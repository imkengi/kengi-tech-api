// ═════════════════════════════════════════════════════════════════════════════
//  MCP — SỔ SÁCH KẾ TOÁN (đọc)
//
//  Trước 03/09/2026 agent KHÔNG đọc được sổ sách: hỏi "lãi tháng này bao nhiêu"
//  thì chỉ có profit_report (ước tính từ giá vốn hiện tại), còn sổ cái / cân đối
//  phát sinh / BCTC thì mù hoàn toàn. Nhóm tool này đọc THẲNG JournalEntry —
//  cùng một nguồn với các trang kế toán trên web, nên số liệu khớp nhau.
//
//  Quy ước bút toán trong hệ: mỗi dòng JournalEntry là MỘT cặp Nợ/Có
//  (debitAccount / creditAccount) + amount. Số dư tài khoản = Σ ghi Nợ − Σ ghi
//  Có (tài sản/chi phí) hoặc ngược lại (nguồn vốn/doanh thu).
// ═════════════════════════════════════════════════════════════════════════════

import { Tool, ToolError } from '../lib/mcpTypes'
import { accountName } from '../lib/chartOfAccounts'
import { tinhB01, tinhB02, tinhB03 } from '../lib/baoCaoTaiChinh'

type But = { date: string; description: string; debitAccount: string; creditAccount: string; amount: number; reference?: string | null; debitAccountName?: string | null; creditAccountName?: string | null }

