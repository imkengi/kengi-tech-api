/**
 * BẢN GIẢI TRÌNH KHAI BỔ SUNG + TIỀN CHẬM NỘP — hàm thuần, không chạm CSDL.
 *
 * Hệ thống đã lập được tờ khai bổ sung 01/GTGT và so được chênh lệch từng chỉ
 * tiêu. Nhưng còn thiếu đúng hai thứ mà người khai hay quên và bị truy sau:
 *
 *  1. BẢN GIẢI TRÌNH mẫu 01-1/KHBS — nộp kèm tờ khai bổ sung là bắt buộc
 *     (Điều 47 Luật Quản lý thuế 38/2019; Thông tư 80/2021/TT-BTC).
 *  2. TIỀN CHẬM NỘP người khai phải TỰ TÍNH VÀ TỰ NỘP, không chờ cơ quan thuế
 *     ra thông báo: 0,03%/ngày trên số thuế tăng thêm, tính từ ngày kế tiếp
 *     hạn nộp của kỳ gốc (Điều 59 Luật Quản lý thuế 38/2019).
 *
 * Nộp bổ sung mà quên khoản (2) thì vài tháng sau nhận thông báo tiền chậm nộp
 * kèm tiền phạt — đúng cái người ta tưởng đã tránh được khi chủ động khai.
 */

/** Tiền chậm nộp 0,03%/ngày — Điều 59 Luật Quản lý thuế 38/2019 */
export const TY_LE_CHAM_NOP_NGAY = 0.0003

/**
 * Tên chỉ tiêu trên tờ khai 01/GTGT — để bản giải trình đọc được, không phải "ct30".
 *
 * Bảng này PHẢI khớp quy ước của chính hệ thống (xem CHI_TIEU_LABELS ở giao diện
 * và công thức recalcVatTotals ở backend: [29] = [21]+[22]+[23]+[25]+[27] là tổng
 * doanh thu, [30] = [24]+[26]+[28] là tổng thuế bán ra). Bản đầu tiên ở đây tự
 * đặt tên theo trí nhớ và lệch hẳn: [21] bị ghi là hàng MUA VÀO trong khi hệ
 * thống dùng nó cho hàng BÁN RA không chịu thuế. Sai ở đây không dừng ở màn hình
 * — nó in thẳng vào bản giải trình mang đi ký nộp cho cơ quan thuế.
 */
export const TEN_CHI_TIEU: Record<string, string> = {
    ct21: '[21] Hàng hóa, dịch vụ bán ra không chịu thuế GTGT',
    ct22: '[22] Hàng hóa, dịch vụ bán ra chịu thuế suất 0%',
    ct23: '[23] Hàng hóa, dịch vụ chịu thuế suất 5% — giá trị',
    ct24: '[24] Hàng hóa, dịch vụ chịu thuế suất 5% — thuế GTGT',
    ct25: '[25] Hàng hóa, dịch vụ chịu thuế suất 8% — giá trị',
    ct26: '[26] Hàng hóa, dịch vụ chịu thuế suất 8% — thuế GTGT',
    ct27: '[27] Hàng hóa, dịch vụ chịu thuế suất 10% — giá trị',
    ct28: '[28] Hàng hóa, dịch vụ chịu thuế suất 10% — thuế GTGT',
    ct29: '[29] Tổng doanh thu hàng hóa, dịch vụ bán ra',
    ct30: '[30] Tổng số thuế GTGT của hàng hóa, dịch vụ bán ra',
    ct31: '[31] Hàng hóa, dịch vụ mua vào — giá trị',
    ct32: '[32] Hàng hóa, dịch vụ mua vào — thuế GTGT',
    ct33: '[33] Thuế GTGT được khấu trừ kỳ này',
    ct34: '[34] Thuế GTGT khấu trừ kỳ trước chuyển sang',
    ct35: '[35] Thuế GTGT phát sinh trong kỳ',
    ct36: '[36] Điều chỉnh tăng thuế GTGT các kỳ trước',
    ct37: '[37] Điều chỉnh giảm thuế GTGT các kỳ trước',
    ct38: '[38] Thuế GTGT còn phải nộp trong kỳ',
    ct39: '[39] Thuế GTGT còn được khấu trừ chuyển kỳ sau',
    ct40a: '[40a] Thuế GTGT đề nghị hoàn',
    ct40b: '[40b] Thuế GTGT còn được khấu trừ sau hoàn',
}

