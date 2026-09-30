/**
 * BỘ MÁY ĐĂNG BÀI — Marketing Studio, 05/09/2026
 * Chuyển từ `scratch/fanpage-dashboard/marketing/service.js`.
 *
 * Bốn thứ ở đây là lý do cả module này đáng gộp vào. Bộ `FbScheduledPost` cũ
 * KHÔNG có thứ nào trong bốn thứ này:
 *
 *  1. KHOÁ IDEMPOTENT — `MktPublication.idempotencyKey` là UNIQUE. Gọi gửi hai
 *     lần vẫn ra một bài.
 *
 *  2. GIÀNH VIỆC NGUYÊN TỬ — `UPDATE ... WHERE id=? AND status='queued'` rồi ĐẾM
 *     SỐ DÒNG ĐỔI. 0 dòng nghĩa là tiến trình khác đã giành mất; bỏ qua, đừng
 *     làm tiếp. Không có bước này thì hai instance Cloud Run cùng đăng một bài.
 *
 *  3. HẠN GIỮ VIỆC (lease) — worker chết giữa chừng thì việc không kẹt mãi ở
 *     `processing`: hết hạn giữ là đứa sau nhặt lại. Nhưng nhặt lại thành
 *     `uncertain` chứ KHÔNG phải `queued` (xem điểm 4).
 *
 *  4. ⛔ GHI MƠ HỒ KHÔNG BAO GIỜ TỰ THỬ LẠI — đứt mạng giữa lệnh POST nghĩa là
 *     bài CÓ THỂ đã lên. Thử lại là đăng trùng lên trang khách hàng, và không
 *     sửa được: xoá bài thì người theo dõi đã thấy rồi. Phải có người vào xem.
 */
import { LoiNenTang, trangThaiTuLoi } from '../lib/mktLoiNenTang'
import { giaiMa, maHoa } from '../lib/maHoaKhoa'
import { moTaLoi } from '../lib/gomLoi'
import { GIA_HAN_TRUOC_MS, giaHanToken } from './mktNenTangKhac'
import { AI_TU_DUYET } from '../lib/mktThuongHieu'

/** Bao lâu thì coi như worker giữ việc đã chết. */
const HAN_GIU_MS = 5 * 60_000

/** Một nền tảng phải cung cấp đúng chừng này. */
export interface NenTang {
    /** Đăng bài. `luuMoc` để ghi checkpoint (id container/upload) TRƯỚC khi gửi
     *  bước cuối — có nó thì lần chạy sau dùng lại, không đẻ container thứ hai. */
    dang(
        taiKhoan: { externalId: string; platform: string },
        token: string,
        bai: {
            body: string
            /** Tiêu đề (YouTube bắt buộc) và tuỳ chọn riêng nền tảng (quyền riêng tư TikTok/YouTube…). */
            title?: string
            options?: any
            linkUrl?: string | null
            /** [{type:'image'|'video', url, mime, storagePath}] — đúng media của phiên bản kênh này. */
            assets: any[]
        },
        moc: string | null,
        luuMoc: (m: string) => Promise<void>
    ): Promise<{ remotePostId: string; remoteRef?: string }>
}

const dangKy = new Map<string, NenTang>()
export function khaiNenTang(platform: string, nt: NenTang) { dangKy.set(platform, nt) }
export function layNenTang(platform: string): NenTang | undefined { return dangKy.get(platform) }

/**
 * Giành MỘT việc đến hạn. Trả `null` nếu không có gì để làm.
 *
 * Hai loại được nhặt:
 *   · `queued` đã tới giờ
 *   · `processing` mà HẾT HẠN GIỮ (worker cũ chết)
 * Loại thứ hai bị đẩy sang `uncertain` chứ không quay lại `queued`: worker cũ có
 * thể đã gửi xong rồi mới chết. Đưa về `queued` là mời một lần đăng trùng.
 */
