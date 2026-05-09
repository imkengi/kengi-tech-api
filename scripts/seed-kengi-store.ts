// Quick seed: Insert store KENGI into registry DB + create/setup store schema
// Usage: npx tsx scripts/seed-kengi-store.ts

import { PrismaClient } from '@prisma/client'
import { PrismaClient as StorePrisma } from '../src/generated/store-client'
import bcrypt from 'bcryptjs'
import { execSync } from 'child_process'

const registry = new PrismaClient()

const STORE_CODE = 'KENGI'
const STORE_NAME = 'Kengi Tech'
const SCHEMA_NAME = 'store_kengi'
const DB_URL = process.env.DATABASE_URL || ''

function getStoreClient(schema: string) {
    const sep = DB_URL.includes('?') ? '&' : '?'
    return new StorePrisma({
        datasources: { db: { url: `${DB_URL}${sep}schema=${schema}` } },
    })
}

async function main() {
    console.log('🌱 Seeding KENGI store into registry...')

    // 1. Create schema
    console.log(`📦 Creating PostgreSQL schema: ${SCHEMA_NAME}`)
    await registry.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA_NAME}"`)

    // 2. Push store tables to schema
    console.log('📦 Pushing store tables...')
    const storeUrl = `${DB_URL}${DB_URL.includes('?') ? '&' : '?'}schema=${SCHEMA_NAME}`
    execSync('npx prisma db push --schema=prisma/schema-store.prisma --skip-generate --accept-data-loss', {
        stdio: 'inherit',
        env: { ...process.env, STORE_DATABASE_URL: storeUrl },
    })

    // 3. Insert store into registry (upsert)
    const store = await registry.store.upsert({
        where: { code: STORE_CODE },
        update: { name: STORE_NAME, schema: SCHEMA_NAME, status: 'active' },
        create: { code: STORE_CODE, name: STORE_NAME, schema: SCHEMA_NAME, status: 'active' },
    })
    console.log(`✅ Store upserted: ${store.code} → schema: ${store.schema}`)

    // 4. Seed store data (branch, users, settings)
    const storePrisma = getStoreClient(SCHEMA_NAME)

    // Store settings
    await storePrisma.storeSettings.upsert({
        where: { id: 'default' },
        update: {},
        create: { id: 'default', name: STORE_NAME, phone: '0901000000' },
    })

    // Branch
    const branch = await storePrisma.branch.upsert({
        where: { code: 'CN01' },
        update: {},
        create: { name: 'Chi nhánh chính', code: 'CN01', isMainBranch: true },
    })
    console.log(`✅ Branch: ${branch.name} (${branch.id})`)

    // Users
    const pw = { admin: await bcrypt.hash('admin123', 10), manager: await bcrypt.hash('manager123', 10), cashier: await bcrypt.hash('cashier123', 10) }

    for (const [role, [email, name, hash]] of Object.entries({
        admin: ['admin@kengi.vn', 'Nguyễn Admin', pw.admin],
        manager: ['manager@kengi.vn', 'Trần Quản Lý', pw.manager],
        cashier: ['cashier@kengi.vn', 'Lê Thu Ngân', pw.cashier],
    })) {
        await storePrisma.user.upsert({
            where: { email },
            update: {},
            create: { email, name, password: hash, role: role as any, branchId: branch.id },
        })
    }
    console.log('✅ Users: admin@kengi.vn / manager@kengi.vn / cashier@kengi.vn')

    await storePrisma.$disconnect()
    await registry.$disconnect()

    console.log('\n🎉 KENGI store ready!')
    console.log('   Store code: KENGI')
    console.log('   Admin: admin@kengi.vn / admin123')
    console.log('   Manager: manager@kengi.vn / manager123')
    console.log('   Cashier: cashier@kengi.vn / cashier123')
}

main().catch(e => { console.error('❌', e); process.exit(1) })
