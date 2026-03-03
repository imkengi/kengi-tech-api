import { PrismaClient } from '@prisma/client'

const registry = new PrismaClient()

async function main() {
    // List all stores in registry
    const stores = await (registry as any).store.findMany({
        select: { code: true, name: true, schema: true, status: true },
    })
    console.log('=== STORES IN REGISTRY ===')
    console.log(JSON.stringify(stores, null, 2))

    // List all postgres schemas
    const schemas: any[] = await registry.$queryRaw`
        SELECT schema_name FROM information_schema.schemata 
        WHERE schema_name NOT IN ('public','information_schema','pg_catalog','pg_toast')
        AND schema_name NOT LIKE 'pg_%'
        ORDER BY schema_name
    `
    console.log('\n=== POSTGRES SCHEMAS ===')
    schemas.forEach(s => console.log(' -', s.schema_name))

    // For each non-public schema, count key tables
    for (const s of schemas) {
        try {
            const url = (process.env.DATABASE_URL || '') + (process.env.DATABASE_URL?.includes('?') ? '&' : '?') + `schema=${s.schema_name}`
            const { PrismaClient: StorePrisma } = await import('../src/generated/store-client')
            const sc = new StorePrisma({ datasources: { db: { url } } })
            const [products, customers, transactions] = await Promise.all([
                sc.product.count(),
                sc.customer.count(),
                sc.transaction.count(),
            ])
            console.log(`   ${s.schema_name}: products=${products}, customers=${customers}, transactions=${transactions}`)
            await sc.$disconnect()
        } catch (e: any) {
            console.log(`   ${s.schema_name}: error - ${e.message?.substring(0, 60)}`)
        }
    }

    await registry.$disconnect()
}

main().catch(e => { console.error('Error:', e.message); process.exit(1) })
