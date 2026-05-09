import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { registryPrisma, disconnectAll } from './lib/prisma'
import authRoutes from './routes/auth'
import productRoutes from './routes/products'
import categoryRoutes from './routes/categories'
import brandRoutes from './routes/brands'
import customerRoutes from './routes/customers'
import customerGroupRoutes from './routes/customerGroups'
import inventoryRoutes from './routes/inventory'
import transactionRoutes from './routes/transactions'
import promotionRoutes from './routes/promotions'
import dashboardRoutes from './routes/dashboard'
import supplierRoutes from './routes/suppliers'
import purchaseOrderRoutes from './routes/purchaseOrders'
import expenseRoutes from './routes/expenses'
import employeeRoutes from './routes/employees'
import notificationRoutes from './routes/notifications'
import warrantyRoutes from './routes/warranties'
import repairRoutes from './routes/repairs'
import quotationRoutes from './routes/quotations'
import auditLogRoutes from './routes/auditLogs'
import priceHistoryRoutes from './routes/priceHistory'
import shippingRoutes from './routes/shipping'
import driverRoutes from './routes/drivers'
import vehicleRoutes from './routes/vehicles'
import taxRoutes from './routes/tax'
import segmentRoutes from './routes/segments'
import currencyRoutes from './routes/currencies'
import feedbackRoutes from './routes/feedback'
import scheduleRoutes from './routes/schedule'
import returnRoutes from './routes/returns'
import debtRoutes from './routes/debts'
import bundleRoutes from './routes/bundles'
import apiKeyRoutes from './routes/apiKeys'
import financialReportRoutes from './routes/financialReports'
import salesTrackingRoutes from './routes/salesTracking'
import salesOrderRoutes from './routes/salesOrders'
import importReceiptRoutes from './routes/importReceipts'
import storeSettingsRoutes from './routes/storeSettings'
import settingsRoutes from './routes/settings'
import branchRoutes from './routes/branches'
import priceListRoutes from './routes/priceLists'
import adminRoutes from './routes/admin'
import importDataRoutes from './routes/importData'
import uploadRoutes from './routes/uploads'
import syncRoutes from './routes/sync'
import announcementRoutes from './routes/announcements'
import attendanceRoutes from './routes/attendance'
import loyaltyRoutes from './routes/loyalty'
import reviewRoutes from './routes/reviews'
import payrollRoutes from './routes/payroll'
import onlineOrderRoutes from './routes/onlineOrders'
import upgradeRequestRoutes from './routes/upgradeRequests'
import webhookRoutes from './routes/webhooks'
import eventRoutes from './routes/events'
import warehouseRoutes from './routes/warehouses'
import salesTripRoutes from './routes/salesTrips'
import { cacheDisconnect, cacheHealth } from './lib/cache'
import { startAutoSync, stopAutoSync } from './cron/autoSync'
import { setupWebSocket, getWebSocketStats } from './lib/websocket'
import { pubsubDisconnect } from './lib/pubsub'
import { createServer } from 'http'

const app = express()
app.set('trust proxy', 1) // Trust first proxy (Cloud Run load balancer)
const PORT = process.env.PORT || 3001

// ─── Middleware ──────────────────────────────────────────────────────────────

// Security headers
app.use(helmet({
    crossOriginEmbedderPolicy: false, // allow embedding for dev
    contentSecurityPolicy: false,     // managed by Next.js
}))

// CORS — allow known origins
const allowedOrigins = [
    process.env.FRONTEND_URL || 'https://kengi.vn',
    'https://kengi.vn',
    'https://www.kengi.vn',
    'https://open-retail.tinohosting.vn',
    'http://localhost:3000',
    'http://localhost:3001',
]
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true)
        } else {
            callback(new Error(`CORS: origin '${origin}' not allowed`))
        }
    },
    credentials: true,
}))

app.use(express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
        // Stash raw body bytes for HMAC verification (e.g., Shopee webhook).
        // Recomputing from JSON.stringify(req.body) would diverge from the bytes
        // the sender actually signed (key order, whitespace).
        ; (req as any).rawBody = buf
    },
}))
import path from 'path'
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')))

