/**
 * MỐC THỜI GIAN THEO GIỜ VIỆT NAM (UTC+7).
 *
 * Máy chủ chạy UTC. Dùng `new Date()` để cắt ngày là cắt theo giờ UTC — tức
 * 07:00 sáng giờ VN. Hậu quả: việc xảy ra lúc 8 giờ tối hôm qua bị tính sang
 * "hôm nay", còn việc lúc 6 giờ sáng nay lại rơi về "hôm qua". Người dùng đối
 * chiếu với sổ sách/biên bản thực tế là lệch ngay.
 *
 * VN không có giờ mùa hè nên độ lệch cố định +7, không cần thư viện múi giờ.
 */

const LECH_VN = 7 * 60 * 60_000

/** Đầu và cuối của một ngày (theo giờ VN), trả về mốc UTC để so với DB. */
export function khoangNgayVN(moc: Date = new Date()): { tu: Date; den: Date } {
    const vn = new Date(moc.getTime() + LECH_VN)
    const y = vn.getUTCFullYear(), m = vn.getUTCMonth(), d = vn.getUTCDate()
    return {
        tu: new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - LECH_VN),
        den: new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - LECH_VN),
    }
}

/** Ngày hôm nay theo giờ VN, dạng 'YYYY-MM-DD'. */
export function ngayVN(moc: Date = new Date()): string {
    return new Date(moc.getTime() + LECH_VN).toISOString().slice(0, 10)
}
