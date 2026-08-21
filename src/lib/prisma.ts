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
import { chonClientDeThai } from './thaiClientNhanRoi'

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
    /** Số lượt chạy dài đang GIỮ client này (cron đồng bộ, quét toàn bộ). >0 = cấm thải. */
    dangBan: number
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
    // Stash schema name để tiện tra ngược (vd webhook dispatch fast-path).
    ;(client as any).__schema = schemaName

    branchClients.set(schemaName, { client, lastUsed: Date.now(), dangBan: 0 })
    return client
}

/* ─── THẢI CLIENT NHÀN RỖI ────────────────────────────────────────────────────
 *
 * Trước đây client CHỈ bị thải khi map chạm `MAX_BRANCH_CLIENTS` (50) — với 9
 * cửa hàng thì không bao giờ. Cửa hàng ngồi im cả ngày vẫn ôm nguyên
 * `connection_limit` kết nối, và Cloud SQL db-f1-micro chỉ có 50 slot cho TẤT
 * CẢ instance cộng lại.
 *
 * Đo 16/08/2026: nền ~25 kết nối (một instance ấm), đỉnh 45–48 khi có hai
 * instance; chạm trần lúc 10:30 và 13:34 — mỗi lần là
 * `FATAL: remaining connection slots are reserved…`, tức ĐĂNG NHẬP SẬP CHO MỌI
 * CỬA HÀNG chứ không riêng tính năng nào.
 *
 * Thải theo thời gian nhàn rỗi trả kết nối về DB trong lúc vắng khách mà KHÔNG
 * giảm năng lực phục vụ: cửa hàng quay lại chỉ tốn một lần nối lại. Ngưỡng đặt
 * đủ dài để cửa hàng đang bán không bao giờ bị thải giữa chừng.
 */
const NHAN_ROI_MS = parseInt(process.env.PRISMA_IDLE_EVICT_MS || String(10 * 60_000), 10)

function thaiClientNhanRoi(): void {
    /* Phần QUYẾT ĐỊNH nằm ở lib/thaiClientNhanRoi.ts (thuần, có bộ kiểm riêng);
     * ở đây chỉ thi hành. Client đang có lượt chạy dài giữ (dangBan > 0) KHÔNG
     * bị thải — xem giuClient(). */
    const danhSach = [...branchClients.entries()].map(([schema, v]) => ({ schema, lastUsed: v.lastUsed, dangBan: v.dangBan }))
    for (const schema of chonClientDeThai(danhSach, Date.now(), NHAN_ROI_MS)) {
        const val = branchClients.get(schema)
        if (!val) continue
        branchClients.delete(schema)
        val.client.$disconnect().catch(() => { })
    }
}

/* Quét mỗi 2 phút. `unref()` để tiến trình không bị giữ sống chỉ vì hẹn giờ này
 * — thiếu nó thì container không thoát được lúc Cloud Run thu hồi. */
