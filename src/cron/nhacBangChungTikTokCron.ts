/**
 * NHẮC XÁC NHẬN "ĐÃ ĐỦ BẰNG CHỨNG" TIKTOK — mỗi giờ một lần cho tới khi bấm OK (09/10/2026).
 *
 * Chủ shop: "với tiktok thì sau khi khiếu nại thì trong vòng 24 giờ nó bắt xác nhận đã đủ bằng
 * chứng thì cứ 1 tiếng spam vào check 1 lần cho đến khi ấn nút ok". Luật mốc 24 giờ ở
 * lib/bangChungTikTok.ts (đo dữ liệu thật: API TikTok KHÔNG báo bước này — mốc lấy từ lúc khiếu
 * nại qua app hoặc lúc TikTok chuyển vụ sang tranh chấp).
 *
 * NĂM NGUYÊN TẮC:
 *  1. MỖI GIỜ MỘT TIN / CỬA HÀNG — gom mọi vụ đang chờ vào một tin (nhiều vụ ≠ nhiều tiếng chuông
 *     cùng lúc). Dấu "[nhac-bc-tt:<YYYY-MM-DDTHH giờ VN>]" nằm trong chính thông báo — cùng cách
 *     hanThanhToanCron, khỏi đẻ bảng trạng thái.
 *  2. CHẠY CẢ ĐÊM: Cloud Run cpu-throttling ⇒ setInterval chỉ có CPU khi có request. Nhịp chính là
 *     POST /api/cron/tick (Cloud Scheduler mỗi phút, routes/cronTick.ts) — gọi mỗi 10 phút;
 *     setInterval ở đây chỉ là phần bù ban ngày. Khoá lãnh đạo + dấu giờ chống gửi đúp.
 *  3. HẾT 24 GIỜ mà chưa bấm OK → báo MỘT lần cuối (dấu "[het-bc-tt:<mã>:<mốc>]") rồi thôi.
 *  4. ĐỌC HỎNG ≠ KHÔNG CÓ VIỆC: cửa hàng lỗi thì ghi log, đi tiếp, không im lặng coi như sạch.
 *  5. Loại 'dispute_result' (nhóm Khiếu nại, kênh ưu tiên cao trên Android, mở tab Trả hàng) — loại
 *     mới phải khai 3 nơi, không thì bị lọc mất.
 *
 * ⛔ PROD `PRISMA_POOL_SIZE=1` — duyệt cửa hàng TUẦN TỰ, không `Promise.all`.
 */
import { registryPrisma, getStorePrisma, giuClient } from '../lib/prisma'
import { chayNeuLanhDao } from '../lib/leaderLock'
import { moTaLoi } from '../lib/gomLoi'
import { canNhacXacNhan, mocXacNhanBangChung, gioVN, conGioChu } from '../lib/bangChungTikTok'

const VN_MS = 7 * 3600_000
/** "2026-10-09T21" theo giờ VN — dấu "đã nhắc trong giờ này". */
const khoaGioVN = (d: Date) => new Date(d.getTime() + VN_MS).toISOString().slice(0, 13)

type GuiPush = (sp: any, tieuDe: string, noiDung: string, meta: { id?: string; type: string; route: string }) => Promise<number>
const guiPushMacDinh: GuiPush = async (sp, tieuDe, noiDung, meta) => {
    const { sendPushToStore } = await import('../routes/notifications')
    return sendPushToStore(sp, tieuDe, noiDung, meta)
}

export interface KetQuaNhacBC { store: string; soVuCho: number; daNhac: boolean; soBaoHetHan: number; lyDoBoQua?: string }

