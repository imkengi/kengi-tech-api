/* ═══════════════════════════════════════════════════════════════════════════════
 *  BỘ CANH WEBHOOK KIOTVIET — TỰ BẬT LẠI WEBHOOK BỊ KIOTVIET TẮT (16/09/2026)
 *
 *  Chủ shop 16/09: "xem thử webhook có thay đổi gì không sao không cập nhật".
 *  Lần thứ BA cùng một bệnh (15/08, 21/08, 16/09): KiotViet tự tắt webhook
 *  (`isActive=false`) → hoá đơn ngừng về mà không ai hay, cho tới khi chủ shop
 *  nhìn thấy sổ thiếu.
 *
 *  Đo 16/09: 07:35 KiotViet dội ~144 webhook → Cloud Run nhân 1 → 3 bản → kết nối
 *  DB 18 → 49/50 suốt 5 phút → 07:38:30 hai request đọc KiotVietConfig hỏng
 *  ("Too many database connections") → mã cũ nuốt lỗi thành null → trả 403 →
 *  KiotViet tắt NGAY đúng hai webhook đó (invoice.update, customer.update).
 *  Hoá đơn ngừng về 7,5 giờ. Gốc đã vá ở routes/kiotviet.ts (đọc hỏng → 503) và
 *  lib/prisma.ts (trần kết nối) — bộ canh này là LƯỚI AN TOÀN cho lần sau.
 *
 *  Mỗi 10 phút (chỉ bản lãnh đạo): với từng cửa hàng BẬT KiotViet, đọc danh sách
 *  webhook; cái nào là CỦA KENGI (url chứa /api/kiotviet/webhook/) mà đang tắt
 *  thì xoá rồi tạo lại (KiotViet không có API bật lại). KHÔNG đụng webhook trỏ
 *  hệ thống khác (n8n) — đó là quyết định của chủ shop (03/09/2026).
 *
 *  KHÔNG tự đồng bộ bù hoá đơn: chủ shop giữ quyền tự bấm các thao tác đổ dữ liệu
 *  vào sổ. Bộ canh ghi MỘT dòng vào "Lịch sử đồng bộ" nói rõ đã bật lại cái gì và
 *  khoảng ngày cần bấm đồng bộ bù.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import registryPrisma, { getStorePrisma } from '../lib/prisma'
import { chayNeuLanhDao } from '../lib/leaderLock'
import { KV, type KiotVietCreds } from '../services/kiotviet'
import { moTaLoi } from '../lib/gomLoi'

const CHU_KY = 10 * 60_000
const DUONG_KENGI = '/api/kiotviet/webhook/'

export interface KetQuaCanh {
    cuaHang: string
    webhook: Array<{ type: string; isActive: boolean; cuaKengi: boolean }>
    batLai: string[]
    loi: string[]
}

const ngayGioVN = (d: Date) => d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
const ngayVN = (d: Date) => d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' })

/**
 * Quét mọi cửa hàng bật KiotViet. `chayThu = true` → chỉ báo cáo, không xoá/tạo,
 * không ghi nhật ký (dùng cho bộ đo GET /admin/do-canh-webhook-kiotviet).
 */
