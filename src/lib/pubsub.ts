// ═══════════════════════════════════════════════════════════════════════════════
// Redis Pub/Sub — Publish store events for realtime broadcasting
// ═══════════════════════════════════════════════════════════════════════════════

import Redis from 'ioredis'
import { EventEmitter } from 'events'

const REDIS_URL = process.env.REDIS_URL || ''

// Dedicated publisher connection (separate from cache connection)
let publisher: Redis | null = null
let subscriberClient: Redis | null = null
let useLocalEmitter = false

// Fallback: in-process EventEmitter for single-instance mode (no Redis)
export const localEmitter = new EventEmitter()
localEmitter.setMaxListeners(100)

// ─── Initialize Publisher ───────────────────────────────────────────────────

function initPublisher(): Redis | null {
    if (!REDIS_URL) {
        console.log('📡 Redis Pub/Sub: No REDIS_URL — using in-process EventEmitter')
        useLocalEmitter = true
        return null
    }
    try {
        const client = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
                if (times > 3) {
                    console.warn('⚠️ Redis PubSub publisher failed — falling back to local emitter')
                    useLocalEmitter = true
                    return null
                }
                return Math.min(times * 200, 2000)
            },
            lazyConnect: true,
        })

        client.on('error', (err) => {
            if (!useLocalEmitter) {
                console.warn('⚠️ Redis PubSub publisher error:', err.message)
                useLocalEmitter = true
            }
        })

        client.on('connect', () => {
            console.log('✅ Redis PubSub publisher connected')
            useLocalEmitter = false
        })

        client.connect().catch(() => {
            useLocalEmitter = true
        })

        return client
    } catch {
        useLocalEmitter = true
        return null
    }
}

// ─── Create Subscriber (for WebSocket server) ──────────────────────────────

export function createSubscriber(): Redis | null {
    if (!REDIS_URL) return null
    try {
        const client = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
                if (times > 5) return null
                return Math.min(times * 300, 3000)
            },
            lazyConnect: true,
        })

        client.on('error', (err) => {
            console.warn('⚠️ Redis PubSub subscriber error:', err.message)
        })

        client.on('connect', () => {
            console.log('✅ Redis PubSub subscriber connected')
        })

        client.connect().catch(() => {
            console.warn('⚠️ Redis subscriber connection failed')
        })

        return client
    } catch {
        return null
    }
}

// ─── Publish Event ──────────────────────────────────────────────────────────

export interface StoreEvent {
    type: string                // e.g. 'transaction:created'
    storeSchema: string         // which store this belongs to
    branchId?: string | null    // specific branch
    data: any                   // the event payload
    timestamp: string           // ISO timestamp
}

/**
 * Publish an event to a store's channel.
 * Channel pattern: "store:{storeSchema}:events"
 */
export async function publishEvent(
    storeSchema: string | undefined,
    type: string,
    data: any,
    branchId?: string | null
): Promise<void> {
    if (!storeSchema) return

    const event: StoreEvent = {
        type,
        storeSchema,
        branchId: branchId || null,
        data,
        timestamp: new Date().toISOString(),
    }

    const channel = `store:${storeSchema}:events`

    if (useLocalEmitter || !publisher) {
        // In-process fallback — directly emit
        localEmitter.emit(channel, JSON.stringify(event))
        // Also notify SSE clients
        localEmitter.emit('sse-broadcast', storeSchema, type, data)
        console.log(`📡 [Local] Published ${type} on ${channel}`)
        return
    }

    try {
        await publisher.publish(channel, JSON.stringify(event))
        console.log(`📡 [Redis] Published ${type} on ${channel}`)
    } catch (err: any) {
        console.warn(`⚠️ Redis publish failed, falling back to local:`, err.message)
        localEmitter.emit(channel, JSON.stringify(event))
    }
}

/**
 * Check if running in local-emitter mode (no Redis).
 */
export function isUsingLocalEmitter(): boolean {
    return useLocalEmitter
}

/**
 * Disconnect publisher.
 */
export async function pubsubDisconnect(): Promise<void> {
    if (publisher) {
        await publisher.quit().catch(() => { })
    }
    localEmitter.removeAllListeners()
}

// ─── Init on load ───────────────────────────────────────────────────────────
publisher = initPublisher()