export async function giatMotViec(prisma: any, workerId: string): Promise<any | null> {
    const bayGio = new Date()

    // ── Dọn việc quá hạn giữ TRƯỚC, và đánh dấu là mơ hồ ──
    const quaHan = await prisma.mktPublication.findFirst({
        where: { status: 'processing', leaseUntil: { lt: bayGio } },
        select: { id: true, workerId: true },
    })
    if (quaHan) {
        await prisma.mktPublication.updateMany({
            where: { id: quaHan.id, status: 'processing' },
            data: {
                status: 'uncertain',
                errorCode: 'LEASE_EXPIRED',
                errorMessage: `Worker ${quaHan.workerId || '?'} giữ việc rồi mất tín hiệu. `
                    + 'KHÔNG tự gửi lại: bài có thể đã lên. Vào nền tảng kiểm rồi quyết.',
                leaseUntil: null, workerId: null,
            },
        })
        /* Không trả việc này ra — nó cần người, không cần worker. */
    }

    const ungVien = await prisma.mktPublication.findFirst({
        where: { status: 'queued', scheduledAt: { lte: bayGio } },
        orderBy: { scheduledAt: 'asc' },
        select: { id: true },
    })
    if (!ungVien) return null

    /* ⛔ GIÀNH NGUYÊN TỬ: điều kiện `status:'queued'` nằm TRONG câu UPDATE, và ta
     * đọc `count`. Đọc-rồi-ghi tách làm hai bước là để hở đúng khe cho hai worker
     * cùng lấy một việc. */
    const giat = await prisma.mktPublication.updateMany({
        where: { id: ungVien.id, status: 'queued' },
        data: {
            status: 'processing',
            workerId,
            leaseUntil: new Date(Date.now() + HAN_GIU_MS),
            attempts: { increment: 1 },
        },
    })
    if (giat.count === 0) return null   // đứa khác nhanh tay hơn

    return prisma.mktPublication.findUnique({
        where: { id: ungVien.id },
        include: { content: { include: { campaign: true } }, account: true },
    })
}

/**
 * Đăng một việc đã giành được. KHÔNG ném lỗi ra ngoài — mọi kết cục đều được ghi
 * vào bản ghi, vì một ngoại lệ lọt ra sẽ để việc kẹt ở `processing`.
 */
