import { Router, Response } from 'express'
import { errMsg } from '../lib/errorResponse'
import { createJournalEntriesForTransaction } from '../lib/autoJournal'
import { postImportReceiptJournal, postReturnJournal } from '../lib/autoJournalPurchase'
import { thuGhiSo, coKhauTruVat } from '../lib/ghiSoDongBo'
import multer from 'multer'
import * as XLSX from 'xlsx'
import { authMiddleware, AuthRequest, getBranchFilter, getBranchId } from '../middleware/auth'
import { PrismaClient as StorePrisma } from '../generated/store-client'
import { adjustSellableStock, getOrCreateDefaultWarehouse, updateWarehouseStock } from '../lib/warehouseHelper'

// Helper: get the per-branch prisma client from request (injected by authMiddleware)
function getPrisma(req: AuthRequest): StorePrisma {
    if (!req.storePrisma) throw new Error('Không tìm thấy kết nối database. Vui lòng đăng nhập lại.')
    return req.storePrisma
}

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// ─── SSE Progress Streaming ─────────────────────────────────────────────────
function setupSSE(res: Response) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',  // nginx
    })
    res.flushHeaders()
}

function sendProgress(res: Response, data: { current: number; total: number; imported: number; errors: number; message?: string }) {
    const progress = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0
    res.write(`data: ${JSON.stringify({ ...data, progress })}\n\n`)
}

function sendDone(res: Response, data: { imported: number; total: number; errors: string[] }) {
    res.write(`data: ${JSON.stringify({ ...data, progress: 100, done: true })}\n\n`)
    res.end()
}

function sendError(res: Response, error: string) {
    res.write(`data: ${JSON.stringify({ error, done: true })}\n\n`)
    res.end()
}

// ─── Helper: resolve + validate branchId from body or auth token ────────────
async function resolveBranchId(req: AuthRequest): Promise<string> {
    // Priority: body.branchId > token branchId
    const branchId = req.body?.branchId || getBranchId(req)
    if (!branchId) throw new Error('Vui lòng chọn chi nhánh trước khi import')
    const branch = await getPrisma(req).branch.findFirst({ where: { id: branchId } })
    if (!branch) throw new Error(`Chi nhánh không tồn tại hoặc không thuộc cửa hàng này`)
    return branchId
}

// ─── GET /api/import-data/branches — list branches for import branch selector
router.get('/branches', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const branches = await getPrisma(req).branch.findMany({
            where: {},
            select: { id: true, name: true, address: true },
            orderBy: { name: 'asc' }
        })
        res.json({ success: true, data: branches })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err, 'Lỗi') })
    }
})

// ─── Templates ──────────────────────────────────────────────────────────────
const TEMPLATES: Record<string, { filename: string; headers: string[]; sample: string[][] }> = {
    products: {
        filename: 'mau_san_pham.xlsx',
        headers: [
            'Mã hàng', 'Tên hàng', 'Nhóm hàng cấp 1', 'Nhóm hàng cấp 2', 'Nhóm hàng cấp 3',
            'Thương hiệu', 'Giá vốn', 'Giá bán', 'Tồn đầu kỳ', 'Đơn vị', 'Barcode',
            'Hình 1', 'Hình 2', 'Hình 3', 'Hình 4', 'Hình 5',
            'Hình 6', 'Hình 7', 'Hình 8', 'Hình 9', 'Hình 10',
        ],
        sample: [
            ['SP001', 'Áo thun nam basic', 'Thời trang', 'Áo', 'Áo thun', 'Nike', '85000', '150000', '100', 'Cái', '8901234567890',
                'https://example.com/img/sp001-1.jpg', 'https://example.com/img/sp001-2.jpg', '', '', '', '', '', '', '', ''],
        ]
    },
    suppliers: {
        filename: 'mau_nha_cung_cap.xlsx',
        headers: ['Mã NCC', 'Tên NCC', 'Người liên hệ', 'SĐT', 'Email', 'Địa chỉ', 'MST', 'Ghi chú', 'Công nợ'],
        sample: [['NCC001', 'Công ty TNHH ABC', 'Nguyễn Văn X', '0909123456', 'abc@company.vn', '123 Nguyễn Huệ, Q1', '0312345678', '', '0']]
    },
    transactions: {
        filename: 'mau_don_hang.xlsx',
        headers: ['Mã đơn', 'Ngày giờ', 'Mã KH', 'Khách hàng', 'SĐT', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Giảm giá', 'Ghi chú'],
        sample: [['DH001', '28/02/2026 14:30', 'KH001', 'Nguyễn Văn A', '0901234567', 'SP001', 'Áo thun', '2', '150000', '0', '']]
    },
    'import-receipts': {
        filename: 'mau_nhap_hang.xlsx',
        headers: ['Mã phiếu', 'Ngày giờ', 'Nhà cung cấp', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Giảm giá', 'Ghi chú'],
        sample: [['PN001', '28/02/2026 10:00', 'Công ty ABC', 'SP001', 'Áo thun', '50', '85000', '5000', '']]
    },
    returns: {
        filename: 'mau_tra_hang.xlsx',
        headers: ['Mã trả hàng', 'Ngày giờ', 'Mã đơn gốc', 'Khách hàng', 'SĐT', 'Lý do', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Ghi chú'],
        sample: [['TH001', '28/02/2026 09:15', 'DH001', 'Nguyễn Văn A', '0901234567', 'Lỗi', 'SP001', 'Áo thun', '1', '150000', '']]
    },
    customers: {
        filename: 'mau_khach_hang.xlsx',
        headers: ['Mã KH', 'Tên khách hàng', 'SĐT', 'Email', 'Địa chỉ', 'Nhóm KH', 'Ngày sinh', 'Giới tính', 'Ghi chú', 'Công nợ'],
        sample: [['KH001', 'Nguyễn Văn A', '0901234567', 'a@email.com', '123 Lê Lợi', 'VIP', '15/06/1990', 'Nam', '', '0']]
    }
}

router.get('/template/:type', (req, res) => {
    const template = TEMPLATES[req.params.type]
    if (!template) return res.status(404).json({ success: false, error: 'Template không tồn tại' })
    const data = [template.headers, ...template.sample]
    const ws = XLSX.utils.aoa_to_sheet(data)
    ws['!cols'] = template.headers.map(h => ({ wch: Math.max(h.length * 2, 15) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Dữ liệu')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${template.filename}"`)
    res.send(buf)
})

// ─── Helpers ────────────────────────────────────────────────────────────────
function parseExcel(buffer: Buffer): Record<string, string>[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', codepage: 65001 })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return []
    const sheet = workbook.Sheets[sheetName]
    return XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' })
}

function col(row: Record<string, string>, ...names: string[]): string {
    for (const name of names) {
        if (row[name] !== undefined && row[name] !== '') return String(row[name]).trim()
        const key = Object.keys(row).find(k => k.toLowerCase().trim() === name.toLowerCase().trim())
        if (key && row[key] !== undefined && row[key] !== '') return String(row[key]).trim()
    }
    return ''
}

// Parse a numeric cell that may be a real number OR a localized text string.
// Handles both VN format "1.234.567,89" and US format "1,234,567.89", plus plain
// "1234567.89" / "1234567". Heuristic: the LAST '.' or ',' is the decimal point
// ONLY when it's followed by 1–2 digits; otherwise every '.'/',' is a thousands
// separator and is stripped. This is what broke price imports before: the old
// code replaced just the first comma then parseFloat("272.817.38") → 272.817.
function toNumber(val: string | number | null | undefined): number {
    if (val === null || val === undefined) return 0
    if (typeof val === 'number') return isFinite(val) ? val : 0
    let s = String(val).trim().replace(/[^\d.,\-]/g, '')
    if (!s) return 0
    const neg = s.startsWith('-')
    s = s.replace(/-/g, '')
    if (!s) return 0
    const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
    let n: number
    if (lastSep === -1) {
        n = parseFloat(s)
    } else {
        const decimals = s.length - lastSep - 1
        if (decimals === 1 || decimals === 2) {
            // last separator is the decimal point; everything else is grouping
            const intPart = s.slice(0, lastSep).replace(/[.,]/g, '')
            const fracPart = s.slice(lastSep + 1)
            n = parseFloat(`${intPart || '0'}.${fracPart}`)
        } else {
            // all separators are thousands grouping
            n = parseFloat(s.replace(/[.,]/g, ''))
        }
    }
    if (isNaN(n)) return 0
    return neg ? -n : n
}

async function findOrCreateCategory(prisma: StorePrisma, level1?: string, level2?: string, level3?: string): Promise<string> {
    if (!level1) {
        let def = await prisma.category.findFirst({ where: { name: 'Chung', level: 1 } })
        if (!def) def = await prisma.category.create({ data: { name: 'Chung', level: 1 } })
        return def.id
    }
    let cat1 = await prisma.category.findFirst({ where: { name: level1, level: 1, parentId: null } })
    if (!cat1) cat1 = await prisma.category.create({ data: { name: level1, level: 1 } })
    if (!level2) return cat1.id

    let cat2 = await prisma.category.findFirst({ where: { name: level2, level: 2, parentId: cat1.id } })
    if (!cat2) cat2 = await prisma.category.create({ data: { name: level2, level: 2, parentId: cat1.id } })
    if (!level3) return cat2.id

    let cat3 = await prisma.category.findFirst({ where: { name: level3, level: 3, parentId: cat2.id } })
    if (!cat3) cat3 = await prisma.category.create({ data: { name: level3, level: 3, parentId: cat2.id } })
    return cat3.id
}

async function findOrCreateBrand(prisma: StorePrisma, name: string): Promise<string | null> {
    if (!name) return null
    let brand = await prisma.brand.findFirst({ where: { name } })
    if (!brand) brand = await prisma.brand.create({ data: { name } })
    return brand.id
}

function parseDateTime(str: string, defaultHour: number, defaultMin: number): Date {
    const withDefaultTime = () => { const d = new Date(); d.setHours(defaultHour, defaultMin, 0, 0); return d }
    if (str === null || str === undefined || String(str).trim() === '') return withDefaultTime()
    str = String(str).trim()

    // Excel serial date number (vd "46176" hoặc "46176.5"). Ô được Excel coi là NGÀY
    // sẽ về đây dưới dạng số serial (raw value), không phải chuỗi dd/MM/yyyy — đây là
    // lỗi khiến mọi hoá đơn import bị gán ngày hôm nay thay vì ngày trong file.
    // Epoch Excel = 1899-12-30 (đã tính cả lỗi năm nhuận 1900). Dựng wall-clock theo
    // UTC rồi build lại bằng giờ local để khớp đúng giá trị Excel hiển thị (tránh lệch TZ).
    if (/^\d+(\.\d+)?$/.test(str)) {
        const serial = parseFloat(str)
        if (serial >= 29000 && serial <= 80000) { // ~1979 → 2119, tránh nhầm mã số thành ngày
            const whole = Math.floor(serial)
            const frac = serial - whole
            const utc = new Date(Date.UTC(1899, 11, 30) + whole * 86400000 + Math.round(frac * 86400000))
            const d = new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds())
            if (frac === 0) d.setHours(defaultHour, defaultMin, 0, 0) // serial chỉ có ngày → giờ mặc định
            return d
        }
    }

    // dd/MM/yyyy [HH:mm[:ss]]
    const match = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (match) return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]), parseInt(match[4]), parseInt(match[5]), parseInt(match[6] || '0'))

    // ISO yyyy-MM-dd[ T HH:mm[:ss]] (một số file/export dùng định dạng này)
    const iso = str.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
    if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]), iso[4] ? parseInt(iso[4]) : defaultHour, iso[5] ? parseInt(iso[5]) : defaultMin, iso[6] ? parseInt(iso[6]) : 0)

    // dd/MM/yyyy (chỉ ngày)
    const parts = str.split(/[\/\-\.]/)
    if (parts.length === 3 && parseInt(parts[2]) > 100)
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), defaultHour, defaultMin)

    return withDefaultTime()
}

