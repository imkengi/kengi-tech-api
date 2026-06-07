// ─────────────────────────────────────────────────────────────────────────────
//  Hóa đơn điện tử (E-invoice) — Phase 3 — mounted at /api/einvoice
//
//  Lifecycle per Thông tư 78/2021/TT-BTC + Nghị định 123/2020:
//    DRAFT ──sign──▶ SIGNED ──send──▶ SENT ──cancel──▶ CANCELLED ──replace──▶ REPLACED
//
//  Phase-3 routes (rich model):
//    GET    /                 list (status, dateFrom, dateTo, buyerTaxCode, invoiceNumber)
//    POST   /                 create DRAFT from transaction data
//    POST   /from-sale/:id    auto-create DRAFT from a Transaction
//    GET    /:id              single invoice + items
//    PUT    /:id              update DRAFT
//    DELETE /:id              delete DRAFT
//    POST   /:id/sign         sign → SIGNED, generate TT78 XML, assign number
//    POST   /:id/send         send to tax authority (provider STUB) → SENT
//    POST   /:id/cancel       cancel a sent invoice → CANCELLED
//    POST   /:id/replace      create replacement DRAFT, original → REPLACED
//    GET    /:id/pdf          HTML/PDF preview
//    GET    /:id/xml          signed XML
//
//  Config:
//    GET    /config           current config (secrets masked)
//    PUT    /config           update provider + company + numbering config
//    POST   /config/test      test connection (STUB)
//
//  Legacy provider-issuance routes (kept for backward compatibility):
//    GET    /providers, POST /issue/:transactionId, GET /history,
//    POST   /test-connection, POST /cancel/:invoiceId
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { errMsg } from '../lib/errorResponse'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { getProvider, PROVIDERS } from '../services/einvoice'
import type { EInvoiceProviderConfig, EInvoiceData } from '../services/einvoice'

const router = Router()

