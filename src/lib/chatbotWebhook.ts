// ─────────────────────────────────────────────────────────────────────────────
//  WEBHOOK ĐẦU VÀO / ĐẦU RA CỦA CHATBOT (21/10/2026) — chủ shop: "không phải tải workflow mà gắn webhook đầu vào và
//  đầu ra để trả kết quả".
//   · ĐẦU VÀO: mỗi shop một đường dẫn bí mật POST /api/chatbot/vao/<mã cửa hàng>/<khoá> — n8n chỉ cần dán URL, không
//     cấu hình khoá API / header.
//   · ĐẦU RA: URL webhook của n8n (chủ shop dán ở kengi.vn/chatbot) — kengi.vn POST câu trả lời tới đó, kèm header
//     X-Kengi-Chatbot = khoá riêng của shop để n8n xác minh, và trả lại NGUYÊN các trường kèm theo của tin vào
//     (senderId, pageId…) để n8n biết gửi cho ai.
//   Xử lý NGAY TRONG request đầu vào rồi mới trả lời: Cloud Run bóp CPU ngoài request (nhịp ngoài /api/cron/tick) ⇒
//   việc nền sau khi đã trả 202 có thể không bao giờ chạy.
//
//  Đầu ra là URL do NGƯỜI DÙNG nhập rồi MÁY CHỦ gọi tới ⇒ chặn SSRF: chỉ http/https, không user:pass, không tên nội bộ,
//  phân giải DNS và từ chối mọi IP nội bộ / loopback / link-local (169.254.169.254 = máy chủ metadata Cloud Run, lộ là
//  lộ token service account), không theo chuyển hướng.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import dns from 'dns'
import net from 'net'

export const API_CONG_KHAI = (process.env.PUBLIC_API_URL || 'https://api.kengi.vn/api').replace(/\/+$/, '')

/** Khoá bí mật 32 ký tự hex (đường dẫn đầu vào / header đầu ra) */
export const taoKhoaWebhook = (): string => crypto.randomBytes(16).toString('hex')
export const laKhoaWebhook = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{32}$/.test(s)

/** URL đầu vào của một shop — mã cửa hàng viết thường */
export function duongVao(maCuaHang: unknown, khoa: unknown): string | null {
    const ma = String(maCuaHang ?? '').trim().toLowerCase()
    if (!/^[a-z0-9_-]{2,40}$/.test(ma) || !laKhoaWebhook(khoa)) return null
    return `${API_CONG_KHAI}/chatbot/vao/${ma}/${khoa}`
}

// ─── Chặn SSRF ───────────────────────────────────────────────────────────────
function ipv4SangSo(ip: string): number {
    return ip.split('.').reduce((s, x) => s * 256 + Number(x), 0)
}
const DAI_V4_NOI_BO: [string, number][] = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
    ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
]

/** IP không được gọi tới từ máy chủ: nội bộ, loopback, link-local (metadata), CGNAT, multicast, dành riêng */
export function laIpNoiBo(ip: string): boolean {
    const v = net.isIP(ip)
    if (v === 4) {
        const so = ipv4SangSo(ip)
        return DAI_V4_NOI_BO.some(([goc, bit]) => {
            const mat = bit === 0 ? 0 : (0xffffffff << (32 - bit)) >>> 0
            return ((so & mat) >>> 0) === ((ipv4SangSo(goc) & mat) >>> 0)
        })
    }
    if (v === 6) {
        // URL chuẩn hoá [::ffff:127.0.0.1] thành ::ffff:7f00:1 ⇒ phải MỞ RỘNG đủ 8 nhóm rồi soi, không so chuỗi
        const g = moRongIpv6(ip)
        if (!g) return true
        const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
        if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return laIpNoiBo(v4(g[6], g[7]))       // ::ffff:a.b.c.d
        if (g.slice(0, 6).every(x => x === 0)) return true                                                // ::, ::1, ::a.b.c.d
        if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return laIpNoiBo(v4(g[6], g[7])) // NAT64
        return (g[0] & 0xfe00) === 0xfc00      // fc00::/7 nội bộ
            || (g[0] & 0xffc0) === 0xfe80      // fe80::/10 link-local
            || (g[0] & 0xff00) === 0xff00      // ff00::/8 multicast
            || (g[0] === 0x2001 && g[1] === 0x0db8)
    }
    return true // không phải IP ⇒ coi như không an toàn
}

/** IPv6 → 8 nhóm 16 bit (hỗ trợ "::" và IPv4 nhúng ở cuối); hỏng ⇒ null */
function moRongIpv6(ip: string): number[] | null {
    let s = ip.toLowerCase().split('%')[0]
    const nhung = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
    if (nhung) {
        if (net.isIP(nhung[2]) !== 4) return null
        const so = ipv4SangSo(nhung[2])
        s = `${nhung[1]}${Math.floor(so / 65536).toString(16)}:${(so % 65536).toString(16)}`
    }
    const phan = s.split('::')
    if (phan.length > 2) return null
    const dau = phan[0] ? phan[0].split(':') : []
    const cuoi = phan.length === 2 ? (phan[1] ? phan[1].split(':') : []) : null
    const nhom = cuoi === null ? dau : [...dau, ...Array(8 - dau.length - cuoi.length).fill('0'), ...cuoi]
    if (nhom.length !== 8 || nhom.some(x => !/^[0-9a-f]{1,4}$/.test(x))) return null
    return nhom.map(x => parseInt(x, 16))
}

type TraDns = (host: string, opts: { all: true }) => Promise<{ address: string; family: number }[]>
const traDnsMacDinh: TraDns = (host, opts) => dns.promises.lookup(host, opts)

