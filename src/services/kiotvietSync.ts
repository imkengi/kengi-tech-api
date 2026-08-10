/**
 * ĐỒNG BỘ DỮ LIỆU KIOTVIET → KENGI (2026-08-05)
 *
 * NGUYÊN TẮC AN TOÀN (đây là dữ liệu sản xuất, đọc hết trước khi sửa):
 *
 *  1. MẶC ĐỊNH CHẠY THỬ. Không truyền `apply: true` thì chỉ đếm và liệt kê,
 *     không ghi một dòng nào. Giống hệt /admin/adjust-stock.
 *
 *  2. KHÔNG GHI ĐÈ dữ liệu Kengi trừ khi người dùng bật cờ tương ứng
 *     (overwriteNames/Prices/Stock). Mặc định chỉ TẠO MỚI và ĐIỀN CHỖ TRỐNG.
 *     Lý do: cửa hàng đã sửa giá/tên trên Kengi thì một lần đồng bộ không được
 *     phép nuốt mất công sức đó.
 *
 *  3. CHỐNG TRÙNG bằng bảng KiotVietMap (kvId ↔ localId) + khoá nghiệp vụ
 *     (sku/code/receiptNumber). Chạy lại đợt đồng bộ cũ phải ra "cập nhật",
 *     KHÔNG được đẻ thêm bản ghi.
 *
 *  4. BẤT BIẾN TỒN KHO: Product.stock phải bằng tổng WarehouseStock của các kho
 *     `main`. Mọi thay đổi tồn đều ghi CẢ HAI nơi trong một transaction, kèm
 *     một dòng InventoryTransaction để còn truy vết được ai/khi nào/tại sao.
 *
 *  5. HOÁ ĐƠN KHÔNG TRỪ KHO. Tồn lấy từ `onHand` của KiotViet vốn ĐÃ trừ các
 *     hoá đơn đó rồi; trừ thêm lần nữa là âm kho khống. Hoá đơn nhập vào chỉ để
 *     có lịch sử doanh thu.
 */

import crypto from 'crypto'

export interface SyncCounters {
    fetched: number
    created: number
    updated: number
    skipped: number
    failed: number
    errors: string[]
    samples: any[]
}

export function newCounters(): SyncCounters {
    return { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [], samples: [] }
}

function noteError(c: SyncCounters, msg: string) {
    c.failed++
    if (c.errors.length < 20) c.errors.push(msg.slice(0, 200))
}

function noteSample(c: SyncCounters, s: any) {
    if (c.samples.length < 10) c.samples.push(s)
}

/**
 * Bỏ qua CÓ GHI LÝ DO. Bỏ qua im lặng làm nhật ký chỉ còn con số "bỏ qua 1",
 * không ai lần ra được vì sao webhook hoá đơn về mà không lưu (dính 08/08/2026).
 */
function boQua(c: SyncCounters, lyDo: string) {
    c.skipped++
    if (c.errors.length < 20) c.errors.push(`bỏ qua — ${lyDo}`.slice(0, 200))
}

export interface SyncOptions {
    apply: boolean
    overwriteNames?: boolean
    overwritePrices?: boolean
    overwriteStock?: boolean
    defaultCategoryId?: string | null
    defaultWarehouseId?: string | null
    branchIds?: number[]
    /** Người tạo cho bản ghi nhập từ KiotViet (bắt buộc với hoá đơn) */
    systemUserId?: string | null
    /**
     * NHỊP TIM. Gọi sau mỗi vài bản ghi để đóng dấu "còn sống" vào nhật ký.
     * Không có nó thì đợt chạy nền chết giữa chừng vẫn hiện "đang chạy" mãi mãi
     * và người dùng không biết nên chờ hay bấm lại (dính 06/08/2026).
     * Bên gọi tự giới hạn tần suất ghi DB.
     */
    onProgress?: (c: SyncCounters) => void
    /**
     * Mã phiếu thu ĐÃ tính vào hoá đơn trong CHÍNH lượt chạy này.
     * Bảng map chỉ được ghi khi chạy thật, nên chạy thử cần chỗ nhớ tạm — thiếu
     * nó thì số liệu chạy thử lệch hẳn với chạy thật ở phần sổ quỹ.
     */
    invoicePaymentCodes?: Set<string>
}

/** Đập nhịp mỗi 25 bản ghi — đủ dày để thấy tiến độ, đủ thưa để không nghẽn DB. */
function beat(opts: SyncOptions, c: SyncCounters) {
    if (opts.onProgress && c.fetched % 25 === 0) opts.onProgress(c)
}

/**
 * Lấy MỘT số điện thoại dùng được từ ô liên hệ của KiotViet.
 *
 * Ô đó là văn bản tự do, khách hay nhập 2 số: "02563 847 745 - 0903 596 729".
 * Bóc thô kiểu bỏ hết ký tự không phải số sẽ dán chúng lại thành chuỗi 21 chữ
 * số vô nghĩa, gọi không được mà đối chiếu trùng khách cũng hỏng (đo 06/08/2026).
 * Ở đây tách theo dấu phân cách rồi lấy số ĐẦU TIÊN có độ dài hợp lệ.
 */
export function firstPhone(raw: any): string {
    const s = String(raw || '').trim()
    if (!s) return ''
    const parts = s.split(/[^\d+]{2,}|[,;/|]|\s-\s|–|—/).map(p => p.replace(/[^\d+]/g, '')).filter(Boolean)
    for (const p of parts) {
        const digits = p.replace(/\D/g, '')
        if (digits.length >= 8 && digits.length <= 12) return p
    }
    // Không tách được: chỉ nhận khi cả chuỗi đã là một số hợp lệ, còn lại bỏ
    const all = s.replace(/[^\d+]/g, '')
    const d = all.replace(/\D/g, '')
    return d.length >= 8 && d.length <= 12 ? all : ''
}

// ─── Bản đồ id KiotViet ↔ id Kengi ──────────────────────────────────────────

async function findMap(sp: any, entity: string, kvId: string | number): Promise<string | null> {
    const row = await sp.kiotVietMap.findUnique({
        where: { entity_kvId: { entity, kvId: String(kvId) } },
        select: { localId: true },
    }).catch(() => null)
    return row?.localId || null
}

async function saveMap(sp: any, entity: string, kvId: string | number, kvCode: string | null, localId: string) {
    await sp.kiotVietMap.upsert({
        where: { entity_kvId: { entity, kvId: String(kvId) } },
        create: { entity, kvId: String(kvId), kvCode: kvCode || null, localId, syncedAt: new Date() },
        update: { localId, kvCode: kvCode || null, syncedAt: new Date() },
    }).catch(() => { /* bảng map hỏng không được giết cả đợt đồng bộ */ })
}

// ─── Danh mục ───────────────────────────────────────────────────────────────

/**
 * Id giả dùng trong CHẠY THỬ khi nhóm hàng chưa tồn tại.
 *
 * Chạy thử không được tạo nhóm thật, nhưng cũng KHÔNG được báo lỗi: lần chạy
 * thật sẽ tạo nhóm đó và sản phẩm vào bình thường. Trước đây trả null ở đây làm
 * cửa hàng chưa có nhóm hàng nào bị báo lỗi 100% sản phẩm khi chạy thử — nhìn
 * như hỏng nặng trong khi thực ra chạy thật là chạy được (dính 06/08/2026).
 * Chỉ xuất hiện khi apply=false nên không bao giờ chạm tới DB.
 */
const DRYRUN_CATEGORY = '__CHAY_THU_SE_TAO_NHOM__'

