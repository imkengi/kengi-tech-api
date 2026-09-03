import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { registryPrisma, disconnectAll } from './lib/prisma'
import { errorDetail } from './lib/errorResponse'
import authRoutes from './routes/auth'
import productRoutes from './routes/products'
import categoryRoutes from './routes/categories'
import brandRoutes from './routes/brands'
import customerRoutes from './routes/customers'
import customerFinancialHealthRoutes from './routes/customerFinancialHealth'
import customerGroupRoutes from './routes/customerGroups'
import crmEmailRoutes from './routes/crmEmail'
import mailboxRoutes from './routes/mailbox'
import crmRoutes from './routes/crm'
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
import deliveryRouteRoutes from './routes/deliveryRoutes'
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
import mcpRoutes from './routes/mcp'
import mcpAgentRoutes from './routes/mcpAgent'
import flashSaleRoutes from './routes/flashSales'
import importDataRoutes from './routes/importData'
import uploadRoutes from './routes/uploads'
import livestreamRoutes from './routes/livestream'
import syncRoutes from './routes/sync'
import announcementRoutes from './routes/announcements'
import attendanceRoutes from './routes/attendance'
import loyaltyRoutes from './routes/loyalty'
import reviewRoutes from './routes/reviews'
import payrollRoutes from './routes/payroll'
import onlineOrderRoutes from './routes/onlineOrders'
import kiotvietRoutes from './routes/kiotviet'
import misaRoutes from './routes/misa'
import driveVideoRoutes from './routes/driveVideos'
import upgradeRequestRoutes from './routes/upgradeRequests'
import webhookRoutes from './routes/webhooks'
import packingLogRoutes from './routes/packingLogs'
import eventRoutes from './routes/events'
import warehouseRoutes from './routes/warehouses'
import salesTripRoutes from './routes/salesTrips'
import cashReceiptRoutes from './routes/cashReceipts'
import bankAccountRoutes from './routes/bankAccounts'
import accountRoutes from './routes/accounts'
import accountingRoutes from './routes/accounting'
import printTemplateRoutes from './routes/printTemplates'
import accountingReportRoutes from './routes/accountingReports'
import accountingReconcileRoutes from './routes/accountingReconcile'
import complianceRoutes from './routes/compliance'
import financialStatementRoutes from './routes/financialStatements'
import taxDeclarationRoutes from './routes/taxDeclarations'
import taxAuditRoutes from './routes/taxAudit'
import strategyRoutes from './routes/strategy'
import aiReportRoutes from './routes/aiReports'
import fanpageRoutes from './routes/fanpage'
import aiJobRoutes from './routes/aiJobs'
import { cacheDisconnect, cacheHealth } from './lib/cache'
import { startAutoSync, stopAutoSync, choAutoSyncXong } from './cron/autoSync'
import { startHanThanhToanCron } from './cron/hanThanhToanCron'
import { batCoDangTat } from './lib/choXong'
import { startFlashSaleScheduler } from './cron/flashSaleScheduler'
import { startEInvoiceQueueCron } from './cron/einvoiceQueue'
import { startKiotVietNightlyCron, stopKiotVietNightlyCron } from './cron/kiotvietNightly'
import { startFanpageCron, stopFanpageCron } from './cron/fanpageCron'
import { startAiAgentCron, stopAiAgentCron } from './cron/aiAgentCron'
import { startWebhookCron, stopWebhookCron } from './cron/webhookCron'
import { startTaxAuditCron, stopTaxAuditCron } from './cron/taxAuditCron'
import { startTaxDeadlineCron, stopTaxDeadlineCron } from './cron/taxDeadlineCron'
import { startReconcileCron, stopReconcileCron } from './cron/reconcileCron'
import { startWeeklyBriefCron, stopWeeklyBriefCron } from './cron/weeklyBriefCron'
import { startEmailReplyCron, stopEmailReplyCron } from './cron/emailReplyCron'
import webhookEndpointRoutes from './routes/webhookEndpoints'
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
    'https://studio.kengi.vn', // Nguyệt Các Tarot (trang tĩnh trên Tino)
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3100', // Kengi Stream studio dev
    'http://localhost:4189', // Nguyệt Các Tarot chạy máy local (tarot-server.js)
    'http://127.0.0.1:4189',
    'http://localhost:8791', // xem thử trang studio ở máy (python http.server)
]
app.use(cors({
    /* Origin lạ thì TỪ CHỐI SẠCH, không ném Error.
     *
     * Ném Error làm Express trả 500 — kể cả cho preflight OPTIONS. Trên log
     * production 7 ngày: 300 request 5xx, TOÀN BỘ là do đây (166 lần
     * /notifications/stream, 106 lần OPTIONS /notifications, 28 lần
     * OPTIONS /events). Không chặn được gì thêm so với cách từ chối sạch —
     * trình duyệt vẫn chặn vì thiếu header CORS — nhưng lại:
     *   - đội 5xx của dịch vụ lên, làm cảnh báo hạ tầng kêu oan;
     *   - đổ "Unhandled error" vào log, che mất lỗi thật (đúng ba lỗi im lặng
     *     tìm ra hôm nay đều nằm lẫn trong đống này).
     *
     * callback(null, false) = không gắn header CORS, không lỗi. */
    origin: (origin, callback) => {
        callback(null, !origin || allowedOrigins.includes(origin))
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

// Very strict limit for signup — each signup provisions a new PostgreSQL schema
// and pushes the full table set (expensive + blocking), so it's a prime DoS target.
const signupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,                    // 3 store signups per IP per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Quá nhiều lần đăng ký. Vui lòng thử lại sau 1 giờ.' },
    skip: (req: express.Request) => process.env.NODE_ENV === 'development' && (req.ip === '::1' || req.ip === '127.0.0.1'),
})

// Token exchange (API key → JWT) — mỗi request tốn 1 bcrypt.compare (~100ms CPU)
// nên là mục tiêu DoS/brute-force; siết chặt hơn hẳn limiter chung.
const tokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Quá nhiều yêu cầu đổi token. Vui lòng thử lại sau 15 phút.' },
    skip: (req: express.Request) => process.env.NODE_ENV === 'development' && (req.ip === '::1' || req.ip === '127.0.0.1'),
})

