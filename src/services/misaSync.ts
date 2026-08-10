/**
 * ĐỒNG BỘ DỮ LIỆU MISA AMIS → KENGI (2026-08-09)
 *
 * NGUYÊN TẮC AN TOÀN — giống hệt cổng KiotViet, và giống vì đã trả giá để rút ra:
 *
 *  1. MẶC ĐỊNH CHẠY THỬ. Không có `apply: true` thì chỉ đếm và trả mẫu.
 *  2. KHÔNG GHI ĐÈ dữ liệu Kengi trừ khi bật cờ; mặc định chỉ TẠO MỚI và ĐIỀN
 *     CHỖ TRỐNG. Cửa hàng đã sửa giá/tên trên Kengi thì một lần đồng bộ không
 *     được nuốt mất công sức đó.
 *  3. CHỐNG TRÙNG bằng bảng MisaMap (misaId ↔ localId) + khoá nghiệp vụ
 *     (sku/code). Chạy lại phải ra "cập nhật", KHÔNG đẻ thêm bản ghi.
 *  4. BẤT BIẾN TỒN KHO: Product.stock == tổng WarehouseStock các kho `main`.
 *     Mọi thay đổi tồn ghi CẢ HAI nơi trong một transaction, kèm một dòng thẻ
 *     kho với SỐ LƯỢNG CÓ DẤU (dương = nhập, âm = xuất) và type 'adjustment'.
 *     Ghi Math.abs() hay type lạ là thẻ kho hiện sai — đã dính với KiotViet.
 *
 * PHẠM VI: MISA Open API chỉ cho KÉO DANH MỤC và TỒN KHO. Hoá đơn, phiếu thu/
 * chi, phiếu nhập kho KHÔNG kéo được (xem ghi chú đầu services/misa.ts).
 */

export interface MisaCounters {
    fetched: number
    created: number
    updated: number
    skipped: number
    failed: number
    errors: string[]
    samples: any[]
}

export function newMisaCounters(): MisaCounters {
    return { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [], samples: [] }
}

function noteError(c: MisaCounters, msg: string) {
    c.failed++
    if (c.errors.length < 20) c.errors.push(msg.slice(0, 200))
}
function boQua(c: MisaCounters, lyDo: string) {
    c.skipped++
    if (c.errors.length < 20) c.errors.push(`bỏ qua — ${lyDo}`.slice(0, 200))
}
function noteSample(c: MisaCounters, s: any) {
    if (c.samples.length < 10) c.samples.push(s)
}

/**
 * Tồn kho và công nợ tra mã trong CSDL Kengi, mà chạy thử thì Vật tư/Đối tượng
 * chưa được tạo — nên toàn bộ đều "không tìm thấy". Nói thẳng ra, đừng để người
 * xem tưởng hỏng: đợt chạy thử của HUTITAX hiện 1801 dòng tồn + 312 dòng công
 * nợ bỏ qua, nhìn y như lỗi.
 */
const nhacChayThu = (opts: MisaOptions) =>
    opts.apply ? '' : ' (đang CHẠY THỬ nên chưa tạo danh mục — chạy thật sẽ khớp)'

export interface MisaOptions {
    apply: boolean
    overwriteNames?: boolean
    overwritePrices?: boolean
    overwriteStock?: boolean
    /** Ghi đè công nợ Kengi bằng số của MISA — tiền thật, mặc định TẮT */
    overwriteDebt?: boolean
    /** Đảo dấu công nợ phải trả (MISA có bản trả số âm) — xem syncMisaDebt */
    negateDebt?: boolean
    defaultCategoryId?: string | null
    defaultWarehouseId?: string | null
    onProgress?: (c: MisaCounters) => void
}

function beat(opts: MisaOptions, c: MisaCounters) {
    if (opts.onProgress && c.fetched % 25 === 0) opts.onProgress(c)
}

// ─── Bản đồ id MISA ↔ id Kengi ──────────────────────────────────────────────

async function findMap(sp: any, entity: string, misaId: string | number): Promise<string | null> {
    const row = await sp.misaMap.findUnique({
        where: { entity_misaId: { entity, misaId: String(misaId) } },
        select: { localId: true },
    }).catch(() => null)
    return row?.localId || null
}