export interface DongGiaiTrinh {
    chiTieu: string
    ten: string
    soCu: number
    soMoi: number
    chenh: number
    /** Chênh dương với chỉ tiêu thuế phải nộp là bất lợi cho người nộp thuế */
    huong: 'tang' | 'giam'
}

export interface TienChamNop {
    thueTangThem: number
    hanNopGoc: string
    ngayNop: string
    soNgayCham: number
    tyLeNgay: number
    tienChamNop: number
    tongPhaiNop: number
    canCu: string
    ghiChu: string
}

export interface GiaiTrinhKhaiBoSung {
    kyGoc: string
    lanBoSung: number
    lyDo: string
    dong: DongGiaiTrinh[]
    /** Số thuế phải nộp thêm (dương) hoặc được giảm (âm) sau khai bổ sung */
    chenhThuePhaiNop: number
    chamNop: TienChamNop | null
    /** Văn bản soạn sẵn, kế toán sửa lại rồi in ký đóng dấu */
    vanBan: string
    canhBao: string[]
    huongDanNop: string[]
}

const vnd = (v: number) => Math.round(v || 0).toLocaleString('vi-VN')
const r0 = (v: number) => Math.round(v || 0)
const p2 = (n: number) => String(n).padStart(2, '0')

/** Hạn nộp hồ sơ khai thuế của kỳ — Điều 44 Luật Quản lý thuế 38/2019 */
export function hanNopKy(period: string): string {
    const nam = Number(String(period).slice(0, 4))
    if (/^\d{4}-Q[1-4]$/.test(period)) {
        const thang = Number(period.slice(6)) * 3 + 1
        const y = thang > 12 ? nam + 1 : nam
        const m = thang > 12 ? thang - 12 : thang
        return `${y}-${p2(m)}-${p2(new Date(y, m, 0).getDate())}`
    }
    if (/^\d{4}-\d{2}$/.test(period)) {
        const thang = Number(period.slice(5, 7)) + 1
        const y = thang > 12 ? nam + 1 : nam
        const m = thang > 12 ? thang - 12 : thang
        return `${y}-${p2(m)}-20`
    }
    return `${nam + 1}-03-31`
}

/** Chỉ tiêu phản ánh SỐ THUẾ PHẢI NỘP — tăng ở đây mới sinh tiền chậm nộp */
const CHI_TIEU_PHAI_NOP = 'ct38'
const CHI_TIEU_PHAI_NOP_DU_PHONG = 'ct40a'

/**
 * So thue phai nop cua mot to khai.
 *
 * Phep tinh to khai cua he thong dat so phai nop vao [38] va de [40a] = 0 ([40a]
 * la de nghi hoan, he thong khong tu tinh). Doc [40a] la luon ra 0 — nghia la
 * moi phep so sanh "chenh so thue phai nop" deu bang 0, va tien cham nop cung
 * bang 0. Do la con so nguoi dung mang di nop that.
 *
 * Van doc [40a] lam duong lui cho to khai cu nhap tay theo kieu khac.
 */
function soThuePhaiNop(d: Record<string, number>): number {
    const ct38 = r0(d[CHI_TIEU_PHAI_NOP] || 0)
    return ct38 !== 0 ? ct38 : r0(d[CHI_TIEU_PHAI_NOP_DU_PHONG] || 0)
}

