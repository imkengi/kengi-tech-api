import { registryPrisma } from './prisma'

const TTL_MS = 30_000
const MAX_ENTRIES = 5000

type Entry = { status: string | null; expiresAt: number }
const cache = new Map<string, Entry>()

function evictIfNeeded() {
    if (cache.size <= MAX_ENTRIES) return
    // Drop the oldest insertion (Map preserves insertion order)
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) cache.delete(firstKey)
}

export async function getStoreStatus(storeId: string): Promise<string | null> {
    const now = Date.now()
    const cached = cache.get(storeId)
    if (cached && cached.expiresAt > now) return cached.status

    const store = await registryPrisma.store.findUnique({
        where: { id: storeId },
        select: { status: true },
    })
    const status = store?.status ?? null

    // Refresh insertion order for LRU-ish behaviour
    cache.delete(storeId)
    cache.set(storeId, { status, expiresAt: now + TTL_MS })
    evictIfNeeded()
    return status
}

export function invalidateStoreStatus(storeId: string): void {
    cache.delete(storeId)
}

export function clearStoreStatusCache(): void {
    cache.clear()
}
