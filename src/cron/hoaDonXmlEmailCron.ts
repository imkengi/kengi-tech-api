/* ═══════════════════════════════════════════════════════════════════════════════
 *  CUỐI NGÀY ĐỌC HOÁ ĐƠN XML TRONG HỘP THƯ (26/09/2026)
 *
 *  Chủ shop: "cuối ngày quét 1 lần thôi". Chạy 23:00 giờ VN (16:00 UTC), MỘT lần
 *  mỗi ngày, chỉ bản lãnh đạo; chỉ cửa hàng đã gắn hộp thư. Việc cụ thể ở
 *  services/hoaDonXmlEmail.ts — ở đây chỉ hẹn giờ + chọn cửa hàng + báo kết quả.
 *
 *  Máy khởi động lại sau 23:00 thì tự chạy bù (cùng nếp kiotvietNightly); mỗi cửa
 *  hàng tự kiểm "đã có lượt tự động trong 20 giờ qua chưa" nên chạy bù không lặp.
 *  Không lượt nào ghi vào sổ: hoá đơn hàng hoá vào hàng đợi Nhập Hàng, dịch vụ
 *  thành phiếu chi CHỜ DUYỆT.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import registryPrisma, { getStorePrisma } from '../lib/prisma'
import { chayNeuLanhDao } from '../lib/leaderLock'
import { moTaLoi } from '../lib/gomLoi'
import { quetHoaDonXmlEmail, damBaoBang } from '../services/hoaDonXmlEmail'

const GIO_UTC = 16          // 23:00 giờ VN
let timer: NodeJS.Timeout | null = null
let lanChayNgay = ''
let dangChay = false

/** Schema các cửa hàng ĐÃ GẮN hộp thư — hỏi bằng client registry, không mở client từng cửa hàng. */
async function schemaCoHopThu(): Promise<string[]> {
    const coCot: Array<{ s: string }> = await registryPrisma.$queryRawUnsafe(
        `SELECT table_schema AS s FROM information_schema.columns WHERE table_name = 'StoreSettings' AND column_name = 'mailboxConfig'`)
    const out: string[] = []
    for (const { s } of coCot) {
        if (!/^[a-z0-9_]+$/i.test(s)) continue
        const r: any[] = await registryPrisma.$queryRawUnsafe<any[]>(
            `SELECT COALESCE("mailboxConfig", '') <> '' AS co FROM "${s}"."StoreSettings" WHERE id = 'default'`).catch(() => [] as any[])
        if (r[0]?.co) out.push(s)
    }
    return out
}

export async function chayLuotHoaDonXml(): Promise<void> {
    if (dangChay) return
    dangChay = true
    try {
        const schemas = await schemaCoHopThu()
        if (!schemas.length) return
        const stores = await registryPrisma.store.findMany({
            where: { status: 'active', schema: { in: schemas } }, select: { code: true, schema: true },
        })
        for (const st of stores) {
            try {
                const sp: any = getStorePrisma(st.schema)
                await damBaoBang(sp)
                const gan: any[] = await sp.$queryRawUnsafe(
                    `SELECT 1 FROM "HoaDonEmailLuotQuet" WHERE "cheDo" = 'tu-dong' AND "trangThai" = 'xong'
                        AND "batDau" > now() - interval '20 hours' LIMIT 1`)
                if (gan.length) continue
                const kq = await quetHoaDonXmlEmail(sp, { cheDo: 'tu-dong' })
                const moi = kq.moiHang + kq.moiChuaRo + kq.moiChiPhi
                console.log(`[HĐ XML email] ${st.code}: ${kq.soThu} thư có tệp, ${kq.soTep} tệp XML → ` +
                    `${kq.moiHang + kq.moiChuaRo} chờ nhập hàng, ${kq.moiChiPhi} phiếu chi chờ duyệt, ${kq.daCo} đã có, ${kq.boQua} bỏ qua, ${kq.loi.length} lỗi`)
                if (moi > 0 || kq.loi.length) {
                    const tieuDe = moi > 0 ? `📄 ${moi} hoá đơn XML mới từ email` : '⚠ Đọc hoá đơn XML từ email có lỗi'
                    const noiDung = [
                        kq.moiHang + kq.moiChuaRo ? `${kq.moiHang + kq.moiChuaRo} chờ nhập hàng (trang Nhập Hàng)` : '',
                        kq.moiChiPhi ? `${kq.moiChiPhi} phiếu chi chờ duyệt (trang Chi phí)` : '',
                        kq.loi.length ? `${kq.loi.length} tệp đọc lỗi — xem Hộp Thư` : '',
                    ].filter(Boolean).join(' · ')
                    const tin = await sp.notification.create({ data: { type: 'info', title: tieuDe, message: noiDung } }).catch(() => null)
                    try {
                        const { sendPushToStore } = await import('../routes/notifications')
                        sendPushToStore(sp, tieuDe, noiDung, { id: tin?.id, type: 'info' }).catch(() => { })
                    } catch { /* thông báo web vẫn có */ }
                }
            } catch (e) {
                console.error(`[HĐ XML email] ${st.code}: ${moTaLoi(e)}`)
            }
        }
    } finally {
        dangChay = false
    }
}

export function startHoaDonXmlEmailCron(): void {
    if (timer) return
    timer = setInterval(() => {
        const now = new Date()
        const homNay = now.toISOString().slice(0, 10)
        if (lanChayNgay === homNay || now.getUTCHours() < GIO_UTC) return
        lanChayNgay = homNay
        void chayNeuLanhDao('hoa-don-xml-email', 60 * 60_000, chayLuotHoaDonXml)
            .catch(e => { console.error(`[HĐ XML email] ${moTaLoi(e)}`); lanChayNgay = '' })
    }, 10 * 60_000)
    if (typeof timer.unref === 'function') timer.unref()
}

export function stopHoaDonXmlEmailCron(): void {
    if (timer) clearInterval(timer)
    timer = null
}
