/**
 * PHÂN LOẠI ĐƠN SÀN ĐÃ XOÁ MÀ SÀN KHÔNG TRẢ SỐ PHÍ (21/10/2026) — CHỈ ĐỌC.
 *
 * Sau đợt lấy lại phí (services/layLaiPhiSan.ts), các phiếu còn lại ở PhiSanDon
 * 'chua-lay-duoc' KHÔNG phải "sàn quên trả số". Soi thô một đơn mẫu: Shopee ghi
 * COMPLETED, nhưng vận đơn LOGISTICS_DELIVERY_FAILED (đơn COD giao thất bại, hàng
 * quay về shop), escrow_amount −2.700. Tức là KHÔNG có bán hàng thật — mà phiếu
 * 'ONLINE-<mã>' vẫn ghi đủ doanh thu và đã trừ kho, vì đơn gốc bị cron dọn xoá trước
 * khi kịp đảo (reverseOnlineOrderEffects cần đơn gốc nên với đơn đã xoá nó không làm gì).
 *
 * File này chỉ PHÂN LOẠI + đọc trạng thái sổ của từng phiếu để chủ shop quyết cách
 * sửa. KHÔNG ghi gì — sửa phiếu/kho/hoá đơn là việc kế toán, chủ shop quyết.
 * Luật: đọc không được thì nói "lỗi hỏi sàn", KHÔNG xếp đại vào một nhóm.
 */

export type LoaiDon =
    | 'huy'               // sàn báo huỷ: không có bán hàng
    | 'giao-that-bai'     // vận đơn giao thất bại / hoàn về người bán: hàng về shop, không có tiền
    | 'that-lac'          // vận đơn báo thất lạc: hàng không về, xem sàn có đền không
    | 'hoan-tien'         // đã giao rồi khách trả hàng / được hoàn tiền
    | 'quyet-toan-am'     // sàn quyết toán ÂM mà không thấy dấu trả/huỷ — lỗ phí
    | 'chua-quyet-toan'   // đơn bình thường, sàn chưa chốt tiền (TikTok chốt chậm)
    | 'khong-tim-thay'    // không gian nào của cửa hàng nhận đơn này
    | 'loi-hoi-san'       // hỏi sàn lỗi (mạng, giới hạn lượt, token) — chưa kết luận
    | 'khac'              // có dữ liệu mà không khớp luật nào — xem tay

export interface DuLieuSan {
    san: 'shopee' | 'tiktok'
    gianId: string | null           // gian nhận đơn; null = không gian nào nhận
    loiHoi?: string                 // lỗi khi hỏi (không phải "không tìm thấy")
    trangThai?: string              // order_status (Shopee) / status (TikTok)
    huyBoi?: string                 // cancel_by / cancellation_initiator
    lyDoHuy?: string
    vanDon?: string                 // logistics_status (Shopee)
    // Shopee escrow (order_income) — số thô
    thucNhan?: number | null        // escrow_amount / settlement_amount
    giaBan?: number | null          // order_selling_price
    khachTra?: number | null        // buyer_total_amount
    hoanChoKhach?: number | null    // seller_return_refund (âm = hoàn cho khách)
    phiShipHoan?: number | null     // final_return_to_seller_shipping_fee
    thanhToan?: string              // buyer_payment_method / is_cod
    soGiaoDichQuyetToan?: number    // TikTok: số dòng statement
}

const co = (v: unknown, re: RegExp) => re.test(String(v || ''))

/** Thứ tự luật = thứ tự ưu tiên. Giao thất bại đứng TRƯỚC hoàn tiền: đơn COD giao
 *  hỏng vẫn có seller_return_refund âm (đo 21/10/2026), nhìn mỗi trường đó là xếp nhầm. */
