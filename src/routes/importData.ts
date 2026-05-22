import { Router, Response } from 'express'
import { errMsg } from '../lib/errorResponse'
import multer from 'multer'
import * as XLSX from 'xlsx'
import { authMiddleware, AuthRequest, getBranchFilter, getBranchId } from '../middleware/auth'
import { PrismaClient as StorePrisma } from '../generated/store-client'

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
        headers: ['Mã NCC', 'Tên NCC', 'Người liên hệ', 'SĐT', 'Email', 'Địa chỉ', 'MST', 'Ghi chú'],
        sample: [['NCC001', 'Công ty TNHH ABC', 'Nguyễn Văn X', '0909123456', 'abc@company.vn', '123 Nguyễn Huệ, Q1', '0312345678', '']]
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

function toNumber(val: string): number {
    if (!val) return 0
    const cleaned = String(val).replace(/[^\d.,\-]/g, '').replace(',', '.')
    const n = parseFloat(cleaned)
    return isNaN(n) ? 0 : n
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
    if (!str) {
        const d = new Date(); d.setHours(defaultHour, defaultMin, 0, 0); return d
    }
    const match = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (match) return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]), parseInt(match[4]), parseInt(match[5]), parseInt(match[6] || '0'))
    const parts = str.split(/[\/\-\.]/)
    if (parts.length === 3 && parseInt(parts[2]) > 100)
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), defaultHour, defaultMin)
    const d = new Date(); d.setHours(defaultHour, defaultMin, 0, 0); return d
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
                if (existing) {
                    // Sản phẩm đã tồn tại (dữ liệu kỳ sau) → KHÔNG ghi đè stock
                    // Chỉ cập nhật tên, giá, category, brand
                    const { stock, ...updateData } = productData
                    product = await getPrisma(req).product.update({ where: { id: existing.id }, data: updateData })
                } else {
                    // Dòng đầu tiên (kỳ đầu) → tạo mới với stock = tồn đầu kỳ
                    product = await getPrisma(req).product.create({ data: { sku, ...productData } })
                }

                // InventoryTransaction for opening stock (tồn đầu kỳ = data ban đầu)
                if (openingStock > 0) {
                    await getPrisma(req).inventoryTransaction.create({
                        data: {
                            type: 'stocktaking', productId: product.id, productName: name, productSku: sku,
                            quantity: openingStock, reason: 'Tồn đầu kỳ - Import',
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
                    const itemDiscount = toNumber(col(row, 'Giảm giá', 'Chiết khấu', 'discount'))
                    if (qty <= 0) continue
                    itemsData.push({ productId: product.id, productName: product.name, sku, quantity: qty, unitPrice: price, discount: itemDiscount, lineTotal: Math.max(0, qty * price - itemDiscount) })
                }
                if (itemsData.length === 0) { orderIdx++; continue }

                const subtotal = itemsData.reduce((s, i) => s + (i.quantity * i.unitPrice), 0)
                const discount = itemsData.reduce((s, i) => s + i.discount, 0)
                const total = subtotal - discount

                // Upsert: if receiptNumber already exists, update; otherwise create
                const existing = await getPrisma(req).transaction.findUnique({ where: { receiptNumber } })
                if (existing) {
                    // Delete old items and update transaction
                    await getPrisma(req).transactionItem.deleteMany({ where: { transactionId: existing.id } })
                    await getPrisma(req).transaction.update({
                        where: { id: existing.id },
                        data: {
                            customerName, customerPhone, customerId,
                            subtotal, discount, total, branchId: branchId || null,
                            status: 'completed', notes, createdAt,
                            items: { create: itemsData }
                        }
                    })
                } else {
                    await getPrisma(req).transaction.create({
                        data: {
                            receiptNumber, customerName, customerPhone,
                            customerId,
                            subtotal, discount, total, branchId: branchId || null,
                            status: 'completed', createdBy: userId, notes,
                            createdAt,
                            items: { create: itemsData }
                        }
                    })
                }

                for (const item of itemsData) {
                    await getPrisma(req).product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } })
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

                await getPrisma(req).importReceipt.create({
                    data: {
                        code, supplierName, totalCost, totalItems, branchId: branchId || null,
                        status: 'completed', note, userId, userName: 'Import',
                        createdAt,
                        items: { create: itemsData }
                    }
                })

                for (const item of itemsData) {
                    await getPrisma(req).product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } })
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

                await getPrisma(req).returnOrder.create({
                    data: {
                        code, originalInvoice, customerName, customerPhone,
                        reason, notes, status: 'refunded', branchId: branchId || null,
                        items: JSON.stringify(itemsList), totalRefund,
                        createdAt
                    }
                })

                for (const item of itemsList) {
                    await getPrisma(req).product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } })
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
            const name = col(row, 'Tên khách hàng', 'Tên KH', 'Tên', 'name', 'customer_name')
            const phone = col(row, 'SĐT', 'Số điện thoại', 'Phone', 'phone', 'sdt')
            if (!name || !phone) { errors.push(`Dòng ${i + 2}: Thiếu tên hoặc SĐT`); continue }

            const code = col(row, 'Mã KH', 'Mã khách hàng', 'code', 'customer_code') || `KH-${Date.now()}-${i}`
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
            const name = col(row, 'Tên NCC', 'Tên nhà cung cấp', 'Nhà cung cấp', 'name', 'supplier_name')
            if (!name) { errors.push(`Dòng ${i + 2}: Thiếu tên nhà cung cấp`); continue }

            const code = col(row, 'Mã NCC', 'Mã nhà cung cấp', 'code', 'supplier_code') || `NCC-${Date.now()}-${i}`
            const contactName = col(row, 'Người liên hệ', 'Liên hệ', 'contact', 'contact_name') || null
            const phone = col(row, 'SĐT', 'Số điện thoại', 'Phone', 'phone', 'sdt') || null
            const email = col(row, 'Email', 'email') || null
            const address = col(row, 'Địa chỉ', 'Address', 'dia_chi') || null
            const taxCode = col(row, 'MST', 'Mã số thuế', 'Tax', 'tax_code', 'ma_so_thue') || null
            const notes = col(row, 'Ghi chú', 'Notes', 'ghi_chu') || null

            try {
                const existing = await getPrisma(req).supplier.findFirst({ where: { code } })
                const supplierData = { name, contactName, phone, email, address, taxCode, notes }

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

export default router
