import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { extractTrackingCandidates } from '../routes/driveVideos'

/**
 * DỌN VIDEO ĐÓNG HÀNG QUÁ 45 NGÀY (2026-08-04, yêu cầu chủ shop)
 *
 * Video đóng gói/mở hoàn là bằng chứng tranh chấp — hết cửa sổ khiếu nại thì
 * chỉ còn chiếm dung lượng Drive. Chạy cùng nhịp cleanup 24h của autoSync.
 *
 * Ranh giới an toàn (cố ý, đừng gỡ khi chưa hiểu):
 *  1. CHO VÀO THÙNG RÁC (trashed=true), KHÔNG xoá vĩnh viễn — Drive giữ rác 30
 *     ngày, bấm nhầm/đổi ý còn cứu được. Xoá thật là việc của Drive sau đó.
 *  2. CHỪA video còn dính KHIẾU NẠI MỞ: phiếu trả pending/approved cần bằng
 *     chứng cả hai đầu (mã gửi đi + mã trả về) — khớp mã trong tên file thì giữ
 *     lại bất kể tuổi.
 *  3. Trần 300 file/cửa hàng/đêm — tồn nhiều thì rút dần, không treo cron.
 *
 * Điều kiện chạy được: service account của Cloud Run phải được share thư mục
 * với quyền EDITOR (scope ghi ở đây + quyền Viewer bên Drive = 403 cả loạt —
 * lỗi sẽ được đếm và báo rõ trong notification).
 */

const RETENTION_DAYS = 45
const PER_STORE_CAP = 300
const WRITE_SCOPES = ['https://www.googleapis.com/auth/drive']

let writeClient: any = null
function getDriveWrite(): any {
    if (!writeClient) {
        const { google } = require('googleapis') as typeof import('googleapis')
        const auth = new google.auth.GoogleAuth({ scopes: WRITE_SCOPES })
        writeClient = google.drive({ version: 'v3', auth })
    }
    return writeClient
}

async function listSubfolderIds(drive: any, parentId: string): Promise<string[]> {
    const ids: string[] = []
    let pageToken: string | undefined
    do {
        const resp = await drive.files.list({
            q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'nextPageToken, files(id)',
            pageSize: 100,
            pageToken,
        })
        for (const f of resp.data.files || []) ids.push(f.id!)
        pageToken = resp.data.nextPageToken || undefined
    } while (pageToken)
    for (const id of [...ids]) ids.push(...await listSubfolderIds(drive, id))
    return ids
}

/** Mã vận đơn (gửi đi + trả về) của các phiếu trả ĐANG MỞ — video khớp thì giữ. */
async function openDisputeTrackings(sp: any): Promise<Set<string>> {
    const keep = new Set<string>()
    try {
        const open = await sp.returnOrder.findMany({
            where: { status: { in: ['pending', 'approved'] } },
            select: { notes: true, originalInvoice: true },
            take: 500,
        })
        const invoices = open.map((r: any) => r.originalInvoice).filter(Boolean)
        for (const r of open) {
            const m = /(?:^|\n)\s*Tracking:\s*(.+?)\s*(?:\n|$)/i.exec(r.notes || '')
            const t = m?.[1]?.trim().toUpperCase()
            if (t && t !== 'N/A') keep.add(t)
        }
        if (invoices.length > 0) {
            const orders = await sp.onlineOrder.findMany({
                where: {
                    OR: [{ orderNumber: { in: invoices } }, { externalOrderId: { in: invoices } }],
                    trackingNumber: { not: null },
                },
                select: { trackingNumber: true },
            })
            for (const o of orders) {
                const t = String(o.trackingNumber || '').trim().toUpperCase()
                if (t) keep.add(t)
            }
        }
    } catch { /* store chưa có bảng — coi như không có gì cần giữ */ }
    return keep
}

