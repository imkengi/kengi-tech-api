/**
 * Migrate ALL existing store schemas to current `prisma/schema-store.prisma`.
 *
 * Reads the registry's Store table, derives each store's schema name, and runs
 * `prisma db push --schema=prisma/schema-store.prisma` against each one. Each
 * store is processed independently — one failure does not abort the run.
 *
 * Usage:  npm run db:migrate:all-stores
 *
 * Env:
 *   DATABASE_URL  — registry connection (required)
 *   STATUS_FILTER — optional CSV of store statuses to include. Default: "active".
 *                   Pass "all" to include every store regardless of status.
 *   ACCEPT_DATA_LOSS — set to "1" to pass --accept-data-loss to prisma db push.
 *                      Default: enabled (matches createBranchSchema behavior).
 */

import 'dotenv/config'
import { execSync } from 'child_process'
import { PrismaClient } from '@prisma/client'

type StoreRow = { id: string; code: string; schema: string; status: string }

const ACCEPT_DATA_LOSS = process.env.ACCEPT_DATA_LOSS !== '0'
const STATUS_FILTER = (process.env.STATUS_FILTER || 'active')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

function buildStoreUrl(schemaName: string): string {
    const base = (process.env.DATABASE_URL || '')
        .replace(/[?&]schema=[^&]*/g, '')
        .replace(/\?$/, '')
    if (!base) throw new Error('DATABASE_URL is required')
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}schema=${schemaName}`
}

async function pushSchema(schemaName: string, registry: PrismaClient): Promise<void> {
    // Ensure the PostgreSQL schema exists first; prisma db push needs it
    await registry.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)

    const storeUrl = buildStoreUrl(schemaName)
    const args = ['npx prisma db push', '--schema=prisma/schema-store.prisma', '--skip-generate']
    if (ACCEPT_DATA_LOSS) args.push('--accept-data-loss')

    execSync(args.join(' '), {
        stdio: 'pipe',
        env: { ...process.env, STORE_DATABASE_URL: storeUrl, DATABASE_URL: storeUrl },
    })
}

async function main(): Promise<void> {
    const registry = new PrismaClient()

    let stores: StoreRow[]
    try {
        const all = await registry.$queryRaw<StoreRow[]>`
            SELECT id, code, schema, status FROM "Store" ORDER BY code
        `
        stores = STATUS_FILTER.includes('all')
            ? all
            : all.filter(s => STATUS_FILTER.includes(s.status))
    } catch (err: any) {
        console.error('❌ Failed to query registry Store table:', err.message)
        await registry.$disconnect()
        process.exit(1)
    }

    if (stores.length === 0) {
        console.log(`⚠️  No stores matched filter [${STATUS_FILTER.join(',')}]`)
        await registry.$disconnect()
        return
    }

    console.log(`\n🔍 Migrating ${stores.length} store schema(s)`)
    console.log(`   Schema file:    prisma/schema-store.prisma`)
    console.log(`   Status filter:  ${STATUS_FILTER.join(',')}`)
    console.log(`   --accept-data-loss: ${ACCEPT_DATA_LOSS ? 'yes' : 'no'}\n`)

    const results: { store: string; schema: string; ok: boolean; error?: string }[] = []

    for (const store of stores) {
        const label = `${store.code} (${store.schema})`
        process.stdout.write(`▶  ${label} ... `)
        try {
            await pushSchema(store.schema, registry)
            console.log('✅ pushed')
            results.push({ store: store.code, schema: store.schema, ok: true })
        } catch (err: any) {
            const msg = (err.stderr?.toString() || err.message || String(err))
                .split('\n').slice(0, 4).join(' | ').slice(0, 240)
            console.log(`❌ failed: ${msg}`)
            results.push({ store: store.code, schema: store.schema, ok: false, error: msg })
        }
    }

    await registry.$disconnect()

    const ok = results.filter(r => r.ok)
    const failed = results.filter(r => !r.ok)

    console.log('\n────── Summary ──────')
    console.log(`Total:    ${results.length}`)
    console.log(`Success:  ${ok.length}`)
    console.log(`Failed:   ${failed.length}`)
    if (failed.length) {
        console.log('\nFailures:')
        for (const f of failed) console.log(`  - ${f.store} (${f.schema}): ${f.error}`)
        process.exit(2)
    }
}

main().catch(async (e) => {
    console.error('Fatal error:', e)
    process.exit(1)
})
