/**
 * HUỶ / TRẢ / CẬP NHẬT một ĐƠN BÁN TRÊN XE ngay TRÊN XE (14/11/2026).
 *
 * Đơn bán trên xe chỉ trừ KHO XE — Product.stock + kho chính đã trừ từ lúc chất hàng lên xe, phần chưa bán về lại kho
 * chính khi đóng chuyến (theo tồn THẬT của kho xe). Trước đây huỷ / trả / cập nhật phiếu luôn hoàn về Product.stock +
 * kho chính và không đụng tới chuyến, nên khi thao tác diễn ra NGAY TRÊN XE:
 *   - kho cửa hàng có thêm hàng chưa về, kho xe thiếu đúng số đó ⇒ bán lại món vừa huỷ trong chuyến bị chặn
 *     "chỉ còn 0 trên xe";
 *   - chuyến vẫn tính số bán, doanh thu và tiền mặt phải nộp của đơn đã huỷ / phần đã trả.
 *
 * Thao tác ở đâu thì máy chủ không tự biết ⇒ theo POS: đang ở chế độ bán trên xe thì POS gửi kèm x-sales-trip-id
 * (y như lúc bán). Chỉ khi đơn thuộc ĐÚNG chuyến đó (nhật ký 'sale' của chuyến có transactionId của đơn) và chuyến
 * còn mở thì hàng hoá mới lên lại xe và chuyến bị trừ số bán. Không có mã chuyến (làm ở cửa hàng) thì GIỮ NHƯ CŨ:
 * hàng đã rời xe và về cửa hàng; số bán của chuyến giữ nguyên — trừ đi thì đối soát ra "thiếu hàng" oan cho tài xế —
 * và tài xế vẫn nộp đủ tiền đã thu (cửa hàng hoàn tiền khách bằng két của mình).
 *
 * Dịch vụ không bao giờ nằm trên xe (bán đi đường quầy) ⇒ luôn hoàn đường quầy như cũ.
 * Bộ soát: npm run check:ban-tren-xe-dich-vu (nhóm ca F–J).
 */
import { laDichVu, updateWarehouseStock } from './warehouseHelper'

type AnyPrisma = any

/** Chuyến đã đóng / huỷ: xe đã dỡ hết hàng về kho chính ⇒ không còn gì "trên xe" để trả lên. */
const CHUYEN_DA_KET_THUC = ['closed', 'cancelled']

export interface ChuyenXe {
    id: string
    code: string
    warehouseId: string
    status: string
}

export interface DongLenXe {
    productId: string
    productName?: string | null
    sku?: string | null
    /** Số lượng theo ĐƠN VỊ GỐC (đúng số kho xe đã trừ lúc bán). */
    soLuong: number
}

/** Mã chuyến POS gửi kèm (chế độ bán trên xe). Không có ⇒ null. */
export function maChuyenTuHeader(headers: Record<string, any> | undefined): string | null {
    const h = headers?.['x-sales-trip-id']
    const v = Array.isArray(h) ? h[0] : h
    const s = typeof v === 'string' ? v.trim() : ''
    return s || null
}

/**
 * Chuyến CÒN MỞ mà đơn này đã bán trên đó, và đúng là chuyến POS đang bán (maChuyen). Mọi điều kiện khác ⇒ null ⇒ nơi
 * gọi hoàn kho như đơn quầy (hành vi cũ). Nhật ký 'sale' do cả POS bán trên xe lẫn "chuyển đơn sang xe" ghi, metadata
 * JSON có "transactionId":"<id>".
 */
export async function chuyenDangMoCuaDon(
    db: AnyPrisma,
    don: { id?: string | null; channel?: string | null } | null | undefined,
    maChuyen: string | null | undefined,
): Promise<ChuyenXe | null> {
    if (!don?.id || don.channel !== 'van' || !maChuyen) return null
    const vet = await db.salesTripLog.findFirst({
        where: { tripId: String(maChuyen), action: 'sale', metadata: { contains: `"transactionId":"${String(don.id)}"` } },
        select: { id: true },
    })
    if (!vet) return null
    const chuyen = await db.salesTrip.findUnique({
        where: { id: String(maChuyen) },
        select: { id: true, code: true, warehouseId: true, status: true },
    })
    if (!chuyen?.warehouseId || CHUYEN_DA_KET_THUC.includes(String(chuyen.status))) return null
    return chuyen as ChuyenXe
}

