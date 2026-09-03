import { Router, Request, Response } from 'express'
import { errorDetail } from '../lib/errorResponse'
import { moTaLoi } from '../lib/gomLoi'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId, canAccessBranch } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { calculateCostPrice, getCostPriceMethod } from '../lib/costPrice'
import { nextCode } from '../lib/codeGenerator'
import { getOrCreateDefaultWarehouse, updateWarehouseStock, adjustSellableStock } from '../lib/warehouseHelper'
import { emitStockChanged, emitEntityEvent, webhooksActive } from '../lib/webhookDispatch'
import { postImportReceiptJournal, postExpenseJournal, refsOfImport, reverseJournalRefs } from '../lib/autoJournalPurchase'
import { tinhHanTraTheoQuyTac, quyTacTuSupplier, nhanQuyTac, mucHanTra } from '../lib/dieuKhoanThanhToan'
import { tongPhieuChuaTraTheoNcc, congNoHienThi } from '../lib/congNoNcc'

/**
 * MỘT SỐ HOÁ ĐƠN CHỈ ĐƯỢC DÙNG MỘT LẦN CHO MỘT NHÀ CUNG CẤP.
 *
 * Nhập trùng số hoá đơn đầu vào là nhân đôi thuế GTGT được khấu trừ và nhân đôi
 * chi phí được trừ — đúng thứ cơ quan thuế đối chiếu ra ngay, vì bên bán chỉ
 * phát hành một tờ. Hậu quả là truy thu cộng phạt kê khai sai, chứ không phải
 * một lỗi nhập liệu vặt.
 *
 * Trùng số ở HAI nhà cung cấp KHÁC NHAU thì bình thường: mỗi bên có dải số
 * riêng, tờ 0000123 của bên A không liên quan gì tờ 0000123 của bên B. Chặn cả
 * trường hợp đó là bắt người dùng sửa một thứ không sai.
 *
 * So sánh sau khi chuẩn hoá: bỏ khoảng trắng và không phân biệt hoa thường —
 * "HD 001" và "hd001" là cùng một tờ, chặn được thì mới có tác dụng thật.
 */
