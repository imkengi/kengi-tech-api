/**
 * KHUNG GIỜ ĐĂNG — "08:00, 12:00, 20:00" (giờ VN).
 *
 * Duyệt xong bài TỰ HẸN vào giờ trống gần nhất trong khung, khỏi chọn giờ lại. HUTI 30/09:
 * tác vụ AI có ô "Khung giờ đăng bài" nhưng tác vụ chỉ soạn (không tự duyệt) bỏ qua ô đó,
 * bài không nhớ khung giờ nên người duyệt phải chọn giờ lần nữa.
 *
 * Khung của BÀI (theo tác vụ AI soạn ra nó) được ưu tiên; không có thì dùng khung MẶC ĐỊNH
 * của thương hiệu. Giao diện (studio.js docKhungGio / chonGio) tính y hệt để hiện trước
 * giờ sẽ đăng — máy chủ vẫn là bên quyết.
 *
 * Module này không import gì: mktThuongHieu và mktNoiDung đều dùng nó.
 */
const VN_MS = 7 * 3600_000
/** Hai bài trên cùng một kênh cách nhau ít nhất 60 phút. */
export const CACH_TOI_THIEU_MS = 60 * 60_000
/** Giờ hẹn cách lúc bấm ít nhất 10 phút — worker kịp nhận, người kịp đổi ý. */
const TRE_NHAT_MS = 10 * 60_000
const TIM_TOI_DA_NGAY = 14

/** "08:00, 12h, 20h30, 7" → phút trong ngày [420, 480, 720, 1230] (tăng dần, không trùng). */
export function docKhungGio(raw: any): number[] {
    const s = String(raw ?? '')
    const ra = new Set<number>()
    /* Không dùng lookbehind: giao diện chạy cùng regex này, Safari cũ không hỗ trợ. */
    for (const m of s.matchAll(/(\d{1,2})(?:\s*[:hg]\s*(\d{2}))?(?!\d)/gi)) {
        if (m.index! > 0 && /\d/.test(s[m.index! - 1])) continue
        const h = Number(m[1]), p = Number(m[2] ?? 0)
        if (h <= 23 && p <= 59) ra.add(h * 60 + p)
    }
    return [...ra].sort((a, b) => a - b)
}

/** Chuẩn hoá để lưu: "8h, 20h30" → "08:00, 20:30". Rỗng → "". Có chữ mà không đọc được giờ nào → null. */
export function chuanKhungGio(raw: any): string | null {
    const s = String(raw ?? '').trim()
    if (!s) return ''
    const ds = docKhungGio(s)
    if (!ds.length || ds.length > 24 || s.length > 200) return null
    return ds.map(p => `${String(Math.floor(p / 60)).padStart(2, '0')}:${String(p % 60).padStart(2, '0')}`).join(', ')
}

/** Khung giờ áp cho một bài: của bài, không có thì của thương hiệu. */
export const khungGioCua = (c: any, brand: any): string =>
    String(c?.postSlots || '').trim() || String(brand?.postSlots || '').trim()

/**
 * Phần tính thuần: giờ đầu tiên trong khung (xét từ ngày của `tuMs`, giờ VN) nằm trong
 * [tuMs, denMs] và cách mọi mốc `daCo` ít nhất `cach`. Không có thì null.
 */
export function chonGio(phut: number[], daCo: number[], tuMs: number, denMs: number, cach = CACH_TOI_THIEU_MS): Date | null {
    const vn = new Date(tuMs + VN_MS)
    for (let ngay = 0; ngay <= TIM_TOI_DA_NGAY; ngay++) {
        for (const p of phut) {
            const t = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + ngay, 0, p) - VN_MS
            if (t < tuMs || t > denMs) continue
            if (daCo.every(x => Math.abs(x - t) >= cach)) return new Date(t)
        }
    }
    return null
}

/**
 * Giờ TRỐNG gần nhất trong khung cho MỌI kênh trong `accountIds`: sau lúc này ít nhất
 * 10 phút, cách mọi lượt đăng đã hẹn / đang đăng / đã đăng trên cùng kênh ít nhất 60 phút.
 * Tìm trong 14 ngày; hết chỗ thì null (để người chọn tay).
 */
export async function gioTrongGanNhat(prisma: any, accountIds: string[], khungGio: string, tu = new Date()): Promise<Date | null> {
    const phut = docKhungGio(khungGio)
    if (!phut.length || !accountIds.length) return null
    const tuMs = tu.getTime() + TRE_NHAT_MS
    const denMs = tu.getTime() + TIM_TOI_DA_NGAY * 86400_000
    const daCo = await prisma.mktPublication.findMany({
        where: {
            accountId: { in: accountIds },
            status: { in: ['queued', 'processing', 'uncertain', 'sent'] },
            scheduledAt: { gte: new Date(tuMs - CACH_TOI_THIEU_MS), lte: new Date(denMs + CACH_TOI_THIEU_MS) },
        },
        select: { scheduledAt: true },
    })
    return chonGio(phut, daCo.map((p: any) => new Date(p.scheduledAt).getTime()), tuMs, denMs)
}
