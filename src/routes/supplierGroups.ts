// ─────────────────────────────────────────────────────────────────────────────
//  NHÓM NHÀ CUNG CẤP — /api/supplier-groups   (03/09/2026)
//
//  Chủ shop: "có thể gộp nhiều nhà cung cấp thành nhóm, dùng 1 stk để chuyển
//  tiền nha". Thực tế hay gặp: vài pháp nhân khác tên nhưng cùng một chủ, hoặc
//  cùng một người đứng ra thu tiền — kế toán chuyển về một tài khoản duy nhất.
//
//  LUẬT ƯU TIÊN: tài khoản riêng của NCC THẮNG tài khoản nhóm. Nhóm chỉ là mặc
//  định dùng chung; NCC nào khai riêng thì tiền đi theo cái riêng. Làm ngược lại
//  là tiền của một NCC bị đẩy sang tài khoản người khác — sai kiểu khó đòi lại.
//
//    GET    /api/supplier-groups        danh sách nhóm + số NCC trong nhóm
//    POST   /api/supplier-groups        tạo nhóm
//    PUT    /api/supplier-groups/:id    sửa nhóm (tên, ghi chú, tài khoản)
//    DELETE /api/supplier-groups/:id    xoá nhóm (NCC trong nhóm KHÔNG bị xoá)
//    PUT    /api/supplier-groups/:id/thanh-vien   đặt danh sách NCC của nhóm
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { guiLoi } from '../lib/errorResponse'
import { cacheDel } from '../lib/cache'

const router = Router()

const donCache = (req: AuthRequest) =>
    cacheDel(`${req.user?.storeSchema || 'default'}:suppliers:*`).catch(() => { })

// ─── GET / ───────────────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const nhom = await prisma.supplierGroup.findMany({
            orderBy: { name: 'asc' },
            include: {
                suppliers: {
                    select: { id: true, code: true, name: true, bankBin: true, bankAccountNo: true },
                    orderBy: { name: 'asc' },
                },
            },
        })
        res.json({
            success: true,
            data: nhom.map((n: any) => ({
                ...n,
                soNcc: n.suppliers?.length ?? 0,
                /* Nhóm chưa khai tài khoản thì NÓI RA — nhóm lập ra để dùng chung
                 * tài khoản, mà bỏ trống thì nó không giúp gì cả. */
                thieuTaiKhoan: !(n.bankBin && n.bankAccountNo && n.bankAccountName),
            })),
        })
    } catch (err: any) { guiLoi(res, err, 'GET /supplier-groups lỗi:') }
})

// ─── POST / ──────────────────────────────────────────────────────────────────
router.post('/', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const name = String(req.body?.name || '').trim()
        if (!name) { res.status(400).json({ success: false, error: 'Thiếu tên nhóm' }); return }
        const nhom = await prisma.supplierGroup.create({
            data: {
                name,
                note: req.body?.note ?? null,
                bankBin: req.body?.bankBin ?? null,
                bankAccountNo: req.body?.bankAccountNo ?? null,
                bankAccountName: req.body?.bankAccountName ?? null,
            },
        })
        await donCache(req)
        res.status(201).json({ success: true, data: nhom })
    } catch (err: any) { guiLoi(res, err, 'POST /supplier-groups lỗi:') }
})

// ─── PUT /:id ────────────────────────────────────────────────────────────────
router.put('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const b = req.body || {}
        const data: any = {}
        if (b.name !== undefined) data.name = String(b.name).trim()
        if (b.note !== undefined) data.note = b.note || null
        if (b.bankBin !== undefined) data.bankBin = b.bankBin || null
        if (b.bankAccountNo !== undefined) data.bankAccountNo = b.bankAccountNo || null
        if (b.bankAccountName !== undefined) data.bankAccountName = b.bankAccountName || null
        if (Object.keys(data).length === 0) { res.status(400).json({ success: false, error: 'Không có gì để sửa' }); return }

        const nhom = await prisma.supplierGroup.update({ where: { id: String(req.params.id) }, data })
        // Danh sách NCC cache 300s — sửa tài khoản nhóm mà không dọn thì mã QR
        // vẫn dựng theo số cũ suốt 5 phút (đúng lỗi đã cắn với chính bảng NCC).
        await donCache(req)
        res.json({ success: true, data: nhom })
    } catch (err: any) { guiLoi(res, err, 'PUT /supplier-groups/:id lỗi:') }
})

// ─── PUT /:id/thanh-vien — đặt danh sách NCC của nhóm ────────────────────────
router.put('/:id/thanh-vien', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const groupId = String(req.params.id)
        const ids: string[] = Array.isArray(req.body?.supplierIds)
            ? req.body.supplierIds.map((x: any) => String(x)).filter(Boolean)
            : []

        const nhom = await prisma.supplierGroup.findUnique({ where: { id: groupId } })
        if (!nhom) { res.status(404).json({ success: false, error: 'Không tìm thấy nhóm' }); return }

        /* ĐẶT LẠI cả danh sách chứ không cộng dồn: bỏ một NCC khỏi nhóm cũng phải
         * làm được, mà chỉ có "thêm" thì không bao giờ gỡ ra được.
         * Tuần tự — pool prod mỗi cửa hàng 1 kết nối. */
        const goRa = await prisma.supplier.updateMany({
            where: { groupId, ...(ids.length ? { id: { notIn: ids } } : {}) },
            data: { groupId: null },
        })
        const themVao = ids.length
            ? await prisma.supplier.updateMany({ where: { id: { in: ids } }, data: { groupId } })
            : { count: 0 }

        await donCache(req)
        res.json({ success: true, data: { trongNhom: themVao.count, daGoRa: goRa.count } })
    } catch (err: any) { guiLoi(res, err, 'PUT /supplier-groups/:id/thanh-vien lỗi:') }
})

// ─── DELETE /:id ─────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = String(req.params.id)
        /* Gỡ NCC ra trước rồi mới xoá nhóm. KHÔNG xoá NCC theo — nhóm chỉ là cách
         * gom tài khoản chuyển tiền, xoá nhóm mà mất luôn nhà cung cấp thì mất cả
         * công nợ và lịch sử nhập hàng. */
        await prisma.supplier.updateMany({ where: { groupId: id }, data: { groupId: null } })
        await prisma.supplierGroup.delete({ where: { id } })
        await donCache(req)
        res.json({ success: true, data: { daXoa: id } })
    } catch (err: any) { guiLoi(res, err, 'DELETE /supplier-groups/:id lỗi:') }
})

export default router
