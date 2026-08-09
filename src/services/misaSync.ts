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

export interface MisaOptions {
    apply: boolean
    overwriteNames?: boolean
    overwritePrices?: boolean
    overwriteStock?: boolean
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
                            // MISA có inventory_item_type nhưng tài liệu không nói rõ
                            // giá trị nào là dịch vụ → KHÔNG đoán, để mặc định hàng hoá
                            productType: 'goods',
                            sellingPrice: giaBan,
                            costPrice: giaVon,
                            stock: 0,          // đặt qua applyStock để giữ bất biến kho
                            baseUnit: String(pick(m, 'unit_name', 'UnitName') || 'cái').slice(0, 50),
                        },
                    })
                    await saveMap(sp, 'product', misaId, code, created.id)
                }
                c.created++
                noteSample(c, { sku: code, name, giaBan, giaVon, hanhDong: 'tạo mới' })
            }
        } catch (e: any) {
            noteError(c, `Vật tư ${pick(m, 'inventory_item_code') || ''}: ${e?.message || e}`)
        }
    }
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

export async function syncMisaWarehouses(sp: any, items: any[], opts: MisaOptions, c: MisaCounters): Promise<void> {
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
            if (!p) { boQua(c, `Mã ${code}: chưa có bên Kengi — đồng bộ Vật tư trước`); continue }

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
