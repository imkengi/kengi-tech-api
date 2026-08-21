/**
 * ĐỌC FILE EXCEL XUẤT TỪ MISA AMIS (2026-08-21)
 *
 * Vì sao có file này: mảng **mua hàng** và **bán hàng** của MISA KHÔNG có API để kéo về
 * (khác với vật tư/đối tác/tồn kho/công nợ vốn đã có cổng ở `misaSync.ts`). Cách duy nhất
 * lấy dữ liệu là xuất Excel rồi đổ lên.
 *
 * NGUYÊN TẮC — giống hệt `misaSync.ts`, và giống vì đã trả giá để rút ra:
 *
 *  1. **ĐỌC HỎNG ≠ BẰNG 0.** Ô trống, sai định dạng, hàng rác → ghi vào `boQua` KÈM LÝ DO,
 *     tuyệt đối không âm thầm biến thành 0 rồi đem cộng. Cả sự cố mất 2 tỷ ngày 20-21/08
 *     mọc từ đúng một dòng `Number(x) || 0`.
 *  2. **KHAI ĐỘ PHỦ.** Luôn trả `tongDong / docDuoc / boQua` để người đọc biết kết luận đứng
 *     trên bao nhiêu phần dữ liệu. "Không thấy lỗi" mà không nói đã đọc bao nhiêu dòng thì
 *     vô nghĩa.
 *  3. **DÒ CỘT THEO TÊN, KHÔNG THEO VỊ TRÍ.** MISA đổi thứ tự cột giữa các phiên bản/báo cáo.
 *     Bám chỉ số cột là hỏng âm thầm — số nhảy sang cột khác mà vẫn ra một con số trông hợp lệ.
 *  4. **KHÔNG ĐOÁN GIÁ VỐN.** Mẫu đo ngày 21/08: cột `Giá vốn` = 0 ở TOÀN BỘ 805 dòng.
 *     Thiếu giá vốn phải gắn cờ `thieuGiaVon`, không được coi là 0 — nếu không, mọi báo cáo
 *     lãi/lỗ dựng từ đây sẽ cho lãi đúng bằng doanh thu.
 */

/** Một dòng hàng trong sổ chi tiết bán hàng. Tiền: đồng, đã chuẩn hoá về number. */
export interface DongBanHangMisa {
    ngayHachToan: Date | null
    ngayChungTu: Date | null
    soChungTu: string          // BH00394 — khoá gộp thành MỘT chứng từ
    ngayHoaDon: Date | null
    soHoaDon: string           // 00002511
    dienGiai: string
    maKhach: string            // mã đối tượng MISA: khi là MST ("5801411242"), khi là mã tắt ("LTH")
    tenKhach: string
    /** Tên khách lấy từ đâu — để bên đổ biết cái nào chắc, cái nào chỉ là vớt được. */
    nguonTenKhach: 'cot' | 'dienGiai' | 'khong'
    maHang: string             // SKU — khoá nối sang Product của Kengi
    tenHang: string
    dvt: string
    soLuong: number
    donGia: number
    doanhSo: number
    chietKhau: number
    soLuongTra: number
    giaTriTra: number
    giamGia: number
    tkThueGtgt: string
    thueGtgt: number
    giaVon: number | null      // null = MISA KHÔNG xuất giá vốn (đừng đọc thành 0)
    dongSo: number             // số dòng trong file, để chỉ đúng chỗ khi báo lỗi
}

export interface KetQuaDocExcel<T> {
    dong: T[]
    tongDong: number
    dorDuoc?: never
    docDuoc: number
    boQua: Array<{ dong: number; lyDo: string }>
    tieuDeThieu: string[]      // cột bắt buộc không tìm thấy trong file
    kyBaoCao: string           // "Tháng 8 năm 2026" — lấy từ dòng tiêu đề nếu có
}

/* ── Chuẩn hoá ────────────────────────────────────────────────────────────── */

/**
 * Vớt tên khách từ `Diễn giải chung` khi cột `Tên khách hàng` bỏ trống.
 *
 * Đo trên mẫu 21/08: **23/61 chứng từ (38%)** trống CẢ mã lẫn tên khách, nhưng diễn giải vẫn ghi
 * "Bán hàng cho CÔNG TY TNHH …". Đó là khách MISA chưa khai thành đối tượng, kế toán gõ thẳng lên
 * chứng từ. Không vớt thì mất gần bốn phần mười chứng từ — mà mất kiểu im lặng, vì mỗi dòng vẫn
 * đọc ra một bản ghi trông hợp lệ, chỉ khuyết tên.
 */
