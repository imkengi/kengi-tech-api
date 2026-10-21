/**
 * SỬA PHIẾU BÁN CỦA ĐƠN SÀN ĐÃ XOÁ MÀ THỰC RA KHÔNG BÁN ĐƯỢC — LUẬT (thuần, có bộ kiểm).
 * Chủ shop chọn phương án A ngày 21/10/2026: "huỷ 914 phiếu, đảo bút toán, cộng lại kho
 * cho đơn huỷ / giao thất bại / hoàn tiền có phiếu trả; chạy thử trước rồi mới ghi".
 *
 * Nhóm lấy từ lib/phanLoaiDonChuaLayPhi.ts, hỏi sàn LẠI ngay lúc chạy (không dùng kết quả cũ):
 *   huy, giao-that-bai          → huỷ phiếu + đảo bút toán + cộng lại kho
 *   hoan-tien CÓ phiếu trả sàn  → như trên (khách đã gửi hàng về)
 *   hoan-tien KHÔNG phiếu trả   → huỷ phiếu + đảo bút toán, KHÔNG cộng kho (có thể chỉ hoàn tiền)
 *   mọi nhóm khác               → KHÔNG đụng (thất lạc, quyết toán âm, khác, lỗi hỏi sàn…)
 * KHÔNG đụng hoá đơn điện tử: phiếu đã xuất HĐ vẫn huỷ, nhưng HĐ là việc kế toán lập
 * HĐ điều chỉnh/huỷ trên hệ thống HĐĐT — xuất danh sách riêng.
 */
import type { LoaiDon } from './phanLoaiDonChuaLayPhi'

export type HanhDong = 'huy-phieu-cong-kho' | 'huy-phieu' | 'bo-qua'

export interface DauVaoQuyetDinh {
    loai: LoaiDon
    coPhieuTraDaDuyet: boolean      // phiếu trả từ sàn, trạng thái khác 'rejected'
    trangThaiPhieu: string
    ngayPhieu: string               // YYYY-MM-DD (giờ VN) — ngày bán trên phiếu
    ngayKhoaSo: string | null       // PeriodLock.lockDate đang hiệu lực, null = không khoá
    donGocConTrongBang: boolean     // đơn được đồng bộ lại ⇒ để đường đảo thường lo
}

export function quyetDinh(d: DauVaoQuyetDinh): { hanhDong: HanhDong; lyDo: string } {
    if (d.donGocConTrongBang) return { hanhDong: 'bo-qua', lyDo: 'đơn gốc đã có lại trong bảng — đường đảo thường (reverseOnlineOrderEffects) lo' }
    if (/^(voided|returned)$/.test(d.trangThaiPhieu)) return { hanhDong: 'bo-qua', lyDo: `phiếu đã ở trạng thái ${d.trangThaiPhieu}` }
    if (d.ngayKhoaSo && d.ngayPhieu <= d.ngayKhoaSo) return { hanhDong: 'bo-qua', lyDo: `kỳ đã khoá sổ tới ${d.ngayKhoaSo}` }
    if (d.loai === 'huy' || d.loai === 'giao-that-bai') return { hanhDong: 'huy-phieu-cong-kho', lyDo: d.loai === 'huy' ? 'đơn huỷ' : 'giao thất bại, hàng về shop' }
    if (d.loai === 'hoan-tien') {
        return d.coPhieuTraDaDuyet
            ? { hanhDong: 'huy-phieu-cong-kho', lyDo: 'hoàn tiền, có phiếu trả từ sàn (hàng về)' }
            : { hanhDong: 'huy-phieu', lyDo: 'hoàn tiền, KHÔNG có phiếu trả — không cộng kho' }
    }
    return { hanhDong: 'bo-qua', lyDo: `nhóm ${d.loai} — không thuộc phương án A` }
}

/** Dòng kho cần cộng lại: phần CÒN ÂM của thẻ kho 'ONLINE-<mã>' theo từng hàng. Hàng đã
 *  gộp sang mã khác (mergedIntoId) hoặc đã xoá thì KHÔNG tự cộng — báo để xử lý tay. */
export function dongKhoCanCong(dong: Array<{ productId: string; rong: number; tonTai: boolean; gopVao: string | null }>) {
    const cong: Array<{ productId: string; soLuong: number }> = []
    const boQua: string[] = []
    for (const d of dong) {
        const sl = -Math.round(Number(d.rong) || 0)
        if (sl <= 0) continue
        if (!d.tonTai) { boQua.push(`${d.productId}: hàng không còn`); continue }
        if (d.gopVao) { boQua.push(`${d.productId}: đã gộp vào ${d.gopVao}`); continue }
        cong.push({ productId: d.productId, soLuong: sl })
    }
    return { cong, boQua }
}

/** Bút toán đảo: đổi chỗ Nợ/Có, cùng số tiền, ref 'REV-<ref gốc>' (unique ⇒ chạy lại vô hại). */
export function butToanDao(e: { reference: string; debitAccount: string; debitAccountName: string | null; creditAccount: string; creditAccountName: string | null; amount: number; referenceType: string; branchId: string | null }, ma: string, ngay: string) {
    return {
        date: ngay,
        description: `Đảo bút toán: đơn sàn ${ma} không bán được (đơn gốc đã bị dọn) — sửa 21/10/2026`,
        debitAccount: e.creditAccount, debitAccountName: e.creditAccountName,
        creditAccount: e.debitAccount, creditAccountName: e.debitAccountName,
        amount: e.amount, reference: `REV-${e.reference}`, referenceType: e.referenceType, branchId: e.branchId,
    }
}

export const GHI_CHU_HUY = (loai: string, lyDo: string) => ` | Huỷ 21/10/2026: đơn sàn ${loai} (đơn gốc đã bị dọn) — ${lyDo}`
