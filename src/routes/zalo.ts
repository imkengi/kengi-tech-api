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
 *
 * ĐĂNG NHẬP ZALO NGAY TRONG KENGI (25/10/2026) — gửi tin nhóm + quét nhóm không cần n8n (lib/zaloKengi.ts):
 *   GET  /api/zalo/dang-nhap              trạng thái phiên (tên, ảnh, sống / hết hạn) — không bao giờ có cookie
 *   POST /api/zalo/dang-nhap/qr           LUỒNG SSE: mã QR → đã quét → xong (chỉ quản lý, không nhận khoá API)
 *   POST /api/zalo/dang-nhap/kiem-tra     đăng nhập lại từ bản lưu — cứu được lần kết luận "hết hạn" nhầm
 *   POST /api/zalo/dang-xuat              quên phiên trong Kengi
 *
 * TUỲ CHỌN GỬI (25/10/2026, lib/zaloTuyChon.ts): /gui-thu + /dot-gui nhận `tuyChon` {mucDo, nhacCaNhom, tuXoa,
 * henGio}; thẻ định dạng [đậm]… nằm ngay trong noiDung. POST /api/zalo/dot-gui/:id/gui-ngay = bỏ giờ hẹn.
 *
 * GỬI ĐỊNH KỲ (26/10/2026, lib/zaloLichGui.ts): /api/zalo/lich-gui (GET, POST, PUT /:id, DELETE /:id, POST /:id/bat,
 * POST /:id/chay-ngay, POST /xem). Biến công nợ {congNo} {ngayChot} dùng được cả trong /gui-thu + /dot-gui.
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
import {
    docChiMucKhach, goiYKhach, kiemUrlN8n, goiN8n, docNhomTuN8n, luuNhomQuet, chonKenhGui, guiQuaKenh, CAU_CHUA_CO_KENH,
} from '../lib/zaloGui'
import { docTrangThai, dangNhapQR, kiemTraPhien, dangXuat, dsNhomZalo, LoiPhienZalo, laLoiZalo, type SuKienQR } from '../lib/zaloKengi'
import { docTuyChon, luuTuyChonDot, docTuyChonCacDot, boHenGio } from '../lib/zaloTuyChon'
import {
    dsLich, layLich, docDuLieuLich, taoLich, suaLich, datBat, xoaLich, chayLich, soanNguoiNhan, tinMau, lanDau,
    moTaTanSuat, kiemSoNoTuoi, dungBienCongNo, bienCongNo, moTaBo,
} from '../lib/zaloLichGui'
import { dungBienHomNay, canNoDauNgay, soNgayCuaKhach, bienHomNay } from '../lib/zaloGiaoDichNgay'
import { nhanDangAnh, luuAnhSanPham } from '../lib/anhSanPham'
import { dungBienDoanhSo, docCauHinhDoanhSo, tinhDoanhSo, bienDoanhSo, CauHinhDoanhSo } from '../lib/zaloDoanhSo'

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
        // Nhóm chưa có khách: gợi ý ghép theo tên nhóm (trùng mã / tên giống)
        const canGoiY = rows.some((r: any) => !r.customerId && r.tenNhom)
        const cm = canGoiY ? await docChiMucKhach(sp) : null
        res.json({
            success: true, tong,
            data: rows.map((r: any) => ({
                ...r,
                khach: r.customerId ? (theoId.get(r.customerId) || null) : null,
                soTin: tk.get(r.groupId)?.soTin || 0,
                tinCuoi: tk.get(r.groupId)?.tinCuoi || null,
                goiY: !r.customerId && cm ? goiYKhach(cm, r.tenNhom) : [],
            })),
        })
    } catch (e: any) {
        console.error('[zalo] GET nhom:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── GET /api/zalo/nhom-la ──────────────────────────────────────────────────
// Nhóm CHƯA nối: có tin n8n đẩy về, hoặc n8n quét thấy (có tên) — kèm gợi ý ghép khách.
router.get('/nhom-la', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const tk = await thongKeTin(sp)
        const daNoi = new Set<string>((await sp.zaloNhom.findMany({ select: { groupId: true } })).map((r: any) => r.groupId))
        const quet: any[] = await sp.zaloNhomQuet.findMany({}).catch(() => [])   // bảng chưa migrate thì coi như chưa quét
        const tenQuet = new Map<string, any>(quet.map((q: any) => [q.groupId, q]))
        const ids = new Set<string>([...tk.keys(), ...quet.map((q: any) => q.groupId)])
        const cm = await docChiMucKhach(sp)
        const data = [...ids].filter(gid => !daNoi.has(gid)).map(groupId => {
            const q = tenQuet.get(groupId)
            const x = tk.get(groupId)
            return {
                groupId, tenNhom: q?.tenNhom || null, soThanhVien: q?.soThanhVien || null, quetLuc: q?.quetLuc || null,
                soTin: x?.soTin || 0, tinCuoi: x?.tinCuoi || null,
                goiY: goiYKhach(cm, q?.tenNhom),
            }
        }).sort((m, n) => (n.goiY[0]?.diem || 0) - (m.goiY[0]?.diem || 0)
            || new Date(n.tinCuoi?.thoiDiem || 0).getTime() - new Date(m.tinCuoi?.thoiDiem || 0).getTime())
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

/* ═══ n8n: CẤU HÌNH + QUÉT NHÓM + GỬI TIN (18/10/2026) — lõi ở lib/zaloGui.ts ═══ */

const CALLBACK_QUET = 'https://api.kengi.vn/api/zalo/nhom/quet'

/** Lỗi phiên / lỗi Zalo là lời nhắn cho người dùng — hiện nguyên văn; lỗi máy mình thì che như mọi route */
function loiChoNguoiDung(e: any): string {
    if (e instanceof LoiPhienZalo) return e.message
    if (laLoiZalo(e)) return `Zalo: ${String(e?.message || '').slice(0, 200)}`
    return errMsg(e)
}

// ─── GET /api/zalo/cau-hinh ─────────────────────────────────────────────────
// Kèm phienZalo (trạng thái đăng nhập Zalo trong Kengi) — trang cần biết có kênh gửi nào không
router.get('/cau-hinh', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const ch = await sp.zaloCauHinh.findUnique({ where: { id: 'default' } })
        let phienZalo: any = null
        try { phienZalo = await docTrangThai(sp) } catch (e: any) { console.error('[zalo] cau-hinh phienZalo:', e?.message || e) }
        res.json({ success: true, data: ch || { id: 'default', n8nQuetUrl: null, n8nGuiUrl: null, guiMoiPhut: 4, quetLuc: null, quetKetQua: null }, callbackQuet: CALLBACK_QUET, phienZalo })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── PUT /api/zalo/cau-hinh {n8nQuetUrl?, n8nGuiUrl?, guiMoiPhut?} ───────────
router.put('/cau-hinh', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const b = req.body || {}
        const data: any = {}
        for (const k of ['n8nQuetUrl', 'n8nGuiUrl'] as const) {
            if (b[k] === undefined) continue
            const v = String(b[k] || '').trim()
            if (v) { const loi = kiemUrlN8n(v); if (loi) { res.status(400).json({ success: false, error: `${k === 'n8nQuetUrl' ? 'Webhook quét' : 'Webhook gửi'}: ${loi}` }); return } }
            data[k] = v || null
        }
        if (b.guiMoiPhut !== undefined) data.guiMoiPhut = Math.min(30, Math.max(1, Math.round(Number(b.guiMoiPhut) || 4)))
        const ch = await (req.storePrisma as any).zaloCauHinh.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data })
        res.json({ success: true, data: ch })
    } catch (e: any) {
        console.error('[zalo] PUT cau-hinh:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/nhom/quet-ngay — nút "Quét lại nhóm" ────────────────────
// Đã đăng nhập Zalo trong Kengi: đọc thẳng danh sách nhóm của tài khoản (lib/zaloKengi.ts).
// Chưa thì gọi webhook quét của n8n. n8n trả danh sách ngay thì lưu luôn; không thì n8n POST về
// /api/zalo/nhom/quet sau (kèm X-API-Key + X-Store-Code như gửi tin).
router.post('/nhom/quet-ngay', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const phien = await docTrangThai(sp)
        if (phien.coPhien) {
            if (phien.trangThai !== 'song') { res.status(400).json({ success: false, error: 'Phiên Zalo trong Kengi đã hết hạn — quét lại mã QR ở mục Đăng nhập Zalo', hetHan: true }); return }
            const kq = await dsNhomZalo(sp)
            const ds = docNhomTuN8n(kq.raw)
            if (!ds.length && kq.soId) {
                res.status(502).json({ success: false, error: `Zalo có ${kq.soId} nhóm nhưng không đọc được thông tin nhóm nào${kq.loLoi.length ? ` (${kq.loLoi[0]})` : ''} — thử lại sau ít phút` })
                return
            }
            const luu = await luuNhomQuet(sp, ds)
            const thieu = kq.soId - ds.length
            res.json({
                success: true,
                data: { ...luu, quaKengi: true, ...(thieu > 0 ? { canhBao: `${thieu} nhóm chưa đọc được thông tin${kq.loLoi.length ? ` (${kq.loLoi[0]})` : ''} — bấm quét lại sau` } : {}) },
            })
            return
        }
        const ch = await sp.zaloCauHinh.findUnique({ where: { id: 'default' } })
        if (!ch?.n8nQuetUrl) { res.status(400).json({ success: false, error: 'Chưa đăng nhập Zalo (mục Đăng nhập Zalo) và chưa dán webhook QUÉT NHÓM của n8n', chuaCauHinh: true }); return }
        const r = await goiN8n(ch.n8nQuetUrl, { loai: 'quet_nhom', storeCode: req.user?.storeCode || null, callbackUrl: CALLBACK_QUET }, 90_000)
        if (!r.ok) { res.status(502).json({ success: false, error: `n8n báo lỗi: ${r.data?.error || r.data?.message || r.text || 'HTTP ' + r.status}` }); return }
        const ds = docNhomTuN8n(r.data)
        if (!ds.length) {
            res.json({ success: true, data: { soNhom: 0, choN8nGuiVe: true, ghiChu: 'n8n đã nhận lệnh nhưng chưa trả danh sách nhóm — nếu workflow gửi về sau, bấm làm mới sau ít phút' } })
            return
        }
        res.json({ success: true, data: await luuNhomQuet(sp, ds) })
    } catch (e: any) {
        console.error('[zalo] quet-ngay:', e?.message || e)
        res.status(e instanceof LoiPhienZalo ? 400 : laLoiZalo(e) ? 502 : 500)
            .json({ success: false, error: loiChoNguoiDung(e), ...(e instanceof LoiPhienZalo ? { hetHan: true } : {}) })
    }
})

// ─── POST /api/zalo/nhom/quet — n8n gửi danh sách nhóm về (mọi kiểu dữ liệu, xem docNhomTuN8n) ─
router.post('/nhom/quet', authMiddleware, canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const ds = docNhomTuN8n(req.body)
        if (!ds.length) { res.status(400).json({ success: false, error: 'Không đọc được nhóm nào — cần mảng [{groupId, name}] (groupId dạng CHUỖI)' }); return }
        res.json({ success: true, data: await luuNhomQuet(req.storePrisma as any, ds) })
    } catch (e: any) {
        console.error('[zalo] nhom/quet:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

/* ═══ ĐĂNG NHẬP ZALO NGAY TRONG KENGI (25/10/2026) — lõi ở lib/zaloKengi.ts ═══ */

const QUAN_LY = ['admin', 'manager', 'owner', 'superadmin']

/** Đăng nhập / đăng xuất Zalo công ty: chỉ quản lý ĐĂNG NHẬP kengi.vn — khoá API (n8n) không được đổi tài khoản Zalo */
function chiQuanLy(req: AuthRequest, res: Response, next: NextFunction): void {
    if ((req as any).viaApiKey) { res.status(403).json({ success: false, error: 'Đăng nhập Zalo chỉ làm được khi đăng nhập kengi.vn, không dùng khoá API' }); return }
    if (!QUAN_LY.includes(String(req.user?.role || '').toLowerCase())) { res.status(403).json({ success: false, error: 'Chỉ chủ cửa hàng / quản lý mới đăng nhập hoặc đăng xuất Zalo' }); return }
    next()
}

// ─── GET /api/zalo/dang-nhap — trạng thái phiên (KHÔNG BAO GIỜ có cookie) ────
router.get('/dang-nhap', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        res.json({ success: true, data: await docTrangThai(req.storePrisma as any) })
    } catch (e: any) {
        console.error('[zalo] dang-nhap:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/dang-nhap/qr — LUỒNG SSE ────────────────────────────────
// Mỗi dòng "data: {loai, …}": qr (ảnh data:image/png, sống 100 giây) → da_quet (tên, ảnh đại diện) →
// xong | het_han | tu_choi | loi. Trình duyệt đóng kết nối = huỷ chờ quét.
router.post('/dang-nhap/qr', authMiddleware, chiQuanLy, async (req: AuthRequest, res: Response) => {
    const huy = new AbortController()
    res.on('close', () => { if (!res.writableEnded) huy.abort() })
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    })
    res.flushHeaders()
    const conMo = () => !res.writableEnded && !res.destroyed
    const phat = (s: SuKienQR) => { if (conMo()) res.write(`data: ${JSON.stringify(s)}\n\n`) }
    const nhip = setInterval(() => { if (conMo()) res.write(': giu-ket-noi\n\n') }, 15_000)
    try {
        await dangNhapQR(req.storePrisma as any, req.user?.email || req.user?.userId || null, phat, huy.signal)
    } catch (e: any) {
        console.error('[zalo] dang-nhap/qr:', e?.message || e)
        phat({ loai: 'loi', loi: loiChoNguoiDung(e) })
    } finally {
        clearInterval(nhip)
        if (conMo()) res.end()
    }
})

// ─── POST /api/zalo/dang-nhap/kiem-tra — đăng nhập lại từ bản lưu ───────────
// Cả khi đang "hết hạn": kết luận nhầm (Zalo trục trặc) thì bấm đây là sống lại, khỏi quét QR.
router.post('/dang-nhap/kiem-tra', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const kiemTra = await kiemTraPhien(sp, true)
        res.json({ success: true, data: { ...(await docTrangThai(sp)), kiemTra } })
    } catch (e: any) {
        console.error('[zalo] dang-nhap/kiem-tra:', e?.message || e)
        res.status(500).json({ success: false, error: loiChoNguoiDung(e) })
    }
})

// ─── POST /api/zalo/dang-xuat — quên phiên trong Kengi ──────────────────────
router.post('/dang-xuat', authMiddleware, chiQuanLy, async (req: AuthRequest, res: Response) => {
    try {
        res.json({ success: true, data: { daXoa: await dangXuat(req.storePrisma as any) } })
    } catch (e: any) {
        console.error('[zalo] dang-xuat:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/anh {base64} — tải ảnh cho tin nhắn, trả link công khai ──
// Base64 trong JSON chứ không multipart — WAF của Tino chặn gửi tệp (xem lib/anhSanPham.ts).
router.post('/anh', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const b64 = String(req.body?.base64 || '').replace(/^data:[^;]+;base64,/, '')
        if (!b64) { res.status(400).json({ success: false, error: 'Thiếu ảnh' }); return }
        const buf = Buffer.from(b64, 'base64')
        if (buf.length > 6 * 1024 * 1024) { res.status(400).json({ success: false, error: 'Ảnh quá 6MB — thu nhỏ rồi tải lại' }); return }
        const loai = nhanDangAnh(buf)
        if (!loai || loai === 'heic') { res.status(400).json({ success: false, error: loai === 'heic' ? 'Ảnh HEIC (iPhone) — đổi sang JPG/PNG' : 'Chỉ nhận ảnh JPG, PNG, WEBP' }); return }
        const schema = String(req.user?.storeSchema || (req.user as any)?.branchSchema || '')
        // Cùng kho ảnh công khai với ảnh sản phẩm, thư mục con "zalo"
        const url = await luuAnhSanPham(schema, 'zalo', buf, loai)
        res.json({ success: true, data: { url } })
    } catch (e: any) {
        console.error('[zalo] anh:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

function docAnh(v: any): string[] {
    return (Array.isArray(v) ? v : []).map(String).filter(u => /^https:\/\//.test(u)).slice(0, 10)
}

// ─── POST /api/zalo/gui-thu {groupId, noiDung, anh[]} — gửi NGAY vào một nhóm để thử ─
router.post('/gui-thu', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const b = req.body || {}
        const ch = await sp.zaloCauHinh.findUnique({ where: { id: 'default' } })
        const { kenh, tamDung } = await chonKenhGui(sp, ch)
        if (!kenh) { res.status(400).json({ success: false, error: tamDung || CAU_CHUA_CO_KENH, ...(tamDung ? { hetHan: true } : {}) }); return }
        const gid = chuoiGid(b.groupId)
        if (!/^\d{6,25}$/.test(gid)) { res.status(400).json({ success: false, error: 'Chọn nhóm để gửi thử' }); return }
        if (!String(b.noiDung || '').trim() && !docAnh(b.anh).length) { res.status(400).json({ success: false, error: 'Tin trống' }); return }
        // Gửi thử dùng đủ tuỳ chọn (định dạng, mức độ, nhắc cả nhóm, tự xoá) — trừ hẹn giờ: thử là gửi NGAY
        const tuyChon = docTuyChon(b.tuyChon, false)
        if (typeof tuyChon === 'string') { res.status(400).json({ success: false, error: tuyChon }); return }
        const nhom = await sp.zaloNhom.findUnique({ where: { groupId: gid } })
        const k = nhom?.customerId ? await sp.customer.findUnique({ where: { id: nhom.customerId }, select: { code: true, name: true } }) : null
        let bien: Record<string, string> | null = null
        if (dungBienDoanhSo(b.noiDung)) {
            const cfg = docCauHinhDoanhSo(b.doanhSo)
            if (typeof cfg === 'string' || !cfg) { res.status(400).json({ success: false, error: cfg || 'Tin có {doanhSo} — chọn nhóm hàng và kỳ doanh số' }); return }
            if (!nhom?.customerId) { res.status(400).json({ success: false, error: 'Nhóm gửi thử chưa nối khách nên không có doanh số — chọn nhóm đã nối (vd T1)' }); return }
            const { theoKhach, nhomHang } = await tinhDoanhSo(sp, cfg, [nhom.customerId])
            bien = bienDoanhSo(theoKhach.get(nhom.customerId), cfg, nhomHang)
        }
        // Công nợ {congNo} {ngayChot} (26/10/2026) — số dư của khách nhóm này, chốt ngay lúc gửi thử
        if (dungBienCongNo(b.noiDung)) {
            const kh = nhom?.customerId ? await sp.customer.findUnique({ where: { id: nhom.customerId }, select: { debt: true } }) : null
            if (!kh) { res.status(400).json({ success: false, error: 'Nhóm gửi thử chưa nối khách nên không có số nợ — chọn nhóm đã nối khách' }); return }
            bien = { ...(bien || {}), ...bienCongNo(Number(kh.debt) || 0, new Date()) }
        }
        // Tổng kết hôm nay {muaHomNay} {daTraHomNay}… — số của khách nhóm này, tính ngay lúc gửi thử
        if (dungBienHomNay(b.noiDung)) {
            const kh = nhom?.customerId ? await sp.customer.findUnique({ where: { id: nhom.customerId }, select: { id: true, debt: true } }) : null
            if (!kh) { res.status(400).json({ success: false, error: 'Nhóm gửi thử chưa nối khách nên không có số mua / thanh toán — chọn nhóm đã nối khách' }); return }
            const luc = new Date()
            const { theoKhach } = await soNgayCuaKhach(sp, [{ id: kh.id, debt: kh.debt }], luc)
            // Chưa có số nợ 0 giờ ⇒ không có {noDauNgay}, dienMau bỏ dòng đó (26/10/2026)
            bien = { ...(bien || {}), ...bienHomNay(theoKhach.get(kh.id)!, luc) }
        }
        const kq = await guiQuaKenh(sp, kenh, {
            dotId: null, groupId: gid, noiDung: String(b.noiDung || ''), anh: docAnh(b.anh), tieuDe: b.tieuDe || null,
            maKhach: k?.code || null, tenKhach: k?.name || null, tenNhom: nhom?.tenNhom || null, bien, tuyChon,
        })
        if (!kq.ok) { res.status(502).json({ success: false, error: kq.loi, ...(kq.matPhien ? { hetHan: true } : {}) }); return }
        res.json({ success: true, data: { kenh: kenh.loai } })
    } catch (e: any) {
        console.error('[zalo] gui-thu:', e?.message || e)
        res.status(500).json({ success: false, error: loiChoNguoiDung(e) })
    }
})

// ─── POST /api/zalo/doanh-so/xem {doanhSo:{categoryIds,tu,den}, groupIds?} — xem trước doanh số từng nhóm ─
// groupIds rỗng = mọi nhóm đã nối khách. Chỉ đọc. Số tính giống hệt lúc tạo đợt (lib/zaloDoanhSo.ts).
router.post('/doanh-so/xem', authMiddleware, requirePermission('customers.create'), async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const b = req.body || {}
        const cfg = docCauHinhDoanhSo(b.doanhSo)
        if (typeof cfg === 'string' || !cfg) { res.status(400).json({ success: false, error: cfg || 'Chọn nhóm hàng và kỳ doanh số' }); return }
        const ids = [...new Set<string>((Array.isArray(b.groupIds) ? b.groupIds : []).map(chuoiGid).filter((g: string) => /^\d{6,25}$/.test(g)))]
        const nhom: any[] = await sp.zaloNhom.findMany({
            where: { customerId: { not: null }, ...(ids.length ? { groupId: { in: ids } } : {}) },
            select: { groupId: true, customerId: true, tenNhom: true },
        })
        const kIds = [...new Set<string>(nhom.map(n => n.customerId))]
        const khach: any[] = kIds.length ? await sp.customer.findMany({ where: { id: { in: kIds } }, select: { id: true, code: true, name: true } }) : []
        const theoId = new Map(khach.map(k => [k.id, k]))
        const { theoKhach, nhomHang } = await tinhDoanhSo(sp, cfg, kIds)
        const ds = nhom.map(n => {
            const s = theoKhach.get(n.customerId)
            return {
                groupId: n.groupId, tenNhom: n.tenNhom, customerId: n.customerId,
                maKhach: theoId.get(n.customerId)?.code || null, tenKhach: theoId.get(n.customerId)?.name || null,
                tien: s?.tien || 0, soLuong: s?.soLuong || 0, soDon: s?.soDon || 0,
            }
        }).sort((a, b) => b.tien - a.tien)
        res.json({
            success: true,
            data: {
                nhomHang, tu: cfg.tu, den: cfg.den, ds,
                soNhomChuaNoi: ids.length ? ids.length - nhom.length : 0,
                tongTien: [...theoKhach.values()].reduce((a, s) => a + s.tien, 0),
            },
        })
    } catch (e: any) {
        console.error('[zalo] doanh-so/xem:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/dot-gui {tieuDe?, noiDung, anh[], groupIds[]} — tạo đợt, nhịp cron gửi dần ─
router.post('/dot-gui', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const b = req.body || {}
        const ch = await sp.zaloCauHinh.findUnique({ where: { id: 'default' } })
        // Phiên Kengi hết hạn thì CHẶN tạo đợt (quét lại QR trước) — tạo xong nằm chờ cả ngày mới gửi là tin cũ
        const { kenh, tamDung } = await chonKenhGui(sp, ch)
        if (!kenh) { res.status(400).json({ success: false, error: tamDung || CAU_CHUA_CO_KENH, ...(tamDung ? { hetHan: true } : {}) }); return }
        const noiDung = String(b.noiDung || '').trim()
        const anh = docAnh(b.anh)
        if (!noiDung && !anh.length) { res.status(400).json({ success: false, error: 'Tin trống — nhập nội dung hoặc thêm ảnh' }); return }
        const tuyChon = docTuyChon(b.tuyChon)
        if (typeof tuyChon === 'string') { res.status(400).json({ success: false, error: tuyChon }); return }
        const ids = [...new Set<string>((Array.isArray(b.groupIds) ? b.groupIds : []).map(chuoiGid).filter((g: string) => /^\d{6,25}$/.test(g)))]
        if (!ids.length) { res.status(400).json({ success: false, error: 'Chưa chọn nhóm nào' }); return }
        if (ids.length > 2000) { res.status(400).json({ success: false, error: 'Tối đa 2.000 nhóm một đợt' }); return }
        const nhom: any[] = await sp.zaloNhom.findMany({ where: { groupId: { in: ids } }, select: { groupId: true, customerId: true, tenNhom: true } })
        const quet: any[] = await sp.zaloNhomQuet.findMany({ where: { groupId: { in: ids } }, select: { groupId: true, tenNhom: true } })
        const theoNhom = new Map<string, any>(nhom.map(n => [n.groupId, n]))
        const tenQuet = new Map<string, string | null>(quet.map(q => [q.groupId, q.tenNhom]))

        // Báo doanh số: số CHỐT ngay lúc tạo đợt cho từng nhóm; nhóm chưa nối khách / (tuỳ chọn) khách không mua thì bỏ
        let guiToi = ids
        let cfgDs: (CauHinhDoanhSo & { nhomHang: string }) | null = null
        const bienTheoNhom = new Map<string, Record<string, string>>()
        let boChuaNoi = 0, boKhongMua = 0
        if (dungBienDoanhSo(noiDung)) {
            const cfg = docCauHinhDoanhSo(b.doanhSo)
            if (typeof cfg === 'string' || !cfg) { res.status(400).json({ success: false, error: cfg || 'Tin có {doanhSo} — chọn nhóm hàng và kỳ doanh số' }); return }
            const { theoKhach, nhomHang } = await tinhDoanhSo(sp, cfg, nhom.map(n => n.customerId).filter(Boolean))
            cfgDs = { ...cfg, nhomHang }
            guiToi = []
            for (const gid of ids) {
                const kid = theoNhom.get(gid)?.customerId
                if (!kid) { boChuaNoi++; continue }
                const s = theoKhach.get(kid)
                if (cfg.chiKhachCoDoanhSo && !(s && s.tien > 0)) { boKhongMua++; continue }
                bienTheoNhom.set(gid, bienDoanhSo(s, cfg, nhomHang))
                guiToi.push(gid)
            }
            if (!guiToi.length) {
                res.status(400).json({ success: false, error: `Không còn nhóm nào để gửi: ${boChuaNoi} nhóm chưa nối khách, ${boKhongMua} khách không có doanh số trong kỳ` })
                return
            }
        }

        // Số dư chưa đủ mới (KiotViet chưa đối chiếu / webhook im) ⇒ 409 canXacNhan: người bấm thấy lý do rồi mới quyết.
        // Áp cho {congNo} và {noDauNgay} (ảnh chụp số dư — lib/zaloGiaoDichNgay.ts).
        if ((dungBienCongNo(noiDung) || canNoDauNgay(noiDung)) && b.boQuaKiemTraNo !== true) {
            const t = await kiemSoNoTuoi(sp)
            if (!t.ok) { res.status(409).json({ success: false, error: t.lyDo, canXacNhan: true }); return }
        }
        // Công nợ {congNo} {ngayChot} (26/10/2026): số dư CHỐT lúc tạo đợt, nhóm chưa nối khách bị bỏ.
        if (dungBienCongNo(noiDung)) {
            const luc = new Date()
            const kIds = [...new Set<string>(guiToi.map(g => theoNhom.get(g)?.customerId).filter(Boolean))]
            const khs: any[] = kIds.length ? await sp.customer.findMany({ where: { id: { in: kIds } }, select: { id: true, debt: true } }) : []
            const noTheoKhach = new Map<string, number>(khs.map(k => [k.id, Number(k.debt) || 0]))
            const conLai: string[] = []
            for (const gid of guiToi) {
                const kid = theoNhom.get(gid)?.customerId
                if (!kid || !noTheoKhach.has(kid)) { boChuaNoi++; continue }
                bienTheoNhom.set(gid, { ...(bienTheoNhom.get(gid) || {}), ...bienCongNo(noTheoKhach.get(kid)!, luc) })
                conLai.push(gid)
            }
            guiToi = conLai
            if (!guiToi.length) { res.status(400).json({ success: false, error: `Không còn nhóm nào để gửi: ${boChuaNoi} nhóm chưa nối khách nên không có số nợ` }); return }
        }
        // Tổng kết hôm nay {muaHomNay} {daTraHomNay}… (26/10/2026): nhóm chưa nối khách bị bỏ; chưa có số nợ 0 giờ ⇒ tin
        // bỏ dòng {noDauNgay} (dienMau), vẫn gửi
        let thieuNoDau = 0
        if (dungBienHomNay(noiDung)) {
            const luc = new Date()
            const kIds = [...new Set<string>(guiToi.map(g => theoNhom.get(g)?.customerId).filter(Boolean))]
            const khs: any[] = kIds.length ? await sp.customer.findMany({ where: { id: { in: kIds } }, select: { id: true, debt: true } }) : []
            const { theoKhach } = await soNgayCuaKhach(sp, khs, luc)
            const conLai: string[] = []
            for (const gid of guiToi) {
                const kid = theoNhom.get(gid)?.customerId
                const s = kid ? theoKhach.get(kid) : undefined
                if (!s) { boChuaNoi++; continue }
                if (canNoDauNgay(noiDung) && s.noDau === null) thieuNoDau++
                bienTheoNhom.set(gid, { ...(bienTheoNhom.get(gid) || {}), ...bienHomNay(s, luc) })
                conLai.push(gid)
            }
            guiToi = conLai
            if (!guiToi.length) { res.status(400).json({ success: false, error: `Không còn nhóm nào để gửi: ${boChuaNoi} nhóm chưa nối khách` }); return }
        }

        const dot = await sp.zaloDotGui.create({
            data: {
                tieuDe: b.tieuDe ? String(b.tieuDe).slice(0, 200) : null, noiDung, anh: JSON.stringify(anh), soNhom: guiToi.length,
                nguoiTao: req.user?.email || req.user?.userId || null, doanhSo: cfgDs ? JSON.stringify(cfgDs) : null,
            },
        })
        // Tuỳ chọn + giờ hẹn ghi TRƯỚC khi có hàng chờ: ghi sau thì nhịp gửi có thể lọt vào giữa và gửi luôn
        // tin hẹn 8 giờ sáng mai. Ghi hỏng ⇒ huỷ đợt (chưa có hàng chờ nào) rồi báo lỗi.
        try { await luuTuyChonDot(sp, dot.id, tuyChon) } catch (e: any) {
            await sp.zaloDotGui.updateMany({ where: { id: dot.id }, data: { trangThai: 'huy' } })
            throw e
        }
        await sp.zaloDotGuiNhom.createMany({
            data: guiToi.map(gid => ({
                dotId: dot.id, groupId: gid, customerId: theoNhom.get(gid)?.customerId || null,
                tenNhom: theoNhom.get(gid)?.tenNhom || tenQuet.get(gid) || null,
                bien: bienTheoNhom.has(gid) ? JSON.stringify(bienTheoNhom.get(gid)) : null,
            })),
            skipDuplicates: true,
        })
        const phut = Math.ceil(guiToi.length / Math.max(1, ch?.guiMoiPhut || 4))
        res.json({ success: true, data: { dotId: dot.id, soNhom: guiToi.length, uocTinhPhut: phut, boChuaNoi, boKhongMua, thieuNoDau, kenh: kenh.loai, henGio: tuyChon.henGio } })
    } catch (e: any) {
        console.error('[zalo] dot-gui:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── GET /api/zalo/dot-gui — các đợt gần đây + đếm theo trạng thái ──────────
router.get('/dot-gui', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const dots = await sp.zaloDotGui.findMany({ orderBy: { createdAt: 'desc' }, take: 30 })
        const dem: any[] = dots.length
            ? await sp.zaloDotGuiNhom.groupBy({ by: ['dotId', 'trangThai'], where: { dotId: { in: dots.map((d: any) => d.id) } }, _count: true })
            : []
        // Tuỳ chọn gửi (mức độ, nhắc cả nhóm, tự xoá, giờ hẹn) — đọc hỏng thì danh sách vẫn hiện, chỉ thiếu nhãn
        let tuyChon = new Map<string, any>()
        try { tuyChon = await docTuyChonCacDot(sp, dots.map((d: any) => d.id)) } catch (e: any) { console.error('[zalo] dot-gui tuyChon:', e?.message || e) }
        res.json({
            success: true,
            data: dots.map((d: any) => {
                const c: Record<string, number> = {}
                for (const x of dem.filter(x => x.dotId === d.id)) c[x.trangThai] = x._count
                let anh: string[] = []
                try { anh = d.anh ? JSON.parse(d.anh) : [] } catch { anh = [] }
                let doanhSo: any = null
                try { doanhSo = d.doanhSo ? JSON.parse(d.doanhSo) : null } catch { doanhSo = null }
                return { ...d, anh, doanhSo, dem: c, tuyChon: tuyChon.get(d.id) || null }
            }),
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── GET /api/zalo/dot-gui/:id — từng nhóm của một đợt ──────────────────────
router.get('/dot-gui/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const rows: any[] = await (req.storePrisma as any).zaloDotGuiNhom.findMany({ where: { dotId: String(req.params.id) }, orderBy: [{ trangThai: 'asc' }, { tenNhom: 'asc' }] })
        res.json({
            success: true,
            data: rows.map(r => {
                let bien: any = null
                try { bien = r.bien ? JSON.parse(r.bien) : null } catch { bien = null }
                return { ...r, bien }
            }),
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/dot-gui/:id/huy — dừng các nhóm CHƯA gửi ────────────────
router.post('/dot-gui/:id/huy', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const id = String(req.params.id)
        await sp.zaloDotGui.updateMany({ where: { id }, data: { trangThai: 'huy' } })
        const r = await sp.zaloDotGuiNhom.updateMany({ where: { dotId: id, trangThai: 'cho' }, data: { trangThai: 'huy' } })
        res.json({ success: true, data: { soNhomDung: r.count } })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/dot-gui/:id/gui-ngay — đợt đang HẸN GIỜ thì gửi luôn ─────
router.post('/dot-gui/:id/gui-ngay', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const co = await boHenGio(req.storePrisma as any, String(req.params.id))
        if (!co) { res.status(400).json({ success: false, error: 'Đợt này không hẹn giờ (hoặc đã tới giờ gửi)' }); return }
        res.json({ success: true })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/dot-gui/:id/gui-lai-loi — đưa các nhóm LỖI về hàng đợi ──
router.post('/dot-gui/:id/gui-lai-loi', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const id = String(req.params.id)
        const r = await sp.zaloDotGuiNhom.updateMany({ where: { dotId: id, trangThai: 'loi' }, data: { trangThai: 'cho', loi: null, lanThu: 0 } })
        if (r.count) await sp.zaloDotGui.updateMany({ where: { id }, data: { trangThai: 'dang_gui' } })
        res.json({ success: true, data: { soNhom: r.count } })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

/* ═══ GỬI ĐỊNH KỲ — công nợ / doanh số / tin bất kỳ theo lịch (26/10/2026) — lõi ở lib/zaloLichGui.ts ═══ */

const veLich = (l: any) => ({ ...l, moTa: moTaTanSuat(l.tanSuat) })

// ─── GET /api/zalo/lich-gui ─────────────────────────────────────────────────
router.get('/lich-gui', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        res.json({ success: true, data: (await dsLich(req.storePrisma as any)).map(veLich) })
    } catch (e: any) {
        console.error('[zalo] lich-gui:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/lich-gui/xem — xem trước (KHÔNG ghi gì): ai nhận, số chốt nếu chạy bây giờ, tin mẫu ─
router.post('/lich-gui/xem', authMiddleware, requirePermission('customers.create'), async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const d = docDuLieuLich(req.body)
        if (typeof d === 'string') { res.status(400).json({ success: false, error: d }); return }
        const luc = new Date()
        const soan = await soanNguoiNhan(sp, d, luc)
        const ch = await sp.zaloCauHinh.findUnique({ where: { id: 'default' } })
        const { kenh, tamDung } = await chonKenhGui(sp, ch)
        const noTuoi = dungBienCongNo(d.noiDung) || canNoDauNgay(d.noiDung) ? await kiemSoNoTuoi(sp, luc) : { ok: true, lyDo: null }
        res.json({
            success: true,
            data: {
                soNhom: soan.dong.length, boChuaNoi: soan.boChuaNoi, boKhongNo: soan.boKhongNo, boKhongMua: soan.boKhongMua,
                boKhongGiaoDich: soan.boKhongGiaoDich, thieuNoDau: soan.thieuNoDau, moTaBo: moTaBo(soan),
                tongNo: soan.dong.reduce((a, x) => a + (x.no && x.no > 0 ? x.no : 0), 0),
                ds: soan.dong.slice(0, 500).map(x => ({ groupId: x.groupId, tenNhom: x.tenNhom, maKhach: x.maKhach, tenKhach: x.tenKhach, no: x.no, bien: x.bien })),
                tinMau: tinMau(d.noiDung, soan.dong[0]), nhomMau: soan.dong[0]?.tenNhom || null,
                lanToi: lanDau(d.tanSuat, d.batDauTu, luc).toISOString(), moTa: moTaTanSuat(d.tanSuat),
                noTuoi, kenh: kenh?.loai || null, tamDung, doanhSo: soan.doanhSo,
            },
        })
    } catch (e: any) {
        console.error('[zalo] lich-gui/xem:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/lich-gui — tạo lịch ─────────────────────────────────────
router.post('/lich-gui', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const d = docDuLieuLich(req.body)
        if (typeof d === 'string') { res.status(400).json({ success: false, error: d }); return }
        const l = await taoLich(req.storePrisma as any, d, req.user?.email || req.user?.userId || null)
        res.json({ success: true, data: veLich(l) })
    } catch (e: any) {
        console.error('[zalo] POST lich-gui:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── PUT /api/zalo/lich-gui/:id — sửa lịch (giờ chạy kế tiếp tính lại) ──────
router.put('/lich-gui/:id', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const d = docDuLieuLich(req.body)
        if (typeof d === 'string') { res.status(400).json({ success: false, error: d }); return }
        const l = await suaLich(req.storePrisma as any, String(req.params.id), d)
        if (!l) { res.status(404).json({ success: false, error: 'Không tìm thấy lịch gửi' }); return }
        res.json({ success: true, data: veLich(l) })
    } catch (e: any) {
        console.error('[zalo] PUT lich-gui:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/lich-gui/:id/bat {bat} — bật / tạm tắt ──────────────────
router.post('/lich-gui/:id/bat', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const l = await datBat(req.storePrisma as any, String(req.params.id), req.body?.bat === true)
        if (!l) { res.status(404).json({ success: false, error: 'Không tìm thấy lịch gửi' }); return }
        res.json({ success: true, data: veLich(l) })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── DELETE /api/zalo/lich-gui/:id — xoá lịch (các đợt đã gửi vẫn giữ trong lịch sử) ─
router.delete('/lich-gui/:id', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const co = await xoaLich(req.storePrisma as any, String(req.params.id))
        if (!co) { res.status(404).json({ success: false, error: 'Không tìm thấy lịch gửi' }); return }
        res.json({ success: true })
    } catch (e: any) {
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

// ─── POST /api/zalo/lich-gui/:id/chay-ngay {boQuaKiemTraNo?} — chạy một lượt NGAY (không đổi giờ lượt tới) ─
// Số nợ chưa đủ mới ⇒ 409 canXacNhan kèm lý do: người bấm đọc rồi tự quyết gửi tiếp.
router.post('/lich-gui/:id/chay-ngay', authMiddleware, requirePermission('customers.create'), canGhi, async (req: AuthRequest, res: Response) => {
    try {
        const sp = req.storePrisma as any
        const l = await layLich(sp, String(req.params.id))
        if (!l) { res.status(404).json({ success: false, error: 'Không tìm thấy lịch gửi' }); return }
        const kq = await chayLich(sp, l, { thuCong: true, boQuaKiemTraNo: req.body?.boQuaKiemTraNo === true })
        if (kq.canXacNhan) { res.status(409).json({ success: false, error: kq.ketQua, canXacNhan: true }); return }
        if (kq.boQua) { res.status(400).json({ success: false, error: kq.ketQua }); return }
        res.json({ success: true, data: kq })
    } catch (e: any) {
        console.error('[zalo] lich-gui chay-ngay:', e?.message || e)
        res.status(500).json({ success: false, error: errMsg(e) })
    }
})

export default router
