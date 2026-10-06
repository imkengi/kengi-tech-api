/**
 * KHUNG GIỜ ĐĂNG — "08:00, 12:00, 20:00" (giờ VN).
 *
 * Duyệt xong bài TỰ HẸN vào giờ trống gần nhất trong khung, khỏi chọn giờ lại. HUTI 30/09:
 * tác vụ AI có ô "Khung giờ đăng bài" nhưng tác vụ chỉ soạn (không tự duyệt) bỏ qua ô đó,
 * bài không nhớ khung giờ nên người duyệt phải chọn giờ lần nữa.
 *
 * TRÙNG GIỜ THÌ CỘNG THÊM 30 PHÚT (chủ shop, 06/10/2026). Trước đó khung kín là đẩy sang
 * NGÀY SAU: 4 tác vụ soạn 9 bài tự duyệt/ngày mà khung 10:00, 13:00, 22:00 (cách ≥ 60 phút)
 * chỉ chứa 5–6 bài ⇒ 38 bài xếp hàng tới tận 14/10, mỗi ngày dài thêm. Giờ:
 *   · mỗi mốc trong khung nhận một bài trước (vòng 0), rồi mốc +30 phút (vòng 1), +60…
 *     — bài trải đều sáng / trưa / tối thay vì dồn hết vào khung sớm nhất;
 *   · mỗi mốc lùi tới TRƯỚC mốc kế tiếp (mốc cuối: tới hết ngày);
 *   · hai bài trên cùng kênh cách nhau ít nhất 30 phút.
 *
 * Khung của BÀI (theo tác vụ AI soạn ra nó) được ưu tiên; không có thì dùng khung MẶC ĐỊNH
 * của thương hiệu. Giao diện (studio.js gioTrongDuKien) tính y hệt để hiện trước giờ sẽ
 * đăng — máy chủ vẫn là bên quyết.
 *
 * Module này không import gì: mktThuongHieu và mktNoiDung đều dùng nó.
 */
const VN_MS = 7 * 3600_000
/** Hai bài trên cùng một kênh cách nhau ít nhất 30 phút (06/10: trước là 60). */
export const CACH_TOI_THIEU_MS = 30 * 60_000
/** Trùng giờ thì lùi thêm từng nấc 30 phút. */
export const BUOC_LUI_MS = 30 * 60_000
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

const trong = (t: number, daCo: number[], cach: number) => daCo.every(x => Math.abs(x - t) >= cach)

/**
 * Phần tính thuần: giờ đầu tiên (xét từ ngày của `tuMs`, giờ VN) nằm trong [tuMs, denMs]
 * và cách mọi mốc `daCo` ít nhất `cach`. Mỗi ngày đi theo VÒNG: vòng 0 = các mốc gốc, vòng k =
 * mốc + k×30 phút — nhưng một mốc chỉ lùi tiếp khi chỗ vòng trước của nó ĐÃ CÓ BÀI (trùng giờ
 * thì cộng 30 phút). Mốc đã qua mà còn trống thì thôi, không lùi: duyệt lúc 22:05 với khung
 * 08:00 / 12:00 / 20:00 là chờ 08:00 hôm sau, không đăng 22:30. Không còn chỗ thì null.
 */
export function chonGio(phut: number[], daCo: number[], tuMs: number, denMs: number, cach = CACH_TOI_THIEU_MS): Date | null {
    if (!phut.length) return null
    const vn = new Date(tuMs + VN_MS)
    for (let ngay = 0; ngay <= TIM_TOI_DA_NGAY; ngay++) {
        const dauNgay = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + ngay) - VN_MS
        const conLui = phut.map(() => true)      // mốc i còn được lùi tiếp không
        for (let vong = 0; conLui.some(Boolean); vong++) {
            for (let i = 0; i < phut.length; i++) {
                if (!conLui[i]) continue
                const t = dauNgay + phut[i] * 60_000 + vong * BUOC_LUI_MS
                const tran = i + 1 < phut.length ? dauNgay + phut[i + 1] * 60_000 : dauNgay + 24 * 3600_000
                if (t >= tran) { conLui[i] = false; continue }      // lùi chạm mốc kế / hết ngày
                if (!trong(t, daCo, cach)) continue                 // trùng giờ ⇒ vòng sau +30 phút
                if (t >= tuMs && t <= denMs) return new Date(t)
                conLui[i] = false                                   // trống mà đã qua giờ ⇒ thôi
            }
        }
    }
    return null
}

/** Mọi mốc lượt đăng (đã hẹn / đang đăng / đã đăng) trên các kênh này trong [tu, den]. */
async function mocDaCo(prisma: any, accountIds: string[], tu: number, den: number): Promise<number[]> {
    const ds = await prisma.mktPublication.findMany({
        where: {
            accountId: { in: accountIds },
            status: { in: ['queued', 'processing', 'uncertain', 'sent'] },
            scheduledAt: { gte: new Date(tu - CACH_TOI_THIEU_MS), lte: new Date(den + CACH_TOI_THIEU_MS) },
        },
        select: { scheduledAt: true },
    })
    return ds.map((p: any) => new Date(p.scheduledAt).getTime())
}

/**
 * Giờ TRỐNG gần nhất trong khung cho MỌI kênh trong `accountIds`: sau lúc này ít nhất
 * 10 phút, trùng giờ thì lùi 30 phút (xem đầu file). Tìm trong 14 ngày; hết chỗ thì null.
 */
export async function gioTrongGanNhat(prisma: any, accountIds: string[], khungGio: string, tu = new Date()): Promise<Date | null> {
    const phut = docKhungGio(khungGio)
    if (!phut.length || !accountIds.length) return null
    const tuMs = tu.getTime() + TRE_NHAT_MS
    const denMs = tu.getTime() + TIM_TOI_DA_NGAY * 86400_000
    return chonGio(phut, await mocDaCo(prisma, accountIds, tuMs, denMs), tuMs, denMs)
}

/**
 * Giờ CỤ THỂ (AI tự chọn, vd tác vụ tạo trước 01/10) mà trùng bài khác trên cùng kênh thì
 * cộng thêm 30 phút cho tới khi trống (tối đa 1 ngày). Giờ người chọn tay KHÔNG đi qua đây.
 */
export async function nhuongGio(prisma: any, accountIds: string[], khi: Date): Promise<Date> {
    if (!accountIds.length || isNaN(khi.getTime())) return khi
    const tu = khi.getTime(), den = tu + 86400_000
    const daCo = await mocDaCo(prisma, accountIds, tu, den)
    for (let t = tu; t <= den; t += BUOC_LUI_MS) if (trong(t, daCo, CACH_TOI_THIEU_MS)) return new Date(t)
    return khi
}
