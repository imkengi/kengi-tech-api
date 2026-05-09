// ═══════════════════════════════════════════════════════════════════════════════
// PrismaManager — Multi-schema database manager
//
// Architecture:
//   registry        → public schema (Store lookup)
//   branch_<id>     → per-branch schema (all business data for that branch)
//
// Each branch has its own isolated PostgreSQL schema.
// Schema is created on first signup, or when a new branch is added.
//
// Usage in routes:
//   const prisma = req.storePrisma!   // per-branch client (attached by auth middleware)
//   const products = await prisma.product.findMany()  // no storeId/branchId filter needed
// ═══════════════════════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client'
import { PrismaClient as StorePrisma } from '../generated/store-client'
import { execSync } from 'child_process'

const POOL_SIZE = parseInt(process.env.PRISMA_POOL_SIZE || '3', 10)
const POOL_TIMEOUT = parseInt(process.env.PRISMA_POOL_TIMEOUT || '10', 10)
const MAX_BRANCH_CLIENTS = parseInt(process.env.MAX_STORE_CLIENTS || '50', 10)

// ─── Registry Client (public schema — Store lookup only) ────────────────────

const registryPrisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL || '' } },
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['warn', 'error'],
})

// ─── Branch Client Cache (LRU) ───────────────────────────────────────────────

interface CachedClient {
    client: StorePrisma
    lastUsed: number
}

const branchClients = new Map<string, CachedClient>()

function getBaseDbUrl(): string {
    const url = process.env.DATABASE_URL || ''
    return url.replace(/[?&]schema=[^&]*/g, '').replace(/\?$/, '')
}

/**
 * Convert branch ID to PostgreSQL schema name.
 * e.g. "cm1a2b3c..." → "branch_cm1a2b3c"
 */
function branchIdToSchema(branchId: string): string {
    // Sanitize: only allow alphanumeric and underscores
    const safe = branchId.toLowerCase().replace(/[^a-z0-9]/g, '')
    return `branch_${safe}`
}

/**
 * Validate schema name to prevent SQL injection in raw queries.
 * Schema names must only contain lowercase alphanumeric chars and underscores.
 * Throws if invalid.
 */
function validateSchemaName(schemaName: string): void {
    if (!/^[a-z0-9_]+$/.test(schemaName)) {
        throw new Error(`Invalid schema name: "${schemaName}" — only [a-z0-9_] allowed`)
    }
    if (schemaName.length > 63) {
        throw new Error(`Schema name too long: "${schemaName}" (max 63 chars)`)
    }
}

/**
 * Get a Prisma client connected to a specific branch's schema.
 * Clients are cached and reused across requests (LRU eviction).
 */
function getStorePrisma(schemaName: string): StorePrisma {
    validateSchemaName(schemaName)
    const existing = branchClients.get(schemaName)
    if (existing) {
        existing.lastUsed = Date.now()
        return existing.client
    }

    // Evict least-recently-used if at capacity
    if (branchClients.size >= MAX_BRANCH_CLIENTS) {
        let oldest: string | null = null
        let oldestTime = Infinity
        for (const [key, val] of branchClients) {
            if (val.lastUsed < oldestTime) {
                oldestTime = val.lastUsed
                oldest = key
            }
        }
        if (oldest) {
            branchClients.get(oldest)?.client.$disconnect().catch(() => { })
            branchClients.delete(oldest)
        }
    }

    const base = getBaseDbUrl()
    const sep = base.includes('?') ? '&' : '?'
    // IMPORTANT: Adding application_name=${schemaName} forces Prisma to treat this as a unique connection pool
    // This prevents the severe bug where multiple PrismaClients share the search_path of the first loaded schema
    const url = `${base}${sep}schema=${schemaName}&application_name=${schemaName}&connection_limit=${POOL_SIZE}&pool_timeout=${POOL_TIMEOUT}`

    const client = new StorePrisma({
        datasources: { db: { url } },
        log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['warn', 'error'],
    })

    branchClients.set(schemaName, { client, lastUsed: Date.now() })
    return client
}

// ─── Schema Management ──────────────────────────────────────────────────────

/**
 * Create a new PostgreSQL schema and push all branch tables into it.
 * Called at signup (main branch) and when adding new branches.
 *
 * @param schemaName  PostgreSQL schema name (e.g. "branch_cm1a2b3c")
 */
async function createBranchSchema(schemaName: string): Promise<void> {
    validateSchemaName(schemaName)
    // 1. Create the schema if it doesn't exist
    await registryPrisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)
    console.log(`📦 Schema created: ${schemaName}`)

    // 2. Push tables using prisma db push
    const base = getBaseDbUrl()
    const sep = base.includes('?') ? '&' : '?'
    const schemaUrl = `${base}${sep}schema=${schemaName}`

    try {
        execSync('npx prisma db push --schema=prisma/schema-store.prisma --skip-generate --accept-data-loss', {
            stdio: 'pipe',
            env: { ...process.env, STORE_DATABASE_URL: schemaUrl, DATABASE_URL: schemaUrl },
        })
        console.log(`✅ Tables pushed to schema: ${schemaName}`)
    } catch (err: any) {
        // If prisma db push fails, try to create tables with raw SQL as fallback
        console.warn(`⚠️ prisma db push failed for ${schemaName}, attempting raw SQL fallback...`)
        await createTablesRawSQL(schemaName)
    }
}

