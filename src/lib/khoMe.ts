// ═══════════════════════════════════════════════════════════════════════════════
//  KHO MẸ — cửa hàng bán sàn MƯỢN tồn của một cửa hàng khác
//
//  Chủ shop chốt 10/09/2026: HUTI là kho mẹ; KENGISTORE đẩy tồn HUTI lên sàn, có
//  đơn thì trừ, hoàn thì cộng lại. KHÔNG dính tồn kho thuế — đây thuần tồn vận hành.
//
//  Ba điều chủ shop đã chọn, KHÔNG được tự đổi:
//    1. Trừ CẢ HAI kho (tôi đã nêu lo ngại tồn con đang âm; chủ shop vẫn chọn).
//    2. CÓ ghi phiếu ở kho mẹ — để người xem sổ HUTI giải thích được vì sao tồn giảm.
//    3. Tồn đẩy lên sàn = tồn mẹ − ĐƠN TREO bên con (đơn đã có mà chưa trừ kho).
//
//  ⚠ HAI SCHEMA POSTGRES KHÁC NHAU ⇒ KHÔNG chung transaction được. Nên đường ghi
//  sang mẹ phải TỰ CHỐNG TRÙNG: cờ `OnlineOrder.khoMeTruLuc` trên cửa hàng CON
//  được giành bằng `updateMany` điều kiện (đúng khuôn `stockDeducted` đã chạy ổn),
//  giành được mới trừ mẹ. Đứt giữa chừng thì lần sau không trừ lại lần nữa.
//
//  ⚠ HOÀN KHO ĐỌC LẠI CHÍNH PHIẾU ĐÃ XUẤT, không tính lại từ dòng hàng của đơn.
//  Đường trừ dùng `baseQuantity` (đã quy đổi vỉ→cái) còn đường hoàn của đơn sàn
//  dùng `quantity` thô — hai số đó KHÁC nhau (lỗi tồn đọng đã ghi 09/09). Cộng lại
//  đúng bằng cái đã trừ là cách duy nhất để kho mẹ luôn về 0 khi đơn bị huỷ.
// ═══════════════════════════════════════════════════════════════════════════════

import { registryPrisma, getStorePrisma } from './prisma'
import { adjustSellableStock } from './warehouseHelper'
import { TRANG_THAI_CHO_XAC_NHAN } from './donDuocXoa'

/** referenceType của phiếu ghi trên thẻ kho MẸ — để tra ngược và để hoàn đúng số. */
export const LOAI_THAM_CHIEU = 'kho_me_don_san'

export interface KhoMe {
    ma: string          // mã cửa hàng mẹ, vd 'HUTI'
    ten: string
    schema: string
    sp: any             // prisma client của mẹ
    maCon: string       // mã cửa hàng con (để ghi vào phiếu, người đọc biết ai mượn)
}

/** Mã cửa hàng từ client prisma — schema được cất ở `__schema` lúc tạo client. */
async function maCuaHangTheoClient(sp: any): Promise<string | null> {
    const schema = String((sp as any)?.__schema || '')
    if (!schema) return null
    const st = await registryPrisma.store.findFirst({ where: { schema }, select: { code: true } })
    return st?.code || null
}

/**
 * Mở kho mẹ của cửa hàng đang thao tác. Trả null khi cửa hàng KHÔNG khai kho mẹ —
 * đó là trường hợp thường, phải rẻ và im lặng.
 */
export async function moKhoMe(spCon: any): Promise<KhoMe | null> {
    let cai: any = null
    try {
        cai = await spCon.storeSettings.findFirst({ select: { khoMeMa: true } as any })
    } catch {
        return null   // cửa hàng chưa migrate cột khoMeMa ⇒ coi như không dùng
    }
    const ma = String(cai?.khoMeMa || '').trim()
    if (!ma) return null

    const me = await registryPrisma.store.findFirst({
        where: { code: { equals: ma, mode: 'insensitive' } },
        select: { code: true, name: true, schema: true, status: true },
    })
    if (!me) {
        console.warn(`[KhoMe] Cửa hàng khai kho mẹ "${ma}" nhưng không có cửa hàng nào mã đó — bỏ qua`)
        return null
    }
    if (me.status && me.status !== 'active') {
        console.warn(`[KhoMe] Kho mẹ ${me.code} đang ở trạng thái "${me.status}" — không trừ/hoàn`)
        return null
    }
    const maCon = (await maCuaHangTheoClient(spCon)) || '(không rõ)'
    if (me.schema === String((spCon as any)?.__schema || '')) {
        console.warn(`[KhoMe] ${maCon} khai kho mẹ là CHÍNH NÓ — bỏ qua, nếu không sẽ trừ hai lần một kho`)
        return null
    }
    return { ma: me.code, ten: me.name, schema: me.schema, sp: getStorePrisma(me.schema), maCon }
}