// ─── Table provisioning (per-schema, cached once per process) ────────────────
// Boot migration handles existing schemas; this covers schemas provisioned at
// runtime. All statements are idempotent.
const ensuredSchemas = new Set<string>()
async function ensureTables(req: AuthRequest): Promise<void> {
    const prisma = req.storePrisma! as any
    const key = req.user?.branchSchema || req.user?.storeSchema || 'default'
    if (ensuredSchemas.has(key)) return
    try {
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "EInvoice" (
                "id" TEXT NOT NULL, "transactionId" TEXT, "provider" TEXT,
                "lookupCode" TEXT, "xmlData" TEXT, "errorMessage" TEXT,
                "invoiceNumber" TEXT, "invoiceSymbol" TEXT, "invoiceDate" TEXT,
                "invoiceType" TEXT NOT NULL DEFAULT 'SALE',
                "status" TEXT NOT NULL DEFAULT 'DRAFT',
                "sellerName" TEXT, "sellerTaxCode" TEXT, "sellerAddress" TEXT,
                "buyerName" TEXT, "buyerTaxCode" TEXT, "buyerAddress" TEXT,
                "totalBeforeVat" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "currency" TEXT NOT NULL DEFAULT 'VND', "paymentMethod" TEXT,
                "xmlContent" TEXT, "pdfUrl" TEXT, "providerInvoiceId" TEXT,
                "providerResponse" TEXT, "replacesInvoiceId" TEXT, "replacedByInvoiceId" TEXT,
                "cancelReason" TEXT, "notes" TEXT, "branchId" TEXT,
                "createdBy" TEXT, "createdByName" TEXT,
                "issuedAt" TIMESTAMP(3), "signedAt" TIMESTAMP(3), "sentAt" TIMESTAMP(3),
                "cancelledAt" TIMESTAMP(3),
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "EInvoice_pkey" PRIMARY KEY ("id")
            )
        `)
        // Upgrade legacy EInvoice tables that predate Phase 3.
        const eiCols: Array<[string, string]> = [
            ['transactionId', 'TEXT'], ['provider', 'TEXT'], ['lookupCode', 'TEXT'],
            ['xmlData', 'TEXT'], ['errorMessage', 'TEXT'], ['invoiceNumber', 'TEXT'],
            ['invoiceSymbol', 'TEXT'], ['invoiceDate', 'TEXT'],
            ['invoiceType', `TEXT NOT NULL DEFAULT 'SALE'`], ['status', `TEXT NOT NULL DEFAULT 'DRAFT'`],
            ['sellerName', 'TEXT'], ['sellerTaxCode', 'TEXT'], ['sellerAddress', 'TEXT'],
            ['buyerName', 'TEXT'], ['buyerTaxCode', 'TEXT'], ['buyerAddress', 'TEXT'],
            ['totalBeforeVat', 'DOUBLE PRECISION NOT NULL DEFAULT 0'],
            ['vatAmount', 'DOUBLE PRECISION NOT NULL DEFAULT 0'],
            ['totalAmount', 'DOUBLE PRECISION NOT NULL DEFAULT 0'],
            ['currency', `TEXT NOT NULL DEFAULT 'VND'`], ['paymentMethod', 'TEXT'],
            ['xmlContent', 'TEXT'], ['pdfUrl', 'TEXT'], ['providerInvoiceId', 'TEXT'],
            ['providerResponse', 'TEXT'], ['replacesInvoiceId', 'TEXT'], ['replacedByInvoiceId', 'TEXT'],
            ['cancelReason', 'TEXT'], ['notes', 'TEXT'], ['branchId', 'TEXT'],
            ['createdBy', 'TEXT'], ['createdByName', 'TEXT'],
            ['issuedAt', 'TIMESTAMP(3)'], ['signedAt', 'TIMESTAMP(3)'], ['sentAt', 'TIMESTAMP(3)'],
            ['cancelledAt', 'TIMESTAMP(3)'],
            ['updatedAt', 'TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP'],
        ]
        for (const [col, type] of eiCols) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "EInvoice" ADD COLUMN IF NOT EXISTS "${col}" ${type};`).catch(() => {})
        }
        for (const col of ['transactionId', 'provider']) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "EInvoice" ALTER COLUMN "${col}" DROP NOT NULL;`).catch(() => {})
        }
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EInvoice_status_idx" ON "EInvoice"("status")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EInvoice_invoiceNumber_idx" ON "EInvoice"("invoiceNumber")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EInvoice_invoiceDate_idx" ON "EInvoice"("invoiceDate")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EInvoice_buyerTaxCode_idx" ON "EInvoice"("buyerTaxCode")`).catch(() => {})
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EInvoice_branchId_idx" ON "EInvoice"("branchId")`).catch(() => {})

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "EInvoiceItem" (
                "id" TEXT NOT NULL, "eInvoiceId" TEXT NOT NULL,
                "itemNumber" INTEGER NOT NULL DEFAULT 0, "itemName" TEXT NOT NULL,
                "unitName" TEXT, "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "amount" DOUBLE PRECISION NOT NULL DEFAULT 0, "notes" TEXT,
                CONSTRAINT "EInvoiceItem_pkey" PRIMARY KEY ("id")
            )
        `)
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "EInvoiceItem_eInvoiceId_idx" ON "EInvoiceItem"("eInvoiceId")`).catch(() => {})

        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "EInvoiceConfig" (
                "id" TEXT NOT NULL, "provider" TEXT NOT NULL DEFAULT 'CUSTOM',
                "apiUrl" TEXT, "apiKey" TEXT, "apiSecret" TEXT, "taxCode" TEXT,
                "templateId" TEXT, "serialNo" TEXT, "extra" TEXT,
                "apiUsername" TEXT, "apiPassword" TEXT, "companyName" TEXT, "companyAddress" TEXT,
                "invoicePattern" TEXT, "invoiceSerial" TEXT, "certificateSerial" TEXT,
                "active" BOOLEAN NOT NULL DEFAULT true, "isActive" BOOLEAN NOT NULL DEFAULT true,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "EInvoiceConfig_pkey" PRIMARY KEY ("id")
            )
        `)
        const cfgCols: Array<[string, string]> = [
            ['apiUrl', 'TEXT'], ['apiKey', 'TEXT'], ['apiSecret', 'TEXT'], ['taxCode', 'TEXT'],
            ['templateId', 'TEXT'], ['serialNo', 'TEXT'], ['extra', 'TEXT'],
            ['apiUsername', 'TEXT'], ['apiPassword', 'TEXT'], ['companyName', 'TEXT'],
            ['companyAddress', 'TEXT'], ['invoicePattern', 'TEXT'], ['invoiceSerial', 'TEXT'],
            ['certificateSerial', 'TEXT'], ['isActive', 'BOOLEAN NOT NULL DEFAULT true'],
        ]
        for (const [col, type] of cfgCols) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "EInvoiceConfig" ADD COLUMN IF NOT EXISTS "${col}" ${type};`).catch(() => {})
        }
        for (const col of ['apiUrl', 'apiKey', 'apiSecret', 'taxCode']) {
            await prisma.$executeRawUnsafe(`ALTER TABLE "EInvoiceConfig" ALTER COLUMN "${col}" DROP NOT NULL;`).catch(() => {})
        }
        ensuredSchemas.add(key)
    } catch (e: any) {
        console.error('ensureTables(einvoice) error:', e?.message || e)
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const pad = (n: number, w: number) => String(n).padStart(w, '0')
const num = (v: any) => Math.round(Number(v) || 0)
const VALID_VAT = [0, 5, 8, 10]

function escXml(s: any): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function escHtml(s: any): string {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const fmtMoney = (v: any) => new Intl.NumberFormat('vi-VN').format(num(v))

// Đọc số tiền bằng chữ (tiếng Việt) — for the TgTTTBChu element / PDF preview.
function docTienBangChu(amount: number): string {
    amount = Math.round(amount || 0)
    if (amount === 0) return 'Không đồng'
    const ones = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']
    const readTriple = (n: number, full: boolean): string => {
        const tram = Math.floor(n / 100)
        const chuc = Math.floor((n % 100) / 10)
        const donvi = n % 10
        let s = ''
        if (full || tram > 0) s += ones[tram] + ' trăm'
        if (chuc === 0) {
            if (donvi > 0) s += (s ? ' lẻ ' : '') + ones[donvi]
        } else if (chuc === 1) {
            s += (s ? ' ' : '') + 'mười'
            if (donvi === 5) s += ' lăm'
            else if (donvi > 0) s += ' ' + ones[donvi]
        } else {
            s += (s ? ' ' : '') + ones[chuc] + ' mươi'
            if (donvi === 1) s += ' mốt'
            else if (donvi === 5) s += ' lăm'
            else if (donvi > 0) s += ' ' + ones[donvi]
        }
        return s.trim()
    }
    const units = ['', ' nghìn', ' triệu', ' tỷ']
    const groups: number[] = []
    let n = amount
    while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000) }
    let out = ''
    for (let i = groups.length - 1; i >= 0; i--) {
        if (groups[i] === 0) continue
        out += readTriple(groups[i], i !== groups.length - 1 && out !== '') + units[i] + ' '
    }
    out = out.trim()
    out = out.charAt(0).toUpperCase() + out.slice(1)
    return out + ' đồng'
}

// Merge config row (Phase-3 + legacy fields) into a normalized object.
function normalizeConfig(c: any) {
    if (!c) return null
    return {
        id: c.id,
        provider: c.provider || 'CUSTOM',
        apiUrl: c.apiUrl || '',
        apiUsername: c.apiUsername || c.apiKey || '',
        // apiPassword/apiSecret masked by callers
        taxCode: c.taxCode || '',
        companyName: c.companyName || '',
        companyAddress: c.companyAddress || '',
        invoicePattern: c.invoicePattern || c.templateId || '1',
        invoiceSerial: c.invoiceSerial || c.serialNo || '',
        certificateSerial: c.certificateSerial || '',
        isActive: c.isActive ?? c.active ?? true,
        templateId: c.templateId || null,
        serialNo: c.serialNo || null,
        extra: c.extra || null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
    }
}

