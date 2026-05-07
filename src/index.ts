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
import { cacheDisconnect, cacheHealth } from './lib/cache'
import { startAutoSync, stopAutoSync } from './cron/autoSync'

const app = express()
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

app.use(express.json({ limit: '10mb' }))

// ─── Rate Limiting ───────────────────────────────────────────────────────────

// Strict rate limit for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau 15 phút.' },
    skip: (req: express.Request) => process.env.NODE_ENV === 'development' && (req.ip === '::1' || req.ip === '127.0.0.1'),
})

// General API rate limit
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 300,
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

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
    const cache = await cacheHealth()
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        architecture: 'multi-schema',
        cache,
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

    registryPrisma.$connect()
        .then(() => console.log('✅ Registry DB connected'))
        .catch((err: any) => console.error('⚠️ Registry DB connection failed:', err.message))
        .then(() => {
            app.listen(PORT, () => {
                const elapsed = Date.now() - startTime
                console.log(`🚀 KengiTech API running on http://localhost:${PORT} (startup: ${elapsed}ms)`)
                console.log(`📋 Health check: http://localhost:${PORT}/api/health`)
                console.log(`🏗️ Architecture: Multi-schema (per-store isolation)`)
                startAutoSync()
            })
        })

    // Graceful shutdown
    const shutdown = async () => {
        console.log('🛑 Shutting down gracefully...')
        await disconnectAll()
        await cacheDisconnect()
        stopAutoSync()
        process.exit(0)
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
}

export default app
