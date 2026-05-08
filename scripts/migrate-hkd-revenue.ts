import { execSync } from 'child_process'
import { PrismaClient } from '@prisma/client'

const BASE_URL = process.env.DATABASE_URL || ''
const p = new PrismaClient()

async function pushToStore(schemaName: string) {
    console.log(`\n📦 Pushing HKDRevenueEntry to schema: ${schemaName}`)
    const url = BASE_URL.replace(/[?&]schema=[^&]*/g, '').replace(/\?$/, '')
    const sep = url.includes('?') ? '&' : '?'
    const storeUrl = `${url}${sep}schema=${schemaName}`
    try {
        execSync('npx prisma db push --schema=prisma/schema-store.prisma --skip-generate --accept-data-loss', {
            stdio: 'inherit',
            env: { ...process.env, STORE_DATABASE_URL: storeUrl, DATABASE_URL: storeUrl },
        })
        console.log(`✅ Done: ${schemaName}`)
    } catch (e) {
        console.error(`❌ Failed for ${schemaName}:`, e)
    }
}

async function main() {
    const stores = await p.$queryRaw<{ id: string; code: string; schema: string }[]>`SELECT id, code, schema FROM "Store" WHERE schema IS NOT NULL AND schema != ''`
    console.log(`Found ${stores.length} stores:`)
    stores.forEach(s => console.log(`  - ${s.code} → ${s.schema}`))

    for (const store of stores) {
        await pushToStore(store.schema)
    }

    console.log('\n✅ All store schemas updated with HKDRevenueEntry!')
    await p.$disconnect()
}

main().catch(async e => {
    console.error(e)
    await p.$disconnect()
    process.exit(1)
})