// ═══════════════════════════════════════════════════════════════════
// POST /api/import-data/products
// ═══════════════════════════════════════════════════════════════════
router.post('/products', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Vui lòng upload file Excel' })
        let rows = parseExcel(req.file.buffer)
        if (!rows.length) return res.status(400).json({ success: false, error: 'File Excel trống' })

        const branchId = await resolveBranchId(req)
        const useSSE = req.query.stream === 'true'

        if (useSSE) setupSSE(res)

        let imported = 0
        const errors: string[] = []

        console.log(`[ImportData] Products: ${rows.length} rows, branchId=${branchId}, sse=${useSSE}`)

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            const name = col(row, 'Tên hàng', 'Tên sản phẩm', 'name', 'product_name', 'ten_hang', 'Tên Hàng', 'Tên')
            if (!name) { errors.push(`Dòng ${i + 2}: Thiếu tên sản phẩm`); continue }

            const sku = col(row, 'Mã hàng', 'Mã sản phẩm', 'SKU', 'code', 'sku', 'product_code', 'ma_hang', 'Mã Hàng') || `SP-${Date.now()}-${i}`
            const catLevel1 = col(row, 'Nhóm hàng cấp 1', 'Nhóm 1', 'Danh mục', 'category', 'Category')
            const catLevel2 = col(row, 'Nhóm hàng cấp 2', 'Nhóm 2', 'Danh mục con')
            const catLevel3 = col(row, 'Nhóm hàng cấp 3', 'Nhóm 3', 'Danh mục chi tiết')
            const brandName = col(row, 'Thương hiệu', 'Brand', 'Nhãn hiệu', 'thuong_hieu')
            const costPrice = toNumber(col(row, 'Giá vốn', 'Giá nhập', 'cost', 'cost_price', 'gia_von', 'Giá Vốn'))
            const sellingPrice = toNumber(col(row, 'Giá bán', 'Giá bán lẻ', 'price', 'sale_price', 'gia_ban', 'Giá Bán'))
            const openingStock = Math.round(toNumber(col(row, 'Tồn đầu kỳ', 'Tồn đầu', 'opening_stock', 'ton_dau_ky', 'Tồn kho', 'stock', 'quantity', 'ton_kho', 'Tồn Kho', 'Số lượng')))
            const baseUnit = col(row, 'Đơn vị', 'ĐVT', 'unit', 'don_vi', 'Đơn Vị') || 'Cái'
            const barcode = col(row, 'Barcode', 'Mã vạch', 'barcode', 'ma_vach') || null

            const imageUrls: string[] = []
            for (let j = 1; j <= 10; j++) {
                const url = col(row, `Hình ${j}`, `Image ${j}`, `image_${j}`, `hinh_${j}`, `Ảnh ${j}`)
                if (url && (url.startsWith('http://') || url.startsWith('https://'))) imageUrls.push(url)
            }

            try {
                const categoryId = await findOrCreateCategory(getPrisma(req), catLevel1, catLevel2, catLevel3)
                const brandId = await findOrCreateBrand(getPrisma(req), brandName)

                // Find existing product by sku + storeId
                const existing = await getPrisma(req).product.findFirst({ where: { sku } })
                const productData = {
                    name, costPrice, sellingPrice,
                    stock: openingStock, minStock: 0,
                    baseUnit, barcode, categoryId,
                    ...(brandId ? { brandId } : {})
                }

                let product
                let stockDelta = 0 // delta tồn kho THẬT của lần import này (0 = không đổi)
                if (existing) {
                    // Sản phẩm đã tồn tại (dữ liệu kỳ sau) → KHÔNG ghi đè stock
                    // Chỉ cập nhật tên, giá, category, brand
                    const { stock, ...updateData } = productData
                    product = await getPrisma(req).product.update({ where: { id: existing.id }, data: updateData })
                } else {
                    // Dòng đầu tiên (kỳ đầu) → tạo mới với stock = tồn đầu kỳ
                    product = await getPrisma(req).product.create({ data: { sku, ...productData } })
                    stockDelta = openingStock
                    // product.create đã set Product.stock = openingStock → KHÔNG dùng
                    // adjustSellableStock (sẽ cộng thêm lần nữa). Set thẳng WarehouseStock
                    // kho main = openingStock để POS thấy tồn ngay sau import.
                    if (openingStock > 0) {
                        try {
                            const wh = await getOrCreateDefaultWarehouse(getPrisma(req), branchId)
                            if (wh?.id) await updateWarehouseStock(getPrisma(req), wh.id, product.id, openingStock)
                        } catch { /* schema chưa có bảng Warehouse — Product.stock vẫn đúng */ }
                    }
                }

                // InventoryTransaction tồn đầu kỳ: CHỈ ghi khi stock thực sự thay đổi
                // (sản phẩm mới tạo). Import lần 2 stock không đổi mà vẫn ghi +N sẽ làm
                // thẻ kho lệch so với tồn thật.
                if (stockDelta > 0) {
                    await getPrisma(req).inventoryTransaction.create({
                        data: {
                            type: 'stocktaking', productId: product.id, productName: name, productSku: sku,
                            quantity: stockDelta, reason: 'Tồn đầu kỳ - Import',
                            referenceType: 'adjustment', referenceId: `IMP-${sku}`, branchId,
                            userName: 'System Import'
                        }
                    })
                }

                // Images
                if (imageUrls.length > 0) {
                    await getPrisma(req).productImage.deleteMany({ where: { productId: product.id } })
                    await getPrisma(req).productImage.createMany({
                        data: imageUrls.map((url, idx) => ({ productId: product.id, url, isPrimary: idx === 0 }))
                    })
                }

                imported++
            } catch (err: any) {
                errors.push(`Dòng ${i + 2}: ${err?.message?.slice(0, 80) || 'Lỗi'}`)
            }

            // Send progress every 10 rows
            if (useSSE && (i % 10 === 0 || i === rows.length - 1)) {
                sendProgress(res, { current: i + 1, total: rows.length, imported, errors: errors.length, message: `Đang xử lý: ${name}` })
            }
        }
        console.log(`[ImportData] Products result: imported=${imported}, total=${rows.length}, errors=${errors.length}`)
        if (useSSE) {
            sendDone(res, { imported, total: rows.length, errors: errors.slice(0, 10) })
        } else {
            res.json({ success: true, imported, total: rows.length, errors: errors.slice(0, 10) })
        }
    } catch (err: any) {
        console.error('[ImportData] Products error:', err)
        if (req.query.stream === 'true') {
            sendError(res, err?.message || 'Import thất bại')
        } else {
            res.status(500).json({ success: false, error: errMsg(err, 'Import thất bại') })
        }
    }
})