if (NHAN_ROI_MS > 0) {
    const hen = setInterval(thaiClientNhanRoi, 2 * 60_000)
    if (typeof hen.unref === 'function') hen.unref()
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
 * Sync an EXISTING branch schema with the current schema-store.prisma.
 * Unlike createBranchSchema, this propagates errors (no raw-SQL fallback) so
 * the caller can report exactly which schema failed and why. Used by
 * POST /admin/sync-schemas after schema-store.prisma gains tables/columns.
 */
async function syncBranchSchemaTables(schemaName: string): Promise<void> {
    validateSchemaName(schemaName)
    const base = getBaseDbUrl()
    const sep = base.includes('?') ? '&' : '?'
    const schemaUrl = `${base}${sep}schema=${schemaName}`
    execSync('npx prisma db push --schema=prisma/schema-store.prisma --skip-generate --accept-data-loss', {
        stdio: 'pipe',
        env: { ...process.env, STORE_DATABASE_URL: schemaUrl, DATABASE_URL: schemaUrl },
    })
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

/**
 * Client cho schema này ĐANG được giữ sẵn chưa?
 *
 * Dùng cho các lượt QUÉT TOÀN BỘ CỬA HÀNG (vd /admin/health-overview): quét
 * xong thì trả lại đúng những client mà chính lượt quét đã tạo, đừng để lại 9
 * client ấm chỉ vì có người mở trang quản trị.
 */
function dangGiuClient(schemaName: string): boolean {
    return branchClients.has(schemaName)
}

/**
 * Trả client của schema này về (đóng kết nối). Không có thì thôi.
 *
 * Chỉ dùng cho lượt quét toàn bộ — ĐỪNG gọi trên đường phục vụ request thường,
 * cửa hàng đang bán mà bị đóng client là mỗi request phải nối lại.
 */
function traClient(schemaName: string): void {
    const c = branchClients.get(schemaName)
    if (!c) return
    // Lượt chạy dài khác đang giữ → để yên, họ sẽ nhả sau.
    if (c.dangBan > 0) return
    branchClients.delete(schemaName)
    c.client.$disconnect().catch(() => { })
}

/**
 * GIỮ client cho một lượt chạy dài, trả về hàm NHẢ. Dùng dạng:
 *
 *     const nha = giuClient(schema)
 *     try { …chạy hàng chục phút… } finally { nha() }
 *
 * ⚠ VÌ SAO PHẢI CÓ (sự cố đêm 17→18/08/2026): bộ thải nhàn rỗi chỉ nhìn
 * `lastUsed`, mà `lastUsed` chỉ được chạm khi ai đó gọi getStorePrisma().
 * Cron đồng bộ gọi hàm đó MỘT LẦN đầu lượt rồi giữ tham chiếu client suốt cả
 * lượt — một lượt kéo lịch sử có thể dài hàng chục phút. Đến phút thứ 10 bộ
 * thải coi client là nhàn rỗi và $disconnect() NGAY DƯỚI CHÂN cron đang chạy.
 *
 * Hậu quả đo được: container tự tắt/khởi động lại 12 lần từ 01:00 đến 06:46,
 * 563 lần "connection limit: 1", 575 lần "Engine is not yet connected" riêng
 * giờ 06h, và 289 đơn chuyển hỏng cùng một phút. Ban ngày không lộ vì request
 * người dùng liên tục chạm client nên lastUsed luôn tươi; BAN ĐÊM chỉ còn cron
 * dùng nên nó chết. Đây là hồi quy do chính cơ chế thải nhàn rỗi thêm ngày
 * 16/08 gây ra — nó đúng ở nửa "cửa hàng ngồi im", sai ở nửa "cron chạy dài".
 *
 * Nhả bằng bộ đếm chứ không phải cờ, vì cùng lúc có thể có nhiều lượt giữ
 * (autoSync + feeSync + reconcile cùng một schema).
 */
function giuClient(schemaName: string): () => void {
    getStorePrisma(schemaName)               // đảm bảo tồn tại + chạm lastUsed
    const c = branchClients.get(schemaName)
    if (!c) return () => { }
    c.dangBan++
    let daNha = false
    return () => {
        if (daNha) return                    // gọi nhả hai lần không được trừ hai
        daNha = true
        const cc = branchClients.get(schemaName)
        if (cc && cc.dangBan > 0) { cc.dangBan--; cc.lastUsed = Date.now() }
    }
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
    syncBranchSchemaTables,
    dropBranchSchema,
    disconnectAll,
    dangGiuClient,
    traClient,
    giuClient,
    mapWithConcurrency,
    STORE_FANOUT_CONCURRENCY,
}

// Backward compat aliases
export const storeCodeToSchema = branchIdToSchema
export const createStoreSchema = createBranchSchema
export const dropStoreSchema = dropBranchSchema

// Default export for backward compatibility
export default registryPrisma
