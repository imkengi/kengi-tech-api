import { Router, Request, Response } from 'express'
import { errorDetail } from '../lib/errorResponse'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { requireRole } from '../middleware/roleMiddleware'
import { validate } from '../middleware/validate'
import { CreateCustomerSchema, UpdateCustomerSchema } from '../schemas'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'
import { nextCode } from '../lib/codeGenerator'
import { postDebtCollectionJournal } from '../lib/autoJournal'
import { emitEntityEvent } from '../lib/webhookDispatch'

const router = Router()

// Payload gọn cho webhook khách hàng
const customerPayload = (c: any) => ({
    id: c?.id, code: c?.code, name: c?.name, phone: c?.phone ?? null,
    email: c?.email ?? null, address: c?.address ?? null, debt: c?.debt ?? null, groupId: c?.groupId ?? null,
})

// ─── Customers CRUD ─────────────────────────────────────────────────────────

// GET /api/customers/stats
router.get('/stats', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const total = await prisma.customer.count()
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        const newThisMonth = await prisma.customer.count({ where: { createdAt: { gte: monthStart } } })
        const agg = await prisma.customer.aggregate({ _sum: { debt: true, loyaltyPoints: true } })
        res.json({ success: true, data: { total, newThisMonth, totalDebt: agg._sum.debt || 0, totalPoints: agg._sum.loyaltyPoints || 0 } })
    } catch { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// GET /api/customers
router.get('/', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const schema = req.user?.storeSchema || 'default'
        const { search, groupId, salesUserId, page = '1', pageSize = '20' } = req.query

        const cacheKey = `${schema}:customers:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)

        const where: any = {}
        if (search) {
            where.OR = [
                { name: { contains: search as string, mode: 'insensitive' } },
                { phone: { contains: search as string, mode: 'insensitive' } },
                { code: { contains: search as string, mode: 'insensitive' } },
                { email: { contains: search as string, mode: 'insensitive' } },
            ]
        }
        if (groupId) where.groupId = groupId
        if (salesUserId) where.salesUserId = salesUserId

        const pageNum = Math.max(1, parseInt(page as string))
        const size = Math.max(1, Math.min(1000, parseInt(pageSize as string)))
        const skip = (pageNum - 1) * size

        const [total, customers] = await Promise.all([
            prisma.customer.count({ where }),
            prisma.customer.findMany({
                where,
                include: { group: true },
                orderBy: { createdAt: 'desc' },
                skip,
                take: size,
            }),
        ])

        const data = customers.map(c => ({
            ...c,
            lastPurchaseDate: c.lastPurchaseDate?.toISOString(),
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
        }))

        const response = {
            success: true,
            data: {
                items: data,
                total,
                page: pageNum,
                pageSize: size,
                totalPages: Math.ceil(total / size),
            },
        }
        await cacheSet(cacheKey, response, 300)
        res.json(response)
    } catch (err: any) {
        console.error('Get customers error:', err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: errorDetail(err) })
    }
})

// GET /api/customers/segments-live — KH kèm chỉ số mua hàng TÍNH SỐNG từ giao dịch
/**
 * Trang Phân Khúc phân loại bằng totalOrders/totalPurchases/lastPurchaseDate
 * trên bảng Customer — nhưng chỉ luồng POS gốc đắp các cột đó, dữ liệu đổ từ
 * KiotViet thì không, nên cả nghìn khách dồn vào "Chưa mua hàng" (đo
 * 11/08/2026 trên HUTI). Cột `tier` cũng không ai ghi (loyalty dùng bảng
 * LoyaltyMember riêng) — VIP vĩnh viễn rỗng.
 *
 * Ở đây tính lại từ bảng Transaction — nguồn sự thật duy nhất, đúng bất kể
 * dữ liệu vào bằng đường nào — và tự xếp hạng theo chi tiêu:
 *   diamond ≥ 100tr · platinum ≥ 50tr · gold ≥ 20tr · silver ≥ 5tr · bronze
 *
 * CHỈ ĐỌC, không ghi ngược vào Customer: cột cũ để nguyên cho tới khi có
 * quyết định backfill riêng.
 */
router.get('/segments-live', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        /**
         * Lợi nhuận = Σ lineTotal − Σ(số lượng × giá vốn HIỆN TẠI của sản phẩm).
         * TransactionItem không lưu giá vốn tại thời điểm bán nên đây là ước
         * tính theo giá vốn hôm nay — đủ để xếp loại, đừng đem đi quyết toán.
         * Chỉ owner/admin thấy (cùng cổng với lợi nhuận đơn online).
         */
        const laChuCua = ['owner', 'admin'].includes(String((req as any).user?.role || '').toLowerCase())
        const [customers, grp, nam12, gan90, vonRows] = await Promise.all([
            prisma.customer.findMany({
                select: {
                    id: true, code: true, name: true, phone: true, debt: true,
                    createdAt: true, lastPurchaseDate: true,
                },
            }),
            prisma.transaction.groupBy({
                by: ['customerId'],
                where: { customerId: { not: null }, status: { notIn: ['voided', 'returned'] } },
                _count: { _all: true },
                _sum: { total: true },
                _max: { createdAt: true },
            }),
            // CỬA SỔ 12 THÁNG: xếp hạng theo bình quân tháng gần đây, không phải
            // tổng trọn đời — mua một cục năm ngoái rồi biến mất mà vẫn Kim cương
            // là xếp sai (người dùng chỉnh 11/08/2026, ca 'Mỹ Duyên')
            prisma.transaction.groupBy({
                by: ['customerId'],
                where: {
                    customerId: { not: null }, status: { notIn: ['voided', 'returned'] },
                    createdAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
                },
                _count: { _all: true }, _sum: { total: true },
            }),
            // ĐỘ ĐỀU ĐẶN: số đơn 90 ngày gần đây — VIP mà lâu không mua phải lộ ra
            prisma.transaction.groupBy({
                by: ['customerId'],
                where: {
                    customerId: { not: null }, status: { notIn: ['voided', 'returned'] },
                    createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
                },
                _count: { _all: true },
            }),
            laChuCua
                ? (prisma as any).$queryRawUnsafe(
                    `SELECT t."customerId" AS cid,
                            SUM(i."lineTotal")::float AS rev,
                            SUM(i."quantity" * COALESCE(p."costPrice", 0))::float AS von,
                            SUM(i."lineTotal") FILTER (WHERE t."createdAt" >= NOW() - INTERVAL '365 days')::float AS rev12,
                            SUM(i."quantity" * COALESCE(p."costPrice", 0)) FILTER (WHERE t."createdAt" >= NOW() - INTERVAL '365 days')::float AS von12
                     FROM "TransactionItem" i
                     JOIN "Transaction" t ON t."id" = i."transactionId"
                     LEFT JOIN "Product" p ON p."id" = i."productId"
                     WHERE t."customerId" IS NOT NULL
                       AND t."status" NOT IN ('voided', 'returned')
                     GROUP BY t."customerId"`,
                ).catch((e: any) => { console.error('segments-live von:', e?.message); return [] })
                : Promise.resolve([]),
        ])
        const agg = new Map(grp.map((g: any) => [g.customerId as string, g]))
        /**
         * TUỔI NỢ FIFO TRÊN TOÀN BỘ ĐƠN BÁN, neo vào Customer.debt.
         *
         * KHÔNG dùng status/số-đã-thu của từng đơn: thu nợ qua phiếu thu độc
         * lập không đụng hoá đơn nên "chưa thu" từng đơn là SỐ MA — Thúy An
         * mua đều, nợ 9tr, mà bị dán "Chậm 316d" vì đơn partial ma của 316
         * ngày trước (đo 11/08/2026). Quy ước FIFO: tiền trả cover nợ CŨ
         * trước → nợ còn lại nằm ở các đơn MỚI NHẤT. Đi từ đơn bán mới nhất
         * ngược về, gom đủ Customer.debt thì dừng — mốc dừng là tuổi nợ.
         * Cùng quy ước với trang Công nợ.
         */
        const khachCoNo = customers.filter((c: any) => (c.debt ?? 0) > 0).map((c: any) => c.id)
        const mapNo = new Map<string, Array<{ ngay: Date; soTien: number }>>()
        if (khachCoNo.length) {
            const donBan = await prisma.transaction.findMany({
                where: { customerId: { in: khachCoNo }, status: { notIn: ['voided', 'returned'] } },
                select: { customerId: true, createdAt: true, total: true },
                orderBy: { createdAt: 'desc' },
            })
            for (const t of donBan as any[]) {
                const ds = mapNo.get(t.customerId) || []
                ds.push({ ngay: t.createdAt, soTien: t.total || 0 })
                mapNo.set(t.customerId, ds)
            }
        }
        const tuoiNoFifo = (custId: string, debt: number): { tuoi: number; soDon: number } => {
            if (debt <= 0) return { tuoi: 0, soDon: 0 }
            const ds = mapNo.get(custId) || []
            let con = debt, moc: Date | null = null, soDon = 0
            for (const d of ds) {
                moc = d.ngay; soDon++
                con -= d.soTien
                if (con <= 0) break
            }
            // Nợ nhiều hơn tổng đơn bán (dư đầu kỳ không chứng từ): tuổi tính
            // tới đơn cổ nhất có thật, không bịa xa hơn. Không có đơn nào thì
            // không đoán tuổi (0 → 'dungHan', trung tính).
            if (!moc) return { tuoi: 0, soDon: 0 }
            return { tuoi: Math.floor((Date.now() - new Date(moc).getTime()) / (24 * 60 * 60 * 1000)), soDon }
        }
        const map90 = new Map(gan90.map((g: any) => [g.customerId as string, g._count?._all ?? 0]))
        const map12 = new Map(nam12.map((g: any) => [g.customerId as string, g]))
        const mapVon = new Map((vonRows as any[]).map((r: any) => [r.cid as string, r]))
        const NGAY = 24 * 60 * 60 * 1000
        const data = customers.map((c: any) => {
            const a: any = agg.get(c.id)
            const totalOrders = a?._count?._all ?? 0
            const totalPurchases = a?._sum?.total ?? 0
            const lanCuoi = a?._max?.createdAt ?? c.lastPurchaseDate
            /**
             * ĐIỂM KHÁCH 0–100, GỘP 5 YẾU TỐ trên cửa sổ 12 tháng — hạng xếp
             * theo điểm, không theo một con số đơn lẻ (người dùng chỉnh
             * 11/08/2026: tổng trọn đời làm 'Mỹ Duyên mua năm ngoái vẫn Kim
             * cương'; một mình doanh thu tháng cũng chưa đủ):
             *   30đ doanh thu BQ tháng (kịch trần ở 10tr/tháng)
             *   25đ lợi nhuận BQ tháng (kịch trần ở 2tr/tháng — tính nội bộ
             *       cho MỌI người để hạng nhất quán, nhưng CHỈ owner/admin
             *       thấy con số lợi nhuận thô)
             *   20đ đều đặn (kịch trần ở 4 đơn/tháng)
             *   15đ mới mua gần đây (≤30 ngày trọn điểm, >180 ngày 0đ)
             *   10đ trả nợ (hết nợ 10, còn nợ đúng hạn 6, treo >30 ngày 0)
             * Diamond ≥80 · Platinum ≥65 · Gold ≥45 · Silver ≥25 · Bronze.
             */
            const t12: any = map12.get(c.id)
            const v: any = mapVon.get(c.id)
            const doanhThuThang = Math.round(((t12?._sum?.total ?? 0) as number) / 12)
            const donThang = Math.round(((t12?._count?._all ?? 0) as number) / 12 * 10) / 10
            const loiThang = v ? Math.round((((v.rev12 || 0) - (v.von12 || 0)) as number) / 12) : 0
            const ngayCuoi = lanCuoi ? Math.floor((Date.now() - new Date(lanCuoi).getTime()) / NGAY) : null
            const diemDoanhThu = Math.min(30, Math.round(doanhThuThang / 10_000_000 * 30))
            const diemLoiNhuan = Math.min(25, Math.max(0, Math.round(loiThang / 2_000_000 * 25)))
            const diemDeuDan = Math.min(20, Math.round(donThang / 4 * 20))
            const diemGanDay = ngayCuoi == null ? 0 : ngayCuoi <= 30 ? 15 : ngayCuoi <= 60 ? 11 : ngayCuoi <= 90 ? 8 : ngayCuoi <= 180 ? 4 : 0
            // thanhToan tính ở dưới nhưng cần cho điểm — tính trước tại đây
            const noFifo = tuoiNoFifo(c.id, c.debt ?? 0)
            const diemThanhToan = (c.debt ?? 0) <= 0 ? 10 : noFifo.tuoi > 30 ? 0 : 6
            const diemKhach = diemDoanhThu + diemLoiNhuan + diemDeuDan + diemGanDay + diemThanhToan
            const tier = diemKhach >= 80 ? 'diamond' : diemKhach >= 65 ? 'platinum' : diemKhach >= 45 ? 'gold' : diemKhach >= 25 ? 'silver' : 'bronze'

            // ── Trả nợ nhanh hay chậm ── (tuổi FIFO tính ở trên, dùng chung với điểm)
            const soDonGhiNo = noFifo.soDon
            const tuoiNoNgay = noFifo.tuoi
            const debt = c.debt ?? 0
            // Hết nợ = tốt, kể cả từng ghi nợ (đã trả xong là khách đàng hoàng).
            // Còn nợ mà đơn treo lâu nhất quá 30 ngày = chậm.
            const thanhToan = debt <= 0 ? 'tot' : tuoiNoNgay > 30 ? 'cham' : 'dungHan'

            // ── Độ đều đặn mua hàng ──
            const donGan90 = map90.get(c.id) ?? 0
            const ngayTuLanCuoi = lanCuoi
                ? Math.floor((Date.now() - new Date(lanCuoi).getTime()) / NGAY)
                : null
            // deu = >=3 đơn/90 ngày · thinhThoang = có mua trong 90 ngày
            // lau = >90 ngày chưa quay lại · chua = chưa mua bao giờ
            const muaDeu = totalOrders === 0 ? 'chua'
                : donGan90 >= 3 ? 'deu'
                    : (ngayTuLanCuoi != null && ngayTuLanCuoi <= 90) ? 'thinhThoang' : 'lau'

            // ── Mua có lời không ── (chỉ chủ cửa hàng thấy)
            const loiNhuan = laChuCua && v ? Math.round((v.rev || 0) - (v.von || 0)) : null
            const bienLoiNhuan = laChuCua && v && v.rev > 0
                ? Math.round(((v.rev - v.von) / v.rev) * 1000) / 10
                : null

            return {
                id: c.id, code: c.code, name: c.name, phone: c.phone,
                debt, totalOrders, totalPurchases, tier,
                soDonGhiNo, tuoiNoNgay, thanhToan,
                donGan90, ngayTuLanCuoi, muaDeu,
                doanhThuThang, donThang,
                diemKhach,
                diem: { doanhThu: diemDoanhThu, loiNhuan: diemLoiNhuan, deuDan: diemDeuDan, ganDay: diemGanDay, thanhToan: diemThanhToan },
                loiNhuanThang: laChuCua && v ? Math.round((((v.rev12 || 0) - (v.von12 || 0)) as number) / 12) : null,
                loiNhuan, bienLoiNhuan,
                createdAt: c.createdAt.toISOString(),
                lastPurchaseDate: lanCuoi ? new Date(lanCuoi).toISOString() : null,
            }
        })
        res.json({ success: true, data })
    } catch (err) {
        console.error('segments-live error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/customers/:id
router.get('/:id', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        // Check if path is "groups" — handle customer-groups route
        if (req.params.id === 'groups') {
            return res.redirect('/api/customer-groups')
        }

        const customer = await prisma.customer.findFirst({
            where: { id: String(req.params.id) },
            include: { group: true },
        })

        if (!customer) {
            res.status(404).json({ success: false, error: 'Customer not found' })
            return
        }

        // Compute stats dynamically from transactions
        const whereConditions: any[] = [{ customerId: customer.id }]
        if (customer.name) whereConditions.push({ customerName: customer.name })
        if (customer.phone) whereConditions.push({ customerPhone: customer.phone })

        const [txAgg, txCount, lastTx] = await Promise.all([
            prisma.transaction.aggregate({
                // Loại cả đơn trả hàng — tiền đã hoàn thì không tính vào tổng mua
                where: { OR: whereConditions, status: { notIn: ['voided', 'returned'] } },
                _sum: { total: true },
            }),
            prisma.transaction.count({
                where: { OR: whereConditions, status: { not: 'voided' } },
            }),
            prisma.transaction.findFirst({
                where: { OR: whereConditions, status: { not: 'voided' } },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true },
            }),
        ])

        res.json({
            success: true,
            data: {
                ...customer,
                totalPurchases: txAgg._sum.total || 0,
                totalOrders: txCount,
                lastPurchaseDate: lastTx?.createdAt?.toISOString() || customer.lastPurchaseDate?.toISOString(),
                createdAt: customer.createdAt.toISOString(),
                updatedAt: customer.updatedAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Get customer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/customers/:id/purchases
router.get('/:id/purchases', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const custId = String(req.params.id)

        // Also look up customer name/phone so we can match by those too
        const customer = await prisma.customer.findFirst({ where: { id: custId }, select: { name: true, phone: true } })

        const whereConditions: any[] = [{ customerId: custId }]
        if (customer?.name) whereConditions.push({ customerName: customer.name })
        if (customer?.phone) whereConditions.push({ customerPhone: customer.phone })

        const transactions = await prisma.transaction.findMany({
            where: { OR: whereConditions },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { items: true },
        })

        const purchases = transactions.map(t => ({
            id: t.id,
            orderId: t.receiptNumber,
            customerId: custId,
            date: t.createdAt.toISOString(),
            items: t.items.length,
            total: t.total,
            status: t.status === 'voided' ? 'cancelled' : t.status === 'returned' ? 'cancelled' : 'completed',
        }))

        res.json(purchases)
    } catch (err) {
        console.error('Customer purchases error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/customers/:id/prices/:productId
router.get('/:id/prices/:productId', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const custId = String(req.params.id)
        const prodId = String(req.params.productId)

        const customer = await prisma.customer.findFirst({ where: { id: custId }, select: { name: true, phone: true } })

        const whereConditions: any[] = [{ customerId: custId }]
        if (customer?.name) whereConditions.push({ customerName: customer.name })
        if (customer?.phone) whereConditions.push({ customerPhone: customer.phone })

        const transactions = await prisma.transaction.findMany({
            where: {
                OR: whereConditions,
                items: { some: { productId: prodId } }
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
                id: true,
                receiptNumber: true,
                createdAt: true,
                items: {
                    where: { productId: prodId },
                    select: { unitPrice: true }
                }
            }
        })

        const prices: { price: number; date: Date; receiptNumber: string }[] = []
        const seen = new Set<number>()

        for (const tx of transactions) {
            if (!tx.items || tx.items.length === 0) continue;
            for (const item of tx.items) {
                if (!seen.has(item.unitPrice)) {
                    seen.add(item.unitPrice)
                    prices.push({
                        price: item.unitPrice,
                        date: tx.createdAt,
                        receiptNumber: tx.receiptNumber
                    })
                    if (prices.length >= 5) break
                }
            }
            if (prices.length >= 5) break
        }

        res.json({ success: true, data: prices })
    } catch (err) {
        console.error('Customer product prices error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


// GET /api/customers/:id/debt-history — Build debt movement history from transactions + DebtEntry
/**
 * Tách thành hàm để /admin/debt-trace tái hiện ĐÚNG con số mà nút In hoá đơn
 * sẽ ra (FE tính "nợ cũ" = balance − amount của dòng Bán hàng). Truy lỗi mà
 * chép lại thuật toán ở chỗ khác là truy một bản sao, không phải thứ đang chạy.
 */
export async function buildDebtHistory(prisma: any, custId: string): Promise<{
    customer: { name: string | null; phone: string | null; debt: number } | null
    history: any[]
}> {
    {
        const customer = await prisma.customer.findFirst({
            where: { id: custId },
            select: { name: true, phone: true, debt: true },
        })
        if (!customer) {
            return { customer: null, history: [] }
        }

        // 1. Get ALL transactions for this customer
        // Ưu tiên match theo customerId; chỉ fallback name/phone cho giao dịch cũ
        // CHƯA gắn customerId — tránh dính giao dịch của khách khác trùng tên/SĐT.
        const whereConditions: any[] = [{ customerId: custId }]
        if (customer.name) whereConditions.push({ customerId: null, customerName: customer.name })
        if (customer.phone) whereConditions.push({ customerId: null, customerPhone: customer.phone })

        const transactions = await prisma.transaction.findMany({
            where: { OR: whereConditions },
            include: { payments: true },
            orderBy: { createdAt: 'asc' },
        })

        // 2. Get DebtEntry records
        const debtEntries = await prisma.debtEntry.findMany({
            where: { customerId: custId },
            orderBy: { createdAt: 'asc' },
        })

        // AuditLog source removed — Payment records cover pay_debt events

        console.log(`[debt-history] Customer ${custId}: ${transactions.length} txs, ${debtEntries.length} entries`)

        interface DebtHistoryItem {
            id: string
            code: string
            date: string
            type: 'sale' | 'payment' | 'debt' | 'manual_payment' | 'return'
            label: string
            amount: number
            balance: number
        }

        const history: DebtHistoryItem[] = []
        let ptCounter = 0 // Counter for PT (Phiếu Thu) codes

        // Helper: generate PT code from receipt number or sequential
        const makePTCode = (receiptNumber?: string) => {
            ptCounter++
            if (receiptNumber) {
                // HD026877 → PT026877
                const digits = receiptNumber.replace(/\D/g, '')
                if (digits) return `PT${digits}`
            }
            return `PT${String(ptCounter).padStart(5, '0')}`
        }

        for (const t of transactions) {
            // Skip voided transactions
            if (t.status === 'voided') continue

            // Đơn trả hàng: KHÔNG continue — vẫn ghi entry bán hàng + các phiếu thu
            // của chính đơn đó như đơn thường (continue làm mất chúng → running
            // balance âm giả), chỉ THÊM entry "Trả hàng"; sort theo thời gian ở
            // cuối lo thứ tự. Schema chưa có trường refund/returnedAmount riêng
            // nên số hoàn vẫn dùng total như cũ.
            if (t.status === 'returned') {
                const digits = t.receiptNumber?.replace(/\D/g, '') || ''
                history.push({
                    id: `${t.id}-return`,
                    code: `TH${digits || String(++ptCounter).padStart(5, '0')}`,
                    date: ((t as any).returnedAt || (t as any).updatedAt || t.createdAt).toISOString(),
                    type: 'return',
                    label: 'Trả hàng',
                    amount: -t.total,
                    balance: 0,
                })
            }

            // ── 1. "Bán hàng" entry: total invoice amount (increases debt)
            if (t.total > 0) {
                history.push({
                    id: t.id,
                    code: t.receiptNumber,
                    date: t.createdAt.toISOString(),
                    type: 'sale',
                    label: 'Bán hàng',
                    amount: t.total,
                    balance: 0,
                })
            }

            // ── 2. "Phiếu thu lúc bán": payments at time of sale
            //    = all payments that are NOT credit AND NOT "Thanh toán nợ"
            const salePayments = t.payments.filter((p: any) =>
                p.type !== 'credit' &&
                !(p.reference && p.reference.includes('Thanh toán nợ'))
            )
            const saleReceived = salePayments.reduce((sum: number, p: any) => sum + p.amount, 0)
            if (saleReceived > 0) {
                history.push({
                    id: `${t.id}-receipt`,
                    code: makePTCode(t.receiptNumber),
                    date: t.createdAt.toISOString(),
                    type: 'payment',
                    label: 'Phiếu thu',
                    amount: -saleReceived,
                    balance: 0,
                })
            }

            // ── 3. "Phiếu thu trả nợ": each debt payment record
            const debtPaymentRecords = t.payments.filter((p: any) =>
                p.reference && p.reference.includes('Thanh toán nợ')
            )
            for (const dp of debtPaymentRecords) {
                if (dp.amount <= 0) continue
                history.push({
                    id: dp.id,
                    code: makePTCode(t.receiptNumber),
                    date: (dp as any).createdAt?.toISOString?.() || t.createdAt.toISOString(),
                    type: 'payment',
                    label: 'Phiếu thu',
                    amount: -dp.amount,
                    balance: 0,
                })
            }
        }

        // ❌ AuditLog source REMOVED — already covered by Payment records above

        // From DebtEntry records.
        // Các entry TỰ ĐỘNG sinh từ luồng hóa đơn (bán chịu POS, thu nợ theo HĐ,
        // trả hàng theo HĐ, hủy đơn, hủy phiếu thu) phải BỎ QUA ở đây — phía
        // transaction/payment phía trên đã thể hiện đúng các phát sinh đó, đếm
        // thêm entry là double-count. Entry thủ công / phiếu thu độc lập vẫn tính.
        const TX_LINKED_ENTRY = [
            /^Nợ từ HĐ /,
            /^Thanh toán nợ HĐ /,
            /^Trả hàng theo HĐ /,
            /^Hủy đơn .+ - xóa nợ$/,
            /^Hủy phiếu thu( nợ)? HĐ /,
        ]
        for (const e of debtEntries) {
            if (TX_LINKED_ENTRY.some(rx => rx.test(e.description || ''))) continue
            let entryCode = makePTCode()
            let entryType: DebtHistoryItem['type'] = 'manual_payment'
            let entryLabel = 'Phiếu thu'
            let entryAmount = -e.amount

            if (e.type === 'debt') {
                entryCode = 'GN'
                entryType = 'debt'
                entryLabel = 'Ghi nợ'
                entryAmount = e.amount
            } else if (e.type === 'return') {
                // Generate TH (Trả Hàng) code
                const thNum = String(ptCounter).padStart(5, '0')
                entryCode = `TH${thNum}`
                entryType = 'return'
                entryLabel = 'Phiếu trả hàng'
                entryAmount = -e.amount
            }

            history.push({
                id: e.id,
                code: entryCode,
                date: e.createdAt.toISOString(),
                type: entryType,
                label: entryLabel,
                amount: entryAmount,
                balance: 0,
            })
        }

        // Sort by date ascending and calculate running balance
        history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

        /**
         * NEO LUỸ KẾ VÀO SỐ DƯ THẬT, KHÔNG BẮT ĐẦU TỪ 0.
         *
         * Bắt đầu từ 0 chỉ đúng khi lịch sử chứa MỌI phát sinh từ ngày đầu tiên.
         * Dữ liệu nhập từ phần mềm khác thì không: có thể có 4.016 hoá đơn nhưng
         * 7.971 phiếu thu trải từ nhiều năm trước — trả nhiều hơn bán, luỹ kế
         * âm, `Math.max(0, …)` kẹp mọi dòng về 0 và cột dư nợ vô nghĩa
         * (đo 08/08/2026 trên khách HA01: nợ 340.962.385 mà mọi dòng hiện 0).
         *
         * `Customer.debt` mới là số dư có thẩm quyền. Suy ngược ra dư đầu kỳ để
         * dòng CUỐI CÙNG luôn bằng đúng số dư hiện tại — cùng cách /debts/summary
         * đang làm. Phần không giải thích được nằm gọn ở dòng "Dư nợ đầu kỳ".
         */
        const net = history.reduce((s, i) => s + i.amount, 0)
        const openingBalance = (customer.debt ?? 0) - net
        if (Math.round(openingBalance) !== 0) {
            history.unshift({
                id: 'opening-balance',
                code: 'DK',
                date: history[0]?.date || new Date(0).toISOString(),
                type: 'debt',
                label: 'Dư nợ đầu kỳ',
                amount: openingBalance,
                balance: openingBalance,
            })
        }
        let runningBalance = 0
        for (const item of history) {
            runningBalance += item.amount
            item.balance = runningBalance
        }

        // Return newest first
        history.reverse()

        return { customer, history }
    }
}

router.get('/:id/debt-history', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const { customer, history } = await buildDebtHistory(req.storePrisma!, String(req.params.id))
        if (!customer) {
            res.status(404).json({ success: false, error: 'Customer not found' })
            return
        }
        res.json({ success: true, data: history })
    } catch (err) {
        console.error('Get customer debt history error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


// POST /api/customers/:id/cancel-receipt
// Cancel a "Phiếu thu" — keep the sale, convert it to debt
// Body: { entryId: string } — the debt-history item id
//   - "<txId>-receipt" → sale-time receipt: drop non-credit payments, add credit, status=partial, debt+=amount
//   - Payment.id ("Thanh toán nợ") → debt-payment receipt: delete payment, status=partial, debt+=amount
//   - DebtEntry.id (type=payment) → manual payment: delete entry, debt+=amount
router.post('/:id/cancel-receipt', authMiddleware, requireRole('admin', 'manager', 'superadmin', 'owner'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const customerId = String(req.params.id)
        const entryId: string = String(req.body?.entryId || '').trim()
        if (!entryId) {
            res.status(400).json({ success: false, error: 'entryId required' })
            return
        }

        const customer = await prisma.customer.findFirst({ where: { id: customerId } })
        if (!customer) {
            res.status(404).json({ success: false, error: 'Customer not found' })
            return
        }

        const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
        const userName = user?.name || 'Admin'

        let cancelledAmount = 0
        let cancelledCode = ''
        let scope: 'sale-receipt' | 'debt-payment' | 'manual' = 'sale-receipt'

        // ── Case 1: sale-time receipt ────────────────────────────────────────
        if (entryId.endsWith('-receipt')) {
            const txId = entryId.slice(0, -'-receipt'.length)
            const tx = await prisma.transaction.findUnique({
                where: { id: txId },
                include: { payments: true },
            })
            if (!tx) {
                res.status(404).json({ success: false, error: 'Transaction not found' })
                return
            }
            // Chống nhầm khách: giao dịch phải thuộc đúng khách :id — gọi với id khách X
            // + phiếu của khách Y sẽ làm sổ nợ CẢ HAI khách sai. Giao dịch cũ chưa gắn
            // customerId thì đối chiếu tên/SĐT (cùng logic match của debt-history).
            const ownsTx = tx.customerId
                ? tx.customerId === customerId
                : Boolean((customer.name && tx.customerName === customer.name) ||
                    (customer.phone && tx.customerPhone === customer.phone))
            if (!ownsTx) {
                res.status(404).json({ success: false, error: 'Transaction not found' })
                return
            }
            if (tx.status === 'voided' || tx.status === 'returned') {
                res.status(400).json({ success: false, error: 'Giao dịch đã hủy/trả hàng' })
                return
            }
            const saleReceipts = tx.payments.filter(p =>
                p.type !== 'credit' &&
                !(p.reference && p.reference.includes('Thanh toán nợ'))
            )
            cancelledAmount = saleReceipts.reduce((s, p) => s + p.amount, 0)
            if (cancelledAmount <= 0) {
                res.status(400).json({ success: false, error: 'Không có phiếu thu để hủy' })
                return
            }

            await prisma.$transaction(async (tx2) => {
                // Drop non-credit payments
                await tx2.payment.deleteMany({
                    where: { id: { in: saleReceipts.map(p => p.id) } },
                })
                // Ensure a credit payment exists for the cancelled amount
                const existingCredit = tx.payments.find(p => p.type === 'credit')
                if (existingCredit) {
                    await tx2.payment.update({
                        where: { id: existingCredit.id },
                        data: { amount: existingCredit.amount + cancelledAmount },
                    })
                } else {
                    await tx2.payment.create({
                        data: {
                            transactionId: tx.id,
                            type: 'credit',
                            amount: cancelledAmount,
                            reference: `Hủy phiếu thu ${tx.receiptNumber}`,
                        },
                    })
                }
                // Update tx: amountReceived down, status partial
                await tx2.transaction.update({
                    where: { id: tx.id },
                    data: {
                        amountReceived: Math.max(0, (tx.amountReceived ?? 0) - cancelledAmount),
                        status: 'partial',
                    },
                })
                // Customer debt up
                await tx2.customer.update({
                    where: { id: customerId },
                    data: { debt: { increment: cancelledAmount } },
                })
                // Ghi sổ chi tiết: hủy phiếu thu = ghi nợ lại
                await tx2.debtEntry.create({
                    data: {
                        customerId,
                        customerName: customer.name,
                        phone: customer.phone || null,
                        type: 'debt',
                        amount: cancelledAmount,
                        description: `Hủy phiếu thu HĐ ${tx.receiptNumber} - ghi nợ lại`,
                        balance: Math.max(0, customer.debt) + cancelledAmount,
                    },
                })
            })

            cancelledCode = `PT${(tx.receiptNumber || '').replace(/\D/g, '')}`
            scope = 'sale-receipt'
        }

        // ── Case 2: debt-payment receipt (Payment.id) ────────────────────────
        else if (await prisma.payment.findUnique({ where: { id: entryId } })) {
            const payment = await prisma.payment.findUnique({
                where: { id: entryId },
                include: { transaction: true },
            })
            if (!payment) {
                res.status(404).json({ success: false, error: 'Payment not found' })
                return
            }
            if (!payment.reference || !payment.reference.includes('Thanh toán nợ')) {
                res.status(400).json({ success: false, error: 'Phiếu này không phải phiếu thu nợ — vui lòng hủy theo đường khác' })
                return
            }
            // Chống nhầm khách: so customerId của giao dịch cha với khách :id
            // (giao dịch cũ chưa gắn customerId thì đối chiếu tên/SĐT).
            const parentTx = payment.transaction
            const ownsPayment = parentTx.customerId
                ? parentTx.customerId === customerId
                : Boolean((customer.name && parentTx.customerName === customer.name) ||
                    (customer.phone && parentTx.customerPhone === customer.phone))
            if (!ownsPayment) {
                res.status(404).json({ success: false, error: 'Payment not found' })
                return
            }
            cancelledAmount = payment.amount
            const tx = payment.transaction

            await prisma.$transaction(async (tx2) => {
                await tx2.payment.delete({ where: { id: payment.id } })
                const newReceived = Math.max(0, (tx.amountReceived ?? 0) - cancelledAmount)
                await tx2.transaction.update({
                    where: { id: tx.id },
                    data: {
                        amountReceived: newReceived,
                        status: newReceived < tx.total ? 'partial' : tx.status,
                    },
                })
                await tx2.customer.update({
                    where: { id: customerId },
                    data: { debt: { increment: cancelledAmount } },
                })
                // Ghi sổ chi tiết: hủy phiếu thu nợ = ghi nợ lại
                await tx2.debtEntry.create({
                    data: {
                        customerId,
                        customerName: customer.name,
                        phone: customer.phone || null,
                        type: 'debt',
                        amount: cancelledAmount,
                        description: `Hủy phiếu thu nợ HĐ ${tx.receiptNumber} - ghi nợ lại`,
                        balance: Math.max(0, customer.debt) + cancelledAmount,
                    },
                })
            })

            cancelledCode = `PT${(tx.receiptNumber || '').replace(/\D/g, '')}`
            scope = 'debt-payment'
        }

        // ── Case 3: manual DebtEntry payment ─────────────────────────────────
        else if (await prisma.debtEntry.findUnique({ where: { id: entryId } })) {
            const entry = await prisma.debtEntry.findUnique({ where: { id: entryId } })
            if (!entry) {
                res.status(404).json({ success: false, error: 'Debt entry not found' })
                return
            }
            if (entry.type !== 'payment') {
                res.status(400).json({ success: false, error: 'Mục này không phải phiếu thu' })
                return
            }
            // Chống nhầm khách: entry phải thuộc đúng khách :id
            if (entry.customerId !== customerId) {
                res.status(404).json({ success: false, error: 'Debt entry not found' })
                return
            }
            cancelledAmount = entry.amount

            await prisma.$transaction(async (tx2) => {
                await tx2.debtEntry.delete({ where: { id: entry.id } })
                await tx2.customer.update({
                    where: { id: customerId },
                    data: { debt: { increment: cancelledAmount } },
                })
            })

            cancelledCode = 'PT (thủ công)'
            scope = 'manual'
        }

        else {
            res.status(404).json({ success: false, error: 'Không tìm thấy phiếu thu để hủy' })
            return
        }

        // Audit log (best-effort)
        try {
            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    userName,
                    action: 'cancel_receipt',
                    entity: 'Customer',
                    entityId: customerId,
                    details: JSON.stringify({ entryId, scope, amount: cancelledAmount, code: cancelledCode }),
                },
            })
        } catch { }

        cacheDel(`${req.user?.storeSchema || 'default'}:*:transactions:*`).catch(() => { })
        cacheDel(`${req.user?.storeSchema || 'default'}:customers:*`).catch(() => { })

        console.log(`🚫 Cancelled receipt ${cancelledCode} (${scope}) — ${cancelledAmount} for customer ${customerId}`)

        res.json({
            success: true,
            data: { entryId, scope, amount: cancelledAmount, code: cancelledCode },
        })
    } catch (err) {
        console.error('Cancel receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


// POST /api/customers
router.post('/', authMiddleware, requirePermission('customers.create'), validate(CreateCustomerSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, phone, email, address, notes, groupId, birthday, gender, taxCode, salesUserId, salesUserName } = req.body

        if (!name) {
            res.status(400).json({ success: false, error: 'Name is required' })
            return
        }

        // Auto-generate customer code if not provided. Uses an atomic sequence
        // so concurrent POST /api/customers cannot mint the same code twice.
        let code = req.body.code
        if (!code) {
            code = await nextCode(prisma, 'customerCodeSeq', 'KH', 3, '', 'Customer', 'code')
        }

        const customer = await prisma.customer.create({
            data: {
                code,
                name,
                phone: phone || '',
                email: email || null,
                address: address || null,
                notes: notes || null,
                groupId: groupId || null,
                birthday: birthday || null,
                gender: gender || null,
                salesUserId: salesUserId || null,
                salesUserName: salesUserName || null,
            },
            include: { group: true },
        })

        res.status(201).json({
            success: true,
            data: {
                ...customer,
                lastPurchaseDate: customer.lastPurchaseDate?.toISOString(),
                createdAt: customer.createdAt.toISOString(),
                updatedAt: customer.updatedAt.toISOString(),
            },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:customers:*`).catch(() => { })
        emitEntityEvent(prisma, 'customer.created', customerPayload(customer), req.user?.storeSchema).catch(() => { })
    } catch (err) {
        console.error('Create customer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/customers/:id
router.put('/:id', authMiddleware, requirePermission('customers.edit'), validate(UpdateCustomerSchema), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const existing = await prisma.customer.findFirst({ where: { id: String(req.params.id) } })
        if (!existing) return res.status(404).json({ success: false, error: 'Customer not found' })
        // Explicitly allowlist updatable fields — prevent overwriting debt/points via mass assignment
        const { name, phone, email, address, groupId, taxCode, note, notes, loyaltyPoints, birthday, gender, salesUserId, salesUserName } = req.body
        const customer = await prisma.customer.update({
            where: { id: existing.id },
            data: {
                ...(name !== undefined && { name }),
                ...(phone !== undefined && { phone }),
                ...(email !== undefined && { email }),
                ...(address !== undefined && { address }),
                ...(groupId !== undefined && { groupId: groupId || null }),
                ...(taxCode !== undefined && { taxCode }),
                ...(note !== undefined && { note }),
                ...(notes !== undefined && { notes }),
                ...(loyaltyPoints !== undefined && { loyaltyPoints }),
                ...(birthday !== undefined && { birthday: birthday || null }),
                ...(gender !== undefined && { gender: gender || null }),
                ...(salesUserId !== undefined && { salesUserId: salesUserId || null }),
                ...(salesUserName !== undefined && { salesUserName: salesUserName || null }),
            },
        })

        res.json({
            success: true,
            data: {
                ...customer,
                lastPurchaseDate: customer.lastPurchaseDate?.toISOString(),
                createdAt: customer.createdAt.toISOString(),
                updatedAt: customer.updatedAt.toISOString(),
            },
        })
        cacheDel(`${req.user?.storeSchema || 'default'}:customers:*`).catch(() => { })
        emitEntityEvent(prisma, 'customer.updated', customerPayload(customer), req.user?.storeSchema).catch(() => { })
    } catch (err) {
        console.error('Update customer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/customers/:id
router.delete('/:id', authMiddleware, requirePermission('customers.delete'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        // Verify ownership before delete
        const toDelete = await prisma.customer.findFirst({ where: { id: String(req.params.id) } })
        if (!toDelete) return res.status(404).json({ success: false, error: 'Customer not found' })
        await prisma.customer.delete({ where: { id: toDelete.id } })
        res.json({ success: true, message: 'Customer deleted' })
        emitEntityEvent(prisma, 'customer.deleted', customerPayload(toDelete), req.user?.storeSchema).catch(() => { })
    } catch (err) {
        console.error('Delete customer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PATCH /api/customers/:id/geocode — Lưu tọa độ geocode vào database
router.patch('/:id/geocode', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { latitude, longitude } = req.body
        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
            res.status(400).json({ success: false, error: 'latitude and longitude are required numbers' })
            return
        }
        const existing = await prisma.customer.findFirst({ where: { id: String(req.params.id) } })
        if (!existing) {
            res.status(404).json({ success: false, error: 'Customer not found' })
            return
        }
        await prisma.customer.update({
            where: { id: existing.id },
            data: { latitude, longitude },
        })
        // Clear cache so next fetch includes new coordinates
        cacheDel(`${req.user?.storeSchema || 'default'}:customers:*`).catch(() => {})
        res.json({ success: true })
    } catch (err) {
        console.error('Geocode customer error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/customers/:id/pay-debt — Pay down customer debt
router.post('/:id/pay-debt', authMiddleware, requireRole('admin', 'manager', 'superadmin', 'owner'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { amount, method, reference, note } = req.body

        if (!amount || amount <= 0) {
            res.status(400).json({ success: false, error: 'Amount must be positive' })
            return
        }

        const customer = await prisma.customer.findFirst({
            where: { id: String(req.params.id) },
        })

        if (!customer) {
            res.status(404).json({ success: false, error: 'Customer not found' })
            return
        }

        // Không cho thu quá số nợ hiện có (clamp về Customer.debt — nguồn sự thật)
        const payAmount = Math.min(amount, customer.debt)
        if (payAmount <= 0) {
            res.status(400).json({ success: false, error: 'Khách hàng không còn công nợ' })
            return
        }

        // Số dư hiện tại lấy từ Customer.debt (nguồn sự thật) — KHÔNG lấy từ
        // lastEntry.balance vì sổ chi tiết có thể lệch (entry cũ/xóa tay).
        const currentBalance = Math.max(0, customer.debt)

        // Sổ chi tiết + số dư + bút toán phải đi cùng nhau trong một transaction
        const updated = await prisma.$transaction(async (tx) => {
            const debtEntry = await tx.debtEntry.create({
                data: {
                    customerId: customer.id,
                    customerName: customer.name,
                    phone: customer.phone || '',
                    type: 'payment',
                    amount: payAmount,
                    description: note || reference || `Thanh toán nợ (${method || 'cash'})`,
                    balance: Math.max(0, currentBalance - payAmount),
                },
            })

            const updatedCustomer = await tx.customer.update({
                where: { id: String(req.params.id) },
                data: {
                    debt: { decrement: payAmount },
                },
                include: { group: true },
            })

            // Bút toán giảm phải thu: Nợ 111/112 / Có 131.
            // refKey xác định theo DebtEntry vừa tạo (không dùng Date.now()) —
            // idempotent khi retry nhờ JournalEntry.reference @unique.
            await postDebtCollectionJournal(tx, {
                amount: payAmount,
                refKey: `COLLECT-CUST-${customer.id}-${debtEntry.id}`,
                date: new Date().toISOString().slice(0, 10),
                paymentType: method,
                customerName: customer.name,
                branchId: (customer as any).branchId ?? null,
                userId: req.user?.userId ?? null,
            })

            return updatedCustomer
        })

        console.log(`💰 Customer ${customer.name} paid debt: ${payAmount} (remaining: ${updated.debt})`)

        res.json({
            success: true,
            data: {
                ...updated,
                paidAmount: payAmount,
                remainingDebt: updated.debt,
                lastPurchaseDate: updated.lastPurchaseDate?.toISOString(),
                createdAt: updated.createdAt.toISOString(),
                updatedAt: updated.updatedAt.toISOString(),
            },
        })
    } catch (err) {
        console.error('Pay customer debt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router

