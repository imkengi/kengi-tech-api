// ─────────────────────────────────────────────────────────────────────────────
//  BÁO CÁO TÀI CHÍNH — MỘT bản tính duy nhất cho B01 / B02 / B03
//
//  Trước 03/09/2026 có BA bản tính song song, và chúng ra ba con số khác nhau:
//    · routes/financialStatements.ts  → màn Kế Toán   (danh sách trắng 22 mã TK)
//    · routes/tax.ts                  → màn Thuế      (gom theo chữ số đầu + số bù)
//    · routes/mcpAccountingTools.ts   → trợ lý AI     (danh sách trắng thứ ba)
//  Cùng một cửa hàng, cùng một ngày, hai màn hình ra hai tổng tài sản — kế toán
//  mất buổi truy nguyên một chênh lệch KHÔNG có trong sổ, nó chỉ do hai công thức
//  gom. Nay cả ba nơi gọi file này; muốn đổi cách tính thì đổi ở ĐÂY.
//
//  Ba nguyên tắc của bản gộp:
//
//  1. KHÔNG BỎ IM LẶNG MÃ NÀO. Bản cũ lọc theo danh sách trắng nên 1381 (hàng
//     thiếu chờ xử lý), 3381, 335, 413… biến mất khỏi báo cáo — hàng đã mất khỏi
//     kho mà giá trị không hiện ở đâu. Nay mọi mã có phát sinh đều được xếp nhóm;
//     mã không thuộc nhóm 1–8 (ví dụ 911 đang treo) đi vào `khongPhanLoai` và
//     được NÓI RA, chứ không rơi mất.
//
//  2. KHÔNG BÙ SỐ ĐỂ BẢNG TỰ CÂN. Bản tax.ts cộng thêm dòng 421 = doanh thu −
//     chi phí, mà bút toán kép thì tổng Nợ luôn bằng tổng Có, nên đẳng thức
//     Tài sản = Nợ + Vốn LUÔN đúng — ô "Cân đối ✓" không phát hiện được gì.
//     Nay tách bạch: `lechTrinhBay` là chênh lệch thật trên mặt báo cáo,
//     `loiNhuanChuaKetChuyen` giải thích nó, và `lechKhongGiaiThichDuoc` mới là
//     con số đáng báo động.
//
//  3. ĐỌC HỎNG ≠ BẰNG 0. Bản cũ `catch { entries = [] }` rồi tính tiếp, nên lỗi
//     đọc sổ hiện ra thành "doanh thu 0đ". Nay trả cờ `docDuoc: false` để nơi gọi
//     nói thật với người dùng.
//
//  Ghi chú vận hành: pool prod mỗi cửa hàng chỉ 1 kết nối nên các truy vấn ở đây
//  chạy TUẦN TỰ — Promise.all chỉ xếp hàng chứ không nhanh hơn, mà lỗi thì khó lần.
// ─────────────────────────────────────────────────────────────────────────────

import { accountName } from './chartOfAccounts'

/* ═══════════════════════════════════════════════════════════════════════════
 *  Đọc sổ
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface DongSo {
    debitAccount: string
    creditAccount: string
    amount: number
    debitAccountName?: string | null
    creditAccountName?: string | null
}

export interface LatSo {
    dong: DongSo[]
    /** false = KHÔNG đọc được sổ. Đừng trình bày như "không có số liệu". */
    docDuoc: boolean
}

const RONG: LatSo = { dong: [], docDuoc: false }

