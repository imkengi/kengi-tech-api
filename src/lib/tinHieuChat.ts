/**
 * TÍN HIỆU "CÓ TIN CHAT SÀN MỚI" — bảng "TinHieuChatSan" (24/10/2026).
 *
 * Luật Chat API của Shopee: muốn cập nhật thời gian thực thì dùng Push Mechanism (webchat_push, mã 10),
 * không hỏi vòng. Trước đây web hỏi thẳng Shopee danh sách hội thoại 15 giây/lần cho mọi kênh, tin nhắn
 * 10 giây/lần; còn sự kiện realtime phát lúc nhận push chỉ tới được trình duyệt nối CÙNG bản Cloud Run
 * (prod không có Redis — lib/pubsub.ts rơi về EventEmitter trong tiến trình) nên gần như không ai nhận.
 *
 * Nay: nhận push mã 10 ⇒ ghi một dòng tín hiệu cho kênh (mã hội thoại + giờ + số lần — KHÔNG lưu nội dung
 * tin, đúng cam kết với Shopee "không lưu nội dung chat"). Web hỏi tín hiệu 5 giây/lần — chỉ chạm DB của
 * mình — đổi thì mới gọi Shopee làm mới; hỏi thẳng Shopee chỉ còn là lưới an toàn thưa.
 */

/** Phần prisma mà file này dùng — để bộ kiểm thay bằng bản giả. */
export interface DbThuan {
    $executeRawUnsafe(sql: string, ...thamSo: any[]): Promise<number>
    $queryRawUnsafe<T = any>(sql: string, ...thamSo: any[]): Promise<T>
}

/** Tạo LƯỜI ở ghiTinHieuChat (lần đầu nhận push chat) — không cần /admin/migrate; đọc lúc bảng chưa có ⇒ rỗng. */
export const DDL_TIN_HIEU_CHAT = `CREATE TABLE IF NOT EXISTS "TinHieuChatSan" (
    "kenhId" TEXT NOT NULL PRIMARY KEY,
    "lanCuoi" TIMESTAMP(3) NOT NULL,
    "hoiThoaiId" TEXT,
    "soTin" INTEGER NOT NULL DEFAULT 0
)`

const daDamBao = new WeakSet<object>()

/** Ghi tín hiệu cho một kênh. Tạo bảng lười, một lần cho mỗi client. */
export async function ghiTinHieuChat(db: DbThuan, kenhId: string, hoiThoaiId: string | null): Promise<void> {
    if (!kenhId) return
    if (!daDamBao.has(db as any)) {
        await db.$executeRawUnsafe(DDL_TIN_HIEU_CHAT)
        daDamBao.add(db as any)
    }
    await db.$executeRawUnsafe(
        `INSERT INTO "TinHieuChatSan" ("kenhId", "lanCuoi", "hoiThoaiId", "soTin")
         VALUES ($1, (NOW() AT TIME ZONE 'UTC'), $2, 1)
         ON CONFLICT ("kenhId") DO UPDATE SET
            "lanCuoi" = EXCLUDED."lanCuoi",
            "hoiThoaiId" = EXCLUDED."hoiThoaiId",
            "soTin" = "TinHieuChatSan"."soTin" + 1`,
        kenhId, hoiThoaiId || null,
    )
}

export interface TinHieuKenh { kenhId: string; lanCuoi: string; hoiThoaiId: string | null; soTin: number }

/** Lỗi "bảng chưa có" (Postgres 42P01) — cửa hàng chưa nhận push chat nào / chưa /admin/migrate. */
export function laLoiThieuBang(e: any, bang: string): boolean {
    const s = `${e?.code || ''} ${e?.meta?.code || ''} ${e?.message || e}`
    return s.includes(bang) && /does not exist|42P01/.test(s)
}

/** Tín hiệu mọi kênh của cửa hàng. Bảng chưa có = chưa từng có push chat ⇒ danh sách rỗng (không phải lỗi). */
export async function docTinHieuChat(db: DbThuan): Promise<TinHieuKenh[]> {
    try {
        const rows: any[] = await db.$queryRawUnsafe(
            `SELECT "kenhId", "lanCuoi", "hoiThoaiId", "soTin" FROM "TinHieuChatSan" ORDER BY "kenhId"`)
        return (rows || []).map(r => ({
            kenhId: String(r.kenhId),
            lanCuoi: new Date(r.lanCuoi).toISOString(),
            hoiThoaiId: r.hoiThoaiId ? String(r.hoiThoaiId) : null,
            soTin: Number(r.soTin) || 0,
        }))
    } catch (e: any) {
        if (laLoiThieuBang(e, 'TinHieuChatSan')) return []
        throw e
    }
}
