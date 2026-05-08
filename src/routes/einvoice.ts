import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { getProvider, PROVIDERS } from '../services/einvoice'
import type { EInvoiceProviderConfig, EInvoiceData } from '../services/einvoice'

const router = Router()

// GET /api/einvoice/providers — list available providers
router.get('/providers', authMiddleware, (_req: AuthRequest, res: Response) => {
    res.json({ success: true, data: PROVIDERS })
})

// GET /api/einvoice/config — get current config
router.get('/config', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        // Ensure table exists
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "EInvoiceConfig" (
                "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "apiUrl" TEXT NOT NULL,
                "apiKey" TEXT NOT NULL, "apiSecret" TEXT NOT NULL, "taxCode" TEXT NOT NULL,
                "templateId" TEXT, "serialNo" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
                "extra" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "EInvoiceConfig_pkey" PRIMARY KEY ("id")
            )
        `)
        const config = await prisma.eInvoiceConfig.findFirst({ where: { active: true } })
        // Mask secret
        if (config) {
            config.apiSecret = config.apiSecret ? '********' : ''
        }
        res.json({ success: true, data: config })
    } catch (err: any) {
        console.error('GET /einvoice/config error:', err)
        res.status(500).json({ success: false, error: err.message })
    }
})

// PUT /api/einvoice/config — save config
router.put('/config', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const { provider, apiUrl, apiKey, apiSecret, taxCode, templateId, serialNo, extra } = req.body

        if (!provider || !apiUrl || !apiKey || !taxCode) {
            return res.status(400).json({ success: false, error: 'provider, apiUrl, apiKey, taxCode required' })
        }

        // Deactivate existing configs
        await prisma.eInvoiceConfig.updateMany({ where: { active: true }, data: { active: false } }).catch(() => { })

        // Check if we have an existing config for this provider
        const existing = await prisma.eInvoiceConfig.findFirst({ where: { provider } }).catch(() => null)

        const data: any = {
            provider, apiUrl, apiKey, taxCode, active: true,
            templateId: templateId || null,
            serialNo: serialNo || null,
            extra: extra || null,
        }
        // Only update secret if it's not masked
        if (apiSecret && apiSecret !== '********') {
            data.apiSecret = apiSecret
        }

        let config
        if (existing) {
            config = await prisma.eInvoiceConfig.update({ where: { id: existing.id }, data })
        } else {
            if (!apiSecret || apiSecret === '********') {
                return res.status(400).json({ success: false, error: 'API Secret / Mật khẩu là bắt buộc' })
            }
            data.apiSecret = apiSecret
            config = await prisma.eInvoiceConfig.create({ data })
        }

        config.apiSecret = '********'
        res.json({ success: true, data: config })
    } catch (err: any) {
        console.error('PUT /einvoice/config error:', err)
        res.status(500).json({ success: false, error: err.message })
    }
})

// POST /api/einvoice/test-connection — test connection to provider
router.post('/test-connection', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const config = await prisma.eInvoiceConfig.findFirst({ where: { active: true } })
        if (!config) return res.status(400).json({ success: false, error: 'Chưa cấu hình NCC hóa đơn' })

        const provider = getProvider(config.provider)
        if (!provider) return res.status(400).json({ success: false, error: `Không hỗ trợ NCC: ${config.provider}` })

        const result = await provider.testConnection(config as EInvoiceProviderConfig)
        res.json({ success: true, data: result })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// POST /api/einvoice/issue/:transactionId — issue e-invoice
router.post('/issue/:transactionId', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const txId = String(req.params.transactionId)

        // Ensure EInvoice table exists
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "EInvoice" (
                "id" TEXT NOT NULL, "transactionId" TEXT NOT NULL, "provider" TEXT NOT NULL,
                "invoiceNumber" TEXT, "lookupCode" TEXT, "pdfUrl" TEXT, "xmlData" TEXT,
                "status" TEXT NOT NULL DEFAULT 'pending', "errorMessage" TEXT,
                "issuedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3),
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "EInvoice_pkey" PRIMARY KEY ("id")
            )
        `)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EInvoice_transactionId_idx" ON "EInvoice"("transactionId")`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EInvoice_invoiceNumber_idx" ON "EInvoice"("invoiceNumber")`)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EInvoice_status_idx" ON "EInvoice"("status")`)

        // Get config
        const config = await prisma.eInvoiceConfig.findFirst({ where: { active: true } })
        if (!config) return res.status(400).json({ success: false, error: 'Chưa cấu hình NCC hóa đơn' })

        const provider = getProvider(config.provider)
        if (!provider) return res.status(400).json({ success: false, error: `NCC ${config.provider} không hỗ trợ` })

        // Check if already issued
        const existing = await prisma.eInvoice.findFirst({ where: { transactionId: txId, status: 'issued' } }).catch(() => null)
        if (existing) return res.status(400).json({ success: false, error: `Giao dịch đã xuất HĐ số ${existing.invoiceNumber}` })

        // Get transaction data
        const tx = await prisma.transaction.findUnique({
            where: { id: txId },
            include: { items: { include: { product: true } }, customer: true },
        })
        if (!tx) return res.status(404).json({ success: false, error: 'Không tìm thấy giao dịch' })

        // Build invoice data
        const invoiceData: EInvoiceData = {
            sellerTaxCode: config.taxCode,
            sellerName: '', // Will be filled from store info
            buyerName: tx.customer?.name || tx.customerName || 'Khách lẻ',
            buyerTaxCode: tx.customer?.taxCode || req.body.buyerTaxCode || '',
            buyerAddress: tx.customer?.address || req.body.buyerAddress || '',
            buyerPhone: tx.customer?.phone || '',
            buyerEmail: tx.customer?.email || req.body.buyerEmail || '',
            templateId: config.templateId || undefined,
            serialNo: config.serialNo || undefined,
            paymentMethod: tx.paymentMethod || 'TM/CK',
            items: (tx.items || []).map((item: any) => ({
                name: item.product?.name || item.productName || 'Sản phẩm',
                unit: item.product?.baseUnit || item.unit || 'Cái',
                quantity: item.quantity || 1,
                unitPrice: item.price || 0,
                amount: (item.quantity || 1) * (item.price || 0),
                vatRate: 10, // Default 10%
                vatAmount: Math.round(((item.quantity || 1) * (item.price || 0)) * 0.1),
                discount: item.discount || 0,
            })),
            subtotal: tx.subtotal || tx.total || 0,
            vatRate: 10,
            vatAmount: tx.tax || 0,
            total: tx.total || 0,
            transactionId: tx.id,
            receiptNumber: tx.receiptNumber || '',
        }

        // Issue via provider
        const result = await provider.issueInvoice(config as EInvoiceProviderConfig, invoiceData)

        // Save record
        const record = await prisma.eInvoice.create({
            data: {
                transactionId: txId,
                provider: config.provider,
                invoiceNumber: result.invoiceNumber || null,
                lookupCode: result.lookupCode || null,
                pdfUrl: result.pdfUrl || null,
                xmlData: result.xmlData || null,
                status: result.success ? 'issued' : 'error',
                errorMessage: result.errorMessage || null,
                issuedAt: result.success ? new Date() : null,
            },
        })

        // Update transaction VAT status
        if (result.success) {
            await prisma.transaction.update({
                where: { id: txId },
                data: { vatStatus: 'issued', vatInvoiceNumber: result.invoiceNumber, vatIssuedAt: new Date() },
            }).catch(() => { })
        }

        res.json({ success: result.success, data: record })
    } catch (err: any) {
        console.error('Issue e-invoice error:', err)
        res.status(500).json({ success: false, error: err.message })
    }
})