export async function timPhieuTrungSoHoaDon(
    prisma: any,
    args: { vatInvoiceNo?: string | null; supplierId?: string | null; supplierName?: string | null; boQuaId?: string },
): Promise<{ code: string; createdAt: any; supplierName?: string | null; cungNcc: boolean } | null> {
    const so = String(args.vatInvoiceNo || '').replace(/\s+/g, '').toLowerCase()
    if (!so) return null

    /* Lọc theo nhà cung cấp ở tầng DB, còn so số hoá đơn thì làm ở Node: Prisma
     * không có hàm bỏ khoảng trắng, mà so thô sẽ lọt "HD 001" vs "HD001". */
    const dieuKien: any = args.supplierId
        ? { supplierId: args.supplierId }
        : args.supplierName
            ? { supplierName: args.supplierName }
            : null

    /* CHƯA CHỌN NHÀ CUNG CẤP thì vẫn phải soát (03/09/2026 — chủ shop: "trùng
     * hoá đơn không cho nhập vào"). Bản cũ trả null ở đây, nên chỉ cần bỏ trống
     * ô NCC là cùng một tờ hoá đơn vào sổ được vô số lần: tồn kho thừa, giá vốn
     * lệch, thuế GTGT khấu trừ khai trùng. Soát toàn bộ rồi báo rõ phiếu cũ
     * thuộc NCC nào — nếu thật sự là hai nhà cung cấp khác nhau trùng số thì
     * chọn NCC vào phiếu là phân biệt được ngay. */
    const ds = await prisma.importReceipt.findMany({
        where: {
            ...(dieuKien || {}),
            status: { not: 'cancelled' },
            vatInvoiceNo: { not: null },
            ...(args.boQuaId ? { id: { not: args.boQuaId } } : {}),
        },
        select: { id: true, code: true, vatInvoiceNo: true, supplierId: true, supplierName: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: dieuKien ? 500 : 2000,
    }).catch(() => [])

    const trung = ds.find((r: any) => String(r.vatInvoiceNo || '').replace(/\s+/g, '').toLowerCase() === so)
    if (!trung) return null
    return {
        code: trung.code,
        createdAt: trung.createdAt,
        supplierName: trung.supplierName ?? null,
        cungNcc: Boolean(dieuKien),
    }
}


// Payload phiếu nhập cho webhook (kèm thông tin NCC + chi tiết mặt hàng)
const importPayload = (r: any) => ({
    id: r?.id, code: r?.code,
    supplierId: r?.supplierId ?? null,
    supplierName: r?.supplierName ?? null,
    totalCost: r?.totalCost, totalItems: r?.totalItems,
    status: r?.status, paymentStatus: r?.paymentStatus, paidAmount: r?.paidAmount ?? null,
    dueDate: r?.dueDate ?? null, paymentTerm: r?.paymentTerm ?? null,
    branchId: r?.branchId ?? null, createdAt: r?.createdAt,
    items: Array.isArray(r?.items) ? r.items.map((it: any) => ({
        productId: it.productId, productName: it.productName, sku: it.productSku ?? null,
        quantity: it.quantity, costPrice: it.costPrice, lineTotal: it.total,
    })) : undefined,
})

const router = Router()

/**
 * GET /api/import-receipts/duplicates?months=12
 *
 * Những phiếu nhập ĐÃ trùng số hoá đơn cùng một nhà cung cấp.
 *
 * Chốt chặn lúc nhập chỉ ngăn phiếu sắp tạo. Cặp đã trùng sẵn thì tồn kho đang
 * thừa, giá vốn đang lệch, công nợ nhà cung cấp đang ghi thừa, và chi phí được
 * trừ đang khai trùng — bốn thứ cùng lúc, ngay lúc này.
 *
 * Đặt ở đây thay vì chỉ trong trang Thuế: người nhập hàng làm việc ở màn hình
 * này, và họ mới là người biết phiếu nào là nhầm.
 */
router.get('/duplicates', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const thang = Math.max(1, Math.min(36, Number((req.query as any)?.months) || 12))
        const tu = new Date(Date.now() - thang * 30 * 86400_000)
        const chuan = (v: any) => String(v || '').replace(/\s+/g, '').toLowerCase()

        const TRAN_DS = 5000
        const ds: any[] = await prisma.importReceipt.findMany({
            where: { createdAt: { gte: tu }, status: { not: 'cancelled' }, vatInvoiceNo: { not: null } },
            select: {
                id: true, code: true, vatInvoiceNo: true, supplierId: true, supplierName: true,
                totalCost: true, vatAmount: true, createdAt: true, transactionDate: true, status: true,
            },
            orderBy: { createdAt: 'asc' },
            take: TRAN_DS,
        })
        /* Chạm trần = CHƯA soi hết. "Không thấy trùng" lúc đó không đồng nghĩa "không có trùng" —
         * đừng để câu trấn an đứng trên một phép soi dở dang (20/08/2026). */
        const catDs = ds.length >= TRAN_DS

        const nhom = new Map<string, any[]>()
        for (const r of ds) {
            const so = chuan(r.vatInvoiceNo)
            const ncc = r.supplierId || chuan(r.supplierName)
            if (!so || !ncc) continue
            const k = `${ncc}|${so}`
            if (!nhom.has(k)) nhom.set(k, [])
            nhom.get(k)!.push(r)
        }

        const cap = Array.from(nhom.values())
            .filter(v => v.length > 1)
            .map(v => ({
                nhaCungCap: v[0].supplierName || null,
                soHoaDon: v[0].vatInvoiceNo,
                /* Phiếu ĐẦU TIÊN là phiếu thật (nhập trước); các phiếu sau mới là
                 * phiếu cần xem xét huỷ. Đánh dấu rõ để người dùng không huỷ nhầm
                 * phiếu gốc rồi mất luôn dữ liệu đúng. */
                phieu: v.map((r: any, i: number) => ({
                    id: r.id, code: r.code,
                    tien: Math.round(Number(r.totalCost) || 0),
                    ngay: new Date(r.transactionDate || r.createdAt).toISOString().slice(0, 10),
                    laPhieuGoc: i === 0,
                })),
                tienGhiThua: Math.round(v.slice(1).reduce((s: number, r: any) => s + (Number(r.totalCost) || 0), 0)),
            }))
            .sort((a, b) => b.tienGhiThua - a.tienGhiThua)

        /* HUỶ PHIẾU TRÙNG LÀM TỒN GIẢM THÊM — phải nói trước khi người ta bấm.
         *
         * Phiếu nhập cộng tồn, nên huỷ nó là trừ lại. Với mã ĐANG ÂM thì sau khi
         * huỷ nó âm sâu hơn, và người dùng dễ tưởng mình vừa làm hỏng thêm rồi
         * hoảng — trong khi con số mới mới là con số đúng: phần dương giả từ
         * phiếu trùng vốn đang che bớt độ âm thật.
         *
         * Đo trên dữ liệu thật 14/08/2026: mã SHD4038 vừa nằm trong phiếu trùng
         * (+10) vừa đang tồn -557. Huỷ xong sẽ thành -567. */
        let soMaSeAmThem = 0
        /* Không đếm được ≠ không có mã nào sẽ âm. Mất câu cảnh báo này thì người dùng huỷ phiếu
         * trùng xong mới phát hiện tồn âm sâu hơn (20/08/2026). */
        let khongDemDuocAm = false
        if (cap.length > 0) {
            const idThua = cap.flatMap(c => c.phieu.filter((p: any) => !p.laPhieuGoc).map((p: any) => p.id))
            if (idThua.length > 0) {
                const dong: any[] = await prisma.importReceiptItem.findMany({
                    where: { receiptId: { in: idThua } },
                    select: { productId: true },
                    take: 2000,
                }).catch(() => { khongDemDuocAm = true; return [] })
                const idHang = Array.from(new Set(dong.map((d: any) => String(d.productId)).filter(Boolean)))
                if (idHang.length > 0) {
                    const am: any = await prisma.product.count({
                        where: { id: { in: idHang }, stock: { lt: 0 } },
                    }).catch(() => { khongDemDuocAm = true; return 0 })
                    soMaSeAmThem = Number(am) || 0
                }
            }
        }

        res.json({
            success: true,
            data: {
                soThang: thang,
                soCap: cap.length,
                tongGhiThua: cap.reduce((s, c) => s + c.tienGhiThua, 0),
                soMaSeAmThem,
                cap,
                biCat: catDs,
                soPhieuDaSoi: ds.length,
                ghiChu: cap.length === 0
                    ? (catDs
                        ? `Chưa thấy phiếu trùng trong ${ds.length.toLocaleString('vi-VN')} phiếu ĐẦU TIÊN — đã chạm trần nên CHƯA soi hết ${thang} tháng. Thu hẹp khoảng tháng để soi đủ.`
                        : 'Không có phiếu nhập nào trùng số hoá đơn.')
                    : 'Giữ phiếu ĐẦU TIÊN, huỷ phiếu sau. Huỷ phiếu nhập sẽ tự trừ lại tồn kho và đảo bút toán tương ứng.'
                        + (khongDemDuocAm
                            ? ' Lưu ý: CHƯA đếm được số mã đang âm trong nhóm này (đọc dữ liệu lỗi) — đừng hiểu là không có mã nào âm.'
                            : '')
                        + (soMaSeAmThem > 0
                            ? ` Lưu ý: ${soMaSeAmThem} mã trong nhóm này ĐANG ÂM, nên huỷ xong chúng sẽ âm sâu hơn. Đó là con số ĐÚNG — phần dương giả từ phiếu trùng đang che bớt độ âm thật. Kiểm kê nhóm mã đó sau khi huỷ.`
                            : ''),
            },
        })
    } catch (err) {
        console.error('GET /import-receipts/duplicates error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


/**
 * GET /import-receipts/payment-due — HẠN THANH TOÁN NHÀ CUNG CẤP (18/08/2026).
 *
 * Yêu cầu chủ shop: "các mốc thời gian trả tiền cho NCC, từ gần đến xa; quá hạn
 * đỏ, gần tới hạn vàng, chưa tới hạn xanh". Mỗi dòng = một phiếu nhập CHƯA trả
 * đủ (paymentStatus ≠ paid — phiếu cũ mặc định paid nên không lọt vào đây).
 * Mức màu (muc) tính MỘT chỗ ở BE bằng mucHanTra(); FE chỉ tô. Phiếu không có
 * hạn xếp cuối, nhóm riêng — không bịa hạn.
 *
 * ?sapDen=N — ngưỡng "sắp đến hạn" tính bằng ngày (mặc định 7); ?supplierId=.
 */
/* Gác quyền (23/08/2026): trước đây route này CHỈ cần đăng nhập — menu giấu link chứ
 * API mở cho mọi người dùng. Nay đòi quyền riêng HOẶC quyền cũ (import.view — đúng
 * quyền mà menu vẫn dùng để hiện tab), nên không ai đang dùng bị mất truy cập. */
router.get('/payment-due', authMiddleware, requirePermission('payment_due.view', 'import.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        /* Cùng luật với GET / (getBranchFilter): chi nhánh CHÍNH thấy hết. Bản đầu dùng getBranchId → phiếu
         * đồng bộ KiotViet (branchId null) bị lọc mất → HUTI thấy 0 phiếu trong khi có 293 (18/08/2026). */
        const branchId = getBranchFilter(req).branchId as string | undefined
        const sapDenNgay = Math.max(1, Math.min(60, Number(req.query.sapDen) || 7))
        /* CHỈ phiếu đã hoàn thành (đã nhận hàng) mới là nợ phải trả — cùng định nghĩa với
         * sổ đối chiếu (lib/reconcile.ts) và hồ sơ kiểm toán (lib/auditPack.ts). Bản đầu lấy
         * ≠ cancelled nên gồm cả phiếu NHÁP chưa nhận hàng — hai màn hình sẽ ra hai số. */
        const where: any = { paymentStatus: { in: ['unpaid', 'partial'] }, status: 'completed' }
        if (branchId) where.branchId = branchId
        if (req.query.supplierId) where.supplierId = String(req.query.supplierId)
        /* Ba cái trần dưới đây trước để trần trụi trong code. Chạm trần thì màn hình HỤT phiếu/NCC
         * mà không nói gì — nợ phải trả trông nhẹ đi. Nay khai thẳng trong `tomTat.biCat` để giao
         * diện nói ra (20/08/2026 — cùng họ với Dạng 16 "cắt ngầm"). */
        const TRAN_PHIEU = 1000, TRAN_NCC = 2000, TRAN_HIEN_NCC = 300
        const rows: any[] = await (prisma as any).importReceipt.findMany({
            where,
            select: { id: true, code: true, supplierId: true, supplierName: true, totalCost: true, paidAmount: true, paymentStatus: true, dueDate: true, paymentTerm: true, createdAt: true, transactionDate: true, status: true },
            orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
            take: TRAN_PHIEU,
        })
        /* Hồ sơ NCC đọc hỏng ⇒ mất điều khoản thanh toán ⇒ mọi phiếu không suy được hạn và rơi
         * hết vào nhóm "chưa có hạn": màn hình trông như cửa hàng chẳng nợ ai đến hạn cả. */
        let loiDocNcc = false
        const nccWhere: any = {}
        if (req.query.supplierId) nccWhere.id = String(req.query.supplierId)
        // Tuần tự (pool prod = 1, quy ước dự án), không Promise.all
        const nccAll: any[] = await (prisma as any).supplier.findMany({ where: nccWhere, take: TRAN_NCC,
            select: { id: true, code: true, name: true, payable: true, paymentTerms: true, paymentTermType: true, paymentTermDays: true, paymentTermDom: true, paymentTermMonthOffset: true } }).catch(() => { loiDocNcc = true; return [] })
        const phieuTheoNcc: Map<string, { tong: number; so: number }> = await tongPhieuChuaTraTheoNcc(prisma, req.query.supplierId ? [String(req.query.supplierId)] : undefined)
        const nccTheoId = new Map<string, any>(nccAll.map((x: any) => [x.id, x]))
        const homNay = new Date()
        const items = rows.map(r => {
            const conLai = Math.max(0, (Number(r.totalCost) || 0) - (Number(r.paidAmount) || 0))
            /* Phiếu không ghi hạn → SUY SỐNG từ điều khoản NCC hiện tại (theo ngày chứng từ). Phiếu tạo trước
             * khi đặt điều khoản (HUTI: 310 phiếu) nhờ vậy vẫn lên mốc đỏ/vàng/xanh ngay khi chủ shop đặt
             * điều khoản; hanSuy=true để FE ghi rõ "hạn suy từ điều khoản NCC", không giả vờ phiếu tự ghi. */
            const ncc = r.supplierId ? nccTheoId.get(r.supplierId) : null
            const han = tinhHanTraTheoQuyTac(r.transactionDate || r.createdAt, r.dueDate, quyTacTuSupplier(ncc))
            const hanSuy = !r.dueDate && !!han
            const muc = mucHanTra(han, homNay, sapDenNgay)
            const soNgay = han ? Math.ceil((han.getTime() - homNay.getTime()) / 86_400_000) : null
            return { id: r.id, code: r.code, supplierId: r.supplierId, supplierName: r.supplierName,
                tong: Math.round(Number(r.totalCost) || 0), daTra: Math.round(Number(r.paidAmount) || 0), conLai: Math.round(conLai),
                paymentStatus: r.paymentStatus, dueDate: han, hanSuy, paymentTerm: r.paymentTerm || (hanSuy ? nhanQuyTac(quyTacTuSupplier(ncc)) : null), ngayNhap: r.transactionDate || r.createdAt,
                muc, soNgayConLai: soNgay }   // âm = đã quá hạn bấy nhiêu ngày
        })
        // Có hạn trước (gần → xa), không hạn xếp cuối
        items.sort((a, b) => (a.dueDate ? a.dueDate.getTime() : Infinity) - (b.dueDate ? b.dueDate.getTime() : Infinity))
        const gom = (m: string) => items.filter(x => x.muc === m)
        const tong = (xs: any[]) => xs.reduce((s2, x) => s2 + x.conLai, 0)
        /* CÔNG NỢ THEO NCC — cùng công thức với GET /suppliers (lib/congNoNcc.ts): payable (số dư đầu kỳ)
         * + Σ phiếu chưa trả, kẹp ≥ 0. HUTI 18/08/2026: KiotViet ghi PO chưa trả, nợ NCC 20,15 tỷ; danh sách
         * NCC từng hiện 40,49 tỷ vì payable bị ghi = tổng nợ KV rồi cộng phiếu lần nữa (đã sửa ở đồng bộ +
         * đối chiếu). Ở đây hiện MỘT số/NCC là số danh sách NCC hiển thị, tách rõ "sổ" và "phiếu";
         * phần dư ÂM = có khoản đã trả chưa gắn vào phiếu (phiếu treo ≠ nợ, như bên khách). Không bịa hạn. */
        const theoNccDay = nccAll.map(sn => {
            const soDuSo = Math.round(Number(sn.payable) || 0)
            const ph = phieuTheoNcc.get(sn.id) || { tong: 0, so: 0 }
            return { supplierId: sn.id, code: sn.code, name: sn.name,
                soDuSo, phieuChuaTra: Math.round(ph.tong), soPhieuChuaTra: ph.so,
                congNo: congNoHienThi(soDuSo, ph.tong),
                daTraChuaGanPhieu: soDuSo < 0 ? -soDuSo : 0,   // KV nói nợ ít hơn Σ phiếu ⇒ có khoản trả chưa gắn
                dieuKhoan: sn.paymentTerms || nhanQuyTac(quyTacTuSupplier(sn)) || null }
        }).filter(x => x.congNo > 0 || x.phieuChuaTra > 0).sort((a, b) => b.congNo - a.congNo)
        const theoNcc = theoNccDay.slice(0, TRAN_HIEN_NCC)
        res.json({ success: true, data: {
            items,
            theoNcc,
            tomTat: {
                soPhieu: items.length, tongConLai: tong(items),
                quaHan: { so: gom('qua-han').length, tien: tong(gom('qua-han')) },
                sapDen: { so: gom('sap-den').length, tien: tong(gom('sap-den')), trongNgay: sapDenNgay },
                chuaDen: { so: gom('chua-den').length, tien: tong(gom('chua-den')) },
                khongHan: { so: gom('khong-han').length, tien: tong(gom('khong-han')) },
                khongDocDuocNcc: loiDocNcc,
                biCat: {
                    phieu: rows.length >= TRAN_PHIEU,
                    ncc: nccAll.length >= TRAN_NCC,
                    nccHienThi: theoNccDay.length > TRAN_HIEN_NCC,
                    soNccBoBot: Math.max(0, theoNccDay.length - TRAN_HIEN_NCC),
                    /* Gửi luôn CON SỐ trần, đừng để giao diện tự viết cứng (21/08/2026).
                     * Trang đang in "1.000 phiếu / 2.000 NCC / 300 dòng" bằng chữ viết tay — hôm nay
                     * khớp, nhưng sửa trần ở đây một cái là **lời khai bị cắt trở thành lời khai
                     * SAI**, mà lại là loại sai rất khó thấy: vẫn có cảnh báo, chỉ là sai số.
                     * Cùng một hằng số nằm hai nơi thì sớm muộn cũng lệch. */
                    tranPhieu: TRAN_PHIEU,
                    tranNcc: TRAN_NCC,
                    tranHienNcc: TRAN_HIEN_NCC,
                },
                theoNcc: { soNcc: theoNcc.length, tongCongNo: theoNcc.reduce((s2, x) => s2 + x.congNo, 0), daTraChuaGanPhieu: theoNcc.reduce((s2, x) => s2 + x.daTraChuaGanPhieu, 0) },
            },
        } })
    } catch (err: any) {
        console.error('[payment-due]', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/import-receipts
/* ─────────────────────────────────────────────────────────────────────────────
 *  TRẢ GỘP NHIỀU PHIẾU BẰNG MỘT LỆNH CHUYỂN — POST /api/import-receipts/tra-nhom
 *  (03/09/2026)
 *
 *  Chủ shop: "1 ngày nếu có những NCC cùng nhóm thì gom thanh toán 1 lần chứ".
 *  Đúng thực tế: vài pháp nhân cùng một chủ, kế toán chuyển MỘT lệnh cho cả cụm.
 *
 *  MỘT LỆNH CHUYỂN = MỘT PHIẾU CHI. Không đẻ N phiếu chi cho N phiếu nhập: sao kê
 *  ngân hàng chỉ có MỘT dòng ghi nợ, mà sổ quỹ lại có N dòng thì đối chiếu không
 *  bao giờ khớp. Công nợ vẫn trừ đúng từng phiếu nhập của từng NCC.
 *
 *  RÀO CHẶN QUAN TRỌNG NHẤT — MỘT LỆNH CHUYỂN CHỈ TỚI MỘT NƠI NHẬN. Gom nhầm hai
 *  NCC có tài khoản khác nhau vào một lệnh là ghi "đã trả" cho một NCC chưa hề
 *  nhận được đồng nào: công nợ của họ biến mất khỏi màn hình, không ai đòi nữa,
 *  và tiền thì đã nằm ở túi người khác. Nên tính "nơi nhận hiệu lực" của từng
 *  phiếu rồi bắt buộc tất cả phải trùng nhau, khác một cái là từ chối và NÓI RÕ
 *  cái nào khác.
 *
 *  Chuyển khoản thì nơi nhận là SỐ TÀI KHOẢN (riêng của NCC thắng tài khoản nhóm,
 *  cùng luật với `bankHieuLuc`). Tiền mặt thì nơi nhận là NHÓM — một người ôm tiền
 *  đi thu hộ cả cụm.
 * ───────────────────────────────────────────────────────────────────────────── */
router.post('/tra-nhom', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const ids: string[] = Array.isArray(req.body?.receiptIds)
            ? Array.from(new Set(req.body.receiptIds.map((x: any) => String(x)).filter(Boolean)))
            : []
        if (ids.length === 0) { res.status(400).json({ success: false, error: 'Chưa chọn phiếu nào' }); return }
        if (ids.length > 100) {
            res.status(400).json({ success: false, error: 'Mỗi lệnh gộp tối đa 100 phiếu — chia làm nhiều lượt' })
            return
        }

        const payBy = String(req.body?.paidBy || 'bank').toLowerCase()
        const laChuyenKhoan = payBy === 'bank' || payBy === 'transfer'

        const phieuDs = await prisma.importReceipt.findMany({ where: { id: { in: ids } } })
        if (phieuDs.length !== ids.length) {
            /* Thiếu phiếu thì DỪNG, đừng trả phần còn lại: người bấm đang nhìn một
             * tổng tiền cụ thể, trả thiếu một phiếu là lệch đúng số họ vừa chuyển. */
            const thay = new Set(phieuDs.map((r: any) => r.id))
            res.status(404).json({ success: false, error: `Không tìm thấy ${ids.filter(i => !thay.has(i)).length} phiếu — tải lại trang rồi chọn lại` })
            return
        }

        // ─── Kiểm từng phiếu: quyền chi nhánh, chưa huỷ, còn nợ ───
        const canTra: Array<{ phieu: any; conLai: number }> = []
        for (const r of phieuDs) {
            if (!canAccessBranch(req, r.branchId)) { res.status(404).json({ success: false, error: `Phiếu ${r.code} không thuộc chi nhánh đang xem` }); return }
            if (r.status === 'cancelled') { res.status(400).json({ success: false, error: `Phiếu ${r.code} đã huỷ — bỏ nó ra khỏi lệnh gộp` }); return }
            const daTra = r.paymentStatus === 'paid' ? r.totalCost : (r.paidAmount ?? 0)
            const conLai = Math.round(Math.max(0, r.totalCost - daTra))
            if (conLai <= 0) { res.status(400).json({ success: false, error: `Phiếu ${r.code} đã trả đủ — tải lại trang rồi chọn lại` }); return }
            canTra.push({ phieu: r, conLai })
        }

        // ─── NƠI NHẬN phải là MỘT ───
        const nccIds = Array.from(new Set(canTra.map(x => String(x.phieu.supplierId || '')).filter(Boolean)))
        const nccDs = nccIds.length
            ? await prisma.supplier.findMany({
                where: { id: { in: nccIds } },
                include: { group: { select: { id: true, name: true, bankBin: true, bankAccountNo: true, bankAccountName: true } } },
            })
            : []
        const nccTheoId = new Map<string, any>(nccDs.map((n: any) => [n.id, n]))

        /** Tài khoản THẬT SỰ nhận tiền — riêng của NCC thắng tài khoản nhóm */
        const tkHieuLuc = (n: any) => {
            if (!n) return null
            if (n.bankBin && n.bankAccountNo && n.bankAccountName) {
                return { bin: n.bankBin, so: n.bankAccountNo, ten: n.bankAccountName, nguon: 'ncc' as const }
            }
            const g = n.group
            if (g?.bankBin && g?.bankAccountNo && g?.bankAccountName) {
                return { bin: g.bankBin, so: g.bankAccountNo, ten: g.bankAccountName, nguon: 'nhom' as const }
            }
            return null
        }

        const noiNhan = new Map<string, string[]>()   // khoá → tên NCC
        for (const { phieu } of canTra) {
            const n = nccTheoId.get(String(phieu.supplierId || ''))
            const ten = String(phieu.supplierName || n?.name || 'NCC không rõ')
            let khoa: string
            if (laChuyenKhoan) {
                const tk = tkHieuLuc(n)
                // Chưa khai tài khoản thì tự nó là một đích riêng — không gộp mù được
                khoa = tk ? `tk:${tk.bin}|${tk.so}` : `chua-khai:${phieu.supplierId || phieu.id}`
            } else {
                khoa = n?.groupId ? `nhom:${n.groupId}` : `ncc:${phieu.supplierId || phieu.id}`
            }
            const cu2 = noiNhan.get(khoa) || []
            if (!cu2.includes(ten)) cu2.push(ten)
            noiNhan.set(khoa, cu2)
        }
        if (noiNhan.size > 1) {
            const moTa = Array.from(noiNhan.entries()).map(([k, tens]) => {
                const nhan = k.startsWith('tk:') ? k.slice(3).split('|')[1]
                    : k.startsWith('chua-khai:') ? 'chưa khai tài khoản' : 'trả riêng'
                return `${tens.join(', ')} → ${nhan}`
            })
            res.status(400).json({
                success: false,
                error: 'Không gộp được: các phiếu này trả về NHIỀU nơi nhận khác nhau, một lệnh chuyển chỉ tới một nơi. '
                    + moTa.join(' · ') + '. Tách ra trả từng nơi, hoặc khai chung tài khoản nhóm trước.',
            })
            return
        }

        const tongTien = canTra.reduce((a, x) => a + x.conLai, 0)
        if (tongTien <= 0) { res.status(400).json({ success: false, error: 'Tổng tiền bằng 0 — không có gì để trả' }); return }

        // Tài khoản chuyển ĐI (của mình) — chỉ có nghĩa với chuyển khoản
        let bankAccountId: string | null = null
        if (laChuyenKhoan && req.body?.bankAccountId) {
            const tk = await prisma.bankAccount.findUnique({
                where: { id: String(req.body.bankAccountId) }, select: { id: true },
            }).catch(() => null)
            if (!tk) { res.status(400).json({ success: false, error: 'Tài khoản ngân hàng không tồn tại — tải lại danh sách rồi chọn lại' }); return }
            bankAccountId = tk.id
        }

        /* ─── GHI TRẢ: MỘT transaction cho CẢ CỤM ───
         * Tất-cả-hoặc-không-gì. Ghi lẻ từng phiếu rồi gãy giữa chừng là để lại một
         * lệnh chuyển đã đi mà chỉ vài phiếu được trừ — dò lại rất mất công.
         * Tuần tự trong transaction: pool prod mỗi cửa hàng đúng 1 kết nối. */
        let daGhi: Array<{ code: string; supplierName: string; tra: number }> = []
        try {
            daGhi = await prisma.$transaction(async (tx: any) => {
                const kq: Array<{ code: string; supplierName: string; tra: number }> = []
                for (const { phieu, conLai } of canTra) {
                    const fresh = await tx.importReceipt.findUnique({ where: { id: phieu.id } })
                    if (!fresh || fresh.status === 'cancelled') throw new Error('PAY_CONFLICT')
                    const daTra = fresh.paymentStatus === 'paid' ? fresh.totalCost : (fresh.paidAmount ?? 0)
                    if (daTra + conLai > fresh.totalCost + 1) throw new Error('PAY_CONFLICT')
                    // Khoá lạc quan theo paidAmount cũ — lượt thua nhận 409, không ghi đè
                    const w = await tx.importReceipt.updateMany({
                        where: { id: fresh.id, paidAmount: fresh.paidAmount },
                        data: { paidAmount: daTra + conLai, paymentStatus: 'paid' },
                    })
                    if (w.count === 0) throw new Error('PAY_CONFLICT')
                    kq.push({ code: fresh.code, supplierName: String(fresh.supplierName || ''), tra: conLai })
                }
                return kq
            }, { timeout: 30000 })
        } catch (e: any) {
            if (e?.message === 'PAY_CONFLICT') {
                res.status(409).json({ success: false, error: 'Một phiếu trong cụm vừa được thanh toán ở thao tác khác — KHÔNG ghi gì cả, tải lại trang rồi chọn lại' })
                return
            }
            throw e
        }

        /* ─── MỘT phiếu chi cho cả lệnh + bút toán đi kèm ───
         * Hỏng thì phải KÊU: phiếu nhập đã ghi trả rồi, sổ quỹ đang thiếu khoản chi
         * này, người ta cần biết mà bù. Nuốt lỗi ở đây là sổ và kho tiền lệch nhau
         * trong im lặng — đúng lỗi đã cắn ngày 20/08. */
        const tenNhan = Array.from(noiNhan.values())[0] || []
        const moTaChi = `Trả gộp ${daGhi.length} phiếu nhập cho ${tenNhan.slice(0, 3).join(', ')}`
            + (tenNhan.length > 3 ? ` +${tenNhan.length - 3} NCC` : '')
            + ` (${daGhi.map(x => x.code).slice(0, 8).join(', ')}${daGhi.length > 8 ? '…' : ''})`
        let phieuChi: any = null
        let loiSo: string | null = null
        try {
            phieuChi = await prisma.$transaction(async (t: any) => {
                const pc = await t.expense.create({
                    data: {
                        description: moTaChi,
                        amount: tongTien,
                        category: 'supplier_payment',
                        paidBy: laChuyenKhoan ? 'bank' : 'cash',
                        bankAccountId,
                        date: new Date(),
                        branchId: getBranchId(req) || canTra[0]?.phieu.branchId || null,
                    },
                })
                await postExpenseJournal(t, pc as any, {
                    branchId: pc.branchId || null,
                    userId: (req as any).user?.userId || null,
                })
                return pc
            })
        } catch (e: any) {
            loiSo = moTaLoi(e)
            console.error(`[tra-nhom] ĐÃ ghi trả ${tongTien} cho ${daGhi.length} phiếu (${daGhi.map(x => x.code).join(', ')}) nhưng KHÔNG tạo được phiếu chi + bút toán — sổ đang thiếu khoản chi này:`, loiSo)
        }

        try {
            const u = await prisma.user.findUnique({ where: { id: req.user!.userId } })
            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId, userName: u?.name || 'Admin',
                    action: 'pay_supplier_batch', entity: 'ImportReceipt',
                    entityId: phieuChi?.id || daGhi[0]?.code || '',
                    details: JSON.stringify({ tongTien, soPhieu: daGhi.length, phieu: daGhi, phieuChiId: phieuChi?.id || null }),
                },
            })
        } catch { /* nhật ký hỏng không được chặn việc đã làm xong */ }

        res.json({
            success: true,
            data: {
                tongTien, soPhieu: daGhi.length, chiTiet: daGhi,
                phieuChiId: phieuChi?.id || null,
                // Nói thẳng khi sổ quỹ chưa có khoản chi, đừng để người dùng tưởng xong xuôi
                canhBaoSo: phieuChi ? null
                    : `Đã trừ công nợ ${daGhi.length} phiếu nhưng CHƯA tạo được phiếu chi trong sổ quỹ (${loiSo || 'không rõ lỗi'}). Vào Kế Toán → Đối chiếu sổ sách để ghi bù.`,
            },
        })
    } catch (err: any) {
        console.error('POST /import-receipts/tra-nhom lỗi:', err)
        res.status(500).json({ success: false, error: errorDetail(err) })
    }
})

router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const {
            search, status, dateFrom, dateTo, supplierId, payment, vat, amountMin, amountMax,
            page = '1', pageSize = '20',
        } = req.query

        // Branch filter như các route khác: chi nhánh con chỉ thấy phiếu của mình
        const where: any = { ...getBranchFilter(req) }

        if (search) {
            // Không phân biệt hoa/thường (Postgres mặc định phân biệt) + tìm được cả
            // TÊN/SKU hàng hoá nằm trong phiếu, số hoá đơn VAT.
            const s = String(search).trim()
            const ci = { contains: s, mode: 'insensitive' as const }
            where.OR = [
                { code: ci },
                { supplierName: ci },
                { note: ci },
                { vatInvoiceNo: ci },
                { items: { some: { productName: ci } } },
                { items: { some: { productSku: ci } } },
            ]
        }
        if (status) where.status = String(status)
        if (supplierId) where.supplierId = String(supplierId)
        // Có/không hoá đơn VAT (tồn kho thuế)
        if (vat === 'true') where.hasVatInvoice = true
        if (vat === 'false') where.hasVatInvoice = { not: true }
        // Công nợ NCC: phiếu legacy không có paymentStatus coi như đã trả đủ
        if (payment === 'unpaid') where.paymentStatus = { in: ['unpaid', 'partial'] }
        // paymentStatus là cột NOT NULL default 'paid' → KHÔNG được so với null
        // (Prisma ném ValidationError, cả endpoint 500).
        if (payment === 'paid') where.paymentStatus = 'paid'
        // Khoảng tiền theo tổng phiếu — bỏ qua giá trị không phải số (NaN lọt vào
        // filter Prisma làm nổ query → 500).
        const numOrNull = (v: any) => {
            const n = parseFloat(String(v))
            return Number.isFinite(n) ? n : null
        }
        const minVal = amountMin ? numOrNull(amountMin) : null
        const maxVal = amountMax ? numOrNull(amountMax) : null
        if (minVal !== null || maxVal !== null) {
            where.totalCost = {}
            if (minVal !== null) where.totalCost.gte = minVal
            if (maxVal !== null) where.totalCost.lte = maxVal
        }
        // Khoảng ngày: ưu tiên ngày nhập trên phiếu (transactionDate = ngày hoá đơn),
        // phiếu cũ không có thì rơi về createdAt. FE gửi ISO datetime đã tính theo giờ VN.
        if (dateFrom || dateTo) {
            const range: any = {}
            const dOrNull = (v: any) => { const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d }
            const gte = dateFrom ? dOrNull(dateFrom) : null
            const lte = dateTo ? dOrNull(dateTo) : null
            if (gte) range.gte = gte
            if (lte) range.lte = lte
            if (gte || lte) {
                where.AND = [...(where.AND || []), {
                    OR: [
                        { transactionDate: range },
                        { transactionDate: null, createdAt: range },
                    ],
                }]
            }
        }

        const pageNum = Math.max(1, parseInt(String(page)) || 1)
        const size = Math.max(1, Math.min(100, parseInt(String(pageSize)) || 20))
        const skip = (pageNum - 1) * size

        const whereNoStatus: any = { ...where }
        delete whereNoStatus.status

        // TUẦN TỰ, không Promise.all: 5 truy vấn song song = 1 lượt tải trang ôm 5
        // kết nối trong pool per-store nhỏ (PRISMA_POOL_SIZE=8) → trùng cron là cạn
        // pool, 500 hàng loạt (sự cố 29/07). Chậm thêm ~200ms, đổi lấy ổn định.
        const total = await prisma.importReceipt.count({ where })
        const receipts = await prisma.importReceipt.findMany({
            where,
            include: { items: true },
            orderBy: { createdAt: 'desc' },
            skip,
            take: size,
        })
        // Tổng hợp trên TOÀN BỘ filter (không chỉ trang) cho KPI/donut/top NCC
        // Donut trạng thái phải bỏ chính filter status ra, nếu không chọn "Nháp"
        // là 3 ô còn lại về 0 (nhìn như mất dữ liệu).
        const statusGroups = await prisma.importReceipt.groupBy({ by: ['status'], where: whereNoStatus, _count: true })
        const completedAgg = await prisma.importReceipt.aggregate({ where: { ...where, status: 'completed' }, _sum: { totalCost: true }, _count: true })
        const topSup = await prisma.importReceipt.groupBy({
            by: ['supplierName'], where: { ...where, status: 'completed' },
            _sum: { totalCost: true }, orderBy: { _sum: { totalCost: 'desc' } }, take: 5,
        })

        const byStatus: Record<string, number> = Object.fromEntries(statusGroups.map((g: any) => [g.status, g._count]))
        const completedValue = completedAgg._sum.totalCost || 0
        const summary = {
            total,
            draft: byStatus['draft'] || 0,
            completed: byStatus['completed'] || 0,
            cancelled: byStatus['cancelled'] || 0,
            returned: (byStatus['returned'] || 0) + (byStatus['partial_return'] || 0),
            totalValue: completedValue,
            avgValue: completedAgg._count ? Math.round(completedValue / completedAgg._count) : 0,
            topSuppliers: topSup.map((t: any) => ({ name: t.supplierName || 'Không có NCC', value: t._sum.totalCost || 0 })),
        }

        res.json({
            success: true,
            data: {
                summary,
                items: receipts.map(r => ({
                    ...r,
                    createdAt: r.createdAt.toISOString(),
                    importDate: (r as any).transactionDate
                        ? (r as any).transactionDate.toISOString().slice(0, 10)
                        : null,
                    transactionDate: (r as any).transactionDate?.toISOString() || r.createdAt.toISOString(),
                    dueDate: (r as any).dueDate ? (r as any).dueDate.toISOString().slice(0, 10) : null,
                    updatedAt: r.updatedAt.toISOString(),
                    // returnedQtyMap: productId -> returnedQuantity (stored directly on items)
                    returnedQtyMap: Object.fromEntries(
                        (r.items || []).map((i: any) => [i.productId, i.returnedQuantity ?? 0])
                    ),
                })),
                total,
                page: pageNum,
                pageSize: size,
                totalPages: Math.ceil(total / size),
            },
        })
    } catch (err) {
        console.error('Get import receipts error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/import-receipts/:id
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true },
        })

        if (!receipt) {
            res.status(404).json({ success: false, error: 'Not found' })
            return
        }

        // Branch ownership: prevent reading another branch's receipt by id
        if (!canAccessBranch(req, receipt.branchId)) {
            res.status(404).json({ success: false, error: 'Not found' })
            return
        }

        // returnedQtyMap built from returnedQuantity field directly on items
        const returnedQtyMap: Record<string, number> = Object.fromEntries(
            receipt.items.map(i => [i.productId, (i as any).returnedQuantity ?? 0])
        )
        res.json({
            success: true,
            data: { ...receipt, createdAt: receipt.createdAt.toISOString(), updatedAt: receipt.updatedAt.toISOString(), returnedQtyMap },
        })
    } catch (err) {
        console.error('Get import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/import-receipts
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const { items, ...receiptData } = req.body
        const user = (req as any).user

        /* Chặn trùng số hoá đơn TRƯỚC khi làm bất cứ việc gì khác: phiếu nhập
         * đụng vào tồn kho, giá vốn và bút toán, nên phát hiện muộn là phải gỡ
         * cả chuỗi. */
        const trung = await timPhieuTrungSoHoaDon(prisma, {
            vatInvoiceNo: receiptData?.vatInvoiceNo,
            supplierId: receiptData?.supplierId,
            supplierName: receiptData?.supplierName,
        })
        if (trung) {
            const oDau = trung.cungNcc
                ? 'đã dùng cho nhà cung cấp này'
                : `đã dùng ở phiếu của nhà cung cấp "${trung.supplierName || 'không ghi tên'}"`
            return res.status(400).json({
                success: false,
                error: `Số hoá đơn "${receiptData.vatInvoiceNo}" ${oDau} — phiếu ${trung.code}. `
                    + 'Nhập trùng số hoá đơn là khai trùng thuế GTGT được khấu trừ và trùng chi phí được trừ — cơ quan thuế đối chiếu ra ngay vì bên bán chỉ phát hành một tờ. '
                    + (trung.cungNcc
                        ? 'Kiểm tra lại số trên hoá đơn, hoặc mở phiếu cũ nếu đây là cùng một lần nhập.'
                        : 'Nếu đây là hoá đơn của một nhà cung cấp KHÁC trùng số, hãy chọn nhà cung cấp cho phiếu này rồi lưu lại.'),
                code: 'TRUNG_SO_HOA_DON',
                phieuTrung: trung.code,
                nccPhieuTrung: trung.supplierName ?? null,
                cungNcc: trung.cungNcc,
            })
        }

        // Fetch actual user name from DB
        const dbUser = await prisma.user.findUnique({ where: { id: user.userId || user.id } })
        const userName = dbUser?.name || user.email || 'Unknown'

        // Generate code: NH-YYYYMMDD-XXX
        const today = new Date()
        const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
        const code = await nextCode(prisma, 'importReceiptNHCodeSeq', `NH-${dateStr}`, 3, '-', 'ImportReceipt', 'code')

        // Ưu tiên item.total do client gửi (= cột "Thành tiền" trên hoá đơn đầu vào,
        // đã làm tròn chuẩn) — tự nhân SL × đơn giá sẽ lệch vài đồng khi đơn giá lẻ.
        const lineTotal = (item: any) => (Number(item.total) > 0 ? Number(item.total) : item.quantity * item.costPrice)
        const totalCost = items.reduce((sum: number, item: any) => sum + lineTotal(item), 0)

        // GIÁ VỐN = giá nhập + PHÂN BỔ chi phí cấp phiếu theo tỷ trọng thành tiền.
        // VAT đầu vào: HKD/cá nhân (không khấu trừ) → tính vào giá vốn; CÔNG TY
        // (kê khai khấu trừ) → KHÔNG — VAT tách riêng đi TK 1331 bù trừ 33311.
        const _bt = (await prisma.storeSettings.findFirst({ select: { businessType: true } }).catch(() => null))?.businessType || 'company'
        const _vatIntoCost = _bt === 'household' || _bt === 'individual'
        const extraCosts = (_vatIntoCost ? (Number(receiptData.vatAmount) || 0) : 0)
            + (Number(receiptData.shippingFee) || 0)
            + (Number(receiptData.importTax) || 0) + (Number(receiptData.otherFees) || 0)
            - (Number(receiptData.totalDiscount) || 0)
        const landedUnitCost = (item: any) => {
            const lt = lineTotal(item)
            const allocated = totalCost > 0 ? extraCosts * (lt / totalCost) : 0
            const qty = item.quantity || 1
            return Math.round((lt + allocated) / qty)
        }
        const totalItems = items.reduce((sum: number, item: any) => sum + item.quantity, 0)

        // Điều khoản thanh toán mặc định của NCC — chỉ tra khi phiếu KHÔNG tự ghi hạn.
        let hanTraTuNcc: Date | null = receiptData.dueDate ? new Date(receiptData.dueDate) : null
        let nhanDieuKhoanNcc: string | null = null
        if (!hanTraTuNcc && receiptData.supplierId) {
            const ncc = await (prisma as any).supplier.findUnique({
                where: { id: String(receiptData.supplierId) },
                select: { paymentTermType: true, paymentTermDays: true, paymentTermDom: true, paymentTermMonthOffset: true, paymentTerms: true },
            }).catch(() => null)
            /* Quy tắc ĐẦY ĐỦ của NCC (net/dom/eom, 18/08/2026 chiều) — bản ghi cũ chỉ có
             * paymentTermDays được hiểu là net. Ngày tính theo GIỜ VN. Không quy tắc → trống. */
            const quyTac = quyTacTuSupplier(ncc)
            // Tính từ NGÀY CHỨNG TỪ của phiếu (importDate/transactionDate), không phải lúc bấm lưu — phiếu nhập
            // lùi ngày (hàng nhận 01/08, ghi 18/08, NCC net-30) phải ra hạn 31/08 chứ không phải 17/09; cùng luật
            // với /payment-due suy sống (rà soát độc lập 19/08/2026).
            const ngayChungTu = receiptData.importDate ? new Date(receiptData.importDate) : (receiptData.transactionDate ? new Date(receiptData.transactionDate) : new Date())
            hanTraTuNcc = tinhHanTraTheoQuyTac(isNaN(ngayChungTu.getTime()) ? new Date() : ngayChungTu, null, quyTac)
            nhanDieuKhoanNcc = ncc?.paymentTerms || nhanQuyTac(quyTac) || null
        }

        // Công nợ NCC: client gửi paidAmount (số đã trả NCC). Không gửi → coi như
        // trả đủ (giữ nguyên hành vi cũ, không phát sinh nợ ảo).
        const paidAmount = receiptData.paidAmount !== undefined && receiptData.paidAmount !== null
            ? Math.min(Math.max(0, Number(receiptData.paidAmount) || 0), totalCost)
            : totalCost
        const paymentStatus = paidAmount >= totalCost ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid')

        const receipt = await prisma.importReceipt.create({ data: { code,
                branchId: branchId || null, // gắn chi nhánh của phiếu — thiếu sẽ khiến branch filter/canAccessBranch không có tác dụng
                supplierId: receiptData.supplierId || null,
                supplierName: receiptData.supplierName || null,
                totalCost,
                totalItems,
                status: receiptData.status || 'draft',
                paidAmount,
                paymentStatus,
                /* Hạn trả: phiếu tự ghi thì giữ; không ghi mà NCC có điều khoản
                 * (Supplier.paymentTermDays) thì suy = ngày nhập + số ngày; cả hai
                 * đều không có thì để trống. Xem lib/dieuKhoanThanhToan.ts. */
                dueDate: hanTraTuNcc,
                paymentTerm: receiptData.paymentTerm || nhanDieuKhoanNcc || null,
                // Có hoá đơn VAT đầu vào → mới tính vào tồn kho thuế. Client gửi cờ;
                // không gửi thì suy từ có tiền thuế GTGT (vatAmount > 0).
                hasVatInvoice: receiptData.hasVatInvoice !== undefined
                    ? Boolean(receiptData.hasVatInvoice)
                    : Number(receiptData.vatAmount) > 0,
                vatInvoiceNo: receiptData.vatInvoiceNo || null,
                // Chi phí cấp phiếu — phân bổ vào GIÁ VỐN (không sửa giá nhập từng dòng)
                vatAmount: Number(receiptData.vatAmount) || 0,
                shippingFee: Number(receiptData.shippingFee) || 0,
                importTax: Number(receiptData.importTax) || 0,
                otherFees: Number(receiptData.otherFees) || 0,
                totalDiscount: Number(receiptData.totalDiscount) || 0,
                note: receiptData.note || null,
                userId: user.userId || user.id,
                userName,
                transactionDate: receiptData.importDate ? new Date(receiptData.importDate) : (receiptData.transactionDate ? new Date(receiptData.transactionDate) : null),
                items: {
                    create: items.map((item: any) => ({
                        productId: item.productId,
                        productName: item.productName,
                        productSku: item.productSku,
                        quantity: item.quantity,
                        costPrice: item.costPrice,
                        total: lineTotal(item),
                    })),
                },
            },
            include: { items: true },
        })

        // If completed immediately, update product stock + log inventory transactions
        if (receipt.status === 'completed') {
            const method = await getCostPriceMethod(prisma as any)
            // Đồng bộ WarehouseStock theo kho mặc định của chi nhánh phiếu —
            // POS check tồn theo WarehouseStock nên nhập hàng phải tăng cả kho này
            const defaultWarehouse = await getOrCreateDefaultWarehouse(prisma as any, branchId || null)
            const defaultWarehouseId: string | null = defaultWarehouse?.id || null
            for (const item of receipt.items) {
                // Fetch product BEFORE updating stock to get current state
                const productBefore = await prisma.product.findUnique({ where: { id: item.productId } })
                const currentStock = productBefore?.stock ?? 0
                const currentCostPrice = productBefore?.costPrice ?? 0

                // Calculate new cost price based on chosen method — dùng GIÁ VỐN đã
                // phân bổ chi phí (landed cost), không phải giá nhập trần trên dòng
                const newCostPrice = calculateCostPrice(method, {
                    productId: item.productId,
                    currentStock,
                    currentCostPrice,
                    transactionQty: item.quantity,
                    transactionUnitPrice: landedUnitCost(item),
                })

                // Update stock AND costPrice
                const _u = await prisma.product.update({
                    where: { id: item.productId },
                    data: {
                        stock: { increment: item.quantity },
                        costPrice: newCostPrice,
                    },
                })

                // Tăng tồn theo kho (WarehouseStock) — best-effort như luồng inventory
                if (defaultWarehouseId) {
                    await updateWarehouseStock(prisma as any, defaultWarehouseId, item.productId, item.quantity)
                        .catch((err: any) => console.error(`[ImportReceipt] WarehouseStock increment failed for product ${item.productId}:`, err))
                }
                // Webhook đầu ra: stock.changed khi nhập hàng (gated + fire-and-forget)
                emitStockChanged(prisma as any, { productId: item.productId, sku: (_u as any).sku, name: (_u as any).name, branchId: branchId ?? null, delta: item.quantity, stock: (_u as any).stock, reason: 'import' }, req.user?.storeSchema).catch(() => { })

                await prisma.inventoryTransaction.create({
                    data: {
                        type: 'import',
                        productId: item.productId,
                        productName: item.productName,
                        productSku: item.productSku,
                        quantity: item.quantity,
                        reason: `Nhập kho theo phiếu ${code}`,
                        referenceId: code,
                        referenceType: 'import_receipt',
                        unitPrice: item.costPrice || 0,
                        costPriceAfter: newCostPrice,
                        supplierId: receiptData.supplierId || null,
                        supplierName: receiptData.supplierName || null,
                        userId: user.userId || user.id,
                        userName,
                    },
                })
            }
        }

        /* Ghi sổ kế toán NGAY khi phiếu đã hoàn tất (Nợ 156 + 1331 / Có 331, và
         * phần trả ngay Nợ 331 / Có 111). Phiếu nháp chưa phải nghiệp vụ nên
         * không ghi. Không chặn phản hồi nếu ghi sổ hỏng — bút toán còn có thể
         * dựng lại bằng POST /api/tax/auto-journal. */
        if (receipt.status === 'completed') {
            await postImportReceiptJournal(prisma, receipt as any, {
                branchId: receipt.branchId || branchId || null,
                userId: user.userId || user.id,
                vatKhauTru: !_vatIntoCost,
            }).catch(() => { })
        }

        res.status(201).json({
            success: true,
            data: {
                ...receipt,
                createdAt: receipt.createdAt.toISOString(),
                importDate: (receipt as any).transactionDate
                    ? (receipt as any).transactionDate.toISOString().slice(0, 10)
                    : null,
                updatedAt: receipt.updatedAt.toISOString(),
            },
        })

        // Webhook đầu ra: nhập hàng (post-response, enrich thông tin NCC — gated)
        if (webhooksActive()) {
            try {
                let payload: any = importPayload(receipt)
                if (receipt.supplierId) {
                    const sup = await prisma.supplier.findUnique({ where: { id: receipt.supplierId }, select: { code: true, phone: true, contactName: true } }).catch(() => null)
                    if (sup) payload = { ...payload, supplierCode: sup.code, supplierPhone: sup.phone, supplierContact: sup.contactName }
                }
                emitEntityEvent(prisma, 'import.created', payload, req.user?.storeSchema).catch(() => { })
            } catch { /* webhook không ảnh hưởng phiếu nhập */ }
        }
    } catch (err) {
        console.error('Create import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/import-receipts/:id/complete — Confirm receipt (draft → completed)
router.put('/:id/complete', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true },
        })

        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (receipt.status !== 'draft') { res.status(400).json({ success: false, error: 'Only drafts can be completed' }); return }

        // Claim trạng thái trước khi tăng kho (chống race): 2 request đồng thời cùng
        // đọc status='draft' sẽ tăng kho 2 lần. updateMany có điều kiện status='draft'
        // là atomic — chỉ 1 request claim được, request còn lại nhận count=0 → 409.
        const claimed = await prisma.importReceipt.updateMany({
            where: { id: String(req.params.id), status: 'draft' },
            data: { status: 'processing' },
        })
        if (claimed.count === 0) {
            res.status(409).json({ success: false, error: 'Phiếu đã được xử lý' })
            return
        }

        const user = (req as any).user
        const dbUser = await prisma.user.findUnique({ where: { id: user.userId || user.id } })
        const userName = dbUser?.name || user.email || 'Unknown'

        // Update stock for each item + log inventory transactions
        const method = await getCostPriceMethod(prisma as any)
        // GIÁ VỐN = giá nhập + phân bổ chi phí cấp phiếu theo tỷ trọng thành tiền —
        // như đường tạo phiếu. VAT: chỉ HKD/cá nhân mới tính vào giá vốn; công ty
        // kê khai khấu trừ thì VAT tách riêng (TK 1331), không vào giá vốn.
        const rAny: any = receipt
        /* Đọc hỏng KHÔNG được mặc định 'company': hộ kinh doanh mà rơi nhầm nhánh này thì VAT
         * không vào giá vốn ⇒ giá vốn thấp giả, và con số đó được GHI CỨNG vào tồn kho, sai vĩnh
         * viễn cho tới khi ai đó phát hiện. Thà hỏng lộ ra ngay (20/08/2026). */
        const _bt2 = (await prisma.storeSettings.findFirst({ select: { businessType: true } }))?.businessType || 'company'
        const _vatIntoCost2 = _bt2 === 'household' || _bt2 === 'individual'
        const cExtra = (_vatIntoCost2 ? (Number(rAny.vatAmount) || 0) : 0)
            + (Number(rAny.shippingFee) || 0)
            + (Number(rAny.importTax) || 0) + (Number(rAny.otherFees) || 0)
            - (Number(rAny.totalDiscount) || 0)
        const cTotal = receipt.items.reduce((s: number, it: any) => s + (Number(it.total) > 0 ? Number(it.total) : it.quantity * it.costPrice), 0)
        const landedUnit = (it: any) => {
            const lt = Number(it.total) > 0 ? Number(it.total) : it.quantity * it.costPrice
            const alloc = cTotal > 0 ? cExtra * (lt / cTotal) : 0
            return Math.round((lt + alloc) / (it.quantity || 1))
        }
        // Đồng bộ WarehouseStock theo kho mặc định của chi nhánh phiếu —
        // POS check tồn theo WarehouseStock nên nhập hàng phải tăng cả kho này
        const defaultWarehouse = await getOrCreateDefaultWarehouse(prisma as any, receipt.branchId || null)
        const defaultWarehouseId: string | null = defaultWarehouse?.id || null
        for (const item of receipt.items) {
            // Fetch product BEFORE updating stock
            const productBefore = await prisma.product.findUnique({ where: { id: item.productId } })
            const currentStock = productBefore?.stock ?? 0
            const currentCostPrice = productBefore?.costPrice ?? 0

            const newCostPrice = calculateCostPrice(method, {
                productId: item.productId,
                currentStock,
                currentCostPrice,
                transactionQty: item.quantity,
                transactionUnitPrice: landedUnit(item),
            })

            const _u = await prisma.product.update({
                where: { id: item.productId },
                data: {
                    stock: { increment: item.quantity },
                    costPrice: newCostPrice,
                },
            })
            // Tăng tồn theo kho (WarehouseStock) — best-effort như luồng inventory
            if (defaultWarehouseId) {
                await updateWarehouseStock(prisma as any, defaultWarehouseId, item.productId, item.quantity)
                    .catch((err: any) => console.error(`[ImportReceipt] WarehouseStock increment failed for product ${item.productId}:`, err))
            }
            // Webhook đầu ra: stock.changed khi nhập hàng (gated + fire-and-forget)
            emitStockChanged(prisma as any, { productId: item.productId, sku: (_u as any).sku, name: (_u as any).name, branchId: receipt.branchId ?? null, delta: item.quantity, stock: (_u as any).stock, reason: 'import' }, req.user?.storeSchema).catch(() => { })
            await prisma.inventoryTransaction.create({
                data: {
                    type: 'import',
                    productId: item.productId,
                    productName: item.productName,
                    productSku: item.productSku,
                    quantity: item.quantity,
                    reason: `Nhập kho theo phiếu ${receipt.code}`,
                    referenceId: receipt.code,
                    referenceType: 'import_receipt',
                    unitPrice: item.costPrice || 0,
                    costPriceAfter: newCostPrice,
                    supplierId: receipt.supplierId,
                    supplierName: receipt.supplierName,
                    userId: user.userId || user.id,
                    userName,
                },
            })
        }

        const updated = await prisma.importReceipt.update({
            where: { id: String(req.params.id) },
            data: { status: 'completed' },
            include: { items: true },
        })

        res.json({
            success: true,
            data: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() },
        })
    } catch (err) {
        console.error('Complete import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/import-receipts/:id/cancel
router.put('/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const receipt = await prisma.importReceipt.findUnique({ where: { id: String(req.params.id) } })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (receipt.status !== 'draft') { res.status(400).json({ success: false, error: 'Only drafts can be cancelled' }); return }

        const updated = await prisma.importReceipt.update({
            where: { id: String(req.params.id) },
            data: { status: 'cancelled' },
            include: { items: true },
        })

        res.json({
            success: true,
            data: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() },
        })
    } catch (err) {
        console.error('Cancel import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/import-receipts/:id/vat-invoice — đánh dấu phiếu CÓ/KHÔNG hoá đơn VAT.
// Body: { hasVatInvoice: boolean, vatInvoiceNo?: string }. Chỉ phiếu có hoá đơn
// VAT mới tính vào TỒN KHO THUẾ (gate xuất hoá đơn bán).
router.put('/:id/vat-invoice', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const has = Boolean(req.body?.hasVatInvoice)

        /* Cửa thứ hai: gán số hoá đơn cho phiếu đã tạo. Chặn ở mỗi cửa tạo phiếu
         * là bịt được một nửa — người dùng vẫn gõ trùng được qua đường này. */
        if (has && String(req.body?.vatInvoiceNo || '').trim()) {
            const hienTai = await prisma.importReceipt.findUnique({
                where: { id: String(req.params.id) },
                select: { supplierId: true, supplierName: true },
            }).catch(() => null)
            const trung = await timPhieuTrungSoHoaDon(prisma, {
                vatInvoiceNo: req.body.vatInvoiceNo,
                supplierId: hienTai?.supplierId,
                supplierName: hienTai?.supplierName,
                boQuaId: String(req.params.id),
            })
            if (trung) {
                return res.status(400).json({
                    success: false,
                    error: `Số hoá đơn "${req.body.vatInvoiceNo}" đã dùng cho nhà cung cấp này ở phiếu ${trung.code}. `
                        + 'Nhập trùng là khai trùng thuế GTGT được khấu trừ và trùng chi phí được trừ.',
                    code: 'TRUNG_SO_HOA_DON',
                    phieuTrung: trung.code,
                })
            }
        }

        const updated = await prisma.importReceipt.update({
            where: { id: String(req.params.id) },
            data: { hasVatInvoice: has, vatInvoiceNo: has ? (req.body?.vatInvoiceNo || null) : null },
        })
        res.json({ success: true, data: { id: updated.id, hasVatInvoice: updated.hasVatInvoice, vatInvoiceNo: updated.vatInvoiceNo } })
    } catch (err) {
        console.error('Set VAT invoice flag error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/import-receipts/:id/pay — Trả tiền NCC cho phiếu nhập (một phần hoặc đủ)
// Body: { amount?: number } — không gửi amount = trả nốt phần còn lại.
router.put('/:id/pay', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const receipt = await prisma.importReceipt.findUnique({ where: { id: String(req.params.id) } })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (!canAccessBranch(req, receipt.branchId)) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (receipt.status === 'cancelled') {
            res.status(400).json({ success: false, error: 'Phiếu đã hủy — không thể thanh toán' })
            return
        }

        const paid = (receipt as any).paymentStatus === 'paid' ? receipt.totalCost : ((receipt as any).paidAmount ?? 0)
        const remaining = Math.max(0, receipt.totalCost - paid)
        if (remaining <= 0) {
            res.status(400).json({ success: false, error: 'Phiếu đã thanh toán đủ' })
            return
        }

        const rawAmount = req.body?.amount
        const payAmount = rawAmount !== undefined && rawAmount !== null ? Number(rawAmount) : remaining
        if (!Number.isFinite(payAmount) || payAmount <= 0) {
            res.status(400).json({ success: false, error: 'Số tiền thanh toán không hợp lệ' })
            return
        }
        if (payAmount > remaining) {
            res.status(400).json({ success: false, error: `Số tiền vượt quá nợ còn lại (${remaining})` })
            return
        }

        // Chống race đọc-cộng-ghi: 2 request /pay đồng thời cùng đọc paidAmount cũ sẽ
        // mất 1 lần trả hoặc trả vượt totalCost. Gói vào $transaction, đọc lại phiếu
        // bên trong, kiểm tra paid + số trả <= totalCost, và ghi bằng khóa lạc quan
        // theo paidAmount cũ (updateMany có điều kiện) — request thua nhận 409.
        let newPaid = 0
        let updated: any
        try {
            updated = await prisma.$transaction(async (tx) => {
                const fresh = await tx.importReceipt.findUnique({ where: { id: receipt.id } })
                if (!fresh || fresh.status === 'cancelled') throw new Error('PAY_CONFLICT')
                const freshPaid = (fresh as any).paymentStatus === 'paid' ? fresh.totalCost : ((fresh as any).paidAmount ?? 0)
                if (freshPaid + payAmount > fresh.totalCost) throw new Error('PAY_CONFLICT')
                newPaid = freshPaid + payAmount
                const write = await tx.importReceipt.updateMany({
                    where: { id: fresh.id, paidAmount: (fresh as any).paidAmount } as any,
                    data: {
                        paidAmount: newPaid,
                        paymentStatus: newPaid >= fresh.totalCost ? 'paid' : 'partial',
                    } as any,
                })
                if (write.count === 0) throw new Error('PAY_CONFLICT')
                return tx.importReceipt.findUnique({ where: { id: fresh.id }, include: { items: true } })
            })
        } catch (e: any) {
            if (e?.message === 'PAY_CONFLICT') {
                res.status(409).json({ success: false, error: 'Phiếu vừa được thanh toán bởi thao tác khác — vui lòng tải lại và thử lại' })
                return
            }
            throw e
        }
        if (!updated) { res.status(404).json({ success: false, error: 'Not found' }); return }

        // Mirror vào sổ chi (Expense) để sổ quỹ phản ánh dòng tiền ra — best-effort.
        // category 'supplier_payment' → auto-journal ghi Nợ 331/Có 11x (giảm phải
        // trả), KHÔNG vào chi phí 6428. paidBy quyết định vế Có 111 (cash) hay 112.
        const payBy = String(req.body?.paidBy || req.body?.method || 'cash').toLowerCase()
        /* TÀI KHOẢN CHUYỂN ĐI (30/08/2026, chủ shop: "chọn chuyển từ tài khoản
         * nào để mai này tra soát sao kê cho dễ"): phiếu chi gắn bankAccountId
         * thì đối chiếu sao kê e-banking lọc thẳng theo tài khoản được. Chỉ có
         * nghĩa với chuyển khoản; id lạ thì báo lỗi chứ không ghi bừa. */
        let bankAccountId: string | null = null
        if ((payBy === 'bank' || payBy === 'transfer') && req.body?.bankAccountId) {
            const tk = await (prisma as any).bankAccount.findUnique({
                where: { id: String(req.body.bankAccountId) }, select: { id: true },
            }).catch(() => null)
            if (!tk) {
                res.status(400).json({ success: false, error: 'Tài khoản ngân hàng không tồn tại — tải lại danh sách rồi chọn lại' })
                return
            }
            bankAccountId = tk.id
        }
        /* PHIẾU CHI + BÚT TOÁN đi cùng nhau (20/08/2026). Bản cũ tạo phiếu chi rồi ghi sổ ở lệnh
         * riêng với `.catch(() => { })` RỖNG: phiếu nhập ghi "đã trả", có phiếu chi, mà sổ không
         * có bút toán giảm 331 nào — sổ và kho tiền lệch nhau trong im lặng.
         * Vẫn để NGOÀI transaction thanh toán (khối đó dùng khoá lạc quan riêng), nhưng hỏng thì
         * phải kêu: phiếu nhập đã ghi trả rồi, người ta cần biết mà bù sổ. */
        let phieuChi: any = null
        try {
            phieuChi = await (prisma as any).$transaction(async (t: any) => {
                const pc = await t.expense.create({
                    data: {
                        description: `Trả tiền NCC ${receipt.supplierName || ''} - phiếu nhập ${receipt.code}`.trim(),
                        amount: payAmount,
                        category: 'supplier_payment',
                        paidBy: payBy === 'bank' || payBy === 'transfer' ? 'bank' : 'cash',
                        bankAccountId,
                        date: new Date(),
                        branchId: receipt.branchId || null,
                    },
                })
                /* Ghi sổ ngay cho phiếu chi vừa tạo (Nợ 331 / Có 111|112 vì category là
                 * supplier_payment). CHỈ ghi qua đường phiếu chi này — thêm một bút toán
                 * PAYSUP-* nữa là ghi trùng, vì backfill cũng ghi theo EXP-<id>. */
                await postExpenseJournal(t, pc as any, {
                    branchId: receipt.branchId || null,
                    userId: (req as any).user?.userId || (req as any).user?.id || null,
                })
                return pc
            })
        } catch (e: any) {
            console.error(`[tra-ncc] Phiếu nhập ${receipt.code} ĐÃ ghi trả ${payAmount} nhưng KHÔNG tạo được phiếu chi + bút toán — sổ đang thiếu khoản chi này:`, moTaLoi(e))
        }

        // Audit log (best-effort)
        try {
            const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    userName: user?.name || 'Admin',
                    action: 'pay_supplier',
                    entity: 'ImportReceipt',
                    entityId: receipt.id,
                    details: JSON.stringify({ code: receipt.code, amount: payAmount, remaining: receipt.totalCost - newPaid }),
                },
            })
        } catch { }

        res.json({
            success: true,
            data: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() },
        })
    } catch (err) {
        console.error('Pay import receipt error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/import-receipts/:id/return — Return imported goods to supplier
router.put('/:id/return', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true },
        })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }
        if (receipt.status !== 'completed' && receipt.status !== 'partial_return') {
            res.status(400).json({ success: false, error: 'Chỉ có thể trả hàng phiếu đã hoàn thành' }); return
        }

        const user = (req as any).user
        const dbUser = await prisma.user.findUnique({ where: { id: user.userId || user.id } })
        const userName = dbUser?.name || user.email || 'Unknown'

        const returnItems: { productId: string; quantity: number; reason?: string }[] = req.body.items
        if (!returnItems || returnItems.length === 0) {
            res.status(400).json({ success: false, error: 'Vui lòng chọn sản phẩm cần trả' }); return
        }

        let totalReturnCost = 0
        let totalReturnQty = 0

        // ── Validate & process each return item ──────────────────────────────
        for (const ri of returnItems) {
            const receiptItem = receipt.items.find(i => i.productId === ri.productId)
            if (!receiptItem) {
                res.status(400).json({ success: false, error: `Sản phẩm ${ri.productId} không có trong phiếu` }); return
            }

            // returnedQuantity is tracked directly on the item (not via inventoryTransaction)
            const alreadyReturned = (receiptItem as any).returnedQuantity ?? 0
            const canReturn = receiptItem.quantity - alreadyReturned

            if (ri.quantity <= 0) {
                res.status(400).json({ success: false, error: `Số lượng trả phải lớn hơn 0 cho ${receiptItem.productName}` }); return
            }
            if (ri.quantity > canReturn) {
                res.status(400).json({
                    success: false,
                    error: `${receiptItem.productName}: chỉ còn ${canReturn} SP có thể trả (đã trả ${alreadyReturned}/${receiptItem.quantity})`
                }); return
            }
        }

        // ── Generate unique batchId for this return session ──────────────────
        const now = new Date()
        const batchId = `RETURN-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).toUpperCase()}`

        // ── All valid — execute updates ───────────────────────────────────────
        for (const ri of returnItems) {
            const receiptItem = receipt.items.find(i => i.productId === ri.productId)!

            // 1. Increment returnedQuantity on the receipt item
            await (prisma as any).importReceiptItem.update({
                where: { id: receiptItem.id },
                data: { returnedQuantity: { increment: ri.quantity } },
            })

            // 2. Decrement product stock (mirror sang kho main của chi nhánh phiếu)
            await adjustSellableStock(prisma, ri.productId, receipt.branchId, -ri.quantity)

            totalReturnCost += receiptItem.costPrice * ri.quantity
            totalReturnQty += ri.quantity

            // 3. Log inventory transaction — note stores batchId for later undo
            await prisma.inventoryTransaction.create({
                data: {
                    type: 'export',
                    productId: ri.productId,
                    productName: receiptItem.productName,
                    productSku: receiptItem.productSku,
                    quantity: -ri.quantity,
                    reason: ri.reason || `Trả hàng nhập theo phiếu ${receipt.code}`,
                    note: batchId,  // ← batch identifier for targeted undo
                    referenceId: receipt.code,
                    referenceType: 'import_return',
                    unitPrice: receiptItem.costPrice,
                    supplierId: receipt.supplierId,
                    supplierName: receipt.supplierName,
                    userId: user.userId || user.id,
                    userName,
                },
            })
        }

        // ── Determine new status based on accumulated returnedQuantity ────────
        // Re-fetch items to get updated returnedQuantity values
        const updatedItems = await (prisma as any).importReceiptItem.findMany({
            where: { receiptId: receipt.id },
        })
        const totalOriginalQty = updatedItems.reduce((s: number, i: any) => s + i.quantity, 0)
        const totalReturnedQty = updatedItems.reduce((s: number, i: any) => s + (i.returnedQuantity ?? 0), 0)
        const isFullReturn = totalReturnedQty >= totalOriginalQty
        const newStatus = isFullReturn ? 'returned' : 'partial_return'

        const updated = await prisma.importReceipt.update({
            where: { id: String(req.params.id) },
            data: { status: newStatus },
            include: { items: true },
        })

        res.json({
            success: true,
            data: {
                ...updated,
                createdAt: updated.createdAt.toISOString(),
                updatedAt: updated.updatedAt.toISOString(),
                returnedQty: totalReturnQty,
                returnedCost: totalReturnCost,
                batchId,
            },
        })
    } catch (err: any) {
        console.error('Return import receipt error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: errorDetail(err) })
    }
})