// ═══════════════════════════════════════════════════════════════════
// POST /api/import-data/transactions
// ═══════════════════════════════════════════════════════════════════
router.post('/transactions', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Vui lòng upload file Excel' })
        const rows = parseExcel(req.file.buffer)
        if (!rows.length) return res.status(400).json({ success: false, error: 'File Excel trống' })

        const branchId = await resolveBranchId(req)
        const userId = req.user?.userId
        if (!userId) return res.status(400).json({ success: false, error: 'Không xác định được user' })

        const grouped = new Map<string, typeof rows>()
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            const receiptNumber = col(row, 'Mã đơn', 'Mã hóa đơn', 'receipt_number', 'Mã Đơn') || `TXN-IMP-${Date.now()}-${i}`
            if (!grouped.has(receiptNumber)) grouped.set(receiptNumber, [])
            grouped.get(receiptNumber)!.push(row)
        }

        const useSSE = req.query.stream === 'true'
        if (useSSE) setupSSE(res)

        let imported = 0
        const errors: string[] = []
        let orderIdx = 0

        for (const [receiptNumber, itemRows] of grouped) {
            try {
                const firstRow = itemRows[0]
                const customerCode = col(firstRow, 'Mã KH', 'Mã khách hàng', 'customer_code', 'ma_kh') || null
                const customerName = col(firstRow, 'Khách hàng', 'Tên KH', 'customer', 'Khách Hàng') || null
                const customerPhone = col(firstRow, 'SĐT', 'Số điện thoại', 'phone') || null
                const notes = col(firstRow, 'Ghi chú', 'notes') || null
                const dateStr = col(firstRow, 'Ngày giờ', 'Ngày', 'Thời gian', 'Date', 'DateTime', 'ngay_gio')
                const createdAt = dateStr ? parseDateTime(dateStr, 12, 0) : new Date()

                // Look up customerId from customer code, phone, or name
                let customerId: string | null = null
                if (customerCode) {
                    const customer = await getPrisma(req).customer.findFirst({ where: { code: customerCode } })
                    if (customer) customerId = customer.id
                }
                if (!customerId && customerPhone) {
                    const customer = await getPrisma(req).customer.findFirst({ where: { phone: customerPhone } })
                    if (customer) customerId = customer.id
                }
                if (!customerId && customerName) {
                    const customer = await getPrisma(req).customer.findFirst({ where: { name: customerName } })
                    if (customer) customerId = customer.id
                }

                const itemsData: { productId: string; productName: string; sku: string; quantity: number; unitPrice: number; discount: number; lineTotal: number }[] = []
                for (const row of itemRows) {
                    const sku = col(row, 'Mã hàng', 'SKU', 'Mã sản phẩm', 'sku')
                    if (!sku) continue
                    const product = await getPrisma(req).product.findFirst({ where: { sku } })
                    if (!product) { errors.push(`Mã hàng "${sku}" không tồn tại`); continue }
                    const qty = Math.round(toNumber(col(row, 'Số lượng', 'SL', 'quantity', 'Số Lượng')))
                    const price = toNumber(col(row, 'Đơn giá', 'Giá bán', 'unit_price', 'Đơn Giá')) || product.sellingPrice
                    if (qty <= 0) continue
                    // "Giảm giá" trong Excel là giảm trên ĐƠN GIÁ (mỗi cái), nên giảm cả dòng = giảm/cái × SL.
                    // Item.discount lưu theo TỔNG cả dòng (khớp cách hiển thị & cách tính total ở nơi khác).
                    const unitDiscount = toNumber(col(row, 'Giảm giá', 'Chiết khấu', 'discount'))
                    const lineDiscount = Math.max(0, unitDiscount * qty)
                    itemsData.push({ productId: product.id, productName: product.name, sku, quantity: qty, unitPrice: price, discount: lineDiscount, lineTotal: Math.max(0, qty * price - lineDiscount) })
                }
                if (itemsData.length === 0) { orderIdx++; continue }

                const subtotal = itemsData.reduce((s, i) => s + (i.quantity * i.unitPrice), 0)
                const discount = itemsData.reduce((s, i) => s + i.discount, 0)
                const total = subtotal - discount

                // Đơn import = đã thu đủ (status completed). Tạo 1 phiếu thu (Payment non-credit)
                // cho cả đơn để: (1) khớp với "Tiền vào" ở Sổ quỹ, (2) sau này HUỶ PHIẾU THU được
                // — cancel-receipt yêu cầu có payment non-credit, nếu không sẽ báo "Không có phiếu
                // thu để hủy". Mặc định tiền mặt; đọc cột 'Thanh toán'/'Hình thức' nếu file có.
                const payRaw = col(firstRow, 'Thanh toán', 'Hình thức', 'Hình thức TT', 'Phương thức', 'payment_method', 'thanh_toan').toLowerCase()
                let payType = 'cash'
                if (payRaw.includes('chuyển') || payRaw.includes('ck') || payRaw.includes('transfer') || payRaw.includes('bank')) payType = 'transfer'
                else if (payRaw.includes('thẻ') || payRaw.includes('card')) payType = 'card'
                else if (payRaw.includes('ví') || payRaw.includes('ewallet') || payRaw.includes('momo') || payRaw.includes('vnpay')) payType = 'ewallet'
                const paymentsCreate = total > 0 ? [{ type: payType, amount: total, reference: `Phiếu thu import ${receiptNumber}` }] : []

                // Upsert: if receiptNumber already exists, update; otherwise create
                const existing = await getPrisma(req).transaction.findUnique({ where: { receiptNumber } })
                if (existing) {
                    // Re-import ghi đè: HOÀN KHO items cũ trước khi xóa — nếu không, mỗi lần
                    // import lại cùng file kho bị trừ thêm 1 lần (hoàn cũ + trừ mới → net = 0)
                    const oldItems = await getPrisma(req).transactionItem.findMany({ where: { transactionId: existing.id } })
                    for (const oldItem of oldItems) {
                        await adjustSellableStock(getPrisma(req), oldItem.productId, branchId, oldItem.quantity)
                    }
                    await getPrisma(req).transactionItem.deleteMany({ where: { transactionId: existing.id } })

                    // GIỮ LẠI payment type 'credit' (sinh từ "Hủy phiếu thu" — đã tăng
                    // Customer.debt + ghi DebtEntry). Xóa credit ở đây làm công nợ lệch
                    // không có bút toán bù; chỉ xóa các phiếu thu thường rồi tạo lại.
                    const keptCredits = await getPrisma(req).payment.findMany({ where: { transactionId: existing.id, type: 'credit' } })
                    const creditKept = keptCredits.reduce((s, p) => s + (p.amount || 0), 0)
                    await getPrisma(req).payment.deleteMany({ where: { transactionId: existing.id, type: { not: 'credit' } } })

                    // amountReceived = tổng thanh toán từ file − phần đã hủy thu (credit giữ lại), floor 0.
                    // Phiếu thu tạo lại cũng chỉ bằng phần thực thu để khớp Sổ quỹ / luồng hủy phiếu thu.
                    const received = Math.max(0, total - creditKept)
                    const paymentsForUpdate = received > 0 ? [{ type: payType, amount: received, reference: `Phiếu thu import ${receiptNumber}` }] : []
                    await getPrisma(req).transaction.update({
                        where: { id: existing.id },
                        data: {
                            customerName, customerPhone, customerId,
                            subtotal, discount, total, amountReceived: received, branchId: branchId || null,
                            // còn credit giữ lại = chưa thu đủ → status 'partial' như luồng hủy phiếu thu
                            status: creditKept > 0 ? 'partial' : 'completed', notes, createdAt,
                            items: { create: itemsData },
                            payments: { create: paymentsForUpdate }
                        }
                    })
                } else {
                    const donMoi = await getPrisma(req).transaction.create({
                        include: {
                            items: { include: { product: { select: { costPrice: true } } } },
                            payments: true,
                        },
                        data: {
                            receiptNumber, customerName, customerPhone,
                            customerId,
                            subtotal, discount, total, amountReceived: total, branchId: branchId || null,
                            status: 'completed', createdBy: userId, notes,
                            createdAt,
                            items: { create: itemsData },
                            payments: { create: paymentsCreate }
                        }
                    })
                    /* GHI SỔ (03/09/2026 — điểm đứt 4). Nhập liệu hàng loạt trước nay
                     * đổ phiếu bán vào rồi dừng: số chứng từ nhảy vọt mà sổ đứng yên.
                     * `createdAt` ở đây đã là NGÀY CHỨNG TỪ GỐC nên bút toán vào đúng kỳ. */
                    await thuGhiSo(`HĐ ${receiptNumber}`, () => createJournalEntriesForTransaction(
                        getPrisma(req), donMoi as any,
                        { branchId: branchId || null, userId },
                    ))
                }

                for (const item of itemsData) {
                    await adjustSellableStock(getPrisma(req), item.productId, branchId, -item.quantity)
                }
                imported++
            } catch (err: any) {
                errors.push(`Đơn ${receiptNumber}: ${err?.message?.slice(0, 80) || 'Lỗi'}`)
            }
            orderIdx++
            if (useSSE) sendProgress(res, { current: orderIdx, total: grouped.size, imported, errors: errors.length, message: `Đang xử lý đơn: ${receiptNumber}` })
        }
        if (useSSE) {
            sendDone(res, { imported, total: grouped.size, errors: errors.slice(0, 10) })
        } else {
            res.json({ success: true, imported, total: grouped.size, errors: errors.slice(0, 10) })
        }
    } catch (err: any) {
        console.error('[ImportData] Transactions error:', err)
        if (req.query.stream === 'true') {
            sendError(res, err?.message || 'Import thất bại')
        } else {
            res.status(500).json({ success: false, error: errMsg(err, 'Import thất bại') })
        }
    }
})

