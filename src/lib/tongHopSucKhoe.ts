/**
 * GOM SỨC KHOẺ NHIỀU CỬA HÀNG THÀNH MỘT BẢNG — dùng cho GET /admin/health-overview.
 *
 * Phần tính toán tách riêng khỏi route để kiểm được: thứ tự xếp và cách đếm là
 * hai chỗ sai im lặng nhất của một màn hình giám sát.
 *
 *   - Xếp sai → cửa hàng đang cháy nằm ở dòng thứ bảy, người quản trị nhìn ba
 *     dòng đầu thấy xanh rồi đóng tab.
 *   - Đếm sai → con số trên thẻ nói "0 cần lo" trong khi có, tức là trấn an sai.
 *
 * QUY ƯỚC XUYÊN SUỐT: "không đọc được" KHÁC "không có vấn đề". Cửa hàng soát
 * hỏng phải nằm TRÊN CÙNG và được đếm riêng — gộp nó vào nhóm ổn là biến một
 * chỗ mù thành một lời trấn an.
 */

export interface HangSucKhoe {
    code: string
    /** Cửa hàng demo: hiện mờ cuối bảng, KHÔNG tính vào "cần lo". */
    laDemo?: boolean
    name: string
    trangThai?: string
    diem?: number
    xepLoai?: string
    soNang?: number
    soVua?: number
    nang?: Array<{ ma: string; ten: string; so: string | null; canLam?: string }>
    vua?: Array<{ ma: string; ten: string; so: string | null }>
    chuaDocDuoc?: number
    loi?: string
}

/**
 * Xếp: cửa hàng KHÔNG SOÁT ĐƯỢC lên đầu (chỗ mù nguy hiểm hơn chỗ đã biết),
 * rồi nhiều lỗi nặng, rồi điểm thấp.
 *
 * `diem ?? 999` cố ý: dòng không có điểm (vì soát hỏng) không được nhờ điểm
 * rỗng mà trồi lên trước dòng có điểm thật — nó đã lên đầu bằng nhánh `loi`.
 */
export function xepCuaHang<T extends HangSucKhoe>(ds: T[]): T[] {
    return [...ds].sort((a, b) =>
        // Demo xuống ĐÁY, bất kể lỗi gì — dữ liệu bịa thì "cháy" cũng không cần lo
        (a.laDemo ? 1 : 0) - (b.laDemo ? 1 : 0) ||
        (b.loi ? 1 : 0) - (a.loi ? 1 : 0) ||
        (b.soNang || 0) - (a.soNang || 0) ||
        (a.diem ?? 999) - (b.diem ?? 999))
}

export interface TomTatSucKhoe {
    soCuaHang: number
    soCanLo: number
    soDocHong: number
    soDemo: number
}

/**
 * `soCanLo` gồm CẢ cửa hàng soát hỏng: không đọc được thì không thể nói là ổn.
 * Đây là chỗ dễ viết nhầm thành `filter(c => c.soNang > 0)` — khi ấy một cửa
 * hàng chết hẳn (soát hỏng, không có soNang) lại được đếm là bình thường.
 */
export function tomTatSucKhoe(ds: HangSucKhoe[]): TomTatSucKhoe {
    /* Demo bị loại khỏi CẢ soCanLo lẫn soDocHong: dữ liệu bịa thì hỏng cũng
     * không phải việc phải lo, và một dòng đỏ demo sẽ dạy người ta bỏ qua
     * dòng đỏ thật. Nhưng vẫn đếm riêng soDemo để không giấu sự tồn tại. */
    return {
        soCuaHang: ds.length,
        soCanLo: ds.filter(c => !c.laDemo && (c.loi || (c.soNang || 0) > 0)).length,
        soDocHong: ds.filter(c => !c.laDemo && c.loi).length,
        soDemo: ds.filter(c => c.laDemo).length,
    }
}
