/**
 * Nối fanpage bằng token DÁN TAY — lõi của POST /api/fanpage/connect-page-token (10/11/2026, lô 20: FB-06 / X-16).
 *
 * Trước lô 20:
 *  - dán USER token ⇒ bị từ chối "không phải PAGE token", trong khi USER token (có quyền trang) chính là thứ lấy ra page token
 *    KHÔNG hết hạn: "Long-lived Page access token do not have an expiration date" (tài liệu Facebook "Get Long-Lived Tokens" —
 *    page token đọc qua me/accounts bằng USER token đã gia hạn ~60 ngày);
 *  - hạn token ghi cứng "hôm nay + 55 ngày": token chép thẳng ở Graph API Explorer chỉ sống vài giờ mà Kengi vẫn báo "còn 55
 *    ngày" ⇒ fanpage rớt kết nối, bài hẹn giờ không lên mà không ai được nhắc; page token không hết hạn thì ngày 48 bị nhắc oan.
 * Nay:
 *  - USER token ⇒ đọc me/accounts lấy page token của fanpage: gửi kèm pageId, hoặc tài khoản chỉ quản lý MỘT fanpage; nhiều
 *    fanpage ⇒ lỗi FB_CHON_PAGE kèm danh sách { id, name } để người chọn — KHÔNG BAO GIỜ trả token nào về.
 *    USER token KHÔNG được lưu: chỉ cần nó để lấy page token, giữ lại là giữ thêm một chìa mở MỌI fanpage (và có thể cả quảng
 *    cáo) của tài khoản. fanpageCron chỉ chữa page token bằng FbUserToken có quyền trang — đường này không tạo dòng nào.
 *  - hạn thật đọc bằng debug_token, best-effort (Facebook chỉ cho app token hoặc token của nhà phát triển app đọc): expires_at
 *    0 ⇒ không hết hạn (null — như page token fanpageCron chữa); > 0 ⇒ đúng hạn đó; còn < 24 giờ ⇒ VẪN lưu (đang chạy được)
 *    nhưng cảnh báo gắt kèm cách gia hạn. Không đọc được ⇒ giữ cách cũ (55 ngày) và NÓI RÕ là đoán.
 */
import { FacebookService, type FbPageInfo } from '../services/platforms/facebook'

const H = 3600_000
const NGAY = 24 * H
/** hạn đoán khi không đọc được hạn thật — như trước lô 20 (page token dán tay ~60 ngày, chừa 5 ngày để nhắc) */
export const HAN_DOAN_NGAY = 55

/** Cách có token bền — một chỗ, cho mọi câu cảnh báo. */
const CACH_BEN = 'Cách bền nhất: dán USER token ĐÃ GIA HẠN (Graph API Explorer để ô "User or Page" là User Token → Generate → bấm ⓘ cạnh token'
    + ' → Open in Access Token Tool → «Extend Access Token») — Kengi tự lấy page token, page token lấy từ USER token đã gia hạn không hết hạn.'

/** Lỗi trả thẳng cho người dán (HTTP 400): `code` để FE nhận ra, `them` (vd danh sách fanpage để chọn) đi kèm JSON. */
export class LoiNoiToken extends Error {
    constructor(message: string, public code: string, public them: Record<string, any> = {}) { super(message) }
}

export interface KetQuaNoiToken {
    pageId: string
    /** page token đã lưu — CHỈ để route bật webhook, KHÔNG trả về trình duyệt */
    pageToken: string
    /** page token lấy từ USER token (me/accounts) chứ không phải dán thẳng */
    tuUserToken: boolean
    /** hạn đã ghi, ms (null = không hết hạn) */
    hetHan: number | null
    /** hạn đọc từ Facebook (true) hay đoán HAN_DOAN_NGAY ngày (false) */
    hanThat: boolean
    canhBao: string | null
}

