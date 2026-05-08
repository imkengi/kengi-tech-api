// ═══════════════════════════════════════════════════════════════════════════════
// WebSocket Server — Realtime event broadcasting to authenticated clients
// ═══════════════════════════════════════════════════════════════════════════════

import { Server as HTTPServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import { createSubscriber, localEmitter, isUsingLocalEmitter, StoreEvent } from './pubsub'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret'
const HEARTBEAT_INTERVAL = 30_000 // 30s ping/pong

interface AuthenticatedSocket extends WebSocket {
    storeSchema?: string
    userId?: string
    isAlive?: boolean
}

// Track active subscriptions per store
const storeSubscriptions = new Map<string, Set<AuthenticatedSocket>>()

// ─── Setup WebSocket Server ─────────────────────────────────────────────────

export function setupWebSocket(server: HTTPServer): WebSocketServer {
    const wss = new WebSocketServer({
        server,
        path: '/ws',
        maxPayload: 1024 * 64, // 64KB max message
    })

    console.log('🔌 WebSocket server attached at /ws')

    // ── Redis subscriber for cross-instance messaging ──────────────────────
    const subscriber = createSubscriber()

    if (subscriber) {
        // Use psubscribe to match all store channels
        subscriber.psubscribe('store:*:events', (err) => {
            if (err) console.error('❌ Redis psubscribe failed:', err)
            else console.log('✅ WebSocket server subscribed to store:*:events')
        })

        subscriber.on('pmessage', (_pattern: string, _channel: string, message: string) => {
            try {
                const event: StoreEvent = JSON.parse(message)
                broadcastToStore(event)
            } catch (err) {
                console.warn('⚠️ Invalid PubSub message:', err)
            }
        })
    } else {
        // Local emitter fallback — listen for events from same process
        console.log('📡 WebSocket using local EventEmitter (single-instance mode)')
    }

    // ── Connection handler ─────────────────────────────────────────────────
    wss.on('connection', (ws: AuthenticatedSocket, req) => {
        // Authenticate via query param: /ws?token=JWT
        const url = new URL(req.url || '', `http://${req.headers.host}`)
        const token = url.searchParams.get('token')

        if (!token) {
            ws.close(4001, 'Authentication required')
            return
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET) as any
            ws.storeSchema = decoded.storeSchema
            ws.userId = decoded.userId
            ws.isAlive = true
        } catch {
            ws.close(4002, 'Invalid token')
            return
        }

        // Register this socket for its store
        const schema = ws.storeSchema!
        if (!storeSubscriptions.has(schema)) {
            storeSubscriptions.set(schema, new Set())

            // Subscribe to local emitter for this store's channel (fallback mode)
            if (isUsingLocalEmitter()) {
                const channel = `store:${schema}:events`
                const handler = (message: string) => {
                    try {
                        const event: StoreEvent = JSON.parse(message)
                        broadcastToStore(event)
                    } catch { }
                }
                localEmitter.on(channel, handler)
                    // Store handler reference for cleanup
                    ; (storeSubscriptions.get(schema) as any)._localHandler = handler
                    ; (storeSubscriptions.get(schema) as any)._localChannel = channel
            }
        }
        storeSubscriptions.get(schema)!.add(ws)

        const clientCount = storeSubscriptions.get(schema)!.size
        console.log(`🔌 WS connected: user=${ws.userId} store=${schema} (${clientCount} active)`)

        // Send welcome message
        ws.send(JSON.stringify({
            type: 'connected',
            message: 'Kết nối realtime thành công',
            timestamp: new Date().toISOString(),
        }))

        // Pong handler for heartbeat
        ws.on('pong', () => {
            ws.isAlive = true
        })

        // Handle client messages (future: subscribe to specific channels)
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString())
                if (msg.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }))
                }
            } catch { /* ignore invalid messages */ }
        })

        // Cleanup on disconnect
        ws.on('close', () => {
            const sockets = storeSubscriptions.get(schema)
            if (sockets) {
                sockets.delete(ws)
                console.log(`🔌 WS disconnected: user=${ws.userId} store=${schema} (${sockets.size} remain)`)

                // Cleanup empty store subscription + local handler
                if (sockets.size === 0) {
                    if (isUsingLocalEmitter()) {
                        const handler = (sockets as any)._localHandler
                        const channel = (sockets as any)._localChannel
                        if (handler && channel) {
                            localEmitter.off(channel, handler)
                        }
                    }
                    storeSubscriptions.delete(schema)
                }
            }
        })

        ws.on('error', (err) => {
            console.warn(`⚠️ WS error for user=${ws.userId}:`, err.message)
        })
    })

    // ── Heartbeat: ping every 30s, kill dead connections ───────────────────
    const heartbeat = setInterval(() => {
        wss.clients.forEach((ws: WebSocket) => {
            const authWs = ws as AuthenticatedSocket
            if (authWs.isAlive === false) {
                return authWs.terminate()
            }
            authWs.isAlive = false
            authWs.ping()
        })
    }, HEARTBEAT_INTERVAL)

    wss.on('close', () => {
        clearInterval(heartbeat)
        if (subscriber) subscriber.quit().catch(() => { })
    })

    return wss
}

// ─── Broadcast to Store ─────────────────────────────────────────────────────

function broadcastToStore(event: StoreEvent): void {
    const sockets = storeSubscriptions.get(event.storeSchema)
    if (!sockets || sockets.size === 0) return

    const message = JSON.stringify(event)
    let sentCount = 0

    sockets.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message)
            sentCount++
        }
    })

    if (sentCount > 0) {
        console.log(`📤 Broadcast ${event.type} to ${sentCount} clients in store:${event.storeSchema}`)
    }
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export function getWebSocketStats(): { stores: number; connections: number } {
    let connections = 0
    storeSubscriptions.forEach((sockets) => {
        connections += sockets.size
    })
    return { stores: storeSubscriptions.size, connections }
}
