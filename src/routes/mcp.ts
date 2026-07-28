import { Router, Response, NextFunction } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { decrementSellableStock, adjustSellableStock } from '../lib/warehouseHelper'
import { createJournalEntriesForTransaction, postDebtCollectionJournal } from '../lib/autoJournal'
import { Tool, ToolCtx, ToolError } from '../lib/mcpTypes'
import { FANPAGE_TOOLS } from './mcpFanpageTools'
import { FINANCE_TOOLS } from './mcpFinanceTools'

// Re-export để mcpAgent.ts (và code cũ) vẫn `import { ToolError, ToolCtx } from './mcp'`
export { ToolError }
export type { Tool, ToolCtx }

/**
 * MCP SERVER — Model Context Protocol (Streamable HTTP, stateless) cho AI agent.
 *
 * Endpoint: POST https://api.kengi.vn/api/mcp
 * Cho phép AI agent (Claude, Cursor, agent tự viết...) thao tác hệ bán lẻ theo
 * TỪNG STORE: tra hàng, tồn kho, doanh thu, đơn hàng, khách nợ, tạo/sửa hàng hoá.
 *
 * Auth (headers gửi kèm mọi request):
 *   - X-API-Key: <secret>  +  x-store-code: <MÃ STORE>   ← API key tạo ở
 *     Dashboard → Cài đặt → API Keys (authMiddleware sẵn có xử lý).
 *     Scope 'read' chỉ gọi được tool đọc; 'write' mới được tạo/sửa.
 *   - HOẶC x-admin-key + x-store-code (vận hành nội bộ, full quyền).
 *
 * Giao thức: JSON-RPC 2.0 — initialize / notifications/initialized / ping /
 * tools/list / tools/call. Stateless (không session) — hợp lệ theo spec
 * Streamable HTTP; trả application/json, không dùng SSE.
 * Tự triển khai thay vì @modelcontextprotocol/sdk: bundle esbuild CJS
 * (--packages=external) dễ vỡ với dep ESM-only, và server chỉ cần tools.
 */

const router = Router()

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'kengi-open-retail', version: '1.0.0' }
const INSTRUCTIONS =
    'MCP của hệ bán lẻ Kengi Open-Retail. Mọi tool chạy trong phạm vi MỘT store (xác định bởi API key). ' +
    'Tiền tệ VND. Dùng get_store_overview để nắm tình hình trước, search_products/search_customers để tra cứu, ' +
    'sales_report/revenue_by_day cho doanh thu, inventory_value cho giá trị tồn kho. ' +
    'LÊN ĐƠN BÁN HÀNG bằng create_sale (tra hàng bằng search_products lấy đúng SKU trước; bán chịu thì tạo/khớp khách bằng create_customer/search_customers). ' +
    'THU NỢ khách bằng record_debt_payment (tra dư nợ bằng search_customers trước). ' +
    'Tool ghi (create_sale, record_debt_payment, create_product, update_product_price, create_customer, update_online_order_status) cần API key scope write. ' +
    'FANPAGE FACEBOOK: nhóm tool fanpage_* vận hành fanpage của store — gọi fanpage_list_pages TRƯỚC để biết page nào đang kết nối và token còn hạn không. ' +
    'Chăm bình luận: fanpage_list_comments (chỉ trả bình luận CHƯA được trả lời) → fanpage_reply_comment / fanpage_hide_comment. ' +
    'Đăng bài: fanpage_create_post (bỏ scheduled_at = đăng ngay; có thì phải cách hiện tại ≥ 10 phút), quản lý bài đã hẹn bằng fanpage_manage_scheduled_post. ' +
    'Trả lời tự động 24/7: fanpage_create_rule rồi fanpage_set_auto_reply để bật. Tool fanpage_* ghi cũng cần scope write. ' +
    'TÀI CHÍNH: profit_report cho câu hỏi lãi/lỗ (doanh thu − giá vốn − chi phí; giá vốn là ƯỚC TÍNH theo giá vốn hiện tại, hãy nói rõ điều đó khi báo cáo), '+
    'expense_report cho chi phí theo nhóm, supplier_debt cho công nợ phải trả nhà cung cấp, list_import_receipts cho lịch sử nhập hàng, '+
    'stock_by_warehouse cho tồn theo từng kho/xe. Ngày truyền dạng 2026-07-01 và được hiểu theo GIỜ VN.'

// ─── Auth ────────────────────────────────────────────────────────────────────
// Lối 1: x-admin-key (+ x-store-code) — nội bộ. Lối 2: authMiddleware sẵn có
// (X-API-Key + x-store-code, hoặc Bearer JWT đăng nhập).
async function mcpAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    const adminKey = req.headers['x-admin-key'] as string
    if (adminKey && process.env.ADMIN_KEY && adminKey === process.env.ADMIN_KEY) {
        const code = String(req.headers['x-store-code'] || '').trim()
        if (!code) {
            res.status(400).json(rpcError(null, -32000, 'Thiếu header x-store-code (mã store cần thao tác)'))
            return
        }
        const store = await registryPrisma.store.findFirst({
            where: { code: { equals: code, mode: 'insensitive' } },
        })
        if (!store) {
            res.status(404).json(rpcError(null, -32000, `Không tìm thấy store "${code}"`))
            return
        }
        req.storePrisma = getStorePrisma(store.schema)
        ;(req as any).apiKeyScopes = 'read,write'
        ;(req as any).mcpStoreCode = store.code
        next()
        return
    }
    authMiddleware(req, res, next)
}

