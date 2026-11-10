/**
 * NHỊP 2 GIỜ KÉO SỔ QUỸ KIOTVIET (23/10/2026 — chủ shop: "làm cả 3 hướng").
 *
 * Phiếu thu khách trả nợ trên KiotViet trước nay chỉ về Kengi khi có người bấm đồng bộ tay có sổ
 * quỹ, hoặc tình cờ khi lượt đêm quét trúng hoá đơn cũ — trễ từ một đến sáu tuần (đo HUTI). Ba
 * đường mới, dùng chung `keoPhieuThuKhach` (services/kiotvietSync.ts):
 *   1. webhook `customer.update` ⇒ kéo phiếu thu của đúng khách đó (routes/kiotviet.ts);
 *   2. lượt đêm 0h có thêm sổ quỹ (cron/kiotvietNightly.ts);
 *   3. nhịp này — lưới an toàn ban ngày khi webhook KiotViet tự tắt (đã từng tắt ngầm 36 giờ).
 *
 * Cloud Scheduler gọi /api/cron/tick mỗi phút; nhịp xét ở phút 26 và 56, mỗi cửa hàng tối đa một
 * lượt mỗi 2 giờ — mốc đọc từ KiotVietSyncLog nên mọi bản Cloud Run dùng chung, khởi động lại không
 * chạy dồn. Chạy trùng (hai bản cùng phút) vẫn an toàn: giành bản nối trước khi ghi (giuMap) + khoá
 * advisory khi dựng lại phiếu thu hoá đơn.
 */
import { registryPrisma, getStorePrisma, giuClient } from '../lib/prisma'
import { moTaLoi } from '../lib/gomLoi'
import { buildOptions, credsOf } from '../services/kiotvietRunner'
import { keoPhieuThuKhach, newCounters, xepHangPhieuThu } from '../services/kiotvietSync'
import { KV, kvDate } from '../services/kiotviet'

/** Khoảng cách tối thiểu giữa hai lượt của một cửa hàng. */
const CHU_KY_MS = 2 * 3600_000
/** Cửa sổ sổ quỹ mỗi lượt — gấp đôi chu kỳ là thừa, lấy 2 ngày để bù lượt hỏng. */
const SO_NGAY = 2
/** Đợt đêm / bấm tay còn nhịp tim trong khoảng này = đang chạy — để lần sau. */
const CON_SONG_MS = 2 * 60_000

export async function nhipPhieuThuKV(nganSachMs = 35_000): Promise<string> {
    const batDau = Date.now()
    const hanChot = batDau + nganSachMs
    const stores = await registryPrisma.store.findMany({
        where: { status: 'active' },
        select: { code: true, schema: true },
    }) as any[]
    const ra: string[] = []
    for (const st of stores) {
        if (Date.now() > hanChot) { ra.push('hết giờ — cửa hàng còn lại để nhịp sau'); break }
        const nha = giuClient(st.schema)
        try {
            const sp: any = getStorePrisma(st.schema)
            // Cửa hàng chưa từng có bảng cấu hình KiotViet (P2021) = không nối KiotViet, không phải lỗi
            const cfg = await sp.kiotVietConfig.findUnique({ where: { id: 'default' } })
                .catch((e: any) => (e?.code === 'P2021' ? null : Promise.reject(e)))
            // Chỉ cửa hàng đồng bộ hoá đơn từ KiotViet: phiếu thu gắn vào hoá đơn của họ
            if (!cfg?.enabled || !cfg.syncInvoices || !cfg.clientId || !cfg.clientSecret || !cfg.retailer) continue
            const ganDay = await sp.kiotVietSyncLog.findFirst({
                where: { entity: 'phieu-thu', startedAt: { gte: new Date(Date.now() - CHU_KY_MS + 5 * 60_000) } },
                select: { id: true },
            })
            if (ganDay) continue
            const dangChay = await sp.kiotVietSyncLog.findFirst({
                where: { status: 'running', mode: { in: ['cron', 'manual'] }, heartbeatAt: { gte: new Date(Date.now() - CON_SONG_MS) } },
                select: { id: true },
            })
            if (dangChay) { ra.push(`${st.code}: có đợt đồng bộ khác đang chạy — để nhịp sau`); continue }

            const tu = new Date(Date.now() - SO_NGAY * 86400_000)
            const log = await sp.kiotVietSyncLog.create({
                data: { entity: 'phieu-thu', mode: 'cron', status: 'running', fromDate: tu, startedAt: new Date(), heartbeatAt: new Date() },
            })
            const c = newCounters()
            try {
                const opts = await buildOptions(sp, cfg, true)
                opts.creds = credsOf(cfg)
                opts.daTuoiNo = new Set<string>()
                const { items } = await KV.cashflow(opts.creds, {
                    startDate: kvDate(tu),
                    endDate: kvDate(new Date(Date.now() + 3600_000)),
                }, { pageSize: 100, maxPages: 10 })
                const kq = await xepHangPhieuThu(sp, () => keoPhieuThuKhach(sp, opts, items, c, { hoaDonToiDa: 60, hanChot }))
                await sp.kiotVietSyncLog.update({
                    where: { id: log.id },
                    data: {
                        status: c.failed ? 'partial' : 'success',
                        fetched: c.fetched, created: c.created, updated: kq.hoaDonCapNhat, skipped: c.skipped, failed: c.failed,
                        errors: c.errors.join('\n').slice(0, 2000) || null,
                        details: JSON.stringify({ phieuThu: kq, mau: c.samples }).slice(0, 4000),
                        finishedAt: new Date(),
                    },
                })
                ra.push(`${st.code}: ${kq.phieuThuKhach} phiếu thu khách, ${kq.phieuLa} phiếu mới, gắn ${kq.hoaDonCapNhat} hoá đơn, ghi riêng ${kq.conLa.length}`)
            } catch (e: any) {
                await sp.kiotVietSyncLog.update({
                    where: { id: log.id },
                    data: { status: 'failed', errors: moTaLoi(e).slice(0, 2000), finishedAt: new Date() },
                }).catch(() => { /* nhật ký hỏng thì dòng 'running' tự bị coi là chết sau CON_SONG_MS */ })
                ra.push(`${st.code}: lỗi — ${moTaLoi(e)}`)
            }
        } catch (e: any) {
            ra.push(`${st.code}: lỗi — ${moTaLoi(e)}`)
        } finally {
            nha()
        }
    }
    return ra.join(' · ') || 'bỏ qua'
}