/** Nhắc cho MỘT cửa hàng. `guiPush` thay được để thử không cần máy chủ thông báo thật. */
export async function nhacBangChungChoStore(sp: any, storeCode: string, now: Date = new Date(), guiPush: GuiPush = guiPushMacDinh): Promise<KetQuaNhacBC> {
    const kq: KetQuaNhacBC = { store: storeCode, soVuCho: 0, daNhac: false, soBaoHetHan: 0 }
    const ds: any[] = await sp.returnOrder.findMany({
        where: {
            code: { startsWith: 'RTN-TT-' },
            updatedAt: { gte: new Date(now.getTime() - 3 * 86400_000) },
            OR: [{ notes: { contains: '[Từ chối TikTok]' } }, { notes: { contains: '[Tranh chấp TikTok]' } }],
        },
        select: { code: true, notes: true, originalInvoice: true },
        take: 300,
    })

    const cho = ds
        .map(p => ({ p, c: canNhacXacNhan(p.notes, now) }))
        .filter((x): x is { p: any; c: NonNullable<ReturnType<typeof canNhacXacNhan>> } => !!x.c)
        .sort((a, b) => a.c.hetHan.getTime() - b.c.hetHan.getTime())   // gần hạn nhất lên đầu
    kq.soVuCho = cho.length

    if (cho.length) {
        const dau = `[nhac-bc-tt:${khoaGioVN(now)}]`
        const daGui = await sp.notification.findFirst({ where: { type: 'dispute_result', message: { contains: dau } }, select: { id: true } })
        if (daGui) kq.lyDoBoQua = 'đã nhắc trong giờ này'
        else {
            const gap = cho[0]!.c
            const tieuDe = cho.length === 1
                ? `⏰ TikTok: xác nhận ĐỦ BẰNG CHỨNG — ${cho[0]!.p.code} (còn ${conGioChu(gap.conPhut)})`
                : `⏰ TikTok: ${cho.length} vụ chờ xác nhận ĐỦ BẰNG CHỨNG — gấp nhất còn ${conGioChu(gap.conPhut)}`
            const noiDung = cho.slice(0, 6).map(x => `${x.p.code} · hạn ${gioVN(x.c.hetHan)}${x.c.nguon === 'tranh-chap' ? ' (khách đưa lên sàn)' : ''}`).join(' | ')
                + (cho.length > 6 ? ` (+${cho.length - 6} vụ)` : '')
                + ' — Vào TikTok Seller Center › Trả hàng/Hoàn tiền xác nhận đã đủ bằng chứng, xong bấm OK ở Việc cần làm (hoặc chi tiết vụ trả) để tắt nhắc.'
            const tin = await sp.notification.create({
                data: { type: 'dispute_result', title: tieuDe.slice(0, 200), message: `${noiDung} ${dau}`.slice(0, 1000) },
            })
            kq.daNhac = true
            try { await guiPush(sp, tieuDe, noiDung.slice(0, 300), { id: tin?.id, type: 'dispute_result', route: 'returns' }) }
            catch (e: any) { console.warn(`[NhacBangChungTT] ${storeCode}: push hỏng — ${moTaLoi(e)} (tin trong app vẫn có)`) }
        }
    }

    /* HẾT 24 GIỜ mà chưa bấm OK, sàn chưa phân xử: báo MỘT lần (trong 3 giờ sau hạn — cron có lỡ một
     * nhịp vẫn kịp), rồi thôi. Không im lặng biến mất khỏi danh sách. */
    for (const p of ds) {
        const m = mocXacNhanBangChung(p.notes)
        if (!m || m.daXacNhan || m.daKetThuc) continue
        const qua = now.getTime() - m.hetHan.getTime()
        if (qua < 0 || qua > 3 * 3600_000) continue
        const dau = `[het-bc-tt:${p.code}:${m.batDau.getTime()}]`
        const daGui = await sp.notification.findFirst({ where: { type: 'dispute_result', message: { contains: dau } }, select: { id: true } })
        if (daGui) continue
        const tieuDe = `⛔ TikTok: HẾT 24 giờ xác nhận bằng chứng — ${p.code}`
        const noiDung = `Hạn ${gioVN(m.hetHan)} đã qua mà chưa bấm OK trong Kengi. Kiểm tra trên TikTok Seller Center xem vụ còn cho bổ sung bằng chứng không.`
        const tin = await sp.notification.create({ data: { type: 'dispute_result', title: tieuDe, message: `${noiDung} ${dau}` } })
        kq.soBaoHetHan++
        try { await guiPush(sp, tieuDe, noiDung, { id: tin?.id, type: 'dispute_result', route: 'returns' }) }
        catch (e: any) { console.warn(`[NhacBangChungTT] ${storeCode}: push hết hạn hỏng — ${moTaLoi(e)}`) }
    }
    return kq
}

export async function runNhacBangChungTikTok(): Promise<void> {
    let stores: any[] = []
    try {
        stores = await registryPrisma.store.findMany({ where: { status: 'active' }, select: { code: true, schema: true } }) as any[]
    } catch (e: any) {
        console.error('[NhacBangChungTT] không đọc được danh sách cửa hàng:', moTaLoi(e))
        return
    }
    for (const store of stores) {
        const nha = giuClient(store.schema)
        try {
            const kq = await nhacBangChungChoStore(getStorePrisma(store.schema) as any, store.code)
            if (kq.daNhac || kq.soBaoHetHan) console.log(`[NhacBangChungTT] ${store.code}: ${kq.soVuCho} vụ chờ — đã nhắc${kq.soBaoHetHan ? `, ${kq.soBaoHetHan} báo hết hạn` : ''}`)
        } catch (e: any) {
            // Đi tiếp cửa hàng khác — nhưng PHẢI ghi ra: im lặng ở đây = vụ quá hạn không ai được báo
            console.error(`[NhacBangChungTT] ${store.code}: ${moTaLoi(e)}`)
        } finally {
            nha()
        }
    }
}

/** Gọi từ nhịp ngoài (POST /api/cron/tick) — một bản Cloud Run chạy mỗi lượt. */
export const nhacBangChungTuNgoai = () => chayNeuLanhDao('nhac-bang-chung-tiktok', 5 * 60_000, runNhacBangChungTikTok)

let timer: NodeJS.Timeout | null = null
/** Phần bù ban ngày khi có khách (nhịp chính là cron tick — xem nguyên tắc 2). */
export function startNhacBangChungTikTokCron(): void {
    if (timer) return
    console.log('⏰ Nhắc xác nhận bằng chứng TikTok: mỗi giờ một tin / cửa hàng (nhịp ngoài /api/cron/tick + bù 10 phút)')
    timer = setInterval(() => { nhacBangChungTuNgoai().catch(e => console.error('[NhacBangChungTT]', e?.message || e)) }, 10 * 60_000)
}
