import { PrismaClient } from '@prisma/client'

const basePrisma = new PrismaClient()

// ─── Models to SKIP audit logging (avoid infinite loop on AuditLog itself) ───
const SKIP_MODELS = new Set(['AuditLog'])

// ─── Friendly entity names ───────────────────────────────────────────────────
const MODEL_TO_ENTITY: Record<string, string> = {
    Product: 'products', Category: 'products', Brand: 'products',
    Customer: 'customers', CustomerGroup: 'customers',
    Transaction: 'transactions', TransactionItem: 'transactions', Payment: 'transactions',
    InventoryTransaction: 'inventory', ImportReceipt: 'inventory', ImportReceiptItem: 'inventory',
    Expense: 'expenses', Promotion: 'promotions',
    Supplier: 'suppliers', PurchaseOrder: 'suppliers', PurchaseOrderItem: 'suppliers',
    User: 'auth', Employee: 'auth',
    Notification: 'system', Warranty: 'products', Repair: 'products',
    ReturnOrder: 'transactions', DebtEntry: 'customers', Bundle: 'products',
    Quotation: 'transactions', ShippingOrder: 'transactions',
    Currency: 'settings', TaxConfig: 'settings', CustomerSegment: 'customers',
    Feedback: 'customers', Schedule: 'system', Driver: 'transactions',
}

// ─── Auto-log helper (fire & forget) ────────────────────────────────────────
function autoLog(action: string, model: string, result: any) {
    const entity = MODEL_TO_ENTITY[model] || model.toLowerCase()
    const entityId = result?.id || null

    let details = `${action} ${model}`
    if (action === 'create' && result) {
        const name = result.name || result.code || result.receiptNumber || result.description || ''
        if (name) details += ` — ${name}`
    }
    if (action === 'delete' && entityId) {
        details += ` (ID: ${entityId})`
    }

    // Fire & forget — don't await, don't block
    basePrisma.auditLog.create({
        data: { action, entity, entityId: entityId ? String(entityId) : null, userName: 'System', details }
    }).catch((err) => { console.error('[AuditLog] Failed to log:', err.message) })
}

// ─── Extended Prisma client with auto audit logging ─────────────────────────
const prisma = basePrisma.$extends({
    query: {
        $allModels: {
            async create({ model, args, query }) {
                const result = await query(args)
                if (!SKIP_MODELS.has(model)) autoLog('create', model, result)
                return result
            },
            async update({ model, args, query }) {
                const result = await query(args)
                if (!SKIP_MODELS.has(model)) autoLog('update', model, result)
                return result
            },
            async delete({ model, args, query }) {
                const result = await query(args)
                if (!SKIP_MODELS.has(model)) autoLog('delete', model, result)
                return result
            },
        },
    },
})

// ─── Helper: log activity with full context (user info, IP, custom details) ──
export async function logActivity(opts: {
    action: string
    entity: string
    entityId?: string | null
    userId?: string | null
    userName?: string | null
    details?: string | null
    ipAddress?: string | null
}) {
    try {
        await basePrisma.auditLog.create({
            data: {
                action: opts.action,
                entity: opts.entity,
                entityId: opts.entityId || null,
                userId: opts.userId || null,
                userName: opts.userName || 'System',
                details: opts.details || null,
                ipAddress: opts.ipAddress || null,
            }
        })
    } catch {
        // silently ignore — audit logging should never break the main flow
    }
}

export default prisma
