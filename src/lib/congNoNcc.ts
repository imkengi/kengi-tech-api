/**
 * CÔNG NỢ PHẢI TRẢ NHÀ CUNG CẤP — MỘT CÔNG THỨC CHO MỌI MÀN HÌNH (18/08/2026)
 *
 * App định nghĩa (routes/suppliers.ts, debt-history):
 *     công nợ hiển thị = Supplier.payable (SỐ DƯ ĐẦU KỲ) + Σ phiếu nhập chưa trả + Σ PO chưa nhận
 *
 * Bẫy đã dính (HUTI, đo 18/08/2026): đồng bộ KiotViet ghi `payable = kv.debt` — là TỔNG NỢ
 * HIỆN TẠI của KV, vốn đã gồm các PO đã đồng bộ thành phiếu nhập — rồi trang danh sách cộng
 * thêm Σ phiếu chưa trả ⇒ ĐẾM ĐÔI: hiện 40,49 tỷ = 20,15 tỷ (Σ payable) + 20,34 tỷ (tổng
 * giá trị nhập), khớp đến từng đồng, trong khi KiotViet nói 20,15 tỷ. Con số "40 tỷ" từng
 * được báo là đọc từ chỗ đếm đôi này.
 *
 * Luật: với NCC đồng bộ KiotViet, `payable` phải là PHẦN DƯ = kv.debt − Σ phiếu chưa trả
 * (số dư đầu kỳ đúng nghĩa), để payable + Σ phiếu = kv.debt. Phần dư có thể ÂM (KV nói nợ
 * ít hơn Σ phiếu ⇒ có khoản đã trả nhưng chưa gắn vào phiếu — như "phiếu treo ≠ nợ" bên
 * khách hàng); màn hình kẹp ≥ 0 khi hiển thị, nhưng khi ĐỐI CHIẾU với KV phải so số chưa kẹp.
 */

/** Phiếu nhập còn nợ bao nhiêu — cùng luật với GET /suppliers: 'paid' = đã trả đủ dù paidAmount 0
 *  (phiếu cũ trước khi có theo dõi thanh toán). */
export function conLaiPhieu(r: { totalCost?: number | null; paidAmount?: number | null; paymentStatus?: string | null }): number {
    const tong = Number(r?.totalCost) || 0
    if (r?.paymentStatus === 'paid') return 0
    const daTra = Math.min(tong, Number(r?.paidAmount) || 0)
    return Math.max(0, tong - daTra)
}

/** Số dư đầu kỳ suy từ KV: phần KV nói nợ mà phiếu Kengi không giải thích được (có thể âm). */
export function soDuDauKyTuKV(kvDebt: number, tongPhieuChuaTra: number): number {
    return Math.round((Number(kvDebt) || 0) - (Number(tongPhieuChuaTra) || 0))
}

/** Công nợ hiển thị (chưa kẹp) = số dư đầu kỳ + Σ phiếu chưa trả (+ PO chưa nhận nếu có). */
export function congNoChuaKep(payable: number, tongPhieuChuaTra: number, poChuaNhan = 0): number {
    return Math.round((Number(payable) || 0) + (Number(tongPhieuChuaTra) || 0) + (Number(poChuaNhan) || 0))
}

/** Công nợ hiển thị trên màn hình — kẹp ≥ 0 như trang danh sách NCC. */
export function congNoHienThi(payable: number, tongPhieuChuaTra: number, poChuaNhan = 0): number {
    return Math.max(0, congNoChuaKep(payable, tongPhieuChuaTra, poChuaNhan))
}

/** Σ phiếu chưa trả theo NCC — đọc DB một lượt. Trạng thái lọc `notIn ['cancelled','draft']`
 *  y hệt GET /suppliers để hai màn hình cùng một số.
 *  ⚠ NÉM LỖI khi không đọc được (rà soát độc lập 19/08/2026): bản đầu `.catch(() => [])` biến "không đọc
 *  được" thành Σ = 0 ⇒ payable = kv.debt trọn ⇒ đếm đôi 40 tỷ tái phát ngay trong cron apply với log "đã sửa".
 *  Bên GHI payable phải bắt lỗi và KHÔNG ghi; bên ĐỌC cứ để 500 còn hơn số sai. */
export async function tongPhieuChuaTraTheoNcc(sp: any, supplierIds?: string[]): Promise<Map<string, { tong: number; so: number }>> {
    const where: any = { status: { notIn: ['cancelled', 'draft'] }, supplierId: { not: null } }
    if (supplierIds && supplierIds.length) where.supplierId = { in: supplierIds }
    /* TRẦN 50.000: đủ cho mọi cửa hàng hiện nay, nhưng nếu có ngày chạm trần thì Σ phiếu bị HỤT —
     * mà con số này còn được GHI vào Supplier.payable, tức là sai số sẽ đóng cứng vào sổ. Cùng lý do
     * với việc bỏ `.catch(() => [])`: thà 500 còn hơn số sai. Chạm trần ⇒ ném lỗi có tên rõ ràng
     * để bên ghi payable bỏ qua lượt đó (20/08/2026 — họ hàng của Dạng 16 "cắt ngầm"). */
    const TRAN = 50000
    const rows: any[] = await sp.importReceipt.findMany({
        where, select: { supplierId: true, totalCost: true, paidAmount: true, paymentStatus: true }, take: TRAN,
    })   // không .catch — lỗi đọc phiếu phải chặn ghi payable
    if (rows.length >= TRAN) {
        throw new Error(`tongPhieuChuaTraTheoNcc: chạm trần ${TRAN} phiếu nhập — Σ sẽ thiếu, không được dùng để ghi payable. Cần đọc theo trang trước khi bỏ trần.`)
    }
    const out = new Map<string, { tong: number; so: number }>()
    for (const r of rows) {
        const cl = conLaiPhieu(r)
        if (cl <= 0) continue
        const cur = out.get(r.supplierId) || { tong: 0, so: 0 }
        cur.tong += cl; cur.so += 1
        out.set(r.supplierId, cur)
    }
    return out
}
