// ═══════════════════════════════════════════════════════════════════════════════
//  DRIVE VIDEOS — ghép video đóng gói trên Google Drive với đơn sàn theo mã vận đơn
//
//  Video quay lúc đóng gói được upload vào MỘT thư mục Drive dùng chung, tên file
//  có kèm mã vận đơn (vd: donhang_VN123456789_2026.mp4). Route này liệt kê video
//  trong thư mục, rút mã vận đơn từ tên file rồi dò sang OnlineOrder của cửa hàng
//  đang đăng nhập (multi-tenant — luôn dùng req.storePrisma).
//
//  Xác thực Drive: ADC (Application Default Credentials) trên Cloud Run — service
//  account 445765742612-compute@developer.gserviceaccount.com đã được share thư mục.
//  Không nhúng credentials vào code.
//
//  Danh sách file Drive được cache 5 phút (dùng chung mọi cửa hàng vì chỉ có 1 thư
//  mục) để không đụng rate limit; phần dò đơn thì luôn chạy lại theo từng store.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response } from 'express'
import type { drive_v3 } from 'googleapis'
import { errMsg } from '../lib/errorResponse'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'

const router = Router()

// Thư mục Drive chứa video đóng gói. Cho phép override bằng env để đổi thư mục
// mà không phải deploy lại code.
const FOLDER_ID = process.env.DRIVE_PACKING_VIDEOS_FOLDER_ID || '1CdpkNvJPdwJGP9KQO6mYZoNouSH_vPVQ'
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_FILES = 5000 // chặn trên, tránh kéo vô hạn nếu thư mục phình to

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

interface VideoWithOrder {
    videoId: string
    videoName: string
    videoUrl: string | null
    thumbnailUrl: string | null
    trackingNumber: string | null
    matchedOrder: MatchedOrder | null
    createdTime: string | null
}

// ─── Google Drive client (ADC, khởi tạo 1 lần) ──────────────────────────────────

let driveClient: drive_v3.Drive | null = null

/**
 * Nạp googleapis THEO YÊU CẦU chứ không import ở đầu file: require('googleapis')
 * tốn ~1.1s và ~83MB heap, mà tuyệt đại đa số request của POS không đụng Drive —
 * để ở top-level là bắt mọi cold start Cloud Run trả giá đó.
 */
function getDrive(): drive_v3.Drive {
    if (!driveClient) {
        const { google } = require('googleapis') as typeof import('googleapis')
        const auth = new google.auth.GoogleAuth({ scopes: DRIVE_SCOPES })
        driveClient = google.drive({ version: 'v3', auth })
    }
    return driveClient
}

// ─── Cache danh sách file Drive ─────────────────────────────────────────────────

let cache: { at: number; files: DriveVideoFile[] } | null = null
let inFlight: Promise<DriveVideoFile[]> | null = null // gộp request đồng thời, tránh gọi Drive N lần

