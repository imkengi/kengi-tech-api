import express from 'express'
import cors from 'cors'
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

const app = express()
const PORT = process.env.PORT || 3001

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '10mb' }))

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
app.use('/api/returns', returnRoutes)
app.use('/api/debts', debtRoutes)
app.use('/api/bundles', bundleRoutes)
app.use('/api/reports/financial', financialReportRoutes)
app.use('/api/store-settings', storeSettingsRoutes)

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── Error handler ──────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err)
    res.status(500).json({ success: false, error: 'Internal server error' })
})

// ─── Start ──────────────────────────────────────────────────────────────────
// cPanel Phusion Passenger sets PASSENGER env — skip listen() in that case
if (!process.env.PASSENGER_BASE_URI) {
    app.listen(PORT, () => {
        console.log(`🚀 Open-Retail API running on http://localhost:${PORT}`)
        console.log(`📋 Health check: http://localhost:${PORT}/api/health`)
    })
}

export default app