export function votTenKhach(dienGiai: string): string {
    const s = String(dienGiai || '').trim()
    if (!s) return ''
    const m = s.match(/^\s*(?:bán\s*hàng|xuất\s*bán|bán)\s*(?:cho|:)\s*(.+)$/i)
    return (m?.[1] ?? '').trim()
}

/** Bỏ dấu, gộp khoảng trắng, thường hoá — để so tên cột bất kể MISA viết hoa/có dấu kiểu gì. */
function chuanHoa(s: any): string {
    return String(s ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/gi, 'd')
        .replace(/\s+/g, ' ')
        .trim().toLowerCase()
}

/**
 * Số kiểu MISA: "1,333,333" · "111,111.11" · "12.00" · "(1,234)" = âm · "" = KHÔNG CÓ.
 * Trả `null` khi ô trống hoặc không đọc được — người gọi tự quyết coi là 0 hay là thiếu.
 * KHÔNG bao giờ tự trả 0 cho ô trống.
 */
export function docSo(v: any): number | null {
    if (v === null || v === undefined) return null
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    const s = String(v).trim()
    if (!s) return null
    const am = /^\(.*\)$/.test(s)                       // (1,234) = âm, quy ước kế toán
    const sach = s.replace(/[()]/g, '').replace(/[^0-9.,-]/g, '').replace(/,/g, '')
    if (!sach || sach === '-' || sach === '.') return null
    const n = Number(sach)
    if (!Number.isFinite(n)) return null
    return am ? -n : n
}

