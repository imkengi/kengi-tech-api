// ═════════════════════════════════════════════════════════════════════════════
//  MCP — VẬN HÀNH CỬA HÀNG (đọc nhiều, ghi ít và an toàn)
//
//  Bổ khuyết mảng agent trước đây mù: việc cần xử lý, nhà cung cấp, hạn trả nợ,
//  công nợ khách, chi tiết đơn/khách/đơn sàn, sao kê, kho, khuyến mãi, nhân sự.
//
//  RANH GIỚI GHI (03/09/2026): chỉ mở những thao tác KHÔNG đụng tồn kho và
//  KHÔNG chuyển tiền — create_supplier, create_expense, create_draft_import_receipt.
//  Nhập kho thật, trả tiền NCC, huỷ đơn… vẫn phải do người bấm trên web: các
//  luồng đó kéo theo giá vốn bình quân, WarehouseStock, bút toán và công nợ —
//  agent làm sai một nhịp là phải gỡ cả chuỗi.
// ═════════════════════════════════════════════════════════════════════════════

import { Tool, ToolError, ToolCtx } from '../lib/mcpTypes'
import { tinhViecCanLam } from '../lib/viecCanLam'
import { postExpenseJournal } from '../lib/autoJournalPurchase'
import { timPhieuTrungSoHoaDon } from './importReceipts'

const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d)
const gioiHan = (v: any, mac = 20, tran = 100) => Math.min(Math.max(num(v, mac), 1), tran)
const ngayVN = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null)