export function phanLoaiDon(d: DuLieuSan): { loai: LoaiDon; lyDo: string } {
    if (d.loiHoi) return { loai: 'loi-hoi-san', lyDo: d.loiHoi }
    if (!d.gianId) return { loai: 'khong-tim-thay', lyDo: 'không gian nào của cửa hàng nhận mã đơn này' }
    const tt = String(d.trangThai || '').toUpperCase()
    if (/^(CANCELLED|IN_CANCEL)$/.test(tt)) {
        return { loai: 'huy', lyDo: `sàn báo ${tt}${d.huyBoi ? ` (huỷ bởi ${d.huyBoi})` : ''}${d.lyDoHuy ? ` — ${d.lyDoHuy}` : ''}` }
    }
    // Bộ trạng thái vận đơn của Shopee v2 (logistics_status): DELIVERY_DONE, DELIVERY_FAILED,
    // COD_REJECTED, PICKUP_FAILED, REQUEST_CANCELED, LOST…
    if (co(d.vanDon, /LOST/i)) return { loai: 'that-lac', lyDo: `vận đơn ${d.vanDon}` }
    if (co(d.vanDon, /PICKUP_FAILED|REQUEST_CANCELED/i)) return { loai: 'huy', lyDo: `vận đơn ${d.vanDon} (hàng chưa rời shop)` }
    if (co(d.vanDon, /DELIVERY_FAILED|COD_REJECTED/i)) {
        return { loai: 'giao-that-bai', lyDo: `vận đơn ${d.vanDon}${d.thanhToan ? ` · ${d.thanhToan}` : ''}` }
    }
    if (tt === 'TO_RETURN' || (Number(d.hoanChoKhach) || 0) < 0) {
        return { loai: 'hoan-tien', lyDo: tt === 'TO_RETURN' ? 'sàn báo TO_RETURN' : `hoàn cho khách ${d.hoanChoKhach}` }
    }
    if ((Number(d.thucNhan) || 0) < 0) return { loai: 'quyet-toan-am', lyDo: `thực nhận ${d.thucNhan}` }
    if (d.san === 'tiktok' && !d.soGiaoDichQuyetToan && /^(COMPLETED|DELIVERED|IN_TRANSIT|AWAITING_COLLECTION)$/.test(tt)) {
        return { loai: 'chua-quyet-toan', lyDo: `sàn báo ${tt}, chưa có dòng quyết toán` }
    }
    return { loai: 'khac', lyDo: `trạng thái ${tt || '?'} · vận đơn ${d.vanDon || '?'} · thực nhận ${d.thucNhan ?? '?'}` }
}

/** Hỏi nhầm gian: Shopee trả error_not_found / "does not belong to you". Phân biệt với
 *  lỗi thật (token, giới hạn lượt) — lỗi thật KHÔNG được coi là "không thuộc gian này". */
export function laSaiGianShopee(data: any): boolean {
    const s = `${data?.error || ''} ${data?.message || ''}`
    return /not_found|not found|does not belong|invalid order/i.test(s)
}

/* ─── Đối chiếu sổ cho từng phiếu (đọc) ───────────────────────────────────── */

export const TIEN_TO_BUT_TOAN = ['SALE-', 'VAT-', 'DISC-', 'COGS-', 'COLLECT-'] as const

/** Mọi mã bút toán có thể có của một phiếu (cùng bộ với onlineOrderReversal) + bản đảo. */
export function maButToanCuaPhieu(soPhieu: string): string[] {
    const goc = TIEN_TO_BUT_TOAN.map(p => `${p}${soPhieu}`)
    return [...goc, ...goc.map(r => `REV-${r}`)]
}

export const SQL_PHIEU_CHUA_LAY_PHI = `
    SELECT f."orderNumber", f.platform, t.id AS "transactionId", t."receiptNumber", t.total, t.status,
           t."transactionDate", t."createdAt", t."vatStatus", (t."vatInvoiceNumber" IS NOT NULL) AS "coSoHoaDon",
           COUNT(*) OVER ()::int AS tong
    FROM "PhiSanDon" f
    JOIN "Transaction" t ON t."receiptNumber" = 'ONLINE-' || f."orderNumber"
    WHERE f.nguon = 'chua-lay-duoc' AND f."netRevenue" = 0
    ORDER BY f."orderNumber"
    OFFSET $1 LIMIT $2`

/** Kho của cửa hàng: quantity CÓ DẤU (out âm, hoàn dương) theo referenceId 'ONLINE-<mã>'. */
export const SQL_SO_KHO = `
    SELECT "referenceId" AS ref, COALESCE(SUM(quantity), 0)::float8 AS rong,
           COALESCE(SUM(quantity) FILTER (WHERE quantity < 0), 0)::float8 AS da_tru,
           COALESCE(SUM(quantity) FILTER (WHERE quantity > 0), 0)::float8 AS da_hoan
    FROM "InventoryTransaction" WHERE "referenceId" = ANY($1::text[]) GROUP BY 1`

export const SQL_BUT_TOAN = `SELECT reference FROM "JournalEntry" WHERE reference = ANY($1::text[])`

/** Phiếu trả từ sàn: originalInvoice là orderNumber (đơn còn lúc tạo) hoặc mã trần (đơn đã mất). */
export const SQL_PHIEU_TRA = `
    SELECT code, status, "originalInvoice", "refundAmount" FROM "ReturnOrder" WHERE "originalInvoice" = ANY($1::text[])`

/** Kho mẹ (lib/khoMe.ts): phiếu trên thẻ kho MẸ, referenceId '<mã con>:<mã đơn>'. */
export const SQL_SO_KHO_ME = `
    SELECT "referenceId" AS ref, COALESCE(SUM(quantity), 0)::float8 AS rong
    FROM "InventoryTransaction" WHERE "referenceType" = 'kho_me_don_san' AND "referenceId" = ANY($1::text[]) GROUP BY 1`
