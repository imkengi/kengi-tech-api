/* ═══════════════════════════════════════════════════════════════════════════════
 *  TỰ XẾP LỊCH ĐĂNG VIDEO (14/10/2026)
 *
 *  Chủ shop: "tự hẹn giờ cho hợp lý các video cũ sao cho không trùng". Video Nháp CŨ NHẤT xếp trước, mỗi video
 *  vào ô trống sớm nhất của ĐÚNG gian Shopee của nó:
 *    · ô = khung giờ đăng trong ngày (giờ VN, mặc định 11:30 + 20:00 — giờ xem cao điểm), từ ≥20 phút tới (Shopee
 *      nhận lịch từ 15 phút) đến trước 30 ngày (trần của Shopee và của refresh token video)
 *    · một gian một ngày tối đa N video (tính cả video đã hẹn / đã lên lịch / đã đăng hôm đó)
 *    · hai video cùng gian cách nhau ≥ X phút — không bao giờ hai video một giờ
 *    · cùng mã hàng trên cùng gian cách nhau ≥ Y ngày
 *  Chỉ xếp video ĐỦ điều kiện như nút Hẹn giờ (đã khai AI, gian đã uỷ quyền Shopee Video, file trong Drive); video
 *  thiếu gì thì nói thiếu gì, không đoán hộ. Video đã hẹn / đã lên lịch trên Shopee coi là ô đã chiếm — Shopee giữ
 *  lịch rồi thì không dời được.
 *  Mặc định CHẠY THỬ (trả kế hoạch); áp dụng mới hẹn thật, từng video qua datHenGio (cùng lõi với nút Hẹn giờ).
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { datHenGio } from './henGioDangVideo'

export type CauHinhXep = {
    /** khung giờ đăng trong ngày, 'HH:MM' giờ VN */
    khung: string[]
    /** tối đa video mỗi gian mỗi ngày */
    moiNgay: number
    /** hai video cùng gian cách nhau tối thiểu (phút) */
    cachPhut: number
    /** cùng mã trên cùng gian cách nhau tối thiểu (ngày); 0 = không xét */
    cungMaCachNgay: number
}
export const XEP_MAC_DINH: CauHinhXep = { khung: ['11:30', '20:00'], moiNgay: 2, cachPhut: 120, cungMaCachNgay: 3 }

const VN_MS = 7 * 3600_000
const NGAY_MS = 86400_000
/** Ngày giờ VN 'YYYY-MM-DD' của một mốc */
export const ngayVN = (ms: number) => new Date(ms + VN_MS).toISOString().slice(0, 10)
/** 'YYYY-MM-DD' + 'HH:MM' giờ VN → mốc (ms) */
export const mocVN = (ngay: string, hhmm: string) => Date.parse(`${ngay}T${hhmm}:00+07:00`)
const soNguyen = (v: unknown, macDinh: number, a: number, b: number) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : macDinh
}
export const laGio = (s: unknown) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)

export function chuanXep(x: any): CauHinhXep {
    const khung = Array.from(new Set((Array.isArray(x?.khung) ? x.khung : XEP_MAC_DINH.khung).filter(laGio) as string[])).sort().slice(0, 12)
    return {
        khung: khung.length ? khung : [...XEP_MAC_DINH.khung],
        // trần 48 (bản đầu 12); số ô THẬT do mốc + khoảng cách quyết (oTrongNgay), giao diện ghi rõ
        moiNgay: soNguyen(x?.moiNgay, XEP_MAC_DINH.moiNgay, 1, 48),
        cachPhut: soNguyen(x?.cachPhut, XEP_MAC_DINH.cachPhut, 0, 720),
        cungMaCachNgay: soNguyen(x?.cungMaCachNgay, XEP_MAC_DINH.cungMaCachNgay, 0, 30),
    }
}

/**
 * Ô giờ trong MỘT ngày theo thứ tự ưu tiên (giờ VN 'HH:MM'). Số video/ngày ≤ số mốc ⇒ chỉ đúng các mốc (như trước).
 * Nhiều hơn ⇒ thêm ô SAU từng mốc, cách nhau `cachPhut` (≥15, 0 thì 30), XOAY VÒNG giữa các mốc (11:30, 17:00, 20:00,
 * 12:00, 17:30, 20:30…), không lấn sang mốc kế tiếp, không quá 23:30. Bản đầu chỉ đặt đúng mốc ⇒ chủ shop đặt 12
 * video/ngày với 3 mốc mà thật ra chỉ được 3 — trần cắt âm thầm (14/10/2026).
 */
