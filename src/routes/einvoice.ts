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
import { sendNotification, sendPushToStore } from './notifications'
import type { EInvoiceProviderConfig, EInvoiceData } from '../services/einvoice'
import { moTaLoi } from '../lib/gomLoi'

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
            // Điều chỉnh ≠ thay thế: HĐ gốc vẫn hiệu lực nên KHÔNG dùng chung
            // replacedByInvoiceId (cờ đó nghĩa là "gốc đã bị vô hiệu").
            ['adjustsInvoiceId', 'TEXT'], ['adjustedByInvoiceId', 'TEXT'],
            // Mã phiếu trả đã dùng để lập bản điều chỉnh — khoá nối ĐÍCH DANH khi
            // hoàn tồn kho thuế. Một đơn sàn có thể có NHIỀU phiếu trả; nối lỏng
            // qua mã đơn sẽ cộng lại cả phiếu chưa điều chỉnh → thừa tồn thuế.
            ['adjustReturnCode', 'TEXT'],
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
        // Thông tin xuất HĐ khách yêu cầu trên phiếu — tự vá ở đây để mọi đường
        // (route + cron) chạy được ngay cả khi store chưa qua /admin/migrate.
        await prisma.$executeRawUnsafe(`ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "vatBuyerInfo" TEXT`).catch(() => {})

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
    /* KHÔNG được nuốt lỗi ở đây (20/08/2026): đếm hỏng → 0 → hàm trả "00000001", tức là cấp lại
     * một SỐ HOÁ ĐƠN ĐÃ DÙNG. Trùng số hoá đơn là sai phạm ở phía cơ quan thuế, không phải một ô
     * hiển thị lệch. Đọc không được thì dừng, đừng đoán. */
    const count = await prisma.eInvoice.count({
        where: { invoiceSymbol: symbol, invoiceNumber: { not: null } },
    })
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
// Tên khách do SÀN che ("T******g", "H*******h") KHÔNG phải tên người thật —
// đưa vào hoá đơn thuế là vô nghĩa, CQT không chấp nhận. Coi như không có tên →
// "Bán cho người tiêu dùng" (đúng nghiệp vụ khách không lấy hoá đơn).
/**
 * Mã đơn hàng để ghi kèm tên người mua trên hoá đơn bán lẻ.
 * receiptNumber đơn sàn có dạng "ONLINE-TIK-585573796595926789" — bỏ tiền tố kỹ thuật,
 * chỉ giữ mã đơn thật để tra ngược được bên sàn. Đơn bán trực tiếp (HD030373) giữ nguyên.
 * (Ghép lại từ bản đang chạy trên prod, 21/08.)
 */
export function maDonTuReceipt(receiptNumber: any): string {
    return String(receiptNumber || '')
        .trim()
        .replace(/^ONLINE-/i, '')
        .replace(/^(TIK|SPE|LZD|SHOPEE|TIKTOK|LAZADA)-/i, '')
        .trim()
}

/**
 * Tên người mua ghi lên hoá đơn THẬT.
 *
 * Khách sàn không cho tên thật: sàn che bằng dấu * ("D******n"), hoặc mình tự điền tên
 * thay thế lúc đồng bộ ("Khách TikTok"). CẢ HAI đều không phải tên người — đưa lên chứng
 * từ thuế là sai; đã ra tới 37 hoá đơn ĐÃ KÝ của KENGISTORE (15–19/08/2026) ghi
 * "Khách TikTok" trước khi phát hiện.
 *
 * Ghi kèm MÃ ĐƠN để đối chiếu ngược được đơn nào ra hoá đơn nào.
 * Có MST = khách CHỦ ĐỘNG lấy hoá đơn ⇒ giữ nguyên tên họ khai.
 */
export function tenNguoiMuaHD(name: any, taxCode: any, receiptNumber?: any): string {
    const t = String(name || '').trim()
    const mst = String(taxCode || '').trim()
    if (mst) return t || 'Bán cho người tiêu dùng'
    const voDanh = !t || t.includes('*') || /^kh[áa]ch\s/i.test(t)
    if (!voDanh) return t
    const maDon = maDonTuReceipt(receiptNumber)
    return maDon ? `Bán cho người tiêu dùng (${maDon})` : 'Bán cho người tiêu dùng'
}

function tenNguoiMua(name: any, taxCode: any): string {
    // MỘT luật duy nhất cho mọi đường — xem tenNguoiMuaHD ở trên. Ở đây không có
    // receiptNumber (chỉ render lại từ bản ghi EInvoice đã lưu), nên tên đã kèm mã đơn
    // từ lúc phát hành sẽ đi qua nguyên vẹn.
    return tenNguoiMuaHD(name, taxCode)
}

