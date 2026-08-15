/**
 * GOM LỖI PRODUCTION THÀNH NHÓM ĐỌC ĐƯỢC — dùng cho GET /admin/errors.
 *
 * 500 dòng "Timed out fetching a new connection" là MỘT vấn đề, không phải 500
 * vấn đề. Đổ nguyên log ra màn hình thì vẫn không ai đọc nổi — giá trị của
 * trung tâm lỗi nằm ở chỗ gom, không ở chỗ hiển thị.
 *
 * HỎNG THEO HAI CHIỀU ĐỀU TỆ, và tệ theo kiểu im lặng:
 *   - Gom QUÁ TAY: hai lỗi khác bệnh dính làm một → cái hiếm bị cái phổ biến
 *     che mất, đúng thứ người ta cần thấy thì lại không thấy.
 *   - Gom QUÁ ÍT: một lỗi lặp lại nổ thành hàng trăm nhóm → màn hình đầy nhiễu,
 *     người dùng bỏ qua luôn, và trung tâm lỗi thành vô dụng.
 *
 * Nguyên tắc: chỉ bỏ những phần CHẮC CHẮN là biến thiên theo từng lần (id,
 * mốc thời gian, số dài). Giữ nguyên chữ nghĩa của thông báo, vì đó mới là
 * thứ phân biệt bệnh này với bệnh kia.
 */

/** Bỏ phần biến thiên để hai lần lỗi cùng bệnh gom về một nhóm. */
export function chuKyLoi(msg: string): string {
    return String(msg || '')
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
        .replace(/\bc[a-z0-9]{24,}\b/gi, '<id>')            // cuid
        .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, '<thoi-gian>')
        .replace(/\b\d{5,}\b/g, '<so>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220)
}

/**
 * Chuẩn hoá đường dẫn để đếm 5xx theo route, không theo từng URL.
 * `/api/x/cm123…/sync` và `/api/x/cm456…/sync` là CÙNG một route.
 */
export function chuanHoaDuong(url: string): string {
    return String(url || '')
        .replace(/^https?:\/\/[^/]+/, '')
        .split('?')[0]!
        .replace(/\/c[a-z0-9]{20,}/gi, '/:id')
        .replace(/\/\d{3,}/g, '/:id')
}

export interface NhomLoi {
    chuKy: string
    so: number
    mau: string
    somNhat: string
    muonNhat: string
}

export interface KetQuaGom {
    nhom: NhomLoi[]
    duongLoi: Array<{ duong: string; so: number }>
    so5xx: number
}

/**
 * Gom danh sách bản ghi Cloud Logging.
 * @param dong các entry thô (textPayload / jsonPayload.message / httpRequest)
 */
export function gomLoi(dong: any[]): KetQuaGom {
    const nhom = new Map<string, NhomLoi>()
    const theoDuong = new Map<string, number>()
    let so5xx = 0

    for (const e of dong) {
        const url = e?.httpRequest?.requestUrl
        const status = Number(e?.httpRequest?.status) || 0
        if (status >= 500) {
            so5xx++
            if (url) {
                const duong = chuanHoaDuong(url)
                theoDuong.set(duong, (theoDuong.get(duong) || 0) + 1)
            }
        }

        /* LOG REQUEST CỦA CLOUD RUN KHÔNG CÓ NỘI DUNG ỨNG DỤNG.
         * Đo 15/08/2026: 985 request 5xx trong 24h mà `textPayload` lẫn
         * `jsonPayload` đều rỗng — nên nếu chỉ đọc payload thì đám này biến
         * mất và màn hình báo "0 lỗi". Dựng thông báo từ status + URL. */
        const msg = e?.textPayload
            || e?.jsonPayload?.message
            || (status >= 500 ? `HTTP ${status} ${url || ''}` : null)
        if (!msg) continue

        const ky = chuKyLoi(msg)
        if (!ky) continue
        const cu = nhom.get(ky)
        if (cu) {
            cu.so++
            if (e.timestamp && e.timestamp < cu.somNhat) cu.somNhat = e.timestamp
            if (e.timestamp && e.timestamp > cu.muonNhat) cu.muonNhat = e.timestamp
        } else {
            nhom.set(ky, {
                chuKy: ky, so: 1,
                mau: String(msg).slice(0, 400),
                somNhat: e.timestamp, muonNhat: e.timestamp,
            })
        }
    }

    return {
        nhom: [...nhom.values()].sort((a, b) => b.so - a.so),
        duongLoi: [...theoDuong.entries()].sort((a, b) => b[1] - a[1])
            .map(([duong, so]) => ({ duong, so })),
        so5xx,
    }
}
