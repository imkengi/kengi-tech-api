/**
 * SỐ LIỆU BÀI ĐĂNG — Marketing Studio, 30/09/2026
 *
 * Dùng chung cho nút "Đồng bộ số liệu" (POST /api/mkt/analytics/sync) và vòng tự làm mới
 * trong mktWorker. Trước 30/09 số liệu CHỈ cập nhật khi người bấm Đồng bộ: HUTI bấm lúc bài
 * Threads mới lên vài phút ⇒ lưu 0/0/0/0, và màn Báo cáo đứng yên ở 0 mãi dù bài đã có
 * người xem ("vẫn trả về 0").
 *
 * Mỗi lần kéo là MỘT snapshot mới (MktMetric) — báo cáo lấy snapshot MỚI NHẤT từng bài.
 * Nền tảng không trả số nào thì để NULL, không ghi 0.
 */
import { giaiMa } from '../lib/maHoaKhoa'
import { layChiSo } from './mktNenTangKhac'

/** Snapshot cũ hơn chừng này thì vòng tự động làm mới. */
export const LAM_MOI_SAU_MS = 3 * 3600_000
/** Chỉ tự làm mới bài đăng trong chừng này ngày — bài cũ hơn gần như không đổi số. */
export const CUA_SO_TU_DONG_NGAY = 14
/** Bài vừa lên chưa ai kịp xem: đợi chừng này mới chụp, khỏi lưu một loạt số 0 vô nghĩa. */
const DOI_SAU_KHI_DANG_MS = 10 * 60_000

/* Lượt kéo HỎNG gần đây (token hết hạn, bài bị xoá…) — bỏ qua 3 giờ để vòng tự động không
 * gọi lại mỗi 30 phút mãi mãi. KHÔNG ghi snapshot rỗng để đánh dấu: snapshot mới nhất là
 * thứ báo cáo hiển thị, ghi rỗng là xoá mất con số tốt lần trước. Nằm trong bộ nhớ tiến
 * trình là đủ — khởi động lại thì thử lại, vô hại. */
const hongGanDay = new Map<string, number>()
export function danhDauHong(publicationId: string) { hongGanDay.set(publicationId, Date.now()) }

/** Kéo số liệu MỘT lượt đăng (kèm `account`) rồi lưu snapshot. Nền tảng từ chối thì NÉM lỗi. */
export async function keoSoLieu(prisma: any, pub: any) {
    const cs = await layChiSo(pub.account.platform, giaiMa(pub.account.accessToken), pub.remotePostId)
    await prisma.mktMetric.create({ data: { accountId: pub.accountId, publicationId: pub.id, ...cs } })
    hongGanDay.delete(pub.id)
    return cs
}

/**
 * Tối đa `toiDa` lượt đăng CẦN làm mới, mới đăng trước: đã đăng trong CUA_SO_TU_DONG_NGAY
 * ngày và được ít nhất 10 phút, kênh còn hoạt động, snapshot mới nhất cũ hơn 3 giờ (hoặc
 * chưa có), và không vừa hỏng trong 3 giờ qua. Hai câu truy vấn nhẹ — pool 1 kết nối.
 */
export async function chonLuotCanLamMoi(prisma: any, toiDa: number): Promise<any[]> {
    const bayGio = Date.now()
    const ds: any[] = await prisma.mktPublication.findMany({
        where: {
            status: 'sent', remotePostId: { not: null },
            sentAt: { gte: new Date(bayGio - CUA_SO_TU_DONG_NGAY * 86400_000), lte: new Date(bayGio - DOI_SAU_KHI_DANG_MS) },
            account: { status: 'active' },
        },
        orderBy: { sentAt: 'desc' }, take: 50,
        select: { id: true },
    })
    if (!ds.length) return []
    const ms: any[] = await prisma.mktMetric.findMany({
        where: { publicationId: { in: ds.map(p => p.id) } },
        orderBy: { snapshotAt: 'desc' },
        select: { publicationId: true, snapshotAt: true },
    })
    const moiNhat = new Map<string, number>()
    for (const m of ms) if (!moiNhat.has(m.publicationId)) moiNhat.set(m.publicationId, +new Date(m.snapshotAt))
    const can = ds
        .filter(p => !moiNhat.has(p.id) || bayGio - moiNhat.get(p.id)! >= LAM_MOI_SAU_MS)
        .filter(p => !hongGanDay.has(p.id) || bayGio - hongGanDay.get(p.id)! >= LAM_MOI_SAU_MS)
        .slice(0, toiDa)
    if (!can.length) return []
    return prisma.mktPublication.findMany({
        where: { id: { in: can.map(p => p.id) } },
        include: { account: true },
    })
}
