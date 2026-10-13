/**
 * ZALO NHÓM — n8n gọi thẳng Kengi thay cho Google Sheet trung gian (13/10/2026)
 *
 * Bối cảnh: HUTI dùng Zalo CÁ NHÂN của công ty, mỗi đại lý một nhóm. n8n đọc tin nhóm
 * rồi ghi vào Google Sheet → Sheets chặn vì quá hạn mức ghi (60 lần/phút/tài khoản).
 * Nay n8n gọi các route dưới đây; không còn hạn mức kiểu Sheets.
 *
 * Xác thực cho n8n: header `X-API-Key: <key>` + `X-Store-Code: HUTI` (API key cửa hàng,
 * tạo ở Cài đặt › API Keys). Ghi (POST) cần key có quyền write.
 *
 *   GET  /api/zalo/nhom/:groupId     nhóm này là khách nào + thông tin xuất hoá đơn
 *   POST /api/zalo/tin               lưu một tin nhóm (chống trùng theo msgId)
 *   GET  /api/zalo/tin               đọc lại tin đã lưu (lọc khách / nhóm / yêu cầu HĐ)
 *   GET  /api/zalo/nhom              danh sách nhóm đã nối
 *   POST /api/zalo/nhom/nhap         nhập bảng CODE | TÊN NHÓM | GROUP ID (Excel), mặc định CHẠY THỬ
 *   POST /api/zalo/admin/nhap        như trên cho quản trị hệ thống (x-admin-key + storeCode)
 */