async function saveMap(sp: any, entity: string, misaId: string | number, misaCode: string | null, localId: string) {
    await sp.misaMap.upsert({
        where: { entity_misaId: { entity, misaId: String(misaId) } },
        create: { entity, misaId: String(misaId), misaCode: misaCode || null, localId, syncedAt: new Date() },
        update: { localId, misaCode: misaCode || null, syncedAt: new Date() },
    }).catch(() => { /* bảng map hỏng không được giết cả đợt */ })
}

/** MISA trả tên trường snake_case; vẫn dò vài biến thể phòng bản khác. */
const pick = (o: any, ...keys: string[]) => {
    for (const k of keys) {
        const v = o?.[k]
        if (v !== undefined && v !== null && v !== '') return v
    }
    return undefined
}

const soTien = (v: any) => {
    const n = Number(v)
    return isFinite(n) ? n : 0
}

// ─── VẬT TƯ / HÀNG HOÁ (data_type = 2) ──────────────────────────────────────

export async function syncMisaProducts(sp: any, items: any[], opts: MisaOptions, c: MisaCounters): Promise<void> {
    const catCache = new Map<string, string>()

    for (const m of items) {
        c.fetched++
        beat(opts, c)
        try {
            const misaId = pick(m, 'inventory_item_id', 'InventoryItemID')
            const code = String(pick(m, 'inventory_item_code', 'InventoryItemCode') || '').trim()
            const name = String(pick(m, 'inventory_item_name', 'InventoryItemName') || '').trim()
            if (!misaId || !code || !name) { boQua(c, 'thiếu mã hoặc tên vật tư'); continue }

            /**
             * GIÁ: `unit_price` của MISA là ĐƠN GIÁ VỐN (giá nhập), còn giá bán
             * nằm ở sale_price1..3. Lấy nhầm là hàng nào cũng bán bằng giá vốn.
             * Không có giá bán thì để 0 chứ KHÔNG lấy giá vốn thay — bán lỗ vì
             * một phép suy diễn thì quá đắt.
             */
            const giaVon = soTien(pick(m, 'unit_price', 'UnitPrice'))
            const giaBan = soTien(pick(m, 'sale_price1', 'SalePrice1', 'fixed_sale_price', 'FixedSalePrice'))

            let localId = await findMap(sp, 'product', misaId)
            let existing = localId
                ? await sp.product.findUnique({ where: { id: localId } }).catch(() => null)
                : null
            if (!existing) existing = await sp.product.findUnique({ where: { sku: code } }).catch(() => null)

            if (existing) {
                const data: any = {}
                if (opts.overwriteNames && name !== existing.name) data.name = name
                if (opts.overwritePrices) {
                    if (giaBan > 0 && giaBan !== existing.sellingPrice) data.sellingPrice = giaBan
                    if (giaVon > 0 && giaVon !== existing.costPrice) data.costPrice = giaVon
                } else {
                    if (!existing.sellingPrice && giaBan > 0) data.sellingPrice = giaBan
                    if (!existing.costPrice && giaVon > 0) data.costPrice = giaVon
                }

                if (!Object.keys(data).length) {
                    c.skipped++
                    if (opts.apply) await saveMap(sp, 'product', misaId, code, existing.id)
                    continue
                }
                if (opts.apply) {
                    await sp.product.update({ where: { id: existing.id }, data })
                    await saveMap(sp, 'product', misaId, code, existing.id)
                }
                c.updated++
                noteSample(c, { sku: code, name, hanhDong: 'cập nhật', truong: Object.keys(data) })
            } else {
                const categoryId = await resolveCategory(sp, pick(m, 'inventory_category_name', 'InventoryCategoryName'),
                    opts.defaultCategoryId, catCache, opts.apply)
                if (!categoryId) { noteError(c, `Mã ${code}: chưa có nhóm hàng mặc định để gán`); continue }

                if (opts.apply) {
                    const created = await sp.product.create({
                        data: {
                            name, sku: code, categoryId,
                            productType: loaiHang(m),
                            sellingPrice: giaBan,
                            costPrice: giaVon,
                            stock: 0,          // đặt qua applyStock để giữ bất biến kho
                            baseUnit: String(pick(m, 'unit_name', 'UnitName') || 'cái').slice(0, 50),
                        },
                    })
                    await saveMap(sp, 'product', misaId, code, created.id)
                }
                c.created++
                noteSample(c, { sku: code, name, giaBan, giaVon, loai: loaiHang(m), hanhDong: 'tạo mới' })
            }
        } catch (e: any) {
            noteError(c, `Vật tư ${pick(m, 'inventory_item_code') || ''}: ${e?.message || e}`)
        }
    }
}

