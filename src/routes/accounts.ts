// ─────────────────────────────────────────────────────────────────────────────
//  Chart of Accounts CRUD — /api/accounts
//
//  Thong tu 99/2025/TT-BTC grants enterprises full autonomy over their account
//  system (no more Ministry-of-Finance approval to add/edit accounts), so this
//  exposes complete CRUD with a tree view.
//
//    GET    /api/accounts            tree view (parentId structure)
//    GET    /api/accounts/flat       flat list (filterable)
//    GET    /api/accounts/:code      single account
//    POST   /api/accounts            add account / sub-account
//    POST   /api/accounts/seed       (re)seed the TT99 standard chart
//    PUT    /api/accounts/:code      edit name / description / parent / status
//    DELETE /api/accounts/:code      delete — only when the account has no postings
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { errMsg } from '../lib/errorResponse'
import { COA_SEED, COA_CIRCULAR } from '../lib/chartOfAccounts'

const router = Router()

// Count journal postings that reference an account code (exact or as a sub-account prefix).
async function postingCount(prisma: any, code: string): Promise<number> {
    try {
        const n = await prisma.journalEntry.count({
            where: { OR: [{ debitAccount: code }, { creditAccount: code }] },
        })
        return n
    } catch {
        return 0
    }
}

// Build a parentId/children tree out of the flat ChartOfAccount rows.
function buildTree(rows: any[]): any[] {
    const byCode = new Map<string, any>()
    for (const r of rows) byCode.set(r.code, { ...r, parentId: r.parentCode ?? null, children: [] })
    const roots: any[] = []
    for (const r of rows) {
        const node = byCode.get(r.code)
        if (r.parentCode && byCode.has(r.parentCode)) {
            byCode.get(r.parentCode).children.push(node)
        } else {
            roots.push(node)
        }
    }
    const sortRec = (nodes: any[]) => {
        nodes.sort((a, b) => a.code.localeCompare(b.code))
        for (const n of nodes) if (n.children.length) sortRec(n.children)
    }
    sortRec(roots)
    return roots
}