export const OPS_TOOLS: Tool[] = [
    // ─── Việc cần xử lý ──────────────────────────────────────────────────────
    {
        name: 'viec_can_lam',
        description: 'DANH SÁCH VIỆC CẦN XỬ LÝ NGAY của cửa hàng: hàng hết/sắp hết, tồn âm, nợ NCC tới hạn, khách nợ, đơn sàn chờ, hoá đơn điện tử lỗi, sao kê chưa đối soát, số hoá đơn nhập trùng, phiếu nháp, sửa chữa đang mở, báo giá chưa chốt. Gọi ĐẦU TIÊN khi chủ shop hỏi "hôm nay cần làm gì" hoặc "có gì gấp không". Mỗi việc kèm mức độ (khan/canhBao/nhac), số lượng và trang xử lý.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (_a, { prisma }) => {
            const kq = await tinhViecCanLam(prisma)
            return {
                ...kq,
                ghiChu: kq.khongDocDuoc.length
                    ? `KHÔNG đọc được: ${kq.khongDocDuoc.join(', ')} — đừng kết luận "không có việc" ở những mục này.`
                    : null,
            }
        },
    },

    // ─── Nhà cung cấp ────────────────────────────────────────────────────────
    {
        name: 'list_suppliers',
        description: 'Danh sách nhà cung cấp kèm công nợ phải trả (payable) và điều khoản thanh toán. Tìm theo tên / mã / mã số thuế.',
        inputSchema: {
            type: 'object',
            properties: {
                search: { type: 'string', description: 'Từ khoá tên / mã / MST' },
                con_no: { type: 'boolean', description: 'true = chỉ lấy NCC đang còn nợ' },
                limit: { type: 'number', description: 'Mặc định 20, tối đa 100' },
            },
        },
        run: async (a, { prisma }) => {
            const where: any = {}
            if (a.search) {
                const q = String(a.search)
                where.OR = [
                    { name: { contains: q, mode: 'insensitive' } },
                    { code: { contains: q, mode: 'insensitive' } },
                    { taxCode: { contains: q } },
                ]
            }
            if (a.con_no) where.payable = { gt: 0 }
            const ds = await prisma.supplier.findMany({
                where, take: gioiHan(a.limit),
                orderBy: [{ payable: 'desc' }, { name: 'asc' }],
                select: {
                    id: true, code: true, name: true, phone: true, taxCode: true,
                    payable: true, paymentTermDays: true, status: true, totalValue: true,
                },
            })
            return { soKetQua: ds.length, nhaCungCap: ds }
        },
    },
    {
        name: 'create_supplier',
        description: 'Tạo nhà cung cấp mới (chỉ danh mục — không phát sinh công nợ hay tiền). Dùng trước khi lập phiếu nhập cho NCC chưa có trong hệ thống.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Tên nhà cung cấp' },
                phone: { type: 'string' },
                taxCode: { type: 'string', description: 'Mã số thuế' },
                address: { type: 'string' },
                contactName: { type: 'string', description: 'Người liên hệ' },
                paymentTermDays: { type: 'number', description: 'Số ngày được nợ (0 = trả ngay)' },
            },
            required: ['name'],
        },
        run: async (a, { prisma }) => {
            const ten = String(a.name || '').trim()
            if (!ten) throw new ToolError('Thiếu tên nhà cung cấp')
            const trung = await prisma.supplier.findFirst({ where: { name: { equals: ten, mode: 'insensitive' } } })
            if (trung) throw new ToolError(`Đã có nhà cung cấp "${trung.name}" (mã ${trung.code}) — dùng lại thay vì tạo trùng`)
            const dem = await prisma.supplier.count()
            const code = `NCC${String(dem + 1).padStart(4, '0')}`
            const row = await prisma.supplier.create({
                data: {
                    code, name: ten,
                    phone: a.phone ? String(a.phone) : null,
                    taxCode: a.taxCode ? String(a.taxCode) : null,
                    address: a.address ? String(a.address) : null,
                    contactName: a.contactName ? String(a.contactName) : null,
                    paymentTermDays: a.paymentTermDays != null ? num(a.paymentTermDays, 0) : null,
                },
            })
            return { daTao: true, nhaCungCap: row }
        },
    },

    // ─── Nhập hàng ───────────────────────────────────────────────────────────
    {
        name: 'check_duplicate_invoice',
        description: 'Kiểm tra một SỐ HOÁ ĐƠN đầu vào đã được nhập chưa (theo nhà cung cấp, hoặc toàn bộ nếu không biết NCC). Gọi TRƯỚC khi lập phiếu nhập: nhập trùng số hoá đơn là khai trùng thuế GTGT khấu trừ và trùng chi phí được trừ.',
        inputSchema: {
            type: 'object',
            properties: {
                vat_invoice_no: { type: 'string', description: 'Số hoá đơn GTGT đầu vào' },
                supplier_id: { type: 'string', description: 'id NCC (nếu biết)' },
                supplier_name: { type: 'string', description: 'Tên NCC (nếu không có id)' },
            },
            required: ['vat_invoice_no'],
        },
        run: async (a, { prisma }) => {
            const trung = await timPhieuTrungSoHoaDon(prisma, {
                vatInvoiceNo: String(a.vat_invoice_no),
                supplierId: a.supplier_id ? String(a.supplier_id) : null,
                supplierName: a.supplier_name ? String(a.supplier_name) : null,
            })
            if (!trung) return { trung: false, ketLuan: 'Chưa có phiếu nhập nào dùng số hoá đơn này — nhập được.' }
            return {
                trung: true,
                phieuTrung: trung.code,
                nhaCungCapPhieuCu: trung.supplierName,
                cungNhaCungCap: trung.cungNcc,
                ketLuan: trung.cungNcc
                    ? `TRÙNG: số này đã có ở phiếu ${trung.code} của cùng nhà cung cấp. KHÔNG nhập lại.`
                    : `Số này đã dùng ở phiếu ${trung.code} (NCC "${trung.supplierName || 'không ghi tên'}"). Nếu là NCC khác thì phải ghi rõ nhà cung cấp cho phiếu mới.`,
            }
        },
    },
    {
        name: 'create_draft_import_receipt',
        description: 'Lập phiếu nhập hàng ở trạng thái NHÁP (chưa cộng tồn kho, chưa ghi sổ, chưa sinh công nợ). Dùng để agent chuẩn bị sẵn phiếu từ hoá đơn/tin nhắn NCC; người thật mở web bấm Hoàn tất mới vào kho. Tự chặn nếu số hoá đơn đã dùng.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                supplier_id: { type: 'string', description: 'id NCC (ưu tiên; tra bằng list_suppliers)' },
                supplier_name: { type: 'string', description: 'Tên NCC nếu chưa có id' },
                vat_invoice_no: { type: 'string', description: 'Số hoá đơn GTGT đầu vào' },
                note: { type: 'string' },
                items: {
                    type: 'array',
                    description: 'Các dòng hàng: sku (hoặc id) + số lượng + giá nhập',
                    items: {
                        type: 'object',
                        properties: {
                            sku_or_id: { type: 'string' },
                            quantity: { type: 'number' },
                            cost_price: { type: 'number', description: 'Giá nhập một đơn vị' },
                        },
                        required: ['sku_or_id', 'quantity', 'cost_price'],
                    },
                },
            },
            required: ['items'],
        },
        run: async (a, ctx: ToolCtx) => {
            const { prisma } = ctx
            const dong: any[] = Array.isArray(a.items) ? a.items : []
            if (!dong.length) throw new ToolError('Phiếu nhập phải có ít nhất một dòng hàng')

            if (a.vat_invoice_no) {
                const trung = await timPhieuTrungSoHoaDon(prisma, {
                    vatInvoiceNo: String(a.vat_invoice_no),
                    supplierId: a.supplier_id ? String(a.supplier_id) : null,
                    supplierName: a.supplier_name ? String(a.supplier_name) : null,
                })
                if (trung) {
                    throw new ToolError(
                        `Số hoá đơn "${a.vat_invoice_no}" đã dùng ở phiếu ${trung.code}`
                        + (trung.cungNcc ? ' của cùng nhà cung cấp' : ` (NCC "${trung.supplierName || 'không ghi tên'}")`)
                        + '. Không lập phiếu trùng — kiểm tra lại số hoặc mở phiếu cũ.',
                    )
                }
            }

            const items: any[] = []
            for (const d of dong) {
                const key = String(d.sku_or_id || '')
                const p = await prisma.product.findFirst({ where: { OR: [{ sku: key }, { id: key }, { barcode: key }] } })
                if (!p) throw new ToolError(`Không tìm thấy hàng hoá "${key}" — tra bằng search_products trước`)
                const qty = num(d.quantity, 0), gia = num(d.cost_price, 0)
                if (qty <= 0) throw new ToolError(`Số lượng phải > 0 (dòng ${key})`)
                items.push({ productId: p.id, productName: p.name, productSku: p.sku, quantity: qty, costPrice: gia, total: qty * gia })
            }
            const totalCost = items.reduce((s, i) => s + i.total, 0)
            const totalItems = items.reduce((s, i) => s + i.quantity, 0)

            const d = new Date()
            const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
            const demNgay = await prisma.importReceipt.count({ where: { code: { startsWith: `NH-${stamp}` } } })
            const code = `NH-${stamp}-${String(demNgay + 1).padStart(3, '0')}`

            const receipt = await prisma.importReceipt.create({
                data: {
                    code,
                    supplierId: a.supplier_id ? String(a.supplier_id) : null,
                    supplierName: a.supplier_name ? String(a.supplier_name) : null,
                    totalCost, totalItems,
                    status: 'draft',                 // NHÁP: chưa đụng tồn kho / sổ sách
                    paidAmount: 0,
                    paymentStatus: 'unpaid',
                    hasVatInvoice: Boolean(a.vat_invoice_no),
                    vatInvoiceNo: a.vat_invoice_no ? String(a.vat_invoice_no) : null,
                    note: a.note ? String(a.note) : 'Phiếu nháp do AI agent lập — cần người kiểm tra và hoàn tất',
                    userName: ctx.userName || 'AI Agent',
                    items: { create: items },
                },
                include: { items: true },
            })
            return {
                daTao: true,
                trangThai: 'draft',
                phieu: { code: receipt.code, id: receipt.id, totalCost, totalItems },
                canLam: 'Phiếu đang NHÁP — chưa cộng tồn kho, chưa ghi sổ, chưa sinh công nợ NCC. Vào web Nhập hàng kiểm tra rồi bấm Hoàn tất.',
            }
        },
    },
    {
        name: 'list_payment_due',
        description: 'Các phiếu nhập tới hạn / quá hạn trả tiền nhà cung cấp, kèm số còn nợ và số ngày quá hạn. Trả lời "sắp tới phải trả ai bao nhiêu".',
        inputSchema: {
            type: 'object',
            properties: {
                days_ahead: { type: 'number', description: 'Nhìn trước bao nhiêu ngày (mặc định 7)' },
                limit: { type: 'number', description: 'Mặc định 20, tối đa 100' },
            },
        },
        run: async (a, { prisma }) => {
            const truoc = num(a.days_ahead, 7)
            const moc = new Date(); moc.setDate(moc.getDate() + truoc + 1); moc.setHours(0, 0, 0, 0)
            const homNay = new Date(); homNay.setHours(0, 0, 0, 0)
            const ds = await prisma.importReceipt.findMany({
                where: {
                    dueDate: { not: null, lt: moc },
                    paymentStatus: { not: 'paid' },
                    status: { notIn: ['cancelled', 'draft', 'returned'] },
                },
                orderBy: { dueDate: 'asc' },
                take: gioiHan(a.limit),
                select: { code: true, supplierName: true, totalCost: true, paidAmount: true, dueDate: true, paymentTerm: true },
            })
            const rows = ds.map((r: any) => {
                const conNo = Math.max(0, (r.totalCost || 0) - (r.paidAmount || 0))
                const quaHan = r.dueDate ? Math.floor((homNay.getTime() - new Date(r.dueDate).getTime()) / 86400_000) : 0
                return {
                    phieu: r.code, nhaCungCap: r.supplierName,
                    tongTien: r.totalCost, daTra: r.paidAmount, conNo,
                    hanTra: ngayVN(r.dueDate),
                    soNgayQuaHan: quaHan > 0 ? quaHan : 0,
                    dieuKhoan: r.paymentTerm || null,
                }
            })
            return {
                soPhieu: rows.length,
                tongConNo: rows.reduce((s: number, r: any) => s + r.conNo, 0),
                soPhieuQuaHan: rows.filter((r: any) => r.soNgayQuaHan > 0).length,
                phieu: rows,
            }
        },
    },

    // ─── Công nợ khách ───────────────────────────────────────────────────────
    {
        name: 'list_customer_debts',
        description: 'Khách đang nợ tiền, sắp theo số nợ giảm dần. Kèm điện thoại để gọi đòi. Trả lời "ai đang nợ nhiều nhất".',
        inputSchema: {
            type: 'object',
            properties: { limit: { type: 'number', description: 'Mặc định 20, tối đa 100' } },
        },
        run: async (a, { prisma }) => {
            const ds = await prisma.customer.findMany({
                where: { debt: { gt: 0 } },
                orderBy: { debt: 'desc' },
                take: gioiHan(a.limit),
                select: { id: true, code: true, name: true, phone: true, debt: true, totalSpent: true, lastPurchaseDate: true },
            })
            return {
                soKhachNo: ds.length,
                tongNo: ds.reduce((s: number, c: any) => s + (c.debt || 0), 0),
                khachHang: ds.map((c: any) => ({ ...c, lastPurchaseDate: ngayVN(c.lastPurchaseDate) })),
            }
        },
    },
    {
        name: 'get_customer',
        description: 'Chi tiết một khách hàng: thông tin, dư nợ, tổng chi tiêu, và các đơn gần nhất.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'id, mã KH, số điện thoại hoặc tên' },
                so_don: { type: 'number', description: 'Số đơn gần nhất muốn xem (mặc định 5, tối đa 20)' },
            },
            required: ['query'],
        },
        run: async (a, { prisma }) => {
            const q = String(a.query)
            const kh = await prisma.customer.findFirst({
                where: { OR: [{ id: q }, { code: q }, { phone: { contains: q } }, { name: { contains: q, mode: 'insensitive' } }] },
            })
            if (!kh) throw new ToolError(`Không tìm thấy khách "${q}"`)
            const don = await prisma.transaction.findMany({
                where: { customerId: kh.id },
                orderBy: { createdAt: 'desc' },
                take: gioiHan(a.so_don, 5, 20),
                select: { receiptNumber: true, total: true, paidAmount: true, debtAmount: true, status: true, createdAt: true },
            }).catch(() => [])
            return {
                khachHang: {
                    id: kh.id, ma: kh.code, ten: kh.name, dienThoai: kh.phone,
                    duNo: kh.debt, tongChiTieu: kh.totalSpent, hangThanhVien: (kh as any).tier ?? null,
                },
                donGanNhat: don.map((t: any) => ({ ...t, createdAt: ngayVN(t.createdAt) })),
            }
        },
    },

    // ─── Đơn hàng ────────────────────────────────────────────────────────────
    {
        name: 'list_transactions',
        description: 'Danh sách đơn bán (POS + online đã ghi nhận) theo khoảng ngày / trạng thái. Đơn ghi nợ có status "partial" — VẪN là bán thật, đừng bỏ ra khi tính doanh thu.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Từ ngày YYYY-MM-DD' },
                to: { type: 'string', description: 'Đến ngày YYYY-MM-DD' },
                status: { type: 'string', description: 'completed | partial | voided | cancelled' },
                con_no: { type: 'boolean', description: 'true = chỉ đơn còn nợ tiền' },
                limit: { type: 'number', description: 'Mặc định 20, tối đa 100' },
            },
        },
        run: async (a, { prisma }) => {
            const where: any = {}
            if (a.from || a.to) {
                where.createdAt = {}
                if (a.from) where.createdAt.gte = new Date(`${String(a.from).slice(0, 10)}T00:00:00+07:00`)
                if (a.to) where.createdAt.lte = new Date(`${String(a.to).slice(0, 10)}T23:59:59+07:00`)
            }
            if (a.status) where.status = String(a.status)
            if (a.con_no) where.debtAmount = { gt: 0 }
            const ds = await prisma.transaction.findMany({
                where, orderBy: { createdAt: 'desc' }, take: gioiHan(a.limit),
                select: {
                    id: true, receiptNumber: true, customerName: true, total: true, paidAmount: true,
                    debtAmount: true, status: true, vatStatus: true, createdAt: true, createdByName: true,
                },
            })
            return {
                soDon: ds.length,
                tongTien: ds.reduce((s: number, t: any) => s + (t.total || 0), 0),
                tongConNo: ds.reduce((s: number, t: any) => s + (t.debtAmount || 0), 0),
                don: ds.map((t: any) => ({ ...t, createdAt: ngayVN(t.createdAt) })),
            }
        },
    },
    {
        name: 'get_transaction',
        description: 'Chi tiết một đơn bán theo mã phiếu hoặc id: từng mặt hàng, thanh toán, công nợ, tình trạng hoá đơn điện tử.',
        inputSchema: {
            type: 'object',
            properties: { receipt_or_id: { type: 'string', description: 'Mã phiếu (HD…) hoặc id' } },
            required: ['receipt_or_id'],
        },
        run: async (a, { prisma }) => {
            const q = String(a.receipt_or_id)
            const t = await prisma.transaction.findFirst({
                where: { OR: [{ id: q }, { receiptNumber: q }] },
                include: { items: true, payments: true },
            })
            if (!t) throw new ToolError(`Không tìm thấy đơn "${q}"`)
            return t
        },
    },
    {
        name: 'get_online_order',
        description: 'Chi tiết một đơn sàn (Shopee/TikTok/Lazada…) theo mã đơn: khách, địa chỉ, mặt hàng, trạng thái, phí sàn, thực nhận.',
        inputSchema: {
            type: 'object',
            properties: { order_code: { type: 'string', description: 'Mã đơn sàn hoặc id' } },
            required: ['order_code'],
        },
        run: async (a, { prisma }) => {
            const q = String(a.order_code || '').trim()
            if (!q) throw new ToolError('Thiếu order_code')
            /* DÒ ĐÚNG TÊN CỘT (03/09/2026). Bản cũ dò `orderCode` và `platformOrderId`
             * — HAI CỘT KHÔNG TỒN TẠI. Prisma `as any` không ném P2022 mà trả về
             * không-tìm-thấy, nên tool luôn báo "Không tìm thấy đơn sàn" kể cả với
             * mã có thật (đo hôm nay với SPE-2609033AFWUNGK, đơn có trong hệ thống).
             * Tên thật: orderNumber (duy nhất) · externalOrderId · trackingNumber. */
            const o = await prisma.onlineOrder.findFirst({
                where: { OR: [{ id: q }, { orderNumber: q }, { externalOrderId: q }, { trackingNumber: q }] },
                include: {
                    // Kèm ảnh + SKU kho để agent nói được "đơn này gồm hàng gì"
                    items: {
                        include: {
                            product: {
                                select: {
                                    sku: true,
                                    images: { select: { url: true }, orderBy: { isPrimary: 'desc' }, take: 1 },
                                },
                            },
                        },
                    },
                },
            }).catch(() => null)
            if (!o) throw new ToolError(`Không tìm thấy đơn sàn "${q}" — thử mã đơn (orderNumber), mã sàn (externalOrderId) hoặc mã vận đơn`)
            return o
        },
    },

    // ─── Tiền & sổ phụ ───────────────────────────────────────────────────────
    {
        name: 'list_bank_transactions',
        description: 'Sao kê ngân hàng: các dòng tiền vào/ra, lọc được riêng những dòng CHƯA đối soát (chưa gắn vào phiếu nào — đây là chỗ sổ ngân hàng lệch sổ kế toán).',
        inputSchema: {
            type: 'object',
            properties: {
                chua_doi_soat: { type: 'boolean', description: 'true = chỉ dòng chưa đối soát' },
                from: { type: 'string', description: 'Từ ngày YYYY-MM-DD' },
                to: { type: 'string', description: 'Đến ngày YYYY-MM-DD' },
                limit: { type: 'number', description: 'Mặc định 20, tối đa 100' },
            },
        },
        run: async (a, { prisma }) => {
            const where: any = {}
            if (a.chua_doi_soat) where.isReconciled = false
            if (a.from || a.to) {
                where.date = {}
                if (a.from) where.date.gte = new Date(`${String(a.from).slice(0, 10)}T00:00:00+07:00`)
                if (a.to) where.date.lte = new Date(`${String(a.to).slice(0, 10)}T23:59:59+07:00`)
            }
            const ds = await prisma.bankTransaction.findMany({
                where, orderBy: { date: 'desc' }, take: gioiHan(a.limit),
                select: {
                    id: true, type: true, amount: true, description: true, date: true,
                    counterpartyName: true, referenceNo: true, isReconciled: true,
                },
            })
            return {
                soDong: ds.length,
                tienVao: ds.filter((r: any) => r.type !== 'debit').reduce((s: number, r: any) => s + r.amount, 0),
                tienRa: ds.filter((r: any) => r.type === 'debit').reduce((s: number, r: any) => s + r.amount, 0),
                giaoDich: ds.map((r: any) => ({ ...r, date: ngayVN(r.date) })),
                ghiChu: "type 'debit' = tiền RA, còn lại là tiền VÀO.",
            }
        },
    },
    {
        name: 'list_expenses',
        description: 'Danh sách phiếu chi theo khoảng ngày / nhóm chi phí (lương, mặt bằng, điện nước, marketing…).',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Từ ngày YYYY-MM-DD' },
                to: { type: 'string', description: 'Đến ngày YYYY-MM-DD' },
                category: { type: 'string', description: 'Nhóm chi phí: salary, rent, utilities, marketing, transport, supplies, tax, other' },
                limit: { type: 'number', description: 'Mặc định 20, tối đa 100' },
            },
        },
        run: async (a, { prisma }) => {
            const where: any = { status: { not: 'cancelled' } }
            if (a.category) where.category = String(a.category)
            if (a.from || a.to) {
                where.date = {}
                if (a.from) where.date.gte = new Date(`${String(a.from).slice(0, 10)}T00:00:00+07:00`)
                if (a.to) where.date.lte = new Date(`${String(a.to).slice(0, 10)}T23:59:59+07:00`)
            }
            const ds = await prisma.expense.findMany({
                where, orderBy: { date: 'desc' }, take: gioiHan(a.limit),
                select: { id: true, description: true, amount: true, category: true, date: true, paidBy: true, invoiceNo: true, supplierName: true },
            })
            return {
                soPhieu: ds.length,
                tongChi: ds.reduce((s: number, e: any) => s + (e.amount || 0), 0),
                phieuChi: ds.map((e: any) => ({ ...e, date: ngayVN(e.date) })),
            }
        },
    },
    {
        name: 'create_expense',
        description: 'Ghi một phiếu chi (tiền mặt hoặc chuyển khoản) — TỰ ĐỘNG ghi bút toán Nợ 641/642 / Có 111|112 như trên web. Dùng cho chi phí vận hành đã thực chi. Không dùng để trả nợ nhà cung cấp (khoản đó phải ghi ở phiếu nhập để trừ đúng công nợ).',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                description: { type: 'string', description: 'Diễn giải, vd "Tiền điện tháng 8"' },
                amount: { type: 'number', description: 'Số tiền (VND)' },
                category: { type: 'string', description: 'salary | rent | utilities | marketing | transport | supplies | tax | other' },
                date: { type: 'string', description: 'Ngày chi YYYY-MM-DD (mặc định hôm nay)' },
                paid_by: { type: 'string', description: 'cash (mặc định) hoặc bank' },
            },
            required: ['description', 'amount'],
        },
        run: async (a, ctx: ToolCtx) => {
            const { prisma } = ctx
            const tien = num(a.amount, 0)
            if (tien <= 0) throw new ToolError('Số tiền phải lớn hơn 0')
            const mo = String(a.description || '').trim()
            if (!mo) throw new ToolError('Thiếu diễn giải phiếu chi')
            const row = await prisma.$transaction(async (t: any) => {
                const e = await t.expense.create({
                    data: {
                        description: mo,
                        amount: tien,
                        category: String(a.category || 'other'),
                        paidBy: String(a.paid_by || 'cash'),
                        date: a.date ? new Date(`${String(a.date).slice(0, 10)}T12:00:00+07:00`) : new Date(),
                    },
                })
                await postExpenseJournal(t, e as any, { branchId: e.branchId || null, userId: ctx.userId || null })
                return e
            })
            return {
                daGhi: true,
                phieuChi: { id: row.id, dienGiai: row.description, soTien: row.amount, nhom: row.category, ngay: ngayVN(row.date) },
                ghiChu: 'Đã ghi sổ kế toán (Nợ chi phí / Có tiền). Muốn huỷ phải vào web xoá phiếu để bút toán được đảo.',
            }
        },
    },

    // ─── Kho, khuyến mãi, nhân sự ────────────────────────────────────────────
    {
        name: 'list_warehouses',
        description: 'Danh sách kho / xe bán lưu động của store kèm số mã hàng đang có tồn. Dùng trước stock_by_warehouse.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (_a, { prisma }) => {
            const ds = await prisma.warehouse.findMany({
                where: { isActive: true },
                orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
                select: { id: true, code: true, name: true, type: true, isDefault: true },
            }).catch(() => [])
            const out: any[] = []
            for (const w of ds) {
                const n = await prisma.warehouseStock.count({ where: { warehouseId: w.id, quantity: { gt: 0 } } }).catch(() => null)
                out.push({ ...w, soMaConTon: n })
            }
            return { soKho: out.length, kho: out }
        },
    },
    {
        name: 'list_promotions',
        description: 'Chương trình khuyến mãi: đang chạy, sắp bắt đầu, đã hết hạn. Xem trước khi tư vấn giá cho khách.',
        inputSchema: {
            type: 'object',
            properties: { dang_chay: { type: 'boolean', description: 'true = chỉ chương trình còn hiệu lực' } },
        },
        run: async (a, { prisma }) => {
            const now = new Date()
            const where: any = {}
            if (a.dang_chay) {
                where.isActive = true
                where.startDate = { lte: now }
                where.endDate = { gte: now }
            }
            const ds = await prisma.promotion.findMany({
                where, orderBy: { startDate: 'desc' }, take: 50,
            }).catch(() => [])
            return {
                soChuongTrinh: ds.length,
                khuyenMai: ds.map((p: any) => ({
                    id: p.id, ten: p.name, loai: p.type, giaTri: p.value,
                    tuNgay: ngayVN(p.startDate), denNgay: ngayVN(p.endDate),
                    dangChay: p.isActive && (!p.startDate || new Date(p.startDate) <= now) && (!p.endDate || new Date(p.endDate) >= now),
                })),
            }
        },
    },
    {
        name: 'list_employees',
        description: 'Danh sách nhân viên đang làm việc (tên, vai trò, chi nhánh) — KHÔNG bao gồm lương. Dùng để biết ai bán hàng, ai phụ trách khi phân công.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (_a, { prisma }) => {
            const ds = await prisma.user.findMany({
                where: { isActive: true },
                orderBy: { name: 'asc' },
                take: 200,
                select: { id: true, name: true, email: true, role: true, branchId: true },
            }).catch(() => [])
            return { soNhanVien: ds.length, nhanVien: ds }
        },
    },
]
