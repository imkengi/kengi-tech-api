// ─────────────────────────────────────────────────────────────────────────────
//  LƯU SHOP + KHO KIẾN THỨC CỦA CHATBOT (bảng ChatbotShop, mỗi schema cửa hàng) — 20/10/2026.
//  Trước đây kho kiến thức chỉ nằm trong localStorage của trang kengi.vn/chatbot ⇒ máy chủ không đọc được để trả lời
//  webhook n8n. Đọc / ghi bằng SQL THÔ (không đụng client Prisma sinh sẵn); bảng tự tạo ở lượt gọi đầu của mỗi cửa hàng
//  (giống Kengi Vault) — /admin/migrate có cùng câu CREATE.
//  Truy vấn TUẦN TỰ — pool prod = 1 (bẫy Promise.all).
// ─────────────────────────────────────────────────────────────────────────────

export const DDL_CHATBOT: string[] = [
    `CREATE TABLE IF NOT EXISTS "{s}"."ChatbotShop" ("id" TEXT NOT NULL, "ten" TEXT NOT NULL, "kenh" TEXT, "san" TEXT NOT NULL DEFAULT '', "kienThuc" TEXT NOT NULL, "thuTu" INTEGER NOT NULL DEFAULT 0, "capNhatBoi" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ChatbotShop_pkey" PRIMARY KEY ("id"))`,
]

const daTao = new Map<string, Promise<void>>()

/** Tạo bảng nếu cửa hàng chưa có (một lần mỗi schema mỗi bản máy) */
export function damBaoBangChatbot(prisma: any, schema: string): Promise<void> {
    if (!/^[a-z0-9_]+$/.test(String(schema || ''))) return Promise.reject(new Error('Schema cửa hàng không hợp lệ'))
    let p = daTao.get(schema)
    if (!p) {
        p = (async () => {
            const co: any[] = await prisma.$queryRawUnsafe(
                `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ChatbotShop'`, schema)
            if (co.length) return
            for (const cau of DDL_CHATBOT) await prisma.$executeRawUnsafe(cau.replace(/\{s\}/g, schema))
            console.log(`🤖 Chatbot: đã tạo bảng ChatbotShop cho ${schema}`)
        })().catch((e) => { daTao.delete(schema); throw e })
        daTao.set(schema, p)
    }
    return p
}

export interface DongShopChatbot {
    id: string
    ten: string
    kenh: string | null
    san: string
    thuTu: number
    kienThuc: string
    capNhatBoi: string | null
    updatedAt: Date
}

export async function dsShopChatbot(prisma: any): Promise<DongShopChatbot[]> {
    return prisma.$queryRawUnsafe(
        `SELECT "id", "ten", "kenh", "san", "thuTu", "kienThuc", "capNhatBoi", "updatedAt" FROM "ChatbotShop" ORDER BY "thuTu", "createdAt"`)
}

/** Tìm theo MÃ shop, không có thì theo TÊN (không phân biệt hoa thường / khoảng trắng) */
export async function timShopChatbot(prisma: any, maHoacTen: string): Promise<DongShopChatbot | null> {
    const gon = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    const nhe: { id: string; ten: string }[] = await prisma.$queryRawUnsafe(`SELECT "id", "ten" FROM "ChatbotShop"`)
    const trung = nhe.find(s => s.id === maHoacTen) || nhe.find(s => gon(s.ten) === gon(maHoacTen))
    if (!trung) return null
    const rows: DongShopChatbot[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "ten", "kenh", "san", "thuTu", "kienThuc", "capNhatBoi", "updatedAt" FROM "ChatbotShop" WHERE "id" = $1`, trung.id)
    return rows[0] || null
}

export async function luuShopChatbot(prisma: any, s: { id: string; ten: string; kenh: string | null; san: string; thuTu: number; kienThuc: string }, nguoi: string | null): Promise<void> {
    await prisma.$executeRawUnsafe(
        `INSERT INTO "ChatbotShop" ("id", "ten", "kenh", "san", "thuTu", "kienThuc", "capNhatBoi", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
         ON CONFLICT ("id") DO UPDATE SET "ten" = EXCLUDED."ten", "kenh" = EXCLUDED."kenh", "san" = EXCLUDED."san",
            "thuTu" = EXCLUDED."thuTu", "kienThuc" = EXCLUDED."kienThuc", "capNhatBoi" = EXCLUDED."capNhatBoi", "updatedAt" = CURRENT_TIMESTAMP`,
        s.id, s.ten, s.kenh, s.san, s.thuTu, s.kienThuc, nguoi)
}

export async function xoaShopChatbot(prisma: any, id: string): Promise<number> {
    return prisma.$executeRawUnsafe(`DELETE FROM "ChatbotShop" WHERE "id" = $1`, id)
}
