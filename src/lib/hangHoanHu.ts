// ─────────────────────────────────────────────────────────────────────────────
//  HÀNG HOÀN KHÔNG NGUYÊN VẸN → CHỈ VÀO KHO HƯ HỎNG KHI KHIẾU NẠI THẮNG (09/10/2026)
//
//  Chủ shop: "đối với các sản phẩm trừ nguyên vẹn thì phải chờ khiếu nại thành công với
//  Shopee hoặc tiktok mới trả vào kho hàng hư hỏng, không thì sẽ báo thông báo và đưa vào
//  việc cần làm để khiếu nại tiếp".
//
//  Trạm quay ghi "[Nhận hàng hoàn] <giờ> — <tình trạng> — …" vào ghi chú phiếu trả (hoặc
//  ghi chú nội bộ của đơn giao thất bại). Khi hàng KHÔNG nguyên vẹn:
//    · khiếu nại đã THẮNG  → đưa vào kho hư hỏng ngay (trạm gọi) hoặc lúc returnSync thấy
//      kết quả thắng (sau khi đã nhận hàng);
//    · chưa thắng          → báo + "Việc cần làm" (lib/viecVuTra.ts) cho tới khi thắng, hoặc
//      chủ shop bấm "Đưa vào kho hư hỏng" (không khiếu nại nữa / đã xử lý ngoài hệ thống).
//
//  NGUỒN khi nhập kho hư hỏng — đọc SỔ, không đoán:
//    · đơn đã được HOÀN KHO (returnSync → reverseOnlineOrderEffects ghi thẻ kho 'in',
//      "Hoàn kho do hủy/hoàn đơn online", referenceId ONLINE-<đơn>) ⇒ món này đang nằm
//      trong tồn BÁN ĐƯỢC ⇒ 'tu-kho' (trừ tồn bán được, cộng kho hư hỏng);
//    · chưa hoàn kho (khiếu nại thắng = sàn KHÔNG hoàn tiền ⇒ không đảo đơn) ⇒ món về tay
//      shop mà không nằm trong tồn nào ⇒ 'ngoai' (chỉ cộng kho hư hỏng).
//  Sai chiều là tồn bán được lệch đúng số món — nên mỗi món một lần tra, không suy chung.
//
//  MỘT LẦN DUY NHẤT: dấu "[Vào kho hư hỏng]" + giành quyền bằng updateMany có điều kiện ghi
//  chú cũ (trạm và returnSync có thể chạy cùng lúc). Mọi truy vấn trong giao dịch đi qua `tx`
//  — prod pool 1 kết nối, gọi `prisma` bên trong là tự khoá chết.
// ─────────────────────────────────────────────────────────────────────────────

import { khoHuHong, updateWarehouseStock, adjustSellableStock } from './warehouseHelper'
import { DAU_VAO_KHO_HU, lanNhanCuoi, daVaoKhoHu } from './nhanHangHoan'

const gioVN = () => new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
})

/** Chuông + push cho việc hàng hoàn hư. DÙNG LẠI loại 'dispute_result' (nhóm Khiếu nại, kênh ưu
 *  tiên cao trên Android, mở tab Trả hàng) — loại MỚI phải khai đủ 3 nơi BE/Android/chuông web,
 *  thiếu một nơi là tin bị lọc mất im lặng. Báo hỏng không được làm hỏng việc chính. */
export async function baoHangHoanHu(prisma: any, tieuDe: string, noiDung: string): Promise<void> {
    try {
        const { sendPushToStore } = await import('../routes/notifications')
        const tin = await prisma.notification.create({
            data: { type: 'dispute_result', title: tieuDe.slice(0, 200), message: noiDung.slice(0, 500) },
        }).catch(() => null)
        await sendPushToStore(prisma, tieuDe, noiDung.slice(0, 300), { id: tin?.id, type: 'dispute_result', route: 'returns' })
    } catch (e: any) {
        console.error('[hangHoanHu] báo thông báo hỏng:', e?.message || e)
    }
}