export async function canhWebhookKiotViet(chayThu = false): Promise<KetQuaCanh[]> {
    /* Tìm cửa hàng BẬT KiotViet bằng client registry (một kết nối), KHÔNG mở client
     * từng cửa hàng — đi mở cả 12 client mỗi 10 phút là tự đốt ngân sách kết nối. */
    const coBang: Array<{ s: string }> = await registryPrisma.$queryRawUnsafe(
        `SELECT table_schema AS s FROM information_schema.tables WHERE table_name = 'KiotVietConfig'`)
    if (!coBang.length) return []
    const stores = await registryPrisma.store.findMany({
        where: { status: 'active', schema: { in: coBang.map(r => r.s) } },
        select: { code: true, schema: true },
    })

    const kq: KetQuaCanh[] = []
    for (const st of stores) {
        if (!/^[a-z0-9_]+$/i.test(st.schema)) continue
        const bat: any[] = await registryPrisma.$queryRawUnsafe<any[]>(
            `SELECT enabled FROM "${st.schema}"."KiotVietConfig" WHERE id = 'default'`).catch(() => [] as any[])
        if (!bat[0]?.enabled) continue

        const dong: KetQuaCanh = { cuaHang: st.code, webhook: [], batLai: [], loi: [] }
        kq.push(dong)
        const sp: any = getStorePrisma(st.schema)
        let cfg: any
        try {
            cfg = await sp.kiotVietConfig.findUnique({ where: { id: 'default' } })
        } catch (e) {
            dong.loi.push(`không đọc được cấu hình: ${moTaLoi(e)}`)
            continue
        }
        if (!cfg?.clientId || !cfg?.webhookToken) continue
        const creds: KiotVietCreds = {
            clientId: String(cfg.clientId).trim(),
            clientSecret: String(cfg.clientSecret || '').trim(),
            retailer: String(cfg.retailer || '').trim(),
        }

        let hienCo: any[]
        try {
            hienCo = (await KV.listWebhooks(creds))?.data || []
        } catch (e) {
            dong.loi.push(`không đọc được danh sách webhook từ KiotViet: ${moTaLoi(e)}`)
            continue
        }
        dong.webhook = hienCo.map((w: any) => ({
            type: String(w.type), isActive: !!w.isActive, cuaKengi: String(w.url || '').includes(DUONG_KENGI),
        }))
        const biTat = hienCo.filter((w: any) => String(w.url || '').includes(DUONG_KENGI) && !w.isActive)
        if (!biTat.length || chayThu) {
            if (chayThu) dong.batLai = biTat.map((w: any) => `${w.type} (sẽ bật lại)`)
            continue
        }

        const base = process.env.PUBLIC_API_BASE_URL || process.env.PUBLIC_API_URL || 'https://api.kengi.vn'
        const myUrl = `${base}${DUONG_KENGI}${encodeURIComponent(st.code)}/${cfg.webhookToken}`
        for (const w of biTat) {
            try {
                await KV.deleteWebhook(creds, w.id)
                await KV.createWebhook(creds, String(w.type), myUrl, `Kengi ${st.code}`)
                dong.batLai.push(String(w.type))
            } catch (e) {
                dong.loi.push(`${w.type}: ${moTaLoi(e).slice(0, 250)}`)
            }
        }

        /* Mốc để chủ shop biết đồng bộ bù từ đâu: lần cuối webhook hoá đơn ghi được.
         * Hoá đơn lọc theo NGÀY CHỨNG TỪ, mà đơn sàn tạo trước vài ngày mới hoàn thành
         * (trạng thái 3 → 1) — nên khoảng bù phải lùi thêm 14 ngày. */
        const moc = await sp.kiotVietSyncLog.findFirst({
            where: { entity: { startsWith: 'invoice.update' }, mode: 'webhook', status: { in: ['success', 'partial'] } },
            orderBy: { startedAt: 'desc' }, select: { startedAt: true },
        }).catch(() => null)
        const coHoaDon = dong.batLai.includes('invoice.update')
        const tuNgayBu = moc?.startedAt ? new Date(new Date(moc.startedAt).getTime() - 14 * 86400_000) : null
        const note = [
            dong.batLai.length
                ? `KiotViet đã TỰ TẮT ${dong.batLai.join(', ')} — bộ canh đã bật lại lúc ${ngayGioVN(new Date())}.`
                : '',
            coHoaDon
                ? `Hoá đơn hoàn thành trong lúc webhook tắt CHƯA về Kengi (webhook hoá đơn ghi được lần cuối: ${moc?.startedAt ? ngayGioVN(new Date(moc.startedAt)) : 'không rõ'}). `
                + `Bấm Đồng bộ → chọn Hoá đơn → từ ngày ${tuNgayBu ? ngayVN(tuNgayBu) : '(14 ngày trước)'} tới hôm nay → chạy thử xem số rồi Ghi thật.`
                : '',
            dong.loi.length ? `Lỗi: ${dong.loi.join(' | ')}` : '',
        ].filter(Boolean).join('\n')
        const bayGio = new Date()
        await sp.kiotVietSyncLog.create({
            data: {
                entity: 'webhook-watchdog', mode: 'cron',
                status: dong.loi.length ? (dong.batLai.length ? 'partial' : 'failed') : 'success',
                fetched: biTat.length, created: 0, updated: dong.batLai.length, skipped: 0, failed: dong.loi.length,
                errors: note.slice(0, 2000) || null,
                startedAt: bayGio, finishedAt: bayGio,
            },
        }).catch((e: any) => console.error(`[KiotViet canh] ${st.code}: không ghi được nhật ký: ${moTaLoi(e)}`))
        console.warn(`[KiotViet canh] ${st.code}: ${note.replace(/\n/g, ' ')}`)
    }
    return kq
}

let timer: NodeJS.Timeout | null = null
let dangChay = false

async function luot(): Promise<void> {
    if (dangChay) return
    dangChay = true
    try {
        await chayNeuLanhDao('kiotviet-webhook-canh', CHU_KY - 60_000, async () => { await canhWebhookKiotViet(false) })
    } catch (e) {
        console.error(`[KiotViet canh] lượt quét hỏng: ${moTaLoi(e)}`)
    } finally {
        dangChay = false
    }
}

export function startKiotVietWebhookWatchdog(): void {
    if (timer) return
    const dau = setTimeout(luot, 3 * 60_000)
    if (typeof dau.unref === 'function') dau.unref()
    timer = setInterval(luot, CHU_KY)
    if (typeof timer.unref === 'function') timer.unref()
}

export function stopKiotVietWebhookWatchdog(): void {
    if (timer) clearInterval(timer)
    timer = null
}