// ═══════════════════════════════════════════════════════════════════
// POST /api/import-data/import-receipts
// ═══════════════════════════════════════════════════════════════════
router.post('/import-receipts', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Vui lòng upload file Excel' })
        const rows = parseExcel(req.file.buffer)
        if (!rows.length) return res.status(400).json({ success: false, error: 'File Excel trống' })

        const branchId = await resolveBranchId(req)
        const userId = req.user?.userId
        if (!userId) return res.status(400).json({ success: false, error: 'Không xác định được user' })

        const grouped = new Map<string, typeof rows>()
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            const code = col(row, 'Mã phiếu', 'Mã nhập', 'receipt_code', 'Mã Phiếu') || `IR-IMP-${Date.now()}-${i}`
            if (!grouped.has(code)) grouped.set(code, [])
            grouped.get(code)!.push(row)
        }

        const useSSE = req.query.stream === 'true'
        if (useSSE) setupSSE(res)

        let imported = 0
        const errors: string[] = []
        let orderIdx = 0

        for (const [code, itemRows] of grouped) {
            try {
                const firstRow = itemRows[0]
                const supplierName = col(firstRow, 'Nhà cung cấp', 'NCC', 'supplier') || 'NCC chưa xác định'
                const note = col(firstRow, 'Ghi chú', 'notes') || null
                const dateStr = col(firstRow, 'Ngày giờ', 'Ngày', 'Thời gian', 'Date', 'DateTime', 'ngay_gio')
                const createdAt = dateStr ? parseDateTime(dateStr, 10, 0) : new Date()

                const itemsData: { productId: string; productName: string; productSku: string; quantity: number; costPrice: number; discount: number; total: number }[] = []
                for (const row of itemRows) {
                    const sku = col(row, 'Mã hàng', 'SKU', 'Mã sản phẩm', 'sku')
                    if (!sku) continue
                    const product = await getPrisma(req).product.findFirst({ where: { sku } })
                    if (!product) { errors.push(`Mã hàng "${sku}" không tồn tại`); continue }
                    const qty = Math.round(toNumber(col(row, 'Số lượng', 'SL', 'quantity', 'Số Lượng')))
                    const price = toNumber(col(row, 'Đơn giá', 'Giá nhập', 'unit_price', 'Đơn Giá')) || product.costPrice
                    const itemDiscount = toNumber(col(row, 'Giảm giá', 'Chiết khấu', 'discount'))
                    if (qty <= 0) continue
                    itemsData.push({ productId: product.id, productName: product.name, productSku: sku, quantity: qty, costPrice: price, discount: itemDiscount, total: Math.max(0, qty * price - itemDiscount) })
                }
                if (itemsData.length === 0) { orderIdx++; continue }

                const totalCost = itemsData.reduce((s, i) => s + i.total, 0)
                const totalItems = itemsData.reduce((s, i) => s + i.quantity, 0)

                // TỒN KHO THUẾ chỉ tính phiếu CÓ hoá đơn VAT thật. Trước đây cứ mã
                // nào không phải TXN-IMP- tự sinh là bật cờ → mã phiếu nội bộ trong
                // file Excel ("PN001", "NH-2026-01") cũng bị tính là có hoá đơn VAT,
                // thổi phồng tồn kho thuế và mở cổng xuất HĐ bán khống (rủi ro thuế).
                // Nay PHẢI khai báo tường minh (?hasVatInvoice=1 hoặc cột trong file).
                const hasVatInvoice = String(req.query.hasVatInvoice || req.body?.hasVatInvoice || '') === '1'
                    || String(req.query.hasVatInvoice || req.body?.hasVatInvoice || '').toLowerCase() === 'true'
                const phieuMoi = await getPrisma(req).importReceipt.create({
                    data: {
                        code, supplierName, totalCost, totalItems, branchId: branchId || null,
                        status: 'completed', note, userId, userName: 'Import',
                        hasVatInvoice, vatInvoiceNo: hasVatInvoice ? String(code) : null,
                        createdAt,
                        items: { create: itemsData }
                    }
                })
                // GHI SỔ: Nợ 156 / Có 331 — điểm đứt 4
                await thuGhiSo(`Phiếu nhập ${code}`, async () => postImportReceiptJournal(
                    getPrisma(req), phieuMoi as any,
                    { branchId: branchId || null, userId, vatKhauTru: await coKhauTruVat(getPrisma(req)) },
                ))

                for (const item of itemsData) {
                    await adjustSellableStock(getPrisma(req), item.productId, branchId, item.quantity)
                }
                imported++
            } catch (err: any) {
                errors.push(`Phiếu ${code}: ${err?.message?.slice(0, 80) || 'Lỗi'}`)
            }
            orderIdx++
            if (useSSE) sendProgress(res, { current: orderIdx, total: grouped.size, imported, errors: errors.length, message: `Đang xử lý phiếu: ${code}` })
        }
        if (useSSE) {
            sendDone(res, { imported, total: grouped.size, errors: errors.slice(0, 10) })
        } else {
            res.json({ success: true, imported, total: grouped.size, errors: errors.slice(0, 10) })
        }
    } catch (err: any) {
        console.error('[ImportData] ImportReceipts error:', err)
        if (req.query.stream === 'true') sendError(res, err?.message || 'Import thất bại')
        else res.status(500).json({ success: false, error: errMsg(err, 'Import thất bại') })
    }
})

