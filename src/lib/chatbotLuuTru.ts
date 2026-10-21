// ─────────────────────────────────────────────────────────────────────────────
//  LƯU SHOP + KHO KIẾN THỨC CỦA CHATBOT (bảng ChatbotShop, mỗi schema cửa hàng) — 20/10/2026.
//  Trước đây kho kiến thức chỉ nằm trong localStorage của trang kengi.vn/chatbot ⇒ máy chủ không đọc được để trả lời
//  webhook n8n. Đọc / ghi bằng SQL THÔ (không đụng client Prisma sinh sẵn); bảng tự tạo / tự vá ở lượt gọi đầu của mỗi
//  cửa hàng (giống Kengi Vault) — /admin/migrate có cùng câu lệnh.
//  21/10: thêm webhook ĐẦU VÀO (webhookToken — đường dẫn bí mật) + ĐẦU RA (webhookRa — URL n8n, webhookRaKhoa — header
//  X-Kengi-Chatbot) — lib/chatbotWebhook.ts.
//  Truy vấn TUẦN TỰ — pool prod = 1 (bẫy Promise.all).
// ─────────────────────────────────────────────────────────────────────────────

import { taoKhoaWebhook } from './chatbotWebhook'

export const DDL_CHATBOT: string[] = [
    `CREATE TABLE IF NOT EXISTS "{s}"."ChatbotShop" ("id" TEXT NOT NULL, "ten" TEXT NOT NULL, "kenh" TEXT, "san" TEXT NOT NULL DEFAULT '', "kienThuc" TEXT NOT NULL, "thuTu" INTEGER NOT NULL DEFAULT 0, "capNhatBoi" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ChatbotShop_pkey" PRIMARY KEY ("id"))`,
    `ALTER TABLE "{s}"."ChatbotShop" ADD COLUMN IF NOT EXISTS "webhookToken" TEXT`,
    `ALTER TABLE "{s}"."ChatbotShop" ADD COLUMN IF NOT EXISTS "webhookRa" TEXT`,
    `ALTER TABLE "{s}"."ChatbotShop" ADD COLUMN IF NOT EXISTS "webhookRaKhoa" TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ChatbotShop_webhookToken_key" ON "{s}"."ChatbotShop"("webhookToken")`,
]
/** Cột thêm SAU CÙNG — có nó là đủ bộ (một câu hỏi thay vì chạy cả danh sách DDL mỗi lần) */
const COT_MOC = 'webhookRaKhoa'

const daTao = new Map<string, Promise<void>>()

