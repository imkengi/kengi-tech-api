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
export async function chayTheoDot<T = any>(
    cac: Array<() => PromiseLike<T>>,
    coToiDa = 3,
): Promise<T[]> {
    const n = Math.max(1, Math.floor(coToiDa))
    const ra: T[] = []
    for (let i = 0; i < cac.length; i += n) {
        const dot = cac.slice(i, i + n).map(f => f())
        // pool-co-y: đây CHÍNH LÀ chỗ giới hạn số kết nối — mỗi đợt tối đa n cái
        ra.push(...await Promise.all(dot))
    }
    return ra
}