// ═══════════════════════════════════════════════════════════════════
// POST /api/import-data/returns
// ═══════════════════════════════════════════════════════════════════
router.post('/returns', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Vui lòng upload file Excel' })
        const rows = parseExcel(req.file.buffer)
        if (!rows.length) return res.status(400).json({ success: false, error: 'File Excel trống' })

        const branchId = await resolveBranchId(req)

        const grouped = new Map<string, typeof rows>()
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            const code = col(row, 'Mã trả hàng', 'Mã phiếu', 'return_code', 'Mã Trả Hàng') || `RTN-IMP-${Date.now()}-${i}`
            if (!grouped.has(code)) grouped.set(code, [])
            grouped.get(code)!.push(row)
        }

        const useSSE = req.query.stream === 'true'
        if (useSSE) setupSSE(res)

        let imported = 0
        const errors: string[] = []
        let orderIdx = 0

        for (const [code, itemRows] of grouped) {
            try {
                const firstRow = itemRows[0]
                const originalInvoice = col(firstRow, 'Mã đơn gốc', 'Hóa đơn gốc', 'original_invoice') || 'N/A'
                const reason = col(firstRow, 'Lý do', 'Lý do trả', 'reason') || 'Import từ hệ thống cũ'
                const customerName = col(firstRow, 'Khách hàng', 'Tên KH', 'customer') || 'Khách lẻ'
                const customerPhone = col(firstRow, 'SĐT', 'Số điện thoại', 'phone') || null
                const notes = col(firstRow, 'Ghi chú', 'notes') || null
                const dateStr = col(firstRow, 'Ngày giờ', 'Ngày', 'Thời gian', 'Date', 'DateTime', 'ngay_gio')
                const createdAt = dateStr ? parseDateTime(dateStr, 9, 0) : new Date()

                const itemsList: { sku: string; name: string; quantity: number; unitPrice: number; total: number; productId: string }[] = []
                for (const row of itemRows) {
                    const sku = col(row, 'Mã hàng', 'SKU', 'Mã sản phẩm', 'sku')
                    if (!sku) continue
                    const product = await getPrisma(req).product.findFirst({ where: { sku } })
                    if (!product) { errors.push(`Mã hàng "${sku}" không tồn tại`); continue }
                    const qty = Math.round(toNumber(col(row, 'Số lượng', 'SL', 'quantity', 'Số Lượng')))
                    const price = toNumber(col(row, 'Đơn giá', 'Giá bán', 'unit_price', 'Đơn Giá')) || product.sellingPrice
                    if (qty <= 0) continue
                    itemsList.push({ sku, name: product.name, quantity: qty, unitPrice: price, total: qty * price, productId: product.id })
                }
                if (itemsList.length === 0) { orderIdx++; continue }

                const totalRefund = itemsList.reduce((s, i) => s + i.total, 0)

                // ReturnOrder.items là relation sang ReturnItem — phải nested create,
                // truyền chuỗi JSON sẽ bị Prisma reject và cả phiếu import fail.
                await getPrisma(req).returnOrder.create({
                    data: {
                        code, originalInvoice, customerName, customerPhone,
                        reason, notes, status: 'refunded', branchId: branchId || null,
                        totalRefund, createdAt,
                        items: {
                            create: itemsList.map(i => ({
                                productId: i.productId,
                                productName: i.name,
                                sku: i.sku,
                                quantity: i.quantity,
                                unitPrice: i.unitPrice,
                                restocked: true,
                            }))
                        },
                    }
                })

                /* GHI SỔ: Nợ 5212 / Có 111 + nhập lại kho — điểm đứt 4.
                 * Phiếu import đặt sẵn status 'refunded' và restocked=true, tức hàng
                 * ĐÃ về kho, nên ghi luôn vế nhập lại kho theo giá vốn hiện tại của
                 * mã hàng. Không tra được giá vốn thì để 0 và bộ đối chiếu soi ra —
                 * đoán một con số là làm sai giá vốn. */
                await thuGhiSo(`Trả hàng ${code}`, async () => {
                    let giaVon = 0
                    for (const i2 of itemsList) {
                        if (!i2.productId) continue
                        const sp2 = await getPrisma(req).product.findUnique({
                            where: { id: i2.productId }, select: { costPrice: true },
                        })
                        giaVon += (sp2?.costPrice ?? 0) * (i2.quantity ?? 0)
                    }
                    return postReturnJournal(getPrisma(req), {
                        code, customerName, originalInvoice,
                        totalRefund, refundMethod: 'cash', costValue: giaVon,
                        branchId: branchId || null, createdAt,
                    }, { branchId: branchId || null })
                })

                for (const item of itemsList) {
                    await adjustSellableStock(getPrisma(req), item.productId, branchId, item.quantity)
                }
                imported++
            } catch (err: any) {
                errors.push(`Phiếu ${code}: ${err?.message?.slice(0, 80) || 'Lỗi'}`)
            }
            orderIdx++
            if (useSSE) sendProgress(res, { current: orderIdx, total: grouped.size, imported, errors: errors.length, message: `Đang xử lý trả hàng: ${code}` })
        }
        if (useSSE) {
            sendDone(res, { imported, total: grouped.size, errors: errors.slice(0, 10) })
        } else {
            res.json({ success: true, imported, total: grouped.size, errors: errors.slice(0, 10) })
        }
    } catch (err: any) {
        console.error('[ImportData] Returns error:', err)
        if (req.query.stream === 'true') sendError(res, err?.message || 'Import thất bại')
        else res.status(500).json({ success: false, error: errMsg(err, 'Import thất bại') })
    }
})

