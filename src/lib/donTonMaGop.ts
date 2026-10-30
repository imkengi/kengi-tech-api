// ═══════════════════════════════════════════════════════════════════════════════
//  DỌN TỒN KẸT Ở MÃ ĐÃ GỘP — luôn dời sang mã đích, không chờ ai bấm.
//
//  Chủ shop 30/10/2026: "phải luôn có logic chứ". Phiếu nhập đã quy đổi lúc lưu
//  (lib/quyDoiMaGop.ts), nhưng còn nhiều đường khác ghi tồn theo đúng mã đang chọn
//  — bán POS, kiểm kê, chuyển kho, trả hàng… — chọn trúng mã đã gộp là hàng lại
//  kẹt. Nhịp này bắt MỌI đường: mã gộp nào còn tồn ≠ 0 thì chạy lại chính phép gộp
//  (lib/mergeProduct.ts): dời tồn ×hệ số sang mã đích, dời luôn dòng phiếu/thẻ kho
//  (SL ×hệ số, giá ÷hệ số, mã/tên mã đích), giá vốn mã đích tính lại theo cách tính
//  giá vốn của cửa hàng — y như một lần nhập.
//
//  KHÔNG dời mã gộp mà KiotViet/MISA đang ghi tồn (đồng bộ tồn = ảnh chụp số dư bên
//  kia): dời xong thì lượt đồng bộ sau ghi lại vào mã gộp, nhịp sau dời tiếp — tồn
//  mã đích phình mãi. Những mã đó chỉ báo, không đụng.
// ═══════════════════════════════════════════════════════════════════════════════

import { registryPrisma, getStorePrisma } from './prisma'
import { mergeProduct } from './mergeProduct'
import { giaiConTroGop, LoiQuyDoiMaGop } from './quyDoiMaGop'
import { calculateCostPrice, getCostPriceMethod } from './costPrice'

export interface KetQuaDon {
    tuSku: string
    sangSku: string | null
    heSo: number | null
    /** Tồn đang kẹt ở mã gộp (đơn vị mã gộp) */
    tonNguon: number
    /** Số dời sang mã đích (đơn vị mã đích) */
    slDoi: number
    tonDichTruoc: number | null
    tonDichSau: number | null
    giaDichTruoc: number | null
    giaDichSau: number | null
    /** Số dòng dời theo bảng (phiếu nhập, thẻ kho, tồn kho…) */
    dongDoi: Record<string, number>
    /** da_don = chạy thật đã dời · se_don = chạy thử · bo_qua = không đụng (xem lyDo) */
    ketQua: 'da_don' | 'se_don' | 'bo_qua'
    lyDo?: string
}

const SCHEMA_RE = /^[A-Za-z0-9_]+$/

/** Thẻ kho do đồng bộ ẢNH CHỤP tồn bên ngoài ghi — có thì mã đó do KiotViet/MISA giữ số */
const DONG_BO_NGOAI = `(t."referenceType" IN ('kiotviet','misa') OR t."userName" IN ('KiotViet Sync','MISA Sync'))`

/**
 * Mã gộp còn tồn (ở sản phẩm hoặc ở bất kỳ kho nào). `schema` có giá trị = câu dò
 * chạy bằng kết nối registry (ghi rõ tên schema), chỉ ĐẾM những mã dời được.
 */
export function sqlMaGopKet(schema: string | null, chiDem: boolean): string {
    if (schema !== null && !SCHEMA_RE.test(schema)) throw new Error(`schema lạ: ${schema}`)
    const b = (ten: string) => (schema ? `"${schema}"."${ten}"` : `"${ten}"`)
    const coTon = `(p.stock <> 0 OR EXISTS (SELECT 1 FROM ${b('WarehouseStock')} w WHERE w."productId" = p.id AND w.quantity <> 0))`
    const dongBoNgoai = `EXISTS (SELECT 1 FROM ${b('InventoryTransaction')} t WHERE t."productId" = p.id AND ${DONG_BO_NGOAI})`
    if (chiDem) {
        return `SELECT COUNT(*)::int AS n FROM ${b('Product')} p
                WHERE p."mergedIntoId" IS NOT NULL AND ${coTon} AND NOT ${dongBoNgoai}`
    }
    return `SELECT p.id, p.sku, p.stock, p."costPrice", ${dongBoNgoai} AS "dongBoNgoai"
            FROM ${b('Product')} p
            WHERE p."mergedIntoId" IS NOT NULL AND ${coTon}
            ORDER BY p.sku`
}