import { Router, Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import multer from 'multer'
import * as XLSX from 'xlsx'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { errMsg } from '../lib/errorResponse'
import { nhapNhomZalo, docFileNhomZalo, type DongNhomZalo } from '../lib/zaloNhom'

const router = Router()

/** Các trường xuất hoá đơn trên hồ sơ khách — n8n cần để soạn/đối chiếu yêu cầu */
const CHON_KHACH = {
    id: true, code: true, name: true, phone: true, address: true, email: true, taxCode: true,
    invoiceType: true, invoiceCompanyName: true, invoiceBuyerName: true, invoiceAddress: true,
    invoiceEmail: true, invoicePhone: true, invoiceIdNo: true,
} as const

/** Key chỉ-đọc không được ghi. Đăng nhập thường (JWT) thì để phân quyền lo. */
function canGhi(req: AuthRequest, res: Response, next: NextFunction): void {
    if ((req as any).viaApiKey && !String((req as any).apiKeyScopes || 'read').includes('write')) {
        res.status(403).json({ success: false, error: 'API key này chỉ có quyền đọc — tạo key có quyền ghi (read,write)' })
        return
    }
    next()
}

const chuoiGid = (v: any) => String(v ?? '').trim()

// ─── GET /api/zalo/nhom/:groupId ────────────────────────────────────────────
router.get('/nhom/:groupId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const gid = chuoiGid(req.params.groupId)
        const nhom = await sp.zaloNhom.findUnique({ where: { groupId: gid } })
        if (!nhom) { res.status(404).json({ success: false, error: `Nhóm ${gid} chưa nối với khách nào`, chuaNoi: true }); return }
        const khach = nhom.customerId
            ? await sp.customer.findUnique({ where: { id: nhom.customerId }, select: CHON_KHACH })
            : null
        res.json({
            success: true,
            data: {
                groupId: nhom.groupId, tenNhom: nhom.tenNhom, maKhach: nhom.maKhach,
                khach,
                // Nhóm nối mã chưa có trên Kengi: nói ra, đừng để n8n tưởng khách không có thông tin HĐ
                ghiChu: khach ? null : `Mã ${nhom.maKhach} chưa có khách trên Kengi`,
            },
        })
    } catch (e: any) {
        console.error('[zalo] GET nhom:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── GET /api/zalo/nhom?customerId=&q= ──────────────────────────────────────
router.get('/nhom', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const where: any = {}
        if (req.query.customerId) where.customerId = String(req.query.customerId)
        if (req.query.chuaNoi === '1') where.customerId = null
        if (req.query.q) {
            const q = String(req.query.q)
            where.OR = [{ maKhach: { contains: q, mode: 'insensitive' } }, { tenNhom: { contains: q, mode: 'insensitive' } }, { groupId: q }]
        }
        const rows = await sp.zaloNhom.findMany({ where, orderBy: { maKhach: 'asc' }, take: 1000 })
        const tong = await sp.zaloNhom.count({ where })
        res.json({ success: true, data: rows, tong })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/tin ─────────────────────────────────────────────────────
// Body: {groupId, noiDung, msgId?, nguoiGui?, thoiDiem?, yeuCauHoaDon?: true|false}
// Ghi XONG mới trả 200. msgId trùng ⇒ trả lại bản đã lưu, không ghi thêm.
router.post('/tin', authMiddleware, canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const b = req.body || {}
        const gid = chuoiGid(b.groupId)
        const noiDung = String(b.noiDung ?? b.content ?? '').trim()
        if (!/^\d{6,25}$/.test(gid)) { res.status(400).json({ success: false, error: 'groupId phải là dãy số (gửi dạng CHUỖI — số 19 chữ số mà gửi dạng number là mất chữ số cuối)' }); return }
        if (!noiDung) { res.status(400).json({ success: false, error: 'Thiếu noiDung' }); return }
        const msgId = b.msgId != null && String(b.msgId).trim() ? String(b.msgId).trim() : null

        if (msgId) {
            const cu = await sp.zaloTin.findUnique({ where: { msgId } })
            if (cu) { res.json({ success: true, data: { tinId: cu.id, trung: true, customerId: cu.customerId } }); return }
        }
        const nhom = await sp.zaloNhom.findUnique({ where: { groupId: gid }, select: { customerId: true, maKhach: true } })
        const tg = b.thoiDiem ? new Date(typeof b.thoiDiem === 'number' && b.thoiDiem < 1e12 ? b.thoiDiem * 1000 : b.thoiDiem) : new Date()
        const yc = b.yeuCauHoaDon === true || b.yeuCauHoaDon === false ? b.yeuCauHoaDon : null

        let tin
        try {
            tin = await sp.zaloTin.create({
                data: {
                    msgId, groupId: gid, customerId: nhom?.customerId || null,
                    nguoiGui: b.nguoiGui ? String(b.nguoiGui).slice(0, 200) : null,
                    noiDung: noiDung.slice(0, 10000), yeuCauHoaDon: yc,
                    thoiDiem: isNaN(tg.getTime()) ? new Date() : tg,
                },
            })
        } catch (e: any) {
            // Hai lượt n8n gửi lại cùng lúc: bản kia đã ghi — coi là trùng, không phải lỗi
            if (e?.code === 'P2002' && msgId) {
                const cu = await sp.zaloTin.findUnique({ where: { msgId } })
                res.json({ success: true, data: { tinId: cu?.id, trung: true, customerId: cu?.customerId } }); return
            }
            throw e
        }
        res.json({
            success: true,
            data: {
                tinId: tin.id, trung: false, customerId: tin.customerId,
                maKhach: nhom?.maKhach || null,
                ghiChu: nhom ? (nhom.customerId ? null : `Nhóm nối mã ${nhom.maKhach} — chưa có khách trên Kengi`) : 'Nhóm chưa nối khách — vẫn đã lưu tin',
            },
        })
    } catch (e: any) {
        console.error('[zalo] POST tin:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── GET /api/zalo/tin?customerId=&groupId=&yeuCauHoaDon=1|0&take= ──────────
router.get('/tin', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const where: any = {}
        if (req.query.customerId) where.customerId = String(req.query.customerId)
        if (req.query.groupId) where.groupId = String(req.query.groupId)
        if (req.query.yeuCauHoaDon === '1') where.yeuCauHoaDon = true
        if (req.query.yeuCauHoaDon === '0') where.yeuCauHoaDon = false
        const take = Math.min(500, Math.max(1, Number(req.query.take) || 100))
        const rows = await sp.zaloTin.findMany({ where, orderBy: { thoiDiem: 'desc' }, take })
        res.json({ success: true, data: rows })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/nhom/nhap (multipart: file, apply, ghiDe) ───────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

function docUpload(file: any): { dong: DongNhomZalo[]; loi: string | null } {
    const wb = XLSX.read(file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    // raw:true giữ kiểu thật của ô — để bắt ô SỐ đã mất chữ số (xem docFileNhomZalo)
    return docFileNhomZalo(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as any[][])
}

router.post('/nhom/nhap', authMiddleware, requirePermission('customers.create'), canGhi, upload.single('file'),
    async (req: AuthRequest, res: Response) => {
        try {
            if (!req.file) { res.status(400).json({ success: false, error: 'Chưa chọn file Excel' }); return }
            const { dong, loi } = docUpload(req.file)
            if (loi) { res.status(400).json({ success: false, error: loi }); return }
            const kq = await nhapNhomZalo(req.storePrisma as any, dong, {
                apply: String(req.body?.apply) === 'true', ghiDe: String(req.body?.ghiDe) === 'true',
            })
            res.json({ success: true, data: kq })
        } catch (e: any) {
            console.error('[zalo] nhap:', e?.message || e)
            res.status(500).json({ success: false, error: errMsg(e) })
        }
    })

// ─── POST /api/zalo/admin/nhap {storeCode, rows:[{maKhach,tenNhom,groupId}], apply, ghiDe} ─
function adminKey(req: Request, res: Response, next: NextFunction): void {
    const key = String(req.headers['x-admin-key'] || '')
    const dung = process.env.ADMIN_KEY || ''
    const a = Buffer.from(key), b = Buffer.from(dung)
    if (dung && a.length === b.length && crypto.timingSafeEqual(a, b)) { next(); return }
    res.status(403).json({ success: false, error: 'Unauthorized' })
}

router.post('/admin/nhap', adminKey, async (req: Request, res: Response) => {
    try {
        const b = req.body || {}
        const store = await registryPrisma.store.findFirst({
            where: { code: { equals: String(b.storeCode || '').trim(), mode: 'insensitive' } }, select: { schema: true, name: true },
        })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        if (!Array.isArray(b.rows)) { res.status(400).json({ success: false, error: 'Thiếu rows' }); return }
        const kq = await nhapNhomZalo(getStorePrisma(store.schema) as any, b.rows, { apply: b.apply === true, ghiDe: b.ghiDe === true })
        res.json({ success: true, store: store.name, data: kq })
    } catch (e: any) {
        console.error('[zalo] admin/nhap:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

export default router
