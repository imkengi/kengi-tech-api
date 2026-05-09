// ═══════════════════════════════════════════════════════════════════════════════
// Seed Script — Multi-Schema Architecture
//
// Creates:
//   1. Store entry in registry (public schema)
//   2. PostgreSQL schema for the store
//   3. Demo data in the store schema
//
// Usage:
//   npm run db:seed
//   npx tsx prisma/seed.ts
// ═══════════════════════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client'
import { PrismaClient as StorePrisma } from '../src/generated/store-client'
import bcrypt from 'bcryptjs'

const registry = new PrismaClient()

function storeCodeToSchema(code: string): string {
    return 'store_' + code.toLowerCase().replace(/[^a-z0-9]/g, '_')
}

function getStoreClient(schemaName: string): StorePrisma {
    const base = process.env.DATABASE_URL || ''
    const sep = base.includes('?') ? '&' : '?'
    return new StorePrisma({
        datasources: { db: { url: `${base}${sep}schema=${schemaName}` } },
    })
}

async function createSchema(schemaName: string) {
    await registry.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)
}

async function pushStoreTables(schemaName: string) {
    // We need to push tables to the store schema
    // Use prisma db push with the store schema
    const { execSync } = require('child_process')
    const base = process.env.DATABASE_URL || ''
    const sep = base.includes('?') ? '&' : '?'
    const storeUrl = `${base}${sep}schema=${schemaName}`

    process.env.STORE_DATABASE_URL = storeUrl
    execSync('npx prisma db push --schema=prisma/schema-store.prisma --skip-generate --accept-data-loss', {
        stdio: 'pipe',
        env: { ...process.env, STORE_DATABASE_URL: storeUrl },
    })
}

async function main() {
    console.log('🌱 Seeding database (multi-schema architecture)...\n')

    // ─── Step 1: Push registry schema ───────────────────────────────────────
    console.log('📦 Pushing registry schema...')
    const { execSync } = require('child_process')
    execSync('npx prisma db push --skip-generate --accept-data-loss', { stdio: 'pipe' })
    console.log('✅ Registry schema ready\n')

    // ─── Step 2: Create stores ──────────────────────────────────────────────
    const stores = [
        { code: 'KENGI-HCM', name: 'Kengi Tech - Chi nhánh HCM', address: '123 Nguyễn Huệ, Q1, TP.HCM', phone: '028-1234-5678' },
        { code: 'KENGI-HN', name: 'Kengi Tech - Chi nhánh Hà Nội', address: '456 Phố Huế, Hai Bà Trưng, Hà Nội', phone: '024-9876-5432' },
    ]

    for (const storeData of stores) {
        const schemaName = storeCodeToSchema(storeData.code)
        console.log(`\n🏪 Setting up store: ${storeData.code} → schema: ${schemaName}`)

        // Create registry entry
        await registry.store.upsert({
            where: { code: storeData.code },
            update: { name: storeData.name, schema: schemaName },
            create: { ...storeData, schema: schemaName },
        })

        // Create PostgreSQL schema + push tables
        await createSchema(schemaName)
        console.log('  📦 Pushing store tables...')
        await pushStoreTables(schemaName)

        // Seed store data
        const storePrisma = getStoreClient(schemaName)
        await seedStoreData(storePrisma, storeData)
        await storePrisma.$disconnect()

        console.log(`  ✅ Store ${storeData.code} seeded!`)
    }

    console.log('\n🎉 Database seeding completed!')
    console.log('\n📋 Demo accounts (for both stores):')
    console.log('   admin@kengi.vn / admin123 (Admin)')
    console.log('   manager@kengi.vn / manager123 (Manager)')
    console.log('   cashier@kengi.vn / cashier123 (Cashier)')
    console.log('\n🏪 Store codes: KENGI-HCM, KENGI-HN')
}

// ═══════════════════════════════════════════════════════════════════════════════
// Seed data for a single store schema
// ═══════════════════════════════════════════════════════════════════════════════

