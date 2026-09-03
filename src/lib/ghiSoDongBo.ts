// ─────────────────────────────────────────────────────────────────────────────
//  GHI SỔ CHO CHỨNG TỪ ĐẾN TỪ ĐƯỜNG TỰ ĐỘNG (03/09/2026)
//
//  Năm cửa ngõ nhận dữ liệu — đồng bộ KiotViet, đồng bộ đơn sàn, đồng bộ trả
//  hàng sàn, nhập liệu hàng loạt, trả hàng của đơn sàn — trước nay tạo chứng từ
//  gốc rồi DỪNG, không sinh bút toán nào. Không có cron nào bù lại. Đo trên HUTI
//  ngày 03/09/2026: chứng từ bán 30 ngày là 4.732.610.695đ mà sổ TK 511 chỉ ghi
//  1.665.992.750đ — thiếu 64,8%.
//
//  Ba luật riêng của đường tự động, khác đường người bấm:
//
//  1. GHI SỔ HỎNG THÌ KHÔNG ĐƯỢC LÀM HỎNG LƯỢT ĐỒNG BỘ. Chứng từ vẫn phải vào —
//     mất đơn hàng nặng hơn thiếu bút toán, và bút toán thì ghi bù lại được
//     (Kế Toán → Đối chiếu sổ sách). Nhưng KHÔNG nuốt im lặng: log đủ mã chứng
//     từ và lý do, còn mục "đơn chưa vào sổ" trên tab Việc Cần Làm soi ra phần
//     còn thiếu.
//
//  2. KỲ ĐÃ KHOÁ SỔ THÌ BỎ QUA BÚT TOÁN, KHÔNG CHẶN CHỨNG TỪ. Dữ liệu đến từ hệ
//     thống nguồn bên ngoài; từ chối nhập vì kỳ đã khoá là làm hỏng đồng bộ.
//     Ghi log rõ, để người ta quyết có mở khoá ghi bù hay không.
//
//  3. NGÀY BÚT TOÁN LÀ NGÀY CHỨNG TỪ GỐC, không phải ngày chạy đồng bộ. Các
//     đường đồng bộ đã đặt `createdAt` = ngày gốc nên bộ sinh bút toán lấy đúng;
//     chỗ nào chưa thì phải truyền ngày gốc vào (xem memory ngay-ban-vs-ngay-tao-dong).
//
//  Chống ghi hai lần: mọi bút toán khoá theo `reference` (SALE-<số phiếu>,
//  IMP-<mã phiếu>…) nên chạy lại đồng bộ bao nhiêu lượt cũng không đẻ thêm.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chạy một lượt ghi sổ cho chứng từ vừa đồng bộ về.
 * Trả về true nếu ghi được, false nếu bỏ qua — không bao giờ ném lỗi ra ngoài.
 */
export async function thuGhiSo(nhan: string, fn: () => Promise<any>): Promise<boolean> {
    try {
        await fn()
        return true
    } catch (e: any) {
        if (e?.code === 'PERIOD_LOCKED') {
            console.warn(
                `[ghi-so] ${nhan}: kỳ kế toán đã khoá sổ đến ${e.lockDate} — chứng từ VẪN nhập, ` +
                'bút toán bỏ qua. Mở khoá rồi chạy Đối chiếu sổ sách → Ghi bù nếu muốn bổ sung.',
            )
            return false
        }
        console.error(`[ghi-so] ${nhan}: KHÔNG ghi được bút toán — ${e?.message || e}`)
        return false
    }
}

/**
 * Hộ kinh doanh / cá nhân KHÔNG được khấu trừ VAT đầu vào → VAT nằm luôn trong
 * giá vốn, không tách sang 1331. Đọc hỏng thì coi như doanh nghiệp (khấu trừ),
 * đúng mặc định của các đường ghi tay.
 */
export async function coKhauTruVat(prisma: any): Promise<boolean> {
    try {
        const s = await prisma.storeSettings.findFirst({ select: { businessType: true } })
        const loai = String(s?.businessType || 'company')
        return !(loai === 'household' || loai === 'individual')
    } catch {
        return true
    }
}

/** Nhãn sàn của Kengi → hậu tố tài khoản phải thu 131-<SÀN> */
export function sanCuaDon(platform?: string | null): 'shopee' | 'tiktok' | 'lazada' | 'online' {
    const p = String(platform || '').toLowerCase()
    if (p.includes('shopee')) return 'shopee'
    if (p.includes('tiktok')) return 'tiktok'
    if (p.includes('lazada')) return 'lazada'
    return 'online'
}
