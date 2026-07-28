// ═══════════════════════════════════════════════════════════════════════════════
//  MCP TOOLS — TÀI CHÍNH & MUA HÀNG
//  Những câu chủ shop hỏi hằng ngày mà bộ tool cũ chưa trả lời được:
//  lãi bao nhiêu, chi hết bao nhiêu, còn nợ nhà cung cấp nào, kho nào còn hàng.
// ═══════════════════════════════════════════════════════════════════════════════

import { Tool, ToolCtx, ToolError } from '../lib/mcpTypes'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d)

/**
 * Đọc khoảng ngày. Không truyền → N ngày gần nhất.
 * Ngày hiểu theo GIỜ VN: chuỗi "2026-07-01" là 00:00 giờ VN, không phải UTC —
 * máy chủ chạy UTC nên không quy đổi sẽ lệch 7 tiếng, đơn buổi sáng sớm/tối muộn
 * rơi nhầm ngày.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000
function khoangNgay(from?: string, to?: string, macDinhNgay = 30): { tu: Date; den: Date; moTa: string } {
    let tu: Date, den: Date
    if (from) {
        const t = new Date(`${String(from).slice(0, 10)}T00:00:00+07:00`).getTime()
        if (!Number.isFinite(t)) throw new ToolError(`Ngày bắt đầu "${from}" không đọc được — dùng dạng 2026-07-01`)
        tu = new Date(t)
    } else {
        tu = new Date(Date.now() - macDinhNgay * 86400_000)
    }
    if (to) {
        const t = new Date(`${String(to).slice(0, 10)}T23:59:59+07:00`).getTime()
        if (!Number.isFinite(t)) throw new ToolError(`Ngày kết thúc "${to}" không đọc được — dùng dạng 2026-07-31`)
        den = new Date(t)
    } else {
        den = new Date()
    }
    if (tu > den) throw new ToolError('Ngày bắt đầu phải trước ngày kết thúc')
    const nhan = (d: Date) => new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10)
    return { tu, den, moTa: `${nhan(tu)} → ${nhan(den)} (giờ VN)` }
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export const FINANCE_TOOLS: Tool[] = [
    {
        name: 'profit_report',
        description: 'LỢI NHUẬN theo khoảng ngày: doanh thu, giá vốn hàng bán, lãi gộp, chi phí, lãi ròng. Dùng khi chủ shop hỏi "lãi bao nhiêu", "có lời không". Lưu ý giá vốn là ƯỚC TÍNH theo giá vốn HIỆN TẠI của hàng.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Từ ngày, dạng 2026-07-01 (giờ VN). Bỏ trống = 30 ngày gần nhất.' },
                to: { type: 'string', description: 'Đến ngày, dạng 2026-07-31 (giờ VN). Bỏ trống = hôm nay.' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const { tu, den, moTa } = khoangNgay(a?.from, a?.to, 30)

            const donHang = await prisma.transaction.aggregate({
                where: { status: 'completed', createdAt: { gte: tu, lte: den } },
                _count: true, _sum: { total: true, discount: true },
            })

            // Giá vốn phải tính THEO TỪNG DÒNG, không gộp trước rồi mới nhân:
            // baseQuantity mặc định 0 ở bản ghi cũ, nên SUM(baseQuantity) của một
            // mặt hàng vừa có dòng cũ vừa có dòng mới ra một tổng LAI khác 0 —
            // nhánh dự phòng "|| quantity" không bao giờ chạy và giá vốn hụt nhiều
            // lần (đo thực tế: biên lãi vọt lên 72% trong khi hàng thật chỉ 13-24%).
            // COALESCE(NULLIF(baseQuantity,0), quantity) xử lý đúng từng dòng và
            // vẫn tính đúng hàng bán theo vỉ/lốc (baseQuantity = số đơn vị gốc).
            const cogsRows: any[] = await prisma.$queryRawUnsafe(
                `SELECT
                     COALESCE(SUM(COALESCE(NULLIF(ti."baseQuantity", 0), ti.quantity) * p."costPrice"), 0)::float AS cogs,
                     COALESCE(SUM(CASE WHEN COALESCE(p."costPrice", 0) = 0 THEN ti."lineTotal" ELSE 0 END), 0)::float AS doanhthu_thieu_gv,
                     COUNT(DISTINCT CASE WHEN COALESCE(p."costPrice", 0) = 0 THEN ti."productId" END)::int AS so_mathang_thieu_gv
                 FROM "TransactionItem" ti
                 JOIN "Transaction" t ON t.id = ti."transactionId"
                 JOIN "Product" p ON p.id = ti."productId"
                 WHERE t.status = 'completed' AND t."createdAt" >= $1 AND t."createdAt" <= $2`,
                tu, den,
            )
            const giaVon = Number(cogsRows?.[0]?.cogs) || 0
            const soMatHangThieuGiaVon = Number(cogsRows?.[0]?.so_mathang_thieu_gv) || 0
            const doanhThuThieuGiaVon = Number(cogsRows?.[0]?.doanhthu_thieu_gv) || 0

            const thieu: string[] = soMatHangThieuGiaVon
                ? (await prisma.$queryRawUnsafe(
                    `SELECT DISTINCT p.name
                     FROM "TransactionItem" ti
                     JOIN "Transaction" t ON t.id = ti."transactionId"
                     JOIN "Product" p ON p.id = ti."productId"
                     WHERE t.status = 'completed' AND t."createdAt" >= $1 AND t."createdAt" <= $2
                       AND COALESCE(p."costPrice", 0) = 0
                     LIMIT 10`,
                    tu, den,
                ) as any[]).map(r => r.name)
                : []

            const chiPhi = await prisma.expense.aggregate({
                where: { status: 'active', date: { gte: tu, lte: den } },
                _sum: { amount: true }, _count: true,
            })

            const doanhThu = Number(donHang._sum.total) || 0
            const tongChiPhi = Number(chiPhi._sum.amount) || 0
            const laiGop = doanhThu - giaVon
            const laiRong = laiGop - tongChiPhi

            return {
                khoang: moTa,
                doanhThu,
                soDonHang: donHang._count,
                giaVonUocTinh: Math.round(giaVon),
                laiGop: Math.round(laiGop),
                bienLaiGopPhanTram: doanhThu ? Number(((laiGop / doanhThu) * 100).toFixed(1)) : 0,
                chiPhi: tongChiPhi,
                soKhoanChi: chiPhi._count,
                laiRong: Math.round(laiRong),
                luuY: 'Giá vốn tính theo giá vốn HIỆN TẠI của hàng, không phải giá vốn lúc bán — nếu giá nhập vừa thay đổi thì con số này lệch.',
                canhBaoThieuGiaVon: soMatHangThieuGiaVon
                    ? {
                        soMatHang: soMatHangThieuGiaVon,
                        doanhThuChuaTinhGiaVon: Math.round(doanhThuThieuGiaVon),
                        viDu: thieu,
                        ghiChu: 'Các mặt hàng này CHƯA có giá vốn nên bị loại khỏi phép tính (không tính bằng 0) → lãi thực tế THẤP HƠN số trên. Cập nhật giá vốn để báo cáo đúng.',
                    }
                    : null,
            }
        },
    },
    {
        name: 'expense_report',
        description: 'CHI PHÍ theo khoảng ngày, tách theo nhóm chi và liệt kê khoản lớn nhất. Dùng khi hỏi "tháng này chi hết bao nhiêu", "tiền đi đâu".',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Từ ngày 2026-07-01 (giờ VN). Bỏ trống = 30 ngày gần nhất.' },
                to: { type: 'string', description: 'Đến ngày 2026-07-31 (giờ VN).' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const { tu, den, moTa } = khoangNgay(a?.from, a?.to, 30)
            const dk = { status: 'active', date: { gte: tu, lte: den } }

            const theoNhom = await prisma.expense.groupBy({
                by: ['category'], where: dk, _sum: { amount: true }, _count: true,
            })
            const tong = theoNhom.reduce((s: number, g: any) => s + (Number(g._sum.amount) || 0), 0)
            const lonNhat = await prisma.expense.findMany({
                where: dk, orderBy: { amount: 'desc' }, take: 10,
                select: { description: true, amount: true, category: true, date: true },
            })

            return {
                khoang: moTa,
                tongChi: Math.round(tong),
                theoNhom: theoNhom
                    .map((g: any) => ({
                        nhom: g.category || 'Chưa phân loại',
                        soTien: Math.round(Number(g._sum.amount) || 0),
                        soKhoan: g._count,
                        tyTrongPhanTram: tong ? Number((((Number(g._sum.amount) || 0) / tong) * 100).toFixed(1)) : 0,
                    }))
                    .sort((x: any, y: any) => y.soTien - x.soTien),
                khoanChiLonNhat: lonNhat.map((e: any) => ({
                    noiDung: e.description, soTien: Math.round(e.amount), nhom: e.category, ngay: e.date,
                })),
            }
        },
    },
    {
        name: 'supplier_debt',
        description: 'CÔNG NỢ PHẢI TRẢ NHÀ CUNG CẤP: phiếu nhập chưa trả hết, tổng còn nợ, phiếu quá hạn. Dùng khi hỏi "còn nợ ai", "tới hạn trả tiền chưa".',
        inputSchema: {
            type: 'object',
            properties: {
                only_overdue: { type: 'boolean', description: 'Chỉ lấy phiếu ĐÃ QUÁ HẠN trả (mặc định false)' },
                limit: { type: 'number', description: 'Số phiếu tối đa (mặc định 20, tối đa 100)' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            // paymentStatus mặc định "paid" để phiếu nhập CŨ (trước khi có tracking
            // công nợ) không bị tính thành nợ ảo — chỉ lấy partial/unpaid.
            const dk: any = { paymentStatus: { in: ['partial', 'unpaid'] }, status: { not: 'cancelled' } }
            if (a?.only_overdue) dk.dueDate = { lt: new Date() }

            const phieu = await prisma.importReceipt.findMany({
                where: dk,
                orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
                take: Math.min(num(a?.limit, 20), 100),
                select: {
                    code: true, supplierName: true, totalCost: true, paidAmount: true,
                    paymentStatus: true, dueDate: true, paymentTerm: true, createdAt: true,
                },
            })
            const tatCa = await prisma.importReceipt.aggregate({
                where: { paymentStatus: { in: ['partial', 'unpaid'] }, status: { not: 'cancelled' } },
                _sum: { totalCost: true, paidAmount: true }, _count: true,
            })
            const quaHan = await prisma.importReceipt.aggregate({
                where: { paymentStatus: { in: ['partial', 'unpaid'] }, status: { not: 'cancelled' }, dueDate: { lt: new Date() } },
                _sum: { totalCost: true, paidAmount: true }, _count: true,
            })

            const conNo = (Number(tatCa._sum.totalCost) || 0) - (Number(tatCa._sum.paidAmount) || 0)
            const conNoQuaHan = (Number(quaHan._sum.totalCost) || 0) - (Number(quaHan._sum.paidAmount) || 0)
            const homNay = Date.now()

            return {
                tongConNo: Math.round(conNo),
                soPhieuConNo: tatCa._count,
                conNoQuaHan: Math.round(conNoQuaHan),
                soPhieuQuaHan: quaHan._count,
                danhSach: phieu.map((p: any) => {
                    const conLai = (Number(p.totalCost) || 0) - (Number(p.paidAmount) || 0)
                    const treNgay = p.dueDate ? Math.floor((homNay - new Date(p.dueDate).getTime()) / 86400_000) : null
                    return {
                        maPhieu: p.code,
                        nhaCungCap: p.supplierName || 'Không rõ',
                        tongTien: Math.round(Number(p.totalCost) || 0),
                        daTra: Math.round(Number(p.paidAmount) || 0),
                        conNo: Math.round(conLai),
                        hanTra: p.dueDate,
                        dieuKhoan: p.paymentTerm,
                        tinhTrang: treNgay === null ? 'chưa đặt hạn' : treNgay > 0 ? `QUÁ HẠN ${treNgay} ngày` : `còn ${-treNgay} ngày`,
                        ngayNhap: p.createdAt,
                    }
                }),
                ghiChu: 'Phiếu nhập cũ (trước khi hệ thống theo dõi công nợ) mặc định là ĐÃ TRẢ ĐỦ nên không xuất hiện ở đây.',
            }
        },
    },
    {
        name: 'list_import_receipts',
        description: 'Phiếu NHẬP HÀNG gần đây: mã phiếu, nhà cung cấp, tổng tiền, đã trả, có hoá đơn VAT không. Dùng khi hỏi "tuần này nhập gì", "nhập bao nhiêu tiền hàng".',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Từ ngày 2026-07-01 (giờ VN). Bỏ trống = 30 ngày gần nhất.' },
                to: { type: 'string', description: 'Đến ngày (giờ VN)' },
                limit: { type: 'number', description: 'Số phiếu (mặc định 20, tối đa 100)' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const { tu, den, moTa } = khoangNgay(a?.from, a?.to, 30)
            const dk = { status: { not: 'cancelled' }, createdAt: { gte: tu, lte: den } }
            const [phieu, tong] = await Promise.all([
                prisma.importReceipt.findMany({
                    where: dk, orderBy: { createdAt: 'desc' }, take: Math.min(num(a?.limit, 20), 100),
                    select: {
                        code: true, supplierName: true, totalCost: true, totalItems: true,
                        paidAmount: true, paymentStatus: true, hasVatInvoice: true, createdAt: true, userName: true,
                    },
                }),
                prisma.importReceipt.aggregate({ where: dk, _sum: { totalCost: true }, _count: true }),
            ])
            return {
                khoang: moTa,
                soPhieu: tong._count,
                tongTienNhap: Math.round(Number(tong._sum.totalCost) || 0),
                danhSach: phieu.map((p: any) => ({
                    maPhieu: p.code,
                    nhaCungCap: p.supplierName || 'Không rõ',
                    tongTien: Math.round(Number(p.totalCost) || 0),
                    soMatHang: p.totalItems,
                    daTra: Math.round(Number(p.paidAmount) || 0),
                    thanhToan: p.paymentStatus === 'paid' ? 'đã trả đủ' : p.paymentStatus === 'partial' ? 'trả một phần' : 'chưa trả',
                    coHoaDonVAT: p.hasVatInvoice,
                    nguoiNhap: p.userName,
                    ngay: p.createdAt,
                })),
            }
        },
    },
    {
        name: 'stock_health_check',
        description: 'KIỂM TRA SỨC KHOẺ DỮ LIỆU KHO: hàng bị tồn ÂM, lệch giữa tồn tổng và tồn kho chính, kho bị trùng/thiếu. Gọi khi báo cáo tồn kho ra số vô lý (âm, lệch) hoặc để soát định kỳ. Chỉ ĐỌC, không sửa gì.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Số mặt hàng liệt kê mỗi mục (mặc định 10, tối đa 50)' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const lim = Math.min(num(a?.limit, 10), 50)

            // 1. Hàng tồn ÂM — bán quá số đã nhập, hoặc trừ kho hai lần
            const amRows: any[] = await prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int AS so_mat_hang, COALESCE(SUM(stock),0)::float AS tong_am,
                        COALESCE(SUM(stock * "costPrice"),0)::float AS gia_tri_am
                 FROM "Product" WHERE stock < 0`,
            )
            const amChiTiet: any[] = await prisma.$queryRawUnsafe(
                `SELECT sku, name, stock, "costPrice" FROM "Product" WHERE stock < 0 ORDER BY stock ASC LIMIT ${lim}`,
            )

            // 2. Bất biến: tồn ở (các) kho CHÍNH phải BẰNG Product.stock.
            //    Lệch = POS kiểm tồn theo kho chính sẽ bán khống hoặc chặn nhầm.
            //    PHẢI gộp SUM qua MỌI kho main rồi mới so — join thẳng vào từng kho
            //    sẽ sinh 1 dòng/kho, và khi store có 2 kho chính (trường hợp đang
            //    gặp) thì dòng của kho rỗng luôn "lệch" → thổi phồng con số.
            const lechRows: any[] = await prisma.$queryRawUnsafe(
                `WITH ton_main AS (
                     SELECT p.id, p.sku, p.name, p.stock,
                            -- ::float BẮT BUỘC: SUM(int) của Postgres ra bigint,
                            -- Prisma trả về BigInt và JSON.stringify ném lỗi
                            -- "Do not know how to serialize a BigInt" → tool chết
                            -- ĐÚNG Ở STORE ĐANG CÓ LỆCH (store lệch 0 không lộ ra).
                            COALESCE(SUM(ws.quantity), 0)::float AS ton_kho
                     FROM "Product" p
                     LEFT JOIN "WarehouseStock" ws ON ws."productId" = p.id
                          AND ws."warehouseId" IN (SELECT id FROM "Warehouse" WHERE type = 'main' AND "isActive" = true)
                     WHERE p."productType" = 'goods'
                     GROUP BY p.id, p.sku, p.name, p.stock
                 )
                 SELECT COUNT(*)::int AS so_lech, COALESCE(SUM(ABS(stock - ton_kho)),0)::float AS tong_lech
                 FROM ton_main WHERE stock <> ton_kho`,
            )
            const lechChiTiet: any[] = await prisma.$queryRawUnsafe(
                `WITH ton_main AS (
                     SELECT p.id, p.sku, p.name, p.stock,
                            -- ::float BẮT BUỘC: SUM(int) của Postgres ra bigint,
                            -- Prisma trả về BigInt và JSON.stringify ném lỗi
                            -- "Do not know how to serialize a BigInt" → tool chết
                            -- ĐÚNG Ở STORE ĐANG CÓ LỆCH (store lệch 0 không lộ ra).
                            COALESCE(SUM(ws.quantity), 0)::float AS ton_kho
                     FROM "Product" p
                     LEFT JOIN "WarehouseStock" ws ON ws."productId" = p.id
                          AND ws."warehouseId" IN (SELECT id FROM "Warehouse" WHERE type = 'main' AND "isActive" = true)
                     WHERE p."productType" = 'goods'
                     GROUP BY p.id, p.sku, p.name, p.stock
                 )
                 SELECT sku, name, stock AS ton_tong, ton_kho AS ton_kho_chinh
                 FROM ton_main WHERE stock <> ton_kho
                 ORDER BY ABS(stock - ton_kho) DESC LIMIT ${lim}`,
            )

            // 3. Kho trùng: nhiều kho chính cùng đánh dấu mặc định → resolver kho
            //    có thể trỏ nhầm, hàng nhập vào một kho mà POS đọc kho kia.
            const khoChinh: any[] = await prisma.$queryRawUnsafe(
                `SELECT w.id, w.code, w.name, w."branchId", w."isDefault",
                        COUNT(ws.id)::int AS so_ma_hang,
                        COALESCE(SUM(ws.quantity),0)::float AS tong_sl
                 FROM "Warehouse" w
                 LEFT JOIN "WarehouseStock" ws ON ws."warehouseId" = w.id
                 WHERE w.type = 'main' AND w."isActive" = true
                 GROUP BY w.id, w.code, w.name, w."branchId", w."isDefault"
                 ORDER BY so_ma_hang DESC`,
            )
            // Trùng = NHIỀU kho mặc định TRONG CÙNG MỘT chi nhánh, hoặc kho mặc định
            // mồ côi (branchId=null) tồn tại song song với kho của chi nhánh.
            // KHÔNG phải cứ >1 kho mặc định là sai: store nhiều chi nhánh thì mỗi
            // chi nhánh một kho main mặc định là ĐÚNG (resolver tra theo branchId).
            const macDinh = khoChinh.filter(k => k.isDefault)
            const theoChiNhanh = new Map<string, number>()
            for (const k of macDinh) {
                const key = k.branchId || '(không gắn chi nhánh)'
                theoChiNhanh.set(key, (theoChiNhanh.get(key) || 0) + 1)
            }
            const chiNhanhTrung = [...theoChiNhanh.entries()].filter(([, n]) => n > 1)
            const coMoCoi = macDinh.some(k => !k.branchId)

            const vanDe: string[] = []
            if (Number(amRows[0]?.so_mat_hang) > 0) {
                vanDe.push(`${amRows[0].so_mat_hang} mặt hàng đang TỒN ÂM (tổng ${amRows[0].tong_am}) — bán nhiều hơn số đã nhập vào hệ thống, hoặc bị trừ kho hai lần.`)
            }
            if (Number(lechRows[0]?.so_lech) > 0) {
                vanDe.push(`${lechRows[0].so_lech} mặt hàng LỆCH giữa tồn tổng và tồn kho chính — POS kiểm tồn theo kho chính nên sẽ bán khống hoặc chặn bán nhầm.`)
            }
            if (chiNhanhTrung.length) {
                vanDe.push(`${chiNhanhTrung.length} chi nhánh có NHIỀU HƠN MỘT kho chính mặc định (${chiNhanhTrung.map(([b, n]) => `${b}: ${n} kho`).join(', ')}) — hàng nhập vào một kho nhưng POS/đẩy tồn có thể đọc kho kia.`)
            }
            if (coMoCoi) {
                vanDe.push('Có kho chính mặc định KHÔNG gắn chi nhánh (kho mồ côi từ lúc tạo store) — dọn bằng POST /api/admin/cleanup-orphan-warehouses.')
            }

            return {
                ketLuan: vanDe.length ? 'CÓ VẤN ĐỀ' : 'Dữ liệu kho bình thường',
                vanDe,
                tonAm: {
                    soMatHang: Number(amRows[0]?.so_mat_hang) || 0,
                    tongSoLuongAm: Number(amRows[0]?.tong_am) || 0,
                    giaTriAmTheoVon: Math.round(Number(amRows[0]?.gia_tri_am) || 0),
                    viDu: amChiTiet.map(p => ({ sku: p.sku, ten: p.name, ton: p.stock })),
                },
                lechKhoChinh: {
                    soMatHang: Number(lechRows[0]?.so_lech) || 0,
                    tongDoLech: Number(lechRows[0]?.tong_lech) || 0,
                    viDu: lechChiTiet.map(p => ({ sku: p.sku, ten: p.name, tonTong: p.ton_tong, tonKhoChinh: p.ton_kho_chinh })),
                },
                khoChinh: khoChinh.map(k => ({
                    ma: k.code, ten: k.name, chiNhanh: k.branchId, macDinh: k.isDefault,
                    soMaHang: k.so_ma_hang, tongSoLuong: k.tong_sl,
                })),
                canhBao: 'KHÔNG chạy /api/inventory/reindex để chữa: thẻ kho ở hệ này không đáng tin (import "Tồn đầu kỳ" ghi trùng, POS bán không ghi thẻ kho) — reindex sẽ thổi hoặc xoá sạch tồn. Phải rà nguyên nhân trước.',
            }
        },
    },
    {
        name: 'stock_by_warehouse',
        description: 'TỒN KHO THEO TỪNG KHO (kho chính, kho hàng lỗi, kho bảo hành, xe bán hàng lưu động...). Dùng khi hỏi "kho nào còn hàng", "xe nào còn bao nhiêu".',
        inputSchema: {
            type: 'object',
            properties: {
                product_query: { type: 'string', description: 'Lọc theo tên hoặc SKU một mặt hàng cụ thể. Bỏ trống = tổng hợp toàn bộ kho.' },
                limit: { type: 'number', description: 'Số dòng hàng mỗi kho khi có product_query (mặc định 20)' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const khos = await prisma.warehouse.findMany({
                where: { isActive: true },
                select: { id: true, code: true, name: true, type: true, isDefault: true, branchId: true },
                orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
            })
            if (!khos.length) return { soKho: 0, ghiChu: 'Cửa hàng chưa khai kho nào.' }

            const q = String(a?.product_query || '').trim()
            const loaiKho: Record<string, string> = {
                main: 'kho chính', damaged: 'kho hàng lỗi', warranty: 'kho bảo hành',
                mobile: 'xe bán lưu động', other: 'khác',
            }

            if (!q) {
                // Tổng hợp: mỗi kho bao nhiêu mã, tổng bao nhiêu đơn vị
                const gop = await prisma.warehouseStock.groupBy({
                    by: ['warehouseId'], _sum: { quantity: true }, _count: true,
                })
                const map = new Map(gop.map((g: any) => [g.warehouseId, g]))
                return {
                    soKho: khos.length,
                    khoHang: khos.map((k: any) => {
                        const g: any = map.get(k.id)
                        return {
                            ma: k.code, ten: k.name, loai: loaiKho[k.type] || k.type,
                            khoMacDinh: k.isDefault,
                            soMaHang: g?._count || 0,
                            tongSoLuong: Number(g?._sum.quantity) || 0,
                        }
                    }),
                }
            }

            const sp = await prisma.product.findMany({
                where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }, { barcode: q }] },
                select: { id: true, name: true, sku: true, stock: true },
                take: 20,
            })
            if (!sp.length) throw new ToolError(`Không tìm thấy hàng nào khớp "${q}"`)
            const ton = await prisma.warehouseStock.findMany({
                where: { productId: { in: sp.map((p: any) => p.id) } },
                select: { warehouseId: true, productId: true, quantity: true },
                take: Math.min(num(a?.limit, 20), 100) * khos.length,
            })
            const tenKho = new Map(khos.map((k: any) => [k.id, k]))
            return {
                soMatHang: sp.length,
                matHang: sp.map((p: any) => ({
                    ten: p.name, sku: p.sku, tonTong: p.stock,
                    theoKho: ton
                        .filter((t: any) => t.productId === p.id)
                        .map((t: any) => {
                            const k: any = tenKho.get(t.warehouseId)
                            return { kho: k?.name || t.warehouseId, loai: loaiKho[k?.type] || k?.type, soLuong: t.quantity }
                        })
                        .filter((x: any) => x.soLuong !== 0),
                })),
                ghiChu: 'Tồn tổng của hàng LUÔN bằng tồn ở kho chính — các kho khác (lỗi, bảo hành, xe) tách riêng.',
            }
        },
    },
]
