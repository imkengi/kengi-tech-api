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

import { Router, Response, NextFunction } from 'express'
import { errMsg } from '../lib/errorResponse'
import { authMiddleware, AuthRequest, getBranchFilter } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { getProvider, PROVIDERS } from '../services/einvoice'
import type { EInvoiceProviderConfig, EInvoiceData } from '../services/einvoice'

const router = Router()

// Vận hành nội bộ: x-admin-key + x-store-code (giống /api/mcp, /api/flash-sales)
// để debug/xem hàng đợi. authMiddleware phía sau vẫn xử lý mọi request thường.
router.use(async (req: AuthRequest, res: Response, next) => {
    const adminKey = req.headers['x-admin-key'] as string
    if (adminKey && process.env.ADMIN_KEY && adminKey === process.env.ADMIN_KEY) {
        const code = String(req.headers['x-store-code'] || '').trim()
        if (code) {
            const { registryPrisma, getStorePrisma } = await import('../lib/prisma')
            const store = await registryPrisma.store.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } })
            if (store) {
                req.storePrisma = getStorePrisma(store.schema)
                req.user = { role: 'admin', storeSchema: store.schema, branchSchema: store.schema } as any
                ;(req as any).__viaAdminKey = true
                next()
                return
            }
        }
        res.status(400).json({ success: false, error: 'x-admin-key cần kèm x-store-code hợp lệ' })
        return
    }
    next()
})

// Auth cho route: đã qua admin-key shim thì cho thẳng, còn lại authMiddleware như cũ.
const einvoiceAuth = (req: AuthRequest, res: Response, next: NextFunction) =>
    (req as any).__viaAdminKey ? next() : authMiddleware(req, res, next)
// requireRole đọc req.user.role='admin' do shim set nên pass tự nhiên.

// ─── Table provisioning (per-schema, cached once per process) ────────────────
// Boot migration handles existing schemas; this covers schemas provisioned at
// runtime. All statements are idempotent.
const ensuredSchemas = new Set<string>()
async function ensureTables(req: AuthRequest): Promise<void> {
    const prisma = req.storePrisma! as any
    const key = req.user?.branchSchema || req.user?.storeSchema || 'default'
    return ensureEInvoiceTablesFor(prisma, key)
}

/** Bản không cần req — cron hàng đợi xuất HĐ gọi trực tiếp với store client. */
export async function ensureEInvoiceTablesFor(prisma: any, key: string): Promise<void> {
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
    let ex: any = {}
    try { ex = c.extra ? JSON.parse(c.extra) : {} } catch { /* extra hỏng */ }
    const uname = c.apiUsername || c.apiKey || ''
    const tmpl = c.invoicePattern || c.templateId || ''
    const serial = c.invoiceSerial || c.serialNo || ''
    return {
        id: c.id,
        provider: c.provider || 'CUSTOM',
        apiUrl: c.apiUrl || '',
        apiUsername: uname,
        // apiPassword/apiSecret masked by callers
        taxCode: c.taxCode || '',
        companyName: c.companyName || '',
        companyAddress: c.companyAddress || '',
        invoicePattern: tmpl || '1',
        invoiceSerial: serial,
        certificateSerial: c.certificateSerial || '',
        isActive: c.isActive ?? c.active ?? true,
        templateId: c.templateId || null,
        serialNo: c.serialNo || null,
        extra: c.extra || null,
        // Alias theo TÊN TRƯỜNG form FE (EInvoiceConfigView) để form tự nạp lại
        // đúng giá trị đã lưu sau khi reload.
        username: uname,
        templateCode: tmpl,
        serial,
        sellerName: c.companyName || '',
        sellerAddress: c.companyAddress || '',
        sellerEmail: ex.sellerEmail || '',
        sellerPhone: ex.sellerPhone || '',
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
    }
}

