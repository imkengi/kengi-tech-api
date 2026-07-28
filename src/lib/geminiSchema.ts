// ═══════════════════════════════════════════════════════════════════════════════
//  JSON Schema (MCP inputSchema) → schema function-calling của Gemini.
//
//  Nằm ở lib chứ không ở routes/mcpAgent để aiAgentRunner dùng được mà KHÔNG tạo
//  vòng import (runner ← mcpAgent ← runner). Bundle esbuild CJS vỡ rất khó chẩn
//  đoán với circular require — cùng lý do đã tách lib/mcpTypes.ts.
//
//  Gemini không nhận additionalProperties/$schema; `type` phải VIẾT HOA.
//  Kiểm tra toàn bộ tool bằng: npm run check:mcp
// ═══════════════════════════════════════════════════════════════════════════════

export function toGeminiSchema(node: any): any {
    if (!node || typeof node !== 'object') return { type: 'STRING' }
    const t = String(node.type || 'string').toUpperCase()
    if (t === 'OBJECT') {
        const props: any = {}
        for (const [k, v] of Object.entries(node.properties || {})) props[k] = toGeminiSchema(v)
        const out: any = { type: 'OBJECT', properties: props }
        if (Array.isArray(node.required) && node.required.length) out.required = node.required
        return out
    }
    if (t === 'ARRAY') {
        const arr: any = { type: 'ARRAY', items: toGeminiSchema(node.items) }
        if (node.description) arr.description = node.description
        return arr
    }
    const out: any = { type: t }
    if (node.description) out.description = node.description
    // Giữ enum: thiếu nó Gemini hay bịa giá trị ngoài tập hợp cho phép
    // (media_type, match_type, action... của nhóm tool fanpage_*).
    if (Array.isArray(node.enum) && node.enum.length) out.enum = node.enum.map(String)
    return out
}
