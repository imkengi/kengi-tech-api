// ─────────────────────────────────────────────────────────────────────────────
//  NHẬT KÝ ĐÓNG GÓI — /api/packing-logs   (03/09/2026)
//
//  Chủ shop: "nhân viên đóng hàng sẽ lưu lại đóng bao nhiêu đơn ngày hôm đó và
//  coi như hôm làm là chấm công luôn".
//
//    POST /api/packing-logs          ghi 1 đơn vừa đóng xong (+ tự chấm công)
//    GET  /api/packing-logs/thong-ke đếm theo nhân viên / theo ngày
//
//  HAI ĐIỀU CỐ Ý:
//
//  1. DANH TÍNH LẤY TỪ TOKEN, không nhận từ máy khách. Nhận `userId` do client
//     gửi thì ai cũng khai được mình đóng trăm đơn — mà con số này dùng để chấm
//     công, tức là dính tới lương.
//
//  2. CHẤM CÔNG LÀ HỆ QUẢ, KHÔNG PHẢI Ô NHẬP. Đóng đơn đầu tiên trong ngày thì
//     tạo bản ghi chấm công (checkIn = lúc đó); mỗi đơn sau chỉ đẩy checkOut ra.
//     Không tạo bản ghi trùng — bảng Attendance là căn cứ tính lương, đẻ hai
//     dòng cho một ngày là tính công đôi.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchId } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { guiLoi } from '../lib/errorResponse'

const router = Router()

/** 00:00 giờ VN của một mốc thời gian — khoá ngày làm việc */
function ngayLamViec(d: Date): Date {
    const vn = new Date(d.getTime() + 7 * 3600_000)
    return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()))
}

// ─── POST / — ghi một đơn vừa đóng xong ──────────────────────────────────────
router.post('/', authMiddleware, requirePermission('packing.view', 'online_orders.view', 'orders.view'),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma: any = req.storePrisma!
            const orderCode = String(req.body?.orderCode || '').trim()
            if (!orderCode) { res.status(400).json({ success: false, error: 'Thiếu orderCode' }); return }

            const userId = String(req.user?.userId || '')
            const userName = String((req.user as any)?.name || req.user?.email || 'Không rõ')
            if (!userId) { res.status(401).json({ success: false, error: 'Chưa xác thực' }); return }

            const bayGio = new Date()
            const workDate = ngayLamViec(bayGio)
            const branchId = getBranchId(req) || null

            /* Đóng lại cùng một đơn trong ngày KHÔNG đếm thêm — khoá duy nhất lo
             * việc đó, ở đây chỉ cần nuốt lỗi trùng cho êm. */
            let daGhi = true
            try {
                await prisma.packingLog.create({
                    data: { userId, userName, orderCode, workDate, branchId },
                })
            } catch (e: any) {
                if (e?.code === 'P2002') daGhi = false
                else throw e
            }

            // ─── Chấm công: đơn đầu tiên trong ngày mở công, các đơn sau đẩy giờ ra ───
            let chamCong: 'moi' | 'capNhat' | 'boQua' = 'boQua'
            try {
                const dauNgay = workDate
                const cuoiNgay = new Date(workDate.getTime() + 86400_000)
                const daCo = await prisma.attendance.findFirst({
                    where: { userId, date: { gte: dauNgay, lt: cuoiNgay } },
                })
                if (!daCo) {
                    await prisma.attendance.create({
                        data: {
                            userId, userName, branchId,
                            role: String(req.user?.role || '') || null,
                            date: workDate, checkIn: bayGio, checkOut: bayGio,
                            status: 'present',
                            note: 'Tự chấm công từ việc đóng gói',
                        },
                    })
                    chamCong = 'moi'
                } else {
                    await prisma.attendance.update({
                        where: { id: daCo.id },
                        data: { checkOut: bayGio, ...(daCo.checkIn ? {} : { checkIn: bayGio }) },
                    })
                    chamCong = 'capNhat'
                }
            } catch (e: any) {
                /* Chấm công hỏng KHÔNG được làm hỏng việc ghi đơn — người ta đang
                 * đứng đóng hàng, không thể vì bảng công mà chặn. Nói ra ở log. */
                console.error('[packing-logs] không chấm công được:', e?.message || e)
            }

            const soDonHomNay = await prisma.packingLog.count({
                where: { userId, workDate },
            }).catch(() => null)

            res.json({
                success: true,
                data: { daGhi, trungLap: !daGhi, soDonHomNay, chamCong, nguoiDong: userName },
            })
        } catch (err: any) {
            guiLoi(res, err, 'POST /packing-logs lỗi:')
        }
    })

// ─── GET /thong-ke — đếm theo nhân viên, theo ngày ───────────────────────────
router.get('/thong-ke', authMiddleware, requirePermission('packing.view', 'online_orders.view', 'orders.view'),
    async (req: AuthRequest, res: Response) => {
        try {
            const prisma: any = req.storePrisma!
            const hnay = ngayLamViec(new Date())
            const tu = req.query.from
                ? ngayLamViec(new Date(String(req.query.from)))
                : new Date(hnay.getTime() - 29 * 86400_000)
            const den = req.query.to ? ngayLamViec(new Date(String(req.query.to))) : hnay

            const ds = await prisma.packingLog.findMany({
                where: { workDate: { gte: tu, lte: den } },
                select: { userId: true, userName: true, workDate: true, orderCode: true },
                take: 20000,
            })

            /* Gom ở máy chủ thay vì groupBy: số dòng nhỏ (một tiệm đóng vài trăm
             * đơn/ngày), mà groupBy hai tầng thì phải hai lượt truy vấn — pool
             * prod chỉ 1 kết nối. */
            const theoNguoi = new Map<string, { userId: string; userName: string; tongDon: number; soNgayLam: number; theoNgay: Record<string, number> }>()
            for (const r of ds) {
                const ngay = new Date(r.workDate).toISOString().slice(0, 10)
                let o = theoNguoi.get(r.userId)
                if (!o) {
                    o = { userId: r.userId, userName: r.userName, tongDon: 0, soNgayLam: 0, theoNgay: {} }
                    theoNguoi.set(r.userId, o)
                }
                o.tongDon++
                o.theoNgay[ngay] = (o.theoNgay[ngay] || 0) + 1
                o.userName = r.userName   // giữ tên mới nhất
            }
            for (const o of theoNguoi.values()) o.soNgayLam = Object.keys(o.theoNgay).length

            const nhanVien = Array.from(theoNguoi.values()).sort((a, b) => b.tongDon - a.tongDon)
            res.json({
                success: true,
                data: {
                    tu: tu.toISOString().slice(0, 10),
                    den: den.toISOString().slice(0, 10),
                    tongDon: ds.length,
                    nhanVien,
                    // Chạm trần thì NÓI RÕ, đừng để con số cắt ngầm thành kết luận
                    chamTran: ds.length >= 20000,
                },
            })
        } catch (err: any) {
            guiLoi(res, err, 'GET /packing-logs/thong-ke lỗi:')
        }
    })

export default router
