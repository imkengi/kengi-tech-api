// ═══════════════════════════════════════════════════════════════════════════════
//  KHO MẸ — PHẦN HƯ HỎNG (09/10/2026)
//
//  Chủ shop: "trong phần kho mẹ của admin thì có 2 mục là kho bình thường và kho hư hỏng,
//  có thể bật kho hư hỏng trước để kho hư hỏng ghi nhận hàng hư vào". Cửa hàng bán sàn
//  (KENGISTORE) không giữ hàng thật — hàng nằm ở kho mẹ (HUTI). Khai
//  `StoreSettings.khoMeHuMa` trên cửa hàng CON → hàng hư của con vào KHO HƯ HỎNG của MẸ:
//    · hàng hoàn không nguyên vẹn khi khiếu nại thắng / bấm "Đưa vào kho hư hỏng" (lib/hangHoanHu)
//    · duyệt trả hàng chọn "hư hỏng" (onlineOrders PUT /returns/:id/process)
//  Bật / tắt ĐỘC LẬP với kho mẹ thường (`khoMeMa`, lib/khoMe.ts) — bật phần hư hỏng trước,
//  phần mượn tồn bán được để sau.
//
//  TỒN — đọc sổ, không đoán:
//    · MẸ: cộng kho hư hỏng của mẹ + lô DamagedEntry (lý do, người, mã phiếu bên con). Tồn BÁN
//      ĐƯỢC của mẹ chỉ trừ khi món đang nằm trong đó: đơn đã trừ kho mẹ rồi được HOÀN kho mẹ
//      (phiếu 'kho_me_don_san' type 'return' — kho mẹ thường đang bật). Kho mẹ thường tắt ⇒
//      không đụng tồn bán được của mẹ.
//    · CON: nơi gọi tự lo (vd hàng hoàn: món đã được hoàn kho bán được của con thì trừ lại).
//  HAI SCHEMA ⇒ không chung transaction với bên con. Bên mẹ ghi trong giao dịch của mẹ và chống
//  trùng bằng dấu `[kho-me-hu:<con>:<khoá vụ>:<id hàng mẹ>]` trong ghi chú lô.
// ═══════════════════════════════════════════════════════════════════════════════

import { registryPrisma, getStorePrisma } from './prisma'
import { khoHuHong, updateWarehouseStock, adjustSellableStock } from './warehouseHelper'
import { timHangMe, LOAI_THAM_CHIEU } from './khoMe'

export interface KhoMeHu {
    ma: string          // mã cửa hàng mẹ, vd 'HUTI'
    ten: string
    schema: string
    sp: any             // prisma client của mẹ
    maCon: string       // mã cửa hàng con — ghi vào lô để người xem kho mẹ biết hàng của ai
}

async function maCuaHangTheoClient(sp: any): Promise<string | null> {
    const schema = String((sp as any)?.__schema || '')
    if (!schema) return null
    const st = await registryPrisma.store.findFirst({ where: { schema }, select: { code: true } })
    return st?.code || null
}

/** Kho mẹ nhận hàng hư của cửa hàng đang thao tác. null = không khai — trường hợp thường, rẻ và im lặng. */
export async function moKhoMeHu(spCon: any): Promise<KhoMeHu | null> {
    let cai: any = null
    try {
        cai = await spCon.storeSettings.findFirst({ select: { khoMeHuMa: true } as any })
    } catch {
        return null   // cửa hàng chưa có cột ⇒ coi như không dùng
    }
    const ma = String(cai?.khoMeHuMa || '').trim()
    if (!ma) return null
    const me = await registryPrisma.store.findFirst({
        where: { code: { equals: ma, mode: 'insensitive' } },
        select: { code: true, name: true, schema: true, status: true },
    })
    const maCon = (await maCuaHangTheoClient(spCon)) || '(không rõ)'
    if (!me) { console.warn(`[KhoMeHu] ${maCon} khai kho mẹ hư hỏng "${ma}" nhưng không có cửa hàng mã đó — bỏ qua`); return null }
    if (me.status && me.status !== 'active') { console.warn(`[KhoMeHu] Kho mẹ ${me.code} đang "${me.status}" — bỏ qua`); return null }
    if (me.schema === String((spCon as any)?.__schema || '')) { console.warn(`[KhoMeHu] ${maCon} khai kho mẹ là CHÍNH NÓ — bỏ qua`); return null }
    return { ma: me.code, ten: me.name, schema: me.schema, sp: getStorePrisma(me.schema), maCon }
}