export async function getActiveConfig(prisma: any) {
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
router.get('/config', einvoiceAuth, async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/einvoice/config
router.put('/config', einvoiceAuth, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        const provider = (b.provider || 'CUSTOM').toString().toUpperCase()

        // Chấp nhận NHIỀU tên trường: form FE gửi username/password/templateCode/
        // serial/sellerName…, script/legacy gửi apiUsername/apiKey/invoicePattern…
        // — nếu chỉ nhận 1 bộ tên thì form UI lưu hụt (username/mật khẩu/mẫu số mất).
        const existing = await prisma.eInvoiceConfig.findFirst({ where: { provider } }).catch(() => null)
        const uname = b.apiUsername ?? b.apiKey ?? b.username ?? null
        const tmpl = b.invoicePattern ?? b.templateId ?? b.templateCode ?? null
        const serial = b.invoiceSerial ?? b.serialNo ?? b.serial ?? null

        // Gộp email/SĐT bên bán vào extra để provider (VNPT biên lai) điền TCTPhi.
        let extraObj: any = {}
        try { extraObj = existing?.extra ? JSON.parse(existing.extra) : {} } catch { /* extra hỏng → bỏ */ }
        if (b.extra) { try { extraObj = { ...extraObj, ...JSON.parse(b.extra) } } catch { /* ignore */ } }
        if (b.sellerEmail) extraObj.sellerEmail = b.sellerEmail
        if (b.sellerPhone) extraObj.sellerPhone = b.sellerPhone

        const data: any = {
            provider,
            apiUrl: b.apiUrl ?? null,
            apiUsername: uname,
            apiKey: uname, // keep legacy column in sync
            taxCode: b.taxCode ?? null,
            companyName: b.companyName ?? b.sellerName ?? null,
            companyAddress: b.companyAddress ?? b.sellerAddress ?? null,
            invoicePattern: tmpl,
            invoiceSerial: serial,
            templateId: tmpl,
            serialNo: serial,
            certificateSerial: b.certificateSerial ?? null,
            extra: Object.keys(extraObj).length ? JSON.stringify(extraObj) : (b.extra ?? null),
            active: true, isActive: true,
        }
        // Only overwrite the password when a real (non-masked) value is supplied.
        const pwd = b.apiPassword ?? b.apiSecret ?? b.password
        if (pwd && pwd !== '********') {
            data.apiPassword = pwd
            data.apiSecret = pwd // keep legacy column in sync
        }

        // Deactivate previous configs, then upsert the one for this provider.
        await prisma.eInvoiceConfig.updateMany({ where: {}, data: { active: false, isActive: false } }).catch(() => {})

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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/config/test — test connection (STUB)
router.post('/config/test', einvoiceAuth, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const raw = await getActiveConfig(prisma)
        if (!raw) return res.status(400).json({ success: false, error: 'Chưa cấu hình nhà cung cấp hóa đơn' })

        // Gọi THẬT nếu NCC có service (vnpt/misa...); NCC chưa implement thì mô phỏng.
        const provider = getProvider((raw.provider || '').toLowerCase())
        if (!provider) {
            console.log(`[einvoice][STUB] test-connection provider=${raw.provider} url=${raw.apiUrl || '(none)'}`)
            return res.json({
                success: true,
                data: { connected: true, provider: raw.provider, message: `Kết nối tới ${raw.provider} thành công (mô phỏng)`, testedAt: new Date().toISOString() },
            })
        }
        const result = await provider.testConnection(raw as EInvoiceProviderConfig)
        res.json({
            success: result.success,
            data: {
                connected: result.success,
                provider: raw.provider,
                message: result.message,
                providerInfo: result.providerInfo,
                testedAt: new Date().toISOString(),
            },
        })
    } catch (err: any) {
        console.error('POST /einvoice/config/test error:', err)
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  Legacy provider-issuance routes (kept for backward compatibility)
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/einvoice/providers
router.get('/providers', einvoiceAuth, (_req: AuthRequest, res: Response) => {
    res.json({ success: true, data: PROVIDERS })
})

// POST /api/einvoice/test-connection (legacy)
router.post('/test-connection', einvoiceAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/einvoice/history (legacy list — all statuses)
router.get('/history', einvoiceAuth, async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/issue/:transactionId (legacy — issue via provider service)
/**
 * Core xuất hoá đơn cho 1 giao dịch — dùng chung bởi route /issue (tay) và cron
 * hàng đợi xuất theo ngày (tự động khi khách NHẬN HÀNG thành công — yêu cầu CQT).
 * Idempotent: đã có HĐ issued/SENT thì trả skipped.
 */
export async function issueInvoiceForTransaction(
    prisma: any,
    txId: string,
    body: any = {}
): Promise<{ success: boolean; skipped?: boolean; error?: string; invoiceNumber?: string; record?: any }> {
    const config = await getActiveConfig(prisma)
    if (!config) return { success: false, error: 'Chưa cấu hình NCC hóa đơn' }
    const provider = getProvider((config.provider || '').toLowerCase())
    if (!provider) return { success: false, error: `NCC ${config.provider} không hỗ trợ qua API trực tiếp` }

    const existing = await prisma.eInvoice.findFirst({ where: { transactionId: txId, status: { in: ['ISSUING', 'issued', 'SENT'] } } }).catch(() => null)
    if (existing) return { success: true, skipped: true, invoiceNumber: existing.invoiceNumber, error: `Đã xuất HĐ số ${existing.invoiceNumber}` }

    const tx = await prisma.transaction.findUnique({
        where: { id: txId },
        // unitConversions: cần để quy đổi ĐVT khi hoá đơn ghi theo vỉ/thùng
        include: { items: { include: { product: { include: { unitConversions: true } } } }, customer: true },
    })
    if (!tx) return { success: false, error: 'Không tìm thấy giao dịch' }

    // ĐỦ TỒN KHO THUẾ mới được xuất hoá đơn (yêu cầu chủ shop 2026-07-23): hàng
    // bán ra phải có đầu vào chứng từ (phiếu nhập) đủ số lượng — âm kho thuế là
    // rủi ro CQT. Thiếu → KHÔNG tạo bản ghi lỗi, phiếu nằm lại hàng đợi; nhập
    // chứng từ đầu vào xong xuất lại là qua. Bỏ qua chốt bằng body.ignoreTaxStock.
    if (!body.ignoreTaxStock) {
        const shortages = await taxStockShortages(prisma, tx.items || [])
        if (shortages.length > 0) {
            const detail = shortages.slice(0, 3).map(s => `${s.sku} thiếu ${s.thieu}`).join(', ')
                + (shortages.length > 3 ? ` +${shortages.length - 3} mã khác` : '')
            return { success: false, error: `Thiếu TỒN KHO THUẾ (${detail}) — nhập phiếu nhập/chứng từ đầu vào đủ số lượng rồi xuất lại` }
        }
    }

    // Thông tin người mua NHẬP TAY lúc xuất (body) ĐƯỢC ƯU TIÊN (override) — dùng
    // cho nút "Cập nhật thông tin người mua". Không nhập gì + phiếu không gắn khách
    // → mặc định "Người mua không lấy hóa đơn" (bán hàng cho người tiêu dùng, HĐ MTT).
    const bStr = (v: any) => (v === undefined || v === null ? '' : String(v).trim())
    // Tiền của 1 dòng = lineTotal (đã trừ chiết khấu dòng); bản ghi cũ thiếu
    // lineTotal thì mới rơi về SL × đơn giá.
    const _lineAmount = (i: any) => Math.round(
        Number(i.lineTotal) > 0 ? Number(i.lineTotal) : (i.quantity || 1) * (i.unitPrice ?? i.price ?? 0))

    // ─── ĐVT ghi trên HOÁ ĐƠN ──────────────────────────────────────────────
    // Hàng nhập theo vỉ/thùng (chứng từ đầu vào ghi vỉ) thì HĐ đầu ra cũng phải
    // ghi theo vỉ mới đối chiếu được với CQT, trong khi kho + sàn (Shopee/TikTok)
    // vẫn chạy theo đơn vị gốc là cái. Product.invoiceUnit = ĐVT ghi trên HĐ,
    // tỷ lệ lấy từ bảng đơn vị quy đổi của chính sản phẩm.
    // TIỀN KHÔNG ĐỔI: chỉ đổi cách ghi số lượng; đơn giá suy NGƯỢC từ thành tiền
    // để không lệch một đồng nào vì làm tròn.
    const _invUnit = (item: any): { unit: string; qty: number; price: number } => {
        const pr = item.product
        const baseQty = Number(item.baseQuantity) > 0 ? Number(item.baseQuantity) : (item.quantity || 1)
        const amount = _lineAmount(item)
        const baseUnit = pr?.baseUnit || 'Cái'
        const target = String(pr?.invoiceUnit || '').trim()
        const asBase = () => ({ unit: baseUnit, qty: baseQty, price: baseQty > 0 ? amount / baseQty : amount })
        if (!target || target.toLowerCase() === String(baseUnit).toLowerCase()) return asBase()
        // rate = số đơn vị GỐC trong 1 đơn vị hoá đơn (1 vỉ = 10 cái)
        const conv = (pr?.unitConversions || []).find((c: any) =>
            String(c.toUnit || '').toLowerCase() === target.toLowerCase() ||
            String(c.fromUnit || '').toLowerCase() === target.toLowerCase())
        if (!conv || !Number(conv.conversionRate)) return asBase()
        const rate = String(conv.toUnit || '').toLowerCase() === target.toLowerCase()
            ? Number(conv.conversionRate) : 1 / Number(conv.conversionRate)
        if (!Number.isFinite(rate) || rate <= 0) return asBase()
        const qty = baseQty / rate                       // 3 cái → 0,3 vỉ
        return { unit: target, qty, price: qty > 0 ? amount / qty : amount }
    }
    const _txItemsTotal = (tx.items || []).reduce((s: number, i: any) => s + _lineAmount(i), 0)
    const _txTax = Number(tx.tax) || 0
    const _txVatRate = _txTax > 0 && _txItemsTotal > 0
        ? Math.round(_txTax * 100 / _txItemsTotal) : 0
    const invoiceData: EInvoiceData = {
            sellerTaxCode: config.taxCode || '',
            sellerName: config.companyName || '',
            buyerName: bStr(body.buyerName) || tx.customer?.name || tx.customerName || 'Bán cho người tiêu dùng',
            buyerTaxCode: bStr(body.buyerTaxCode) || tx.customer?.taxCode || '',
            buyerAddress: bStr(body.buyerAddress) || tx.customer?.address || '',
            buyerPhone: bStr(body.buyerPhone) || tx.customer?.phone || '',
            buyerEmail: bStr(body.buyerEmail) || tx.customer?.email || '',
            templateId: config.templateId || undefined,
            serialNo: config.serialNo || undefined,
            paymentMethod: tx.paymentMethod || 'TM/CK',
            items: (tx.items || []).map((item: any) => ({
                name: item.product?.name || item.productName || 'Sản phẩm',
                unit: _invUnit(item).unit,
                quantity: _invUnit(item).qty,
                unitPrice: _invUnit(item).price,
                // lineTotal = tiền dòng ĐÃ trừ chiết khấu. Dùng SL×đơn giá thì tổng
                // các dòng gửi NCC > số tiền thanh toán của phiếu có giảm giá.
                amount: _lineAmount(item),
                // Thuế suất theo THUẾ THẬT của phiếu (đơn sàn thường 0), không cứng
                // 10% — cứng 10% làm payload gửi CQT lệch hẳn tổng VAT của hoá đơn.
                vatRate: _txVatRate,
                vatAmount: _txTax > 0 && _txItemsTotal > 0
                    ? Math.round(_txTax * _lineAmount(item) / _txItemsTotal) : 0,
                discount: item.discount || 0,
            })),
            subtotal: tx.subtotal || tx.total || 0,
            vatRate: _txVatRate,
            vatAmount: tx.tax || 0,
            total: tx.total || 0,
            transactionId: tx.id,
            receiptNumber: tx.receiptNumber || '',
        }

    const result = await provider.issueInvoice(config as EInvoiceProviderConfig, invoiceData)
    // Dòng hàng lưu kèm bản ghi HĐ — trước đây KHÔNG tạo EInvoiceItem nên màn chi
    // tiết hiện "Không có dòng hàng". Thuế phân bổ theo tx.tax thật (đơn online
    // thường 0), KHÔNG áp 10% cứng để tổng dòng khớp tổng HĐ.
    const itemRows = (tx.items || []).map((item: any, idx: number) => {
        const amount = _lineAmount(item)
        return {
            itemNumber: idx + 1,
            itemName: item.product?.name || item.productName || 'Sản phẩm',
            unitName: _invUnit(item).unit,
            quantity: _invUnit(item).qty,
            unitPrice: _invUnit(item).price,
            vatRate: _txVatRate,
            vatAmount: _txTax > 0 && _txItemsTotal > 0 ? Math.round(_txTax * amount / _txItemsTotal) : 0,
            amount,
        }
    })
    const record = await prisma.eInvoice.create({
        data: {
            transactionId: txId,
            // Thiếu 2 trường này thì HĐ xuất qua hàng đợi KHÔNG hiện ở màn Danh sách
            // HĐĐT (lọc theo chi nhánh) và biến mất khi lọc theo khoảng ngày.
            branchId: tx.branchId || null,
            invoiceDate: new Date().toISOString().slice(0, 10),
            provider: config.provider,
            invoiceNumber: result.invoiceNumber || null,
            // Ký hiệu/mẫu số theo cấu hình — trước đây bỏ trống nên chi tiết hiện "—"
            invoiceSymbol: config.serialNo || config.invoiceSerial || null,
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
            items: { create: itemRows },
        },
    })
    if (result.success) {
        await prisma.transaction.update({
            where: { id: txId },
            data: { vatStatus: 'issued', vatInvoiceNumber: result.invoiceNumber, vatIssuedAt: new Date() },
        }).catch(() => { })
    }
    return { success: result.success, error: result.errorMessage || undefined, invoiceNumber: result.invoiceNumber, record }
}

router.post('/issue/:transactionId', einvoiceAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const r = await issueInvoiceForTransaction(prisma, String(req.params.transactionId), req.body || {})
        if (!r.success || r.skipped) {
            if (r.skipped) return res.status(400).json({ success: false, error: r.error })
            if (!r.record) return res.status(400).json({ success: false, error: r.error })
        }
        res.json({ success: r.success, data: r.record })
    } catch (err: any) {
        console.error('Issue e-invoice error:', err)
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ─── HÀNG ĐỢI XUẤT HOÁ ĐƠN THEO NGÀY ─────────────────────────────────────────
// Yêu cầu CQT: chỉ xuất HĐ khi khách NHẬN HÀNG thành công. Đơn online chuyển
// thành phiếu ngay lúc chốt/gửi hàng, nên KHÔNG xuất HĐ lúc đó — hàng đợi =
// phiếu online mà đơn gốc đã giao xong (delivered/completed) và chưa có HĐ.
// Cron einvoiceQueue chạy mỗi tối gom xuất; cờ bật/tắt lưu trong config.extra
// (JSON — tránh thêm cột phải migration).

export function parseConfigExtra(config: any): any {
    try { return JSON.parse(config?.extra || '{}') || {} } catch { return {} }
}

const DELIVERED_STATUSES = ['delivered', 'DELIVERED', 'completed', 'COMPLETED']

const RETURN_STATUSES = ['TO_RETURN', 'RETURN', 'returned', 'RETURNED', 'refunded', 'REFUNDED', 'refund', 'cancelled', 'CANCELLED']

// Đơn có PHIẾU TRẢ ĐANG MỞ trên sàn (đã đồng bộ về bảng ReturnOrder). Shopee chỉ
// đổi trạng thái đơn khi ĐÃ HOÀN TIỀN; phiếu mới ở mức "chờ duyệt/đã duyệt" thì
// đơn vẫn 'completed' → trước đây lọt vào hàng đợi và bị auto-xuất HĐ dù khách
// đang trả hàng. 'rejected' KHÔNG tính (sàn từ chối trả, đơn vẫn có hiệu lực).
const OPEN_RETURN_EXISTS = `EXISTS (
               SELECT 1 FROM "ReturnOrder" ro
               WHERE ro."originalInvoice" = o."orderNumber"
                 AND LOWER(ro.status) IN ('pending','approved','processing','refunded')
           )`
const HAS_RETURN_EXPR = `(o.status = ANY($4) OR t.status = 'returned' OR ${OPEN_RETURN_EXISTS})`

// Điều kiện chung của hàng đợi (dùng cho cả list, stats, group theo ngày).
// NGÀY dùng để lọc/gom = COALESCE(deliveredAt, createdAt) — deliveredAt (ngày giao
// thật) nếu có, KHÔNG rơi về updatedAt. updatedAt bị mọi lần sync/backfill "chạm"
// bump lên ngày sync → cả kho đơn cũ (chưa có deliveredAt) dồn hết vào 1 ngày sync
// (vd 5903 đơn nhảy vào 15/07). createdAt = ngày ĐẶT trên sàn, ổn định, không bị
// sync dịch, nên gom trải đúng theo ngày phát sinh + neo anchor cron mới vững.
const QUEUE_FROM = `FROM "Transaction" t
         JOIN "OnlineOrder" o ON ('ONLINE-' || o."orderNumber") = t."receiptNumber"
         LEFT JOIN "Customer" c ON c.id = t."customerId"
         WHERE t.channel = 'online' AND t.status IN ('completed', 'returned')
           AND (o.status = ANY($1) OR o."deliveredAt" IS NOT NULL)
           AND COALESCE(o."deliveredAt", o."createdAt") >= $2
           AND COALESCE(o."deliveredAt", o."createdAt") <= $3
           AND NOT EXISTS (
               SELECT 1 FROM "EInvoice" e
               WHERE e."transactionId" = t.id AND e.status IN ('issued', 'SENT')
           )`

/**
 * TỒN KHO THUẾ theo từng SKU = tổng NHẬP có hoá đơn VAT (hasVatInvoice)
 * − tổng ĐÃ XUẤT HOÁ ĐƠN (chỉ phiếu bán ĐÃ có EInvoice issued/SENT — bán chưa
 * xuất HĐ thì CHƯA trừ, yêu cầu chủ shop 2026-07-24 "khi xuất hoá đơn mới trừ").
 * Phiếu đang định xuất: cần tồn khả dụng ≥ số lượng của chính phiếu này.
 */
async function taxStockShortages(
    prisma: any,
    items: { sku?: string | null; productName?: string | null; quantity?: number | null }[]
): Promise<{ sku: string; name: string; thieu: number }[]> {
    const skus = [...new Set(items.map(i => String(i.sku || '').trim().toLowerCase()).filter(Boolean))]
    if (skus.length === 0) return []
    const [inRows, outRows] = await Promise.all([
        prisma.$queryRawUnsafe(
            // CHỈ tính phiếu nhập CÓ HOÁ ĐƠN VAT (hasVatInvoice=true) — nhập trôi
            // nổi không hoá đơn KHÔNG được tính vào tồn kho thuế.
            `SELECT LOWER(TRIM(ii."productSku")) AS k, COALESCE(SUM(ii.quantity - COALESCE(ii."returnedQuantity",0)),0)::float8 AS q
             FROM "ImportReceiptItem" ii JOIN "ImportReceipt" r ON r.id = ii."receiptId"
             WHERE r."hasVatInvoice" = true AND r.status = 'completed'
               AND LOWER(TRIM(ii."productSku")) = ANY($1::text[]) GROUP BY 1`, skus),
        prisma.$queryRawUnsafe(
            // CHỈ trừ phần ĐÃ XUẤT HOÁ ĐƠN (EXISTS EInvoice issued/SENT — EXISTS để
            // phiếu có nhiều bản ghi HĐ lỗi + 1 bản SENT không bị đếm trùng)
            `SELECT LOWER(TRIM(i.sku)) AS k, COALESCE(SUM(COALESCE(NULLIF(i."baseQuantity",0), i.quantity)),0)::float8 AS q
             FROM "TransactionItem" i JOIN "Transaction" t ON t.id = i."transactionId"
             WHERE t.status IN ('completed','partial','returned')
               AND EXISTS (SELECT 1 FROM "EInvoice" e WHERE e."transactionId" = t.id AND e.status IN ('issued','SENT'))
               AND LOWER(TRIM(i.sku)) = ANY($1::text[]) GROUP BY 1`, skus),
    ])
    const imp: Record<string, number> = Object.fromEntries((inRows as any[]).map((r: any) => [r.k, Number(r.q)]))
    const out: Record<string, number> = Object.fromEntries((outRows as any[]).map((r: any) => [r.k, Number(r.q)]))
    // Nhu cầu của CHÍNH phiếu đang xuất (gộp theo mã)
    const need: Record<string, { qty: number; sku: string; name: string }> = {}
    for (const it of items) {
        const k = String(it.sku || '').trim().toLowerCase()
        if (!k) continue
        if (!need[k]) need[k] = { qty: 0, sku: String(it.sku).trim(), name: it.productName || '' }
        // baseQuantity = số lượng theo ĐƠN VỊ GỐC (bán 1 vỉ = 10 cái). Bản ghi cũ
        // chưa có thì rơi về quantity.
        need[k].qty += Number((it as any).baseQuantity) || Number(it.quantity) || 0
    }
    const shortages: { sku: string; name: string; thieu: number }[] = []
    for (const [k, n] of Object.entries(need)) {
        const conLai = (imp[k] || 0) - (out[k] || 0) // tồn kho thuế khả dụng
        if (conLai < n.qty) shortages.push({ sku: n.sku, name: n.name, thieu: n.qty - conLai })
    }
    return shortages
}

// GET /einvoice/tax-stock?q=&limit= — bảng TỒN KHO THUẾ theo từng SKU, tính Y HỆT
// công thức chặn xuất HĐ: nhập có hoá đơn VAT (hasVatInvoice) − đã bán (phiếu
// completed/partial). ton < 0 = đang thiếu, mã đó không xuất được HĐ.
router.get('/tax-stock', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const q = String(req.query.q || '').trim().toLowerCase()
        const limit = Math.min(Math.max(1, Number(req.query.limit) || 300), 1000)
        const qFilter = q ? `WHERE x.sku LIKE '%' || $1 || '%' OR LOWER(COALESCE(p.name,'')) LIKE '%' || $1 || '%'` : ''
        const params: any[] = q ? [q] : []
        const rows = await prisma.$queryRawUnsafe(`
            SELECT x.sku, COALESCE(p.name, x.any_name, '') AS name,
                   x.nhap::float8 AS "nhapVat", x.xuat::float8 AS xuat,
                   (x.nhap - x.xuat)::float8 AS ton
            FROM (
                SELECT COALESCE(i.k, s.k) AS sku,
                       COALESCE(i.q, 0) AS nhap, COALESCE(s.q, 0) AS xuat,
                       COALESCE(i.any_name, s.any_name) AS any_name
                FROM (
                    SELECT LOWER(TRIM(ii."productSku")) AS k,
                           SUM(ii.quantity - COALESCE(ii."returnedQuantity",0)) AS q, MIN(ii."productName") AS any_name
                    FROM "ImportReceiptItem" ii JOIN "ImportReceipt" r ON r.id = ii."receiptId"
                    WHERE r."hasVatInvoice" = true AND r.status = 'completed'
                      AND NULLIF(TRIM(ii."productSku"),'') IS NOT NULL
                    GROUP BY 1
                ) i
                FULL OUTER JOIN (
                    -- CHỈ trừ phần ĐÃ XUẤT HOÁ ĐƠN (khớp công thức chặn — bán chưa
                    -- xuất HĐ thì chưa trừ tồn kho thuế)
                    SELECT LOWER(TRIM(ti.sku)) AS k, SUM(COALESCE(NULLIF(ti."baseQuantity",0), ti.quantity)) AS q, MIN(ti."productName") AS any_name
                    FROM "TransactionItem" ti JOIN "Transaction" t ON t.id = ti."transactionId"
                    WHERE t.status IN ('completed','partial','returned')
                      AND EXISTS (SELECT 1 FROM "EInvoice" e WHERE e."transactionId" = t.id AND e.status IN ('issued','SENT'))
                      AND NULLIF(TRIM(ti.sku),'') IS NOT NULL
                    GROUP BY 1
                ) s ON s.k = i.k
            ) x
            LEFT JOIN "Product" p ON LOWER(TRIM(p.sku)) = x.sku
            ${qFilter}
            ORDER BY (x.nhap - x.xuat) ASC, x.xuat DESC
            LIMIT ${limit}
        `, ...params)
        const tongThieu = (rows as any[]).filter((r: any) => r.ton < 0).length
        res.json({ success: true, data: { rows, tongThieu } })
    } catch (err: any) {
        console.error('[tax-stock]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /einvoice/tax-stock-gap?from=YYYY-MM-DD&to=&platform=&onlyShort=1
// ĐỐI CHIẾU hàng đợi xuất HĐ ⇄ TỒN KHO THUẾ: gom nhu cầu theo SKU của toàn bộ phiếu
// đang chờ xuất (từ MỐC NGÀY người dùng chọn), so với tồn kho thuế khả dụng
// (nhập có HĐ VAT − đã xuất HĐ) → ra danh sách CẦN NHẬP THÊM bao nhiêu mỗi mã.
// Đơn đã trả hàng/hoàn tiền bị loại (không xuất HĐ nữa nên không tính nhu cầu).
router.get('/tax-stock-gap', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        // Ngày phải PARSE ĐƯỢC — ô ngày để trống ở FE gửi lên "T00:00:00" → Invalid
        // Date → query nổ 500. Không hợp lệ thì rơi về mặc định thay vì lỗi.
        const parseDate = (v: any, fallback: Date): Date => {
            if (!v) return fallback
            const d = new Date(String(v))
            return isNaN(d.getTime()) ? fallback : d
        }
        let to = parseDate(req.query.to, new Date())
        let from = parseDate(req.query.from, new Date(Date.now() - 30 * 86400_000))
        if (from > to) [from, to] = [to, from]
        const platform = req.query.platform ? String(req.query.platform).toLowerCase() : ''
        const onlyShort = String(req.query.onlyShort || '') === '1'

        const params: any[] = [DELIVERED_STATUSES, from, to, RETURN_STATUSES]
        let platFilter = ''
        if (platform) {
            params.push(platform)
            platFilter = ` AND LOWER(COALESCE(o.platform,'')) = $${params.length}`
        }
        // Phiếu chờ xuất trong khoảng, BỎ đơn trả hàng/hoàn tiền
        const queueCte = `SELECT t.id ${QUEUE_FROM}
             AND NOT ${HAS_RETURN_EXPR}${platFilter}`

        const rows = await prisma.$queryRawUnsafe(`
            WITH q AS (${queueCte}),
            need AS (
                SELECT LOWER(TRIM(ti.sku)) AS k, SUM(COALESCE(NULLIF(ti."baseQuantity",0), ti.quantity))::float8 AS q,
                       MIN(ti."productName") AS any_name,
                       COUNT(DISTINCT ti."transactionId")::int AS orders
                FROM "TransactionItem" ti JOIN q ON q.id = ti."transactionId"
                WHERE NULLIF(TRIM(ti.sku),'') IS NOT NULL
                GROUP BY 1
            ),
            imp AS (
                SELECT LOWER(TRIM(ii."productSku")) AS k,
                       SUM(ii.quantity - COALESCE(ii."returnedQuantity",0))::float8 AS q
                FROM "ImportReceiptItem" ii JOIN "ImportReceipt" r ON r.id = ii."receiptId"
                WHERE r."hasVatInvoice" = true AND r.status = 'completed'
                  AND NULLIF(TRIM(ii."productSku"),'') IS NOT NULL
                GROUP BY 1
            ),
            sold AS (
                SELECT LOWER(TRIM(ti.sku)) AS k, SUM(COALESCE(NULLIF(ti."baseQuantity",0), ti.quantity))::float8 AS q
                FROM "TransactionItem" ti JOIN "Transaction" t ON t.id = ti."transactionId"
                WHERE t.status IN ('completed','partial','returned')
                  AND EXISTS (SELECT 1 FROM "EInvoice" e WHERE e."transactionId" = t.id AND e.status IN ('issued','SENT'))
                  AND NULLIF(TRIM(ti.sku),'') IS NOT NULL
                GROUP BY 1
            )
            SELECT n.k AS sku, COALESCE(p.name, n.any_name, '') AS name,
                   n.q AS "canXuat", n.orders,
                   COALESCE(i.q,0) AS "nhapVat", COALESCE(s.q,0) AS "daXuat",
                   (COALESCE(i.q,0) - COALESCE(s.q,0)) AS ton,
                   (n.q - (COALESCE(i.q,0) - COALESCE(s.q,0))) AS thieu,
                   COALESCE(p."costPrice",0)::float8 AS "costPrice",
                   COALESCE(p.stock,0)::int AS "tonThuc"
            FROM need n
            LEFT JOIN imp i ON i.k = n.k
            LEFT JOIN sold s ON s.k = n.k
            LEFT JOIN "Product" p ON LOWER(TRIM(p.sku)) = n.k
            ${onlyShort ? 'WHERE (n.q - (COALESCE(i.q,0) - COALESCE(s.q,0))) > 0' : ''}
            ORDER BY (n.q - (COALESCE(i.q,0) - COALESCE(s.q,0))) DESC, n.q DESC
            LIMIT 2000
        `, ...params)

        // Hàng trong hàng đợi KHÔNG có SKU → không đối chiếu được tồn kho thuế
        const noSkuRow = await prisma.$queryRawUnsafe(`
            WITH q AS (${queueCte})
            SELECT COALESCE(SUM(ti.quantity),0)::float8 AS qty,
                   COUNT(DISTINCT ti."transactionId")::int AS orders
            FROM "TransactionItem" ti JOIN q ON q.id = ti."transactionId"
            WHERE NULLIF(TRIM(ti.sku),'') IS NULL
        `, ...params)

        let list = rows as any[]
        let fullCount = list.length

        // ── CHUẨN HOÁ VỀ MÃ KHO THẬT ───────────────────────────────────────
        // (1) COMBO không có chứng từ đầu vào cho chính nó → bung thành THÀNH PHẦN.
        // (2) Mã ĐÃ GỘP → dồn về mã đích, quy đổi số lượng theo hệ số.
        // Không làm thì báo cáo đòi "nhập thêm combo" (vô nghĩa) và tách đôi nhu
        // cầu của cùng một món thành 2 mã.
        try {
            const skus = list.map(r => String(r.sku))
            const prods = skus.length ? await prisma.$queryRawUnsafe(
                `SELECT LOWER(TRIM(sku)) AS k, id, "bundleId", "mergedIntoId", "mergedRate" FROM "Product"
                 WHERE LOWER(TRIM(sku)) = ANY($1::text[])`, skus) : []
            const meta = new Map((prods as any[]).map((p: any) => [p.k, p]))

            // gom nhu cầu theo mã hiệu lực
            const need = new Map<string, { canXuat: number; orders: number; name: string }>()
            const addNeed = (sku: string, qty: number, orders: number, name: string) => {
                const k = sku.toLowerCase().trim()
                const cur = need.get(k) || { canXuat: 0, orders: 0, name }
                cur.canXuat += qty; cur.orders = Math.max(cur.orders, orders)
                if (!cur.name) cur.name = name
                need.set(k, cur)
            }
            for (const r of list) {
                const m: any = meta.get(String(r.sku))
                if (m?.bundleId) {
                    const b = await prisma.bundle.findUnique({ where: { id: m.bundleId } }).catch(() => null)
                    let comps: any[] = []
                    try { comps = JSON.parse((b as any)?.items || '[]') } catch { comps = [] }
                    if (comps.length > 0) {
                        for (const c of comps) {
                            if (!c.sku) continue
                            addNeed(String(c.sku), Number(r.canXuat) * (Number(c.quantity) || 1), r.orders, c.name || '')
                        }
                        continue
                    }
                }
                if (m?.mergedIntoId) {
                    const tgt = await prisma.product.findUnique({ where: { id: m.mergedIntoId }, select: { sku: true, name: true } }).catch(() => null)
                    if (tgt?.sku) { addNeed(tgt.sku, Number(r.canXuat) * (Number(m.mergedRate) || 1), r.orders, tgt.name); continue }
                }
                addNeed(String(r.sku), Number(r.canXuat), r.orders, r.name)
            }

            // tính lại tồn kho thuế cho ĐÚNG tập mã hiệu lực
            const keys = [...need.keys()]
            const stockRows = keys.length ? await prisma.$queryRawUnsafe(`
                SELECT k, COALESCE(i.q,0) - COALESCE(s.q,0) AS ton, COALESCE(i.q,0) AS nhap, COALESCE(s.q,0) AS xuat,
                       COALESCE(p.name,'') AS name, COALESCE(p."costPrice",0)::float8 AS cost, COALESCE(p.stock,0)::int AS tonthuc
                FROM unnest($1::text[]) AS k
                LEFT JOIN (
                    SELECT LOWER(TRIM(ii."productSku")) AS kk,
                           SUM(ii.quantity - COALESCE(ii."returnedQuantity",0))::float8 AS q
                    FROM "ImportReceiptItem" ii JOIN "ImportReceipt" r ON r.id = ii."receiptId"
                    WHERE r."hasVatInvoice" = true AND r.status = 'completed' GROUP BY 1
                ) i ON i.kk = k
                LEFT JOIN (
                    SELECT LOWER(TRIM(ti.sku)) AS kk,
                           SUM(COALESCE(NULLIF(ti."baseQuantity",0), ti.quantity))::float8 AS q
                    FROM "TransactionItem" ti JOIN "Transaction" t ON t.id = ti."transactionId"
                    WHERE t.status IN ('completed','partial','returned')
                      AND EXISTS (SELECT 1 FROM "EInvoice" e WHERE e."transactionId" = t.id AND e.status IN ('issued','SENT'))
                    GROUP BY 1
                ) s ON s.kk = k
                LEFT JOIN "Product" p ON LOWER(TRIM(p.sku)) = k`, keys) : []
            const stockMap = new Map((stockRows as any[]).map((r: any) => [r.k, r]))

            list = keys.map(k => {
                const n = need.get(k)!
                const st: any = stockMap.get(k) || {}
                const ton = Number(st.ton) || 0
                return {
                    sku: k, name: st.name || n.name || '',
                    canXuat: n.canXuat, orders: n.orders,
                    nhapVat: Number(st.nhap) || 0, daXuat: Number(st.xuat) || 0,
                    ton, thieu: n.canXuat - ton,
                    costPrice: Number(st.cost) || 0, tonThuc: Number(st.tonthuc) || 0,
                }
            }).sort((a, b) => b.thieu - a.thieu || b.canXuat - a.canXuat)

            // ── QUY VỀ ĐVT CHÍNH (đơn vị kê thuế) ──────────────────────────
            // Mua hàng theo VỈ thì bảng kê thiếu phải nói "thiếu 2 vỉ", không phải
            // "20 cái" — người đi đặt hàng NCC đọc theo vỉ. invoiceUnit đặt lúc gộp.
            const unitRows = keys.length ? await prisma.$queryRawUnsafe(`
                SELECT LOWER(TRIM(p.sku)) AS k, p."invoiceUnit" AS dv, p."baseUnit" AS dvgoc,
                       uc."conversionRate" AS rate
                FROM "Product" p
                LEFT JOIN "UnitConversion" uc
                  ON uc."productId" = p.id AND LOWER(uc."toUnit") = LOWER(p."invoiceUnit")
                WHERE LOWER(TRIM(p.sku)) = ANY($1::text[]) AND NULLIF(TRIM(p."invoiceUnit"),'') IS NOT NULL
            `, keys) : []
            const unitMap = new Map((unitRows as any[]).map((r: any) => [r.k, r]))

            // Mã hiển thị phải là MÃ CỦA ĐƠN VỊ ĐANG GHI: kê "0,2 Vỉ" thì phải kèm
            // mã vỉ (EDH-CBZ006-E2) chứ không phải mã cái (SP000195) — người đi đặt
            // hàng NCC đọc theo mã vỉ. Lấy từ mã đã gộp có ĐVT gốc trùng ĐVT chính.
            // Khớp theo HỆ SỐ, không khớp theo tên đơn vị: mã vỉ thường được tạo với
            // ĐVT mặc định "Cái" nên so tên là trượt. Hệ số gộp = hệ số quy đổi của
            // ĐVT chính thì đúng là mã của đơn vị đó.
            const aliasRows = keys.length ? await prisma.$queryRawUnsafe(`
                SELECT LOWER(TRIM(t.sku)) AS k, m.sku AS "maDonVi", m."mergedRate" AS rate
                FROM "Product" m
                JOIN "Product" t ON t.id = m."mergedIntoId"
                WHERE LOWER(TRIM(t.sku)) = ANY($1::text[])
                  AND NULLIF(TRIM(t."invoiceUnit"),'') IS NOT NULL`, keys) : []
            const aliasByKey = new Map<string, any[]>()
            for (const a of aliasRows as any[]) {
                (aliasByKey.get(a.k) || aliasByKey.set(a.k, []).get(a.k)!).push(a)
            }
            list = list.map(r => {
                const u: any = unitMap.get(r.sku)
                const rt = Number(u?.rate) || 0
                if (!u || rt <= 0) return { ...r, donVi: (u?.dvgoc || ''), heSo: 1 }
                const q = (v: number) => Math.round((v / rt) * 100) / 100
                return {
                    ...r,
                    // mã đặt hàng theo đơn vị chính; giữ mã kho để tra cứu
                    sku: (aliasByKey.get(r.sku) || []).find((a: any) => Math.abs((Number(a.rate) || 0) - rt) < 0.001)?.maDonVi || r.sku,
                    skuKho: r.sku,
                    donVi: u.dv, heSo: rt, donViGoc: u.dvgoc,
                    canXuat: q(r.canXuat), ton: q(r.ton), thieu: q(r.thieu),
                    nhapVat: q(r.nhapVat), daXuat: q(r.daXuat),
                    // giá vốn theo ĐVT chính để "ước tiền" vẫn đúng
                    costPrice: Math.round((r.costPrice || 0) * rt),
                }
            })
            // Giữ TOÀN BỘ danh sách để tính tổng; onlyShort chỉ cắt phần TRẢ VỀ,
            // nếu không thẻ "mã hàng chờ xuất HĐ" sẽ hiện đúng bằng số mã thiếu.
            fullCount = list.length
            if (onlyShort) list = list.filter(r => r.thieu > 0)
        } catch (e: any) {
            console.warn('[tax-stock-gap] chuẩn hoá combo/gộp lỗi:', e?.message || e)
        }

        const short = list.filter(r => Number(r.thieu) > 0)
        const summary = {
            skus: fullCount,
            canXuatQty: list.reduce((s, r) => s + Number(r.canXuat || 0), 0),
            shortSkus: short.length,
            shortQty: short.reduce((s, r) => s + Number(r.thieu), 0),
            // Ước tính tiền hàng cần nhập thêm (theo giá vốn hiện tại)
            estCost: short.reduce((s, r) => s + Number(r.thieu) * Number(r.costPrice || 0), 0),
            noSku: (noSkuRow as any[])[0] || { qty: 0, orders: 0 },
        }
        res.json({
            success: true,
            data: { rows: list, summary, from: from.toISOString(), to: to.toISOString() },
        })
    } catch (err: any) {
        console.error('[tax-stock-gap]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) || 'Lỗi truy vấn đối chiếu tồn kho thuế' })
    }
})

/** Phiếu online đủ điều kiện xuất HĐ (đã giao, chưa có HĐ) trong khoảng ngày giao. */
export async function findInvoiceQueue(
    prisma: any,
    opts: { from?: Date; to?: Date; limit?: number; offset?: number; day?: string; platform?: string } = {}
): Promise<any[]> {
    const from = opts.from || new Date(Date.now() - 30 * 86400_000)
    const to = opts.to || new Date()
    const limit = Math.min(opts.limit ?? 300, 1000)
    const offset = Math.max(0, opts.offset ?? 0)
    // hasReturn: đơn ĐÃ giao nhưng sau đó trả hàng/hoàn tiền/hủy — vẫn hiện trong
    // bảng (badge đỏ) nhưng KHÔNG auto-xuất (cron/lô lọc).
    // Lọc NGÀY/SÀN chạy ở SQL (không lọc client trên trang hiện tại) — trước đây
    // lọc client làm chọn TikTok chỉ ra 1 phiếu dù cả khoảng có hàng trăm.
    // Chỉ số tham số tính theo params.length để không lệch $n.
    const params: any[] = [DELIVERED_STATUSES, from, to, RETURN_STATUSES]
    let dayFilter = ''
    if (opts.day) {
        params.push(opts.day)
        dayFilter = `AND (COALESCE(o."deliveredAt", o."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $${params.length}::date`
    }
    if (opts.platform) {
        params.push(opts.platform.toLowerCase())
        dayFilter += ` AND LOWER(COALESCE(o.platform,'')) = $${params.length}`
    }
    return prisma.$queryRawUnsafe(
        `SELECT t.id, t."receiptNumber", t."customerName", t."customerPhone", t.total,
                NULL::text AS "buyerTaxCode", c.address AS "buyerAddress",
                o."createdAt" AS "orderDate",
                COALESCE(o."deliveredAt", o."createdAt") AS "deliveredAt", o.status AS "orderStatus", o.platform,
                ${HAS_RETURN_EXPR} AS "hasReturn"
         ${QUEUE_FROM}
         ${dayFilter}
         ORDER BY COALESCE(o."deliveredAt", o."createdAt") ASC
         LIMIT ${limit} OFFSET ${offset}`,
        ...params
    )
}

/** Thống kê hàng đợi: tổng, theo sàn, theo NGÀY giao (cho chế độ "Gom theo ngày"). */
export async function invoiceQueueStats(prisma: any, from: Date, to: Date, platform?: string, day?: string) {
    // totals + byDay theo BỘ LỌC SÀN (để tổng/phân trang khớp danh sách đang xem);
    // byPlatform CỐ TÌNH không lọc sàn — thẻ "THEO SÀN" + dropdown vẫn liệt kê đủ sàn.
    const params: any[] = [DELIVERED_STATUSES, from, to, RETURN_STATUSES]
    let platFilter = ''
    if (platform) {
        params.push(platform.toLowerCase())
        platFilter = ` AND LOWER(COALESCE(o.platform,'')) = $${params.length}`
    }
    // Lọc 1 NGÀY cũng phải áp vào thống kê, nếu không "tổng chờ xuất" là của cả
    // khoảng → FE hiện thừa trang, trang 2 trở đi rỗng.
    if (day) {
        params.push(day)
        platFilter += ` AND (COALESCE(o."deliveredAt", o."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $${params.length}::date`
    }
    const [totals, byPlatform, byDay] = await Promise.all([
        prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS n, COALESCE(SUM(t.total),0)::float8 AS amount,
                    COUNT(*) FILTER (WHERE ${HAS_RETURN_EXPR})::int AS returns
             ${QUEUE_FROM}${platFilter}`, ...params),
        // LƯU Ý: query này không dùng $4 — truyền thừa tham số là Postgres từ chối
        prisma.$queryRawUnsafe(
            `SELECT COALESCE(o.platform,'?') AS platform, COUNT(*)::int AS n, COALESCE(SUM(t.total),0)::float8 AS amount
             ${QUEUE_FROM} GROUP BY 1 ORDER BY 2 DESC`, DELIVERED_STATUSES, from, to),
        prisma.$queryRawUnsafe(
            `SELECT to_char((COALESCE(o."deliveredAt", o."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS day,
                    COUNT(*)::int AS n, COALESCE(SUM(t.total),0)::float8 AS amount,
                    COUNT(*) FILTER (WHERE ${HAS_RETURN_EXPR})::int AS returns
             ${QUEUE_FROM}${platFilter} GROUP BY 1 ORDER BY 1 DESC`, ...params),
    ])
    return { totals: (totals as any[])[0] || { n: 0, amount: 0, returns: 0 }, byPlatform, byDay }
}

// GET /einvoice/queue — hàng đợi + thống kê (tổng/theo sàn/theo ngày) + phân trang.
// ?days=30&page=1&pageSize=50&day=YYYY-MM-DD (lọc 1 ngày — chế độ Gom theo ngày)
router.get('/queue', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const days = Math.min(Number(req.query.days) || 30, 90)
        const page = Math.max(1, Number(req.query.page) || 1)
        const pageSize = Math.min(Math.max(1, Number(req.query.pageSize) || 50), 100)
        const day = req.query.day ? String(req.query.day) : undefined
        const month = req.query.month ? String(req.query.month) : undefined // "YYYY-MM"
        const config = await getActiveConfig(prisma)
        const extra = parseConfigExtra(config)
        // Có mốc neo (thời điểm bật auto) → chỉ tính đơn giao TỪ mốc đó; hoá đơn
        // quá khứ trước khi bật bị bỏ qua theo yêu cầu.
        const anchor = extra.autoIssueSince ? new Date(extra.autoIssueSince) : null
        let from: Date, to: Date
        const monthOk = !!month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
        if (monthOk) {
            // Lọc theo THÁNG (giờ VN): bỏ qua neo/days để soi/​xuất bù cả tháng.
            const [y, m] = String(month).split('-').map(Number)
            const nextM = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
            from = new Date(`${month}-01T00:00:00+07:00`)
            to = new Date(new Date(`${nextM}-01T00:00:00+07:00`).getTime() - 1)
        } else {
            from = anchor || new Date(Date.now() - days * 86400_000)
            to = new Date()
        }
        const platform = req.query.platform ? String(req.query.platform).toLowerCase() : undefined
        const [rows, stats] = await Promise.all([
            findInvoiceQueue(prisma, { from, to, limit: pageSize, offset: (page - 1) * pageSize, day, platform }),
            invoiceQueueStats(prisma, from, to, platform, day),
        ])
        res.json({
            success: true,
            data: {
                autoIssueOnDelivery: !!extra.autoIssueOnDelivery,
                autoIssueSince: extra.autoIssueSince || null,
                providerConfigured: !!config,
                pending: stats.totals.n,
                page, pageSize,
                stats,
                items: rows,
            },
        })
    } catch (err: any) {
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /einvoice/queue/receipt/:txId — chi tiết phiếu trước khi xuất HĐ:
// dòng hàng + thông tin người mua + CẢNH BÁO thiếu MST/địa chỉ.
router.get('/queue/receipt/:txId', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const tx = await prisma.transaction.findUnique({
            where: { id: String(req.params.txId) },
            include: { items: { include: { product: { select: { name: true, baseUnit: true } } } }, customer: true },
        })
        if (!tx) { res.status(404).json({ success: false, error: 'Không tìm thấy phiếu' }); return }
        const warnings: string[] = []
        if (!tx.customer?.taxCode) warnings.push('Người mua chưa có MÃ SỐ THUẾ — hoá đơn sẽ xuất dạng khách lẻ (không khấu trừ được)')
        if (!tx.customer?.address && !tx.customerPhone) warnings.push('Thiếu địa chỉ & SĐT người mua')
        else if (!tx.customer?.address) warnings.push('Thiếu địa chỉ người mua')
        // Đủ tồn kho thuế mới xuất được HĐ — báo trước ngay trong drawer
        try {
            const shortages = await taxStockShortages(prisma, tx.items || [])
            for (const s of shortages.slice(0, 5)) {
                warnings.push(`THIẾU TỒN KHO THUẾ: ${s.sku} thiếu ${s.thieu} — nhập chứng từ đầu vào trước, nếu không sẽ KHÔNG xuất được HĐ`)
            }
        } catch { /* bảng chưa có ở schema cũ — bỏ qua cảnh báo */ }
        res.json({
            success: true,
            data: {
                receiptNumber: tx.receiptNumber,
                customerName: tx.customer?.name || tx.customerName || 'Khách lẻ',
                customerPhone: tx.customerPhone || tx.customer?.phone || '',
                buyerTaxCode: tx.customer?.taxCode || '',
                buyerAddress: tx.customer?.address || '',
                total: tx.total, subtotal: tx.subtotal, discount: tx.discount,
                transactionDate: tx.transactionDate || tx.createdAt,
                items: (tx.items || []).map((i: any) => ({
                    name: i.product?.name || i.productName, sku: i.sku,
                    unit: i.product?.baseUnit || 'cái',
                    quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal,
                })),
                warnings,
            },
        })
    } catch (err: any) {
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /einvoice/queue/history — lịch sử xuất qua hàng đợi: SENT/ERROR + đếm.
router.get('/queue/history', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const days = Math.min(Number(req.query.days) || 30, 90)
        const status = String(req.query.status || '') // '', 'SENT', 'ERROR'
        const page = Math.max(1, Number(req.query.page) || 1)
        const pageSize = Math.min(Math.max(1, Number(req.query.pageSize) || 50), 100)
        const from = new Date(Date.now() - days * 86400_000)
        const where: any = {
            transactionId: { not: null },
            createdAt: { gte: from },
            ...(status ? { status } : { status: { in: ['SENT', 'ERROR'] } }),
        }
        const [items, total, sent, errors] = await Promise.all([
            prisma.eInvoice.findMany({
                where, orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize, take: pageSize,
                select: {
                    id: true, transactionId: true, invoiceNumber: true, status: true,
                    errorMessage: true, buyerName: true, totalAmount: true,
                    issuedAt: true, createdAt: true, provider: true, lookupCode: true,
                },
            }),
            prisma.eInvoice.count({ where }),
            prisma.eInvoice.count({ where: { transactionId: { not: null }, createdAt: { gte: from }, status: 'SENT' } }),
            prisma.eInvoice.count({ where: { transactionId: { not: null }, createdAt: { gte: from }, status: 'ERROR' } }),
        ])
        res.json({ success: true, data: { items, total, page, pageSize, counts: { sent, errors } } })
    } catch (err: any) {
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /einvoice/queue/auto {enabled} — bật/tắt tự động xuất mỗi tối
router.put('/queue/auto', einvoiceAuth, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const config = await getActiveConfig(prisma)
        if (!config) return res.status(400).json({ success: false, error: 'Chưa cấu hình NCC hóa đơn — vào Cài đặt hoá đơn điện tử trước' })
        const extra = parseConfigExtra(config)
        extra.autoIssueOnDelivery = !!req.body?.enabled
        // Mốc neo: BỎ QUA hoá đơn quá khứ — chỉ đơn giao TỪ LÚC BẬT trở đi mới
        // vào hàng đợi. Mỗi lần bật lại là neo lại từ thời điểm đó.
        if (extra.autoIssueOnDelivery) extra.autoIssueSince = new Date().toISOString()
        await prisma.eInvoiceConfig.update({ where: { id: config.id }, data: { extra: JSON.stringify(extra) } })
        res.json({ success: true, data: { autoIssueOnDelivery: extra.autoIssueOnDelivery, autoIssueSince: extra.autoIssueSince || null } })
    } catch (err: any) {
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /einvoice/queue/run {days?|from?,to?, limit?} — chạy xuất ngay (tay)
router.post('/queue/run', einvoiceAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const b = req.body || {}
        let rows: any[]
        let skippedReturns: string[] = []
        if (Array.isArray(b.transactionIds) && b.transactionIds.length > 0) {
            // Xuất theo TICK CHỌN — người dùng tự chỉ định từng phiếu (kể cả phiếu
            // quá khứ). issueInvoiceForTransaction idempotent nên đã có HĐ sẽ skip.
            const ids = b.transactionIds.slice(0, 100).map((x: any) => String(x))
            rows = await prisma.transaction.findMany({
                where: { id: { in: ids } },
                select: { id: true, receiptNumber: true },
            })
            // Đơn ĐANG TRẢ HÀNG/HOÀN TIỀN bị loại kể cả khi người dùng tick chọn
            // (nhánh chạy theo lô đã lọc, nhánh này trước đây thì không → "Chọn tất
            // cả" là xuất HĐ cho cả đơn khách đang trả).
            const blocked = await prisma.$queryRawUnsafe(
                `SELECT t.id, t."receiptNumber"
                 FROM "Transaction" t
                 JOIN "OnlineOrder" o ON ('ONLINE-' || o."orderNumber") = t."receiptNumber"
                 WHERE t.id = ANY($1::text[])
                   AND (t.status = 'returned' OR ${OPEN_RETURN_EXISTS})`, ids)
            const blockedIds = new Set((blocked as any[]).map((x: any) => x.id))
            if (blockedIds.size > 0) {
                rows = rows.filter((r: any) => !blockedIds.has(r.id))
                skippedReturns = (blocked as any[]).map((x: any) => x.receiptNumber)
            }
        } else {
            // Mặc định tôn trọng mốc neo (bỏ qua HĐ quá khứ trước khi bật). Truyền
            // from/to tường minh = chủ ý backfill → cho phép vượt neo.
            const extraCfg = parseConfigExtra(await getActiveConfig(prisma))
            const anchor = extraCfg.autoIssueSince ? new Date(extraCfg.autoIssueSince) : null
            const from = b.from
                ? new Date(String(b.from) + 'T00:00:00')
                : (anchor || new Date(Date.now() - (Number(b.days) || 30) * 86400_000))
            const to = b.to ? new Date(String(b.to) + 'T23:59:59') : new Date()
            const all = await findInvoiceQueue(prisma, { from, to, limit: Math.min(Number(b.limit) || 100, 300) })
            rows = all.filter((r: any) => !r.hasReturn) // đơn hoàn không xuất theo lô
        }
        // Thông tin người mua nhập tay chỉ áp cho XUẤT LẺ 1 phiếu (không áp cho lô).
        const buyerBody = (Array.isArray(b.transactionIds) && b.transactionIds.length === 1 && b.buyer)
            ? b.buyer : {}
        let issued = 0, failed = 0
        const errors: string[] = []
        for (const r of rows) {
            try {
                const rs = await issueInvoiceForTransaction(prisma, r.id, buyerBody)
                if (rs.success && !rs.skipped) issued++
                else if (!rs.success) {
                    // THIẾU TỒN KHO THUẾ → DỪNG NGAY cả lô, báo lỗi liền (yêu cầu chủ
                    // shop 2026-07-24) — không chạy tiếp các phiếu sau kẻo lỗi bị chôn
                    // trong tổng kết cuối.
                    if (String(rs.error || '').includes('TỒN KHO THUẾ')) {
                        res.status(400).json({
                            success: false,
                            error: `DỪNG tại phiếu ${r.receiptNumber}: ${rs.error}`
                                + (issued > 0 ? ` (đã xuất được ${issued} HĐ trước khi dừng)` : ''),
                            data: { candidates: rows.length, issued, failed, stoppedAt: r.receiptNumber },
                        })
                        return
                    }
                    failed++; if (errors.length < 5) errors.push(`${r.receiptNumber}: ${rs.error}`)
                }
            } catch (e: any) {
                failed++; if (errors.length < 5) errors.push(`${r.receiptNumber}: ${e?.message || e}`)
            }
        }
        res.json({ success: true, data: { candidates: rows.length, issued, failed, errors } })
    } catch (err: any) {
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/cancel/:invoiceId (legacy cancel via provider service)
router.post('/cancel/:invoiceId', einvoiceAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ═════════════════════════════════════════════════════════════════════════════
//  Phase-3 routes
// ═════════════════════════════════════════════════════════════════════════════

// POST /api/einvoice/from-sale/:saleId — auto-create DRAFT from a Transaction
router.post('/from-sale/:saleId', einvoiceAuth, requireRole('admin', 'manager', 'cashier'), async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/einvoice — list with filters + pagination
router.get('/', einvoiceAuth, async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice — create DRAFT from transaction data
router.post('/', einvoiceAuth, requireRole('admin', 'manager', 'cashier'), async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/einvoice/:id — single invoice + items
router.get('/:id', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const inv = await getInvoiceWithItems(prisma, String(req.params.id))
        if (!inv) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })
        res.json({ success: true, data: inv })
    } catch (err: any) {
        console.error('GET /einvoice/:id error:', err)
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/einvoice/:id — update DRAFT only
router.put('/:id', einvoiceAuth, requireRole('admin', 'manager', 'cashier'), async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/einvoice/:id — delete DRAFT only
router.delete('/:id', einvoiceAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/:id/sign — sign → SIGNED, generate XML, assign number
router.post('/:id/sign', einvoiceAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/:id/send — send to tax authority via provider (STUB) → SENT
router.post('/:id/send', einvoiceAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/:id/cancel — cancel a SENT invoice (requires reason) → CANCELLED
router.post('/:id/cancel', einvoiceAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/einvoice/:id/replace — create replacement DRAFT, original → REPLACED
router.post('/:id/replace', einvoiceAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/einvoice/:id/xml — return signed XML
router.get('/:id/xml', einvoiceAuth, async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/einvoice/:id/pdf — HTML preview (or stored pdfUrl)
router.get('/:id/pdf', einvoiceAuth, async (req: AuthRequest, res: Response) => {
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
        console.error('[EInvoiceQueue route]', err?.message || err)
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
