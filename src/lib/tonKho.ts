// ─────────────────────────────────────────────────────────────────────────────
//  TỒN KHO: BÁO CÁO GOM SẴN + VỊ TỪ LỌC "HẾT / SẮP HẾT / CÒN" (15/09/2026)
//
//  Một chỗ duy nhất định nghĩa ba nhóm tồn, dùng chung cho:
//    - GET /products?stockStatus=        (danh sách web + app, có phân trang)
//    - GET /products/bao-cao-ton-kho     (báo cáo tồn kho — app Android)
//    - GET /admin/do-ton-kho             (bộ đo: số báo cáo PHẢI bằng số danh sách)
//  Hai nơi tự viết hai kiểu thì nút "Sắp hết (12)" bấm vào ra 3 mã — đúng bệnh
//  đã có trước ngày này.
//
//  Ba nhóm KHÔNG giao nhau, cộng lại đủ mọi mã:
//    hết     = stock <= 0            (gồm tồn âm)
//    sắp hết = 0 < stock <= minStock (chỉ mã có đặt minStock mới rơi vào được)
//    còn     = stock > 0 và không sắp hết
// ─────────────────────────────────────────────────────────────────────────────

export type TrangThaiTon = 'out_of_stock' | 'low_stock' | 'in_stock'

/**
 * Gắn điều kiện lọc tồn vào `where` của prisma.product (sửa tại chỗ).
 * So hai cột (stock <= minStock) Prisma không viết thẳng được trong where, nên
 * lấy danh sách id sắp hết bằng SQL — tập này nhỏ.
 */
export async function apLocTon(prisma: any, where: Record<string, any>, stockStatus: unknown): Promise<void> {
    if (stockStatus === 'out_of_stock') {
        where.stock = { lte: 0 }
        return
    }
    if (stockStatus !== 'low_stock' && stockStatus !== 'in_stock') return
    const dsSapHet: Array<{ id: string }> = await prisma.$queryRawUnsafe(
        `SELECT id FROM "Product" WHERE stock > 0 AND stock <= "minStock"`)
    const idSapHet = dsSapHet.map(r => r.id)
    if (stockStatus === 'low_stock') {
        where.id = { in: idSapHet }
    } else {
        where.stock = { gt: 0 }
        if (idSapHet.length > 0) where.id = { notIn: idSapHet }
    }
}

const TRUONG_SO = ['soMa', 'hetHang', 'sapHet', 'conHang', 'tonAm', 'maGop', 'thieuGiaVon', 'tongTon', 'giaTriVon', 'giaTriBan'] as const
export type SoLieuTonKho = Record<typeof TRUONG_SO[number], number>
export interface NhomTonKho extends SoLieuTonKho { categoryId: string | null; ten: string }

/**
 * Báo cáo tồn kho theo nhóm hàng — MỘT câu GROUP BY, chỉ hàng hoá (`goods`).
 *
 * GIÁ TRỊ chỉ cộng tồn DƯƠNG và bỏ MÃ ĐÃ GỘP:
 *  - tồn âm là số sai cần kiểm kê chứ không phải "giá trị âm" — cộng vào thì tổng
 *    tụt lặng lẽ; đếm riêng `tonAm` để màn hình nói ra;
 *  - mã đã gộp (mergedIntoId) giữ hàng ở MÃ ĐÍCH, cộng cả hai là đếm hàng hai lần.
 * Mã còn tồn mà giá vốn <= 0 làm giá trị vốn bị hụt → đếm `thieuGiaVon`.
 * Số ĐẾM (hết/sắp hết/còn) thì giữ cả mã gộp và tồn âm — để khớp từng mã với danh
 * sách lọc, vốn cũng không loại chúng.
 */
export async function lapBaoCaoTonKho(prisma: any): Promise<{ tongQuan: SoLieuTonKho; theoNhom: NhomTonKho[]; capNhatLuc: string }> {
    const rows: any[] = await prisma.$queryRawUnsafe(`
        SELECT p."categoryId" AS "categoryId",
               COALESCE(NULLIF(TRIM(c.name), ''), 'Chưa phân loại') AS "ten",
               COUNT(*)::int AS "soMa",
               COUNT(*) FILTER (WHERE p.stock <= 0)::int AS "hetHang",
               COUNT(*) FILTER (WHERE p.stock > 0 AND p.stock <= p."minStock")::int AS "sapHet",
               COUNT(*) FILTER (WHERE p.stock > 0 AND p.stock > p."minStock")::int AS "conHang",
               COUNT(*) FILTER (WHERE p.stock < 0)::int AS "tonAm",
               COUNT(*) FILTER (WHERE p."mergedIntoId" IS NOT NULL)::int AS "maGop",
               COUNT(*) FILTER (WHERE p."mergedIntoId" IS NULL AND p.stock > 0 AND p."costPrice" <= 0)::int AS "thieuGiaVon",
               COALESCE(SUM(p.stock) FILTER (WHERE p."mergedIntoId" IS NULL AND p.stock > 0), 0)::float8 AS "tongTon",
               COALESCE(SUM(p.stock * p."costPrice") FILTER (WHERE p."mergedIntoId" IS NULL AND p.stock > 0), 0)::float8 AS "giaTriVon",
               COALESCE(SUM(p.stock * p."sellingPrice") FILTER (WHERE p."mergedIntoId" IS NULL AND p.stock > 0), 0)::float8 AS "giaTriBan"
          FROM "Product" p
          LEFT JOIN "Category" c ON c.id = p."categoryId"
         WHERE p."productType" = 'goods'
         GROUP BY p."categoryId", c.name
         ORDER BY "giaTriVon" DESC, "soMa" DESC`)

    const theoNhom: NhomTonKho[] = rows.map(r => {
        const dong: any = { categoryId: r.categoryId ?? null, ten: String(r.ten) }
        for (const k of TRUONG_SO) dong[k] = Number(r[k]) || 0
        return dong
    })
    const tongQuan = {} as SoLieuTonKho
    for (const k of TRUONG_SO) tongQuan[k] = theoNhom.reduce((a, x) => a + x[k], 0)
    return { tongQuan, theoNhom, capNhatLuc: new Date().toISOString() }
}