/**
 * Tính chất vật tư của MISA → loại sản phẩm Kengi.
 *
 * Tài liệu mục 5.7 (inventory_item): 0 = vật tư hàng hoá, 1 = thành phẩm,
 * 2 = DỊCH VỤ, 3 = nguyên vật liệu. Chỉ 2 mới là dịch vụ; ba giá trị còn lại
 * đều là hàng có tồn kho. Trước đây chỗ này để cứng 'goods' vì chưa tra ra bảng
 * giá trị — nay đã có, dịch vụ không còn bị tính tồn kho oan.
 */
function loaiHang(m: any): 'goods' | 'service' {
    const t = Number(pick(m, 'inventory_item_type', 'InventoryItemType'))
    return t === 2 ? 'service' : 'goods'
}

async function resolveCategory(
    sp: any, name: any, fallbackId: string | null | undefined,
    cache: Map<string, string>, apply: boolean,
): Promise<string | null> {
    const key = String(name || '').trim() || 'Nhập từ MISA'
    if (cache.has(key)) return cache.get(key)!
    const found = await sp.category.findFirst({ where: { name: key }, select: { id: true } }).catch(() => null)
    if (found) { cache.set(key, found.id); return found.id }
    // Chạy thử không tạo nhóm thật, nhưng cũng không được coi là lỗi — chạy thật
    // sẽ tạo được (bài học từ KiotViet: 100% sản phẩm báo lỗi oan)
    if (!apply) return fallbackId || '__CHAY_THU_SE_TAO_NHOM__'
    const created = await sp.category.create({ data: { name: key, description: 'Đồng bộ từ MISA' } }).catch(() => null)
    if (created) { cache.set(key, created.id); return created.id }
    return fallbackId || null
}

// ─── ĐỐI TƯỢNG (data_type = 1): khách hàng + nhà cung cấp chung một bảng ────

/**
 * MISA gộp khách hàng, NCC và nhân viên vào một danh mục, phân biệt bằng cờ
 * `is_customer` / `is_vendor` / `is_employee`. Một đối tượng có thể VỪA là
 * khách VỪA là NCC — khi đó tạo ở CẢ HAI bên, đúng như MISA hiểu.
 */