export function oTrongNgay(xep: CauHinhXep): string[] {
    const phut = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
    const gio = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const moc = Array.from(new Set(xep.khung)).sort().map(phut)
    const buoc = Math.max(15, xep.cachPhut || 30)
    const ra: string[] = []
    for (let k = 0; ra.length < Math.max(xep.moiNgay, moc.length) && k < 96; k++) {
        let them = false
        moc.forEach((m, i) => {
            const t = m + k * buoc, tran = i + 1 < moc.length ? moc[i + 1]! : 23 * 60 + 30
            if (k === 0 || t < tran) { ra.push(gio(t)); them = true }
        })
        if (!them) break
    }
    return ra
}

export type DongKe = { id: string; ten: string; sku: string[]; channelId: string; tenGian: string; henDangLuc: string }
export type DongBo = { id: string; ten: string; lyDo: string }
export type KeHoach = { ke: DongKe[]; boQua: DongBo[]; daChiem: number; xep: CauHinhXep; /** số ô thật sự mỗi gian mỗi ngày */ oMoiNgay: number }

/** Lý do video chưa tự xếp lịch được — cùng điều kiện với datHenGio, nói bằng lời người dùng làm được */
function lyDoChuaDu(m: any, gian: Map<string, any>): string | null {
    if (m.kenh !== 'shopee') return m.kenh === 'tiktok' ? 'Video TikTok — tự xếp lịch đang làm cho Shopee trước' : 'Chưa chọn kênh đăng (Sửa → chọn Shopee và gian)'
    if (m.nguon !== 'drive' || !m.nguonId) return 'Không nằm trong Drive của cửa hàng'
    if (!m.channelId) return 'Chưa chọn gian Shopee (Sửa → chọn gian)'
    const g = gian.get(m.channelId)
    if (!g) return 'Gian Shopee của video không còn'
    if (!g.videoUserId) return `Gian "${g.name}" chưa uỷ quyền Shopee Video`
    if (m.coNoiDungAI !== true && m.coNoiDungAI !== false) return 'Chưa khai video có dùng AI hay không (Shopee bắt buộc) — chọn "Có AI"/"Không AI" dưới tên video'
    if (Number(m.thoiLuongS) > 180) return 'Dài quá 180 giây — Shopee Video không nhận'
    return null
}

/**
 * Lập kế hoạch (không ghi gì). `ids` = chỉ xếp những video này (máy dựng tự động xếp video vừa làm); trống = mọi
 * video Nháp. Đọc hỏng thì NÉM — kế hoạch lập trên dữ liệu thiếu là xếp chồng lên lịch đã có.
 */