// Gửi OTP email: route đã có cooldown theo (email, store) nhưng xoay vòng email
// lạ sẽ lách được — chặn thêm theo IP để không bị lợi dụng bắn mail hàng loạt.
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Quá nhiều yêu cầu gửi mã. Vui lòng thử lại sau 15 phút.' },
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

app.use('/api/auth/signup', signupLimiter)
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/token', tokenLimiter)
app.use('/api/auth/send-otp', otpLimiter)
app.use('/api/auth/verify-2fa', otpLimiter) // chống brute-force mã TOTP
app.use('/api/auth/verify-otp', otpLimiter)
app.use('/api/tarot/auth', authLimiter) // đăng nhập Google của trang tarot
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
app.use('/api/customers', customerFinancialHealthRoutes) // TRƯỚC customerRoutes: '/:id' bên đó sẽ nuốt '/financial-overview'
app.use('/api/customers', customerRoutes)
app.use('/api/customer-groups', customerGroupRoutes)
app.use('/api/crm', crmEmailRoutes)
app.use('/api/mailbox', mailboxRoutes)
app.use('/api/crm', crmRoutes)
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
app.use('/api/delivery-routes', deliveryRouteRoutes)
app.use('/api/vehicles', vehicleRoutes)
app.use('/api/tax', taxDeclarationRoutes) // BCTC phase-2 tax forms (no path overlap with taxRoutes)
// Kiểm tra trước thanh tra thuế — /audit-check, không trùng path nào của taxRoutes
app.use('/api/tax', taxAuditRoutes)
app.use('/api/strategy', strategyRoutes)
app.use('/api/ai-reports', aiReportRoutes)
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
// Cổng đồng bộ KiotViet. Webhook /api/kiotviet/webhook/:storeCode/:token là
// CÔNG KHAI (KiotViet không gửi được admin key) — bảo vệ bằng token trong URL;
// phần quản trị còn lại nằm sau adminAuth ngay trong file route.
app.use('/api/kiotviet', kiotvietRoutes)
// Cổng đồng bộ MISA AMIS Kế toán — toàn bộ sau adminAuth, không có webhook công khai
app.use('/api/misa', misaRoutes)
app.use('/api/import-data', importDataRoutes)
app.use('/api/uploads', uploadRoutes)
app.use('/api/livestream', livestreamRoutes) // Kengi Stream studio (kengi.vn/ai-livestream)
app.use('/api/mcp', mcpRoutes) // MCP server cho AI agent (Streamable HTTP, X-API-Key + x-store-code)
app.use('/api/mcp-agent', mcpAgentRoutes) // Trợ lý AI dashboard (Gemini + MCP tools)
app.use('/api/flash-sales', flashSaleRoutes) // Flash sale hàng loạt Shopee (hàng đợi tuần tự)
app.use('/api/internal', syncRoutes)
app.use('/api/announcements', announcementRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/loyalty', loyaltyRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/payroll', payrollRoutes)
app.use('/api/online-orders', onlineOrderRoutes)
app.use('/api/drive-videos', driveVideoRoutes) // Video đóng gói trên Google Drive ↔ đơn sàn (ghép theo mã vận đơn)
app.use('/api/upgrade-requests', upgradeRequestRoutes)
app.use('/api/webhooks', webhookRoutes)
app.use('/api/packing-logs', packingLogRoutes)
app.use('/api/webhook-endpoints', webhookEndpointRoutes)
app.use('/api/warehouses', warehouseRoutes)
app.use('/api/sales-trips', salesTripRoutes)
app.use('/api/cash-receipts', cashReceiptRoutes)
app.use('/api/bank-accounts', bankAccountRoutes)

// ─── Accounting (Thông tư 99/2025) ──────────────────────────────────────────
// Chart of accounts CRUD, period locking, closing entries, carry-forward, and
// the bookkeeping reports. accountingReportRoutes mounts at /api/reports AFTER
// /api/reports/financial (mounted above) so the more specific prefix wins.
app.use('/api/accounts', accountRoutes)
app.use('/api/print-templates', printTemplateRoutes)
app.use('/api/accounting', accountingRoutes)
// Đối chiếu sổ sách — mount SAU accountingRoutes, đường dẫn /reconcile* không
// trùng với /lock-status, /close-period, /carry-forward nên không che nhau.
app.use('/api/accounting', accountingReconcileRoutes)
// Tuân thủ pháp lý — FE /dashboard-compliance gọi 2 endpoint này (trước đây 404)
app.use('/api/compliance', complianceRoutes)
// Financial statements (B01/B02/B03-DNN) mount at /api/reports before the
// bookkeeping reports; their paths never overlap.
app.use('/api/reports', financialStatementRoutes)
app.use('/api/reports', accountingReportRoutes)

