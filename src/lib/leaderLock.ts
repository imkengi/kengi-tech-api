/**
 * KHOÁ LÃNH ĐẠO cho cron — chỉ MỘT bản Cloud Run được chạy một lượt cron.
 *
 * Vì sao cần: Cloud Run nhân 2–3 bản lúc đông; mỗi bản đều có bộ hẹn giờ
 * riêng nên cùng một việc (quét đơn sàn, watchdog KiotViet, hàng đợi HĐ…)
 * chạy 2–3 lần song song. Mỗi lượt lại mở client tới ĐỦ 9 cửa hàng, mà pool
 * mỗi cửa hàng chỉ 1 kết nối, DB chỉ có 50 slot → đo 7 ngày (12–18/08/2026):
 * kết nối đỉnh 51/50, nền 2 giờ sáng vẫn 36–41 — toàn là cron, không phải khách.
 *
 * Cách làm: SET key NX PX — nguyên tử trên Redis. Ai giành được thì chạy, kẻ
 * khác bỏ qua lượt này (KHÔNG chờ, KHÔNG xếp hàng). TTL = thời gian tối đa
 * hợp lý của một lượt; lượt xong sớm thì trả khoá ngay (chỉ xoá nếu còn là
 * chủ khoá — so token, tránh xoá nhầm khoá của bản khác).
 *
 * KHÔNG CÓ REDIS / REDIS RỚT → trả true (chạy như cũ). Bỏ cron hàng loạt vì
 * Redis hắt hơi là hỏng nghiệp vụ nặng hơn việc chạy trùng.
 */
import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || ''
let khoa: Redis | null = null
let redisHong = false

function client(): Redis | null {
    if (!REDIS_URL || redisHong) return null
    if (khoa) return khoa
    try {
        khoa = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 2,
            lazyConnect: true,
            retryStrategy: (n) => (n > 3 ? null : Math.min(n * 200, 2000)),
        })
        khoa.on('error', () => { /* im — fallback ở dưới */ })
        khoa.connect().catch(() => { redisHong = true })
        return khoa
    } catch {
        redisHong = true
        return null
    }
}

// Mỗi tiến trình một danh tính — để chỉ xoá khoá do chính mình giữ
const TOKEN = `${process.env.K_REVISION || 'local'}:${process.pid}:${Math.random().toString(36).slice(2)}`

/**
 * Chạy `viec` nếu giành được khoá `ten` trong `ttlMs`. Trả về true nếu đã chạy.
 * Redis không dùng được → chạy luôn (an toàn nghiệp vụ hơn là bỏ).
 */
export async function chayNeuLanhDao(ten: string, ttlMs: number, viec: () => Promise<void> | void): Promise<boolean> {
    const r = client()
    const key = `cron:leader:${ten}`
    if (!r || r.status !== 'ready') {
        await viec()
        return true
    }
    let duoc = false
    try {
        duoc = (await r.set(key, TOKEN, 'PX', Math.max(1000, ttlMs), 'NX')) === 'OK'
    } catch {
        await viec()          // Redis lỗi giữa chừng → coi như không có Redis
        return true
    }
    if (!duoc) return false
    try {
        await viec()
    } finally {
        // Trả khoá sớm nếu vẫn là của mình (compare-and-delete nguyên tử)
        try {
            await r.eval(
                'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
                1, key, TOKEN,
            )
        } catch { /* hết TTL tự rơi */ }
    }
    return true
}
