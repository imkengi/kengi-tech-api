// ═══════════════════════════════════════════════════════════════════════════════
//  TẢI FILE LÊN GOOGLE DRIVE THEO KHỐI, QUA MÁY CHỦ (phiên tải nối tiếp / resumable)
//
//  VÌ SAO KHÔNG PUT THẲNG TỪ TRÌNH DUYỆT LÊN GOOGLE NỮA (08/09/2026):
//  Bản đầu cho trình duyệt PUT thẳng byte lên URL phiên Google trả về. Chủ shop
//  tải thì báo "Mất kết nối khi đang tải lên" — đó là `xhr.onerror`, tức là yêu
//  cầu PUT chết ở tầng mạng/CORS chứ không phải Google từ chối nội dung. PUT thẳng
//  vào phiên Drive mở từ máy chủ là lớp lỗi hay gặp (tiền kiểm CORS của URL phiên
//  không chắc chắn). Thay vì đoán, đi đường chắc: byte browser → api.kengi.vn
//  (CORS đã sẵn cho kengi.vn) → Google, cắt KHỐI 8MB nên dưới trần 32MB của
//  Cloud Run, và mỗi khối là một yêu cầu riêng nên dưới cả hạn 300 giây.
//
//  Bonus: token Drive ở LẠI máy chủ, không lộ ra trình duyệt; và mỗi khối thử lại
//  được, không phải tải lại nguyên file khi rớt một nhịp.
//
//  Quy tắc Google (đọc tài liệu 08/09/2026):
//   · KHỐI KHÔNG PHẢI cuối phải là bội số của 256KB. 8MB = 32×256KB ✓.
//   · Content-Range: bytes {đầu}-{cuối}/{tổng}. Khối giữa trả 308 (chưa xong) kèm
//     header Range; khối cuối trả 200/201 kèm JSON tài nguyên file.
//   · PUT vào URL phiên KHÔNG cần Authorization — phiên đã tự mang quyền.
// ═══════════════════════════════════════════════════════════════════════════════

/** 8MB — bội số của 256KB, dưới trần 32MB của Cloud Run. */
export const KICH_THUOC_KHOI = 8 * 1024 * 1024

/** Chặn SSRF: chỉ cho chuyển khối tới đúng host tải lên của Google. */
export function laUrlTaiLenGoogle(u: string): boolean {
    try {
        const h = new URL(u).hostname
        return h === 'www.googleapis.com' || h.endsWith('.googleapis.com')
    } catch { return false }
}

/**
 * Mở phiên tải nối tiếp trên Drive, trả về URL phiên (Location).
 * `token` là access token GHI của cửa hàng (layTokenGhiDrive).
 */
export async function moPhienResumable(
    token: string, folderId: string, name: string, mime: string, size: number,
): Promise<string> {
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': mime,
            'X-Upload-Content-Length': String(size),
        },
        body: JSON.stringify({ name: name.slice(0, 200), parents: [folderId] }),
    })
    if (!r.ok) {
        const chiTiet = (await r.text().catch(() => '')).slice(0, 400)
        throw new Error(`Google từ chối mở phiên tải lên (HTTP ${r.status}). ${chiTiet}`)
    }
    const url = r.headers.get('location')
    if (!url) throw new Error('Google không trả địa chỉ phiên tải lên (thiếu header Location)')
    return url
}

export interface KetQuaKhoi {
    xong: boolean
    status: number
    file?: any          // JSON tài nguyên file khi xong (có .id)
    daNhan?: number     // tổng byte Google đã nhận (đọc từ header Range) khi chưa xong
}

/**
 * Gửi MỘT khối lên phiên. `offset` = vị trí byte đầu của khối trong cả file,
 * `total` = tổng dung lượng file. Google suy ra khối cuối từ Content-Range.
 */
export async function guiKhoiResumable(
    sessionUrl: string, khoi: Uint8Array, offset: number, total: number,
): Promise<KetQuaKhoi> {
    if (!laUrlTaiLenGoogle(sessionUrl)) throw new Error('URL phiên không thuộc Google — từ chối chuyển tiếp')
    const cuoi = offset + khoi.length - 1
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 250_000)
    try {
        /* PHẢI đặt Content-Length BẰNG TAY. Đo 08/09/2026: Node 20 trên Cloud Run
         * (undici cũ) KHÔNG tự đặt Content-Length cho thân Uint8Array → Google trả
         * "411 Length Required" cho mọi khối. Node 24 cục bộ thì tự đặt nên lỗi
         * không lộ khi thử ở máy. Truyền Buffer + khai độ dài là chắc ăn cả hai. */
        const r = await fetch(sessionUrl, {
            method: 'PUT',
            headers: {
                'Content-Range': `bytes ${offset}-${cuoi}/${total}`,
                'Content-Length': String(khoi.length),
            },
            body: Buffer.from(khoi),
            signal: ac.signal,
        })
        // 308 = Resume Incomplete: còn khối nữa. 200/201 = xong.
        if (r.status === 308) {
            const rng = r.headers.get('range') || ''
            const m = rng.match(/bytes=0-(\d+)/)
            return { xong: false, status: 308, daNhan: m && m[1] ? Number(m[1]) + 1 : offset + khoi.length }
        }
        if (r.ok) {
            const text = await r.text()
            let file: any = null
            try { file = JSON.parse(text) } catch { /* Google đôi khi trả rỗng cho PATCH; với POST resumable thì có JSON */ }
            return { xong: true, status: r.status, file }
        }
        const chiTiet = (await r.text().catch(() => '')).slice(0, 400)
        throw new Error(`Google từ chối khối (HTTP ${r.status}) tại byte ${offset}. ${chiTiet}`)
    } finally {
        clearTimeout(timer)
    }
}