import einvoiceRoutes from './routes/einvoice'
app.use('/api/einvoice', einvoiceRoutes)

// ─── Accounting Phase 4 — TSCĐ, CCDC, E-Banking ─────────────────────────────
import fixedAssetsRoutes from './routes/fixedAssets'
import ccdcRoutes from './routes/ccdc'
import ebankingRoutes from './routes/ebanking'
app.use('/api/fixed-assets', fixedAssetsRoutes)
app.use('/api/ccdc', ccdcRoutes)
app.use('/api/ebanking', ebankingRoutes)

import storageRoutes from './routes/storage'
app.use('/api/storage', storageRoutes)

import chatRoutes from './routes/chat'
app.use('/api/online-orders/chat', chatRoutes)
app.use('/api/fanpage', fanpageRoutes)
app.use('/api/ai-jobs', aiJobRoutes) // Tro ly AI tu dong theo lich

// Content AI (hàng đợi bài chờ duyệt). Từng bị ngắt 04/08/2026 vì file route
// chưa commit làm Cloud Build fail — đã commit 15/08/2026, mở lại.
import marketingRoutes from './routes/marketing'
app.use('/api/marketing', marketingRoutes) // AI len content fanpage (hang doi cho duyet)

// Nguyệt Các Tarot (kengi.vn/tarot) — đăng nhập Google + lưu lịch sử trải bài.
// Hệ tài khoản RIÊNG, không dùng chung với tài khoản cửa hàng.
import tarotRoutes from './routes/tarot'
import { moTaLoi } from './lib/gomLoi'
app.use('/api/tarot', tarotRoutes)

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
    const cache = await cacheHealth()
    const ws = getWebSocketStats()
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        architecture: 'multi-schema',
        /* DẤU ẤN BẢN ĐANG CHẠY (20/08/2026). Sự cố hôm nay: prod chạy ảnh cũ hơn cây mã, thiếu bản
         * vá "thiếu ≠ 0", và KHÔNG có cách nào biết trong một lần gọi — phải đi dò từng route xem
         * cái nào 404. Nay `npm run deploy:gcloud` đóng commit + trạng thái cây vào env, chỗ này
         * trả lại. `trangThai: 'ban'` = deploy từ cây có sửa chưa commit. */
        build: {
            sha: process.env.BUILD_GIT_SHA || 'khong-ro',
            trangThai: process.env.BUILD_GIT_TRANG_THAI || 'khong-ro',
            buildId: process.env.BUILD_ID || 'khong-ro',
        },
        cache,
        websocket: ws,
    })
})