// ─── JSON-RPC helpers ────────────────────────────────────────────────────────
function rpcResult(id: any, result: any) {
    return { jsonrpc: '2.0', id, result }
}
function rpcError(id: any, code: number, message: string) {
    return { jsonrpc: '2.0', id, error: { code, message } }
}
function textContent(data: unknown) {
    return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }] }
}
function errContent(message: string) {
    return { content: [{ type: 'text', text: message }], isError: true }
}

// ─── Tools ───────────────────────────────────────────────────────────────────
// ToolCtx / Tool / ToolError nằm ở lib/mcpTypes (import ở đầu file) để file tool
// tách riêng dùng chung mà không tạo vòng import.

/** Lấy actor cho tool ghi: ưu tiên ctx.userId; thiếu thì chọn 1 user admin/owner
 * trong store (Transaction.createdBy là FK BẮT BUỘC tới User). */
async function resolveActor(ctx: ToolCtx): Promise<{ id: string; name: string; branchId: string | null }> {
    if (ctx.userId) return { id: ctx.userId, name: ctx.userName || 'AI Agent', branchId: ctx.branchId ?? null }
    const u = await ctx.prisma.user.findFirst({
        where: { role: { in: ['admin', 'owner', 'superadmin'] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, branchId: true },
    }) || await ctx.prisma.user.findFirst({ select: { id: true, name: true, branchId: true } })
    if (!u) throw new ToolError('Store chưa có người dùng nào để ghi nhận người tạo đơn')
    return { id: u.id, name: u.name || 'AI Agent', branchId: (u as any).branchId ?? null }
}
const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d)

/** Tìm product theo sku (ưu tiên) hoặc id hoặc barcode. */
async function findProduct(prisma: any, skuOrId: string) {
    return prisma.product.findFirst({
        where: { OR: [{ sku: skuOrId }, { id: skuOrId }, { barcode: skuOrId }] },
    })
}

