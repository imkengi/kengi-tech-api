// Helpers for keeping per-warehouse stock (WarehouseStock) in sync with the
// product-level stock that the POS/inventory flows mutate. The "main" default
// warehouse mirrors Product.stock; specialised warehouses (damaged/warranty/
// mobile) are managed via stock transfers.

import { emitStockChanged, webhooksActive } from './webhookDispatch'

type AnyPrisma = any

// Find (or lazily create) the branch's default "main" warehouse. Robust cho
// scale nhiều store/chi nhánh — tránh 2 vấn đề đã gặp trong prod:
//  (1) Boot migration seed kho với mã theo TÊN SCHEMA + branchId=null, còn hàm này
//      tìm theo id CHI NHÁNH. Khi hậu tố schema trùng hậu tố branch, tạo mới bị
//      đụng mã → trước đây trả undefined → POS âm thầm không cập nhật kho.
//  (2) Kho null-branch boot-seed thành "mồ côi" bên cạnh kho theo chi nhánh.
// Cách xử lý: nếu chưa có kho theo chi nhánh, NHẬN kho main null-branch có sẵn
// (gán branchId cho chi nhánh) thay vì tạo trùng; khi tạo mới thì dùng mã duy nhất
// nếu mã cơ bản đã bị chiếm.
export async function getOrCreateDefaultWarehouse(
    prisma: AnyPrisma,
    branchId: string | null | undefined,
    branchName?: string | null,
): Promise<any> {
    // Resolve "kho bán được" chuẩn: nếu KHÔNG truyền branch (đơn sàn, import không
    // gắn chi nhánh...), quy về kho của CHI NHÁNH CHÍNH — đúng kho mà POS dùng — để
    // online và POS cùng trỏ một kho, giữ WarehouseStock[main] == Product.stock.
    let nb = branchId || null
    if (!nb) {
        const mainBranch = await prisma.branch
            .findFirst({ where: { isMainBranch: true }, select: { id: true, name: true } })
            .catch(() => null)
        if (mainBranch?.id) {
            nb = mainBranch.id
            if (!branchName) branchName = mainBranch.name
        }
    }
    const where = { type: 'main', isDefault: true, branchId: nb }

    const existing = await prisma.warehouse.findFirst({ where })
    if (existing) return existing

    // Hỏi kho theo chi nhánh cụ thể mà chưa có → nhận kho main null-branch boot-seed
    // (nếu có) làm kho của chi nhánh này, tránh tạo bản trùng/mồ côi.
    if (nb) {
        const orphan = await prisma.warehouse
            .findFirst({ where: { type: 'main', isDefault: true, branchId: null } })
            .catch(() => null)
        if (orphan) {
            try {
                return await prisma.warehouse.update({ where: { id: orphan.id }, data: { branchId: nb } })
            } catch {
                // race: kho vừa được nhận bởi request khác — trả lại đúng kho chi nhánh
                return (await prisma.warehouse.findFirst({ where })) || orphan
            }
        }
    }

    // Resolve a human-readable name only when we actually need to create.
    let name = branchName || undefined
    if (!name && branchId) {
        const branch = await prisma.branch
            .findUnique({ where: { id: branchId }, select: { name: true } })
            .catch(() => null)
        name = branch?.name || undefined
    }

    const baseCode = nb ? `WH-MAIN-${nb.slice(-6).toUpperCase()}` : 'WH-MAIN'
    // Thử mã cơ bản trước; nếu đã bị chiếm (đụng schema-suffix), dùng mã duy nhất để
    // LUÔN tạo được kho gắn đúng branchId — không bao giờ trả về undefined.
    const codes = [baseCode, `${baseCode}-${Date.now().toString(36).slice(-4).toUpperCase()}`, `WH-MAIN-${Date.now().toString(36).toUpperCase()}`]
    for (const code of codes) {
        try {
            return await prisma.warehouse.create({
                data: {
                    code,
                    name: name ? `Kho chính - ${name}` : 'Kho chính',
                    type: 'main',
                    description: 'Kho hàng hóa chính, đồng bộ với tồn kho sản phẩm',
                    isDefault: true,
                    isActive: true,
                    branchId: nb,
                },
            })
        } catch {
            // Đụng mã hoặc race: nếu đã có kho đúng chi nhánh thì trả về; else thử mã kế.
            const w = await prisma.warehouse.findFirst({ where }).catch(() => null)
            if (w) return w
        }
    }
    return prisma.warehouse.findFirst({ where }).catch(() => null)
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
    reason?: string,
): Promise<void> {
    if (!delta) return
    // 1) Product.stock (tồn tổng bán được) — bắt luôn tồn mới + sku/name để phát webhook
    const updated = await client.product.update({
        where: { id: productId },
        data: { stock: { increment: delta } },
        select: { stock: true, sku: true, name: true },
    })
    // 2) Mirror sang kho main của chi nhánh (best-effort — không chặn nghiệp vụ
    //    chính nếu bảng kho chưa migrate ở schema cũ)
    try {
        const wh = await getOrCreateDefaultWarehouse(client, branchId ?? null)
        if (wh?.id) await updateWarehouseStock(client, wh.id, productId, delta)
    } catch { /* schema chưa có bảng Warehouse — Product.stock vẫn đúng */ }
    // 3) Webhook đầu ra (đã chốt chặn nhanh bên trong; await để chạy trong tx nếu có)
    await emitStockChanged(client, {
        productId, sku: updated?.sku, name: updated?.name,
        branchId: branchId ?? null, delta, stock: updated?.stock ?? 0, reason,
    })
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
    // Webhook đầu ra: chỉ đọc lại tồn khi thật sự có store bật webhook (tránh
    // query thừa trên hot-path bán hàng).
    if (webhooksActive()) {
        try {
            const p = await client.product.findUnique({ where: { id: productId }, select: { stock: true, sku: true, name: true } })
            if (p) await emitStockChanged(client, {
                productId, sku: p.sku, name: p.name,
                branchId: branchId ?? null, delta: -qty, stock: p.stock, reason: 'sale',
            })
        } catch { /* ignore */ }
    }
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