/**
 * Giá vốn mã đích sau khi nhận tồn dời sang — y như một lần nhập theo cách tính của
 * cửa hàng: 'average' bình quân gia quyền, 'lastImport' lấy giá nhập vào mã gộp nếu
 * lần nhập đó MỚI HƠN lần nhập cuối của mã đích, 'fixed' giữ nguyên. null = giữ nguyên.
 */
export function giaVonSauDon(cach: string, p: {
    tonDich: number; giaDich: number; slDoi: number; giaNguon: number; heSo: number; nguonMoiHon: boolean
}): number | null {
    // Dời tồn ÂM (bán nhầm trên mã gộp) không phải nhập — giá vốn không đổi
    if (!(p.slDoi > 0) || !(p.heSo > 0)) return null
    const giaMotDon = p.giaNguon / p.heSo
    // Mã gộp không có giá vốn: đừng kéo giá mã đích về 0
    if (!(giaMotDon > 0)) return null
    if (cach === 'average') {
        return calculateCostPrice('average', {
            productId: '', currentStock: p.tonDich, currentCostPrice: p.giaDich,
            transactionQty: p.slDoi, transactionUnitPrice: giaMotDon,
        })
    }
    if (cach === 'lastImport') return p.nguonMoiHon ? Math.round(giaMotDon) : null
    return null
}

/**
 * Dời tồn kẹt của MỌI mã gộp trong một cửa hàng. `chayThat: false` = chỉ đọc
 * (phép gộp chạy thử chỉ đếm dòng). `gop` để bộ kiểm thay phép gộp thật.
 */
