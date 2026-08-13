// ═══════════════════════════════════════════════════════════════════════════════
//  MCP TOOLS — TÀI CHÍNH & MUA HÀNG
//  Những câu chủ shop hỏi hằng ngày mà bộ tool cũ chưa trả lời được:
//  lãi bao nhiêu, chi hết bao nhiêu, còn nợ nhà cung cấp nào, kho nào còn hàng.
// ═══════════════════════════════════════════════════════════════════════════════

import { Tool, ToolCtx, ToolError } from '../lib/mcpTypes'
import { kiemTraThue, type KhoangKy } from '../lib/taxAudit'
import { truyVetChungTu } from '../lib/auditPack'
import { moPhongThanhTra } from '../lib/auditDrill'
import { moPhongAnDinh } from '../lib/taxAssessment'
import { lapKeHoachKhacPhuc } from '../lib/remediationPlan'
import { quyetToanTndn, layLaiLoTheoNam, layThueDaTamNop } from '../lib/citAdjustment'

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

/**
 * Dựng kỳ thuế từ tham số tool (year/month/quarter). Mã kỳ phải khớp cách
 * TaxDeclaration.period được lưu, nếu không thì mọi phép đối chiếu tờ khai đều
 * tưởng là "chưa kê khai".
 */
function dungKyThue(a: any): KhoangKy {
    const nay = new Date()
    const year = num(a?.year, nay.getFullYear())
    const month = a?.month ? num(a.month, 0) : 0
    const quarter = a?.quarter ? num(a.quarter, 0) : 0
    const p2 = (n: number) => String(n).padStart(2, '0')

    let from: string, to: string, maKy: string, nhan: string
    if (month >= 1 && month <= 12) {
        const cuoi = new Date(year, month, 0).getDate()
        from = `${year}-${p2(month)}-01`
        to = `${year}-${p2(month)}-${p2(cuoi)}`
        maKy = `${year}-${p2(month)}`
        nhan = `tháng ${month}/${year}`
    } else if (quarter >= 1 && quarter <= 4) {
        const dauThang = (quarter - 1) * 3 + 1
        const cuoiThang = dauThang + 2
        const cuoi = new Date(year, cuoiThang, 0).getDate()
        from = `${year}-${p2(dauThang)}-01`
        to = `${year}-${p2(cuoiThang)}-${p2(cuoi)}`
        maKy = `${year}-Q${quarter}`
        nhan = `quý ${quarter}/${year}`
    } else {
        from = `${year}-01-01`
        to = `${year}-12-31`
        maKy = String(year)
        nhan = `năm ${year}`
    }
    return {
        from, to, maKy, nhan,
        start: new Date(`${from}T00:00:00.000Z`),
        // +7h để lấy trọn ngày cuối theo giờ VN
        end: new Date(new Date(`${to}T23:59:59.999Z`).getTime() + VN_OFFSET_MS),
    }
}