export async function syncMisaPartners(sp: any, items: any[], opts: MisaOptions, c: MisaCounters): Promise<void> {
    for (const m of items) {
        c.fetched++
        beat(opts, c)
        try {
            const misaId = pick(m, 'account_object_id', 'AccountObjectID')
            const code = String(pick(m, 'account_object_code', 'AccountObjectCode') || '').trim()
            const name = String(pick(m, 'account_object_name', 'AccountObjectName') || '').trim()
            if (!misaId || !name) { boQua(c, 'thiếu mã hoặc tên đối tượng'); continue }

            const laKhach = !!pick(m, 'is_customer', 'IsCustomer')
            const laNcc = !!pick(m, 'is_vendor', 'IsVendor')
            const laNhanVien = !!pick(m, 'is_employee', 'IsEmployee')
            if (!laKhach && !laNcc) {
                boQua(c, `${code || name}: ${laNhanVien ? 'là nhân viên' : 'không phải khách hàng hay NCC'}`)
                continue
            }

            const phone = laySoDienThoai(m)
            const diaChi = String(pick(m, 'address', 'Address') || '').slice(0, 500) || null
            const mst = String(pick(m, 'company_tax_code', 'CompanyTaxCode', 'tax_code') || '').trim() || null
            let daLam = false

            if (laKhach) {
                const finalCode = code || `MISA${misaId}`
                let localId = await findMap(sp, 'customer', misaId)
                let kh = localId ? await sp.customer.findUnique({ where: { id: localId } }).catch(() => null) : null
                if (!kh) kh = await sp.customer.findUnique({ where: { code: finalCode } }).catch(() => null)
                if (!kh && phone) kh = await sp.customer.findFirst({ where: { phone } }).catch(() => null)

                if (kh) {
                    const data: any = {}
                    if (opts.overwriteNames && name !== kh.name) data.name = name
                    if (!kh.phone && phone) data.phone = phone
                    if (!kh.address && diaChi) data.address = diaChi
                    if (Object.keys(data).length && opts.apply) {
                        await sp.customer.update({ where: { id: kh.id }, data })
                    }
                    if (opts.apply) await saveMap(sp, 'customer', misaId, finalCode, kh.id)
                    if (Object.keys(data).length) { c.updated++; daLam = true }
                } else {
                    if (opts.apply) {
                        const created = await sp.customer.create({
                            data: { code: finalCode, name, phone, address: diaChi, notes: 'Đồng bộ từ MISA' },
                        })
                        await saveMap(sp, 'customer', misaId, finalCode, created.id)
                    }
                    c.created++; daLam = true
                    noteSample(c, { code: finalCode, name, phone, vaiTro: 'khách hàng', hanhDong: 'tạo mới' })
                }
            }

            if (laNcc) {
                const finalCode = code || `MISANCC${misaId}`
                let localId = await findMap(sp, 'supplier', misaId)
                let ncc = localId ? await sp.supplier.findUnique({ where: { id: localId } }).catch(() => null) : null
                if (!ncc) ncc = await sp.supplier.findUnique({ where: { code: finalCode } }).catch(() => null)

                if (ncc) {
                    const data: any = {}
                    if (opts.overwriteNames && name !== ncc.name) data.name = name
                    if (!ncc.phone && phone) data.phone = phone
                    if (!ncc.address && diaChi) data.address = diaChi
                    if (!ncc.taxCode && mst) data.taxCode = mst
                    if (Object.keys(data).length && opts.apply) {
                        await sp.supplier.update({ where: { id: ncc.id }, data })
                    }
                    if (opts.apply) await saveMap(sp, 'supplier', misaId, finalCode, ncc.id)
                    if (Object.keys(data).length) { c.updated++; daLam = true }
                } else {
                    if (opts.apply) {
                        const created = await sp.supplier.create({
                            data: { code: finalCode, name, phone, address: diaChi, taxCode: mst, notes: 'Đồng bộ từ MISA' },
                        })
                        await saveMap(sp, 'supplier', misaId, finalCode, created.id)
                    }
                    c.created++; daLam = true
                    noteSample(c, { code: finalCode, name, mst, vaiTro: 'nhà cung cấp', hanhDong: 'tạo mới' })
                }
            }

            if (!daLam) c.skipped++
        } catch (e: any) {
            noteError(c, `Đối tượng ${pick(m, 'account_object_code') || ''}: ${e?.message || e}`)
        }
    }
}

/**
 * Ô điện thoại của MISA là văn bản tự do, có nơi để 2 số. Lấy số ĐẦU TIÊN hợp
 * lệ — bỏ hết ký tự không phải số sẽ dán chúng thành chuỗi vô nghĩa (đã dính
 * với KiotViet: "02563 847 745 - 0903 596 729" → 21 chữ số).
 */
function laySoDienThoai(m: any): string {
    const raw = String(pick(m, 'tel', 'Tel', 'phone_number', 'PhoneNumber', 'mobile', 'Mobile', 'contact_mobile') || '')
    if (!raw.trim()) return ''
    const parts = raw.split(/[^\d+]{2,}|[,;/|]|\s-\s|–|—/).map(p => p.replace(/[^\d+]/g, '')).filter(Boolean)
    for (const p of parts) {
        const d = p.replace(/\D/g, '')
        if (d.length >= 8 && d.length <= 12) return p
    }
    const all = raw.replace(/[^\d+]/g, '')
    const d = all.replace(/\D/g, '')
    return d.length >= 8 && d.length <= 12 ? all : ''
}

// ─── KHO (data_type = 3) ────────────────────────────────────────────────────