export const TOOLS: Tool[] = [
    {
        name: 'get_store_overview',
        description: 'Tổng quan store hôm nay: doanh thu, số đơn POS, số đơn online chờ xử lý, tổng số hàng hoá, số mặt hàng sắp hết. Gọi đầu tiên để nắm tình hình.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (_a, { prisma }) => {
            const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
            const [tx, productCount, pendingOnline, lowStock] = await Promise.all([
                prisma.transaction.aggregate({
                    where: { createdAt: { gte: startOfDay }, status: 'completed' },
                    _count: true, _sum: { total: true },
                }),
                prisma.product.count(),
                prisma.onlineOrder.count({ where: { status: { in: ['pending', 'confirmed', 'READY_TO_SHIP', 'AWAITING_SHIPMENT'] } } }),
                prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Product" WHERE stock <= "minStock" AND "productType" = 'goods'`),
            ])
            return {
                homNay: { soDonPOS: tx._count, doanhThu: tx._sum.total || 0 },
                donOnlineChoXuLy: pendingOnline,
                tongSoHangHoa: productCount,
                soMatHangSapHet: (lowStock as any[])[0]?.n ?? 0,
            }
        },
    },
    {
        name: 'search_products',
        description: 'Tìm hàng hoá theo tên / SKU / barcode. Trả về id, sku, tên, giá bán, giá vốn, tồn kho.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Từ khoá (tên, SKU hoặc barcode)' },
                limit: { type: 'number', description: 'Số kết quả tối đa (mặc định 10, tối đa 50)' },
            },
            required: ['query'],
        },
        run: async (a, { prisma }) => {
            const products = await prisma.product.findMany({
                where: {
                    OR: [
                        { name: { contains: String(a.query), mode: 'insensitive' } },
                        { sku: { contains: String(a.query), mode: 'insensitive' } },
                        { barcode: { contains: String(a.query) } },
                    ],
                },
                take: Math.min(num(a.limit, 10), 50),
                orderBy: { updatedAt: 'desc' },
                select: { id: true, sku: true, name: true, sellingPrice: true, costPrice: true, stock: true, baseUnit: true },
            })
            return { soKetQua: products.length, hangHoa: products }
        },
    },
    {
        name: 'get_product',
        description: 'Chi tiết 1 hàng hoá theo SKU, id hoặc barcode (kèm nhóm hàng, tồn kho từng kho).',
        inputSchema: {
            type: 'object',
            properties: { sku_or_id: { type: 'string', description: 'SKU, id hoặc barcode' } },
            required: ['sku_or_id'],
        },
        run: async (a, { prisma }) => {
            const p = await prisma.product.findFirst({
                where: { OR: [{ sku: String(a.sku_or_id) }, { id: String(a.sku_or_id) }, { barcode: String(a.sku_or_id) }] },
                include: { category: { select: { name: true } }, brand: { select: { name: true } } },
            })
            if (!p) return errContentThrow(`Không tìm thấy hàng hoá "${a.sku_or_id}"`)
            return p
        },
    },
    {
        name: 'create_product',
        description: 'Tạo hàng hoá mới. Không truyền sku → tự sinh mã. Không truyền categoryName → vào nhóm "Chưa phân loại". Tồn kho khởi tạo = 0 (nhập kho bằng phiếu nhập riêng để sổ sách khớp).',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Tên hàng hoá' },
                sellingPrice: { type: 'number', description: 'Giá bán (VND)' },
                costPrice: { type: 'number', description: 'Giá vốn (VND, tuỳ chọn)' },
                sku: { type: 'string', description: 'Mã hàng (tuỳ chọn — bỏ trống sẽ tự sinh)' },
                barcode: { type: 'string', description: 'Mã vạch (tuỳ chọn)' },
                baseUnit: { type: 'string', description: 'Đơn vị tính, mặc định "cái"' },
                categoryName: { type: 'string', description: 'Tên nhóm hàng — chưa có sẽ tự tạo' },
            },
            required: ['name', 'sellingPrice'],
        },
        run: async (a, { prisma }) => {
            const name = String(a.name || '').trim()
            if (!name) return errContentThrow('Thiếu tên hàng hoá')
            const catName = String(a.categoryName || 'Chưa phân loại').trim()
            let category = await prisma.category.findFirst({ where: { name: { equals: catName, mode: 'insensitive' } } })
            if (!category) category = await prisma.category.create({ data: { name: catName } })

            let sku = String(a.sku || '').trim()
            if (!sku) sku = 'SP' + Date.now().toString(36).toUpperCase()
            const dupe = await prisma.product.findFirst({ where: { sku } })
            if (dupe) return errContentThrow(`SKU "${sku}" đã tồn tại (hàng: ${dupe.name})`)

            const p = await prisma.product.create({
                data: {
                    name,
                    sku,
                    barcode: a.barcode ? String(a.barcode) : null,
                    categoryId: category.id,
                    sellingPrice: num(a.sellingPrice, 0),
                    costPrice: num(a.costPrice, 0),
                    baseUnit: String(a.baseUnit || 'cái'),
                    stock: 0,
                },
            })
            return { daTao: true, id: p.id, sku: p.sku, name: p.name, sellingPrice: p.sellingPrice }
        },
    },
    {
        name: 'update_product_price',
        description: 'Cập nhật giá bán / giá vốn của một hàng hoá.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                sku_or_id: { type: 'string' },
                sellingPrice: { type: 'number', description: 'Giá bán mới (bỏ trống nếu không đổi)' },
                costPrice: { type: 'number', description: 'Giá vốn mới (bỏ trống nếu không đổi)' },
            },
            required: ['sku_or_id'],
        },
        run: async (a, { prisma }) => {
            const p = await findProduct(prisma, String(a.sku_or_id))
            if (!p) return errContentThrow(`Không tìm thấy hàng hoá "${a.sku_or_id}"`)
            const data: any = {}
            if (a.sellingPrice !== undefined) data.sellingPrice = num(a.sellingPrice, p.sellingPrice)
            if (a.costPrice !== undefined) data.costPrice = num(a.costPrice, p.costPrice)
            if (Object.keys(data).length === 0) return errContentThrow('Không có gì để cập nhật (truyền sellingPrice hoặc costPrice)')
            const updated = await prisma.product.update({ where: { id: p.id }, data })
            return { daCapNhat: true, sku: updated.sku, sellingPrice: updated.sellingPrice, costPrice: updated.costPrice }
        },
    },
    {
        name: 'low_stock_products',
        description: 'Danh sách hàng sắp hết (tồn <= tồn tối thiểu), xếp theo tồn tăng dần.',
        inputSchema: {
            type: 'object',
            properties: { limit: { type: 'number', description: 'Mặc định 20, tối đa 100' } },
        },
        run: async (a, { prisma }) => {
            const rows = await prisma.$queryRawUnsafe(
                `SELECT id, sku, name, stock, "minStock", "sellingPrice" FROM "Product"
                 WHERE stock <= "minStock" AND "productType" = 'goods'
                 ORDER BY stock ASC LIMIT ${Math.min(num(a?.limit, 20), 100)}`
            )
            return { soMatHang: (rows as any[]).length, hangSapHet: rows }
        },
    },
    {
        name: 'sales_report',
        description: 'Báo cáo bán hàng theo khoảng ngày (mặc định 7 ngày gần nhất): tổng đơn, doanh thu, giảm giá, top 5 hàng bán chạy.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'ISO date bắt đầu, vd 2026-07-01' },
                to: { type: 'string', description: 'ISO date kết thúc (mặc định hôm nay)' },
            },
        },
        run: async (a, { prisma }) => {
            const to = a?.to ? new Date(String(a.to) + 'T23:59:59') : new Date()
            const from = a?.from ? new Date(String(a.from) + 'T00:00:00') : new Date(to.getTime() - 7 * 86400_000)
            if (isNaN(from.getTime()) || isNaN(to.getTime())) return errContentThrow('Ngày không hợp lệ (dùng YYYY-MM-DD)')
            const whereTx = { createdAt: { gte: from, lte: to }, status: 'completed' }
            const [agg, top] = await Promise.all([
                prisma.transaction.aggregate({ where: whereTx, _count: true, _sum: { total: true, discount: true } }),
                prisma.transactionItem.groupBy({
                    by: ['productName'],
                    where: { transaction: whereTx },
                    _sum: { quantity: true, lineTotal: true },
                    orderBy: { _sum: { quantity: 'desc' } },
                    take: 5,
                }),
            ])
            return {
                tuNgay: from.toISOString().slice(0, 10),
                denNgay: to.toISOString().slice(0, 10),
                soDon: agg._count,
                doanhThu: agg._sum.total || 0,
                tongGiamGia: agg._sum.discount || 0,
                topBanChay: top.map((t: any) => ({ ten: t.productName, soLuong: t._sum.quantity, tien: t._sum.lineTotal })),
            }
        },
    },
    {
        name: 'revenue_by_day',
        description: 'Doanh thu theo TỪNG NGÀY trong khoảng (đúng logic sổ HKD: ưu tiên transactionDate, thiếu thì createdAt) — kèm số phiếu, tách kênh online/direct. Dùng để soi ngày nào thiếu sổ.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'YYYY-MM-DD' },
                to: { type: 'string', description: 'YYYY-MM-DD' },
            },
            required: ['from', 'to'],
        },
        run: async (a, { prisma }) => {
            const rows = await prisma.$queryRawUnsafe(
                `SELECT to_char(COALESCE("transactionDate","createdAt")::date,'YYYY-MM-DD') AS ngay,
                        COUNT(*)::int AS "soPhieu",
                        SUM(total)::float8 AS "doanhThu",
                        COUNT(*) FILTER (WHERE channel='online')::int AS "phieuOnline",
                        COUNT(*) FILTER (WHERE channel<>'online')::int AS "phieuTrucTiep"
                 FROM "Transaction"
                 WHERE status IN ('completed','partial')
                   AND COALESCE("transactionDate","createdAt") >= $1::date
                   AND COALESCE("transactionDate","createdAt") < ($2::date + interval '1 day')
                 GROUP BY 1 ORDER BY 1`,
                String(a.from), String(a.to)
            )
            return { tuNgay: a.from, denNgay: a.to, soNgayCoDoanhThu: (rows as any[]).length, theoNgay: rows }
        },
    },
    {
        name: 'online_orders_by_day',
        description: 'Đếm đơn ONLINE theo từng ngày (ngày đặt trên sàn): tổng đơn, đơn đã chuyển thành phiếu bán, đơn chưa chuyển. Dùng soi khâu nào thiếu: đơn không nhập về, hay nhập rồi mà chưa chuyển phiếu.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'YYYY-MM-DD' },
                to: { type: 'string', description: 'YYYY-MM-DD' },
            },
            required: ['from', 'to'],
        },
        run: async (a, { prisma }) => {
            const rows = await prisma.$queryRawUnsafe(
                `SELECT to_char(o."createdAt"::date,'YYYY-MM-DD') AS ngay,
                        COUNT(*)::int AS "tongDon",
                        COUNT(t.id)::int AS "daChuyenPhieu",
                        (COUNT(*) - COUNT(t.id))::int AS "chuaChuyen",
                        SUM(o.total)::float8 AS "tongTien"
                 FROM "OnlineOrder" o
                 LEFT JOIN "Transaction" t ON t."receiptNumber" = 'ONLINE-' || o."orderNumber"
                 WHERE o."createdAt" >= $1::date AND o."createdAt" < ($2::date + interval '1 day')
                 GROUP BY 1 ORDER BY 1`,
                String(a.from), String(a.to)
            )
            return { tuNgay: a.from, denNgay: a.to, theoNgay: rows }
        },
    },
    {
        name: 'list_recent_orders',
        description: 'Đơn POS gần nhất (phiếu bán hàng): số phiếu, khách, tổng tiền, trạng thái, kênh.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Mặc định 10, tối đa 50' },
                channel: { type: 'string', description: 'Lọc kênh: direct | van | delivery | online' },
            },
        },
        run: async (a, { prisma }) => {
            const orders = await prisma.transaction.findMany({
                where: a?.channel ? { channel: String(a.channel) } : undefined,
                orderBy: { createdAt: 'desc' },
                take: Math.min(num(a?.limit, 10), 50),
                select: {
                    receiptNumber: true, customerName: true, total: true,
                    status: true, channel: true, createdAt: true,
                },
            })
            return { soDon: orders.length, donHang: orders }
        },
    },
    {
        name: 'list_online_orders',
        description: 'Đơn online (Shopee/TikTok/web) gần nhất — mã đơn, sàn, khách, tổng tiền, trạng thái.',
        inputSchema: {
            type: 'object',
            properties: {
                status: { type: 'string', description: 'Lọc trạng thái (vd pending, shipping, completed)' },
                limit: { type: 'number', description: 'Mặc định 10, tối đa 50' },
            },
        },
        run: async (a, { prisma }) => {
            const orders = await prisma.onlineOrder.findMany({
                where: a?.status ? { status: String(a.status) } : undefined,
                orderBy: { createdAt: 'desc' },
                take: Math.min(num(a?.limit, 10), 50),
                select: {
                    orderNumber: true, platform: true, customerName: true,
                    total: true, status: true, createdAt: true,
                },
            })
            return { soDon: orders.length, donOnline: orders }
        },
    },
    {
        name: 'search_customers',
        description: 'Tìm khách hàng theo tên / SĐT / mã KH — kèm công nợ hiện tại.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                limit: { type: 'number', description: 'Mặc định 10, tối đa 50' },
            },
            required: ['query'],
        },
        run: async (a, { prisma }) => {
            const customers = await prisma.customer.findMany({
                where: {
                    OR: [
                        { name: { contains: String(a.query), mode: 'insensitive' } },
                        { phone: { contains: String(a.query) } },
                        { code: { contains: String(a.query), mode: 'insensitive' } },
                    ],
                },
                take: Math.min(num(a.limit, 10), 50),
                select: { code: true, name: true, phone: true, debt: true, totalOrders: true },
            })
            return { soKetQua: customers.length, khachHang: customers }
        },
    },
    {
        name: 'create_sale',
        description: 'LÊN ĐƠN HÀNG / bán hàng tại quầy — tạo phiếu bán, TRỪ KHO, ghi công nợ + bút toán tự động. items là danh sách {sku_or_id, quantity, unit_price?} (bỏ unit_price sẽ lấy giá bán hiện tại). MẶC ĐỊNH: đơn có KHÁCH (customer_query = SĐT/mã/tên đã có) → GHI NỢ TOÀN BỘ (bán chịu); khách LẺ (bỏ trống customer_query) → coi như thu đủ. Muốn thu tiền ngay thì truyền amount_received. CẦN scope write. Trả về số phiếu + tổng tiền + nợ.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    description: 'Danh sách hàng bán',
                    items: {
                        type: 'object',
                        properties: {
                            sku_or_id: { type: 'string', description: 'SKU / id / barcode hàng hoá' },
                            quantity: { type: 'number', description: 'Số lượng bán' },
                            unit_price: { type: 'number', description: 'Đơn giá (bỏ trống = giá bán hiện tại)' },
                        },
                        required: ['sku_or_id', 'quantity'],
                    },
                },
                customer_query: { type: 'string', description: 'SĐT / mã / tên khách đã có trong hệ thống (tuỳ chọn)' },
                amount_received: { type: 'number', description: 'Số tiền khách trả. BỎ TRỐNG: có khách → 0 (ghi nợ toàn bộ), khách lẻ → thu đủ. Truyền số để ép mức thu.' },
                payment_type: { type: 'string', description: 'cash | card | transfer | ewallet (mặc định cash)' },
                discount: { type: 'number', description: 'Giảm giá tổng đơn (VND, tuỳ chọn)' },
                note: { type: 'string', description: 'Ghi chú đơn (tuỳ chọn)' },
            },
            required: ['items'],
        },
        run: async (a, ctx) => {
            const { prisma } = ctx
            const rawItems = Array.isArray(a.items) ? a.items : []
            if (rawItems.length === 0) return errContentThrow('Đơn phải có ít nhất 1 mặt hàng')

            // Gộp trùng + resolve product
            const lines: any[] = []
            for (const it of rawItems) {
                const qty = Math.floor(num(it.quantity, 0))
                if (qty <= 0) return errContentThrow(`Số lượng không hợp lệ cho "${it.sku_or_id}"`)
                const p = await findProduct(prisma, String(it.sku_or_id))
                if (!p) return errContentThrow(`Không tìm thấy hàng hoá "${it.sku_or_id}"`)
                const unitPrice = it.unit_price !== undefined ? num(it.unit_price, p.sellingPrice) : p.sellingPrice
                lines.push({ product: p, qty, unitPrice, lineTotal: Math.round(unitPrice * qty) })
            }

            const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0)
            const discount = Math.max(0, Math.round(num(a.discount, 0)))
            const total = Math.max(0, subtotal - discount)

            // Khách hàng (tuỳ chọn) — phải resolve TRƯỚC để quyết mặc định thu tiền
            let customer: any = null
            if (a.customer_query) {
                const q = String(a.customer_query)
                customer = await prisma.customer.findFirst({
                    where: { OR: [{ phone: { contains: q } }, { code: { equals: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] },
                })
                if (!customer) return errContentThrow(`Không tìm thấy khách "${q}" — tạo trước bằng create_customer hoặc bỏ trống để bán khách lẻ`)
            }

            // MẶC ĐỊNH (yêu cầu chủ shop): đơn AI lên có KHÁCH → GHI NỢ TOÀN BỘ
            // (amount_received = 0). Khách LẺ (không có khách) → thu đủ. Vẫn cho ép
            // số tiền thu qua amount_received khi cần.
            const amountReceived = a.amount_received !== undefined
                ? Math.max(0, Math.round(num(a.amount_received, 0)))
                : (customer ? 0 : total)
            const status = amountReceived < total ? 'partial' : 'completed'
            const debtAmount = status === 'partial' ? total - amountReceived : 0

            if (debtAmount > 0 && !customer) return errContentThrow('Bán chịu (thu thiếu) phải có khách hàng — truyền customer_query')

            const actor = await resolveActor(ctx)
            const settings = await prisma.storeSettings
                .findFirst({ select: { allowNegativeStock: true, autoCreateJournalEntries: true } }).catch(() => null)
            const allowNeg = settings?.allowNegativeStock ?? false

            const count = await prisma.transaction.count()
            const receiptNumber = `HD${Date.now()}${String(count + 1).padStart(4, '0')}`

            const result = await prisma.$transaction(async (tx: any) => {
                const created = await tx.transaction.create({
                    data: {
                        receiptNumber,
                        subtotal, discount, discountType: 'fixed', tax: 0, total,
                        amountReceived, change: Math.max(0, amountReceived - total),
                        status, channel: 'direct',
                        createdBy: actor.id, createdByName: actor.name,
                        branchId: actor.branchId,
                        notes: a.note ? String(a.note) : null,
                        customerId: customer?.id, customerName: customer?.name || null, customerPhone: customer?.phone || null,
                        items: {
                            create: lines.map(l => ({
                                productId: l.product.id, productName: l.product.name,
                                sku: l.product.sku || '', quantity: l.qty, unitPrice: l.unitPrice,
                                discount: 0, discountType: 'fixed', lineTotal: l.lineTotal, baseQuantity: l.qty,
                            })),
                        },
                        payments: { create: [{ type: String(a.payment_type || 'cash'), amount: amountReceived, reference: null }] },
                    },
                    include: { items: { include: { product: { select: { costPrice: true } } } } },
                })

                // Trừ kho race-safe qua helper chuẩn (giữ Product.stock ↔ WarehouseStock)
                for (const l of lines) {
                    const ok = await decrementSellableStock(tx, l.product.id, actor.branchId, l.qty, allowNeg)
                    if (!ok) throw new ToolError(`"${l.product.name}" không đủ tồn (còn ${l.product.stock}, cần ${l.qty})`)
                    await tx.inventoryTransaction.create({
                        data: {
                            type: 'sale', productId: l.product.id, productName: l.product.name,
                            productSku: l.product.sku || '', quantity: -l.qty,
                            reason: `Bán hàng - ${receiptNumber}`, note: `Trợ lý AI tạo đơn ${receiptNumber}`,
                            referenceId: receiptNumber, referenceType: 'sale', unitPrice: l.unitPrice,
                            costPriceAfter: l.product.costPrice || 0, userId: actor.id, userName: actor.name,
                        },
                    })
                }

                // Khách: cộng thống kê + công nợ + DebtEntry
                if (customer) {
                    const upd: any = { totalPurchases: { increment: total }, totalOrders: { increment: 1 }, lastPurchaseDate: new Date() }
                    if (debtAmount > 0) upd.debt = { increment: debtAmount }
                    const uc = await tx.customer.update({ where: { id: customer.id }, data: upd })
                    if (debtAmount > 0) {
                        await tx.debtEntry.create({
                            data: {
                                customerId: customer.id, customerName: uc.name, phone: uc.phone || null,
                                type: 'debt', amount: debtAmount, description: `Nợ từ HĐ ${receiptNumber}`,
                                balance: Math.max(0, uc.debt),
                            },
                        })
                    }
                }

                // Bút toán tự động (nếu store bật)
                if (settings?.autoCreateJournalEntries !== false) {
                    await createJournalEntriesForTransaction(tx, created, { branchId: actor.branchId, userId: actor.id, skipDupCheck: false })
                }
                return created
            }, { timeout: 30000 })

            return {
                daLenDon: true,
                soPhieu: result.receiptNumber,
                soMatHang: lines.length,
                tongTien: total,
                daThu: amountReceived,
                conNo: debtAmount,
                trangThai: status === 'partial' ? 'Bán chịu (còn nợ)' : 'Hoàn tất',
                khach: customer?.name || 'Khách lẻ',
            }
        },
    },
    {
        name: 'create_customer',
        description: 'Tạo khách hàng mới (tên + SĐT bắt buộc). Tự sinh mã KH. Dùng trước khi lên đơn bán chịu cho khách chưa có.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Tên khách hàng' },
                phone: { type: 'string', description: 'Số điện thoại' },
                address: { type: 'string', description: 'Địa chỉ (tuỳ chọn)' },
                email: { type: 'string', description: 'Email (tuỳ chọn)' },
            },
            required: ['name', 'phone'],
        },
        run: async (a, { prisma }) => {
            const name = String(a.name || '').trim()
            const phone = String(a.phone || '').trim()
            if (!name || !phone) return errContentThrow('Cần cả tên và số điện thoại')
            const existing = await prisma.customer.findFirst({ where: { phone } })
            if (existing) return errContentThrow(`SĐT ${phone} đã có khách "${existing.name}" (mã ${existing.code})`)
            const code = 'KH' + Date.now().toString(36).toUpperCase()
            const c = await prisma.customer.create({
                data: { code, name, phone, address: a.address ? String(a.address) : null, email: a.email ? String(a.email) : null },
            })
            return { daTao: true, ma: c.code, ten: c.name, sdt: c.phone }
        },
    },
    {
        name: 'record_debt_payment',
        description: 'THU NỢ KHÁCH — ghi nhận khách trả tiền nợ: giảm dư nợ, ghi sổ công nợ và bút toán Nợ 111/112 / Có 131. Bỏ trống amount = thu HẾT nợ hiện tại; trả thừa sẽ tự cắt bằng đúng số còn nợ. customer_query phải khớp DUY NHẤT 1 khách (dùng mã KH hoặc SĐT cho chắc — search_customers để tra trước). CẦN scope write.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                customer_query: { type: 'string', description: 'Mã KH / SĐT / tên khách (phải khớp duy nhất 1 khách)' },
                amount: { type: 'number', description: 'Số tiền khách trả (VND). Bỏ trống = trả hết nợ hiện tại.' },
                payment_type: { type: 'string', description: 'cash | transfer | card | ewallet (mặc định cash). transfer/bank → ghi Nợ 112, còn lại Nợ 111.' },
                note: { type: 'string', description: 'Ghi chú (tuỳ chọn) — nối sau "Trả nợ"' },
            },
            required: ['customer_query'],
        },
        run: async (a, ctx) => {
            const { prisma } = ctx
            const q = String(a.customer_query || '').trim()
            if (!q) return errContentThrow('Thiếu customer_query (mã KH / SĐT / tên khách)')

            // Thu tiền là việc động vào SỔ — không đoán khách như create_sale:
            // mơ hồ thì bắt AI chọn lại bằng mã KH thay vì trừ nhầm nợ người khác.
            const matches = await prisma.customer.findMany({
                where: {
                    OR: [
                        { code: { equals: q, mode: 'insensitive' } },
                        { phone: { contains: q } },
                        { name: { contains: q, mode: 'insensitive' } },
                    ],
                },
                take: 6,
                select: { id: true, code: true, name: true, phone: true, debt: true },
            })
            if (matches.length === 0) return errContentThrow(`Không tìm thấy khách "${q}"`)
            const exact = matches.filter((c: any) => String(c.code || '').toLowerCase() === q.toLowerCase())
            const customer = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null
            if (!customer) {
                return errContentThrow(
                    `"${q}" khớp ${matches.length} khách — gọi lại với MÃ KH cụ thể: ` +
                    matches.map((c: any) => `${c.code} (${c.name}${c.phone ? ', ' + c.phone : ''}, nợ ${Math.max(0, c.debt || 0)})`).join('; ')
                )
            }

            const currentBalance = Math.max(0, customer.debt ?? 0)
            if (currentBalance <= 0) return errContentThrow(`Khách ${customer.name} (${customer.code}) không còn công nợ`)

            const asked = a.amount !== undefined ? Math.round(num(a.amount, 0)) : currentBalance
            if (asked <= 0) return errContentThrow('Số tiền trả phải lớn hơn 0')
            // Trả thừa → chỉ ghi bằng đúng dư nợ (giống POST /api/debts), không tạo dư âm.
            const paid = Math.min(asked, currentBalance)
            const newBalance = currentBalance - paid

            const paymentType = String(a.payment_type || 'cash')
            const entry = await prisma.$transaction(async (tx: any) => {
                // "Trả nợ" là prefix mà debt-history dò để phân loại — giữ nguyên,
                // ghi chú người dùng nối phía sau.
                const created = await tx.debtEntry.create({
                    data: {
                        customerId: customer.id,
                        customerName: customer.name || 'Khách hàng',
                        phone: customer.phone || null,
                        type: 'payment',
                        amount: paid,
                        description: a.note ? `Trả nợ - ${String(a.note)}` : 'Trả nợ',
                        balance: newBalance,
                    },
                })
                await tx.customer.update({ where: { id: customer.id }, data: { debt: newBalance } })
                await postDebtCollectionJournal(tx, {
                    amount: paid,
                    refKey: `COLLECT-DEBT-${created.id}`,
                    date: new Date().toISOString().slice(0, 10),
                    paymentType,
                    customerName: customer.name,
                    branchId: ctx.branchId ?? null,
                    userId: ctx.userId ?? null,
                })
                return created
            }, { timeout: 30000 })

            return {
                daThuNo: true,
                khach: `${customer.name} (${customer.code})`,
                daThu: paid,
                traThua: asked > paid ? asked - paid : 0,
                noTruoc: currentBalance,
                noConLai: newBalance,
                hinhThuc: paymentType,
                maButToan: entry.id,
            }
        },
    },
    {
        name: 'update_online_order_status',
        description: 'Cập nhật trạng thái một đơn online (theo mã đơn). Ví dụ: confirmed, processing, shipping, completed, cancelled.',
        write: true,
        inputSchema: {
            type: 'object',
            properties: {
                order_number: { type: 'string', description: 'Mã đơn online (orderNumber)' },
                status: { type: 'string', description: 'Trạng thái mới' },
            },
            required: ['order_number', 'status'],
        },
        run: async (a, { prisma }) => {
            const order = await prisma.onlineOrder.findFirst({ where: { orderNumber: String(a.order_number) } })
            if (!order) return errContentThrow(`Không tìm thấy đơn online "${a.order_number}"`)
            const updated = await prisma.onlineOrder.update({
                where: { id: order.id }, data: { status: String(a.status) },
                select: { orderNumber: true, status: true, platform: true },
            })
            return { daCapNhat: true, maDon: updated.orderNumber, trangThaiMoi: updated.status, san: updated.platform }
        },
    },
    {
        name: 'top_customers',
        description: 'Khách hàng mua nhiều nhất (theo tổng tiền tích luỹ) — kèm số đơn và công nợ hiện tại.',
        inputSchema: {
            type: 'object',
            properties: { limit: { type: 'number', description: 'Mặc định 10, tối đa 50' } },
        },
        run: async (a, { prisma }) => {
            const rows = await prisma.customer.findMany({
                orderBy: { totalPurchases: 'desc' },
                take: Math.min(num(a?.limit, 10), 50),
                select: { code: true, name: true, phone: true, totalPurchases: true, totalOrders: true, debt: true },
            })
            return { khachHang: rows }
        },
    },
    {
        name: 'inventory_value',
        description: 'Tổng giá trị tồn kho toàn store: theo giá vốn (vốn đọng) và theo giá bán (doanh thu tiềm năng), số mặt hàng còn tồn.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (_a, { prisma }) => {
            const rows = await prisma.$queryRawUnsafe(
                `SELECT COUNT(*) FILTER (WHERE stock > 0)::int AS "soMatHangConTon",
                        COALESCE(SUM(stock * "costPrice"),0)::float8 AS "giaTriTheoVon",
                        COALESCE(SUM(stock * "sellingPrice"),0)::float8 AS "giaTriTheoGiaBan",
                        COALESCE(SUM(stock),0)::float8 AS "tongSoLuongTon"
                 FROM "Product" WHERE "productType" = 'goods'`
            )
            return (rows as any[])[0] || {}
        },
    },
    {
        name: 'list_categories',
        description: 'Danh sách nhóm hàng kèm số lượng mặt hàng mỗi nhóm.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        run: async (_a, { prisma }) => {
            const cats = await prisma.category.findMany({
                select: { name: true, _count: { select: { products: true } } },
                orderBy: { name: 'asc' },
            })
            return { soNhom: cats.length, nhomHang: cats.map((c: any) => ({ ten: c.name, soMatHang: c._count.products })) }
        },
    },
    // Fanpage Manager (Facebook) — cùng dữ liệu với kengi.vn/fanpage-manager.
    // Tách file riêng vì bộ tool này dài và gắn với Graph API, không phải bán lẻ.
    ...FANPAGE_TOOLS,
    // Tài chính & mua hàng — lãi lỗ, chi phí, công nợ NCC, nhập hàng, tồn theo kho
    ...FINANCE_TOOLS,
]

