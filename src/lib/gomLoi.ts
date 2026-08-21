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
/**
 * MÔ TẢ MỘT LỖI SAO CHO KHÔNG BAO GIỜ RA CHUỖI RỖNG.
 *
 * `console.error(\`... : ${err.message || String(err)}\`)` là mẫu ai cũng viết,
 * và nó THẤT BẠI IM LẶNG với lỗi Prisma: nội dung nằm ở `code`/`meta` còn
 * `.message` rỗng.
 *
 * Tệ hơn, có loại lỗi rỗng CẢ `name` LẪN `message`. Lúc đó `String(err)` gọi
 * `Error.prototype.toString()`, mà đặc tả nói name rỗng thì trả về message —
 * cũng rỗng. Nên mọi đường lùi thông thường đều ra `""`.
 *
 * DÍNH THẬT HAI LẦN:
 *   - 12–15/08/2026: hàng trăm `[OrderSync] Error converting order X:` cụt lủn
 *     mỗi ngày, không lần nào chẩn được. Vá lần một (ghi thêm code|meta) —
 *     nhưng vẫn hụt đúng ca `name` và `message` cùng rỗng.
 *   - 16/08/2026 13:52 UTC: 8 dòng log dài ĐÚNG 55 ký tự, kết thúc bằng dấu
 *     hai chấm. Thủ phạm thật là cạn pool (`connection limit: 1`) và chỉ tìm ra
 *     nhờ mấy dòng `prisma:error` nằm rời bên cạnh.
 *
 * `err.stack` VẪN CÒN khung gọi kể cả khi name/message rỗng — đó là đường lùi.
 */
/**
 * Chuỗi CÓ CHỮ mới tính là có nội dung.
 *
 * ⚠ Đây là chỗ bản đầu tiên của hàm này sai, và sai theo kiểu rất khó thấy:
 * lỗi Prisma hay có `message` chỉ gồm một ký tự xuống dòng. Chuỗi `"\n"` là
 * TRUTHY, nên hàm trả về `"\n"`, rồi Cloud Logging cắt ký tự xuống dòng ở cuối
 * dòng log — ra **đúng 55 ký tự**, y hệt mã CŨ chưa vá. Tôi đã mất một vòng dài
 * đi nghi Cloud Build đẩy nguồn cũ (tải cả gói nguồn 23MB về đối chiếu, soi log
 * build tìm lớp đệm) trước khi nhận ra thủ phạm nằm ngay trong hàm này.
 */
function coChu(x: any): string | null {
    if (typeof x !== 'string') return null
    /* Gộp mọi khoảng trắng về một dấu cách: MỘT LỖI PHẢI LÀ MỘT DÒNG LOG.
     * Thông báo lỗi Prisma thật thường nhiều dòng ("\nInvalid `prisma.x()`
     * invocation:\n\n…"); để nguyên là nó vỡ thành nhiều bản ghi rời trong
     * Cloud Logging — đúng thứ đã làm 4 ngày không ai chẩn được nguyên nhân. */
    const s = x.replace(/\s+/g, ' ').trim()
    return s ? s : null
}

export function moTaLoi(err: any): string {
    const chinh = [
        err?.code && `code=${err.code}`,
        /* Ném thẳng chuỗi/số cũng là chuyện có thật — giữ nguyên nội dung.
         * Cố ý KHÔNG dùng `String(err)` cho mọi kiểu: với object nó ra
         * "[object Object]", nhìn như có thông tin mà thật ra không có gì. */
        coChu(err?.message) || coChu(err?.name)
        || (typeof err === 'number' ? String(err) : coChu(err)),
        err?.meta && `meta=${JSON.stringify(err.meta).slice(0, 200)}`,
    ].filter(Boolean).join(' | ')
    if (chinh) return chinh

    // Rỗng ruột: nói ra ĐƯỢC GÌ còn hơn để trống cho người sau đoán.
    const kieu = err?.constructor?.name || (err === null ? 'null' : typeof err)
    const khoa = err && typeof err === 'object' ? Object.keys(err).slice(0, 8).join(',') : ''
    const khung = String(err?.stack || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || ''
    return [
        `LỖI RỖNG kiểu=${kieu}`,
        khoa && `khoá=${khoa}`,
        khung && `tại ${khung.slice(0, 140)}`,
    ].filter(Boolean).join(' | ')
}

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
