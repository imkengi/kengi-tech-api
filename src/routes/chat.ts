import { Router, Response, Request } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { registryPrisma, getStorePrisma } from '../lib/prisma'

const router = Router()

// ─── Zero-Touch Migration ───────────────────────────────────────────────────
// Creates chat tables on first access per store schema

async function ensureChatTables(prisma: any) {
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ChatConversation" (
            "id" TEXT NOT NULL,
            "customerId" TEXT,
            "customerName" TEXT NOT NULL,
            "customerPhone" TEXT,
            "customerEmail" TEXT,
            "customerAvatar" TEXT,
            "platform" TEXT NOT NULL DEFAULT 'website',
            "channelId" TEXT,
            "channelName" TEXT,
            "lastMessage" TEXT,
            "lastMessageAt" TIMESTAMPTZ,
            "unreadCount" INTEGER NOT NULL DEFAULT 0,
            "status" TEXT NOT NULL DEFAULT 'active',
            "assignedTo" TEXT,
            "assignedName" TEXT,
            "orderId" TEXT,
            "orderNumber" TEXT,
            "sessionToken" TEXT,
            "metadata" JSONB,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
        )
    `)

    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ChatMessage" (
            "id" TEXT NOT NULL,
            "conversationId" TEXT NOT NULL,
            "senderId" TEXT,
            "senderName" TEXT NOT NULL,
            "senderType" TEXT NOT NULL DEFAULT 'customer',
            "content" TEXT NOT NULL,
            "contentType" TEXT NOT NULL DEFAULT 'text',
            "imageUrl" TEXT,
            "fileUrl" TEXT,
            "fileName" TEXT,
            "metadata" JSONB,
            "isRead" BOOLEAN NOT NULL DEFAULT false,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id"),
            CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE
        )
    `)

    // Create indexes
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ChatConversation_status_idx" ON "ChatConversation"("status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ChatConversation_platform_idx" ON "ChatConversation"("platform")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ChatConversation_sessionToken_idx" ON "ChatConversation"("sessionToken")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ChatMessage_conversationId_idx" ON "ChatMessage"("conversationId")`)
}