/** Kiểm URL đầu ra trước khi lưu / gửi. Trả URL đã chuẩn hoá hoặc lý do từ chối (nói được với chủ shop). */
export async function kiemUrlDauRa(raw: unknown, traDns: TraDns = traDnsMacDinh): Promise<{ url: string } | { loi: string }> {
    const s = String(raw ?? '').trim()
    if (!s) return { loi: 'Chưa nhập URL webhook đầu ra' }
    if (s.length > 500) return { loi: 'URL quá dài' }
    let u: URL
    try { u = new URL(s) } catch { return { loi: 'URL không hợp lệ — dán nguyên Production URL của node Webhook trong n8n' } }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { loi: 'URL phải bắt đầu bằng https:// hoặc http://' }
    if (u.username || u.password) return { loi: 'URL không được chứa tên đăng nhập / mật khẩu' }
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    const tenNoiBo = host === 'localhost' || /\.(local|localhost|internal|intranet|lan|home)\.?$/.test(host)
        || (!host.includes('.') && !net.isIP(host))   // tên một nhãn (n8n, metadata…) chỉ phân giải được trong mạng nội bộ
    if (!host || tenNoiBo) {
        return { loi: 'URL trỏ vào máy nội bộ — phải là địa chỉ n8n truy cập được từ Internet' }
    }
    let ips: string[]
    if (net.isIP(host)) ips = [host]
    else {
        try { ips = (await traDns(host, { all: true })).map(x => x.address) } catch { return { loi: `Không tìm thấy tên miền ${host}` } }
    }
    if (!ips.length || ips.some(laIpNoiBo)) return { loi: 'URL trỏ vào địa chỉ nội bộ — phải là địa chỉ n8n truy cập được từ Internet' }
    return { url: u.toString() }
}

// ─── Gửi đầu ra ──────────────────────────────────────────────────────────────
export interface KetQuaDauRa {
    daGui: boolean
    ma: number | null
    loi?: string
}

type HamFetch = (url: string, init: any) => Promise<{ ok: boolean; status: number }>

/** POST kết quả tới webhook n8n: kiểm SSRF lại lúc gửi (DNS có thể đổi), không theo chuyển hướng, 10 giây, thử lại 1 lần
 *  khi mất mạng / 5xx. Không ném lỗi — trả kết quả để báo về cho người gọi. */
export async function guiDauRa(url: string, khoa: string, payload: unknown, opts: { fetchFn?: HamFetch; traDns?: TraDns } = {}): Promise<KetQuaDauRa> {
    const kiem = await kiemUrlDauRa(url, opts.traDns)
    if ('loi' in kiem) return { daGui: false, ma: null, loi: kiem.loi }
    const goi: HamFetch = opts.fetchFn || ((u, init) => fetch(u, init))
    const body = JSON.stringify(payload)
    let cuoi: KetQuaDauRa = { daGui: false, ma: null, loi: 'Không gửi được' }
    for (let lan = 0; lan < 2; lan++) {
        try {
            const r = await goi(kiem.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Kengi-Chatbot': khoa, 'User-Agent': 'kengi-chatbot/1' },
                body,
                redirect: 'manual',
                signal: AbortSignal.timeout(10_000),
            })
            if (r.ok) return { daGui: true, ma: r.status }
            cuoi = {
                daGui: false, ma: r.status,
                loi: r.status >= 300 && r.status < 400 ? 'Webhook đầu ra trả chuyển hướng — dán đúng Production URL của n8n'
                    : r.status === 404 ? 'n8n trả 404 — workflow chưa bật (Active) hoặc sai URL (Production URL, không phải Test URL)'
                        : `n8n trả lỗi ${r.status}`,
            }
            if (r.status < 500) return cuoi
        } catch (e: any) {
            cuoi = { daGui: false, ma: null, loi: e?.name === 'TimeoutError' ? 'n8n không phản hồi trong 10 giây' : 'Không kết nối được tới webhook đầu ra' }
        }
    }
    return cuoi
}

// ─── Tin vào / gói đầu ra ────────────────────────────────────────────────────
const TRUONG_TIN = new Set(['chatInput', 'message', 'text', 'cauHoi', 'query', 'lichSu', 'history', 'shop', 'shopId', 'action'])
const TRAN_KEM_THEO = 8_000

/** Các trường KÈM THEO của tin vào (senderId, pageId, platform…) — gửi nguyên lại ở đầu ra; bỏ phần tin nhắn / lịch sử; ≤ 8 KB */
export function kemTheo(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
    const ra: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
        if (TRUONG_TIN.has(k) || /^(__proto__|constructor|prototype)$/.test(k)) continue
        ra[k] = v
        if (JSON.stringify(ra).length > TRAN_KEM_THEO) { delete ra[k]; break }
    }
    return ra
}

export interface GoiDauRa {
    suKien: 'chatbot.tra_loi' | 'chatbot.thu'
    shop: { id: string; ten: string }
    sessionId: string | null
    cauHoi: string
    traLoi: string
    canNhanVien: boolean
    sanPham: unknown[]
    kemTheo: Record<string, unknown>
    luc: string
    loi?: string
}

export function taoGoiDauRa(p: Omit<GoiDauRa, 'luc' | 'suKien'> & { suKien?: GoiDauRa['suKien']; luc?: Date }): GoiDauRa {
    return {
        suKien: p.suKien || 'chatbot.tra_loi',
        shop: p.shop,
        sessionId: p.sessionId || null,
        cauHoi: p.cauHoi,
        traLoi: p.traLoi,
        canNhanVien: !!p.canNhanVien,
        sanPham: Array.isArray(p.sanPham) ? p.sanPham : [],
        kemTheo: p.kemTheo || {},
        luc: (p.luc || new Date()).toISOString(),
        ...(p.loi ? { loi: p.loi } : {}),
    }
}
