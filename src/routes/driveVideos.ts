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
import { mapWithConcurrency } from '../lib/prisma'

const router = Router()

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
const CACHE_TTL_MS = 5 * 60 * 1000
// Quá 5 phút vẫn trả bản liệt kê cũ (≤ 6 giờ) rồi làm mới ngầm
const STALE_MAX_MS = 6 * 60 * 60 * 1000
// Trần cho bản LIỆT KÊ (trang duyệt video). Thư mục KENGISTORE có 23.610 video (đo
// 03/10/2026) — liệt kê đủ mất ~60s nên vẫn giữ trần, nhưng KHÔNG im lặng nữa: trả
// `biCatTran` + ngày video cũ nhất còn thấy. Tra theo MÃ đi đường tìm thẳng, không dính trần.
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

const folderCaches = new Map<string, { at: number; files: DriveVideoFile[]; capped: boolean }>()
const folderInFlight = new Map<string, Promise<DriveVideoFile[]>>()

/** Bản liệt kê có bị trần MAX_FILES cắt không, và video cũ nhất còn thấy là ngày nào */
function thongTinTran(folderId: string): { biCatTran: boolean; videoCuNhatTrongDanhSach: string | null } {
    const c = folderCaches.get(folderId)
    return { biCatTran: !!c?.capped, videoCuNhatTrongDanhSach: c?.files[c.files.length - 1]?.createdTime ?? null }
}

/** Lấy folderId của cửa hàng từ StoreSettings */
async function getStoreFolderId(prisma: NonNullable<AuthRequest['storePrisma']>): Promise<string | null> {
    const s = await prisma.storeSettings.findFirst({ select: { driveFolderId: true } as any }) as any
    return s?.driveFolderId || null
}

/** Thư mục con TRỰC TIẾP của một thư mục */
async function listDirectSubfolders(drive: drive_v3.Drive, parentId: string): Promise<string[]> {
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
    return ids
}

/** Mọi thư mục con (đệ quy) — duyệt THEO TẦNG, mỗi tầng hỏi song song. Đo 03/10/2026:
 *  24 thư mục con hỏi tuần tự mất 10,5–11s, và lượt tra video nào hết cache cũng trả
 *  khoản đó (cộng liệt kê = 21–25s/lượt, quá hạn 15s của web). */
async function listSubfolderIds(drive: drive_v3.Drive, rootId: string): Promise<string[]> {
    const all: string[] = []
    let tang = [rootId]
    for (let sau = 0; tang.length > 0 && sau < 10; sau++) {
        tang = (await mapWithConcurrency(tang, id => listDirectSubfolders(drive, id), 6)).flat()
        all.push(...tang)
    }
    return all
}

// Thư mục con hiếm khi đổi — giữ 10 phút, quá hạn thì vẫn dùng bản cũ và làm mới ngầm.
const SUBFOLDER_TTL_MS = 10 * 60 * 1000
const subfolderCaches = new Map<string, { at: number; ids: string[] }>()
const subfolderInFlight = new Map<string, Promise<string[]>>()

async function getSubfolderIds(drive: drive_v3.Drive, folderId: string): Promise<string[]> {
    const lamMoi = () => {
        let p = subfolderInFlight.get(folderId)
        if (!p) {
            p = listSubfolderIds(drive, folderId)
                .then(ids => { subfolderCaches.set(folderId, { at: Date.now(), ids }); return ids })
                .finally(() => { subfolderInFlight.delete(folderId) })
            subfolderInFlight.set(folderId, p)
        }
        return p
    }
    const c = subfolderCaches.get(folderId)
    if (!c) return lamMoi()
    if (Date.now() - c.at > SUBFOLDER_TTL_MS) lamMoi().catch(err => console.error('Drive subfolder refresh error:', err))
    return c.ids
}

const parentsClause = (folderId: string, subIds: string[]) =>
    `(${[folderId, ...subIds].map(id => `'${id}' in parents`).join(' or ')})`

/** Quét video trong root + tất cả subfolder */
async function fetchDriveVideos(folderId: string): Promise<{ files: DriveVideoFile[]; capped: boolean }> {
    const drive = getDrive()
    const subIds = await getSubfolderIds(drive, folderId)
    const query = `${parentsClause(folderId, subIds)} and mimeType contains 'video' and trashed = false`

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

    return { files, capped: !!pageToken }
}