// ─── Error handler ──────────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err)

    /**
     * LỖI CỦA NGƯỜI GỌI THÌ ĐỪNG BÁO THÀNH LỖI MÁY CHỦ.
     *
     * body-parser ném SyntaxError kèm sẵn status 400 khi thân request không
     * phải JSON hợp lệ, nhưng khối này vứt status đó đi và trả 500
     * "Internal server error" — người tích hợp nhìn vào tưởng máy chủ sập,
     * đi tìm nhầm chỗ (chính tôi vừa mất một lượt vì nó, 10/08/2026).
     *
     * 4xx là lỗi phía gửi lên: giữ nguyên mã và nói rõ sai ở đâu. Chỉ 5xx mới
     * giấu chi tiết, vì đó mới là chuyện nội bộ không nên lộ ra ngoài.
     */
    const status = Number(err?.status || err?.statusCode) || 500
    if (status >= 400 && status < 500) {
        const laJsonHong = err?.type === 'entity.parse.failed' || err instanceof SyntaxError
        res.status(status).json({
            success: false,
            error: laJsonHong
                ? 'Dữ liệu gửi lên không phải JSON hợp lệ'
                : (typeof err?.message === 'string' && err.message) || 'Yêu cầu không hợp lệ',
        })
        return
    }
    res.status(500).json({ success: false, error: 'Internal server error', detail: errorDetail(err) })
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

            // Auto-create Pending2FA table if not exists (idempotent migration).
            // Backs the 2FA login handshake so verify requests work across Cloud Run instances.
            if (!(await isMigrationApplied('pending_2fa_v1'))) {
            try {
                await registryPrisma.$executeRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS "public"."Pending2FA" (
                        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                        "loginToken" TEXT UNIQUE NOT NULL,
                        "userId" TEXT NOT NULL,
                        email TEXT NOT NULL,
                        role TEXT NOT NULL,
                        "storeId" TEXT NOT NULL,
                        "storeCode" TEXT NOT NULL,
                        "branchId" TEXT,
                        "branchSchema" TEXT NOT NULL,
                        "isMainBranch" BOOLEAN NOT NULL DEFAULT false,
                        "deviceId" TEXT,
                        "userData" TEXT NOT NULL,
                        "storeData" TEXT NOT NULL,
                        "branchData" TEXT,
                        "expiresAt" TIMESTAMP NOT NULL,
                        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
                    )
                `)
                await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Pending2FA_loginToken_idx" ON "public"."Pending2FA"("loginToken")`)
                await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Pending2FA_expiresAt_idx" ON "public"."Pending2FA"("expiresAt")`)
                await markMigrationApplied('pending_2fa_v1')
                console.log('✅ Pending2FA table ready')
            } catch (err: any) {
                console.error('⚠️ Pending2FA table migration failed:', err.message)
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

            // Promotion usage tracking — Transaction.appliedPromotionIds (JSON-encoded list)
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `promotion_usage_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."Transaction" ADD COLUMN IF NOT EXISTS "appliedPromotionIds" TEXT;`).catch(() => {})
                    await markMigrationApplied(migName)
                }
            } catch (err: any) {
                console.error('⚠️ Promotion usage migration failed:', err.message)
            }

            // Delivery routes — admin-planned multi-stop driver routes
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `delivery_route_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue
                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."DeliveryRoute" (
                            "id" TEXT NOT NULL,
                            "name" TEXT NOT NULL,
                            "date" TEXT NOT NULL,
                            "driverId" TEXT NOT NULL,
                            "driverName" TEXT NOT NULL,
                            "status" TEXT NOT NULL DEFAULT 'planned',
                            "startTime" TIMESTAMP(3),
                            "endTime" TIMESTAMP(3),
                            "fuelCost" TEXT,
                            "createdBy" TEXT NOT NULL,
                            "branchId" TEXT,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "DeliveryRoute_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeliveryRoute_driverId_idx" ON "${schema_name}"."DeliveryRoute"("driverId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeliveryRoute_date_idx" ON "${schema_name}"."DeliveryRoute"("date")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeliveryRoute_status_idx" ON "${schema_name}"."DeliveryRoute"("status")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeliveryRoute_branchId_idx" ON "${schema_name}"."DeliveryRoute"("branchId")`).catch(() => {})

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."DeliveryStop" (
                            "id" TEXT NOT NULL,
                            "routeId" TEXT NOT NULL,
                            "sequence" INTEGER NOT NULL,
                            "customerName" TEXT NOT NULL,
                            "customerPhone" TEXT,
                            "address" TEXT NOT NULL,
                            "invoiceCode" TEXT,
                            "invoiceId" TEXT,
                            "productCount" INTEGER NOT NULL DEFAULT 0,
                            "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "status" TEXT NOT NULL DEFAULT 'pending',
                            "notes" TEXT,
                            "deliveredAt" TIMESTAMP(3),
                            CONSTRAINT "DeliveryStop_pkey" PRIMARY KEY ("id"),
                            CONSTRAINT "DeliveryStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "${schema_name}"."DeliveryRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeliveryStop_routeId_idx" ON "${schema_name}"."DeliveryStop"("routeId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DeliveryStop_status_idx" ON "${schema_name}"."DeliveryStop"("status")`).catch(() => {})

                    await markMigrationApplied(migName)
                }
            } catch (err: any) {
                console.error('⚠️ Delivery route migration failed:', err.message)
            }

            // StoreSettings — store hours + sales targets (per-tenant config)
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `store_settings_hours_targets_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."StoreSettings" ADD COLUMN IF NOT EXISTS "openTime" TEXT;`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."StoreSettings" ADD COLUMN IF NOT EXISTS "closeTime" TEXT;`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."StoreSettings" ADD COLUMN IF NOT EXISTS "dailyRevenueTarget" DOUBLE PRECISION;`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."StoreSettings" ADD COLUMN IF NOT EXISTS "monthlyRevenueTarget" DOUBLE PRECISION;`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."StoreSettings" ADD COLUMN IF NOT EXISTS "dailyOrderTarget" INTEGER;`).catch(() => {})
                    await markMigrationApplied(migName)
                }
                console.log('✅ StoreSettings hours+targets migration completed')
            } catch (err: any) {
                console.error('⚠️ StoreSettings hours+targets migration failed:', err.message)
            }

            // CashReceipt table + Expense cashflow columns (bankAccountId, status, cancellation)
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `cash_receipt_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue

                    // Create CashReceipt table
                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."CashReceipt" (
                            "id" TEXT NOT NULL,
                            "description" TEXT NOT NULL,
                            "amount" DOUBLE PRECISION NOT NULL,
                            "category" TEXT NOT NULL,
                            "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "receivedVia" TEXT,
                            "bankAccountId" TEXT,
                            "customerId" TEXT,
                            "customerName" TEXT,
                            "reference" TEXT,
                            "status" TEXT NOT NULL DEFAULT 'active',
                            "cancelledAt" TIMESTAMP(3),
                            "cancelReason" TEXT,
                            "branchId" TEXT,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "CashReceipt_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CashReceipt_branchId_idx" ON "${schema_name}"."CashReceipt"("branchId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CashReceipt_date_idx" ON "${schema_name}"."CashReceipt"("date")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CashReceipt_bankAccountId_idx" ON "${schema_name}"."CashReceipt"("bankAccountId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CashReceipt_status_idx" ON "${schema_name}"."CashReceipt"("status")`).catch(() => {})

                    // Expense — cashflow linkage + cancellation columns
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."Expense" ADD COLUMN IF NOT EXISTS "bankAccountId" TEXT;`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."Expense" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."Expense" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."Expense" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Expense_status_idx" ON "${schema_name}"."Expense"("status")`).catch(() => {})

                    await markMigrationApplied(migName)
                }
                console.log('✅ CashReceipt + Expense cashflow migration completed')
            } catch (err: any) {
                console.error('⚠️ CashReceipt + Expense cashflow migration failed:', err.message)
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
                            console.error(`[Migration] Error restoring ${table}: ${moTaLoi(e)}`)
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

            // Auto-journal support — JournalEntry.referenceType + StoreSettings.autoCreateJournalEntries
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `auto_journal_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue
                    // JournalEntry.referenceType for tagging auto vs manual entries
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."JournalEntry" ADD COLUMN IF NOT EXISTS "referenceType" TEXT NOT NULL DEFAULT 'manual';`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "JournalEntry_referenceType_idx" ON "${schema_name}"."JournalEntry"("referenceType")`).catch(() => {})
                    // StoreSettings.autoCreateJournalEntries toggle
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."StoreSettings" ADD COLUMN IF NOT EXISTS "autoCreateJournalEntries" BOOLEAN NOT NULL DEFAULT true;`).catch(() => {})
                    await markMigrationApplied(migName)
                }
                console.log('✅ Auto-journal columns migration completed')
            } catch (err: any) {
                console.error('⚠️ Auto-journal migration failed:', err.message)
            }

            // discountType support — Transaction.discountType + TransactionItem.discountType
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `discount_type_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."Transaction" ADD COLUMN IF NOT EXISTS "discountType" TEXT DEFAULT 'fixed';`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."TransactionItem" ADD COLUMN IF NOT EXISTS "discountType" TEXT DEFAULT 'fixed';`).catch(() => {})
                    await markMigrationApplied(migName)
                }
                console.log('✅ discountType columns migration completed')
            } catch (err: any) {
                console.error('⚠️ discountType migration failed:', err.message)
            }

            // PeriodLock — accounting period locking (khóa sổ kế toán) per TT99/2025
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `period_lock_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue
                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."PeriodLock" (
                            "id" TEXT NOT NULL,
                            "lockDate" TEXT NOT NULL,
                            "periodType" TEXT NOT NULL DEFAULT 'month',
                            "note" TEXT,
                            "isActive" BOOLEAN NOT NULL DEFAULT true,
                            "lockedBy" TEXT,
                            "lockedByName" TEXT,
                            "unlockedAt" TIMESTAMP(3),
                            "unlockedBy" TEXT,
                            "unlockReason" TEXT,
                            "branchId" TEXT,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "PeriodLock_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PeriodLock_isActive_idx" ON "${schema_name}"."PeriodLock"("isActive")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PeriodLock_lockDate_idx" ON "${schema_name}"."PeriodLock"("lockDate")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PeriodLock_branchId_idx" ON "${schema_name}"."PeriodLock"("branchId")`).catch(() => {})
                    await markMigrationApplied(migName)
                }
                console.log('✅ PeriodLock migration completed')
            } catch (err: any) {
                console.error('⚠️ PeriodLock migration failed:', err.message)
            }

            // E-Invoice Phase 3 — Hóa đơn điện tử (TT78/2021/TT-BTC).
            // Creates EInvoice / EInvoiceItem / EInvoiceConfig and upgrades the
            // legacy EInvoice / EInvoiceConfig tables (Phase-1 issuance flow) with
            // the richer lifecycle columns. Idempotent (IF NOT EXISTS everywhere).
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `einvoice_phase3_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue

                    // EInvoice — create (fresh schemas) then add Phase-3 columns
                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."EInvoice" (
                            "id" TEXT NOT NULL,
                            "status" TEXT NOT NULL DEFAULT 'DRAFT',
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "EInvoice_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    const eiCols: Array<[string, string]> = [
                        ['transactionId', 'TEXT'], ['provider', 'TEXT'], ['lookupCode', 'TEXT'],
                        ['xmlData', 'TEXT'], ['errorMessage', 'TEXT'],
                        ['invoiceNumber', 'TEXT'], ['invoiceSymbol', 'TEXT'], ['invoiceDate', 'TEXT'],
                        ['invoiceType', `TEXT NOT NULL DEFAULT 'SALE'`],
                        ['sellerName', 'TEXT'], ['sellerTaxCode', 'TEXT'], ['sellerAddress', 'TEXT'],
                        ['buyerName', 'TEXT'], ['buyerTaxCode', 'TEXT'], ['buyerAddress', 'TEXT'],
                        ['totalBeforeVat', 'DOUBLE PRECISION NOT NULL DEFAULT 0'],
                        ['vatAmount', 'DOUBLE PRECISION NOT NULL DEFAULT 0'],
                        ['totalAmount', 'DOUBLE PRECISION NOT NULL DEFAULT 0'],
                        ['currency', `TEXT NOT NULL DEFAULT 'VND'`], ['paymentMethod', 'TEXT'],
                        ['xmlContent', 'TEXT'], ['pdfUrl', 'TEXT'],
                        ['providerInvoiceId', 'TEXT'], ['providerResponse', 'TEXT'],
                        ['replacesInvoiceId', 'TEXT'], ['replacedByInvoiceId', 'TEXT'],
                        ['cancelReason', 'TEXT'], ['notes', 'TEXT'], ['branchId', 'TEXT'],
                        ['createdBy', 'TEXT'], ['createdByName', 'TEXT'],
                        ['issuedAt', 'TIMESTAMP(3)'], ['signedAt', 'TIMESTAMP(3)'],
                        ['sentAt', 'TIMESTAMP(3)'], ['cancelledAt', 'TIMESTAMP(3)'],
                        ['updatedAt', 'TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP'],
                    ]
                    for (const [col, type] of eiCols) {
                        await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."EInvoice" ADD COLUMN IF NOT EXISTS "${col}" ${type};`).catch(() => {})
                    }
                    // Make legacy required columns nullable (drafts have no transaction/provider yet)
                    for (const col of ['transactionId', 'provider']) {
                        await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."EInvoice" ALTER COLUMN "${col}" DROP NOT NULL;`).catch(() => {})
                    }
                    for (const [col, idxCol] of [['EInvoice_status_idx', 'status'], ['EInvoice_invoiceNumber_idx', 'invoiceNumber'], ['EInvoice_invoiceDate_idx', 'invoiceDate'], ['EInvoice_buyerTaxCode_idx', 'buyerTaxCode'], ['EInvoice_branchId_idx', 'branchId'], ['EInvoice_transactionId_idx', 'transactionId']]) {
                        await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${col}" ON "${schema_name}"."EInvoice"("${idxCol}")`).catch(() => {})
                    }

                    // EInvoiceItem
                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."EInvoiceItem" (
                            "id" TEXT NOT NULL,
                            "eInvoiceId" TEXT NOT NULL,
                            "itemNumber" INTEGER NOT NULL DEFAULT 0,
                            "itemName" TEXT NOT NULL,
                            "unitName" TEXT,
                            "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "notes" TEXT,
                            CONSTRAINT "EInvoiceItem_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EInvoiceItem_eInvoiceId_idx" ON "${schema_name}"."EInvoiceItem"("eInvoiceId")`).catch(() => {})

                    // EInvoiceConfig — create then add Phase-3 columns
                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."EInvoiceConfig" (
                            "id" TEXT NOT NULL,
                            "provider" TEXT NOT NULL DEFAULT 'CUSTOM',
                            "active" BOOLEAN NOT NULL DEFAULT true,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "EInvoiceConfig_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    const cfgCols: Array<[string, string]> = [
                        ['apiUrl', 'TEXT'], ['apiKey', 'TEXT'], ['apiSecret', 'TEXT'], ['taxCode', 'TEXT'],
                        ['templateId', 'TEXT'], ['serialNo', 'TEXT'], ['extra', 'TEXT'],
                        ['apiUsername', 'TEXT'], ['apiPassword', 'TEXT'],
                        ['companyName', 'TEXT'], ['companyAddress', 'TEXT'],
                        ['invoicePattern', 'TEXT'], ['invoiceSerial', 'TEXT'], ['certificateSerial', 'TEXT'],
                        ['isActive', 'BOOLEAN NOT NULL DEFAULT true'],
                    ]
                    for (const [col, type] of cfgCols) {
                        await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."EInvoiceConfig" ADD COLUMN IF NOT EXISTS "${col}" ${type};`).catch(() => {})
                    }
                    // Legacy required columns become nullable (new config shape may omit them)
                    for (const col of ['apiUrl', 'apiKey', 'apiSecret', 'taxCode']) {
                        await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."EInvoiceConfig" ALTER COLUMN "${col}" DROP NOT NULL;`).catch(() => {})
                    }

                    await markMigrationApplied(migName)
                }
                console.log('✅ E-Invoice Phase 3 migration completed')
            } catch (err: any) {
                console.error('⚠️ E-Invoice Phase 3 migration failed:', err.message)
            }

            // Fixed Assets Phase 4 — TSCĐ (TT99/2025). Adds the Phase-4 columns to
            // the legacy FixedAsset table and creates DepreciationEntry. Idempotent.
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `fixed_assets_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."FixedAsset" (
                            "id" TEXT NOT NULL,
                            "code" TEXT NOT NULL,
                            "name" TEXT NOT NULL,
                            "category" TEXT NOT NULL DEFAULT 'tangible',
                            "acquisitionDate" TEXT NOT NULL DEFAULT '',
                            "originalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "usefulLifeMonths" INTEGER NOT NULL DEFAULT 0,
                            "method" TEXT NOT NULL DEFAULT 'straight-line',
                            "accumulatedDepreciation" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "netBookValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "monthlyDepreciation" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "depreciationAccount" TEXT NOT NULL DEFAULT '6424',
                            "residualValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "status" TEXT NOT NULL DEFAULT 'active',
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    const faCols: Array<[string, string]> = [
                        ['acquisitionCost', 'DOUBLE PRECISION NOT NULL DEFAULT 0'],
                        ['depreciationMethod', `TEXT NOT NULL DEFAULT 'straight_line'`],
                        ['accountCode', `TEXT NOT NULL DEFAULT '211'`],
                        ['depAccAccountCode', `TEXT NOT NULL DEFAULT '2141'`],
                        ['expenseAccountCode', `TEXT NOT NULL DEFAULT '6424'`],
                        ['disposalDate', 'TEXT'], ['disposalAmount', 'DOUBLE PRECISION'],
                        ['department', 'TEXT'], ['description', 'TEXT'],
                        ['branchId', 'TEXT'], ['notes', 'TEXT'],
                    ]
                    for (const [col, type] of faCols) {
                        await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."FixedAsset" ADD COLUMN IF NOT EXISTS "${col}" ${type};`).catch(() => {})
                    }
                    for (const [idx, col] of [['FixedAsset_status_idx', 'status'], ['FixedAsset_category_idx', 'category'], ['FixedAsset_branchId_idx', 'branchId']]) {
                        await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${idx}" ON "${schema_name}"."FixedAsset"("${col}")`).catch(() => {})
                    }

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."DepreciationEntry" (
                            "id" TEXT NOT NULL,
                            "assetId" TEXT NOT NULL,
                            "month" INTEGER NOT NULL,
                            "year" INTEGER NOT NULL,
                            "beginningValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "depreciationAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "accumulatedDepreciation" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "endingValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "journalEntryId" TEXT,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "DepreciationEntry_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DepreciationEntry_assetId_idx" ON "${schema_name}"."DepreciationEntry"("assetId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DepreciationEntry_year_month_idx" ON "${schema_name}"."DepreciationEntry"("year","month")`).catch(() => {})

                    await markMigrationApplied(migName)
                }
                console.log('✅ Fixed Assets Phase 4 migration completed')
            } catch (err: any) {
                console.error('⚠️ Fixed Assets Phase 4 migration failed:', err.message)
            }

            // CCDC Phase 4 — Công cụ dụng cụ (TT99/2025). Creates CCDC + CCDCAllocation.
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `ccdc_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."CCDC" (
                            "id" TEXT NOT NULL,
                            "code" TEXT NOT NULL,
                            "name" TEXT NOT NULL,
                            "category" TEXT,
                            "acquisitionDate" TEXT,
                            "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "allocationMonths" INTEGER NOT NULL DEFAULT 1,
                            "monthlyAllocation" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "allocatedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "remainingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "accountCode" TEXT NOT NULL DEFAULT '242',
                            "expenseAccountCode" TEXT NOT NULL DEFAULT '642',
                            "status" TEXT NOT NULL DEFAULT 'allocating',
                            "branchId" TEXT,
                            "notes" TEXT,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "CCDC_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CCDC_status_idx" ON "${schema_name}"."CCDC"("status")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CCDC_branchId_idx" ON "${schema_name}"."CCDC"("branchId")`).catch(() => {})

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."CCDCAllocation" (
                            "id" TEXT NOT NULL,
                            "ccdcId" TEXT NOT NULL,
                            "month" INTEGER NOT NULL,
                            "year" INTEGER NOT NULL,
                            "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "journalEntryId" TEXT,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "CCDCAllocation_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CCDCAllocation_ccdcId_idx" ON "${schema_name}"."CCDCAllocation"("ccdcId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CCDCAllocation_year_month_idx" ON "${schema_name}"."CCDCAllocation"("year","month")`).catch(() => {})

                    await markMigrationApplied(migName)
                }
                console.log('✅ CCDC Phase 4 migration completed')
            } catch (err: any) {
                console.error('⚠️ CCDC Phase 4 migration failed:', err.message)
            }

            // E-Banking Phase 4 — Ngân hàng điện tử. Adds the Phase-4 columns to the
            // legacy BankAccount / BankTransaction tables (sao kê + đối soát).
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `ebanking_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."BankAccount" (
                            "id" TEXT NOT NULL,
                            "bankName" TEXT NOT NULL DEFAULT '',
                            "accountNumber" TEXT NOT NULL DEFAULT '',
                            "accountName" TEXT,
                            "isDefault" BOOLEAN NOT NULL DEFAULT false,
                            "status" TEXT NOT NULL DEFAULT 'active',
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    const baCols: Array<[string, string]> = [
                        ['bankBranch', 'TEXT'], ['currency', `TEXT NOT NULL DEFAULT 'VND'`],
                        ['balance', 'DOUBLE PRECISION NOT NULL DEFAULT 0'],
                        ['lastSyncAt', 'TIMESTAMP(3)'], ['branchId', 'TEXT'],
                    ]
                    for (const [col, type] of baCols) {
                        await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."BankAccount" ADD COLUMN IF NOT EXISTS "${col}" ${type};`).catch(() => {})
                    }
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BankAccount_branchId_idx" ON "${schema_name}"."BankAccount"("branchId")`).catch(() => {})

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."BankTransaction" (
                            "id" TEXT NOT NULL,
                            "bankAccountId" TEXT,
                            "type" TEXT NOT NULL DEFAULT 'credit',
                            "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "description" TEXT NOT NULL DEFAULT '',
                            "reference" TEXT,
                            "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    const btCols: Array<[string, string]> = [
                        ['transactionDate', 'TIMESTAMP(3)'], ['referenceNo', 'TEXT'],
                        ['counterpartyName', 'TEXT'], ['counterpartyAccount', 'TEXT'],
                        ['isReconciled', 'BOOLEAN NOT NULL DEFAULT false'], ['reconciledAt', 'TIMESTAMP(3)'],
                        ['journalEntryId', 'TEXT'], ['matchedSaleId', 'TEXT'], ['matchedExpenseId', 'TEXT'],
                        ['branchId', 'TEXT'], ['notes', 'TEXT'],
                    ]
                    for (const [col, type] of btCols) {
                        await registryPrisma.$executeRawUnsafe(`ALTER TABLE "${schema_name}"."BankTransaction" ADD COLUMN IF NOT EXISTS "${col}" ${type};`).catch(() => {})
                    }
                    for (const [idx, col] of [['BankTransaction_isReconciled_idx', 'isReconciled'], ['BankTransaction_transactionDate_idx', 'transactionDate'], ['BankTransaction_branchId_idx', 'branchId']]) {
                        await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${idx}" ON "${schema_name}"."BankTransaction"("${col}")`).catch(() => {})
                    }

                    await markMigrationApplied(migName)
                }
                console.log('✅ E-Banking Phase 4 migration completed')
            } catch (err: any) {
                console.error('⚠️ E-Banking Phase 4 migration failed:', err.message)
            }

            // Payroll Phase 4 — Tiền lương. Creates Employee / PayrollPeriod / PayrollEntry.
            // (The route also lazily ensures these tables; this covers existing schemas at boot.)
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `payroll_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."Employee" (
                            "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
                            "position" TEXT, "department" TEXT,
                            "baseSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "bankAccount" TEXT, "bankName" TEXT, "taxCode" TEXT,
                            "socialInsuranceNo" TEXT, "startDate" TEXT, "endDate" TEXT,
                            "status" TEXT NOT NULL DEFAULT 'active',
                            "dependents" INTEGER NOT NULL DEFAULT 0,
                            "notes" TEXT, "branchId" TEXT,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    for (const [idx, col] of [['Employee_status_idx', 'status'], ['Employee_code_idx', 'code'], ['Employee_branchId_idx', 'branchId']]) {
                        await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${idx}" ON "${schema_name}"."Employee"("${col}")`).catch(() => {})
                    }

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."PayrollPeriod" (
                            "id" TEXT NOT NULL, "month" INTEGER NOT NULL, "year" INTEGER NOT NULL,
                            "status" TEXT NOT NULL DEFAULT 'draft',
                            "totalGross" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "totalDeductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "totalNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "notes" TEXT, "branchId" TEXT, "createdBy" TEXT,
                            "confirmedAt" TIMESTAMP(3), "paidAt" TIMESTAMP(3),
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    for (const [idx, col] of [['PayrollPeriod_status_idx', 'status'], ['PayrollPeriod_branchId_idx', 'branchId']]) {
                        await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${idx}" ON "${schema_name}"."PayrollPeriod"("${col}")`).catch(() => {})
                    }
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PayrollPeriod_year_month_idx" ON "${schema_name}"."PayrollPeriod"("year","month")`).catch(() => {})

                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."PayrollEntry" (
                            "id" TEXT NOT NULL, "periodId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
                            "employeeCode" TEXT, "employeeName" TEXT,
                            "workDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "baseSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "allowances" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "overtimePay" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "grossSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "bhxhEmployee" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "bhytEmployee" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "bhtnEmployee" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "bhxhEmployer" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "bhytEmployer" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "bhtnEmployer" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "totalInsuranceEmployee" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "totalInsuranceEmployer" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "totalInsuranceDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "taxableIncome" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "personalDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "dependentDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "dependents" INTEGER NOT NULL DEFAULT 0,
                            "assessableIncome" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "pitAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "netSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "bankTransferAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            "notes" TEXT,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PayrollEntry_periodId_idx" ON "${schema_name}"."PayrollEntry"("periodId")`).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PayrollEntry_employeeId_idx" ON "${schema_name}"."PayrollEntry"("employeeId")`).catch(() => {})

                    await markMigrationApplied(migName)
                }
                console.log('✅ Payroll Phase 4 migration completed')
            } catch (err: any) {
                console.error('⚠️ Payroll Phase 4 migration failed:', err.message)
            }

            // E-Banking config Phase 4 — BankConnectionConfig (provider sync credentials).
            try {
                const schemas: any[] = await registryPrisma.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'public')`
                for (const { schema_name } of schemas) {
                    const migName = `ebanking_config_v1:${schema_name}`
                    if (await isMigrationApplied(migName)) continue
                    await registryPrisma.$executeRawUnsafe(`
                        CREATE TABLE IF NOT EXISTS "${schema_name}"."BankConnectionConfig" (
                            "id" TEXT NOT NULL,
                            "bankName" TEXT NOT NULL DEFAULT '',
                            "apiUrl" TEXT, "apiKey" TEXT, "apiSecret" TEXT,
                            "lastSyncAt" TIMESTAMP(3),
                            "syncStatus" TEXT NOT NULL DEFAULT 'idle',
                            "isActive" BOOLEAN NOT NULL DEFAULT true,
                            "branchId" TEXT,
                            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            CONSTRAINT "BankConnectionConfig_pkey" PRIMARY KEY ("id")
                        )
                    `).catch(() => {})
                    await registryPrisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "BankConnectionConfig_isActive_idx" ON "${schema_name}"."BankConnectionConfig"("isActive")`).catch(() => {})
                    await markMigrationApplied(migName)
                }
                console.log('✅ E-Banking config Phase 4 migration completed')
            } catch (err: any) {
                console.error('⚠️ E-Banking config Phase 4 migration failed:', err.message)
            }

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
                startFanpageCron()
                startAiAgentCron()
                startWebhookCron()
                startEmailReplyCron()
                startHanThanhToanCron()
                startFlashSaleScheduler()
                startEInvoiceQueueCron()
                startKiotVietNightlyCron()
                startTaxAuditCron()
                startTaxDeadlineCron()
                startReconcileCron()
                startWeeklyBriefCron()
            })
        })

    // Graceful shutdown
    const shutdown = async () => {
        console.log('🛑 Shutting down gracefully...')
        /* THỨ TỰ QUAN TRỌNG: (1) bật cờ đang tắt để vòng lặp dài tự thoát giữa
         * chừng; (2) dừng hẹn giờ cron; (3) chờ lượt đang chạy xong (có trần);
         * (4) MỚI đóng DB. Bản cũ đóng DB trước → cron đang chuyển đơn mất engine
         * dưới chân (đo 18/08: 48 đơn hỏng 0,66 s sau SIGTERM). Có cờ nhưng chỉ
         * chờ (không thoát sớm) thì vẫn 11 đơn vì lượt không kịp xong trong 6 s. */
        batCoDangTat()
        stopAutoSync()
        const xong = await choAutoSyncXong(6_000)
        if (!xong) console.warn('[Shutdown] autoSync chưa xong sau 6s — đóng DB, lượt sau sẽ chuyển lại đơn dở')
        await disconnectAll()
        await cacheDisconnect()
        await pubsubDisconnect()
        stopFanpageCron()
        stopKiotVietNightlyCron()
        stopAiAgentCron()
        stopWebhookCron()
        stopEmailReplyCron()
        stopTaxAuditCron()
        stopTaxDeadlineCron()
        stopReconcileCron()
        stopWeeklyBriefCron()
        process.exit(0)
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
}

export default app