export async function dangMotViec(prisma: any, viec: any): Promise<string> {
    const ghi = (data: any) =>
        prisma.mktPublication.updateMany({ where: { id: viec.id }, data })

    try {
        // ── Các cửa kiểm TRƯỚC khi gửi (chưa đụng mạng, còn huỷ được an toàn) ──
        if (viec.content?.campaign && viec.content.campaign.status === 'paused') {
            await ghi({ status: 'queued', leaseUntil: null, workerId: null })
            return 'hoan-chien-dich-tam-dung'
        }
        /* SỬA NỘI DUNG LÀ MẤT DUYỆT: bản duyệt phải khớp bản hiện tại. Thiếu cửa
         * này thì người ta duyệt một bài, sửa nội dung, và bài KHÁC HẲN được đăng. */
        if (viec.content?.approvedRevision !== viec.content?.revision) {
            await ghi({
                status: 'failed', leaseUntil: null, workerId: null,
                errorCode: 'CHUA_DUYET',
                errorMessage: 'Nội dung đã sửa sau khi duyệt — phải duyệt lại bản mới rồi mới đăng.',
            })
            return 'chua-duyet'
        }
        /* Bài do AI TỰ DUYỆT: công tắc của thương hiệu phải CÒN BẬT lúc đăng. Chủ shop tắt
         * công tắc là muốn dừng ngay — bài AI đã duyệt mà chưa lên phải quay về chờ người
         * duyệt, không được lọt qua chỉ vì đã vào hàng đợi từ trước. */
        if (viec.content?.approvedBy === AI_TU_DUYET) {
            const th = viec.content?.brandId
                ? await prisma.mktBrand.findUnique({ where: { id: viec.content.brandId }, select: { aiAutoApprove: true, archivedAt: true } })
                : null
            if (!th?.aiAutoApprove || th.archivedAt) {
                await prisma.mktContent.updateMany({
                    where: { id: viec.content.id, approvedBy: AI_TU_DUYET },
                    data: { approvedRevision: null, approvedAt: null, approvedBy: null, status: 'pending' },
                })
                await ghi({
                    status: 'cancelled', leaseUntil: null, workerId: null,
                    errorCode: 'AI_TU_DUYET_DA_TAT',
                    errorMessage: 'Bài do AI tự duyệt nhưng thương hiệu đã tắt "AI tự duyệt" — đã trả bài về chờ người duyệt.',
                })
                return 'ai-tu-duyet-da-tat'
            }
        }
        if (viec.account?.status !== 'active') {
            await ghi({
                status: 'failed', leaseUntil: null, workerId: null,
                errorCode: 'KENH_KHONG_HOAT_DONG',
                errorMessage: `Kênh ${viec.account?.platform} đang ở trạng thái "${viec.account?.status}". Nối lại kênh rồi gửi lại.`,
            })
            return 'kenh-hong'
        }

        const nt = layNenTang(viec.account.platform)
        if (!nt) {
            await ghi({
                status: 'failed', leaseUntil: null, workerId: null,
                errorCode: 'CHUA_HO_TRO',
                errorMessage: `Chưa cài bộ đăng cho nền tảng "${viec.account.platform}".`,
            })
            return 'chua-ho-tro'
        }

        /* Giải mã token ngay trước khi dùng, KHÔNG giữ trong biến sống lâu và
         * KHÔNG bao giờ đưa vào log/thông báo lỗi. */
        let token: string
        try {
            token = giaiMa(viec.account.accessToken)
        } catch {
            await ghi({
                status: 'failed', leaseUntil: null, workerId: null,
                errorCode: 'TOKEN_KHONG_GIAI_DUOC',
                errorMessage: 'Không giải mã được token đã lưu (khoá vault đã đổi?). Nối lại kênh.',
            })
            return 'token-hong'
        }

        /* GIA HẠN TOKEN trước khi hết (Threads: trước 7 ngày vì chỉ gia hạn được token
         * còn hạn; YouTube/TikTok: bằng refresh token đã lưu). Gia hạn hỏng mà token cũ
         * vẫn còn hạn thì cứ đăng bằng token cũ — đừng chặn bài vì một bước "làm sớm". */
        const han = viec.account.tokenExpiresAt ? new Date(viec.account.tokenExpiresAt).getTime() : null
        const truoc = GIA_HAN_TRUOC_MS[viec.account.platform]
        if (han && truoc && han - Date.now() < truoc) {
            try {
                let bi: any = null
                if (viec.account.refreshSecret) bi = JSON.parse(giaiMa(viec.account.refreshSecret))
                const moi = await giaHanToken(viec.account.platform, token, bi)
                token = moi.accessToken
                await prisma.mktAccount.update({
                    where: { id: viec.account.id },
                    data: {
                        accessToken: maHoa(moi.accessToken), tokenExpiresAt: moi.hetHan,
                        ...(moi.refreshToken && bi ? { refreshSecret: maHoa(JSON.stringify({ ...bi, refreshToken: moi.refreshToken })) } : {}),
                    },
                })
            } catch (e: any) {
                if (han <= Date.now()) {
                    await prisma.mktAccount.update({ where: { id: viec.account.id }, data: { status: 'token_expired' } }).catch(() => { })
                    await ghi({
                        status: 'failed', leaseUntil: null, workerId: null,
                        errorCode: 'TOKEN_HET_HAN',
                        errorMessage: `Token kênh đã hết hạn và không gia hạn được (${moTaLoi(e)}). Nối lại kênh rồi gửi lại.`,
                    })
                    return 'token-het-han'
                }
                console.warn(`[mkt] gia hạn token ${viec.account.platform} hỏng, dùng token cũ còn hạn:`, moTaLoi(e))
            }
        }

        /* Phiên bản RIÊNG của kênh này (Threads 500 ký tự, YouTube cần tiêu đề…);
         * kênh không có phiên bản riêng thì dùng thân bài chung. */
        let phienBan: any = null
        try {
            const ds = JSON.parse(String(viec.content?.variants || '[]'))
            if (Array.isArray(ds)) phienBan = ds.find((v: any) => v?.accountId === viec.accountId) || null
        } catch { /* variants hỏng JSON thì dùng thân bài chung — đã duyệt cả hai */ }

        /* Media của ĐÚNG phiên bản này (không có thì media chung của bài), và chỉ media
         * cùng thương hiệu với bài. Trước 29/09 chỗ này gửi `assets: []` — ảnh/video
         * không bao giờ được đăng. */
        let idsMedia: string[] = Array.isArray(phienBan?.assetIds) ? phienBan.assetIds : []
        if (!idsMedia.length) { try { idsMedia = JSON.parse(String(viec.content?.assetIds || '[]')) } catch { idsMedia = [] } }
        const media = idsMedia.length
            ? await prisma.mktAsset.findMany({ where: { id: { in: idsMedia.map(String) }, brandId: viec.content?.brandId ?? undefined } })
            : []
        const assets = idsMedia
            .map((id: string) => media.find((m: any) => m.id === id))
            .filter(Boolean)
            .map((m: any) => ({ type: m.type, url: m.url, mime: m.mime, storagePath: m.storagePath, bytes: m.bytes }))
        if (assets.length !== idsMedia.length) {
            await ghi({
                status: 'failed', leaseUntil: null, workerId: null,
                errorCode: 'MEDIA_MAT',
                errorMessage: 'Có media trong bài đã bị xoá khỏi thư viện. Sửa bài, duyệt lại rồi gửi.',
            })
            return 'media-mat'
        }

        // ── Gửi thật ──
        const kq = await nt.dang(
            { externalId: viec.account.externalId, platform: viec.account.platform },
            token,
            {
                body: (phienBan?.text || '').trim() ? phienBan.text : (viec.content?.body || ''),
                title: (phienBan?.title || '').trim() ? phienBan.title : (viec.content?.title || ''),
                options: phienBan?.options || {},
                linkUrl: viec.content?.linkUrl ?? null,
                assets,
            },
            viec.remoteRef ?? null,
            /* Ghi checkpoint NGAY khi nền tảng cấp id container — trước bước cuối.
             * Chết giữa hai bước mà không có checkpoint thì lần sau tạo container mới. */
            async (m: string) => { await ghi({ remoteRef: m }) }
        )

        await ghi({
            status: 'sent', leaseUntil: null, workerId: null,
            remotePostId: kq.remotePostId,
            remoteRef: kq.remoteRef ?? viec.remoteRef ?? null,
            sentAt: new Date(), errorCode: null, errorMessage: null,
        })
        return 'da-gui'

    } catch (err: any) {
        /* BA kết cục, không phải hai. Gộp lại là sai thật:
         *
         *  · THỬ LẠI ĐƯỢC — chắc chắn chưa xảy ra gì, HOẶC đang chờ nền tảng xử lý
         *    xong (Facebook mã hoá video, Instagram dựng container). Về `queued`
         *    và đẩy giờ hẹn ra sau. Quy về `failed` là bỏ dở đúng những bài đang
         *    chạy bình thường, chỉ vì nền tảng cần thêm vài chục giây.
         *    ⚠ GIỮ NGUYÊN `remoteRef` — đó là checkpoint, mất là gửi lại từ đầu.
         *
         *  · MƠ HỒ — đã gửi mà không biết kết quả. Dừng, chờ người.
         *
         *  · HỎNG HẲN — chắc chắn không lên và thử lại vô ích. */
        if (err instanceof LoiNenTang && err.thuLaiDuoc && !err.moHo) {
            await ghi({
                status: 'queued', leaseUntil: null, workerId: null,
                scheduledAt: new Date(Date.now() + Math.max(30, err.choGiay) * 1000),
                errorCode: err.code, errorMessage: moTaLoi(err),
            })
            return 'cho-thu-lai'
        }

        const tt = trangThaiTuLoi(err)   // 'uncertain' hoặc 'failed'
        await ghi({
            status: tt, leaseUntil: null, workerId: null,
            errorCode: err instanceof LoiNenTang ? err.code : 'LOI_NOI_BO',
            errorMessage: tt === 'uncertain'
                ? `ĐÃ GỬI NHƯNG KHÔNG BIẾT KẾT QUẢ: ${moTaLoi(err)}. `
                + '⛔ Hệ thống CỐ Ý không tự gửi lại — bài có thể đã lên, gửi lại là đăng trùng. '
                + 'Vào trang kiểm rồi bấm "đã lên" hoặc "gửi lại".'
                : moTaLoi(err),
        })
        return tt
    }
}
