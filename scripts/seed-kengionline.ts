/**
 * Massive seed for KENGIONLINE
 * Run: npx tsx scripts/seed-kengionline.ts
 */
import { PrismaClient } from '@prisma/client'
import { PrismaClient as StorePrisma } from '../src/generated/store-client'
import bcrypt from 'bcryptjs'

const registry = new PrismaClient()

function getStoreClient(schemaName: string) {
    const base = (process.env.DATABASE_URL || '').replace(/[?&]schema=[^&]*/g, '').replace(/\?$/, '')
    const sep = base.includes('?') ? '&' : '?'
    // IMPORTANT: append application_name to prevent connection pool bleeding
    return new StorePrisma({
        datasources: { db: { url: `${base}${sep}schema=${schemaName}&application_name=${schemaName}&connection_limit=10` } },
    })
}

async function main() {
    console.log('🚀 Seeding massive data for KENGIONLINE...')
    
    const store = await registry.store.findFirst({ where: { code: 'KENGIONLINE' } })
    if (!store) throw new Error('Store KENGIONLINE not found!')
    
    const db = getStoreClient(store.schema)
    const hashedPw = await bcrypt.hash('admin123', 10) // Make sure password is admin123

    // ─── Branch ─────────────────────────────────────────────────
    let branch = await db.branch.findFirst({ where: { isMainBranch: true } })
    if (!branch) {
        branch = await db.branch.create({ data: { name: 'Chi nhánh chính', code: 'CN01', isMainBranch: true, address: '123 Nguyễn Huệ, Q1, TP.HCM', phone: '028 1234 5678' } })
    }
    console.log(`  ✅ Branch: ${branch.name}`)

    // ─── Store Settings ──────────────────────────────────────────
    await db.storeSettings.upsert({
        where: { id: 'default' },
        create: { id: 'default', name: store.name, address: '123 Nguyễn Huệ, Q1, TP.HCM', phone: '028 1234 5678' },
        update: { name: store.name },
    })

    // ─── Users ───────────────────────────────────────────────────
    const usersData = [
        { email: 'admin@kengi.vn', name: 'Admin Kengi', role: 'admin', code: 'NV001', password: hashedPw },
        { email: 'manager@kengi.vn', name: 'Quản lý', role: 'manager', code: 'NV002', password: await bcrypt.hash('manager123', 10) },
        { email: 'cashier@kengi.vn', name: 'Thu ngân 1', role: 'cashier', code: 'NV003', password: await bcrypt.hash('cashier123', 10) },
        { email: 'cashier2@kengi.vn', name: 'Thu ngân 2', role: 'cashier', code: 'NV004', password: await bcrypt.hash('cashier123', 10) },
    ]
    const users: any[] = []
    for (const u of usersData) {
        let existing = await db.user.findFirst({ where: { email: u.email } })
        if (!existing) {
            existing = await db.user.create({ data: { ...u, branchId: branch.id, phone: '0901234567' } })
        } else {
            // Force update password just to be sure
            existing = await db.user.update({ where: { id: existing.id }, data: { password: u.password } })
        }
        users.push(existing)
    }
    console.log(`  ✅ Users updated`)

    // ─── Categories ──────────────────────────────────────────────
    const catIds: Record<string, string> = {}
    const cats = [
        { name: 'Thời trang nam', children: ['Áo thun', 'Áo sơ mi', 'Quần Jean', 'Quần Kaki', 'Phụ kiện nam'] },
        { name: 'Thời trang nữ', children: ['Đầm váy', 'Áo kiểu', 'Quần ống rộng', 'Túi xách', 'Phụ kiện nữ'] },
        { name: 'Điện tử & Phụ kiện', children: ['Điện thoại di động', 'Tai nghe', 'Cáp sạc', 'Pin dự phòng', 'Ốp lưng'] },
        { name: 'Gia dụng', children: ['Đồ bếp', 'Vệ sinh nhà cửa', 'Trang trí'] },
    ]
    for (const { name, children } of cats) {
        let parent = await db.category.findFirst({ where: { name, level: 1 } })
        if (!parent) parent = await db.category.create({ data: { name, level: 1 } })
        catIds[name] = parent.id
        for (const child of children) {
            let sub = await db.category.findFirst({ where: { name: child, level: 2, parentId: parent.id } })
            if (!sub) sub = await db.category.create({ data: { name: child, level: 2, parentId: parent.id } })
            catIds[`${name}/${child}`] = sub.id
        }
    }

    // ─── Products (50 items) ────────────────────────────────────────────────
    // Check if we need to create products
    const existingProductsCount = await db.product.count()
    let dbProducts: any[] = await db.product.findMany()

    if (existingProductsCount < 30) {
        console.log(`  ⏳ Generating 50 products...`)
        const newProducts = []
        let skuCounter = 100
        for (const catName of Object.keys(catIds)) {
            if (!catName.includes('/')) continue // skip parents
            
            for (let i = 0; i < 4; i++) { // 4 products per subcategory
                skuCounter++
                const basePrice = (Math.floor(Math.random() * 50) + 10) * 10000 // 100k to 600k
                newProducts.push({
                    sku: `SP${skuCounter}`,
                    name: `Sản phẩm ${catName.split('/')[1]} cao cấp ${i+1}`,
                    costPrice: basePrice * 0.6,
                    sellingPrice: basePrice,
                    stock: Math.floor(Math.random() * 200) + 20,
                    categoryId: catIds[catName],
                    baseUnit: 'Cái',
                    minStock: 10,
                })
            }
        }
        await db.product.createMany({ data: newProducts, skipDuplicates: true })
        dbProducts = await db.product.findMany()
    }
    console.log(`  ✅ Total Products: ${dbProducts.length}`)

    // ─── Customer Groups ─────────────────────────────────────────
    let groupVIP = await db.customerGroup.findFirst({ where: { name: 'VIP' } })
    if (!groupVIP) groupVIP = await db.customerGroup.create({ data: { name: 'VIP', discount: 10, color: '#f59e0b' } })
    
    let groupRegular = await db.customerGroup.findFirst({ where: { name: 'Thường' } })
    if (!groupRegular) groupRegular = await db.customerGroup.create({ data: { name: 'Thường', discount: 0, color: '#6b7280' } })

    // ─── Customers (30 items) ───────────────────────────────────────────────
    let dbCustomers: any[] = await db.customer.findMany()
    if (dbCustomers.length < 20) {
        console.log(`  ⏳ Generating 30 customers...`)
        const newCusts = []
        const ho = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý']
        const dem = ['Văn', 'Thị', 'Minh', 'Hữu', 'Thanh', 'Ngọc', 'Xuân', 'Thu', 'Đức', 'Hải']
        const ten = ['An', 'Bình', 'Cường', 'Dũng', 'Em', 'Phong', 'Giang', 'Hùng', 'Linh', 'Mai', 'Nga', 'Oanh', 'Phúc', 'Quân', 'Trang', 'Tâm', 'Uyên', 'Vân']
        
        for (let i = 0; i < 30; i++) {
            const h = ho[Math.floor(Math.random() * ho.length)]
            const d = dem[Math.floor(Math.random() * dem.length)]
            const t = ten[Math.floor(Math.random() * ten.length)]
            const isVip = Math.random() > 0.8
            newCusts.push({
                code: `KH${1000 + i}`,
                name: `${h} ${d} ${t}`,
                phone: `09${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`,
                groupId: isVip ? groupVIP.id : groupRegular.id,
                totalSpent: 0
            })
        }
        await db.customer.createMany({ data: newCusts, skipDuplicates: true })
        dbCustomers = await db.customer.findMany()
    }
    console.log(`  ✅ Total Customers: ${dbCustomers.length}`)

    // ─── Transactions (Past 90 days - ~1500 items) ───────────────────────────────────
    const txCount = await db.transaction.count()
    if (txCount < 500) {
        console.log(`  ⏳ Generating transactions for the past 90 days (this might take a minute)...`)
        const adminId = users[0].id
        const baseDate = new Date()
        let createdTxCount = 0

        for (let day = 0; day < 90; day++) {
            // More sales on weekends
            const txDate = new Date(baseDate)
            txDate.setDate(txDate.getDate() - day)
            const isWeekend = txDate.getDay() === 0 || txDate.getDay() === 6
            const numTx = isWeekend ? Math.floor(Math.random() * 25) + 15 : Math.floor(Math.random() * 15) + 5

            for (let t = 0; t < numTx; t++) {
                const hour = 8 + Math.floor(Math.random() * 13) // 8am to 9pm
                const min = Math.floor(Math.random() * 60)
                const sec = Math.floor(Math.random() * 60)
                const exactDate = new Date(txDate)
                exactDate.setHours(hour, min, sec, 0)

                const customer = Math.random() > 0.4 ? dbCustomers[Math.floor(Math.random() * dbCustomers.length)] : null
                const numItems = Math.floor(Math.random() * 4) + 1
                const shuffled = [...dbProducts].sort(() => Math.random() - 0.5).slice(0, numItems)
                
                const items = shuffled.map(p => {
                    const qty = Math.floor(Math.random() * 3) + 1
                    return { productId: p.id, productName: p.name, sku: p.sku, quantity: qty, unitPrice: p.sellingPrice, lineTotal: qty * p.sellingPrice, baseCost: p.costPrice }
                })
                
                const subtotal = items.reduce((s, i) => s + i.lineTotal, 0)
                let discount = 0
                if (customer && customer.groupId === groupVIP.id) {
                    discount = Math.round(subtotal * 0.1 / 1000) * 1000 // 10% for VIP
                } else if (Math.random() > 0.8) {
                    discount = Math.round(subtotal * 0.05 / 1000) * 1000 // 5% random
                }
                const total = subtotal - discount

                // Wait, creating nested relation in loop is slow, but OK for 1000 items
                await db.transaction.create({
                    data: {
                        receiptNumber: `HD${Date.now().toString().slice(-6)}-${String(day * 50 + t + 1).padStart(4, '0')}`,
                        customerId: customer?.id || null,
                        customerName: customer?.name || 'Khách lẻ',
                        customerPhone: customer?.phone || null,
                        subtotal, discount, total, tax: 0,
                        status: 'completed',
                        createdBy: adminId,
                        branchId: branch!.id,
                        createdAt: exactDate,
                        items: { create: items.map(i => ({ productId: i.productId, productName: i.productName, sku: i.sku, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal })) },
                        payments: { create: [{ amount: total, type: Math.random() > 0.4 ? 'cash' : 'transfer' }] },
                    },
                })
                createdTxCount++
                if (createdTxCount % 100 === 0) process.stdout.write('.')
            }
        }
        console.log(`\n  ✅ Transactions generated: ${createdTxCount}`)
    } else {
        console.log(`  ✅ Transactions exist: ${txCount}`)
    }

    // ─── Expenses ────────────────────────────────────────────────
    const expCount = await db.expense.count()
    if (expCount < 30) {
        console.log(`  ⏳ Generating expenses...`)
        const expCats = ['Thuê mặt bằng', 'Lương nhân viên', 'Điện nước', 'Marketing', 'Vận chuyển', 'Nhập hàng', 'Tiếp khách']
        const baseDate = new Date()
        for (let i = 0; i < 150; i++) {
            const d = new Date(baseDate)
            d.setDate(d.getDate() - Math.floor(Math.random() * 90))
            await db.expense.create({
                data: {
                    description: `${expCats[i % expCats.length]}`,
                    amount: (Math.floor(Math.random() * 50) + 5) * 100000,
                    category: expCats[i % expCats.length],
                    date: d,
                    branchId: branch!.id,
                },
            })
        }
        console.log(`  ✅ Expenses generated`)
    }

    await db.$disconnect()
    await registry.$disconnect()
    console.log(`  🎉 SEED COMPLETE FOR KENGIONLINE!`)
}

main().catch(async (e) => {
    console.error('❌ Error:', e.message || e)
    await registry.$disconnect()
    process.exit(1)
})