/**
 * ĐỪNG ĐẺ THÊM "KHO CHÍNH" THỨ HAI.
 *
 * Kengi tạo sẵn cho mỗi chi nhánh một kho `main` mặc định. MISA của cửa hàng
 * bán lẻ thường chỉ có ĐÚNG MỘT kho, nên tạo thêm một kho `main` nữa là cửa
 * hàng mới toanh đã có 2 "kho chính" (đo 10/08/2026: HUTITAX vừa tạo, 1 chi
 * nhánh, mà có "Kho chính" + "Kho Hàng" do đồng bộ MISA đẻ ra).
 *
 * Tệ hơn: kho vừa tạo đó KHÔNG được dùng — `syncMisaStock` ghi tồn vào kho mặc
 * định của chi nhánh (xem `datTon`), nên nó chỉ nằm đó làm rối mọi ô chọn kho.
 *
 * Nên: MISA chỉ có một kho thì GẮN nó vào kho mặc định sẵn có; nhiều kho mới
 * tạo thêm.
 */
export async function syncMisaWarehouses(sp: any, items: any[], opts: MisaOptions, c: MisaCounters): Promise<void> {
    const khoMacDinh = opts.defaultWarehouseId
        ? await sp.warehouse.findUnique({
            where: { id: opts.defaultWarehouseId }, select: { id: true, code: true, name: true },
        }).catch(() => null)
        : null
    const chiMotKho = items.length === 1

    for (const m of items) {
        c.fetched++
        beat(opts, c)
        try {
            const misaId = pick(m, 'stock_id', 'StockID')
            const code = String(pick(m, 'stock_code', 'StockCode') || '').trim()
            const name = String(pick(m, 'stock_name', 'StockName') || '').trim()
            if (!misaId || !code || !name) { boQua(c, 'thiếu mã hoặc tên kho'); continue }

            let localId = await findMap(sp, 'warehouse', misaId)
            let kho = localId ? await sp.warehouse.findUnique({ where: { id: localId } }).catch(() => null) : null
            if (!kho) kho = await sp.warehouse.findUnique({ where: { code } }).catch(() => null)

            if (kho) {
                c.skipped++
                if (opts.apply) await saveMap(sp, 'warehouse', misaId, code, kho.id)
                continue
            }
            // Kho MISA duy nhất → dùng luôn kho mặc định của Kengi, không tạo thêm
            if (chiMotKho && khoMacDinh) {
                if (opts.apply) await saveMap(sp, 'warehouse', misaId, code, khoMacDinh.id)
                c.skipped++
                noteSample(c, {
                    code, name,
                    hanhDong: `gắn vào kho sẵn có "${khoMacDinh.name}" (${khoMacDinh.code}) — MISA chỉ có 1 kho nên không tạo kho mới`,
                })
                continue
            }
            if (opts.apply) {
                const created = await sp.warehouse.create({
                    data: {
                        code, name,
                        // Kho từ MISA là kho HÀNG BÁN ĐƯỢC → type 'main' để tồn
                        // của nó nằm trong bất biến Product.stock
                        type: 'main',
                        isActive: !pick(m, 'inactive', 'Inactive'),
                        description: 'Đồng bộ từ MISA',
                    },
                })
                await saveMap(sp, 'warehouse', misaId, code, created.id)
            }
            c.created++
            noteSample(c, { code, name, hanhDong: 'tạo mới' })
        } catch (e: any) {
            noteError(c, `Kho ${pick(m, 'stock_code') || ''}: ${e?.message || e}`)
        }
    }
}

// ─── TỒN KHO (get_list_inventory_balance) ───────────────────────────────────

/**
 * MISA trả tồn theo TỪNG KHO. Gộp lại theo mã vật tư rồi đặt một lần cho mỗi
 * sản phẩm — đặt từng dòng sẽ khiến sản phẩm có 3 kho bị ghi đè 3 lần, kết quả
 * cuối chỉ còn tồn của kho cuối cùng.
 *
 * Chỉ chạy khi người dùng bật `overwriteStock`: đây là ghi đè tồn kho thật.
 */
