// Check what's in branch_cmm64d5kt0000s601vr4djk39 and re-link KENGI store to correct schema
import { PrismaClient } from '@prisma/client'
import { PrismaClient as StorePrisma } from '../src/generated/store-client'

const registry = new PrismaClient()
const OLD_SCHEMA = 'branch_cmm64d5kt0000s601vr4djk39'

function getClient(schema: string) {
    const base = process.env.DATABASE_URL || ''
    const sep = base.includes('?') ? '&' : '?'
    return new StorePrisma({ datasources: { db: { url: `${base}${sep}schema=${schema}` } } })
}

async function main() {
    const old = getClient(OLD_SCHEMA)

    // Check what's in old schema
    const [products, customers, transactions, users, branches] = await Promise.all([
        old.product.count(),
        old.customer.count(),
        old.transaction.count(),
        old.user.findMany({ select: { email: true, role: true, name: true } }),
        old.branch.findMany({ select: { id: true, name: true, code: true, isMainBranch: true } }),
    ])

    console.log(`\n=== ${OLD_SCHEMA} ===`)
    console.log(`  Products: ${products}, Customers: ${customers}, Transactions: ${transactions}`)
    console.log('  Users:', JSON.stringify(users, null, 2))
    console.log('  Branches:', JSON.stringify(branches, null, 2))

    // Update KENGI store to point to old schema
    await registry.store.update({
        where: { code: 'KENGI' },
        data: { schema: OLD_SCHEMA },
    })
    console.log(`\n✅ Updated KENGI store → schema: ${OLD_SCHEMA}`)

    await old.$disconnect()
    await registry.$disconnect()
    console.log('\nDone! Login with your original admin credentials.')
}

main().catch(e => { console.error('Error:', e.message); process.exit(1) })
