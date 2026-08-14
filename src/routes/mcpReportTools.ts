// ═══════════════════════════════════════════════════════════════════════════════
//  MCP TOOLS — BÁO CÁO TỔNG THỂ / SWOT
//  Một tool gom SẴN mọi nguyên liệu số cho phân tích SWOT (tab AI phân tích
//  trong Báo Cáo, hoặc Claude/agent ngoài nối qua /api/mcp): agent gọi MỘT
//  phát là đủ số để nhận định, khỏi tự cộng trừ từng tool lẻ.
// ═══════════════════════════════════════════════════════════════════════════════

import { Tool, ToolCtx, ToolError } from '../lib/mcpTypes'
import { coHoiTangTruong } from '../lib/growthOpportunity'
import { keHoachDatHang } from '../lib/reorderPlan'

const VN_OFFSET_MS = 7 * 60 * 60 * 1000

/** Đọc khoảng ngày giờ VN — cùng ngữ nghĩa với mcpFinanceTools.khoangNgay. */
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

export const REPORT_TOOLS: Tool[] = [
    {
        name: 'growth_opportunity',
        description:
            'BỐN HƯỚNG CHIẾN LƯỢC tính từ giao dịch thật, dùng khi được hỏi "nên bán sỉ hay lẻ", ' +
            '"nên làm combo gì", "nên dồn vào mặt hàng nào", "mùa nào bán mạnh", hoặc khi cần tư vấn chiến lược có căn cứ:\n' +
            '1) SỈ vs LẺ — tách hai nhóm theo ngưỡng suy từ chính dữ liệu cửa hàng, so doanh thu và BIÊN LÃI từng nhóm;\n' +
            '2) BÁN KÈM — cặp mặt hàng đi cùng nhau nhiều hơn mức ngẫu nhiên (lift), kèm số đơn còn bỏ lỡ và tiềm năng quy ra tiền;\n' +
            '3) TẬP TRUNG — bao nhiêu mã hàng tạo 80% lợi nhuận, chỉ số HHI, mức phụ thuộc vào ít khách lớn;\n' +
            '4) MÙA VỤ — nhịp theo giờ / theo thứ / theo tháng, xu hướng nửa đầu so nửa sau, mặt hàng có tính mùa rõ.\n' +
            'Phần nào thiếu dữ liệu sẽ trả duocKetLuan=false kèm lý do — KHÔNG được diễn giải thành "cửa hàng không có" hay "làm sai".',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Từ ngày, dạng 2026-05-01 (giờ VN). Bỏ trống = 90 ngày gần nhất.' },
                to: { type: 'string', description: 'Đến ngày, dạng 2026-07-31 (giờ VN). Bỏ trống = hôm nay.' },
                tyLeChuyenDoi: { type: 'number', description: 'Giả định bao nhiêu phần khách sẽ mua thêm món kèm khi được gợi ý, 0.01–1. Mặc định 0.15 (thận trọng).' },
                nguongSoLuongSi: { type: 'number', description: 'Mua từ bao nhiêu đơn vị trở lên thì coi là đơn sỉ. Mặc định 10.' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            /* Mặc định 90 ngày chứ không 30: mùa vụ và combo cần đủ mẫu, cửa sổ
             * một tháng gần như luôn trả về "chưa đủ dữ liệu để kết luận". */
            const ky = khoangNgay(a?.from, a?.to, 90)
            return await coHoiTangTruong(prisma, ky, {
                tyLeChuyenDoi: a?.tyLeChuyenDoi !== undefined ? Number(a.tyLeChuyenDoi) : undefined,
                nguongSoLuongSi: a?.nguongSoLuongSi !== undefined ? Number(a.nguongSoLuongSi) : undefined,
            })
        },
    },
    {
        name: 'reorder_plan',
        description:
            'ĐIỂM ĐẶT HÀNG TÍNH TỪ SỨC BÁN THẬT — dùng khi được hỏi "cần nhập hàng gì", "sắp hết hàng nào", ' +
            '"hàng nào đang đọng vốn", "nên đặt bao nhiêu". Khác hẳn ô "tồn tối thiểu" gõ tay: ' +
            'điểm đặt hàng = bán trung bình mỗi ngày × số ngày chờ + tồn an toàn, trong đó tồn an toàn tính theo ' +
            'ĐỘ DAO ĐỘNG của sức bán (mã bán thất thường phải trữ dày hơn mã bán đều dù cùng mức bán trung bình), ' +
            'và số ngày chờ ĐO TỪ lịch sử đặt hàng của chính nhà cung cấp đó. ' +
            'Trả về ba nhóm: đang hết hàng (kèm ước tính lãi mất mỗi ngày), cần đặt ngay (kèm số nên đặt và tiền cần bỏ), ' +
            'và hàng đọng vốn (kèm số vốn đang kẹt). ' +
            'LƯU Ý khi diễn giải: mã có cờ "chua-du-lich-su" là CHƯA ĐỦ DỮ LIỆU để tính, không phải hàng ế. ' +
            'Sức bán đo được ở mã từng hết hàng luôn THẤP HƠN nhu cầu thật.',
        inputSchema: {
            type: 'object',
            properties: {
                soNgayLichSu: { type: 'number', description: 'Cửa sổ đo sức bán, 14–365 ngày. Mặc định 90.' },
                mucPhucVu: { type: 'number', description: 'Muốn bao nhiêu phần lần đặt hàng không bị hụt giữa chừng, 0.8–0.99. Mặc định 0.95. Cao hơn = trữ dày hơn = kẹt vốn nhiều hơn.' },
                soNgayChoMacDinh: { type: 'number', description: 'Số ngày chờ dùng khi chưa đủ lịch sử đặt hàng của nhà cung cấp. Mặc định 7.' },
                chuKyDat: { type: 'number', description: 'Bao lâu đặt hàng một lần, ngày. Mặc định 7.' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            return await keHoachDatHang(prisma, {
                soNgayLichSu: a?.soNgayLichSu !== undefined ? Number(a.soNgayLichSu) : undefined,
                mucPhucVu: a?.mucPhucVu !== undefined ? Number(a.mucPhucVu) : undefined,
                soNgayChoMacDinh: a?.soNgayChoMacDinh !== undefined ? Number(a.soNgayChoMacDinh) : undefined,
                chuKyDat: a?.chuKyDat !== undefined ? Number(a.chuKyDat) : undefined,
                soMaToiDa: 40,
            })
        },
    },
    {
        name: 'swot_data',
        description:
            'NGUYÊN LIỆU PHÂN TÍCH SWOT của cửa hàng theo khoảng ngày, gom sẵn trong một lần gọi: ' +
            'doanh thu + giá vốn + biên lãi, đà nửa đầu/nửa cuối kỳ, khách quay lại, khách chiếm tỉ trọng lớn, ' +
            'tỉ lệ ghi nợ, mã bán chạy sắp hết hàng, mã có người mua nhưng đã hết hàng, vốn nằm trong tồn kho, ' +
            'số mã tồn không bán được (hàng chết), độ tập trung top-10 sản phẩm, cơ cấu thanh toán, ngày trũng/đỉnh. ' +
            'Dùng khi được yêu cầu phân tích SWOT / đánh giá tổng thể / tư vấn chiến lược cửa hàng.',
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
            // Đơn tính SWOT: hoàn thành + ghi nợ một phần (partial cũng là đơn bán thật)
            const TRANG_THAI = ['completed', 'partial']

            const donHang = await prisma.transaction.aggregate({
                where: { status: { in: TRANG_THAI }, createdAt: { gte: tu, lte: den } },
                _count: true, _sum: { total: true },
            })
            const doanhThu = Number(donHang._sum.total) || 0
            const soDon = Number(donHang._count) || 0

            // Giá vốn theo từng dòng — cùng công thức chống-baseQuantity-0 với profit_report
            const cogsRows: any[] = await prisma.$queryRawUnsafe(
                `SELECT COALESCE(SUM(COALESCE(NULLIF(ti."baseQuantity",0), ti.quantity) * COALESCE(p."costPrice",0)),0)::float AS cogs
                 FROM "TransactionItem" ti
                 JOIN "Transaction" t ON t.id = ti."transactionId"
                 JOIN "Product" p ON p.id = ti."productId"
                 WHERE t.status = ANY($3) AND t."createdAt" >= $1 AND t."createdAt" <= $2`,
                tu, den, TRANG_THAI,
            )
            const giaVon = Number(cogsRows?.[0]?.cogs) || 0

            // Đà kỳ: nửa đầu vs nửa cuối
            const giua = new Date((tu.getTime() + den.getTime()) / 2)
            const nuaDau = await prisma.transaction.aggregate({
                where: { status: { in: TRANG_THAI }, createdAt: { gte: tu, lt: giua } }, _sum: { total: true },
            })
            const dtNuaDau = Number(nuaDau._sum.total) || 0
            const dtNuaCuoi = doanhThu - dtNuaDau

            // Khách trong kỳ: tổng số, quay lại (≥2 đơn), khách lớn nhất
            const khachRows: any[] = await prisma.$queryRawUnsafe(
                `SELECT t."customerId" AS id, COALESCE(MAX(c.name),'?') AS ten,
                        COUNT(*)::int AS so_don, COALESCE(SUM(t.total),0)::float AS tieu
                 FROM "Transaction" t LEFT JOIN "Customer" c ON c.id = t."customerId"
                 WHERE t.status = ANY($3) AND t."createdAt" >= $1 AND t."createdAt" <= $2
                   AND t."customerId" IS NOT NULL
                 GROUP BY t."customerId" ORDER BY tieu DESC LIMIT 500`,
                tu, den, TRANG_THAI,
            )
            const soKhach = khachRows.length
            const khachQuayLai = khachRows.filter(k => k.so_don >= 2).length
            const khachNhat = khachRows[0]
                ? { ten: khachRows[0].ten, tieu: Math.round(khachRows[0].tieu), tiTrongPhanTram: doanhThu ? Number((khachRows[0].tieu / doanhThu * 100).toFixed(1)) : 0 }
                : null

            // Ghi nợ
            const soDonNo = await prisma.transaction.count({
                where: { status: 'partial', createdAt: { gte: tu, lte: den } },
            })

            // Bán theo sản phẩm + tồn hiện tại
            const spRows: any[] = await prisma.$queryRawUnsafe(
                `SELECT ti."productId" AS id, COALESCE(MAX(p.name), MAX(ti."productName")) AS ten,
                        COALESCE(MAX(p.stock),0)::float AS ton,
                        SUM(ti.quantity)::float AS sl, COALESCE(SUM(ti."lineTotal"),0)::float AS dt
                 FROM "TransactionItem" ti
                 JOIN "Transaction" t ON t.id = ti."transactionId"
                 LEFT JOIN "Product" p ON p.id = ti."productId"
                 WHERE t.status = ANY($3) AND t."createdAt" >= $1 AND t."createdAt" <= $2
                 GROUP BY ti."productId" ORDER BY dt DESC LIMIT 500`,
                tu, den, TRANG_THAI,
            )
            const sapHet = spRows.filter(r => r.ton > 0 && r.ton <= 5 && r.sl >= 3).map(r => ({ ten: r.ten, ton: r.ton, daBan: r.sl }))
            const daHet = spRows.filter(r => r.ton <= 0).map(r => ({ ten: r.ten, daBan: r.sl, doanhThuKy: Math.round(r.dt) }))
            const top10DoanhThu = spRows.slice(0, 10).reduce((s, r) => s + r.dt, 0)

            // Tồn kho toàn cục: vốn chôn + hàng chết (tồn > 0 mà kỳ này không bán được cái nào)
            const tonRows: any[] = await prisma.$queryRawUnsafe(
                `SELECT COALESCE(SUM(GREATEST(p.stock,0) * COALESCE(p."costPrice",0)),0)::float AS von,
                        COUNT(*) FILTER (WHERE p.stock > 0)::int AS so_ma_con_ton,
                        COUNT(*) FILTER (WHERE p.stock > 0 AND NOT EXISTS (
                            SELECT 1 FROM "TransactionItem" ti JOIN "Transaction" t ON t.id = ti."transactionId"
                            WHERE ti."productId" = p.id AND t.status = ANY($3)
                              AND t."createdAt" >= $1 AND t."createdAt" <= $2))::int AS hang_chet
                 FROM "Product" p`,
                tu, den, TRANG_THAI,
            )
            const vonTon = Number(tonRows?.[0]?.von) || 0
            const hangChet = Number(tonRows?.[0]?.hang_chet) || 0
            const soMaConTon = Number(tonRows?.[0]?.so_ma_con_ton) || 0

            // Cơ cấu thanh toán (bảng Payment gắn đơn)
            const ttRows: any[] = await prisma.$queryRawUnsafe(
                `SELECT pm.type AS loai, COUNT(*)::int AS so_lan, COALESCE(SUM(pm.amount),0)::float AS tien
                 FROM "Payment" pm JOIN "Transaction" t ON t.id = pm."transactionId"
                 WHERE t.status = ANY($3) AND t."createdAt" >= $1 AND t."createdAt" <= $2
                 GROUP BY pm.type`,
                tu, den, TRANG_THAI,
            )

            // Doanh thu theo ngày (giờ VN) → ngày trũng / ngày đỉnh
            const ngayRows: any[] = await prisma.$queryRawUnsafe(
                `SELECT to_char(t."createdAt" + interval '7 hour', 'YYYY-MM-DD') AS ngay,
                        COALESCE(SUM(t.total),0)::float AS dt, COUNT(*)::int AS so_don
                 FROM "Transaction" t
                 WHERE t.status = ANY($3) AND t."createdAt" >= $1 AND t."createdAt" <= $2
                 GROUP BY 1 ORDER BY 1`,
                tu, den, TRANG_THAI,
            )
            let ngayTrung: any = null, ngayDinh: any = null
            for (const r of ngayRows) {
                if (!ngayTrung || r.dt < ngayTrung.dt) ngayTrung = r
                if (!ngayDinh || r.dt > ngayDinh.dt) ngayDinh = r
            }

            const laiGop = doanhThu - giaVon
            return {
                khoang: moTa,
                donHang: { soDon, doanhThu: Math.round(doanhThu), giaVonUocTinh: Math.round(giaVon), laiGop: Math.round(laiGop), bienLaiGopPhanTram: doanhThu ? Number((laiGop / doanhThu * 100).toFixed(1)) : 0 },
                daKy: { nuaDau: Math.round(dtNuaDau), nuaCuoi: Math.round(dtNuaCuoi), thayDoiPhanTram: dtNuaDau ? Number(((dtNuaCuoi - dtNuaDau) / dtNuaDau * 100).toFixed(1)) : null },
                khachHang: { soKhachCoDinhDanh: soKhach, khachQuayLai, tiLeQuayLaiPhanTram: soKhach ? Number((khachQuayLai / soKhach * 100).toFixed(1)) : null, khachLonNhat: khachNhat },
                ghiNo: { soDonNo, tiLePhanTram: soDon ? Number((soDonNo / soDon * 100).toFixed(1)) : null },
                sanPham: {
                    soMaDaBan: spRows.length,
                    top10ChiemPhanTramDoanhThu: doanhThu ? Number((top10DoanhThu / doanhThu * 100).toFixed(1)) : null,
                    banChaySapHet: sapHet.slice(0, 10),
                    coNguoiMuaNhungHetHang: daHet.slice(0, 10),
                },
                tonKho: { vonNamTrongTon: Math.round(vonTon), soMaConTon, soMaTonKhongBanDuoc: hangChet },
                thanhToan: ttRows.map(r => ({ loai: r.loai, soLan: r.so_lan, tien: Math.round(r.tien) })),
                theoNgay: { soNgayCoDon: ngayRows.length, ngayTrung, ngayDinh },
                luuY: 'Giá vốn ước tính theo giá vốn HIỆN TẠI. Số liệu chỉ trong phạm vi hệ thống Kengi — chưa gồm chi phí ngoài (mặt bằng, nhân công), gọi expense_report nếu cần chi phí đã ghi sổ.',
            }
        },
    },
]
