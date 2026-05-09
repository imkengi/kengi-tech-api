import { BigQuery, Table } from '@google-cloud/bigquery'

// ─── BigQuery Analytics Layer ───────────────────────────────────────────────
// Handles ETL sync from Cloud SQL → BigQuery and analytics queries.
// Graceful fallback: if BIGQUERY_DATASET is not set, everything is no-op.

const DATASET_ID = process.env.BIGQUERY_DATASET || ''   // e.g. "kengi_analytics"
const PROJECT_ID = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'kengi-tech'

let bq: BigQuery | null = null
let dataset: any = null

if (DATASET_ID) {
    try {
        bq = new BigQuery({ projectId: PROJECT_ID })
        console.log(`✅ BigQuery enabled (dataset: ${DATASET_ID})`)
    } catch (err: any) {
        console.warn('⚠️ BigQuery init failed:', err.message)
    }
} else {
    console.log('ℹ️ BIGQUERY_DATASET not set — analytics queries use Prisma (Cloud SQL)')
}

// ─── Table Schemas ──────────────────────────────────────────────────────────

const TABLE_SCHEMAS: Record<string, any[]> = {
    transactions: [
        { name: 'id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'storeId', type: 'STRING' },
        { name: 'branchId', type: 'STRING' },
        { name: 'receiptNumber', type: 'STRING' },
        { name: 'customerId', type: 'STRING' },
        { name: 'customerName', type: 'STRING' },
        { name: 'total', type: 'FLOAT' },
        { name: 'subtotal', type: 'FLOAT' },
        { name: 'discount', type: 'FLOAT' },
        { name: 'tax', type: 'FLOAT' },
        { name: 'status', type: 'STRING' },
        { name: 'paymentMethod', type: 'STRING' },
        { name: 'createdAt', type: 'TIMESTAMP' },
    ],
    transaction_items: [
        { name: 'id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'transactionId', type: 'STRING' },
        { name: 'productId', type: 'STRING' },
        { name: 'productName', type: 'STRING' },
        { name: 'quantity', type: 'INTEGER' },
        { name: 'unitPrice', type: 'FLOAT' },
        { name: 'lineTotal', type: 'FLOAT' },
        { name: 'costPrice', type: 'FLOAT' },
    ],
    expenses: [
        { name: 'id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'storeId', type: 'STRING' },
        { name: 'category', type: 'STRING' },
        { name: 'amount', type: 'FLOAT' },
        { name: 'description', type: 'STRING' },
        { name: 'date', type: 'TIMESTAMP' },
    ],
    products_snapshot: [
        { name: 'id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'storeId', type: 'STRING' },
        { name: 'name', type: 'STRING' },
        { name: 'sku', type: 'STRING' },
        { name: 'costPrice', type: 'FLOAT' },
        { name: 'sellingPrice', type: 'FLOAT' },
        { name: 'stock', type: 'INTEGER' },
        { name: 'categoryId', type: 'STRING' },
        { name: 'snapshotDate', type: 'DATE' },
    ],
    debt_entries: [
        { name: 'id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'storeId', type: 'STRING' },
        { name: 'customerId', type: 'STRING' },
        { name: 'type', type: 'STRING' },
        { name: 'amount', type: 'FLOAT' },
        { name: 'createdAt', type: 'TIMESTAMP' },
    ],
}

// ─── Ensure Dataset + Tables exist ──────────────────────────────────────────

export async function ensureDataset(): Promise<void> {
    if (!bq || !DATASET_ID) return

    try {
        dataset = bq.dataset(DATASET_ID)
        const [exists] = await dataset.exists()
        if (!exists) {
            [dataset] = await bq.createDataset(DATASET_ID, { location: 'asia-southeast1' })
            console.log(`📦 Created BigQuery dataset: ${DATASET_ID}`)
        }

        // Ensure tables
        for (const [tableName, schema] of Object.entries(TABLE_SCHEMAS)) {
            const table = dataset.table(tableName)
            const [tableExists] = await table.exists()
            if (!tableExists) {
                await dataset.createTable(tableName, { schema: { fields: schema } })
                console.log(`  📋 Created table: ${tableName}`)
            }
        }
    } catch (err: any) {
        console.error('BigQuery ensureDataset error:', err.message)
    }
}

// ─── Insert rows in batches ─────────────────────────────────────────────────

export async function insertRows(tableName: string, rows: any[]): Promise<number> {
    if (!bq || !DATASET_ID || rows.length === 0) return 0

    const table = bq.dataset(DATASET_ID).table(tableName)
    const BATCH_SIZE = 500
    let inserted = 0

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE)
        try {
            await table.insert(batch, { skipInvalidRows: true, ignoreUnknownValues: true })
            inserted += batch.length
        } catch (err: any) {
            // BigQuery insert errors include partial success info
            if (err.name === 'PartialFailureError') {
                const failed = err.errors?.length || 0
                inserted += batch.length - failed
                console.warn(`BigQuery partial insert: ${failed} rows failed in ${tableName}`)
            } else {
                console.error(`BigQuery insert error (${tableName}):`, err.message)
            }
        }
    }
    return inserted
}

// ─── Run analytics query ────────────────────────────────────────────────────

export async function queryBQ<T = any>(sql: string, params?: Record<string, any>): Promise<T[]> {
    if (!bq) throw new Error('BigQuery not configured')

    const options: any = { query: sql, location: 'asia-southeast1' }
    if (params) {
        options.params = params
        options.parameterMode = 'NAMED'
    }

    const [rows] = await bq.query(options)
    return rows as T[]
}

// ─── Delete rows for re-sync (idempotent) ───────────────────────────────────

export async function deleteRowsSince(tableName: string, since: Date, storeIdColumn = 'storeId'): Promise<void> {
    if (!bq || !DATASET_ID) return

    const dateCol = tableName === 'products_snapshot' ? 'snapshotDate' : 'createdAt'
    const sinceStr = since.toISOString()

    try {
        await bq.query({
            query: `DELETE FROM \`${PROJECT_ID}.${DATASET_ID}.${tableName}\` WHERE ${dateCol} >= @since`,
            params: { since: sinceStr },
            parameterMode: 'NAMED',
            location: 'asia-southeast1',
        })
    } catch (err: any) {
        console.warn(`BigQuery delete from ${tableName} failed:`, err.message)
    }
}

// ─── Check if BigQuery is configured ────────────────────────────────────────

export function isBigQueryEnabled(): boolean {
    return !!bq && !!DATASET_ID
}

export function getDatasetId(): string {
    return DATASET_ID
}