function generateInvoiceXml(inv: any, items: any[]): string {
    const symbol = inv.invoiceSymbol || ''
    // Mẫu số (KHMSHDon) là TRƯỜNG RIÊNG trong cấu hình — không được cắt ký tự đầu
    // của ký hiệu ra làm mẫu số ("C26MNH" từng bị băm thành C + 26MNH, VNPT từ
    // chối vì "C" không phải mẫu số). Chỉ khi ký hiệu bắt đầu bằng CHỮ SỐ (dạng
    // gộp "1C26MNH") mới tách; còn lại giữ nguyên ký hiệu, mẫu số đọc từ config.
    const tplRaw = String(inv._config?.templateId || inv._config?.templateCode || '').trim()
    const batDauBangSo = /^[0-9]/.test(symbol)
    // File mẫu MTT chính thức: <KHMSHDon>2</KHMSHDon> — chỉ phần TRƯỚC dấu "/"
    // của mẫu tích hợp ("2/001" → "2")
    const khmshdon = (tplRaw ? tplRaw.split('/')[0] : '') || (batDauBangSo ? symbol.slice(0, 1) : '')
    const khhdon = batDauBangSo && !tplRaw ? symbol.slice(1) : symbol
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

    // Id của DLHDon là ĐỊNH DANH DỮ LIỆU ĐỂ KÝ SỐ — phải có nghĩa với hoá đơn, không
    // phải mã bản ghi nội bộ (cuid "cms2qm88…" vừa vô nghĩa với CQT vừa không tra
    // được khi đối chiếu chữ ký). Ghép mẫu số + ký hiệu + số hoá đơn; chưa có số thì
    // dùng số phiếu bán. Tiền tố "HD-" vì Id trong XML KHÔNG được bắt đầu bằng chữ số.
    const dinhDanh = 'HD-' + String(
        (symbol && inv.invoiceNumber) ? `${symbol}-${inv.invoiceNumber}`
            : (inv.receiptNumber || inv.transactionId || inv.id)
    ).replace(/[^A-Za-z0-9._-]/g, '')

    // Khung theo ĐÚNG file XML mẫu chính thức của hệ MTT (tải từ "Xem mẫu"):
    // PBan 2.1.0, có THDon, NMua dùng HVTNMHang, dòng hàng dùng THHDVu +
    // STCKhau/TLCKhau, TToan chỉ có tổng số + bằng chữ (HĐ bán hàng MTT không
    // tách thuế). Đừng đổi tên thẻ nếu không đối chiếu lại file mẫu.
    return `<?xml version="1.0" encoding="UTF-8"?>
<HDon>
  <DLHDon Id="${escXml(dinhDanh)}">
    <TTChung>
      <DVTTe>${escXml(inv.currency || 'VND')}</DVTTe>
      <TGia>1</TGia>
      <HTTToan>${escXml(inv.paymentMethod || 'TM/CK')}</HTTToan>
      <PBan>2.1.0</PBan>
      <THDon>Hóa đơn bán hàng</THDon>
      <KHMSHDon>${escXml(khmshdon)}</KHMSHDon>
      <KHHDon>${escXml(khhdon)}</KHHDon>
      <SHDon>${escXml(inv.invoiceNumber || '0')}</SHDon>
      <NLap>${escXml(inv.invoiceDate || '')}</NLap>
    </TTChung>
    <NDHDon>
      <NBan>
        <Ten>${escXml(inv.sellerName || inv._config?.companyName || '')}</Ten>
        <MST>${escXml(inv.sellerTaxCode || inv._config?.taxCode || '')}</MST>
        <DChi>${escXml(inv.sellerAddress || inv._config?.companyAddress || '')}</DChi>
        <SDThoai>${escXml(inv._config?.sellerPhone || '')}</SDThoai>
      </NBan>
      <NMua>
        <DChi>${escXml(inv.buyerAddress || '')}</DChi>
        <HVTNMHang>${escXml(tenNguoiMua(inv.buyerName, inv.buyerTaxCode))}</HVTNMHang>
${inv.buyerIdNo ? `        <CCCDan>${escXml(inv.buyerIdNo)}</CCCDan>
` : ''}      </NMua>
      <DSHHDVu>
${items.map((it: any) => `        <HHDVu>
          <TChat>1</TChat>
          <STT>${num(it.itemNumber)}</STT>
          <THHDVu>${escXml(it.itemName)}</THHDVu>
          <DVTinh>${escXml(it.unitName || '')}</DVTinh>
          <SLuong>${Number(it.quantity) || 0}</SLuong>
          <DGia>${num(it.unitPrice)}</DGia>
          <STCKhau>0</STCKhau>
          <TLCKhau>0</TLCKhau>
          <ThTien>${num(it.amount)}</ThTien>
        </HHDVu>`).join('\n')}
      </DSHHDVu>
      <TToan>
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
    /* Không nuốt lỗi đọc ở hàm này (20/08/2026): dòng hàng rỗng sẽ kéo xuống nhánh "dựng lại từ
     * phiếu bán", nhánh đó hỏng nữa thì ra hoá đơn KHÔNG CÓ HÀNG HOÁ — mà chính ghi chú dưới đây
     * đã cảnh báo là gửi đi được. Lỗi đọc phải nổi lên, đừng để nó hoá thành "hoá đơn trống". */
    const inv = await prisma.eInvoice.findUnique({ where: { id } })
    if (!inv) return null
    let items = await prisma.eInvoiceItem.findMany({
        where: { eInvoiceId: id }, orderBy: { itemNumber: 'asc' },
    })

    // Bản ghi NHÁP / bản ghi cũ không có dòng hàng riêng → dựng từ phiếu bán.
    // Thiếu bước này thì XML ra <DSHHDVu> RỖNG dù màn chi tiết vẫn hiện hàng —
    // gửi đi là hoá đơn không có hàng hoá.
    if (items.length === 0 && inv.transactionId) {
        const tx = await prisma.transaction.findUnique({
            where: { id: inv.transactionId },
            include: { items: { include: { product: true } } },
        })
        const txItems = tx?.items || []
        const lineAmt = (i: any) => Math.round(
            Number(i.lineTotal) > 0 ? Number(i.lineTotal) : (i.quantity || 1) * (i.unitPrice ?? 0))
        const tong = txItems.reduce((a: number, i: any) => a + lineAmt(i), 0)
        const thue = Number(tx?.tax) || 0
        items = txItems.map((i: any, idx: number) => {
            const amount = lineAmt(i)
            return {
                itemNumber: idx + 1,
                itemName: i.product?.name || i.productName || 'Sản phẩm',
                unitName: i.product?.invoiceUnit || i.product?.baseUnit || 'Cái',
                quantity: i.quantity || 1,
                unitPrice: (i.quantity || 1) > 0 ? Math.round(amount / (i.quantity || 1)) : amount,
                vatRate: thue > 0 && tong > 0 ? Math.round(thue * 100 / tong) : 0,
                vatAmount: thue > 0 && tong > 0 ? Math.round(thue * amount / tong) : 0,
                amount,
            }
        })
    }

    // Số phiếu bán cho ĐỊNH DANH DLHDon: hoá đơn chưa có số (nháp/lỗi) thì Id
    // rơi về receiptNumber — bản ghi HĐ không lưu sẵn nên phải hỏi phiếu bán.
    /* Bản ghi EInvoice không có cột `receiptNumber` (đúng như chú thích trên), nên vế
     * `!inv.receiptNumber` LUÔN đúng — bỏ đi cho khỏi hiểu nhầm là có kiểm tra gì. */
    if (inv.transactionId) {
        const tx0 = await prisma.transaction.findUnique({
            where: { id: inv.transactionId }, select: { receiptNumber: true },
        }).catch(() => null)
        if (tx0?.receiptNumber) (inv as any).receiptNumber = tx0.receiptNumber
    }

    // Thông tin NGƯỜI BÁN: bản ghi cũ không lưu nên XML ra <NBan> rỗng cả MST.
    // Lấy từ cấu hình HĐĐT đang hoạt động làm nguồn dự phòng.
    // Luôn nạp config: cần cho người bán LẪN mẫu số (KHMSHDon) trong XML
    const _config: any = await getActiveConfig(prisma).catch(() => null)
    return { ...inv, items, _config }
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
    body: any = {},
    // Khoá SSE (storeSchema) — có là bắn sự kiện 'einvoice_issued' đẩy toast
    // realtime cho web đang mở (kênh /notifications/stream).
    sseKey?: string,
): Promise<{ success: boolean; skipped?: boolean; stockShort?: boolean; error?: string; invoiceNumber?: string; record?: any }> {
    const config = await getActiveConfig(prisma)
    if (!config) return { success: false, error: 'Chưa cấu hình NCC hóa đơn' }
    const provider = getProvider((config.provider || '').toLowerCase())
    if (!provider) return { success: false, error: `NCC ${config.provider} không hỗ trợ qua API trực tiếp` }

    /* Chốt chặn xuất trùng hóa đơn cho cùng một giao dịch.
     *
     * Danh sách cũ là ['ISSUING','issued','SENT'] — hai giá trị đầu KHÔNG có nơi
     * nào trong hệ thống ghi ra, còn 'SIGNED' thì bị thiếu. Ký xong mà bước gửi
     * lỗi là bản ghi nằm ở SIGNED; lần xuất sau không thấy nó và cấp tiếp một số
     * hóa đơn thứ hai cho cùng một giao dịch — lỗi rất khó gỡ vì hóa đơn đã lên
     * cơ quan thuế thì phải lập biên bản hủy.
     *
     * Chỉ chặn khi bản ghi ĐÃ CÓ SỐ: có số nghĩa là hóa đơn đã tồn tại thật.
     * Bản ghi dở dang chưa có số thì cho xuất lại, vì đó mới là lúc cần thử lại. */
    /* CHỐT CHỐNG TRÙNG của đường CRON (hàng đợi xuất HĐ chạy mỗi tối). Nuốt lỗi thành null ⇒
     * tưởng chưa có ⇒ xuất thêm một hoá đơn nữa cho cùng phiếu bán. Cron bọc try/catch từng phiếu
     * nên ném ở đây chỉ hoãn 1 phiếu sang lượt sau — rẻ hơn nhiều so với hoá đơn trùng (20/08/2026). */
    const existing = await prisma.eInvoice.findFirst({
        where: {
            transactionId: txId,
            status: { in: ['ISSUING', 'issued', 'SIGNED', 'SENT'] },
            invoiceNumber: { not: null },
        },
    })
    if (existing) return { success: true, skipped: true, invoiceNumber: existing.invoiceNumber, error: `Đã xuất HĐ số ${existing.invoiceNumber}` }

    const tx = await prisma.transaction.findUnique({
        where: { id: txId },
        // unitConversions: cần để quy đổi ĐVT khi hoá đơn ghi theo vỉ/thùng
        include: { items: { include: { product: { include: { unitConversions: true } } } }, customer: true },
    })
    if (!tx) return { success: false, error: 'Không tìm thấy giao dịch' }

    // BUNG COMBO TRƯỚC MỌI THỨ: hoá đơn phải ghi từng THÀNH PHẦN (mã combo là mã
    // ảo, không có chứng từ đầu vào) và chốt tồn kho thuế cũng phải kiểm theo
    // thành phần. Phiếu đồng bộ mới đã bung sẵn ở orderSync; đây là đường cứu
    // cho phiếu CŨ tạo trước khi có tính năng combo.
    const txItems = await expandComboItems(prisma, tx.items || [])

    // ĐỦ TỒN KHO THUẾ mới được xuất hoá đơn (yêu cầu chủ shop 2026-07-23): hàng
    // bán ra phải có đầu vào chứng từ (phiếu nhập) đủ số lượng — âm kho thuế là
    // rủi ro CQT. Thiếu → KHÔNG tạo bản ghi lỗi, phiếu nằm lại hàng đợi; nhập
    // chứng từ đầu vào xong xuất lại là qua. Bỏ qua chốt bằng body.ignoreTaxStock.
    if (!body.ignoreTaxStock) {
        const shortages = await taxStockShortages(prisma, txItems)
        if (shortages.length > 0) {
            const detail = shortages.slice(0, 3).map(s => `${s.sku} thiếu ${s.thieu}`).join(', ')
                + (shortages.length > 3 ? ` +${shortages.length - 3} mã khác` : '')
            // stockShort: lô xuất đếm riêng nhóm này là "chừa lại", không phải lỗi
            return { success: false, stockShort: true, error: `Thiếu TỒN KHO THUẾ (${detail}) — nhập phiếu nhập/chứng từ đầu vào đủ số lượng rồi xuất lại` }
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
    const _txItemsTotal = txItems.reduce((s: number, i: any) => s + _lineAmount(i), 0)
    const _txTax = Number(tx.tax) || 0
    const _txVatRate = _txTax > 0 && _txItemsTotal > 0
        ? Math.round(_txTax * 100 / _txItemsTotal) : 0
    // Thông tin xuất HĐ khách YÊU CẦU gắn trên phiếu (vatBuyerInfo JSON) — ưu
    // tiên sau body (gọi tay) nhưng TRƯỚC dữ liệu customer của sàn (bị che dấu).
    let _vbi: any = {}
    try { _vbi = tx.vatBuyerInfo ? JSON.parse(tx.vatBuyerInfo) : {} } catch { }
    // Tên/SĐT/địa chỉ khách đơn sàn bị che dấu * (vd "D******n") — truyền nguyên
    // lên hoá đơn THẬT là sai (đã dính HĐ số 1). Khách che + không MST = bán lẻ
    // cho người tiêu dùng; trường nào dính dấu * thì bỏ, không gửi nửa vời.
    const _rawBuyerName = bStr(body.buyerName) || bStr(_vbi.name) || tx.customer?.name || tx.customerName || ''
    const _rawBuyerTax = bStr(body.buyerTaxCode) || bStr(_vbi.taxCode) || tx.customer?.taxCode || ''
    const _masked = (s: string) => s.includes('*')
    const _clean = (s: string) => (_masked(s) ? '' : s)
    const invoiceData: EInvoiceData = {
            sellerTaxCode: config.taxCode || '',
            sellerName: config.companyName || '',
            // MỘT luật cho mọi đường (xem tenNguoiMuaHD). Bản trước ở ĐÂY chỉ chặn dấu '*',
            // nên tên tự đặt lúc đồng bộ ("Khách TikTok") lọt thẳng lên hoá đơn ĐÃ KÝ —
            // 37 hoá đơn KENGISTORE 15–19/08/2026 dính đúng chỗ này. Kèm mã đơn để truy ngược.
            buyerName: tenNguoiMuaHD(_rawBuyerName, _rawBuyerTax, tx.receiptNumber),
            buyerTaxCode: _clean(_rawBuyerTax),
            buyerAddress: _clean(bStr(body.buyerAddress) || bStr(_vbi.address) || tx.customer?.address || ''),
            buyerPhone: _clean(bStr(body.buyerPhone) || tx.customer?.phone || ''),
            buyerEmail: _clean(bStr(body.buyerEmail) || bStr(_vbi.email) || tx.customer?.email || ''),
            // CCCD người mua cho HĐ cá nhân — Shopee VN trả `national_id` (từ 28/07/2026),
            // đổ vào vatBuyerInfo.nationalId qua /shopee-buyer-info; người dùng gõ tay cũng được
            buyerIdNo: _clean(bStr(body.buyerIdNo) || bStr(_vbi.nationalId) || ''),
            templateId: config.templateId || undefined,
            serialNo: config.serialNo || undefined,
            /* `Transaction` KHÔNG có cột `paymentMethod` (cột đó thuộc OnlineOrder/EInvoice),
             * nên vế đầu luôn undefined ⇒ giá trị gửi đi VẪN LUÔN là 'TM/CK'. Giữ nguyên kết
             * quả, chỉ bỏ phần đọc cột ma cho khỏi tưởng là có lấy phương thức thật.
             * 'TM/CK' (tiền mặt/chuyển khoản) là giá trị hợp lệ theo mẫu HĐĐT. Muốn ghi đúng
             * phương thức thì phải nạp thêm quan hệ `payments` — CỐ Ý KHÔNG đổi ở đây vì đây là
             * đường phát hành hoá đơn cho cơ quan thuế. (21/08/2026) */
            paymentMethod: 'TM/CK',
            items: txItems.map((item: any) => ({
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
            // VNPT BẮT BUỘC số tiền bằng chữ (VBChu) — để trống là err_code 2.
            totalInWords: docTienBangChu(Math.round(tx.total || 0)),
            transactionId: tx.id,
            receiptNumber: tx.receiptNumber || '',
        }

    const result = await provider.issueInvoice(config as EInvoiceProviderConfig, invoiceData)
    // Dòng hàng lưu kèm bản ghi HĐ — trước đây KHÔNG tạo EInvoiceItem nên màn chi
    // tiết hiện "Không có dòng hàng". Thuế phân bổ theo tx.tax thật (đơn online
    // thường 0), KHÔNG áp 10% cứng để tổng dòng khớp tổng HĐ.
    const itemRows = txItems.map((item: any, idx: number) => {
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
        // Thông báo trong app (web + Android đọc chung GET /notifications)
        const notifTitle = `🧾 Đã xuất hoá đơn số ${result.invoiceNumber || '?'}`
        const notifMessage = `Phiếu ${tx.receiptNumber || txId} — ${invoiceData.buyerName} — ${Math.round(tx.total || 0).toLocaleString('vi-VN')}₫`
            + (invoiceData.buyerEmail ? ` (gửi email tới ${invoiceData.buyerEmail})` : '')
        await prisma.notification.create({
            data: { type: 'einvoice', title: notifTitle, message: notifMessage },
        }).catch(() => { })
        // Đẩy realtime cho web đang mở (toast qua SSE)
        if (sseKey) {
            try { sendNotification(sseKey, 'einvoice_issued', { title: notifTitle, message: notifMessage }) } catch { }
        }
        // Push FCM tức thì tới app Android (kể cả khi app đóng) — fire & forget
        sendPushToStore(prisma, notifTitle, notifMessage).catch(() => { })
        // Khách có email → nhờ VNPT gửi hoá đơn. Lỗi email KHÔNG làm hỏng phát
        // hành — chỉ ghi log + đánh dấu vào notes của bản ghi.
        const emailTo = invoiceData.buyerEmail
        if (emailTo && String(config.provider || '').toLowerCase() === 'vnpt') {
            try {
                const { VnptProvider, vnptFkey } = await import('../services/einvoice/vnpt')
                const mail = await new VnptProvider().sendInvoiceEmail(config, vnptFkey(txId), emailTo)
                await prisma.eInvoice.update({
                    where: { id: record.id },
                    data: { notes: mail.success ? `Đã gửi email HĐ tới ${emailTo}` : `Gửi email HĐ tới ${emailTo} LỖI: ${mail.errorMessage || ''}`.slice(0, 300) },
                }).catch(() => { })
                if (!mail.success) console.warn(`[einvoice] email HĐ ${result.invoiceNumber} → ${emailTo} lỗi: ${mail.errorMessage}`)
            } catch (e: any) {
                console.warn(`[einvoice] email HĐ lỗi: ${moTaLoi(e)}`)
            }
        }
    }
    return { success: result.success, error: result.errorMessage || undefined, invoiceNumber: result.invoiceNumber, record }
}

router.post('/issue/:transactionId', einvoiceAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const r = await issueInvoiceForTransaction(prisma, String(req.params.transactionId), req.body || {},
            (req as any).storeId || req.user?.branchSchema || req.user?.storeSchema)
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
         WHERE t.channel = 'online' AND t.status IN ('completed', 'partial', 'returned')
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
/**
 * BUNG COMBO thành các thành phần cho khâu xuất hoá đơn.
 *
 * Đơn ĐỒNG BỘ MỚI đã được orderSync bung sẵn, nhưng phiếu CŨ (tạo trước khi có
 * tính năng combo) vẫn giữ nguyên dòng combo — xuất thẳng thì hoá đơn ghi "Combo
 * lỗi 1+2+3" (mã ảo, không có chứng từ đầu vào) và chốt tồn kho thuế luôn báo
 * thiếu vì mã combo không bao giờ được nhập kho.
 *
 * Tiền được chia theo TRỌNG SỐ giá gốc từng thành phần, phần lẻ dồn vào dòng
 * lớn nhất để TỔNG TIỀN KHÔNG ĐỔI dù chỉ một đồng.
 */
async function expandComboItems(prisma: any, items: any[]): Promise<any[]> {
    const out: any[] = []
    for (const it of items) {
        const bundleId = it.product?.bundleId
        if (!bundleId) { out.push(it); continue }
        /* Combo phải bung thành từng mặt hàng TRÊN HOÁ ĐƠN. Nuốt lỗi đọc ⇒ comps rỗng ⇒ hoá đơn
         * ghi nguyên dòng "combo", sai mặt hàng so với thực tế giao (20/08/2026). */
        const bundle = await prisma.bundle.findUnique({ where: { id: String(bundleId) } })
        let comps: any[] = []
        try { comps = JSON.parse(bundle?.items || '[]') } catch { comps = [] }
        const resolved: { p: any; qty: number; weight: number }[] = []
        for (const c of comps) {
            const cp = c.productId
                ? await prisma.product.findUnique({
                    where: { id: c.productId },
                    include: { unitConversions: true },
                }).catch(() => null)
                : (c.sku ? await prisma.product.findFirst({
                    where: { sku: c.sku },
                    include: { unitConversions: true },
                }).catch(() => null) : null)
            if (!cp) continue
            const qty = (Number(c.quantity) || 1) * (Number(it.quantity) || 1)
            resolved.push({ p: cp, qty, weight: (Number(c.originalPrice) || cp.sellingPrice || 1) * (Number(c.quantity) || 1) })
        }
        // Không bung được (combo chưa định nghĩa/thiếu thành phần) → giữ nguyên
        // dòng cũ, KHÔNG được im lặng làm mất dòng hàng.
        if (resolved.length === 0) { out.push(it); continue }

        const total = Math.round(Number(it.lineTotal) > 0
            ? Number(it.lineTotal)
            : (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0))
        const sumW = resolved.reduce((a, r) => a + r.weight, 0) || 1
        const parts = resolved.map(r => Math.round(total * r.weight / sumW))
        const diff = total - parts.reduce((a, n) => a + n, 0)
        if (diff !== 0) {
            let bi = 0
            parts.forEach((v, i) => { if ((v || 0) > (parts[bi] || 0)) bi = i })
            parts[bi] = (parts[bi] || 0) + diff
        }
        resolved.forEach((r, i) => {
            const lt = parts[i] || 0
            out.push({
                ...it,
                productId: r.p.id,
                productName: r.p.name,
                sku: r.p.sku,
                quantity: r.qty,
                baseQuantity: r.qty,
                unitPrice: r.qty > 0 ? lt / r.qty : lt,
                lineTotal: lt,
                discount: 0,
                product: r.p, // để _invUnit đọc invoiceUnit/unitConversions của thành phần
                _tuCombo: it.product?.name || it.productName,
            })
        })
    }
    return out
}

/**
 * HÀNG TRẢ LẠI ĐÃ ĐIỀU CHỈNH HOÁ ĐƠN → CỘNG LẠI TỒN KHO THUẾ.
 * Bán 1 cái + xuất HĐ = trừ 1 khỏi tồn thuế. Khách trả cái đó về, mình đã lập
 * HĐ điều chỉnh giảm (hoặc thay thế) gửi thuế → doanh thu đã hoàn, nên phần
 * hàng ấy phải quay lại tồn kho thuế; không cộng lại thì mã đó "hết tồn thuế"
 * oan và lần bán sau bị chặn xuất hoá đơn.
 * CHỈ cộng khi ĐÃ có hoá đơn điều chỉnh/thay thế phát hành — trả hàng suông mà
 * chưa điều chỉnh HĐ thì thuế vẫn ghi nhận doanh thu, chưa được cộng.
 * ($1 = mảng SKU chữ thường; bỏ điều kiện đó khi quét toàn bộ.)
 */
/* ĐÃ THAY BẰNG CÁCH ĐỌC THẲNG DÒNG HÀNG TRÊN HOÁ ĐƠN ĐIỀU CHỈNH (bên dưới).
   Giữ lại để đối chiếu lịch sử: bản cũ đi từ ReturnItem rồi phải dò ngược ra
   hoá đơn điều chỉnh qua notes — mà notes do người lập gõ tay, hai hoá đơn thực
   tế đã bị cắt mất mã phiếu nên cộng hụt (đo 06/08/2026: 1/3 mã được cộng).
const TRA_LAI_CU = `
    SELECT LOWER(TRIM(COALESCE(
               NULLIF(TRIM(pm.sku), ''),
               NULLIF(TRIM(p.sku), ''),
               NULLIF(TRIM(ti.sku), ''),
               ri.sku
           ))) AS k,
           -- QUY VỀ ĐƠN VỊ GỐC: nhánh bán trừ theo baseQuantity (1 vỉ = 10 cái),
           -- nên trả lại cũng phải nhân đúng tỉ lệ đó, không thì mỗi lần trả hàng
           -- đóng gói là tồn kho thuế hụt phần lẻ và mã đó bị chặn xuất HĐ oan.
           COALESCE(SUM(ri.quantity * CASE
               WHEN ti.quantity IS NOT NULL AND ti.quantity > 0
                   THEN COALESCE(NULLIF(ti."baseQuantity", 0), ti.quantity)::float8 / ti.quantity
               ELSE 1 END), 0)::float8 AS q,
           MIN(ri."productName") AS any_name
    FROM "ReturnItem" ri
    JOIN "ReturnOrder" ro ON ro.id = ri."returnOrderId"
    LEFT JOIN "Product" p ON p.id = ri."productId"
    LEFT JOIN "Product" pm ON pm.id = p."mergedIntoId"
    -- Dòng bán tương ứng trên HĐ GỐC: lấy tỉ lệ quy đổi + mã kho chuẩn.
    -- LATERAL + LIMIT 1 để KHÔNG nhân bản dòng trả khi khớp nhiều dòng bán.
    LEFT JOIN LATERAL (
        SELECT ti2.sku, ti2.quantity, ti2."baseQuantity"
        FROM "TransactionItem" ti2
        JOIN "EInvoice" g2 ON g2."transactionId" = ti2."transactionId"
        JOIN "EInvoice" a2 ON a2."adjustsInvoiceId" = g2.id
             AND a2.status IN ('issued','SENT')
             AND (a2."adjustReturnCode" = ro.code
                  OR (a2."adjustReturnCode" IS NULL AND a2.notes LIKE '%' || ro.code || '%'))
        WHERE (ti2."productId" IS NOT NULL AND ti2."productId" = ri."productId")
           OR LOWER(TRIM(ti2.sku)) = LOWER(TRIM(COALESCE(p.sku, ri.sku, '')))
        LIMIT 1
    ) ti ON TRUE
    WHERE ro.status IN ('approved','refunded','exchanged','processing','completed')
      -- Còn mã nào dùng được là tính (mã kho / mã dòng bán / mã trên phiếu)
      AND NULLIF(TRIM(COALESCE(pm.sku, p.sku, ti.sku, ri.sku, '')), '') IS NOT NULL
      AND EXISTS (
          -- Nối ĐÍCH DANH phiếu trả ↔ bản điều chỉnh đã phát hành.
          -- KHÔNG nối qua mã đơn sàn: một đơn có thể có nhiều phiếu trả, nối lỏng
          -- sẽ cộng lại cả phiếu CHƯA điều chỉnh hoá đơn → thừa tồn kho thuế
          -- (đã dính: mã SHD1364 cộng nhầm phiếu RTN-SH-26072108EHX2B9D).
          --   • HĐ mới: cột adjustReturnCode lưu thẳng mã phiếu.
          --   • HĐ cũ (trước 06/08/2026): dò mã phiếu trong notes — chuỗi mặc định
          --     là "…Khách trả hàng/hoàn tiền — phiếu RTN-…".
          SELECT 1 FROM "EInvoice" adj
          WHERE adj.status IN ('issued','SENT')
            AND adj."adjustsInvoiceId" IS NOT NULL
            AND (
                adj."adjustReturnCode" = ro.code
                OR (adj."adjustReturnCode" IS NULL AND adj.notes LIKE '%' || ro.code || '%')
            )
      )`
*/

// ═══════════════════════════════════════════════════════════════════════════════
//  HOÀN TỒN KHO THUẾ = ĐỌC THẲNG DÒNG HÀNG TRÊN HOÁ ĐƠN ĐIỀU CHỈNH
//  Đây là nguồn sự thật duy nhất: hoá đơn điều chỉnh giảm đã ghi rõ MẶT HÀNG và
//  SỐ LƯỢNG được giảm trừ, và nó là thứ đã gửi cơ quan thuế. Không phải dò phiếu
//  trả, không phụ thuộc notes người lập gõ tay, không phụ thuộc transactionId của
//  phiếu trả (đơn sàn luôn null) — ba thứ từng làm cộng hụt/cộng nhầm.
//  Quy đổi về ĐƠN VỊ GỐC bằng tỉ lệ của dòng bán tương ứng trên HĐ gốc
//  (baseQuantity/quantity), vì nhánh "đã bán" trừ theo đơn vị gốc.
// ═══════════════════════════════════════════════════════════════════════════════
const TRA_LAI_SELECT = `
    SELECT LOWER(TRIM(COALESCE(NULLIF(TRIM(ti.sku), ''), NULLIF(TRIM(p.sku), ''), ''))) AS k,
           COALESCE(SUM(ABS(ai.quantity) * CASE
               WHEN ti.quantity IS NOT NULL AND ti.quantity > 0
                   THEN COALESCE(NULLIF(ti."baseQuantity", 0), ti.quantity)::float8 / ti.quantity
               ELSE 1 END), 0)::float8 AS q,
           MIN(ai."itemName") AS any_name
    FROM "EInvoice" adj
    JOIN "EInvoiceItem" ai ON ai."eInvoiceId" = adj.id
    JOIN "EInvoice" goc ON goc.id = adj."adjustsInvoiceId"
    -- Dòng bán tương ứng trên HĐ gốc: khớp theo TÊN HÀNG (dòng điều chỉnh được
    -- dựng từ chính tên trên HĐ gốc) để lấy mã kho + tỉ lệ quy đổi đơn vị
    LEFT JOIN LATERAL (
        SELECT ti2.sku, ti2.quantity, ti2."baseQuantity", ti2."productId"
        FROM "TransactionItem" ti2
        WHERE ti2."transactionId" = goc."transactionId"
          AND LOWER(TRIM(ti2."productName")) = LOWER(TRIM(ai."itemName"))
        LIMIT 1
    ) ti ON TRUE
    LEFT JOIN "Product" p ON p.id = ti."productId"
    WHERE adj."invoiceType" = 'ADJUSTMENT'
      AND adj.status IN ('issued','SENT')
      AND adj."adjustsInvoiceId" IS NOT NULL
      AND NULLIF(TRIM(COALESCE(ti.sku, p.sku, '')), '') IS NOT NULL`

const TRA_LAI_SQL = `${TRA_LAI_SELECT}
      AND LOWER(TRIM(COALESCE(NULLIF(TRIM(ti.sku),''), NULLIF(TRIM(p.sku),''), ''))) = ANY($1::text[])
    GROUP BY 1`

async function taxStockShortages(
    prisma: any,
    items: { sku?: string | null; productName?: string | null; quantity?: number | null }[]
): Promise<{ sku: string; name: string; thieu: number }[]> {
    const skus = [...new Set(items.map(i => String(i.sku || '').trim().toLowerCase()).filter(Boolean))]
    if (skus.length === 0) return []
    const [inRows, outRows, backRows] = await Promise.all([
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
        prisma.$queryRawUnsafe(TRA_LAI_SQL, skus),
    ])
    const imp: Record<string, number> = Object.fromEntries((inRows as any[]).map((r: any) => [r.k, Number(r.q)]))
    const out: Record<string, number> = Object.fromEntries((outRows as any[]).map((r: any) => [r.k, Number(r.q)]))
    const back: Record<string, number> = Object.fromEntries((backRows as any[]).map((r: any) => [r.k, Number(r.q)]))
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
        // tồn kho thuế khả dụng = nhập có HĐ VAT − đã bán (đã xuất HĐ) + trả lại (đã điều chỉnh HĐ)
        const conLai = (imp[k] || 0) - (out[k] || 0) + (back[k] || 0)
        if (conLai < n.qty) shortages.push({ sku: n.sku, name: n.name, thieu: n.qty - conLai })
    }
    return shortages
}

// GET /einvoice/tax-stock-debug?sku=… — MỔ XẺ tồn kho thuế của MỘT mã: từng
// thành phần nhập/xuất/trả và LÝ DO một phiếu trả không được cộng lại (thiếu
// transactionId, sku rỗng, chưa có HĐ điều chỉnh…). Chỉ đọc.
router.get('/tax-stock-debug', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const sku = String(req.query.sku || '').trim().toLowerCase()
        if (!sku) return res.status(400).json({ success: false, error: 'Thiếu sku' })

        const [nhap, xuat, tra, phieuTra] = await Promise.all([
            prisma.$queryRawUnsafe(
                `SELECT COALESCE(SUM(ii.quantity - COALESCE(ii."returnedQuantity",0)),0)::float8 AS q
                 FROM "ImportReceiptItem" ii JOIN "ImportReceipt" r ON r.id = ii."receiptId"
                 WHERE r."hasVatInvoice" = true AND r.status = 'completed'
                   AND LOWER(TRIM(ii."productSku")) = $1`, sku),
            prisma.$queryRawUnsafe(
                `SELECT COALESCE(SUM(COALESCE(NULLIF(ti."baseQuantity",0), ti.quantity)),0)::float8 AS q
                 FROM "TransactionItem" ti JOIN "Transaction" t ON t.id = ti."transactionId"
                 WHERE t.status IN ('completed','partial','returned')
                   AND EXISTS (SELECT 1 FROM "EInvoice" e WHERE e."transactionId" = t.id AND e.status IN ('issued','SENT'))
                   AND LOWER(TRIM(ti.sku)) = $1`, sku),
            // Dùng chung TRA_LAI_SQL (đã lọc theo mã đã phân giải) — trước đây tự
            // viết filter theo ri.sku, mà nguồn dữ liệu giờ là dòng hoá đơn điều
            // chỉnh chứ không còn bảng ReturnItem → SQL nổ 500.
            prisma.$queryRawUnsafe(TRA_LAI_SQL, [sku]),
            // MỌI dòng trả của mã này + vì sao được/không được cộng
            prisma.$queryRawUnsafe(
                `SELECT ro.code, ro.status, ro."transactionId", ri.sku, ri.quantity,
                        EXISTS (
                            SELECT 1 FROM "EInvoice" adj
                            WHERE adj.status IN ('issued','SENT') AND adj."adjustsInvoiceId" IS NOT NULL
                              AND (adj."adjustReturnCode" = ro.code
                                   OR (adj."adjustReturnCode" IS NULL AND adj.notes LIKE '%' || ro.code || '%'))
                        ) AS "coHDDieuChinh",
                        EXISTS (
                            SELECT 1 FROM "EInvoice" e
                            JOIN "Transaction" t2 ON t2.id = e."transactionId"
                            LEFT JOIN "OnlineOrder" o2 ON ('ONLINE-' || o2."orderNumber") = t2."receiptNumber"
                            WHERE e.status IN ('issued','SENT')
                              AND ((ro."transactionId" IS NOT NULL AND ro."transactionId" = e."transactionId")
                                   OR (o2."orderNumber" IS NOT NULL AND (ro."originalInvoice" = o2."orderNumber" OR o2."orderNumber" LIKE '%-' || ro."originalInvoice")))
                        ) AS "gocDaXuatHD"
                 FROM "ReturnItem" ri JOIN "ReturnOrder" ro ON ro.id = ri."returnOrderId"
                 WHERE LOWER(TRIM(ri.sku)) = $1 OR LOWER(TRIM(COALESCE(ri."productName",''))) LIKE '%' || $1 || '%'
                 ORDER BY ro."createdAt" DESC LIMIT 20`, sku),
        ])
        res.json({
            success: true,
            data: {
                sku,
                nhapVat: Number((nhap as any[])[0]?.q || 0),
                daXuat: Number((xuat as any[])[0]?.q || 0),
                traLai: Number((tra as any[])[0]?.q || 0),
                ton: Number((nhap as any[])[0]?.q || 0) - Number((xuat as any[])[0]?.q || 0) + Number((tra as any[])[0]?.q || 0),
                /* Bốn con số trần trụi rất dễ đọc nhầm — chính tôi đã đọc nhầm
                 * `daXuat` thành "tổng đã bán" rồi kết luận nhầm là dữ liệu lệch
                 * mã (16/08/2026). Nói thẳng ý nghĩa ngay trong câu trả lời. */
                ghiChu: {
                    congThuc: 'ton = nhapVat − daXuat + traLai',
                    nhapVat: 'Số đã nhập, CHỈ tính phiếu nhập có hoá đơn GTGT (hasVatInvoice) và đã hoàn thành',
                    daXuat: 'CHỈ tính hàng ĐÃ XUẤT HOÁ ĐƠN (EInvoice issued/SENT) — KHÔNG phải mọi hàng đã bán',
                    traLai: 'Hàng trả đã lập hoá đơn điều chỉnh (được cộng lại vào tồn)',
                    canhBao: 'nhapVat=0 và daXuat=0 nghĩa là chưa có chứng từ VAT và chưa xuất HĐ nào cho mã này — KHÔNG phải dấu hiệu lệch mã',
                },
                dongTraLien: phieuTra,
            },
        })
    } catch (err: any) {
        console.error('[tax-stock-debug]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

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
        // Gộp 3 nguồn bằng UNION ALL (thay FULL OUTER JOIN 2 nhánh): nhập có HĐ
        // VAT (+), đã bán & đã xuất HĐ (−), HÀNG TRẢ LẠI đã điều chỉnh HĐ (+).
        // Thiếu nhánh trả lại thì mã từng bị trả hàng sẽ báo hết tồn thuế oan và
        // chặn xuất hoá đơn lần bán sau.
        const rows = await prisma.$queryRawUnsafe(`
            SELECT x.sku, COALESCE(p.name, x.any_name, '') AS name,
                   x.nhap::float8 AS "nhapVat", x.xuat::float8 AS xuat,
                   x.tra::float8 AS "traLai",
                   (x.nhap - x.xuat + x.tra)::float8 AS ton
            FROM (
                SELECT sku,
                       SUM(nhap) AS nhap, SUM(xuat) AS xuat, SUM(tra) AS tra,
                       MIN(any_name) AS any_name
                FROM (
                    SELECT LOWER(TRIM(ii."productSku")) AS sku,
                           SUM(ii.quantity - COALESCE(ii."returnedQuantity",0)) AS nhap,
                           0 AS xuat, 0 AS tra, MIN(ii."productName") AS any_name
                    FROM "ImportReceiptItem" ii JOIN "ImportReceipt" r ON r.id = ii."receiptId"
                    WHERE r."hasVatInvoice" = true AND r.status = 'completed'
                      AND NULLIF(TRIM(ii."productSku"),'') IS NOT NULL
                    GROUP BY 1

                    UNION ALL
                    -- CHỈ trừ phần ĐÃ XUẤT HOÁ ĐƠN (khớp công thức chặn — bán chưa
                    -- xuất HĐ thì chưa trừ tồn kho thuế)
                    SELECT LOWER(TRIM(ti.sku)) AS sku, 0 AS nhap,
                           SUM(COALESCE(NULLIF(ti."baseQuantity",0), ti.quantity)) AS xuat,
                           0 AS tra, MIN(ti."productName") AS any_name
                    FROM "TransactionItem" ti JOIN "Transaction" t ON t.id = ti."transactionId"
                    WHERE t.status IN ('completed','partial','returned')
                      AND EXISTS (SELECT 1 FROM "EInvoice" e WHERE e."transactionId" = t.id AND e.status IN ('issued','SENT'))
                      AND NULLIF(TRIM(ti.sku),'') IS NOT NULL
                    GROUP BY 1

                    UNION ALL
                    -- HÀNG TRẢ LẠI đã lập HĐ điều chỉnh/thay thế → hoàn tồn kho thuế
                    SELECT k AS sku, 0 AS nhap, 0 AS xuat, q AS tra, any_name
                    FROM ( ${TRA_LAI_SELECT} GROUP BY 1 ) tl
                ) u
                GROUP BY sku
            ) x
            LEFT JOIN "Product" p ON LOWER(TRIM(p.sku)) = x.sku
            ${qFilter}
            ORDER BY (x.nhap - x.xuat + x.tra) ASC, x.xuat DESC
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
            ),
            -- HÀNG TRẢ LẠI đã lập HĐ điều chỉnh/thay thế → cộng lại tồn kho thuế
            -- (phải khớp công thức của /tax-stock và hàm chặn xuất HĐ)
            back AS ( ${TRA_LAI_SELECT} GROUP BY 1 )
            SELECT n.k AS sku, COALESCE(p.name, n.any_name, '') AS name,
                   n.q AS "canXuat", n.orders,
                   COALESCE(i.q,0) AS "nhapVat", COALESCE(s.q,0) AS "daXuat",
                   COALESCE(b.q,0) AS "traLai",
                   (COALESCE(i.q,0) - COALESCE(s.q,0) + COALESCE(b.q,0)) AS ton,
                   (n.q - (COALESCE(i.q,0) - COALESCE(s.q,0) + COALESCE(b.q,0))) AS thieu,
                   COALESCE(p."costPrice",0)::float8 AS "costPrice",
                   COALESCE(p.stock,0)::int AS "tonThuc"
            FROM need n
            LEFT JOIN imp i ON i.k = n.k
            LEFT JOIN sold s ON s.k = n.k
            LEFT JOIN back b ON b.k = n.k
            LEFT JOIN "Product" p ON LOWER(TRIM(p.sku)) = n.k
            ${onlyShort ? 'WHERE (n.q - (COALESCE(i.q,0) - COALESCE(s.q,0) + COALESCE(b.q,0))) > 0' : ''}
            ORDER BY (n.q - (COALESCE(i.q,0) - COALESCE(s.q,0) + COALESCE(b.q,0))) DESC, n.q DESC
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

            /**
             * NẠP TRƯỚC combo + mã đích THEO LÔ — trước đây vòng lặp dưới gọi
             * findUnique CHO TỪNG DÒNG, mỗi lượt một vòng đi-về DB. Pool của
             * mỗi cửa hàng chỉ có 1 kết nối (PRISMA_POOL_SIZE=1) nên chúng xếp
             * hàng tuần tự: 117 mã ≈ 5s, cửa hàng nhiều mã ≈ 90–100s. Suốt thời
             * gian đó MỌI request khác của cửa hàng đó phải chờ, tới 30s là
             * pool_timeout → 500 hàng loạt (đo 18/08/2026: tab Tồn kho thuế và
             * Đối chiếu cần nhập cùng chết). Gom lại còn ĐÚNG 2 truy vấn.
             */
            const bundleIds = [...new Set((prods as any[]).map((p: any) => p.bundleId).filter(Boolean))]
            const mergedIds = [...new Set((prods as any[]).map((p: any) => p.mergedIntoId).filter(Boolean))]
            const [bundleRows, mergedRows] = await Promise.all([
                bundleIds.length
                    ? prisma.bundle.findMany({ where: { id: { in: bundleIds } } }).catch(() => [])
                    : Promise.resolve([]),
                mergedIds.length
                    ? prisma.product.findMany({ where: { id: { in: mergedIds } }, select: { id: true, sku: true, name: true } }).catch(() => [])
                    : Promise.resolve([]),
            ])
            const bundleById = new Map((bundleRows as any[]).map((b: any) => [b.id, b]))
            const mergedById = new Map((mergedRows as any[]).map((p: any) => [p.id, p]))

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
                    const b = bundleById.get(m.bundleId) || null
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
                    const tgt: any = mergedById.get(m.mergedIntoId) || null
                    if (tgt?.sku) { addNeed(tgt.sku, Number(r.canXuat) * (Number(m.mergedRate) || 1), r.orders, tgt.name); continue }
                }
                addNeed(String(r.sku), Number(r.canXuat), r.orders, r.name)
            }

            // tính lại tồn kho thuế cho ĐÚNG tập mã hiệu lực
            const keys = [...need.keys()]
            const stockRows = keys.length ? await prisma.$queryRawUnsafe(`
                SELECT k, COALESCE(i.q,0) - COALESCE(s.q,0) + COALESCE(b.q,0) AS ton,
                       COALESCE(i.q,0) AS nhap, COALESCE(s.q,0) AS xuat, COALESCE(b.q,0) AS tra,
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
                LEFT JOIN (
                    -- hàng trả lại đã điều chỉnh HĐ → hoàn tồn kho thuế
                    SELECT k AS kk, q FROM ( ${TRA_LAI_SELECT} GROUP BY 1 ) tl
                ) b ON b.kk = k
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
                    traLai: Number(st.tra) || 0,
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
                ${HAS_RETURN_EXPR} AS "hasReturn",
                (t."vatBuyerInfo" IS NOT NULL) AS "hasBuyerInfo"
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
    // TUẦN TỰ, không Promise.all: mỗi truy vấn ôm 1 kết nối, chạy song song là
    // MỘT lần tải trang ngốn 3-4 kết nối — pool per-store nhỏ, đụng cron dọn dẹp
    // là cạn pool → 500 (đã sập thật 29/07). Tuần tự chỉ chậm thêm ~200ms.
    const totals = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(t.total),0)::float8 AS amount,
                COUNT(*) FILTER (WHERE ${HAS_RETURN_EXPR})::int AS returns
         ${QUEUE_FROM}${platFilter}`, ...params)
    // LƯU Ý: query này không dùng $4 — truyền thừa tham số là Postgres từ chối
    const byPlatform = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(o.platform,'?') AS platform, COUNT(*)::int AS n, COALESCE(SUM(t.total),0)::float8 AS amount
         ${QUEUE_FROM} GROUP BY 1 ORDER BY 2 DESC`, DELIVERED_STATUSES, from, to)
    const byDay = await prisma.$queryRawUnsafe(
        `SELECT to_char((COALESCE(o."deliveredAt", o."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS n, COALESCE(SUM(t.total),0)::float8 AS amount,
                COUNT(*) FILTER (WHERE ${HAS_RETURN_EXPR})::int AS returns
         ${QUEUE_FROM}${platFilter} GROUP BY 1 ORDER BY 1 DESC`, ...params)
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
        // Tuần tự (xem ghi chú trong invoiceQueueStats): giảm số kết nối một trang
        // ngốn từ ~4 xuống 1
        const rows = await findInvoiceQueue(prisma, { from, to, limit: pageSize, offset: (page - 1) * pageSize, day, platform })
        const stats = await invoiceQueueStats(prisma, from, to, platform, day)
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
            // bundleId + unitConversions: cần để BUNG COMBO đúng như lúc xuất HĐ
            include: { items: { include: { product: { include: { unitConversions: true } } } }, customer: true },
        })
        if (!tx) { res.status(404).json({ success: false, error: 'Không tìm thấy phiếu' }); return }
        // Xem trước phải khớp HOÁ ĐƠN THẬT: bung combo rồi mới kiểm tồn kho thuế
        // và liệt kê dòng hàng, nếu không drawer báo "thiếu CB3L" (mã combo ảo)
        // trong khi thực tế cần kiểm các thành phần.
        const items = await expandComboItems(prisma, tx.items || [])
        const warnings: string[] = []
        if (!tx.customer?.taxCode) warnings.push('Người mua chưa có MÃ SỐ THUẾ — hoá đơn sẽ xuất dạng khách lẻ (không khấu trừ được)')
        if (!tx.customer?.address && !tx.customerPhone) warnings.push('Thiếu địa chỉ & SĐT người mua')
        else if (!tx.customer?.address) warnings.push('Thiếu địa chỉ người mua')
        // Đủ tồn kho thuế mới xuất được HĐ — báo trước ngay trong drawer
        try {
            const shortages = await taxStockShortages(prisma, items)
            for (const s of shortages.slice(0, 5)) {
                warnings.push(`THIẾU TỒN KHO THUẾ: ${s.sku} thiếu ${s.thieu} — nhập chứng từ đầu vào trước, nếu không sẽ KHÔNG xuất được HĐ`)
            }
        } catch { /* bảng chưa có ở schema cũ — bỏ qua cảnh báo */ }
        let vbi: any = null
        try { vbi = tx.vatBuyerInfo ? JSON.parse(tx.vatBuyerInfo) : null } catch { }
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
                vatBuyerInfo: vbi, // {name,taxCode,address,email} khách yêu cầu HĐ
                vatStatus: tx.vatStatus, vatInvoiceNumber: tx.vatInvoiceNumber,
                items: items.map((i: any) => ({
                    name: i.product?.name || i.productName, sku: i.sku,
                    unit: i.product?.baseUnit || 'cái',
                    quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal,
                    tuCombo: i._tuCombo || null, // hiện "(từ combo X)" cho dễ hiểu
                })),
                warnings,
            },
        })
    } catch (err: any) {
        console.error('[EInvoiceQueue route]', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /einvoice/queue/receipt/:txId/buyer — gắn thông tin xuất HĐ khách yêu cầu
// (MST/tên/địa chỉ/email). Có thông tin này thì cron 20:30 TỰ XUẤT khi đơn giao
// xong (kể cả khi auto toàn cục tắt) + tự gửi email hoá đơn cho khách.
// Gửi body toàn trường rỗng = gỡ yêu cầu.
router.put('/queue/receipt/:txId/buyer', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const txId = String(req.params.txId)
        const b = req.body || {}
        const s = (v: any) => (v === undefined || v === null ? '' : String(v).trim())
        // nationalId: CCCD người mua cho HĐ cá nhân (Shopee national_id hoặc gõ tay)
        const info = { name: s(b.name), taxCode: s(b.taxCode), address: s(b.address), email: s(b.email), nationalId: s(b.nationalId) }
        if (info.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email)) {
            res.status(400).json({ success: false, error: 'Email không hợp lệ' }); return
        }
        const has = info.name || info.taxCode || info.address || info.email || info.nationalId
        const tx = await prisma.transaction.update({
            where: { id: txId },
            data: { vatBuyerInfo: has ? JSON.stringify(info) : null },
            select: { id: true, vatBuyerInfo: true },
        })
        res.json({ success: true, data: { id: tx.id, vatBuyerInfo: has ? info : null } })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// ─── Thông tin xuất HĐ theo MÃ ĐƠN SÀN ──────────────────────────────────────
// Khách nhắn xin hoá đơn thì nhân viên đang đứng ở trang ĐƠN HÀNG ONLINE, tay
// cầm mã đơn — không phải tab hàng đợi xuất HĐ với txId. Cho đọc/ghi thẳng theo
// orderNumber; Transaction của đơn sàn có receiptNumber = 'ONLINE-' + orderNumber.
router.get('/buyer/by-order/:orderNumber', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const tx = await timTxTheoMaDon(prisma, String(req.params.orderNumber))
        if (!tx) {
            res.status(404).json({ success: false, error: 'Đơn chưa có phiếu bán trong hệ thống (chưa đồng bộ xong)' })
            return
        }
        let info: any = null
        try { info = tx.vatBuyerInfo ? JSON.parse(tx.vatBuyerInfo) : null } catch { }
        // Đã có hoá đơn phát hành chưa — có rồi thì thông tin mới chỉ dùng được
        // cho hoá đơn THAY THẾ, phải nói rõ để nhân viên khỏi chờ auto vô ích.
        const issued = await prisma.eInvoice.findFirst({
            where: { transactionId: tx.id, status: { in: ['ISSUING', 'issued', 'SIGNED', 'SENT'] } },
            select: { id: true, invoiceNumber: true, invoiceSymbol: true, status: true },
            orderBy: { createdAt: 'desc' },
        }).catch(() => null)
        res.json({
            success: true,
            data: { txId: tx.id, receiptNumber: tx.receiptNumber, total: tx.total, vatBuyerInfo: info, issuedInvoice: issued },
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// Cùng luật ghi với PUT /queue/receipt/:txId/buyer (email hợp lệ, toàn trường
// rỗng = gỡ yêu cầu) — chỉ khác cách tìm phiếu.
router.put('/buyer/by-order/:orderNumber', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const tx = await timTxTheoMaDon(prisma, String(req.params.orderNumber))
        if (!tx) {
            res.status(404).json({ success: false, error: 'Đơn chưa có phiếu bán trong hệ thống (chưa đồng bộ xong)' })
            return
        }
        const b = req.body || {}
        const sv = (v: any) => (v === undefined || v === null ? '' : String(v).trim())
        const info = { name: sv(b.name), taxCode: sv(b.taxCode), address: sv(b.address), email: sv(b.email), nationalId: sv(b.nationalId) }
        if (info.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email)) {
            res.status(400).json({ success: false, error: 'Email không hợp lệ' })
            return
        }
        if (info.nationalId && !/^\d{9,12}$/.test(info.nationalId)) {
            res.status(400).json({ success: false, error: 'CCCD phải là 9–12 chữ số' })
            return
        }
        const has = info.name || info.taxCode || info.address || info.email || info.nationalId
        const saved = await prisma.transaction.update({
            where: { id: tx.id },
            data: { vatBuyerInfo: has ? JSON.stringify(info) : null },
            select: { id: true, vatBuyerInfo: true },
        })
        res.json({ success: true, data: { txId: saved.id, vatBuyerInfo: has ? info : null } })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /einvoice/needs-adjust — HOÁ ĐƠN ĐÃ PHÁT HÀNH nhưng đơn phát sinh TRẢ
// HÀNG / HOÀN TIỀN → phải lập hoá đơn ĐIỀU CHỈNH (trả một phần) hoặc THAY THẾ /
// huỷ (trả toàn bộ). Chưa xử lý = còn rủi ro kê khai thừa doanh thu với CQT.
// Bỏ qua hoá đơn đã được thay thế rồi (replacedByInvoiceId) hoặc đã đánh dấu xử lý.
router.get('/needs-adjust', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const rows = await prisma.$queryRawUnsafe(`
            SELECT e.id, e."invoiceNumber", e."invoiceSymbol", e."invoiceDate", e.status,
                   e."totalAmount", e."buyerName", e."transactionId", e."replacedByInvoiceId",
                   e.notes, e."createdAt" AS "issuedAt",
                   t."receiptNumber", t.total AS "txTotal", t.status AS "txStatus",
                   o.status AS "orderStatus", o.platform,
                   ro.code AS "returnCode", ro.status AS "returnStatus",
                   ro."refundAmount", ro."createdAt" AS "returnDate",
                   (SELECT COUNT(*)::int FROM "ReturnItem" ri WHERE ri."returnOrderId" = ro.id) AS "returnItemCount"
            FROM "EInvoice" e
            JOIN "Transaction" t ON t.id = e."transactionId"
            LEFT JOIN "OnlineOrder" o ON ('ONLINE-' || o."orderNumber") = t."receiptNumber"
            -- Nối chịu cả 2 dạng originalInvoice: 'TIK-5852…' (tìm được đơn lúc
            -- sync) LẪN '5852…' thô (không tìm được → lưu orderSn trần). Nếu chỉ
            -- nối dạng có prefix thì 11 phiếu trả mồ côi thành ĐIỂM MÙ.
            JOIN "ReturnOrder" ro ON (
                    ro."originalInvoice" = o."orderNumber"
                 OR o."orderNumber" LIKE '%-' || ro."originalInvoice"
            )
            WHERE e.status IN ('SENT','issued','SIGNED')
              AND e."replacedByInvoiceId" IS NULL
              AND e."adjustedByInvoiceId" IS NULL
              AND LOWER(ro.status) IN ('approved','refunded','processing')
            ORDER BY ro."createdAt" DESC
            LIMIT 300`)
        // ?debug=1 — soi từng mắt xích nối bảng để phân biệt "thật sự không có"
        // với "nối sai nên luôn ra 0" (ReturnOrder.originalInvoice có thể là
        // orderNumber CÓ prefix hoặc orderSn thô tuỳ lúc sync tìm được đơn hay không).
        if (String(req.query.debug || '') === '1') {
            const one = async (sql: string) => {
                try { const r: any = await prisma.$queryRawUnsafe(sql); return r?.[0]?.n ?? r } catch (e: any) { return `LOI: ${e?.message}` }
            }
            res.json({
                success: true,
                data: {
                    ketQua: (rows as any[]).length,
                    hdDaPhatHanh: await one(`SELECT COUNT(*)::int AS n FROM "EInvoice" WHERE status IN ('SENT','issued','SIGNED')`),
                    hdCoGiaoDich: await one(`SELECT COUNT(*)::int AS n FROM "EInvoice" e JOIN "Transaction" t ON t.id = e."transactionId" WHERE e.status IN ('SENT','issued','SIGNED')`),
                    hdNoiDuocDonSan: await one(`SELECT COUNT(*)::int AS n FROM "EInvoice" e JOIN "Transaction" t ON t.id = e."transactionId" JOIN "OnlineOrder" o ON ('ONLINE-' || o."orderNumber") = t."receiptNumber" WHERE e.status IN ('SENT','issued','SIGNED')`),
                    phieuTraTong: await one(`SELECT COUNT(*)::int AS n FROM "ReturnOrder"`),
                    phieuTraNoiDuocDonSan: await one(`SELECT COUNT(*)::int AS n FROM "ReturnOrder" ro JOIN "OnlineOrder" o ON (ro."originalInvoice" = o."orderNumber" OR o."orderNumber" LIKE '%-' || ro."originalInvoice")`),
                    phieuTraKhongNoiDuoc: await one(`SELECT COUNT(*)::int AS n FROM "ReturnOrder" ro WHERE NOT EXISTS (SELECT 1 FROM "OnlineOrder" o WHERE ro."originalInvoice" = o."orderNumber" OR o."orderNumber" LIKE '%-' || ro."originalInvoice")`),
                    mauOriginalInvoice: await one(`SELECT "originalInvoice" AS n FROM "ReturnOrder" ORDER BY "createdAt" DESC LIMIT 5`),
                    mauOrderNumber: await one(`SELECT "orderNumber" AS n FROM "OnlineOrder" ORDER BY "createdAt" DESC LIMIT 5`),
                },
            })
            return
        }
        const list = (rows as any[]).map(r => {
            const refund = Number(r.refundAmount) || 0
            const total = Number(r.totalAmount) || Number(r.txTotal) || 0
            // Hoàn ≥ 98% tổng tiền coi như trả TOÀN BỘ → thay thế/huỷ; còn lại là
            // trả một phần → hoá đơn điều chỉnh giảm.
            const fullReturn = total > 0 && refund >= total * 0.98
            return {
                ...r,
                refundAmount: refund,
                totalAmount: total,
                suggestion: fullReturn ? 'replace' : 'adjust',
                suggestionLabel: fullReturn
                    ? 'Trả toàn bộ → nên THAY THẾ/huỷ hoá đơn'
                    : `Trả một phần (${refund.toLocaleString('vi-VN')}đ/${total.toLocaleString('vi-VN')}đ) → nên lập HĐ ĐIỀU CHỈNH giảm`,
            }
        })
        res.json({
            success: true,
            data: {
                items: list,
                total: list.length,
                totalRefund: list.reduce((s, r) => s + r.refundAmount, 0),
                fullReturns: list.filter(r => r.suggestion === 'replace').length,
            },
        })
    } catch (err: any) {
        console.error('[needs-adjust]', err?.message || err)
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
        // TUẦN TỰ (xem ghi chú pool ở /einvoice/queue) — 4 truy vấn song song ôm
        // 4 kết nối/lượt tải, trùng cron là cạn pool.
        const items = await prisma.eInvoice.findMany({
            where, orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize, take: pageSize,
            select: {
                id: true, transactionId: true, invoiceNumber: true, status: true,
                errorMessage: true, buyerName: true, totalAmount: true,
                issuedAt: true, createdAt: true, provider: true, lookupCode: true,
            },
        })
        const total = await prisma.eInvoice.count({ where })
        const sent = await prisma.eInvoice.count({ where: { transactionId: { not: null }, createdAt: { gte: from }, status: 'SENT' } })
        const errors = await prisma.eInvoice.count({ where: { transactionId: { not: null }, createdAt: { gte: from }, status: 'ERROR' } })
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
        let issued = 0, failed = 0, stockSkipped = 0
        const errors: string[] = []
        const stockDetails: string[] = []
        for (const r of rows) {
            try {
                const rs: any = await issueInvoiceForTransaction(prisma, r.id, buyerBody,
                    (req as any).storeId || req.user?.branchSchema || req.user?.storeSchema)
                if (rs.success && !rs.skipped) issued++
                else if (!rs.success) {
                    // THIẾU TỒN KHO THUẾ → CHỪA phiếu đó lại (vẫn nằm trong hàng
                    // đợi, không tạo bản ghi lỗi) và CHẠY TIẾP các phiếu sau —
                    // trước đây dừng cả lô làm 1 phiếu thiếu chặn hàng trăm phiếu
                    // đủ điều kiện (yêu cầu chủ shop 2026-07-30).
                    if (rs.stockShort) {
                        stockSkipped++
                        if (stockDetails.length < 5) stockDetails.push(`${r.receiptNumber}: ${rs.error}`)
                    } else {
                        failed++; if (errors.length < 5) errors.push(`${r.receiptNumber}: ${rs.error}`)
                    }
                }
            } catch (e: any) {
                failed++; if (errors.length < 5) errors.push(`${r.receiptNumber}: ${e?.message || e}`)
            }
        }
        res.json({ success: true, data: { candidates: rows.length, issued, failed, stockSkipped, stockDetails, errors } })
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
/**
 * POST /einvoice/shopee-buyer-info/:transactionId — kéo THÔNG TIN XUẤT HĐ khách
 * khai trên Shopee (get_buyer_invoice_info) về phiếu: ghi vào Transaction.vatBuyerInfo
 * {type, name, taxCode, address, email, nationalId, companyName…}. Từ 28/07/2026
 * Shopee VN trả `national_id` cho HĐ cá nhân → luồng xuất tự đưa vào <CCCDan>.
 * Chỉ ĐỌC từ sàn + ghi lên phiếu; không xuất HĐ ở đây.
 */
router.post('/shopee-buyer-info/:transactionId', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const txId = String(req.params.transactionId)
        const tx = await prisma.transaction.findUnique({ where: { id: txId } })
        if (!tx) return res.status(404).json({ success: false, error: 'Không thấy phiếu' })
        const rn = String(tx.receiptNumber || '')
        if (!rn.startsWith('ONLINE-')) return res.status(400).json({ success: false, error: 'Không phải đơn sàn' })
        const oo = await prisma.onlineOrder.findFirst({
            where: { orderNumber: rn.replace(/^ONLINE-/, '') }, include: { channel: true },
        })
        if (!oo || String(oo.channel?.platform).toLowerCase() !== 'shopee') {
            return res.status(400).json({ success: false, error: 'Chỉ hỗ trợ đơn Shopee (Lazada/TikTok không có API thông tin HĐ người mua)' })
        }
        const { getPlatformService } = await import('../services/platforms')
        const ch = oo.channel
        const svc: any = getPlatformService('shopee', {
            apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
            accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined,
            shopId: ch.shopId || undefined,
        } as any)
        const sn = String(oo.externalOrderId || oo.orderNumber).replace(/^SPE-/i, '')
        const info = await svc.getBuyerInvoiceInfo(sn)
        if (!info) return res.json({ success: true, data: null, message: 'Khách không khai thông tin xuất hoá đơn trên Shopee cho đơn này' })
        const laCongTy = info.invoiceType === 'company'
        const vbi = {
            source: 'shopee', fetchedAt: new Date().toISOString(),
            type: info.invoiceType,
            name: laCongTy ? (info.companyName || info.name || '') : (info.name || ''),
            taxCode: laCongTy ? (info.companyTaxId || '') : (info.taxId || ''),
            address: laCongTy ? (info.companyAddress || info.address || '') : (info.address || ''),
            email: laCongTy ? (info.companyEmail || info.email || '') : (info.email || ''),
            phone: info.phone || '',
            nationalId: info.nationalId || '',
        }
        await prisma.transaction.update({ where: { id: txId }, data: { vatBuyerInfo: JSON.stringify(vbi) } as any })
        res.json({ success: true, data: vbi })
    } catch (err: any) {
        console.error('[shopee-buyer-info]', err?.message || err)
        res.status(502).json({ success: false, error: err?.message || 'Không lấy được thông tin từ Shopee' })
    }
})

router.post('/from-sale/:saleId', einvoiceAuth, requireRole('admin', 'manager', 'cashier'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const saleId = String(req.params.saleId)

        // Đọc hỏng mà trả 404 "Không tìm thấy giao dịch" là chẩn sai bệnh — để lỗi nổi lên.
        const tx = await prisma.transaction.findUnique({
            where: { id: saleId },
            include: { items: { include: { product: true } }, customer: true },
        })
        if (!tx) return res.status(404).json({ success: false, error: 'Không tìm thấy giao dịch' })

        /* CHỐT CHỐNG TRÙNG HOÁ ĐƠN. Nuốt lỗi thành null ⇒ tưởng phiếu chưa có hoá đơn ⇒ lập
         * hoá đơn THỨ HAI cho cùng một lần bán. Hoá đơn trùng là việc phải xin huỷ với cơ quan
         * thuế, không sửa được bằng một nút bấm (20/08/2026). */
        const existing = await prisma.eInvoice.findFirst({
            where: { transactionId: saleId, status: { notIn: ['CANCELLED', 'REPLACED', 'ERROR'] } },
        })
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
                buyerName: tenNguoiMuaHD(tx.customer?.name || tx.customerName, tx.customer?.taxCode || req.body?.buyerTaxCode, tx.receiptNumber),
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

// GET /api/einvoice/vnpt-raw?fkey=… — CHỈ ĐỌC: trả NGUYÊN VĂN phản hồi
// portal/get-pos-by-fkey của VNPT (số hoá đơn, trạng thái ký, trạng thái CQT).
// PHẢI khai TRƯỚC router.get('/:id') — nếu không Express nuốt luôn thành id.
router.get('/vnpt-raw', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const fkey = String(req.query.fkey || '').trim()
        if (!fkey) return res.status(400).json({ success: false, error: 'Thiếu fkey' })
        const cfgRow: any = await getActiveConfig(prisma).catch(() => null)
        if (!cfgRow) return res.status(400).json({ success: false, error: 'Chưa cấu hình nhà cung cấp HĐĐT' })
        const { VnptProvider } = await import('../services/einvoice/vnpt')
        const vnpt: any = new VnptProvider()
        const kq = await vnpt.findByFkey(cfgRow, fkey)
        return res.json({ success: true, data: kq })
    } catch (err: any) {
        res.status(500).json({ success: false, error: err?.message })
    }
})

// POST /api/einvoice/:id/sync-vnpt — kéo SỐ HOÁ ĐƠN + MÃ CQT thật từ VNPT về
// cho bản ghi đang thiếu (hoá đơn đã phát hành nhưng lúc lưu bị lỗi/thiếu số).
// CHỈ ĐỌC bên VNPT rồi cập nhật bản ghi — KHÔNG phát hành gì thêm.
router.post('/:id/sync-vnpt', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const inv = await prisma.eInvoice.findUnique({ where: { id: String(req.params.id) } })
        if (!inv) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })
        const cfgRow: any = await getActiveConfig(prisma).catch(() => null)
        if (!cfgRow) return res.status(400).json({ success: false, error: 'Chưa cấu hình nhà cung cấp HĐĐT' })

        const { VnptProvider, vnptFkey } = await import('../services/einvoice/vnpt')
        const vnpt = new VnptProvider()
        // Fkey theo loại hoá đơn: điều chỉnh '<id gốc>A', thay thế '<id gốc>R', bán = transactionId
        const fkey = inv.invoiceType === 'ADJUSTMENT' && inv.adjustsInvoiceId
            ? vnptFkey(`${inv.adjustsInvoiceId}A`)
            : inv.invoiceType === 'REPLACEMENT' && inv.replacesInvoiceId
                ? vnptFkey(`${inv.replacesInvoiceId}R`)
                : vnptFkey(inv.transactionId || inv.id)
        const kq: any = await vnpt.findByFkey(cfgRow, fkey)
        if (!kq.found) return res.status(404).json({ success: false, error: `VNPT không có hoá đơn nào theo khoá ${fkey}` })

        const data: any = {}
        if (kq.invoiceNumber && !inv.invoiceNumber) data.invoiceNumber = kq.invoiceNumber
        if (kq.lookupCode && !inv.lookupCode) data.lookupCode = kq.lookupCode
        // Có mã CQT = cơ quan thuế đã cấp mã → hoá đơn hợp lệ
        if (kq.sent && inv.status !== 'SENT') { data.status = 'SENT'; data.sentAt = new Date() }
        const updated = Object.keys(data).length
            ? await prisma.eInvoice.update({ where: { id: inv.id }, data })
            : inv
        return res.json({
            success: true,
            data: {
                fkey,
                capNhat: Object.keys(data),
                invoiceNumber: updated.invoiceNumber,
                lookupCode: updated.lookupCode,
                status: updated.status,
                vnpt: { soHoaDon: kq.invoiceNumber, maCQT: kq.lookupCode, maThongDiep: kq.messageCode, daGuiCQT: kq.sent },
            },
        })
    } catch (err: any) {
        console.error('POST /einvoice/:id/sync-vnpt error:', err?.message || err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
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
            /* KHÔNG nuốt lỗi ở lệnh XOÁ (21/08/2026): ngay dưới là `data.items = { create: … }`.
             * Xoá hỏng mà bị nuốt ⇒ dòng hàng MỚI cộng thêm vào dòng CŨ ⇒ **hoá đơn có dòng trùng,
             * tổng tiền nhân đôi** — trên chứng từ gửi cơ quan thuế. `deleteMany` không ném khi
             * không có gì để xoá, nên ném ở đây là lỗi thật: phải dừng. */
            await prisma.eInvoiceItem.deleteMany({ where: { eInvoiceId: id } })
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
        // Đọc hỏng ≠ không tìm thấy: 404 ở đây làm người dùng tưởng hoá đơn đã bị xoá.
        const inv = await prisma.eInvoice.findUnique({ where: { id } })
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
        const _maDonGoc = original.transactionId
            ? ((await prisma.transaction.findUnique({
                where: { id: original.transactionId }, select: { receiptNumber: true },
            }).catch(() => null))?.receiptNumber || '')
            : ''
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

        // Hoá đơn đã PHÁT HÀNH THẬT qua VNPT (status SENT + có transactionId):
        // phải thay thế bên VNPT (invoice-adjustment, TCHDon=1) chứ không chỉ tạo
        // nháp local — nếu không cổng thuế vẫn giữ hoá đơn sai.
        const bStr = (v: any) => (v === undefined || v === null ? '' : String(v).trim())
        const cfgRow: any = await getActiveConfig(prisma).catch(() => null)
        const isVnptIssued = String(original.status).toUpperCase() === 'SENT'
            && !!original.transactionId
            && String(cfgRow?.provider || '').toLowerCase() === 'vnpt'
        if (isVnptIssued) {
            const { VnptProvider, vnptFkey } = await import('../services/einvoice/vnpt')
            const vnpt = new VnptProvider()
            const totalAmount = computed.totalAmount || original.totalAmount || 0
            const vatAmount = computed.vatAmount || 0
            const subtotal = computed.totalBeforeVat || totalAmount - vatAmount
            const replData = {
                sellerTaxCode: cfgRow.taxCode || original.sellerTaxCode || '',
                sellerName: cfgRow.companyName || original.sellerName || '',
                sellerAddress: cfgRow.companyAddress || original.sellerAddress || '',
                // Nút "Thay thế" cũ ở modal chi tiết gửi body TRỐNG → từng rơi về
                // nguyên tên che dấu sao của sàn và phát hành y chang bản sai (HĐ
                // số 2). Tên dính '*' không kèm MST thì ép về người tiêu dùng.
                buyerName: (() => {
                    const n = bStr(b.buyerName) || original.buyerName || ''
                    return tenNguoiMuaHD(n, b.buyerTaxCode, _maDonGoc)
                })(),
                buyerTaxCode: bStr(b.buyerTaxCode) || '',
                buyerAddress: (bStr(b.buyerAddress) || '').includes('*') ? '' : (bStr(b.buyerAddress) || ''),
                buyerPhone: '', buyerEmail: '',
                paymentMethod: b.paymentMethod || original.paymentMethod || 'TM/CK',
                currencyCode: 'VND',
                items: computed.items.map((it: any) => ({
                    name: it.itemName, unit: it.unitName || 'Cái', quantity: it.quantity,
                    unitPrice: it.unitPrice, amount: it.amount,
                    vatRate: it.vatRate || 0, vatAmount: it.vatAmount || 0,
                })),
                subtotal,
                vatRate: vatAmount > 0 && subtotal > 0 ? Math.round(vatAmount * 100 / subtotal) : 0,
                vatAmount,
                total: totalAmount,
                totalInWords: docTienBangChu(Math.round(totalAmount)),
                // Khoá MỚI cho hoá đơn thay thế — KHÔNG dùng transactionId gốc kẻo
                // trùng Fkey với hoá đơn bị thay.
                transactionId: `${original.id}R`,
                receiptNumber: '',
            }
            // Thay thế MỘT HOÁ ĐƠN THAY THẾ: Fkey bên VNPT của nó là "<id gốc>R"
            // (đặt lúc phát hành thay thế), không phải transactionId.
            const originalFkey = original.invoiceType === 'REPLACEMENT' && original.replacesInvoiceId
                ? vnptFkey(`${original.replacesInvoiceId}R`)
                : vnptFkey(original.transactionId)
            const result = await vnpt.replaceInvoice(cfgRow, originalFkey, replData as any)
            if (!result.success) {
                return res.status(502).json({ success: false, error: result.errorMessage || 'Thay thế bên VNPT thất bại' })
            }
            const replacement = await prisma.eInvoice.create({
                data: {
                    transactionId: original.transactionId,
                    provider: cfgRow.provider,
                    invoiceType: 'REPLACEMENT',
                    status: 'SENT',
                    invoiceDate: todayISO(),
                    invoiceNumber: result.invoiceNumber || null,
                    invoiceSymbol: original.invoiceSymbol,
                    lookupCode: result.lookupCode || null,
                    issuedAt: new Date(), sentAt: new Date(),
                    sellerName: replData.sellerName, sellerTaxCode: replData.sellerTaxCode, sellerAddress: replData.sellerAddress,
                    buyerName: replData.buyerName, buyerTaxCode: replData.buyerTaxCode, buyerAddress: replData.buyerAddress,
                    totalBeforeVat: subtotal, vatAmount, totalAmount, currency: 'VND',
                    paymentMethod: replData.paymentMethod,
                    notes: `Thay thế HĐ ${original.invoiceSymbol || ''} số ${original.invoiceNumber || ''}${b.reason ? `: ${b.reason}` : ''}`,
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
                data: { status: 'REPLACED', replacedByInvoiceId: replacement.id, cancelReason: bStr(b.reason) || null },
            })
            return res.status(201).json({ success: true, data: { original: { id, status: 'REPLACED' }, replacement, invoiceNumber: result.invoiceNumber } })
        }

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

// ═══════════════════════════════════════════════════════════════════════════════
//  DỰNG DÒNG ĐIỀU CHỈNH TỪ PHIẾU TRẢ
//  Nguyên tắc kế toán: điều chỉnh giảm phải ghi ĐÚNG MẶT HÀNG, ĐÚNG ĐƠN GIÁ và
//  ĐÚNG THUẾ SUẤT như trên hoá đơn gốc — bán món nào giá nào thì điều chỉnh món
//  đó giá đó, số lượng = số lượng khách trả. KHÔNG gom thành một dòng "giảm X
//  đồng" (cơ quan thuế không đối chiếu được, và mất luôn dấu vết mặt hàng).
//  Trả về cả phần lệch so với tiền hoàn thực tế để người lập tự quyết.
// ═══════════════════════════════════════════════════════════════════════════════
function chuanHoaTen(s: any): string {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
}
async function dungDongDieuChinh(prisma: any, original: any, returnCode: string) {
    const ro = await prisma.returnOrder.findFirst({
        where: { code: returnCode },
        include: { items: true },
    })
    if (!ro) return { loi: `Không tìm thấy phiếu trả ${returnCode}` }

    // Thuế suất mặc định suy từ tổng HĐ gốc (dùng khi không khớp được dòng nào)
    const goc = Number(original.totalBeforeVat || 0)
    const rateGoc = Number(original.vatAmount || 0) > 0 && goc > 0
        ? Math.round(Number(original.vatAmount) * 100 / goc) : 0
    const lam = (n: number) => Math.round(n)

    // Dòng hàng của HĐ gốc để tra đơn giá/ĐVT/thuế suất.
    // KHỚP THEO productId LÀ CHÍNH: tên trên phiếu trả đơn sàn là tên Shopee/TikTok
    // ("[Freeship Toàn Quốc] Máy Xay Sinh Tố Đa Năng … 12 Tháng") còn hoá đơn ghi
    // tên rút gọn trong kho ("Máy xay sinh tố Sunhouse SHD5114") → so tên trần
    // luôn trượt. EInvoiceItem không lưu productId nên đi vòng qua giao dịch gốc.
    const dongGoc: any[] = original.items || []
    const txGoc = original.transactionId
        ? await prisma.transaction.findUnique({
            where: { id: original.transactionId },
            include: { items: true },
        }).catch(() => null)
        : null
    const txItems: any[] = txGoc?.items || []

    /** Tên rút gọn để so mờ: bỏ phần trong ngoặc, ký tự lạ, chỉ giữ chữ + số. */
    const rutGon = (s: any) => chuanHoaTen(s)
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^a-z0-9à-ỹ\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    const timDongGoc = (it: any) => {
        // 1) Qua productId: phiếu trả → dòng giao dịch gốc → dòng hoá đơn cùng tên
        if (it.productId) {
            const tx = txItems.find((t: any) => t.productId === it.productId)
            if (tx) {
                const g = dongGoc.find((d: any) => chuanHoaTen(d.itemName) === chuanHoaTen(tx.productName))
                if (g) return g
            }
        }
        // 2) Trùng tên tuyệt đối
        const bangTen = dongGoc.find((g: any) => chuanHoaTen(g.itemName) === chuanHoaTen(it.productName))
        if (bangTen) return bangTen
        // 3) Hoá đơn chỉ có ĐÚNG MỘT dòng → chính là nó
        if (dongGoc.length === 1) return dongGoc[0]
        // 4) So mờ: tên này chứa tên kia (sau khi bỏ ngoặc/ký tự lạ)
        const a = rutGon(it.productName)
        if (a) {
            const mo = dongGoc.find((g: any) => {
                const b = rutGon(g.itemName)
                return !!b && (a.includes(b) || b.includes(a))
            })
            if (mo) return mo
        }
        return null
    }

    const items = (ro.items || []).map((it: any) => {
        const g = timDongGoc(it)
        // Đơn giá LẤY TỪ HĐ GỐC (giá đã xuất hoá đơn), không lấy giá ghi trên
        // phiếu trả — hai số này lệch nhau khi bán có khuyến mãi/làm tròn.
        const donGia = g ? Number(g.unitPrice || 0) : Number(it.unitPrice || 0)
        const sl = Number(it.quantity || 1)
        const thanhTien = lam(sl * donGia)
        const rate = g ? Number(g.vatRate ?? rateGoc) : rateGoc
        return {
            itemName: g?.itemName || it.productName,
            unitName: g?.unitName || 'Cái',
            quantity: sl,
            unitPrice: donGia,
            amount: thanhTien,
            vatRate: rate,
            vatAmount: lam(thanhTien * rate / 100),
            // Thông tin phụ cho màn xem trước (không gửi sang VNPT)
            _khopHoaDonGoc: !!g,
            _sku: it.sku || null,
        }
    })

    if (items.length === 0) {
        // Phiếu trả không có dòng hàng (hoàn tiền thuần) → buộc phải ghi 1 dòng tổng
        const tien = lam(Number(ro.totalRefund || ro.refundAmount || 0))
        items.push({
            itemName: `Điều chỉnh giảm theo phiếu trả ${ro.code}`,
            unitName: 'Lần', quantity: 1, unitPrice: tien, amount: tien,
            vatRate: rateGoc, vatAmount: lam(tien * rateGoc / 100),
            _khopHoaDonGoc: false, _sku: null,
        })
    }

    const tongTruocThue = items.reduce((s: number, i: any) => s + i.amount, 0)
    const tongThue = items.reduce((s: number, i: any) => s + (i.vatAmount || 0), 0)
    const tienHoanThucTe = lam(Number(ro.totalRefund || ro.refundAmount || 0))
    return {
        items,
        returnCode: ro.code,
        tongTruocThue,
        tongThue,
        tongCong: tongTruocThue + tongThue,
        tienHoanThucTe,
        // >0 nghĩa là dòng hàng cộng lại KHÁC số tiền đã hoàn cho khách
        lech: (tongTruocThue + tongThue) - tienHoanThucTe,
    }
}

// GET /api/einvoice/vnpt-raw?fkey=… — CHỈ ĐỌC: trả NGUYÊN VĂN phản hồi
// portal/get-pos-by-fkey của VNPT. Dùng để soi tên trường thật (số hoá đơn,
// trạng thái ký, trạng thái CQT) khi bản ghi bên mình thiếu thông tin.
// GET /api/einvoice/:id/adjust-preview?returnCode=… — xem trước CÁC MỤC sẽ ghi
// trên hoá đơn điều chỉnh (để người lập kiểm tra/sửa trước khi phát hành thật).
router.get('/:id/adjust-preview', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const original = await getInvoiceWithItems(prisma, String(req.params.id))
        if (!original) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })
        const returnCode = String(req.query.returnCode || '').trim()
        if (!returnCode) return res.status(400).json({ success: false, error: 'Thiếu returnCode' })
        const kq: any = await dungDongDieuChinh(prisma, original, returnCode)
        if (kq.loi) return res.status(404).json({ success: false, error: kq.loi })
        return res.json({
            success: true,
            data: {
                ...kq,
                hoaDonGoc: {
                    id: original.id, invoiceSymbol: original.invoiceSymbol, invoiceNumber: original.invoiceNumber,
                    totalAmount: original.totalAmount, items: original.items || [],
                },
            },
        })
    } catch (err: any) {
        console.error('GET /einvoice/:id/adjust-preview error:', err?.message || err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// POST /api/einvoice/:id/adjust — hoá đơn ĐIỀU CHỈNH (giảm) cho trả hàng MỘT PHẦN.
// Khác /replace: HĐ gốc VẪN HIỆU LỰC (không đổi status), bản điều chỉnh chỉ ghi
// phần chênh. Quy định hiện hành không cho huỷ HĐ đã phát hành — chỉ điều chỉnh
// hoặc thay thế; trả một phần mà dùng thay thế là sai nghiệp vụ.
// Body: { items: [dòng điều chỉnh], reason? } — items BẮT BUỘC vì phần chênh
// không suy ra được từ HĐ gốc.
router.post('/:id/adjust', einvoiceAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const id = String(req.params.id)
        const original = await getInvoiceWithItems(prisma, id)
        if (!original) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })
        const _maDonGoc = original.transactionId
            ? ((await prisma.transaction.findUnique({
                where: { id: original.transactionId }, select: { receiptNumber: true },
            }).catch(() => null))?.receiptNumber || '')
            : ''
        if (!['SIGNED', 'SENT'].includes(original.status)) {
            return res.status(400).json({ success: false, error: `Chỉ điều chỉnh hóa đơn đã ký/phát hành. Trạng thái hiện tại: ${original.status}` })
        }
        if (original.replacedByInvoiceId) {
            return res.status(400).json({ success: false, error: 'Hóa đơn đã bị thay thế — điều chỉnh bản thay thế thay vì bản này' })
        }

        const b = req.body || {}
        const bStr = (v: any) => (v === undefined || v === null ? '' : String(v).trim())
        // Dòng điều chỉnh: FE truyền thẳng items, HOẶC truyền returnCode để dựng
        // từ phiếu trả (màn needs-adjust chỉ có mã phiếu, không có dòng hàng).
        let rawItems: any[] | null = Array.isArray(b.items) && b.items.length ? b.items : null
        if (!rawItems && bStr(b.returnCode)) {
            // Dựng từ phiếu trả theo ĐÚNG mặt hàng/đơn giá/thuế suất của HĐ gốc
            // (cùng hàm với /adjust-preview → cái người lập nhìn thấy chính là
            // cái được phát hành, không có bản dựng thứ hai lệch nhau).
            const kq: any = await dungDongDieuChinh(prisma, original, bStr(b.returnCode))
            if (kq.loi) return res.status(404).json({ success: false, error: kq.loi })
            rawItems = kq.items
        }
        // Bỏ field phụ dành cho màn xem trước trước khi tính toán/gửi VNPT
        if (rawItems) rawItems = rawItems.map(({ _khopHoaDonGoc, _sku, ...giu }: any) => giu)
        if (!rawItems || rawItems.length === 0) {
            return res.status(400).json({ success: false, error: 'Thiếu dòng điều chỉnh — truyền items hoặc returnCode của phiếu trả' })
        }
        const computed = computeItems(rawItems)

        const cfgRow: any = await getActiveConfig(prisma).catch(() => null)
        const isVnptIssued = String(original.status).toUpperCase() === 'SENT'
            && !!original.transactionId
            && String(cfgRow?.provider || '').toLowerCase() === 'vnpt'
        if (!isVnptIssued) {
            return res.status(400).json({ success: false, error: 'Hoá đơn chưa phát hành qua VNPT — dùng sửa nháp/thay thế thay vì điều chỉnh' })
        }

        const { VnptProvider, vnptFkey } = await import('../services/einvoice/vnpt')
        const vnpt = new VnptProvider()
        const totalAmount = computed.totalAmount || 0
        const vatAmount = computed.vatAmount || 0
        const subtotal = computed.totalBeforeVat || totalAmount - vatAmount
        const adjData = {
            sellerTaxCode: cfgRow.taxCode || original.sellerTaxCode || '',
            sellerName: cfgRow.companyName || original.sellerName || '',
            sellerAddress: cfgRow.companyAddress || original.sellerAddress || '',
            buyerName: (() => {
                const n = bStr(b.buyerName) || original.buyerName || ''
                return tenNguoiMuaHD(n, bStr(b.buyerTaxCode) || bStr(original.buyerTaxCode), _maDonGoc)
            })(),
            buyerTaxCode: bStr(b.buyerTaxCode) || bStr(original.buyerTaxCode) || '',
            buyerAddress: (bStr(b.buyerAddress) || bStr(original.buyerAddress) || '').includes('*') ? '' : (bStr(b.buyerAddress) || bStr(original.buyerAddress) || ''),
            buyerPhone: '', buyerEmail: '',
            paymentMethod: b.paymentMethod || original.paymentMethod || 'TM/CK',
            currencyCode: 'VND',
            items: computed.items.map((it: any) => ({
                name: it.itemName, unit: it.unitName || 'Cái', quantity: it.quantity,
                unitPrice: it.unitPrice, amount: it.amount,
                vatRate: it.vatRate || 0, vatAmount: it.vatAmount || 0,
            })),
            subtotal,
            vatRate: vatAmount > 0 && subtotal > 0 ? Math.round(vatAmount * 100 / subtotal) : 0,
            vatAmount,
            total: totalAmount,
            totalInWords: docTienBangChu(Math.round(totalAmount)),
            // Khoá MỚI — 'A' (adjust) để không đụng Fkey gốc lẫn Fkey thay thế '<id>R'
            transactionId: `${original.id}A`,
            receiptNumber: '',
        }
        // Điều chỉnh một HĐ thay thế: Fkey bên VNPT của nó là '<id gốc>R'
        const originalFkey = original.invoiceType === 'REPLACEMENT' && original.replacesInvoiceId
            ? vnptFkey(`${original.replacesInvoiceId}R`)
            : vnptFkey(original.transactionId)
        let result = await vnpt.adjustInvoice(cfgRow, originalFkey, adjData as any)
        if (!result.success) {
            // CỨU bản đã phát hành: lần trước gọi VNPT xong nhưng lưu DB hỏng →
            // hoá đơn có thật bên thuế, phát hành lại bị chặn vì trùng Fkey.
            // Tra theo Fkey của bản điều chỉnh; có thật thì đi tiếp để ghi bản ghi.
            const daCo = await vnpt.findByFkey(cfgRow, vnptFkey(adjData.transactionId))
            if (daCo.found) {
                console.warn(`[adjust] HĐ điều chỉnh đã tồn tại bên VNPT (số ${daCo.invoiceNumber}) — ghi bản ghi bù thay vì phát hành lại`)
                result = { success: true, invoiceNumber: daCo.invoiceNumber, lookupCode: daCo.lookupCode } as any
            } else {
                return res.status(502).json({ success: false, error: result.errorMessage || 'Điều chỉnh bên VNPT thất bại' })
            }
        }

        const adjustment = await prisma.eInvoice.create({
            data: {
                transactionId: original.transactionId,
                provider: cfgRow.provider,
                invoiceType: 'ADJUSTMENT',
                status: 'SENT',
                invoiceDate: todayISO(),
                invoiceNumber: result.invoiceNumber || null,
                invoiceSymbol: original.invoiceSymbol,
                lookupCode: result.lookupCode || null,
                issuedAt: new Date(), sentAt: new Date(),
                sellerName: adjData.sellerName, sellerTaxCode: adjData.sellerTaxCode, sellerAddress: adjData.sellerAddress,
                buyerName: adjData.buyerName, buyerTaxCode: adjData.buyerTaxCode, buyerAddress: adjData.buyerAddress,
                // LƯU SỐ ÂM: bản ghi phải phản ánh đúng hoá đơn đã phát hành
                // (điều chỉnh giảm ghi tiền âm) — báo cáo doanh thu/thuế cộng dồn
                // thẳng là ra số đã trừ, không phải bỏ riêng ADJUSTMENT ra tính tay.
                totalBeforeVat: -Math.abs(subtotal),
                vatAmount: -Math.abs(vatAmount),
                totalAmount: -Math.abs(totalAmount),
                currency: 'VND',
                paymentMethod: adjData.paymentMethod,
                notes: `Điều chỉnh giảm HĐ ${original.invoiceSymbol || ''} số ${original.invoiceNumber || ''}${b.reason ? `: ${b.reason}` : ''}`,
                adjustsInvoiceId: original.id,
                // Khoá nối đích danh để hoàn tồn kho thuế đúng phiếu trả
                adjustReturnCode: bStr(b.returnCode) || null,
                branchId: original.branchId || req.user?.branchId || null,
                createdBy: req.user?.userId || null,
                createdByName: (req.user as any)?.email || null,
                // Dòng hàng cũng ghi âm cho khớp hoá đơn đã phát hành
                items: {
                    create: computed.items.map((it: any) => ({
                        ...it,
                        amount: -Math.abs(Number(it.amount) || 0),
                        vatAmount: -Math.abs(Number(it.vatAmount) || 0),
                    })),
                },
            },
            include: { items: true },
        })
        // HĐ gốc GIỮ NGUYÊN status (vẫn hiệu lực) — chỉ ghi liên kết để
        // needs-adjust thôi liệt kê nó.
        await prisma.eInvoice.update({
            where: { id },
            data: { adjustedByInvoiceId: adjustment.id },
        })
        return res.status(201).json({ success: true, data: { original: { id, status: original.status }, adjustment, invoiceNumber: result.invoiceNumber } })
    } catch (err: any) {
        console.error('POST /einvoice/:id/adjust error:', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/einvoice/:id/vnpt-file — tải bản hoá đơn THẬT (có QR + chữ ký) từ
// cổng VNPT theo Fkey. FE mở blob trong tab mới.
router.get('/:id/vnpt-file', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const record = await prisma.eInvoice.findUnique({ where: { id: String(req.params.id) } })
        if (!record) return res.status(404).json({ success: false, error: 'Không tìm thấy hóa đơn' })
        if (!record.transactionId) return res.status(400).json({ success: false, error: 'Hóa đơn không gắn giao dịch — không có Fkey bên VNPT' })
        const cfgRow: any = await getActiveConfig(prisma).catch(() => null)
        if (String(cfgRow?.provider || '').toLowerCase() !== 'vnpt') {
            return res.status(400).json({ success: false, error: 'Chưa cấu hình VNPT' })
        }
        const { VnptProvider, vnptFkey } = await import('../services/einvoice/vnpt')
        // Hoá đơn thay thế phát hành với Fkey "<id gốc>R" — xem bản thay thế thì
        // phải tra bằng khoá đó, không phải transactionId.
        const fkey = record.invoiceType === 'REPLACEMENT' && record.replacesInvoiceId
            ? vnptFkey(`${record.replacesInvoiceId}R`)
            : vnptFkey(record.transactionId)
        const file = await new VnptProvider().downloadInvoice(cfgRow, fkey)
        if (file.kind === 'pdf' && file.base64) {
            res.set('Content-Type', 'application/pdf')
            res.set('Content-Disposition', `inline; filename="HD-${record.invoiceNumber || record.id}.pdf"`)
            return res.send(Buffer.from(file.base64, 'base64'))
        }
        if (file.kind === 'xml' && file.base64) {
            res.set('Content-Type', 'application/xml; charset=utf-8')
            return res.send(Buffer.from(file.base64, 'base64'))
        }
        if (file.kind === 'zip' && file.base64) {
            res.set('Content-Type', 'application/zip')
            res.set('Content-Disposition', `attachment; filename="HD-${record.invoiceNumber || record.id}.zip"`)
            return res.send(Buffer.from(file.base64, 'base64'))
        }
        if (file.kind === 'url') return res.json({ success: true, url: file.raw })
        res.status(502).json({ success: false, error: `VNPT không trả file nhận diện được: ${file.raw || ''}`.slice(0, 400) })
    } catch (err: any) {
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
        // Bản XML ĐÃ LƯU chỉ có giá trị với hoá đơn ĐÃ KÝ/PHÁT HÀNH (bản ký là bất
        // biến). Tờ nháp/lỗi mà trả bản lưu thì người dùng thấy ảnh chụp của code
        // cũ, tưởng bản vá không ăn — phải dựng lại từ dữ liệu hiện tại.
        const daKy = ['issued', 'sent', 'signed'].includes(String(inv.status || '').toLowerCase())
        const xml = daKy
            ? (inv.xmlContent || inv.xmlData || generateInvoiceXml(inv, inv.items))
            : generateInvoiceXml(inv, inv.items)
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
  <div class="party"><b>Người bán:</b> ${escHtml(inv.sellerName || inv._config?.companyName || '')}</div>
  <div class="party">MST: ${escHtml(inv.sellerTaxCode || inv._config?.taxCode || '')} &nbsp;|&nbsp; Địa chỉ: ${escHtml(inv.sellerAddress || inv._config?.companyAddress || '')}</div>
  <div class="party" style="margin-top:8px"><b>Người mua:</b> ${escHtml(tenNguoiMua(inv.buyerName, inv.buyerTaxCode))}</div>
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

/**
 * POST /einvoice/shopee-buyer-info/:transactionId — kéo THÔNG TIN XUẤT HĐ khách
 * khai trên Shopee (get_buyer_invoice_info) về phiếu: ghi vào Transaction.vatBuyerInfo
 * {type, name, taxCode, address, email, nationalId, companyName…}. Từ 28/07/2026
 * Shopee VN trả `national_id` cho HĐ cá nhân → luồng xuất tự đưa vào <CCCDan>.
 * Chỉ ĐỌC từ sàn + ghi lên phiếu; không xuất HĐ ở đây.
 */
router.post('/shopee-buyer-info/:transactionId', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const txId = String(req.params.transactionId)
        const tx = await prisma.transaction.findUnique({ where: { id: txId } })
        if (!tx) return res.status(404).json({ success: false, error: 'Không thấy phiếu' })
        const rn = String(tx.receiptNumber || '')
        if (!rn.startsWith('ONLINE-')) return res.status(400).json({ success: false, error: 'Không phải đơn sàn' })
        const oo = await prisma.onlineOrder.findFirst({
            where: { orderNumber: rn.replace(/^ONLINE-/, '') }, include: { channel: true },
        })
        if (!oo || String(oo.channel?.platform).toLowerCase() !== 'shopee') {
            return res.status(400).json({ success: false, error: 'Chỉ hỗ trợ đơn Shopee (Lazada/TikTok không có API thông tin HĐ người mua)' })
        }
        const { getPlatformService } = await import('../services/platforms')
        const ch = oo.channel
        const svc: any = getPlatformService('shopee', {
            apiKey: ch.apiKey || '', apiSecret: ch.apiSecret || '',
            accessToken: ch.accessToken || undefined, refreshToken: ch.refreshToken || undefined,
            shopId: ch.shopId || undefined,
        } as any)
        const sn = String(oo.externalOrderId || oo.orderNumber).replace(/^SPE-/i, '')
        const info = await svc.getBuyerInvoiceInfo(sn)
        if (!info) return res.json({ success: true, data: null, message: 'Khách không khai thông tin xuất hoá đơn trên Shopee cho đơn này' })
        const laCongTy = info.invoiceType === 'company'
        const vbi = {
            source: 'shopee', fetchedAt: new Date().toISOString(),
            type: info.invoiceType,
            name: laCongTy ? (info.companyName || info.name || '') : (info.name || ''),
            taxCode: laCongTy ? (info.companyTaxId || '') : (info.taxId || ''),
            address: laCongTy ? (info.companyAddress || info.address || '') : (info.address || ''),
            email: laCongTy ? (info.companyEmail || info.email || '') : (info.email || ''),
            phone: info.phone || '',
            nationalId: info.nationalId || '',
        }
        await prisma.transaction.update({ where: { id: txId }, data: { vatBuyerInfo: JSON.stringify(vbi) } as any })
        res.json({ success: true, data: vbi })
    } catch (err: any) {
        console.error('[shopee-buyer-info]', err?.message || err)
        res.status(502).json({ success: false, error: err?.message || 'Không lấy được thông tin từ Shopee' })
    }
})

/* ── Tra/sửa thông tin người mua THEO MÃ ĐƠN SÀN (ghép lại từ bản đang chạy trên prod).
 * Frontend đã gọi hai đường này từ OrderDetailModal, nhưng cây này không có chúng
 * ⇒  báo "2 lời gọi không khớp route nào" suốt. ── */
// ─── Thông tin xuất HĐ theo MÃ ĐƠN SÀN ──────────────────────────────────────
// Khách nhắn xin hoá đơn thì nhân viên đang đứng ở trang ĐƠN HÀNG ONLINE, tay
// cầm mã đơn — không phải tab hàng đợi xuất HĐ với txId. Cho đọc/ghi thẳng theo
// orderNumber; Transaction của đơn sàn có receiptNumber = 'ONLINE-' + orderNumber.
async function timTxTheoMaDon(prisma: any, orderNumber: string) {
    const ma = String(orderNumber || '').trim()
    if (!ma) return null
    // Đơn cũ trước quy ước ONLINE- có thể mang receipt trần (TIK-xxx) — thử cả hai.
    return await prisma.transaction.findFirst({
        where: { receiptNumber: { in: [`ONLINE-${ma}`, ma] } },
        select: { id: true, receiptNumber: true, total: true, vatBuyerInfo: true },
    })
}

router.get('/buyer/by-order/:orderNumber', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const tx = await timTxTheoMaDon(prisma, String(req.params.orderNumber || ''))
        if (!tx) {
            res.status(404).json({ success: false, error: 'Đơn chưa có phiếu bán trong hệ thống (chưa đồng bộ xong)' })
            return
        }
        let info: any = null
        try { info = tx.vatBuyerInfo ? JSON.parse(tx.vatBuyerInfo) : null } catch { }
        // Đã có hoá đơn phát hành chưa — có rồi thì thông tin mới chỉ dùng được
        // cho hoá đơn THAY THẾ, phải nói rõ để nhân viên khỏi chờ auto vô ích.
        const issued = await prisma.eInvoice.findFirst({
            where: { transactionId: tx.id, status: { in: ['ISSUING', 'issued', 'SIGNED', 'SENT'] } },
            select: { id: true, invoiceNumber: true, invoiceSymbol: true, status: true },
            orderBy: { createdAt: 'desc' },
        }).catch(() => null)
        res.json({
            success: true,
            data: { txId: tx.id, receiptNumber: tx.receiptNumber, total: tx.total, vatBuyerInfo: info, issuedInvoice: issued },
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// Cùng luật ghi với PUT /queue/receipt/:txId/buyer (email hợp lệ, toàn trường
// rỗng = gỡ yêu cầu) — chỉ khác cách tìm phiếu.
router.put('/buyer/by-order/:orderNumber', einvoiceAuth, async (req: AuthRequest, res: Response) => {
    try {
        await ensureTables(req)
        const prisma = req.storePrisma! as any
        const tx = await timTxTheoMaDon(prisma, String(req.params.orderNumber || ''))
        if (!tx) {
            res.status(404).json({ success: false, error: 'Đơn chưa có phiếu bán trong hệ thống (chưa đồng bộ xong)' })
            return
        }
        const b = req.body || {}
        const sv = (v: any) => (v === undefined || v === null ? '' : String(v).trim())
        const info = { name: sv(b.name), taxCode: sv(b.taxCode), address: sv(b.address), email: sv(b.email), nationalId: sv(b.nationalId) }
        if (info.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email)) {
            res.status(400).json({ success: false, error: 'Email không hợp lệ' })
            return
        }
        if (info.nationalId && !/^\d{9,12}$/.test(info.nationalId)) {
            res.status(400).json({ success: false, error: 'CCCD phải là 9–12 chữ số' })
            return
        }
        const has = info.name || info.taxCode || info.address || info.email || info.nationalId
        const saved = await prisma.transaction.update({
            where: { id: tx.id },
            data: { vatBuyerInfo: has ? JSON.stringify(info) : null },
            select: { id: true, vatBuyerInfo: true },
        })
        res.json({ success: true, data: { txId: saved.id, vatBuyerInfo: has ? info : null } })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
