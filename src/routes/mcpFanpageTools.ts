// ═══════════════════════════════════════════════════════════════════════════════
//  MCP TOOLS — FANPAGE MANAGER
//  Cho AI agent tự vận hành fanpage: đọc bình luận, trả lời, lên lịch bài,
//  quản lý quy tắc auto-reply, xem số liệu. Cùng nguồn dữ liệu với
//  kengi.vn/fanpage-manager (bảng Fb* per-store + routes/fanpage.ts).
//
//  Token page nằm ở FbPage.accessToken (server giữ) — agent KHÔNG bao giờ thấy.
// ═══════════════════════════════════════════════════════════════════════════════

import { Tool, ToolCtx, ToolError } from '../lib/mcpTypes'
import { FacebookService, FbGraphError } from '../services/platforms/facebook'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Lấy page + service. Bỏ trống pageId khi store CHỈ có 1 page (agent đỡ phải hỏi);
 * có nhiều page mà không nói rõ thì báo lỗi kèm danh sách để agent chọn lại.
 */
async function resolvePage(prisma: any, pageId?: string): Promise<{ page: any; svc: FacebookService }> {
    const active = { status: { not: 'disconnected' } }
    let page: any
    if (pageId) {
        page = await prisma.fbPage.findFirst({ where: { pageId: String(pageId), ...active } })
        if (!page) throw new ToolError(`Không tìm thấy fanpage "${pageId}" đã kết nối. Gọi fanpage_list_pages để xem danh sách.`)
    } else {
        const pages = await prisma.fbPage.findMany({ where: active, take: 5, orderBy: { createdAt: 'asc' } })
        if (!pages.length) throw new ToolError('Store chưa kết nối fanpage nào. Vào kengi.vn/fanpage-manager để kết nối Facebook trước.')
        if (pages.length > 1) {
            throw new ToolError(
                `Store có ${pages.length} fanpage — phải nói rõ page_id. Đang có: ` +
                pages.map((p: any) => `${p.name} (${p.pageId})`).join(', '),
            )
        }
        page = pages[0]
    }
    if (page.status === 'token_expired') {
        throw new ToolError(`Token Facebook của "${page.name}" đã hết hạn — chủ shop cần vào kengi.vn/fanpage-manager kết nối lại. Chưa thao tác được.`)
    }
    return { page, svc: new FacebookService(page.accessToken) }
}

/** Đánh dấu token hỏng khi Graph trả lỗi token, rồi ném lỗi dễ hiểu cho agent. */
async function wrapGraph<T>(prisma: any, pageId: string, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn()
    } catch (e: any) {
        if ((e as FbGraphError)?.isTokenError) {
            await prisma.fbPage.update({ where: { pageId }, data: { status: 'token_expired' } }).catch(() => { })
            throw new ToolError('Token Facebook đã hết hạn — chủ shop cần kết nối lại ở kengi.vn/fanpage-manager.')
        }
        throw new ToolError(`Facebook báo lỗi: ${e?.message || 'không rõ'}`)
    }
}

const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d)
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

const PAGE_ID_PROP = {
    page_id: { type: 'string', description: 'Facebook Page ID. Bỏ trống nếu store chỉ có 1 fanpage.' },
} as const

// ─── Tools ───────────────────────────────────────────────────────────────────

