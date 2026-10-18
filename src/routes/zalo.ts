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
 *   GET  /api/zalo/yeu-cau-hoa-don?ngay=YYYY-MM-DD   JSON yêu cầu HĐ trong ngày (khách + phiếu + dòng hàng) — CHỈ ĐỌC
 *
 * "/hoadon" (18/10/2026): khách nhắn lệnh này trong nhóm = lấy hoá đơn cho MỌI phiếu bán của
 * khách trong ngày (giờ VN) đó. CHỈ LƯU YÊU CẦU — hoá đơn xuất bên MISA, KHÔNG ghi gì lên phiếu.
 * Xem lib/zaloNhom.ts mục YÊU CẦU HOÁ ĐƠN.
 */

import { Router, Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import multer from 'multer'
import * as XLSX from 'xlsx'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { errMsg } from '../lib/errorResponse'
import {
    nhapNhomZalo, docFileNhomZalo, laLenhHoaDon, dsYeuCauHoaDon, danhDauLayHoaDon, ngayVN,
    type DongNhomZalo,
} from '../lib/zaloNhom'

const router = Router()

/** Các trường xuất hoá đơn trên hồ sơ khách — n8n cần để soạn/đối chiếu yêu cầu */
const CHON_KHACH = {
    id: true, code: true, name: true, phone: true, address: true, email: true, taxCode: true,
    invoiceType: true, invoiceCompanyName: true, invoiceBuyerName: true, invoiceAddress: true,
    invoiceEmail: true, invoicePhone: true, invoiceIdNo: true,
} as const

/** Key chỉ-đọc không được ghi. Đăng nhập thường (JWT) thì để phân quyền lo. */
function canGhi(req: AuthRequest, res: Response, next: NextFunction): void {
    // 'admin' = key tạo ở Cài đặt › API (POST /api-keys/regenerate) — chính key chủ shop dán vào n8n
    if ((req as any).viaApiKey && !/write|admin/.test(String((req as any).apiKeyScopes || 'read'))) {
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

/** Thống kê tin theo nhóm: số tin + tin gần nhất (một câu SQL, DISTINCT ON + đếm theo cửa sổ) */
async function thongKeTin(sp: any): Promise<Map<string, { soTin: number; tinCuoi: any }>> {
    const rows: any[] = await sp.$queryRawUnsafe(
        `SELECT DISTINCT ON (t."groupId") t."groupId", t."noiDung", t."nguoiGui", t."thoiDiem", t."yeuCauHoaDon",
                COUNT(*) OVER (PARTITION BY t."groupId")::int AS "soTin"
           FROM "ZaloTin" t
          ORDER BY t."groupId", t."thoiDiem" DESC`,
    )
    return new Map(rows.map(r => [String(r.groupId), {
        soTin: Number(r.soTin) || 0,
        tinCuoi: { noiDung: String(r.noiDung || '').slice(0, 160), nguoiGui: r.nguoiGui, thoiDiem: r.thoiDiem, yeuCauHoaDon: r.yeuCauHoaDon },
    }]))
}

// ─── GET /api/zalo/nhom?customerId=&q=&chuaNoi=1 ────────────────────────────
// Danh sách nhóm đã nối + tên khách + số tin + tin gần nhất (tab Chăm sóc khách hàng).
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
        const rows = await sp.zaloNhom.findMany({ where, orderBy: { maKhach: 'asc' }, take: 2000 })
        const tong = await sp.zaloNhom.count({ where })
        const ids = [...new Set<string>(rows.map((r: any) => r.customerId).filter(Boolean))]
        const khach = ids.length
            ? await sp.customer.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, phone: true, taxCode: true } })
            : []
        const theoId = new Map<string, any>(khach.map((k: any) => [k.id, k]))
        const tk = await thongKeTin(sp)
        res.json({
            success: true, tong,
            data: rows.map((r: any) => ({
                ...r,
                khach: r.customerId ? (theoId.get(r.customerId) || null) : null,
                soTin: tk.get(r.groupId)?.soTin || 0,
                tinCuoi: tk.get(r.groupId)?.tinCuoi || null,
            })),
        })
    } catch (e: any) {
        console.error('[zalo] GET nhom:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── GET /api/zalo/nhom-la ──────────────────────────────────────────────────
// Nhóm có tin n8n đẩy về mà CHƯA có trong bảng nối — đợi người nối với khách thật.
router.get('/nhom-la', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const tk = await thongKeTin(sp)
        const daNoi = new Set<string>((await sp.zaloNhom.findMany({ select: { groupId: true } })).map((r: any) => r.groupId))
        const data = [...tk.entries()]
            .filter(([gid]) => !daNoi.has(gid))
            .map(([groupId, x]) => ({ groupId, soTin: x.soTin, tinCuoi: x.tinCuoi }))
            .sort((a, b) => new Date(b.tinCuoi?.thoiDiem || 0).getTime() - new Date(a.tinCuoi?.thoiDiem || 0).getTime())
        res.json({ success: true, data })
    } catch (e: any) {
        console.error('[zalo] GET nhom-la:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

/** Kéo tin cũ của nhóm theo khách mới — để /hoadon đã nhắn tính đúng khách (nhịp cron bật Lấy HĐ) */
async function ganTinTheoNhom(sp: any, groupId: string, customerId: string | null): Promise<number> {
    const r = await sp.zaloTin.updateMany({ where: { groupId }, data: { customerId } })
    return r.count
}

// ─── POST /api/zalo/nhom {groupId, customerId, tenNhom?} — nối một nhóm ─────
router.post('/nhom', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const b = req.body || {}
        const gid = chuoiGid(b.groupId)
        if (!/^\d{6,25}$/.test(gid)) { res.status(400).json({ success: false, error: 'Group ID phải là dãy số' }); return }
        const k = b.customerId ? await sp.customer.findUnique({ where: { id: String(b.customerId) }, select: { id: true, code: true } }) : null
        if (!k) { res.status(400).json({ success: false, error: 'Chọn khách hàng để nối' }); return }
        const cu = await sp.zaloNhom.findUnique({ where: { groupId: gid } })
        if (cu) { res.status(409).json({ success: false, error: `Nhóm này đã nối với ${cu.maKhach} — dùng "Đổi khách"` }); return }
        const nhom = await sp.zaloNhom.create({
            data: { groupId: gid, tenNhom: b.tenNhom ? String(b.tenNhom).trim().slice(0, 200) : null, maKhach: k.code, customerId: k.id },
        })
        const soTin = await ganTinTheoNhom(sp, gid, k.id)
        res.json({ success: true, data: { ...nhom, soTinGan: soTin } })
    } catch (e: any) {
        console.error('[zalo] POST nhom:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── PUT /api/zalo/nhom/:id {customerId?, tenNhom?} — đổi khách / đổi tên nhóm ─
router.put('/nhom/:id', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const b = req.body || {}
        const nhom = await sp.zaloNhom.findUnique({ where: { id: String(req.params.id) } })
        if (!nhom) { res.status(404).json({ success: false, error: 'Không tìm thấy nhóm' }); return }
        const data: any = {}
        if (typeof b.tenNhom === 'string') data.tenNhom = b.tenNhom.trim().slice(0, 200) || null
        let soTin = 0
        if (b.customerId !== undefined) {
            const k = b.customerId ? await sp.customer.findUnique({ where: { id: String(b.customerId) }, select: { id: true, code: true } }) : null
            if (b.customerId && !k) { res.status(400).json({ success: false, error: 'Không tìm thấy khách hàng' }); return }
            data.customerId = k?.id || null
            if (k) data.maKhach = k.code
        }
        const moi = await sp.zaloNhom.update({ where: { id: nhom.id }, data })
        if ('customerId' in data && data.customerId !== nhom.customerId) soTin = await ganTinTheoNhom(sp, nhom.groupId, data.customerId)
        res.json({ success: true, data: { ...moi, soTinGan: soTin } })
    } catch (e: any) {
        console.error('[zalo] PUT nhom:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── DELETE /api/zalo/nhom/:id — bỏ nối (tin cũ của nhóm thôi gắn khách) ─────
// ⚠ Không gỡ "Lấy HĐ" đã bật trên phiếu theo nối cũ — việc đó tắt tay ở trang Giao dịch.
router.delete('/nhom/:id', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const nhom = await sp.zaloNhom.findUnique({ where: { id: String(req.params.id) } })
        if (!nhom) { res.status(404).json({ success: false, error: 'Không tìm thấy nhóm' }); return }
        await sp.zaloNhom.delete({ where: { id: nhom.id } })
        const soTin = await ganTinTheoNhom(sp, nhom.groupId, null)
        res.json({ success: true, data: { groupId: nhom.groupId, soTinGo: soTin } })
    } catch (e: any) {
        console.error('[zalo] DELETE nhom:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/nhom/nhap-json {rows:[{maKhach,tenNhom,groupId}], apply, ghiDe} ─
// Trang đọc Excel ngay trên trình duyệt rồi gửi JSON — tránh gửi tệp (WAF của Tino chặn multipart).
router.post('/nhom/nhap-json', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        if (!Array.isArray(b.rows) || !b.rows.length) { res.status(400).json({ success: false, error: 'File không có dòng nào' }); return }
        if (b.rows.length > 5000) { res.status(400).json({ success: false, error: 'Tối đa 5.000 dòng một lần' }); return }
        const kq = await nhapNhomZalo(req.storePrisma as any, b.rows, { apply: b.apply === true, ghiDe: b.ghiDe === true })
        // Nhập thật xong: tin cũ của các nhóm vừa nối kéo theo khách
        if (b.apply === true) {
            const sp = req.storePrisma as any
            const ds = await sp.zaloNhom.findMany({ where: { customerId: { not: null } }, select: { groupId: true, customerId: true } })
            for (const n of ds) await sp.zaloTin.updateMany({ where: { groupId: n.groupId, customerId: null }, data: { customerId: n.customerId } })
        }
        res.json({ success: true, data: kq })
    } catch (e: any) {
        console.error('[zalo] nhap-json:', e?.message || e)
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
        const laLenh = laLenhHoaDon(noiDung)
        // n8n gửi rõ true/false thì theo n8n; không gửi thì tự nhận lệnh "/hoadon"
        const yc = b.yeuCauHoaDon === true || b.yeuCauHoaDon === false ? b.yeuCauHoaDon : (laLenh ? true : null)

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
        // /hoadon ⇒ bật cột "Lấy HĐ" cho phiếu của khách trong ngày (phiếu tạo sau: nhịp cron tick)
        const layHoaDon = yc === true && tin.customerId
            ? await danhDauLayHoaDon(sp, tin.customerId, ngayVN(tin.thoiDiem))
            : null
        res.json({
            success: true,
            data: {
                tinId: tin.id, trung: false, customerId: tin.customerId,
                ...(layHoaDon ? { layHoaDon } : {}),
                maKhach: nhom?.maKhach || null,
                // Yêu cầu HĐ CHỈ được lưu (xem đầu file) — ngày áp dụng là ngày VN của tin
                yeuCauHoaDon: yc,
                ...(yc === true ? { ngayYeuCau: ngayVN(tin.thoiDiem) } : {}),
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

// ─── GET /api/zalo/admin/do?storeCode=&ngay=YYYY-MM-DD — CHỈ ĐỌC (x-admin-key) ─
// Soát một ngày: tin nhóm nào đã về, tin /hoadon của khách nào, và phiếu của khách đó đã
// bật "Lấy HĐ" chưa. Dùng khi chủ shop hỏi "đơn khách X hôm nay đã bật chưa".
router.get('/admin/do', adminKey, async (req: Request, res: Response) => {
    try {
        const store = await registryPrisma.store.findFirst({
            where: { code: { equals: String(req.query.storeCode || '').trim(), mode: 'insensitive' } }, select: { schema: true, name: true },
        })
        if (!store) { res.status(404).json({ success: false, error: 'Không tìm thấy cửa hàng' }); return }
        const sp = getStorePrisma(store.schema) as any
        const ngay = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.ngay || '')) ? String(req.query.ngay) : ngayVN(new Date())
        const tu = new Date(`${ngay}T00:00:00+07:00`), den = new Date(`${ngay}T23:59:59.999+07:00`)
        const tin = await sp.zaloTin.findMany({ where: { thoiDiem: { gte: tu, lte: den } }, orderBy: { thoiDiem: 'asc' }, take: 500 })
        const khachIds = [...new Set<string>(tin.filter((t: any) => t.yeuCauHoaDon && t.customerId).map((t: any) => t.customerId))]
        const khach = khachIds.length
            ? await sp.customer.findMany({ where: { id: { in: khachIds } }, select: { id: true, code: true, name: true } })
            : []
        const theoKhach: any[] = []
        for (const k of khach) {
            const phieu = await sp.transaction.findMany({
                where: {
                    customerId: k.id,
                    OR: [{ transactionDate: { gte: tu, lte: den } }, { transactionDate: null, createdAt: { gte: tu, lte: den } }],
                },
                select: { receiptNumber: true, status: true, total: true, layHoaDon: true, createdAt: true, transactionDate: true },
                orderBy: { createdAt: 'asc' },
            })
            theoKhach.push({ khach: k.code, ten: k.name, phieu })
        }
        const tongBat = await sp.transaction.count({
            where: { layHoaDon: true, OR: [{ transactionDate: { gte: tu, lte: den } }, { transactionDate: null, createdAt: { gte: tu, lte: den } }] },
        })
        res.json({
            success: true, store: store.name, ngay,
            data: {
                soTin: tin.length,
                tin: tin.map((t: any) => ({ thoiDiem: t.thoiDiem, groupId: t.groupId, customerId: t.customerId, nguoiGui: t.nguoiGui, yeuCauHoaDon: t.yeuCauHoaDon, noiDung: String(t.noiDung).slice(0, 80) })),
                theoKhach, tongPhieuLayHoaDonTrongNgay: tongBat,
            },
        })
    } catch (e: any) {
        console.error('[zalo] admin/do:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── GET /api/zalo/yeu-cau-hoa-don?ngay=YYYY-MM-DD (mặc định hôm nay, giờ VN) ──
router.get('/yeu-cau-hoa-don', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const ngay = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.ngay || '')) ? String(req.query.ngay) : ngayVN(new Date())
        res.json({ success: true, data: await dsYeuCauHoaDon(req.storePrisma as any, ngay) })
    } catch (e: any) {
        console.error('[zalo] yeu-cau-hoa-don:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

export default router
