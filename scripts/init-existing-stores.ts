import { execSync } from 'child_process'
import { PrismaClient } from '@prisma/client'

const BASE_URL = process.env.DATABASE_URL || ''

const p = new PrismaClient()

async function pushSchemaToStore(schemaName: string) {
    console.log(`\n📦 Pushing tables to schema: ${schemaName}`)
    // First create the schema
    await p.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)

    const url = BASE_URL.replace(/[?&]schema=[^&]*/g, '').replace(/\?$/, '')
    const sep = url.includes('?') ? '&' : '?'
    const storeUrl = `${url}${sep}schema=${schemaName}`

    execSync('npx prisma db push --schema=prisma/schema-store.prisma --skip-generate --accept-data-loss', {
        stdio: 'inherit',
        env: { ...process.env, STORE_DATABASE_URL: storeUrl, DATABASE_URL: storeUrl },
    })
    console.log(`✅ Tables pushed to: ${schemaName}`)
}

async function main() {
    const stores = await p.$queryRaw<{ id: string; code: string; schema: string }[]>`SELECT id, code, schema FROM "Store"`
    console.log(`Found ${stores.length} stores:`)
    stores.forEach(s => console.log(`  - ${s.code} → ${s.schema}`))

    for (const store of stores) {
        await pushSchemaToStore(store.schema)
    }

    console.log('\n✅ All store schemas initialized!')
    await p.$disconnect()
}

main().catch(async (e) => {
    console.error(e)
    await p.$disconnect()
    process.exit(1)
})
