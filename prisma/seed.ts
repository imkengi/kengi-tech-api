import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
    console.log('🌱 Seeding database...')

    // ─── Stores ─────────────────────────────────────────────────────────────────
    const store1 = await prisma.store.upsert({
        where: { code: 'KENGI-HCM' },
        update: {},
        create: {
            id: 'store-1',
            code: 'KENGI-HCM',
            name: 'Kengi Tech - Chi nhánh HCM',
            address: '123 Nguyễn Huệ, Q1, TP.HCM',
            phone: '028-1234-5678',
            description: 'Chi nhánh chính Kengi Tech tại TP.HCM',
        },
    })

    const store2 = await prisma.store.upsert({
        where: { code: 'KENGI-HN' },
        update: {},
        create: {
            id: 'store-2',
            code: 'KENGI-HN',
            name: 'Kengi Tech - Chi nhánh Hà Nội',
            address: '456 Phố Huế, Hai Bà Trưng, Hà Nội',
            phone: '024-9876-5432',
            description: 'Chi nhánh Kengi Tech tại Hà Nội',
        },
    })

    console.log('✅ Stores seeded (2 stores)')

    // ─── Users ────────────────────────────────────────────────────────────────
    const hashedPassword = await bcrypt.hash('admin123', 10)
    const hashedManager = await bcrypt.hash('manager123', 10)
    const hashedCashier = await bcrypt.hash('cashier123', 10)

    const admin = await prisma.user.upsert({
        where: { id: 'u-1' },
        update: {},
        create: {
            id: 'u-1',
            email: 'admin@kengi.vn',
            name: 'Nguyễn Admin',
            password: hashedPassword,
            role: 'admin',
            phone: '0901000001',
            storeId: store1.id,
        },
    })

    await prisma.user.upsert({
        where: { id: 'u-2' },
        update: {},
        create: {
            id: 'u-2',
            email: 'manager@kengi.vn',
            name: 'Trần Quản Lý',
            password: hashedManager,
            role: 'manager',
            phone: '0901000002',
            storeId: store1.id,
        },
    })

    await prisma.user.upsert({
        where: { id: 'u-3' },
        update: {},
        create: {
            id: 'u-3',
            email: 'cashier@kengi.vn',
            name: 'Lê Thu Ngân',
            password: hashedCashier,
            role: 'cashier',
            phone: '0901000003',
            storeId: store1.id,
        },
    })

    // Store 2 users
    await prisma.user.upsert({
        where: { id: 'u-4' },
        update: {},
        create: {
            id: 'u-4',
            email: 'admin@kengi.vn',
            name: 'Phạm Admin HN',
            password: hashedPassword,
            role: 'admin',
            phone: '0901000004',
            storeId: store2.id,
        },
    })

    console.log('✅ Users seeded (4 users across 2 stores)')

    // ─── Categories (3 levels) ─────────────────────────────────────────────────
    // Level 1 — root
    const rootCategories = [
        { id: 'cat-1', name: 'Điện thoại & Phụ kiện', description: 'Smartphone & phụ kiện điện thoại', color: '#3b82f6', level: 1 },
        { id: 'cat-2', name: 'Thời trang', description: 'Quần áo, giày dép, túi xách', color: '#f59e0b', level: 1 },
        { id: 'cat-3', name: 'Thực phẩm & Đồ uống', description: 'Đồ ăn, nước uống', color: '#10b981', level: 1 },
        { id: 'cat-4', name: 'Điện tử & Công nghệ', description: 'Laptop, tablet, phụ kiện IT', color: '#8b5cf6', level: 1 },
        { id: 'cat-5', name: 'Đồ gia dụng', description: 'Nội thất, dụng cụ nhà bếp', color: '#ef4444', level: 1 },
    ]

    // Level 2 — sub
    const subCategories = [
        { id: 'cat-1-1', name: 'Smartphone', parentId: 'cat-1', level: 2, color: '#60a5fa' },
        { id: 'cat-1-2', name: 'Phụ kiện điện thoại', parentId: 'cat-1', level: 2, color: '#93c5fd' },
        { id: 'cat-2-1', name: 'Giày dép', parentId: 'cat-2', level: 2, color: '#fbbf24' },
        { id: 'cat-2-2', name: 'Áo quần', parentId: 'cat-2', level: 2, color: '#fcd34d' },
        { id: 'cat-3-1', name: 'Nước giải khát', parentId: 'cat-3', level: 2, color: '#34d399' },
        { id: 'cat-3-2', name: 'Đồ ăn vặt', parentId: 'cat-3', level: 2, color: '#6ee7b7' },
        { id: 'cat-4-1', name: 'Tablet', parentId: 'cat-4', level: 2, color: '#a78bfa' },
        { id: 'cat-4-2', name: 'Tai nghe & Loa', parentId: 'cat-4', level: 2, color: '#c4b5fd' },
        { id: 'cat-5-1', name: 'Đồ bếp', parentId: 'cat-5', level: 2, color: '#f87171' },
        { id: 'cat-5-2', name: 'Đồ nội thất', parentId: 'cat-5', level: 2, color: '#fca5a5' },
    ]

    // Level 3 — leaf
    const leafCategories = [
        { id: 'cat-1-1-1', name: 'Android', parentId: 'cat-1-1', level: 3 },
        { id: 'cat-1-1-2', name: 'iPhone', parentId: 'cat-1-1', level: 3 },
        { id: 'cat-1-2-1', name: 'Ốp lưng', parentId: 'cat-1-2', level: 3 },
        { id: 'cat-2-1-1', name: 'Giày thể thao', parentId: 'cat-2-1', level: 3 },
        { id: 'cat-2-2-1', name: 'Áo thun', parentId: 'cat-2-2', level: 3 },
        { id: 'cat-3-1-1', name: 'Nước ngọt có ga', parentId: 'cat-3-1', level: 3 },
        { id: 'cat-4-1-1', name: 'Tablet Android', parentId: 'cat-4-1', level: 3 },
        { id: 'cat-4-2-1', name: 'Tai nghe không dây', parentId: 'cat-4-2', level: 3 },
        { id: 'cat-5-1-1', name: 'Nồi & chảo', parentId: 'cat-5-1', level: 3 },
        { id: 'cat-5-2-1', name: 'Kệ & tủ', parentId: 'cat-5-2', level: 3 },
    ]

    // Insert in order: root → sub → leaf
    for (const cat of [...rootCategories, ...subCategories, ...leafCategories]) {
        await prisma.category.upsert({
            where: { id: cat.id },
            update: {},
            create: cat as any,
        })
    }
    console.log('✅ Categories seeded (3 levels: 5 root + 10 sub + 10 leaf)')

    // ─── Brands ───────────────────────────────────────────────────────────────
    const brands = [
        { id: 'brand-1', name: 'Samsung', description: 'Samsung Electronics' },
        { id: 'brand-2', name: 'Apple', description: 'Apple Inc.' },
        { id: 'brand-3', name: 'Nike', description: 'Nike Inc.' },
        { id: 'brand-4', name: 'Adidas', description: 'Adidas AG' },
        { id: 'brand-5', name: 'Sony', description: 'Sony Corporation' },
    ]

    for (const brand of brands) {
        await prisma.brand.upsert({
            where: { id: brand.id },
            update: {},
            create: brand,
        })
    }
    console.log('✅ Brands seeded')

    // ─── Products ─────────────────────────────────────────────────────────────
    const products = [
        {
            id: 'prod-1', name: 'Samsung Galaxy S24', sku: 'SAMSUNG-S24', barcode: '8801643188092',
            categoryId: 'cat-1-1-1', brandId: 'brand-1', costPrice: 18000000, sellingPrice: 22990000,
            stock: 25, minStock: 5, maxStock: 100, baseUnit: 'cái', taxInclusive: true,
        },
        {
            id: 'prod-2', name: 'iPhone 15 Pro Max', sku: 'IPHONE-15PM', barcode: '194253947066',
            categoryId: 'cat-1-1-2', brandId: 'brand-2', costPrice: 28000000, sellingPrice: 34990000,
            stock: 15, minStock: 3, maxStock: 50, baseUnit: 'cái', taxInclusive: true,
        },
        {
            id: 'prod-3', name: 'Nike Air Force 1', sku: 'NIKE-AF1-W', barcode: '195239928345',
            categoryId: 'cat-2-1-1', brandId: 'brand-3', costPrice: 1800000, sellingPrice: 2990000,
            stock: 45, minStock: 10, maxStock: 200, baseUnit: 'đôi', taxInclusive: true,
        },
        {
            id: 'prod-4', name: 'Adidas Ultraboost', sku: 'ADIDAS-UB22', barcode: '195239381990',
            categoryId: 'cat-2-1-1', brandId: 'brand-4', costPrice: 2800000, sellingPrice: 4290000,
            stock: 30, minStock: 5, maxStock: 100, baseUnit: 'đôi', taxInclusive: true,
        },
        {
            id: 'prod-5', name: 'Coca Cola lon 330ml', sku: 'COCA-330', barcode: '5449000214911',
            categoryId: 'cat-3-1-1', costPrice: 7000, sellingPrice: 10000,
            stock: 200, minStock: 50, maxStock: 500, baseUnit: 'lon', taxInclusive: true,
        },
        {
            id: 'prod-6', name: 'Sony WH-1000XM5', sku: 'SONY-XM5', barcode: '4548736132597',
            categoryId: 'cat-4-2-1', brandId: 'brand-5', costPrice: 6500000, sellingPrice: 8490000,
            stock: 12, minStock: 3, maxStock: 30, baseUnit: 'cái', taxInclusive: true,
        },
        {
            id: 'prod-7', name: 'Samsung Galaxy Tab S9', sku: 'SAMSUNG-TABS9', barcode: '8806095159478',
            categoryId: 'cat-4-1-1', brandId: 'brand-1', costPrice: 15000000, sellingPrice: 19990000,
            stock: 8, minStock: 2, maxStock: 20, baseUnit: 'cái', taxInclusive: true,
        },
        {
            id: 'prod-8', name: 'Nồi cơm điện Sunhouse', sku: 'SH-RC18', barcode: '8936086280014',
            categoryId: 'cat-5-1-1', costPrice: 450000, sellingPrice: 690000,
            stock: 35, minStock: 10, maxStock: 100, baseUnit: 'cái', taxInclusive: true,
        },
        {
            id: 'prod-9', name: 'Pepsi lon 330ml', sku: 'PEPSI-330', barcode: '4902102063289',
            categoryId: 'cat-3-1-1', costPrice: 6500, sellingPrice: 10000,
            stock: 180, minStock: 50, maxStock: 500, baseUnit: 'lon', taxInclusive: true,
        },
        {
            id: 'prod-10', name: 'Áo thun Nike Dri-FIT', sku: 'NIKE-DRIFIT-L', barcode: '196151345678',
            categoryId: 'cat-2-2-1', brandId: 'brand-3', costPrice: 550000, sellingPrice: 890000,
            stock: 60, minStock: 15, maxStock: 200, baseUnit: 'cái', taxInclusive: true,
        },
    ]

    for (const product of products) {
        await prisma.product.upsert({
            where: { id: product.id },
            update: {},
            create: product,
        })
    }
    console.log('✅ Products seeded (10 items)')

    // ─── Customer Groups ──────────────────────────────────────────────────────
    const groups = [
        { id: 'grp-1', name: 'VIP', discount: 10, color: '#f59e0b' },
        { id: 'grp-2', name: 'Thường xuyên', discount: 5, color: '#3b82f6' },
        { id: 'grp-3', name: 'Mới', discount: 0, color: '#6b7280' },
    ]

    for (const group of groups) {
        await prisma.customerGroup.upsert({
            where: { id: group.id },
            update: {},
            create: group,
        })
    }
    console.log('✅ Customer groups seeded')

    // ─── Customers ────────────────────────────────────────────────────────────
    const customers = [
        {
            id: 'cust-1', code: 'KH001', name: 'Nguyễn Văn An', phone: '0901234567',
            email: 'nguyenvanan@gmail.com', address: '123 Nguyễn Huệ, Q1, TP.HCM',
            groupId: 'grp-1', gender: 'male', totalPurchases: 25000000, totalOrders: 12,
            debt: 0, loyaltyPoints: 2500, tier: 'gold',
        },
        {
            id: 'cust-2', code: 'KH002', name: 'Trần Thị Bình', phone: '0907654321',
            email: 'tranthib@gmail.com', address: '456 Lê Lợi, Q3, TP.HCM',
            groupId: 'grp-2', gender: 'female', totalPurchases: 15000000, totalOrders: 8,
            debt: 2000000, loyaltyPoints: 1500, tier: 'silver',
        },
        {
            id: 'cust-3', code: 'KH003', name: 'Lê Văn Cường', phone: '0912345678',
            address: '789 Trần Hưng Đạo, Q5, TP.HCM',
            groupId: 'grp-3', gender: 'male', totalPurchases: 3500000, totalOrders: 3,
            debt: 0, loyaltyPoints: 350, tier: 'bronze',
        },
        {
            id: 'cust-4', code: 'KH004', name: 'Phạm Thị Dung', phone: '0918765432',
            email: 'phamthid@gmail.com', groupId: 'grp-1', gender: 'female',
            totalPurchases: 55000000, totalOrders: 25, debt: 0,
            loyaltyPoints: 5500, tier: 'vip',
        },
        {
            id: 'cust-5', code: 'KH005', name: 'Hoàng Minh Tuấn', phone: '0919999999',
            groupId: 'grp-2', gender: 'male', totalPurchases: 8000000, totalOrders: 5,
            debt: 1000000, loyaltyPoints: 800, tier: 'bronze',
        },
    ]

    for (const customer of customers) {
        await prisma.customer.upsert({
            where: { id: customer.id },
            update: {},
            create: customer,
        })
    }
    console.log('✅ Customers seeded (5 customers)')

    // ─── Transactions ─────────────────────────────────────────────────────────
    const now = Date.now()
    const DAY = 24 * 60 * 60 * 1000

    const transactions = [
        {
            id: 'tx-1',
            receiptNumber: 'HD20260201001',
            customerId: 'cust-1',
            customerName: 'Nguyễn Văn An',
            subtotal: 22990000,
            discount: 0,
            tax: 0,
            total: 22990000,
            amountReceived: 23000000,
            change: 10000,
            status: 'completed',
            createdBy: admin.id,
            createdByName: admin.name,
            createdAt: new Date(now - 2 * DAY),
        },
        {
            id: 'tx-2',
            receiptNumber: 'HD20260201002',
            customerId: 'cust-2',
            customerName: 'Trần Thị Bình',
            subtotal: 2990000,
            discount: 149500,
            tax: 0,
            total: 2840500,
            amountReceived: 3000000,
            change: 159500,
            status: 'completed',
            createdBy: admin.id,
            createdByName: admin.name,
            createdAt: new Date(now - 1 * DAY),
        },
        {
            id: 'tx-3',
            receiptNumber: 'HD20260202001',
            subtotal: 30000,
            discount: 0,
            tax: 0,
            total: 30000,
            amountReceived: 50000,
            change: 20000,
            status: 'completed',
            createdBy: admin.id,
            createdByName: admin.name,
            createdAt: new Date(now - 12 * 60 * 60 * 1000),
        },
        {
            id: 'tx-4',
            receiptNumber: 'HD20260202002',
            customerId: 'cust-4',
            customerName: 'Phạm Thị Dung',
            subtotal: 34990000,
            discount: 3499000,
            tax: 0,
            total: 31491000,
            amountReceived: 31491000,
            change: 0,
            status: 'completed',
            createdBy: admin.id,
            createdByName: admin.name,
            createdAt: new Date(now - 6 * 60 * 60 * 1000),
        },
    ]

    for (const tx of transactions) {
        await prisma.transaction.upsert({
            where: { id: tx.id },
            update: {},
            create: tx,
        })
    }

    // Transaction items
    const txItems = [
        { transactionId: 'tx-1', productId: 'prod-1', productName: 'Samsung Galaxy S24', sku: 'SAMSUNG-S24', quantity: 1, unitPrice: 22990000, discount: 0, lineTotal: 22990000 },
        { transactionId: 'tx-2', productId: 'prod-3', productName: 'Nike Air Force 1', sku: 'NIKE-AF1-W', quantity: 1, unitPrice: 2990000, discount: 149500, lineTotal: 2840500 },
        { transactionId: 'tx-3', productId: 'prod-5', productName: 'Coca Cola lon 330ml', sku: 'COCA-330', quantity: 3, unitPrice: 10000, discount: 0, lineTotal: 30000 },
        { transactionId: 'tx-4', productId: 'prod-2', productName: 'iPhone 15 Pro Max', sku: 'IPHONE-15PM', quantity: 1, unitPrice: 34990000, discount: 3499000, lineTotal: 31491000 },
    ]

    const existingItems = await prisma.transactionItem.count()
    if (existingItems === 0) {
        for (const item of txItems) {
            await prisma.transactionItem.create({ data: item })
        }
    }

    // Payments
    const payments = [
        { transactionId: 'tx-1', type: 'cash', amount: 23000000 },
        { transactionId: 'tx-2', type: 'card', amount: 2840500 },
        { transactionId: 'tx-3', type: 'cash', amount: 50000 },
        { transactionId: 'tx-4', type: 'transfer', amount: 31491000 },
    ]

    const existingPayments = await prisma.payment.count()
    if (existingPayments === 0) {
        for (const payment of payments) {
            await prisma.payment.create({ data: payment })
        }
    }
    console.log('✅ Transactions seeded (4 transactions)')

    // ─── Promotions ───────────────────────────────────────────────────────────
    const promotions = [
        {
            id: 'promo-1', code: 'SALE50', name: 'Giảm 50% Điện Thoại',
            description: 'Giảm giá 50% tất cả điện thoại', type: 'percentage', value: 50,
            minOrderValue: 1000000, maxDiscount: 5000000,
            startDate: new Date(now - 7 * DAY), endDate: new Date(now + 30 * DAY),
            status: 'active', usageCount: 5, usageLimit: 100,
            applicableTo: 'category', categoryIds: JSON.stringify(['cat-1']),
        },
        {
            id: 'promo-2', code: 'FREESHIP', name: 'Miễn phí vận chuyển',
            description: 'Miễn phí vận chuyển cho đơn từ 500k', type: 'fixed', value: 30000,
            minOrderValue: 500000,
            startDate: new Date(now - 14 * DAY), endDate: new Date(now + 60 * DAY),
            status: 'active', usageCount: 22, usageLimit: 500,
            applicableTo: 'all',
        },
        {
            id: 'promo-3', code: 'WELCOME10', name: 'Chào mừng khách mới',
            description: 'Giảm 10% cho khách hàng mới', type: 'percentage', value: 10,
            maxDiscount: 200000,
            startDate: new Date(now - 30 * DAY), endDate: new Date(now + 90 * DAY),
            status: 'active', usageCount: 15,
            applicableTo: 'all',
        },
    ]

    for (const promo of promotions) {
        await prisma.promotion.upsert({
            where: { id: promo.id },
            update: {},
            create: promo,
        })
    }
    console.log('✅ Promotions seeded (3 promotions)')

    // ─── Inventory Transactions ───────────────────────────────────────────────
    const invTransactions = [
        {
            type: 'import', productId: 'prod-1', productName: 'Samsung Galaxy S24',
            productSku: 'SAMSUNG-S24', quantity: 10,
            reason: 'Nhập kho từ nhà cung cấp Samsung', userId: admin.id, userName: admin.name,
            createdAt: new Date(now - 5 * DAY),
        },
        {
            type: 'import', productId: 'prod-3', productName: 'Nike Air Force 1',
            productSku: 'NIKE-AF1-W', quantity: 40,
            reason: 'Nhập kho từ nhà cung cấp Nike', userId: admin.id, userName: admin.name,
            createdAt: new Date(now - 10 * DAY),
        },
        {
            type: 'adjustment', productId: 'prod-5', productName: 'Coca Cola lon 330ml',
            productSku: 'COCA-330', quantity: -5,
            reason: 'Hỏng hóc', note: '5 lon bị móp méo',
            userId: admin.id, userName: admin.name,
            createdAt: new Date(now - 1 * DAY),
        },
    ]

    const existingInvTx = await prisma.inventoryTransaction.count()
    if (existingInvTx === 0) {
        for (const invTx of invTransactions) {
            await prisma.inventoryTransaction.create({ data: invTx })
        }
    }
    console.log('✅ Inventory transactions seeded')

    // ─── Suppliers ──────────────────────────────────────────────────────────
    const existingSup = await prisma.supplier.count()
    if (existingSup === 0) {
        const suppliers = [
            { code: 'NCC-001', name: 'Công ty TNHH Thực Phẩm Sài Gòn', contactName: 'Nguyễn Minh Tuấn', phone: '0901234567', email: 'tuan@saigonfood.vn', address: '123 Nguyễn Văn Linh, Q7, HCM', taxCode: '0312345678', totalOrders: 15, totalValue: 125000000, status: 'active' },
            { code: 'NCC-002', name: 'Đại lý Nước Giải Khát Phương Nam', contactName: 'Trần Thị Hoa', phone: '0912345678', email: 'hoa@phuongnam.vn', address: '456 Lê Lợi, Q1, HCM', taxCode: '0312345679', totalOrders: 22, totalValue: 89000000, status: 'active' },
            { code: 'NCC-003', name: 'Kho Văn Phòng Phẩm Đông Á', contactName: 'Lê Văn Đức', phone: '0923456789', email: 'duc@dongavpp.vn', address: '789 Trần Hưng Đạo, Q5, HCM', taxCode: '0312345680', totalOrders: 8, totalValue: 32000000, status: 'active' },
            { code: 'NCC-004', name: 'Nhà cung cấp điện tử Tech World', contactName: 'Phạm Thu Hằng', phone: '0934567890', email: 'hang@techworld.vn', address: '321 CMT8, Q10, HCM', taxCode: '0312345681', totalOrders: 5, totalValue: 215000000, status: 'active' },
            { code: 'NCC-005', name: 'Công ty Bao Bì Xanh', contactName: 'Võ Thanh Tùng', phone: '0945678901', email: 'tung@baobixanh.vn', address: '654 Hai Bà Trưng, Q3, HCM', taxCode: '0312345682', totalOrders: 3, totalValue: 18000000, status: 'inactive' },
        ]
        for (const s of suppliers) await prisma.supplier.create({ data: s })
    }
    console.log('✅ Suppliers seeded')

    // ─── Expenses ───────────────────────────────────────────────────────────
    const existingExp = await prisma.expense.count()
    if (existingExp === 0) {
        const expenses = [
            { description: 'Tiền thuê mặt bằng tháng 2', amount: 15000000, category: 'rent', paidBy: 'Admin', recurring: true, date: new Date(now - 2 * DAY) },
            { description: 'Tiền điện tháng 1', amount: 2500000, category: 'electricity', paidBy: 'Admin', recurring: true, date: new Date(now - 5 * DAY) },
            { description: 'Tiền nước tháng 1', amount: 350000, category: 'water', paidBy: 'Admin', recurring: true, date: new Date(now - 5 * DAY) },
            { description: 'Internet VNPT', amount: 450000, category: 'internet', paidBy: 'Admin', recurring: true, date: new Date(now - 7 * DAY) },
            { description: 'Mua văn phòng phẩm', amount: 780000, category: 'supplies', paidBy: 'Cashier 1', recurring: false, date: new Date(now - 3 * DAY) },
            { description: 'Xăng xe giao hàng', amount: 500000, category: 'transport', paidBy: 'Driver', recurring: false, date: new Date(now - 1 * DAY) },
            { description: 'Đồ ăn nhân viên', amount: 1200000, category: 'food', paidBy: 'Admin', recurring: false, date: new Date(now - 1 * DAY) },
            { description: 'Sửa máy lạnh', amount: 850000, category: 'maintenance', paidBy: 'Admin', recurring: false, date: new Date(now - 10 * DAY) },
        ]
        for (const e of expenses) await prisma.expense.create({ data: e })
    }
    console.log('✅ Expenses seeded')

    // ─── Notifications ──────────────────────────────────────────────────────
    const existingNotif = await prisma.notification.count()
    if (existingNotif === 0) {
        const notifications = [
            { title: 'Chào mừng!', message: 'Chào mừng bạn đến với Open Retail', type: 'info', read: true },
            { title: 'Sản phẩm sắp hết hàng', message: 'Có 3 sản phẩm tồn kho dưới mức tối thiểu', type: 'warning', read: false },
            { title: 'Khuyến mãi mới', message: 'Chương trình giảm giá 20% đã được kích hoạt', type: 'success', read: false },
            { title: 'Cập nhật hệ thống', message: 'Hệ thống sẽ bảo trì vào 23:00 tối nay', type: 'announcement', read: false },
            { title: 'Đơn hàng lớn', message: 'Đơn hàng HD-015 trị giá 5,200,000đ đã hoàn thành', type: 'success', read: true },
        ]
        for (const n of notifications) await prisma.notification.create({ data: n })
    }
    console.log('✅ Notifications seeded')

    // ─── Drivers ────────────────────────────────────────────────────────────
    const existingDrivers = await prisma.driver.count()
    if (existingDrivers === 0) {
        const drivers = [
            { code: 'TX-001', name: 'Nguyễn Văn Tài', phone: '0901111111', vehicleType: 'motorbike', vehiclePlate: '59-B1 12345', status: 'active', totalDeliveries: 45, rating: 4.8 },
            { code: 'TX-002', name: 'Trần Thanh Bình', phone: '0902222222', vehicleType: 'motorbike', vehiclePlate: '59-C1 67890', status: 'active', totalDeliveries: 32, rating: 4.5 },
            { code: 'TX-003', name: 'Lê Minh Khoa', phone: '0903333333', vehicleType: 'van', vehiclePlate: '59-D1 11111', status: 'busy', totalDeliveries: 18, rating: 4.9 },
        ]
        for (const d of drivers) await prisma.driver.create({ data: d })
    }
    console.log('✅ Drivers seeded')

    // ─── Tax Config ─────────────────────────────────────────────────────────
    const existingTax = await prisma.taxConfig.count()
    if (existingTax === 0) {
        await prisma.taxConfig.createMany({
            data: [
                { name: 'VAT 10%', rate: 10, description: 'Thuế GTGT tiêu chuẩn', isDefault: true, status: 'active' },
                { name: 'VAT 8%', rate: 8, description: 'Thuế GTGT ưu đãi', isDefault: false, status: 'active' },
                { name: 'VAT 5%', rate: 5, description: 'Thuế GTGT đặc biệt', isDefault: false, status: 'active' },
                { name: 'Không thuế', rate: 0, description: 'Miễn thuế', isDefault: false, status: 'active' },
            ]
        })
    }
    console.log('✅ Tax config seeded')

    // ─── Currencies ─────────────────────────────────────────────────────────
    const existingCur = await prisma.currency.count()
    if (existingCur === 0) {
        await prisma.currency.createMany({
            data: [
                { code: 'VND', name: 'Việt Nam Đồng', symbol: '₫', rate: 1, isBase: true, status: 'active' },
                { code: 'USD', name: 'US Dollar', symbol: '$', rate: 25450, isBase: false, status: 'active' },
                { code: 'EUR', name: 'Euro', symbol: '€', rate: 27800, isBase: false, status: 'active' },
                { code: 'JPY', name: 'Japanese Yen', symbol: '¥', rate: 168, isBase: false, status: 'active' },
            ]
        })
    }
    console.log('✅ Currencies seeded')

    // ─── Customer Segments ──────────────────────────────────────────────────
    const existingSeg = await prisma.customerSegment.count()
    if (existingSeg === 0) {
        await prisma.customerSegment.createMany({
            data: [
                { name: 'Khách VIP', description: 'Khách hàng chi tiêu trên 10 triệu', conditions: '{"minPurchases":10000000}', customerCount: 5, color: '#f59e0b' },
                { name: 'Khách thân thiết', description: 'Khách mua hàng >= 5 lần', conditions: '{"minOrders":5}', customerCount: 12, color: '#3b82f6' },
                { name: 'Khách mới', description: 'Khách đăng ký trong 30 ngày qua', conditions: '{"tier":"bronze"}', customerCount: 8, color: '#10b981' },
            ]
        })
    }
    console.log('✅ Customer segments seeded')

    // ─── Feedback ───────────────────────────────────────────────────────────
    const existingFb = await prisma.feedback.count()
    if (existingFb === 0) {
        await prisma.feedback.createMany({
            data: [
                { customerName: 'Trần Văn A', customerPhone: '0911223344', type: 'praise', rating: 5, message: 'Nhân viên phục vụ rất nhiệt tình', status: 'resolved', response: 'Cảm ơn bạn đã ủng hộ!' },
                { customerName: 'Nguyễn Thị B', type: 'complaint', rating: 2, message: 'Đợi thanh toán hơi lâu', status: 'in_progress' },
                { customerName: 'Lê Hoàng C', type: 'suggestion', rating: 4, message: 'Nên thêm dịch vụ giao hàng tận nhà', status: 'new' },
            ]
        })
    }
    console.log('✅ Feedback seeded')

    console.log('\n🎉 Database seeding completed!')
    console.log('\n📋 Demo accounts:')
    console.log('   admin@kengi.vn / admin123 (Admin)')
    console.log('   manager@kengi.vn / manager123 (Manager)')
    console.log('   cashier@kengi.vn / cashier123 (Cashier)')
}

main()
    .catch((e) => {
        console.error('Seed error:', e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