/** Lấy/ tạo Category theo tên KiotViet. Có bộ nhớ đệm trong một đợt đồng bộ. */
async function resolveCategory(
    sp: any, name: string | undefined, fallbackId: string | null | undefined,
    cache: Map<string, string>, apply: boolean,
): Promise<string | null> {
    const key = (name || '').trim() || 'Nhập từ KiotViet'
    if (cache.has(key)) return cache.get(key)!

    const found = await sp.category.findFirst({ where: { name: key }, select: { id: true } }).catch(() => null)
    if (found) { cache.set(key, found.id); return found.id }

    // Chưa có nhóm này: chạy thật thì tạo, chạy thử thì coi như sẽ tạo được
    if (!apply) return fallbackId || DRYRUN_CATEGORY

    const created = await sp.category.create({ data: { name: key, description: 'Đồng bộ từ KiotViet' } })
        .catch(() => null)
    if (created) { cache.set(key, created.id); return created.id }
    return fallbackId || null
}

/**
 * Lấy/tạo Thương hiệu theo `tradeMarkName` của KiotViet.
 *
 * KiotViet LƯỢC BỎ trường khi hàng không gắn thương hiệu, nên đừng kết luận
 * "API không trả" chỉ vì xem trúng vài mã trống. Product.brandId cho phép rỗng
 * nên không tìm thấy thì để trống — không phải lỗi.
 */
async function resolveBrand(
    sp: any, name: string | undefined, cache: Map<string, string | null>, apply: boolean,
): Promise<string | null> {
    const key = String(name || '').trim()
    if (!key) return null
    if (cache.has(key)) return cache.get(key)!

    const found = await sp.brand.findFirst({ where: { name: key }, select: { id: true } }).catch(() => null)
    if (found) { cache.set(key, found.id); return found.id }

    if (!apply) { cache.set(key, null); return null }   // chạy thử không tạo thật
    const created = await sp.brand.create({ data: { name: key, description: 'Đồng bộ từ KiotViet' } })
        .catch(() => null)
    cache.set(key, created?.id || null)
    return created?.id || null
}

// ─── HÀNG HOÁ ───────────────────────────────────────────────────────────────

/**
 * KiotViet `code` chính là SKU nghiệp vụ → ánh xạ thẳng sang Product.sku.
 * Thứ tự dò: bảng map (chắc nhất) → sku → barcode. Không tìm thấy thì tạo mới.
 */
