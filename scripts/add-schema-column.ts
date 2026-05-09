import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

async function main() {
    // Add schema column with empty default (to allow adding to existing rows)
    await p.$executeRawUnsafe(`ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS schema TEXT NOT NULL DEFAULT ''`)
    console.log('✅ Added schema column')

    // Update existing rows with generated schema names from store code
    const stores = await p.$queryRaw<{ id: string; code: string }[]>`SELECT id, code FROM "Store"`
    for (const s of stores) {
        const schemaName = 'store_' + s.code.toLowerCase().replace(/[^a-z0-9]/g, '_')
        await p.$executeRawUnsafe(`UPDATE "Store" SET schema = $1 WHERE id = $2`, schemaName, s.id)
        console.log(`  Updated store ${s.code} → ${schemaName}`)
    }

    // Add unique constraint (ignore if already exists)
    try {
        await p.$executeRawUnsafe(`ALTER TABLE "Store" ADD CONSTRAINT "Store_schema_key" UNIQUE (schema)`)
        console.log('✅ Added unique constraint on schema')
    } catch (e: any) {
        if (e.message?.includes('already exists')) {
            console.log('ℹ️  Unique constraint already exists')
        } else {
            throw e
        }
    }

    console.log('\n✅ Migration complete!')
    await p.$disconnect()
}

main().catch(async (e) => {
    console.error(e)
    await p.$disconnect()
    process.exit(1)
})
