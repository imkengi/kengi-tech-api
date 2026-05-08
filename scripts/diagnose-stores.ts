/**
 * diagnose-stores.ts — Check Store registry + schema health
 *
 * Run: npx tsx scripts/diagnose-stores.ts
 *
 * This script:
 *   1. Lists all stores in the registry with their schema mappings
 *   2. Detects duplicate/shared schemas (KENGI-HCM ↔ KENGIONLINE bug)
 *   3. Checks if each PostgreSQL schema actually exists
 *   4. Checks if the User table has all required columns
 *   5. Optionally fixes the schema mapping for a store
 */

import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'
dotenv.config()

const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
})

async function main() {
    console.log('═══════════════════════════════════════════════════')
    console.log('  Open Retail — Store Registry Diagnostic')
    console.log('═══════════════════════════════════════════════════\n')

    // 1. List all stores
    const stores = await prisma.store.findMany({ orderBy: { createdAt: 'asc' } })
    console.log(`📋 Total stores in registry: ${stores.length}\n`)

    for (const s of stores) {
        console.log(`  Store: ${s.code}`)
        console.log(`    ID:     ${s.id}`)
        console.log(`    Name:   ${s.name}`)
        console.log(`    Schema: ${s.schema}`)
        console.log(`    Status: ${s.status}`)
        console.log(`    Plan:   ${s.plan}`)
        console.log(`    Created: ${s.createdAt.toISOString()}`)
        console.log()
    }

    // 2. Check for duplicate schemas
    const schemaMap = new Map<string, string[]>()
    for (const s of stores) {
        const list = schemaMap.get(s.schema) || []
        list.push(s.code)
        schemaMap.set(s.schema, list)
    }

    console.log('─── Duplicate Schema Check ───')
    let hasDuplicates = false
    for (const [schema, codes] of schemaMap) {
        if (codes.length > 1) {
            hasDuplicates = true
            console.log(`  ❌ DUPLICATE: schema "${schema}" shared by: ${codes.join(', ')}`)
        }
    }
    if (!hasDuplicates) {
        console.log('  ✅ No duplicate schemas found')
    }

    // 3. Check if schemas exist in PostgreSQL
    console.log('\n─── Schema Existence Check ───')
    const existingSchemas = await prisma.$queryRaw<{ schema_name: string }[]>`
        SELECT schema_name FROM information_schema.schemata
        WHERE schema_name LIKE 'branch_%' OR schema_name LIKE 'store_%' OR schema_name LIKE 'pending_%'
    `
    const existingSet = new Set(existingSchemas.map(s => s.schema_name))

    for (const s of stores) {
        const exists = existingSet.has(s.schema)
        console.log(`  ${exists ? '✅' : '❌'} ${s.code} → "${s.schema}" ${exists ? '(exists)' : '(MISSING!)'}`)
    }

    // 4. Check User table columns in each schema
    console.log('\n─── User Table Column Check ───')
    const requiredColumns = [
        'id', 'email', 'name', 'password', 'role', 'phone', 'avatar', 'code',
        'employeeStatus', 'isLocked', 'twoFactorEnabled', 'twoFactorSecret',
        'trustedDevices', 'permissions', 'branchId', 'createdAt', 'updatedAt',
    ]

    for (const s of stores) {
        if (!existingSet.has(s.schema)) continue
        try {
            const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
                `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'User'`,
                s.schema
            )
            const colSet = new Set(columns.map(c => c.column_name))
            const missing = requiredColumns.filter(c => !colSet.has(c))
            if (missing.length > 0) {
                console.log(`  ⚠️  ${s.code} (${s.schema}): missing columns: ${missing.join(', ')}`)
            } else {
                console.log(`  ✅ ${s.code} (${s.schema}): all required columns present`)
            }

            // Count users
            const userCount = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
                `SELECT COUNT(*) as count FROM "${s.schema}"."User"`
            )
            console.log(`     └─ Users: ${userCount[0]?.count || 0}`)
        } catch (err: any) {
            console.log(`  ❌ ${s.code} (${s.schema}): error checking — ${err.message}`)
        }
    }

    // 5. Expected schema mapping check
    console.log('\n─── Expected Schema Mapping ───')
    for (const s of stores) {
        const safe = s.id.toLowerCase().replace(/[^a-z0-9]/g, '')
        const expected = `branch_${safe}`
        const match = s.schema === expected
        if (!match) {
            console.log(`  ⚠️  ${s.code}: schema="${s.schema}" but expected="${expected}"`)
        } else {
            console.log(`  ✅ ${s.code}: schema matches expected`)
        }
    }

    // 6. List orphan schemas (schemas that exist but no store points to)
    console.log('\n─── Orphan Schemas ───')
    const usedSchemas = new Set(stores.map(s => s.schema))
    const orphans = existingSchemas.filter(s => !usedSchemas.has(s.schema_name))
    if (orphans.length > 0) {
        for (const o of orphans) {
            console.log(`  🔷 "${o.schema_name}" — not referenced by any store`)
        }
    } else {
        console.log('  ✅ No orphan schemas')
    }

    console.log('\n═══════════════════════════════════════════════════')
    console.log('  Diagnostic complete')
    console.log('═══════════════════════════════════════════════════\n')

    // If --fix flag, offer fix suggestions
    if (process.argv.includes('--fix')) {
        console.log('🔧 FIX MODE: Correcting schema mappings...\n')
        for (const s of stores) {
            const safe = s.id.toLowerCase().replace(/[^a-z0-9]/g, '')
            const expected = `branch_${safe}`
            if (s.schema !== expected && existingSet.has(expected)) {
                console.log(`  Fixing ${s.code}: "${s.schema}" → "${expected}"`)
                await prisma.store.update({
                    where: { id: s.id },
                    data: { schema: expected },
                })
                console.log(`  ✅ Fixed!`)
            } else if (s.schema !== expected && !existingSet.has(expected)) {
                console.log(`  ⚠️  ${s.code}: expected schema "${expected}" does not exist — skipping`)
            }
        }
    } else {
        console.log('💡 Run with --fix to auto-correct schema mappings:')
        console.log('   npx tsx scripts/diagnose-stores.ts --fix\n')
    }
}

main()
    .catch(err => {
        console.error('Fatal error:', err)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