export async function syncMisaStock(sp: any, rows: any[], opts: MisaOptions, c: MisaCounters): Promise<void> {
    if (!opts.overwriteStock) {
        c.fetched = rows.length
        boQua(c, 'Chưa bật "Ghi đè tồn kho" — bỏ qua toàn bộ để không đụng tồn thật')
        return
    }

    const tong = new Map<string, number>()
    for (const r of rows) {
        const code = String(pick(r, 'inventory_item_code', 'InventoryItemCode') || '').trim()
        if (!code) continue
        const qty = Number(pick(r, 'quantity_balance', 'QuantityBalance') ?? 0) || 0
        tong.set(code, (tong.get(code) || 0) + qty)
    }

    for (const [code, qty] of tong) {
        c.fetched++
        beat(opts, c)
        try {
            const p = await sp.product.findUnique({
                where: { sku: code }, select: { id: true, name: true, sku: true, stock: true },
            }).catch(() => null)
            if (!p) { boQua(c, `Mã ${code}: chưa có bên Kengi — đồng bộ Vật tư trước${nhacChayThu(opts)}`); continue }

            const target = Math.round(qty)
            if (target === p.stock) { c.skipped++; continue }
            if (opts.apply) await datTon(sp, p, target, opts, `MISA đồng bộ tồn (mã ${code})`)
            c.updated++
            noteSample(c, { sku: code, tonCu: p.stock, tonMoi: target })
        } catch (e: any) {
            noteError(c, `Tồn kho ${code}: ${e?.message || e}`)
        }
    }
}

/** Đặt tồn, GIỮ BẤT BIẾN Product.stock == tổng WarehouseStock kho `main`. */
async function datTon(sp: any, product: any, target: number, opts: MisaOptions, lyDo: string): Promise<void> {
    const whId = opts.defaultWarehouseId
    const delta = target - (Number(product.stock) || 0)
    if (!delta) return

    await sp.$transaction(async (tx: any) => {
        if (whId) {
            const cur = await tx.warehouseStock.findUnique({
                where: { warehouseId_productId: { warehouseId: whId, productId: product.id } },
                select: { quantity: true },
            }).catch(() => null)
            const newQty = (Number(cur?.quantity) || 0) + delta
            await tx.warehouseStock.upsert({
                where: { warehouseId_productId: { warehouseId: whId, productId: product.id } },
                create: {
                    warehouseId: whId, productId: product.id,
                    productName: product.name, productSku: product.sku,
                    quantity: newQty < 0 ? 0 : newQty,
                },
                update: { quantity: newQty < 0 ? 0 : newQty },
            })
        }
        await tx.product.update({ where: { id: product.id }, data: { stock: target < 0 ? 0 : target } })
        await tx.inventoryTransaction.create({
            data: {
                // SỐ LƯỢNG CÓ DẤU + từ vựng chuẩn của app — xem nguyên tắc 4 đầu file
                type: 'adjustment',
                productId: product.id,
                productName: product.name,
                productSku: product.sku,
                quantity: delta,
                reason: lyDo,
                referenceType: 'misa',
                userName: 'MISA Sync',
            },
        }).catch(() => { })
    })
}

// ─── CÔNG NỢ (get_list_acc_obj_debt) ────────────────────────────────────────

/**
 * Công nợ phải thu (loai = 0 → Customer.debt) và phải trả (loai = 1 →
 * Supplier.payable).
 *
 * VỀ DẤU — chỗ này ĐÃ SUÝT ĐOÁN SAI nên viết rõ: ví dụ trong tài liệu MISA cho
 * công nợ phải trả là SỐ ÂM (-235.800.000), trong khi Kengi quy ước
 * `Supplier.payable` DƯƠNG = mình đang nợ NCC. Không có cách nào biết chắc bản
 * dữ liệu của từng cửa hàng theo quy ước nào, nên:
 *   - Chạy thử luôn ĐẾM số dòng âm/dương và báo lên màn hình.
 *   - Nếu phần lớn ngược dấu với quy ước Kengi mà người dùng chưa bật "đảo dấu"
 *     thì ghi một cảnh báo TO, KHÔNG tự ý đảo.
 * Đây là tiền thật; thà bắt bấm thêm một nút còn hơn ghi ngược cả sổ công nợ.
 *
 * Chỉ cập nhật đối tượng ĐÃ CÓ bên Kengi. Không đẻ khách/NCC mới từ bảng công
 * nợ — việc đó của mục "Đối tượng", chạy trước.
 */
