const { PrismaClient } = require('./node_modules/@prisma/client')
const registry = new PrismaClient()

async function main() {
    const stores = [
        { code: 'KENGI-HCM', name: 'Kengi Tech - HCM (Demo)', schema: 'store_kengi', status: 'active' },
        { code: 'KENGI-HN', name: 'Kengi Tech - HN (Demo)', schema: 'store_kengi2311', status: 'active' },
    ]
    for (const s of stores) {
        const result = await registry.store.upsert({
            where: { code: s.code },
            update: { name: s.name, schema: s.schema, status: s.status },
            create: s,
        })
        console.log('OK:', result.code, '->', result.schema)
    }
    await registry.$disconnect()
    console.log('Done!')
}
main().catch(e => { console.error(e.message); process.exit(1) })
