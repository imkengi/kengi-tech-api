/**
 * Cron ĐỐI CHIẾU NỢ KHÁCH ↔ KIOTVIET — chạy theo nhịp cleanup 24h của autoSync.
 *
 * Với cửa hàng có cấu hình KiotViet: hỏi KV từng khách có ánh xạ, lệch thì ghi
 * lại đúng số KV (Customer.debt là bản sao của KV theo thiết kế — xem
 * lamTuoiNoKhach). Ghi MỘT dòng tổng kết + từng khách đã sửa để lần được.
 * Bọc giuClient() vì chạy 4–5 phút/cửa hàng (593 khách × 120ms).
 */
import { registryPrisma, getStorePrisma, giuClient } from '../lib/prisma'
import { doiChieuNoKhach, doiChieuNoNcc } from '../services/kiotvietRunner'
import { moTaLoi } from '../lib/gomLoi'

export async function runDoiChieuNoKiotViet(): Promise<void> {
    const stores = await registryPrisma.store.findMany({ where: { status: 'active' }, select: { schema: true, name: true, code: true } }) as any[]
    for (const store of stores) {
        const nhaClient = giuClient(store.schema)
        let sp: any = null, logRow: any = null   // khai báo ngoài try để catch ghi được trạng thái failed
        try {
            sp = getStorePrisma(store.schema) as any
            const cfg = await sp.kiotVietConfig.findUnique({ where: { id: 'default' } }).catch(() => null)
            if (!cfg || cfg.enabled === false) continue
            /* CHẶN CHẠY TRÙNG: cleanup chạy 5 phút sau MỖI lần container lên (mỗi deploy,
             * mỗi instance) — đo 18/08: 3 lượt trong 45 phút vì 3 deploy, mỗi lượt ~600
             * lần gọi KiotViet. Ghi mốc vào KiotVietSyncLog (entity 'doi-chieu-no') và
             * bỏ qua nếu lần thành công gần nhất chưa quá 20 giờ. Không cần bảng mới,
             * và dòng log này hiện luôn trên nhật ký KiotViet cho chủ shop xem. */
            const lanTruoc = await sp.kiotVietSyncLog.findFirst({
                where: { entity: 'doi-chieu-no', status: 'success' },
                orderBy: { startedAt: 'desc' }, select: { startedAt: true },
            }).catch(() => null)
            if (lanTruoc?.startedAt && Date.now() - new Date(lanTruoc.startedAt).getTime() < 20 * 3600_000) {
                console.log(`[DoiChieuNoKV] ${store.code}: đã chạy lúc ${new Date(lanTruoc.startedAt).toISOString().slice(11, 16)}Z (<20h) — bỏ qua lượt này`)
                continue
            }
            logRow = await sp.kiotVietSyncLog.create({ data: { entity: 'doi-chieu-no', mode: 'cron', status: 'running', startedAt: new Date() } }).catch(() => null)
            const kq = await doiChieuNoKhach(sp, cfg, true)
            const tom = `[DoiChieuNoKV] ${store.code}: quét ${kq.quet}, khớp ${kq.khop}, lệch ${kq.lech}, đã sửa ${kq.daSua}` +
                (kq.tongChenh ? `, tổng chênh ${kq.tongChenh.toLocaleString('vi-VN')}đ` : '') +
                (kq.loiKV ? `, KV lỗi ${kq.loiKV}` : '') + ` (${Math.round(kq.ms / 1000)}s)`
            if (kq.lech > 0) console.warn(tom); else console.log(tom)
            if (kq.kvKhongCoDebt > 0) {
                const m0 = kq.mauKhongDebt?.[0]
                console.warn(`[DoiChieuNoKV] ${store.code}: ${kq.kvKhongCoDebt} khách KV trả 200 mà không có debt` +
                    (m0 ? ` — vd ${m0.code} (kv ${m0.kvId}) khoá=[${m0.khoa.slice(0, 6).join(',')}] tt=${JSON.stringify(m0.trangThai).slice(0, 120)}` : ''))
            }
            for (const x of kq.danhSachLech.slice(0, 50)) {
                console.warn(`[DoiChieuNoKV] ${store.code}/${x.code} ${x.name}: ${x.kengi} → ${x.kiotviet} (${x.chenh > 0 ? '+' : ''}${x.chenh})${x.daSua ? ' ĐÃ SỬA' : x.suaLoi ? ' SỬA LỖI' : x.ghiChu ? ` — ${x.ghiChu}` : ''}`)
            }
            // NCC — một lượt danh sách, rẻ; cùng bệnh giấu nợ (18/08: 6/54, 325,7tr)
            const kn = await doiChieuNoNcc(sp, cfg, true)
            const tomN = `[DoiChieuNoKV] ${store.code} NCC: quét ${kn.quet}, khớp ${kn.khop}, lệch ${kn.lech}, đã sửa ${kn.daSua}` + (kn.tongChenh ? `, tổng chênh ${kn.tongChenh.toLocaleString('vi-VN')}đ` : '')
            if (kn.lech > 0) console.warn(tomN); else console.log(tomN)
            for (const x of kn.danhSachLech.slice(0, 30)) console.warn(`[DoiChieuNoKV] ${store.code}/NCC ${x.code} ${x.name}: ${x.kengi} → ${x.kiotviet} (${x.chenh > 0 ? '+' : ''}${x.chenh})${x.daSua ? ' ĐÃ SỬA' : ''}`)

            /* THÔNG BÁO, KHÔNG CHỈ GHI LOG.
             *
             * Cả HAI lần mất nợ khách (20/08 và 21/08, tổng ~3,5 tỷ) đều phát hiện muộn vì
             * chỗ này chỉ `console.warn`. Không ai đọc Cloud Logging hằng ngày — một cảnh báo
             * không tới được mắt người thì bằng không có cảnh báo.
             *
             * Chỉ báo khi THẬT SỰ có lệch: báo mỗi ngày kể cả lúc bình thường thì vài tuần
             * sau người ta bỏ qua, và lần lệch thật cũng bị bỏ qua cùng. */
            const tongLech = kq.lech + kn.lech
            if (tongLech > 0) {
                const tienChenh = (kq.tongChenh || 0) + (kn.tongChenh || 0)
                const vd = kq.danhSachLech[0]
                await sp.notification.create({
                    data: {
                        /* 'system' CHỨ KHÔNG PHẢI 'warning'.
                         * NotificationDropdown LỌC theo type — chỉ nhận 'einvoice' | 'system' |
                         * 'payment_due'. Đặt 'warning' là thông báo bị bỏ im lặng, tức lại đúng
                         * cái bệnh cron này sinh ra để chữa: cảnh báo không tới được mắt người. */
                        type: 'system',
                        title: `⚠️ Lệch công nợ với KiotViet: ${tongLech} đối tượng`,
                        message: `${store.code}: ${kq.lech} khách + ${kn.lech} NCC lệch so với KiotViet`
                            + (tienChenh ? `, tổng chênh ${Math.round(tienChenh).toLocaleString('vi-VN')}đ` : '')
                            + `. Đã ghi lại theo số KiotViet.`
                            + (vd ? ` Ví dụ: ${vd.name || vd.code} ${Number(vd.kengi || 0).toLocaleString('vi-VN')}`
                                + ` → ${Number(vd.kiotviet || 0).toLocaleString('vi-VN')}đ.` : '')
                            + ` Lệch nhiều hoặc lặp lại nhiều ngày là dấu hiệu webhook đang ghi đè sai —`
                            + ` xem lại cờ syncCustomers.`,
                    },
                }).catch(() => { /* thông báo hỏng không được làm hỏng lượt đối chiếu */ })
            }
            if (logRow) await sp.kiotVietSyncLog.update({ where: { id: logRow.id }, data: {
                status: 'success', finishedAt: new Date(),
                fetched: kq.quet + kn.quet, updated: kq.daSua + kn.daSua, failed: kq.loiKV + kn.loiKV,
                details: JSON.stringify({ khach: { quet: kq.quet, khop: kq.khop, lech: kq.lech, daSua: kq.daSua, tongChenh: kq.tongChenh, loiKV: kq.loiKV, kvKhongCoDebt: kq.kvKhongCoDebt, ms: kq.ms },
                    // KV trả 200 mà không có debt: ghi mẫu để phân biệt "đã xoá bên KV" / "KV bỏ trống" (26 ca chưa lần được 18/08)
                    khongDebt: (kq.mauKhongDebt || []).slice(0, 10).map(x => ({ code: x.code, kv: x.kvId, khoa: x.khoa.slice(0, 8), tt: x.trangThai })),
                    loiKV: (kq.mauLoiKV || []).slice(0, 5),
                    ncc: { quet: kn.quet, khop: kn.khop, lech: kn.lech, daSua: kn.daSua, tongChenh: kn.tongChenh },
                    lechKhach: kq.danhSachLech.slice(0, 50).map(x => ({ code: x.code, kengi: x.kengi, kv: x.kiotviet })),
                    lechNcc: kn.danhSachLech.slice(0, 30).map(x => ({ code: x.code, kengi: x.kengi, kv: x.kiotviet })) }).slice(0, 8000),
            } }).catch(() => { })
        } catch (e: any) {
            console.error(`[DoiChieuNoKV] ${store.code}: ${moTaLoi(e)}`)
            // Đừng để dòng log treo 'running' mãi (rà soát 19/08): ghi failed để chốt 20h không bị nhầm và nhật ký sạch
            if (logRow && sp) await sp.kiotVietSyncLog.update({ where: { id: logRow.id }, data: { status: 'failed', finishedAt: new Date(), errors: String(moTaLoi(e)).slice(0, 2000) } }).catch(() => { })
        } finally {
            nhaClient()
        }
    }
}