/** Mã các sản phẩm là DỊCH VỤ trong danh sách (dòng đơn không mang productType ⇒ tra Product). */
export async function maDichVuTrongDon(db: AnyPrisma, productIds: Array<string | null | undefined>): Promise<Set<string>> {
    const ma = [...new Set(productIds.filter(Boolean).map(String))]
    if (ma.length === 0) return new Set()
    const sp = await db.product.findMany({ where: { id: { in: ma } }, select: { id: true, productType: true } })
    return new Set((sp || []).filter((p: any) => laDichVu(p)).map((p: any) => String(p.id)))
}

/**
 * Trừ số bán của chuyến cho phần hàng vừa lên lại xe + trừ doanh thu, ghi nhật ký chuyến. KHÔNG đụng kho (xem
 * traHangLenXe). Kẹp ở 0: dữ liệu cũ có thể đã lệch, số bán âm chỉ làm bảng đối soát khó hiểu hơn.
 *   soTien: huỷ / cập nhật phiếu = tổng tiền đơn (đúng số đã cộng vào totalRevenue lúc bán); trả hàng = tiền hoàn.
 */
export async function truSoBanChuyen(
    tx: AnyPrisma,
    chuyen: ChuyenXe,
    dong: DongLenXe[],
    soTien: number,
    nhatKy: { action: 'void' | 'return'; notes: string; userId: string; userName?: string | null; metadata: Record<string, any> },
): Promise<{ soLuong: number }> {
    let tong = 0
    for (const d of dong) {
        const sl = Math.round(Number(d.soLuong) || 0)
        if (!(sl > 0)) continue
        const giam = await tx.salesTripItem.updateMany({
            where: { tripId: chuyen.id, productId: d.productId, soldQty: { gte: sl } },
            data: { soldQty: { decrement: sl } },
        })
        if (giam.count === 0) {
            await tx.salesTripItem.updateMany({ where: { tripId: chuyen.id, productId: d.productId }, data: { soldQty: 0 } })
        }
        tong += sl
    }
    if (tong > 0) {
        const g = await tx.salesTrip.updateMany({ where: { id: chuyen.id, totalSold: { gte: tong } }, data: { totalSold: { decrement: tong } } })
        if (g.count === 0) await tx.salesTrip.updateMany({ where: { id: chuyen.id }, data: { totalSold: 0 } })
    }
    const tien = Math.max(0, Number(soTien) || 0)
    if (tien > 0) {
        const g = await tx.salesTrip.updateMany({ where: { id: chuyen.id, totalRevenue: { gte: tien } }, data: { totalRevenue: { decrement: tien } } })
        if (g.count === 0) await tx.salesTrip.updateMany({ where: { id: chuyen.id }, data: { totalRevenue: 0 } })
    }
    await tx.salesTripLog.create({
        data: {
            tripId: chuyen.id,
            action: nhatKy.action,
            notes: nhatKy.notes,
            userId: nhatKy.userId,
            userName: nhatKy.userName ?? null,
            metadata: JSON.stringify({
                ...nhatKy.metadata,
                items: dong.map(d => ({ productId: d.productId, sku: d.sku ?? null, qty: Math.round(Number(d.soLuong) || 0) })),
            }),
        },
    })
    return { soLuong: tong }
}

/** Hàng hoá lên lại xe (cộng kho XE, không cộng Product.stock / kho chính) + truSoBanChuyen. Gọi TRONG giao dịch CSDL. */
export async function traHangLenXe(
    tx: AnyPrisma,
    chuyen: ChuyenXe,
    dong: DongLenXe[],
    soTien: number,
    nhatKy: { action: 'void' | 'return'; notes: string; userId: string; userName?: string | null; metadata: Record<string, any> },
): Promise<{ soLuong: number }> {
    for (const d of dong) {
        const sl = Math.round(Number(d.soLuong) || 0)
        if (sl > 0) await updateWarehouseStock(tx, chuyen.warehouseId, d.productId, sl)
    }
    return truSoBanChuyen(tx, chuyen, dong, soTien, nhatKy)
}