/** Ba tham số kỳ dùng chung cho mọi tool thuế */
const SCHEMA_KY = {
    year: { type: 'number', description: 'Năm cần soát (mặc định năm hiện tại)' },
    month: { type: 'number', description: 'Tháng 1-12; bỏ trống để soát cả năm' },
    quarter: { type: 'number', description: 'Quý 1-4 (dùng thay cho month)' },
} as const

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
        name: 'trace_negative_stock',
        description: 'TRUY NGUYÊN vì sao một mặt hàng bị tồn ÂM: đối chiếu số đã BÁN, số đã NHẬP (phiếu nhập) và thẻ kho, để biết là CHƯA NHẬP hàng vào hệ thống hay bị TRỪ KHO HAI LẦN. Dùng khi stock_health_check báo tồn âm.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Số mặt hàng âm nặng nhất cần soi (mặc định 10, tối đa 30)' },
                sku: { type: 'string', description: 'Soi đúng một mã cụ thể thay vì lấy các mã âm nặng nhất' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const lim = Math.min(num(a?.limit, 10), 30)
            const sku = String(a?.sku || '').trim()

            const dong: any[] = await prisma.$queryRawUnsafe(
                `WITH mh AS (
                     SELECT id, sku, name, stock, "costPrice"
                     FROM "Product"
                     ${sku ? `WHERE sku = $1` : `WHERE stock < 0 ORDER BY stock ASC LIMIT ${lim}`}
                 )
                 SELECT mh.sku, mh.name, mh.stock,
                        -- Đã bán: theo ĐƠN VỊ GỐC (baseQuantity), fallback quantity
                        COALESCE((SELECT SUM(COALESCE(NULLIF(ti."baseQuantity",0), ti.quantity))
                                  FROM "TransactionItem" ti
                                  JOIN "Transaction" t ON t.id = ti."transactionId"
                                  WHERE ti."productId" = mh.id AND t.status = 'completed'), 0)::float AS da_ban,
                        -- Đã nhập qua PHIẾU NHẬP (trừ phần đã trả lại NCC)
                        COALESCE((SELECT SUM(ri.quantity - ri."returnedQuantity")
                                  FROM "ImportReceiptItem" ri
                                  JOIN "ImportReceipt" r ON r.id = ri."receiptId"
                                  WHERE ri."productId" = mh.id AND r.status <> 'cancelled'), 0)::float AS da_nhap_phieu,
                        -- Tổng phát sinh trên THẺ KHO (gồm cả nhập liệu hàng loạt,
                        -- điều chỉnh, tồn đầu kỳ...) — nguồn rộng hơn phiếu nhập
                        COALESCE((SELECT SUM(it.quantity) FROM "InventoryTransaction" it
                                  WHERE it."productId" = mh.id), 0)::float AS the_kho_tong,
                        COALESCE((SELECT COUNT(*) FROM "InventoryTransaction" it
                                  WHERE it."productId" = mh.id), 0)::int AS the_kho_so_dong
                 FROM mh ORDER BY mh.stock ASC`,
                ...(sku ? [sku] : []),
            )
            if (!dong.length) throw new ToolError(sku ? `Không tìm thấy mã "${sku}"` : 'Không có mặt hàng nào tồn âm')

            const ket = dong.map(r => {
                const daBan = Number(r.da_ban) || 0
                const daNhap = Number(r.da_nhap_phieu) || 0
                const ton = Number(r.stock) || 0
                // Nếu CHỈ có bán và nhập qua phiếu thì tồn phải = nhập − bán.
                // Lệch so với con số đó = phần hàng vào/ra bằng đường khác
                // (nhập liệu hàng loạt, điều chỉnh tồn, trả hàng...).
                const duKienNeuChiCoPhieu = daNhap - daBan
                const chenh = ton - duKienNeuChiCoPhieu
                let chanDoan: string
                if (daBan > 0 && daNhap === 0 && Math.abs(chenh) < 1) {
                    chanDoan = 'CHƯA NHẬP hàng này vào hệ thống — bán bao nhiêu âm bấy nhiêu'
                } else if (daBan > 0 && ton <= -daBan * 1.8) {
                    chanDoan = 'NGHI TRỪ KHO HAI LẦN — âm nhiều hơn cả số đã bán'
                } else if (chenh > 0) {
                    chanDoan = `Có ${Math.round(chenh)} đơn vị vào bằng đường khác phiếu nhập (nhập liệu hàng loạt / điều chỉnh) nhưng vẫn không đủ bán`
                } else {
                    chanDoan = 'Nhập ít hơn bán — thiếu tồn đầu kỳ hoặc quên ghi phiếu nhập'
                }
                return {
                    sku: r.sku, ten: r.name, tonHienTai: ton,
                    daBan, daNhapQuaPhieu: daNhap,
                    tonNeuChiTinhPhieuNhap: duKienNeuChiCoPhieu,
                    chenhLechDoDuongKhac: Math.round(chenh),
                    theKhoSoDong: Number(r.the_kho_so_dong) || 0,
                    theKhoTongPhatSinh: Number(r.the_kho_tong) || 0,
                    chanDoan,
                }
            })
            return {
                soMatHang: ket.length,
                matHang: ket,
                cachDoc: 'tonNeuChiTinhPhieuNhap = đã nhập − đã bán. Nếu tồn thật CAO HƠN con số đó thì có hàng vào bằng đường khác (nhập liệu hàng loạt, điều chỉnh tồn). Nếu tồn thật ÂM SÂU HƠN cả số đã bán thì nghi bị trừ kho hai lần.',
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
    {
        name: 'tax_audit_check',
        description: 'KIỂM TRA TRƯỚC THANH TRA THUẾ: đối chiếu ba nguồn doanh thu (sổ kế toán / tờ khai GTGT / hóa đơn điện tử), tìm dấu hiệu bị ấn định thuế và các khoản sẽ bị loại khi quyết toán, kèm ước tính tiền truy thu + phạt + chậm nộp. Gọi khi chủ shop hỏi "sổ sách có vấn đề gì không", "có rủi ro thuế gì", "bị thanh tra thì mất bao nhiêu". CHỈ ĐỌC, không sửa gì.',
        inputSchema: {
            type: 'object',
            properties: { ...SCHEMA_KY },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const h = await kiemTraThue(prisma, dungKyThue(a))

            return {
                ky: h.ky,
                diemSanSang: h.diem,
                xepLoai: h.xepLoai,
                doanhThuBaNguon: h.doanhThu,
                thueGTGT: h.thue,
                uocTinhPhaiNopThem: h.uocTinhPhat,
                soCanhBao: h.canhBao.length,
                canhBao: h.canhBao.map(c => ({
                    mucDo: c.muc,
                    noiDung: c.tieuDe,
                    chiTiet: c.chiTiet,
                    canCu: c.canCu,
                    viecCanLam: c.canLam,
                    tienRuiRo: c.tienRuiRo,
                    viDu: c.viDu,
                })),
                khoanBiLoaiKhiQuyetToan: h.khoanBiLoai,
                ghiChu: 'Soi trên dữ liệu có trong phần mềm, KHÔNG thay thế rà soát của kế toán hay tư vấn thuế. Số ước tính không phải số ấn định của cơ quan thuế.',
            }
        },
    },
    {
        name: 'tax_trace_document',
        description: 'TRUY VẾT MỘT CHỨNG TỪ hết chuỗi giống cách đoàn thanh tra làm: chứng từ gốc → xuất kho → hóa đơn điện tử → bút toán ghi sổ → thu tiền → kỳ kê khai. Nhận số phiếu bán, mã phiếu nhập hoặc số hóa đơn điện tử. Gọi khi chủ shop hỏi "hóa đơn này đi đâu về đâu", "phiếu này đã xuất hóa đơn chưa", "đơn này ghi sổ chưa". CHỈ ĐỌC.',
        inputSchema: {
            type: 'object',
            properties: {
                ma: { type: 'string', description: 'Số phiếu bán (vd HD000123), mã phiếu nhập, hoặc số hóa đơn điện tử' },
            },
            required: ['ma'],
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const ma = String(a?.ma || '').trim()
            if (!ma) throw new ToolError('Cần mã chứng từ để truy vết — số phiếu bán, mã phiếu nhập hoặc số hóa đơn')
            const kq = await truyVetChungTu(prisma, ma)
            return {
                timThay: kq.timThay,
                loaiChungTu: kq.loai,
                tieuDe: kq.tieuDe,
                soMatXichDut: kq.soMocDut,
                cacMoc: kq.moc.map(m => ({
                    buoc: m.buoc, ten: m.ten, trangThai: m.trangThai,
                    chiTiet: m.chiTiet, doanHayHoi: m.cauHoi,
                })),
                diemSeBiHoi: kq.canhBao,
            }
        },
    },
    {
        name: 'tax_audit_drill',
        description: 'MÔ PHỎNG BUỔI LÀM VIỆC VỚI ĐOÀN THANH TRA: trả về những câu đoàn hay hỏi kèm CÂU TRẢ LỜI dựng sẵn từ số liệu thật của kỳ, chứng từ phải chìa ra, và việc cần làm trước. Gọi khi chủ shop hỏi "thanh tra sẽ hỏi gì", "tôi trả lời sao", "cần chuẩn bị giấy tờ gì". CHỈ ĐỌC.',
        inputSchema: {
            type: 'object',
            properties: { ...SCHEMA_KY },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const d = await moPhongThanhTra(prisma, dungKyThue(a))
            return {
                ky: d.ky,
                tiLeTraLoiDuocNgay: d.diemTraLoi,
                soCauSeBiTruy: d.soNguyHiem,
                soCauCanChuanBi: d.soCanChuanBi,
                cauHoi: d.cauHoi.map(c => ({
                    nhom: c.nhom, cauHoi: c.cauHoi, viSaoHoHoi: c.vaSao,
                    traLoiTuSoLieu: c.traLoi, mucDo: c.muc,
                    chungTuPhaiChiaRa: c.chungTu, viecCanLam: c.canLam,
                })),
                nhaCungCapNenTraCuu: d.nhaCungCapCanTraCuu,
                luuY: d.luuY,
            }
        },
    },
    {
        name: 'tax_assessment_risk',
        description: 'MÔ PHỎNG BỊ ẤN ĐỊNH THUẾ (Điều 50 Luật Quản lý thuế): liệt kê căn cứ ấn định đang CÓ THẬT trong dữ liệu kèm cách phản bác từng cái, và ước tính số thuế phải nộp thêm nếu cơ quan thuế bỏ qua sổ sách. Gọi khi chủ shop hỏi "bị ấn định thuế thì mất bao nhiêu", "sổ sách của tôi có bị bác không". CHỈ ĐỌC. Nhắc người dùng đây là ước tính minh họa, không phải số cơ quan thuế sẽ ra.',
        inputSchema: {
            type: 'object',
            properties: {
                ...SCHEMA_KY,
                tySuatLoiNhuan: { type: 'number', description: 'Tỷ suất lợi nhuận ngành dạng thập phân (0.05 = 5%), chỉ dùng cho doanh nghiệp' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const ts = Number(a?.tySuatLoiNhuan)
            const d = await moPhongAnDinh(prisma, dungKyThue(a), {
                tySuatLoiNhuan: Number.isFinite(ts) && ts > 0 && ts <= 1 ? ts : undefined,
            })
            return {
                ky: d.ky,
                nguyCoBiAnDinh: d.nguyCo,
                canCuAnDinhTimThay: d.canCu.map(c => ({
                    dauHieu: c.dauHieu, mucDo: c.muc, dieuKhoan: c.dieuKhoan,
                    hauQua: c.chiTiet, caiLaiTheNao: c.caiThenao,
                })),
                doanhThu: {
                    trenSo: d.doanhThuSo, trenHoaDon: d.doanhThuHoaDon,
                    gocAnDinh: d.doanhThuGocAnDinh,
                },
                thueDaKeKhai: d.thueDaKeKhai,
                kichBan: d.kichBan,
                lamNgay: d.canLamNgay,
                ghiChu: d.ghiChu,
            }
        },
    },
    {
        name: 'tax_remediation_plan',
        description: 'KẾ HOẠCH KHẮC PHỤC TRƯỚC THANH TRA: danh sách việc phải làm theo thứ tự ưu tiên (tiền nhiều + làm nhanh lên trước), kèm hạn chót tính theo hạn nộp tờ khai thật của kỳ và người chịu trách nhiệm. Gọi khi chủ shop hỏi "giờ tôi phải làm gì", "sửa cái nào trước", "còn bao lâu nữa". CHỈ ĐỌC.',
        inputSchema: {
            type: 'object',
            properties: { ...SCHEMA_KY },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const ky = dungKyThue(a)
            const hoSo = await kiemTraThue(prisma, ky)
            const anDinh = await moPhongAnDinh(prisma, ky).catch(() => null)
            // Hôm nay theo giờ VN — lệch múi giờ là sai hạn chót cả ngày
            const homNay = new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10)
            const kh = lapKeHoachKhacPhuc(hoSo, anDinh, ky, homNay)
            return {
                ky: kh.ky,
                tomTat: kh.tomTat,
                hanNopToKhaiCuaKy: kh.hanNopToKhai,
                soViecPhaiLamNgay: kh.soViecLamNgay,
                soViecQuaHan: kh.soViecQuaHan,
                tongTienThueLienQuan: kh.tongTienLoiIch,
                danhSachViec: kh.viec.map(v => ({
                    uuTien: v.uuTien, viec: v.tieuDe, phaiLamGi: v.viecLam, vaSao: v.vaSao,
                    hanChot: v.hanChot, soNgayConLai: v.soNgayConLai, quaHan: v.quaHan,
                    tienLienQuan: v.tienLoiIch, congSuc: v.congSuc, aiLam: v.aiLam, canCu: v.canCu,
                })),
                ghiChu: kh.ghiChu,
            }
        },
    },
    {
        name: 'tax_cit_settlement',
        description: 'QUYẾT TOÁN THUẾ TNDN CÓ ĐIỀU CHỈNH cho một năm: lãi kế toán + chi phí không được trừ − lỗ được chuyển = thu nhập tính thuế, kèm số thuế còn phải nộp và cảnh báo lỗ sắp hết hạn chuyển. Gọi khi chủ shop hỏi "năm nay phải nộp bao nhiêu thuế TNDN", "quyết toán thuế năm ngoái", "lỗ năm trước có được trừ không". CHỈ ĐỌC.',
        inputSchema: {
            type: 'object',
            properties: {
                year: { type: 'number', description: 'Năm quyết toán (mặc định năm hiện tại)' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const nay = new Date()
            const nam = num(a?.year, nay.getFullYear())
            const laiLoTheoNam = await layLaiLoTheoNam(prisma, nam)
            const hoSo = await kiemTraThue(prisma, dungKyThue({ year: nam }))
            const daTamNop = await layThueDaTamNop(prisma, nam)
            const kq = quyetToanTndn({
                nam,
                loiNhuanKeToan: laiLoTheoNam.get(nam) ?? 0,
                khoanBiLoai: hoSo.khoanBiLoai?.dong ?? [],
                laiLoTheoNam,
                daTamNop,
            })
            return {
                nam: kq.nam,
                loiNhuanKeToan: kq.loiNhuanKeToan,
                chiPhiKhongDuocTru: kq.tongDieuChinhTang,
                chiTietKhongDuocTru: kq.dieuChinhTang,
                thuNhapChiuThue: kq.thuNhapChiuThue,
                loDuocChuyen: kq.loChuyen,
                thuNhapTinhThue: kq.thuNhapTinhThue,
                thueTndnPhaiNop: kq.thueTndnPhaiNop,
                daTamNop: kq.daTamNop,
                conPhaiNop: kq.conPhaiNop,
                neuTinhTheoLaiKeToanSeKhaiThieu: kq.chenhSoVoiCachTinhThieu,
                canhBao: kq.canhBao,
                ghiChu: kq.ghiChu,
            }
        },
    },
]
