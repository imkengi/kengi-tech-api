// ═══════════════════════════════════════════════════════════════════════════════
// Redis Cache — Real implementation with in-memory fallback
// ═══════════════════════════════════════════════════════════════════════════════

import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || ''
let redis: Redis | null = null
let memoryCache = new Map<string, { value: string; expiresAt: number }>()
let useMemory = false

// ─── Initialize ─────────────────────────────────────────────────────────────

function initRedis(): Redis | null {
    if (!REDIS_URL) {
        console.log('⚡ Redis URL not set — using in-memory cache')
        useMemory = true
        return null
    }
    try {
        const client = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
                if (times > 3) {
                    console.warn('⚠️ Redis connection failed — falling back to in-memory cache')
                    useMemory = true
                    return null // stop retrying
                }
                return Math.min(times * 200, 2000)
            },
            lazyConnect: true,
        })

        client.on('error', (err) => {
            if (!useMemory) {
                console.warn('⚠️ Redis error, falling back to memory:', err.message)
                useMemory = true
            }
        })

        client.on('connect', () => {
            console.log('✅ Redis connected')
            useMemory = false
        })

        client.connect().catch(() => {
            useMemory = true
        })

        return client
    } catch {
        useMemory = true
        return null
    }
}

redis = initRedis()

// ─── Memory Cache Helpers ───────────────────────────────────────────────────

function memGet(key: string): string | null {
    const entry = memoryCache.get(key)
    if (!entry) return null
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
        memoryCache.delete(key)
        return null
    }
    return entry.value
}

function memSet(key: string, value: string, ttlMs: number): void {
    // Limit memory cache size to 1000 entries
    if (memoryCache.size > 1000) {
        const first = memoryCache.keys().next().value
        if (first) memoryCache.delete(first)
    }
    memoryCache.set(key, { value, expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0 })
}

function memDel(pattern: string): void {
    if (!pattern.includes('*')) {
        memoryCache.delete(pattern)
        return
    }
    // Convert glob pattern to regex: escape special chars, replace * with .*
    const regexStr = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
    const regex = new RegExp(regexStr)
    for (const key of memoryCache.keys()) {
        if (regex.test(key)) memoryCache.delete(key)
    }
}

/**
 * Đo bộ đệm trong máy (GET /admin/do-bo-nho, 27/10/2026): số mục, tổng ký tự giá trị, số mục đã hết hạn mà còn
 * nằm đó (memGet chỉ xoá mục hết hạn khi bị đọc lại). Heap bản máy chạy lâu ~140MB so với ~55MB lúc mới bật — đo
 * trước rồi mới quyết có phải dọn bộ đệm hay không.
 */
export function thongKeBoDemTrongMay(): { dungBoNho: boolean; soMuc: number; kyTuMB: number; soMucHetHan: number } {
    const nay = Date.now()
    let kyTu = 0, hetHan = 0
    for (const v of memoryCache.values()) {
        kyTu += v.value.length
        if (v.expiresAt > 0 && nay > v.expiresAt) hetHan++
    }
    return { dungBoNho: useMemory || !redis, soMuc: memoryCache.size, kyTuMB: Math.round(kyTu / 104857.6) / 10, soMucHetHan: hetHan }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get a cached value. Returns parsed JSON or null.
 */
export async function cacheGet<T = any>(key: string): Promise<T | null> {
    try {
        if (useMemory || !redis) {
            const raw = memGet(key)
            return raw ? JSON.parse(raw) : null
        }
        const raw = await redis.get(key)
        return raw ? JSON.parse(raw) : null
    } catch {
        return null
    }
}

/**
 * Set a cached value with optional TTL in seconds.
 */
export async function cacheSet(key: string, value: any, ttlSeconds: number = 60): Promise<void> {
    try {
        const json = JSON.stringify(value)
        if (useMemory || !redis) {
            memSet(key, json, ttlSeconds * 1000)
            return
        }
        if (ttlSeconds > 0) {
            await redis.set(key, json, 'EX', ttlSeconds)
        } else {
            await redis.set(key, json)
        }
    } catch { }
}

/**
 * Delete cached values by exact key or pattern (ending with *).
 */
export async function cacheDel(pattern: string): Promise<void> {
    try {
        if (useMemory || !redis) {
            memDel(pattern)
            return
        }
        if (pattern.endsWith('*')) {
            const keys = await redis.keys(pattern)
            if (keys.length > 0) {
                await redis.del(...keys)
            }
        } else {
            await redis.del(pattern)
        }
    } catch { }
}

/**
 * Wrap a DB query with automatic cache-get/cache-set.
 * Returns { data, source } so routes can optionally expose cache status.
 */
export async function withCache<T>(
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>
): Promise<{ data: T; source: 'cache' | 'db' }> {
    const cached = await cacheGet<T>(key)
    if (cached) return { data: cached, source: 'cache' }
    const data = await fetcher()
    await cacheSet(key, data, ttlSeconds)
    return { data, source: 'db' }
}

/**
 * Invalidate all cache for a specific store.
 */
export async function cacheInvalidateStore(storeSchema: string): Promise<void> {
    await cacheDel(`${storeSchema}:*`)
}

/**
 * Disconnect Redis.
 */
export async function cacheDisconnect(): Promise<void> {
    if (redis) {
        await redis.quit().catch(() => { })
    }
    memoryCache.clear()
}

/**
 * Check if Redis is connected and healthy.
 */
export async function cacheHealth(): Promise<{ status: string; type: string }> {
    if (useMemory || !redis) {
        return { status: 'ok', type: 'memory' }
    }
    try {
        await redis.ping()
        return { status: 'ok', type: 'redis' }
    } catch {
        return { status: 'degraded', type: 'memory-fallback' }
    }
}