export async function lapLich(prisma: any, o: { ids?: string[]; xep: CauHinhXep; now?: number }): Promise<KeHoach> {
    const now = o.now ?? Date.now()
    const xep = chuanXep(o.xep)
    const ids = (o.ids || []).map(String).filter(Boolean).slice(0, 300)
    // POOL 1 trên prod ⇒ đọc tuần tự
    const ung: any[] = await prisma.sanMedia.findMany({
        where: { trangThai: 'nhap', ...(ids.length ? { id: { in: ids } } : {}) },
        orderBy: { createdAt: 'asc' }, take: 300,
        select: { id: true, ten: true, kenh: true, channelId: true, nguon: true, nguonId: true, coNoiDungAI: true, thoiLuongS: true, createdAt: true,
            sanPham: { select: { sku: true } } },
    })
    const kenh: any[] = await prisma.onlineChannel.findMany({ where: { platform: 'shopee' }, select: { id: true, name: true, videoUserId: true } as any })
    const gian = new Map<string, any>(kenh.map(c => [c.id, c]))
    // Ô ĐÃ CHIẾM: đã hẹn (Kengi giữ lịch), đã lên lịch (Shopee giữ), đã đăng — 30 ngày trước tới 31 ngày sau
    const chiem: any[] = kenh.length ? await prisma.sanMedia.findMany({
        where: {
            channelId: { in: kenh.map(c => c.id) },
            OR: [
                { trangThai: { in: ['hen_gio', 'da_len_lich'] }, henDangLuc: { gte: new Date(now - 30 * NGAY_MS), lte: new Date(now + 31 * NGAY_MS) } },
                { trangThai: 'da_dang', dangLuc: { gte: new Date(now - 30 * NGAY_MS) } },
            ],
        },
        select: { id: true, channelId: true, henDangLuc: true, dangLuc: true, trangThai: true, sanPham: { select: { sku: true } } },
    }) : []
    type O = { t: number; ngay: string; skus: string[] }
    const oCua = new Map<string, O[]>()
    const them = (ch: string, t: number, skus: string[]) => {
        const ds = oCua.get(ch) || []
        ds.push({ t, ngay: ngayVN(t), skus })
        oCua.set(ch, ds)
    }
    let daChiem = 0
    for (const c of chiem) {
        const t = new Date(c.trangThai === 'da_dang' ? (c.dangLuc || c.henDangLuc) : c.henDangLuc).getTime()
        if (!Number.isFinite(t)) continue
        them(c.channelId, t, (c.sanPham || []).map((s: any) => s.sku))
        if (t >= now) daChiem++
    }

    const ke: DongKe[] = [], boQua: DongBo[] = []
    const som = now + 20 * 60_000, muon = now + 30 * NGAY_MS - 3600_000
    const oNgay = oTrongNgay(xep)
    const oMoiNgay = Math.min(xep.moiNgay, oNgay.length)
    const cachNgay = (a: string, b: string) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / NGAY_MS)
    for (const m of ung) {
        const ly = lyDoChuaDu(m, gian)
        if (ly) { boQua.push({ id: m.id, ten: m.ten, lyDo: ly }); continue }
        const skus: string[] = (m.sanPham || []).map((s: any) => s.sku)
        const ds = oCua.get(m.channelId) || []
        let chon: number | null = null
        for (let d = 0; d <= 31 && chon == null; d++) {
            const ngay = ngayVN(now + d * NGAY_MS)
            const trongNgay = ds.filter(x => x.ngay === ngay)
            if (trongNgay.length >= xep.moiNgay) continue
            if (xep.cungMaCachNgay > 0 && skus.length && ds.some(x => x.skus.some(s => skus.includes(s)) && cachNgay(x.ngay, ngay) < xep.cungMaCachNgay)) continue
            for (const hhmm of oNgay) {
                const t = mocVN(ngay, hhmm)
                if (t < som || t > muon) continue
                if (ds.some(x => Math.abs(x.t - t) < Math.max(1, xep.cachPhut) * 60_000)) continue
                chon = t
                break
            }
        }
        if (chon == null) {
            boQua.push({ id: m.id, ten: m.ten, lyDo: `Hết ô trống trong 30 ngày tới (${oMoiNgay} video/ngày/gian, mốc ${xep.khung.join(', ')})` })
            continue
        }
        them(m.channelId, chon, skus)
        ke.push({ id: m.id, ten: m.ten, sku: skus, channelId: m.channelId, tenGian: gian.get(m.channelId)?.name || '', henDangLuc: new Date(chon).toISOString() })
    }
    return { ke, boQua, daChiem, xep, oMoiNgay }
}

/** Áp dụng kế hoạch: hẹn TỪNG video qua datHenGio (kiểm lại đủ điều kiện ngay lúc hẹn), tuần tự. */
export async function apDungLich(prisma: any, ke: DongKe[]): Promise<{ id: string; ten: string; ok: boolean; henDangLuc: string; loi?: string }[]> {
    const ra: { id: string; ten: string; ok: boolean; henDangLuc: string; loi?: string }[] = []
    for (const k of ke) {
        try {
            const kq = await datHenGio(prisma, k.id, new Date(k.henDangLuc))
            ra.push(kq.ok ? { id: k.id, ten: k.ten, ok: true, henDangLuc: k.henDangLuc } : { id: k.id, ten: k.ten, ok: false, henDangLuc: k.henDangLuc, loi: kq.loi })
        } catch (e: any) {
            ra.push({ id: k.id, ten: k.ten, ok: false, henDangLuc: k.henDangLuc, loi: String(e?.message || e).slice(0, 300) })
        }
    }
    return ra
}