export async function syncProducts(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    const catCache = new Map<string, string>()
    const brandCache = new Map<string, string | null>()

    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            const name = String(kv?.name || '').trim()
            if (!kvId || !code || !name) { c.skipped++; continue }

            // Dịch vụ / combo của KiotViet: productType 1=combo, 2=hàng thường, 3=dịch vụ
            const productType = Number(kv?.productType) === 3 ? 'service' : 'goods'

            let localId = await findMap(sp, 'product', kvId)
            let existing = localId
                ? await sp.product.findUnique({ where: { id: localId } }).catch(() => null)
                : null
            if (!existing) {
                existing = await sp.product.findUnique({ where: { sku: code } }).catch(() => null)
            }
            if (!existing && kv?.barCode) {
                existing = await sp.product.findFirst({ where: { barcode: String(kv.barCode) } }).catch(() => null)
            }

            // Tồn: cộng onHand của các chi nhánh được chọn (không chọn = cộng hết)
            const invs: any[] = Array.isArray(kv?.inventories) ? kv.inventories : []
            const picked = opts.branchIds?.length
                ? invs.filter(i => opts.branchIds!.includes(Number(i?.branchId)))
                : invs
            const onHand = Math.round(picked.reduce((s, i) => s + (Number(i?.onHand) || 0), 0))

            const price = Number(kv?.basePrice) || 0
            /**
             * GIÁ VỐN NẰM TRONG `inventories`, KHÔNG Ở CẤP SẢN PHẨM.
             *
             * Đo trên dữ liệu thật (HUTI 08/08/2026): `cost`/`costPrice` ở cấp
             * sản phẩm luôn null, còn `inventories[i].cost` mới có số thật
             * (NA105 → 3.720). Đọc sai chỗ nên mọi mặt hàng nhập vào đều giá
             * vốn 0 — hỏng luôn lãi gộp và giá trị tồn kho.
             *
             * Nhiều chi nhánh thì lấy giá vốn của chi nhánh có tồn (giá vốn
             * bình quân chỉ có nghĩa khi còn hàng); không chi nhánh nào có tồn
             * thì lấy giá vốn khác 0 đầu tiên.
             */
            const cost = (() => {
                const coTon = picked.find(i => (Number(i?.onHand) || 0) > 0 && (Number(i?.cost) || 0) > 0)
                if (coTon) return Number(coTon.cost)
                const batKy = picked.find(i => (Number(i?.cost) || 0) > 0)
                if (batKy) return Number(batKy.cost)
                return Number(kv?.cost ?? kv?.costPrice) || 0
            })()
            const brandName = String(kv?.tradeMarkName || '').trim()

            if (existing) {
                const data: any = {}
                if (opts.overwriteNames && name && name !== existing.name) data.name = name
                if (opts.overwritePrices) {
                    if (price > 0 && price !== existing.sellingPrice) data.sellingPrice = price
                    if (cost > 0 && cost !== existing.costPrice) data.costPrice = cost
                } else {
                    // Không ghi đè: chỉ ĐIỀN CHỖ TRỐNG
                    if (!existing.sellingPrice && price > 0) data.sellingPrice = price
                    if (!existing.costPrice && cost > 0) data.costPrice = cost
                }
                if (!existing.barcode && kv?.barCode) data.barcode = String(kv.barCode)
                // Thương hiệu: điền khi hàng bên Kengi đang trống. Không ghi đè
                // trừ khi người dùng bật, vì cửa hàng có thể đã tự gán khác.
                if (brandName && (!existing.brandId || opts.overwriteNames)) {
                    const bId = await resolveBrand(sp, brandName, brandCache, opts.apply)
                    if (bId && bId !== existing.brandId) data.brandId = bId
                }

                const stockChanged = opts.overwriteStock && onHand !== existing.stock

                if (!Object.keys(data).length && !stockChanged) {
                    c.skipped++
                    await saveMap(sp, 'product', kvId, code, existing.id)
                    continue
                }

                if (opts.apply) {
                    if (Object.keys(data).length) {
                        await sp.product.update({ where: { id: existing.id }, data })
                    }
                    if (stockChanged) {
                        await applyStock(sp, existing, onHand, opts, `KiotViet đồng bộ tồn (mã ${code})`)
                    }
                    await saveMap(sp, 'product', kvId, code, existing.id)
                }
                c.updated++
                noteSample(c, { sku: code, name, hanhDong: 'cập nhật', truong: Object.keys(data), tonCu: existing.stock, tonMoi: stockChanged ? onHand : existing.stock })
            } else {
                const categoryId = await resolveCategory(sp, kv?.categoryName, opts.defaultCategoryId, catCache, opts.apply)
                if (!categoryId) {
                    noteError(c, `Mã ${code}: chưa có nhóm hàng mặc định để gán`)
                    continue
                }

                const brandId = await resolveBrand(sp, brandName, brandCache, opts.apply)
                if (opts.apply) {
                    const created = await sp.product.create({
                        data: {
                            name,
                            sku: code,
                            barcode: kv?.barCode ? String(kv.barCode) : null,
                            categoryId,
                            brandId,
                            productType,
                            sellingPrice: price,
                            costPrice: cost,
                            stock: 0,          // đặt qua applyStock để giữ bất biến kho
                            baseUnit: String(kv?.unit || 'cái').slice(0, 50),
                            // Hàng NGỪNG KINH DOANH vẫn phải nhập: hoá đơn cũ
                            // tham chiếu tới nó, bỏ đi là mất dòng hàng. Kengi
                            // chưa có cờ ngừng bán nên ghi vào mô tả để nhìn ra.
                            description: [
                                kv?.isActive === false ? '[NGỪNG KINH DOANH bên KiotViet]' : '',
                                kv?.description ? String(kv.description) : '',
                            ].filter(Boolean).join(' ').slice(0, 1000) || null,
                        },
                    })
                    if (onHand > 0) {
                        await applyStock(sp, { ...created, stock: 0 }, onHand, opts, `KiotViet nhập tồn ban đầu (mã ${code})`)
                    }
                    await saveMap(sp, 'product', kvId, code, created.id)
                }
                c.created++
                noteSample(c, { sku: code, name, hanhDong: 'tạo mới', ton: onHand, gia: price, thuongHieu: brandName || '(không có)' })
            }
        } catch (e: any) {
            noteError(c, `Mã ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

/**
 * Đặt tồn cho một sản phẩm, GIỮ BẤT BIẾN Product.stock == tổng kho `main`.
 * Ghi cả WarehouseStock lẫn Product.stock trong một transaction, kèm thẻ kho.
 */
async function applyStock(sp: any, product: any, target: number, opts: SyncOptions, reason: string): Promise<void> {
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
                /**
                 * SỐ LƯỢNG CÓ DẤU — cả hệ thống quy ước vậy.
                 * Thẻ kho chia cột Nhập/Xuất theo DẤU của quantity (dương = nhập,
                 * âm = xuất), `runningBalance` và Tổng nhập/Tổng xuất cũng cộng
                 * theo dấu. Ghi Math.abs() thì dòng giảm tồn vẫn nhảy vào cột
                 * Nhập, tổng nhập phồng lên và tồn luỹ kế ra số âm vô nghĩa
                 * (đã thấy trên SHD4568 ngày 09/08/2026).
                 *
                 * `adjustment` là đúng bản chất: đây là điều chỉnh tồn cho khớp
                 * KiotViet, không phải nhập mua hay bán ra. Dùng đúng từ vựng
                 * của app ('in'/'out' không có trong các báo cáo lọc theo type).
                 */
                type: 'adjustment',
                productId: product.id,
                productName: product.name,
                productSku: product.sku,
                quantity: delta,
                reason,
                referenceType: 'kiotviet',
                userName: 'KiotViet Sync',
            },
        }).catch(() => { /* thẻ kho lỗi không được cuộn ngược cả tồn */ })
    })
}

// ─── KHÁCH HÀNG ─────────────────────────────────────────────────────────────

export async function syncCustomers(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            const name = String(kv?.name || '').trim()
            if (!kvId || !name) { c.skipped++; continue }

            const phone = firstPhone(kv?.contactNumber)

            let localId = await findMap(sp, 'customer', kvId)
            let existing = localId
                ? await sp.customer.findUnique({ where: { id: localId } }).catch(() => null)
                : null
            if (!existing && code) {
                existing = await sp.customer.findUnique({ where: { code } }).catch(() => null)
            }
            // Trùng số điện thoại = cùng một người → gộp, KHÔNG đẻ khách trùng
            if (!existing && phone) {
                existing = await sp.customer.findFirst({ where: { phone } }).catch(() => null)
            }

            // CÔNG NỢ lấy từ KiotViet — hệ thống đang là nguồn gốc dữ liệu.
            // Chỉ ĐIỀN khi bên Kengi đang là 0 (chưa ai đụng tới), hoặc khi
            // người dùng bật ghi đè giá/công nợ. Đè bừa là xoá mất khoản thu nợ
            // mà cửa hàng đã ghi trên Kengi.
            const kvDebt = Number(kv?.debt) || 0

            if (existing) {
                const data: any = {}
                if (opts.overwriteNames && name !== existing.name) data.name = name
                if (!existing.phone && phone) data.phone = phone
                if (!existing.address && kv?.address) data.address = String(kv.address).slice(0, 500)
                if (!existing.email && kv?.email) data.email = String(kv.email)
                if (kvDebt !== existing.debt && (!existing.debt || opts.overwritePrices)) data.debt = kvDebt

                if (!Object.keys(data).length) {
                    c.skipped++
                    if (opts.apply) await saveMap(sp, 'customer', kvId, code, existing.id)
                    continue
                }
                if (opts.apply) {
                    await sp.customer.update({ where: { id: existing.id }, data })
                    await saveMap(sp, 'customer', kvId, code, existing.id)
                }
                c.updated++
                noteSample(c, { code, name, hanhDong: 'cập nhật', truong: Object.keys(data) })
            } else {
                // code là @unique — thiếu thì tự sinh để không đụng bản ghi khác
                const finalCode = code || `KV${kvId}`
                if (opts.apply) {
                    const created = await sp.customer.create({
                        data: {
                            code: finalCode,
                            name,
                            phone,                       // Kengi bắt buộc có trường này (chuỗi rỗng vẫn hợp lệ)
                            email: kv?.email ? String(kv.email) : null,
                            address: kv?.address ? String(kv.address).slice(0, 500) : null,
                            gender: kv?.gender === true ? 'male' : kv?.gender === false ? 'female' : null,
                            debt: kvDebt,
                            notes: 'Đồng bộ từ KiotViet',
                        },
                    })
                    await saveMap(sp, 'customer', kvId, finalCode, created.id)
                }
                c.created++
                noteSample(c, { code: finalCode, name, phone, congNo: kvDebt, hanhDong: 'tạo mới' })
            }
        } catch (e: any) {
            noteError(c, `Khách ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

// ─── NHÀ CUNG CẤP ───────────────────────────────────────────────────────────

export async function syncSuppliers(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            const name = String(kv?.name || '').trim()
            if (!kvId || !name) { c.skipped++; continue }

            let localId = await findMap(sp, 'supplier', kvId)
            let existing = localId
                ? await sp.supplier.findUnique({ where: { id: localId } }).catch(() => null)
                : null
            if (!existing && code) {
                existing = await sp.supplier.findUnique({ where: { code } }).catch(() => null)
            }

            // CÔNG NỢ PHẢI TRẢ + tổng đã mua, lấy từ KiotViet (nguồn gốc dữ liệu).
            // Cùng quy tắc với công nợ khách: chỉ điền khi Kengi đang là 0, hoặc
            // khi người dùng bật ghi đè giá/công nợ.
            const kvPayable = Number(kv?.debt) || 0
            const kvBought = Number(kv?.totalInvoiced) || 0

            if (existing) {
                const data: any = {}
                if (opts.overwriteNames && name !== existing.name) data.name = name
                if (!existing.phone && firstPhone(kv?.contactNumber)) data.phone = firstPhone(kv.contactNumber)
                if (!existing.address && kv?.address) data.address = String(kv.address).slice(0, 500)
                if (!existing.taxCode && kv?.taxCode) data.taxCode = String(kv.taxCode)
                if (!existing.email && kv?.email) data.email = String(kv.email)
                if (kvPayable !== existing.payable && (!existing.payable || opts.overwritePrices)) data.payable = kvPayable
                if (kvBought && kvBought !== existing.totalValue && (!existing.totalValue || opts.overwritePrices)) data.totalValue = kvBought

                if (!Object.keys(data).length) {
                    c.skipped++
                    if (opts.apply) await saveMap(sp, 'supplier', kvId, code, existing.id)
                    continue
                }
                if (opts.apply) {
                    await sp.supplier.update({ where: { id: existing.id }, data })
                    await saveMap(sp, 'supplier', kvId, code, existing.id)
                }
                c.updated++
                noteSample(c, { code, name, hanhDong: 'cập nhật' })
            } else {
                const finalCode = code || `KVNCC${kvId}`
                if (opts.apply) {
                    const created = await sp.supplier.create({
                        data: {
                            code: finalCode, name,
                            phone: firstPhone(kv?.contactNumber) || null,
                            email: kv?.email ? String(kv.email) : null,
                            address: kv?.address ? String(kv.address).slice(0, 500) : null,
                            taxCode: kv?.taxCode ? String(kv.taxCode) : null,
                            payable: kvPayable,
                            totalValue: kvBought,
                            notes: 'Đồng bộ từ KiotViet',
                        },
                    })
                    await saveMap(sp, 'supplier', kvId, finalCode, created.id)
                }
                c.created++
                noteSample(c, { code: finalCode, name, phaiTra: kvPayable, daMua: kvBought, hanhDong: 'tạo mới' })
            }
        } catch (e: any) {
            noteError(c, `NCC ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

// ─── HOÁ ĐƠN BÁN ────────────────────────────────────────────────────────────

/**
 * KHÔNG TRỪ KHO (xem nguyên tắc 5 đầu file). Dòng hàng nào chưa có sản phẩm
 * tương ứng bên Kengi thì BỎ QUA DÒNG ĐÓ và ghi rõ trong lỗi — chứ không tự
 * đẻ sản phẩm ma từ hoá đơn.
 */
export async function syncInvoices(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    if (!opts.systemUserId) {
        noteError(c, 'Chưa xác định được người dùng hệ thống để gán cho hoá đơn — bỏ qua toàn bộ')
        return
    }
    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            if (!kvId || !code) { boQua(c, 'thiếu id hoặc mã hoá đơn'); continue }

            // CHỈ LẤY HOÁ ĐƠN HOÀN THÀNH.
            // Trạng thái đo trên dữ liệu thật (HUTI 06/08/2026):
            //   1 = "Hoàn thành" · 2 = "Đã hủy" · 3 = "Đang xử lý"
            // Bản trước tôi ghi 3 là huỷ → hoá đơn ĐÃ HUỶ (2) lọt vào sổ như
            // doanh thu thật, còn đơn đang xử lý bị gắn nhãn huỷ. Sai cả hai đầu.
            if (Number(kv?.status) !== 1) {
                // ĐÃ VÀO SỔ RỒI MÀ NAY BỊ HUỶ/QUAY LẠI XỬ LÝ → phải rút khỏi
                // doanh thu. Webhook `invoice.update` bắn đúng lúc này; bỏ qua
                // im lặng là để lại doanh thu ma trong sổ.
                const daCo = await sp.transaction.findUnique({
                    where: { receiptNumber: code }, select: { id: true, status: true },
                }).catch(() => null)
                if (daCo && daCo.status !== 'voided') {
                    if (opts.apply) {
                        await sp.transaction.update({ where: { id: daCo.id }, data: { status: 'voided' } })
                    }
                    c.updated++
                    noteSample(c, { code, hanhDong: 'huỷ khỏi sổ', trangThaiKiotViet: kv?.status })
                } else {
                    boQua(c, `HĐ ${code}: trạng thái ${kv?.status} (chỉ nhận hoàn thành = 1)`)
                }
                continue
            }

            const kvPayments: any[] = Array.isArray(kv?.payments) ? kv.payments : []
            // Ghi mã phiếu thu vào bộ nhớ lượt chạy TRƯỚC khi kiểm hoá đơn đã
            // tồn tại. Hoá đơn cũ vẫn `continue` ở dưới, nhưng phiếu thu của nó
            // thì bước sổ quỹ vẫn phải biết mà tránh — nếu không, đổ lại sổ quỹ
            // trên nền hoá đơn đã có sẽ nhân đôi tiền y như cũ.
            for (const p of kvPayments) {
                if (p?.code) opts.invoicePaymentCodes?.add(String(p.code))
            }

            const existing = await sp.transaction.findUnique({ where: { receiptNumber: code } }).catch(() => null)
            if (existing) {
                if (opts.apply) {
                    await saveMap(sp, 'invoice', kvId, code, existing.id)
                    // Hoá đơn nhập bằng bản cũ chưa có bản đồ phiếu thu — vá lại
                    for (const p of kvPayments) {
                        if (p?.code) await saveMap(sp, 'invoicePayment', String(p.code), String(p.code), existing.id)
                    }
                }

                /**
                 * HOÁ ĐƠN ĐÃ CÓ VẪN PHẢI CẬP NHẬT.
                 * `invoice.update` nghĩa là hoá đơn THAY ĐỔI — thường là vừa
                 * thu thêm tiền. Bản trước chỉ biết TẠO MỚI, gặp hoá đơn đã có
                 * là bỏ qua, nên webhook về đều đặn mà sổ không nhúc nhích.
                 */
                const thuMoi = kvPayments
                    .filter((p: any) => Number(p?.status) !== 1)
                    .reduce((s: number, p: any) => s + (Number(p?.amount) || 0), 0)
                const data: any = {}
                if (thuMoi > 0 && thuMoi !== existing.amountReceived) {
                    data.amountReceived = thuMoi
                    data.status = thuMoi >= existing.total ? 'completed' : 'partial'
                    data.change = thuMoi > existing.total ? thuMoi - existing.total : 0
                }
                if (existing.status === 'voided') data.status = 'completed'   // huỷ rồi mở lại

                if (!Object.keys(data).length) {
                    boQua(c, `HĐ ${code}: đã có trong sổ và không có gì đổi`)
                    continue
                }
                if (opts.apply) {
                    await sp.transaction.update({ where: { id: existing.id }, data })
                    if (kvPayments.length) {
                        // Ghi lại phiếu thu cho khớp, tránh chồng bản ghi cũ
                        await sp.payment.deleteMany({ where: { transactionId: existing.id } }).catch(() => { })
                        await sp.payment.createMany({
                            data: kvPayments
                                .filter((p: any) => Number(p?.status) !== 1 && (Number(p?.amount) || 0) > 0)
                                .map((p: any) => ({
                                    transactionId: existing.id,
                                    type: /transfer|bank/i.test(String(p?.method || '')) ? 'bank_transfer' : 'cash',
                                    amount: Number(p.amount) || 0,
                                    reference: p?.code ? String(p.code) : null,
                                })),
                        }).catch(() => { })
                    }
                }
                c.updated++
                noteSample(c, { code, hanhDong: 'cập nhật thanh toán', daThu: thuMoi, truong: Object.keys(data) })
                continue
            }

            const details: any[] = Array.isArray(kv?.invoiceDetails) ? kv.invoiceDetails : []
            const lines: any[] = []
            const missing: string[] = []
            for (const d of details) {
                const sku = String(d?.productCode || '').trim()
                if (!sku) continue
                const p = await sp.product.findUnique({
                    where: { sku }, select: { id: true, name: true, sku: true },
                }).catch(() => null)
                if (!p) { missing.push(sku); continue }
                const qty = Math.round(Number(d?.quantity) || 0)
                const unitPrice = Number(d?.price) || 0
                const disc = Number(d?.discount) || 0
                lines.push({
                    productId: p.id, productName: p.name, sku: p.sku,
                    quantity: qty, unitPrice, discount: disc,
                    lineTotal: Number(d?.subTotal ?? (qty * unitPrice - disc)) || 0,
                })
            }
            // CHẠY THỬ: hàng hoá chưa được tạo (chạy thử không ghi gì) nên mọi
            // dòng đều "không tìm thấy". Báo lỗi ở đây là báo oan — chạy thật
            // đồng bộ hàng hoá trước thì có đủ (dính 06/08/2026: 24462 lỗi ảo).
            if (!opts.apply) {
                if (missing.length && c.errors.length < 3) {
                    c.errors.push(`Chạy thử: ${missing.length} mã hàng của HĐ ${code} chưa có bên Kengi — chạy thật sẽ có sau khi đồng bộ hàng hoá`)
                }
                c.created++
                noteSample(c, { code, tong: Number(kv?.total) || 0, soDong: details.length, hanhDong: 'sẽ tạo' })
                continue
            }
            if (missing.length) {
                noteError(c, `HĐ ${code}: ${missing.length} mã hàng chưa có bên Kengi (${missing.slice(0, 3).join(', ')}) — đồng bộ hàng hoá trước`)
            }
            if (!lines.length) {
                boQua(c, `HĐ ${code}: không dựng được dòng hàng nào` +
                    `${details.length ? ` (${details.length} dòng nhưng không khớp mã bên Kengi)` : ' — payload không có invoiceDetails'}`)
                continue
            }

            // Khách: chỉ GẮN nếu đã có, không tự đẻ khách từ hoá đơn
            let customerId: string | null = null
            if (kv?.customerId) customerId = await findMap(sp, 'customer', kv.customerId)

            /**
             * ĐÃ THU HAY CHƯA THU LÀ VIỆC CỦA PHIẾU THU, KHÔNG SUY DIỄN.
             *
             * Bản trước ở đây có quy tắc "khách không còn nợ thì hoá đơn coi
             * như đã thu đủ" — dựng lên để chặn 82 khách nợ ảo hồi 07/08/2026.
             * Nó SAI và đã gây hậu quả ngược (đo 10/08/2026):
             *
             *   KiotViet HD030321 — Duy Khương: total 14.332.320,
             *   totalPayment = 0, KHÔNG có phiếu thu nào, khách đang nợ
             *   89.751.811. Vậy mà Kengi ghi amountReceived = total,
             *   status 'completed', không có dòng Payment nào → sổ quỹ thấy
             *   "đơn hoàn thành mà không có phiếu thu" liền coi là đã thu đủ
             *   và cộng 14.332.320 vào TIỀN VÀO. Tiền chưa hề về.
             *
             * `khachConNo` còn hỏng thêm một nước: khách chưa map thì
             * customerId = null → mặc định coi như KHÔNG nợ → mọi hoá đơn của
             * khách lạ đều thành "đã thu".
             *
             * Còn lý do dựng nó lên thì nay không còn: /debts/summary đã đọc
             * thẳng `Customer.debt` (số KiotViet đồng bộ sang), chứ không suy
             * người nợ từ hoá đơn chưa thu nữa; lịch sử công nợ cũng neo dòng
             * cuối vào `Customer.debt` bằng dòng dư đầu kỳ. Nên để hoá đơn
             * 'partial' KHÔNG đẻ ra khách nợ ảo.
             *
             * Từ đây: có phiếu thu bao nhiêu ghi bấy nhiêu.
             */
            const total = Number(kv?.total) || 0
            const when = kv?.purchaseDate ? new Date(kv.purchaseDate) : new Date()

            /**
             * THANH TOÁN LÀ PHIẾU THU, KHÔNG PHẢI MỘT CON SỐ.
             *
             * `payments[]` của hoá đơn chính là các phiếu thu — mã dạng
             * `TTHD016712` (gắn hoá đơn) hoặc `TT011815` (thu chung). CHÍNH
             * NHỮNG MÃ ẤY CŨNG NẰM TRONG /cashflow. Bản trước tôi vừa đặt
             * amountReceived trên hoá đơn vừa tạo phiếu thu riêng từ sổ quỹ →
             * cùng một khoản tiền vào sổ HAI LẦN (đo 07/08/2026).
             *
             * Nay: phiếu thu của hoá đơn thành Payment gắn vào hoá đơn, và mã
             * của chúng được ghi vào bảng map để bước sổ quỹ BỎ QUA.
             */
            const paymentRows = kvPayments
                .filter(p => Number(p?.status) !== 1)          // bỏ phiếu đã huỷ
                .map(p => ({
                    type: /transfer|bank/i.test(String(p?.method || '')) ? 'bank_transfer' : 'cash',
                    amount: Number(p?.amount) || 0,
                    reference: p?.code ? String(p.code) : null,
                }))
                .filter(p => p.amount > 0)
            // Không có phiếu thu nào thì hoá đơn CHƯA thu tiền — dù KiotViet có
            // điền totalPayment, vì tiền thật nằm ở phiếu thu.
            const paid = paymentRows.reduce((s, p) => s + p.amount, 0)
            // Có phiếu thu bao nhiêu ghi bấy nhiêu — xem khối ghi chú ở trên
            const thuDu = paid >= total
            const amountReceived = paid

            if (opts.apply) {
                const created = await sp.transaction.create({
                    data: {
                        receiptNumber: code,
                        customerId,
                        customerName: kv?.customerName ? String(kv.customerName) : null,
                        subtotal: lines.reduce((s, l) => s + l.lineTotal, 0),
                        discount: Number(kv?.discount) || 0,
                        total,
                        amountReceived,
                        // Khách đưa dư (một lần trả cho nhiều hoá đơn) thì phần
                        // dư là tiền thối, không phải doanh thu
                        change: amountReceived > total ? amountReceived - total : 0,
                        // CHƯA THU ĐỦ = 'partial'. Kengi suy công nợ ra từ đơn
                        // 'partial' (total − amountReceived); nhập tất cả thành
                        // 'completed' là báo cáo công nợ ra 0 trong khi khách
                        // vẫn đang nợ thật (đo 07/08/2026: 14/40 khách có nợ).
                        status: thuDu ? 'completed' : 'partial',
                        createdBy: opts.systemUserId,
                        createdByName: 'KiotViet Sync',
                        notes: `Nhập từ KiotViet (mã ${code})`,
                        transactionDate: isNaN(when.getTime()) ? new Date() : when,
                        // NGÀY CHỨNG TỪ, KHÔNG PHẢI NGÀY ĐỒNG BỘ. Báo cáo doanh
                        // thu lọc theo `createdAt` chứ không phải transactionDate,
                        // để mặc định now() là 24 nghìn hoá đơn cũ dồn hết vào
                        // "hôm nay" (dính 06/08/2026).
                        createdAt: isNaN(when.getTime()) ? new Date() : when,
                        channel: 'direct',
                        items: { create: lines },
                        ...(paymentRows.length ? { payments: { create: paymentRows } } : {}),
                    },
                })
                await saveMap(sp, 'invoice', kvId, code, created.id)
                // Đánh dấu các mã phiếu thu đã tính vào hoá đơn, để bước sổ quỹ
                // không tạo lại chúng thành phiếu thu độc lập (tránh nhân đôi)
                for (const p of paymentRows) {
                    if (p.reference) await saveMap(sp, 'invoicePayment', p.reference, p.reference, created.id)
                }
            }
            c.created++
            noteSample(c, { code, total, daThu: paid, soDong: lines.length, hanhDong: 'tạo mới', ngay: when.toISOString().slice(0, 10) })
        } catch (e: any) {
            noteError(c, `HĐ ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

// ─── PHIẾU NHẬP HÀNG ────────────────────────────────────────────────────────

/**
 * "Nhập hàng" của KiotViet → PHIẾU NHẬP KHO (ImportReceipt) của Kengi.
 *
 * VÌ SAO KHÔNG PHẢI PurchaseOrder: Kengi tách hai module — `PurchaseOrder` là
 * ĐƠN ĐẶT hàng nhập (có cổng kiểm hàng draft→pending→checking→received), còn
 * `ImportReceipt` mới là PHIẾU NHẬP KHO đã hoàn tất (có giá vốn, công nợ NCC,
 * hoá đơn VAT). `/purchaseorders` của KiotViet là chứng từ hàng ĐÃ VỀ, nên
 * thuộc về ImportReceipt. Bản trước đổ vào PurchaseOrder nên trang "Phiếu nhập
 * hàng" trống trơn dù đã nhập 758 phiếu (dính 09/08/2026).
 *
 * KHÔNG CỘNG KHO (cùng lý do với hoá đơn: `onHand` bên KiotViet đã tính rồi,
 * cộng thêm lần nữa là tồn khống gấp đôi).
 */
export async function syncPurchaseOrders(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            if (!kvId || !code) { c.skipped++; continue }

            const existing = await sp.importReceipt.findUnique({ where: { code } }).catch(() => null)
            if (existing) {
                c.skipped++
                if (opts.apply) await saveMap(sp, 'purchaseOrder', kvId, code, existing.id)
                continue
            }

            // CHỈ LẤY PHIẾU NHẬP HOÀN THÀNH.
            // Phiếu đã xoá vẫn được KiotViet trả về, gắn hậu tố {DEL} vào mã;
            // 10/10 phiếu {DEL} đều status 4 (đo HUTI 06/08/2026). Status 3 là
            // nhóm phiếu bình thường (60/60). Chỉ nhận 3, bỏ hết phần còn lại —
            // nuốt phiếu huỷ vào là thổi phồng lịch sử mua hàng.
            if (/\{DEL\}/i.test(code) || Number(kv?.status) !== 3) { c.skipped++; continue }

            // NHÀ CUNG CẤP: KiotViet LƯỢC BỎ trường khi phiếu không gắn NCC, nên
            // có phiếu thấy supplierName/supplierCode, có phiếu không. Đừng kết
            // luận "API không trả NCC" chỉ vì xem trúng một phiếu cũ không gắn.
            // (`purchaseName` là NGƯỜI TẠO PHIẾU — không phải nhà cung cấp.)
            let supplierId: string | null = null
            if (kv?.supplierId) supplierId = await findMap(sp, 'supplier', kv.supplierId)
            const supplierName = String(
                kv?.supplierName || kv?.supplierCode || 'Không rõ (phiếu không gắn NCC)'
            ).slice(0, 200)

            // ImportReceiptItem.productId là KHOÁ NGOẠI BẮT BUỘC → chỉ dựng được
            // dòng cho mã đã có bên Kengi. Thiếu mã thì ghi rõ, không đẻ SP ma.
            const details: any[] = Array.isArray(kv?.purchaseOrderDetails) ? kv.purchaseOrderDetails
                : Array.isArray(kv?.details) ? kv.details : []
            const lines: any[] = []
            const missing: string[] = []
            for (const d of details) {
                const sku = String(d?.productCode || '').trim()
                const qty = Math.round(Number(d?.quantity) || 0)
                const gia = Number(d?.price) || 0
                const p = sku
                    ? await sp.product.findUnique({ where: { sku }, select: { id: true, name: true, sku: true } }).catch(() => null)
                    : null
                if (!p) { if (sku) missing.push(sku); continue }
                lines.push({
                    productId: p.id,
                    productName: p.name,
                    productSku: p.sku,
                    quantity: qty,
                    costPrice: gia,
                    discount: Number(d?.discount) || 0,
                    total: Number(d?.subTotal ?? (qty * gia)) || 0,
                })
            }
            if (missing.length) {
                noteError(c, `Phiếu nhập ${code}: ${missing.length} mã hàng chưa có bên Kengi (${missing.slice(0, 3).join(', ')}) — đồng bộ Hàng hoá trước`)
            }

            const total = Number(kv?.total) || 0
            const daTra = Number(kv?.totalPayment) || 0
            const when = kv?.purchaseDate ? new Date(kv.purchaseDate) : null
            const ngay = when && !isNaN(when.getTime()) ? when : new Date()

            if (opts.apply) {
                const created = await sp.importReceipt.create({
                    data: {
                        code, supplierId, supplierName,
                        totalCost: total,
                        totalItems: lines.reduce((s, l) => s + l.quantity, 0),
                        status: 'completed',          // KiotViet status 3 = đã hoàn tất
                        // Công nợ NCC suy từ số đã trả — mặc định của model là
                        // 'paid', để nguyên là mọi phiếu nợ đều biến mất khỏi báo cáo
                        paidAmount: daTra,
                        paymentStatus: daTra >= total ? 'paid' : daTra > 0 ? 'partial' : 'unpaid',
                        note: 'Nhập từ KiotViet',
                        userId: opts.systemUserId || '',
                        userName: 'KiotViet Sync',
                        transactionDate: ngay,
                        createdAt: ngay,              // ngày chứng từ gốc
                        ...(lines.length ? { items: { create: lines } } : {}),
                    },
                })
                await saveMap(sp, 'purchaseOrder', kvId, code, created.id)
            }
            c.created++
            noteSample(c, { code, ncc: supplierName, tong: total, daTra, soDong: lines.length, ngay: ngay.toISOString().slice(0, 10) })
        } catch (e: any) {
            noteError(c, `Phiếu nhập ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

// ─── TRẢ HÀNG BÁN (khách trả lại) ───────────────────────────────────────────

/**
 * KiotViet `/returns` → ReturnOrder + ReturnItem của Kengi.
 *
 * KHÔNG CỘNG KHO (`restocked: false`): tồn lấy từ `onHand` của KiotViet vốn đã
 * tính hàng trả về rồi. Chỉ lấy phiếu ĐÃ TRẢ XONG (status 1 = "Đã trả", đo trên
 * dữ liệu thật HUTI 06/08/2026).
 *
 * TRẢ HÀNG MUA (trả lại nhà cung cấp) KHÔNG CÓ trong Public API của KiotViet —
 * đã thử /purchaseReturns, /returnsupplier, /purchasereturns, /returnSuppliers,
 * /supplierreturns đều lỗi, và danh sách phiếu nhập chỉ có tiền tố PN (không có
 * phiếu trả trộn vào). Không dựng được thì nói thẳng, không bịa.
 */
export async function syncReturns(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            if (!kvId || !code) { c.skipped++; continue }
            // Chỉ nhận phiếu đã trả xong
            if (Number(kv?.status) !== 1) { c.skipped++; continue }

            const existing = await sp.returnOrder.findUnique({ where: { code } }).catch(() => null)
            if (existing) {
                c.skipped++
                if (opts.apply) await saveMap(sp, 'return', kvId, code, existing.id)
                continue
            }

            // Gắn về hoá đơn gốc nếu hoá đơn đó đã được đồng bộ
            let transactionId: string | null = null
            let originalInvoice = kv?.invoiceId ? `KV#${kv.invoiceId}` : code
            if (kv?.invoiceId) {
                transactionId = await findMap(sp, 'invoice', kv.invoiceId)
                if (transactionId) {
                    const tx = await sp.transaction.findUnique({
                        where: { id: transactionId }, select: { receiptNumber: true },
                    }).catch(() => null)
                    if (tx?.receiptNumber) originalInvoice = tx.receiptNumber
                }
            }

            const details: any[] = Array.isArray(kv?.returnDetails) ? kv.returnDetails : []
            const lines: any[] = []
            for (const d of details) {
                const sku = String(d?.productCode || '').trim()
                // productId của ReturnItem cho phép rỗng → thiếu hàng vẫn giữ được dòng
                const p = sku
                    ? await sp.product.findUnique({ where: { sku }, select: { id: true } }).catch(() => null)
                    : null
                lines.push({
                    productId: p?.id || null,
                    productName: String(d?.productName || sku || 'Hàng trả').slice(0, 200),
                    sku: sku || null,
                    quantity: Math.round(Number(d?.quantity) || 0),
                    unitPrice: Number(d?.price ?? d?.sellPrice) || 0,
                    restocked: false,   // kho đã phản ánh bên KiotViet, xem ghi chú trên
                })
            }
            if (!lines.length) { c.skipped++; continue }

            const when = kv?.returnDate ? new Date(kv.returnDate) : new Date()
            const date = isNaN(when.getTime()) ? new Date() : when
            const total = Number(kv?.returnTotal) || 0

            if (opts.apply) {
                const created = await sp.returnOrder.create({
                    data: {
                        code,
                        originalInvoice,
                        transactionId,
                        customerName: String(kv?.customerName || 'Khách lẻ').slice(0, 200),
                        status: 'refunded',            // đã trả xong bên KiotViet
                        reason: 'Nhập từ KiotViet',
                        refundAmount: Number(kv?.totalPayment) || total,
                        totalRefund: total,
                        notes: `Phí trả hàng: ${Number(kv?.returnFee) || 0}`,
                        processedAt: date,
                        refundedAt: date,
                        createdAt: date,               // ngày chứng từ gốc
                        items: { create: lines },
                    },
                })
                await saveMap(sp, 'return', kvId, code, created.id)
            }
            c.created++
            noteSample(c, { code, khach: kv?.customerName, tien: total, soDong: lines.length, ngay: date.toISOString().slice(0, 10) })
        } catch (e: any) {
            noteError(c, `Trả hàng ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

// ─── SỔ QUỸ: PHIẾU THU / PHIẾU CHI ──────────────────────────────────────────

/**
 * Một bản ghi sổ quỹ KiotViet ra PHIẾU THU (CashReceipt) hoặc PHIẾU CHI
 * (Expense) tuỳ chiều tiền.
 *
 * Tài liệu công khai không mô tả rõ trường nào chỉ chiều, nên dò theo nhiều dấu
 * hiệu và KHÔNG ĐOÁN BỪA: không suy được chiều thì BỎ QUA. Ghi nhầm chiều tiền
 * còn tệ hơn không ghi vì nó lặng lẽ làm lệch sổ quỹ.
 *
 * Phiếu chi vào trạng thái 'pending' (chờ duyệt) — giống phiếu bóc từ email —
 * để tiền chỉ vào sổ sau khi người dùng soát.
 */
export async function syncCashflow(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            const amount = Math.abs(Number(kv?.amount) || 0)
            if (!kvId || !code || !amount) { c.skipped++; continue }

            // TRẠNG THÁI — đo trên dữ liệu thật của HUTI (06/08/2026):
            //   status 0 = "Đã thanh toán"  ← HỢP LỆ
            //   status 1 = "Đã hủy"          ← bỏ
            // Bản đầu tôi làm NGƯỢC (loại status 0), nên loại sạch 515/523 phiếu
            // hợp lệ và chỉ nhận đúng mấy phiếu đã huỷ. Đừng đảo lại lần nữa.
            if (Number(kv?.status) === 1 || /hủy|huỷ|cancel|void/i.test(String(kv?.statusValue || ''))) { c.skipped++; continue }

            const dir = cashflowDirection(kv)
            if (!dir) {
                noteError(c, `Sổ quỹ ${code}: không xác định được thu hay chi — bỏ qua để khỏi lệch sổ`)
                continue
            }

            // PHIẾU THU CỦA HOÁ ĐƠN ĐÃ TÍNH RỒI — bỏ qua, nếu không cùng một
            // khoản tiền vào sổ hai lần (xem ghi chú trong syncInvoices).
            if (dir === 'in' && (opts.invoicePaymentCodes?.has(code) || await findMap(sp, 'invoicePayment', code))) {
                c.skipped++; continue
            }

            const entity = dir === 'in' ? 'cashReceipt' : 'expense'
            const mapped = await findMap(sp, entity, kvId)
            if (mapped) { c.skipped++; continue }

            const when = kv?.transDate ? new Date(kv.transDate) : new Date()
            const date = isNaN(when.getTime()) ? new Date() : when
            // Tên đối tác nằm ở partnerName (đã đo trên dữ liệu thật)
            const partner = String(kv?.partnerName || kv?.contactName || '').trim()
            const note = [String(kv?.cashGroup || 'Sổ quỹ KiotViet'), partner].filter(Boolean).join(' — ').slice(0, 300)
            const viaBank = /transfer|bank|chuy/i.test(String(kv?.method || ''))

            /**
             * KHÁCH TRẢ NỢ → DebtEntry, KHÔNG PHẢI CashReceipt.
             *
             * Kengi ghi việc thu nợ vào sổ công nợ (DebtEntry type='payment') —
             * đó là thứ trang "Lịch sử công nợ" đọc. Bản trước tôi đổ hết phiếu
             * thu vào CashReceipt nên tiền có trong sổ quỹ nhưng lịch sử công nợ
             * TRỐNG TRƠN, khách nợ bao nhiêu cũng không thấy đã trả lần nào
             * (dính 07/08/2026).
             *
             * KHÔNG đụng Customer.debt: số dư đã lấy thẳng từ KiotViet và đã đối
             * chiếu khớp từng đồng. Cộng trừ thêm ở đây là làm lệch trở lại.
             * `balance` để 0 vì trang tự tính lại luỹ kế khi hiển thị.
             */
            const laKhachTraNo = dir === 'in'
                && String(kv?.partnerType || '').toUpperCase() === 'C'
                && kv?.partnerId
            if (laKhachTraNo) {
                const localCus = await findMap(sp, 'customer', kv.partnerId)
                if (localCus) {
                    if (await findMap(sp, 'debtPayment', code)) { c.skipped++; continue }
                    if (opts.apply) {
                        const cus = await sp.customer.findUnique({
                            where: { id: localCus }, select: { name: true, phone: true },
                        }).catch(() => null)
                        const created = await sp.debtEntry.create({
                            data: {
                                customerId: localCus,
                                customerName: cus?.name || partner || 'Khách hàng',
                                phone: cus?.phone || null,
                                type: 'payment',
                                amount,
                                description: `Trả nợ — phiếu thu ${code} (KiotViet)`,
                                balance: 0,
                                createdAt: date,
                            },
                        })
                        await saveMap(sp, 'debtPayment', code, code, created.id)
                    }
                    c.created++
                    noteSample(c, { code, chieu: 'THU NỢ', soTien: amount, khach: partner, ngay: date.toISOString().slice(0, 10) })
                    continue
                }
            }

            if (dir === 'in') {
                const dup = await sp.cashReceipt.findFirst({ where: { reference: code } }).catch(() => null)
                if (dup) { c.skipped++; if (opts.apply) await saveMap(sp, entity, kvId, code, dup.id); continue }
                if (opts.apply) {
                    const created = await sp.cashReceipt.create({
                        data: {
                            description: note, amount, category: 'other', date,
                            receivedVia: viaBank ? 'Chuyển khoản' : 'Tiền mặt',
                            customerName: partner ? partner.slice(0, 200) : null,
                            reference: code, status: 'active',
                            createdAt: date,   // ngày chứng từ gốc
                        },
                    })
                    await saveMap(sp, entity, kvId, code, created.id)
                }
            } else {
                const dup = await sp.expense.findFirst({ where: { sourceRef: `KV|${code}` } }).catch(() => null)
                if (dup) { c.skipped++; if (opts.apply) await saveMap(sp, entity, kvId, code, dup.id); continue }
                if (opts.apply) {
                    const created = await sp.expense.create({
                        data: {
                            description: note, amount, category: 'Sổ quỹ KiotViet', date,
                            status: 'pending',        // CHỜ DUYỆT — chưa vào thống kê
                            supplierName: partner ? partner.slice(0, 200) : null,
                            sourceRef: `KV|${code}`,
                            createdAt: date,   // ngày chứng từ gốc
                        },
                    })
                    await saveMap(sp, entity, kvId, code, created.id)
                }
            }
            c.created++
            noteSample(c, { code, chieu: dir === 'in' ? 'THU' : 'CHI', soTien: amount, ngay: date.toISOString().slice(0, 10) })
        } catch (e: any) {
            noteError(c, `Sổ quỹ ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

/**
 * Dò chiều tiền của bản ghi sổ quỹ. Không chắc thì trả null (xem ghi chú trên).
 *
 * CHỐT TỪ DỮ LIỆU THẬT (HUTI, 06/08/2026 — không phải suy diễn từ tài liệu):
 *   THU: code TT…/TTHD… · cashGroup "Tiền khách trả" · origin "Pay"      ·
 *        partnerType "C" · amount DƯƠNG
 *   CHI: code PC…        · cashGroup "Tiền trả NCC"   · origin "Purchase" ·
 *        partnerType "S" · amount ÂM
 * Năm dấu hiệu này đi cùng nhau; xét lần lượt để một trường đổi tên bên KiotViet
 * không làm câm cả bộ.
 */
function cashflowDirection(kv: any): 'in' | 'out' | null {
    // 1. Nhóm sổ quỹ — chuỗi người đọc được, rõ nghĩa nhất
    const g = String(kv?.cashGroup || '').toLowerCase()
    if (/trả ncc|tra ncc|chi/.test(g)) return 'out'
    if (/khách trả|khach tra|thu/.test(g)) return 'in'

    // 2. Nguồn phát sinh
    const o = String(kv?.origin || '').toLowerCase()
    if (o === 'purchase') return 'out'
    if (o === 'pay') return 'in'

    // 3. Tiền tố mã phiếu
    const code = String(kv?.code || '').toUpperCase()
    if (/^(PC|CT|TC)/.test(code)) return 'out'
    if (/^TT/.test(code)) return 'in'

    // 4. Đối tác: S = nhà cung cấp (chi), C = khách hàng (thu)
    const p = String(kv?.partnerType || '').toUpperCase()
    if (p === 'S') return 'out'
    if (p === 'C') return 'in'

    // 5. Dấu của số tiền
    const raw = Number(kv?.amount)
    if (Number.isFinite(raw) && raw !== 0) return raw > 0 ? 'in' : 'out'

    return null
}

// ─── WEBHOOK ────────────────────────────────────────────────────────────────

/**
 * Chuẩn hoá payload webhook. KiotViet gửi khoá VIẾT HOA (`Notifications`,
 * `Action`, `Data`) nhưng tài liệu công khai không cam kết — nhận cả hai kiểu
 * để một lần đổi chữ hoa/thường bên họ không làm câm cả cổng nhận.
 */
export function parseWebhookPayload(body: any): { action: string; data: any[] }[] {
    const notis = body?.Notifications || body?.notifications
    if (!Array.isArray(notis)) return []
    return notis.map((n: any) => ({
        action: String(n?.Action || n?.action || '').toLowerCase(),
        data: Array.isArray(n?.Data || n?.data) ? (n.Data || n.data).map(chuanHoaKhoa) : [],
    })).filter(n => n.action)
}

/**
 * ĐƯA TÊN TRƯỜNG WEBHOOK VỀ CÙNG DẠNG VỚI REST API.
 *
 * KiotViet dùng HAI kiểu đặt tên tuỳ sự kiện (đo trên payload thật 08/08/2026):
 *   customer.update → PascalCase: Id, Code, Name, ContactNumber, TaxCode…
 *   stock.update    → PascalCase: ProductId, ProductCode, OnHand…
 *   invoice.update  → camelCase : id, code, purchaseDate, invoiceDetails…
 *
 * Các hàm đồng bộ viết theo REST API (camelCase), nên payload PascalCase vào là
 * mọi trường đều `undefined` → bản ghi bị bỏ qua lặng lẽ. Webhook khách hàng vì
 * vậy CHƯA BAO GIỜ chạy được. Hạ chữ đầu của mọi khoá là xong, và làm luôn cho
 * cả cấp con để phòng khi họ đổi thêm chỗ khác.
 */
function chuanHoaKhoa(v: any): any {
    if (Array.isArray(v)) return v.map(chuanHoaKhoa)
    if (!v || typeof v !== 'object' || v instanceof Date) return v
    const out: any = {}
    for (const [k, val] of Object.entries(v)) {
        if (k.startsWith('__')) continue          // __type: rác của .NET, bỏ
        const key = k.charAt(0).toLowerCase() + k.slice(1)
        // Giữ cả khoá gốc nếu đụng nhau, ưu tiên khoá đã chuẩn hoá
        out[key] = chuanHoaKhoa(val)
    }
    return out
}

/**
 * Kiểm chữ ký webhook.
 *
 * Tài liệu công khai của KiotViet KHÔNG mô tả công thức ký (đã tra 05/08/2026);
 * nguồn cộng đồng nói `x-signature` = HMAC-SHA256 của (data + timestamp +
 * retailerCode + secretKey) nhưng không rõ đâu là KHOÁ đâu là THÔNG ĐIỆP.
 * Nên ở đây thử vài biến thể hợp lý; khớp một cái là đạt.
 *
 * LỚP BẢO VỆ CHÍNH KHÔNG PHẢI CHỮ KÝ mà là TOKEN BÍ MẬT TRONG URL (32 byte
 * ngẫu nhiên) — kẻ lạ không đoán được đường dẫn thì không gọi tới được. Chữ ký
 * là lớp thứ hai: chưa bật `strictSignature` thì sai chữ ký vẫn nhận nhưng ghi
 * cờ để soi lại; bật rồi thì từ chối thẳng.
 */
export function verifyWebhookSignature(
    rawBody: string, signature: string, timestamp: string, retailer: string, secret: string,
): boolean {
    if (!secret || !signature) return false
    const candidates = [
        // (thông điệp, khoá)
        [rawBody + timestamp + retailer, secret],
        [rawBody + timestamp + retailer + secret, secret],
        [rawBody, secret],
        [rawBody + timestamp, secret],
        [timestamp + rawBody, secret],
    ]
    const given = signature.trim().toLowerCase()
    for (const [msg, key] of candidates) {
        const hex = crypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex').toLowerCase()
        const b64 = crypto.createHmac('sha256', key).update(msg, 'utf8').digest('base64')
        if (given === hex || signature.trim() === b64) return true
    }
    return false
}