// ═══════════════════════════════════════════════════════════════════
// POST /api/import-data/customers
// ═══════════════════════════════════════════════════════════════════
router.post('/customers', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Vui lòng upload file Excel' })
        const rows = parseExcel(req.file.buffer)
        if (!rows.length) return res.status(400).json({ success: false, error: 'File Excel trống' })


        const useSSE = req.query.stream === 'true'
        if (useSSE) setupSSE(res)

        let imported = 0
        const errors: string[] = []

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            const code = col(row, 'Mã KH', 'Mã khách hàng', 'code', 'customer_code')
            if (!code) { errors.push(`Dòng ${i + 2}: Thiếu mã khách`); continue }

            const name = col(row, 'Tên khách hàng', 'Tên KH', 'Tên', 'name', 'customer_name') || code
            const phone = col(row, 'SĐT', 'Số điện thoại', 'Phone', 'phone', 'sdt') || '' // Customer.phone non-nullable
            const email = col(row, 'Email', 'email') || null
            const address = col(row, 'Địa chỉ', 'Address', 'dia_chi') || null
            const groupName = col(row, 'Nhóm KH', 'Nhóm khách hàng', 'group', 'nhom_kh')
            const birthday = col(row, 'Ngày sinh', 'Birthday', 'ngay_sinh') || null
            const genderRaw = col(row, 'Giới tính', 'Gender', 'gioi_tinh') || null
            const notes = col(row, 'Ghi chú', 'Notes', 'ghi_chu') || null
            const debt = toNumber(col(row, 'Công nợ', 'Nợ', 'Debt', 'cong_no'))

            let gender: string | null = null
            if (genderRaw) {
                const g = genderRaw.toLowerCase()
                if (g.includes('nam') || g === 'male') gender = 'male'
                else if (g.includes('nữ') || g === 'female') gender = 'female'
                else gender = 'other'
            }

            try {
                let groupId: string | null = null
                if (groupName) {
                    let group = await getPrisma(req).customerGroup.findFirst({ where: { name: groupName } })
                    if (!group) group = await getPrisma(req).customerGroup.create({ data: { name: groupName } })
                    groupId = group.id
                }

                const existing = await getPrisma(req).customer.findFirst({ where: { code } })
                const customerData = {
                    name, phone, email, address, birthday, gender, notes, debt,
                    ...(groupId ? { groupId } : {})
                }

                if (existing) {
                    await getPrisma(req).customer.update({ where: { id: existing.id }, data: customerData })
                } else {
                    await getPrisma(req).customer.create({ data: { code, ...customerData } })
                }
                imported++
            } catch (err: any) {
                errors.push(`Dòng ${i + 2}: ${err?.message?.slice(0, 80) || 'Lỗi'}`)
            }

            if (useSSE && (i % 5 === 0 || i === rows.length - 1)) {
                sendProgress(res, { current: i + 1, total: rows.length, imported, errors: errors.length, message: `Đang xử lý: ${name}` })
            }
        }
        if (useSSE) {
            sendDone(res, { imported, total: rows.length, errors: errors.slice(0, 10) })
        } else {
            res.json({ success: true, imported, total: rows.length, errors: errors.slice(0, 10) })
        }
    } catch (err: any) {
        console.error('[ImportData] Customers error:', err)
        if (req.query.stream === 'true') sendError(res, err?.message || 'Import thất bại')
        else res.status(500).json({ success: false, error: errMsg(err, 'Import thất bại') })
    }
})

// ═══════════════════════════════════════════════════════════════════
// POST /api/import-data/suppliers
// ═══════════════════════════════════════════════════════════════════
router.post('/suppliers', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Vui lòng upload file Excel' })
        const rows = parseExcel(req.file.buffer)
        if (!rows.length) return res.status(400).json({ success: false, error: 'File Excel trống' })


        const useSSE = req.query.stream === 'true'
        if (useSSE) setupSSE(res)

        let imported = 0
        const errors: string[] = []

        console.log(`[ImportData] Suppliers: ${rows.length} rows`)

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            const code = col(row, 'Mã NCC', 'Mã nhà cung cấp', 'code', 'supplier_code')
            if (!code) { errors.push(`Dòng ${i + 2}: Thiếu mã NCC`); continue }

            const name = col(row, 'Tên NCC', 'Tên nhà cung cấp', 'Nhà cung cấp', 'name', 'supplier_name') || code
            const contactName = col(row, 'Người liên hệ', 'Liên hệ', 'contact', 'contact_name') || null
            const phone = col(row, 'SĐT', 'Số điện thoại', 'Phone', 'phone', 'sdt') || null
            const email = col(row, 'Email', 'email') || null
            const address = col(row, 'Địa chỉ', 'Address', 'dia_chi') || null
            const taxCode = col(row, 'MST', 'Mã số thuế', 'Tax', 'tax_code', 'ma_so_thue') || null
            const notes = col(row, 'Ghi chú', 'Notes', 'ghi_chu') || null
            const payable = toNumber(col(row, 'Công nợ', 'Nợ', 'payable', 'cong_no'))

            try {
                const existing = await getPrisma(req).supplier.findFirst({ where: { code } })
                const supplierData = { name, contactName, phone, email, address, taxCode, notes, payable }

                if (existing) {
                    await getPrisma(req).supplier.update({ where: { id: existing.id }, data: supplierData })
                } else {
                    await getPrisma(req).supplier.create({ data: { code, ...supplierData } })
                }
                imported++
            } catch (err: any) {
                errors.push(`Dòng ${i + 2}: ${err?.message?.slice(0, 80) || 'Lỗi'}`)
            }

            if (useSSE && (i % 5 === 0 || i === rows.length - 1)) {
                sendProgress(res, { current: i + 1, total: rows.length, imported, errors: errors.length, message: `Đang xử lý: ${name}` })
            }
        }

        console.log(`[ImportData] Suppliers result: imported=${imported}, total=${rows.length}, errors=${errors.length}`)
        if (useSSE) {
            sendDone(res, { imported, total: rows.length, errors: errors.slice(0, 10) })
        } else {
            res.json({ success: true, imported, total: rows.length, errors: errors.slice(0, 10) })
        }
    } catch (err: any) {
        console.error('[ImportData] Suppliers error:', err)
        if (req.query.stream === 'true') sendError(res, err?.message || 'Import thất bại')
        else res.status(500).json({ success: false, error: errMsg(err, 'Import thất bại') })
    }
})

// ═══════════════════════════════════════════════════════════════════════════
//  NHẬP HÀNG TỪ HOÁ ĐƠN ĐIỆN TỬ (PDF / XML)
//  - XML: chuẩn hoá đơn VN TT78 (HDon → NDHDon → DSHHDVu → HHDVu) — parse regex
//    theo schema quốc gia cố định, không cần thêm dependency XML.
//  - PDF: pdf-parse rút text + heuristic bảng (kém tin cậy hơn XML — trả gì
//    được nấy, người dùng duyệt lại trước khi tạo phiếu).
//  - Khớp SP theo tên/SKU; ?autoCreate=1 → SP chưa có thì TỰ TẠO MÃ HÀNG MỚI
//    (yêu cầu chủ shop: "không có hàng hoá trong kho thì tự tạo mã hàng").
// ═══════════════════════════════════════════════════════════════════════════

