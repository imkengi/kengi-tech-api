// ═══════════════════════════════════════════════════════════════════════════════
//  MCP TOOLS — MARKETING STUDIO (đa nền tảng)   05/09/2026
//
//  ⛔ RANH GIỚI CỐ Ý: KHÔNG CÓ TOOL DUYỆT BÀI.
//
//  AI soạn được, xem được, lên lịch được bài ĐÃ ĐƯỢC NGƯỜI DUYỆT — nhưng không
//  có đường nào để tự duyệt. Duyệt là cửa cuối cùng ngăn nội dung do máy sinh ra
//  đi thẳng lên trang khách hàng, và cửa đó phải do người mở. Nếu sau này ai thêm
//  `mkt_duyet_noi_dung`, cả tính năng mất ý nghĩa an toàn.
//
//  Cũng KHÔNG có tool nào trả `accessToken` — token không rời máy chủ.
// ═══════════════════════════════════════════════════════════════════════════════
import type { Tool, ToolCtx } from '../lib/mcpTypes'
import { canhBaoCat } from '../lib/mcpTypes'

const TRAN = 50

export const MKT_TOOLS: Tool[] = [
    // ═══ ĐỌC ═══════════════════════════════════════════════════════════════════
    {
        name: 'mkt_tinh_trang',
        description: 'Tình trạng Marketing Studio: đã nối bao nhiêu kênh, bao nhiêu bài đang chờ đăng, bao nhiêu bài GỬI RỒI MÀ CHƯA RÕ KẾT QUẢ (cần người kiểm), bao nhiêu bài hỏng. Gọi đầu tiên trước mọi thao tác marketing khác.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (_a: any, { prisma }: ToolCtx) => {
            const p: any = prisma
            const [soKenh, cho, moHo, hong, daGui] = [
                await p.mktAccount.count({ where: { status: 'active' } }),
                await p.mktPublication.count({ where: { status: 'queued' } }),
                await p.mktPublication.count({ where: { status: 'uncertain' } }),
                await p.mktPublication.count({ where: { status: 'failed' } }),
                await p.mktPublication.count({ where: { status: 'sent' } }),
            ]
            return {
                soKenhDangHoatDong: soKenh, dangChoDang: cho, daGui, hong,
                guiRoiChuaRoKetQua: moHo,
                ghiChu: soKenh === 0
                    ? 'Chưa nối kênh nào — chủ shop phải vào Marketing Studio dán token kênh trước.'
                    : moHo > 0
                        ? `${moHo} bài đã gửi mà không rõ đã lên chưa. KHÔNG được gửi lại tự động — phải chủ shop vào nền tảng kiểm rồi quyết, nếu không sẽ đăng trùng.`
                        : undefined,
            }
        },
    },
    {
        name: 'mkt_danh_sach_kenh',
        description: 'Các kênh đã nối (Facebook/Instagram/TikTok/YouTube) kèm trạng thái và số ngày token còn lại. KHÔNG trả về token.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (_a: any, { prisma }: ToolCtx) => {
            const ds = await (prisma as any).mktAccount.findMany({
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true, platform: true, externalId: true, name: true,
                    followers: true, status: true, tokenExpiresAt: true,
                },
            })
            if (!ds.length) return { soKenh: 0, ghiChu: 'Chưa nối kênh nào.' }
            return {
                soKenh: ds.length,
                kenh: ds.map((k: any) => {
                    const conLai = k.tokenExpiresAt
                        ? Math.floor((new Date(k.tokenExpiresAt).getTime() - Date.now()) / 86400_000)
                        : null
                    return {
                        id: k.id, nenTang: k.platform, ten: k.name, trangThai: k.status,
                        /* `null` = KHÔNG ĐỌC ĐƯỢC số người theo dõi, khác hẳn 0 người. */
                        nguoiTheoDoi: k.followers,
                        hanToken: k.status === 'token_expired' ? 'ĐÃ HẾT HẠN'
                            : conLai === null ? 'không rõ hạn'
                                : conLai <= 0 ? 'HẾT HẠN HÔM NAY'
                                    : conLai <= 7 ? `SẮP HẾT — còn ${conLai} ngày`
                                        : `còn ${conLai} ngày`,
                    }
                }),
            }
        },
    },
    {
        name: 'mkt_danh_sach_noi_dung',
        description: 'Bài viết trong Marketing Studio, lọc theo trạng thái (pending/approved/scheduled/done/rejected). Dùng để biết bài nào đang chờ chủ shop duyệt.',
        inputSchema: {
            type: 'object',
            properties: { trangThai: { type: 'string', description: 'pending | approved | scheduled | done | rejected' } },
            additionalProperties: false,
        },
        run: async (a: any, { prisma }: ToolCtx) => {
            const where: any = {}
            if (a?.trangThai) where.status = String(a.trangThai)
            const ds = await (prisma as any).mktContent.findMany({
                where, orderBy: { updatedAt: 'desc' }, take: TRAN,
                select: { id: true, title: true, body: true, status: true, revision: true, approvedRevision: true, updatedAt: true },
            })
            return {
                soBai: ds.length,
                bai: ds.map((c: any) => ({
                    id: c.id, tieuDe: c.title,
                    trichNoiDung: String(c.body || '').slice(0, 160),
                    trangThai: c.status,
                    daDuyetBanHienTai: c.approvedRevision === c.revision,
                })),
                ...canhBaoCat(ds.length, TRAN, 'bài'),
            }
        },
    },
    {
        name: 'mkt_hang_doi_dang',
        description: 'Hàng đợi đăng bài: bài nào chờ, bài nào đã gửi, bài nào hỏng, và đặc biệt bài nào GỬI RỒI MÀ CHƯA RÕ KẾT QUẢ.',
        inputSchema: {
            type: 'object',
            properties: { trangThai: { type: 'string', description: 'queued | processing | sent | failed | uncertain | cancelled' } },
            additionalProperties: false,
        },
        run: async (a: any, { prisma }: ToolCtx) => {
            const where: any = {}
            if (a?.trangThai) where.status = String(a.trangThai)
            const ds = await (prisma as any).mktPublication.findMany({
                where, orderBy: { scheduledAt: 'desc' }, take: TRAN,
                include: { account: { select: { platform: true, name: true } }, content: { select: { title: true } } },
            })
            return {
                so: ds.length,
                muc: ds.map((p: any) => ({
                    id: p.id, nenTang: p.account?.platform, kenh: p.account?.name,
                    tieuDe: p.content?.title, trangThai: p.status,
                    henLuc: p.scheduledAt, daGuiLuc: p.sentAt,
                    loi: p.errorMessage || undefined,
                    canNguoiQuyet: p.status === 'uncertain' || undefined,
                })),
                ...canhBaoCat(ds.length, TRAN, 'bài'),
            }
        },
    },

    // ═══ GHI — đều nằm trong TOOL_NHAY_CAM ═════════════════════════════════════
    {
        name: 'mkt_soan_noi_dung',
        description: 'Soạn một bài mới vào Marketing Studio. Bài LUÔN vào trạng thái CHỜ DUYỆT — không có cách nào để bài này tự lên trang. Chủ shop phải đọc và duyệt tay.',
        inputSchema: {
            type: 'object',
            properties: {
                tieuDe: { type: 'string', description: 'Nhãn nội bộ để chủ shop lướt nhanh' },
                noiDung: { type: 'string', description: 'Toàn văn bài đăng' },
                lienKet: { type: 'string', description: 'URL kèm theo (tuỳ chọn)' },
                chienDichId: { type: 'string' },
            },
            required: ['noiDung'],
            additionalProperties: false,
        },
        run: async (a: any, { prisma }: ToolCtx) => {
            const body = String(a?.noiDung || '').trim()
            if (!body) throw new Error('Nội dung bài không được để trống.')
            const c = await (prisma as any).mktContent.create({
                data: {
                    title: String(a?.tieuDe || ''), body,
                    linkUrl: a?.lienKet || null, campaignId: a?.chienDichId || null,
                    status: 'pending', source: 'ai',
                },
            })
            return {
                id: c.id, trangThai: c.status,
                ghiChu: 'Đã lưu vào hàng đợi CHỜ DUYỆT. Bài sẽ KHÔNG lên trang cho tới khi chủ shop tự duyệt — '
                    + 'trợ lý AI không có quyền duyệt, đó là cố ý.',
            }
        },
    },
    {
        name: 'mkt_len_lich_dang',
        description: 'Lên lịch đăng một bài ĐÃ ĐƯỢC DUYỆT ra các kênh đã chọn. Từ chối nếu bài chưa duyệt hoặc đã sửa sau khi duyệt.',
        inputSchema: {
            type: 'object',
            properties: {
                noiDungId: { type: 'string' },
                kenhIds: { type: 'array', items: { type: 'string' }, description: 'id các kênh (lấy từ mkt_danh_sach_kenh)' },
                henLuc: { type: 'string', description: 'ISO datetime; bỏ trống = đăng ngay' },
            },
            required: ['noiDungId', 'kenhIds'],
            additionalProperties: false,
        },
        run: async (a: any, { prisma }: ToolCtx) => {
            const p: any = prisma
            const c = await p.mktContent.findUnique({ where: { id: String(a.noiDungId) } })
            if (!c) throw new Error('Không tìm thấy bài.')
            /* Cửa duyệt — lặp lại ở đây chứ không tin phía gọi. */
            if (c.approvedRevision !== c.revision) {
                throw new Error('Bài chưa được duyệt (hoặc đã sửa sau khi duyệt). Phải chủ shop duyệt bản hiện tại trước.')
            }
            const khi = a?.henLuc ? new Date(a.henLuc) : new Date()
            if (isNaN(khi.getTime())) throw new Error('henLuc không hợp lệ.')

            const taoRa: string[] = [], boQua: string[] = []
            for (const accId of (a.kenhIds || []) as string[]) {
                const acc = await p.mktAccount.findUnique({ where: { id: accId } })
                if (!acc) { boQua.push(`${accId}: không tìm thấy kênh`); continue }
                if (acc.status !== 'active') { boQua.push(`${acc.name}: kênh đang "${acc.status}"`); continue }
                const key = `${c.id}|${accId}|${c.revision}`
                if (await p.mktPublication.findUnique({ where: { idempotencyKey: key } })) {
                    boQua.push(`${acc.name}: đã có trong hàng đợi`); continue
                }
                const pub = await p.mktPublication.create({
                    data: { contentId: c.id, accountId: accId, idempotencyKey: key, scheduledAt: khi, status: 'queued' },
                })
                taoRa.push(pub.id)
            }
            if (taoRa.length) await p.mktContent.update({ where: { id: c.id }, data: { status: 'scheduled' } })
            return { daLenLich: taoRa.length, boQua, ghiChu: boQua.length ? 'Có kênh bị bỏ qua — xem `boQua`.' : undefined }
        },
    },
]
