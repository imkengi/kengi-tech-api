/**
 * BÌNH LUẬN của bài đã đăng — đọc và TRẢ LỜI ngay trong Marketing Studio (30/09/2026,
 * chủ shop: "chưa có chỗ reply comment", làm Threads trước).
 *
 * Đọc thẳng từ nền tảng mỗi lần mở, KHÔNG lưu DB: bình luận là dữ liệu của nền tảng (người
 * ta sửa, xoá, bị ẩn…); lưu lại là phải đồng bộ theo — không đáng cho việc đọc rồi trả lời.
 *
 * Threads cần 2 quyền trong token (thiếu thì báo ĐÚNG tên quyền, không báo chung chung):
 *   threads_read_replies (đọc) · threads_manage_replies (trả lời)
 * Facebook / Instagram / TikTok / YouTube: chưa làm.
 */
import { goiNenTang, LoiNenTang } from '../lib/mktLoiNenTang'

const TH = 'https://graph.threads.net/v1.0'
/* Threads: token ở tham số URL như adapter đăng bài (mktNenTangKhac). */
const th = (duong: string, token: string) =>
    `${TH}${duong}${duong.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`
const ngu = (ms: number) => new Promise(r => setTimeout(r, ms))

export const HO_TRO_BINH_LUAN = new Set(['threads'])

export type BinhLuan = {
    id: string
    text: string
    /** username người viết */
    nguoi: string
    luc: string | null
    /** Do CHÍNH kênh mình viết (bài trả lời của shop) */
    laCuaMinh: boolean
    /** id bình luận được trả lời; null = trả lời thẳng vào bài */
    traLoiCho: string | null
    daAn?: boolean
    link?: string | null
}

const QUYEN = { doc: 'threads_read_replies', traLoi: 'threads_manage_replies' }

/** Lỗi quyền của Graph (10, 200…) → nói rõ PHẢI thêm quyền nào; token hỏng (190) → nối lại kênh. */
function noiRoLoi(viec: 'doc' | 'traLoi', e: any): never {
    const code = e instanceof LoiNenTang ? String(e.code) : ''
    if (code === '190') throw new LoiNenTang('Token Threads đã hết hạn — vào Kết nối kênh để nối lại.', { code: 'TOKEN_HONG' })
    if (['10', '200', '3'].includes(code) || /^2\d\d$/.test(code))
        throw new LoiNenTang(`Token Threads chưa có quyền "${QUYEN[viec]}". Thêm quyền này cho app ở developers.facebook.com (Use cases → Threads API), tạo token mới rồi vào Kết nối kênh → nối lại kênh Threads.`, { code: 'THIEU_QUYEN' })
    throw e
}

const AN = new Set(['HIDDEN', 'COVERED', 'BLOCKED', 'RESTRICTED'])

/** Mọi bình luận của một bài Threads (cả trả lời lồng nhau), cũ trước mới sau. */
export async function docBinhLuan(platform: string, token: string, baiId: string): Promise<BinhLuan[]> {
    if (platform !== 'threads') throw new LoiNenTang(`Chưa hỗ trợ bình luận trên ${platform} — hiện làm Threads trước.`, { code: 'CHUA_HO_TRO' })
    try {
        /* /conversation trả MỌI tầng trả lời (còn /replies chỉ tầng đầu). */
        const ra: BinhLuan[] = []
        let url: string | null = th(`/${baiId}/conversation?fields=id,text,username,timestamp,replied_to,is_reply_owned_by_me,hide_status,permalink&reverse=false&limit=50`, token)
        for (let trang = 0; url && trang < 4; trang++) {
            const d: any = await goiNenTang(url, null)
            for (const r of d?.data || []) {
                const cha = r?.replied_to?.id ? String(r.replied_to.id) : null
                ra.push({
                    id: String(r.id), text: String(r.text || ''), nguoi: String(r.username || ''),
                    luc: r.timestamp || null, laCuaMinh: r.is_reply_owned_by_me === true,
                    traLoiCho: cha && cha !== baiId ? cha : null,
                    daAn: AN.has(String(r.hide_status || '')) || undefined,
                    link: r.permalink || null,
                })
            }
            url = d?.paging?.next || null   // link trang sau đã kèm sẵn token
        }
        return ra
    } catch (e) { noiRoLoi('doc', e) }
}

/**
 * Trả lời một bình luận (hoặc trả lời thẳng vào bài: `traLoiId` = id bài). Trả id bài trả lời.
 * Tạo container có `reply_to_id` → chờ FINISHED → threads_publish (giống đăng bài).
 */
export async function traLoiBinhLuan(platform: string, token: string, userId: string, traLoiId: string, text: string): Promise<string> {
    if (platform !== 'threads') throw new LoiNenTang(`Chưa hỗ trợ trả lời bình luận trên ${platform} — hiện làm Threads trước.`, { code: 'CHUA_HO_TRO' })
    try {
        const c: any = await goiNenTang(th(`/${userId}/threads`, token), null, {
            method: 'POST', body: { media_type: 'TEXT', text: text.normalize('NFC'), reply_to_id: traLoiId },
        })
        if (!c?.id) throw new LoiNenTang('Threads không tạo được bản trả lời.', { code: 'KHONG_CO_ID' })
        /* Chữ thuần thường xong ngay; vẫn chờ FINISHED (tối đa ~15 giây) như đăng bài. */
        for (let i = 0; i < 6; i++) {
            await ngu(i === 0 ? 800 : 2500)
            const s: any = await goiNenTang(th(`/${c.id}?fields=status,error_message`, token), null).catch(() => null)
            if (s?.status === 'FINISHED') break
            if (['ERROR', 'EXPIRED'].includes(s?.status))
                throw new LoiNenTang(`Threads không xử lý được bản trả lời: ${s?.error_message || s.status}`, { code: 'MEDIA_FAILED' })
        }
        const p: any = await goiNenTang(th(`/${userId}/threads_publish`, token), null, { method: 'POST', body: { creation_id: c.id } })
        if (!p?.id) throw new LoiNenTang('Threads không trả về id bản trả lời — mở bài trên Threads kiểm tra trước khi gửi lại.', { code: 'KHONG_CO_ID', moHo: true })
        return String(p.id)
    } catch (e) { noiRoLoi('traLoi', e) }
}