export async function syncMisaDebt(
    sp: any, rows: any[], loai: number, opts: MisaOptions, c: MisaCounters,
): Promise<void> {
    const laPhaiThu = Number(loai) === 0
    const ten = laPhaiThu ? 'phải thu' : 'phải trả'

    // Đo dấu TRƯỚC khi ghi — số liệu này hiện ra ở mục "mẫu" của đợt chạy
    let duong = 0, am = 0, tongThuan = 0
    for (const r of rows) {
        const v = soTien(pick(r, 'debt_amount', 'DebtAmount'))
        if (v > 0) duong++; else if (v < 0) am++
        tongThuan += v
    }
    noteSample(c, {
        khaoSatDau: `công nợ ${ten}`,
        soDong: rows.length, soDongDuong: duong, soDongAm: am,
        tongCong: Math.round(tongThuan),
        dangDaoDau: !!opts.negateDebt,
    })
    /**
     * CẢNH BÁO PHẢI CANH CẢ HAI CHIỀU. Bản đầu chỉ canh chiều "dữ liệu âm mà
     * quên bật đảo dấu"; đợt chạy 09/08/2026 của HUTITAX dính đúng chiều còn
     * lại: dữ liệu vốn đã DƯƠNG (phải thu 161 dương / 43 âm) mà công tắc đảo
     * dấu lại đang BẬT — chạy thật là lật ngược cả sổ công nợ mà không một lời
     * nhắc. Thiếu sót của cảnh báo cũng là lỗi.
     */
    if (am > duong && !opts.negateDebt) {
        c.errors.push(
            `Công nợ ${ten}: ${am}/${rows.length} dòng đang là SỐ ÂM trong khi Kengi quy ước số dương. ` +
            `Nhiều khả năng phải BẬT "Đảo dấu công nợ" rồi chạy lại — chưa ghi gì theo chiều đoán.`,
        )
    }
    if (duong > am && opts.negateDebt) {
        c.errors.push(
            `Công nợ ${ten}: ${duong}/${rows.length} dòng ĐÃ LÀ SỐ DƯƠNG, đúng quy ước Kengi, ` +
            `mà công tắc "Đảo dấu công nợ" đang BẬT — chạy thật sẽ ghi ngược dấu toàn bộ. ` +
            `TẮT công tắc đó rồi chạy lại.`,
        )
    }

    if (!opts.overwriteDebt) {
        c.fetched = rows.length
        boQua(c, `Chưa bật "Ghi đè công nợ" — bỏ qua toàn bộ ${rows.length} dòng ${ten} để không đụng số dư thật`)
        return
    }

    const heSo = opts.negateDebt ? -1 : 1

    for (const r of rows) {
        c.fetched++
        beat(opts, c)
        try {
            const misaId = pick(r, 'account_object_id', 'AccountObjectID')
            const code = String(pick(r, 'account_object_code', 'AccountObjectCode') || '').trim()
            const soTienNo = Math.round(soTien(pick(r, 'debt_amount', 'DebtAmount')) * heSo)

            if (laPhaiThu) {
                let localId = misaId ? await findMap(sp, 'customer', misaId) : null
                let kh = localId ? await sp.customer.findUnique({ where: { id: localId } }).catch(() => null) : null
                if (!kh && code) kh = await sp.customer.findUnique({ where: { code } }).catch(() => null)
                if (!kh) { boQua(c, `Phải thu ${code || misaId}: chưa có khách này bên Kengi${nhacChayThu(opts)}`); continue }
                if (Math.round(kh.debt || 0) === soTienNo) { c.skipped++; continue }
                if (opts.apply) await sp.customer.update({ where: { id: kh.id }, data: { debt: soTienNo } })
                c.updated++
                noteSample(c, { code: kh.code, ten: kh.name, noCu: kh.debt, noMoi: soTienNo })
            } else {
                let localId = misaId ? await findMap(sp, 'supplier', misaId) : null
                let ncc = localId ? await sp.supplier.findUnique({ where: { id: localId } }).catch(() => null) : null
                if (!ncc && code) ncc = await sp.supplier.findUnique({ where: { code } }).catch(() => null)
                if (!ncc) { boQua(c, `Phải trả ${code || misaId}: chưa có NCC này bên Kengi${nhacChayThu(opts)}`); continue }
                if (Math.round(ncc.payable || 0) === soTienNo) { c.skipped++; continue }
                if (opts.apply) await sp.supplier.update({ where: { id: ncc.id }, data: { payable: soTienNo } })
                c.updated++
                noteSample(c, { code: ncc.code, ten: ncc.name, noCu: ncc.payable, noMoi: soTienNo })
            }
        } catch (e: any) {
            noteError(c, `Công nợ ${ten} ${pick(r, 'account_object_code') || ''}: ${e?.message || e}`)
        }
    }
}

