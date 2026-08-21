// ═══════════════════════════════════════════════════════════════════════════════
//  DRIVE VIDEOS — ghép video đóng gói / mở hàng hoàn với đơn sàn theo mã vận đơn
//
//  Mỗi cửa hàng tự cấu hình driveFolderId trong Store Settings rồi share thư
//  mục cho service account. Route quét CẢ THƯ MỤC CON (đệ quy), rút mã vận
//  đơn từ tên file, ghép sang OnlineOrder / ReturnOrder, trả về nhóm theo ngày.
//
//  Quy ước tên file:
//    Đóng hàng : DON_<tracking>_<timestamp>.webm
//    Hoàn hàng : HOANTRAHANG_<tracking>_<timestamp>.webm  (hoặc RETURN_)
//
//  Xác thực Drive: ADC trên Cloud Run — service account đã được share thư mục.
//  Cache riêng biệt theo từng folderId, TTL 5 phút.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response } from 'express'
import type { drive_v3 } from 'googleapis'
import { errMsg } from '../lib/errorResponse'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'

const router = Router()

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_FILES = 5000

// ─── Kiểu dữ liệu ───────────────────────────────────────────────────────────────

interface DriveVideoFile {
    id: string
    name: string
    webViewLink: string | null
    webContentLink: string | null
    thumbnailLink: string | null
    createdTime: string | null
    mimeType: string | null
    size: number | null
}

interface MatchedOrder {
    id: string
    orderNumber: string
    customerName: string
    total: number
    status: string
    platform: string | null
}

interface MatchedReturn {
    id: string
    code: string
    customerName: string
    status: string
    refundAmount: number
    reason: string
}

interface VideoWithOrder {
    videoId: string
    videoName: string
    videoUrl: string | null
    thumbnailUrl: string | null
    trackingNumber: string | null
    matchedOrder: MatchedOrder | null
    matchedReturn: MatchedReturn | null
    createdTime: string | null
    dateGroup: string // YYYY-MM-DD
    videoType: 'packing' | 'return' // đóng hàng hoặc mở hàng hoàn
}

// ─── Google Drive client (ADC, khởi tạo 1 lần) ──────────────────────────────────

let driveClient: drive_v3.Drive | null = null

function getDrive(): drive_v3.Drive {
    if (!driveClient) {
        const { google } = require('googleapis') as typeof import('googleapis')
        const auth = new google.auth.GoogleAuth({ scopes: DRIVE_SCOPES })
        driveClient = google.drive({ version: 'v3', auth })
    }
    return driveClient
}

// ─── Per-folder cache ──────────────────────────────────────────────────────────

const folderCaches = new Map<string, { at: number; files: DriveVideoFile[] }>()
const folderInFlight = new Map<string, Promise<DriveVideoFile[]>>()

/** Lấy folderId của cửa hàng từ StoreSettings */
async function getStoreFolderId(prisma: NonNullable<AuthRequest['storePrisma']>): Promise<string | null> {
    const s = await prisma.storeSettings.findFirst({ select: { driveFolderId: true } as any }) as any
    return s?.driveFolderId || null
}

/** Đệ quy tìm tất cả subfolder IDs */
async function listSubfolderIds(drive: drive_v3.Drive, parentId: string): Promise<string[]> {
    const ids: string[] = []
    let pageToken: string | undefined
    do {
        const resp = await drive.files.list({
            q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'nextPageToken, files(id)',
            pageSize: 1000,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            pageToken,
        })
        for (const f of resp.data.files || []) {
            if (f.id) ids.push(f.id)
        }
        pageToken = resp.data.nextPageToken || undefined
    } while (pageToken)

    // Đệ quy vào từng subfolder
    const nested: string[] = []
    for (const id of ids) {
        const sub = await listSubfolderIds(drive, id)
        nested.push(...sub)
    }
    return [...ids, ...nested]
}