export interface KetQuaNhapKhoHuMe {
    ok: boolean
    lyDo?: string
    /** món đã vào kho hư hỏng mẹ từ lượt trước (dấu chống trùng) — không ghi thêm */
    daCo?: boolean
    nguonMe?: 'tu-kho' | 'ngoai'
    skuMe?: string
}

/**
 * Nhập MỘT món vào kho hư hỏng của MẸ. `khoaVu` = mã phiếu / mã đơn bên con (+ dòng nếu cần) —
 * cùng khoá thì chỉ ghi MỘT lần. `maDon` = mã đơn bên con để biết món có đang nằm trong tồn bán
 * được của mẹ không (đơn từng trừ + hoàn kho mẹ).
 */
export async function nhapKhoHuMe(
    me: KhoMeHu,
    mon: { sku: string | null; ten: string; sl: number; maDon?: string | null },
    opts: { khoaVu: string; lyDo: string; ghiChu: string; nguoi?: string | null },
): Promise<KetQuaNhapKhoHuMe> {
    const sl = Math.max(0, Math.floor(Number(mon.sl) || 0))
    if (sl <= 0) return { ok: false, lyDo: 'số lượng 0' }
    const hang = await timHangMe(me.sp, mon.sku)
    if (!hang) return { ok: false, lyDo: mon.sku ? `không tra ra hàng SKU ${mon.sku} ở kho mẹ ${me.ma} (hoặc SKU ứng nhiều hàng)` : `món không có SKU — không tra được sang kho mẹ ${me.ma}` }
    const dau = `[kho-me-hu:${me.maCon}:${opts.khoaVu}:${hang.id}]`
    return me.sp.$transaction(async (tx: any) => {
        const da = await tx.damagedEntry.findFirst({ where: { loai: 'nhap', productId: hang.id, ghiChu: { contains: dau } }, select: { id: true } })
        if (da) return { ok: true, daCo: true, skuMe: hang.sku }
        const khoId = await khoHuHong(tx, null)
        if (!khoId) return { ok: false, lyDo: `kho mẹ ${me.ma} chưa có kho hư hỏng` }
        // Món có đang nằm trong tồn BÁN ĐƯỢC của mẹ không — chỉ khi đơn từng trừ rồi hoàn kho mẹ
        const hoanMe = mon.maDon ? await tx.inventoryTransaction.findFirst({
            where: { referenceType: LOAI_THAM_CHIEU, referenceId: `${me.maCon}:${mon.maDon}`, type: 'return', productId: hang.id },
            select: { id: true },
        }) : null
        const nguonMe: 'tu-kho' | 'ngoai' = hoanMe ? 'tu-kho' : 'ngoai'
        if (nguonMe === 'tu-kho') {
            const t = await tx.product.findUnique({ where: { id: hang.id }, select: { stock: true } })
            if ((t?.stock ?? 0) < sl) return { ok: false, lyDo: `tồn bán được ở ${me.ma} chỉ còn ${t?.stock ?? 0}, không đủ trừ ${sl}` }
        }
        await updateWarehouseStock(tx, khoId, hang.id, sl)
        if (nguonMe === 'tu-kho') await adjustSellableStock(tx, hang.id, null, -sl, 'nhap-kho-hu-hong')
        await tx.damagedEntry.create({
            data: {
                warehouseId: khoId, loai: 'nhap', productId: hang.id,
                productName: hang.name, productSku: hang.sku,
                quantity: sl, nguon: nguonMe, conLai: sl,
                lyDo: (opts.lyDo || 'Hàng hư của cửa hàng bán sàn').slice(0, 500),
                ghiChu: `${opts.ghiChu} ${dau}`.slice(0, 1000),
                branchId: null,
                userId: null,   // userId là của cửa hàng con — người làm ghi bằng tên
                userName: opts.nguoi || `Kho mẹ ← ${me.maCon}`,
            },
        })
        return { ok: true, nguonMe, skuMe: hang.sku }
    }, { maxWait: 10_000, timeout: 30_000 })
}
