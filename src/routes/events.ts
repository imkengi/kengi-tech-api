// ═══════════════════════════════════════════════════════════════════════════════
// SSE (Server-Sent Events) — Realtime push over plain HTTPS
// Bypasses CSP restrictions that block WebSocket (wss:)
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { localEmitter } from '../lib/pubsub'

const router = Router()

// Track active SSE connections per store schema
const sseClients = new Map<string, Set<Response>>()

// ─── SSE Endpoint: GET /api/events ──────────────────────────────────────────
router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
    const schema = req.user?.storeSchema
    if (!schema) {
        res.status(401).json({ error: 'Unauthorized' })
        return
    }

    // Disable request timeout for SSE
    req.socket.setTimeout(0)
    req.socket.setNoDelay(true)
    req.socket.setKeepAlive(true)

    // Set SSE headers — use res.set + res.flushHeaders instead of res.writeHead
    // to work properly with Express middleware chain
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx/proxy buffering
    })
    res.flushHeaders()

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Realtime connected', timestamp: new Date().toISOString() })}\n\n`)

    // Register this connection
    if (!sseClients.has(schema)) {
        sseClients.set(schema, new Set())
    }
    sseClients.get(schema)!.add(res)
    const count = sseClients.get(schema)!.size
    console.log(`📡 SSE connected: store=${schema} (${count} active)`)

    // Keep alive — send comment every 15s to prevent Cloud Run timeout
    const keepAlive = setInterval(() => {
        try {
            res.write(': keepalive\n\n')
        } catch {
            clearInterval(keepAlive)
        }
    }, 15000)

    // Cleanup on disconnect
    const cleanup = () => {
        clearInterval(keepAlive)
        const clients = sseClients.get(schema)
        if (clients) {
            clients.delete(res)
            console.log(`📡 SSE disconnected: store=${schema} (${clients.size} remain)`)
            if (clients.size === 0) sseClients.delete(schema)
        }
    }

    req.on('close', cleanup)
    req.on('error', cleanup)
    res.on('close', cleanup)
    res.on('error', cleanup)
})

// ─── Broadcast function — called when events are published ──────────────────

export function broadcastSSE(storeSchema: string, type: string, data: any): void {
    const clients = sseClients.get(storeSchema)
    if (!clients || clients.size === 0) return

    const message = JSON.stringify({ type, data, storeSchema, timestamp: new Date().toISOString() })
    let sent = 0

    clients.forEach((res) => {
        try {
            res.write(`data: ${message}\n\n`)
            sent++
        } catch {
            // Client disconnected, will be cleaned up
        }
    })

    if (sent > 0) {
        console.log(`📤 SSE broadcast ${type} to ${sent} clients in ${storeSchema}`)
    }
}

// ─── Wire up local EventEmitter to SSE broadcast ────────────────────────────
localEmitter.on('sse-broadcast', (storeSchema: string, type: string, data: any) => {
    broadcastSSE(storeSchema, type, data)
})

// ─── Stats ──────────────────────────────────────────────────────────────────
export function getSSEStats(): { stores: number; connections: number } {
    let connections = 0
    sseClients.forEach((clients) => {
        connections += clients.size
    })
    return { stores: sseClients.size, connections }
}

export default router
