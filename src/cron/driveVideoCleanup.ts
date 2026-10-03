import { registryPrisma, getStorePrisma, mapWithConcurrency } from '../lib/prisma'
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
 *  2. CHỪA video còn dính KHIẾU NẠI: phiếu trả pending/approved/processing, VÀ mọi
 *     phiếu trả mới động tới trong 60 ngày (bị từ chối vẫn có thể bị khách khiếu nại
 *     tiếp) — khớp mã gửi đi hoặc mã trả về trong tên file thì giữ bất kể tuổi.
 *  3. Trần 300 file/cửa hàng/đêm — tồn nhiều thì rút dần, không treo cron. Dọn bù
 *     tồn đọng một lần: POST /api/admin/don-video-dong-hang (mặc định CHẠY THỬ).
 *
 * Điều kiện chạy được: file My Drive chỉ CHỦ SỞ HỮU xoá được — phải kết nối Drive
 * bằng tài khoản chủ thư mục (Cài đặt → Kết nối Google Drive); service account dù
 * được share Editor vẫn bị Google chặn (đo 04/08: 300/300 lỗi).
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
        }, { timeout: 60_000 })
        for (const f of resp.data.files || []) ids.push(f.id!)
        pageToken = resp.data.nextPageToken || undefined
    } while (pageToken)
    for (const id of [...ids]) ids.push(...await listSubfolderIds(drive, id))
    return ids
}

/** Mã vận đơn (gửi đi + trả về) cần GIỮ video: phiếu trả còn mở + mọi phiếu trả động tới
 *  trong 60 ngày. KHÔNG trần — bản cũ `take: 500` (chỉ pending/approved) để lọt phiếu thứ
 *  501 trở đi và mọi phiếu `processing`: video của chúng bị dọn dù vụ chưa xong. */