// GET /api/accounts — tree view
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const where: any = {}
        if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true'
        else where.isActive = true
        const rows = await prisma.chartOfAccount.findMany({ where, orderBy: [{ code: 'asc' }] })
        res.json({ success: true, data: buildTree(rows), circular: COA_CIRCULAR })
    } catch (err: any) {
        console.error('GET /accounts error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/accounts/flat — flat list with optional filters
router.get('/flat', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const where: any = {}
        if (req.query.type) where.type = String(req.query.type)
        if (req.query.parentCode) where.parentCode = String(req.query.parentCode)
        if (req.query.parentId) where.parentCode = String(req.query.parentId)
        if (req.query.isActive !== undefined) where.isActive = req.query.isActive === 'true'
        if (req.query.q) {
            const q = String(req.query.q)
            where.OR = [
                { code: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
                { nameEn: { contains: q, mode: 'insensitive' } },
            ]
        }
        const data = await prisma.chartOfAccount.findMany({ where, orderBy: [{ code: 'asc' }] })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('GET /accounts/flat error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/accounts/seed — (re)seed the TT99 standard chart of accounts
router.post('/seed', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const force = req.body?.force === true || req.query.force === 'true'
        let created = 0, updated = 0, skipped = 0
        const errors: Array<{ code: string; error: string }> = []
        for (const acc of COA_SEED) {
            try {
                const data = {
                    code: acc.code, name: acc.name, nameEn: acc.nameEn ?? null,
                    level: acc.level, parentCode: acc.parentCode ?? null,
                    type: acc.type, nature: acc.nature, description: acc.description ?? null,
                    isSystem: true, isActive: true,
                }
                const existing = await prisma.chartOfAccount.findUnique({ where: { code: acc.code } })
                if (existing) {
                    if (!force) { skipped++; continue }
                    const { code: _ignored, ...updateData } = data
                    await prisma.chartOfAccount.update({ where: { code: acc.code }, data: updateData })
                    updated++
                } else {
                    try {
                        await prisma.chartOfAccount.create({ data })
                        created++
                    } catch (e: any) {
                        if (e?.code === 'P2002') { skipped++ } else { throw e }
                    }
                }
            } catch (itemErr: any) {
                errors.push({ code: acc.code, error: itemErr?.message || String(itemErr) })
            }
        }
        res.json({
            success: true,
            data: { created, updated, skipped, failed: errors.length, total: COA_SEED.length, circular: COA_CIRCULAR, ...(errors.length ? { errors } : {}) },
        })
    } catch (err: any) {
        console.error('POST /accounts/seed error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// GET /api/accounts/:code — single account (+ posting count)
router.get('/:code', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code
        const acc = await prisma.chartOfAccount.findUnique({ where: { code } })
        if (!acc) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' })
        const postings = await postingCount(prisma, code)
        res.json({ success: true, data: { ...acc, parentId: acc.parentCode ?? null, postings } })
    } catch (err: any) {
        console.error('GET /accounts/:code error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/accounts — add account / sub-account
router.post('/', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const body = req.body || {}
        const code = body.code != null ? String(body.code).trim() : ''
        const name = body.name != null ? String(body.name).trim() : ''
        // Accept either parentCode or parentId (UI tree convention).
        const parentCode = (body.parentCode ?? body.parentId)
        let { nameEn, level, type, nature, description, isActive } = body

        if (!code || !name) {
            return res.status(400).json({ success: false, error: 'Mã (code) và tên (name) là bắt buộc' })
        }

        const existing = await prisma.chartOfAccount.findUnique({ where: { code } }).catch(() => null)
        if (existing) return res.status(409).json({ success: false, error: `Tài khoản ${code} đã tồn tại` })

        let parent: any = null
        if (parentCode) {
            parent = await prisma.chartOfAccount.findUnique({ where: { code: String(parentCode) } }).catch(() => null)
            if (!parent) return res.status(400).json({ success: false, error: `Tài khoản cha ${parentCode} không tồn tại` })
        }
        // Inherit type/nature from parent when omitted (sub-accounts share their parent's classification).
        if (!type && parent) type = parent.type
        if (!nature && parent) nature = parent.nature
        if (!type || !nature) {
            return res.status(400).json({ success: false, error: 'type và nature là bắt buộc (hoặc cung cấp parentId để kế thừa)' })
        }

        const data = await prisma.chartOfAccount.create({
            data: {
                code, name,
                nameEn: nameEn ? String(nameEn) : null,
                level: Number(level) || (parentCode ? (Number(parent?.level) || 1) + 1 : 1),
                parentCode: parentCode ? String(parentCode) : null,
                type: String(type), nature: String(nature),
                description: description ? String(description) : null,
                isActive: isActive !== false,
                isSystem: false,
            },
        })
        res.status(201).json({ success: true, data: { ...data, parentId: data.parentCode ?? null } })
    } catch (err: any) {
        console.error('POST /accounts error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// PUT /api/accounts/:code — edit name / description / parent / status (code is immutable)
router.put('/:code', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code
        const existing = await prisma.chartOfAccount.findUnique({ where: { code } }).catch(() => null)
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' })

        const body = req.body || {}
        const updateData: any = {}
        if (body.name !== undefined) updateData.name = String(body.name)
        if (body.nameEn !== undefined) updateData.nameEn = body.nameEn === null ? null : String(body.nameEn)
        if (body.level !== undefined) updateData.level = Number(body.level)
        const parentCode = body.parentCode ?? body.parentId
        if (parentCode !== undefined) {
            if (parentCode === null || parentCode === '') {
                updateData.parentCode = null
            } else {
                if (String(parentCode) === code) return res.status(400).json({ success: false, error: 'Tài khoản không thể là cha của chính nó' })
                const parent = await prisma.chartOfAccount.findUnique({ where: { code: String(parentCode) } }).catch(() => null)
                if (!parent) return res.status(400).json({ success: false, error: `Tài khoản cha ${parentCode} không tồn tại` })
                updateData.parentCode = String(parentCode)
            }
        }
        // type/nature on system accounts are protected to keep reports/closing logic correct.
        if (body.type !== undefined) {
            if (existing.isSystem) return res.status(400).json({ success: false, error: 'Không thể đổi loại tài khoản hệ thống' })
            updateData.type = String(body.type)
        }
        if (body.nature !== undefined) {
            if (existing.isSystem) return res.status(400).json({ success: false, error: 'Không thể đổi tính chất tài khoản hệ thống' })
            updateData.nature = String(body.nature)
        }
        if (body.description !== undefined) updateData.description = body.description === null ? null : String(body.description)
        if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive)

        const data = await prisma.chartOfAccount.update({ where: { code }, data: updateData })
        res.json({ success: true, data: { ...data, parentId: data.parentCode ?? null } })
    } catch (err: any) {
        console.error('PUT /accounts/:code error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// DELETE /api/accounts/:code — hard delete, only when the account has no postings & no children
router.delete('/:code', authMiddleware, requireRole('admin', 'manager', 'superadmin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code
        const existing = await prisma.chartOfAccount.findUnique({ where: { code } }).catch(() => null)
        if (!existing) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' })

        // Has postings? Refuse (this is the core invariant).
        const postings = await postingCount(prisma, code)
        if (postings > 0) {
            return res.status(409).json({
                success: false,
                error: `Không thể xóa: tài khoản ${code} đã có ${postings} bút toán. Hãy ngừng sử dụng (vô hiệu hóa) thay vì xóa.`,
                postings,
            })
        }
        // Has child accounts? Refuse.
        const children = await prisma.chartOfAccount.count({ where: { parentCode: code } })
        if (children > 0) {
            return res.status(409).json({ success: false, error: `Không thể xóa: tài khoản ${code} còn ${children} tài khoản con.` })
        }

        await prisma.chartOfAccount.delete({ where: { code } })
        res.json({ success: true, data: { code, deleted: true } })
    } catch (err: any) {
        console.error('DELETE /accounts/:code error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