/**
 * Hàng bên mẹ ứng với một SKU. KHỚP DUY NHẤT mới nhận.
 *
 * SKU ứng NHIỀU hàng bên mẹ thì TRẢ NULL, không đoán: chọn bừa là trừ nhầm mặt
 * hàng của một cửa hàng khác — âm thầm và gần như không lần ra. Đo 10/09/2026:
 * HUTI có 3.594 SKU và không mã nào trùng, nhưng luật phải có sẵn cho về sau.
 */
export async function timHangMe(spMe: any, sku: string | null | undefined) {
    const s = String(sku || '').trim()
    if (!s) return null
    const ds = await spMe.product.findMany({
        where: { sku: { equals: s, mode: 'insensitive' } },
        select: { id: true, sku: true, name: true, stock: true },
        take: 2,
    })
    if (ds.length !== 1) {
        if (ds.length > 1) console.warn(`[KhoMe] SKU "${s}" ứng ${ds.length} hàng bên kho mẹ — BỎ QUA, phải khai tay`)
        return null
    }
    return ds[0]
}

export interface DongTru { sku: string | null; soLuong: number; ten?: string }

/**
 * Trừ kho mẹ cho một đơn sàn của cửa hàng con. Idempotent qua cờ `khoMeTruLuc`.
 * Trả về số dòng đã trừ và những dòng KHÔNG trừ được (kèm lý do) — im lặng ở đây
 * là kho mẹ thiếu hàng mà không ai biết.
 */
export async function truKhoMe(
    spCon: any, khoMe: KhoMe, donId: string, maDon: string, dong: DongTru[],
): Promise<{ daTru: number; boQua: string[]; daGianhCo: boolean }> {
    const boQua: string[] = []

    /* GIÀNH CỜ TRƯỚC KHI ĐỘNG VÀO KHO. `updateMany` điều kiện null→now là atomic:
     * hai lượt chạy song song thì chỉ một lượt nhận count=1. */
    const gianh = await spCon.onlineOrder.updateMany({
        where: { id: donId, khoMeTruLuc: null },
        data: { khoMeTruLuc: new Date() },
    }).catch(() => ({ count: 0 }))
    if (!gianh?.count) return { daTru: 0, boQua: ['Đơn này đã trừ kho mẹ trước đó'], daGianhCo: false }

    let daTru = 0
    for (const d of dong) {
        const qty = Number(d.soLuong) || 0
        if (qty <= 0) continue
        const hang = await timHangMe(khoMe.sp, d.sku)
        if (!hang) { boQua.push(`${d.sku || d.ten || '?'} — không tra ra hàng ở kho mẹ ${khoMe.ma}`); continue }
        try {
            await adjustSellableStock(khoMe.sp, hang.id, null, -qty, `Đơn sàn ${khoMe.maCon} ${maDon}`)
            // Phiếu trên THẺ KHO của mẹ — quantity CÓ DẤU (âm = xuất), đúng quy ước
            // đang dùng ở mọi chỗ khác trong dự án.
            await khoMe.sp.inventoryTransaction.create({
                data: {
                    type: 'export',
                    productId: hang.id, productName: hang.name, productSku: hang.sku,
                    quantity: -qty,
                    reason: `Xuất cho đơn sàn ${khoMe.maCon}`,
                    note: `Đơn ${maDon} của cửa hàng ${khoMe.maCon} (kho mẹ)`,
                    referenceId: `${khoMe.maCon}:${maDon}`,
                    referenceType: LOAI_THAM_CHIEU,
                    userName: `Kho mẹ ← ${khoMe.maCon}`,
                    transactionDate: new Date(),
                },
            }).catch((e: any) => {
                // Mất phiếu thì tồn vẫn đúng, nhưng người xem sổ hết đường giải thích.
                console.error(`[KhoMe] Trừ được tồn nhưng KHÔNG ghi được phiếu ${maDon}/${hang.sku}: ${e?.message || e}`)
            })
            daTru++
        } catch (e: any) {
            boQua.push(`${hang.sku} — trừ kho mẹ hỏng: ${String(e?.message || e).slice(0, 120)}`)
        }
    }
    return { daTru, boQua, daGianhCo: true }
}