export const FANPAGE_TOOLS: Tool[] = [
    // ═══ ĐỌC ═══════════════════════════════════════════════════════════════════
    {
        name: 'fanpage_list_pages',
        description: 'Danh sách fanpage Facebook đã kết nối kèm trạng thái: token còn hạn không, đã bật webhook chưa, auto-reply đang bật hay tắt. Gọi đầu tiên trước mọi thao tác fanpage khác.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (_a, { prisma }: ToolCtx) => {
            const pages = await prisma.fbPage.findMany({
                where: { status: { not: 'disconnected' } },
                orderBy: { createdAt: 'asc' },
                select: {
                    pageId: true, name: true, category: true, fanCount: true, status: true,
                    webhookSubscribed: true, autoReplyEnabled: true, adAccountId: true, lastSyncAt: true,
                },
            })
            if (!pages.length) return { soFanpage: 0, ghiChu: 'Chưa kết nối fanpage nào — vào kengi.vn/fanpage-manager để kết nối Facebook.' }
            return {
                soFanpage: pages.length,
                fanpages: pages.map((p: any) => ({
                    pageId: p.pageId,
                    ten: p.name,
                    chuyenMuc: p.category,
                    soNguoiTheoDoi: p.fanCount,
                    trangThai: p.status === 'token_expired' ? 'TOKEN HẾT HẠN — cần kết nối lại' : 'đang hoạt động',
                    webhook: p.webhookSubscribed ? 'đã bật (nhận bình luận tức thì)' : 'chưa bật (chỉ quét lại mỗi 5 phút)',
                    autoReply: p.autoReplyEnabled ? 'đang bật' : 'đang tắt',
                    taiKhoanQuangCao: p.adAccountId || null,
                    dongBoLanCuoi: p.lastSyncAt,
                })),
            }
        },
    },
    {
        name: 'fanpage_list_comments',
        description: 'Bình luận mới nhất trên các bài gần đây của fanpage. Dùng để tìm bình luận cần trả lời (khách hỏi giá, hỏi tồn, phàn nàn). Trả về comment_id để gọi fanpage_reply_comment.',
        inputSchema: {
            type: 'object',
            properties: {
                ...PAGE_ID_PROP,
                post_limit: { type: 'number', description: 'Số bài gần đây cần quét bình luận (mặc định 10, tối đa 50)' },
                only_unanswered: { type: 'boolean', description: 'Chỉ lấy bình luận CHƯA được tool/auto-reply trả lời (mặc định true)' },
            },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const { page, svc } = await resolvePage(prisma, a?.page_id)
            const postLimit = clamp(num(a?.post_limit, 10), 1, 50)
            const comments = await wrapGraph(prisma, page.pageId, () => svc.listRecentComments(page.pageId, postLimit))

            let list = comments
            if (a?.only_unanswered !== false && comments.length) {
                // Đã ghi log auto-reply = coi như đã xử lý; tránh agent trả lời chồng.
                const done = await prisma.fbAutoReplyLog.findMany({
                    where: { pageId: page.pageId, commentId: { in: comments.map(c => c.id) } },
                    select: { commentId: true },
                })
                const seen = new Set(done.map((d: any) => d.commentId))
                list = comments.filter(c => !seen.has(c.id))
            }
            return {
                fanpage: page.name,
                soBinhLuan: list.length,
                ghiChu: a?.only_unanswered === false ? 'Gồm cả bình luận đã trả lời' : 'Chỉ bình luận chưa được trả lời tự động',
                binhLuan: list.slice(0, 100).map(c => ({
                    comment_id: c.id,
                    nguoiBinhLuan: c.from?.name || 'Ẩn danh',
                    noiDung: c.message,
                    luc: c.createdTime,
                    soLike: c.likeCount || 0,
                    daAn: !!c.isHidden,
                    post_id: c.postId,
                })),
            }
        },
    },
    {
        name: 'fanpage_list_posts',
        description: 'Bài ĐÃ ĐĂNG gần đây của fanpage kèm lượt tương tác. Dùng để biết bài nào đang chạy tốt, hoặc lấy post_id để chạy quảng cáo.',
        inputSchema: {
            type: 'object',
            properties: { ...PAGE_ID_PROP, limit: { type: 'number', description: 'Số bài (mặc định 10, tối đa 50)' } },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const { page, svc } = await resolvePage(prisma, a?.page_id)
            const limit = clamp(num(a?.limit, 10), 1, 50)
            const posts = await wrapGraph(prisma, page.pageId, () => svc.listPublishedPosts(page.pageId, limit))
            return {
                fanpage: page.name,
                soBai: posts.length,
                baiViet: posts.map((p: any) => ({
                    post_id: p.id,
                    noiDung: (p.message || '').slice(0, 200),
                    dangLuc: p.created_time,
                    link: p.permalink_url,
                    soCamXuc: p.reactions?.summary?.total_count ?? 0,
                    soBinhLuan: p.comments?.summary?.total_count ?? 0,
                    soChiaSe: p.shares?.count ?? 0,
                })),
            }
        },
    },
    {
        name: 'fanpage_list_scheduled',
        description: 'Danh sách bài ĐÃ LÊN LỊCH chưa đăng của fanpage (kèm bài lỗi). Dùng trước khi lên lịch mới để tránh trùng giờ hoặc trùng nội dung.',
        inputSchema: { type: 'object', properties: { ...PAGE_ID_PROP }, additionalProperties: false },
        run: async (a, { prisma }: ToolCtx) => {
            const { page } = await resolvePage(prisma, a?.page_id)
            const rows = await prisma.fbScheduledPost.findMany({
                where: { pageId: page.pageId, status: { in: ['scheduled', 'failed'] } },
                orderBy: { scheduledAt: 'asc' },
                take: 100,
            })
            return {
                fanpage: page.name,
                soBaiChoDang: rows.filter((r: any) => r.status === 'scheduled').length,
                soBaiLoi: rows.filter((r: any) => r.status === 'failed').length,
                danhSach: rows.map((r: any) => ({
                    id: r.id,
                    noiDung: (r.message || '').slice(0, 200),
                    hendang: r.scheduledAt,
                    loaiNoiDung: r.mediaType,
                    trangThai: r.status === 'failed' ? `LỖI: ${r.errorMessage || 'không rõ'}` : 'chờ đăng',
                })),
            }
        },
    },
    {
        name: 'fanpage_insights',
        description: 'Số liệu fanpage theo ngày: lượt tiếp cận (người dùng duy nhất) và số người tương tác. Dùng để báo cáo hiệu quả trang.',
        inputSchema: {
            type: 'object',
            properties: { ...PAGE_ID_PROP, days: { type: 'number', description: 'Số ngày gần nhất (mặc định 7, tối đa 90)' } },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const { page, svc } = await resolvePage(prisma, a?.page_id)
            const days = clamp(num(a?.days, 7), 1, 90)
            const raw: any = await wrapGraph(prisma, page.pageId, () => svc.getPageInsights(page.pageId, undefined, days))
            const out: Record<string, any> = {}
            for (const m of raw?.data || []) {
                const values = (m.values || []).map((v: any) => ({ ngay: v.end_time?.slice(0, 10), giaTri: v.value || 0 }))
                out[m.name] = { tong: values.reduce((s: number, v: any) => s + (Number(v.giaTri) || 0), 0), theoNgay: values }
            }
            return { fanpage: page.name, soNgay: days, soLieu: out }
        },
    },
    {
        name: 'fanpage_list_rules',
        description: 'Danh sách quy tắc auto-reply bình luận của fanpage (từ khoá → nội dung trả lời tự động).',
        inputSchema: { type: 'object', properties: { ...PAGE_ID_PROP }, additionalProperties: false },
        run: async (a, { prisma }: ToolCtx) => {
            const { page } = await resolvePage(prisma, a?.page_id)
            const rules = await prisma.fbCommentRule.findMany({ where: { pageId: page.pageId }, orderBy: { priority: 'asc' } })
            return {
                fanpage: page.name,
                autoReplyDangBat: page.autoReplyEnabled,
                soQuyTac: rules.length,
                quyTac: rules.map((r: any) => ({
                    id: r.id, ten: r.name || null, tuKhoa: r.keyword,
                    kieuKhop: r.matchType === 'exact' ? 'khớp chính xác' : r.matchType === 'starts' ? 'bắt đầu bằng' : 'có chứa',
                    traLoi: r.replyText,
                    guiTinNhanRieng: r.privateReply, anBinhLuanSauKhiTraLoi: r.hideComment,
                    dangBat: r.enabled, doUuTien: r.priority,
                })),
            }
        },
    },
    {
        name: 'fanpage_auto_reply_log',
        description: 'Nhật ký auto-reply gần đây: bình luận nào đã được trả lời tự động, bằng quy tắc nào, thành công hay lỗi. Dùng để kiểm tra engine có chạy đúng không.',
        inputSchema: {
            type: 'object',
            properties: { ...PAGE_ID_PROP, limit: { type: 'number', description: 'Số dòng (mặc định 20, tối đa 100)' } },
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const { page } = await resolvePage(prisma, a?.page_id)
            const logs = await prisma.fbAutoReplyLog.findMany({
                where: { pageId: page.pageId }, orderBy: { createdAt: 'desc' }, take: clamp(num(a?.limit, 20), 1, 100),
            })
            return {
                fanpage: page.name,
                soDong: logs.length,
                nhatKy: logs.map((l: any) => ({
                    luc: l.createdAt, nguoiBinhLuan: l.fromName, binhLuan: l.commentMsg,
                    hanhDong: l.action, daTraLoi: l.replyText,
                    ketQua: l.success ? 'thành công' : `lỗi: ${l.errorMessage || 'không rõ'}`,
                })),
            }
        },
    },

    // ═══ GHI (cần scope write) ════════════════════════════════════════════════
    {
        name: 'fanpage_reply_comment',
        description: 'Trả lời một bình luận trên fanpage. Lấy comment_id từ fanpage_list_comments. Có thể gửi kèm tin nhắn riêng (Messenger) cho người bình luận.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                comment_id: { type: 'string', description: 'ID bình luận cần trả lời (từ fanpage_list_comments)' },
                message: { type: 'string', description: 'Nội dung trả lời công khai' },
                ...PAGE_ID_PROP,
                private_reply: { type: 'boolean', description: 'Gửi thêm tin nhắn riêng qua Messenger (chỉ được trong 7 ngày kể từ bình luận). Mặc định false.' },
                hide_after: { type: 'boolean', description: 'Ẩn bình luận sau khi trả lời (dùng cho bình luận spam/tiêu cực). Mặc định false.' },
            },
            required: ['comment_id', 'message'],
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const commentId = String(a?.comment_id || '').trim()
            const message = String(a?.message || '').trim()
            if (!commentId) throw new ToolError('Thiếu comment_id')
            if (!message) throw new ToolError('Nội dung trả lời không được để trống')
            const { page, svc } = await resolvePage(prisma, a?.page_id)

            const rep = await wrapGraph(prisma, page.pageId, () => svc.replyToComment(commentId, message))

            let privateReplyResult = 'không gửi'
            if (a?.private_reply) {
                // Cửa sổ 7 ngày của FB — hỏng thì KHÔNG làm hỏng cả thao tác trả lời công khai
                try { await svc.privateReply(commentId, message); privateReplyResult = 'đã gửi' }
                catch (e: any) { privateReplyResult = `không gửi được (${e?.message || 'lỗi'})` }
            }
            let hidden = 'không ẩn'
            if (a?.hide_after) {
                try { await svc.hideComment(commentId, true); hidden = 'đã ẩn' }
                catch (e: any) { hidden = `không ẩn được (${e?.message || 'lỗi'})` }
            }

            // Ghi log để lần quét sau không trả lời chồng (unique pageId+commentId).
            // fromName để trống — đó là chỗ ghi NGƯỜI BÌNH LUẬN, không phải người trả lời;
            // dấu vết "do agent làm" nằm ở action.
            await prisma.fbAutoReplyLog.upsert({
                where: { pageId_commentId: { pageId: page.pageId, commentId } },
                create: {
                    pageId: page.pageId, commentId,
                    action: a?.hide_after ? 'reply_hide_mcp' : 'reply_mcp',
                    replyText: message, success: true,
                },
                update: { replyText: message, success: true, action: a?.hide_after ? 'reply_hide_mcp' : 'reply_mcp' },
            }).catch(() => { })

            return { ketQua: 'Đã trả lời bình luận', fanpage: page.name, replyId: (rep as any)?.id, tinNhanRieng: privateReplyResult, anBinhLuan: hidden }
        },
    },
    {
        name: 'fanpage_hide_comment',
        description: 'Ẩn hoặc bỏ ẩn một bình luận trên fanpage (dùng cho bình luận spam, công kích, lộ thông tin khách).',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                comment_id: { type: 'string', description: 'ID bình luận' },
                hidden: { type: 'boolean', description: 'true = ẩn (mặc định), false = bỏ ẩn' },
                ...PAGE_ID_PROP,
            },
            required: ['comment_id'],
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const commentId = String(a?.comment_id || '').trim()
            if (!commentId) throw new ToolError('Thiếu comment_id')
            const hide = a?.hidden !== false
            const { page, svc } = await resolvePage(prisma, a?.page_id)
            await wrapGraph(prisma, page.pageId, () => svc.hideComment(commentId, hide))
            return { ketQua: hide ? 'Đã ẩn bình luận' : 'Đã bỏ ẩn bình luận', fanpage: page.name, comment_id: commentId }
        },
    },
    {
        name: 'fanpage_create_post',
        description: 'Đăng bài lên fanpage NGAY, hoặc LÊN LỊCH đăng sau. Hỗ trợ chữ, ảnh (URL), video (URL), nhiều ảnh, hoặc kèm link. Lên lịch phải cách hiện tại ít nhất 10 phút (quy định của Facebook).',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: 'Nội dung bài viết' },
                ...PAGE_ID_PROP,
                scheduled_at: { type: 'string', description: 'Thời điểm hẹn đăng dạng ISO 8601 (VD 2026-08-01T09:00:00+07:00). Bỏ trống = ĐĂNG NGAY.' },
                media_urls: { type: 'array', items: { type: 'string' }, description: 'Danh sách URL ảnh/video công khai (Facebook tự tải về). 1 ảnh → dùng luôn; nhiều ảnh → đặt media_type = multi_photo.' },
                media_type: { type: 'string', enum: ['text', 'photo', 'video', 'multi_photo', 'link'], description: 'Loại nội dung. Mặc định tự suy ra từ media_urls / link_url.' },
                link_url: { type: 'string', description: 'Link đính kèm bài viết' },
            },
            required: ['message'],
            additionalProperties: false,
        },
        run: async (a, { prisma, userId }: ToolCtx) => {
            const message = String(a?.message || '').trim()
            if (!message) throw new ToolError('Nội dung bài viết không được để trống')
            const { page, svc } = await resolvePage(prisma, a?.page_id)

            const mediaUrls: string[] = Array.isArray(a?.media_urls) ? a.media_urls.filter((u: any) => typeof u === 'string' && u) : []
            const MEDIA_TYPES = ['text', 'photo', 'video', 'multi_photo', 'link'] as const
            type MediaType = typeof MEDIA_TYPES[number]
            const guessed: MediaType = mediaUrls.length > 1 ? 'multi_photo' : mediaUrls.length === 1 ? 'photo' : a?.link_url ? 'link' : 'text'
            const mediaType: MediaType = MEDIA_TYPES.includes(a?.media_type) ? a.media_type : guessed

            let scheduledAtMs: number | null = null
            if (a?.scheduled_at) {
                const t = new Date(a.scheduled_at).getTime()
                if (!Number.isFinite(t)) throw new ToolError(`scheduled_at "${a.scheduled_at}" không đọc được — dùng ISO 8601, VD 2026-08-01T09:00:00+07:00`)
                if (t < Date.now() + 10 * 60_000) throw new ToolError('Facebook yêu cầu thời điểm hẹn đăng cách hiện tại ít nhất 10 phút.')
                scheduledAtMs = t
            }

            const fb = await wrapGraph(prisma, page.pageId, () =>
                svc.createOrSchedulePost({ pageId: page.pageId, message, mediaType, mediaUrls, linkUrl: a?.link_url, scheduledAtMs }))

            const rec = await prisma.fbScheduledPost.create({
                data: {
                    pageId: page.pageId, fbPostId: fb.id, message,
                    mediaType, mediaUrls: JSON.stringify(mediaUrls), linkUrl: a?.link_url || null,
                    scheduledAt: scheduledAtMs ? new Date(scheduledAtMs) : new Date(),
                    status: scheduledAtMs ? 'scheduled' : 'published',
                    publishedAt: scheduledAtMs ? null : new Date(),
                    createdBy: userId || null,
                },
            })
            return {
                ketQua: scheduledAtMs ? 'Đã lên lịch đăng bài' : 'Đã đăng bài lên fanpage',
                fanpage: page.name, id: rec.id, fb_post_id: fb.id,
                hendang: scheduledAtMs ? new Date(scheduledAtMs).toISOString() : 'đăng ngay',
            }
        },
    },
    {
        name: 'fanpage_manage_scheduled_post',
        description: 'Thao tác trên bài ĐÃ LÊN LỊCH: đăng ngay, đổi giờ đăng, hoặc huỷ. Lấy id từ fanpage_list_scheduled.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'id bài đã lên lịch (từ fanpage_list_scheduled)' },
                action: { type: 'string', enum: ['publish_now', 'reschedule', 'cancel'], description: 'publish_now = đăng ngay, reschedule = đổi giờ (cần scheduled_at), cancel = huỷ lịch' },
                scheduled_at: { type: 'string', description: 'Giờ đăng mới dạng ISO 8601 — bắt buộc khi action = reschedule' },
            },
            required: ['id', 'action'],
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const rec = await prisma.fbScheduledPost.findUnique({ where: { id: String(a?.id || '') } })
            if (!rec) throw new ToolError(`Không tìm thấy bài đã lên lịch id "${a?.id}"`)
            if (rec.status !== 'scheduled' && rec.status !== 'failed') {
                throw new ToolError(`Bài này đang ở trạng thái "${rec.status}" — không thao tác được nữa.`)
            }
            const { page, svc } = await resolvePage(prisma, rec.pageId)
            const action = String(a?.action)

            if (action === 'publish_now') {
                if (rec.fbPostId) await wrapGraph(prisma, page.pageId, () => svc.publishNow(rec.fbPostId!))
                await prisma.fbScheduledPost.update({ where: { id: rec.id }, data: { status: 'published', publishedAt: new Date() } })
                return { ketQua: 'Đã đăng bài ngay', fanpage: page.name, id: rec.id }
            }
            if (action === 'cancel') {
                // Xoá được trên FB thì tốt; xoá rồi/token hỏng vẫn phải huỷ mirror
                if (rec.fbPostId) { try { await svc.deletePost(rec.fbPostId) } catch { /* bỏ qua */ } }
                await prisma.fbScheduledPost.update({ where: { id: rec.id }, data: { status: 'cancelled' } })
                return { ketQua: 'Đã huỷ lịch đăng', fanpage: page.name, id: rec.id }
            }
            if (action === 'reschedule') {
                const t = new Date(a?.scheduled_at || '').getTime()
                if (!Number.isFinite(t)) throw new ToolError('reschedule cần scheduled_at dạng ISO 8601, VD 2026-08-01T09:00:00+07:00')
                if (t < Date.now() + 10 * 60_000) throw new ToolError('Facebook yêu cầu thời điểm hẹn đăng cách hiện tại ít nhất 10 phút.')
                if (rec.fbPostId) await wrapGraph(prisma, page.pageId, () => svc.editScheduledPost(rec.fbPostId!, { scheduledAtMs: t }))
                await prisma.fbScheduledPost.update({ where: { id: rec.id }, data: { scheduledAt: new Date(t) } })
                return { ketQua: 'Đã đổi giờ đăng', fanpage: page.name, id: rec.id, hendangMoi: new Date(t).toISOString() }
            }
            throw new ToolError(`action "${action}" không hợp lệ — dùng publish_now / reschedule / cancel`)
        },
    },
    {
        name: 'fanpage_create_rule',
        description: 'Tạo quy tắc auto-reply bình luận: khách bình luận chứa từ khoá nào thì fanpage tự trả lời câu gì. Chạy server-side kể cả khi không ai mở máy. Tạo xong nhớ bật auto-reply bằng fanpage_set_auto_reply.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: 'Từ khoá trigger, VD "giá", "ship", "còn hàng"' },
                reply_text: { type: 'string', description: 'Nội dung fanpage sẽ tự trả lời' },
                ...PAGE_ID_PROP,
                match_type: { type: 'string', enum: ['contains', 'exact', 'starts'], description: 'contains = có chứa (mặc định), exact = khớp chính xác, starts = bắt đầu bằng' },
                name: { type: 'string', description: 'Tên gợi nhớ cho quy tắc' },
                private_reply: { type: 'boolean', description: 'Gửi kèm tin nhắn riêng qua Messenger. Mặc định false.' },
                hide_comment: { type: 'boolean', description: 'Ẩn bình luận sau khi trả lời. Mặc định false.' },
                priority: { type: 'number', description: 'Độ ưu tiên, số nhỏ chạy trước (mặc định 0)' },
            },
            required: ['keyword', 'reply_text'],
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const keyword = String(a?.keyword || '').trim()
            const replyText = String(a?.reply_text || '').trim()
            if (!keyword) throw new ToolError('Thiếu keyword')
            if (!replyText) throw new ToolError('Thiếu reply_text')
            const { page } = await resolvePage(prisma, a?.page_id)
            const matchType = ['contains', 'exact', 'starts'].includes(String(a?.match_type)) ? String(a.match_type) : 'contains'

            const rule = await prisma.fbCommentRule.create({
                data: {
                    pageId: page.pageId, name: String(a?.name || ''), keyword, matchType, replyText,
                    privateReply: !!a?.private_reply, hideComment: !!a?.hide_comment,
                    enabled: true, priority: num(a?.priority, 0),
                },
            })
            return {
                ketQua: 'Đã tạo quy tắc auto-reply', fanpage: page.name, id: rule.id,
                canhBao: page.autoReplyEnabled ? null : 'Auto-reply của fanpage này đang TẮT — gọi fanpage_set_auto_reply để bật thì quy tắc mới chạy.',
            }
        },
    },
    {
        name: 'fanpage_update_rule',
        description: 'Sửa hoặc BẬT/TẮT một quy tắc auto-reply đã có. Lấy id từ fanpage_list_rules. Chỉ gửi trường muốn đổi.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'id quy tắc (từ fanpage_list_rules)' },
                keyword: { type: 'string', description: 'Từ khoá mới' },
                reply_text: { type: 'string', description: 'Nội dung trả lời mới' },
                match_type: { type: 'string', enum: ['contains', 'exact', 'starts'], description: 'Kiểu khớp mới' },
                enabled: { type: 'boolean', description: 'true = bật quy tắc, false = tắt' },
                private_reply: { type: 'boolean', description: 'Gửi kèm tin nhắn riêng' },
                hide_comment: { type: 'boolean', description: 'Ẩn bình luận sau khi trả lời' },
                priority: { type: 'number', description: 'Độ ưu tiên, số nhỏ chạy trước' },
                name: { type: 'string', description: 'Tên gợi nhớ' },
            },
            required: ['id'],
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const id = String(a?.id || '').trim()
            if (!id) throw new ToolError('Thiếu id quy tắc')
            const rule = await prisma.fbCommentRule.findUnique({ where: { id } })
            if (!rule) throw new ToolError(`Không tìm thấy quy tắc id "${id}" — gọi fanpage_list_rules để lấy id đúng.`)

            const data: any = {}
            if (typeof a?.keyword === 'string' && a.keyword.trim()) data.keyword = a.keyword.trim()
            if (typeof a?.reply_text === 'string' && a.reply_text.trim()) data.replyText = a.reply_text.trim()
            if (['contains', 'exact', 'starts'].includes(String(a?.match_type))) data.matchType = String(a.match_type)
            if (typeof a?.enabled === 'boolean') data.enabled = a.enabled
            if (typeof a?.private_reply === 'boolean') data.privateReply = a.private_reply
            if (typeof a?.hide_comment === 'boolean') data.hideComment = a.hide_comment
            if (Number.isFinite(Number(a?.priority))) data.priority = Number(a.priority)
            if (typeof a?.name === 'string') data.name = a.name
            if (!Object.keys(data).length) throw new ToolError('Không có trường nào để cập nhật.')

            const updated = await prisma.fbCommentRule.update({ where: { id }, data })
            return {
                ketQua: 'Đã cập nhật quy tắc auto-reply', id: updated.id,
                tuKhoa: updated.keyword, traLoi: updated.replyText, dangBat: updated.enabled,
            }
        },
    },
    {
        name: 'fanpage_delete_rule',
        description: 'Xoá hẳn một quy tắc auto-reply. Nếu chỉ muốn tạm ngưng thì dùng fanpage_update_rule với enabled=false thay vì xoá.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'id quy tắc (từ fanpage_list_rules)' } },
            required: ['id'],
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const id = String(a?.id || '').trim()
            const rule = await prisma.fbCommentRule.findUnique({ where: { id } })
            if (!rule) throw new ToolError(`Không tìm thấy quy tắc id "${id}"`)
            await prisma.fbCommentRule.delete({ where: { id } })
            return { ketQua: 'Đã xoá quy tắc auto-reply', tuKhoaDaXoa: rule.keyword }
        },
    },
    {
        name: 'fanpage_subscribe_webhook',
        description: 'Đăng ký fanpage nhận webhook Facebook để bình luận mới về server TỨC THÌ (không có webhook thì auto-reply chỉ chạy khi cron quét lại mỗi 5 phút). Gọi khi fanpage_list_pages báo webhook chưa bật.',
        write: true,
        inputSchema: { type: 'object', properties: { ...PAGE_ID_PROP }, additionalProperties: false },
        run: async (a, { prisma }: ToolCtx) => {
            if (!process.env.FB_WEBHOOK_VERIFY_TOKEN) {
                throw new ToolError('Server chưa cấu hình FB_WEBHOOK_VERIFY_TOKEN — quản trị viên phải đặt biến này trước.')
            }
            const { page, svc } = await resolvePage(prisma, a?.page_id)
            try {
                await svc.subscribeWebhook(page.pageId)
            } catch (e: any) {
                await prisma.fbPage.update({ where: { pageId: page.pageId }, data: { webhookSubscribed: false } }).catch(() => { })
                if ((e as FbGraphError)?.isTokenError) {
                    await prisma.fbPage.update({ where: { pageId: page.pageId }, data: { status: 'token_expired' } }).catch(() => { })
                    throw new ToolError('Token Facebook đã hết hạn — chủ shop cần kết nối lại ở kengi.vn/fanpage-manager.')
                }
                throw new ToolError(`Không bật được webhook: ${e?.message || 'lỗi không rõ'}. Thường do app Facebook chưa được duyệt quyền quản lý page.`)
            }
            await prisma.fbPage.update({ where: { pageId: page.pageId }, data: { webhookSubscribed: true } })
            return { ketQua: 'Đã bật webhook — bình luận mới sẽ về server tức thì', fanpage: page.name }
        },
    },
    {
        name: 'fanpage_set_auto_reply',
        description: 'Bật hoặc tắt engine auto-reply bình luận cho fanpage. Bật thì các quy tắc đã tạo sẽ tự chạy khi có bình luận mới.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                enabled: { type: 'boolean', description: 'true = bật, false = tắt' },
                ...PAGE_ID_PROP,
            },
            required: ['enabled'],
            additionalProperties: false,
        },
        run: async (a, { prisma }: ToolCtx) => {
            const enabled = !!a?.enabled
            const { page } = await resolvePage(prisma, a?.page_id)
            await prisma.fbPage.update({ where: { pageId: page.pageId }, data: { autoReplyEnabled: enabled } })
            const soQuyTac = await prisma.fbCommentRule.count({ where: { pageId: page.pageId, enabled: true } })
            return {
                ketQua: enabled ? 'Đã BẬT auto-reply' : 'Đã TẮT auto-reply',
                fanpage: page.name,
                soQuyTacDangBat: soQuyTac,
                canhBao: enabled && !soQuyTac ? 'Chưa có quy tắc nào đang bật — tạo bằng fanpage_create_rule thì mới có tác dụng.' : null,
                tocDo: page.webhookSubscribed ? 'Nhận bình luận tức thì (webhook đã bật)' : 'Quét lại mỗi 5 phút (webhook chưa bật)',
            }
        },
    },
]