type ParsedInvoiceItem = {
    name: string; unit: string; quantity: number; unitPrice: number; amount: number
    // Thuế GTGT theo TỪNG DÒNG — giá nhập kho tính GỒM VAT (HKD không khấu trừ đầu vào)
    vatRate?: number; vatAmount?: number
    productId?: string; productSku?: string; matched?: boolean; created?: boolean
    // Hệ số đã quy đổi từ ĐVT hoá đơn sang ĐVT kho (vd 1 vỉ = 10 cái → 10)
    convertedBy?: number
}

function xmlTag(block: string, tag: string): string {
    const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
    return m ? m[1].trim() : ''
}
function xmlNum(block: string, tag: string): number {
    const raw = xmlTag(block, tag).replace(/,/g, '.')
    const n = parseFloat(raw)
    return Number.isFinite(n) ? n : 0
}

function parseVnEInvoiceXml(xml: string) {
    const items: ParsedInvoiceItem[] = []
    const rows = xml.match(/<HHDVu>[\s\S]*?<\/HHDVu>/gi) || []
    for (const row of rows) {
        const name = xmlTag(row, 'THHDVu')
        if (!name) continue
        const quantity = xmlNum(row, 'SLuong')
        const unitPrice = xmlNum(row, 'DGia')
        const amount = xmlNum(row, 'ThTien') || quantity * unitPrice
        // TSuat dạng "8%"/"10%"/"KCT"; TThue = tiền thuế dòng (có thể thiếu → tự tính)
        const vatRate = parseFloat(xmlTag(row, 'TSuat').replace('%', '')) || 0
        const vatAmount = xmlNum(row, 'TThue') || (vatRate > 0 ? Math.round(amount * vatRate / 100) : 0)
        items.push({ name, unit: xmlTag(row, 'DVTinh') || 'cái', quantity: quantity || 1, unitPrice, amount, vatRate, vatAmount })
    }
    const sellerBlock = (xml.match(/<NBan>[\s\S]*?<\/NBan>/i) || [''])[0]
    return {
        format: 'xml' as const,
        invoiceNumber: xmlTag(xml, 'SHDon'),
        invoiceDate: xmlTag(xml, 'NLap'),
        sellerName: xmlTag(sellerBlock, 'Ten'),
        sellerTaxCode: xmlTag(sellerBlock, 'MST'),
        // Tổng CHUẨN in trên hoá đơn — FE dùng để cân phần lẻ làm tròn từng dòng
        totals: {
            subtotal: xmlNum(xml, 'TgTCThue'),
            vatTotal: xmlNum(xml, 'TgTThue'),
            grandTotal: xmlNum(xml, 'TgTTTBSo'),
        },
        items,
    }
}

/** Số kiểu VN/US: "1.574.074", "78.703,70", "20,00", "1,234,567.89" → number. */
function vnNum(s: string): number {
    let t = String(s).trim()
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')      // 1.574.074 / 78.703,70
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '')                     // 1,574,074.50
    else if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')                   // 20,00
    else t = t.replace(/,/g, '')
    const n = parseFloat(t)
    return Number.isFinite(n) ? n : 0
}

/**
 * Đọc bảng hàng hoá từ text PDF hoá đơn VN (đã test với mẫu MISA meInvoice).
 * Tên hàng thường TRÀN nhiều dòng → gom từ dòng bắt đầu bằng STT tới khi gặp
 * "đuôi số": <ĐVT> <SL> <đơn giá> <thành tiền> [<thuế%> <tiền thuế>].
 * Chỉ nhận dòng có thành tiền ≈ SL × đơn giá (±2%) để lọc rác.
 */