async function seedStoreData(prisma: StorePrisma, storeInfo: { code: string; name: string; address?: string; phone?: string }) {
    // ─── Store Settings ─────────────────────────────────────────────────────
    await prisma.storeSettings.upsert({
        where: { id: 'default' },
        update: {},
        create: { id: 'default', name: storeInfo.name, address: storeInfo.address, phone: storeInfo.phone },
    })

    // ─── Branch ─────────────────────────────────────────────────────────────
    const branch = await prisma.branch.upsert({
        where: { code: 'CN01' },
        update: {},
        create: { name: 'Chi nhánh chính', code: 'CN01', isMainBranch: true, address: storeInfo.address },
    })

    // ─── Users ──────────────────────────────────────────────────────────────
    const hashedAdmin = await bcrypt.hash('admin123', 10)
    const hashedManager = await bcrypt.hash('manager123', 10)
    const hashedCashier = await bcrypt.hash('cashier123', 10)

    const admin = await prisma.user.upsert({
        where: { email: 'admin@kengi.vn' },
        update: {},
        create: { email: 'admin@kengi.vn', name: 'Nguyễn Admin', password: hashedAdmin, role: 'admin', phone: '0901000001', branchId: branch.id },
    })
    await prisma.user.upsert({
        where: { email: 'manager@kengi.vn' },
        update: {},
        create: { email: 'manager@kengi.vn', name: 'Trần Quản Lý', password: hashedManager, role: 'manager', phone: '0901000002', branchId: branch.id },
    })
    await prisma.user.upsert({
        where: { email: 'cashier@kengi.vn' },
        update: {},
        create: { email: 'cashier@kengi.vn', name: 'Lê Thu Ngân', password: hashedCashier, role: 'cashier', phone: '0901000003', branchId: branch.id },
    })
    console.log('  ✅ Users seeded (3)')

    // ─── Categories (3 levels) ──────────────────────────────────────────────
    const cats: any[] = [
        { id: 'cat-1', name: 'Điện thoại & Phụ kiện', color: '#3b82f6', level: 1 },
        { id: 'cat-2', name: 'Thời trang', color: '#f59e0b', level: 1 },
        { id: 'cat-3', name: 'Thực phẩm & Đồ uống', color: '#10b981', level: 1 },
        { id: 'cat-4', name: 'Điện tử & Công nghệ', color: '#8b5cf6', level: 1 },
        { id: 'cat-5', name: 'Đồ gia dụng', color: '#ef4444', level: 1 },
        { id: 'cat-1-1', name: 'Smartphone', parentId: 'cat-1', level: 2, color: '#60a5fa' },
        { id: 'cat-1-2', name: 'Phụ kiện điện thoại', parentId: 'cat-1', level: 2, color: '#93c5fd' },
        { id: 'cat-2-1', name: 'Giày dép', parentId: 'cat-2', level: 2, color: '#fbbf24' },
        { id: 'cat-3-1', name: 'Nước giải khát', parentId: 'cat-3', level: 2, color: '#34d399' },
        { id: 'cat-4-1', name: 'Tablet', parentId: 'cat-4', level: 2, color: '#a78bfa' },
        { id: 'cat-4-2', name: 'Tai nghe & Loa', parentId: 'cat-4', level: 2, color: '#c4b5fd' },
        { id: 'cat-5-1', name: 'Đồ bếp', parentId: 'cat-5', level: 2, color: '#f87171' },
        { id: 'cat-1-1-1', name: 'Android', parentId: 'cat-1-1', level: 3 },
        { id: 'cat-1-1-2', name: 'iPhone', parentId: 'cat-1-1', level: 3 },
        { id: 'cat-2-1-1', name: 'Giày thể thao', parentId: 'cat-2-1', level: 3 },
        { id: 'cat-3-1-1', name: 'Nước ngọt có ga', parentId: 'cat-3-1', level: 3 },
        { id: 'cat-4-1-1', name: 'Tablet Android', parentId: 'cat-4-1', level: 3 },
        { id: 'cat-4-2-1', name: 'Tai nghe không dây', parentId: 'cat-4-2', level: 3 },
        { id: 'cat-5-1-1', name: 'Nồi & chảo', parentId: 'cat-5-1', level: 3 },
    ]
    for (const cat of cats) {
        await prisma.category.upsert({ where: { id: cat.id }, update: {}, create: cat })
    }
    console.log('  ✅ Categories seeded (19)')

    // ─── Brands ─────────────────────────────────────────────────────────────
    const brands = [
        { id: 'brand-1', name: 'Samsung' }, { id: 'brand-2', name: 'Apple' },
        { id: 'brand-3', name: 'Nike' }, { id: 'brand-4', name: 'Adidas' },
        { id: 'brand-5', name: 'Sony' },
    ]
    for (const b of brands) { await prisma.brand.upsert({ where: { id: b.id }, update: {}, create: b }) }

    // ─── Products ───────────────────────────────────────────────────────────
    const products = [
        { id: 'prod-1', name: 'Samsung Galaxy S24', sku: 'SAMSUNG-S24', barcode: '8801643188092', categoryId: 'cat-1-1-1', brandId: 'brand-1', costPrice: 18000000, sellingPrice: 22990000, stock: 25, minStock: 5, maxStock: 100, baseUnit: 'cái' },
        { id: 'prod-2', name: 'iPhone 15 Pro Max', sku: 'IPHONE-15PM', barcode: '194253947066', categoryId: 'cat-1-1-2', brandId: 'brand-2', costPrice: 28000000, sellingPrice: 34990000, stock: 15, minStock: 3, maxStock: 50, baseUnit: 'cái' },
        { id: 'prod-3', name: 'Nike Air Force 1', sku: 'NIKE-AF1-W', barcode: '195239928345', categoryId: 'cat-2-1-1', brandId: 'brand-3', costPrice: 1800000, sellingPrice: 2990000, stock: 45, minStock: 10, maxStock: 200, baseUnit: 'đôi' },
        { id: 'prod-4', name: 'Adidas Ultraboost', sku: 'ADIDAS-UB22', barcode: '195239381990', categoryId: 'cat-2-1-1', brandId: 'brand-4', costPrice: 2800000, sellingPrice: 4290000, stock: 30, minStock: 5, maxStock: 100, baseUnit: 'đôi' },
        { id: 'prod-5', name: 'Coca Cola lon 330ml', sku: 'COCA-330', barcode: '5449000214911', categoryId: 'cat-3-1-1', costPrice: 7000, sellingPrice: 10000, stock: 200, minStock: 50, maxStock: 500, baseUnit: 'lon' },
        { id: 'prod-6', name: 'Sony WH-1000XM5', sku: 'SONY-XM5', barcode: '4548736132597', categoryId: 'cat-4-2-1', brandId: 'brand-5', costPrice: 6500000, sellingPrice: 8490000, stock: 12, minStock: 3, maxStock: 30, baseUnit: 'cái' },
        { id: 'prod-7', name: 'Samsung Galaxy Tab S9', sku: 'SAMSUNG-TABS9', barcode: '8806095159478', categoryId: 'cat-4-1-1', brandId: 'brand-1', costPrice: 15000000, sellingPrice: 19990000, stock: 8, minStock: 2, maxStock: 20, baseUnit: 'cái' },
        { id: 'prod-8', name: 'Nồi cơm điện Sunhouse', sku: 'SH-RC18', barcode: '8936086280014', categoryId: 'cat-5-1-1', costPrice: 450000, sellingPrice: 690000, stock: 35, minStock: 10, maxStock: 100, baseUnit: 'cái' },
        { id: 'prod-9', name: 'Pepsi lon 330ml', sku: 'PEPSI-330', barcode: '4902102063289', categoryId: 'cat-3-1-1', costPrice: 6500, sellingPrice: 10000, stock: 180, minStock: 50, maxStock: 500, baseUnit: 'lon' },
        { id: 'prod-10', name: 'Áo thun Nike Dri-FIT', sku: 'NIKE-DRIFIT-L', barcode: '196151345678', categoryId: 'cat-2-1-1', brandId: 'brand-3', costPrice: 550000, sellingPrice: 890000, stock: 60, minStock: 15, maxStock: 200, baseUnit: 'cái' },
        { id: 'prod-11', name: 'AirPods Pro 2', sku: 'AIRPODS-PRO2', barcode: '194253361988', categoryId: 'cat-4-2-1', brandId: 'brand-2', costPrice: 5500000, sellingPrice: 6990000, stock: 20, minStock: 5, maxStock: 50, baseUnit: 'cái' },
        { id: 'prod-12', name: 'Adidas Áo khoác 3-Stripes', sku: 'ADIDAS-JAK-M', barcode: '195240123456', categoryId: 'cat-2-1-1', brandId: 'brand-4', costPrice: 800000, sellingPrice: 1290000, stock: 40, minStock: 10, maxStock: 100, baseUnit: 'cái' },
        { id: 'prod-13', name: 'Samsung 65" QLED 4K', sku: 'SAMSUNG-TV65', barcode: '8801643452108', categoryId: 'cat-4-1', brandId: 'brand-1', costPrice: 18000000, sellingPrice: 24990000, stock: 5, minStock: 1, maxStock: 10, baseUnit: 'cái' },
        { id: 'prod-14', name: 'Sony PlayStation 5', sku: 'SONY-PS5', barcode: '711719536864', categoryId: 'cat-4', brandId: 'brand-5', costPrice: 12000000, sellingPrice: 15490000, stock: 6, minStock: 2, maxStock: 15, baseUnit: 'cái' },
        { id: 'prod-15', name: 'Nước suối Aquafina 500ml', sku: 'AQUA-500', barcode: '8936024100061', categoryId: 'cat-3-1', costPrice: 3500, sellingPrice: 5000, stock: 300, minStock: 100, maxStock: 1000, baseUnit: 'chai' },
    ]
    for (const p of products) { await prisma.product.upsert({ where: { sku: p.sku }, update: {}, create: p }) }
    console.log('  ✅ Products seeded (15)')

    // ─── Customer Groups ────────────────────────────────────────────────────
    const groups = [
        { id: 'grp-1', name: 'VIP', discount: 10, color: '#f59e0b' },
        { id: 'grp-2', name: 'Thường xuyên', discount: 5, color: '#3b82f6' },
        { id: 'grp-3', name: 'Mới', discount: 0, color: '#6b7280' },
    ]
    for (const g of groups) { await prisma.customerGroup.upsert({ where: { id: g.id }, update: {}, create: g }) }

    // ─── Customers ──────────────────────────────────────────────────────────
    const customers = [
        { id: 'cust-1', code: 'KH001', name: 'Nguyễn Văn An', phone: '0901234567', email: 'nguyenvanan@gmail.com', groupId: 'grp-1', gender: 'male', totalPurchases: 25000000, totalOrders: 12, loyaltyPoints: 2500, tier: 'gold' },
        { id: 'cust-2', code: 'KH002', name: 'Trần Thị Bình', phone: '0907654321', email: 'tranthib@gmail.com', groupId: 'grp-2', gender: 'female', totalPurchases: 15000000, totalOrders: 8, debt: 2000000, loyaltyPoints: 1500, tier: 'silver' },
        { id: 'cust-3', code: 'KH003', name: 'Lê Văn Cường', phone: '0912345678', groupId: 'grp-3', gender: 'male', totalPurchases: 3500000, totalOrders: 3, loyaltyPoints: 350, tier: 'bronze' },
        { id: 'cust-4', code: 'KH004', name: 'Phạm Thị Dung', phone: '0918765432', email: 'phamthid@gmail.com', groupId: 'grp-1', gender: 'female', totalPurchases: 55000000, totalOrders: 25, loyaltyPoints: 5500, tier: 'gold' },
        { id: 'cust-5', code: 'KH005', name: 'Hoàng Minh Tuấn', phone: '0919999999', groupId: 'grp-2', gender: 'male', totalPurchases: 8000000, totalOrders: 5, debt: 1000000, loyaltyPoints: 800, tier: 'bronze' },
    ]
    for (const c of customers) { await prisma.customer.upsert({ where: { code: c.code }, update: {}, create: c }) }
    console.log('  ✅ Customers seeded (5)')

    // ─── Transactions ───────────────────────────────────────────────────────
    const now = Date.now()
    const DAY = 24 * 60 * 60 * 1000

    const txData = [
        { id: 'tx-1', receiptNumber: 'HD20260201001', customerId: 'cust-1', customerName: 'Nguyễn Văn An', subtotal: 22990000, total: 22990000, amountReceived: 23000000, change: 10000, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(now - 2 * DAY) },
        { id: 'tx-2', receiptNumber: 'HD20260201002', customerId: 'cust-2', customerName: 'Trần Thị Bình', subtotal: 2990000, discount: 149500, total: 2840500, amountReceived: 3000000, change: 159500, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(now - 1 * DAY) },
        { id: 'tx-3', receiptNumber: 'HD20260202001', subtotal: 30000, total: 30000, amountReceived: 50000, change: 20000, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(now - 12 * 60 * 60 * 1000) },
        { id: 'tx-4', receiptNumber: 'HD20260202002', customerId: 'cust-4', customerName: 'Phạm Thị Dung', subtotal: 34990000, discount: 3499000, total: 31491000, amountReceived: 31491000, change: 0, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(now - 6 * 60 * 60 * 1000) },
    ]
    for (const tx of txData) {
        await prisma.transaction.upsert({ where: { receiptNumber: tx.receiptNumber }, update: {}, create: tx })
    }

    // Transaction items
    const existingItems = await prisma.transactionItem.count()
    if (existingItems === 0) {
        const txItems = [
            { transactionId: 'tx-1', productId: 'prod-1', productName: 'Samsung Galaxy S24', sku: 'SAMSUNG-S24', quantity: 1, unitPrice: 22990000, lineTotal: 22990000 },
            { transactionId: 'tx-2', productId: 'prod-3', productName: 'Nike Air Force 1', sku: 'NIKE-AF1-W', quantity: 1, unitPrice: 2990000, discount: 149500, lineTotal: 2840500 },
            { transactionId: 'tx-3', productId: 'prod-5', productName: 'Coca Cola lon 330ml', sku: 'COCA-330', quantity: 3, unitPrice: 10000, lineTotal: 30000 },
            { transactionId: 'tx-4', productId: 'prod-2', productName: 'iPhone 15 Pro Max', sku: 'IPHONE-15PM', quantity: 1, unitPrice: 34990000, discount: 3499000, lineTotal: 31491000 },
        ]
        for (const item of txItems) { await prisma.transactionItem.create({ data: item }) }
    }

    // Payments
    const existingPayments = await prisma.payment.count()
    if (existingPayments === 0) {
        const payments = [
            { transactionId: 'tx-1', type: 'cash', amount: 23000000 },
            { transactionId: 'tx-2', type: 'card', amount: 2840500 },
            { transactionId: 'tx-3', type: 'cash', amount: 50000 },
            { transactionId: 'tx-4', type: 'transfer', amount: 31491000 },
        ]
        for (const p of payments) { await prisma.payment.create({ data: p }) }
    }
    console.log('  ✅ Transactions seeded (4)')

    // ─── Suppliers ──────────────────────────────────────────────────────────
    const existingSup = await prisma.supplier.count()
    if (existingSup === 0) {
        const suppliers = [
            { code: 'NCC-001', name: 'Công ty TNHH Thực Phẩm Sài Gòn', contactName: 'Nguyễn Minh Tuấn', phone: '0901234567', email: 'tuan@saigonfood.vn', address: '123 Nguyễn Văn Linh, Q7, HCM', taxCode: '0312345678', totalOrders: 15, totalValue: 125000000 },
            { code: 'NCC-002', name: 'Đại lý Nước Giải Khát Phương Nam', contactName: 'Trần Thị Hoa', phone: '0912345678', email: 'hoa@phuongnam.vn', address: '456 Lê Lợi, Q1, HCM', taxCode: '0312345679', totalOrders: 22, totalValue: 89000000 },
            { code: 'NCC-003', name: 'Nhà cung cấp điện tử Tech World', contactName: 'Phạm Thu Hằng', phone: '0934567890', email: 'hang@techworld.vn', address: '321 CMT8, Q10, HCM', taxCode: '0312345681', totalOrders: 5, totalValue: 215000000 },
        ]
        for (const s of suppliers) { await prisma.supplier.create({ data: s }) }
    }

    // ─── Employees ──────────────────────────────────────────────────────────
    const existingEmp = await (prisma as any).employee?.count().catch(() => 0) ?? 0
    if (existingEmp === 0) {
        try {
            await (prisma as any).employee?.createMany({
                data: [
                    { code: 'NV-001', name: 'Nguyễn Thị Hương', phone: '0901111111', email: 'huong.nv@kengi.vn', role: 'cashier', department: 'Bán hàng', position: 'Thu ngân', salary: 8000000, startDate: new Date('2024-01-15'), status: 'active', branchId: branch.id },
                    { code: 'NV-002', name: 'Trần Văn Nam', phone: '0902222222', email: 'nam.tv@kengi.vn', role: 'warehouse', department: 'Kho', position: 'Thủ kho', salary: 9000000, startDate: new Date('2023-06-01'), status: 'active', branchId: branch.id },
                    { code: 'NV-003', name: 'Lê Thị Mai', phone: '0903333333', email: 'mai.lt@kengi.vn', role: 'staff', department: 'Bán hàng', position: 'Nhân viên bán hàng', salary: 7500000, startDate: new Date('2024-03-10'), status: 'active', branchId: branch.id },
                    { code: 'NV-004', name: 'Phạm Minh Khôi', phone: '0904444444', email: 'khoi.pm@kengi.vn', role: 'accountant', department: 'Kế toán', position: 'Kế toán viên', salary: 12000000, startDate: new Date('2023-01-05'), status: 'active', branchId: branch.id },
                    { code: 'NV-005', name: 'Hoàng Đức Long', phone: '0905555555', email: 'long.hd@kengi.vn', role: 'driver', department: 'Vận chuyển', position: 'Tài xế', salary: 10000000, startDate: new Date('2024-05-20'), status: 'active', branchId: branch.id },
                ]
            })
            console.log('  ✅ Employees seeded (5)')
        } catch { /* model may not exist */ }
    }

    // ─── Expenses ───────────────────────────────────────────────────────────
    const existingExp = await prisma.expense.count().catch(() => 0)
    if (existingExp === 0) {
        const now2 = new Date()
        await prisma.expense.createMany({
            data: [
                { category: 'Tiền thuê mặt bằng', amount: 25000000, date: new Date(now2.getFullYear(), now2.getMonth(), 1), description: 'Tiền thuê tháng ' + (now2.getMonth() + 1), status: 'paid' },
                { category: 'Lương nhân viên', amount: 46500000, date: new Date(now2.getFullYear(), now2.getMonth(), 5), description: 'Lương tháng ' + (now2.getMonth() + 1), status: 'paid' },
                { category: 'Tiền điện nước', amount: 3200000, date: new Date(now2.getFullYear(), now2.getMonth(), 10), description: 'Tiền điện nước tháng ' + (now2.getMonth() + 1), status: 'paid' },
                { category: 'Marketing', amount: 5000000, date: new Date(now2.getFullYear(), now2.getMonth(), 12), description: 'Quảng cáo Facebook + Google', status: 'paid' },
                { category: 'Vận chuyển', amount: 1800000, date: new Date(now2.getFullYear(), now2.getMonth(), 15), description: 'Phí giao hàng tháng', status: 'paid' },
                { category: 'Văn phòng phẩm', amount: 500000, date: new Date(now2.getFullYear(), now2.getMonth(), 18), description: 'Mua văn phòng phẩm', status: 'paid' },
            ]
        }).catch(() => {})
        console.log('  ✅ Expenses seeded (6)')
    }

    // ─── More transactions (spread over last 5 days) ─────────────────────────
    const existingTxCount = await prisma.transaction.count()
    if (existingTxCount <= 4) {
        const ref = new Date()
        const extraTx: any[] = [
            { id: 'tx-5', receiptNumber: 'HD20260203001', customerId: 'cust-3', customerName: 'Lê Văn Cường', subtotal: 4290000, total: 4290000, amountReceived: 5000000, change: 710000, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(ref.getTime() - 3*86400000) },
            { id: 'tx-6', receiptNumber: 'HD20260203002', subtotal: 50000, total: 50000, amountReceived: 50000, change: 0, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(ref.getTime() - 3*86400000 + 7200000) },
            { id: 'tx-7', receiptNumber: 'HD20260204001', customerId: 'cust-1', customerName: 'Nguyễn Văn An', subtotal: 8490000, total: 8490000, amountReceived: 9000000, change: 510000, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(ref.getTime() - 2*86400000) },
            { id: 'tx-8', receiptNumber: 'HD20260204002', customerId: 'cust-5', customerName: 'Hoàng Minh Tuấn', subtotal: 6990000, total: 5990000, discount: 1000000, amountReceived: 5990000, change: 0, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(ref.getTime() - 2*86400000 + 10800000) },
            { id: 'tx-9', receiptNumber: 'HD20260204003', subtotal: 690000, total: 690000, amountReceived: 700000, change: 10000, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(ref.getTime() - 2*86400000 + 18000000) },
            { id: 'tx-10', receiptNumber: 'HD20260205001', customerId: 'cust-4', customerName: 'Phạm Thị Dung', subtotal: 24990000, total: 22491000, discount: 2499000, amountReceived: 22491000, change: 0, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(ref.getTime() - 86400000) },
            { id: 'tx-11', receiptNumber: 'HD20260205002', subtotal: 30000, total: 30000, amountReceived: 30000, change: 0, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(ref.getTime() - 86400000 + 14400000) },
            { id: 'tx-12', receiptNumber: 'HD20260205003', customerId: 'cust-2', customerName: 'Trần Thị Bình', subtotal: 19990000, total: 17990000, discount: 2000000, amountReceived: 17990000, change: 0, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(ref.getTime() - 64800000) },
            { id: 'tx-13', receiptNumber: 'HD20260205004', subtotal: 890000, total: 890000, amountReceived: 1000000, change: 110000, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(ref.getTime() - 28800000) },
            { id: 'tx-14', receiptNumber: 'HD20260205005', customerId: 'cust-1', customerName: 'Nguyễn Văn An', subtotal: 1290000, total: 1290000, amountReceived: 1290000, change: 0, status: 'completed', createdBy: admin.id, createdByName: admin.name, createdAt: new Date(ref.getTime() - 10800000) },
        ]
        for (const tx of extraTx) {
            await prisma.transaction.upsert({ where: { receiptNumber: tx.receiptNumber }, update: {}, create: tx })
        }
        // Transaction items for extra transactions
        const extraItems: any[] = [
            { transactionId: 'tx-5', productId: 'prod-4', productName: 'Adidas Ultraboost', sku: 'ADIDAS-UB22', quantity: 1, unitPrice: 4290000, lineTotal: 4290000 },
            { transactionId: 'tx-6', productId: 'prod-5', productName: 'Coca Cola lon 330ml', sku: 'COCA-330', quantity: 5, unitPrice: 10000, lineTotal: 50000 },
            { transactionId: 'tx-7', productId: 'prod-6', productName: 'Sony WH-1000XM5', sku: 'SONY-XM5', quantity: 1, unitPrice: 8490000, lineTotal: 8490000 },
            { transactionId: 'tx-8', productId: 'prod-11', productName: 'AirPods Pro 2', sku: 'AIRPODS-PRO2', quantity: 1, unitPrice: 6990000, discount: 1000000, lineTotal: 5990000 },
            { transactionId: 'tx-9', productId: 'prod-8', productName: 'Nồi cơm điện Sunhouse', sku: 'SH-RC18', quantity: 1, unitPrice: 690000, lineTotal: 690000 },
            { transactionId: 'tx-10', productId: 'prod-13', productName: 'Samsung 65" QLED 4K', sku: 'SAMSUNG-TV65', quantity: 1, unitPrice: 24990000, discount: 2499000, lineTotal: 22491000 },
            { transactionId: 'tx-11', productId: 'prod-15', productName: 'Nước suối Aquafina 500ml', sku: 'AQUA-500', quantity: 6, unitPrice: 5000, lineTotal: 30000 },
            { transactionId: 'tx-12', productId: 'prod-7', productName: 'Samsung Galaxy Tab S9', sku: 'SAMSUNG-TABS9', quantity: 1, unitPrice: 19990000, discount: 2000000, lineTotal: 17990000 },
            { transactionId: 'tx-13', productId: 'prod-10', productName: 'Áo thun Nike Dri-FIT', sku: 'NIKE-DRIFIT-L', quantity: 1, unitPrice: 890000, lineTotal: 890000 },
            { transactionId: 'tx-14', productId: 'prod-12', productName: 'Adidas Áo khoác 3-Stripes', sku: 'ADIDAS-JAK-M', quantity: 1, unitPrice: 1290000, lineTotal: 1290000 },
        ]
        for (const item of extraItems) { await prisma.transactionItem.create({ data: item }).catch(() => {}) }
        const extraPayments: any[] = [
            { transactionId: 'tx-5', type: 'cash', amount: 5000000 },
            { transactionId: 'tx-6', type: 'cash', amount: 50000 },
            { transactionId: 'tx-7', type: 'transfer', amount: 9000000 },
            { transactionId: 'tx-8', type: 'card', amount: 5990000 },
            { transactionId: 'tx-9', type: 'cash', amount: 700000 },
            { transactionId: 'tx-10', type: 'transfer', amount: 22491000 },
            { transactionId: 'tx-11', type: 'cash', amount: 30000 },
            { transactionId: 'tx-12', type: 'ewallet', amount: 17990000 },
            { transactionId: 'tx-13', type: 'cash', amount: 1000000 },
            { transactionId: 'tx-14', type: 'card', amount: 1290000 },
        ]
        for (const p of extraPayments) { await prisma.payment.create({ data: p }).catch(() => {}) }
        console.log('  ✅ Extra transactions seeded (+10 = 14 total)')
    }

    // ─── Repairs ────────────────────────────────────────────────────────────
    const existingRepair = await prisma.repair.count().catch(() => 0)
    if (existingRepair === 0) {
        const ref2 = new Date()
        await prisma.repair.createMany({
            data: [
                { code: 'SC-001', customerName: 'Nguyễn Văn An', customerPhone: '0901234567', deviceName: 'Samsung Galaxy S24', issue: 'Vỡ màn hình, cần thay màn', status: 'in_progress', estimatedCost: 2500000, depositAmount: 500000, assignedTo: 'Kỹ thuật viên A', receivedAt: new Date(ref2.getTime() - 2*86400000), estimatedDone: new Date(ref2.getTime() + 86400000) },
                { code: 'SC-002', customerName: 'Trần Thị Bình', customerPhone: '0907654321', deviceName: 'iPhone 15 Pro Max', issue: 'Hỏng pin, pin xấu cần thay', status: 'pending', estimatedCost: 1200000, depositAmount: 200000, receivedAt: new Date(ref2.getTime() - 86400000), estimatedDone: new Date(ref2.getTime() + 2*86400000) },
                { code: 'SC-003', customerName: 'Lê Văn Cường', customerPhone: '0912345678', deviceName: 'Sony WH-1000XM5', issue: 'Không có âm thanh bên tai trái', status: 'completed', estimatedCost: 800000, actualCost: 750000, depositAmount: 300000, assignedTo: 'Kỹ thuật viên B', receivedAt: new Date(ref2.getTime() - 5*86400000), estimatedDone: new Date(ref2.getTime() - 2*86400000), completedAt: new Date(ref2.getTime() - 2*86400000) },
            ]
        }).catch(() => {})
        console.log('  ✅ Repairs seeded (3)')
    }

    // ─── Promotions ─────────────────────────────────────────────────────────
    const existingPromo = await prisma.promotion.count().catch(() => 0)
    if (existingPromo === 0) {
        const now3 = new Date()
        await prisma.promotion.createMany({
            data: [
                { code: 'SALE10', name: 'Giảm 10% toàn bộ đơn hàng', type: 'percent', value: 10, minOrderValue: 500000, startDate: new Date(now3.getFullYear(), now3.getMonth(), 1), endDate: new Date(now3.getFullYear(), now3.getMonth() + 1, 0), isActive: true, usageLimit: 1000, usedCount: 47 },
                { code: 'FREESHIP', name: 'Miễn phí giao hàng cho đơn trên 300k', type: 'fixed', value: 30000, minOrderValue: 300000, startDate: new Date(now3.getFullYear(), now3.getMonth(), 1), endDate: new Date(now3.getFullYear(), now3.getMonth() + 1, 0), isActive: true, usageLimit: 500, usedCount: 123 },
            ]
        }).catch(() => {})
        console.log('  ✅ Promotions seeded (2)')
    }

    // ─── Tax Config ─────────────────────────────────────────────────────────
    const existingTax = await prisma.taxConfig.count()
    if (existingTax === 0) {
        await prisma.taxConfig.createMany({
            data: [
                { name: 'VAT 10%', rate: 10, description: 'Thuế GTGT tiêu chuẩn', isDefault: true },
                { name: 'VAT 8%', rate: 8, description: 'Thuế GTGT ưu đãi' },
                { name: 'VAT 5%', rate: 5, description: 'Thuế GTGT đặc biệt' },
                { name: 'Không thuế', rate: 0, description: 'Miễn thuế' },
            ],
        })
    }

    // ─── Currencies ─────────────────────────────────────────────────────────
    const existingCur = await prisma.currency.count()
    if (existingCur === 0) {
        await prisma.currency.createMany({
            data: [
                { code: 'VND', name: 'Việt Nam Đồng', symbol: '₫', rate: 1, isBase: true },
                { code: 'USD', name: 'US Dollar', symbol: '$', rate: 25450 },
            ],
        })
    }

    // ─── Drivers ────────────────────────────────────────────────────────────
    const existingDrv = await prisma.driver.count()
    if (existingDrv === 0) {
        await prisma.driver.createMany({
            data: [
                { code: 'TX-001', name: 'Nguyễn Văn Tài', phone: '0901111111', vehicleType: 'motorbike', vehiclePlate: '59-B1 12345', totalDeliveries: 45, rating: 4.8 },
                { code: 'TX-002', name: 'Trần Thanh Bình', phone: '0902222222', vehicleType: 'motorbike', vehiclePlate: '59-C1 67890', totalDeliveries: 32, rating: 4.5 },
            ],
        })
    }

    console.log('  ✅ Supporting data seeded (suppliers, tax, currencies, drivers, promotions)')
}

// ─── Run ────────────────────────────────────────────────────────────────────

main()
    .catch((e) => {
        console.error('❌ Seed error:', e)
        process.exit(1)
    })
    .finally(async () => {
        await registry.$disconnect()
    })