function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function generateSessionToken() {
    return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 12)}`
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── STAFF ENDPOINTS (require auth) ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /conversations — list all conversations
router.get('/conversations', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        console.log('[Chat Debug] GET /conversations - user schema:', req.user?.branchSchema || req.user?.storeSchema, 'storeId:', req.user?.storeId)
        await ensureChatTables(prisma)

        const { search, platform, status, channelId, page = '1', pageSize = '50' } = req.query
        const skip = (parseInt(page as string) - 1) * parseInt(pageSize as string)
        const take = parseInt(pageSize as string)

        let whereClause = 'WHERE 1=1'
        const params: any[] = []
        let paramIdx = 1

        if (search) {
            whereClause += ` AND ("customerName" ILIKE $${paramIdx} OR "lastMessage" ILIKE $${paramIdx} OR "customerPhone" ILIKE $${paramIdx})`
            params.push(`%${search}%`)
            paramIdx++
        }
        if (platform && platform !== 'all') {
            whereClause += ` AND "platform" = $${paramIdx}`
            params.push(platform)
            paramIdx++
        }
        if (channelId && channelId !== 'all') {
            whereClause += ` AND "channelId" = $${paramIdx}`
            params.push(channelId)
            paramIdx++
        }
        if (status && status !== 'all') {
            whereClause += ` AND "status" = $${paramIdx}`
            params.push(status)
            paramIdx++
        }

        const [conversations, countResult] = await Promise.all([
            prisma.$queryRawUnsafe(
                `SELECT * FROM "ChatConversation" ${whereClause} ORDER BY "lastMessageAt" DESC NULLS LAST, "createdAt" DESC LIMIT ${take} OFFSET ${skip}`,
                ...params
            ),
            prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int as count FROM "ChatConversation" ${whereClause}`,
                ...params
            ),
        ])

        res.json({
            success: true,
            data: {
                items: conversations,
                total: (countResult as any[])[0]?.count ?? 0,
            },
        })
    } catch (err) {
        console.error('Get chat conversations error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /conversations/:id/messages — messages in convo
router.get('/conversations/:id/messages', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await ensureChatTables(prisma)
        const { id } = req.params

        const messages = await prisma.$queryRawUnsafe(
            `SELECT * FROM "ChatMessage" WHERE "conversationId" = $1 ORDER BY "createdAt" ASC`,
            id
        )

        res.json({ success: true, data: messages })
    } catch (err) {
        console.error('Get chat messages error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /conversations/:id/messages — staff sends message
router.post('/conversations/:id/messages', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await ensureChatTables(prisma)
        const { id } = req.params
        const { content, contentType = 'text' } = req.body
        const msgId = generateId()
        const senderName = req.user?.email?.split('@')[0] || 'Shop'

        await prisma.$executeRawUnsafe(
            `INSERT INTO "ChatMessage" ("id", "conversationId", "senderId", "senderName", "senderType", "content", "contentType", "isRead", "createdAt")
             VALUES ($1, $2, $3, $4, 'staff', $5, $6, true, NOW())`,
            msgId, id, req.user?.userId ?? '', senderName, content, contentType
        )

        // Update conversation
        await prisma.$executeRawUnsafe(
            `UPDATE "ChatConversation" SET "lastMessage" = $1, "lastMessageAt" = NOW(), "updatedAt" = NOW() WHERE "id" = $2`,
            content.substring(0, 200), id
        )

        res.json({
            success: true,
            data: { id: msgId, conversationId: id, senderName, senderType: 'staff', content, contentType, isRead: true, createdAt: new Date().toISOString() },
        })
    } catch (err) {
        console.error('Send chat message error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /conversations/:id/read — mark as read
router.put('/conversations/:id/read', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await ensureChatTables(prisma)
        const { id } = req.params

        await prisma.$executeRawUnsafe(
            `UPDATE "ChatMessage" SET "isRead" = true WHERE "conversationId" = $1 AND "senderType" = 'customer'`, id
        )
        await prisma.$executeRawUnsafe(
            `UPDATE "ChatConversation" SET "unreadCount" = 0, "updatedAt" = NOW() WHERE "id" = $1`, id
        )

        res.json({ success: true })
    } catch (err) {
        console.error('Mark read error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /conversations/:id/status — update status
router.put('/conversations/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await ensureChatTables(prisma)
        const { id } = req.params
        const { status } = req.body

        await prisma.$executeRawUnsafe(
            `UPDATE "ChatConversation" SET "status" = $1, "updatedAt" = NOW() WHERE "id" = $2`, status, id
        )

        res.json({ success: true })
    } catch (err) {
        console.error('Update convo status error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /unread-count
router.get('/unread-count', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await ensureChatTables(prisma)

        const result = await prisma.$queryRawUnsafe(
            `SELECT COALESCE(SUM("unreadCount"), 0)::int as count FROM "ChatConversation"`
        )

        res.json({ success: true, data: { count: (result as any[])[0]?.count ?? 0 } })
    } catch (err) {
        console.error('Get unread count error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})
// POST /backfill-channels — one-time: set channelId on conversations that don't have one
router.post('/backfill-channels', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        await ensureChatTables(prisma)

        // Get all conversations without channelId
        const convos = await prisma.$queryRawUnsafe(
            `SELECT "id", "platform" FROM "ChatConversation" WHERE "channelId" IS NULL`
        ) as any[]

        if (convos.length === 0) {
            res.json({ success: true, data: { updated: 0 } })
            return
        }

        // Get all channels
        let channels: any[] = []
        try {
            channels = await prisma.$queryRawUnsafe(`SELECT "id", "name", "platform" FROM "OnlineChannel"`) as any[]
        } catch { /* table may not exist */ }

        let updated = 0
        for (const convo of convos) {
            const matchingChannel = channels.find(
                (ch: any) => ch.platform?.toLowerCase() === convo.platform?.toLowerCase()
            )
            if (matchingChannel) {
                await prisma.$executeRawUnsafe(
                    `UPDATE "ChatConversation" SET "channelId" = $1, "channelName" = $2 WHERE "id" = $3`,
                    matchingChannel.id, matchingChannel.name, convo.id
                )
                updated++
            }
        }

        res.json({ success: true, data: { total: convos.length, updated } })
    } catch (err) {
        console.error('Backfill channels error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


// ═══════════════════════════════════════════════════════════════════════════════
// ─── SHOPEE CHAT API (proxy to Shopee seller chat) ──────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

import { ShopeeService } from '../services/platforms'

// Helper: load channel credentials and create ShopeeService
async function getShopeeServiceForChannel(prisma: any, channelId: string): Promise<{ shopee: ShopeeService; channel: any }> {
    const channels = await prisma.$queryRawUnsafe(
        `SELECT * FROM "OnlineChannel" WHERE "id" = $1 AND "platform" = 'shopee' LIMIT 1`, channelId
    ) as any[]
    const channel = channels[0]
    if (!channel) throw new Error('Kênh Shopee không tồn tại')
    if (!channel.accessToken) throw new Error('Kênh Shopee chưa kết nối (thiếu access token)')

    const shopee = new ShopeeService({
        apiKey: channel.apiKey || '',
        apiSecret: channel.apiSecret || '',
        accessToken: channel.accessToken || '',
        refreshToken: channel.refreshToken || '',
        shopId: channel.shopId || '',
    })

    return { shopee, channel }
}

// Helper: auto-refresh token if expired, update DB
async function withTokenRefresh(prisma: any, channel: any, shopee: ShopeeService, fn: () => Promise<any>): Promise<any> {
    try {
        return await fn()
    } catch (err: any) {
        const msg = err?.message || ''
        // Shopee returns error.auth or token expired errors
        if (msg.includes('error.auth') || msg.includes('token') || msg.includes('expired') || msg.includes('invalid')) {
            console.log('[Shopee Chat] Token expired, refreshing...')
            try {
                const newTokens = await shopee.refreshAccessToken()
                // Update channel in DB
                await prisma.$executeRawUnsafe(
                    `UPDATE "OnlineChannel" SET "accessToken" = $1, "refreshToken" = $2, "updatedAt" = NOW() WHERE "id" = $3`,
                    newTokens.accessToken, newTokens.refreshToken, channel.id
                )
                // Retry with new credentials
                const newShopee = new ShopeeService({
                    apiKey: channel.apiKey || '',
                    apiSecret: channel.apiSecret || '',
                    accessToken: newTokens.accessToken,
                    refreshToken: newTokens.refreshToken,
                    shopId: channel.shopId || '',
                })
                // Patch the shopee instance for subsequent calls
                Object.assign(shopee, newShopee)
                return await fn()
            } catch (refreshErr: any) {
                console.error('[Shopee Chat] Token refresh failed:', refreshErr)
                throw new Error(`Không thể làm mới token Shopee: ${refreshErr.message}`)
            }
        }
        throw err
    }
}

// Helper: safe timestamp to ISO string
function safeTimestampToISO(ts: number | undefined | null): string | null {
    if (!ts || ts <= 0) return null
    try { return new Date(ts * 1000).toISOString() } catch { return null }
}

// GET /shopee/conversations — fetch conversations from Shopee seller chat
router.get('/shopee/conversations', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { channelId, type, pageSize } = req.query

        if (!channelId) {
            res.status(400).json({ success: false, error: 'channelId is required' })
            return
        }

        console.log(`[Shopee Chat Route] Getting conversations for channelId=${channelId}`)
        const { shopee, channel } = await getShopeeServiceForChannel(prisma, channelId as string)
        console.log(`[Shopee Chat Route] Channel: name=${channel.name}, shopId=${channel.shopId}, hasAccessToken=${!!channel.accessToken}, accessToken=${(channel.accessToken || '').substring(0, 20)}...`)

        const result = await withTokenRefresh(prisma, channel, shopee, () =>
            shopee.getConversationList({
                type: (type as string) || 'all',
                pageSize: parseInt(pageSize as string) || 25,
            })
        )

        console.log(`[Shopee Chat Route] Result: ${result.conversations.length} conversations, hasMore=${result.hasMore}`)

        // Map to our ChatConversation-like format
        const items = result.conversations.map((c: any) => ({
            id: c.conversationId,
            customerName: c.toName || 'Khách Shopee',
            customerAvatar: c.toAvatar || '',
            platform: 'shopee',
            channelId: channelId,
            channelName: channel.name || 'Shopee',
            status: 'active',
            lastMessage: c.lastMessage || '',
            lastMessageAt: safeTimestampToISO(c.lastMessageTimestamp),
            _sortTimestamp: c.lastMessageTimestamp || 0, // raw timestamp for sorting
            unreadCount: c.unreadCount || 0,
            // Shopee-specific fields
            shopeeToId: c.toId,
            shopeePinned: c.pinned,
            shopeeLastReadMessageId: c.lastReadMessageId,
        }))
        // Sort: unread/unreplied first, then by most recent message (newest first)
        items.sort((a: any, b: any) => {
            // Unread first
            if (a.unreadCount > 0 && b.unreadCount === 0) return -1
            if (a.unreadCount === 0 && b.unreadCount > 0) return 1
            // Then by raw timestamp (newest first)
            return (b._sortTimestamp || 0) - (a._sortTimestamp || 0)
        })

        res.json({
            success: true,
            data: {
                items,
                total: items.length,
                hasMore: result.hasMore,
                nextOffset: result.nextOffset,
                source: 'shopee',
            },
        })
    } catch (err: any) {
        console.error('Shopee get conversations error:', err)
        res.status(500).json({ success: false, error: err.message || 'Internal server error' })
    }
})

// GET /shopee/messages/:conversationId — fetch messages for a Shopee conversation
router.get('/shopee/messages/:conversationId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { channelId, pageSize, offset } = req.query
        const { conversationId } = req.params

        if (!channelId) {
            res.status(400).json({ success: false, error: 'channelId is required' })
            return
        }

        const { shopee, channel } = await getShopeeServiceForChannel(prisma, channelId as string)

        const result = await withTokenRefresh(prisma, channel, shopee, () =>
            shopee.getMessages(conversationId, {
                pageSize: parseInt(String(pageSize) || '25') || 25,
                offset: offset ? String(offset) : undefined,
            })
        )

        // Map to our ChatMessage-like format
        const shopId = parseInt(channel.shopId || '0')
        const messages = result.messages.map((m: any) => ({
            id: m.messageId,
            conversationId,
            senderName: m.fromId === shopId ? (channel.name || 'Shop') : m.fromName,
            senderType: m.fromId === shopId ? 'staff' : 'customer',
            content: m.content,
            contentType: m.messageType === 'image' ? 'image' : 'text',
            imageUrl: m.imageUrl || null,
            isRead: true,
            createdAt: safeTimestampToISO(m.createdTimestamp) || new Date().toISOString(),
            // Shopee-specific
            shopeeMessageType: m.messageType,
            shopeeSourceContent: m.sourceContent,
        }))

        // Reverse to chronological order (oldest first, newest last) for chat display
        messages.reverse()

        res.json({
            success: true,
            data: {
                messages,
                hasMore: result.hasMore,
                nextOffset: result.nextOffset,
                source: 'shopee',
            },
        })
    } catch (err: any) {
        console.error('Shopee get messages error:', err)
        res.status(500).json({ success: false, error: err.message || 'Internal server error' })
    }
})

// POST /shopee/send — send a message via Shopee seller chat
router.post('/shopee/send', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { channelId, toId, content } = req.body

        if (!channelId || !toId || !content) {
            res.status(400).json({ success: false, error: 'channelId, toId, and content are required' })
            return
        }

        const { shopee, channel } = await getShopeeServiceForChannel(prisma, channelId as string)

        const result = await withTokenRefresh(prisma, channel, shopee, () =>
            shopee.sendMessage(parseInt(toId), content)
        )

        res.json({
            success: true,
            data: {
                messageId: result.messageId,
                conversationId: result.conversationId,
            },
        })
    } catch (err: any) {
        console.error('Shopee send message error:', err)
        res.status(500).json({ success: false, error: err.message || 'Internal server error' })
    }
})

// POST /shopee/read — mark conversation as read
router.post('/shopee/read', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { channelId, conversationId, lastReadMessageId } = req.body

        if (!channelId || !conversationId) {
            res.status(400).json({ success: false, error: 'channelId and conversationId are required' })
            return
        }

        const { shopee, channel } = await getShopeeServiceForChannel(prisma, channelId as string)

        await withTokenRefresh(prisma, channel, shopee, () =>
            shopee.readConversation(conversationId, lastReadMessageId || '')
        )

        res.json({ success: true })
    } catch (err: any) {
        console.error('Shopee read conversation error:', err)
        res.status(500).json({ success: false, error: err.message || 'Internal server error' })
    }
})


// ═══════════════════════════════════════════════════════════════════════════════
// ─── PUBLIC ENDPOINTS (customer-facing, no auth required) ───────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// Helper to resolve store schema from storeCode
async function resolveStoreSchema(storeCode: string): Promise<{ schema: string } | null> {
    const store = await registryPrisma.store.findFirst({
        where: { code: storeCode, status: 'active' },
    })
    if (!store || !store.schema || store.schema === 'pending') return null
    return { schema: store.schema }
}

// POST /public/start — customer starts a new chat session
router.post('/public/start', async (req: Request, res: Response) => {
    try {
        const { storeCode, customerName, customerPhone, customerEmail, platform = 'website' } = req.body

        if (!storeCode || !customerName) {
            res.status(400).json({ success: false, error: 'storeCode and customerName are required' })
            return
        }

        const resolved = await resolveStoreSchema(storeCode)
        if (!resolved) {
            res.status(404).json({ success: false, error: 'Store not found' })
            return
        }

        const prisma = getStorePrisma(resolved.schema) as any
        console.log('[Chat Debug] POST /public/start - resolved schema:', resolved.schema)
        await ensureChatTables(prisma)

        const convoId = generateId()
        const sessionToken = generateSessionToken()

        // Auto-resolve channelId from platform match or explicit channelId
        let resolvedChannelId: string | null = req.body.channelId || null
        let resolvedChannelName: string | null = null
        try {
            if (resolvedChannelId) {
                // Explicit channelId provided — look up name
                const ch = await prisma.$queryRawUnsafe(
                    `SELECT "id", "name" FROM "OnlineChannel" WHERE "id" = $1 LIMIT 1`, resolvedChannelId
                ) as any[]
                if (ch.length > 0) resolvedChannelName = ch[0].name
            } else {
                // Match by platform
                const ch = await prisma.$queryRawUnsafe(
                    `SELECT "id", "name" FROM "OnlineChannel" WHERE LOWER("platform") = LOWER($1) LIMIT 1`, platform
                ) as any[]
                if (ch.length > 0) {
                    resolvedChannelId = ch[0].id
                    resolvedChannelName = ch[0].name
                }
            }
        } catch { /* OnlineChannel table may not exist yet — skip */ }

        await prisma.$executeRawUnsafe(
            `INSERT INTO "ChatConversation" ("id", "customerName", "customerPhone", "customerEmail", "platform", "channelId", "channelName", "sessionToken", "status", "unreadCount", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', 0, NOW(), NOW())`,
            convoId, customerName, customerPhone || null, customerEmail || null, platform, resolvedChannelId, resolvedChannelName, sessionToken
        )

        // Add system message
        const sysMsgId = generateId()
        await prisma.$executeRawUnsafe(
            `INSERT INTO "ChatMessage" ("id", "conversationId", "senderName", "senderType", "content", "contentType", "isRead", "createdAt")
             VALUES ($1, $2, 'Hệ thống', 'system', $3, 'text', true, NOW())`,
            sysMsgId, convoId, `${customerName} đã bắt đầu trò chuyện`
        )

        res.json({
            success: true,
            data: {
                conversationId: convoId,
                sessionToken,
            },
        })
    } catch (err) {
        console.error('Start chat error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /public/send — customer sends a message
router.post('/public/send', async (req: Request, res: Response) => {
    try {
        const { storeCode, sessionToken, content, customerName } = req.body

        if (!storeCode || !sessionToken || !content) {
            res.status(400).json({ success: false, error: 'storeCode, sessionToken and content are required' })
            return
        }

        const resolved = await resolveStoreSchema(storeCode)
        if (!resolved) {
            res.status(404).json({ success: false, error: 'Store not found' })
            return
        }

        const prisma = getStorePrisma(resolved.schema) as any
        await ensureChatTables(prisma)

        // Verify session
        const convo = await prisma.$queryRawUnsafe(
            `SELECT "id", "customerName" FROM "ChatConversation" WHERE "sessionToken" = $1 LIMIT 1`,
            sessionToken
        ) as any[]

        if (!convo.length) {
            res.status(404).json({ success: false, error: 'Chat session not found' })
            return
        }

        const conversationId = convo[0].id
        const senderName = customerName || convo[0].customerName
        const msgId = generateId()

        await prisma.$executeRawUnsafe(
            `INSERT INTO "ChatMessage" ("id", "conversationId", "senderName", "senderType", "content", "contentType", "isRead", "createdAt")
             VALUES ($1, $2, $3, 'customer', $4, 'text', false, NOW())`,
            msgId, conversationId, senderName, content
        )

        // Update conversation
        await prisma.$executeRawUnsafe(
            `UPDATE "ChatConversation" SET "lastMessage" = $1, "lastMessageAt" = NOW(), "unreadCount" = "unreadCount" + 1, "updatedAt" = NOW(), "status" = 'active' WHERE "id" = $2`,
            content.substring(0, 200), conversationId
        )

        res.json({
            success: true,
            data: {
                id: msgId,
                conversationId,
                senderName,
                senderType: 'customer',
                content,
                contentType: 'text',
                isRead: false,
                createdAt: new Date().toISOString(),
            },
        })
    } catch (err) {
        console.error('Customer send error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /public/messages — customer polls for messages
router.get('/public/messages', async (req: Request, res: Response) => {
    try {
        const { storeCode, sessionToken } = req.query

        if (!storeCode || !sessionToken) {
            res.status(400).json({ success: false, error: 'storeCode and sessionToken are required' })
            return
        }

        const resolved = await resolveStoreSchema(storeCode as string)
        if (!resolved) {
            res.status(404).json({ success: false, error: 'Store not found' })
            return
        }

        const prisma = getStorePrisma(resolved.schema) as any
        await ensureChatTables(prisma)

        const convo = await prisma.$queryRawUnsafe(
            `SELECT "id" FROM "ChatConversation" WHERE "sessionToken" = $1 LIMIT 1`,
            sessionToken
        ) as any[]

        if (!convo.length) {
            res.status(404).json({ success: false, error: 'Chat session not found' })
            return
        }

        const messages = await prisma.$queryRawUnsafe(
            `SELECT * FROM "ChatMessage" WHERE "conversationId" = $1 ORDER BY "createdAt" ASC`,
            convo[0].id
        )

        res.json({ success: true, data: messages })
    } catch (err) {
        console.error('Get public messages error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router

