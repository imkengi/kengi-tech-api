/**
 * Seed test data into existing store schemas
 * Run: npx tsx scripts/seed-test-data.ts
 */
import { PrismaClient } from '@prisma/client'
import { PrismaClient as StorePrisma } from '../src/generated/store-client'
import bcrypt from 'bcryptjs'

const registry = new PrismaClient()

function getStoreClient(schemaName: string) {
    const base = (process.env.DATABASE_URL || '').replace(/[?&]schema=[^&]*/g, '').replace(/\?$/, '')
    const sep = base.includes('?') ? '&' : '?'
    return new StorePrisma({
        datasources: { db: { url: `${base}${sep}schema=${schemaName}&connection_limit=5` } },
    })
}

async function findOrCreate<T>(findFn: () => Promise<T | null>, createFn: () => Promise<T>): Promise<T> {
    const existing = await findFn()
    return existing ?? createFn()
}

async function seedStore(storeName: string, schemaName: string) {
    console.log(`\n${'='.repeat(55)}`)
    console.log(`🏪 ${storeName} → ${schemaName}`)
    console.log('='.repeat(55))

    const db = getStoreClient(schemaName)
    const hashedPw = await bcrypt.hash('123456', 10)

    // ─── Branch ─────────────────────────────────────────────────
    const branch = await findOrCreate(
        () => db.branch.findFirst({ where: { isMainBranch: true } }),
        () => db.branch.create({ data: { name: 'Chi nhánh chính', code: 'CN01', isMainBranch: true, address: '123 Nguyễn Huệ, Q1, TP.HCM', phone: '028 1234 5678' } })
    )
    console.log(`  ✅ Branch: ${branch.name}`)

    // ─── Store Settings ──────────────────────────────────────────
    await db.storeSettings.upsert({
        where: { id: 'default' },
        create: { id: 'default', name: storeName, address: '123 Nguyễn Huệ, Q1, TP.HCM', phone: '028 1234 5678' },
        update: { name: storeName },
    })
    console.log(`  ✅ Store settings`)

    // ─── Users ───────────────────────────────────────────────────
    for (const u of [
        { email: 'admin@kengi.vn', name: 'Admin Cửa hàng', role: 'admin', code: 'NV001' },
        { email: 'manager@kengi.vn', name: 'Quản lý', role: 'manager', code: 'NV002' },
        { email: 'cashier@kengi.vn', name: 'Thu ngân', role: 'cashier', code: 'NV003' },
    ]) {
        await findOrCreate(
            () => db.user.findFirst({ where: { email: u.email } }),
            () => db.user.create({ data: { ...u, password: hashedPw, branchId: branch.id, phone: '0901234567' } })
        )
    }
    console.log(`  ✅ Users: 3 accounts (password: 123456)`)

    // ─── Categories ──────────────────────────────────────────────
    const catIds: Record<string, string> = {}
    for (const { name, children } of [
        { name: 'Thời trang', children: ['Áo', 'Quần', 'Giày dép'] },
        { name: 'Điện tử', children: ['Điện thoại', 'Laptop'] },
        { name: 'Thực phẩm', children: ['Đồ uống', 'Bánh kẹo'] },
    ]) {
        const parent = await findOrCreate(
            () => db.category.findFirst({ where: { name, level: 1, parentId: null } }),
            () => db.category.create({ data: { name, level: 1 } })
        )
        catIds[name] = parent.id
        for (const child of children) {
            const sub = await findOrCreate(
                () => db.category.findFirst({ where: { name: child, level: 2, parentId: parent.id } }),
                () => db.category.create({ data: { name: child, level: 2, parentId: parent.id } })
            )
            catIds[`${name}/${child}`] = sub.id
        }
    }
    console.log(`  ✅ Categories: ${Object.keys(catIds).length}`)

    // ─── Products ────────────────────────────────────────────────
    const productDefs = [
        { sku: 'AO001', name: 'Áo thun nam basic', costPrice: 80000, sellingPrice: 159000, stock: 50, categoryId: catIds['Thời trang/Áo'], baseUnit: 'Cái', minStock: 10 },
        { sku: 'AO002', name: 'Áo polo nam', costPrice: 120000, sellingPrice: 249000, stock: 35, categoryId: catIds['Thời trang/Áo'], baseUnit: 'Cái', minStock: 5 },
        { sku: 'AO003', name: 'Áo sơ mi trắng', costPrice: 150000, sellingPrice: 299000, stock: 20, categoryId: catIds['Thời trang/Áo'], baseUnit: 'Cái', minStock: 5 },
        { sku: 'QU001', name: 'Quần jean slim', costPrice: 200000, sellingPrice: 399000, stock: 30, categoryId: catIds['Thời trang/Quần'], baseUnit: 'Cái', minStock: 5 },
        { sku: 'QU002', name: 'Quần short kaki', costPrice: 100000, sellingPrice: 199000, stock: 45, categoryId: catIds['Thời trang/Quần'], baseUnit: 'Cái', minStock: 10 },
        { sku: 'GD001', name: 'Giày sneaker trắng', costPrice: 300000, sellingPrice: 599000, stock: 15, categoryId: catIds['Thời trang/Giày dép'], baseUnit: 'Đôi', minStock: 3 },
        { sku: 'DT001', name: 'iPhone 15 128GB', costPrice: 18000000, sellingPrice: 22990000, stock: 5, categoryId: catIds['Điện tử/Điện thoại'], baseUnit: 'Cái', minStock: 2 },
        { sku: 'DT002', name: 'Samsung Galaxy S24', costPrice: 15000000, sellingPrice: 19990000, stock: 8, categoryId: catIds['Điện tử/Điện thoại'], baseUnit: 'Cái', minStock: 2 },
        { sku: 'LT001', name: 'MacBook Air M2', costPrice: 25000000, sellingPrice: 32990000, stock: 3, categoryId: catIds['Điện tử/Laptop'], baseUnit: 'Cái', minStock: 1 },
        { sku: 'TP001', name: 'Nước suối Aquafina', costPrice: 5000, sellingPrice: 8000, stock: 200, categoryId: catIds['Thực phẩm/Đồ uống'], baseUnit: 'Chai', minStock: 50 },
        { sku: 'TP002', name: 'Bánh Oreo', costPrice: 15000, sellingPrice: 22000, stock: 100, categoryId: catIds['Thực phẩm/Bánh kẹo'], baseUnit: 'Hộp', minStock: 20 },
    ]
    const products: any[] = []
    for (const p of productDefs) {
        products.push(await findOrCreate(
            () => db.product.findFirst({ where: { sku: p.sku } }),
            () => db.product.create({ data: p })
        ))
    }
    console.log(`  ✅ Products: ${products.length}`)

    // ─── Customer Groups ─────────────────────────────────────────
    // CustomerGroup schema: { id, name, discount, color }
    const groupVIP = await findOrCreate(
        () => db.customerGroup.findFirst({ where: { name: 'VIP' } }),
        () => db.customerGroup.create({ data: { name: 'VIP', discount: 5, color: '#f59e0b' } })
    )
    const groupRegular = await findOrCreate(
        () => db.customerGroup.findFirst({ where: { name: 'Thường' } }),
        () => db.customerGroup.create({ data: { name: 'Thường', discount: 0, color: '#6b7280' } })
    )

    // ─── Customers ───────────────────────────────────────────────
    const customerDefs = [
        { code: 'KH001', name: 'Nguyễn Văn An', phone: '0901234567', email: 'an@email.com', gender: 'male', groupId: groupVIP.id },
        { code: 'KH002', name: 'Trần Thị Bình', phone: '0912345678', email: 'binh@email.com', gender: 'female', groupId: groupVIP.id },
        { code: 'KH003', name: 'Lê Văn Cường', phone: '0923456789', gender: 'male', groupId: groupRegular.id },
        { code: 'KH004', name: 'Phạm Thị Thu', phone: '0934567890', gender: 'female', groupId: groupRegular.id },
        { code: 'KH005', name: 'Hoàng Minh Đức', phone: '0945678901', gender: 'male', groupId: groupRegular.id },
    ]
    const customers: any[] = []
    for (const c of customerDefs) {
        customers.push(await findOrCreate(
            () => db.customer.findFirst({ where: { code: c.code } }),
            () => db.customer.create({ data: c })
        ))
    }
    console.log(`  ✅ Customers: ${customers.length}`)

    // ─── Suppliers ───────────────────────────────────────────────
    for (const s of [
        { code: 'NCC001', name: 'Công ty TNHH Thời Trang Việt', contactName: 'Anh Minh', phone: '028 3456 7890' },
        { code: 'NCC002', name: 'Apple Authorised Reseller VN', contactName: 'Ms. Lan', phone: '028 8765 4321' },
    ]) {
        await findOrCreate(
            () => db.supplier.findFirst({ where: { code: s.code } }),
            () => db.supplier.create({ data: s })
        )
    }
    console.log(`  ✅ Suppliers: 2`)

    // ─── Transactions (30 days) ───────────────────────────────────
    const adminUser = await db.user.findFirst({ where: { role: 'admin' } })
    const userId = adminUser!.id
    let txCount = 0
    const baseDate = new Date('2026-02-28T10:00:00+07:00')

    for (let day = 0; day < 30; day++) {
        const numTx = Math.floor(Math.random() * 7) + 3
        for (let t = 0; t < numTx; t++) {
            const txDate = new Date(baseDate)
            txDate.setDate(txDate.getDate() - day)
            txDate.setHours(8 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60))

            const customer = Math.random() > 0.45 ? customers[Math.floor(Math.random() * customers.length)] : null
            const numItems = Math.floor(Math.random() * 3) + 1
            const shuffled = [...products].sort(() => Math.random() - 0.5).slice(0, numItems)
            const items = shuffled.map(p => {
                const qty = Math.floor(Math.random() * 3) + 1
                return { productId: p.id, productName: p.name, sku: p.sku, quantity: qty, unitPrice: p.sellingPrice, lineTotal: qty * p.sellingPrice }
            })
            const subtotal = items.reduce((s, i) => s + i.lineTotal, 0)
            const discount = Math.random() > 0.8 ? Math.round(subtotal * 0.05 / 1000) * 1000 : 0
            const total = subtotal - discount

            await db.transaction.create({
                data: {
                    receiptNumber: `HD${Date.now()}-${String(day * 15 + t + 1).padStart(4, '0')}`,
                    customerId: customer?.id || null,
                    customerName: customer?.name || 'Khách lẻ',
                    customerPhone: customer?.phone || null,
                    subtotal, discount, total, tax: 0,
                    status: 'completed',
                    createdBy: userId,
                    branchId: branch.id,
                    createdAt: txDate,
                    items: { create: items },
                    payments: { create: [{ amount: total, type: Math.random() > 0.35 ? 'cash' : 'card' }] },
                },
            })
            txCount++
        }
    }
    console.log(`  ✅ Transactions: ${txCount} (30 ngày)`)

    // ─── Expenses ────────────────────────────────────────────────
    // Expense schema: { description, amount, category, date, paidBy, recurring, branchId }
    const expCats = ['Thuê mặt bằng', 'Lương nhân viên', 'Điện nước', 'Marketing', 'Vận chuyển']
    for (let i = 0; i < 10; i++) {
        const d = new Date(baseDate)
        d.setDate(d.getDate() - Math.floor(Math.random() * 30))
        await db.expense.create({
            data: {
                description: `${expCats[i % expCats.length]} tháng 2/2026`,
                amount: (Math.floor(Math.random() * 50) + 5) * 100000,
                category: expCats[i % expCats.length],
                date: d,
                branchId: branch.id,
            },
        })
    }
    console.log(`  ✅ Expenses: 10`)

    await db.$disconnect()
    console.log(`  🎉 Done!`)
}

async function main() {
    console.log('🚀 Seeding test data...')
    const stores = await registry.$queryRaw<{ name: string; schema: string }[]>`
        SELECT name, schema FROM "Store" ORDER BY "createdAt"
    `
    console.log(`Found ${stores.length} stores: ${stores.map(s => s.name).join(', ')}`)

    for (const store of stores) {
        await seedStore(store.name, store.schema)
    }

    console.log('\n\n🎉 Seed complete!\n')
    console.log('📋 Login:')
    console.log('  Email:    admin@kengi.vn')
    console.log('  Password: 123456')
    console.log('  Mã CH:    KENGI or KENGI2311')

    await registry.$disconnect()
}

main().catch(async (e) => {
    console.error('❌ Error:', e.message || e)
    await registry.$disconnect()
    process.exit(1)
})