export async function runDriveVideoCleanup(): Promise<void> {
    const cutoffISO = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString()
    let stores: any[] = []
    try {
        stores = await registryPrisma.store.findMany({ where: { status: 'active' }, select: { name: true, schema: true } }) as any[]
    } catch (e: any) {
        // message rỗng khi DB chưa sẵn sàng lúc boot — in cả code/cause cho lần được
        console.error('[VideoCleanup] không đọc được danh sách store:',
            e?.message || e?.code || e?.cause?.message || String(e))
        return
    }

    for (const store of stores) {
        try {
            const sp = getStorePrisma(store.schema) as any
            const settings = await sp.storeSettings.findFirst({ select: { driveFolderId: true } as any }).catch(() => null) as any
            const folderId = settings?.driveFolderId
            if (!folderId) continue

            // CHỐT CHỐNG SPAM: lịch "24h/lần" nhưng lần đầu chạy 5' sau khi server
            // khởi động — mà Cloud Run khởi động lại theo MỖI deploy/scale, nên
            // ngày deploy nhiều là mỗi lần một thông báo lỗi y hệt (đo 05/08:
            // 5 thông báo trong một buổi sáng). Dấu vết = thông báo gần nhất
            // trong DB; đã dọn trong 20h qua thì bỏ qua store này.
            const daChayGanDay = await sp.notification.findFirst({
                where: {
                    title: { startsWith: '🎬 Dọn video' },
                    createdAt: { gte: new Date(Date.now() - 20 * 3600_000) },
                },
                select: { id: true },
            }).catch(() => null)
            if (daChayGanDay) continue

            // ĐÃ BIẾT KHÔNG XOÁ ĐƯỢC thì thôi nhắc mỗi ngày: file My Drive chỉ chủ
            // sở hữu xoá được — chừng nào chủ shop chưa cài Apps Script thì lần
            // chạy nào cũng y hệt lỗi đó. Nhắc lại 7 NGÀY/LẦN cho đỡ phiền, thay
            // vì dội thông báo "lỗi" hằng đêm cho việc mình không tự sửa được.
            const nhacGanDay = await sp.notification.findFirst({
                where: {
                    title: { startsWith: '🎬 Dọn video' },
                    message: { contains: 'chỉ chủ sở hữu xoá được' },
                    createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) },
                },
                select: { id: true },
            }).catch(() => null)
            const boQuaNhac = !!nhacGanDay

            // Ưu tiên TÀI KHOẢN CHỦ SHOP đã kết nối (OAuth) — chỉ chủ sở hữu mới
            // xoá được file My Drive; chưa kết nối thì rơi về service account
            // (chỉ dọn được file do chính SA sở hữu).
            const { getStoreDriveWriter } = await import('../lib/driveOAuth')
            const writer = await getStoreDriveWriter(sp).catch(() => null)
            const drive = writer?.drive || getDriveWrite()
            const dungChuShop = writer?.nguon === 'chu-shop'
            const folders = [folderId, ...await listSubfolderIds(drive, folderId)]
            const keep = await openDisputeTrackings(sp)

            let trashed = 0, kept = 0, failed = 0, consecPerm = 0
            let firstErr = ''
            outer:
            for (const fid of folders) {
                let pageToken: string | undefined
                do {
                    const resp = await drive.files.list({
                        q: `'${fid}' in parents and trashed = false and mimeType contains 'video/' and createdTime < '${cutoffISO}'`,
                        fields: 'nextPageToken, files(id, name, createdTime)',
                        pageSize: 100,
                        pageToken,
                    })
                    for (const f of resp.data.files || []) {
                        if (trashed + failed >= PER_STORE_CAP) break outer
                        const cands = extractTrackingCandidates(f.name || '').map(c => c.toUpperCase())
                        if (cands.some(c => keep.has(c))) { kept++; continue }
                        try {
                            await drive.files.update({ fileId: f.id!, requestBody: { trashed: true } })
                            trashed++
                            consecPerm = 0
                        } catch (e: any) {
                            failed++
                            if (!firstErr) firstErr = e?.message || String(e)
                            // GIỚI HẠN CỦA DRIVE (đo 04/08: 300/300 lỗi): file trong
                            // My Drive chỉ CHỦ SỞ HỮU xoá được — SA có Editor vẫn bị
                            // "insufficient permissions". Gặp chuỗi lỗi quyền là dừng
                            // sớm, đường xoá thật là Apps Script chạy trong tài khoản
                            // chủ shop (scripts/drive-video-cleanup.gs).
                            if (/insufficient permissions|does not have sufficient/i.test(firstErr) && ++consecPerm >= 5) {
                                console.warn(`[VideoCleanup] ${store.name}: file thuộc sở hữu người dùng — SA không xoá được (giới hạn My Drive). Dùng scripts/drive-video-cleanup.gs chạy trong tài khoản chủ shop.`)
                                break outer
                            }
                        }
                    }
                    pageToken = resp.data.nextPageToken || undefined
                } while (pageToken)
            }

            // Chỉ toàn lỗi quyền + vừa nhắc trong 7 ngày → im lặng, khỏi dội thông báo
            const chiLoiQuyen = trashed === 0 && failed > 0 &&
                /insufficient permissions|does not have sufficient/i.test(firstErr)
            if (chiLoiQuyen && boQuaNhac) continue

            if (trashed > 0 || failed > 0 || kept > 0) {
                console.log(`[VideoCleanup] ${store.name}: đưa vào thùng rác ${trashed} video >${RETENTION_DAYS} ngày` +
                    `${kept > 0 ? `, giữ ${kept} video còn dính khiếu nại mở` : ''}` +
                    `${failed > 0 ? `, lỗi ${failed} — ${firstErr.slice(0, 120)}` : ''}` +
                    `${trashed + failed >= PER_STORE_CAP ? ` (chạm trần ${PER_STORE_CAP}/đêm, mai dọn tiếp)` : ''}`)
                await sp.notification.create({
                    data: {
                        type: 'system',
                        // Toàn lỗi quyền thì đây KHÔNG phải báo lỗi hệ thống mà là
                        // việc cần chủ shop làm một lần — đặt tiêu đề cho đúng bản chất.
                        title: chiLoiQuyen
                            ? `🎬 Dọn video đóng hàng: cần cài script một lần (Google chặn xoá hộ)`
                            : `🎬 Dọn video đóng hàng: ${trashed} video quá ${RETENTION_DAYS} ngày vào thùng rác Drive`,
                        message: `${kept > 0 ? `Giữ lại ${kept} video thuộc khiếu nại đang mở. ` : ''}` +
                            // KHÔNG khuyên "kiểm tra quyền Editor" — file My Drive chỉ CHỦ SỞ HỮU
                            // xoá được, Editor cũng bị Google chặn (đo 04/08: 300/300 lỗi).
                            `${failed > 0
                                ? (dungChuShop
                                    ? `${failed} video chưa dọn được dù đã kết nối tài khoản Google (${writer?.email || ''}). Kiểm tra: tài khoản đó có phải CHỦ SỞ HỮU thư mục video không? Lỗi gốc: ${firstErr.slice(0, 140)}`
                                    : `${failed} video chưa dọn được: Google chỉ cho CHỦ SỞ HỮU xoá file trong My Drive — máy chủ được chia sẻ quyền Chỉnh sửa vẫn bị chặn, đây không phải lỗi hệ thống. Cách xử lý MỘT LẦN: vào Cài đặt → "Kết nối Google Drive", đăng nhập tài khoản chứa thư mục video. Sau đó app tự dọn hằng đêm dưới danh nghĩa của bạn. Nhắc lại sau 7 ngày nếu chưa kết nối.`)
                                : 'Video trong thùng rác còn khôi phục được 30 ngày.'}`,
                    },
                }).catch(() => { })
            }
        } catch (e: any) {
            if (!String(e?.message || '').includes('does not exist')) {
                console.error(`[VideoCleanup] ${store.name}:`, e?.message || e)
            }
        }
    }
}