/** Tạo / vá bảng nếu cửa hàng chưa đủ (một lần mỗi schema mỗi bản máy) */
export function damBaoBangChatbot(prisma: any, schema: string): Promise<void> {
    if (!/^[a-z0-9_]+$/.test(String(schema || ''))) return Promise.reject(new Error('Schema cửa hàng không hợp lệ'))
    let p = daTao.get(schema)
    if (!p) {
        p = (async () => {
            const co: any[] = await prisma.$queryRawUnsafe(
                `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'ChatbotShop' AND column_name = $2`, schema, COT_MOC)
            if (co.length) return
            for (const cau of DDL_CHATBOT) await prisma.$executeRawUnsafe(cau.replace(/\{s\}/g, schema))
            console.log(`🤖 Chatbot: đã tạo / vá bảng ChatbotShop cho ${schema}`)
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
    webhookToken: string | null
    webhookRa: string | null
    webhookRaKhoa: string | null
}

const COT = `"id", "ten", "kenh", "san", "thuTu", "kienThuc", "capNhatBoi", "updatedAt", "webhookToken", "webhookRa", "webhookRaKhoa"`

export async function dsShopChatbot(prisma: any): Promise<DongShopChatbot[]> {
    return prisma.$queryRawUnsafe(`SELECT ${COT} FROM "ChatbotShop" ORDER BY "thuTu", "createdAt"`)
}

/** Tìm theo MÃ shop, không có thì theo TÊN (không phân biệt hoa thường / khoảng trắng) */
export async function timShopChatbot(prisma: any, maHoacTen: string): Promise<DongShopChatbot | null> {
    const gon = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    const nhe: { id: string; ten: string }[] = await prisma.$queryRawUnsafe(`SELECT "id", "ten" FROM "ChatbotShop"`)
    const trung = nhe.find(s => s.id === maHoacTen) || nhe.find(s => gon(s.ten) === gon(maHoacTen))
    if (!trung) return null
    const rows: DongShopChatbot[] = await prisma.$queryRawUnsafe(`SELECT ${COT} FROM "ChatbotShop" WHERE "id" = $1`, trung.id)
    return rows[0] || null
}

/** Shop có đường dẫn đầu vào này (khoá đã kiểm định dạng ở route) */
export async function timShopTheoKhoa(prisma: any, khoa: string): Promise<DongShopChatbot | null> {
    const rows: DongShopChatbot[] = await prisma.$queryRawUnsafe(`SELECT ${COT} FROM "ChatbotShop" WHERE "webhookToken" = $1`, khoa)
    return rows[0] || null
}

/** Lưu kho kiến thức + kênh bán. KHÔNG nhận khoá / URL webhook từ trang — khoá do máy chủ tự sinh lần đầu (COALESCE). */
export async function luuShopChatbot(prisma: any, s: { id: string; ten: string; kenh: string | null; san: string; thuTu: number; kienThuc: string }, nguoi: string | null): Promise<void> {
    await prisma.$executeRawUnsafe(
        `INSERT INTO "ChatbotShop" ("id", "ten", "kenh", "san", "thuTu", "kienThuc", "capNhatBoi", "updatedAt", "webhookToken", "webhookRaKhoa")
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8, $9)
         ON CONFLICT ("id") DO UPDATE SET "ten" = EXCLUDED."ten", "kenh" = EXCLUDED."kenh", "san" = EXCLUDED."san",
            "thuTu" = EXCLUDED."thuTu", "kienThuc" = EXCLUDED."kienThuc", "capNhatBoi" = EXCLUDED."capNhatBoi", "updatedAt" = CURRENT_TIMESTAMP,
            "webhookToken" = COALESCE("ChatbotShop"."webhookToken", EXCLUDED."webhookToken"),
            "webhookRaKhoa" = COALESCE("ChatbotShop"."webhookRaKhoa", EXCLUDED."webhookRaKhoa")`,
        s.id, s.ten, s.kenh, s.san, s.thuTu, s.kienThuc, nguoi, taoKhoaWebhook(), taoKhoaWebhook())
}

/** Shop lưu từ trước 21/10 chưa có khoá ⇒ cấp (khoá sinh bằng crypto ở máy chủ, không dùng random() của SQL) */
export async function boSungKhoaThieu(prisma: any): Promise<void> {
    const thieu: { id: string }[] = await prisma.$queryRawUnsafe(`SELECT "id" FROM "ChatbotShop" WHERE "webhookToken" IS NULL OR "webhookRaKhoa" IS NULL`)
    for (const s of thieu) {
        await prisma.$executeRawUnsafe(
            `UPDATE "ChatbotShop" SET "webhookToken" = COALESCE("webhookToken", $2), "webhookRaKhoa" = COALESCE("webhookRaKhoa", $3) WHERE "id" = $1`,
            s.id, taoKhoaWebhook(), taoKhoaWebhook())
    }
}

/** Đặt / xoá URL đầu ra (đã kiểm SSRF ở route). Trả số dòng đổi (0 = không có shop). */
export async function datDauRa(prisma: any, id: string, url: string | null): Promise<number> {
    return prisma.$executeRawUnsafe(
        `UPDATE "ChatbotShop" SET "webhookRa" = $2, "webhookRaKhoa" = COALESCE("webhookRaKhoa", $3), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
        id, url, taoKhoaWebhook())
}

/** Đổi khoá: 'vao' = đường dẫn đầu vào (link cũ hết dùng), 'ra' = header X-Kengi-Chatbot gửi n8n */
export async function lamMoiKhoaWebhook(prisma: any, id: string, loai: 'vao' | 'ra'): Promise<number> {
    const cot = loai === 'vao' ? '"webhookToken"' : '"webhookRaKhoa"'
    return prisma.$executeRawUnsafe(`UPDATE "ChatbotShop" SET ${cot} = $2, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`, id, taoKhoaWebhook())
}

export async function xoaShopChatbot(prisma: any, id: string): Promise<number> {
    return prisma.$executeRawUnsafe(`DELETE FROM "ChatbotShop" WHERE "id" = $1`, id)
}