// GET /api/import-receipts/:id/return-history — List all return batches for a receipt
router.get('/:id/return-history', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true },
        })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }

        // Get all return transactions, grouped by batchId (stored in note field)
        const txns = await prisma.inventoryTransaction.findMany({
            where: { referenceId: receipt.code, referenceType: 'import_return' },
            orderBy: { createdAt: 'asc' },
        })

        // Group by batchId (note field)
        const batchMap = new Map<string, any>()
        for (const txn of txns) {
            const batchId = txn.note || 'LEGACY'
            if (!batchMap.has(batchId)) {
                batchMap.set(batchId, {
                    batchId,
                    createdAt: txn.createdAt.toISOString(),
                    userName: txn.userName,
                    totalQty: 0,
                    totalCost: 0,
                    items: [],
                })
            }
            const batch = batchMap.get(batchId)!
            const qty = Math.abs(txn.quantity)
            batch.totalQty += qty
            batch.totalCost += qty * (txn.unitPrice || 0)
            batch.items.push({
                productId: txn.productId,
                productName: txn.productName,
                productSku: txn.productSku,
                quantity: qty,
                unitPrice: txn.unitPrice || 0,
            })
        }

        res.json({
            success: true,
            data: Array.from(batchMap.values()).reverse(), // newest first
        })
    } catch (err: any) {
        console.error('Return history error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// DELETE /api/import-receipts/:id/return/:batchId — Undo a specific return batch
router.delete('/:id/return/:batchId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const batchId = String(req.params.batchId)

        const receipt = await prisma.importReceipt.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true },
        })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }

        // Find only this batch's transactions (note = batchId)
        const batchTxns = await prisma.inventoryTransaction.findMany({
            where: { referenceId: receipt.code, referenceType: 'import_return', note: batchId },
        })
        if (batchTxns.length === 0) {
            res.status(404).json({ success: false, error: `Không tìm thấy phiếu trả ${batchId}` }); return
        }

        // 1. Restore stock for each product in this batch
        for (const txn of batchTxns) {
            if (!txn.productId) continue
            const returnedQty = Math.abs(txn.quantity)
            await adjustSellableStock(prisma, txn.productId, receipt.branchId, returnedQty)

            // 2. Decrement returnedQuantity on the receipt item
            const receiptItem = receipt.items.find(i => i.productId === txn.productId)
            if (receiptItem) {
                const current = (receiptItem as any).returnedQuantity ?? 0
                await (prisma as any).importReceiptItem.update({
                    where: { id: receiptItem.id },
                    data: { returnedQuantity: Math.max(0, current - returnedQty) },
                })
            }
        }

        // 3. Delete only this batch's transactions
        await prisma.inventoryTransaction.deleteMany({
            where: { referenceId: receipt.code, referenceType: 'import_return', note: batchId },
        })

        // 4. Re-fetch items to recalculate status
        const updatedItems = await (prisma as any).importReceiptItem.findMany({
            where: { receiptId: receipt.id },
        })
        const totalOriginalQty = updatedItems.reduce((s: number, i: any) => s + i.quantity, 0)
        const totalReturnedQty = updatedItems.reduce((s: number, i: any) => s + (i.returnedQuantity ?? 0), 0)

        let newStatus: string
        if (totalReturnedQty <= 0) newStatus = 'completed'
        else if (totalReturnedQty >= totalOriginalQty) newStatus = 'returned'
        else newStatus = 'partial_return'

        const updated = await prisma.importReceipt.update({
            where: { id: String(req.params.id) },
            data: { status: newStatus },
            include: { items: true },
        })

        // Build new returnedQtyMap
        const returnedQtyMap = Object.fromEntries(
            (updated.items || []).map((i: any) => [i.productId, i.returnedQuantity ?? 0])
        )

        res.json({
            success: true,
            message: `Đã hủy phiếu trả ${batchId} thành công`,
            data: {
                ...updated,
                createdAt: updated.createdAt.toISOString(),
                updatedAt: updated.updatedAt.toISOString(),
                returnedQtyMap,
            },
        })
    } catch (err: any) {
        console.error('Undo batch return error:', err?.message || err)
        res.status(500).json({ success: false, error: 'Internal server error', detail: errorDetail(err) })
    }
})

