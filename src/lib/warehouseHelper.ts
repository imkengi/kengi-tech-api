// Helpers for keeping per-warehouse stock (WarehouseStock) in sync with the
// product-level stock that the POS/inventory flows mutate. The "main" default
// warehouse mirrors Product.stock; specialised warehouses (damaged/warranty/
// mobile) are managed via stock transfers.

type AnyPrisma = any

// Find (or lazily create) the branch's default "main" warehouse. The lookup key
// (type + isDefault + branchId) matches the seeder in routes/warehouses.ts, so
// this returns the same record those routes manage rather than a duplicate.
export async function getOrCreateDefaultWarehouse(
    prisma: AnyPrisma,
    branchId: string | null | undefined,
    branchName?: string | null,
): Promise<any> {
    const where = { type: 'main', isDefault: true, branchId: branchId || null }

    const existing = await prisma.warehouse.findFirst({ where })
    if (existing) return existing

    // Resolve a human-readable name only when we actually need to create.
    let name = branchName || undefined
    if (!name && branchId) {
        const branch = await prisma.branch
            .findUnique({ where: { id: branchId }, select: { name: true } })
            .catch(() => null)
        name = branch?.name || undefined
    }

    const code = branchId ? `WH-MAIN-${branchId.slice(-6).toUpperCase()}` : 'WH-MAIN'

    try {
        return await prisma.warehouse.create({
            data: {
                code,
                name: name ? `Kho chính - ${name}` : 'Kho chính',
                type: 'main',
                description: 'Kho hàng hóa chính, đồng bộ với tồn kho sản phẩm',
                isDefault: true,
                isActive: true,
                branchId: branchId || null,
            },
        })
    } catch {
        // Unique-constraint race: another request seeded it first — re-fetch.
        return prisma.warehouse.findFirst({ where })
    }
}

// ─── Canonical sellable-stock mutation ──────────────────────────────────────
// BẤT BIẾN của hệ thống: WarehouseStock[kho main của chi nhánh] LUÔN bằng phần
// Product.stock bán được của chi nhánh đó. POS check tồn theo kho main, nên MỌI
// chỗ đổi Product.stock PHẢI mirror cùng delta sang kho main — nếu không, tồn
// lệch, POS bán khống hoặc không bán được hàng đã nhập.
//
// Dùng helper này thay cho `prisma.product.update({ data: { stock: {...} } })`
// ở mọi flow bán/nhập/trả/điều chỉnh/đơn sàn. Có thể gọi trong $transaction
// (truyền tx) hoặc ngoài (truyền prisma). `delta` dương = nhập, âm = xuất.
//
// KHÔNG dùng cho việc chuyển hàng sang kho damaged/warranty/xe — đó là "rời khỏi
// hàng bán được": gọi adjustSellableStock(-qty) rồi updateWarehouseStock(khoĐặcBiệt,+qty).
export async function adjustSellableStock(
    client: AnyPrisma,
    productId: string,
    branchId: string | null | undefined,
    delta: number,
): Promise<void> {
    if (!delta) return
    // 1) Product.stock (tồn tổng bán được)
    await client.product.update({
        where: { id: productId },
        data: { stock: { increment: delta } },
    })
    // 2) Mirror sang kho main của chi nhánh (best-effort — không chặn nghiệp vụ
    //    chính nếu bảng kho chưa migrate ở schema cũ)
    try {
        const wh = await getOrCreateDefaultWarehouse(client, branchId ?? null)
        if (wh?.id) await updateWarehouseStock(client, wh.id, productId, delta)
    } catch { /* schema chưa có bảng Warehouse — Product.stock vẫn đúng */ }
}

// Biến thể chống bán âm: chỉ trừ khi tồn đủ (updateMany có guard gte). Trả về
// true nếu trừ thành công, false nếu không đủ tồn (caller tự rollback/báo lỗi).
// delta PHẢI âm (số lượng xuất). allowNegative=true thì trừ thẳng không guard.
export async function decrementSellableStock(
    client: AnyPrisma,
    productId: string,
    branchId: string | null | undefined,
    qty: number,
    allowNegative = false,
): Promise<boolean> {
    if (qty <= 0) return true
    if (allowNegative) {
        await adjustSellableStock(client, productId, branchId, -qty)
        return true
    }
    const r = await client.product.updateMany({
        where: { id: productId, stock: { gte: qty } },
        data: { stock: { decrement: qty } },
    })
    if (r.count === 0) return false
    try {
        const wh = await getOrCreateDefaultWarehouse(client, branchId ?? null)
        if (wh?.id) await updateWarehouseStock(client, wh.id, productId, -qty)
    } catch { /* ignore */ }
    return true
}

// Upsert a WarehouseStock row, applying a signed delta to its quantity.
// Positive delta = stock in, negative = stock out. Product name/sku are looked
// up so the row stays self-describing when first created.
export async function updateWarehouseStock(
    prisma: AnyPrisma,
    warehouseId: string,
    productId: string,
    quantityDelta: number,
): Promise<any> {
    const product = await prisma.product
        .findUnique({ where: { id: productId }, select: { name: true, sku: true } })
        .catch(() => null)

    return prisma.warehouseStock.upsert({
        where: { warehouseId_productId: { warehouseId, productId } },
        update: { quantity: { increment: quantityDelta } },
        create: {
            warehouseId,
            productId,
            productName: product?.name ?? '',
            productSku: product?.sku ?? null,
            quantity: quantityDelta,
        },
    })
}