/**
 * Hạn thật của `token` qua debug_token. Thử lần lượt `dsSvc` (đường USER token: USER token trước — chủ shop tạo token bằng app
 * của chính họ thì USER token ấy là "token của nhà phát triển app"; rồi chính page token). Mọi lỗi / dữ liệu lạ ⇒ thử đường kế,
 * hết đường ⇒ null (KHÔNG ném: hạn chỉ để nhắc, đọc hỏng không được chặn việc nối).
 */
export async function docHanToken(dsSvc: Pick<FacebookService, 'get'>[], token: string): Promise<{ hetHan: number | null } | null> {
    for (const s of dsSvc) {
        try {
            const d = (await s.get('debug_token', { input_token: token }))?.data
            if (!d || d.is_valid === false || d.expires_at === undefined || d.expires_at === null) continue
            const ea = Number(d.expires_at)
            if (!Number.isFinite(ea) || ea < 0) continue
            return { hetHan: ea > 0 ? ea * 1000 : null }
        } catch { /* debug_token chỉ cho app token / token của nhà phát triển app — thử đường kế */ }
    }
    return null
}

export async function noiPageTokenDanTay(o: {
    prisma: any
    accessToken: unknown
    pageId?: unknown
    name?: unknown
    /** userId người dán (FbPage.connectedBy khi tạo mới) */
    nguoi?: string | null
    bayGio?: number
}): Promise<KetQuaNoiToken> {
    const now = o.bayGio ?? Date.now()
    const token = String(o.accessToken || '').trim()
    if (!token) throw new LoiNoiToken('Thiếu accessToken', 'FB_TOKEN_THIEU')
    if (/\s/.test(token)) throw new LoiNoiToken('Token phải là MỘT chuỗi liền (thường bắt đầu bằng EAA…) — chép lại, đừng lẫn dấu cách hay xuống dòng.', 'FB_TOKEN_INVALID')

    // 1. Token có sống không + loại gì (identifyToken suy từ /me — Facebook bỏ metadata=1 từ 19/05/2026)
    const svcGoc = new FacebookService(token)
    let info: Awaited<ReturnType<FacebookService['identifyToken']>>
    try {
        info = await svcGoc.identifyToken()
    } catch (e: any) {
        throw new LoiNoiToken(`Token không dùng được: ${e?.message || 'Facebook từ chối'}`, 'FB_TOKEN_INVALID')
    }
    const claimed = String(o.pageId || '').trim()
    let svc = svcGoc
    let pageToken = token
    let tuUserToken = false
    let trang: { id: string; name?: string; category?: string; fanCount?: number; picture?: string; igUserId?: string }

    if (info.type === 'application') {
        throw new LoiNoiToken('Đây là token của APP, không phải token fanpage hay tài khoản. ' + CACH_BEN, 'FB_NOT_PAGE_TOKEN')
    } else if (info.type && info.type !== 'page') {
        // 2a. USER token (hoặc tài khoản hệ thống): lấy page token của fanpage qua me/accounts
        const chu = info.name || info.id
        let ds: FbPageInfo[]
        try {
            ds = await svcGoc.listPages()
        } catch (e: any) {
            throw new LoiNoiToken(`Đây là USER token của ${chu} nhưng không đọc được danh sách fanpage (${e?.message || 'Facebook từ chối'}) — tạo lại token có tick quyền pages_show_list.`, 'FB_KHONG_DOC_DUOC_PAGE')
        }
        const ten = (p: FbPageInfo) => p.name || String(p.id)
        const tomTat = ds.slice(0, 50).map(p => ({ id: String(p.id), name: ten(p) }))
        let p: FbPageInfo | undefined
        if (claimed) {
            p = ds.find(x => String(x.id) === claimed)
            if (!p) {
                throw new LoiNoiToken(`Tài khoản Facebook của token (${chu}) không quản lý fanpage ${claimed}`
                    + (ds.length ? ` — chỉ thấy: ${ds.slice(0, 5).map(ten).join(', ')}${ds.length > 5 ? '…' : ''}.` : '.'), 'FB_PAGE_KHONG_THUOC', { pages: tomTat })
            }
        } else if (ds.length === 1) {
            p = ds[0]
        } else if (!ds.length) {
            throw new LoiNoiToken(`Đây là USER token của ${chu} nhưng Facebook không trả fanpage nào — lúc bấm Generate Access Token, Facebook hỏi chọn fanpage: tick fanpage cần nối và giữ quyền pages_show_list.`, 'FB_KHONG_CO_PAGE')
        } else {
            throw new LoiNoiToken(`Tài khoản ${chu} quản lý ${ds.length} fanpage — chọn fanpage cần nối.`, 'FB_CHON_PAGE', { pages: tomTat })
        }
        if (!p.accessToken) {
            throw new LoiNoiToken(`Facebook không trả page token cho fanpage ${ten(p)} — tài khoản phải có quyền quản lý fanpage này và token cần quyền pages_show_list.`, 'FB_KHONG_CO_PAGE_TOKEN')
        }
        pageToken = p.accessToken
        svc = new FacebookService(pageToken)
        tuUserToken = true
        trang = { id: String(p.id), name: p.name, category: p.category, fanCount: p.fanCount, picture: p.picture, igUserId: p.igUserId }
    } else {
        // 2b. PAGE token: pageId gửi kèm phải khớp — tránh lưu nhầm token của page khác
        if (claimed && claimed !== info.id) {
            throw new LoiNoiToken(`Page ID bạn nhập (${claimed}) không khớp với page của token (${info.id} — ${info.name || 'không rõ tên'}).`, 'FB_PAGE_KHONG_KHOP')
        }
        trang = { id: info.id, name: info.name, category: info.category, fanCount: info.fanCount, picture: info.picture }
    }

    const pageId = trang.id
    const name = String(o.name || '').trim() || trang.name || `Page ${pageId}`
    const canhBao: string[] = []

    // 3. Token thao tác được, không chỉ đọc /me — thiếu pages_read_engagement vẫn qua /me nhưng hỏng ở đây
    try {
        await svc.listPublishedPosts(pageId, 1)
    } catch (e: any) {
        canhBao.push(`Token đọc được thông tin page nhưng KHÔNG đọc được bài viết (${e?.message || 'lỗi'}). `
            + 'Thường do thiếu quyền pages_read_engagement — vẫn lưu, nhưng nhiều tính năng sẽ không chạy.')
    }

    // 4. Hạn THẬT (best-effort); không đọc được ⇒ đoán như cũ và nói rõ là đoán
    const han = await docHanToken(tuUserToken ? [svcGoc, svc] : [svc], pageToken)
    const hetHan = han ? han.hetHan : now + HAN_DOAN_NGAY * NGAY
    if (!han) {
        canhBao.push(`Facebook không cho đọc hạn thật của token (chỉ nhà phát triển app xem được) — Kengi tạm tính ${HAN_DOAN_NGAY} ngày. `
            + 'Token chép thẳng ở Graph API Explorer, chưa gia hạn, chỉ sống vài giờ. ' + CACH_BEN)
    } else if (hetHan !== null && hetHan - now < NGAY) {
        const gio = Math.max(1, Math.round((hetHan - now) / H))
        canhBao.push(`Token chỉ còn sống khoảng ${gio} giờ (chưa gia hạn) — ${gio} giờ nữa fanpage rớt kết nối, bài hẹn giờ không lên. ` + CACH_BEN)
    }

    // 5. Lưu page token (USER token không lưu)
    const duLieu = {
        name, category: trang.category, avatar: trang.picture, fanCount: trang.fanCount || 0,
        accessToken: pageToken, tokenExpiresAt: hetHan === null ? null : new Date(hetHan),
        status: 'active', lastSyncAt: new Date(now),
        ...(trang.igUserId ? { igUserId: trang.igUserId } : {}),
    }
    await o.prisma.fbPage.upsert({
        where: { pageId },
        create: { pageId, ...duLieu, connectedBy: o.nguoi || undefined },
        update: duLieu,
    })
    return { pageId, pageToken, tuUserToken, hetHan, hanThat: !!han, canhBao: canhBao.join(' ') || null }
}