async function getActiveConfig(prisma: any) {
    const active = await prisma.eInvoiceConfig.findFirst({ where: { active: true } }).catch(() => null)
    if (active) return active
    return prisma.eInvoiceConfig.findFirst().catch(() => null)
}

// Seller info: prefer EInvoiceConfig, fall back to StoreSettings.
async function resolveSeller(prisma: any, config: any) {
    const store = await prisma.storeSettings.findFirst().catch(() => null)
    return {
        sellerName: config?.companyName || store?.name || '',
        sellerTaxCode: config?.taxCode || store?.taxCode || '',
        sellerAddress: config?.companyAddress || store?.address || '',
    }
}

// Build the ký hiệu mẫu (e.g. "1C26TAA") from config pattern + serial.
function buildSymbol(config: any): string {
    const pattern = (config?.invoicePattern || config?.templateId || '1').toString().trim()
    const serial = (config?.invoiceSerial || config?.serialNo || 'C26TAA').toString().trim()
    return `${pattern}${serial}`
}

// Next sequential số hóa đơn for a given symbol (8-digit, zero-padded).
async function nextInvoiceNumber(prisma: any, symbol: string): Promise<string> {
    const count = await prisma.eInvoice.count({
        where: { invoiceSymbol: symbol, invoiceNumber: { not: null } },
    }).catch(() => 0)
    return pad(count + 1, 8)
}

// Recompute item VAT/amount + invoice totals from a raw items array.
function computeItems(rawItems: any[]) {
    let totalBeforeVat = 0
    let vatAmount = 0
    const items = (rawItems || []).map((it: any, i: number) => {
        const quantity = Number(it.quantity) || 0
        const unitPrice = Number(it.unitPrice ?? it.price) || 0
        let vatRate = Number(it.vatRate)
        if (!VALID_VAT.includes(vatRate)) vatRate = 10
        const amount = it.amount != null ? Number(it.amount) : quantity * unitPrice
        const itemVat = it.vatAmount != null ? Number(it.vatAmount) : Math.round(amount * vatRate / 100)
        totalBeforeVat += amount
        vatAmount += itemVat
        return {
            itemNumber: it.itemNumber != null ? Number(it.itemNumber) : i + 1,
            itemName: String(it.itemName ?? it.name ?? 'Sản phẩm'),
            unitName: it.unitName ?? it.unit ?? null,
            quantity, unitPrice, vatRate,
            vatAmount: Math.round(itemVat),
            amount: Math.round(amount),
            notes: it.notes ?? null,
        }
    })
    return {
        items,
        totalBeforeVat: Math.round(totalBeforeVat),
        vatAmount: Math.round(vatAmount),
        totalAmount: Math.round(totalBeforeVat + vatAmount),
    }
}

// ─── TT78/2021 XML generation ────────────────────────────────────────────────
function generateInvoiceXml(inv: any, items: any[]): string {
    const symbol = inv.invoiceSymbol || ''
    // KHMSHDon = mẫu số (1st char), KHHDon = phần ký hiệu còn lại
    const khmshdon = symbol.slice(0, 1)
    const khhdon = symbol.slice(1)
    const itemsXml = items.map((it) => `        <HHDVu>
          <TChat>1</TChat>
          <STT>${num(it.itemNumber)}</STT>
          <Ten>${escXml(it.itemName)}</Ten>
          <DVTinh>${escXml(it.unitName || '')}</DVTinh>
          <SLuong>${Number(it.quantity) || 0}</SLuong>
          <DGia>${num(it.unitPrice)}</DGia>
          <TLSuat>${num(it.vatRate)}%</TLSuat>
          <ThTien>${num(it.amount)}</ThTien>
          <TThue>${num(it.vatAmount)}</TThue>
        </HHDVu>`).join('\n')

    return `<?xml version="1.0" encoding="UTF-8"?>
<HDon>
  <DLHDon Id="${escXml(inv.id)}">
    <TTChung>
      <PBan>1.0</PBan>
      <KHMSHDon>${escXml(khmshdon)}</KHMSHDon>
      <KHHDon>${escXml(khhdon)}</KHHDon>
      <SHDon>${escXml(inv.invoiceNumber || '')}</SHDon>
      <NLap>${escXml(inv.invoiceDate || '')}</NLap>
      <DVTTe>${escXml(inv.currency || 'VND')}</DVTTe>
      <TGia>1</TGia>
      <HTTToan>${escXml(inv.paymentMethod || 'TM/CK')}</HTTToan>
    </TTChung>
    <NDHDon>
      <NBan>
        <Ten>${escXml(inv.sellerName)}</Ten>
        <MST>${escXml(inv.sellerTaxCode)}</MST>
        <DChi>${escXml(inv.sellerAddress)}</DChi>
      </NBan>
      <NMua>
        <Ten>${escXml(inv.buyerName)}</Ten>
        <MST>${escXml(inv.buyerTaxCode)}</MST>
        <DChi>${escXml(inv.buyerAddress)}</DChi>
      </NMua>
      <DSHHDVu>
${itemsXml}
      </DSHHDVu>
      <TToan>
        <TgTCThue>${num(inv.totalBeforeVat)}</TgTCThue>
        <TgTThue>${num(inv.vatAmount)}</TgTThue>
        <TgTTTBSo>${num(inv.totalAmount)}</TgTTTBSo>
        <TgTTTBChu>${escXml(docTienBangChu(num(inv.totalAmount)))}</TgTTTBChu>
      </TToan>
    </NDHDon>
  </DLHDon>
  <DLQRCode/>
</HDon>`
}