async function docSo(prisma: any, where: any): Promise<LatSo> {
    try {
        const dong = await prisma.journalEntry.findMany({
            where,
            select: {
                debitAccount: true, debitAccountName: true,
                creditAccount: true, creditAccountName: true,
                amount: true,
            },
        })
        return { dong: Array.isArray(dong) ? dong : [], docDuoc: true }
    } catch {
        return RONG
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Cộng theo tài khoản
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Tổng phát sinh một bên của nhóm tài khoản bắt đầu bằng `ma`. */
function ben(dong: DongSo[], ma: string, phia: 'no' | 'co'): number {
    let t = 0
    for (const e of dong) {
        const code = phia === 'no' ? e.debitAccount : e.creditAccount
        if (code && code.startsWith(ma)) t += e.amount || 0
    }
    return t
}

/** Số dư bên Nợ (Nợ − Có) — dùng cho tài sản và chi phí. */
export const duNo = (dong: DongSo[], ma: string) => ben(dong, ma, 'no') - ben(dong, ma, 'co')
/** Số dư bên Có (Có − Nợ) — dùng cho nợ phải trả, vốn và doanh thu. */
export const duCo = (dong: DongSo[], ma: string) => ben(dong, ma, 'co') - ben(dong, ma, 'no')

/**
 * Gộp tài khoản chi tiết về tài khoản cấp 1 để bảng đọc được:
 *   1111 → 111 · 3331 → 333 · 1381 → 138 · 131-SHOPEE → 131
 * Mã ngắn hơn 3 ký tự giữ nguyên (không đoán bừa).
 */
export function gocTK(ma: string): string {
    const s = String(ma || '').trim()
    if (s.length <= 3) return s
    const dau = s.slice(0, 3)
    return /^\d{3}$/.test(dau) ? dau : s
}

type Nhom = 'tsNganHan' | 'tsDaiHan' | 'noPhaiTra' | 'vonChuSoHuu' | 'kqkd' | 'khac'

/** Xếp nhóm theo chữ số đầu của mã tài khoản Việt Nam (TT133/TT200). */
export function nhomTK(ma: string): Nhom {
    const c = String(ma || '').charAt(0)
    if (c === '1') return 'tsNganHan'
    if (c === '2') return 'tsDaiHan'
    if (c === '3') return 'noPhaiTra'
    if (c === '4') return 'vonChuSoHuu'
    if (c === '5' || c === '6' || c === '7' || c === '8') return 'kqkd'
    return 'khac'
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  B01 — Bảng cân đối kế toán
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface DongB01 {
    /** mã tài khoản cấp 1 (111, 131, 331…) */
    ma: string
    ten: string
    /** số dư kỳ này, đã theo bản chất tài khoản (tài sản dư Nợ, nguồn vốn dư Có) */
    kyNay: number
    /** số dư đầu năm; null = không xin so sánh */
    kyTruoc: number | null
}

export interface KetQuaB01 {
    ngay: string
    ngayTruoc: string | null

    taiSanNganHan: DongB01[]
    taiSanDaiHan: DongB01[]
    noPhaiTra: DongB01[]
    vonChuSoHuu: DongB01[]
    /** mã ngoài nhóm 1–8 (911, mã lạ) — hiện ra chứ KHÔNG bỏ */
    khongPhanLoai: DongB01[]

    tongTaiSanNganHan: number
    tongTaiSanDaiHan: number
    tongTaiSan: number
    tongNoPhaiTra: number
    tongVonChuSoHuu: number
    tongNguonVon: number
    tongKhongPhanLoai: number

    tongTaiSanTruoc: number
    tongNoPhaiTraTruoc: number
    tongVonChuSoHuuTruoc: number

    /** lãi/lỗ luỹ kế CHƯA kết chuyển sang 421 (số dư còn lại ở TK 5–8) */
    loiNhuanChuaKetChuyen: number

    /** chênh lệch thấy trên mặt báo cáo: tổng tài sản − tổng nguồn vốn */
    lechTrinhBay: number
    /** phần chênh lệch KHÔNG giải thích được bằng lãi chưa kết chuyển hay TK lạ */
    lechKhongGiaiThichDuoc: number
    /** true khi sổ thật sự cân (đã trừ phần giải thích được) */
    canDoi: boolean
    giaiThichLech: string | null

    docDuoc: boolean
    soDong: number
}

function dungDongB01(
    dong: DongSo[],
    dongTruoc: DongSo[] | null,
    nhomCan: Nhom,
    phia: 'no' | 'co',
): DongB01[] {
    /* Gom theo tài khoản cấp 1 rồi mới cộng — nếu cộng theo prefix trên mã thô,
     * một cửa hàng dùng cả 111 lẫn 1111 sẽ bị đếm hai lần. */
    const ten = new Map<string, string>()
    const maCo = new Set<string>()
    for (const e of dong) {
        for (const [ma, nm] of [
            [e.debitAccount, e.debitAccountName],
            [e.creditAccount, e.creditAccountName],
        ] as const) {
            if (!ma) continue
            const g = gocTK(ma)
            if (nhomTK(g) !== nhomCan) continue
            maCo.add(g)
            if (!ten.has(g)) ten.set(g, accountName(g) || String(nm || '') || g)
        }
    }

    const tinh = (ds: DongSo[], ma: string) => Math.round(phia === 'no' ? duNo(ds, ma) : duCo(ds, ma))

    return Array.from(maCo).sort().map(ma => ({
        ma,
        ten: ten.get(ma) || ma,
        kyNay: tinh(dong, ma),
        kyTruoc: dongTruoc ? tinh(dongTruoc, ma) : null,
    }))
}

export async function tinhB01(
    prisma: any,
    opts: { ngay: string; soSanh?: boolean },
): Promise<KetQuaB01> {
    const ngay = opts.ngay
    const ngayTruoc = opts.soSanh ? `${Number(ngay.slice(0, 4)) - 1}-12-31` : null

    // TUẦN TỰ: pool prod = 1 kết nối
    const nay = await docSo(prisma, { date: { lte: ngay } })
    const truoc = ngayTruoc ? await docSo(prisma, { date: { lte: ngayTruoc } }) : null

    const d = nay.dong
    const dt = truoc ? truoc.dong : null

    const taiSanNganHan = dungDongB01(d, dt, 'tsNganHan', 'no')
    const taiSanDaiHan = dungDongB01(d, dt, 'tsDaiHan', 'no')
    const noPhaiTra = dungDongB01(d, dt, 'noPhaiTra', 'co')
    const vonChuSoHuu = dungDongB01(d, dt, 'vonChuSoHuu', 'co')
    const khongPhanLoai = dungDongB01(d, dt, 'khac', 'no')

    const cong = (rows: DongB01[], k: 'kyNay' | 'kyTruoc') =>
        rows.reduce((s, r) => s + (k === 'kyNay' ? r.kyNay : (r.kyTruoc ?? 0)), 0)

    const tongTaiSanNganHan = cong(taiSanNganHan, 'kyNay')
    const tongTaiSanDaiHan = cong(taiSanDaiHan, 'kyNay')
    const tongTaiSan = tongTaiSanNganHan + tongTaiSanDaiHan
    const tongNoPhaiTra = cong(noPhaiTra, 'kyNay')
    const tongVonChuSoHuu = cong(vonChuSoHuu, 'kyNay')
    const tongKhongPhanLoai = cong(khongPhanLoai, 'kyNay')

    /* Lãi/lỗ chưa kết chuyển: số dư còn nằm ở nhóm 5–8. Sau khi khoá sổ đúng
     * cách thì bằng 0 vì đã đẩy hết sang 421. */
    const loiNhuanChuaKetChuyen = Math.round(
        duCo(d, '5') + duCo(d, '7') - duNo(d, '6') - duNo(d, '8'),
    )

    const tongNguonVon = tongNoPhaiTra + tongVonChuSoHuu
    const lechTrinhBay = tongTaiSan - tongNguonVon
    const lechKhongGiaiThichDuoc = Math.round(
        lechTrinhBay + tongKhongPhanLoai - loiNhuanChuaKetChuyen,
    )
    const canDoi = Math.abs(lechKhongGiaiThichDuoc) < 1

    let giaiThichLech: string | null = null
    if (!nay.docDuoc) {
        giaiThichLech = 'KHÔNG đọc được sổ nhật ký — mọi con số dưới đây chưa dùng được, và số 0 ở đây KHÔNG có nghĩa là không có phát sinh.'
    } else if (Math.abs(lechTrinhBay) < 1) {
        giaiThichLech = null
    } else if (canDoi && Math.abs(loiNhuanChuaKetChuyen) >= 1) {
        const dau = loiNhuanChuaKetChuyen >= 0 ? 'lãi' : 'lỗ'
        giaiThichLech = `Lệch ${Math.abs(lechTrinhBay).toLocaleString('vi-VN')}đ ĐÚNG BẰNG ${dau} trong kỳ chưa kết chuyển sang TK 421 — sổ KHÔNG hỏng, chỉ là chưa khoá sổ. Vào Kế toán → Kết chuyển cuối kỳ để bảng cân.`
    } else if (canDoi && Math.abs(tongKhongPhanLoai) >= 1) {
        giaiThichLech = `Lệch ${Math.abs(lechTrinhBay).toLocaleString('vi-VN')}đ do còn ${Math.abs(tongKhongPhanLoai).toLocaleString('vi-VN')}đ nằm ở tài khoản ngoài nhóm 1–8 (${khongPhanLoai.map(r => r.ma).join(', ')}) — thường là 911 chưa kết chuyển xong.`
    } else {
        giaiThichLech = `Lệch ${Math.abs(lechTrinhBay).toLocaleString('vi-VN')}đ, trong đó ${Math.abs(lechKhongGiaiThichDuoc).toLocaleString('vi-VN')}đ KHÔNG giải thích được bằng lãi chưa kết chuyển hay tài khoản treo. Cần soi lại sổ nhật ký (Kế toán → Đối chiếu sổ sách).`
    }

    return {
        ngay, ngayTruoc,
        taiSanNganHan, taiSanDaiHan, noPhaiTra, vonChuSoHuu, khongPhanLoai,
        tongTaiSanNganHan, tongTaiSanDaiHan, tongTaiSan,
        tongNoPhaiTra, tongVonChuSoHuu, tongNguonVon, tongKhongPhanLoai,
        tongTaiSanTruoc: cong(taiSanNganHan, 'kyTruoc') + cong(taiSanDaiHan, 'kyTruoc'),
        tongNoPhaiTraTruoc: cong(noPhaiTra, 'kyTruoc'),
        tongVonChuSoHuuTruoc: cong(vonChuSoHuu, 'kyTruoc'),
        loiNhuanChuaKetChuyen,
        lechTrinhBay, lechKhongGiaiThichDuoc, canDoi, giaiThichLech,
        docDuoc: nay.docDuoc,
        soDong: d.length,
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  B02 — Báo cáo kết quả hoạt động kinh doanh
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface SoB02 {
    doanhThu: number            // [01] Có 511
    giamTruDoanhThu: number     // [02] Nợ 521
    doanhThuThuan: number       // [10]
    giaVon: number              // [11] Nợ 632
    loiNhuanGop: number         // [20]
    doanhThuTaiChinh: number    // [21] Có 515
    chiPhiTaiChinh: number      // [22] Nợ 635
    chiPhiBanHang: number       // [25] Nợ 641
    chiPhiQuanLy: number        // [26] Nợ 642
    loiNhuanThuan: number       // [30]
    thuNhapKhac: number         // [31] Có 711
    chiPhiKhac: number          // [32] Nợ 811
    loiNhuanKhac: number        // [40]
    loiNhuanTruocThue: number   // [50]
    chiPhiThueTNDN: number      // [51] Nợ 821
    loiNhuanSauThue: number     // [60]
}

export interface KetQuaB02 {
    tu: string
    den: string
    kyNay: SoB02
    kyTruoc: SoB02 | null
    /** Nợ 622 — chi phí nhân công trực tiếp. KHÔNG cộng vào [30] vì lẽ ra nó
     *  phải chạy qua 154 → 632; cộng thẳng là đếm hai lần. Nêu ra để soát. */
    chiPhiNhanCong622: number
    /** VAT đầu ra (Có 3331) — KHÔNG phải chi phí thuế TNDN, để riêng cho rõ */
    vatDauRa: number
    canhBao: string[]
    docDuoc: boolean
}

function tinhSoB02(d: DongSo[]): SoB02 {
    const doanhThu = duCo(d, '511')
    const giamTruDoanhThu = duNo(d, '521')
    const doanhThuThuan = doanhThu - giamTruDoanhThu
    const giaVon = duNo(d, '632')
    const loiNhuanGop = doanhThuThuan - giaVon
    const doanhThuTaiChinh = duCo(d, '515')
    const chiPhiTaiChinh = duNo(d, '635')
    const chiPhiBanHang = duNo(d, '641')
    const chiPhiQuanLy = duNo(d, '642')
    const loiNhuanThuan = loiNhuanGop + doanhThuTaiChinh - chiPhiTaiChinh - chiPhiBanHang - chiPhiQuanLy
    const thuNhapKhac = duCo(d, '711')
    const chiPhiKhac = duNo(d, '811')
    const loiNhuanKhac = thuNhapKhac - chiPhiKhac
    const loiNhuanTruocThue = loiNhuanThuan + loiNhuanKhac
    const chiPhiThueTNDN = duNo(d, '821')
    const loiNhuanSauThue = loiNhuanTruocThue - chiPhiThueTNDN

    const r = Math.round
    return {
        doanhThu: r(doanhThu), giamTruDoanhThu: r(giamTruDoanhThu), doanhThuThuan: r(doanhThuThuan),
        giaVon: r(giaVon), loiNhuanGop: r(loiNhuanGop),
        doanhThuTaiChinh: r(doanhThuTaiChinh), chiPhiTaiChinh: r(chiPhiTaiChinh),
        chiPhiBanHang: r(chiPhiBanHang), chiPhiQuanLy: r(chiPhiQuanLy), loiNhuanThuan: r(loiNhuanThuan),
        thuNhapKhac: r(thuNhapKhac), chiPhiKhac: r(chiPhiKhac), loiNhuanKhac: r(loiNhuanKhac),
        loiNhuanTruocThue: r(loiNhuanTruocThue), chiPhiThueTNDN: r(chiPhiThueTNDN),
        loiNhuanSauThue: r(loiNhuanSauThue),
    }
}

/** Lùi `n` năm trên chuỗi YYYY-MM-DD, giữ nguyên tháng/ngày. */
export function luiNam(ngay: string, n = 1): string {
    const y = Number(ngay.slice(0, 4))
    return `${y - n}${ngay.slice(4)}`
}

export async function tinhB02(
    prisma: any,
    opts: { tu: string; den: string; soSanh?: boolean },
): Promise<KetQuaB02> {
    const nay = await docSo(prisma, { date: { gte: opts.tu, lte: opts.den } })
    const truoc = opts.soSanh
        ? await docSo(prisma, { date: { gte: luiNam(opts.tu), lte: luiNam(opts.den) } })
        : null

    const kyNay = tinhSoB02(nay.dong)
    const chiPhiNhanCong622 = Math.round(duNo(nay.dong, '622'))
    const vatDauRa = Math.round(duCo(nay.dong, '3331'))

    const canhBao: string[] = []
    if (!nay.docDuoc) {
        canhBao.push('KHÔNG đọc được sổ nhật ký — số 0 ở đây không có nghĩa là không phát sinh.')
    }
    if (chiPhiNhanCong622 !== 0) {
        canhBao.push(`Có ${chiPhiNhanCong622.toLocaleString('vi-VN')}đ ghi thẳng vào TK 622 (chi phí nhân công trực tiếp). Số này KHÔNG được cộng vào lợi nhuận thuần vì đúng quy trình nó phải kết chuyển qua 154 → 632; nếu chưa kết chuyển thì giá vốn đang thiếu đúng khoản đó.`)
    }
    if (kyNay.doanhThu > 0 && kyNay.giaVon === 0) {
        canhBao.push('Có doanh thu nhưng giá vốn bằng 0 — lãi gộp đang bị thổi phồng, kiểm tra lại bút toán Nợ 632 / Có 156.')
    }

    return {
        tu: opts.tu, den: opts.den,
        kyNay,
        kyTruoc: truoc ? tinhSoB02(truoc.dong) : null,
        chiPhiNhanCong622, vatDauRa, canhBao,
        docDuoc: nay.docDuoc,
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  B03 — Lưu chuyển tiền tệ (phương pháp trực tiếp)
 * ═══════════════════════════════════════════════════════════════════════════ */

const LA_TIEN = (ma: string) => !!ma && (ma.startsWith('111') || ma.startsWith('112'))

export interface KetQuaB03 {
    tu: string
    den: string
    thuTuBanHang: number       // Có 511/512/131/3331 → tiền
    traNguoiBan: number        // tiền → Nợ 331/152/153/156/611/632/641/642/635 (số âm)
    traNguoiLaoDong: number    // tiền → Nợ 334 (số âm)
    nopThue: number            // tiền → Nợ 333 (số âm)
    khacHDKD: number           // phần còn lại của hoạt động kinh doanh
    thuanHDKD: number
    thuanDauTu: number
    thuanTaiChinh: number
    thuanTrongKy: number
    tienDauKy: number
    tienCuoiKy: number
    /** thuanTrongKy có khớp (tienCuoiKy − tienDauKy) không */
    khopSoDu: boolean
    lechSoDu: number
    canhBao: string[]
    docDuoc: boolean
}

export async function tinhB03(
    prisma: any,
    opts: { tu: string; den: string },
): Promise<KetQuaB03> {
    const trongKy = await docSo(prisma, { date: { gte: opts.tu, lte: opts.den } })
    const truocKy = await docSo(prisma, { date: { lt: opts.tu } })

    let thuTuBanHang = 0, traNguoiBan = 0, traNguoiLaoDong = 0, nopThue = 0
    let khacHDKD = 0, thuanDauTu = 0, thuanTaiChinh = 0

    for (const e of trongKy.dong) {
        const noTien = LA_TIEN(e.debitAccount)
        const coTien = LA_TIEN(e.creditAccount)
        // Chuyển quỹ ↔ ngân hàng không phải dòng tiền của doanh nghiệp
        if (noTien === coTien) continue

        if (noTien) {
            const c = e.creditAccount
            if (c.startsWith('511') || c.startsWith('512') || c.startsWith('131') || c.startsWith('3331')) thuTuBanHang += e.amount
            else if (c.startsWith('341') || c.startsWith('411')) thuanTaiChinh += e.amount
            else if (c.startsWith('2')) thuanDauTu += e.amount
            /* Mọi khoản còn lại PHẢI rơi vào đây, không được bỏ qua: bản cũ ở
             * tax.ts thiếu nhánh cuối nên thu/chi lạ (tạm ứng 141, phải thu khác
             * 138…) rụng khỏi báo cáo, và lưu chuyển thuần không khớp số dư. */
            else khacHDKD += e.amount
        } else {
            const n = e.debitAccount
            if (n.startsWith('334')) traNguoiLaoDong -= e.amount
            else if (n.startsWith('333')) nopThue -= e.amount
            else if (n.startsWith('331') || n.startsWith('152') || n.startsWith('153')
                || n.startsWith('156') || n.startsWith('611') || n.startsWith('632')
                || n.startsWith('641') || n.startsWith('642') || n.startsWith('635')) traNguoiBan -= e.amount
            else if (n.startsWith('2')) thuanDauTu -= e.amount
            else if (n.startsWith('341') || n.startsWith('411')) thuanTaiChinh -= e.amount
            else khacHDKD -= e.amount
        }
    }

    const thuanHDKD = thuTuBanHang + traNguoiBan + traNguoiLaoDong + nopThue + khacHDKD
    const thuanTrongKy = thuanHDKD + thuanDauTu + thuanTaiChinh

    let tienDauKy = 0
    for (const e of truocKy.dong) {
        if (LA_TIEN(e.debitAccount)) tienDauKy += e.amount
        if (LA_TIEN(e.creditAccount)) tienDauKy -= e.amount
    }
    const tienCuoiKy = tienDauKy + thuanTrongKy

    /* Phép thử tự soát: lưu chuyển thuần phải bằng biến động số dư tiền trong kỳ.
     * Lệch nghĩa là có bút toán tiền chưa được xếp nhóm — nói ra, đừng giấu. */
    let bienDongThuc = 0
    for (const e of trongKy.dong) {
        if (LA_TIEN(e.debitAccount)) bienDongThuc += e.amount
        if (LA_TIEN(e.creditAccount)) bienDongThuc -= e.amount
    }
    const lechSoDu = Math.round(thuanTrongKy - bienDongThuc)
    const khopSoDu = Math.abs(lechSoDu) < 1

    const canhBao: string[] = []
    if (!trongKy.docDuoc) canhBao.push('KHÔNG đọc được sổ nhật ký — số 0 ở đây không có nghĩa là không có dòng tiền.')
    if (!khopSoDu) canhBao.push(`Lưu chuyển thuần lệch ${Math.abs(lechSoDu).toLocaleString('vi-VN')}đ so với biến động số dư tiền trong kỳ — có bút toán tiền chưa xếp được nhóm.`)

    const r = Math.round
    return {
        tu: opts.tu, den: opts.den,
        thuTuBanHang: r(thuTuBanHang), traNguoiBan: r(traNguoiBan),
        traNguoiLaoDong: r(traNguoiLaoDong), nopThue: r(nopThue), khacHDKD: r(khacHDKD),
        thuanHDKD: r(thuanHDKD), thuanDauTu: r(thuanDauTu), thuanTaiChinh: r(thuanTaiChinh),
        thuanTrongKy: r(thuanTrongKy), tienDauKy: r(tienDauKy), tienCuoiKy: r(tienCuoiKy),
        khopSoDu, lechSoDu, canhBao,
        docDuoc: trongKy.docDuoc,
    }
}