// ─── DANH MỤC ĐÃ XOÁ (get_dictionary_delete) ────────────────────────────────

/**
 * MISA xoá một danh mục thì bên Kengi NGỪNG THEO DÕI, tuyệt đối không xoá theo:
 * mã hàng đã nằm trong hoá đơn, thẻ kho, đơn sàn — xoá là gãy lịch sử.
 *
 * Kengi không có cờ ngừng theo dõi cho Hàng hoá và Khách hàng (Product và
 * Customer đều không có trường trạng thái), nên hai loại đó chỉ BÁO LÊN để chủ
 * cửa hàng tự xử, không im lặng bỏ qua.
 */
export async function syncMisaDeleted(
    sp: any, rows: any[], opts: MisaOptions, c: MisaCounters,
): Promise<void> {
    for (const r of rows) {
        c.fetched++
        beat(opts, c)
        try {
            const loai = Number(pick(r, 'type', 'Type'))
            const misaId = pick(r, 'id', 'Id', 'ID')
            // `data` là CHUỖI JSON lồng, chứa mã/tên của bản ghi bị xoá
            const info = docJson(pick(r, 'data', 'Data'))
            const code = String(
                pick(info || {}, 'stock_code', 'inventory_item_code', 'account_object_code') || '',
            ).trim()
            const ten = String(
                pick(info || {}, 'stock_name', 'inventory_item_name', 'account_object_name') || '',
            ).trim()

            if (loai === 3) {                       // Kho
                let localId = misaId ? await findMap(sp, 'warehouse', misaId) : null
                let kho = localId ? await sp.warehouse.findUnique({ where: { id: localId } }).catch(() => null) : null
                if (!kho && code) kho = await sp.warehouse.findUnique({ where: { code } }).catch(() => null)
                if (!kho) { c.skipped++; continue }
                if (!kho.isActive) { c.skipped++; continue }
                if (opts.apply) await sp.warehouse.update({ where: { id: kho.id }, data: { isActive: false } })
                c.updated++
                noteSample(c, { loai: 'kho', code: kho.code, ten: kho.name, hanhDong: 'ngừng theo dõi' })
            } else if (loai === 1) {                // Đối tượng: chỉ NCC có cờ trạng thái
                let localId = misaId ? await findMap(sp, 'supplier', misaId) : null
                let ncc = localId ? await sp.supplier.findUnique({ where: { id: localId } }).catch(() => null) : null
                if (!ncc && code) ncc = await sp.supplier.findUnique({ where: { code } }).catch(() => null)
                if (ncc && ncc.status !== 'inactive') {
                    if (opts.apply) await sp.supplier.update({ where: { id: ncc.id }, data: { status: 'inactive' } })
                    c.updated++
                    noteSample(c, { loai: 'nhà cung cấp', code: ncc.code, ten: ncc.name, hanhDong: 'ngừng theo dõi' })
                    continue
                }
                const kh = code ? await sp.customer.findUnique({ where: { code } }).catch(() => null) : null
                if (kh) {
                    boQua(c, `Khách ${kh.code} (${kh.name}) đã bị xoá bên MISA — Kengi không có cờ ngừng theo dõi khách hàng, cần xử lý tay`)
                } else c.skipped++
            } else if (loai === 2) {                // Vật tư
                const hang = code ? await sp.product.findUnique({ where: { sku: code } }).catch(() => null) : null
                if (hang) {
                    boQua(c, `Hàng ${hang.sku} (${hang.name}) đã bị xoá bên MISA — Kengi không có cờ ngừng theo dõi hàng hoá, cần xử lý tay`)
                } else c.skipped++
            } else {
                boQua(c, `Loại danh mục ${loai}${ten ? ` (${ten})` : ''} đã xoá bên MISA — Kengi không quản lý loại này`)
            }
        } catch (e: any) {
            noteError(c, `Danh mục đã xoá: ${e?.message || e}`)
        }
    }
}

/** MISA hay lồng JSON trong chuỗi — gỡ một lớp, hỏng thì trả null. */
function docJson(v: any): any {
    if (!v) return null
    if (typeof v === 'object') return v
    try { return JSON.parse(String(v)) } catch { return null }
}