/** Quét video trong root + tất cả subfolder */
async function fetchDriveVideos(folderId: string): Promise<DriveVideoFile[]> {
    const drive = getDrive()

    // Lấy tất cả subfolder IDs
    const subIds = await listSubfolderIds(drive, folderId)
    const allFolderIds = [folderId, ...subIds]

    // Build query: files in any of these folders
    const parentClauses = allFolderIds.map(id => `'${id}' in parents`).join(' or ')
    const query = `(${parentClauses}) and mimeType contains 'video' and trashed = false`

    const files: DriveVideoFile[] = []
    let pageToken: string | undefined

    do {
        const resp = await drive.files.list({
            q: query,
            fields: 'nextPageToken, files(id, name, mimeType, webViewLink, webContentLink, thumbnailLink, createdTime, size)',
            pageSize: 1000,
            orderBy: 'createdTime desc',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            pageToken,
        })

        for (const f of resp.data.files || []) {
            if (!f.id || !f.name) continue
            files.push({
                id: f.id,
                name: f.name,
                webViewLink: f.webViewLink || null,
                webContentLink: f.webContentLink || null,
                thumbnailLink: f.thumbnailLink || null,
                createdTime: f.createdTime || null,
                mimeType: f.mimeType || null,
                size: f.size != null ? Number(f.size) : null,
            })
        }

        pageToken = resp.data.nextPageToken || undefined
    } while (pageToken && files.length < MAX_FILES)

    return files
}

