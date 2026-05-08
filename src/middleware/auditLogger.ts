import { Request, Response, NextFunction } from 'express'
import { AuthRequest } from './auth'

/**
 * Audit Logger Middleware
 * Automatically logs write operations (POST/PUT/DELETE) to the AuditLog table.
 * Attach AFTER authMiddleware so req.user and req.storePrisma are available.
 */

// Map route paths to entity names
const ENTITY_MAP: Record<string, string> = {
    '/api/products': 'products',
    '/api/customers': 'customers',
    '/api/transactions': 'orders',
    '/api/inventory': 'inventory',
    '/api/suppliers': 'suppliers',
    '/api/promotions': 'promotions',
    '/api/warranties': 'warranty',
    '/api/repairs': 'repairs',
    '/api/employees': 'employees',
    '/api/expenses': 'finance',
    '/api/purchase-orders': 'inventory',
    '/api/import-receipts': 'inventory',
    '/api/quotations': 'orders',
    '/api/sales-orders': 'orders',
    '/api/returns': 'orders',
    '/api/bundles': 'products',
    '/api/categories': 'products',
    '/api/brands': 'products',
    '/api/settings': 'settings',
    '/api/branches': 'settings',
    '/api/tax-configs': 'finance',
    '/api/shipping-orders': 'orders',
    '/api/schedules': 'settings',
}

function getAction(method: string): string {
    switch (method) {
        case 'POST': return 'create'
        case 'PUT':
        case 'PATCH': return 'update'
        case 'DELETE': return 'delete'
        default: return 'view'
    }
}

function getEntityFromPath(path: string): string {
    // Try matching known routes (longest match first)
    const sorted = Object.keys(ENTITY_MAP).sort((a, b) => b.length - a.length)
    for (const route of sorted) {
        if (path.startsWith(route)) return ENTITY_MAP[route]!
    }
    // Fallback: extract from path segment
    const segments = path.replace('/api/', '').split('/')
    return segments[0] || 'unknown'
}

function getEntityId(path: string): string | null {
    // Extract ID from paths like /api/products/:id
    const segments = path.split('/')
    // Check if last segment looks like an ID (cuid, uuid, or numeric)
    const lastSeg = segments[segments.length - 1]
    if (lastSeg && lastSeg.length > 8 && /^[a-z0-9]+$/i.test(lastSeg)) return lastSeg
    return null
}

function getIpAddress(req: Request): string {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() || req.ip || '—'
    if (Array.isArray(forwarded)) return forwarded[0] || req.ip || '—'
    return req.ip || req.socket.remoteAddress || '—'
}

function getDeviceInfo(req: Request): string | null {
    const ua = req.headers['user-agent']
    if (!ua) return null
    // Parse a simplified browser + OS
    let browser = 'Unknown Browser'
    let os = 'Unknown OS'
    if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome'
    else if (ua.includes('Edg')) browser = 'Edge'
    else if (ua.includes('Firefox')) browser = 'Firefox'
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari'
    if (ua.includes('Windows')) os = 'Windows'
    else if (ua.includes('Mac')) os = 'macOS'
    else if (ua.includes('Linux')) os = 'Linux'
    else if (ua.includes('Android')) os = 'Android'
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'
    return JSON.stringify({ browser, os, ip: getIpAddress(req) })
}

function buildDetails(req: AuthRequest, action: string, entity: string): string {
    const parts: string[] = []
    const user = req.user?.name || req.user?.email || 'Unknown'
    
    switch (action) {
        case 'create': {
            const name = req.body?.name || req.body?.productName || req.body?.customerName || ''
            parts.push(`${user} tạo mới ${entity}`)
            if (name) parts.push(`"${name}"`)
            break
        }
        case 'update': {
            const entityId = getEntityId(req.originalUrl)
            parts.push(`${user} cập nhật ${entity}`)
            if (entityId) parts.push(`#${entityId.slice(0, 8).toUpperCase()}`)
            // Show changed fields
            const fields = Object.keys(req.body || {}).filter(k => !['id', 'createdAt', 'updatedAt'].includes(k))
            if (fields.length > 0 && fields.length <= 5) parts.push(`(${fields.join(', ')})`)
            break
        }
        case 'delete': {
            const entityId = getEntityId(req.originalUrl)
            parts.push(`${user} xóa ${entity}`)
            if (entityId) parts.push(`#${entityId.slice(0, 8).toUpperCase()}`)
            break
        }
        default:
            parts.push(`${user} ${action} ${entity}`)
    }
    return parts.join(' ')
}

// Skip these paths from audit logging
const SKIP_PATHS = ['/api/audit-logs', '/api/health', '/api/auth/me']

export function auditLoggerMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
    // Only log write operations
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
    // Skip audit log endpoint itself & health checks
    if (SKIP_PATHS.some(p => req.originalUrl.startsWith(p))) return next()

    // Capture original res.json to log after success
    const originalJson = res.json.bind(res)
    res.json = function (body: any) {
        // Only log successful operations
        if (res.statusCode >= 200 && res.statusCode < 400) {
            const prisma = req.storePrisma
            if (prisma) {
                const action = getAction(req.method)
                const entity = getEntityFromPath(req.originalUrl)
                const entityId = getEntityId(req.originalUrl) || body?.data?.id || null
                const details = buildDetails(req, action, entity)
                const ipAddress = getIpAddress(req)
                const deviceInfo = getDeviceInfo(req)

                // Fire-and-forget — don't block the response
                prisma.auditLog.create({
                    data: {
                        userId: req.user?.id || null,
                        userName: req.user?.name || req.user?.email || 'system',
                        action,
                        entity,
                        entityId: entityId ? String(entityId) : null,
                        details,
                        ipAddress,
                        deviceInfo,
                    }
                }).catch(() => {}) // Silently fail — audit should never break operations
            }
        }
        return originalJson(body)
    } as any

    next()
}