async function fetchDriveVideos(): Promise<DriveVideoFile[]> {
    const drive = getDrive()
    const files: DriveVideoFile[] = []
    let pageToken: string | undefined

    do {
        const resp = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and mimeType contains 'video' and trashed = false`,
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

async function getDriveVideos(forceRefresh = false): Promise<DriveVideoFile[]> {
    if (!forceRefresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.files

    // Chỉ request ĐẦU TIÊN gọi Drive; các request đến cùng lúc bám vào cùng promise.
    // Mọi request đều đi qua try/catch bên dưới để cùng được hưởng fallback cache cũ.
    if (!inFlight) {
        inFlight = fetchDriveVideos()
            .then(files => {
                cache = { at: Date.now(), files }
                return files
            })
            .finally(() => { inFlight = null })
    }

    try {
        return await inFlight
    } catch (err) {
        // Drive lỗi mà vẫn còn cache cũ → dùng tạm cache thay vì ném 500
        if (cache) {
            console.error('Drive list error, serving stale cache:', err)
            return cache.files
        }
        throw err
    }
}

// ─── Rút mã vận đơn từ tên file ─────────────────────────────────────────────────

/**
 * Trả về danh sách ứng viên mã vận đơn trong tên file, xếp theo độ tin cậy giảm dần.
 *
 * Ưu tiên:
 *   1. SPXVN + chữ/số  (Shopee Express VN)
 *   2. VN + số         (vd VN123456789)
 *   3. Token chữ-số bất kỳ giữa các dấu phân cách, dài >= 8 và có ít nhất 1 chữ số
 *      (bắt các dạng mã của TikTok/GHN/J&T… mà không nuốt nhầm "donhang" hay "2026")
 *
 * Mã trả về đã UPPERCASE để so khớp ổn định.
 */
export function extractTrackingCandidates(filename: string): string[] {
    const base = filename.replace(/\.[a-z0-9]{2,5}$/i, '') // bỏ đuôi mở rộng
    const upper = base.toUpperCase()
    const out: string[] = []
    const push = (v: string) => { if (v && !out.includes(v)) out.push(v) }

    for (const m of upper.matchAll(/SPXVN[A-Z0-9]+/g)) push(m[0])
    for (const m of upper.matchAll(/\bVN\d{6,}\b/g)) push(m[0])

    // Token giữa các dấu phân cách thường gặp trong tên file
    for (const token of upper.split(/[^A-Z0-9]+/)) {
        if (token.length < 8) continue
        if (!/\d/.test(token)) continue   // toàn chữ → không phải mã vận đơn
        if (/^\d{8}$/.test(token) && /^(19|20)\d{6}$/.test(token)) continue // yyyymmdd
        push(token)
    }

    return out
}

// ─── Ghép video ↔ đơn hàng ──────────────────────────────────────────────────────

/**
 * Dò đơn cho từng video bằng ĐÚNG MỘT query findMany (pool Prisma mỗi store rất
 * nhỏ — không được bắn N query song song).
 */
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
            allCandidates.add(c.toLowerCase()) // trackingNumber trong DB có thể khác hoa/thường
        }
    }

    // Map UPPERCASE(trackingNumber) → đơn, để tra ngược không phụ thuộc hoa/thường
    const orderByTracking = new Map<string, MatchedOrder>()
    if (allCandidates.size > 0) {
        const orders = await prisma.onlineOrder.findMany({
            where: { trackingNumber: { in: Array.from(allCandidates) } },
            select: {
                id: true,
                orderNumber: true,
                customerName: true,
                total: true,
                status: true,
                platform: true,
                trackingNumber: true,
            },
            orderBy: { createdAt: 'desc' },
        })

        for (const o of orders) {
            const key = String(o.trackingNumber || '').toUpperCase()
            if (!key || orderByTracking.has(key)) continue // giữ đơn mới nhất nếu trùng mã
            orderByTracking.set(key, {
                id: o.id,
                orderNumber: o.orderNumber,
                customerName: o.customerName,
                total: o.total,
                status: o.status,
                platform: o.platform ?? null,
            })
        }
    }

    return files.map(f => {
        const cands = candidatesByFile.get(f.id) || []
        const hit = cands.find(c => orderByTracking.has(c))
        return {
            videoId: f.id,
            videoName: f.name,
            videoUrl: f.webViewLink,
            thumbnailUrl: f.thumbnailLink,
            trackingNumber: hit || cands[0] || null,
            matchedOrder: hit ? orderByTracking.get(hit)! : null,
            createdTime: f.createdTime,
        }
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/drive-videos/videos — danh sách video kèm đơn đã ghép
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/videos', authMiddleware, requirePermission('online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma
        if (!prisma) {
            res.status(400).json({ success: false, error: 'Store context required' })
            return
        }

        const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
        const limitRaw = parseInt(String(req.query.limit ?? '20'), 10) || 20
        const limit = Math.min(200, Math.max(1, limitRaw))
        const matchedFilter = String(req.query.matched ?? 'all').toLowerCase()
        const search = String(req.query.search ?? '').trim().toLowerCase()
        const forceRefresh = ['1', 'true'].includes(String(req.query.refresh ?? '').toLowerCase())

        const files = await getDriveVideos(forceRefresh)
        let items = await matchVideosWithOrders(prisma, files)

        if (matchedFilter === 'matched') items = items.filter(v => v.matchedOrder !== null)
        else if (matchedFilter === 'unmatched') items = items.filter(v => v.matchedOrder === null)

        if (search) {
            items = items.filter(v =>
                v.videoName.toLowerCase().includes(search) ||
                (v.trackingNumber || '').toLowerCase().includes(search) ||
                (v.matchedOrder?.orderNumber || '').toLowerCase().includes(search)
            )
        }

        const total = items.length
        const totalPages = Math.ceil(total / limit) || 1
        const paged = items.slice((page - 1) * limit, page * limit)

        res.json({
            success: true,
            data: {
                items: paged,
                total,
                page,
                pageSize: limit,
                totalPages,
                cachedAt: cache ? new Date(cache.at).toISOString() : null,
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

        // Chỉ phục vụ file NẰM TRONG thư mục video đóng gói — nếu không endpoint này
        // thành cửa đọc mọi file mà service account nhìn thấy.
        if (!file.parents || !file.parents.includes(FOLDER_ID)) {
            res.status(404).json({ success: false, error: 'Không tìm thấy video' })
            return
        }

        res.json({
            success: true,
            data: {
                videoId: file.id,
                videoName: file.name,
                mimeType: file.mimeType || null,
                // iframe nhúng phát trực tiếp trong dashboard
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

        const files = await getDriveVideos()
        const items = await matchVideosWithOrders(prisma, files)
        const matched = items.filter(v => v.matchedOrder !== null).length

        res.json({
            success: true,
            data: {
                totalVideos: items.length,
                matched,
                unmatched: items.length - matched,
                folderId: FOLDER_ID,
                cachedAt: cache ? new Date(cache.at).toISOString() : null,
            },
        })
    } catch (err) {
        console.error('Get drive videos stats error:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không lấy được thống kê video') })
    }
})

export default router