async function getDriveVideos(folderId: string, forceRefresh = false): Promise<DriveVideoFile[]> {
    const cached = folderCaches.get(folderId)
    if (!forceRefresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.files

    if (!folderInFlight.has(folderId)) {
        const p = fetchDriveVideos(folderId)
            .then(files => {
                folderCaches.set(folderId, { at: Date.now(), files })
                return files
            })
            .finally(() => { folderInFlight.delete(folderId) })
        folderInFlight.set(folderId, p)
    }

    try {
        return await folderInFlight.get(folderId)!
    } catch (err) {
        if (cached) {
            console.error('Drive list error, serving stale cache:', err)
            return cached.files
        }
        throw err
    }
}

// ─── Phân loại video: đóng hàng vs mở hàng hoàn ─────────────────────────────────

const RETURN_PREFIXES = /^(HOANTRAHANG|RETURN|HTH|UNBOX)/i

function isReturnVideo(filename: string): boolean {
    const base = filename.replace(/\.[a-z0-9]{2,5}$/i, '')
    return RETURN_PREFIXES.test(base)
}

// ─── Rút mã vận đơn từ tên file ─────────────────────────────────────────────────

export function extractTrackingCandidates(filename: string): string[] {
    const base = filename.replace(/\.[a-z0-9]{2,5}$/i, '')
    const upper = base.toUpperCase()
    const out: string[] = []
    const push = (v: string) => { if (v && !out.includes(v)) out.push(v) }

    for (const m of upper.matchAll(/SPXVN[A-Z0-9]+/g)) push(m[0])
    for (const m of upper.matchAll(/\bVN\d{6,}\b/g)) push(m[0])

    for (const token of upper.split(/[^A-Z0-9]+/)) {
        if (token.length < 8) continue
        if (!/\d/.test(token)) continue
        if (/^\d{8}$/.test(token) && /^(19|20)\d{6}$/.test(token)) continue // yyyymmdd
        push(token)
    }

    return out
}

// ─── Ghép video ↔ đơn hàng / hoàn hàng ─────────────────────────────────────────

async function matchVideosWithOrders(
    prisma: NonNullable<AuthRequest['storePrisma']>,
    files: DriveVideoFile[],
): Promise<VideoWithOrder[]> {
    const candidatesByFile = new Map<string, string[]>()
    const allCandidates = new Set<string>()

    for (const f of files) {
        const cands = extractTrackingCandidates(f.name)
        candidatesByFile.set(f.id, cands)
        for (const c of cands) {
            allCandidates.add(c)
            allCandidates.add(c.toLowerCase())
        }
    }

    // Match đơn hàng
    const orderByTracking = new Map<string, MatchedOrder>()
    if (allCandidates.size > 0) {
        const orders = await prisma.onlineOrder.findMany({
            where: { trackingNumber: { in: Array.from(allCandidates) } },
            select: {
                id: true, orderNumber: true, customerName: true,
                total: true, status: true, platform: true, trackingNumber: true,
            },
            orderBy: { createdAt: 'desc' },
        })
        for (const o of orders) {
            const key = String(o.trackingNumber || '').toUpperCase()
            if (!key || orderByTracking.has(key)) continue
            orderByTracking.set(key, {
                id: o.id, orderNumber: o.orderNumber,
                customerName: o.customerName, total: o.total,
                status: o.status, platform: o.platform ?? null,
            })
        }
    }

    // Match theo MÃ VẬN ĐƠN TRẢ — video mở hàng hoàn đặt tên theo mã của CHUYẾN
    // HÀNG KHÁCH GỬI VỀ, không phải mã gửi đi, nên dò OnlineOrder.trackingNumber
    // không bao giờ trúng → cả đám nằm ở "Chưa match". Mã trả nằm trong notes
    // phiếu trả dạng "Tracking: X" (returnSync ghi/làm tươi).
    const returnByTracking = new Map<string, MatchedReturn>()
    if (allCandidates.size > 0) {
        try {
            const rets = await prisma.returnOrder.findMany({
                where: { notes: { contains: 'Tracking: ' } },
                select: {
                    id: true, code: true, customerName: true,
                    status: true, refundAmount: true, reason: true, notes: true,
                },
                orderBy: { createdAt: 'desc' },
                take: 1500,
            })
            for (const r of rets) {
                const m = /(?:^|\n)\s*Tracking:\s*(.+?)\s*(?:\n|$)/i.exec(r.notes || '')
                const trk = m?.[1]?.trim().toUpperCase()
                if (!trk || trk === 'N/A' || returnByTracking.has(trk)) continue
                returnByTracking.set(trk, {
                    id: r.id, code: r.code, customerName: r.customerName,
                    status: r.status, refundAmount: r.refundAmount, reason: r.reason,
                })
            }
        } catch { /* ReturnOrder table might not exist */ }
    }

    // Match hoàn hàng — dò ReturnOrder theo originalInvoice (= orderNumber) của đơn đã match
    const returnByOrderNumber = new Map<string, MatchedReturn>()
    const matchedOrderNumbers = [...orderByTracking.values()].map(o => o.orderNumber)
    if (matchedOrderNumbers.length > 0) {
        try {
            const returns = await prisma.returnOrder.findMany({
                where: { originalInvoice: { in: matchedOrderNumbers } },
                select: {
                    id: true, code: true, customerName: true,
                    status: true, refundAmount: true, reason: true, originalInvoice: true,
                },
                orderBy: { createdAt: 'desc' },
            })
            for (const r of returns) {
                if (!returnByOrderNumber.has(r.originalInvoice)) {
                    returnByOrderNumber.set(r.originalInvoice, {
                        id: r.id, code: r.code, customerName: r.customerName,
                        status: r.status, refundAmount: r.refundAmount, reason: r.reason,
                    })
                }
            }
        } catch { /* ReturnOrder table might not exist */ }
    }

    return files.map(f => {
        const cands = candidatesByFile.get(f.id) || []
        const hit = cands.find(c => orderByTracking.has(c))
        const matchedOrder = hit ? orderByTracking.get(hit)! : null
        // Không trúng đơn gửi đi → thử mã vận đơn TRẢ. Trúng thì đây chắc chắn
        // là video mở hàng hoàn, bất kể tên file có đánh dấu hay không.
        const retHit = !matchedOrder ? cands.find(c => returnByTracking.has(c.toUpperCase())) : undefined
        const matchedByReturnTracking = retHit ? returnByTracking.get(retHit.toUpperCase())! : null
        const matchedReturn = matchedByReturnTracking
            || (matchedOrder ? returnByOrderNumber.get(matchedOrder.orderNumber) || null : null)
        const videoType = (matchedByReturnTracking || isReturnVideo(f.name)) ? 'return' as const : 'packing' as const

        // dateGroup = YYYY-MM-DD from createdTime
        let dateGroup = 'unknown'
        if (f.createdTime) {
            try { dateGroup = new Date(f.createdTime).toISOString().slice(0, 10) } catch { }
        }

        return {
            videoId: f.id,
            videoName: f.name,
            videoUrl: f.webViewLink,
            thumbnailUrl: f.thumbnailLink,
            trackingNumber: hit || retHit || cands[0] || null,
            matchedOrder,
            matchedReturn: videoType === 'return' ? matchedReturn : null,
            createdTime: f.createdTime,
            dateGroup,
            videoType,
        }
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/drive-videos/videos — danh sách video kèm đơn đã ghép
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
//  KẾT NỐI GOOGLE DRIVE BẰNG TÀI KHOẢN CHỦ SHOP
//  Cần cho việc TỰ DỌN VIDEO: file My Drive chỉ chủ sở hữu xoá được.
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/drive-videos/oauth/status — đã kết nối chưa, tài khoản nào
router.get('/oauth/status', authMiddleware, requirePermission('settings.view', 'online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const { driveOAuthConfigured, driveRedirectUri } = await import('../lib/driveOAuth')
        const st = await (req.storePrisma as any).storeSettings
            .findFirst({ select: { driveOauthEmail: true, driveOauthAt: true, driveFolderId: true } as any })
            .catch(() => null) as any
        res.json({
            success: true,
            data: {
                daCauHinh: driveOAuthConfigured(),
                daKetNoi: !!st?.driveOauthEmail,
                email: st?.driveOauthEmail || null,
                ketNoiLuc: st?.driveOauthAt || null,
                coThuMuc: !!st?.driveFolderId,
                redirectUri: driveRedirectUri(),
            },
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/drive-videos/oauth/url — lấy link đưa chủ shop sang Google đồng ý
router.get('/oauth/url', authMiddleware, requirePermission('settings.edit_store', 'settings.view'), async (req: AuthRequest, res: Response) => {
    try {
        const { driveOAuthConfigured, buildDriveAuthUrl } = await import('../lib/driveOAuth')
        if (!driveOAuthConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Chưa cấu hình Google OAuth trên máy chủ (GOOGLE_OAUTH_CLIENT_ID/SECRET) — báo Kengi bật giúp.',
            })
        }
        // state chỉ để chống lạc trang, KHÔNG dùng để quyết định lưu token vào
        // cửa hàng nào — cửa hàng được lấy từ PHIÊN ĐĂNG NHẬP ở bước /oauth/complete.
        const state = Buffer.from(JSON.stringify({ t: Date.now() })).toString('base64url')
        res.json({ success: true, data: { url: buildDriveAuthUrl(state) } })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/drive-videos/oauth/callback — Google gọi lại sau khi chủ shop đồng ý.
//
// ⚠ CALLBACK NÀY TUYỆT ĐỐI KHÔNG GHI TOKEN. Nó chỉ chuyển mã về web, y như
// callback Shopee/TikTok trong routes/onlineOrders.ts. Lý do (lỗ hổng đã suýt
// phát hành 06/08/2026): callback công khai không mang phiên đăng nhập, nếu lấy
// mã cửa hàng từ 'state' thì kẻ xấu tự dựng liên kết với state trỏ cửa hàng
// khác, rồi:
//   • tự đăng nhập Google của hắn → ghi đè kết nối của cửa hàng nạn nhân, hoặc
//   • gửi liên kết cho chủ shop nạn nhân → refresh_token TOÀN QUYỀN DRIVE của
//     nạn nhân rơi vào cửa hàng của hắn, cron đêm dọn video Drive cá nhân nạn nhân.
// Cách chặn: cửa hàng nhận token LUÔN lấy từ PHIÊN ĐĂNG NHẬP ở /oauth/complete,
// không bao giờ từ tham số trên URL.
router.get('/oauth/callback', async (req, res: Response) => {
    const webBase = process.env.PUBLIC_WEB_URL || 'https://kengi.vn'
    if (req.query.error) {
        return res.redirect(`${webBase}/dashboard-settings?driveOauth=loi&msg=${encodeURIComponent(`Bạn đã từ chối cấp quyền (${req.query.error})`)}`)
    }
    const code = String(req.query.code || '')
    if (!code) {
        return res.redirect(`${webBase}/dashboard-settings?driveOauth=loi&msg=${encodeURIComponent('Thiếu mã xác thực từ Google')}`)
    }
    // Trả mã về web; web đang có phiên đăng nhập sẽ gọi /oauth/complete để đổi
    // token và lưu vào ĐÚNG cửa hàng của người đang đăng nhập.
    return res.redirect(`${webBase}/dashboard-settings?driveCode=${encodeURIComponent(code)}`)
})

// POST /api/drive-videos/oauth/complete { code } — đổi mã lấy token và lưu vào
// cửa hàng CỦA NGƯỜI ĐANG ĐĂNG NHẬP (req.storePrisma từ JWT). Đây là chỗ duy
// nhất được ghi token Drive.
router.post('/oauth/complete', authMiddleware, requirePermission('settings.edit_store', 'settings.view'), async (req: AuthRequest, res: Response) => {
    try {
        const code = String(req.body?.code || '').trim()
        if (!code) return res.status(400).json({ success: false, error: 'Thiếu mã xác thực' })
        const { driveOAuthConfigured, exchangeDriveCode } = await import('../lib/driveOAuth')
        if (!driveOAuthConfigured()) {
            return res.status(503).json({ success: false, error: 'Máy chủ chưa cấu hình Google OAuth' })
        }
        const { refreshToken, email } = await exchangeDriveCode(code)

        const sp = req.storePrisma as any
        // Cột có thể chưa migrate ở schema cũ → tự vá rồi ghi
        await sp.$executeRawUnsafe(`ALTER TABLE "StoreSettings" ADD COLUMN IF NOT EXISTS "driveOauthToken" TEXT`).catch(() => { })
        await sp.$executeRawUnsafe(`ALTER TABLE "StoreSettings" ADD COLUMN IF NOT EXISTS "driveOauthEmail" TEXT`).catch(() => { })
        await sp.$executeRawUnsafe(`ALTER TABLE "StoreSettings" ADD COLUMN IF NOT EXISTS "driveOauthAt" TIMESTAMP(3)`).catch(() => { })
        const cur = await sp.storeSettings.findFirst({ select: { id: true } }).catch(() => null)
        if (cur) {
            await sp.storeSettings.update({
                where: { id: cur.id },
                data: { driveOauthToken: refreshToken, driveOauthEmail: email, driveOauthAt: new Date() } as any,
            })
        } else {
            await sp.storeSettings.create({
                data: { id: 'default', driveOauthToken: refreshToken, driveOauthEmail: email, driveOauthAt: new Date() } as any,
            })
        }
        // KHÔNG log refresh_token — chỉ email để đối chiếu
        console.log(`[DriveOAuth] ${req.user?.storeCode}: đã kết nối tài khoản ${email}`)
        res.json({ success: true, data: { email } })
    } catch (err: any) {
        console.error('[DriveOAuth complete]', err?.message || err)
        res.status(500).json({ success: false, error: String(err?.message || 'Kết nối thất bại').slice(0, 200) })
    }
})

// POST /api/drive-videos/oauth/disconnect — gỡ kết nối (xoá token đã lưu)
router.post('/oauth/disconnect', authMiddleware, requirePermission('settings.edit_store', 'settings.view'), async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const cur = await sp.storeSettings.findFirst({ select: { id: true } }).catch(() => null)
        if (cur) {
            await sp.storeSettings.update({
                where: { id: cur.id },
                data: { driveOauthToken: null, driveOauthEmail: null, driveOauthAt: null } as any,
            })
        }
        res.json({ success: true })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

router.get('/videos', authMiddleware, requirePermission('online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma
        if (!prisma) {
            res.status(400).json({ success: false, error: 'Store context required' })
            return
        }

        const folderId = await getStoreFolderId(prisma)
        if (!folderId) {
            res.json({
                success: true,
                data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0, dateGroups: [], configured: false },
            })
            return
        }

        const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
        const limitRaw = parseInt(String(req.query.limit ?? '20'), 10) || 20
        const limit = Math.min(200, Math.max(1, limitRaw))
        const matchedFilter = String(req.query.matched ?? 'all').toLowerCase()
        const typeFilter = String(req.query.type ?? 'all').toLowerCase() // all | packing | return
        const dateFilter = String(req.query.date ?? '').trim() // YYYY-MM-DD
        const search = String(req.query.search ?? '').trim().toLowerCase()
        const forceRefresh = ['1', 'true'].includes(String(req.query.refresh ?? '').toLowerCase())

        const files = await getDriveVideos(folderId, forceRefresh)
        let items = await matchVideosWithOrders(prisma, files)

        // Filters
        // "Đã match" gồm cả video trúng PHIẾU TRẢ (matchedOrder=null nhưng
        // matchedReturn có) — video mở hàng hoàn khớp mã vận đơn trả là match thật.
        if (matchedFilter === 'matched') items = items.filter(v => v.matchedOrder !== null || v.matchedReturn !== null)
        else if (matchedFilter === 'unmatched') items = items.filter(v => v.matchedOrder === null && v.matchedReturn === null)

        if (typeFilter === 'packing') items = items.filter(v => v.videoType === 'packing')
        else if (typeFilter === 'return') items = items.filter(v => v.videoType === 'return')

        if (dateFilter) items = items.filter(v => v.dateGroup === dateFilter)

        if (search) {
            items = items.filter(v =>
                v.videoName.toLowerCase().includes(search) ||
                (v.trackingNumber || '').toLowerCase().includes(search) ||
                (v.matchedOrder?.orderNumber || '').toLowerCase().includes(search)
            )
        }

        // Collect unique date groups (for date filter dropdown)
        const dateGroupSet = new Set(items.map(v => v.dateGroup))
        const dateGroups = [...dateGroupSet].sort().reverse()

        const total = items.length
        const totalPages = Math.ceil(total / limit) || 1
        const paged = items.slice((page - 1) * limit, page * limit)

        const fc = folderCaches.get(folderId)
        res.json({
            success: true,
            data: {
                items: paged,
                total,
                page,
                pageSize: limit,
                totalPages,
                dateGroups,
                configured: true,
                cachedAt: fc ? new Date(fc.at).toISOString() : null,
            },
        })
    } catch (err) {
        console.error('Get drive videos error:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không lấy được danh sách video từ Google Drive') })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/drive-videos/videos/:videoId/stream — link xem/nhúng video
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/videos/:videoId/stream', authMiddleware, requirePermission('online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const videoId = String(req.params.videoId || '').trim()
        if (!videoId) {
            res.status(400).json({ success: false, error: 'Thiếu videoId' })
            return
        }

        const drive = getDrive()
        const resp = await drive.files.get({
            fileId: videoId,
            fields: 'id, name, mimeType, parents, webViewLink, webContentLink, thumbnailLink, size',
            supportsAllDrives: true,
        })
        const file = resp.data

        res.json({
            success: true,
            data: {
                videoId: file.id,
                videoName: file.name,
                mimeType: file.mimeType || null,
                embedUrl: `https://drive.google.com/file/d/${file.id}/preview`,
                webViewLink: file.webViewLink || null,
                webContentLink: file.webContentLink || null,
                thumbnailUrl: file.thumbnailLink || null,
                size: file.size != null ? Number(file.size) : null,
            },
        })
    } catch (err: any) {
        if (err?.code === 404 || err?.response?.status === 404) {
            res.status(404).json({ success: false, error: 'Không tìm thấy video' })
            return
        }
        console.error('Get drive video stream error:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không lấy được link video') })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/drive-videos/stats — tổng hợp số video / đã ghép / chưa ghép
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/stats', authMiddleware, requirePermission('online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma
        if (!prisma) {
            res.status(400).json({ success: false, error: 'Store context required' })
            return
        }

        const folderId = await getStoreFolderId(prisma)
        if (!folderId) {
            res.json({
                success: true,
                data: { totalVideos: 0, matched: 0, unmatched: 0, packingVideos: 0, returnVideos: 0, configured: false },
            })
            return
        }

        const files = await getDriveVideos(folderId)
        const items = await matchVideosWithOrders(prisma, files)
        const matched = items.filter(v => v.matchedOrder !== null || v.matchedReturn !== null).length
        const packingVideos = items.filter(v => v.videoType === 'packing').length
        const returnVideos = items.filter(v => v.videoType === 'return').length

        const fc = folderCaches.get(folderId)
        res.json({
            success: true,
            data: {
                totalVideos: items.length,
                matched,
                unmatched: items.length - matched,
                packingVideos,
                returnVideos,
                folderId,
                configured: true,
                cachedAt: fc ? new Date(fc.at).toISOString() : null,
            },
        })
    } catch (err) {
        console.error('Get drive videos stats error:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không lấy được thống kê video') })
    }
})

export default router
