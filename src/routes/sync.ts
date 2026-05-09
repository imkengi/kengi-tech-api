import { Router, Request, Response } from 'express'
import { registryPrisma, getStorePrisma } from '../lib/prisma'

// BigQuery imports (optional, only used if available)
let ensureDataset: any, insertRows: any, deleteRowsSince: any, isBigQueryEnabled: any
try {
    const bq = require('../lib/bigquery')
    ensureDataset = bq.ensureDataset
    insertRows = bq.insertRows
    deleteRowsSince = bq.deleteRowsSince
    isBigQueryEnabled = bq.isBigQueryEnabled
} catch {
    isBigQueryEnabled = () => false
}

const router = Router()

// Internal API key check — requires INTERNAL_API_KEY to be configured
function checkInternalKey(req: Request): boolean {
    const expected = process.env.INTERNAL_API_KEY
    if (!expected) {
        console.warn('⚠️ INTERNAL_API_KEY not configured — internal routes will reject all requests')
        return false
    }
    const key = req.headers['x-internal-key'] as string
    return !!key && key === expected
}

// ─── POST /api/internal/sync-to-bigquery ────────────────────────────────────
router.post('/sync-to-bigquery', async (req: Request, res: Response) => {
    const startTime = Date.now()

    if (!checkInternalKey(req)) {
        return res.status(403).json({ success: false, error: 'Unauthorized' })
    }

    if (!isBigQueryEnabled()) {
        return res.status(400).json({ success: false, error: 'BigQuery not configured' })
    }

    try {
        console.log('[Sync] Starting BigQuery ETL sync across all stores...')
        await ensureDataset()

        const since = new Date(Date.now() - 25 * 60 * 60 * 1000)
        const today = new Date().toISOString().slice(0, 10)
        const result: Record<string, number> = {}

        // Get all active stores and sync each
        const stores = await registryPrisma.store.findMany({ where: { status: 'active' } })

        for (const store of stores) {
            try {
                const storePrisma = getStorePrisma(store.schema)

                // Transactions
                const transactions = await storePrisma.transaction.findMany({
                    where: { createdAt: { gte: since } },
                    include: { payments: true },
                })
                const txRows = transactions.map(tx => ({
                    id: tx.id,
                    storeCode: store.code,
                    branchId: tx.branchId || null,
                    receiptNumber: tx.receiptNumber,
                    total: tx.total,
                    subtotal: tx.subtotal,
                    discount: tx.discount,
                    status: tx.status,
                    paymentMethod: tx.payments?.[0]?.type || 'cash',
                    createdAt: tx.createdAt.toISOString(),
                }))
                if (txRows.length > 0) {
                    result[`${store.code}_transactions`] = await insertRows('transactions', txRows)
                }

                // Products snapshot
                const products = await storePrisma.product.findMany({
                    select: { id: true, name: true, sku: true, costPrice: true, sellingPrice: true, stock: true, categoryId: true },
                })
                const productRows = products.map(p => ({
                    id: p.id,
                    storeCode: store.code,
                    name: p.name,
                    sku: p.sku,
                    costPrice: p.costPrice,
                    sellingPrice: p.sellingPrice,
                    stock: p.stock,
                    snapshotDate: today,
                }))
                if (productRows.length > 0) {
                    result[`${store.code}_products`] = await insertRows('products_snapshot', productRows)
                }
            } catch (err: any) {
                console.error(`[Sync] Error syncing store ${store.code}:`, err.message)
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`[Sync] ✅ ETL complete in ${elapsed}s:`, result)
        res.json({ success: true, data: { synced: result, elapsed: `${elapsed}s`, syncedAt: new Date().toISOString() } })
    } catch (err: any) {
        console.error('[Sync] ETL error:', err)
        res.status(500).json({ success: false, error: err.message || 'ETL sync failed' })
    }
})

// ─── GET /api/internal/sync-status ──────────────────────────────────────────
router.get('/sync-status', (_req: Request, res: Response) => {
    res.json({
        success: true,
        data: {
            bigqueryEnabled: isBigQueryEnabled(),
            architecture: 'multi-schema',
            dataset: process.env.BIGQUERY_DATASET || null,
        },
    })
})

export default router
