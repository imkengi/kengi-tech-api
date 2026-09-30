/**
 * Key AI của cửa hàng: Gemini (chính) + DeepSeek (DỰ PHÒNG, 30/09/2026 — Gemini hết hạn
 * mức / quá tải ở mọi model thì lượt chạy chuyển sang DeepSeek). Admin nhập ở mục AI & MCP;
 * cửa hàng chưa nhập thì dùng key chung ở env (GEMINI_API_KEY / DEEPSEEK_API_KEY).
 * Dùng chung cho tác vụ AI tự động, trợ lý chat và trợ lý marketing — ba nơi tự đọc key
 * riêng là ba chỗ có thể lệch nhau.
 */
export async function layKeyAi(prisma: any): Promise<{ gemini: string; deepseek: string }> {
    let s: any = null
    try {
        s = await prisma.storeSettings.findFirst({ select: { geminiApiKey: true, deepseekApiKey: true } as any })
    } catch {
        /* cột deepseekApiKey chưa migrate ở cửa hàng này ⇒ vẫn đọc được key Gemini */
        try { s = await prisma.storeSettings.findFirst({ select: { geminiApiKey: true } as any }) } catch { /* dùng env */ }
    }
    return {
        gemini: String(s?.geminiApiKey || process.env.GEMINI_API_KEY || ''),
        deepseek: String(s?.deepseekApiKey || process.env.DEEPSEEK_API_KEY || ''),
    }
}
