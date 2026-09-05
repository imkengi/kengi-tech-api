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

/**
 * CẢNH BÁO CẮT TRẦN — trải vào ĐẦU object trả về của mọi tool có `take:`.
 *
 * ```ts
 * return { ...canhBaoCat(ds.length, gioiHan(a.limit), 'khách'), soKhachNo: ds.length, ... }
 * ```
 *
 * ─── VÌ SAO PHẢI CÓ ───────────────────────────────────────────────────────────
 * Tool cắt ở 20 dòng rồi trả về một danh sách trông hoàn chỉnh. AI đọc xong cộng
 * lại và nói "tổng nợ khách là 43 triệu" — trong khi đó là tổng của 20 khách đầu.
 * Không có lỗi nào nổ, con số vẫn tròn trịa, chủ shop tin và ra quyết định.
 * Đây đúng là bệnh "trần cắt âm thầm" đã cắn nhiều lần ở web; với AI thì nặng hơn
 * vì AI TỰ CỘNG chứ không chỉ hiển thị.
 *
 * ─── VÌ SAO LÀ CÂU CHỮ, KHÔNG PHẢI `chamTran: true` ───────────────────────────
 * Một cờ boolean là thứ AI rất dễ lướt qua. Một câu ra lệnh rõ ràng — "không được
 * nói tất cả / tổng cộng" — mới đổi được hành vi. Đặt Ở ĐẦU object vì phần đầu
 * được đọc kỹ nhất.
 *
 * Trả về `{}` khi chưa chạm trần, nên trải vào lúc nào cũng an toàn.
 */
/**
 * Anh em của `canhBaoCat`, cho tool cắt DANH SÁCH nhưng TỔNG vẫn đúng — vì tổng
 * lấy từ `aggregate`/`groupBy` chạy trên toàn bộ dữ liệu chứ không cộng từ danh
 * sách đã cắt (mẫu chuẩn: `list_import_receipts`).
 *
 * Phải tách riêng, không dùng chung câu với `canhBaoCat`: bảo AI rằng "mọi tổng
 * dưới đây thấp hơn thực tế" trong khi tổng đang ĐÚNG là đẩy nó đi nghi ngờ một
 * con số tốt, rồi tự đi cộng lại từ danh sách cắt — hỏng đúng thứ đang lành.
 */
export function canhBaoMau(soDong: number, tran: number, donVi = 'dòng'): Record<string, string> {
    if (!Number.isFinite(soDong) || !Number.isFinite(tran) || soDong < tran) return {}
    return {
        ghiChuDanhSach:
            `Danh sách dưới đây chỉ là ${tran} ${donVi} gần nhất (còn nữa). ` +
            `Các con số TỔNG trong kết quả này ĐÃ TÍNH TRÊN TOÀN BỘ dữ liệu nên dùng được — ` +
            `nhưng ĐỪNG tự cộng lại từ danh sách, và đừng nói danh sách này là đầy đủ.`,
    }
}

export function canhBaoCat(soDong: number, tran: number, donVi = 'dòng'): Record<string, string> {
    if (!Number.isFinite(soDong) || !Number.isFinite(tran) || soDong < tran) return {}
    return {
        canhBaoCat:
            `CHƯA ĐỦ DỮ LIỆU: chỉ đọc được ${tran} ${donVi} đầu tiên, phía sau còn nữa chưa đọc. ` +
            `Mọi con số TỔNG hoặc ĐẾM tính từ danh sách này đều THẤP HƠN thực tế. ` +
            `KHÔNG được nói "tất cả", "tổng cộng", "toàn bộ" hay đưa ra kết luận cuối cùng. ` +
            `Muốn số đúng: thu hẹp bộ lọc (theo ngày, theo nhóm, theo trạng thái) rồi gọi lại, ` +
            `hoặc dùng công cụ báo cáo tổng hợp thay vì tự cộng danh sách.`,
    }
}
