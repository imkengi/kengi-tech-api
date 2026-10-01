/**
 * WORKER ĐĂNG BÀI — Marketing Studio, 05/09/2026
 *
 * ⚠ ĐÂY LÀ CHỖ DỄ GIẾT MÁY CHỦ NHẤT CỦA CẢ MODULE. Đọc hết phần này trước khi sửa.
 *
 * Prod chạy `PRISMA_POOL_SIZE=1` — MỖI CỬA HÀNG ĐÚNG MỘT KẾT NỐI. Đo 05/09/2026:
 * đã có 819 lần cạn kết nối trong 24h và 69 lần container sập vì SIGSEGV trong 30
 * ngày, chỉ vì một vòng lặp đồng bộ đơn quét thừa. Thêm một vòng lặp nền nữa mà
 * làm ẩu là đổ dầu vào lửa.
 *
 * Bốn luật, đừng phá:
 *
 *  1. TUẦN TỰ. Không `Promise.all`, không `setInterval` riêng cho mỗi cửa hàng.
 *     Một vòng lặp duy nhất, đi hết cửa hàng này mới sang cửa hàng khác.
 *
 *  2. BỌC `giuClient(schema)`. Bộ thải client nhàn rỗi chỉ nhìn `lastUsed`, và nó
 *     từng gọi `$disconnect()` NGAY DƯỚI CHÂN một cron đang chạy — 12 lần restart,
 *     289 đơn hỏng đêm 17→18/08. Xem chú thích của `giuClient()` ở lib/prisma.ts.
 *
 *  3. CỜ REGISTRY. Chỉ chạm cửa hàng có `hasMarketing = true`. 11 cửa hàng nhưng
 *     chỉ vài cửa hàng có lịch đăng — bỏ qua phần còn lại là không tốn kết nối nào.
 *     Đây chính là thứ giữ cho pool sống.
 *
 *  4. MỘT VIỆC MỖI LƯỢT MỖI CỬA HÀNG. Bài đăng không gấp tới mức phải giành pool
 *     với việc bán hàng. Còn việc thì lượt sau làm tiếp.
 *
 * Nhịp 60 giây (bản độc lập để 15 giây — quá dày cho pool này).
 */
import { registryPrisma, getStorePrisma, giuClient } from '../lib/prisma'
import { giatMotViec, dangMotViec } from '../services/mktDangBai'
import { chonLuotCanLamMoi, keoSoLieu, danhDauHong } from '../services/mktSoLieu'
import { dangTat } from '../lib/choXong'
import { moTaLoi } from '../lib/gomLoi'

const NHIP_MS = 60_000
/* TỰ LÀM MỚI SỐ LIỆU (30/09/2026): 30 phút một lần, mỗi cửa hàng tối đa 2 bài, và CHỈ ở
 * lượt cửa hàng đó không có bài nào cần đăng (luật 4: một việc mỗi lượt — đăng bài luôn
 * được trước). Trước đây số liệu chỉ đổi khi người bấm Đồng bộ nên đứng yên ở số lúc bấm. */
const LAM_MOI_MOI_N_LUOT = 30
const SO_BAI_LAM_MOI_MOI_LAN = 2
let hen: NodeJS.Timeout | null = null
let dangChay = false
let soLuot = 0

/** Id worker để truy vết ai giữ việc nào — gồm cả revision đang chạy. */
const WORKER_ID = `${process.env.K_REVISION || 'local'}-${process.pid}`

async function motLuot(): Promise<void> {
    /* Chống chồng lượt: lượt trước chưa xong thì bỏ lượt này. Không có chốt này
     * thì một cửa hàng chậm sẽ làm các lượt xếp chồng lên nhau và nhân đôi tải. */
    if (dangChay) return
    dangChay = true
    soLuot++
    const toiLamMoi = soLuot % LAM_MOI_MOI_N_LUOT === 0
    try {
        const stores = await registryPrisma.store.findMany({
            where: { status: 'active', hasMarketing: true },
            select: { code: true, schema: true },
            orderBy: { code: 'asc' },
        })

        for (const st of stores) {
            if (dangTat()) return   // container đang thu hồi — dừng ngay, lượt sau làm tiếp

            /* ⛔ BẮT BUỘC. Xem luật 2 ở đầu file. */
            const nhaClient = giuClient(st.schema)
            try {
                const prisma: any = getStorePrisma(st.schema)
                const viec = await giatMotViec(prisma, WORKER_ID)
                if (viec) {
                    const kq = await dangMotViec(prisma, viec)
                    console.log(`[MktWorker] ${st.code} · publication ${viec.id} → ${kq}`)
                    continue
                }
                if (!toiLamMoi) continue
                // Không có bài cần đăng ⇒ tới lượt làm mới số liệu (tuần tự, tối đa 2 bài)
                for (const pub of await chonLuotCanLamMoi(prisma, SO_BAI_LAM_MOI_MOI_LAN)) {
                    if (dangTat()) return
                    try {
                        const cs = await keoSoLieu(prisma, pub)
                        console.log(`[MktWorker] ${st.code} · số liệu ${pub.id} (${pub.account?.platform}) → xem ${cs.views ?? '—'} · thích ${cs.likes ?? '—'}`)
                    } catch (e: any) {
                        danhDauHong(pub.id)
                        console.warn(`[MktWorker] ${st.code} · số liệu ${pub.id} hỏng, thử lại sau 3 giờ: ${moTaLoi(e)}`)
                    }
                }
            } catch (err: any) {
                /* Một cửa hàng hỏng KHÔNG được làm chết cả vòng — nhưng phải NÓI RA. */
                console.error(`[MktWorker] ${st.code}: ${moTaLoi(err)}`)
            } finally {
                nhaClient()
            }
        }
    } catch (err: any) {
        console.error(`[MktWorker] lượt hỏng: ${moTaLoi(err)}`)
    } finally {
        dangChay = false
    }
}

/**
 * Nhịp do Cloud Scheduler gọi qua POST /api/cron/tick (routes/cronTick.ts) — chạy TRONG
 * request nên có CPU. Cloud Run chạy cpu-throttling: setInterval bên dưới chỉ có CPU khi
 * đang có khách dùng; tối muộn / sáng sớm không ai vào là bài hẹn giờ đứng im. Lượt đang
 * chạy dở (của setInterval hay nhịp trước) thì bỏ qua — y như luật 1 ở đầu file.
 */
export async function nhipMktTuNgoai(): Promise<'xong' | 'dang-chay'> {
    if (dangChay) return 'dang-chay'
    await motLuot()
    return 'xong'
}

export function startMktWorker(): void {
    if (hen) return
    hen = setInterval(() => { void motLuot() }, NHIP_MS)
    /* `unref()` để hẹn giờ không giữ tiến trình sống — thiếu nó thì container
     * không thoát được lúc Cloud Run thu hồi, và bị giết bằng SIGKILL. */
    if (typeof hen.unref === 'function') hen.unref()
    console.log(`[MktWorker] bật, nhịp ${NHIP_MS / 1000}s, worker=${WORKER_ID}`)
}

export function stopMktWorker(): void {
    if (hen) { clearInterval(hen); hen = null }
}