export function giaiTrinhKhaiBoSung(
    soCu: Record<string, number>,
    soMoi: Record<string, number>,
    thongTin: {
        kyGoc: string
        lanBoSung: number
        lyDo: string
        tenDonVi?: string
        maSoThue?: string
        /** Ngày dự kiến nộp tiền — mặc định hôm nay; tiền chậm nộp tính tới ngày này */
        ngayNop: string
        /** Đã có quyết định thanh tra/kiểm tra chưa — đổi hẳn hệ quả pháp lý */
        daCoQuyetDinhThanhTra?: boolean
    },
): GiaiTrinhKhaiBoSung {
    const dong: DongGiaiTrinh[] = []
    for (const ma of Object.keys(TEN_CHI_TIEU)) {
        const cu = r0(soCu[ma] || 0)
        const moi = r0(soMoi[ma] || 0)
        if (cu === moi) continue
        dong.push({
            chiTieu: ma,
            ten: TEN_CHI_TIEU[ma],
            soCu: cu,
            soMoi: moi,
            chenh: moi - cu,
            huong: moi > cu ? 'tang' : 'giam',
        })
    }

    const chenhThuePhaiNop = soThuePhaiNop(soMoi) - soThuePhaiNop(soCu)
    const hanGoc = hanNopKy(thongTin.kyGoc)

    let chamNop: TienChamNop | null = null
    if (chenhThuePhaiNop > 0) {
        /* Tính từ NGÀY KẾ TIẾP hạn nộp của kỳ gốc: ngày cuối hạn vẫn là đúng hạn.
         * Nộp trong hạn thì không có ngày chậm nào, không được ra số âm. */
        const moc = new Date(hanGoc + 'T00:00:00.000Z').getTime()
        const nop = new Date(thongTin.ngayNop + 'T00:00:00.000Z').getTime()
        const soNgayCham = Math.max(0, Math.round((nop - moc) / 86400_000))
        chamNop = {
            thueTangThem: chenhThuePhaiNop,
            hanNopGoc: hanGoc,
            ngayNop: thongTin.ngayNop,
            soNgayCham,
            tyLeNgay: TY_LE_CHAM_NOP_NGAY,
            tienChamNop: r0(chenhThuePhaiNop * TY_LE_CHAM_NOP_NGAY * soNgayCham),
            tongPhaiNop: r0(chenhThuePhaiNop + chenhThuePhaiNop * TY_LE_CHAM_NOP_NGAY * soNgayCham),
            canCu: 'Điều 59 Luật Quản lý thuế 38/2019 — 0,03%/ngày trên số tiền thuế chậm nộp',
            ghiChu: soNgayCham === 0
                ? 'Nộp trong hạn của kỳ gốc nên chưa phát sinh tiền chậm nộp.'
                : 'Người nộp thuế TỰ tính và TỰ nộp khoản này cùng lúc với tiền thuế, không chờ cơ quan thuế ra thông báo.',
        }
    }

    const canhBao: string[] = []
    if (thongTin.daCoQuyetDinhThanhTra) {
        canhBao.push('Đã có quyết định thanh tra/kiểm tra: khai bổ sung lúc này KHÔNG còn được coi là tự giác khắc phục, vẫn bị phạt 20% trên số thuế khai thiếu theo Điều 16 NĐ 125/2020.')
    } else if (chenhThuePhaiNop > 0) {
        canhBao.push('Khai bổ sung TRƯỚC khi cơ quan thuế công bố quyết định thanh tra thì chỉ phải nộp thuế thiếu + tiền chậm nộp, không bị phạt 20% khai sai (Điều 16 NĐ 125/2020).')
    }
    if (chenhThuePhaiNop > 0 && chamNop && chamNop.soNgayCham > 0) {
        canhBao.push(`Nhớ nộp cả ${vnd(chamNop.tienChamNop)}đ tiền chậm nộp — rất nhiều trường hợp chỉ nộp tiền thuế rồi vài tháng sau bị truy khoản này.`)
    }
    if (chenhThuePhaiNop < 0) {
        canhBao.push('Khai bổ sung làm GIẢM số thuế phải nộp: khoản nộp thừa được bù trừ vào kỳ sau hoặc làm thủ tục hoàn theo Điều 60 Luật Quản lý thuế — không tự động trả lại.')
    }
    if (dong.length === 0) {
        canhBao.push('Không có chỉ tiêu nào thay đổi — kiểm tra lại số liệu trước khi nộp, tờ khai bổ sung y hệt bản gốc sẽ bị từ chối.')
    }

    const huongDanNop: string[] = chenhThuePhaiNop > 0 ? [
        'Nộp tờ khai bổ sung 01/GTGT kèm Bản giải trình 01-1/KHBS trên thuedientu.gdt.gov.vn.',
        `Lập giấy nộp tiền cho ${vnd(chenhThuePhaiNop)}đ tiền thuế GTGT (tiểu mục 1701).`,
        chamNop && chamNop.tienChamNop > 0
            ? `Lập giấy nộp tiền riêng cho ${vnd(chamNop.tienChamNop)}đ tiền chậm nộp (tiểu mục 4931 — tiền chậm nộp thuế GTGT).`
            : 'Chưa phát sinh tiền chậm nộp nên không cần giấy nộp tiền riêng.',
        'Lưu Thông báo tiếp nhận hồ sơ và chứng từ nộp tiền vào hồ sơ kỳ — đây là bằng chứng đã tự giác khắc phục.',
    ] : [
        'Nộp tờ khai bổ sung 01/GTGT kèm Bản giải trình 01-1/KHBS trên thuedientu.gdt.gov.vn.',
        'Lưu Thông báo tiếp nhận hồ sơ vào hồ sơ kỳ.',
    ]

    // ── Văn bản soạn sẵn ─────────────────────────────────────────────────────
    const bang = dong.length
        ? dong.map(d =>
            `  • ${d.ten}: ${vnd(d.soCu)} → ${vnd(d.soMoi)} (${d.chenh > 0 ? '+' : ''}${vnd(d.chenh)})`
        ).join('\n')
        : '  • (Chưa có chỉ tiêu nào thay đổi)'

    const vanBan = [
        'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
        'Độc lập - Tự do - Hạnh phúc',
        '',
        'BẢN GIẢI TRÌNH KHAI BỔ SUNG',
        '(Mẫu 01-1/KHBS ban hành kèm Thông tư 80/2021/TT-BTC)',
        '',
        `Đơn vị: ${thongTin.tenDonVi || '.....................................'}`,
        `Mã số thuế: ${thongTin.maSoThue || '.....................................'}`,
        `Kỳ tính thuế khai bổ sung: ${thongTin.kyGoc} — lần thứ ${thongTin.lanBoSung}`,
        `Hạn nộp hồ sơ khai thuế của kỳ gốc: ${hanGoc}`,
        '',
        'I. NỘI DUNG KHAI BỔ SUNG',
        bang,
        '',
        'II. LÝ DO KHAI BỔ SUNG',
        `  ${thongTin.lyDo || '(ghi rõ nguyên nhân sai sót)'}`,
        '',
        'III. SỐ THUẾ ĐIỀU CHỈNH',
        chenhThuePhaiNop > 0
            ? `  Số thuế GTGT phải nộp tăng thêm: ${vnd(chenhThuePhaiNop)} đồng.`
            : chenhThuePhaiNop < 0
                ? `  Số thuế GTGT phải nộp giảm: ${vnd(-chenhThuePhaiNop)} đồng.`
                : '  Không làm thay đổi số thuế phải nộp.',
        chamNop && chamNop.tienChamNop > 0
            ? `  Tiền chậm nộp tự tính: ${vnd(chamNop.thueTangThem)} × 0,03%/ngày × ${chamNop.soNgayCham} ngày = ${vnd(chamNop.tienChamNop)} đồng (Điều 59 Luật Quản lý thuế 38/2019).`
            : '',
        chamNop && chamNop.tienChamNop > 0
            ? `  Tổng số tiền nộp: ${vnd(chamNop.tongPhaiNop)} đồng.`
            : '',
        '',
        'Đơn vị cam kết số liệu khai bổ sung trên là đúng và chịu trách nhiệm trước pháp luật.',
        '',
        `..........., ngày ${thongTin.ngayNop.slice(8, 10)} tháng ${thongTin.ngayNop.slice(5, 7)} năm ${thongTin.ngayNop.slice(0, 4)}`,
        'NGƯỜI NỘP THUẾ hoặc ĐẠI DIỆN HỢP PHÁP',
        '(Ký, ghi rõ họ tên, đóng dấu)',
    ].filter(d => d !== '').join('\n')

    return {
        kyGoc: thongTin.kyGoc,
        lanBoSung: thongTin.lanBoSung,
        lyDo: thongTin.lyDo,
        dong,
        chenhThuePhaiNop,
        chamNop,
        vanBan,
        canhBao,
        huongDanNop,
    }
}