// DELETE /api/import-receipts/:id — delete any receipt, reverse stock if completed

router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const branchId = getBranchId(req)
        const receipt = await prisma.importReceipt.findUnique({
            where: { id: String(req.params.id) },
            include: { items: true },
        })
        if (!receipt) { res.status(404).json({ success: false, error: 'Not found' }); return }

        // ATOMIC (#17): đảo tồn + xóa ledger nhập + xóa phiếu cùng 1 transaction —
        // crash giữa chừng không để tồn/thẻ kho lệch nhau.
        const method = receipt.status === 'completed' ? await getCostPriceMethod(prisma as any) : null
        await prisma.$transaction(async (tx: any) => {
            if (receipt.status === 'completed') {
                for (const item of receipt.items) {
                    const product = await tx.product.findUnique({ where: { id: item.productId } })
                    if (product) {
                        const newStock = Math.max(0, product.stock - item.quantity)
                        let newCostPrice = product.costPrice
                        if (method === 'average' && newStock > 0) {
                            const totalValue = (product.costPrice * product.stock) - (item.costPrice * item.quantity)
                            const recalced = Math.round(totalValue / newStock)
                            newCostPrice = Number.isFinite(recalced) ? Math.max(0, recalced) : product.costPrice
                        }
                        // delta = newStock - product.stock (âm khi thật sự trừ; 0 nếu chạm sàn 0)
                        await adjustSellableStock(tx, item.productId, receipt.branchId, newStock - product.stock)
                        if (newStock > 0 && newCostPrice !== product.costPrice) {
                            await tx.product.update({ where: { id: item.productId }, data: { costPrice: newCostPrice } })
                        }
                    }
                }
                await tx.inventoryTransaction.deleteMany({
                    where: { referenceId: receipt.code, referenceType: 'import_receipt' },
                })
            }
            await tx.importReceipt.delete({ where: { id: String(req.params.id) } }) // cascade xóa items
        }, { timeout: 60000 }) // mặc định 5s không đủ cho phiếu nhiều dòng (hoàn kho từng item) → "Transaction already closed"
        res.json({ success: true, message: 'Deleted' })
    } catch (err: any) {
        console.error('Delete import receipt error:', err?.message || err)
        console.error('Delete import receipt stack:', err?.stack)
        res.status(500).json({ success: false, error: 'Internal server error', detail: errorDetail(err) })
    }
})

export default router