// ─── Rate Limiting ───────────────────────────────────────────────────────────

// Strict rate limit for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau 15 phút.' },
    skip: (req: express.Request) => process.env.NODE_ENV === 'development' && (req.ip === '::1' || req.ip === '127.0.0.1'),
})

// General API rate limit
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 3000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' },
    skip: (req: express.Request) => process.env.NODE_ENV === 'development' && (req.ip === '::1' || req.ip === '127.0.0.1'),
})

app.use('/api/auth/login', authLimiter)
app.use('/api', apiLimiter)

// ─── Request Logger (dev) ───────────────────────────────────────────────────
app.use((req, _res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path} — origin: ${req.headers.origin || 'none'}`)
    next()
})

// ─── Automatic Audit Logging ────────────────────────────────────────────────
import { auditLoggerMiddleware } from './middleware/auditLogger'
app.use('/api', auditLoggerMiddleware)

// ─── Core Routes ────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes)
app.use('/api/api-keys', apiKeyRoutes)
app.use('/api/products', productRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/brands', brandRoutes)
app.use('/api/customers', customerRoutes)
app.use('/api/customer-groups', customerGroupRoutes)
app.use('/api/inventory', inventoryRoutes)
app.use('/api/transactions', transactionRoutes)
app.use('/api/events', eventRoutes)
app.use('/api/promotions', promotionRoutes)
app.use('/api/dashboard', dashboardRoutes)

// ─── Extended Routes ────────────────────────────────────────────────────────
app.use('/api/suppliers', supplierRoutes)
app.use('/api/purchase-orders', purchaseOrderRoutes)
app.use('/api/expenses', expenseRoutes)
app.use('/api/employees', employeeRoutes)
app.use('/api/sales-tracking', salesTrackingRoutes)
app.use('/api/sales-orders', salesOrderRoutes)
app.use('/api/import-receipts', importReceiptRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/warranties', warrantyRoutes)
app.use('/api/repairs', repairRoutes)
app.use('/api/quotations', quotationRoutes)
app.use('/api/audit-logs', auditLogRoutes)
app.use('/api/price-history', priceHistoryRoutes)
app.use('/api/shipping', shippingRoutes)
app.use('/api/drivers', driverRoutes)
app.use('/api/vehicles', vehicleRoutes)
app.use('/api/tax', taxRoutes)
app.use('/api/segments', segmentRoutes)
app.use('/api/currencies', currencyRoutes)
app.use('/api/feedback', feedbackRoutes)
app.use('/api/schedule', scheduleRoutes)
app.use('/api/schedules', scheduleRoutes) // alias: frontend uses plural
app.use('/api/returns', returnRoutes)
app.use('/api/debts', debtRoutes)
app.use('/api/bundles', bundleRoutes)
app.use('/api/reports/financial', financialReportRoutes)
app.use('/api/store-settings', storeSettingsRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/branches', branchRoutes)
app.use('/api/price-lists', priceListRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/import-data', importDataRoutes)
app.use('/api/uploads', uploadRoutes)
app.use('/api/internal', syncRoutes)
app.use('/api/announcements', announcementRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/loyalty', loyaltyRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/payroll', payrollRoutes)
app.use('/api/online-orders', onlineOrderRoutes)
app.use('/api/upgrade-requests', upgradeRequestRoutes)
app.use('/api/webhooks', webhookRoutes)
app.use('/api/warehouses', warehouseRoutes)
app.use('/api/sales-trips', salesTripRoutes)

import einvoiceRoutes from './routes/einvoice'
app.use('/api/einvoice', einvoiceRoutes)

import storageRoutes from './routes/storage'
app.use('/api/storage', storageRoutes)

import chatRoutes from './routes/chat'
app.use('/api/online-orders/chat', chatRoutes)

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
    const cache = await cacheHealth()
    const ws = getWebSocketStats()
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        architecture: 'multi-schema',
        cache,
        websocket: ws,
    })
})

// ─── Error handler ──────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err)
    res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message || String(err) })
})

// ─── Start ──────────────────────────────────────────────────────────────────
if (!process.env.PASSENGER_BASE_URI) {
    const startTime = Date.now()
    const httpServer = createServer(app)

    // Attach WebSocket server to the same HTTP server
    setupWebSocket(httpServer)

    registryPrisma.$connect()
        .then(async () => {
            console.log('✅ Registry DB connected')

            // ─── Boot migration framework ──────────────────────────────────
            // Tracks which migration blocks have run so we don't replay 750+
            // DDL statements on every deploy. First boot runs everything;
            // subsequent boots skip in ~1 query.
            const migrationStartTime = Date.now()
            console.log('[Migration] Checking for pending migrations...')

            try {
                await registryPrisma.$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "public"."_schema_migrations" (
                        id SERIAL,
                        name TEXT UNIQUE,
                        applied_at TIMESTAMP DEFAULT NOW()
                    )
                `)
            } catch (err: any) {
                console.error('[Migration] Failed to create _schema_migrations table:', err.message)
            }

            const isMigrationApplied = async (name: string): Promise<boolean> => {
                try {
                    const rows = await registryPrisma.$queryRawUnsafe<any[]>(
                        `SELECT 1 FROM "public"."_schema_migrations" WHERE name = $1 LIMIT 1`,
                        name
                    )
                    return rows.length > 0
                } catch {
                    return false
                }
            }

            const markMigrationApplied = async (name: string): Promise<void> => {
                try {
                    await registryPrisma.$executeRawUnsafe(
                        `INSERT INTO "public"."_schema_migrations" (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
                        name
                    )
                } catch (err: any) {
                    console.error(`[Migration] Failed to mark ${name} applied:`, err.message)
                }
            }

            try {
            // Auto-create RefreshToken table if not exists (idempotent migration)
            if (!(await isMigrationApplied('refresh_token_v1'))) {
            try {
                await registryPrisma.$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "public"."RefreshToken" (
                        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                        token TEXT UNIQUE NOT NULL,
                        "userId" TEXT NOT NULL,
                        email TEXT NOT NULL,
                        role TEXT NOT NULL,
                        "storeId" TEXT NOT NULL,
                        "storeCode" TEXT NOT NULL,
                        "branchId" TEXT,
                        "branchSchema" TEXT NOT NULL,
                        "isMainBranch" BOOLEAN NOT NULL DEFAULT false,
                        "deviceId" TEXT,
                        "expiresAt" TIMESTAMP NOT NULL,
                        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
                    )
                `)
                // Apply migration for existing databases
                await registryPrisma.$executeRawUnsafe(`
                    ALTER TABLE "public"."RefreshToken" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;
                `)
                await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RefreshToken_token_idx" ON "public"."RefreshToken"(token)`)
                await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RefreshToken_userId_idx" ON "public"."RefreshToken"("userId")`)
                await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RefreshToken_expiresAt_idx" ON "public"."RefreshToken"("expiresAt")`)
                await markMigrationApplied('refresh_token_v1')
                console.log('✅ RefreshToken table ready')
            } catch (err: any) {
                console.error('⚠️ RefreshToken table migration failed:', err.message)
            }
            }

            // Auto-create StorageFile table for all vault metadata across all dynamic schemas
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const storageFileMigName = `storage_file_v1:${schema_name}`
                    if (await isMigrationApplied(storageFileMigName)) continue
                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."StorageFile" (
                            "id" TEXT NOT NULL,
                            "name" TEXT NOT NULL,
                            "url" TEXT NOT NULL,
                            "size" INTEGER NOT NULL,
                            "type" TEXT NOT NULL,
                            "category" TEXT NOT NULL,
                            "referenceId" TEXT,
                            "referenceName" TEXT,
                            "description" TEXT,
                            "uploadedBy" TEXT NOT NULL,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "StorageFile_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    await markMigrationApplied(storageFileMigName)
                }
                console.log('✅ StorageFile multi-schema synchronization completed')
            } catch (err: any) {
                console.error('⚠️ StorageFile multi-schema migration failed:', err.message)
            }

            // Auto-upgrade existing schemas with new security + customer columns
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const schemaUpgradeMigName = `schema_upgrade_v1:${schema_name}`
                    if (await isMigrationApplied(schemaUpgradeMigName)) continue
                    // Security columns
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."User" ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT;`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."User" ADD COLUMN IF NOT EXISTS "trustedDevices" TEXT NOT NULL DEFAULT '[]';`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."AuditLog" ADD COLUMN IF NOT EXISTS "deviceInfo" TEXT;`).catch(() => {})
                    // Customer sales association columns
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."Customer" ADD COLUMN IF NOT EXISTS "salesUserId" TEXT;`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."Customer" ADD COLUMN IF NOT EXISTS "salesUserName" TEXT;`).catch(() => {})
                    // Employee permissions column
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."User" ADD COLUMN IF NOT EXISTS "permissions" TEXT NOT NULL DEFAULT '[]';`).catch(() => {})
                    // Transaction revisions
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."Transaction" ADD COLUMN IF NOT EXISTS "transactionDate" TIMESTAMP(3);`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."Transaction" ADD COLUMN IF NOT EXISTS "revisionOfId" TEXT;`).catch(() => {})
                    // Vehicle fleet management tables
                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."Vehicle" (
                            "id" TEXT NOT NULL,
                            "code" TEXT NOT NULL,
                            "name" TEXT NOT NULL,
                            "type" TEXT NOT NULL DEFAULT 'car',
                            "licensePlate" TEXT NOT NULL,
                            "brand" TEXT,
                            "model" TEXT,
                            "year" INTEGER,
                            "color" TEXT,
                            "currentKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "lastOilChangeKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "inspectionExpiry" TIMESTAMP(3),
                            "insuranceExpiry" TIMESTAMP(3),
                            "assignedDriverId" TEXT,
                            "assignedDriverName" TEXT,
                            "status" TEXT NOT NULL DEFAULT 'available',
                            "imageUrl" TEXT,
                            "notes" TEXT,
                            "branchId" TEXT,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id"),
                            CONSTRAINT "Vehicle_code_key" UNIQUE ("code")
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Vehicle_branchId_idx" ON "${schema_name}"."Vehicle"("branchId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Vehicle_status_idx" ON "${schema_name}"."Vehicle"("status")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Vehicle_licensePlate_idx" ON "${schema_name}"."Vehicle"("licensePlate")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."VehicleMaintenance" (
                            "id" TEXT NOT NULL,
                            "vehicleId" TEXT NOT NULL,
                            "type" TEXT NOT NULL,
                            "description" TEXT NOT NULL,
                            "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "kmAtService" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "serviceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "nextDueDate" TIMESTAMP(3),
                            "performedBy" TEXT,
                            "notes" TEXT,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "VehicleMaintenance_pkey" PRIMARY KEY ("id"),
                            CONSTRAINT "VehicleMaintenance_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "${schema_name}"."Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VehicleMaintenance_vehicleId_idx" ON "${schema_name}"."VehicleMaintenance"("vehicleId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VehicleMaintenance_serviceDate_idx" ON "${schema_name}"."VehicleMaintenance"("serviceDate")`).catch(() => {})

                    // Warehouse / WarehouseStock / StockTransfer / StockTransferItem
                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."Warehouse" (
                            "id" TEXT NOT NULL,
                            "code" TEXT NOT NULL,
                            "name" TEXT NOT NULL,
                            "type" TEXT NOT NULL DEFAULT 'main',
                            "branchId" TEXT,
                            "description" TEXT,
                            "isDefault" BOOLEAN NOT NULL DEFAULT false,
                            "isActive" BOOLEAN NOT NULL DEFAULT true,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id"),
                            CONSTRAINT "Warehouse_code_key" UNIQUE ("code")
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Warehouse_branchId_idx" ON "${schema_name}"."Warehouse"("branchId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Warehouse_type_idx" ON "${schema_name}"."Warehouse"("type")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Warehouse_isActive_idx" ON "${schema_name}"."Warehouse"("isActive")`).catch(() => {})

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."WarehouseStock" (
                            "id" TEXT NOT NULL,
                            "warehouseId" TEXT NOT NULL,
                            "productId" TEXT NOT NULL,
                            "productName" TEXT NOT NULL,
                            "productSku" TEXT,
                            "quantity" INTEGER NOT NULL DEFAULT 0,
                            "notes" TEXT,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "WarehouseStock_pkey" PRIMARY KEY ("id"),
                            CONSTRAINT "WarehouseStock_warehouseId_productId_key" UNIQUE ("warehouseId", "productId"),
                            CONSTRAINT "WarehouseStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "${schema_name}"."Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WarehouseStock_warehouseId_idx" ON "${schema_name}"."WarehouseStock"("warehouseId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "WarehouseStock_productId_idx" ON "${schema_name}"."WarehouseStock"("productId")`).catch(() => {})

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."StockTransfer" (
                            "id" TEXT NOT NULL,
                            "code" TEXT NOT NULL,
                            "fromWarehouseId" TEXT,
                            "toWarehouseId" TEXT,
                            "status" TEXT NOT NULL DEFAULT 'completed',
                            "reason" TEXT,
                            "notes" TEXT,
                            "branchId" TEXT,
                            "userId" TEXT,
                            "userName" TEXT,
                            "totalQuantity" INTEGER NOT NULL DEFAULT 0,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id"),
                            CONSTRAINT "StockTransfer_code_key" UNIQUE ("code"),
                            CONSTRAINT "StockTransfer_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "${schema_name}"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE,
                            CONSTRAINT "StockTransfer_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "${schema_name}"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "StockTransfer_branchId_idx" ON "${schema_name}"."StockTransfer"("branchId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "StockTransfer_fromWarehouseId_idx" ON "${schema_name}"."StockTransfer"("fromWarehouseId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "StockTransfer_toWarehouseId_idx" ON "${schema_name}"."StockTransfer"("toWarehouseId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "StockTransfer_createdAt_idx" ON "${schema_name}"."StockTransfer"("createdAt")`).catch(() => {})

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."StockTransferItem" (
                            "id" TEXT NOT NULL,
                            "transferId" TEXT NOT NULL,
                            "productId" TEXT NOT NULL,
                            "productName" TEXT NOT NULL,
                            "productSku" TEXT,
                            "quantity" INTEGER NOT NULL,
                            "notes" TEXT,
                            CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id"),
                            CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "${schema_name}"."StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "StockTransferItem_transferId_idx" ON "${schema_name}"."StockTransferItem"("transferId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "StockTransferItem_productId_idx" ON "${schema_name}"."StockTransferItem"("productId")`).catch(() => {})

                    // Warehouse.vehicleId — links a warehouse to a specific vehicle (for sales trips)
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."Warehouse" ADD COLUMN IF NOT EXISTS "vehicleId" TEXT;`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_vehicleId_key" ON "${schema_name}"."Warehouse"("vehicleId") WHERE "vehicleId" IS NOT NULL`).catch(() => {})

                    // SalesTrip + SalesTripItem (van-sales / mobile selling)
                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."SalesTrip" (
                            "id" TEXT NOT NULL,
                            "code" TEXT NOT NULL,
                            "vehicleId" TEXT NOT NULL,
                            "warehouseId" TEXT NOT NULL,
                            "status" TEXT NOT NULL DEFAULT 'planned',
                            "driverId" TEXT,
                            "driverName" TEXT,
                            "salesUserId" TEXT NOT NULL,
                            "salesUserName" TEXT,
                            "branchId" TEXT,
                            "plannedDate" TIMESTAMP(3),
                            "startedAt" TIMESTAMP(3),
                            "closedAt" TIMESTAMP(3),
                            "notes" TEXT,
                            "totalLoaded" INTEGER NOT NULL DEFAULT 0,
                            "totalSold" INTEGER NOT NULL DEFAULT 0,
                            "totalReturned" INTEGER NOT NULL DEFAULT 0,
                            "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "SalesTrip_pkey" PRIMARY KEY ("id"),
                            CONSTRAINT "SalesTrip_code_key" UNIQUE ("code"),
                            CONSTRAINT "SalesTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "${schema_name}"."Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
                            CONSTRAINT "SalesTrip_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "${schema_name}"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SalesTrip_vehicleId_idx" ON "${schema_name}"."SalesTrip"("vehicleId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SalesTrip_warehouseId_idx" ON "${schema_name}"."SalesTrip"("warehouseId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SalesTrip_status_idx" ON "${schema_name}"."SalesTrip"("status")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SalesTrip_branchId_idx" ON "${schema_name}"."SalesTrip"("branchId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SalesTrip_salesUserId_idx" ON "${schema_name}"."SalesTrip"("salesUserId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SalesTrip_createdAt_idx" ON "${schema_name}"."SalesTrip"("createdAt")`).catch(() => {})

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."SalesTripItem" (
                            "id" TEXT NOT NULL,
                            "tripId" TEXT NOT NULL,
                            "productId" TEXT NOT NULL,
                            "productName" TEXT NOT NULL,
                            "productSku" TEXT,
                            "loadedQty" INTEGER NOT NULL DEFAULT 0,
                            "soldQty" INTEGER NOT NULL DEFAULT 0,
                            "returnedQty" INTEGER NOT NULL DEFAULT 0,
                            "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "notes" TEXT,
                            CONSTRAINT "SalesTripItem_pkey" PRIMARY KEY ("id"),
                            CONSTRAINT "SalesTripItem_tripId_productId_key" UNIQUE ("tripId", "productId"),
                            CONSTRAINT "SalesTripItem_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "${schema_name}"."SalesTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SalesTripItem_tripId_idx" ON "${schema_name}"."SalesTripItem"("tripId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SalesTripItem_productId_idx" ON "${schema_name}"."SalesTripItem"("productId")`).catch(() => {})

                    // Seed default warehouses (idempotent — uses isDefault flag)
                    try {
                        const existing: any[] = await registryPrisma.$queryRawUnsafe(
                            `SELECT type FROM "${schema_name}"."Warehouse" WHERE "isDefault" = true AND "branchId" IS NULL`
                        )
                        const existingTypes = new Set(existing.map((r: any) => r.type))
                        const defaults: Array<{ code: string; name: string; type: string; description: string }> = [
                            { code: `WH-MAIN-${schema_name.slice(-6).toUpperCase()}`, name: 'Kho chính', type: 'main', description: 'Kho hàng hóa chính' },
                            { code: `WH-DAMAGED-${schema_name.slice(-6).toUpperCase()}`, name: 'Kho hàng hư hỏng', type: 'damaged', description: 'Kho chứa hàng bị hư hỏng, không bán được' },
                            { code: `WH-WARRANTY-${schema_name.slice(-6).toUpperCase()}`, name: 'Kho hàng bảo hành', type: 'warranty', description: 'Kho chứa hàng đang bảo hành / đã thu hồi để bảo hành' },
                        ]
                        for (const d of defaults) {
                            if (existingTypes.has(d.type)) continue
                            await registryPrisma.$executeRawUnsafe(
                                `INSERT INTO "${schema_name}"."Warehouse" ("id", "code", "name", "type", "description", "isDefault", "isActive", "createdAt", "updatedAt")
                                 VALUES (gen_random_uuid()::text, $1, $2, $3, $4, true, true, NOW(), NOW())
                                 ON CONFLICT ("code") DO NOTHING`,
                                d.code, d.name, d.type, d.description
                            ).catch(() => {})
                        }
                    } catch {}
                    await markMigrationApplied(schemaUpgradeMigName)
                }
                console.log('✅ Security + Customer + Vehicle + Warehouse columns multi-schema migration completed')
            } catch (err: any) {
                console.error('⚠️ Schema columns migration failed:', err.message)
            }

            // --- BEGIN LEGACY DATA MIGRATION ---
            // Automatically migrate data from single-tenant public schema to the new multi-tenant schemas
            try {
                const stores = await registryPrisma.store.findMany({ where: { status: 'active' } })
                for (const store of stores) {
                    if (!store.schema.startsWith('branch_')) continue

                    const legacyMigName = `legacy_data_v1:${store.schema}`
                    if (await isMigrationApplied(legacyMigName)) continue

                    console.log(`[Migration] Checking legacy data restoration for ${store.schema}...`)
                    let hasTransaction = [{ count: 0 }]
                    try {
                        hasTransaction = await registryPrisma.$queryRawUnsafe<{ count: number }[]>(`SELECT count(*) FROM "${store.schema}"."Transaction"`)
                    } catch {
                        console.log(`[Migration] ${store.schema} table not ready, skipping.`)
                        continue
                    }
                    if (Number(hasTransaction[0]?.count || 0) > 10) {
                        console.log(`[Migration] ${store.schema} already has transactions, assuming migrated. Skipping.`)
                        await markMigrationApplied(legacyMigName)
                        continue
                    }

                    const tablesOrder = [
                        'CustomerGroup',
                        'Customer',
                        'Supplier',
                        'ProductCategory',
                        'Tax',
                        'Segment',
                        'LoyaltyTier',
                        'Product',
                        'Bundle',
                        'ProductBundle',
                        'Batch',
                        'PriceList',
                        'PriceHistory',
                        'SalesOrder',
                        'SalesOrderItem',
                        'PurchaseOrder',
                        'PurchaseOrderItem',
                        'ImportReceipt',
                        'ImportReceiptItem',
                        'Transaction',
                        'TransactionItem',
                        'InventoryTransaction',
                        'PaymentMethod',
                        'CashRegistry',
                        'Shift',
                        'ShiftSession',
                        'CashTransaction',
                        'CustomerDebtHistory',
                        'SupplierDebtHistory',
                        'SalesCheckin',
                        'Warranty',
                        'Repair',
                        'Promotion'
                    ]

                    let migratedCount = 0;
                    for (const table of tablesOrder) {
                        try {
                            const pubCols = await registryPrisma.$queryRawUnsafe<{ column_name: string }[]>(
                                `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}'`
                            )
                            const storeCols = await registryPrisma.$queryRawUnsafe<{ column_name: string }[]>(
                                `SELECT column_name FROM information_schema.columns WHERE table_schema = '${store.schema}' AND table_name = '${table}'`
                            )

                            const pCols = pubCols.map(r => r.column_name)
                            const sCols = storeCols.map(r => r.column_name)
                            if (!pCols.length || !sCols.length) continue

                            const common = pCols.filter(c => sCols.includes(c))
                            if (!common.length) continue

                            const cStr = common.map(c => `"${c}"`).join(', ')
                            const query = `INSERT INTO "${store.schema}"."${table}" (${cStr}) SELECT ${cStr} FROM "public"."${table}" ON CONFLICT DO NOTHING`

                            await registryPrisma.$executeRawUnsafe(query)
                            migratedCount++;
                        } catch (e: any) {
                            console.error(`[Migration] Error restoring ${table}: ${e.message}`)
                        }
                    }
                    if (migratedCount > 0) {
                        console.log(`[Migration] Successfully restored ${migratedCount} tables into ${store.schema}`)
                    }
                    await markMigrationApplied(legacyMigName)
                }
            } catch (err: any) {
                console.error('⚠️ Legacy data migration failed:', err.message)
            }
            // --- END LEGACY DATA MIGRATION ---

            } catch (err: any) {
                console.error('[Migration] Boot migration error (server will still start):', err.message)
            }

            const migrationElapsed = Date.now() - migrationStartTime
            console.log(`[Migration] All migrations up to date (${migrationElapsed}ms)`)

        })
        .catch((err: any) => console.error('⚠️ Registry DB connection failed:', err.message))
        .then(() => {
            httpServer.listen(PORT, () => {
                const elapsed = Date.now() - startTime
                console.log(`🚀 KengiTech API running on http://localhost:${PORT} (startup: ${elapsed}ms)`)
                console.log(`📋 Health check: http://localhost:${PORT}/api/health`)
                console.log(`🏗️ Architecture: Multi-schema (per-store isolation)`)
                console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}/ws`)
                startAutoSync()
            })
        })

    // Graceful shutdown
    const shutdown = async () => {
        console.log('🛑 Shutting down gracefully...')
        await disconnectAll()
        await cacheDisconnect()
        await pubsubDisconnect()
        stopAutoSync()
        process.exit(0)
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
}

export default app