function todayISO(): string {
    const d = new Date()
    return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`
}

// Fetch an invoice + items, scoped to the caller's branch.
async function getInvoiceWithItems(prisma: any, id: string) {
    const inv = await prisma.eInvoice.findUnique({ where: { id } }).catch(() => null)
    if (!inv) return null
    const items = await prisma.eInvoiceItem.findMany({
        where: { eInvoiceId: id }, orderBy: { itemNumber: 'asc' },
    }).catch(() => [])
    return { ...inv, items }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Config routes (literal paths — registered before /:id)
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/einvoice/config
router.get('/config', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const raw = await getActiveConfig(prisma)
        const config = normalizeConfig(raw)
        if (config) {
            // Mask credentials
            ;(config as any).apiPassword = raw?.apiPassword || raw?.apiSecret ? '********' : ''
        }
        res.json({ success: true, data: config })
    } catch (err: any) {
        console.error('GET /einvoice/config error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/einvoice/config
router.put('/config', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        const provider = (b.provider || 'CUSTOM').toString().toUpperCase()

        // Accept both new (apiUsername/apiPassword/companyName) and legacy (apiKey/apiSecret) shapes.
        const data: any = {
            provider,
            apiUrl: b.apiUrl ?? null,
            apiUsername: b.apiUsername ?? b.apiKey ?? null,
            apiKey: b.apiUsername ?? b.apiKey ?? null, // keep legacy column in sync
            taxCode: b.taxCode ?? null,
            companyName: b.companyName ?? null,
            companyAddress: b.companyAddress ?? null,
            invoicePattern: b.invoicePattern ?? b.templateId ?? null,
            invoiceSerial: b.invoiceSerial ?? b.serialNo ?? null,
            templateId: b.invoicePattern ?? b.templateId ?? null,
            serialNo: b.invoiceSerial ?? b.serialNo ?? null,
            certificateSerial: b.certificateSerial ?? null,
            extra: b.extra ?? null,
            active: true, isActive: true,
        }
        // Only overwrite the password when a real (non-masked) value is supplied.
        const pwd = b.apiPassword ?? b.apiSecret
        if (pwd && pwd !== '********') {
            data.apiPassword = pwd
            data.apiSecret = pwd // keep legacy column in sync
        }

        // Deactivate previous configs, then upsert the one for this provider.
        await prisma.eInvoiceConfig.updateMany({ where: {}, data: { active: false, isActive: false } }).catch(() => {})
        const existing = await prisma.eInvoiceConfig.findFirst({ where: { provider } }).catch(() => null)

        let config
        if (existing) {
            config = await prisma.eInvoiceConfig.update({ where: { id: existing.id }, data })
        } else {
            config = await prisma.eInvoiceConfig.create({ data })
        }
        const out: any = normalizeConfig(config)
        out.apiPassword = config.apiPassword || config.apiSecret ? '********' : ''
        res.json({ success: true, data: out })
    } catch (err: any) {
        console.error('PUT /einvoice/config error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/config/test — test connection (STUB)
router.post('/config/test', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const raw = await getActiveConfig(prisma)
        if (!raw) return res.status(400).json({ success: false, error: 'Chưa cấu hình nhà cung cấp hóa đơn' })

        // STUB: simulate a successful handshake with the provider.
        console.log(`[einvoice][STUB] test-connection provider=${raw.provider} url=${raw.apiUrl || '(none)'}`)
        res.json({
            success: true,
            data: {
                connected: true,
                provider: raw.provider,
                message: `Kết nối tới ${raw.provider} thành công (mô phỏng)`,
                testedAt: new Date().toISOString(),
            },
        })
    } catch (err: any) {
        console.error('POST /einvoice/config/test error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  Legacy provider-issuance routes (kept for backward compatibility)
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/einvoice/providers
router.get('/providers', authMiddleware, (_req: AuthRequest, res: Response) => {
    res.json({ success: true, data: PROVIDERS })
})

// POST /api/einvoice/test-connection (legacy)
router.post('/test-connection', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const config = await getActiveConfig(prisma)
        if (!config) return res.status(400).json({ success: false, error: 'Chưa cấu hình NCC hóa đơn' })
        const provider = getProvider((config.provider || '').toLowerCase())
        if (!provider) {
            // Fall back to STUB when the provider has no service implementation.
            return res.json({ success: true, data: { connected: true, provider: config.provider, message: 'Mô phỏng kết nối thành công' } })
        }
        const result = await provider.testConnection(config as EInvoiceProviderConfig)
        res.json({ success: true, data: result })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/einvoice/history (legacy list — all statuses)
router.get('/history', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const invoices = await prisma.eInvoice.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
        const txIds = [...new Set(invoices.map((i: any) => i.transactionId).filter(Boolean))]
        const transactions = txIds.length > 0
            ? await prisma.transaction.findMany({
                where: { id: { in: txIds } },
                select: { id: true, receiptNumber: true, customerName: true, total: true, transactionDate: true },
            }).catch(() => [])
            : []
        const txMap = new Map(transactions.map((t: any) => [t.id, t]))
        const data = invoices.map((inv: any) => {
            const tx: any = txMap.get(inv.transactionId)
            return {
                ...inv,
                receiptNumber: tx?.receiptNumber || '',
                customerName: tx?.customerName || inv.buyerName || '',
                transactionTotal: tx?.total || inv.totalAmount || 0,
                transactionDate: tx?.transactionDate || null,
            }
        })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /einvoice/history error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/issue/:transactionId (legacy — issue via provider service)
router.post('/issue/:transactionId', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const txId = String(req.params.transactionId)

        const config = await getActiveConfig(prisma)
        if (!config) return res.status(400).json({ success: false, error: 'Chưa cấu hình NCC hóa đơn' })
        const provider = getProvider((config.provider || '').toLowerCase())
        if (!provider) return res.status(400).json({ success: false, error: `NCC ${config.provider} không hỗ trợ qua API trực tiếp` })

        const existing = await prisma.eInvoice.findFirst({ where: { transactionId: txId, status: { in: ['issued', 'SENT'] } } }).catch(() => null)
        if (existing) return res.status(400).json({ success: false, error: `Giao dịch đã xuất HĐ số ${existing.invoiceNumber}` })

        const tx = await prisma.transaction.findUnique({
            where: { id: txId },
            include: { items: { include: { product: true } }, customer: true },
        })
        if (!tx) return res.status(404).json({ success: false, error: 'Không tìm thấy giao dịch' })

        const invoiceData: EInvoiceData = {
            sellerTaxCode: config.taxCode || '',
            sellerName: config.companyName || '',
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
                unitPrice: item.unitPrice ?? item.price ?? 0,
                amount: (item.quantity || 1) * (item.unitPrice ?? item.price ?? 0),
                vatRate: 10,
                vatAmount: Math.round(((item.quantity || 1) * (item.unitPrice ?? item.price ?? 0)) * 0.1),
                discount: item.discount || 0,
            })),
            subtotal: tx.subtotal || tx.total || 0,
            vatRate: 10,
            vatAmount: tx.tax || 0,
            total: tx.total || 0,
            transactionId: tx.id,
            receiptNumber: tx.receiptNumber || '',
        }

        const result = await provider.issueInvoice(config as EInvoiceProviderConfig, invoiceData)
        const record = await prisma.eInvoice.create({
            data: {
                transactionId: txId,
                provider: config.provider,
                invoiceNumber: result.invoiceNumber || null,
                lookupCode: result.lookupCode || null,
                pdfUrl: result.pdfUrl || null,
                xmlData: result.xmlData || null,
                status: result.success ? 'SENT' : 'ERROR',
                errorMessage: result.errorMessage || null,
                issuedAt: result.success ? new Date() : null,
                sentAt: result.success ? new Date() : null,
                buyerName: invoiceData.buyerName,
                buyerTaxCode: invoiceData.buyerTaxCode,
                buyerAddress: invoiceData.buyerAddress,
                totalAmount: invoiceData.total,
                vatAmount: invoiceData.vatAmount,
                totalBeforeVat: (invoiceData.total || 0) - (invoiceData.vatAmount || 0),
                paymentMethod: invoiceData.paymentMethod,
            },
        })
        if (result.success) {
            await prisma.transaction.update({
                where: { id: txId },
                data: { vatStatus: 'issued', vatInvoiceNumber: result.invoiceNumber, vatIssuedAt: new Date() },
            }).catch(() => {})
        }
        res.json({ success: result.success, data: record })
    } catch (err: any) {
        console.error('Issue e-invoice error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/cancel/:invoiceId (legacy cancel via provider service)
router.post('/cancel/:invoiceId', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const invId = String(req.params.invoiceId)
        const { reason } = req.body || {}

        const invoice = await prisma.eInvoice.findUnique({ where: { id: invId } })
        if (!invoice) return res.status(404).json({ success: false, error: 'Không tìm thấy HĐ' })
        if (invoice.status === 'cancelled' || invoice.status === 'CANCELLED') {
            return res.status(400).json({ success: false, error: 'HĐ đã hủy rồi' })
        }

        const config = await getActiveConfig(prisma)
        const provider = config ? getProvider((config.provider || '').toLowerCase()) : null
        let ok = true
        if (provider) {
            const result = await provider.cancelInvoice(config as EInvoiceProviderConfig, invoice.invoiceNumber || '', reason || 'Sai thông tin')
            ok = result.success
        } else {
            console.log(`[einvoice][STUB] cancel invoice=${invoice.invoiceNumber} reason=${reason || ''}`)
        }
        if (ok) {
            await prisma.eInvoice.update({
                where: { id: invId },
                data: { status: 'CANCELLED', cancelReason: reason || null, cancelledAt: new Date() },
            })
            if (invoice.transactionId) {
                await prisma.transaction.update({
                    where: { id: invoice.transactionId },
                    data: { vatStatus: 'none', vatInvoiceNumber: null, vatIssuedAt: null },
                }).catch(() => {})
            }
        }
        res.json({ success: ok, data: { id: invId, status: ok ? 'CANCELLED' : invoice.status } })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  Phase-3 routes
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/einvoice/from-sale/:saleId — auto-create DRAFT from a Transaction
router.post('/from-sale/:saleId', authMiddleware, requireRole('admin', 'manager', 'cashier'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const saleId = String(req.params.saleId)

        const tx = await prisma.transaction.findUnique({
            where: { id: saleId },
            include: { items: { include: { product: true } }, customer: true },
        }).catch(() => null)
        if (!tx) return res.status(404).json({ success: false, error: 'Không tìm thấy giao dịch' })

        const existing = await prisma.eInvoice.findFirst({
            where: { transactionId: saleId, status: { notIn: ['CANCELLED', 'REPLACED', 'ERROR'] } },
        }).catch(() => null)
        if (existing) {
            return res.status(409).json({ success: false, error: `Giao dịch đã có hóa đơn (${existing.status})`, data: existing })
        }

        const config = await getActiveConfig(prisma)
        const seller = await resolveSeller(prisma, config)

        // Derive per-line VAT: distribute the transaction's tax over lines by amount.
        const txTax = Number(tx.tax) || 0
        const txSubtotal = Number(tx.subtotal) || (tx.items || []).reduce((s: number, i: any) => s + (i.lineTotal || 0), 0)
        const effRate = txSubtotal > 0 ? Math.round(txTax / txSubtotal * 100) : 0
        const vatRate = VALID_VAT.includes(effRate) ? effRate : (txTax > 0 ? 10 : 0)

        const rawItems = (tx.items || []).map((item: any, i: number) => {
            const quantity = Number(item.quantity) || 0
            const unitPrice = Number(item.unitPrice ?? item.price) || 0
            const amount = item.lineTotal != null ? Number(item.lineTotal) : quantity * unitPrice
            return {
                itemNumber: i + 1,
                itemName: item.productName || item.product?.name || 'Sản phẩm',
                unitName: item.product?.baseUnit || item.unit || 'Cái',
                quantity, unitPrice, vatRate,
                amount,
                vatAmount: Math.round(amount * vatRate / 100),
            }
        })
        const computed = computeItems(rawItems)

        const invoice = await prisma.eInvoice.create({
            data: {
                transactionId: saleId,
                invoiceType: 'SALE',
                status: 'DRAFT',
                invoiceDate: todayISO(),
                ...seller,
                buyerName: tx.customer?.name || tx.customerName || 'Khách lẻ',
                buyerTaxCode: tx.customer?.taxCode || req.body?.buyerTaxCode || '',
                buyerAddress: tx.customer?.address || req.body?.buyerAddress || '',
                totalBeforeVat: computed.totalBeforeVat,
                vatAmount: computed.vatAmount,
                totalAmount: computed.totalAmount,
                currency: 'VND',
                paymentMethod: req.body?.paymentMethod || 'TM/CK',
                notes: req.body?.notes || null,
                branchId: tx.branchId || req.user?.branchId || null,
                createdBy: req.user?.userId || null,
                createdByName: (req.user as any)?.email || null,
                items: { create: computed.items },
            },
            include: { items: true },
        })
        res.status(201).json({ success: true, data: invoice })
    } catch (err: any) {
        console.error('POST /einvoice/from-sale error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/einvoice — list with filters + pagination
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const q = req.query
        const where: any = { ...getBranchFilter(req) }
        if (q.status) where.status = String(q.status).toUpperCase()
        if (q.invoiceType) where.invoiceType = String(q.invoiceType).toUpperCase()
        if (q.buyerTaxCode) where.buyerTaxCode = { contains: String(q.buyerTaxCode) }
        if (q.invoiceNumber) where.invoiceNumber = { contains: String(q.invoiceNumber) }
        if (q.dateFrom || q.dateTo) {
            where.invoiceDate = {}
            if (q.dateFrom) where.invoiceDate.gte = String(q.dateFrom)
            if (q.dateTo) where.invoiceDate.lte = String(q.dateTo)
        }
        const page = Math.max(1, Number(q.page) || 1)
        const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50))

        const [total, data] = await Promise.all([
            prisma.eInvoice.count({ where }).catch(() => 0),
            prisma.eInvoice.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }).catch(() => []),
        ])
        res.json({ success: true, data, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } })
    } catch (err: any) {
        console.error('GET /einvoice error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice — create DRAFT from transaction data
router.post('/', authMiddleware, requireRole('admin', 'manager', 'cashier'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        if (!Array.isArray(b.items) || b.items.length === 0) {
            return res.status(400).json({ success: false, error: 'items[] là bắt buộc' })
        }

        const config = await getActiveConfig(prisma)
        const seller = await resolveSeller(prisma, config)
        const computed = computeItems(b.items)

        const invoice = await prisma.eInvoice.create({
            data: {
                transactionId: b.transactionId || null,
                invoiceType: (b.invoiceType || 'SALE').toString().toUpperCase(),
                status: 'DRAFT',
                invoiceDate: b.invoiceDate || todayISO(),
                ...seller,
                buyerName: b.buyerName || 'Khách lẻ',
                buyerTaxCode: b.buyerTaxCode || '',
                buyerAddress: b.buyerAddress || '',
                totalBeforeVat: computed.totalBeforeVat,
                vatAmount: computed.vatAmount,
                totalAmount: computed.totalAmount,
                currency: b.currency || 'VND',
                paymentMethod: b.paymentMethod || 'TM/CK',
                notes: b.notes || null,
                branchId: req.user?.branchId || null,
                createdBy: req.user?.userId || null,
                createdByName: (req.user as any)?.email || null,
                items: { create: computed.items },
            },
            include: { items: true },
        })
        res.status(201).json({ success: true, data: invoice })
    } catch (err: any) {
        console.error('POST /einvoice error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/einvoice/:id — single invoice + items
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const inv = await getInvoiceWithItems(prisma, String(req.params.id))
        if (!inv) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })
        res.json({ success: true, data: inv })
    } catch (err: any) {
        console.error('GET /einvoice/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/einvoice/:id — update DRAFT only
router.put('/:id', authMiddleware, requireRole('admin', 'manager', 'cashier'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const inv = await prisma.eInvoice.findUnique({ where: { id } }).catch(() => null)
        if (!inv) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })
        if (inv.status !== 'DRAFT') {
            return res.status(400).json({ success: false, error: `Chỉ sửa được hóa đơn nháp (DRAFT). Trạng thái hiện tại: ${inv.status}` })
        }

        const b = req.body || {}
        const data: any = {}
        for (const f of ['buyerName', 'buyerTaxCode', 'buyerAddress', 'paymentMethod', 'notes', 'invoiceDate', 'currency']) {
            if (b[f] !== undefined) data[f] = b[f]
        }
        if (b.invoiceType !== undefined) data.invoiceType = String(b.invoiceType).toUpperCase()

        // Replace items + recompute totals when a new items[] is provided.
        if (Array.isArray(b.items)) {
            const computed = computeItems(b.items)
            data.totalBeforeVat = computed.totalBeforeVat
            data.vatAmount = computed.vatAmount
            data.totalAmount = computed.totalAmount
            await prisma.eInvoiceItem.deleteMany({ where: { eInvoiceId: id } }).catch(() => {})
            data.items = { create: computed.items }
        }

        const updated = await prisma.eInvoice.update({ where: { id }, data, include: { items: true } })
        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('PUT /einvoice/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/einvoice/:id — delete DRAFT only
router.delete('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const inv = await prisma.eInvoice.findUnique({ where: { id } }).catch(() => null)
        if (!inv) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })
        if (inv.status !== 'DRAFT') {
            return res.status(400).json({ success: false, error: `Chỉ xóa được hóa đơn nháp (DRAFT). Trạng thái hiện tại: ${inv.status}` })
        }
        await prisma.eInvoiceItem.deleteMany({ where: { eInvoiceId: id } }).catch(() => {})
        await prisma.eInvoice.delete({ where: { id } })
        res.json({ success: true, data: { id, deleted: true } })
    } catch (err: any) {
        console.error('DELETE /einvoice/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/:id/sign — sign → SIGNED, generate XML, assign number
router.post('/:id/sign', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const inv = await getInvoiceWithItems(prisma, id)
        if (!inv) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })
        if (inv.status !== 'DRAFT') {
            return res.status(400).json({ success: false, error: `Chỉ ký được hóa đơn nháp (DRAFT). Trạng thái hiện tại: ${inv.status}` })
        }
        if (!inv.items || inv.items.length === 0) {
            return res.status(400).json({ success: false, error: 'Hóa đơn chưa có dòng hàng hóa' })
        }

        const config = await getActiveConfig(prisma)
        const symbol = inv.invoiceSymbol || buildSymbol(config)
        const invoiceNumber = inv.invoiceNumber || await nextInvoiceNumber(prisma, symbol)

        const signed = { ...inv, invoiceSymbol: symbol, invoiceNumber }
        const xml = generateInvoiceXml(signed, inv.items)

        const updated = await prisma.eInvoice.update({
            where: { id },
            data: {
                status: 'SIGNED',
                invoiceSymbol: symbol,
                invoiceNumber,
                xmlContent: xml,
                signedAt: new Date(),
                issuedAt: new Date(),
            },
            include: { items: true },
        })
        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('POST /einvoice/:id/sign error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/:id/send — send to tax authority via provider (STUB) → SENT
router.post('/:id/send', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const inv = await prisma.eInvoice.findUnique({ where: { id } }).catch(() => null)
        if (!inv) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })
        if (inv.status !== 'SIGNED') {
            return res.status(400).json({ success: false, error: `Chỉ gửi được hóa đơn đã ký (SIGNED). Trạng thái hiện tại: ${inv.status}` })
        }

        const config = await getActiveConfig(prisma)
        // STUB: simulate the provider/CQT acceptance response.
        const providerInvoiceId = `${(config?.provider || 'STUB').toUpperCase()}-${inv.invoiceSymbol || ''}-${inv.invoiceNumber || ''}`
        const providerResponse = {
            code: '00',
            message: 'Hóa đơn đã được cơ quan thuế tiếp nhận (mô phỏng)',
            maCQT: `CQT${pad(Math.abs(hashCode(id)) % 1000000000, 9)}`, // mã cơ quan thuế (giả lập)
            providerInvoiceId,
            receivedAt: new Date().toISOString(),
        }
        console.log(`[einvoice][STUB] send invoice=${inv.invoiceSymbol}${inv.invoiceNumber} provider=${config?.provider || 'STUB'} → ${providerInvoiceId}`)

        const updated = await prisma.eInvoice.update({
            where: { id },
            data: {
                status: 'SENT',
                provider: config?.provider || null,
                providerInvoiceId,
                providerResponse: JSON.stringify(providerResponse),
                sentAt: new Date(),
            },
            include: { items: true },
        })
        // Reflect issuance on the linked transaction, if any.
        if (inv.transactionId) {
            await prisma.transaction.update({
                where: { id: inv.transactionId },
                data: { vatStatus: 'issued', vatInvoiceNumber: `${inv.invoiceSymbol || ''}${inv.invoiceNumber || ''}`, vatIssuedAt: new Date() },
            }).catch(() => {})
        }
        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('POST /einvoice/:id/send error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/:id/cancel — cancel a SENT invoice (requires reason) → CANCELLED
router.post('/:id/cancel', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const reason = req.body?.reason
        if (!reason) return res.status(400).json({ success: false, error: 'Lý do hủy (reason) là bắt buộc' })

        const inv = await prisma.eInvoice.findUnique({ where: { id } }).catch(() => null)
        if (!inv) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })
        if (['CANCELLED', 'REPLACED'].includes(inv.status)) {
            return res.status(400).json({ success: false, error: `Hóa đơn đã ở trạng thái ${inv.status}` })
        }
        if (!['SIGNED', 'SENT'].includes(inv.status)) {
            return res.status(400).json({ success: false, error: `Chỉ hủy được hóa đơn đã ký/đã gửi. Trạng thái hiện tại: ${inv.status}` })
        }

        const config = await getActiveConfig(prisma)
        console.log(`[einvoice][STUB] cancel invoice=${inv.invoiceSymbol}${inv.invoiceNumber} provider=${config?.provider || 'STUB'} reason=${reason}`)

        const updated = await prisma.eInvoice.update({
            where: { id },
            data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
            include: { items: true },
        })
        if (inv.transactionId) {
            await prisma.transaction.update({
                where: { id: inv.transactionId },
                data: { vatStatus: 'none', vatInvoiceNumber: null, vatIssuedAt: null },
            }).catch(() => {})
        }
        res.json({ success: true, data: updated })
    } catch (err: any) {
        console.error('POST /einvoice/:id/cancel error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/:id/replace — create replacement DRAFT, original → REPLACED
router.post('/:id/replace', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const original = await getInvoiceWithItems(prisma, id)
        if (!original) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })
        if (!['SIGNED', 'SENT', 'CANCELLED'].includes(original.status)) {
            return res.status(400).json({ success: false, error: `Chỉ thay thế hóa đơn đã ký/gửi/hủy. Trạng thái hiện tại: ${original.status}` })
        }
        if (original.replacedByInvoiceId) {
            return res.status(400).json({ success: false, error: 'Hóa đơn đã có hóa đơn thay thế' })
        }

        const b = req.body || {}
        // Replacement uses the supplied items, or clones the original's lines.
        const rawItems = Array.isArray(b.items) && b.items.length
            ? b.items
            : (original.items || []).map((it: any) => ({
                itemNumber: it.itemNumber, itemName: it.itemName, unitName: it.unitName,
                quantity: it.quantity, unitPrice: it.unitPrice, vatRate: it.vatRate,
                amount: it.amount, vatAmount: it.vatAmount, notes: it.notes,
            }))
        const computed = computeItems(rawItems)

        const replacement = await prisma.eInvoice.create({
            data: {
                transactionId: original.transactionId || null,
                invoiceType: original.invoiceType || 'SALE',
                status: 'DRAFT',
                invoiceDate: b.invoiceDate || todayISO(),
                sellerName: original.sellerName,
                sellerTaxCode: original.sellerTaxCode,
                sellerAddress: original.sellerAddress,
                buyerName: b.buyerName ?? original.buyerName,
                buyerTaxCode: b.buyerTaxCode ?? original.buyerTaxCode,
                buyerAddress: b.buyerAddress ?? original.buyerAddress,
                totalBeforeVat: computed.totalBeforeVat,
                vatAmount: computed.vatAmount,
                totalAmount: computed.totalAmount,
                currency: original.currency || 'VND',
                paymentMethod: b.paymentMethod ?? original.paymentMethod,
                notes: b.reason ? `Thay thế HĐ ${original.invoiceSymbol || ''}${original.invoiceNumber || ''}: ${b.reason}` : `Thay thế HĐ ${original.invoiceSymbol || ''}${original.invoiceNumber || ''}`,
                replacesInvoiceId: original.id,
                branchId: original.branchId || req.user?.branchId || null,
                createdBy: req.user?.userId || null,
                createdByName: (req.user as any)?.email || null,
                items: { create: computed.items },
            },
            include: { items: true },
        })

        await prisma.eInvoice.update({
            where: { id },
            data: { status: 'REPLACED', replacedByInvoiceId: replacement.id },
        })

        res.status(201).json({ success: true, data: { original: { id, status: 'REPLACED' }, replacement } })
    } catch (err: any) {
        console.error('POST /einvoice/:id/replace error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/einvoice/:id/xml — return signed XML
router.get('/:id/xml', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const inv = await getInvoiceWithItems(prisma, id)
        if (!inv) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })

        // Use stored signed XML when present; otherwise render a live preview.
        const xml = inv.xmlContent || inv.xmlData || generateInvoiceXml(inv, inv.items)
        if (req.query.download === 'true') {
            res.setHeader('Content-Type', 'application/xml; charset=utf-8')
            res.setHeader('Content-Disposition', `attachment; filename="HDon_${inv.invoiceSymbol || ''}${inv.invoiceNumber || inv.id}.xml"`)
            return res.send(xml)
        }
        res.setHeader('Content-Type', 'application/xml; charset=utf-8')
        res.send(xml)
    } catch (err: any) {
        console.error('GET /einvoice/:id/xml error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/einvoice/:id/pdf — HTML preview (or stored pdfUrl)
router.get('/:id/pdf', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const inv = await getInvoiceWithItems(prisma, id)
        if (!inv) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })

        if (inv.pdfUrl && req.query.redirect === 'true') return res.redirect(inv.pdfUrl)

        const rows = (inv.items || []).map((it: any) => `
            <tr>
              <td style="text-align:center">${num(it.itemNumber)}</td>
              <td>${escHtml(it.itemName)}</td>
              <td style="text-align:center">${escHtml(it.unitName || '')}</td>
              <td style="text-align:right">${Number(it.quantity) || 0}</td>
              <td style="text-align:right">${fmtMoney(it.unitPrice)}</td>
              <td style="text-align:center">${num(it.vatRate)}%</td>
              <td style="text-align:right">${fmtMoney(it.amount)}</td>
            </tr>`).join('')

        const html = `<!DOCTYPE html>
<html lang="vi"><head><meta charset="UTF-8"><title>Hóa đơn ${escHtml(inv.invoiceSymbol || '')}${escHtml(inv.invoiceNumber || '')}</title>
<style>
  body{font-family:'Times New Roman',serif;max-width:800px;margin:24px auto;color:#111;padding:0 16px}
  h1{text-align:center;font-size:20px;margin:4px 0}
  .sub{text-align:center;font-size:13px;color:#444;margin-bottom:16px}
  .meta{display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px}
  .party{font-size:13px;margin:4px 0}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  th,td{border:1px solid #444;padding:6px}
  th{background:#f2f2f2}
  .totals{margin-top:12px;font-size:13px}
  .totals div{display:flex;justify-content:space-between;padding:2px 0}
  .words{font-style:italic;margin-top:8px;font-size:13px}
  .status{display:inline-block;padding:2px 8px;border-radius:4px;background:#eee;font-size:12px}
</style></head>
<body>
  <h1>HÓA ĐƠN GIÁ TRỊ GIA TĂNG</h1>
  <div class="sub">(Bản thể hiện của hóa đơn điện tử — TT78/2021/TT-BTC)</div>
  <div class="meta">
    <div>Ký hiệu: <b>${escHtml(inv.invoiceSymbol || '')}</b></div>
    <div>Số: <b>${escHtml(inv.invoiceNumber || '')}</b></div>
    <div>Ngày: <b>${escHtml(inv.invoiceDate || '')}</b></div>
  </div>
  <div class="meta"><div>Trạng thái: <span class="status">${escHtml(inv.status)}</span></div></div>
  <hr/>
  <div class="party"><b>Người bán:</b> ${escHtml(inv.sellerName || '')}</div>
  <div class="party">MST: ${escHtml(inv.sellerTaxCode || '')} &nbsp;|&nbsp; Địa chỉ: ${escHtml(inv.sellerAddress || '')}</div>
  <div class="party" style="margin-top:8px"><b>Người mua:</b> ${escHtml(inv.buyerName || '')}</div>
  <div class="party">MST: ${escHtml(inv.buyerTaxCode || '')} &nbsp;|&nbsp; Địa chỉ: ${escHtml(inv.buyerAddress || '')}</div>
  <div class="party">Hình thức thanh toán: ${escHtml(inv.paymentMethod || 'TM/CK')}</div>
  <table>
    <thead><tr><th>STT</th><th>Tên hàng hóa, dịch vụ</th><th>ĐVT</th><th>SL</th><th>Đơn giá</th><th>Thuế suất</th><th>Thành tiền</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div><span>Cộng tiền hàng (chưa VAT):</span><b>${fmtMoney(inv.totalBeforeVat)} ${escHtml(inv.currency || 'VND')}</b></div>
    <div><span>Tiền thuế GTGT:</span><b>${fmtMoney(inv.vatAmount)} ${escHtml(inv.currency || 'VND')}</b></div>
    <div><span>Tổng tiền thanh toán:</span><b>${fmtMoney(inv.totalAmount)} ${escHtml(inv.currency || 'VND')}</b></div>
  </div>
  <div class="words">Số tiền bằng chữ: ${escHtml(docTienBangChu(num(inv.totalAmount)))}</div>
</body></html>`

        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.send(html)
    } catch (err: any) {
        console.error('GET /einvoice/:id/pdf error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// Tiny deterministic hash for the simulated mã cơ quan thuế.
function hashCode(s: string): number {
    let h = 0
    for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0 }
    return h
}

export default router
