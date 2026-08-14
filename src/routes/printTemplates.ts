// ═══════════════════════════════════════════════════════════════════════════════
//  MẪU IN — đồng bộ giữa các máy
//
//  Trước đây mẫu in chỉ nằm trong localStorage của từng trình duyệt: sửa trên máy
//  tính thì máy POS vẫn in mẫu cũ, xoá dữ liệu trình duyệt là mất sạch, và mỗi
//  lần nâng cấp lại có nguy cơ bị ghi đè về mẫu mặc định.
//
//  Bảng PrintTemplate là bản có thẩm quyền. Trình duyệt vẫn giữ một bản để in
//  được khi mất mạng; khi hai bên lệch thì lấy bản có updatedAt MỚI HƠN.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { errMsg } from '../lib/errorResponse'

const router = Router()

interface MauIn {
    id: string
    name: string
    type: string
    htmlSource: string
    linkedPrinter?: string
    isDefault?: boolean
    isBuiltIn?: boolean
    daSuaTay?: boolean
    updatedAt?: string
}

const chuanHoa = (t: any): MauIn | null => {
    const id = String(t?.id || '').trim()
    if (!id) return null
    return {
        id,
        name: String(t.name || '').slice(0, 200) || id,
        type: String(t.type || 'receipt').slice(0, 50),
        htmlSource: String(t.htmlSource ?? ''),
        linkedPrinter: String(t.linkedPrinter ?? '').slice(0, 200),
        isDefault: !!t.isDefault,
        isBuiltIn: !!t.isBuiltIn,
        daSuaTay: !!t.daSuaTay,
        updatedAt: t.updatedAt ? String(t.updatedAt) : new Date().toISOString(),
    }
}

// GET /api/print-templates — toàn bộ mẫu của cửa hàng
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const rows = await prisma.printTemplate.findMany({ orderBy: { type: 'asc' } })
        res.json({
            success: true,
            data: (rows || []).map((r: any) => ({
                ...r,
                updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
            })),
        })
    } catch (err: any) {
        /* Cửa hàng chưa chạy migrate thì bảng chưa có. Trả mảng rỗng để client
         * dùng bản trong máy như trước, KHÔNG để màn hình cài đặt vỡ. */
        if (/does not exist|P2021/i.test(String(err?.message))) {
            return res.json({ success: true, data: [], chuaCoBang: true })
        }
        console.error('GET /print-templates error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

/**
 * PUT /api/print-templates — đẩy một hoặc nhiều mẫu lên.
 *
 * Ghi theo kiểu "bản mới hơn thắng": mẫu đã có trên máy chủ với updatedAt mới
 * hơn thì GIỮ NGUYÊN. Nếu ghi đè vô điều kiện thì một máy mở lâu ngày, còn giữ
 * bản cũ trong bộ nhớ, đồng bộ lên là xoá mất sửa đổi vừa làm ở máy khác.
 */
router.put('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const dsGui: any[] = Array.isArray(req.body?.templates) ? req.body.templates : [req.body]
        const ds = dsGui.map(chuanHoa).filter(Boolean) as MauIn[]
        if (ds.length === 0) {
            return res.status(400).json({ success: false, error: 'Không có mẫu nào để lưu' })
        }
        // Chặn payload quá lớn — mẫu in là HTML, một mẫu vài chục KB là bất thường
        const qua = ds.find(t => t.htmlSource.length > 500_000)
        if (qua) {
            return res.status(400).json({ success: false, error: `Mẫu "${qua.name}" quá lớn (${Math.round(qua.htmlSource.length / 1024)} KB)` })
        }

        const daGhi: string[] = []
        const boQua: string[] = []
        for (const t of ds) {
            const cu = await prisma.printTemplate.findUnique({ where: { id: t.id } }).catch(() => null)
            const moiHon = !cu || new Date(t.updatedAt!) >= new Date(cu.updatedAt)
            if (!moiHon) { boQua.push(t.id); continue }

            const data = {
                name: t.name, type: t.type, htmlSource: t.htmlSource,
                linkedPrinter: t.linkedPrinter || '',
                isDefault: !!t.isDefault, isBuiltIn: !!t.isBuiltIn,
                daSuaTay: !!t.daSuaTay,
                updatedAt: new Date(t.updatedAt!),
            }
            await prisma.printTemplate.upsert({
                where: { id: t.id },
                create: { id: t.id, ...data },
                update: data,
            })
            daGhi.push(t.id)
        }

        res.json({ success: true, data: { daGhi: daGhi.length, boQuaVìCũHơn: boQua.length, boQua } })
    } catch (err: any) {
        if (/does not exist|P2021/i.test(String(err?.message))) {
            return res.status(503).json({
                success: false,
                error: 'Cửa hàng chưa có bảng mẫu in — chạy /api/admin/migrate rồi thử lại',
            })
        }
        console.error('PUT /print-templates error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/print-templates/:id — xoá mẫu (chỉ mẫu người dùng tự tạo)
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const cu = await prisma.printTemplate.findUnique({ where: { id } }).catch(() => null)
        if (!cu) return res.json({ success: true, data: { daXoa: 0 } })
        if (cu.isBuiltIn) {
            return res.status(400).json({ success: false, error: 'Không xoá được mẫu có sẵn của hệ thống' })
        }
        await prisma.printTemplate.delete({ where: { id } })
        res.json({ success: true, data: { daXoa: 1 } })
    } catch (err: any) {
        console.error('DELETE /print-templates/:id error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