async function openDisputeTrackings(sp: any): Promise<{ keep: Set<string>; soPhieu: number }> {
    const keep = new Set<string>()
    let soPhieu = 0
    try {
        const open = await sp.returnOrder.findMany({
            where: {
                OR: [
                    { status: { in: ['pending', 'approved', 'processing'] } },
                    { updatedAt: { gte: new Date(Date.now() - 60 * 86400_000) } },
                ],
            },
            select: { notes: true, originalInvoice: true },
        })
        soPhieu = open.length
        const invoices: string[] = [...new Set<string>(open.map((r: any) => r.originalInvoice).filter(Boolean))]
        for (const r of open) {
            const m = /(?:^|\n)\s*Tracking:\s*(.+?)\s*(?:\n|$)/i.exec(r.notes || '')
            const t = m?.[1]?.trim().toUpperCase()
            if (t && t !== 'N/A') keep.add(t)
        }
        for (let i = 0; i < invoices.length; i += 2000) {
            const lo = invoices.slice(i, i + 2000)
            const orders = await sp.onlineOrder.findMany({
                where: {
                    OR: [{ orderNumber: { in: lo } }, { externalOrderId: { in: lo } }],
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
    return { keep, soPhieu }
}

/** Đưa MỘT file vào thùng rác; lỗi tạm (quá nhịp, rớt kết nối, 5xx) thì thử lại 3 lần.
 *  Nhật ký đêm từng có vài file/đêm hỏng vì "socket hang up" rồi phải chờ đêm sau. */
async function duaVaoThungRac(drive: any, fileId: string): Promise<'ok' | 'mat' | string> {
    for (let lan = 0; ; lan++) {
        try {
            // Hạn 30s/lệnh: googleapis mặc định KHÔNG hạn giờ — một socket treo giữ chân cả
            // lượt (đo 03/10: lượt hạn 230s chạy 326s, chỉ dọn được 622 video).
            await drive.files.update({ fileId, requestBody: { trashed: true } }, { timeout: 30_000 })
            return 'ok'
        } catch (e: any) {
            const code = Number(e?.code || e?.response?.status || 0)
            const msg = String(e?.message || e)
            if (code === 404) return 'mat' // đã không còn (người dùng tự xoá)
            const tamThoi = code === 429 || code >= 500 || /rate ?limit|socket hang up|ECONNRESET|ETIMEDOUT|network|aborted/i.test(msg) // 'aborted' = quá hạn 30s; trash lại vô hại
            if (!tamThoi || lan >= 3) return msg
            await new Promise(r => setTimeout(r, 1000 * 2 ** lan))
        }
    }
}

/**
 * LÕI DỌN — dùng chung cho cron đêm và lệnh dọn bù của admin.
 * apply=false: CHỈ ĐẾM (quét hết video quá hạn, đếm sẽ giữ / sẽ dọn, không đụng gì).
 * apply=true: đưa tối đa `tran` file vào thùng rác, dừng khi chạm trần hoặc hết `hanMs`.
 */
export async function donVideoCu(sp: any, opts: { apply: boolean; tran: number; hanMs?: number; ngayGiu?: number; luong?: number }) {
    const ngayGiu = Math.max(30, opts.ngayGiu ?? RETENTION_DAYS)
    const cutoffISO = new Date(Date.now() - ngayGiu * 86400_000).toISOString()
    const settings = await sp.storeSettings.findFirst({ select: { driveFolderId: true } as any }).catch(() => null) as any
    const folderId = settings?.driveFolderId
    if (!folderId) return null

    // Ưu tiên TÀI KHOẢN CHỦ SHOP đã kết nối (OAuth) — chỉ chủ sở hữu mới xoá được file
    // My Drive; chưa kết nối thì rơi về service account (chỉ dọn được file SA sở hữu).
    const { getStoreDriveWriter } = await import('../lib/driveOAuth')
    const writer = await getStoreDriveWriter(sp).catch(() => null)
    const drive = writer?.drive || getDriveWrite()
    const dungChuShop = writer?.nguon === 'chu-shop'
    const batDau = Date.now()
    const han = opts.hanMs ?? 230_000
    const folders = [folderId, ...await listSubfolderIds(drive, folderId)]
    const { keep, soPhieu } = await openDisputeTrackings(sp)

    let trashed = 0, kept = 0, failed = 0, mat = 0, quaHan = 0, loiQuyen = 0
    let firstErr = ''
    let dungSom: '' | 'tran' | 'het-gio' | 'loi-quyen' = ''
    const mauGiu: string[] = []
    const mauDon: string[] = []
    outer:
    for (const fid of folders) {
        let pageToken: string | undefined
        do {
            const resp = await drive.files.list({
                q: `'${fid}' in parents and trashed = false and mimeType contains 'video/' and createdTime < '${cutoffISO}'`,
                fields: 'nextPageToken, files(id, name, createdTime)',
                pageSize: opts.apply ? 200 : 1000,
                pageToken,
            }, { timeout: 60_000 })
            const lo: any[] = []
            for (const f of resp.data.files || []) {
                quaHan++
                const cands = extractTrackingCandidates(f.name || '').map(c => c.toUpperCase())
                if (cands.some(c => keep.has(c))) { kept++; if (mauGiu.length < 5) mauGiu.push(f.name); continue }
                if (mauDon.length < 5) mauDon.push(f.name)
                if (opts.apply) lo.push(f)
            }
            if (lo.length) {
                await mapWithConcurrency(lo, async (f: any) => {
                    if (dungSom) return
                    if (trashed + failed >= opts.tran) { dungSom = 'tran'; return }
                    if (Date.now() - batDau > han) { dungSom = 'het-gio'; return }
                    const kq = await duaVaoThungRac(drive, f.id)
                    if (kq === 'ok') trashed++
                    else if (kq === 'mat') mat++
                    else {
                        failed++
                        if (!firstErr) firstErr = kq
                        // GIỚI HẠN CỦA DRIVE: file My Drive chỉ CHỦ SỞ HỮU xoá được — SA có
                        // Editor vẫn bị "insufficient permissions". Chuỗi lỗi quyền ⇒ dừng sớm.
                        if (/insufficient permissions|does not have sufficient/i.test(kq) && ++loiQuyen >= 5 && trashed === 0) dungSom = 'loi-quyen'
                    }
                }, Math.min(8, Math.max(1, opts.luong ?? 3)))
                if (dungSom) break outer
            }
            pageToken = resp.data.nextPageToken || undefined
        } while (pageToken)
    }

    return {
        nguon: dungChuShop ? 'chu-shop' as const : 'service-account' as const,
        email: writer?.email,
        ngayGiu,
        moc: cutoffISO,
        soThuMuc: folders.length,
        soPhieuTraDuocGiu: soPhieu,
        soMaGiu: keep.size,
        // chạy thử: quaHan = TẤT CẢ video quá hạn; chạy thật: số đã quét tới lúc dừng
        quaHan,
        kept,
        trashed,
        failed,
        mat,
        // gán trong closure của mapWithConcurrency ⇒ TS tưởng luôn là '' — khai lại kiểu
        dungSom: dungSom as '' | 'tran' | 'het-gio' | 'loi-quyen',
        firstErr: firstErr.slice(0, 200),
        mauGiu,
        mauDon,
        ms: Date.now() - batDau,
    }
}

export async function runDriveVideoCleanup(): Promise<void> {
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
            if (!settings?.driveFolderId) continue

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
            // sở hữu xoá được — chừng nào chủ shop chưa kết nối Drive thì lần chạy
            // nào cũng y hệt lỗi đó. Nhắc lại 7 NGÀY/LẦN cho đỡ phiền.
            // (Bản cũ dò message 'chỉ chủ sở hữu xoá được' — chuỗi không hề có trong thông
            // báo nên chưa bao giờ khớp. Dò theo TIÊU ĐỀ, khớp cả tiêu đề cũ lẫn mới.)
            const nhacGanDay = await sp.notification.findFirst({
                where: {
                    title: { startsWith: '🎬 Dọn video', contains: 'Google chặn xoá hộ' },
                    createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) },
                },
                select: { id: true },
            }).catch(() => null)
            const boQuaNhac = !!nhacGanDay

            const kq = await donVideoCu(sp, { apply: true, tran: PER_STORE_CAP, hanMs: 20 * 60_000 })
            if (!kq) continue
            const { trashed, kept, failed, firstErr } = kq
            const dungChuShop = kq.nguon === 'chu-shop'

            // Chỉ toàn lỗi quyền + vừa nhắc trong 7 ngày → im lặng, khỏi dội thông báo
            const chiLoiQuyen = trashed === 0 && failed > 0 &&
                /insufficient permissions|does not have sufficient/i.test(firstErr)
            if (chiLoiQuyen && boQuaNhac) continue

            if (trashed > 0 || failed > 0 || kept > 0) {
                console.log(`[VideoCleanup] ${store.name}: đưa vào thùng rác ${trashed} video >${RETENTION_DAYS} ngày` +
                    `${kept > 0 ? `, giữ ${kept} video còn dính khiếu nại` : ''}` +
                    `${failed > 0 ? `, lỗi ${failed} — ${firstErr.slice(0, 120)}` : ''}` +
                    `${kq.dungSom === 'tran' ? ` (chạm trần ${PER_STORE_CAP}/đêm, mai dọn tiếp)` : ''}`)
                if (chiLoiQuyen) console.warn(`[VideoCleanup] ${store.name}: file thuộc sở hữu người dùng — SA không xoá được (giới hạn My Drive). Cần kết nối Drive bằng tài khoản chủ thư mục.`)
                await sp.notification.create({
                    data: {
                        type: 'system',
                        // Toàn lỗi quyền thì đây KHÔNG phải báo lỗi hệ thống mà là
                        // việc cần chủ shop làm một lần — đặt tiêu đề cho đúng bản chất.
                        title: chiLoiQuyen
                            ? `🎬 Dọn video đóng hàng: cần kết nối Google Drive một lần (Google chặn xoá hộ)`
                            : `🎬 Dọn video đóng hàng: ${trashed} video quá ${RETENTION_DAYS} ngày vào thùng rác Drive`,
                        message: `${kept > 0 ? `Giữ lại ${kept} video thuộc phiếu trả/khiếu nại còn mở hoặc mới động tới trong 60 ngày. ` : ''}` +
                            // KHÔNG khuyên "kiểm tra quyền Editor" — file My Drive chỉ CHỦ SỞ HỮU
                            // xoá được, Editor cũng bị Google chặn (đo 04/08: 300/300 lỗi).
                            `${failed > 0
                                ? (dungChuShop
                                    ? `${failed} video chưa dọn được dù đã kết nối tài khoản Google (${kq.email || ''}). Kiểm tra: tài khoản đó có phải CHỦ SỞ HỮU thư mục video không? Lỗi gốc: ${firstErr.slice(0, 140)}`
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