function errContentThrow(message: string): never { throw new ToolError(message) }

// ─── HTTP handlers ───────────────────────────────────────────────────────────
router.get('/', (_req, res) => {
    // Không hỗ trợ SSE stream — stateless JSON là đủ cho tools.
    res.status(405).json(rpcError(null, -32000, 'Method Not Allowed — POST JSON-RPC tới endpoint này'))
})
router.delete('/', (_req, res) => {
    res.status(405).json(rpcError(null, -32000, 'Stateless server — không có session để xoá'))
})

router.post('/', mcpAuth, async (req: AuthRequest, res: Response) => {
    const prisma = req.storePrisma
    if (!prisma) {
        res.status(401).json(rpcError(null, -32000, 'Chưa xác thực store (X-API-Key + x-store-code)'))
        return
    }
    const scopes = String((req as any).apiKeyScopes || 'read')
    const storeCode = String((req as any).mcpStoreCode || req.user?.storeCode || '')
    const ctx: ToolCtx = {
        prisma, scopes, storeCode,
        userId: req.user?.userId,
        userName: (req.user as any)?.name,
        branchId: req.user?.branchId ?? null,
    }

    const isBatch = Array.isArray(req.body)
    const messages: any[] = isBatch ? req.body : [req.body]
    const responses: any[] = []

    for (const msg of messages) {
        if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') {
            responses.push(rpcError(msg?.id ?? null, -32600, 'Invalid Request'))
            continue
        }
        const hasId = msg.id !== undefined && msg.id !== null
        // Notification (không id) → không trả response
        if (!hasId) continue

        try {
            switch (msg.method) {
                case 'initialize': {
                    const clientPv = msg.params?.protocolVersion
                    const pv = PROTOCOL_VERSIONS.includes(clientPv) ? clientPv : '2025-03-26'
                    responses.push(rpcResult(msg.id, {
                        protocolVersion: pv,
                        capabilities: { tools: { listChanged: false } },
                        serverInfo: SERVER_INFO,
                        instructions: INSTRUCTIONS,
                    }))
                    break
                }
                case 'ping':
                    responses.push(rpcResult(msg.id, {}))
                    break
                case 'tools/list':
                    responses.push(rpcResult(msg.id, {
                        tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
                    }))
                    break
                case 'tools/call': {
                    const name = msg.params?.name
                    const tool = TOOLS.find(t => t.name === name)
                    if (!tool) {
                        responses.push(rpcError(msg.id, -32602, `Tool không tồn tại: ${name}`))
                        break
                    }
                    if (tool.write && !/write|admin/.test(scopes)) {
                        responses.push(rpcResult(msg.id, errContent(
                            `Tool "${name}" cần API key scope write — key hiện tại chỉ có "${scopes}".`)))
                        break
                    }
                    try {
                        const out = await tool.run(msg.params?.arguments ?? {}, ctx)
                        responses.push(rpcResult(msg.id, textContent(out)))
                    } catch (e: any) {
                        if (e instanceof ToolError) {
                            responses.push(rpcResult(msg.id, errContent(e.message)))
                        } else {
                            console.error(`[MCP] tool ${name} lỗi:`, e?.message || e)
                            responses.push(rpcResult(msg.id, errContent(`Lỗi hệ thống khi chạy ${name}: ${e?.message || e}`)))
                        }
                    }
                    break
                }
                default:
                    responses.push(rpcError(msg.id, -32601, `Method not found: ${msg.method}`))
            }
        } catch (e: any) {
            responses.push(rpcError(msg.id, -32603, `Internal error: ${e?.message || e}`))
        }
    }

    if (responses.length === 0) {
        res.status(202).end() // toàn notifications
        return
    }
    res.json(isBatch ? responses : responses[0])
})

export default router