/** Ngày kiểu MISA: "01/08/2026" (dd/MM/yyyy). Cũng nhận Date và số serial của Excel. */
export function docNgay(v: any): Date | null {
    if (!v && v !== 0) return null
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
    if (typeof v === 'number') {                        // serial Excel (gốc 1899-12-30)
        const ms = Math.round((v - 25569) * 86400 * 1000)
        const d = new Date(ms)
        return Number.isNaN(d.getTime()) ? null : d
    }
    const s = String(v).trim()
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/)
    if (!m) return null
    // Giờ VN: chốt 00:00 +07 để không bị lùi một ngày khi đổi múi giờ
    const d = new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T00:00:00+07:00`)
    return Number.isNaN(d.getTime()) ? null : d
}

/* ── Dò hàng tiêu đề ──────────────────────────────────────────────────────── */

/** Tên cột chấp nhận được cho từng trường. So sau khi đã bỏ dấu. */
// `dongSo` và `nguonTenKhach` KHÔNG có trong file — chúng do bộ đọc suy ra, nên không nằm ở đây.
const COT_BAN_HANG: Record<keyof Omit<DongBanHangMisa, 'dongSo' | 'nguonTenKhach'>, string[]> = {
    ngayHachToan: ['ngay hach toan'],
    ngayChungTu: ['ngay chung tu'],
    soChungTu: ['so chung tu'],
    ngayHoaDon: ['ngay hoa don'],
    soHoaDon: ['so hoa don'],
    dienGiai: ['dien giai chung', 'dien giai'],
    maKhach: ['ma khach hang', 'ma doi tuong'],
    tenKhach: ['ten khach hang', 'ten doi tuong'],
    maHang: ['ma hang'],
    tenHang: ['ten hang'],
    dvt: ['dvt', 'don vi tinh'],
    soLuong: ['tong so luong ban', 'so luong ban', 'so luong'],
    donGia: ['don gia'],
    doanhSo: ['doanh so ban', 'doanh so', 'thanh tien'],
    chietKhau: ['chiet khau'],
    soLuongTra: ['tong so luong tra lai', 'so luong tra lai'],
    giaTriTra: ['gia tri tra lai'],
    giamGia: ['gia tri giam gia', 'giam gia'],
    tkThueGtgt: ['tk thue gtgt'],
    thueGtgt: ['thue gtgt'],
    giaVon: ['gia von'],
}

/** Cột thiếu là KHÔNG ĐỌC ĐƯỢC FILE, không phải đọc ra 0. */
const BAT_BUOC: Array<keyof typeof COT_BAN_HANG> = ['soChungTu', 'maHang', 'soLuong', 'doanhSo']

/**
 * Tìm hàng tiêu đề trong ~20 hàng đầu (MISA chèn tên báo cáo, kỳ, logo… phía trên).
 * Chọn hàng khớp NHIỀU tên cột nhất — đừng lấy hàng đầu tiên có một chữ trùng.
 */
function timHangTieuDe(rows: any[][]): { chiSo: number; anhXa: Partial<Record<string, number>>; thieu: string[] } {
    let tot = { chiSo: -1, anhXa: {} as Partial<Record<string, number>>, diem: 0 }
    const gioiHan = Math.min(rows.length, 20)
    for (let r = 0; r < gioiHan; r++) {
        const anhXa: Partial<Record<string, number>> = {}
        let diem = 0
        rows[r].forEach((o, c) => {
            const ten = chuanHoa(o)
            if (!ten) return
            for (const [truong, nhan] of Object.entries(COT_BAN_HANG)) {
                if (anhXa[truong] !== undefined) continue
                if (nhan.includes(ten)) { anhXa[truong] = c; diem++; break }
            }
        })
        if (diem > tot.diem) tot = { chiSo: r, anhXa, diem }
    }
    const thieu = BAT_BUOC.filter(t => tot.anhXa[t] === undefined).map(t => COT_BAN_HANG[t][0])
    return { chiSo: tot.chiSo, anhXa: tot.anhXa, thieu }
}

/* ── Đọc sổ chi tiết bán hàng ─────────────────────────────────────────────── */

/**
 * @param rows Mảng hai chiều đã đọc từ sheet (XLSX.utils.sheet_to_json với header:1, raw:false).
 */
export function docSoBanHang(rows: any[][]): KetQuaDocExcel<DongBanHangMisa> {
    const kq: KetQuaDocExcel<DongBanHangMisa> = {
        dong: [], tongDong: 0, docDuoc: 0, boQua: [], tieuDeThieu: [], kyBaoCao: '',
    }
    if (!rows?.length) { kq.tieuDeThieu = ['(file rỗng)']; return kq }

    // Kỳ báo cáo: dòng dạng "Tháng 8 năm 2026" ở phần đầu — chỉ để hiển thị, không dùng để tính.
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
        const t = String(rows[r]?.find((x: any) => /tháng\s*\d/i.test(String(x ?? ''))) ?? '')
        if (t) { kq.kyBaoCao = t.trim(); break }
    }

    const { chiSo, anhXa, thieu } = timHangTieuDe(rows)
    if (chiSo < 0 || thieu.length) {
        // Đoán xem người ta tải nhầm báo cáo nào, để câu báo lỗi nói đúng chuyện thay vì
        // liệt kê tên cột — người bấm không tra cột, họ chỉ muốn biết mình chọn nhầm file.
        const dauFile = chuanHoa(rows.slice(0, 6).flat().join(' '))
        const loai = /so chi tiet mua hang|mua hang/.test(dauFile) ? 'MUA HÀNG'
            : /ton kho|nhap xuat ton/.test(dauFile) ? 'TỒN KHO'
                : /cong no|cong no phai/.test(dauFile) ? 'CÔNG NỢ'
                    : ''
        kq.tieuDeThieu = loai
            ? [`đây là báo cáo ${loai}, cổng này chỉ đọc "Sổ chi tiết bán hàng"`]
            : (thieu.length ? thieu : ['(không tìm thấy hàng tiêu đề)'])
        return kq
    }

    const lay = (r: any[], t: string): any => {
        const c = anhXa[t]
        return c === undefined ? '' : r[c]
    }
    const so0 = (r: any[], t: string): number => docSo(lay(r, t)) ?? 0   // chỉ dùng cho cột PHỤ

    for (let r = chiSo + 1; r < rows.length; r++) {
        const hang = rows[r] || []
        const dongSo = r + 1                                  // 1-based cho khớp Excel
        const soChungTu = String(lay(hang, 'soChungTu') ?? '').trim()
        const maHang = String(lay(hang, 'maHang') ?? '').trim()

        // Hàng trống hoàn toàn: bỏ im lặng, KHÔNG tính vào tổng (Excel luôn thừa hàng cuối)
        if (!hang.some((x: any) => String(x ?? '').trim())) continue
        kq.tongDong++

        // Hàng tổng cộng / rác: không có số chứng từ
        if (!soChungTu) { kq.boQua.push({ dong: dongSo, lyDo: 'không có số chứng từ (có thể là dòng tổng cộng)' }); continue }
        if (!maHang) { kq.boQua.push({ dong: dongSo, lyDo: `chứng từ ${soChungTu}: thiếu mã hàng` }); continue }

        const soLuong = docSo(lay(hang, 'soLuong'))
        const doanhSo = docSo(lay(hang, 'doanhSo'))
        if (soLuong === null) { kq.boQua.push({ dong: dongSo, lyDo: `${soChungTu}/${maHang}: số lượng không đọc được` }); continue }
        if (doanhSo === null) { kq.boQua.push({ dong: dongSo, lyDo: `${soChungTu}/${maHang}: doanh số không đọc được` }); continue }

        const dienGiai = String(lay(hang, 'dienGiai') ?? '').trim()
        const tenCot = String(lay(hang, 'tenKhach') ?? '').trim()
        const tenVot = tenCot ? '' : votTenKhach(dienGiai)

        kq.dong.push({
            ngayHachToan: docNgay(lay(hang, 'ngayHachToan')),
            ngayChungTu: docNgay(lay(hang, 'ngayChungTu')),
            soChungTu,
            ngayHoaDon: docNgay(lay(hang, 'ngayHoaDon')),
            soHoaDon: String(lay(hang, 'soHoaDon') ?? '').trim(),
            dienGiai,
            maKhach: String(lay(hang, 'maKhach') ?? '').trim(),
            tenKhach: tenCot || tenVot,
            nguonTenKhach: tenCot ? 'cot' : (tenVot ? 'dienGiai' : 'khong'),
            maHang,
            tenHang: String(lay(hang, 'tenHang') ?? '').trim(),
            dvt: String(lay(hang, 'dvt') ?? '').trim(),
            soLuong,
            donGia: so0(hang, 'donGia'),
            doanhSo,
            chietKhau: so0(hang, 'chietKhau'),
            soLuongTra: so0(hang, 'soLuongTra'),
            giaTriTra: so0(hang, 'giaTriTra'),
            giamGia: so0(hang, 'giamGia'),
            tkThueGtgt: String(lay(hang, 'tkThueGtgt') ?? '').trim(),
            thueGtgt: so0(hang, 'thueGtgt'),
            // Giá vốn: giữ null khi MISA bỏ trống. KHÔNG đổi thành 0.
            giaVon: docSo(lay(hang, 'giaVon')),
            dongSo,
        })
        kq.docDuoc++
    }
    return kq
}

/* ── Gộp dòng hàng thành chứng từ ─────────────────────────────────────────── */

export interface ChungTuBanHangMisa {
    soChungTu: string
    soHoaDon: string
    ngay: Date | null
    maKhach: string
    tenKhach: string
    nguonTenKhach: 'cot' | 'dienGiai' | 'khong'
    dienGiai: string
    dong: DongBanHangMisa[]
    tongDoanhSo: number
    tongThue: number
    tongChietKhau: number
    tongTra: number
    thieuGiaVon: boolean       // có ít nhất một dòng MISA không xuất giá vốn
}

/** Gộp theo `Số chứng từ` — một chứng từ MISA = một đơn bán nhiều dòng hàng. */
export function gomChungTu(dong: DongBanHangMisa[]): ChungTuBanHangMisa[] {
    const map = new Map<string, ChungTuBanHangMisa>()
    for (const d of dong) {
        let ct = map.get(d.soChungTu)
        if (!ct) {
            ct = {
                soChungTu: d.soChungTu,
                soHoaDon: d.soHoaDon,
                ngay: d.ngayChungTu || d.ngayHachToan || d.ngayHoaDon,
                maKhach: d.maKhach, tenKhach: d.tenKhach, nguonTenKhach: d.nguonTenKhach,
                dienGiai: d.dienGiai,
                dong: [], tongDoanhSo: 0, tongThue: 0, tongChietKhau: 0, tongTra: 0,
                thieuGiaVon: false,
            }
            map.set(d.soChungTu, ct)
        }
        ct.dong.push(d)
        ct.tongDoanhSo += d.doanhSo
        ct.tongThue += d.thueGtgt
        ct.tongChietKhau += d.chietKhau
        ct.tongTra += d.giaTriTra
        // 0 cũng tính là THIẾU, không phải "bán không tốn đồng nào". Đo trên mẫu 21/08: MISA ghi
        // đúng chữ "0" vào ô giá vốn chứ không bỏ trống, nên nếu chỉ bắt `null` thì cờ này TẮT —
        // đúng cái bẫy mà cả bộ đọc này dựng ra để tránh. Giá vốn 0 trong bán lẻ không tồn tại.
        if (d.giaVon === null || d.giaVon === 0) ct.thieuGiaVon = true
        if (!ct.soHoaDon && d.soHoaDon) ct.soHoaDon = d.soHoaDon
        // Dòng đầu có thể khuyết khách mà dòng sau lại có — lấy nguồn chắc nhất trong cả chứng từ
        if (!ct.maKhach && d.maKhach) ct.maKhach = d.maKhach
        if (d.nguonTenKhach === 'cot' && ct.nguonTenKhach !== 'cot') {
            ct.tenKhach = d.tenKhach; ct.nguonTenKhach = 'cot'
        } else if (!ct.tenKhach && d.tenKhach) {
            ct.tenKhach = d.tenKhach; ct.nguonTenKhach = d.nguonTenKhach
        }
    }
    return [...map.values()]
}