const pad2 = (n: number) => String(n).padStart(2, '0')
const homNay = () => {
    const d = new Date()
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
const dauThang = () => {
    const d = new Date()
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`
}
const ngay = (v: any, mac: string) => (v ? String(v).slice(0, 10) : mac)

/** Đọc bút toán trong khoảng ngày (date là chuỗi 'YYYY-MM-DD' trong schema). */
async function docBut(prisma: any, from: string, to: string, take = 20000): Promise<But[]> {
    return prisma.journalEntry.findMany({
        where: { date: { gte: from, lte: to } },
        select: {
            date: true, description: true, amount: true, reference: true,
            debitAccount: true, creditAccount: true, debitAccountName: true, creditAccountName: true,
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        take,
    }).catch(() => [])
}

const ben = (bs: But[], tienTo: string, phia: 'no' | 'co') =>
    bs.reduce((s, e) => {
        const tk = phia === 'no' ? e.debitAccount : e.creditAccount
        return tk && tk.startsWith(tienTo) ? s + (e.amount || 0) : s
    }, 0)

const duNo = (bs: But[], tk: string) => ben(bs, tk, 'no') - ben(bs, tk, 'co')
const duCo = (bs: But[], tk: string) => ben(bs, tk, 'co') - ben(bs, tk, 'no')

/** Tên TK: ưu tiên tên đã ghi trong bút toán, thiếu thì tra bảng hệ thống. */
const tenTK = (ma: string) => accountName(ma) || ma

export const ACCOUNTING_TOOLS: Tool[] = [
    {
        name: 'accounting_trial_balance',
        description: 'Bảng cân đối số phát sinh: mỗi tài khoản có phát sinh Nợ / phát sinh Có / số dư cuối kỳ. Dùng để trả lời "tài khoản X trong kỳ biến động thế nào" và để kiểm tra sổ có cân không (tổng Nợ phải bằng tổng Có).',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Từ ngày YYYY-MM-DD (mặc định đầu tháng này)' },
                to: { type: 'string', description: 'Đến ngày YYYY-MM-DD (mặc định hôm nay)' },
            },
        },
        run: async (a, { prisma }) => {
            const from = ngay(a.from, dauThang()), to = ngay(a.to, homNay())
            const bs = await docBut(prisma, from, to)
            const map = new Map<string, { no: number; co: number }>()
            for (const e of bs) {
                if (e.debitAccount) {
                    const r = map.get(e.debitAccount) || { no: 0, co: 0 }; r.no += e.amount; map.set(e.debitAccount, r)
                }
                if (e.creditAccount) {
                    const r = map.get(e.creditAccount) || { no: 0, co: 0 }; r.co += e.amount; map.set(e.creditAccount, r)
                }
            }
            const dong = [...map.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([ma, v]) => ({
                taiKhoan: ma,
                tenTaiKhoan: tenTK(ma),
                phatSinhNo: Math.round(v.no),
                phatSinhCo: Math.round(v.co),
                duCuoiKy: Math.round(v.no - v.co),   // dương = dư Nợ, âm = dư Có
            }))
            const tongNo = dong.reduce((s, d) => s + d.phatSinhNo, 0)
            const tongCo = dong.reduce((s, d) => s + d.phatSinhCo, 0)
            return {
                kyBaoCao: { from, to },
                soDongButToan: bs.length,
                taiKhoan: dong,
                tongPhatSinhNo: tongNo,
                tongPhatSinhCo: tongCo,
                canDoi: Math.abs(tongNo - tongCo) < 1,
                ghiChu: 'duCuoiKy > 0 là dư Nợ, < 0 là dư Có. Chỉ tính bút toán trong kỳ (không cộng số dư đầu kỳ trước đó).',
            }
        },
    },
    {
        name: 'accounting_journal',
        description: 'Sổ nhật ký chung: liệt kê từng bút toán Nợ/Có theo thời gian. Dùng khi cần soi "khoản này vào sổ thế nào", hoặc tìm bút toán theo tài khoản / diễn giải.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Từ ngày YYYY-MM-DD (mặc định đầu tháng này)' },
                to: { type: 'string', description: 'Đến ngày YYYY-MM-DD (mặc định hôm nay)' },
                account: { type: 'string', description: 'Chỉ lấy bút toán chạm tài khoản này (vd 111, 131, 632)' },
                search: { type: 'string', description: 'Lọc theo diễn giải hoặc số chứng từ' },
                limit: { type: 'number', description: 'Số dòng tối đa (mặc định 100, tối đa 500)' },
            },
        },
        run: async (a, { prisma }) => {
            const from = ngay(a.from, dauThang()), to = ngay(a.to, homNay())
            let bs = await docBut(prisma, from, to)
            if (a.account) {
                const tk = String(a.account)
                bs = bs.filter(e => e.debitAccount?.startsWith(tk) || e.creditAccount?.startsWith(tk))
            }
            if (a.search) {
                const q = String(a.search).toLowerCase()
                bs = bs.filter(e => (e.description || '').toLowerCase().includes(q) || (e.reference || '').toLowerCase().includes(q))
            }
            const gioiHan = Math.min(Math.max(Number(a.limit) || 100, 1), 500)
            const tong = bs.reduce((s, e) => s + (e.amount || 0), 0)
            return {
                kyBaoCao: { from, to },
                soButToan: bs.length,
                tongTien: Math.round(tong),
                caCat: bs.length > gioiHan ? `Chỉ trả ${gioiHan}/${bs.length} dòng — thu hẹp khoảng ngày hoặc lọc theo account để xem đủ` : null,
                butToan: bs.slice(0, gioiHan).map(e => ({
                    ngay: e.date,
                    dienGiai: e.description,
                    no: `${e.debitAccount} — ${e.debitAccountName || tenTK(e.debitAccount)}`,
                    co: `${e.creditAccount} — ${e.creditAccountName || tenTK(e.creditAccount)}`,
                    soTien: Math.round(e.amount || 0),
                    soChungTu: e.reference || null,
                })),
            }
        },
    },
    {
        name: 'accounting_ledger',
        description: 'Sổ cái MỘT tài khoản: từng phát sinh Nợ/Có kèm tài khoản đối ứng và số dư luỹ kế. Trả lời "tiền mặt trong tháng chi vào những gì", "công nợ 131 phát sinh từ đâu".',
        inputSchema: {
            type: 'object',
            properties: {
                account: { type: 'string', description: 'Mã tài khoản, vd 111, 112, 131, 331, 511, 632' },
                from: { type: 'string', description: 'Từ ngày YYYY-MM-DD (mặc định đầu tháng này)' },
                to: { type: 'string', description: 'Đến ngày YYYY-MM-DD (mặc định hôm nay)' },
                limit: { type: 'number', description: 'Số dòng tối đa (mặc định 100, tối đa 500)' },
            },
            required: ['account'],
        },
        run: async (a, { prisma }) => {
            const tk = String(a.account || '').trim()
            if (!tk) throw new ToolError('Thiếu mã tài khoản')
            const from = ngay(a.from, dauThang()), to = ngay(a.to, homNay())

            // Số dư đầu kỳ = luỹ kế mọi bút toán TRƯỚC ngày bắt đầu
            const truoc: But[] = await prisma.journalEntry.findMany({
                where: { date: { lt: from }, OR: [{ debitAccount: { startsWith: tk } }, { creditAccount: { startsWith: tk } }] },
                select: { debitAccount: true, creditAccount: true, amount: true, date: true, description: true },
                take: 50000,
            }).catch(() => [])
            const duDau = duNo(truoc as But[], tk)

            const bs = (await docBut(prisma, from, to)).filter(e => e.debitAccount?.startsWith(tk) || e.creditAccount?.startsWith(tk))
            const gioiHan = Math.min(Math.max(Number(a.limit) || 100, 1), 500)
            let luyKe = duDau
            const dong = bs.map(e => {
                const laNo = Boolean(e.debitAccount?.startsWith(tk))
                const psNo = laNo ? e.amount : 0
                const psCo = laNo ? 0 : e.amount
                luyKe += psNo - psCo
                return {
                    ngay: e.date,
                    dienGiai: e.description,
                    taiKhoanDoiUng: laNo ? e.creditAccount : e.debitAccount,
                    tenDoiUng: laNo ? (e.creditAccountName || tenTK(e.creditAccount)) : (e.debitAccountName || tenTK(e.debitAccount)),
                    phatSinhNo: Math.round(psNo),
                    phatSinhCo: Math.round(psCo),
                    duLuyKe: Math.round(luyKe),
                    soChungTu: e.reference || null,
                }
            })
            return {
                taiKhoan: tk,
                tenTaiKhoan: tenTK(tk),
                kyBaoCao: { from, to },
                duDauKy: Math.round(duDau),
                tongPhatSinhNo: Math.round(dong.reduce((s, d) => s + d.phatSinhNo, 0)),
                tongPhatSinhCo: Math.round(dong.reduce((s, d) => s + d.phatSinhCo, 0)),
                duCuoiKy: Math.round(luyKe),
                caCat: dong.length > gioiHan ? `Chỉ trả ${gioiHan}/${dong.length} dòng (số dư cuối kỳ vẫn tính trên TOÀN BỘ)` : null,
                phatSinh: dong.slice(0, gioiHan),
                ghiChu: 'Số dương = dư Nợ, âm = dư Có.',
            }
        },
    },
    {
        name: 'accounting_cash_book',
        description: 'Sổ quỹ tiền mặt (TK 111) hoặc sổ tiền gửi ngân hàng (TK 112): thu / chi / tồn quỹ theo từng chứng từ, kèm tài khoản đối ứng.',
        inputSchema: {
            type: 'object',
            properties: {
                loai: { type: 'string', enum: ['tien_mat', 'ngan_hang'], description: 'tien_mat = TK 111 (mặc định), ngan_hang = TK 112' },
                from: { type: 'string', description: 'Từ ngày YYYY-MM-DD (mặc định đầu tháng này)' },
                to: { type: 'string', description: 'Đến ngày YYYY-MM-DD (mặc định hôm nay)' },
                limit: { type: 'number', description: 'Số dòng tối đa (mặc định 100, tối đa 500)' },
            },
        },
        run: async (a, { prisma }) => {
            const tk = a.loai === 'ngan_hang' ? '112' : '111'
            const from = ngay(a.from, dauThang()), to = ngay(a.to, homNay())
            const truoc: But[] = await prisma.journalEntry.findMany({
                where: { date: { lt: from }, OR: [{ debitAccount: { startsWith: tk } }, { creditAccount: { startsWith: tk } }] },
                select: { debitAccount: true, creditAccount: true, amount: true, date: true, description: true },
                take: 50000,
            }).catch(() => [])
            const tonDau = duNo(truoc as But[], tk)

            const bs = (await docBut(prisma, from, to)).filter(e => e.debitAccount?.startsWith(tk) || e.creditAccount?.startsWith(tk))
            let ton = tonDau
            const dong = bs.map(e => {
                const thu = e.debitAccount?.startsWith(tk) ? e.amount : 0
                const chi = e.creditAccount?.startsWith(tk) ? e.amount : 0
                ton += thu - chi
                return {
                    ngay: e.date,
                    soChungTu: e.reference || null,
                    dienGiai: e.description,
                    taiKhoanDoiUng: thu ? e.creditAccount : e.debitAccount,
                    thu: Math.round(thu),
                    chi: Math.round(chi),
                    tonQuy: Math.round(ton),
                }
            })
            const gioiHan = Math.min(Math.max(Number(a.limit) || 100, 1), 500)
            return {
                so: tk === '111' ? 'Sổ quỹ tiền mặt (111)' : 'Sổ tiền gửi ngân hàng (112)',
                kyBaoCao: { from, to },
                tonDauKy: Math.round(tonDau),
                tongThu: Math.round(dong.reduce((s, d) => s + d.thu, 0)),
                tongChi: Math.round(dong.reduce((s, d) => s + d.chi, 0)),
                tonCuoiKy: Math.round(ton),
                caCat: dong.length > gioiHan ? `Chỉ trả ${gioiHan}/${dong.length} dòng (tồn cuối kỳ vẫn tính trên TOÀN BỘ)` : null,
                chungTu: dong.slice(0, gioiHan),
            }
        },
    },
    {
        name: 'accounting_income_statement',
        description: 'Báo cáo kết quả kinh doanh (B02-DNN) từ SỔ SÁCH: doanh thu 511, giá vốn 632, chi phí 641/642, lãi trước/sau thuế. Khác profit_report ở chỗ đây là số ĐÃ VÀO SỔ chứ không phải ước tính theo giá vốn hiện tại. Số liệu giống hệt màn Kế Toán và màn Thuế trên web (dùng chung lib/baoCaoTaiChinh.ts).',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Từ ngày YYYY-MM-DD (mặc định đầu tháng này)' },
                to: { type: 'string', description: 'Đến ngày YYYY-MM-DD (mặc định hôm nay)' },
            },
        },
        run: async (a, { prisma }) => {
            const from = ngay(a.from, dauThang()), to = ngay(a.to, homNay())
            const b = await tinhB02(prisma, { tu: from, den: to })
            const k = b.kyNay
            return {
                kyBaoCao: { from, to },
                nguon: 'JournalEntry (số đã vào sổ)',
                chiTieu: [
                    { ma: '01', ten: 'Doanh thu bán hàng và cung cấp dịch vụ', taiKhoan: '511', ben: 'Có', soTien: k.doanhThu },
                    { ma: '02', ten: 'Các khoản giảm trừ doanh thu', taiKhoan: '521', ben: 'Nợ', soTien: k.giamTruDoanhThu },
                    { ma: '10', ten: 'Doanh thu thuần', taiKhoan: null, ben: null, soTien: k.doanhThuThuan },
                    { ma: '11', ten: 'Giá vốn hàng bán', taiKhoan: '632', ben: 'Nợ', soTien: k.giaVon },
                    { ma: '20', ten: 'Lợi nhuận gộp', taiKhoan: null, ben: null, soTien: k.loiNhuanGop },
                    { ma: '21', ten: 'Doanh thu hoạt động tài chính', taiKhoan: '515', ben: 'Có', soTien: k.doanhThuTaiChinh },
                    { ma: '22', ten: 'Chi phí tài chính', taiKhoan: '635', ben: 'Nợ', soTien: k.chiPhiTaiChinh },
                    { ma: '25', ten: 'Chi phí bán hàng', taiKhoan: '641', ben: 'Nợ', soTien: k.chiPhiBanHang },
                    { ma: '26', ten: 'Chi phí quản lý doanh nghiệp', taiKhoan: '642', ben: 'Nợ', soTien: k.chiPhiQuanLy },
                    { ma: '30', ten: 'Lợi nhuận thuần từ HĐKD', taiKhoan: null, ben: null, soTien: k.loiNhuanThuan },
                    { ma: '31', ten: 'Thu nhập khác', taiKhoan: '711', ben: 'Có', soTien: k.thuNhapKhac },
                    { ma: '32', ten: 'Chi phí khác', taiKhoan: '811', ben: 'Nợ', soTien: k.chiPhiKhac },
                    { ma: '40', ten: 'Lợi nhuận khác', taiKhoan: null, ben: null, soTien: k.loiNhuanKhac },
                    { ma: '50', ten: 'Tổng lợi nhuận kế toán trước thuế', taiKhoan: null, ben: null, soTien: k.loiNhuanTruocThue },
                    { ma: '51', ten: 'Chi phí thuế TNDN', taiKhoan: '821', ben: 'Nợ', soTien: k.chiPhiThueTNDN },
                    { ma: '60', ten: 'Lợi nhuận sau thuế', taiKhoan: null, ben: null, soTien: k.loiNhuanSauThue },
                ],
                vatDauRa: b.vatDauRa,
                chiPhiNhanCong622: b.chiPhiNhanCong622,
                docDuocSo: b.docDuoc,
                canhBao: !b.docDuoc
                    ? ['KHÔNG đọc được sổ nhật ký — số 0 ở đây KHÔNG có nghĩa là không phát sinh. Đừng kết luận gì từ báo cáo này.']
                    : (b.canhBao.length ? b.canhBao : null),
            }
        },
    },
    {
        name: 'accounting_balance_sheet',
        description: 'Bảng cân đối kế toán (B01-DNN) tại một ngày: tài sản (tiền, phải thu, hàng tồn, TSCĐ) và nguồn vốn (phải trả, vốn chủ). Kèm giải thích chênh lệch: lệch đúng bằng lãi chưa kết chuyển là BÌNH THƯỜNG, không phải sổ hỏng. Số liệu giống hệt hai màn hình web.',
        inputSchema: {
            type: 'object',
            properties: { date: { type: 'string', description: 'Ngày chốt YYYY-MM-DD (mặc định hôm nay)' } },
        },
        run: async (a, { prisma }) => {
            const den = ngay(a.date, homNay())
            const b = await tinhB01(prisma, { ngay: den })
            const ra = (r: { ma: string; ten: string; kyNay: number }, ben: string) =>
                ({ taiKhoan: r.ma, ten: r.ten, ben, soTien: r.kyNay })
            return {
                ngayChot: den,
                taiSan: [...b.taiSanNganHan, ...b.taiSanDaiHan].filter(r => r.kyNay !== 0).map(r => ra(r, 'Dư Nợ')),
                tongTaiSan: b.tongTaiSan,
                nguonVon: [...b.noPhaiTra, ...b.vonChuSoHuu].filter(r => r.kyNay !== 0).map(r => ra(r, 'Dư Có')),
                tongNguonVon: b.tongNguonVon,
                taiKhoanNgoaiNhom: b.khongPhanLoai.filter(r => r.kyNay !== 0).map(r => ra(r, 'Dư Nợ')),
                canDoi: b.canDoi,
                lech: b.lechTrinhBay,
                lechKhongGiaiThichDuoc: b.lechKhongGiaiThichDuoc,
                loiNhuanChuaKetChuyen: b.loiNhuanChuaKetChuyen,
                giaiThichLech: b.giaiThichLech,
                docDuocSo: b.docDuoc,
                ghiChu: 'TK 214 (hao mòn) mang dấu âm trong tài sản là ĐÚNG — nó là tài khoản điều chỉnh giảm. Số dư 111 âm là BẤT THƯỜNG (quỹ tiền mặt không thể âm) — thường do thiếu phiếu thu. `canDoi` ở đây đã trừ phần giải thích được, nên canDoi=false mới thật sự là sổ có vấn đề.',
            }
        },
    },
    {
        name: 'accounting_cash_flow',
        description: 'Lưu chuyển tiền tệ (trực tiếp): tiền thực thu từ khách, thực chi cho NCC / lương / thuế, đầu tư, tài chính. Trả lời "tháng này tiền đi đâu hết". Có tự kiểm: lưu chuyển thuần phải khớp biến động số dư tiền.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Từ ngày YYYY-MM-DD (mặc định đầu tháng này)' },
                to: { type: 'string', description: 'Đến ngày YYYY-MM-DD (mặc định hôm nay)' },
            },
        },
        run: async (a, { prisma }) => {
            const from = ngay(a.from, dauThang()), to = ngay(a.to, homNay())
            const b = await tinhB03(prisma, { tu: from, den: to })
            return {
                kyBaoCao: { from, to },
                hoatDongKinhDoanh: {
                    thuTuKhachHang: b.thuTuBanHang,
                    chiTraNhaCungCap: b.traNguoiBan,
                    chiTraNguoiLaoDong: b.traNguoiLaoDong,
                    chiNopThue: b.nopThue,
                    thuChiKhac: b.khacHDKD,
                    luuChuyenThuan: b.thuanHDKD,
                },
                hoatDongDauTu: b.thuanDauTu,
                hoatDongTaiChinh: b.thuanTaiChinh,
                luuChuyenTienThuan: b.thuanTrongKy,
                tienDauKy: b.tienDauKy,
                tienCuoiKy: b.tienCuoiKy,
                khopSoDuTien: b.khopSoDu,
                lechSoDu: b.lechSoDu,
                docDuocSo: b.docDuoc,
                canhBao: b.canhBao.length ? b.canhBao : null,
                ghiChu: 'Số âm = tiền ra. Phân loại theo tài khoản đối ứng của mỗi bút toán tiền. khopSoDuTien=false nghĩa là còn bút toán tiền chưa xếp được nhóm — báo cáo chưa dùng được để kết luận.',
            }
        },
    },
    {
        name: 'accounting_account_balance',
        description: 'Số dư nhanh của MỘT hoặc NHIỀU tài khoản tại một ngày (không kèm chi tiết phát sinh). Dùng khi chỉ cần con số, vd "còn bao nhiêu tiền mặt", "nợ NCC 331 bao nhiêu".',
        inputSchema: {
            type: 'object',
            properties: {
                accounts: { type: 'array', items: { type: 'string' }, description: 'Danh sách mã TK, vd ["111","112","131","331"]' },
                date: { type: 'string', description: 'Ngày chốt YYYY-MM-DD (mặc định hôm nay)' },
            },
            required: ['accounts'],
        },
        run: async (a, { prisma }) => {
            const ds: string[] = Array.isArray(a.accounts) ? a.accounts.map((x: any) => String(x)) : []
            if (!ds.length) throw new ToolError('Truyền ít nhất một mã tài khoản trong accounts')
            const den = ngay(a.date, homNay())
            const bs: But[] = await prisma.journalEntry.findMany({
                where: { date: { lte: den } },
                select: { debitAccount: true, creditAccount: true, amount: true, date: true, description: true },
                take: 100000,
            }).catch(() => [])
            return {
                ngayChot: den,
                soDu: ds.map(m => {
                    const no = duNo(bs, m)
                    return {
                        taiKhoan: m,
                        ten: tenTK(m),
                        duNo: no > 0 ? Math.round(no) : 0,
                        duCo: no < 0 ? Math.round(-no) : 0,
                    }
                }),
            }
        },
    },
    {
        name: 'accounting_chart_of_accounts',
        description: 'Hệ thống tài khoản của store (danh mục TK đang dùng + tên). Gọi khi cần biết mã tài khoản nào tồn tại trước khi tra sổ.',
        inputSchema: {
            type: 'object',
            properties: { search: { type: 'string', description: 'Lọc theo mã hoặc tên tài khoản' } },
        },
        run: async (a, { prisma }) => {
            const ds = await prisma.chartOfAccount.findMany({
                where: { isActive: true },
                select: { code: true, name: true, type: true, nature: true, parentCode: true, level: true },
                orderBy: { code: 'asc' },
                take: 1000,
            }).catch(() => [])
            const q = String(a.search || '').toLowerCase()
            const loc = q ? ds.filter((r: any) => String(r.code).includes(q) || String(r.name).toLowerCase().includes(q)) : ds
            return {
                soTaiKhoan: loc.length,
                taiKhoan: loc,
                ghiChu: ds.length === 0 ? 'Store chưa gieo hệ thống tài khoản — gọi trang Kế toán → Hệ thống tài khoản để khởi tạo.' : null,
            }
        },
    },
]
