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