export async function donTonMaGop(sp: any, opts: { chayThat: boolean; gop?: typeof mergeProduct }): Promise<KetQuaDon[]> {
    const gop = opts.gop || mergeProduct
    const rows: any[] = await sp.$queryRawUnsafe(sqlMaGopKet(null, false))
    if (rows.length === 0) return []
    const cach = await getCostPriceMethod(sp)

    const ra: KetQuaDon[] = []
    for (const r of rows) {
        const coSo: KetQuaDon = {
            tuSku: r.sku, sangSku: null, heSo: null, tonNguon: Number(r.stock) || 0, slDoi: 0,
            tonDichTruoc: null, tonDichSau: null, giaDichTruoc: null, giaDichSau: null, dongDoi: {}, ketQua: 'bo_qua',
        }
        if (r.dongBoNgoai) {
            ra.push({ ...coSo, lyDo: 'KiotViet/MISA đang ghi tồn vào mã gộp này — dời thì lượt đồng bộ sau ghi lại, tồn mã đích phình mãi. Bỏ đồng bộ tồn cho mã gộp trước.' })
            continue
        }
        // Từng mã một: một con trỏ hỏng không được chặn cả cửa hàng
        let d
        try {
            d = (await giaiConTroGop(sp, [r.id])).get(r.id)
        } catch (e: any) {
            if (!(e instanceof LoiQuyDoiMaGop)) throw e
            ra.push({ ...coSo, lyDo: e.message })
            continue
        }
        if (!d) { ra.push({ ...coSo, lyDo: 'Mã này vừa được gỡ gộp' }); continue }
        const slThuc = coSo.tonNguon * d.heSo
        if (Math.abs(slThuc - Math.round(slThuc)) > 1e-6) {
            ra.push({ ...coSo, sangSku: d.sku, heSo: d.heSo, lyDo: `${coSo.tonNguon} × ${d.heSo} không phải số nguyên — không làm tròn tồn kho âm thầm` })
            continue
        }
        const slDoi = Math.round(slThuc)

        // Cách 'lastImport' cần biết lần nhập vào mã gộp có MỚI HƠN lần nhập cuối của mã đích
        const moc: any[] = await sp.$queryRawUnsafe(
            `SELECT "productId", MAX("createdAt") AS m FROM "InventoryTransaction" WHERE "productId" IN ($1, $2) AND type = 'import' GROUP BY 1`, r.id, d.id)
        const mNguon = moc.find((x: any) => x.productId === r.id)?.m
        const mDich = moc.find((x: any) => x.productId === d.id)?.m
        const nguonMoiHon = !!mNguon && (!mDich || new Date(mNguon).getTime() > new Date(mDich).getTime())
        const heSo = d.heSo
        const tinhGiaVonDich = (p: { tonDich: number; giaDich: number; slDoi: number; giaNguon: number }) =>
            giaVonSauDon(cach, { ...p, heSo, nguonMoiHon })

        const truoc: any = await sp.product.findUnique({ where: { id: d.id }, select: { stock: true, costPrice: true } })
        // force: cặp này CHỦ SHOP đã gộp — chiều gộp đã chốt, chốt chặn "nghi gộp ngược" không áp ở đây
        const plan = await gop(sp, { fromSku: r.sku, toSku: d.sku, rate: heSo, dryRun: !opts.chayThat, force: true, tinhGiaVonDich })
        const sau: any = opts.chayThat ? await sp.product.findUnique({ where: { id: d.id }, select: { stock: true, costPrice: true } }) : null
        const giaThu = tinhGiaVonDich({ tonDich: Number(truoc?.stock) || 0, giaDich: Number(truoc?.costPrice) || 0, slDoi, giaNguon: Number(r.costPrice) || 0 })
        ra.push({
            ...coSo, sangSku: d.sku, heSo, slDoi,
            tonDichTruoc: Number(truoc?.stock) || 0,
            tonDichSau: sau ? Number(sau.stock) : (Number(truoc?.stock) || 0) + slDoi,
            giaDichTruoc: Number(truoc?.costPrice) || 0,
            giaDichSau: sau ? Number(sau.costPrice) : (giaThu ?? (Number(truoc?.costPrice) || 0)),
            dongDoi: plan?.rowsByTable || {},
            ketQua: opts.chayThat ? 'da_don' : 'se_don',
        })
    }
    return ra
}

/**
 * Nhịp nền (cron/tick): dò mọi cửa hàng đang hoạt động bằng kết nối REGISTRY (cùng
 * CSDL, ghi rõ schema) — cửa hàng không có mã kẹt thì KHÔNG mở client riêng, vì mỗi
 * client giữ kết nối mà cả cụm chỉ có ~45. Có mã kẹt mới mở và dời thật.
 */
export async function nhipDonTonMaGop(): Promise<string> {
    const stores: any[] = await (registryPrisma as any).store.findMany({ where: { status: 'active' }, select: { schema: true, code: true } })
    const ra: string[] = []
    for (const s of stores) {
        const schema = String(s.schema || '')
        if (!SCHEMA_RE.test(schema)) continue
        try {
            const dem: any[] = await (registryPrisma as any).$queryRawUnsafe(sqlMaGopKet(schema, true))
            if (!(Number(dem[0]?.n) > 0)) continue
            const kq = await donTonMaGop(getStorePrisma(schema), { chayThat: true })
            for (const k of kq) {
                console.log(`[donTonMaGop] ${s.code}: ${k.tuSku} → ${k.sangSku ?? '?'} ×${k.heSo ?? '?'} ` + (k.ketQua === 'da_don'
                    ? `tồn kẹt ${k.tonNguon} ⇒ +${k.slDoi} (mã đích ${k.tonDichTruoc} → ${k.tonDichSau}, giá vốn ${k.giaDichTruoc} → ${k.giaDichSau}) dòng ${JSON.stringify(k.dongDoi)}`
                    : `BỎ QUA: ${k.lyDo}`))
            }
            ra.push(`${s.code}:${kq.filter(k => k.ketQua === 'da_don').length}/${kq.length}`)
        } catch (e: any) {
            ra.push(`${s.code}:loi ${String(e?.message || e).slice(0, 80)}`)
        }
    }
    return ra.join(' ') || 'khong-co-gi'
}