export interface KetQuaChuyenKhoHu {
    ok: boolean
    /** vì sao không chuyển (cả phiếu) */
    lyDo?: string
    daChuyen: { sku: string; ten: string; sl: number; nguon: 'tu-kho' | 'ngoai' }[]
    boQua: { sku: string; ten: string; lyDo: string }[]
}

/**
 * Đưa hàng của MỘT phiếu trả (loai 'phieu') hoặc MỘT đơn giao thất bại (loai 'don') vào kho
 * hư hỏng. `vi` = vì sao (vd "khiếu nại thắng lần 2", "chủ shop đưa vào — không khiếu nại nữa"),
 * ghi vào lô hư hỏng + dấu trên phiếu. Không ghi được món nào thì KHÔNG đặt dấu — vụ vẫn nằm
 * trong Việc cần làm để xử lý tay.
 */
export async function chuyenHangHoanVaoKhoHu(
    prisma: any,
    vu: { loai: 'phieu' | 'don'; id: string },
    opts: { vi: string; nguoi?: string | null; userId?: string | null },
): Promise<KetQuaChuyenKhoHu> {
    const ra: KetQuaChuyenKhoHu = { ok: false, daChuyen: [], boQua: [] }
    try {
        return await prisma.$transaction(async (tx: any) => {
            // ── Đọc vụ + món hàng ──
            let ghiChu: string, maVu: string, soDon: string, branchId: string | null
            let mon: { productId: string | null; sku: string; ten: string; sl: number }[]
            if (vu.loai === 'phieu') {
                const p = await tx.returnOrder.findUnique({ where: { id: vu.id }, include: { items: true } })
                if (!p) return { ...ra, lyDo: 'Không thấy phiếu trả' }
                ghiChu = p.notes || ''; maVu = p.code; soDon = p.originalInvoice || ''; branchId = p.branchId ?? null
                mon = (p.items || []).map((i: any) => ({ productId: i.productId || null, sku: i.sku || '', ten: i.productName || '', sl: Math.max(0, Math.floor(Number(i.quantity) || 0)) }))
            } else {
                const d = await tx.onlineOrder.findUnique({ where: { id: vu.id }, include: { items: true } })
                if (!d) return { ...ra, lyDo: 'Không thấy đơn' }
                ghiChu = d.internalNote || ''; maVu = d.orderNumber; soDon = d.orderNumber; branchId = null
                mon = (d.items || []).map((i: any) => ({ productId: i.productId || null, sku: i.sku || '', ten: i.productName || '', sl: Math.max(0, Math.floor(Number(i.quantity) || 0)) }))
            }
            if (daVaoKhoHu(ghiChu)) return { ...ra, lyDo: 'Đã vào kho hư hỏng từ trước' }
            const nhan = lanNhanCuoi(ghiChu)
            if (!nhan) return { ...ra, lyDo: 'Chưa nhận hàng hoàn (trạm quay chưa ghi tình trạng)' }
            if (nhan.nguyenVen) return { ...ra, lyDo: 'Hàng nguyên vẹn — không vào kho hư hỏng' }

            const khoId = await khoHuHong(tx, branchId)
            if (!khoId) return { ...ra, lyDo: 'Cửa hàng chưa có kho hư hỏng' }

            // ── Giành quyền: chỉ MỘT lượt chạy tiếp (trạm + returnSync có thể cùng lúc) ──
            const dauTam = `${ghiChu}\n${DAU_VAO_KHO_HU} (đang chuyển)`
            const gianh = vu.loai === 'phieu'
                ? await tx.returnOrder.updateMany({ where: { id: vu.id, notes: ghiChu }, data: { notes: dauTam } })
                : await tx.onlineOrder.updateMany({ where: { id: vu.id, internalNote: ghiChu }, data: { internalNote: dauTam } })
            if (gianh.count !== 1) return { ...ra, lyDo: 'Ghi chú vừa đổi — thử lại sau' }

            for (const m of mon) {
                if (m.sl <= 0) continue
                let productId = m.productId
                if (!productId && m.sku) productId = (await tx.product.findFirst({ where: { sku: m.sku }, select: { id: true } }))?.id ?? null
                if (!productId) { ra.boQua.push({ sku: m.sku, ten: m.ten, lyDo: 'không xác định được mặt hàng' }); continue }
                const sp = await tx.product.findUnique({ where: { id: productId }, select: { stock: true, sku: true, name: true } })
                if (!sp) { ra.boQua.push({ sku: m.sku, ten: m.ten, lyDo: 'mặt hàng đã bị xoá' }); continue }
                // Đơn đã được HOÀN KHO chưa — đọc thẻ kho do reverseOnlineOrderEffects ghi
                const daHoanKho = soDon ? await tx.inventoryTransaction.findFirst({
                    where: { referenceId: `ONLINE-${soDon}`, reason: 'Hoàn kho do hủy/hoàn đơn online', productId },
                    select: { id: true },
                }) : null
                const nguon: 'tu-kho' | 'ngoai' = daHoanKho ? 'tu-kho' : 'ngoai'
                if (nguon === 'tu-kho' && (sp.stock ?? 0) < m.sl) {
                    // Không ép tồn bán được xuống âm — để người xem tay
                    ra.boQua.push({ sku: sp.sku || m.sku, ten: sp.name || m.ten, lyDo: `tồn bán được chỉ còn ${sp.stock ?? 0}, không đủ trừ ${m.sl}` })
                    continue
                }
                await updateWarehouseStock(tx, khoId, productId, m.sl)
                if (nguon === 'tu-kho') await adjustSellableStock(tx, productId, branchId, -m.sl, 'nhap-kho-hu-hong')
                await tx.damagedEntry.create({
                    data: {
                        warehouseId: khoId, loai: 'nhap', productId,
                        productName: sp.name || m.ten, productSku: sp.sku || m.sku || null,
                        quantity: m.sl, nguon, conLai: m.sl,
                        lyDo: nhan.tinhTrang.slice(0, 500) || 'Hàng hoàn không nguyên vẹn',
                        ghiChu: `Hàng hoàn ${maVu} — ${opts.vi}`.slice(0, 1000),
                        branchId,
                        userId: opts.userId || null,
                        userName: opts.nguoi || nhan.nguoi || 'Tự động (khiếu nại thắng)',
                    },
                })
                ra.daChuyen.push({ sku: sp.sku || m.sku, ten: sp.name || m.ten, sl: m.sl, nguon })
            }

            // Không chuyển được món nào ⇒ đổ cả giao dịch (bỏ dấu tạm), vụ vẫn ở Việc cần làm
            if (!ra.daChuyen.length) throw Object.assign(new Error('KHONG_CHUYEN_DUOC'), { boQua: ra.boQua })

            const dong = `${DAU_VAO_KHO_HU} ${gioVN()} — `
                + ra.daChuyen.map(x => `${x.sl}×${x.sku || x.ten}${x.nguon === 'tu-kho' ? ' (trừ tồn bán được)' : ''}`).join(', ')
                + ` — ${opts.vi}`
                + (ra.boQua.length ? ` — CHƯA chuyển: ${ra.boQua.map(b => `${b.sku || b.ten} (${b.lyDo})`).join(', ')}` : '')
            if (vu.loai === 'phieu') await tx.returnOrder.update({ where: { id: vu.id }, data: { notes: `${ghiChu}\n${dong}` } })
            else await tx.onlineOrder.update({ where: { id: vu.id }, data: { internalNote: `${ghiChu}\n${dong}` } })
            return { ...ra, ok: true }
        }, { maxWait: 10_000, timeout: 30_000 })   // vụ nhiều món: mỗi món vài truy vấn tuần tự
    } catch (e: any) {
        if (e?.message === 'KHONG_CHUYEN_DUOC') {
            return { ok: false, daChuyen: [], boQua: e.boQua || ra.boQua, lyDo: 'Không món nào chuyển được vào kho hư hỏng' }
        }
        throw e
    }
}