async function getDriveVideos(folderId: string, forceRefresh = false): Promise<DriveVideoFile[]> {
    const cached = folderCaches.get(folderId)
    if (!forceRefresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.files

    if (!folderInFlight.has(folderId)) {
        const p = fetchDriveVideos(folderId)
            .then(({ files, capped }) => {
                folderCaches.set(folderId, { at: Date.now(), files, capped })
                return files
            })
            .finally(() => { folderInFlight.delete(folderId) })
        folderInFlight.set(folderId, p)
    }

    // Có bản liệt kê chưa quá STALE_MAX_MS thì trả NGAY, làm mới ngầm — trước đây cứ
    // 5 phút người dùng lại phải chờ một lượt liệt kê 20s+ (quá hạn 15s của web).
    if (!forceRefresh && cached && Date.now() - cached.at < STALE_MAX_MS) {
        folderInFlight.get(folderId)!.catch(err => console.error('Drive list refresh error:', err))
        return cached.files
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

/** Tra THẲNG trên Drive theo một mã — không liệt kê cả thư mục (03/10/2026).
 *  Đường liệt kê cũ: 21–25s mỗi lượt hết cache (quá hạn 15s của web ⇒ dòng video ở vụ
 *  trả biến mất) và chỉ thấy 5.000 video mới nhất (thư mục có 23.610 ⇒ mọi video trước
 *  07/09 coi như không có). Đo: `name contains` ra đúng file trong ~0,5–0,8s, bắt được
 *  cả mã dính chữ thừa phía trước (vVNGH80400469901); `fullText contains` thì hụt. */
async function timVideoTheoMa(folderId: string, ma: string): Promise<DriveVideoFile[]> {
    const drive = getDrive()
    const subIds = await getSubfolderIds(drive, folderId)
    const resp = await drive.files.list({
        q: `${parentsClause(folderId, subIds)} and name contains '${ma}' and mimeType contains 'video' and trashed = false`,
        fields: 'files(id, name, mimeType, webViewLink, webContentLink, thumbnailLink, createdTime, size)',
        pageSize: 50,
        orderBy: 'createdTime desc',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    })
    const can = ma.toUpperCase()
    const daCo = new Set<string>()
    const files: DriveVideoFile[] = []
    for (const f of resp.data.files || []) {
        // Cùng nghĩa "chứa chuỗi" như đường liệt kê; tên trùng (máy quay tải 2 lần) lấy bản mới nhất
        if (!f.id || !f.name || !f.name.toUpperCase().includes(can) || daCo.has(f.name)) continue
        daCo.add(f.name)
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
    return files
}

// ─── Phân loại video: đóng hàng vs mở hàng hoàn ─────────────────────────────────

// "HOAN_<mã>_<giờ>.webm" là tên máy quay đặt cho video mở hàng hoàn (đo 03/10/2026)
const RETURN_PREFIXES = /^(HOANTRAHANG|HOAN|RETURN|HTH|UNBOX)/i

function isReturnVideo(filename: string): boolean {
    const base = filename.replace(/\.[a-z0-9]{2,5}$/i, '')
    return RETURN_PREFIXES.test(base)
}

// ─── Rút mã vận đơn từ tên file ─────────────────────────────────────────────────

// Chữ trong tên file không bao giờ là mã vận đơn (tiền tố máy quay đặt)
const TU_KHONG_PHAI_MA = new Set(['HOANTRAHANG', 'DONGHANG', 'DONGGOI', 'MOHANG', 'UNBOXING'])

/* Tên file máy quay đặt: DON_<mã>_<người đóng>_<giờ quay ms>.webm. Đo 03/10/2026:
 *  - Mã GHN có khi TOÀN CHỮ (GYRBCRLA — đơn SPE-261001G3J7U1DX). Bản cũ bắt mã phải có
 *    chữ số ⇒ bỏ mất mã, chỉ còn giờ quay 1790932751647 ⇒ màn hình hiện số đó thay mã,
 *    "Chưa match" (8 video/3 ngày).
 *  - Mã dính một chữ thường thừa phía trước (vVNGH80400469901 — gõ/quét lỗi) ⇒ thêm
 *    bản bỏ chữ đó (VNGH80400469901 = đơn TIK-586362264440898959).
 *  - Giờ quay (13 số, epoch ms) vẫn giữ làm ứng viên nhưng xếp CUỐI, để mã thật đứng đầu
 *    (ứng viên đầu là mã hiện ra khi chưa ghép được). */
export function extractTrackingCandidates(filename: string): string[] {
    const base = filename.replace(/\.[a-z0-9]{2,5}$/i, '')
    const upper = base.toUpperCase()
    const out: string[] = []
    const cuoi: string[] = []
    const push = (v: string) => { if (v && !out.includes(v)) out.push(v) }

    for (const m of upper.matchAll(/SPXVN[A-Z0-9]+/g)) push(m[0])
    for (const m of upper.matchAll(/\bVN\d{6,}\b/g)) push(m[0])

    for (const token of upper.split(/[^A-Z0-9]+/)) {
        if (token.length < 8) continue
        if (/^\d{8}$/.test(token) && /^(19|20)\d{6}$/.test(token)) continue // yyyymmdd
        if (/^1[5-9]\d{11}$/.test(token)) { cuoi.push(token); continue } // giờ quay epoch ms (2017–2033)
        if (!/\d/.test(token) && (token.length > 20 || TU_KHONG_PHAI_MA.has(token))) continue
        push(token)
    }
    // Chữ thường thừa dính đầu mã: "vVNGH80400469901" ⇒ thêm "VNGH80400469901"
    for (const m of base.matchAll(/(?:^|[^A-Za-z0-9])[a-z]([A-Z0-9]{8,})(?=[^A-Za-z0-9]|$)/g)) push(m[1])
    for (const t of cuoi) push(t)

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
    // Ít ứng viên (tra theo mã) ⇒ hỏi đúng mã đó; nhiều (trang duyệt) ⇒ lấy mọi phiếu có mã
    // trả. Bỏ `take: 1500` cũ — trần cắt âm thầm (đang có 589 phiếu, sẽ vượt).
    const returnByTracking = new Map<string, MatchedReturn>()
    if (allCandidates.size > 0) {
        try {
            const maHoa = [...new Set([...allCandidates].map(c => c.toUpperCase()))]
            const rets = await prisma.returnOrder.findMany({
                where: maHoa.length <= 40
                    ? { OR: maHoa.map(c => ({ notes: { contains: `Tracking: ${c}`, mode: 'insensitive' as const } })) }
                    : { notes: { contains: 'Tracking: ' } },
                select: {
                    id: true, code: true, customerName: true,
                    status: true, refundAmount: true, reason: true, notes: true,
                },
                orderBy: { createdAt: 'desc' },
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

        // Tra theo MÃ (dòng video ở vụ trả / khiếu nại gửi exact=1; ô tìm của trang gõ mã)
        // ⇒ tìm thẳng trên Drive: mọi video, không trần, ~1s. Trang gõ mã mà Drive không ra
        // (gõ dở giữa mã, gõ mã ĐƠN…) ⇒ rơi về đường liệt kê như cũ; exact=1 thì thôi.
        const exact = ['1', 'true'].includes(String(req.query.exact ?? '').toLowerCase())
        const searchRaw = String(req.query.search ?? '').trim()
        let files: DriveVideoFile[] | null = null
        let timThang = false
        if (/^[A-Za-z0-9]{6,40}$/.test(searchRaw) && !forceRefresh) {
            const thay = await timVideoTheoMa(folderId, searchRaw)
            if (thay.length || exact) { files = thay; timThang = true }
        }
        if (!files) files = await getDriveVideos(folderId, forceRefresh)
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
                cachedAt: timThang ? null : fc ? new Date(fc.at).toISOString() : null,
                timThang,
                ...(timThang ? { biCatTran: false, videoCuNhatTrongDanhSach: null } : thongTinTran(folderId)),
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
                ...thongTinTran(folderId),
            },
        })
    } catch (err) {
        console.error('Get drive videos stats error:', err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không lấy được thống kê video') })
    }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  BỘ ĐO CHỈ ĐỌC (03/10/2026) — gọi từ GET /api/admin/do-video-dong-hang
//  Trả lời bằng số: tên file còn mang mã vận đơn không, ghép được bao nhiêu đơn
//  theo từng ngày, trần MAX_FILES có cắt mất video cũ không, quét Drive tốn bao
//  lâu, và với từng mã cho trước: file nào chứa nó, đứng thứ mấy, ghép ra đơn nào.
// ═══════════════════════════════════════════════════════════════════════════════

const ngayVN = (t: string | null) => (t ? new Date(new Date(t).getTime() + 7 * 3600_000).toISOString().slice(0, 10) : 'khong-ro')

export async function doVideoDongHang(
    prisma: NonNullable<AuthRequest['storePrisma']>,
    opts: { soNgay: number; ma: string[] },
) {
    const folderId = await getStoreFolderId(prisma)
    if (!folderId) return { configured: false }
    const drive = getDrive()

    const t0 = Date.now()
    const subIds = await listSubfolderIds(drive, folderId)
    const msThuMucCon = Date.now() - t0
    const q = `(${[folderId, ...subIds].map(id => `'${id}' in parents`).join(' or ')}) and mimeType contains 'video' and trashed = false`

    // Đếm ĐỦ, không trần — để biết MAX_FILES có đang cắt video cũ không.
    const t1 = Date.now()
    const tatCa: { id: string; name: string; createdTime: string | null }[] = []
    let pageToken: string | undefined
    let soTrang = 0
    do {
        const resp = await drive.files.list({
            q, fields: 'nextPageToken, files(id, name, createdTime)', pageSize: 1000, orderBy: 'createdTime desc',
            supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken,
        })
        for (const f of resp.data.files || []) if (f.id && f.name) tatCa.push({ id: f.id, name: f.name, createdTime: f.createdTime || null })
        pageToken = resp.data.nextPageToken || undefined
        soTrang++
    } while (pageToken && soTrang < 40)
    const msLietKe = Date.now() - t1

    const moc = Date.now() - opts.soNgay * 86_400_000
    const trongKhung = tatCa.filter(f => f.createdTime && new Date(f.createdTime).getTime() >= moc)
    const asFile = (f: typeof tatCa[number]): DriveVideoFile => ({
        id: f.id, name: f.name, createdTime: f.createdTime,
        webViewLink: null, webContentLink: null, thumbnailLink: null, mimeType: null, size: null,
    })
    const ghep = await matchVideosWithOrders(prisma, trongKhung.map(asFile))

    const theoNgay: Record<string, { tong: number; khongMa: number; coMaKhongKhop: number; khop: number; videoTra: number }> = {}
    const mauKhongMa: { ten: string; luc: string | null }[] = []
    const khongKhop: { ten: string; luc: string | null; ma: string[] }[] = []
    for (let i = 0; i < ghep.length; i++) {
        const v = ghep[i], f = trongKhung[i]
        const d = (theoNgay[ngayVN(f.createdTime)] ??= { tong: 0, khongMa: 0, coMaKhongKhop: 0, khop: 0, videoTra: 0 })
        d.tong++
        if (v.videoType === 'return') d.videoTra++
        const ma = extractTrackingCandidates(f.name)
        if (v.matchedOrder || v.matchedReturn) d.khop++
        else if (!ma.length) { d.khongMa++; if (mauKhongMa.length < 25) mauKhongMa.push({ ten: f.name, luc: f.createdTime }) }
        else { d.coMaKhongKhop++; khongKhop.push({ ten: f.name, luc: f.createdTime, ma }) }
    }

    // Video có mã mà không ghép được: dò xem mã đó là MÃ ĐƠN (quét nhầm mã) hay mã
    // vận đơn gần giống (rớt/đọc sai ký tự) — mỗi mẫu một truy vấn, tuần tự (pool 1).
    const p: any = prisma
    const chonDon = { orderNumber: true, trackingNumber: true, platform: true, status: true, createdAt: true, shippedAt: true }
    const doKhongKhop: any[] = []
    const daDo = new Set<string>()
    for (const k of khongKhop) {
        if (doKhongKhop.length >= 20) break
        const goc = k.ma[0]
        if (daDo.has(goc)) continue // video trùng tên (tải 2 lần) chỉ đo một lần
        daDo.add(goc)
        const theoMaDon = await p.onlineOrder.findFirst({ where: { orderNumber: { in: k.ma } }, select: chonDon })
        const gan = goc.length >= 6
            ? await p.onlineOrder.findMany({ where: { trackingNumber: { startsWith: goc.slice(0, goc.length - 1), mode: 'insensitive' } }, select: chonDon, take: 3 })
            : []
        const chua = goc.length >= 6
            ? await p.onlineOrder.findFirst({ where: { trackingNumber: { contains: goc, mode: 'insensitive' } }, select: chonDon })
            : null
        doKhongKhop.push({ ...k, laMaDon: theoMaDon, maVanDonGanGiong: gan, maVanDonChuaMa: chua })
    }

    // Đơn MỚI (3 ngày) chưa có mã vận đơn, theo sàn + trạng thái — đơn vừa đóng mà sync
    // chưa kéo mã về thì video hôm nay chưa ghép được.
    const donMoi = await p.onlineOrder.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) } },
        select: chonDon,
        orderBy: { createdAt: 'desc' },
        take: 5000,
    })
    const donMoiThieuMa: Record<string, { tong: number; thieuMa: number }> = {}
    const mauDonMoiThieuMa: any[] = []
    for (const o of donMoi) {
        const r = (donMoiThieuMa[`${o.platform || 'khac'}:${o.status}`] ??= { tong: 0, thieuMa: 0 })
        r.tong++
        if (!String(o.trackingNumber || '').trim()) { r.thieuMa++; if (mauDonMoiThieuMa.length < 10) mauDonMoiThieuMa.push(o) }
    }

    // Tìm THẲNG trên Drive theo mã (không liệt kê cả thư mục) — đo xem Drive có
    // tách tên theo dấu "_" để name/fullText contains bắt được mã không, và mất bao lâu.
    const thuTimDrive: any[] = []
    for (const ma of opts.ma.slice(0, 5)) {
        const sach = ma.replace(/[^A-Za-z0-9]/g, '')
        if (!sach) continue
        const ketQua: any = { ma: sach }
        for (const kieu of ['name', 'fullText'] as const) {
            const t = Date.now()
            try {
                const resp = await drive.files.list({
                    q: `(${[folderId, ...subIds].map(id => `'${id}' in parents`).join(' or ')}) and ${kieu} contains '${sach}' and trashed = false`,
                    fields: 'files(id, name, createdTime)', pageSize: 10,
                    supportsAllDrives: true, includeItemsFromAllDrives: true,
                })
                ketQua[kieu] = { ms: Date.now() - t, so: resp.data.files?.length || 0, ten: (resp.data.files || []).slice(0, 3).map(f => f.name) }
            } catch (e: any) {
                ketQua[kieu] = { ms: Date.now() - t, loi: String(e?.message || e).slice(0, 200) }
            }
        }
        thuTimDrive.push(ketQua)
    }

    // Mã cho trước (vd mã vận đơn của vụ khiếu nại không thấy video)
    const doMa: any[] = []
    for (const ma of opts.ma.slice(0, 10)) {
        const m = ma.toUpperCase()
        const viTri = tatCa.findIndex(f => f.name.toUpperCase().includes(m))
        const don = await p.onlineOrder.findFirst({
            where: { OR: [{ trackingNumber: { equals: ma, mode: 'insensitive' } }, { orderNumber: ma }] },
            select: chonDon,
        })
        const donGanGiong = don ? [] : await p.onlineOrder.findMany({
            where: { trackingNumber: { startsWith: ma.slice(0, Math.max(5, ma.length - 2)), mode: 'insensitive' } },
            select: chonDon, take: 3,
        })
        doMa.push({
            ma,
            file: viTri >= 0 ? { ten: tatCa[viTri].name, luc: tatCa[viTri].createdTime, thuTuMoiNhat: viTri + 1, trongTran: viTri < MAX_FILES, maRutDuoc: extractTrackingCandidates(tatCa[viTri].name) } : null,
            fileGanGiong: viTri >= 0 ? null : tatCa.filter(f => f.name.toUpperCase().includes(m.slice(0, Math.max(8, m.length - 4)))).slice(0, 3).map(f => f.name),
            don,
            donGanGiong,
        })
    }

    // Đơn đã gửi trong khung mà KHÔNG có mã vận đơn — không có mã thì không ghép được video nào.
    const daGui = await p.onlineOrder.findMany({
        where: { shippedAt: { gte: new Date(moc) } },
        select: { platform: true, trackingNumber: true },
        take: 20_000,
    })
    const donThieuMa: Record<string, { daGui: number; thieuMa: number }> = {}
    for (const o of daGui) {
        const r = (donThieuMa[o.platform || 'khac'] ??= { daGui: 0, thieuMa: 0 })
        r.daGui++
        if (!String(o.trackingNumber || '').trim()) r.thieuMa++
    }
    const phieuTraCoMa = await p.returnOrder.count({ where: { notes: { contains: 'Tracking: ' } } }).catch(() => null)

    return {
        configured: true,
        folderId,
        soThuMucCon: subIds.length,
        doDaiTruyVan: q.length,
        msThuMucCon,
        msLietKe,
        tongVideo: tatCa.length,
        danhDuLietKe: !pageToken,
        tranMaxFiles: MAX_FILES,
        biCatBoiTran: Math.max(0, tatCa.length - MAX_FILES),
        videoCuNhatTrongTran: tatCa[Math.min(tatCa.length, MAX_FILES) - 1]?.createdTime ?? null,
        videoCuNhat: tatCa[tatCa.length - 1]?.createdTime ?? null,
        khungNgay: opts.soNgay,
        theoNgay: Object.fromEntries(Object.entries(theoNgay).sort((a, b) => b[0].localeCompare(a[0]))),
        mauKhongMa,
        tongCoMaKhongKhop: khongKhop.length,
        doKhongKhop,
        maKhongKhop: [...daDo],
        maKhongKhopTatCa: [...new Set(khongKhop.map(k => k.ma[0]))],
        doMa,
        donThieuMa,
        donMoiThieuMa,
        mauDonMoiThieuMa,
        thuTimDrive,
        phieuTraCoMa,
        tranPhieuTra: 1500,
    }
}

export default router
