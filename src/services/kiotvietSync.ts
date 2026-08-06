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

/** Lấy/ tạo Category theo tên KiotViet. Có bộ nhớ đệm trong một đợt đồng bộ. */
async function resolveCategory(
    sp: any, name: string | undefined, fallbackId: string | null | undefined,
    cache: Map<string, string>, apply: boolean,
): Promise<string | null> {
    const key = (name || '').trim()
    if (!key) return fallbackId || null
    if (cache.has(key)) return cache.get(key)!

    const found = await sp.category.findFirst({ where: { name: key }, select: { id: true } }).catch(() => null)
    if (found) { cache.set(key, found.id); return found.id }

    if (!apply) return fallbackId || null
    const created = await sp.category.create({ data: { name: key, description: 'Đồng bộ từ KiotViet' } })
        .catch(() => null)
    if (created) { cache.set(key, created.id); return created.id }
    return fallbackId || null
}

// ─── HÀNG HOÁ ───────────────────────────────────────────────────────────────

/**
 * KiotViet `code` chính là SKU nghiệp vụ → ánh xạ thẳng sang Product.sku.
 * Thứ tự dò: bảng map (chắc nhất) → sku → barcode. Không tìm thấy thì tạo mới.
 */
export async function syncProducts(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    const catCache = new Map<string, string>()

    for (const kv of items) {
        c.fetched++
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
            const cost = Number(kv?.cost ?? kv?.costPrice) || 0

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

                if (opts.apply) {
                    const created = await sp.product.create({
                        data: {
                            name,
                            sku: code,
                            barcode: kv?.barCode ? String(kv.barCode) : null,
                            categoryId,
                            productType,
                            sellingPrice: price,
                            costPrice: cost,
                            stock: 0,          // đặt qua applyStock để giữ bất biến kho
                            baseUnit: String(kv?.unit || 'cái').slice(0, 50),
                            description: kv?.description ? String(kv.description).slice(0, 1000) : null,
                        },
                    })
                    if (onHand > 0) {
                        await applyStock(sp, { ...created, stock: 0 }, onHand, opts, `KiotViet nhập tồn ban đầu (mã ${code})`)
                    }
                    await saveMap(sp, 'product', kvId, code, created.id)
                }
                c.created++
                noteSample(c, { sku: code, name, hanhDong: 'tạo mới', ton: onHand, gia: price })
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
                type: delta > 0 ? 'in' : 'out',
                productId: product.id,
                productName: product.name,
                productSku: product.sku,
                quantity: Math.abs(delta),
                reason: 'kiotviet_sync',
                note: reason,
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
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            const name = String(kv?.name || '').trim()
            if (!kvId || !name) { c.skipped++; continue }

            const phone = String(kv?.contactNumber || '').replace(/[^\d+]/g, '')

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

            if (existing) {
                const data: any = {}
                if (opts.overwriteNames && name !== existing.name) data.name = name
                if (!existing.phone && phone) data.phone = phone
                if (!existing.address && kv?.address) data.address = String(kv.address).slice(0, 500)
                if (!existing.email && kv?.email) data.email = String(kv.email)

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
                            notes: 'Đồng bộ từ KiotViet',
                        },
                    })
                    await saveMap(sp, 'customer', kvId, finalCode, created.id)
                }
                c.created++
                noteSample(c, { code: finalCode, name, phone, hanhDong: 'tạo mới' })
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

            if (existing) {
                const data: any = {}
                if (opts.overwriteNames && name !== existing.name) data.name = name
                if (!existing.phone && kv?.contactNumber) data.phone = String(kv.contactNumber)
                if (!existing.address && kv?.address) data.address = String(kv.address).slice(0, 500)
                if (!existing.taxCode && kv?.taxCode) data.taxCode = String(kv.taxCode)
                if (!existing.email && kv?.email) data.email = String(kv.email)

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
                            phone: kv?.contactNumber ? String(kv.contactNumber) : null,
                            email: kv?.email ? String(kv.email) : null,
                            address: kv?.address ? String(kv.address).slice(0, 500) : null,
                            taxCode: kv?.taxCode ? String(kv.taxCode) : null,
                            notes: 'Đồng bộ từ KiotViet',
                        },
                    })
                    await saveMap(sp, 'supplier', kvId, finalCode, created.id)
                }
                c.created++
                noteSample(c, { code: finalCode, name, hanhDong: 'tạo mới' })
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
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            if (!kvId || !code) { c.skipped++; continue }

            const existing = await sp.transaction.findUnique({ where: { receiptNumber: code } }).catch(() => null)
            if (existing) {
                c.skipped++
                if (opts.apply) await saveMap(sp, 'invoice', kvId, code, existing.id)
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
            if (missing.length) {
                noteError(c, `HĐ ${code}: ${missing.length} mã hàng chưa có bên Kengi (${missing.slice(0, 3).join(', ')}) — đồng bộ hàng hoá trước`)
            }
            if (!lines.length) { c.skipped++; continue }

            // Khách: chỉ GẮN nếu đã có, không tự đẻ khách từ hoá đơn
            let customerId: string | null = null
            if (kv?.customerId) customerId = await findMap(sp, 'customer', kv.customerId)

            const total = Number(kv?.total) || 0
            const paid = Number(kv?.totalPayment) || 0
            const when = kv?.purchaseDate ? new Date(kv.purchaseDate) : new Date()
            // status KiotViet: 1=hoàn thành, 2=đang xử lý, 3=đã huỷ, 5=đang giao
            const cancelled = Number(kv?.status) === 3

            if (opts.apply) {
                const created = await sp.transaction.create({
                    data: {
                        receiptNumber: code,
                        customerId,
                        customerName: kv?.customerName ? String(kv.customerName) : null,
                        subtotal: lines.reduce((s, l) => s + l.lineTotal, 0),
                        discount: Number(kv?.discount) || 0,
                        total,
                        amountReceived: paid,
                        change: 0,
                        status: cancelled ? 'cancelled' : 'completed',
                        createdBy: opts.systemUserId,
                        createdByName: 'KiotViet Sync',
                        notes: `Nhập từ KiotViet (mã ${code})`,
                        transactionDate: isNaN(when.getTime()) ? new Date() : when,
                        channel: 'direct',
                        items: { create: lines },
                    },
                })
                await saveMap(sp, 'invoice', kvId, code, created.id)
            }
            c.created++
            noteSample(c, { code, total, soDong: lines.length, hanhDong: 'tạo mới', ngay: when.toISOString().slice(0, 10) })
        } catch (e: any) {
            noteError(c, `HĐ ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
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
        data: Array.isArray(n?.Data || n?.data) ? (n.Data || n.data) : [],
    })).filter(n => n.action)
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
