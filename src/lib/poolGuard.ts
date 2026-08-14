/**
 * CHẠY NHIỀU TRUY VẤN THEO ĐỢT — giữ cho pool cửa hàng không bị hút cạn.
 *
 * Mỗi cửa hàng có pool kết nối rất nhỏ (PRISMA_POOL_SIZE=8, có store chỉ 3).
 * Một `Promise.all` gom 10+ truy vấn nghĩa là MỘT lượt xem trang chiếm ngần ấy
 * kết nối cùng lúc. Hai người mở, hoặc đúng lúc cron chạy, là cạn pool: request
 * khác chờ tới timeout rồi trả 500 — và lỗi hiện ra ở NHỮNG TRANG KHÁC chứ
 * không phải trang gây ra, nên rất khó lần.
 *
 * Hàm này chạy theo đợt, mỗi đợt tối đa `coToiDa` truy vấn. Chậm hơn vài trăm
 * mili giây; đổi lại một trang không bao giờ tự mình làm nghẽn cả cửa hàng.
 *
 * NHẬN THUNK, KHÔNG NHẬN PROMISE SẴN. Nếu nhận promise đã tạo thì với những
 * loại chạy ngay (fetch, axios) mọi thứ đã khởi động trước khi hàm này kịp chia
 * đợt — tức là không giới hạn được gì mà vẫn tưởng là có. Bắt buộc truyền
 * `() => prisma....` để lời gọi chỉ bắt đầu khi tới lượt.
 *
 * Dùng:
 *   const [a, b, c] = await chayTheoDot([
 *       () => prisma.customer.count(),
 *       () => prisma.crmTask.count(),
 *       () => prisma.$queryRawUnsafe(...),
 *   ])
 */
/**
 * Kiểu trả về giữ nguyên BỘ (tuple) chứ không dẹp thành mảng `any[]`.
 *
 * Nếu trả `any[]` thì mỗi lần đổi từ `Promise.all` sang hàm này là mất hết kiểm
 * tra kiểu ở chỗ destructuring — đọc nhầm cột hay đảo thứ tự biến sẽ không ai
 * bắt được. Mất kiểu là cái giá quá đắt cho một tiện ích về hiệu năng, và nó
 * biến thành lý do chính đáng để không ai dùng hàm này.
 */
/* Suy kiểu từ CHÍNH giá trị trả về của thunk rồi mới bóc Promise, chứ không
 * khớp thẳng với `PromiseLike<infer R>`.
 *
 * Lý do: `req.storePrisma` mang kiểu `any`, nên thunk là `() => any`. Khớp `any`
 * với `PromiseLike<infer R>` cho ra `unknown` (TypeScript trả hợp của cả hai
 * nhánh khi gặp `any`), và mọi biến destructuring thành `unknown` — hỏng build ở
 * hàng loạt chỗ. Bóc bằng `Awaited<R>` thì `any` vẫn là `any`. */
type KetQua<T extends readonly (() => PromiseLike<any>)[]> = {
    -readonly [K in keyof T]: T[K] extends () => infer R ? Awaited<R> : never
}

/* `const T` (TS 5.0+) bắt buộc phải có: thiếu nó thì mảng truyền vào bị suy
 * thành MẢNG ĐỒNG NHẤT (mọi phần tử mang kiểu hợp của cả bộ) thay vì bộ có thứ
 * tự — và người dùng nhận về `{total} | {amount} | {totalCost}` cho MỌI biến,
 * hỏng build ở hàng loạt chỗ. */
export async function chayTheoDot<const T extends readonly (() => PromiseLike<any>)[]>(
    cac: T,
    coToiDa = 3,
): Promise<KetQua<T>> {
    const n = Math.max(1, Math.floor(coToiDa))
    const ra: any[] = []
    for (let i = 0; i < cac.length; i += n) {
        const dot = cac.slice(i, i + n).map(f => f())
        // pool-co-y: đây CHÍNH LÀ chỗ giới hạn số kết nối — mỗi đợt tối đa n cái
        ra.push(...await Promise.all(dot))
    }
    return ra as KetQua<T>
}