function parseInvoicePdfText(text: string) {
    const items: ParsedInvoiceItem[] = []
    const lines = text.replace(/\t/g, ' ').split(/\r?\n/).map(l => l.trim())
    const tailRe = /([A-Za-zÀ-ỹ]{1,12})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)(?:\s+(\d{1,2})%\s*([\d.,]+)?)?\s*$/
    const startRe = /^(\d{1,3})\s+\S/
    const stopRe = /^(Tổng hợp|Tổng cộng|Cộng tiền|Số tiền viết|Thuế suất)/i

    // Rác chân trang PDF ("2/3", "tiếp theo", "trang sau") dính vào ĐUÔI dòng hàng
    // cuối trang → tailRe (neo cuối dòng) trượt → RƠI MẤT dòng đó (bug thật: mất
    // dòng 87.037+6.963 = lệch đúng 94.000đ trên HĐ 2057).
    const pageJunkRe = /^(trang\s+)?\d{1,2}\/\d{1,2}\b|^ti[eế]p\s*theo|^\(ti[eế]p|^trang\s+(sau|\d)|^-{2,}|^\d+\s+of\s+\d+/i
    let buf = ''
    const flush = () => {
        if (!buf) return
        // Fallback: cắt rác chân trang ("2/3", "tiếp theo"…) ở đuôi rồi thử khớp
        // lại — tên phải slice trên ĐÚNG chuỗi đã dùng để match.
        let work = buf
        let m = work.match(tailRe)
        if (!m) {
            work = buf.replace(/\s+\d{1,2}\/\d{1,2}\b[\s\S]*$/, '')
            m = work.match(tailRe)
        }
        if (!m) {
            work = buf.replace(/\s+ti[eế]p\s*th[\s\S]*$/i, '')
            m = work.match(tailRe)
        }
        if (!m) {
            work = buf.replace(/\s+-{2,}[\s\S]*$/, '') // "-- 2 of 3 --" dính đuôi
            m = work.match(tailRe)
        }
        if (!m) {
            // Fallback TỔNG QUÁT cho mọi loại rác dính đuôi (header bảng lặp lại ở
            // trang sau, chân trang lạ…): cắt dần từng token cuối tới khi khớp đuôi.
            // An toàn vì tailRe + kiểm tra thành tiền ≈ SL×đơn giá (±2%) vẫn gác.
            let w = buf
            for (let k = 0; k < 40 && !m; k++) {
                const w2 = w.replace(/\s+\S+$/, '')
                if (w2 === w) break
                w = w2
                m = w.match(tailRe)
            }
            if (m) work = w
        }
        if (m) {
            const stt = work.match(/^(\d{1,3})\s+/)
            const name = work.slice(stt ? stt[0].length : 0, work.length - m[0].length).trim()
            const quantity = vnNum(m[2])
            const unitPrice = vnNum(m[3])
            const amount = vnNum(m[4])
            if (name && quantity > 0 && unitPrice > 0 && amount > 0) {
                const calc = quantity * unitPrice
                if (Math.abs(calc - amount) / amount <= 0.02) {
                    const vatRate = m[5] ? parseInt(m[5], 10) : 0
                    const vatAmount = m[6] ? vnNum(m[6]) : (vatRate > 0 ? Math.round(amount * vatRate / 100) : 0)
                    items.push({ name, unit: m[1], quantity, unitPrice, amount, vatRate, vatAmount })
                }
            }
        }
        buf = ''
    }

    for (const line of lines) {
        if (stopRe.test(line)) { flush(); break }
        if (pageJunkRe.test(line)) continue // chân trang — không cho dính vào dòng hàng
        if (startRe.test(line)) { flush(); buf = line; continue }
        if (buf) {
            buf += ' ' + line
            if (tailRe.test(buf) && /[\d.,]+\s*$/.test(line)) flush()
        }
    }
    flush()

    const invNo = text.match(/Số:\s*(\d{1,10})/) || text.match(/(?:Số hóa đơn|SHDon)\s*[:#]?\s*(\d{1,10})/i)
    const seller = lines.find(l => /^(CÔNG TY|CTY|DNTN|HỘ KINH DOANH|HTX)/i.test(l)) || ''
    const mst = text.match(/Mã số thuế:\s*([\d-]{10,14})/)
    // Ngày lập HĐ VN: "Ngày 21 tháng 01 năm 2026" (hoặc dd/MM/yyyy) → YYYY-MM-DD
    let invoiceDate = ''
    const dMy = text.match(/[Nn]gày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/)
    if (dMy) invoiceDate = `${dMy[3]}-${String(dMy[2]).padStart(2, '0')}-${String(dMy[1]).padStart(2, '0')}`
    else {
        const dmy2 = text.match(/[Nn]gày\s*(?:lập|ký)?\s*[:：]?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/)
        if (dmy2) invoiceDate = `${dmy2[3]}-${String(dmy2[2]).padStart(2, '0')}-${String(dmy2[1]).padStart(2, '0')}`
    }
    // Tổng CHUẨN của hoá đơn: dòng có 3 SỐ CUỐI "trước thuế  thuế  thanh toán"
    // (chấp nhận tiền tố chữ như "Tổng cộng:", "Thuế suất 8%:") với a + b ≈ c và
    // a ≈ tổng thành tiền các dòng hàng (±2%) — tránh vớ nhầm dòng hàng (dòng hàng
    // có "8%" chen giữa nên không khớp mẫu 3-số-liền).
    const sumAmount = items.reduce((s, i) => s + i.amount, 0)
    let totals = { subtotal: 0, vatTotal: 0, grandTotal: 0 }
    for (const line of lines) {
        const m3 = line.match(/(\d[\d.,]*)\s+(\d[\d.,]*)\s+(\d[\d.,]*)\s*$/)
        if (!m3) continue
        const a = vnNum(m3[1]), b = vnNum(m3[2]), c = vnNum(m3[3])
        if (a > 0 && c > 0 && Math.abs(a + b - c) <= 2 && (sumAmount === 0 || Math.abs(a - sumAmount) / a <= 0.02)) {
            totals = { subtotal: a, vatTotal: b, grandTotal: c }
            break
        }
    }
    return {
        format: 'pdf' as const, invoiceNumber: invNo?.[1] || '', invoiceDate,
        sellerName: seller, sellerTaxCode: mst?.[1] || '', totals, items,
    }
}

router.post('/parse-invoice', authMiddleware, upload.single('file'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = getPrisma(req) as any
        if (!req.file) { res.status(400).json({ success: false, error: 'Chưa chọn file hoá đơn (PDF hoặc XML)' }); return }
        const fname = (req.file.originalname || '').toLowerCase()
        const buf = req.file.buffer

        let parsed: {
            format: string; invoiceNumber: string; invoiceDate: string; sellerName: string; sellerTaxCode: string
            totals?: { subtotal: number; vatTotal: number; grandTotal: number }
            items: ParsedInvoiceItem[]
        }
        const head = buf.slice(0, 200).toString('utf8')
        if (fname.endsWith('.xml') || head.includes('<?xml') || head.includes('<HDon')) {
            parsed = parseVnEInvoiceXml(buf.toString('utf8'))
            if (parsed.items.length === 0) { res.status(400).json({ success: false, error: 'XML không đúng chuẩn hoá đơn điện tử VN (không tìm thấy dòng hàng HHDVu)' }); return }
        } else if (fname.endsWith('.pdf') || head.startsWith('%PDF')) {
            // pdf-parse v2: API dạng class PDFParse (gọi kiểu hàm v1 → "pdfParse
            // is not a function" — chính là lỗi làm mọi PDF fail trước đây)
            const { PDFParse } = (await import('pdf-parse')) as any
            const parser = new PDFParse({ data: new Uint8Array(buf) })
            const out = await parser.getText()
            parsed = parseInvoicePdfText(String(out?.text || ''))
            if (parsed.items.length === 0) {
                res.status(400).json({ success: false, error: 'Không đọc được bảng hàng hoá từ PDF này (PDF dạng ảnh/scan hoặc bố cục lạ). Dùng file XML của hoá đơn sẽ chính xác 100%.' })
                return
            }
        } else {
            res.status(400).json({ success: false, error: 'Chỉ nhận file .xml hoặc .pdf' }); return
        }

        // ── Khớp sản phẩm theo tên (chính xác, không phân biệt hoa thường) hoặc SKU ──
        const autoCreate = String(req.query.autoCreate || req.body?.autoCreate || '') === '1'
        let defaultCategory: any = null
        for (const it of parsed.items) {
            const found = await prisma.product.findFirst({
                where: { OR: [{ name: { equals: it.name, mode: 'insensitive' } }, { sku: it.name }] },
            })
            if (found) {
                it.productId = found.id; it.productSku = found.sku; it.matched = true
                continue
            }
            // LIÊN KẾT ĐÃ NHỚ: người dùng từng link dòng hoá đơn cùng tên vào SP kho
            // (SkuMapping platform='invoice', key = tên dòng) → hoá đơn sau TỰ khớp,
            // không phải link lại từng lần.
            const remembered = await prisma.skuMapping.findFirst({
                where: { platform: 'invoice', platformSku: { equals: it.name, mode: 'insensitive' } },
                include: { product: { select: { id: true, sku: true, baseUnit: true } } },
            }).catch(() => null)
            if (remembered?.product) {
                it.productId = remembered.product.id; it.productSku = remembered.product.sku; it.matched = true
                // HỆ SỐ QUY ĐỔI: hoá đơn ghi 5 vỉ, kho đếm cái, vỉ = 10 cái → 50 cái,
                // đơn giá chia 10. THÀNH TIỀN GIỮ NGUYÊN (không đụng vào tiền của HĐ).
                const rate = Number((remembered as any).conversionRate) || 1
                if (rate > 0 && rate !== 1) {
                    it.quantity = (Number(it.quantity) || 0) * rate
                    it.unitPrice = it.quantity > 0 ? (Number(it.amount) || 0) / it.quantity : it.unitPrice
                    it.convertedBy = rate
                    it.unit = remembered.product.baseUnit || it.unit
                }
                continue
            }
            if (autoCreate) {
                if (!defaultCategory) {
                    defaultCategory = await prisma.category.findFirst({ where: { name: { equals: 'Chưa phân loại', mode: 'insensitive' } } })
                        || await prisma.category.create({ data: { name: 'Chưa phân loại' } })
                }
                const sku = 'SP' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase()
                const created = await prisma.product.create({
                    data: {
                        name: it.name, sku, categoryId: defaultCategory.id,
                        costPrice: it.unitPrice, sellingPrice: it.unitPrice,
                        baseUnit: it.unit || 'cái', stock: 0,
                    },
                })
                it.productId = created.id; it.productSku = created.sku; it.created = true
            }
        }

        res.json({ success: true, data: parsed })
    } catch (err: any) {
        console.error('parse-invoice error:', err?.message || err)
        res.status(500).json({ success: false, error: errMsg(err, 'Không đọc được file hoá đơn') })
    }
})

// Tạo nhanh 1 mã hàng từ dòng hoá đơn (khi người dùng chọn "Tạo mới" thay vì
// liên kết SKU sẵn có) — SKU tự sinh, vào nhóm "Chưa phân loại".
router.post('/quick-product', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = getPrisma(req) as any
        const name = String(req.body?.name || '').trim()
        if (!name) { res.status(400).json({ success: false, error: 'Thiếu tên hàng hoá' }); return }
        const costPrice = Math.max(0, Number(req.body?.costPrice) || 0)

        const dupe = await prisma.product.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
        if (dupe) { res.json({ success: true, data: dupe, existed: true }); return }

        const category = await prisma.category.findFirst({ where: { name: { equals: 'Chưa phân loại', mode: 'insensitive' } } })
            || await prisma.category.create({ data: { name: 'Chưa phân loại' } })
        const sku = 'SP' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase()
        const product = await prisma.product.create({
            data: {
                name, sku, categoryId: category.id,
                costPrice, sellingPrice: costPrice,
                baseUnit: String(req.body?.unit || 'cái'), stock: 0,
            },
        })
        res.json({ success: true, data: product })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err, 'Không tạo được mã hàng') })
    }
})

export default router