/**
 * Hoàn kho mẹ khi đơn bị huỷ/trả. Cộng lại ĐÚNG BẰNG phiếu đã xuất, không tính
 * lại từ dòng hàng — xem chú thích đầu file.
 */
export async function hoanKhoMe(
    spCon: any, khoMe: KhoMe, donId: string, maDon: string,
): Promise<{ daHoan: number; boQua: string[] }> {
    const boQua: string[] = []
    // Nhả cờ trước, cũng bằng updateMany có điều kiện — chỉ đơn ĐANG giữ cờ mới hoàn.
    const nha = await spCon.onlineOrder.updateMany({
        where: { id: donId, khoMeTruLuc: { not: null } },
        data: { khoMeTruLuc: null },
    }).catch(() => ({ count: 0 }))
    if (!nha?.count) return { daHoan: 0, boQua: ['Đơn này chưa từng trừ kho mẹ (hoặc đã hoàn rồi)'] }

    const phieu: any[] = await khoMe.sp.inventoryTransaction.findMany({
        where: { referenceType: LOAI_THAM_CHIEU, referenceId: `${khoMe.maCon}:${maDon}`, type: 'export' },
        select: { productId: true, productName: true, productSku: true, quantity: true },
    }).catch(() => [])
    if (phieu.length === 0) return { daHoan: 0, boQua: [`Không thấy phiếu xuất kho mẹ nào của đơn ${maDon} — không hoàn được, phải chỉnh tay`] }

    let daHoan = 0
    for (const p of phieu) {
        const qty = Math.abs(Number(p.quantity) || 0)
        if (qty <= 0) continue
        try {
            await adjustSellableStock(khoMe.sp, p.productId, null, qty, `Hoàn đơn sàn ${khoMe.maCon} ${maDon}`)
            await khoMe.sp.inventoryTransaction.create({
                data: {
                    type: 'return',
                    productId: p.productId, productName: p.productName, productSku: p.productSku,
                    quantity: qty,
                    reason: `Hoàn từ đơn sàn ${khoMe.maCon}`,
                    note: `Đơn ${maDon} của cửa hàng ${khoMe.maCon} bị huỷ/trả (kho mẹ)`,
                    referenceId: `${khoMe.maCon}:${maDon}`,
                    referenceType: LOAI_THAM_CHIEU,
                    userName: `Kho mẹ ← ${khoMe.maCon}`,
                    transactionDate: new Date(),
                },
            }).catch(() => { })
            daHoan++
        } catch (e: any) {
            boQua.push(`${p.productSku} — hoàn kho mẹ hỏng: ${String(e?.message || e).slice(0, 120)}`)
        }
    }
    return { daHoan, boQua }
}

/**
 * ĐƠN TREO của cửa hàng con, gộp theo SKU: đơn ĐÃ CÓ mà CHƯA trừ kho.
 *
 * Chủ shop chốt đẩy lên sàn = tồn mẹ − số này. Lý do: đơn chờ xác nhận đã hứa
 * hàng cho khách nhưng chưa trừ kho (chốt 09/09), nên nếu đẩy nguyên tồn mẹ thì
 * đúng phần hàng đã hứa đó bị bán thêm lần nữa.
 */
export async function donTreoTheoSku(spCon: any): Promise<Map<string, number>> {
    const ra = new Map<string, number>()
    const don: any[] = await spCon.onlineOrder.findMany({
        where: {
            stockDeducted: false,
            status: { in: [...TRANG_THAI_CHO_XAC_NHAN] },
        },
        select: { items: { select: { sku: true, quantity: true, product: { select: { sku: true } } } } },
        take: 5000,
    }).catch(() => [])
    for (const d of don) {
        for (const it of (d.items || [])) {
            const sku = String(it.sku || it.product?.sku || '').trim().toLowerCase()
            if (!sku) continue
            ra.set(sku, (ra.get(sku) || 0) + (Number(it.quantity) || 0))
        }
    }
    return ra
}