/**
 * Fallback: create minimal tables via raw SQL if prisma db push is unavailable.
 * This creates the core tables needed for a branch to function.
 */
async function createTablesRawSQL(schemaName: string): Promise<void> {
    validateSchemaName(schemaName)
    const q = (sql: string) => registryPrisma.$executeRawUnsafe(sql)

    // Full User table matching schema-store.prisma
    await q(`CREATE TABLE IF NOT EXISTS "${schemaName}"."User" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'cashier',
        phone TEXT,
        avatar TEXT,
        code TEXT,
        salary DOUBLE PRECISION,
        "hireDate" TIMESTAMP,
        shifts INTEGER NOT NULL DEFAULT 0,
        "totalSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "employeeStatus" TEXT NOT NULL DEFAULT 'active',
        notes TEXT,
        "isLocked" BOOLEAN NOT NULL DEFAULT false,
        "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
        "twoFactorSecret" TEXT,
        "trustedDevices" TEXT NOT NULL DEFAULT '[]',
        permissions TEXT NOT NULL DEFAULT '[]',
        "branchId" TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )`)
    // Indexes for User
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS "${schemaName}_User_code_key" ON "${schemaName}"."User" (code) WHERE code IS NOT NULL`)
    await q(`CREATE INDEX IF NOT EXISTS "${schemaName}_User_branchId_idx" ON "${schemaName}"."User" ("branchId")`)
    await q(`CREATE INDEX IF NOT EXISTS "${schemaName}_User_role_idx" ON "${schemaName}"."User" (role)`)
    await q(`CREATE INDEX IF NOT EXISTS "${schemaName}_User_employeeStatus_idx" ON "${schemaName}"."User" ("employeeStatus")`)

    await q(`CREATE TABLE IF NOT EXISTS "${schemaName}"."Branch" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        address TEXT,
        phone TEXT,
        "isMainBranch" BOOLEAN NOT NULL DEFAULT false,
        status TEXT NOT NULL DEFAULT 'active',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )`)

    await q(`CREATE TABLE IF NOT EXISTS "${schemaName}"."StoreSettings" (
        id TEXT PRIMARY KEY,
        name TEXT,
        address TEXT,
        phone TEXT,
        logo TEXT,
        currency TEXT NOT NULL DEFAULT 'VND',
        timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )`)

    console.log(`✅ Core tables created via raw SQL in: ${schemaName}`)
}

/**
 * Drop a branch schema (permanent, use with caution!)
 */
async function dropBranchSchema(schemaName: string): Promise<void> {
    validateSchemaName(schemaName)
    await registryPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    branchClients.get(schemaName)?.client.$disconnect().catch(() => { })
    branchClients.delete(schemaName)
    console.log(`🗑️ Dropped schema: ${schemaName}`)
}

// ─── Disconnect All ─────────────────────────────────────────────────────────

async function disconnectAll(): Promise<void> {
    await registryPrisma.$disconnect()
    for (const [, { client }] of branchClients) {
        await client.$disconnect().catch(() => { })
    }
    branchClients.clear()
}

// ─── Concurrency helper ─────────────────────────────────────────────────────
// Cap concurrent fan-out across stores so we don't blow past Postgres
// max_connections or evict every entry in the LRU cache.

const STORE_FANOUT_CONCURRENCY = parseInt(process.env.STORE_FANOUT_CONCURRENCY || '5', 10)

/**
 * Map an async function over an array with bounded concurrency.
 * Drop-in replacement for `Promise.all(items.map(fn))` when iterating
 * across stores or other heavyweight resources.
 */
async function mapWithConcurrency<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    limit: number = STORE_FANOUT_CONCURRENCY,
): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let cursor = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const i = cursor++
            if (i >= items.length) return
            results[i] = await fn(items[i], i)
        }
    })
    await Promise.all(workers)
    return results
}

// ─── Exports ────────────────────────────────────────────────────────────────

export {
    registryPrisma,
    getStorePrisma,
    branchIdToSchema,
    createBranchSchema,
    dropBranchSchema,
    disconnectAll,
    mapWithConcurrency,
    STORE_FANOUT_CONCURRENCY,
}

// Backward compat aliases
export const storeCodeToSchema = branchIdToSchema
export const createStoreSchema = createBranchSchema
export const dropStoreSchema = dropBranchSchema

// Default export for backward compatibility
export default registryPrisma
