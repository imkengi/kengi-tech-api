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
import { dangTat } from '../lib/choXong'
import { moTaLoi } from '../lib/gomLoi'

const NHIP_MS = 60_000
let hen: NodeJS.Timeout | null = null
let dangChay = false

/** Id worker để truy vết ai giữ việc nào — gồm cả revision đang chạy. */
const WORKER_ID = `${process.env.K_REVISION || 'local'}-${process.pid}`

async function motLuot(): Promise<void> {
    /* Chống chồng lượt: lượt trước chưa xong thì bỏ lượt này. Không có chốt này
     * thì một cửa hàng chậm sẽ làm các lượt xếp chồng lên nhau và nhân đôi tải. */
    if (dangChay) return
    dangChay = true
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
                if (!viec) continue

                const kq = await dangMotViec(prisma, viec)
                console.log(`[MktWorker] ${st.code} · publication ${viec.id} → ${kq}`)
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