// GET /api/einvoice/history — list issued invoices
router.get('/history', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        // Ensure table exists first
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "EInvoice" (
                "id" TEXT NOT NULL, "transactionId" TEXT NOT NULL, "provider" TEXT NOT NULL,
                "invoiceNumber" TEXT, "lookupCode" TEXT, "pdfUrl" TEXT, "xmlData" TEXT,
                "status" TEXT NOT NULL DEFAULT 'pending', "errorMessage" TEXT,
                "issuedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3),
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "EInvoice_pkey" PRIMARY KEY ("id")
            )
        `)

        const invoices = await prisma.eInvoice.findMany({
            orderBy: { createdAt: 'desc' },
            take: 200,
        })

        // Get transaction details
        const txIds = [...new Set(invoices.map((i: any) => i.transactionId))]
        const transactions = txIds.length > 0
            ? await prisma.transaction.findMany({
                where: { id: { in: txIds } },
                select: { id: true, receiptNumber: true, customerName: true, total: true, transactionDate: true },
            })
            : []
        const txMap = new Map(transactions.map((t: any) => [t.id, t]))

        const data = invoices.map((inv: any) => {
            const tx: any = txMap.get(inv.transactionId)
            return {
                ...inv,
                receiptNumber: tx?.receiptNumber || '',
                customerName: tx?.customerName || '',
                transactionTotal: tx?.total || 0,
                transactionDate: tx?.transactionDate || null,
            }
        })

        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /einvoice/history error:', err)
        res.status(500).json({ success: false, error: err.message })
    }
})

// POST /api/einvoice/cancel/:invoiceId — cancel an invoice
router.post('/cancel/:invoiceId', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const invId = String(req.params.invoiceId)
        const { reason } = req.body

        const invoice = await prisma.eInvoice.findUnique({ where: { id: invId } })
        if (!invoice) return res.status(404).json({ success: false, error: 'Không tìm thấy HĐ' })
        if (invoice.status === 'cancelled') return res.status(400).json({ success: false, error: 'HĐ đã hủy rồi' })

        const config = await prisma.eInvoiceConfig.findFirst({ where: { active: true } })
        if (!config) return res.status(400).json({ success: false, error: 'Chưa cấu hình NCC' })

        const provider = getProvider(config.provider)
        if (!provider) return res.status(400).json({ success: false, error: 'NCC không hỗ trợ' })

        const result = await provider.cancelInvoice(config as EInvoiceProviderConfig, invoice.invoiceNumber || '', reason || 'Sai thông tin')

        if (result.success) {
            await prisma.eInvoice.update({
                where: { id: invId },
                data: { status: 'cancelled', cancelledAt: new Date() },
            })
            // Revert transaction VAT status
            await prisma.transaction.update({
                where: { id: invoice.transactionId },
                data: { vatStatus: 'not_issued', vatInvoiceNumber: null, vatIssuedAt: null },
            }).catch(() => { })
        }

        res.json({ success: result.success, data: result })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message })
    }
})

export default router
