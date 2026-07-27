// ═══════════════════════════════════════════════════════════════════════════════
//  KIỂU DÙNG CHUNG CHO MCP TOOLS
//  Tách riêng khỏi routes/mcp.ts để các file tool (mcpFanpageTools…) import được
//  mà KHÔNG tạo vòng import — bundle esbuild CJS rất dễ vỡ với circular require
//  (class ToolError sẽ là undefined tại thời điểm module eval).
// ═══════════════════════════════════════════════════════════════════════════════

export type ToolCtx = {
    prisma: any
    scopes: string
    storeCode: string
    // Người thực hiện — bắt buộc cho tool GHI có FK createdBy (create_sale…).
    // Thiếu (đường admin-key) → tool tự lấy user admin đầu tiên làm actor.
    userId?: string
    userName?: string
    branchId?: string | null
}

export type Tool = {
    name: string
    description: string
    inputSchema: Record<string, unknown>
    write?: boolean
    run: (args: any, ctx: ToolCtx) => Promise<unknown>
}

/** Lỗi nghiệp vụ: tools/call trả trong result `{content, isError:true}` chứ KHÔNG
 *  phải JSON-RPC error — đúng spec MCP. */
export class ToolError extends Error { }
