// Recover all store schemas and re-register them
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const registry = new PrismaClient()

const SCHEMAS = [
    'branch_cmm64d5kt0000s601vr4djk39',
    'store_kengi',
    'store_kengi2311',
]

function getClient(schema) {
    const { PrismaClient: StorePrisma } = require('./src/generated/store-client')
    const base = process.env.DATABASE_URL || ''
    const sep = base.includes('?') ? '&' : '?'
    return new StorePrisma({ datasources: { db: { url: `${base}${sep}schema=${schema}` } } })
}

async function main() {
    // Check existing stores
    const existing = await registry.store.findMany({ select: { code: true, schema: true } })
    console.log('Existing stores:', existing.map(s => s.code))

    for (const schema of SCHEMAS) {
        try {
            const sc = getClient(schema)
            const [settings, branches, users, productCount, txCount] = await Promise.all([
                sc.storeSettings.findUnique({ where: { id: 'default' } }),
                sc.branch.findMany({ select: { id: true, name: true, code: true } }),
                sc.user.findMany({ select: { email: true, role: true, name: true } }),
                sc.product.count(),
                sc.transaction.count(),
            ])

            console.log(`\n=== ${schema} ===`)
            console.log(`  Products: ${productCount}, Transactions: ${txCount}`)
            console.log(`  Settings name: ${settings?.name}`)
            console.log(`  Branches:`, branches.map(b => b.code))
            console.log(`  Users:`, users.map(u => `${u.email}(${u.role})`))

            await sc.$disconnect()
        } catch (e) {
            console.log(`  ${schema}: ERROR - ${e.message.substring(0, 80)}`)
        }
    }

    await registry.$disconnect()
}

main().catch(e => console.error(e.message))
