import { Router, Request, Response } from 'express'
import { authMiddleware, getBranchFilter, AuthRequest, getBranchId } from '../middleware/auth'

const router = Router()

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
//  TAX CONFIG (existing CRUD)
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

// GET /api/tax
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const data = await prisma.taxConfig.findMany({ where: { ...getBranchFilter(req as any) } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/tax
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, rate, description, isDefault } = req.body
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' })
        if (isDefault) await prisma.taxConfig.updateMany({ data: { isDefault: false } })
        const data = await prisma.taxConfig.create({ data: { name, rate: Number(rate) || 0, description, isDefault: isDefault || false } })
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// â”€â”€â”€ Store Info (for tax declarations) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// GET /api/tax/store-info
router.get('/store-info', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const store = await prisma.storeSettings.findFirst() as any
        res.json({
            success: true,
            data: {
                name: store?.name || '',
                address: store?.address || '',
                phone: store?.phone || '',
                email: store?.email || '',
                website: store?.website || '',
                businessType: store?.businessType || 'company',
                taxCode: store?.taxCode || '',
                ownerName: store?.ownerName || '',
                ownerIdNumber: store?.ownerIdNumber || '',
                representativeName: store?.representativeName || '',
            }
        })
    } catch (err) {
        console.error('Get store-info error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/tax/store-info
router.put('/store-info', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, address, phone, email, website, businessType, taxCode, ownerName, ownerIdNumber, representativeName } = req.body
        const data: any = {}
        if (name !== undefined) data.name = name
        if (address !== undefined) data.address = address
        if (phone !== undefined) data.phone = phone
        if (email !== undefined) data.email = email
        if (website !== undefined) data.website = website
        if (businessType !== undefined) data.businessType = businessType
        if (taxCode !== undefined) data.taxCode = taxCode
        if (ownerName !== undefined) data.ownerName = ownerName
        if (ownerIdNumber !== undefined) data.ownerIdNumber = ownerIdNumber
        if (representativeName !== undefined) data.representativeName = representativeName

        const updated = await prisma.storeSettings.upsert({
            where: { id: 'default' },
            create: { id: 'default', name: name || 'My Store', updatedAt: new Date(), ...data },
            update: data,
        }) as any
        res.json({
            success: true,
            data: {
                name: updated.name || '',
                address: updated.address || '',
                phone: updated.phone || '',
                email: updated.email || '',
                website: updated.website || '',
                businessType: updated.businessType || 'company',
                taxCode: updated.taxCode || '',
                ownerName: updated.ownerName || '',
                ownerIdNumber: updated.ownerIdNumber || '',
                representativeName: updated.representativeName || '',
            }
        })
    } catch (err) {
        console.error('Update store-info error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})


// --- HKD Revenue Entries ---

// GET /api/tax/hkd-revenue
router.get('/hkd-revenue', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = Number(req.query.month) || 0
        const bf = getBranchFilter(req as any)
        const where: any = { ...bf }
        if (month) { where.date = { gte: new Date(year, month - 1, 1), lte: new Date(year, month - 1, 31, 23, 59, 59) } }
        else { where.date = { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31, 23, 59, 59) } }
        const entries = await p.hkdRevenueEntry.findMany({ where, orderBy: { date: 'asc' } })
        const summary = entries.reduce((a: any, e: any) => ({ tongDoanhThu: a.tongDoanhThu + e.doanhThu, tongChietKhau: a.tongChietKhau + e.chietKhau, tongThueGTGT: a.tongThueGTGT + e.thueGTGT, tongDoanhThuThuan: a.tongDoanhThuThuan + e.doanhThuThuan, tongThu: a.tongThu + e.doanhThuThuan }), { tongDoanhThu: 0, tongChietKhau: 0, tongThueGTGT: 0, tongDoanhThuThuan: 0, tongThu: 0 })
        const rows = entries.map((e: any, i: number) => ({ stt: i + 1, id: e.id, ngay: new Date(e.date).toLocaleDateString('vi-VN'), soChungTu: e.soChungTu || `HKD-${String(i + 1).padStart(4, '0')}`, dienGiai: e.dienGiai, soHoaDonVAT: '', doanhThuChuaThue: e.doanhThu, chietKhau: e.chietKhau, thueGTGT: e.thueGTGT, doanhThuThuan: e.doanhThuThuan, tongThu: e.doanhThuThuan, phuongThucTT: e.phuongThucTT, ghiChu: e.ghiChu || '', tncnUocTinh: e.tncnUocTinh }))
        res.json({ success: true, data: { rows, summary } })
    } catch (err) { console.error('HKD revenue GET:', err); res.status(500).json({ success: false, error: 'Server error' }) }
})

// POST /api/tax/hkd-revenue
router.post('/hkd-revenue', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { date, soChungTu, dienGiai, doanhThu, chietKhau, thueGTGT, phuongThucTT, ghiChu } = req.body
        if (!dienGiai?.trim()) return res.status(400).json({ success: false, error: 'Dien giai la bat buoc' })
        const dt = Number(doanhThu) || 0, ck = Number(chietKhau) || 0, vat = Number(thueGTGT) || 0
        const thuThuan = dt - ck, tncn = Math.round(dt * 0.005)
        const branchId = getBranchId(req as any)
        const entry = await p.hkdRevenueEntry.create({ data: { date: date ? new Date(date) : new Date(), soChungTu: soChungTu || null, dienGiai, doanhThu: dt, chietKhau: ck, thueGTGT: vat, doanhThuThuan: thuThuan, tncnUocTinh: tncn, phuongThucTT: phuongThucTT || 'Tiền mặt', ghiChu: ghiChu || null, branchId: branchId || null } })
        res.status(201).json({ success: true, data: entry })
    } catch (err) { console.error('HKD revenue POST:', err); res.status(500).json({ success: false, error: 'Server error' }) }
})

// PUT /api/tax/hkd-revenue/:id
router.put('/hkd-revenue/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { date, soChungTu, dienGiai, doanhThu, chietKhau, thueGTGT, phuongThucTT, ghiChu } = req.body
        const dt = Number(doanhThu) || 0, ck = Number(chietKhau) || 0, vat = Number(thueGTGT) || 0
        const thuThuan = dt - ck, tncn = Math.round(dt * 0.005)
        const entry = await p.hkdRevenueEntry.update({ where: { id: req.params.id }, data: { ...(date && { date: new Date(date) }), ...(soChungTu !== undefined && { soChungTu }), ...(dienGiai && { dienGiai }), doanhThu: dt, chietKhau: ck, thueGTGT: vat, doanhThuThuan: thuThuan, tncnUocTinh: tncn, ...(phuongThucTT && { phuongThucTT }), ...(ghiChu !== undefined && { ghiChu }) } })
        res.json({ success: true, data: entry })
    } catch (err) { console.error('HKD revenue PUT:', err); res.status(500).json({ success: false, error: 'Server error' }) }
})

// DELETE /api/tax/hkd-revenue/:id
router.delete('/hkd-revenue/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        await p.hkdRevenueEntry.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) { console.error('HKD revenue DELETE:', err); res.status(500).json({ success: false, error: 'Server error' }) }
})
// PUT /api/tax/:id
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, rate, description, isDefault, status } = req.body
        if (isDefault) await prisma.taxConfig.updateMany({ data: { isDefault: false } })
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const data = await prisma.taxConfig.update({ where: { id }, data: { ...(name && { name }), ...(rate !== undefined && { rate: Number(rate) }), ...(description !== undefined && { description }), ...(isDefault !== undefined && { isDefault }), ...(status && { status }) } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/tax/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        await prisma.taxConfig.delete({ where: { id } }); res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
//  STORE INFO (Tax / Business profile)
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

// GET /api/tax/store-info
router.get('/store-info', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const store = await (prisma as any).store.findFirst()
        if (!store) return res.json({ success: true, data: null })
        res.json({
            success: true,
            data: {
                id: store.id,
                name: store.name,
                address: store.address,
                phone: store.phone,
                email: store.email,
                website: store.website,
                businessType: store.businessType,
                taxCode: store.taxCode,
                ownerName: store.ownerName,
                ownerIdNumber: store.ownerIdNumber,
                representativeName: store.representativeName,
            },
        })
    } catch (err) {
        console.error('GET /store-info error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/tax/store-info
router.put('/store-info', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, address, phone, email, website, businessType, taxCode, ownerName, ownerIdNumber, representativeName } = req.body
        const store = await (prisma as any).store.findFirst()
        if (!store) return res.status(404).json({ success: false, error: 'Store not found' })
        const data = await (prisma as any).store.update({
            where: { id: store.id },
            data: {
                ...(name !== undefined && { name }),
                ...(address !== undefined && { address }),
                ...(phone !== undefined && { phone }),
                ...(email !== undefined && { email }),
                ...(website !== undefined && { website }),
                ...(businessType !== undefined && { businessType }),
                ...(taxCode !== undefined && { taxCode }),
                ...(ownerName !== undefined && { ownerName }),
                ...(ownerIdNumber !== undefined && { ownerIdNumber }),
                ...(representativeName !== undefined && { representativeName }),
            },
        })
        res.json({ success: true, data })
    } catch (err) {
        console.error('PUT /store-info error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
//  REVENUE CHECK & INVOICE LISTING
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

// GET /api/tax/revenue-check?year=2026
router.get('/revenue-check', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const startDate = new Date(year, 0, 1)
        const endDate = new Date(year, 11, 31, 23, 59, 59, 999)

        const transactions = await prisma.transaction.findMany({
            where: { status: 'completed', createdAt: { gte: startDate, lte: endDate } },
            select: { total: true },
        })
        const totalRevenue = transactions.reduce((s, t) => s + (t.total || 0), 0)
        const threshold = 500000000
        res.json({
            success: true,
            data: { totalRevenue, threshold, isAboveThreshold: totalRevenue >= threshold, year },
        })
    } catch (err) {
        console.error('GET /revenue-check error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/tax/invoices?year=2026&month=2&vatOnly=true
router.get('/invoices', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const vatOnly = req.query.vatOnly === 'true'

        let startDate: Date, endDate: Date
        if (month) {
            startDate = new Date(year, month - 1, 1)
            endDate = new Date(year, month, 0, 23, 59, 59, 999)
        } else {
            startDate = new Date(year, 0, 1)
            endDate = new Date(year, 11, 31, 23, 59, 59, 999)
        }

        const where: any = {
            status: 'completed',
            createdAt: { gte: startDate, lte: endDate },
        }
        if (vatOnly) {
            where.vatStatus = 'issued'
        }

        const transactions = await prisma.transaction.findMany({
            where,
            select: {
                id: true, receiptNumber: true, customerName: true, customerPhone: true,
                subtotal: true, tax: true, total: true, discount: true,
                vatInvoiceNumber: true, vatIssuedAt: true, vatStatus: true,
                createdAt: true, transactionDate: true,
            },
            orderBy: { createdAt: 'desc' },
        })

        const summary = {
            count: transactions.length,
            totalRevenue: transactions.reduce((s, t) => s + (t.total || 0), 0),
            totalTax: transactions.reduce((s, t) => s + (t.tax || 0), 0),
            totalSubtotal: transactions.reduce((s, t) => s + (t.subtotal || 0), 0),
        }

        res.json({ success: true, data: transactions, summary })
    } catch (err) {
        console.error('GET /invoices error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
//  TAX DECLARATIONS (01/GTGT + 01/CNKD)
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

// Ã¢â€â‚¬Ã¢â€â‚¬ Helper: get date range for period Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function getPeriodDateRange(periodType: string, year: number, month?: number, quarter?: number) {
    let startDate: Date, endDate: Date
    if (periodType === 'quarter' && quarter) {
        const startMonth = (quarter - 1) * 3 // 0-indexed
        startDate = new Date(year, startMonth, 1)
        endDate = new Date(year, startMonth + 3, 0, 23, 59, 59, 999)
    } else {
        const m = (month || 1) - 1 // 0-indexed
        startDate = new Date(year, m, 1)
        endDate = new Date(year, m + 1, 0, 23, 59, 59, 999)
    }
    return { startDate, endDate }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Helper: calculate 01/GTGT data from transactions & imports Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
async function calculate01GTGT(prisma: any, req: any, periodType: string, year: number, month?: number, quarter?: number) {
    const { startDate, endDate } = getPeriodDateRange(periodType, year, month, quarter)

    const transactions = await prisma.transaction.findMany({
        where: { status: 'completed', createdAt: { gte: startDate, lte: endDate } },
        select: { subtotal: true, tax: true, total: true, discount: true },
    })
    const imports = await prisma.importReceipt.findMany({
        where: { status: 'completed', createdAt: { gte: startDate, lte: endDate } },
        select: { totalCost: true },
    })
    const taxConfigs = await prisma.taxConfig.findMany({ where: { ...getBranchFilter(req as any), status: 'active' } })
    const defaultRate = taxConfigs.find((t: any) => t.isDefault)?.rate ?? 10

    const totalSalesSubtotal = transactions.reduce((s: number, t: any) => s + (t.subtotal || 0), 0)
    const totalSalesTax = transactions.reduce((s: number, t: any) => s + (t.tax || 0), 0)
    let ct21 = 0, ct22 = 0, ct23 = 0, ct24 = 0, ct25 = 0, ct26 = 0, ct27 = 0, ct28 = 0

    if (defaultRate === 0) { ct22 = totalSalesSubtotal }
    else if (defaultRate === 5) { ct23 = totalSalesSubtotal; ct24 = totalSalesTax }
    else if (defaultRate === 8) { ct25 = totalSalesSubtotal; ct26 = totalSalesTax }
    else { ct27 = totalSalesSubtotal; ct28 = totalSalesTax }

    const ct29 = ct21 + ct22 + ct23 + ct25 + ct27
    const ct30 = ct24 + ct26 + ct28
    const totalImportCost = imports.reduce((s: number, i: any) => s + (i.totalCost || 0), 0)
    const ct31 = totalImportCost
    const ct32 = totalImportCost * (defaultRate / 100)
    const ct33 = ct32
    const ct34 = 0
    const ct35 = ct30 - ct33 - ct34
    const ct36 = 0, ct37 = 0
    const ct38 = ct35 > 0 ? ct35 + ct36 - ct37 : 0
    const ct39 = ct35 < 0 ? Math.abs(ct35) - ct36 + ct37 : 0
    const ct40a = 0
    const ct40b = ct39 - ct40a

    return { ct21, ct22, ct23, ct24, ct25, ct26, ct27, ct28, ct29, ct30, ct31, ct32, ct33, ct34, ct35, ct36, ct37, ct38, ct39, ct40a, ct40b }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Helper: calculate 01/CNKD data (Household / Individual business) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
async function calculate01CNKD(prisma: any, periodType: string, year: number, month?: number, quarter?: number) {
    const { startDate, endDate } = getPeriodDateRange(periodType, year, month, quarter)

    // Total revenue from completed transactions
    const transactions = await prisma.transaction.findMany({
        where: { status: 'completed', createdAt: { gte: startDate, lte: endDate } },
        select: { total: true },
    })
    const cnkdRevenue = transactions.reduce((s: number, t: any) => s + (t.total || 0), 0)

    // VAT rate for retail/trade: 1% (ThÃƒÂ´ng tÃ†Â° 40/2021)
    const cnkdVatRate = 1
    // PIT rate for retail/trade: 0.5%
    const cnkdPitRate = 0.5
    const cnkdThreshold = 500000000 // 500 triÃ¡Â»â€¡u/nÃ„Æ’m

    // Annualized revenue for threshold check (estimate)
    const monthsInPeriod = periodType === 'quarter' ? 3 : 1
    const annualizedRevenue = cnkdRevenue * (12 / monthsInPeriod)

    // If annualized revenue below threshold Ã¢â€ â€™ no tax
    const isAboveThreshold = annualizedRevenue > cnkdThreshold
    const cnkdVatAmount = isAboveThreshold ? cnkdRevenue * (cnkdVatRate / 100) : 0
    const cnkdPitAmount = isAboveThreshold ? cnkdRevenue * (cnkdPitRate / 100) : 0
    const cnkdTotalTax = cnkdVatAmount + cnkdPitAmount

    return { cnkdRevenue, cnkdVatRate, cnkdVatAmount, cnkdPitRate, cnkdPitAmount, cnkdTotalTax, cnkdThreshold }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ XML builder helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function escXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function build01GTGT_Xml(decl: any): string {
    const pad2 = (n: number) => String(n).padStart(2, '0')
    const now = new Date()
    const ngayLap = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`
    const fmtNum = (v: number) => Math.round(v)

    return `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu>
  <HSoKhaiThue>
    <TTChung>
      <ma_nd>01/GTGT</ma_nd>
      <ten_nd>TÃ¡Â»Å“ KHAI THUÃ¡ÂºÂ¾ GIÃƒÂ TRÃ¡Â»Å  GIA TÃ„â€šNG (MÃ¡ÂºÂ«u sÃ¡Â»â€˜ 01/GTGT)</ten_nd>
      <mso_thue>${escXml(decl.taxCode)}</mso_thue>
      <ten_NNT>${escXml(decl.companyName)}</ten_NNT>
      <dchi_NNT>${escXml(decl.companyAddress || '')}</dchi_NNT>
      <ky_khai>${escXml(decl.period)}</ky_khai>
      <ky_khai_loai>${decl.periodType === 'month' ? 'T' : 'Q'}</ky_khai_loai>
      <ky_khai_nam>${decl.year}</ky_khai_nam>
      ${decl.month ? `<ky_khai_thang>${pad2(decl.month)}</ky_khai_thang>` : ''}
      ${decl.quarter ? `<ky_khai_quy>${decl.quarter}</ky_khai_quy>` : ''}
      <ngay_lap>${ngayLap}</ngay_lap>
      <lan_nop>1</lan_nop>
      <bo_sung>0</bo_sung>
    </TTChung>
    <CTieuTKhai>
      <ct21>${fmtNum(decl.ct21)}</ct21>
      <ct22>${fmtNum(decl.ct22)}</ct22>
      <ct23>${fmtNum(decl.ct23)}</ct23>
      <ct24>${fmtNum(decl.ct24)}</ct24>
      <ct25>${fmtNum(decl.ct25)}</ct25>
      <ct26>${fmtNum(decl.ct26)}</ct26>
      <ct27>${fmtNum(decl.ct27)}</ct27>
      <ct28>${fmtNum(decl.ct28)}</ct28>
      <ct29>${fmtNum(decl.ct29)}</ct29>
      <ct30>${fmtNum(decl.ct30)}</ct30>
      <ct31>${fmtNum(decl.ct31)}</ct31>
      <ct32>${fmtNum(decl.ct32)}</ct32>
      <ct33>${fmtNum(decl.ct33)}</ct33>
      <ct34>${fmtNum(decl.ct34)}</ct34>
      <ct35>${fmtNum(decl.ct35)}</ct35>
      <ct36>${fmtNum(decl.ct36)}</ct36>
      <ct37>${fmtNum(decl.ct37)}</ct37>
      <ct38>${fmtNum(decl.ct38)}</ct38>
      <ct39>${fmtNum(decl.ct39)}</ct39>
      <ct40a>${fmtNum(decl.ct40a)}</ct40a>
      <ct40b>${fmtNum(decl.ct40b)}</ct40b>
    </CTieuTKhai>
  </HSoKhaiThue>
</HSoThueDTu>`
}

function build01CNKD_Xml(decl: any): string {
    const pad2 = (n: number) => String(n).padStart(2, '0')
    const now = new Date()
    const ngayLap = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`
    const fmtNum = (v: number) => Math.round(v)

    return `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu>
  <HSoKhaiThue>
    <TTChung>
      <ma_nd>01/CNKD</ma_nd>
      <ten_nd>TÃ¡Â»Å“ KHAI THUÃ¡ÂºÂ¾ Ã„ÂÃ¡Â»ÂI VÃ¡Â»Å¡I CÃƒÂ NHÃƒâ€šN KINH DOANH (MÃ¡ÂºÂ«u sÃ¡Â»â€˜ 01/CNKD)</ten_nd>
      <mso_thue>${escXml(decl.taxCode)}</mso_thue>
      <ten_NNT>${escXml(decl.companyName)}</ten_NNT>
      <dchi_NNT>${escXml(decl.companyAddress || '')}</dchi_NNT>
      <loai_hinh>${decl.businessType === 'household' ? 'HKD' : 'CNKD'}</loai_hinh>
      <ky_khai>${escXml(decl.period)}</ky_khai>
      <ky_khai_loai>${decl.periodType === 'month' ? 'T' : 'Q'}</ky_khai_loai>
      <ky_khai_nam>${decl.year}</ky_khai_nam>
      ${decl.month ? `<ky_khai_thang>${pad2(decl.month)}</ky_khai_thang>` : ''}
      ${decl.quarter ? `<ky_khai_quy>${decl.quarter}</ky_khai_quy>` : ''}
      <ngay_lap>${ngayLap}</ngay_lap>
      <lan_nop>1</lan_nop>
      <bo_sung>0</bo_sung>
    </TTChung>
    <CTieuTKhai>
      <nganh_nghe>Ban le</nganh_nghe>
      <doanh_thu>${fmtNum(decl.cnkdRevenue)}</doanh_thu>
      <nguong_chiu_thue>${fmtNum(decl.cnkdThreshold)}</nguong_chiu_thue>
      <ty_le_thue_gtgt>${decl.cnkdVatRate}</ty_le_thue_gtgt>
      <thue_gtgt>${fmtNum(decl.cnkdVatAmount)}</thue_gtgt>
      <ty_le_thue_tncn>${decl.cnkdPitRate}</ty_le_thue_tncn>
      <thue_tncn>${fmtNum(decl.cnkdPitAmount)}</thue_tncn>
      <tong_thue>${fmtNum(decl.cnkdTotalTax)}</tong_thue>
    </CTieuTKhai>
  </HSoKhaiThue>
</HSoThueDTu>`
}

// Ã¢â€â‚¬Ã¢â€â‚¬ GET /api/tax/declarations Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
router.get('/declarations', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const data = await prisma.taxDeclaration.findMany({ orderBy: { createdAt: 'desc' } })
        res.json({ success: true, data })
    } catch (err) {
        console.error('GET /declarations error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ POST /api/tax/declarations Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
router.post('/declarations', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { periodType = 'month', taxCode, companyName, companyAddress, transactionIds, businessType: reqBusinessType } = req.body
        const year = Number(req.body.year)
        const month = req.body.month ? Number(req.body.month) : undefined
        const quarter = req.body.quarter ? Number(req.body.quarter) : undefined

        if (!year || !taxCode || !companyName) {
            return res.status(400).json({ success: false, error: 'year, taxCode, companyName required' })
        }

        // Check annual revenue (used as fallback suggestion only)
        const yearStart = new Date(year, 0, 1)
        const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999)
        const allYearTx = await prisma.transaction.findMany({
            where: { status: 'completed', createdAt: { gte: yearStart, lte: yearEnd } },
            select: { total: true },
        })
        const annualRevenue = allYearTx.reduce((s, t) => s + (t.total || 0), 0)
        const isAboveThreshold = annualRevenue >= 500000000

        // Ã†Â¯u tiÃƒÂªn businessType tÃ¡Â»Â« user chÃ¡Â»Ân, fallback theo doanh thu
        const businessType = (reqBusinessType === 'company' || reqBusinessType === 'household')
            ? reqBusinessType
            : (isAboveThreshold ? 'company' : 'household')
        const formType = businessType === 'company' ? '01_GTGT' : '01_CNKD'

        const period = periodType === 'quarter'
            ? `Q${quarter}/${year}`
            : `T${String(month).padStart(2, '0')}/${year}`

        console.log(`Creating declaration: form=${formType}, revenue=${annualRevenue}, period=${period}, selectedIds=${transactionIds?.length || 'all'}`)

        let calculated: any = {}

        if (transactionIds && transactionIds.length > 0) {
            // Calculate from selected transactions only
            const selectedTx = await prisma.transaction.findMany({
                where: { id: { in: transactionIds }, status: 'completed' },
                select: { subtotal: true, tax: true, total: true, discount: true },
            })

            if (formType === '01_GTGT') {
                const taxConfigs = await prisma.taxConfig.findMany({ where: { ...getBranchFilter(req as any), status: 'active' } })
                const defaultRate = taxConfigs.find(t => t.isDefault)?.rate ?? 10
                const totalSubtotal = selectedTx.reduce((s, t) => s + (t.subtotal || 0), 0)
                const totalTax = selectedTx.reduce((s, t) => s + (t.tax || 0), 0)
                let ct21 = 0, ct22 = 0, ct23 = 0, ct24 = 0, ct25 = 0, ct26 = 0, ct27 = 0, ct28 = 0
                if (defaultRate === 0) { ct22 = totalSubtotal }
                else if (defaultRate === 5) { ct23 = totalSubtotal; ct24 = totalTax }
                else if (defaultRate === 8) { ct25 = totalSubtotal; ct26 = totalTax }
                else { ct27 = totalSubtotal; ct28 = totalTax }
                const ct29 = ct21 + ct22 + ct23 + ct25 + ct27
                const ct30 = ct24 + ct26 + ct28

                // Input VAT from imports in the same period
                const { startDate, endDate } = getPeriodDateRange(periodType, year, month, quarter)
                const imports = await prisma.importReceipt.findMany({
                    where: { status: 'completed', createdAt: { gte: startDate, lte: endDate } },
                    select: { totalCost: true },
                })
                const totalImportCost = imports.reduce((s, i) => s + (i.totalCost || 0), 0)
                const ct31 = totalImportCost, ct32 = totalImportCost * (defaultRate / 100), ct33 = ct32
                const ct34 = 0, ct35 = ct30 - ct33 - ct34
                const ct36 = 0, ct37 = 0
                const ct38 = ct35 > 0 ? ct35 + ct36 - ct37 : 0
                const ct39 = ct35 < 0 ? Math.abs(ct35) - ct36 + ct37 : 0
                const ct40a = 0, ct40b = ct39 - ct40a
                calculated = { ct21, ct22, ct23, ct24, ct25, ct26, ct27, ct28, ct29, ct30, ct31, ct32, ct33, ct34, ct35, ct36, ct37, ct38, ct39, ct40a, ct40b }
            } else {
                const cnkdRevenue = selectedTx.reduce((s, t) => s + (t.total || 0), 0)
                const cnkdVatRate = 1, cnkdPitRate = 0.5
                const cnkdVatAmount = cnkdRevenue * (cnkdVatRate / 100)
                const cnkdPitAmount = cnkdRevenue * (cnkdPitRate / 100)
                const cnkdTotalTax = cnkdVatAmount + cnkdPitAmount
                calculated = { cnkdRevenue, cnkdVatRate, cnkdVatAmount, cnkdPitRate, cnkdPitAmount, cnkdTotalTax, cnkdThreshold: 500000000 }
            }
        } else {
            // Fallback: calculate from all transactions in period
            if (formType === '01_GTGT') {
                calculated = await calculate01GTGT(prisma, req, periodType, year, month, quarter)
            } else {
                calculated = await calculate01CNKD(prisma, periodType, year, month, quarter)
            }
        }

        console.log('Calculated:', JSON.stringify(calculated))

        const data = await prisma.taxDeclaration.create({
            data: {
                formType,
                businessType,
                period, periodType, year,
                month: periodType === 'month' ? (month || null) : null,
                quarter: periodType === 'quarter' ? (quarter || null) : null,
                taxCode, companyName, companyAddress: companyAddress || null,
                ...calculated,
            },
        })

        res.status(201).json({ success: true, data })
    } catch (err: any) {
        console.error('POST /declarations error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ PUT /api/tax/declarations/:id Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
router.put('/declarations/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const { status, notes, filedAt, ...fields } = req.body
        const updateData: any = {}
        if (status) updateData.status = status
        if (notes !== undefined) updateData.notes = notes
        if (filedAt) updateData.filedAt = new Date(filedAt)
        // Allow updating individual chÃ¡Â»â€° tiÃƒÂªu (for manual adjustments)
        const allowedFields = [
            'ct21', 'ct22', 'ct23', 'ct24', 'ct25', 'ct26', 'ct27', 'ct28',
            'ct31', 'ct32', 'ct33', 'ct34', 'ct36', 'ct37', 'ct40a',
            'cnkdRevenue', 'cnkdVatRate', 'cnkdPitRate',
        ]
        for (const f of allowedFields) {
            if (fields[f] !== undefined) updateData[f] = Number(fields[f])
        }
        // Auto-recalculate summaries if any ct field changed
        if (Object.keys(updateData).some(k => k.startsWith('ct'))) {
            const existing = await prisma.taxDeclaration.findUnique({ where: { id } })
            if (existing) {
                const merged = { ...existing, ...updateData }
                merged.ct29 = merged.ct21 + merged.ct22 + merged.ct23 + merged.ct25 + merged.ct27
                merged.ct30 = merged.ct24 + merged.ct26 + merged.ct28
                merged.ct35 = merged.ct30 - merged.ct33 - merged.ct34
                merged.ct38 = merged.ct35 > 0 ? merged.ct35 + merged.ct36 - merged.ct37 : 0
                merged.ct39 = merged.ct35 < 0 ? Math.abs(merged.ct35) - merged.ct36 + merged.ct37 : 0
                merged.ct40b = merged.ct39 - merged.ct40a
                updateData.ct29 = merged.ct29
                updateData.ct30 = merged.ct30
                updateData.ct35 = merged.ct35
                updateData.ct38 = merged.ct38
                updateData.ct39 = merged.ct39
                updateData.ct40b = merged.ct40b
            }
        }
        // Auto-recalculate CNKD if relevant fields changed
        if (Object.keys(updateData).some(k => k.startsWith('cnkd'))) {
            const existing = await prisma.taxDeclaration.findUnique({ where: { id } })
            if (existing) {
                const merged = { ...existing, ...updateData }
                merged.cnkdVatAmount = merged.cnkdRevenue * (merged.cnkdVatRate / 100)
                merged.cnkdPitAmount = merged.cnkdRevenue * (merged.cnkdPitRate / 100)
                merged.cnkdTotalTax = merged.cnkdVatAmount + merged.cnkdPitAmount
                updateData.cnkdVatAmount = merged.cnkdVatAmount
                updateData.cnkdPitAmount = merged.cnkdPitAmount
                updateData.cnkdTotalTax = merged.cnkdTotalTax
            }
        }

        const data = await prisma.taxDeclaration.update({ where: { id }, data: updateData })
        res.json({ success: true, data })
    } catch (err: any) {
        console.error('PUT /declarations/:id error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ DELETE /api/tax/declarations/:id Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
router.delete('/declarations/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        await prisma.taxDeclaration.delete({ where: { id } })
        res.json({ success: true })
    } catch (err: any) {
        console.error('DELETE /declarations/:id error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ GET /api/tax/declarations/:id/xml Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
router.get('/declarations/:id/xml', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const decl = await prisma.taxDeclaration.findUnique({ where: { id } })
        if (!decl) return res.status(404).json({ success: false, error: 'Not found' })

        let xml: string
        if (decl.formType === '01_CNKD') {
            xml = build01CNKD_Xml(decl)
        } else {
            xml = build01GTGT_Xml(decl)
        }

        const filename = `ToKhai_${decl.formType}_${decl.period.replace('/', '-')}.xml`
        res.setHeader('Content-Type', 'application/xml; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
        res.send(xml)
    } catch (err: any) {
        console.error('GET /declarations/:id/xml error:', err)
        res.status(500).json({ success: false, error: err?.message || 'Internal server error' })
    }
})

// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
//  ACCOUNTING MODULE Ã¢â‚¬â€ Wave 1+2 Routes
// Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

// Ã¢â€â‚¬Ã¢â€â‚¬ GET /api/tax/summary?year=2026 (Dashboard KPI Ã¢â‚¬â€ Enhanced) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
router.get('/summary', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const start = new Date(year, 0, 1), end = new Date(year, 11, 31, 23, 59, 59, 999)
        const prevStart = new Date(year - 1, 0, 1), prevEnd = new Date(year - 1, 11, 31, 23, 59, 59, 999)

        // Current year data
        const [txs, expenses, prevTxs, prevExpenses, imports] = await Promise.all([
            prisma.transaction.findMany({ where: { status: 'completed', createdAt: { gte: start, lte: end } }, select: { total: true, tax: true, subtotal: true, discount: true }, }),
            prisma.expense.findMany({ where: { date: { gte: start, lte: end } }, select: { amount: true } }),
            prisma.transaction.findMany({ where: { status: 'completed', createdAt: { gte: prevStart, lte: prevEnd } }, select: { total: true } }).catch(() => []),
            prisma.expense.findMany({ where: { date: { gte: prevStart, lte: prevEnd } }, select: { amount: true } }).catch(() => []),
            prisma.importReceipt.findMany({ where: { status: { not: 'draft' }, createdAt: { gte: start, lte: end } }, select: { totalCost: true } }).catch(() => []),
        ])

        let journalEntries: any[] = []
        try { journalEntries = await prisma.journalEntry.findMany({ where: { date: { gte: year + '-01-01', lte: year + '-12-31' } } }) } catch (_) { }

        const totalRevenue = txs.reduce((s, t) => s + (t.subtotal || t.total || 0), 0)
        const totalTax = txs.reduce((s, t) => s + (t.tax || 0), 0)
        const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0)
        const totalCOGS = imports.reduce((s: number, i: any) => s + (i.totalCost || 0), 0)
        const grossProfit = totalRevenue - totalCOGS
        const netProfit = grossProfit - totalExpenses
        const totalDiscount = txs.reduce((s, t) => s + ((t as any).discount || 0), 0)

        // Previous year for trend comparison
        const prevRevenue = prevTxs.reduce((s: number, t: any) => s + (t.total || 0), 0)
        const prevExpenseTotal = prevExpenses.reduce((s: number, e: any) => s + (e.amount || 0), 0)

        // Journal aggregates
        const jDebit = journalEntries.reduce((s, j) => s + j.amount, 0)
        const jCredit = jDebit  // double-entry: always balanced per entry

        // Monthly breakdown for chart
        const monthlyRevenue = Array.from({ length: 12 }, (_, m) => {
            const mTxs = txs.filter((t: any) => {
                // We don't have createdAt in select, use index-based estimation
                return true
            })
            return 0
        })

        res.json({
            success: true, data: {
                totalRevenue, totalTax, totalExpenses, totalCOGS, totalDiscount,
                grossProfit, netProfit,
                journalCount: journalEntries.length,
                totalDebit: jDebit, totalCredit: jCredit,
                isBalanced: true,
                txCount: txs.length,
                expenseCount: expenses.length,
                importCount: imports.length,
                // Trends (vs previous year)
                revenueTrend: prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue * 100) : null,
                expenseTrend: prevExpenseTotal > 0 ? ((totalExpenses - prevExpenseTotal) / prevExpenseTotal * 100) : null,
            }
        })
    } catch (err) { console.error('GET /summary error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ JOURNAL ENTRIES CRUD Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// GET /api/tax/journal-entries?year=2026&month=3
router.get('/journal-entries', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`
        const entries = await prisma.journalEntry.findMany({
            where: { date: { gte: dateGte, lte: dateEnd } },
            orderBy: { date: 'desc' },
        })
        const totalDebit = entries.reduce((s, e) => s + e.amount, 0)
        const totalCredit = totalDebit
        res.json({ success: true, data: entries, summary: { count: entries.length, totalDebit, totalCredit, isBalanced: true } })
    } catch (err) { console.error('GET /journal-entries error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/tax/journal-entries
router.post('/journal-entries', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { date, description, debitAccount, debitAccountName, creditAccount, creditAccountName, amount, debitAmount, creditAmount, reference, referenceType, notes } = req.body
        if (!date || !description || !debitAccount || !creditAccount || (amount === undefined && debitAmount === undefined && creditAmount === undefined)) {
            return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc' })
        }

        // Resolve amounts: prefer explicit debit/credit, fall back to single amount
        const dAmt = Number(debitAmount ?? amount)
        const cAmt = Number(creditAmount ?? amount)

        // ─── Balance validation (Nguyên tắc kép: Tổng Nợ = Tổng Có) ──────────────
        if (!Number.isFinite(dAmt) || !Number.isFinite(cAmt) || dAmt <= 0 || cAmt <= 0) {
            return res.status(400).json({ success: false, error: 'Số tiền phải > 0' })
        }
        if (dAmt !== cAmt) {
            return res.status(400).json({
                success: false,
                error: `Bút toán chưa cân đối: Tổng Nợ (${dAmt.toLocaleString('vi-VN')}) ≠ Tổng Có (${cAmt.toLocaleString('vi-VN')})`,
            })
        }
        if (debitAccount === creditAccount) {
            return res.status(400).json({ success: false, error: 'TK Nợ và TK Có không được trùng nhau' })
        }

        const data = await prisma.journalEntry.create({
            data: {
                date, description, debitAccount, debitAccountName: debitAccountName || null,
                creditAccount, creditAccountName: creditAccountName || null,
                amount: dAmt, reference: reference || null,
                referenceType: referenceType || 'manual',
                notes: notes || null,
                branchId: (req as any).branchId || null, createdBy: (req as any).userId || null,
            }
        })
        res.status(201).json({ success: true, data })
    } catch (err) { console.error('POST /journal-entries error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/tax/journal-entries/:id
router.delete('/journal-entries/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        await prisma.journalEntry.delete({ where: { id } })
        res.json({ success: true })
    } catch (err) { console.error('DELETE /journal-entries error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ LEDGER (SÃ¡Â»â€¢ CÃƒÂ¡i) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// GET /api/tax/ledger?account=111&year=2026&month=3
router.get('/ledger', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const account = req.query.account as string
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        if (!account) return res.status(400).json({ success: false, error: 'account query param required' })

        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        const entries = await prisma.journalEntry.findMany({
            where: {
                OR: [{ debitAccount: account }, { creditAccount: account }],
                date: { gte: dateGte, lte: dateEnd },
            },
            orderBy: { date: 'asc' },
        })

        let runningBalance = 0
        const ledgerEntries = entries.map(e => {
            const debit = e.debitAccount === account ? e.amount : 0
            const credit = e.creditAccount === account ? e.amount : 0
            runningBalance += debit - credit
            return {
                id: e.id, date: e.date, description: e.description,
                counterAccount: e.debitAccount === account ? e.creditAccount : e.debitAccount,
                debit, credit, balance: runningBalance,
                reference: e.reference,
                referenceType: e.referenceType || 'manual',
            }
        })

        const totalDebit = ledgerEntries.reduce((s, e) => s + e.debit, 0)
        const totalCredit = ledgerEntries.reduce((s, e) => s + e.credit, 0)

        res.json({
            success: true,
            data: {
                account,
                entries: ledgerEntries,
                openingBalance: 0,
                totalDebit, totalCredit,
                closingBalance: runningBalance,
            }
        })
    } catch (err) { console.error('GET /ledger error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ TRIAL BALANCE (BÃ¡ÂºÂ£ng CÃƒÂ¢n Ã„ÂÃ¡Â»â€˜i PS) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// GET /api/tax/trial-balance?year=2026&month=3
router.get('/trial-balance', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        const entries = await prisma.journalEntry.findMany({
            where: { date: { gte: dateGte, lte: dateEnd } },
        })

        // Aggregate by account
        const accountMap: any = {}
        for (const e of entries) {
            // Debit side
            if (!accountMap[e.debitAccount]) accountMap[e.debitAccount] = { code: e.debitAccount, name: e.debitAccountName || e.debitAccount, debit: 0, credit: 0 }
            accountMap[e.debitAccount].debit += e.amount
            // Credit side
            if (!accountMap[e.creditAccount]) accountMap[e.creditAccount] = { code: e.creditAccount, name: e.creditAccountName || e.creditAccount, debit: 0, credit: 0 }
            accountMap[e.creditAccount].credit += e.amount
        }

        const accounts = Object.values(accountMap).sort((a: any, b: any) => a.code.localeCompare(b.code))
        const totalDebit = (accounts as any[]).reduce((s, a) => s + a.debit, 0)
        const totalCredit = (accounts as any[]).reduce((s, a) => s + a.credit, 0)

        res.json({
            success: true,
            data: {
                accounts,
                totalDebit, totalCredit,
                isBalanced: Math.abs(totalDebit - totalCredit) < 1,
            }
        })
    } catch (err) { console.error('GET /trial-balance error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ CASH BOOK (SÃ¡Â»â€¢ QuÃ¡Â»Â¹ TiÃ¡Â»Ân MÃ¡ÂºÂ·t) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// GET /api/tax/cash-book?year=2026&month=3
router.get('/cash-book', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        // Cash = account 111 journal entries
        const entries = await prisma.journalEntry.findMany({
            where: {
                OR: [{ debitAccount: { startsWith: '111' } }, { creditAccount: { startsWith: '111' } }],
                date: { gte: dateGte, lte: dateEnd },
            },
            orderBy: { date: 'asc' },
        })

        let balance = 0
        const cashEntries = entries.map(e => {
            const receipt = e.debitAccount.startsWith('111') ? e.amount : 0
            const payment = e.creditAccount.startsWith('111') ? e.amount : 0
            balance += receipt - payment
            return {
                id: e.id, date: e.date, description: e.description,
                counterAccount: e.debitAccount.startsWith('111') ? e.creditAccount : e.debitAccount,
                receipt, payment, balance, reference: e.reference,
                referenceType: e.referenceType || 'manual',
            }
        })

        const totalReceipts = cashEntries.reduce((s, e) => s + e.receipt, 0)
        const totalPayments = cashEntries.reduce((s, e) => s + e.payment, 0)

        // Daily balances for chart
        const dailyMap: any = {}
        let dBal = 0
        for (const e of cashEntries) {
            dBal += e.receipt - e.payment
            dailyMap[e.date] = dBal
        }
        const dailyBalances = Object.entries(dailyMap).map(([date, balance]) => ({ date, balance }))

        res.json({
            success: true,
            data: {
                entries: cashEntries,
                openingBalance: 0,
                closingBalance: balance,
                totalReceipts, totalPayments,
                dailyBalances,
            }
        })
    } catch (err) { console.error('GET /cash-book error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ DEBT AGING (CÃƒÂ´ng NÃ¡Â»Â£ PhÃ¡ÂºÂ£i Thu/TrÃ¡ÂºÂ£) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// GET /api/tax/debt-aging?type=receivable&year=2026
router.get('/debt-aging', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const debtType = (req.query.type as string) || 'receivable'
        const now = new Date()

        if (debtType === 'receivable') {
            // Customers with debt > 0
            const customers = await prisma.customer.findMany({
                where: { debt: { gt: 0 } },
                select: { id: true, name: true, debt: true, lastPurchaseDate: true },
                orderBy: { debt: 'desc' },
            })
            const rows = customers.map(c => {
                const daysSince = c.lastPurchaseDate ? Math.floor((now.getTime() - new Date(c.lastPurchaseDate).getTime()) / 86400000) : 999
                const current = daysSince <= 0 ? c.debt : 0
                const days30 = daysSince > 0 && daysSince <= 30 ? c.debt : 0
                const days60 = daysSince > 30 && daysSince <= 60 ? c.debt : 0
                const days90 = daysSince > 60 && daysSince <= 90 ? c.debt : 0
                const overdue90 = daysSince > 90 ? c.debt : 0
                return { partnerId: c.id, partnerName: c.name, totalDebt: c.debt, current, days30, days60, days90, overdue90, lastTransactionDate: c.lastPurchaseDate }
            })
            const totalDebt = rows.reduce((s, r) => s + r.totalDebt, 0)
            const totalCurrent = rows.reduce((s, r) => s + r.current, 0)
            const totalOverdue = totalDebt - totalCurrent
            const agingSummary = {
                current: rows.reduce((s, r) => s + r.current, 0),
                days30: rows.reduce((s, r) => s + r.days30, 0),
                days60: rows.reduce((s, r) => s + r.days60, 0),
                days90: rows.reduce((s, r) => s + r.days90, 0),
                overdue90: rows.reduce((s, r) => s + r.overdue90, 0),
            }
            res.json({ success: true, data: { rows, totalDebt, totalCurrent, totalOverdue, agingSummary } })
        } else {
            // Payable: from import receipts with status != completed (pending payments to suppliers)
            const imports = await prisma.importReceipt.findMany({
                where: { status: { in: ['pending', 'partial'] } },
                select: { id: true, supplierName: true, totalCost: true, createdAt: true },
                orderBy: { totalCost: 'desc' },
            })
            const rows = imports.map(i => {
                const daysSince = Math.floor((now.getTime() - new Date(i.createdAt).getTime()) / 86400000)
                return {
                    partnerId: i.id, partnerName: i.supplierName || 'NCC', totalDebt: i.totalCost,
                    current: daysSince <= 0 ? i.totalCost : 0,
                    days30: daysSince > 0 && daysSince <= 30 ? i.totalCost : 0,
                    days60: daysSince > 30 && daysSince <= 60 ? i.totalCost : 0,
                    days90: daysSince > 60 && daysSince <= 90 ? i.totalCost : 0,
                    overdue90: daysSince > 90 ? i.totalCost : 0,
                    lastTransactionDate: i.createdAt,
                }
            })
            const totalDebt = rows.reduce((s, r) => s + r.totalDebt, 0)
            const totalCurrent = rows.reduce((s, r) => s + r.current, 0)
            const totalOverdue = totalDebt - totalCurrent
            const agingSummary = {
                current: totalCurrent,
                days30: rows.reduce((s, r) => s + r.days30, 0),
                days60: rows.reduce((s, r) => s + r.days60, 0),
                days90: rows.reduce((s, r) => s + r.days90, 0),
                overdue90: rows.reduce((s, r) => s + r.overdue90, 0),
            }
            res.json({ success: true, data: { rows, totalDebt, totalCurrent, totalOverdue, agingSummary } })
        }
    } catch (err) { console.error('GET /debt-aging error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ FIXED ASSETS (TSCÃ„Â + KhÃ¡ÂºÂ¥u Hao) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// GET /api/tax/fixed-assets
router.get('/fixed-assets', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const assets = await prisma.fixedAsset.findMany({ orderBy: { createdAt: 'desc' } })

        // Auto-calculate depreciation for active assets
        const now = new Date()
        const processed = assets.map(a => {
            if (a.status === 'active') {
                const acqDate = new Date(a.acquisitionDate)
                const monthsUsed = Math.max(0, (now.getFullYear() - acqDate.getFullYear()) * 12 + now.getMonth() - acqDate.getMonth())
                const monthlyDep = a.method === 'straight-line' ? Math.round(a.originalCost / a.usefulLifeMonths) : Math.round((a.originalCost * 2) / a.usefulLifeMonths)
                const accumulated = Math.min(a.originalCost, monthlyDep * monthsUsed)
                const netBook = a.originalCost - accumulated
                const status = accumulated >= a.originalCost ? 'fully-depreciated' : 'active'
                return { ...a, accumulatedDepreciation: accumulated, netBookValue: netBook, monthlyDepreciation: monthlyDep, status }
            }
            return a
        })

        const activeAssets = processed.filter(a => a.status === 'active')
        const summary = {
            totalOriginalCost: processed.reduce((s, a) => s + a.originalCost, 0),
            totalAccumulated: processed.reduce((s, a) => s + a.accumulatedDepreciation, 0),
            totalNetBook: processed.reduce((s, a) => s + a.netBookValue, 0),
            totalMonthlyDep: activeAssets.reduce((s, a) => s + a.monthlyDepreciation, 0),
            activeCount: activeAssets.length,
        }

        res.json({ success: true, data: { assets: processed, summary } })
    } catch (err) { console.error('GET /fixed-assets error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/tax/fixed-assets
router.post('/fixed-assets', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { code, name, category, acquisitionDate, originalCost, usefulLifeMonths, method, depreciationAccount } = req.body
        if (!code || !name || !originalCost || !usefulLifeMonths) {
            return res.status(400).json({ success: false, error: 'ThiÃ¡ÂºÂ¿u thÃƒÂ´ng tin bÃ¡ÂºÂ¯t buÃ¡Â»â„¢c' })
        }
        const monthlyDep = method === 'straight-line'
            ? Math.round(Number(originalCost) / Number(usefulLifeMonths))
            : Math.round((Number(originalCost) * 2) / Number(usefulLifeMonths))

        const data = await prisma.fixedAsset.create({
            data: {
                code, name, category: category || 'other',
                acquisitionDate: acquisitionDate || new Date().toISOString().slice(0, 10),
                originalCost: Number(originalCost),
                usefulLifeMonths: Number(usefulLifeMonths),
                method: method || 'straight-line',
                monthlyDepreciation: monthlyDep,
                netBookValue: Number(originalCost),
                depreciationAccount: depreciationAccount || '6424',
            }
        })
        res.status(201).json({ success: true, data })
    } catch (err: any) { console.error('POST /fixed-assets error:', err); res.status(500).json({ success: false, error: err?.message || 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ PAYROLL ACCOUNTING (BÃ¡ÂºÂ£ng LÃ†Â°Ã†Â¡ng KT) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// GET /api/tax/payroll-accounting?year=2026&month=3
router.get('/payroll-accounting', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = Number(req.query.month) || new Date().getMonth() + 1

        const records = await prisma.payrollRecord.findMany({
            where: { year, month },
            orderBy: { employeeName: 'asc' },
        })

        const rows = records.map(r => ({
            employeeId: r.employeeId,
            employeeName: r.employeeName,
            department: r.department || 'Chung',
            grossSalary: r.actualGross || r.grossSalary,
            bhxh: r.bhxh_emp,
            bhyt: r.bhyt_emp,
            bhtn: r.bhtn_emp,
            taxableIncome: (r.actualGross || r.grossSalary) - r.bhxh_emp - r.bhyt_emp - r.bhtn_emp - 11000000 - (r.dependents * 4400000),
            pitAmount: r.pit,
            netSalary: r.netSalary,
        }))

        const summary = {
            totalGross: rows.reduce((s, r) => s + r.grossSalary, 0),
            totalInsuranceEmployee: records.reduce((s, r) => s + r.bhxh_emp + r.bhyt_emp + r.bhtn_emp, 0),
            totalInsuranceEmployer: records.reduce((s, r) => s + r.bhxh_er + r.bhyt_er + r.bhtn_er, 0),
            totalPit: rows.reduce((s, r) => s + r.pitAmount, 0),
            totalNet: rows.reduce((s, r) => s + r.netSalary, 0),
            totalCost: records.reduce((s, r) => s + r.totalCost, 0),
            headcount: rows.length,
        }

        res.json({ success: true, data: { rows, summary } })
    } catch (err) { console.error('GET /payroll-accounting error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ REVENUE ANALYSIS (PhÃƒÂ¢n TÃƒÂ­ch Thu Chi) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// GET /api/tax/revenue-analysis?year=2026
router.get('/revenue-analysis', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const start = new Date(year, 0, 1), end = new Date(year, 11, 31, 23, 59, 59, 999)

        const [txs, expenses, imports] = await Promise.all([
            prisma.transaction.findMany({ where: { status: 'completed', createdAt: { gte: start, lte: end } }, select: { total: true, subtotal: true, tax: true, discount: true, createdAt: true } }),
            prisma.expense.findMany({ where: { date: { gte: start, lte: end } }, select: { amount: true, category: true, date: true } }),
            prisma.importReceipt.findMany({ where: { createdAt: { gte: start, lte: end } }, select: { totalCost: true, createdAt: true } }),
        ])

        const netRevenue = txs.reduce((s, t) => s + (t.total || 0), 0)
        const cogs = imports.reduce((s, i) => s + (i.totalCost || 0), 0)
        const grossProfit = netRevenue - cogs
        const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0
        const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0)
        const netProfit = grossProfit - totalExpenses
        const netMargin = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0
        const taxDue = txs.reduce((s, t) => s + (t.tax || 0), 0)

        // Monthly breakdown
        const monthlyMap: Record<string, { revenue: number; cogs: number; expenses: number }> = {}
        for (let m = 1; m <= 12; m++) monthlyMap[`T${m}`] = { revenue: 0, cogs: 0, expenses: 0 }
        txs.forEach(t => { const m = new Date(t.createdAt).getMonth() + 1; monthlyMap[`T${m}`].revenue += t.total || 0 })
        imports.forEach(i => { const m = new Date(i.createdAt).getMonth() + 1; monthlyMap[`T${m}`].cogs += i.totalCost || 0 })
        expenses.forEach(e => { const m = new Date(e.date).getMonth() + 1; monthlyMap[`T${m}`].expenses += e.amount || 0 })
        const monthly = Object.entries(monthlyMap).map(([month, d]) => ({
            month, revenue: d.revenue, cogs: d.cogs, netProfit: d.revenue - d.cogs - d.expenses,
        }))

        // Cost breakdown by category
        const catMap: Record<string, number> = {}
        expenses.forEach(e => { catMap[e.category] = (catMap[e.category] || 0) + (e.amount || 0) })
        const totalCost = cogs + totalExpenses
        const costBreakdown = [
            { category: 'GiÃƒÂ¡ vÃ¡Â»â€˜n hÃƒÂ ng bÃƒÂ¡n', amount: cogs, percentage: totalCost > 0 ? (cogs / totalCost) * 100 : 0 },
            ...Object.entries(catMap).map(([category, amount]) => ({
                category, amount, percentage: totalCost > 0 ? (amount / totalCost) * 100 : 0,
            })),
        ].filter(c => c.amount > 0)

        // Cash flow (simplified)
        const cashFlow = monthly.map(m => ({
            month: m.month,
            inflow: m.revenue,
            outflow: m.cogs + (monthlyMap[m.month]?.expenses || 0),
        }))

        // P&L Summary
        const plSummary = [
            { label: 'Doanh thu bÃƒÂ¡n hÃƒÂ ng', amount: netRevenue, level: 0, isTotal: false },
            { label: 'GiÃƒÂ¡ vÃ¡Â»â€˜n hÃƒÂ ng bÃƒÂ¡n', amount: -cogs, level: 1, isTotal: false },
            { label: 'LÃ¡Â»Â£i nhuÃ¡ÂºÂ­n gÃ¡Â»â„¢p', amount: grossProfit, level: 0, isTotal: true },
            ...Object.entries(catMap).map(([cat, amt]) => ({ label: cat, amount: -amt, level: 1, isTotal: false })),
            { label: 'TÃ¡Â»â€¢ng chi phÃƒÂ­ hoÃ¡ÂºÂ¡t Ã„â€˜Ã¡Â»â„¢ng', amount: -totalExpenses, level: 0, isTotal: true },
            { label: 'ThuÃ¡ÂºÂ¿ GTGT', amount: -taxDue, level: 1, isTotal: false },
            { label: 'LÃ¡Â»Â£i nhuÃ¡ÂºÂ­n rÃƒÂ²ng', amount: netProfit, level: 0, isTotal: true },
        ]

        res.json({
            success: true, data: {
                kpis: { netRevenue, cogs, grossProfit, grossMargin, totalExpenses, netProfit, netMargin, taxDue, ebitda: netProfit + taxDue },
                monthly, costBreakdown, cashFlow, plSummary,
            }
        })
    } catch (err) { console.error('GET /revenue-analysis error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ AUTO-JOURNAL (Ã„ÂÃ¡Â»â€œng bÃ¡Â»â„¢ dÃ¡Â»Â¯ liÃ¡Â»â€¡u Ã¢â€ â€™ BÃƒÂºt toÃƒÂ¡n kÃ¡ÂºÂ¿ toÃƒÂ¡n) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// POST /api/tax/auto-journal?year=2026&month=3
// Generates journal entries from Transaction, Expense, ImportReceipt, PayrollRecord
router.post('/auto-journal', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const start = month ? new Date(year, month - 1, 1) : new Date(year, 0, 1)
        const end = month ? new Date(year, month, 0, 23, 59, 59, 999) : new Date(year, 11, 31, 23, 59, 59, 999)

        // Get existing auto-generated references to avoid duplicates
        let existingRefs = new Set<string>()
        try {
            const existing = await prisma.journalEntry.findMany({
                where: { referenceType: { not: 'manual' } },
                select: { reference: true },
            })
            existingRefs = new Set(existing.map(e => e.reference).filter(Boolean) as string[])
        } catch (_) { /* table may not exist yet */ }

        const created: any[] = []
        const fmtDate = (d: Date) => d.toISOString().slice(0, 10)
        const branchId = (req as any).branchId || null
        const userId = (req as any).userId || null

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 1. TRANSACTIONS Ã¢â€ â€™ Revenue + VAT + COGS journal entries Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const txs = await prisma.transaction.findMany({
            where: { status: 'completed', createdAt: { gte: start, lte: end } },
            include: { payments: true, items: { include: { product: { select: { costPrice: true } } } } },
            orderBy: { createdAt: 'asc' },
        })

        for (const tx of txs) {
            const ref = `SALE-${tx.receiptNumber}`
            if (existingRefs.has(ref)) continue

            const date = fmtDate(tx.createdAt)
            const revenue = tx.subtotal || (tx.total - (tx.tax || 0))
            const vatAmount = tx.tax || 0

            // Determine debit account based on payment status
            const totalPaid = tx.payments?.reduce((s: number, p: any) => s + (p.amount || 0), 0) || tx.amountReceived || 0
            const isPaid = totalPaid >= tx.total
            let debitAccount: string
            let debitName: string

            if (isPaid) {
                // Customer already paid Ã¢â€ â€™ Cash or Bank
                const payType = tx.payments?.[0]?.type || 'cash'
                debitAccount = payType === 'bank' || payType === 'transfer' ? '112' : '111'
                debitName = debitAccount === '112' ? 'TiÃ¡Â»Ân gÃ¡Â»Â­i ngÃƒÂ¢n hÃƒÂ ng' : 'TiÃ¡Â»Ân mÃ¡ÂºÂ·t'
            } else {
                // Customer hasn't paid Ã¢â€ â€™ Accounts Receivable (PhÃ¡ÂºÂ£i thu khÃƒÂ¡ch hÃƒÂ ng)
                debitAccount = '131'
                debitName = 'PhÃ¡ÂºÂ£i thu khÃƒÂ¡ch hÃƒÂ ng'
            }

            // Entry 1: Cash/Bank Ã¢â€ Â Revenue (NÃ¡Â»Â£ TK111/112, CÃƒÂ³ TK511)
            if (revenue > 0) {
                try {
                    await prisma.journalEntry.create({
                        data: {
                            date, description: `BÃƒÂ¡n hÃƒÂ ng ${tx.receiptNumber}${tx.customerName ? ' - KH: ' + tx.customerName : ''}`,
                            debitAccount, debitAccountName: debitName,
                            creditAccount: '511', creditAccountName: 'Doanh thu bÃƒÂ¡n hÃƒÂ ng',
                            amount: revenue, reference: ref, referenceType: 'sale',
                            branchId, createdBy: userId,
                        }
                    })
                    created.push({ type: 'sale', ref, amount: revenue })
                } catch (_) { }
            }

            // Entry 2: Cash/Bank Ã¢â€ Â VAT (NÃ¡Â»Â£ TK111/112, CÃƒÂ³ TK3331) 
            if (vatAmount > 0) {
                const vatRef = `VAT-${tx.receiptNumber}`
                if (!existingRefs.has(vatRef)) {
                    try {
                        await prisma.journalEntry.create({
                            data: {
                                date, description: `ThuÃ¡ÂºÂ¿ GTGT Ã„â€˜Ã¡ÂºÂ§u ra ${tx.receiptNumber}`,
                                debitAccount, debitAccountName: debitName,
                                creditAccount: '3331', creditAccountName: 'ThuÃ¡ÂºÂ¿ GTGT phÃ¡ÂºÂ£i nÃ¡Â»â„¢p',
                                amount: vatAmount, reference: vatRef, referenceType: 'sale',
                                branchId, createdBy: userId,
                            }
                        })
                        created.push({ type: 'vat-out', ref: vatRef, amount: vatAmount })
                    } catch (_) { }
                }
            }

            // Entry 3: Discount (if any) - NÃ¡Â»Â£ TK521, CÃƒÂ³ TK111/112
            if (tx.discount > 0) {
                const discRef = `DISC-${tx.receiptNumber}`
                if (!existingRefs.has(discRef)) {
                    try {
                        await prisma.journalEntry.create({
                            data: {
                                date, description: `GiÃ¡ÂºÂ£m giÃƒÂ¡ hÃƒÂ ng bÃƒÂ¡n ${tx.receiptNumber}`,
                                debitAccount: '521', debitAccountName: 'ChiÃ¡ÂºÂ¿t khÃ¡ÂºÂ¥u thÃ†Â°Ã†Â¡ng mÃ¡ÂºÂ¡i',
                                creditAccount: debitAccount, creditAccountName: debitName,
                                amount: tx.discount, reference: discRef, referenceType: 'sale',
                                branchId, createdBy: userId,
                            }
                        })
                        created.push({ type: 'discount', ref: discRef, amount: tx.discount })
                    } catch (_) { }
                }
            }

            // Entry 4: COGS Ã¢â‚¬â€ NÃ¡Â»Â£ TK632 (GiÃƒÂ¡ vÃ¡Â»â€˜n), CÃƒÂ³ TK156 (HÃƒÂ ng hÃƒÂ³a)
            const cogsRef = `COGS-${tx.receiptNumber}`
            if (!existingRefs.has(cogsRef)) {
                const cogsAmount = (tx as any).items?.reduce((s: number, item: any) => {
                    const cost = item.product?.costPrice || 0
                    return s + (cost * item.quantity)
                }, 0) || 0
                if (cogsAmount > 0) {
                    try {
                        await prisma.journalEntry.create({
                            data: {
                                date, description: `GiÃƒÂ¡ vÃ¡Â»â€˜n hÃƒÂ ng bÃƒÂ¡n ${tx.receiptNumber}`,
                                debitAccount: '632', debitAccountName: 'GiÃƒÂ¡ vÃ¡Â»â€˜n hÃƒÂ ng bÃƒÂ¡n',
                                creditAccount: '156', creditAccountName: 'HÃƒÂ ng hÃƒÂ³a',
                                amount: cogsAmount, reference: cogsRef, referenceType: 'sale',
                                branchId, createdBy: userId,
                            }
                        })
                        created.push({ type: 'cogs', ref: cogsRef, amount: cogsAmount })
                    } catch (_) { }
                }
            }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 2. EXPENSES Ã¢â€ â€™ Operating expense journal entries Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const expenses = await prisma.expense.findMany({
            where: { date: { gte: start, lte: end } },
            orderBy: { date: 'asc' },
        })

        // Map expense category to account code
        const expenseAccountMap: Record<string, { code: string; name: string }> = {
            'rent': { code: '6421', name: 'CP thuÃƒÂª mÃ¡ÂºÂ·t bÃ¡ÂºÂ±ng' },
            'utilities': { code: '6422', name: 'CP Ã„â€˜iÃ¡Â»â€¡n nÃ†Â°Ã¡Â»â€ºc' },
            'salary': { code: '6411', name: 'CP lÃ†Â°Ã†Â¡ng nhÃƒÂ¢n viÃƒÂªn' },
            'transport': { code: '6415', name: 'CP vÃ¡ÂºÂ­n chuyÃ¡Â»Æ’n' },
            'marketing': { code: '6418', name: 'CP marketing' },
            'maintenance': { code: '6423', name: 'CP sÃ¡Â»Â­a chÃ¡Â»Â¯a' },
            'supplies': { code: '6424', name: 'CP vÃ¡ÂºÂ­t tÃ†Â°' },
            'insurance': { code: '6425', name: 'CP bÃ¡ÂºÂ£o hiÃ¡Â»Æ’m' },
            'other': { code: '6428', name: 'CP khÃƒÂ¡c' },
        }

        for (const exp of expenses) {
            const ref = `EXP-${exp.id}`
            if (existingRefs.has(ref)) continue

            const acct = expenseAccountMap[exp.category?.toLowerCase()] || expenseAccountMap['other']
            const date = fmtDate(exp.date)

            try {
                await prisma.journalEntry.create({
                    data: {
                        date, description: exp.description || `Chi phÃƒÂ­ ${exp.category}`,
                        debitAccount: acct.code, debitAccountName: acct.name,
                        creditAccount: (exp.paidBy === 'bank' || exp.paidBy === 'transfer') ? '112' : '111',
                        creditAccountName: (exp.paidBy === 'bank' || exp.paidBy === 'transfer') ? 'TiÃ¡Â»Ân gÃ¡Â»Â­i ngÃƒÂ¢n hÃƒÂ ng' : 'TiÃ¡Â»Ân mÃ¡ÂºÂ·t',
                        amount: exp.amount, reference: ref, referenceType: 'expense',
                        branchId: exp.branchId || branchId, createdBy: userId,
                    }
                })
                created.push({ type: 'expense', ref, amount: exp.amount })
            } catch (_) { }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 3. IMPORT RECEIPTS Ã¢â€ â€™ Inventory + Payable journal entries Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const imports = await prisma.importReceipt.findMany({
            where: { status: { not: 'draft' }, createdAt: { gte: start, lte: end } },
            orderBy: { createdAt: 'asc' },
        })

        for (const imp of imports) {
            const ref = `IMP-${imp.code}`
            if (existingRefs.has(ref)) continue

            const date = fmtDate(imp.transactionDate || imp.createdAt)

            try {
                // NÃ¡Â»Â£ TK156 (HÃƒÂ ng hÃƒÂ³a), CÃƒÂ³ TK331 (PhÃ¡ÂºÂ£i trÃ¡ÂºÂ£ NCC)
                await prisma.journalEntry.create({
                    data: {
                        date, description: `NhÃ¡ÂºÂ­p hÃƒÂ ng ${imp.code}${imp.supplierName ? ' - NCC: ' + imp.supplierName : ''}`,
                        debitAccount: '156', debitAccountName: 'HÃƒÂ ng hÃƒÂ³a',
                        creditAccount: '331', creditAccountName: 'PhÃ¡ÂºÂ£i trÃ¡ÂºÂ£ ngÃ†Â°Ã¡Â»Âi bÃƒÂ¡n',
                        amount: imp.totalCost, reference: ref, referenceType: 'import',
                        branchId: imp.branchId || branchId, createdBy: userId,
                    }
                })
                created.push({ type: 'import', ref, amount: imp.totalCost })
            } catch (_) { }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 4. PAYROLL Ã¢â€ â€™ Salary expense journal entries Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        try {
            const payrollRecords = await prisma.payrollRecord.findMany({
                where: { year, ...(month ? { month } : {}) },
                orderBy: { employeeName: 'asc' },
            })

            if (payrollRecords.length > 0) {
                // Use actual PayrollRecord data
                for (const pr of payrollRecords) {
                    const ref = `PAY-${pr.employeeId}-${pr.year}-${pr.month}`
                    if (existingRefs.has(ref)) continue

                    const date = `${pr.year}-${String(pr.month).padStart(2, '0')}-25`
                    try {
                        // NÃ¡Â»Â£ TK622 (CP nhÃƒÂ¢n cÃƒÂ´ng), CÃƒÂ³ TK334 (PhÃ¡ÂºÂ£i trÃ¡ÂºÂ£ NLÃ„Â) Ã¢â‚¬â€ Net salary
                        await prisma.journalEntry.create({
                            data: {
                                date, description: `LÃ†Â°Ã†Â¡ng T${pr.month}/${pr.year} - ${pr.employeeName}`,
                                debitAccount: '622', debitAccountName: 'CP nhÃƒÂ¢n cÃƒÂ´ng trÃ¡Â»Â±c tiÃ¡ÂºÂ¿p',
                                creditAccount: '334', creditAccountName: 'PhÃ¡ÂºÂ£i trÃ¡ÂºÂ£ ngÃ†Â°Ã¡Â»Âi lao Ã„â€˜Ã¡Â»â„¢ng',
                                amount: pr.totalCost, reference: ref, referenceType: 'payroll',
                                branchId, createdBy: userId,
                            }
                        })
                        created.push({ type: 'payroll', ref, amount: pr.totalCost })
                    } catch (_) { }

                    // BHXH employer contribution Ã¢â‚¬â€ NÃ¡Â»Â£ TK622, CÃƒÂ³ TK3383
                    const bhxhER = (pr.bhxh_er || 0) + (pr.bhyt_er || 0) + (pr.bhtn_er || 0)
                    if (bhxhER > 0) {
                        const bhRef = `BH-${pr.employeeId}-${pr.year}-${pr.month}`
                        if (!existingRefs.has(bhRef)) {
                            try {
                                await prisma.journalEntry.create({
                                    data: {
                                        date, description: `BHXH cÃƒÂ´ng ty T${pr.month}/${pr.year} - ${pr.employeeName}`,
                                        debitAccount: '622', debitAccountName: 'CP nhÃƒÂ¢n cÃƒÂ´ng trÃ¡Â»Â±c tiÃ¡ÂºÂ¿p',
                                        creditAccount: '3383', creditAccountName: 'BHXH, BHYT, BHTN',
                                        amount: bhxhER, reference: bhRef, referenceType: 'payroll',
                                        branchId, createdBy: userId,
                                    }
                                })
                                created.push({ type: 'payroll', ref: bhRef, amount: bhxhER })
                            } catch (_) { }
                        }
                    }
                }
            } else {
                // Fallback: auto-compute from User.salary for active employees
                const months = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1)
                const activeEmployees = await prisma.user.findMany({
                    where: { employeeStatus: 'active', salary: { gt: 0 } },
                    select: { id: true, name: true, salary: true, code: true },
                })

                for (const m of months) {
                    for (const emp of activeEmployees) {
                        const ref = `PAY-${emp.id}-${year}-${m}`
                        if (existingRefs.has(ref)) continue
                        if (!emp.salary || emp.salary <= 0) continue

                        const date = `${year}-${String(m).padStart(2, '0')}-25`
                        // Simple payroll: salary is the total cost
                        const salaryAmount = emp.salary
                        try {
                            await prisma.journalEntry.create({
                                data: {
                                    date, description: `LÃ†Â°Ã†Â¡ng T${m}/${year} - ${emp.name}`,
                                    debitAccount: '622', debitAccountName: 'CP nhÃƒÂ¢n cÃƒÂ´ng trÃ¡Â»Â±c tiÃ¡ÂºÂ¿p',
                                    creditAccount: '334', creditAccountName: 'PhÃ¡ÂºÂ£i trÃ¡ÂºÂ£ ngÃ†Â°Ã¡Â»Âi lao Ã„â€˜Ã¡Â»â„¢ng',
                                    amount: salaryAmount, reference: ref, referenceType: 'payroll',
                                    branchId, createdBy: userId,
                                }
                            })
                            created.push({ type: 'payroll', ref, amount: salaryAmount })
                        } catch (_) { }
                    }
                }
            }
        } catch (_) { /* PayrollRecord or User table might not exist */ }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 5. ONLINE ORDERS Ã¢â€ â€™ E-commerce revenue journal entries Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        try {
            const onlineOrders = await (prisma as any).onlineOrder.findMany({
                where: { status: { in: ['completed', 'delivered'] }, createdAt: { gte: start, lte: end } },
                include: { items: { include: { product: { select: { costPrice: true } } } } },
                orderBy: { createdAt: 'asc' },
            })

            for (const ord of onlineOrders) {
                const ref = `ONLINE-${ord.orderNumber}`
                if (existingRefs.has(ref)) continue

                const date = fmtDate(ord.createdAt)
                const revenue = ord.subtotal || (ord.total - (ord.shippingFee || 0))
                const isPaid = ord.paymentStatus === 'paid'

                // Revenue entry
                if (revenue > 0) {
                    try {
                        await prisma.journalEntry.create({
                            data: {
                                date, description: `BÃƒÂ¡n online ${ord.orderNumber} - ${ord.customerName}${ord.platform ? ' (' + ord.platform + ')' : ''}`,
                                debitAccount: isPaid ? '112' : '131',
                                debitAccountName: isPaid ? 'TiÃ¡Â»Ân gÃ¡Â»Â­i ngÃƒÂ¢n hÃƒÂ ng' : 'PhÃ¡ÂºÂ£i thu khÃƒÂ¡ch hÃƒÂ ng',
                                creditAccount: '511', creditAccountName: 'Doanh thu bÃƒÂ¡n hÃƒÂ ng',
                                amount: revenue, reference: ref, referenceType: 'online',
                                branchId, createdBy: userId,
                            }
                        })
                        created.push({ type: 'online', ref, amount: revenue })
                    } catch (_) { }
                }

                // Platform fee entry Ã¢â‚¬â€ NÃ¡Â»Â£ TK6418 (CP sÃƒÂ n), CÃƒÂ³ TK112
                if ((ord.platformFee || 0) > 0) {
                    const feeRef = `PFEE-${ord.orderNumber}`
                    if (!existingRefs.has(feeRef)) {
                        try {
                            await prisma.journalEntry.create({
                                data: {
                                    date, description: `PhÃƒÂ­ sÃƒÂ n ${ord.platform || 'online'} - ${ord.orderNumber}`,
                                    debitAccount: '6418', debitAccountName: 'CP phÃƒÂ­ sÃƒÂ n TMÃ„ÂT',
                                    creditAccount: '112', creditAccountName: 'TiÃ¡Â»Ân gÃ¡Â»Â­i ngÃƒÂ¢n hÃƒÂ ng',
                                    amount: ord.platformFee, reference: feeRef, referenceType: 'online',
                                    branchId, createdBy: userId,
                                }
                            })
                            created.push({ type: 'platform-fee', ref: feeRef, amount: ord.platformFee })
                        } catch (_) { }
                    }
                }
                // COGS entry for online orders Ã¢â‚¬â€ NÃ¡Â»Â£ TK632 (GiÃƒÂ¡ vÃ¡Â»â€˜n), CÃƒÂ³ TK156 (HÃƒÂ ng hÃƒÂ³a)
                const cogsRef = `OCOGS-${ord.orderNumber}`
                if (!existingRefs.has(cogsRef)) {
                    const cogsAmount = (ord.items || []).reduce((s: number, item: any) => {
                        const cost = item.product?.costPrice || 0
                        return s + (cost * item.quantity)
                    }, 0)
                    if (cogsAmount > 0) {
                        try {
                            await prisma.journalEntry.create({
                                data: {
                                    date, description: `GiÃƒÂ¡ vÃ¡Â»â€˜n online ${ord.orderNumber}`,
                                    debitAccount: '632', debitAccountName: 'GiÃƒÂ¡ vÃ¡Â»â€˜n hÃƒÂ ng bÃƒÂ¡n',
                                    creditAccount: '156', creditAccountName: 'HÃƒÂ ng hÃƒÂ³a',
                                    amount: cogsAmount, reference: cogsRef, referenceType: 'cogs',
                                    branchId, createdBy: userId,
                                }
                            })
                            created.push({ type: 'cogs', ref: cogsRef, amount: cogsAmount })
                        } catch (_) { }
                    }
                }
            }
        } catch (_) { /* OnlineOrder table might not exist */ }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 6. DEPRECIATION Ã¢â€ â€™ Fixed asset depreciation journal entries Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        try {
            const assets = await (prisma as any).fixedAsset.findMany({
                where: { status: 'active', monthlyDepreciation: { gt: 0 } },
            })

            // Only create depreciation entries for the specific month (or each month in year)
            const depMonths = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1)
            for (const asset of assets) {
                for (const m of depMonths) {
                    const depRef = `DEP-${asset.code}-${year}-${String(m).padStart(2, '0')}`
                    if (existingRefs.has(depRef)) continue

                    const depDate = `${year}-${String(m).padStart(2, '0')}-28` // End of month
                    try {
                        await prisma.journalEntry.create({
                            data: {
                                date: depDate,
                                description: `KhÃ¡ÂºÂ¥u hao T${m}/${year} - ${asset.name}`,
                                debitAccount: asset.depreciationAccount || '6274',
                                debitAccountName: 'CP khÃ¡ÂºÂ¥u hao TSCÃ„Â',
                                creditAccount: '214', creditAccountName: 'Hao mÃƒÂ²n TSCÃ„Â',
                                amount: asset.monthlyDepreciation, reference: depRef, referenceType: 'depreciation',
                                branchId, createdBy: userId,
                            }
                        })
                        created.push({ type: 'depreciation', ref: depRef, amount: asset.monthlyDepreciation })
                    } catch (_) { }
                }
            }
        } catch (_) { /* FixedAsset table might not exist */ }

        // Summary
        const summary = {
            totalCreated: created.length,
            sales: created.filter(c => c.type === 'sale').length,
            vat: created.filter(c => c.type === 'vat-out').length,
            cogs: created.filter(c => c.type === 'cogs').length,
            expenses: created.filter(c => c.type === 'expense').length,
            imports: created.filter(c => c.type === 'import').length,
            payroll: created.filter(c => c.type === 'payroll').length,
            online: created.filter(c => c.type === 'online').length,
            platformFees: created.filter(c => c.type === 'platform-fee').length,
            depreciation: created.filter(c => c.type === 'depreciation').length,
            totalAmount: created.reduce((s, c) => s + c.amount, 0),
        }

        res.json({ success: true, data: { created, summary } })
    } catch (err) { console.error('POST /auto-journal error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ─── CLOSING ENTRIES (Kết chuyển cuối kỳ TK911) ──────────────────────────────

interface ClosingPlanItem {
    description: string
    debitAccount: string
    debitAccountName: string
    creditAccount: string
    creditAccountName: string
    amount: number
}

// Account map for closing: code → { name, normalBalance: 'credit' | 'debit' }
// Revenue/income accounts (credit balance) close TO TK911 via Nợ X / Có 911
// Expense/cost accounts (debit balance) close TO TK911 via Nợ 911 / Có X
const CLOSING_ACCOUNTS: { code: string; name: string; type: 'revenue' | 'expense' }[] = [
    { code: '511', name: 'Doanh thu bán hàng & CCDV', type: 'revenue' },
    { code: '515', name: 'DT hoạt động tài chính', type: 'revenue' },
    { code: '711', name: 'Thu nhập khác', type: 'revenue' },
    { code: '632', name: 'Giá vốn hàng bán', type: 'expense' },
    { code: '635', name: 'Chi phí tài chính', type: 'expense' },
    { code: '641', name: 'Chi phí bán hàng', type: 'expense' },
    { code: '642', name: 'Chi phí QLDN', type: 'expense' },
    { code: '811', name: 'Chi phí khác', type: 'expense' },
]

/**
 * Compute closing plan from journal entries for a period.
 * For each P&L account, balance = sum(credit) - sum(debit) for revenue,
 * sum(debit) - sum(credit) for expenses. Then build the 8 transfer entries
 * + one result-transfer to TK421.
 *
 * `accountCode` may be a sub-account (e.g. '5111') — we match by prefix.
 */
function buildClosingPlan(entries: { debitAccount: string; creditAccount: string; amount: number }[], periodLabel: string): ClosingPlanItem[] {
    const plan: ClosingPlanItem[] = []

    let totalRevenue = 0 // credits to 911
    let totalExpense = 0 // debits from 911

    for (const acc of CLOSING_ACCOUNTS) {
        // Sum debit and credit for entries touching this account (or its sub-accounts)
        let debitSum = 0
        let creditSum = 0
        for (const e of entries) {
            if (e.debitAccount === acc.code || e.debitAccount?.startsWith(acc.code)) debitSum += e.amount
            if (e.creditAccount === acc.code || e.creditAccount?.startsWith(acc.code)) creditSum += e.amount
        }
        // Net balance to close
        const balance = acc.type === 'revenue' ? creditSum - debitSum : debitSum - creditSum
        if (balance <= 0) continue // nothing to close (or contra-balance — skip)

        if (acc.type === 'revenue') {
            // Nợ TKxxx / Có 911
            plan.push({
                description: `Kết chuyển ${acc.name} ${periodLabel}`,
                debitAccount: acc.code, debitAccountName: acc.name,
                creditAccount: '911', creditAccountName: 'Xác định KQKD',
                amount: balance,
            })
            totalRevenue += balance
        } else {
            // Nợ 911 / Có TKxxx
            plan.push({
                description: `Kết chuyển ${acc.name} ${periodLabel}`,
                debitAccount: '911', debitAccountName: 'Xác định KQKD',
                creditAccount: acc.code, creditAccountName: acc.name,
                amount: balance,
            })
            totalExpense += balance
        }
    }

    // Result transfer to TK421 (Lợi nhuận chưa phân phối)
    const profit = totalRevenue - totalExpense
    if (profit > 0) {
        plan.push({
            description: `Kết chuyển lãi ${periodLabel} sang TK421`,
            debitAccount: '911', debitAccountName: 'Xác định KQKD',
            creditAccount: '421', creditAccountName: 'LNST chưa phân phối',
            amount: profit,
        })
    } else if (profit < 0) {
        plan.push({
            description: `Kết chuyển lỗ ${periodLabel} sang TK421`,
            debitAccount: '421', debitAccountName: 'LNST chưa phân phối',
            creditAccount: '911', creditAccountName: 'Xác định KQKD',
            amount: -profit,
        })
    }

    return plan
}

// GET /api/tax/closing-entries/preview?year=2026&month=3
// Returns the planned closing entries without persisting them.
router.get('/closing-entries/preview', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`
        const periodLabel = month ? `T${month}/${year}` : `năm ${year}`

        const entries = await prisma.journalEntry.findMany({
            where: { date: { gte: dateGte, lte: dateEnd } },
            select: { debitAccount: true, creditAccount: true, amount: true },
        })

        const plan = buildClosingPlan(entries, periodLabel)
        const totalDebit = plan.reduce((s, p) => s + p.amount, 0)
        res.json({ success: true, data: { plan, periodLabel, totalDebit, totalCredit: totalDebit } })
    } catch (err) {
        console.error('GET /closing-entries/preview error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/tax/closing-entries?year=2026&month=3
// Calculates and creates period-end closing entries (kết chuyển cuối kỳ TK911).
router.post('/closing-entries', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`
        const periodLabel = month ? `T${month}/${year}` : `năm ${year}`
        // Closing entry date = last day of period
        const closingDate = month
            ? new Date(year, month, 0).toISOString().slice(0, 10)
            : `${year}-12-31`

        const entries = await prisma.journalEntry.findMany({
            where: { date: { gte: dateGte, lte: dateEnd } },
            select: { debitAccount: true, creditAccount: true, amount: true, reference: true, referenceType: true },
        })

        // Idempotency: refuse to re-run if closing entries already exist for this period
        const closingRef = month ? `CLOSE-${year}-${String(month).padStart(2, '0')}` : `CLOSE-${year}`
        const existing = entries.filter(e => e.referenceType === 'closing' && e.reference?.startsWith(closingRef))
        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Đã có ${existing.length} bút toán kết chuyển cho kỳ ${periodLabel}. Xóa bút toán cũ trước khi tạo lại.`,
            })
        }

        const plan = buildClosingPlan(entries, periodLabel)
        if (plan.length === 0) {
            return res.status(400).json({ success: false, error: `Không có số dư nào để kết chuyển trong kỳ ${periodLabel}` })
        }

        const branchId = (req as any).branchId || null
        const userId = (req as any).userId || null
        const created: any[] = []
        for (let i = 0; i < plan.length; i++) {
            const p = plan[i]!
            try {
                const entry = await prisma.journalEntry.create({
                    data: {
                        date: closingDate,
                        description: p.description,
                        debitAccount: p.debitAccount, debitAccountName: p.debitAccountName,
                        creditAccount: p.creditAccount, creditAccountName: p.creditAccountName,
                        amount: p.amount,
                        reference: `${closingRef}-${String(i + 1).padStart(2, '0')}`,
                        referenceType: 'closing',
                        branchId, createdBy: userId,
                    },
                })
                created.push(entry)
            } catch (e) {
                console.error('Failed to create closing entry', p, e)
            }
        }

        res.status(201).json({
            success: true,
            data: {
                created,
                periodLabel,
                totalCreated: created.length,
                totalAmount: created.reduce((s, c) => s + (c.amount || 0), 0),
            },
        })
    } catch (err) {
        console.error('POST /closing-entries error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ BALANCE SHEET (BÃ¡ÂºÂ£ng CÃƒÂ¢n Ã„ÂÃ¡Â»â€˜i KÃ¡ÂºÂ¿ ToÃƒÂ¡n) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

router.get('/balance-sheet', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        let entries: any[] = []
        try { entries = await prisma.journalEntry.findMany({ where: { date: { lte: dateEnd } } }) } catch (_) { }

        // Aggregate by account Ã¢â‚¬â€ compute net balance per account
        const accountBalances: Record<string, { debit: number; credit: number; name: string }> = {}
        for (const e of entries) {
            if (!accountBalances[e.debitAccount]) accountBalances[e.debitAccount] = { debit: 0, credit: 0, name: e.debitAccountName || '' }
            if (!accountBalances[e.creditAccount]) accountBalances[e.creditAccount] = { debit: 0, credit: 0, name: e.creditAccountName || '' }
            accountBalances[e.debitAccount].debit += e.amount
            accountBalances[e.creditAccount].credit += e.amount
        }

        // Classify accounts by VN chart of accounts
        const classify = (code: string) => {
            const c1 = code.charAt(0)
            if (c1 === '1') return 'asset'        // TÃƒÂ i sÃ¡ÂºÂ£n
            if (c1 === '2') return 'asset'         // TÃƒÂ i sÃ¡ÂºÂ£n dÃƒÂ i hÃ¡ÂºÂ¡n
            if (c1 === '3') return 'liability'     // NÃ¡Â»Â£ phÃ¡ÂºÂ£i trÃ¡ÂºÂ£
            if (c1 === '4') return 'equity'        // VÃ¡Â»â€˜n chÃ¡Â»Â§ sÃ¡Â»Å¸ hÃ¡Â»Â¯u
            if (c1 === '5') return 'revenue'       // Doanh thu
            if (c1 === '6') return 'expense'       // Chi phÃƒÂ­
            if (c1 === '7') return 'revenue'       // Thu nhÃ¡ÂºÂ­p khÃƒÂ¡c
            if (c1 === '8') return 'expense'       // Chi phÃƒÂ­ khÃƒÂ¡c
            return 'other'
        }

        const assets: { code: string; name: string; balance: number }[] = []
        const liabilities: { code: string; name: string; balance: number }[] = []
        const equity: { code: string; name: string; balance: number }[] = []

        for (const [code, bal] of Object.entries(accountBalances)) {
            const cls = classify(code)
            const balance = bal.debit - bal.credit
            const item = { code, name: bal.name || code, balance: Math.abs(balance) }
            if (cls === 'asset') assets.push({ ...item, balance })
            else if (cls === 'liability') liabilities.push({ ...item, balance: -balance })
            else if (cls === 'equity') equity.push({ ...item, balance: -balance })
        }

        // Retained earnings = Revenue - Expenses (accumulated from journal)
        let retainedEarnings = 0
        for (const [code, bal] of Object.entries(accountBalances)) {
            const cls = classify(code)
            if (cls === 'revenue') retainedEarnings += (bal.credit - bal.debit)
            if (cls === 'expense') retainedEarnings -= (bal.debit - bal.credit)
        }
        if (retainedEarnings !== 0) {
            equity.push({ code: '421', name: 'LÃ¡Â»Â£i nhuÃ¡ÂºÂ­n chÃ†Â°a phÃƒÂ¢n phÃ¡Â»â€˜i', balance: retainedEarnings })
        }

        const totalAssets = assets.reduce((s, a) => s + a.balance, 0)
        const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0)
        const totalEquity = equity.reduce((s, e) => s + e.balance, 0)

        res.json({
            success: true, data: {
                assets: assets.sort((a, b) => a.code.localeCompare(b.code)),
                liabilities: liabilities.sort((a, b) => a.code.localeCompare(b.code)),
                equity: equity.sort((a, b) => a.code.localeCompare(b.code)),
                totalAssets, totalLiabilities, totalEquity,
                isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1,
            }
        })
    } catch (err) { console.error('GET /balance-sheet error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ INCOME STATEMENT (BÃƒÂ¡o CÃƒÂ¡o KÃ¡ÂºÂ¿t QuÃ¡ÂºÂ£ Kinh Doanh) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

router.get('/income-statement', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        let entries: any[] = []
        try { entries = await prisma.journalEntry.findMany({ where: { date: { gte: dateGte, lte: dateEnd } } }) } catch (_) { }

        // Also get raw transaction/expense data for supplemental info
        const start = month ? new Date(year, month - 1, 1) : new Date(year, 0, 1)
        const end = month ? new Date(year, month, 0, 23, 59, 59, 999) : new Date(year, 11, 31, 23, 59, 59, 999)

        const [txs, rawExpenses] = await Promise.all([
            prisma.transaction.findMany({ where: { status: 'completed', createdAt: { gte: start, lte: end } }, select: { total: true, tax: true, subtotal: true, discount: true } }),
            prisma.expense.findMany({ where: { date: { gte: start, lte: end } }, select: { amount: true, category: true } }),
        ])

        // From journal entries
        const sumByAccount = (acctPrefix: string, side: 'debit' | 'credit') =>
            entries.filter(e => (side === 'debit' ? e.debitAccount : e.creditAccount).startsWith(acctPrefix))
                .reduce((s, e) => s + e.amount, 0)

        const revenue511 = sumByAccount('511', 'credit')      // Doanh thu bÃƒÂ¡n hÃƒÂ ng
        const discount521 = sumByAccount('521', 'debit')       // ChiÃ¡ÂºÂ¿t khÃ¡ÂºÂ¥u
        const netRevenue = revenue511 - discount521
        const cogs632 = sumByAccount('632', 'debit')           // GiÃƒÂ¡ vÃ¡Â»â€˜n
        const grossProfit = netRevenue - cogs632
        const sellingExp641 = sumByAccount('641', 'debit')     // CP bÃƒÂ¡n hÃƒÂ ng
        const adminExp642 = sumByAccount('642', 'debit')       // CP QLDN
        const laborExp622 = sumByAccount('622', 'debit')       // CP nhÃƒÂ¢n cÃƒÂ´ng
        const totalOpExp = sellingExp641 + adminExp642 + laborExp622
        const operatingProfit = grossProfit - totalOpExp
        const otherIncome711 = sumByAccount('711', 'credit')   // Thu nhÃ¡ÂºÂ­p khÃƒÂ¡c
        const otherExpense811 = sumByAccount('811', 'debit')   // Chi phÃƒÂ­ khÃƒÂ¡c
        const profitBeforeTax = operatingProfit + otherIncome711 - otherExpense811
        const taxExpense = sumByAccount('3331', 'credit')      // ThuÃ¡ÂºÂ¿ GTGT
        const netIncome = profitBeforeTax  // Simplified Ã¢â‚¬â€ tax already in revenue

        // Raw data for supplemental info
        const totalRawRevenue = txs.reduce((s, t) => s + (t.subtotal || t.total || 0), 0)
        const totalRawExpenses = rawExpenses.reduce((s, e) => s + (e.amount || 0), 0)

        // Expense breakdown by category
        const expByCategory: Record<string, number> = {}
        rawExpenses.forEach(e => {
            const cat = (e as any).category || 'other'
            expByCategory[cat] = (expByCategory[cat] || 0) + (e.amount || 0)
        })

        res.json({
            success: true, data: {
                // Income Statement lines
                revenue: revenue511,
                discount: discount521,
                netRevenue,
                cogs: cogs632,
                grossProfit,
                sellingExpenses: sellingExp641,
                adminExpenses: adminExp642,
                laborExpenses: laborExp622,
                totalOperatingExpenses: totalOpExp,
                operatingProfit,
                otherIncome: otherIncome711,
                otherExpenses: otherExpense811,
                profitBeforeTax,
                taxExpense,
                netIncome,
                // Margin ratios
                grossMargin: totalRawRevenue > 0 ? (grossProfit / totalRawRevenue * 100) : 0,
                netMargin: totalRawRevenue > 0 ? (netIncome / totalRawRevenue * 100) : 0,
                // Supplemental
                txCount: txs.length,
                rawRevenue: totalRawRevenue,
                rawExpenses: totalRawExpenses,
                expenseBreakdown: Object.entries(expByCategory).map(([category, amount]) => ({ category, amount })),
            }
        })
    } catch (err) { console.error('GET /income-statement error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ ACCOUNT BALANCES (SÃ¡Â»â€˜ dÃ†Â° tÃƒÂ i khoÃ¡ÂºÂ£n) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

router.get('/account-balances', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const dateEnd = `${year}-12-31`

        let entries: any[] = []
        try { entries = await prisma.journalEntry.findMany({ where: { date: { lte: dateEnd } } }) } catch (_) { }

        const balances: Record<string, { debit: number; credit: number; name: string; count: number }> = {}
        for (const e of entries) {
            if (!balances[e.debitAccount]) balances[e.debitAccount] = { debit: 0, credit: 0, name: e.debitAccountName || '', count: 0 }
            if (!balances[e.creditAccount]) balances[e.creditAccount] = { debit: 0, credit: 0, name: e.creditAccountName || '', count: 0 }
            balances[e.debitAccount].debit += e.amount
            balances[e.debitAccount].count++
            balances[e.creditAccount].credit += e.amount
            balances[e.creditAccount].count++
        }

        const result = Object.entries(balances).map(([code, b]) => ({
            code, name: b.name, debit: b.debit, credit: b.credit,
            balance: b.debit - b.credit, count: b.count,
        })).sort((a, b) => a.code.localeCompare(b.code))

        res.json({ success: true, data: result })
    } catch (err) { console.error('GET /account-balances error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ CASH FLOW STATEMENT (BÃƒÂ¡o CÃƒÂ¡o LÃ†Â°u ChuyÃ¡Â»Æ’n TiÃ¡Â»Ân TÃ¡Â»â€¡) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

router.get('/cash-flow', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const dateGte = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
        const dateEnd = month ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`

        let entries: any[] = []
        try { entries = await prisma.journalEntry.findMany({ where: { date: { gte: dateGte, lte: dateEnd } } }) } catch (_) { }

        // Helper: sum amounts where cash accounts (111,112) are on debit or credit side
        const cashAccounts = ['111', '112', '1111', '1112', '1121', '1122']
        const isCash = (code: string) => cashAccounts.some(c => code.startsWith(c))

        // OPERATING ACTIVITIES Ã¢â‚¬â€ Cash from revenue (TK511Ã¢â€ â€™cash), Cash expenses (cashÃ¢â€ â€™TK6xx)
        let cashFromSales = 0, cashFromExpenses = 0, cashFromPayroll = 0, cashFromTax = 0
        // INVESTING Ã¢â‚¬â€ Fixed assets (TK211, TK213)
        let cashInvesting = 0
        // FINANCING Ã¢â‚¬â€ Loans (TK341), Equity (TK411)
        let cashFinancing = 0

        for (const e of entries) {
            const debitIsCash = isCash(e.debitAccount)
            const creditIsCash = isCash(e.creditAccount)

            if (debitIsCash) {
                // Cash inflow
                if (e.creditAccount.startsWith('511') || e.creditAccount.startsWith('512')) cashFromSales += e.amount
                else if (e.creditAccount.startsWith('131')) cashFromSales += e.amount // receivable collected
                else if (e.creditAccount.startsWith('711')) cashFromSales += e.amount // other income
                else if (e.creditAccount.startsWith('341') || e.creditAccount.startsWith('411')) cashFinancing += e.amount
                else if (e.creditAccount.startsWith('2')) cashInvesting += e.amount // asset disposal
            }
            if (creditIsCash) {
                // Cash outflow
                if (e.debitAccount.startsWith('6')) cashFromExpenses -= e.amount
                else if (e.debitAccount.startsWith('331')) cashFromExpenses -= e.amount // pay supplier
                else if (e.debitAccount.startsWith('334')) cashFromPayroll -= e.amount // pay salary
                else if (e.debitAccount.startsWith('333')) cashFromTax -= e.amount // pay tax
                else if (e.debitAccount.startsWith('2')) cashInvesting -= e.amount // buy assets
                else if (e.debitAccount.startsWith('341') || e.debitAccount.startsWith('411')) cashFinancing -= e.amount // repay loan
            }
        }

        const operatingCashFlow = cashFromSales + cashFromExpenses + cashFromPayroll + cashFromTax
        const netCashFlow = operatingCashFlow + cashInvesting + cashFinancing

        // Opening/closing cash Ã¢â‚¬â€ sum all cash account balances
        let allEntries: any[] = []
        try { allEntries = await prisma.journalEntry.findMany({ where: { date: { lte: dateEnd } } }) } catch (_) { }
        let openingEntries: any[] = []
        try { openingEntries = await prisma.journalEntry.findMany({ where: { date: { lt: dateGte } } }) } catch (_) { }

        let closingCash = 0, openingCash = 0
        for (const e of allEntries) {
            if (isCash(e.debitAccount)) closingCash += e.amount
            if (isCash(e.creditAccount)) closingCash -= e.amount
        }
        for (const e of openingEntries) {
            if (isCash(e.debitAccount)) openingCash += e.amount
            if (isCash(e.creditAccount)) openingCash -= e.amount
        }

        res.json({
            success: true, data: {
                operating: {
                    cashFromSales, cashFromExpenses, cashFromPayroll, cashFromTax,
                    total: operatingCashFlow,
                },
                investing: { total: cashInvesting },
                financing: { total: cashFinancing },
                netCashFlow, openingCash, closingCash,
            }
        })
    } catch (err) { console.error('GET /cash-flow error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// Ã¢â€â‚¬Ã¢â€â‚¬ SEED TEST DATA Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

router.post('/seed-test-data', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const userId = (req as any).userId || 'seed'
        const branchId = (req as any).branchId || null
        const doReset = req.query.reset === 'true'
        const counts = { transactions: 0, expenses: 0, imports: 0, onlineOrders: 0, fixedAssets: 0, payroll: 0, products: 0, customers: 0, suppliers: 0, returns: 0, warranties: 0, repairs: 0, branches: 0, schedules: 0, attendance: 0, salesCheckins: 0 }

        // Ã¢â€â‚¬Ã¢â€â‚¬ Helpers Ã¢â€â‚¬Ã¢â€â‚¬
        const rng = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
        const pick = <T>(arr: T[]) => arr[rng(0, arr.length - 1)]
        const pad = (n: number, l = 2) => String(n).padStart(l, '0')

        // 13 months: Mar 2025 Ã¢â€ â€™ Mar 2026
        const months = [
            { year: 2025, month: 3 }, { year: 2025, month: 4 }, { year: 2025, month: 5 },
            { year: 2025, month: 6 }, { year: 2025, month: 7 }, { year: 2025, month: 8 },
            { year: 2025, month: 9 }, { year: 2025, month: 10 }, { year: 2025, month: 11 },
            { year: 2025, month: 12 }, { year: 2026, month: 1 }, { year: 2026, month: 2 },
            { year: 2026, month: 3 },
        ]
        const randDate = (y: number, m: number) => {
            const d = rng(1, 28)
            return new Date(y, m - 1, d, rng(8, 20), rng(0, 59))
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â RESET (optional) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        if (doReset) {
            console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Resetting data...')
            const tables = [
                'JournalEntry', 'TransactionItem', 'TransactionPayment', 'Transaction',
                'Expense', 'ImportReceiptItem', 'ImportReceipt',
                'OnlineOrderItem', 'OnlineOrder', 'FixedAsset', 'PayrollRecord',
                'DebtEntry', 'ReturnItem', 'ReturnOrder', 'Warranty', 'Repair',
                'Schedule', 'Attendance', 'SalesCheckin',
                'Customer', 'Supplier', 'Product', 'Category', 'Brand',
            ]
            for (const t of tables) {
                try { await (prisma as any).$executeRawUnsafe(`TRUNCATE TABLE "${t}" CASCADE`) } catch (_) { }
            }
            console.log('Ã¢Å“â€¦ Reset complete')
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 1. CATEGORIES + PRODUCTS Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const categoryNames = ['Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i', 'Laptop', 'Tablet', 'PhÃ¡Â»Â¥ kiÃ¡Â»â€¡n', 'Ã„ÂÃ¡Â»â€œng hÃ¡Â»â€œ', 'Loa/Tai nghe']
        const categoryMap: Record<string, string> = {}
        for (const catName of categoryNames) {
            try {
                const cat = await (prisma as any).category.create({ data: { name: catName } })
                categoryMap[catName] = cat.id
            } catch (_) { }
        }
        // Fallback: if categories weren't created (already exist), load them
        if (Object.keys(categoryMap).length < 3) {
            const existing = await (prisma as any).category.findMany()
            for (const c of existing) categoryMap[c.name] = c.id
        }

        const sampleProducts = [
            { name: 'iPhone 15 Pro Max 256GB', sku: 'IP15PM-256', price: 34990000, costPrice: 28500000, cat: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i' },
            { name: 'iPhone 15 128GB', sku: 'IP15-128', price: 22990000, costPrice: 18500000, cat: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i' },
            { name: 'iPhone 14 128GB', sku: 'IP14-128', price: 17990000, costPrice: 14500000, cat: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i' },
            { name: 'Samsung Galaxy S24 Ultra', sku: 'SS-S24U', price: 31990000, costPrice: 25200000, cat: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i' },
            { name: 'Samsung Galaxy S24', sku: 'SS-S24', price: 22990000, costPrice: 18200000, cat: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i' },
            { name: 'Samsung Galaxy A15', sku: 'SS-A15', price: 4690000, costPrice: 3600000, cat: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i' },
            { name: 'OPPO Reno 11 5G', sku: 'OPPO-R11', price: 9990000, costPrice: 7800000, cat: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i' },
            { name: 'Xiaomi Redmi Note 13', sku: 'XM-RN13', price: 5490000, costPrice: 4200000, cat: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i' },
            { name: 'MacBook Air M3 13"', sku: 'MBA-M3-13', price: 27990000, costPrice: 23000000, cat: 'Laptop' },
            { name: 'MacBook Pro M3 14"', sku: 'MBP-M3-14', price: 42990000, costPrice: 35000000, cat: 'Laptop' },
            { name: 'Laptop Dell Inspiron 15', sku: 'DELL-I15', price: 15990000, costPrice: 12500000, cat: 'Laptop' },
            { name: 'iPad Air M2', sku: 'IPAD-M2', price: 16990000, costPrice: 13500000, cat: 'Tablet' },
            { name: 'iPad Gen 10', sku: 'IPAD-G10', price: 9990000, costPrice: 7800000, cat: 'Tablet' },
            { name: 'Samsung Galaxy Tab S9', sku: 'SGT-S9', price: 19990000, costPrice: 15800000, cat: 'Tablet' },
            { name: 'AirPods Pro 2 USB-C', sku: 'APP2-USBC', price: 5990000, costPrice: 4200000, cat: 'PhÃ¡Â»Â¥ kiÃ¡Â»â€¡n' },
            { name: 'AirPods 3', sku: 'AP3-2022', price: 4290000, costPrice: 3100000, cat: 'PhÃ¡Â»Â¥ kiÃ¡Â»â€¡n' },
            { name: 'Apple Watch Ultra 2', sku: 'AWU2-49', price: 21490000, costPrice: 17000000, cat: 'Ã„ÂÃ¡Â»â€œng hÃ¡Â»â€œ' },
            { name: 'Apple Watch SE 2', sku: 'AWSE2', price: 6990000, costPrice: 5200000, cat: 'Ã„ÂÃ¡Â»â€œng hÃ¡Â»â€œ' },
            { name: 'Samsung Galaxy Watch 6', sku: 'SGW6', price: 7490000, costPrice: 5800000, cat: 'Ã„ÂÃ¡Â»â€œng hÃ¡Â»â€œ' },
            { name: 'JBL Flip 6', sku: 'JBL-F6', price: 2990000, costPrice: 1800000, cat: 'Loa/Tai nghe' },
            { name: 'Sony WH-1000XM5', sku: 'SONY-XM5', price: 7490000, costPrice: 5500000, cat: 'Loa/Tai nghe' },
            { name: 'Ã¡Â»Âp lÃ†Â°ng iPhone 15 PM', sku: 'CASE-IP15PM', price: 350000, costPrice: 80000, cat: 'PhÃ¡Â»Â¥ kiÃ¡Â»â€¡n' },
            { name: 'CÃƒÂ¡p sÃ¡ÂºÂ¡c USB-C 2m', sku: 'CABLE-USBC', price: 250000, costPrice: 50000, cat: 'PhÃ¡Â»Â¥ kiÃ¡Â»â€¡n' },
            { name: 'KÃƒÂ­nh cÃ†Â°Ã¡Â»Âng lÃ¡Â»Â±c iPhone', sku: 'GLASS-IP', price: 150000, costPrice: 25000, cat: 'PhÃ¡Â»Â¥ kiÃ¡Â»â€¡n' },
            { name: 'Pin sÃ¡ÂºÂ¡c dÃ¡Â»Â± phÃƒÂ²ng 20000mAh', sku: 'PB-20K', price: 690000, costPrice: 350000, cat: 'PhÃ¡Â»Â¥ kiÃ¡Â»â€¡n' },
            { name: 'ChuÃ¡Â»â„¢t Logitech MX Master 3S', sku: 'LG-MXM3S', price: 2490000, costPrice: 1500000, cat: 'PhÃ¡Â»Â¥ kiÃ¡Â»â€¡n' },
            { name: 'BÃƒÂ n phÃƒÂ­m Logitech K380', sku: 'LG-K380', price: 890000, costPrice: 520000, cat: 'PhÃ¡Â»Â¥ kiÃ¡Â»â€¡n' },
            { name: 'BÃ¡Â»â„¢ sÃ¡ÂºÂ¡c nhanh 65W GaN', sku: 'CHRG-65W', price: 890000, costPrice: 380000, cat: 'PhÃ¡Â»Â¥ kiÃ¡Â»â€¡n' },
            { name: 'Ã„ÂÃ¡ÂºÂ¿ sÃ¡ÂºÂ¡c khÃƒÂ´ng dÃƒÂ¢y MagSafe', sku: 'MS-CHR', price: 990000, costPrice: 450000, cat: 'PhÃ¡Â»Â¥ kiÃ¡Â»â€¡n' },
            { name: 'TÃƒÂºi chÃ¡Â»â€˜ng sÃ¡Â»â€˜c Laptop 14"', sku: 'BAG-14', price: 390000, costPrice: 150000, cat: 'PhÃ¡Â»Â¥ kiÃ¡Â»â€¡n' },
        ]
        let products: any[] = []
        for (const p of sampleProducts) {
            const catId = categoryMap[p.cat]
            if (!catId) continue
            try {
                const created = await (prisma as any).product.create({
                    data: { name: p.name, sku: p.sku, barcode: p.sku, stock: rng(10, 200), costPrice: p.costPrice, sellingPrice: p.price, baseUnit: 'cÃƒÂ¡i', categoryId: catId }
                })
                counts.products++
                products.push({ id: created.id, name: p.name, sku: p.sku, price: p.price, costPrice: p.costPrice })
            } catch (_) { }
        }
        if (products.length < 5) products = await (prisma as any).product.findMany({ take: 30 })

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 2. CUSTOMERS (20) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const custData = [
            { name: 'NguyÃ¡Â»â€¦n VÃ„Æ’n An', phone: '0901234567', email: 'an.nguyen@gmail.com', address: '123 NguyÃ¡Â»â€¦n HuÃ¡Â»â€¡, Q.1, HCM' },
            { name: 'TrÃ¡ÂºÂ§n ThÃ¡Â»â€¹ BÃƒÂ¬nh', phone: '0912345678', email: 'binh.tran@gmail.com', address: '456 LÃƒÂª LÃ¡Â»Â£i, Q.1, HCM' },
            { name: 'LÃƒÂª HoÃƒÂ ng DÃ…Â©ng', phone: '0923456789', email: 'dung.le@yahoo.com', address: '789 CÃƒÂ¡ch MÃ¡ÂºÂ¡ng T8, Q.3, HCM' },
            { name: 'PhÃ¡ÂºÂ¡m Minh QuÃƒÂ¢n', phone: '0934567890', email: 'quan.pham@outlook.com', address: '12 NguyÃ¡Â»â€¦n TrÃƒÂ£i, Q.5, HCM' },
            { name: 'HoÃƒÂ ng ThÃƒÂ¹y Linh', phone: '0945678901', email: 'linh.hoang@gmail.com', address: '34 Hai BÃƒÂ  TrÃ†Â°ng, Q.1, HCM' },
            { name: 'VÃƒÂµ Ã„ÂÃƒÂ¬nh BÃ¡ÂºÂ£o', phone: '0956789012', email: 'bao.vo@gmail.com', address: '567 Ã„ÂiÃ¡Â»â€¡n BiÃƒÂªn PhÃ¡Â»Â§, BÃƒÂ¬nh ThÃ¡ÂºÂ¡nh' },
            { name: 'Ã„ÂÃ¡ÂºÂ·ng Kim NgÃƒÂ¢n', phone: '0967890123', email: 'ngan.dang@gmail.com', address: '89 Phan XÃƒÂ­ch Long, PhÃƒÂº NhuÃ¡ÂºÂ­n' },
            { name: 'BÃƒÂ¹i Thanh TÃƒÂ¹ng', phone: '0978901234', email: 'tung.bui@gmail.com', address: '101 Quang Trung, GÃƒÂ² VÃ¡ÂºÂ¥p' },
            { name: 'NgÃƒÂ´ ThÃ¡Â»â€¹ Mai', phone: '0989012345', email: 'mai.ngo@gmail.com', address: '202 LÃƒÂ½ ThÃ†Â°Ã¡Â»Âng KiÃ¡Â»â€¡t, Q.10' },
            { name: 'HuÃ¡Â»Â³nh Gia Huy', phone: '0990123456', email: 'huy.huynh@gmail.com', address: '303 VÃƒÂµ VÃ„Æ’n TÃ¡ÂºÂ§n, Q.3' },
            { name: 'TrÃ†Â°Ã†Â¡ng ThÃ¡Â»â€¹ HÃƒÂ ', phone: '0901112233', email: 'ha.truong@gmail.com', address: '15 NTM Khai, Q.1' },
            { name: 'LÃƒÂ½ QuÃ¡Â»â€˜c Ã„ÂÃ¡ÂºÂ¡t', phone: '0912223344', email: 'dat.ly@gmail.com', address: '42 TrÃ¡ÂºÂ§n HÃ†Â°ng Ã„ÂÃ¡ÂºÂ¡o, Q.5' },
            { name: 'Ã„Âinh ThÃ¡ÂºÂ¿ Anh', phone: '0923334455', email: 'anh.dinh@gmail.com', address: '77 NguyÃ¡Â»â€¦n VÃ„Æ’n CÃ¡Â»Â«, Q.5' },
            { name: 'Phan NhÃ†Â° QuÃ¡Â»Â³nh', phone: '0934445566', email: 'quynh.phan@gmail.com', address: '158 Pasteur, Q.3' },
            { name: 'CT TNHH Minh PhÃƒÂ¡t', phone: '02838123456', email: 'minhphat@corp.vn', address: '27 NÃ„Â ChiÃ¡Â»Æ’u, Q.3' },
            { name: 'CT BÃƒÂ¡ch Khoa Tech', phone: '02839876543', email: 'bktech@corp.vn', address: '100 TÃƒÂ´ HiÃ¡ÂºÂ¿n ThÃƒÂ nh, Q.10' },
            { name: 'GÃ„Â TrÃ¡ÂºÂ§n Minh TuÃ¡ÂºÂ¥n', phone: '0908765432', email: 'tuan.tran@biz.vn', address: '201 LÃ…Â©y BÃƒÂ¡n BÃƒÂ­ch, TÃƒÂ¢n PhÃƒÂº' },
            { name: 'CafÃƒÂ© An NhiÃƒÂªn', phone: '0918765432', email: 'annhien@cafe.vn', address: '35 NguyÃ¡Â»â€¦n HuÃ¡Â»â€¡, Q.1' },
            { name: 'CH ThiÃƒÂªn Long', phone: '0928765432', email: 'thienlong@shop.vn', address: '88 TrÃ¡ÂºÂ§n QuÃ¡Â»â€˜c ToÃ¡ÂºÂ£n, Q.3' },
            { name: 'VÃ…Â© HoÃƒÂ ng Nam', phone: '0938765432', email: 'nam.vu@gmail.com', address: '55 LÃ¡ÂºÂ¡c Long QuÃƒÂ¢n, TÃƒÂ¢n BÃƒÂ¬nh' },
        ]
        let customers: any[] = []
        for (let i = 0; i < custData.length; i++) {
            try {
                const c = await prisma.customer.create({ data: { code: `KH-${pad(i + 1, 3)}`, name: custData[i].name, phone: custData[i].phone, email: custData[i].email, address: custData[i].address } })
                customers.push(c)
                counts.customers++
            } catch (_) { }
        }
        if (customers.length < 5) try { customers = await prisma.customer.findMany({ take: 20 }) } catch (_) { }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 3. SUPPLIERS (8) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const supplierData = [
            { name: 'CÃƒÂ´ng ty TNHH Apple ViÃ¡Â»â€¡t Nam', phone: '02838001001', email: 'apple.vn@supplier.com', address: '1 LÃƒÂª DuÃ¡ÂºÂ©n, Q.1, HCM', contact: 'NguyÃ¡Â»â€¦n VÃ„Æ’n HÃƒÂ¹ng' },
            { name: 'Samsung Vina Electronics', phone: '02838002002', email: 'samsung.vn@supplier.com', address: 'KCN YÃƒÂªn Phong, BÃ¡ÂºÂ¯c Ninh', contact: 'TrÃ¡ÂºÂ§n QuÃ¡Â»â€˜c BÃ¡ÂºÂ£o' },
            { name: 'PhÃ¡Â»Â¥ KiÃ¡Â»â€¡n SÃƒÂ i GÃƒÂ²n JSC', phone: '02838003003', email: 'pksg@supplier.com', address: '112 NTM Khai, Q.3, HCM', contact: 'LÃƒÂª Minh Ã„ÂÃ¡Â»Â©c' },
            { name: 'Synnex FPT Distribution', phone: '02838004004', email: 'synnex@fpt.com.vn', address: '89 LÃƒÂª ThÃƒÂ¡nh TÃƒÂ´n, Q.1', contact: 'PhÃ¡ÂºÂ¡m HÃ¡Â»â€œng PhÃƒÂºc' },
            { name: 'Digiworld Corporation', phone: '02838005005', email: 'digiworld@dw.com.vn', address: 'TÃ¡ÂºÂ§ng 12, Etown, TÃƒÂ¢n BÃƒÂ¬nh', contact: 'HoÃƒÂ ng Minh TuÃ¡Â»â€¡' },
            { name: 'JBL & Harman Vietnam', phone: '02838006006', email: 'jbl.vn@harman.com', address: '45 TrÃ†Â°Ã¡Â»Âng SÃ†Â¡n, TÃƒÂ¢n BÃƒÂ¬nh', contact: 'VÃ…Â© Ã„ÂÃ¡Â»Â©c ThÃ¡ÂºÂ¯ng' },
            { name: 'Logitech Asia Pacific', phone: '02838007007', email: 'logitech@logi.com', address: '15 NK KhÃ¡Â»Å¸i NghÃ„Â©a, Q.1', contact: 'Ã„ÂÃƒÂ m Thu HÃƒÂ ' },
            { name: 'Dell Technologies VN', phone: '02838008008', email: 'dell.vn@dell.com', address: '30 LT TÃƒÂ´n, Q.1', contact: 'NguyÃ¡Â»â€¦n Ã„ÂÃƒÂ¬nh Quang' },
        ]
        for (let i = 0; i < supplierData.length; i++) {
            try {
                await (prisma as any).supplier.create({ data: { code: `NCC-${pad(i + 1, 3)}`, name: supplierData[i].name, phone: supplierData[i].phone, email: supplierData[i].email, address: supplierData[i].address, contactName: supplierData[i].contact } })
                counts.suppliers++
            } catch (_) { }
        }
        const supplierNames = supplierData.map(s => s.name)

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 4. USER for createdBy Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        let createdByUser: any = null
        try { createdByUser = await prisma.user.findFirst() } catch (_) { }
        const creatorId = createdByUser?.id || userId
        const creatorName = createdByUser?.name || 'NhÃƒÂ¢n viÃƒÂªn'

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 5. TRANSACTIONS (seasonal: ~400 total over 13 months) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        for (const { year, month } of months) {
            let baseCount = 30
            if (month === 12) baseCount = 50
            else if (month === 1 || month === 2) baseCount = 40
            else if (month >= 6 && month <= 8) baseCount = 20

            const txCount = rng(baseCount - 5, baseCount + 5)
            for (let t = 0; t < txCount; t++) {
                const date = randDate(year, month)
                const itemCount = rng(1, 4)
                const txItems: any[] = []
                let subtotal = 0

                for (let j = 0; j < itemCount; j++) {
                    const product = pick(products)
                    const qty = rng(1, 3)
                    const disc = rng(0, 5) === 0 ? rng(50000, 500000) : 0
                    const lineTotal = (product.price * qty) - disc
                    txItems.push({ productId: product.id, productName: product.name, sku: product.sku, quantity: qty, unitPrice: product.price, discount: disc, lineTotal })
                    subtotal += lineTotal
                }

                const taxRate = 0.1
                const tax = Math.round(subtotal * taxRate)
                const total = subtotal + tax
                const payType = pick(['cash', 'cash', 'cash', 'bank', 'transfer'])
                const isPaid = rng(1, 10) <= 8
                const amountReceived = isPaid ? total : 0
                const cust = rng(1, 3) <= 2 ? pick(customers) : null
                const receipt = `HCM-${year}${pad(month)}${pad(t + 1, 4)}`

                try {
                    await prisma.transaction.create({
                        data: {
                            receiptNumber: receipt,
                            customerId: cust?.id || null, customerName: cust?.name || null, customerPhone: cust?.phone || null,
                            branchId, subtotal, discount: 0, tax, total,
                            amountReceived, change: Math.max(0, amountReceived - total),
                            status: 'completed',
                            createdBy: creatorId, createdByName: creatorName,
                            transactionDate: date, createdAt: date,
                            items: { create: txItems },
                            payments: isPaid ? { create: [{ type: payType, amount: total }] } : undefined,
                        }
                    })
                    counts.transactions++
                } catch (_) { }
            }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 6. EXPENSES (monthly fixed + variable) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const expCategories = [
            { cat: 'rent', desc: 'ThuÃƒÂª mÃ¡ÂºÂ·t bÃ¡ÂºÂ±ng cÃ¡Â»Â­a hÃƒÂ ng', min: 18000000, max: 22000000, monthly: true },
            { cat: 'utilities', desc: 'Ã„ÂiÃ¡Â»â€¡n nÃ†Â°Ã¡Â»â€ºc', min: 3500000, max: 7000000, monthly: true },
            { cat: 'salary', desc: 'LÃ†Â°Ã†Â¡ng nhÃƒÂ¢n viÃƒÂªn cÃ¡Â»Â­a hÃƒÂ ng', min: 35000000, max: 55000000, monthly: true },
            { cat: 'transport', desc: 'Chi phÃƒÂ­ vÃ¡ÂºÂ­n chuyÃ¡Â»Æ’n hÃƒÂ ng', min: 2000000, max: 5000000, monthly: true },
            { cat: 'marketing', desc: 'QuÃ¡ÂºÂ£ng cÃƒÂ¡o online', min: 5000000, max: 15000000, monthly: false },
            { cat: 'maintenance', desc: 'BÃ¡ÂºÂ£o trÃƒÂ¬ sÃ¡Â»Â­a chÃ¡Â»Â¯a', min: 500000, max: 3000000, monthly: false },
            { cat: 'supplies', desc: 'VÃ„Æ’n phÃƒÂ²ng phÃ¡ÂºÂ©m', min: 300000, max: 1500000, monthly: false },
            { cat: 'insurance', desc: 'BÃ¡ÂºÂ£o hiÃ¡Â»Æ’m cÃ¡Â»Â­a hÃƒÂ ng', min: 2000000, max: 4000000, monthly: false },
            { cat: 'other', desc: 'Chi phÃƒÂ­ khÃƒÂ¡c', min: 300000, max: 2000000, monthly: false },
        ]
        for (const { year, month } of months) {
            for (const ec of expCategories.filter(c => c.monthly)) {
                const date = randDate(year, month)
                try {
                    await prisma.expense.create({ data: { description: `${ec.desc} T${month}/${year}`, amount: rng(ec.min, ec.max), category: ec.cat, date, paidBy: ec.cat === 'rent' ? 'bank' : pick(['cash', 'bank']), branchId } })
                    counts.expenses++
                } catch (_) { }
            }
            for (let e = 0; e < rng(2, 5); e++) {
                const ec = pick(expCategories.filter(c => !c.monthly))
                try {
                    await prisma.expense.create({ data: { description: `${ec.desc} T${month}/${year}`, amount: rng(ec.min, ec.max), category: ec.cat, date: randDate(year, month), paidBy: pick(['cash', 'bank']), branchId } })
                    counts.expenses++
                } catch (_) { }
            }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 7. IMPORT RECEIPTS (3-6 per month) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        for (const { year, month } of months) {
            const impCount = rng(3, 6)
            for (let i = 0; i < impCount; i++) {
                const date = randDate(year, month)
                const supplier = pick(supplierNames)
                const itemCount = rng(2, 5)
                let totalCost = 0
                const items: any[] = []
                for (let j = 0; j < itemCount; j++) {
                    const p = pick(products)
                    const qty = rng(5, 30)
                    const cost = p.costPrice || rng(500000, 20000000)
                    totalCost += cost * qty
                    items.push({ productId: p.id, productName: p.name, sku: p.sku, quantity: qty, unitCost: cost, lineTotal: cost * qty })
                }
                const code = `IMP-HCM-${year}${pad(month)}${pad(i + 1, 3)}`
                try {
                    await prisma.importReceipt.create({
                        data: { code, supplierName: supplier, totalCost, totalItems: items.reduce((s: number, it: any) => s + it.quantity, 0), status: 'completed', branchId, userId: creatorId, userName: creatorName, transactionDate: date, createdAt: date, items: { create: items } }
                    })
                    counts.imports++
                } catch (_) { }
            }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 8. ONLINE ORDERS (5-8 per month) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const platforms = ['Shopee', 'Lazada', 'Tiki', 'TikTok Shop']
        const customerNames = custData.map(c => c.name)
        const customerPhones = custData.map(c => c.phone)
        for (const { year, month } of months) {
            for (let o = 0; o < rng(5, 8); o++) {
                const date = randDate(year, month)
                const platform = pick(platforms)
                const itemCount = rng(1, 3)
                let subtotal = 0
                const items: any[] = []
                for (let j = 0; j < itemCount; j++) {
                    const p = pick(products)
                    const qty = rng(1, 2)
                    const disc = rng(0, 3) === 0 ? rng(50000, 200000) : 0
                    const lineTotal = (p.price * qty) - disc
                    subtotal += lineTotal
                    items.push({ productId: p.id, productName: p.name, sku: p.sku, quantity: qty, unitPrice: p.price, discount: disc, lineTotal })
                }
                const shippingFee = rng(0, 50000)
                const total = subtotal + shippingFee
                const feeRate = platform === 'Shopee' ? 0.06 : platform === 'Lazada' ? 0.05 : platform === 'Tiki' ? 0.04 : 0.03
                const platformFee = Math.round(subtotal * feeRate)
                const isPaid = rng(1, 10) <= 7
                try {
                    await (prisma as any).onlineOrder.create({
                        data: {
                            orderNumber: `ON-${platform.substring(0, 2).toUpperCase()}-${year}${pad(month)}${pad(o + 1, 3)}`,
                            platform, customerName: pick(customerNames), customerPhone: pick(customerPhones),
                            status: pick(['completed', 'delivered']),
                            subtotal, discount: 0, shippingFee, total,
                            paymentMethod: 'bank', paymentStatus: isPaid ? 'paid' : 'unpaid',
                            paidAt: isPaid ? date : null,
                            platformFee, platformFeeRate: feeRate, netRevenue: total - platformFee,
                            createdAt: date, updatedAt: date,
                            items: { create: items },
                        }
                    })
                    counts.onlineOrders++
                } catch (_) { }
            }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 9. FIXED ASSETS Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const assets = [
            { code: 'FA-HCM-001', name: 'TÃ¡Â»Â§ trÃ†Â°ng bÃƒÂ y kÃƒÂ­nh cÃ†Â°Ã¡Â»Âng lÃ¡Â»Â±c', category: 'furniture', originalCost: 45000000, usefulLifeMonths: 60 },
            { code: 'FA-HCM-002', name: 'MÃƒÂ¡y tÃƒÂ­nh POS Dell', category: 'machine', originalCost: 18000000, usefulLifeMonths: 36 },
            { code: 'FA-HCM-003', name: 'Camera an ninh Hikvision', category: 'machine', originalCost: 12000000, usefulLifeMonths: 48 },
            { code: 'FA-HCM-004', name: 'BiÃ¡Â»Æ’n hiÃ¡Â»â€¡u LED cÃ¡Â»Â­a hÃƒÂ ng', category: 'furniture', originalCost: 25000000, usefulLifeMonths: 60 },
            { code: 'FA-HCM-005', name: 'MÃƒÂ¡y in hÃƒÂ³a Ã„â€˜Ã†Â¡n Epson', category: 'machine', originalCost: 8500000, usefulLifeMonths: 36 },
        ]
        for (const a of assets) {
            const monthly = Math.round(a.originalCost / a.usefulLifeMonths)
            try {
                await (prisma as any).fixedAsset.create({
                    data: { ...a, acquisitionDate: '2025-03-01', method: 'straight-line', monthlyDepreciation: monthly, accumulatedDepreciation: 0, netBookValue: a.originalCost, depreciationAccount: '6274', status: 'active' }
                })
                counts.fixedAssets++
            } catch (_) { }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 10. PAYROLL Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        try {
            const employees = await prisma.user.findMany({ where: { salary: { gt: 0 } }, select: { id: true, name: true, salary: true } })
            for (const { year, month } of months) {
                for (const emp of employees) {
                    try {
                        await (prisma as any).payrollRecord.create({
                            data: {
                                month, year, employeeId: emp.id, employeeName: emp.name || 'NV',
                                grossSalary: emp.salary, netSalary: Math.round((emp.salary || 0) * 0.895),
                                totalCost: Math.round((emp.salary || 0) * 1.215),
                                bhxhEmployee: Math.round((emp.salary || 0) * 0.08),
                                bhytEmployee: Math.round((emp.salary || 0) * 0.015),
                                bhtnEmployee: Math.round((emp.salary || 0) * 0.01),
                                bhxhEmployer: Math.round((emp.salary || 0) * 0.175),
                                bhytEmployer: Math.round((emp.salary || 0) * 0.03),
                                bhtnEmployer: Math.round((emp.salary || 0) * 0.01),
                                pitAmount: 0, allowances: 0, deductions: 0,
                            }
                        })
                        counts.payroll++
                    } catch (_) { }
                }
            }
        } catch (_) { }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 11. RETURN ORDERS (~3 per month) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const returnReasons = ['HÃƒÂ ng lÃ¡Â»â€”i', 'Sai sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m', 'KhÃƒÂ´ng Ã„â€˜ÃƒÂºng mÃƒÂ´ tÃ¡ÂºÂ£', 'KhÃƒÂ¡ch Ã„â€˜Ã¡Â»â€¢i ÃƒÂ½', 'HÃƒÂ ng hÃ†Â° hÃ¡Â»Âng khi vÃ¡ÂºÂ­n chuyÃ¡Â»Æ’n']
        const returnConditions = ['new', 'used', 'damaged', 'defective']
        const refundMethods = ['cash', 'bank_transfer', 'store_credit', 'exchange']
        for (const { year, month } of months) {
            const retCount = rng(2, 4)
            for (let r = 0; r < retCount; r++) {
                const date = randDate(year, month)
                const cust = pick(customers)
                const code = `RET-HCM-${year}${pad(month)}${pad(r + 1, 3)}`
                const originalInvoice = `HCM-${year}${pad(month)}${pad(rng(1, 20), 4)}`
                const itemCount = rng(1, 2)
                const retItems: any[] = []
                let totalRefund = 0
                for (let j = 0; j < itemCount; j++) {
                    const p = pick(products)
                    const qty = 1
                    totalRefund += p.price
                    retItems.push({ productName: p.name, sku: p.sku, quantity: qty, unitPrice: p.price, returnReason: pick(returnReasons), condition: pick(returnConditions) })
                }
                try {
                    await (prisma as any).returnOrder.create({
                        data: {
                            code, originalInvoice, customerName: cust.name, customerPhone: cust.phone,
                            reason: pick(returnReasons), refundMethod: pick(refundMethods),
                            refundAmount: totalRefund, totalRefund,
                            status: pick(['approved', 'refunded', 'exchanged', 'processing']),
                            staffName: creatorName, branchId,
                            createdAt: date, updatedAt: date,
                            processedAt: rng(1, 3) <= 2 ? new Date(date.getTime() + rng(1, 3) * 86400000) : null,
                            items: { create: retItems },
                        }
                    })
                    counts.returns++
                } catch (_) { }
            }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 12. WARRANTIES (~5 per month) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        for (const { year, month } of months) {
            const warCount = rng(3, 6)
            for (let w = 0; w < warCount; w++) {
                const p = pick(products.filter(pr => pr.price > 5000000)) || pick(products)
                const cust = pick(customers)
                const startDate = randDate(year, month)
                const warrantyMonths = pick([6, 12, 18, 24])
                const endDate = new Date(startDate.getTime() + warrantyMonths * 30 * 86400000)
                const code = `WR-HCM-${year}${pad(month)}${pad(w + 1, 3)}`
                try {
                    await (prisma as any).warranty.create({
                        data: {
                            code, productId: p.id, productName: p.name,
                            customerName: cust.name, customerPhone: cust.phone,
                            serialNumber: `SN-${p.sku}-${rng(10000, 99999)}`,
                            startDate, endDate,
                            status: endDate > new Date() ? 'active' : 'expired',
                            notes: `BÃ¡ÂºÂ£o hÃƒÂ nh ${warrantyMonths} thÃƒÂ¡ng`,
                        }
                    })
                    counts.warranties++
                } catch (_) { }
            }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 13. REPAIRS (~2 per month) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const repairIssues = ['MÃƒÂ n hÃƒÂ¬nh bÃ¡Â»â€¹ vÃ¡Â»Â¡', 'Pin chai khÃƒÂ´ng giÃ¡Â»Â¯ sÃ¡ÂºÂ¡c', 'KhÃƒÂ´ng nhÃ¡ÂºÂ­n sÃ¡ÂºÂ¡c', 'Loa bÃ¡Â»â€¹ rÃƒÂ¨', 'Camera mÃ¡Â»Â', 'NÃƒÂºt nguÃ¡Â»â€œn kÃ¡ÂºÂ¹t', 'Wifi yÃ¡ÂºÂ¿u', 'SÃ¡Â»Âc mÃƒÂ n hÃƒÂ¬nh', 'MÃ¡ÂºÂ¥t vÃƒÂ¢n tay', 'PhÃ¡ÂºÂ§n mÃ¡Â»Âm lÃ¡Â»â€”i']
        const repairStatuses = ['received', 'diagnosing', 'repairing', 'completed', 'delivered']
        for (const { year, month } of months) {
            const repCount = rng(1, 3)
            for (let r = 0; r < repCount; r++) {
                const p = pick(products.filter(pr => pr.price > 3000000)) || pick(products)
                const cust = pick(customers)
                const date = randDate(year, month)
                const cost = rng(200000, 5000000)
                const code = `REP-HCM-${year}${pad(month)}${pad(r + 1, 3)}`
                const status = pick(repairStatuses)
                try {
                    await (prisma as any).repair.create({
                        data: {
                            code, productName: p.name,
                            customerName: cust.name, customerPhone: cust.phone,
                            issue: pick(repairIssues), status, cost,
                            estimatedDate: new Date(date.getTime() + rng(3, 7) * 86400000),
                            completedDate: (status === 'completed' || status === 'delivered') ? new Date(date.getTime() + rng(3, 10) * 86400000) : null,
                            notes: `SÃ¡Â»Â­a chÃ¡Â»Â¯a ${p.name}`,
                            createdAt: date, updatedAt: date,
                        }
                    })
                    counts.repairs++
                } catch (_) { }
            }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 14. BRANCHES Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const branchData = [
            { name: 'Chi nhÃƒÂ¡nh Q.7', code: 'HCM-Q7', address: '123 NguyÃ¡Â»â€¦n ThÃ¡Â»â€¹ ThÃ¡ÂºÂ­p, Q.7, HCM', phone: '02837001001' },
            { name: 'Chi nhÃƒÂ¡nh ThÃ¡Â»Â§ Ã„ÂÃ¡Â»Â©c', code: 'HCM-TD', address: '456 VÃƒÂµ VÃ„Æ’n NgÃƒÂ¢n, TP.ThÃ¡Â»Â§ Ã„ÂÃ¡Â»Â©c, HCM', phone: '02837002002' },
            { name: 'Chi nhÃƒÂ¡nh BÃƒÂ¬nh TÃƒÂ¢n', code: 'HCM-BT', address: '789 LÃƒÂª VÃ„Æ’n QuÃ¡Â»â€ºi, BÃƒÂ¬nh TÃƒÂ¢n, HCM', phone: '02837003003' },
        ]
        for (const b of branchData) {
            try {
                await (prisma as any).branch.create({ data: { name: b.name, code: b.code, address: b.address, phone: b.phone, status: 'active' } })
                counts.branches++
            } catch (_) { }
        }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 15. SCHEDULES (lÃ¡Â»â€¹ch ca) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const shiftTypes = ['morning', 'afternoon', 'evening']
        const shiftLabels: Record<string, string> = { morning: 'Ca sÃƒÂ¡ng (8:00-14:00)', afternoon: 'Ca chiÃ¡Â»Âu (14:00-20:00)', evening: 'Ca tÃ¡Â»â€˜i (18:00-22:00)' }
        try {
            const allUsers = await prisma.user.findMany({ select: { id: true, name: true } })
            if (allUsers.length > 0) {
                for (const { year, month } of months) {
                    const daysInMonth = new Date(year, month, 0).getDate()
                    for (let d = 1; d <= daysInMonth; d++) {
                        const date = new Date(year, month - 1, d)
                        const dayOfWeek = date.getDay()
                        // Skip some Sundays randomly
                        if (dayOfWeek === 0 && rng(1, 3) <= 2) continue
                        // Assign 1-2 users per shift, 2 shifts per day
                        const dayShifts = dayOfWeek === 6 ? ['morning', 'afternoon'] : ['morning', 'afternoon']
                        for (const shift of dayShifts) {
                            const user = pick(allUsers)
                            try {
                                await (prisma as any).schedule.create({
                                    data: { userId: user.id, userName: user.name || 'NV', date, shift, status: pick(['scheduled', 'confirmed']), branchId, notes: shiftLabels[shift] }
                                })
                                counts.schedules++
                            } catch (_) { }
                        }
                    }
                }
            }
        } catch (_) { }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 16. ATTENDANCE (chÃ¡ÂºÂ¥m cÃƒÂ´ng) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        try {
            const allUsers = await prisma.user.findMany({ select: { id: true, name: true, role: true } })
            if (allUsers.length > 0) {
                for (const { year, month } of months) {
                    const daysInMonth = new Date(year, month, 0).getDate()
                    for (let d = 1; d <= daysInMonth; d++) {
                        const date = new Date(year, month - 1, d)
                        const dayOfWeek = date.getDay()
                        if (dayOfWeek === 0) continue // ChÃ¡Â»Â§ nhÃ¡ÂºÂ­t nghÃ¡Â»â€°
                        for (const user of allUsers) {
                            // 90% Ã„â€˜i lÃƒÂ m, 5% nghÃ¡Â»â€° phÃƒÂ©p, 5% vÃ¡ÂºÂ¯ng
                            const rand = rng(1, 100)
                            let status = 'present'
                            let checkIn: Date | null = null
                            let checkOut: Date | null = null
                            let note: string | null = null
                            if (rand <= 90) {
                                status = 'present'
                                const inH = rng(7, 8), inM = rng(0, 59)
                                checkIn = new Date(year, month - 1, d, inH, inM)
                                const outH = rng(17, 19), outM = rng(0, 59)
                                checkOut = new Date(year, month - 1, d, outH, outM)
                                if (inH >= 8 && inM > 15) { status = 'late'; note = 'Ã„Âi trÃ¡Â»â€¦ ' + inM + ' phÃƒÂºt' }
                            } else if (rand <= 95) {
                                status = 'leave'
                                note = pick(['NghÃ¡Â»â€° phÃƒÂ©p', 'NghÃ¡Â»â€° Ã¡Â»â€˜m', 'ViÃ¡Â»â€¡c gia Ã„â€˜ÃƒÂ¬nh'])
                            } else {
                                status = 'absent'
                                note = 'VÃ¡ÂºÂ¯ng khÃƒÂ´ng phÃƒÂ©p'
                            }
                            try {
                                await (prisma as any).attendance.create({
                                    data: { userId: user.id, userName: user.name || 'NV', role: user.role, date, checkIn, checkOut, status, note, branchId }
                                })
                                counts.attendance++
                            } catch (_) { }
                        }
                    }
                }
            }
        } catch (_) { }

        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â 17. SALES CHECKINS (giÃƒÂ¡m sÃƒÂ¡t sale) Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        const hcmLocations = [
            { lat: 10.7769, lng: 106.7009, addr: '123 NguyÃ¡Â»â€¦n HuÃ¡Â»â€¡, Q.1, HCM' },
            { lat: 10.7731, lng: 106.6982, addr: '456 LÃƒÂª LÃ¡Â»Â£i, Q.1, HCM' },
            { lat: 10.7867, lng: 106.6802, addr: '789 CMT8, Q.3, HCM' },
            { lat: 10.7588, lng: 106.6683, addr: '12 NguyÃ¡Â»â€¦n TrÃƒÂ£i, Q.5, HCM' },
            { lat: 10.8017, lng: 106.7148, addr: '34 Hai BÃƒÂ  TrÃ†Â°ng, Q.1, HCM' },
            { lat: 10.8113, lng: 106.6813, addr: '101 Quang Trung, GÃƒÂ² VÃ¡ÂºÂ¥p' },
            { lat: 10.7942, lng: 106.6753, addr: '89 Phan XÃƒÂ­ch Long, PhÃƒÂº NhuÃ¡ÂºÂ­n' },
            { lat: 10.7657, lng: 106.6652, addr: '202 LÃƒÂ½ ThÃ†Â°Ã¡Â»Âng KiÃ¡Â»â€¡t, Q.10' },
            { lat: 10.7356, lng: 106.7241, addr: '55 NguyÃ¡Â»â€¦n ThÃ¡Â»â€¹ ThÃ¡ÂºÂ­p, Q.7' },
            { lat: 10.8488, lng: 106.7713, addr: '456 VÃƒÂµ VÃ„Æ’n NgÃƒÂ¢n, ThÃ¡Â»Â§ Ã„ÂÃ¡Â»Â©c' },
        ]
        const checkinTypes = ['check_in', 'check_out', 'visit']
        const visitNotes = ['GÃ¡ÂºÂ·p KH tÃ†Â° vÃ¡ÂºÂ¥n sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m mÃ¡Â»â€ºi', 'Thu nÃ¡Â»Â£ khÃƒÂ¡ch hÃƒÂ ng', 'Giao hÃƒÂ ng tÃ¡ÂºÂ­n nÃ†Â¡i', 'KhÃ¡ÂºÂ£o sÃƒÂ¡t thÃ¡Â»â€¹ trÃ†Â°Ã¡Â»Âng', 'ChÃ„Æ’m sÃƒÂ³c khÃƒÂ¡ch hÃƒÂ ng cÃ…Â©', 'GiÃ¡Â»â€ºi thiÃ¡Â»â€¡u chÃ†Â°Ã†Â¡ng trÃƒÂ¬nh khuyÃ¡ÂºÂ¿n mÃƒÂ£i', 'Thu thÃ¡ÂºÂ­p feedback', 'Demo sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m tÃ¡ÂºÂ¡i cÃ¡Â»Â­a hÃƒÂ ng KH']
        try {
            const salesUsers = await prisma.user.findMany({ select: { id: true, name: true } })
            if (salesUsers.length > 0) {
                for (const { year, month } of months) {
                    const daysInMonth = new Date(year, month, 0).getDate()
                    for (let d = 1; d <= daysInMonth; d++) {
                        const dayOfWeek = new Date(year, month - 1, d).getDay()
                        if (dayOfWeek === 0) continue
                        const checkinCount = rng(3, 6)
                        for (let c = 0; c < checkinCount; c++) {
                            const user = pick(salesUsers)
                            const loc = pick(hcmLocations)
                            const type = pick(checkinTypes)
                            const hour = type === 'check_in' ? rng(7, 9) : type === 'check_out' ? rng(17, 19) : rng(9, 17)
                            const cust = type === 'visit' ? pick(customers) : null
                            const createdAt = new Date(year, month - 1, d, hour, rng(0, 59))
                            try {
                                await (prisma as any).salesCheckin.create({
                                    data: {
                                        userId: user.id, type,
                                        latitude: loc.lat + (Math.random() - 0.5) * 0.005,
                                        longitude: loc.lng + (Math.random() - 0.5) * 0.005,
                                        address: loc.addr,
                                        note: type === 'visit' ? pick(visitNotes) : type === 'check_in' ? 'Check-in Ã„â€˜Ã¡ÂºÂ§u ca' : 'Check-out cuÃ¡Â»â€˜i ca',
                                        customerId: cust?.id || null,
                                        customerName: cust?.name || null,
                                        createdAt,
                                    }
                                })
                                counts.salesCheckins++
                            } catch (_) { }
                        }
                    }
                }
            }
        } catch (_) { }

        res.json({
            success: true,
            message: `Ã„ÂÃƒÂ£ tÃ¡ÂºÂ¡o data 13 thÃƒÂ¡ng (T3/2025 Ã¢â‚¬â€œ T3/2026)${doReset ? ' (Ã„â€˜ÃƒÂ£ xÃƒÂ³a data cÃ…Â©)' : ''}`,
            data: counts,
        })
    } catch (err) { console.error('POST /seed-test-data error:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// NOTE: export default router moved to end of file — sau các route HKD S1-S7
// ===============================================================
//  HKD ACCOUNTING BOOKS (S1-S7) - TT88/2021/TT-BTC
// ===============================================================

function hkdDateRange(year: number, month?: number) {
    // new Date(year, month, day) đã tạo local time — không cần convert thêm
    // DB lưu UTC, Prisma tự handle timezone khi query
    let start: Date, end: Date
    if (month) {
        start = new Date(year, month - 1, 1, 0, 0, 0, 0)
        end = new Date(year, month, 0, 23, 59, 59, 999)
    } else {
        start = new Date(year, 0, 1, 0, 0, 0, 0)
        end = new Date(year, 11, 31, 23, 59, 59, 999)
    }
    return { start, end }
}
const fmtDate = (d: any) => { try { return new Date(d).toLocaleDateString('en-CA') } catch { return '' } } // en-CA = YYYY-MM-DD format, uses local timezone

// S1: Doanh thu
router.get('/hkd/s1', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)
        // Filter by transactionDate if set, otherwise by createdAt
        const txs = await p.transaction.findMany({
            where: {
                status: 'completed',
                OR: [
                    { transactionDate: { gte: start, lte: end } },
                    { transactionDate: null, createdAt: { gte: start, lte: end } },
                ]
            },
            orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }]
        })
        const getDate = (t: any) => t.transactionDate || t.createdAt
        const rows = txs.map((t: any, i: number) => ({
            stt: i + 1,
            ngay: fmtDate(getDate(t)),
            soChungTu: t.receiptNumber || t.code || '',
            customerName: t.customerName || '',
            soHoaDonVAT: t.vatInvoiceNumber || '',
            doanhThuChuaThue: t.subtotal || 0,
            chietKhau: t.discount || 0,
            thueGTGT: t.tax || 0,
            doanhThuThuan: (t.subtotal || 0) - (t.discount || 0),
            tongThu: t.total || 0,
            phuongThucTT: t.paymentMethod || 'cash',
        }))

        const summary = {
            tongDoanhThu: rows.reduce((s: number, r: any) => s + r.doanhThuChuaThue, 0),
            tongChietKhau: rows.reduce((s: number, r: any) => s + r.chietKhau, 0),
            tongThue: rows.reduce((s: number, r: any) => s + r.thueGTGT, 0),
            tongThueGTGT: rows.reduce((s: number, r: any) => s + r.thueGTGT, 0),
            tongDoanhThuThuan: rows.reduce((s: number, r: any) => s + r.doanhThuThuan, 0),
            tongThu: rows.reduce((s: number, r: any) => s + r.tongThu, 0),
            soPhieu: rows.length,
        }
        res.json({ success: true, data: { rows, summary, year, month } })
    } catch (err) { console.error('GET /hkd/s1:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S2: Hang hoa — Nhật ký giao dịch (nhập/xuất chi tiết từng dòng)
router.get('/hkd/s2', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)
        const orDateFilter = (): any => ({
            OR: [
                { transactionDate: { gte: start, lte: end } },
                { transactionDate: null, createdAt: { gte: start, lte: end } },
            ]
        })
        const [imports, sales] = await Promise.all([
            // FIX 1: Lọc status completed — phiếu hủy/nháp không vào sổ
            p.importReceipt.findMany({
                where: { status: 'completed', createdAt: { gte: start, lte: end } },
                include: { items: { include: { product: true } } },
                orderBy: { createdAt: 'asc' }
            }),
            p.transaction.findMany({
                where: { status: 'completed', ...orDateFilter() },
                include: { items: { include: { product: true } } },
                orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }]
            }),
        ])
        const rows: any[] = []
        let idx = 1
        for (const imp of imports) {
            for (const item of (imp.items || [])) {
                const maHang = item.productSku || item.sku || (item.productId ? item.productId.slice(-8).toUpperCase() : '—')
                const qty = item.quantity || 0
                const cp = item.costPrice || item.product?.costPrice || 0
                const tt = item.total || (qty * cp)
                // FIX 2: Dùng transactionDate nếu có, fallback createdAt
                const ngay = fmtDate(imp.transactionDate || imp.createdAt)
                rows.push({
                    stt: idx++, ngay, soChungTu: imp.receiptNumber || imp.code || '',
                    supplierName: imp.supplierName || 'NCC', type: 'import',
                    maHang, tenHangHoa: item.productName || item.name || item.product?.name || '',
                    dvt: item.unit || item.product?.baseUnit || 'ăượng',
                    nhapSoLuong: qty, nhapDonGia: cp, nhapThanhTien: tt,
                    xuatSoLuong: 0, xuatDonGia: 0, xuatThanhTien: 0,
                    dienGiai: `Nhập kho từ ${imp.supplierName || 'NCC'}`,
                })
            }
        }
        for (const sale of sales) {
            for (const item of (sale.items || [])) {
                const maHang = item.sku || item.productSku || (item.productId ? item.productId.slice(-8).toUpperCase() : '—')
                const qty = item.quantity || 0
                // FIX 3: Ưu tiên costPrice trực tiếp trên item, fallback product.costPrice
                const gv = item.costPrice || item.product?.costPrice || 0
                rows.push({
                    stt: idx++, ngay: fmtDate(sale.transactionDate || sale.createdAt),
                    soChungTu: sale.receiptNumber || '', supplierName: '', type: 'sale',
                    maHang, tenHangHoa: item.productName || item.name || item.product?.name || '',
                    dvt: item.product?.baseUnit || 'cái',
                    nhapSoLuong: 0, nhapDonGia: 0, nhapThanhTien: 0,
                    xuatSoLuong: qty, xuatDonGia: gv, xuatThanhTien: qty * gv,
                    dienGiai: `Xuất bán - ${sale.customerName || 'Khách lẻ'}`,
                })
            }
        }
        rows.sort((a, b) => a.ngay.localeCompare(b.ngay))
        rows.forEach((r, i) => r.stt = i + 1)
        const summary = {
            tongNhap: rows.reduce((s, r) => s + r.nhapThanhTien, 0),
            tongXuat: rows.reduce((s, r) => s + r.xuatThanhTien, 0),
            soPhieuNhap: imports.length,
            soPhieuXuat: sales.length,
        }
        res.json({ success: true, data: { rows, summary, year, month } })
    } catch (err) { console.error('GET /hkd/s2:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S2 Tổng hợp theo mã hàng: đầu kỳ / nhập / xuất / tồn cuối kỳ
router.get('/hkd/s2-summary', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start: kyStart, end: kyEnd } = hkdDateRange(year, month)
        const dauKyEnd = new Date(kyStart.getTime() - 1)
        const veryOldStart = new Date('2000-01-01T00:00:00Z')
        const orDate = (s: Date, e: Date): any => ({
            OR: [{ transactionDate: { gte: s, lte: e } }, { transactionDate: null, createdAt: { gte: s, lte: e } }]
        })
        const [prevImports, prevSales, kyImports, kySales] = await Promise.all([
            p.importReceipt.findMany({ where: { createdAt: { gte: veryOldStart, lte: dauKyEnd } }, include: { items: true } }),
            p.transaction.findMany({ where: { status: 'completed', ...orDate(veryOldStart, dauKyEnd) }, include: { items: { include: { product: true } } } }),
            p.importReceipt.findMany({ where: { createdAt: { gte: kyStart, lte: kyEnd } }, include: { items: true } }),
            p.transaction.findMany({ where: { status: 'completed', ...orDate(kyStart, kyEnd) }, include: { items: { include: { product: true } } } }),
        ])
        // ImportReceiptItem key: productSku. TransactionItem key: sku
        const itemKey = (item: any) => item.productSku || item.sku || (item.productId ? item.productId.slice(-8).toUpperCase() : item.productName || '—')
        const ensure = (map: Record<string, any>, item: any) => {
            const key = itemKey(item)
            if (!map[key]) map[key] = { maHang: key, tenHang: item.productName || item.name || '', dvt: item.unit || item.product?.baseUnit || 'cái', sl: 0, tt: 0 }
            return map[key]
        }
        const dauKyMap: Record<string, any> = {}
        // ImportReceipt: total = costPrice * quantity (already stored), costPrice per item
        for (const imp of prevImports) for (const item of (imp.items || [])) { const r = ensure(dauKyMap, item); r.sl += item.quantity || 0; r.tt += item.total || ((item.quantity || 0) * (item.costPrice || 0)) }
        // TransactionItem: no costPrice field → use item.product.costPrice
        for (const sale of prevSales) for (const item of (sale.items || [])) { const r = ensure(dauKyMap, item); r.sl -= item.quantity || 0; r.tt -= (item.quantity || 0) * (item.product?.costPrice || 0) }
        const nhapMap: Record<string, any> = {}
        const xuatMap: Record<string, any> = {}
        for (const imp of kyImports) for (const item of (imp.items || [])) { const r = ensure(nhapMap, item); r.sl += item.quantity || 0; r.tt += item.total || ((item.quantity || 0) * (item.costPrice || 0)) }
        for (const sale of kySales) for (const item of (sale.items || [])) { const r = ensure(xuatMap, item); r.sl += item.quantity || 0; r.tt += (item.quantity || 0) * (item.product?.costPrice || 0) }
        const allKeys = new Set([...Object.keys(dauKyMap), ...Object.keys(nhapMap), ...Object.keys(xuatMap)])
        const rowsRaw = Array.from(allKeys).sort().map((key) => {
            const dk = dauKyMap[key] || { maHang: key, tenHang: '', dvt: 'cái', sl: 0, tt: 0 }
            const nh = nhapMap[key] || { sl: 0, tt: 0 }
            const xu = xuatMap[key] || { sl: 0, tt: 0 }
            const cuoiKySL = dk.sl + nh.sl - xu.sl
            const cuoiKyTT = dk.tt + nh.tt - xu.tt
            return { maHang: dk.maHang, tenHang: dk.tenHang || nhapMap[key]?.tenHang || xuatMap[key]?.tenHang || '', dvt: dk.dvt, dauKySL: dk.sl, dauKyTT: dk.tt, nhapSL: nh.sl, nhapTT: nh.tt, xuatSL: xu.sl, xuatTT: xu.tt, cuoiKySL, cuoiKyTT }
        })
        // Chỉ giữ sản phẩm có ít nhất 1 giá trị khác 0 (tồn đầu, nhập, xuất, hoặc tồn cuối)
        const rows = rowsRaw
            .filter(r => r.dauKySL !== 0 || r.nhapSL !== 0 || r.xuatSL !== 0 || r.cuoiKySL !== 0 || r.dauKyTT !== 0 || r.nhapTT !== 0 || r.xuatTT !== 0 || r.cuoiKyTT !== 0)
            .map((r, i) => ({ stt: i + 1, ...r }))
        res.json({ success: true, data: { rows, summary: { tongDauKy: rows.reduce((s, r) => s + r.dauKyTT, 0), tongNhap: rows.reduce((s, r) => s + r.nhapTT, 0), tongXuat: rows.reduce((s, r) => s + r.xuatTT, 0), tongCuoiKy: rows.reduce((s, r) => s + r.cuoiKyTT, 0), soMatHang: rows.length }, year, month } })
    } catch (err) { console.error('GET /hkd/s2-summary:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S3: Chi tiet doanh thu, chi phi
router.get('/hkd/s3', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)
        const txOrDate: any = { OR: [{ transactionDate: { gte: start, lte: end } }, { transactionDate: null, createdAt: { gte: start, lte: end } }] }
        // Fetch transactions với items+product để tính COGS (giá vốn hàng bán)
        const [txs, expenses] = await Promise.all([
            p.transaction.findMany({ where: { status: 'completed', ...txOrDate }, include: { items: { include: { product: true } } }, orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }] }),
            p.expense.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { date: 'asc' } }),
        ])
        // Map expense category → nhóm chi phí hợp lý theo TT152/2025/TT-BTC (Điều 5)
        const catToNhom = (cat: string): { nhom: string; label: string } => {
            const c = (cat || '').toLowerCase()
            if (c === 'a' || c.includes('purchase') || c.includes('hang') || c.includes('nvl') || c.includes('material') || c.includes('hàng hóa') || c.includes('nguyên liệu')) return { nhom: 'a', label: '(a) Nguyên liệu, vật liệu, hàng hóa' }
            if (c === 'b' || c.includes('salary') || c.includes('luong') || c.includes('lương') || c.includes('bh') || c.includes('payroll') || c.includes('labor') || c.includes('nhân công')) return { nhom: 'b', label: '(b) Tiền lương, BHXH, phụ cấp' }
            if (c === 'c' || c.includes('depreciation') || c.includes('khau_hao') || c.includes('khấu hao') || c.includes('tsđ') || c.includes('asset')) return { nhom: 'c', label: '(c) Khấu hao tài sản cố định' }
            if (c === 'd' || c.includes('util') || c.includes('electric') || c.includes('dien') || c.includes('điện') || c.includes('nước') || c.includes('phone') || c.includes('internet') || c.includes('rent') || c.includes('thuê') || c.includes('ship') || c.includes('transport') || c.includes('vận chuyển') || c.includes('service') || c.includes('dịch vụ')) return { nhom: 'd', label: '(d) Dịch vụ mua ngoài' }
            if (c === 'đ' || c.includes('interest') || c.includes('loan') || c.includes('lai') || c.includes('lãi') || c.includes('vay')) return { nhom: 'đ', label: '(đ) Lãi tiền vay' }
            return { nhom: 'e', label: '(e) Chi phí khác' }
        }

        // Rows: mỗi dòng là 1 nghiệp vụ có doanhThu + chiPhi + loiNhuan + loaiChiPhi
        const rows: any[] = []
        // (1) Doanh thu + (2a) COGS — mỗi hóa đơn tạo 2 dòng: 1 dòng DT + 1 dòng giá vốn
        for (const t of txs) {
            const ngay = fmtDate(t.transactionDate || t.createdAt)
            const soChungTu = t.receiptNumber || ''
            const tenKH = t.customerName ? ' - ' + t.customerName : ''
            // Dòng doanh thu
            const dtBan = (t.subtotal || 0) - (t.discount || 0)
            rows.push({ ngay, soChungTu, dienGiai: `Bán hàng${tenKH}`, doanhThu: dtBan, chiPhi: 0, loiNhuan: dtBan, nhom: '', loaiChiPhi: 'Doanh thu' })
            // Dòng giá vốn hàng bán (COGS) = Σ quantity × costPrice của từng item
            const cogs = (t.items || []).reduce((sum: number, item: any) => {
                const gv = item.costPrice || item.product?.costPrice || 0
                return sum + (item.quantity || 0) * gv
            }, 0)
            if (cogs > 0) {
                rows.push({ ngay, soChungTu, dienGiai: `Giá vốn hàng bán${tenKH}`, doanhThu: 0, chiPhi: cogs, loiNhuan: -cogs, nhom: 'a', loaiChiPhi: '(a) Nguyên liệu, vật liệu, hàng hóa (COGS)' })
            }
        }
        // (2b-e) Chi phí từ expense → phân nhóm tự động theo category
        for (const e of expenses) {
            const { nhom, label } = catToNhom(e.category || '')
            // Parse số hóa đơn từ description: format "[INV-001] Nội dung" hoặc giữ nguyên
            const hdMatch = (e.description || '').match(/^\[([^\]]+)\]\s*(.+)$/)
            const soChungTu = hdMatch ? hdMatch[1] : `CP-${e.id.slice(-6)}`
            const dienGiai = hdMatch ? hdMatch[2] : (e.description || e.category || 'Chi phí')
            rows.push({ ngay: fmtDate(e.date), soChungTu, dienGiai, doanhThu: 0, chiPhi: e.amount || 0, loiNhuan: -(e.amount || 0), nhom, loaiChiPhi: label, expenseId: e.id })
        }

        rows.sort((a, b) => a.ngay.localeCompare(b.ngay))
        rows.forEach((r, i) => r.stt = i + 1)

        const tongDoanhThu = rows.reduce((s, r) => s + r.doanhThu, 0)
        const tongChiPhi = rows.reduce((s, r) => s + r.chiPhi, 0)

        // Tổng chi phí theo nhóm (a,b,c,d,đ,e) — để hiển thị đúng mẫu S2c-HKD
        const nhomLabels: Record<string, string> = {
            a: '(a) Nguyên liệu, vật liệu, hàng hóa',
            b: '(b) Tiền lương, BHXH, phụ cấp',
            c: '(c) Khấu hao tài sản cố định',
            d: '(d) Dịch vụ mua ngoài',
            'đ': '(đ) Lãi tiền vay',
            e: '(e) Chi phí khác',
        }
        const chiPhiTheoNhom: Record<string, { label: string; soTien: number }> = {}
        for (const [k, v] of Object.entries(nhomLabels)) chiPhiTheoNhom[k] = { label: v, soTien: 0 }
        for (const r of rows) { if (r.nhom && chiPhiTheoNhom[r.nhom]) chiPhiTheoNhom[r.nhom].soTien += r.chiPhi }

        const chenhLech = tongDoanhThu - tongChiPhi  // Dòng (3) = (1) − (2)
        const summary = {
            tongDoanhThu, tongChiPhi,
            tongLoiNhuan: chenhLech, chenhLech,
            chiPhiTheoNhom,
        }
        res.json({ success: true, data: { rows, summary, year, month } })
    } catch (err) { console.error('GET /hkd/s3:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S4: Nghia vu thue — fields phai khop voi frontend S4View
router.get('/hkd/s4', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const decls = await p.taxDeclaration.findMany({ where: { year }, orderBy: { createdAt: 'asc' } })
        const rows = decls.map((d: any, i: number) => {
            const isCnkd = d.formType === '01_CNKD'
            const doanhThu = isCnkd ? (d.cnkdRevenue || 0) : (d.ct29 || 0)
            const vatPhaiNop = isCnkd ? (d.cnkdVatAmount || 0) : (d.ct38 > 0 ? d.ct38 : 0)
            const tncnPhaiNop = isCnkd ? (d.cnkdPitAmount || 0) : 0
            const tongPhaiNop = vatPhaiNop + tncnPhaiNop
            // Tỷ lệ thuế = GTGT 1.5% + TNCN 0.5% nếu là HKD, hoặc 10% VAT nếu là DN
            const tyLeThue = isCnkd ? 2.0 : (doanhThu > 0 ? Math.round(vatPhaiNop / doanhThu * 1000) / 10 : 0)
            return {
                stt: i + 1,
                ky: d.period,
                loaiThue: isCnkd ? 'HKD (GTGT+TNCN)' : 'DN (VAT)',
                doanhThu,
                tyLeThue,
                soThue: tongPhaiNop,             // Field frontend dùng: r.soThue
                vatPhaiNop,
                tncnPhaiNop,
                tongPhaiNop,
                tongGTGT: vatPhaiNop,
                tongTNCN: tncnPhaiNop,
                daKhaiNop: d.status === 'paid' ? tongPhaiNop : 0,
                tongDaNop: d.status === 'paid' ? tongPhaiNop : 0,
                conPhaiNop: d.status !== 'paid' ? tongPhaiNop : 0,
                trangThai: d.status,
                ghiChu: d.notes || ''
            }
        })
        const summary = {
            tongGTGT: rows.reduce((s: number, r: any) => s + r.vatPhaiNop, 0),
            tongTNCN: rows.reduce((s: number, r: any) => s + r.tncnPhaiNop, 0),
            tongPhaiNop: rows.reduce((s: number, r: any) => s + r.tongPhaiNop, 0),
            tongDaNop: rows.reduce((s: number, r: any) => s + r.daKhaiNop, 0),
            tongPhatSinh: rows.reduce((s: number, r: any) => s + r.tongPhaiNop, 0),
            tongDaKhaiNop: rows.reduce((s: number, r: any) => s + r.daKhaiNop, 0),
            tongConPhaiNop: rows.reduce((s: number, r: any) => s + r.conPhaiNop, 0),
        }
        res.json({ success: true, data: { rows, summary, year } })
    } catch (err) { console.error('GET /hkd/s4:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S5: Luong — su dung PayrollRecord neu co, fallback sang User.salary
router.get('/hkd/s5', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)

        // Ưu tiên dùng PayrollRecord
        let payrollRecords: any[] = []
        try {
            payrollRecords = await p.payrollRecord.findMany({
                where: { year, ...(month ? { month } : {}) },
                orderBy: { employeeName: 'asc' },
            })
        } catch (_) { }

        let rows: any[]
        if (payrollRecords.length > 0) {
            // Dùng PayrollRecord — trả về field giống usePayrollAccounting
            rows = payrollRecords.map((r: any, i: number) => {
                const gross = r.actualGross || r.grossSalary || 0
                const bhxh = r.bhxh_emp || r.bhxhEmployee || Math.round(gross * 0.08)
                const bhyt = r.bhyt_emp || r.bhytEmployee || Math.round(gross * 0.015)
                const bhtn = r.bhtn_emp || r.bhtnEmployee || Math.round(gross * 0.01)
                const tncn = r.pit || r.pitAmount || 0
                const net = r.netSalary || (gross - bhxh - bhyt - bhtn - tncn)
                return {
                    stt: i + 1,
                    maNV: (r.employeeId || '').slice(-6).toUpperCase(),
                    tenNV: r.employeeName || '',
                    chucVu: r.department || r.position || '',
                    luongCB: gross,
                    phuCap: r.allowances || 0,
                    khauTru: r.deductions || 0,
                    thuNhapThucTe: gross + (r.allowances || 0) - (r.deductions || 0),
                    bhxh, bhyt, bhtn, tncn,
                    luongThucLanh: net,
                    // Legacy aliases
                    luongCoBan: gross,
                    bhxhNLD: bhxh + bhyt + bhtn,
                    luongThucLinh: net,
                }
            })
        } else {
            // Fallback: User.salary
            const employees = await p.user.findMany({ where: { role: { not: 'customer' } } }).catch(() => [])
            const monthsInPeriod = month ? 1 : 12
            rows = employees.filter((e: any) => (e.salary || 0) > 0).map((emp: any, i: number) => {
                const gross = (emp.salary || 0) * monthsInPeriod
                const bhxh = Math.round(gross * 0.08)
                const bhyt = Math.round(gross * 0.015)
                const bhtn = Math.round(gross * 0.01)
                const tncn = 0
                const net = gross - bhxh - bhyt - bhtn
                return {
                    stt: i + 1,
                    maNV: emp.id.slice(-6).toUpperCase(),
                    tenNV: emp.name || emp.username || '',
                    chucVu: emp.role || '',
                    luongCB: gross, phuCap: 0, khauTru: 0,
                    thuNhapThucTe: gross,
                    bhxh, bhyt, bhtn, tncn,
                    luongThucLanh: net,
                    luongCoBan: gross,
                    bhxhNLD: bhxh + bhyt + bhtn,
                    luongThucLinh: net,
                }
            })
        }

        const summary = {
            tongLuong: rows.reduce((s: number, r: any) => s + r.luongCB, 0),
            tongBH: rows.reduce((s: number, r: any) => s + r.bhxh + r.bhyt + r.bhtn, 0),
            tongTNCN: rows.reduce((s: number, r: any) => s + r.tncn, 0),
            tongThucLinh: rows.reduce((s: number, r: any) => s + r.luongThucLanh, 0),
            // Legacy aliases
            tongLuongCoBan: rows.reduce((s: number, r: any) => s + r.luongCB, 0),
            tongLuongThucLinh: rows.reduce((s: number, r: any) => s + r.luongThucLanh, 0),
            soNhanVien: rows.length,
        }
        res.json({ success: true, data: { rows, summary, year, month } })
    } catch (err) { console.error('GET /hkd/s5:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ═══ Bank Account CRUD ═══════════════════════════════════════════════════════
router.get('/hkd/bank-accounts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const accounts = await p.bankAccount.findMany({ orderBy: { createdAt: 'asc' } })
        res.json({ success: true, data: accounts })
    } catch (err) { console.error('GET /bank-accounts:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})
router.post('/hkd/bank-accounts', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { bankName, accountNumber, accountName, isDefault } = req.body
        if (!bankName?.trim() || !accountNumber?.trim()) return res.status(400).json({ success: false, error: 'Tên NH và số TK bắt buộc' })
        if (isDefault) await p.bankAccount.updateMany({ data: { isDefault: false } })
        const acc = await p.bankAccount.create({ data: { bankName: bankName.trim(), accountNumber: accountNumber.trim(), accountName: accountName?.trim() || null, isDefault: !!isDefault } })
        res.status(201).json({ success: true, data: acc })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})
router.put('/hkd/bank-accounts/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { bankName, accountNumber, accountName, isDefault } = req.body
        if (isDefault) await p.bankAccount.updateMany({ data: { isDefault: false } })
        const acc = await p.bankAccount.update({ where: { id: req.params.id }, data: { bankName, accountNumber, accountName, isDefault: !!isDefault } })
        res.json({ success: true, data: acc })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})
router.delete('/hkd/bank-accounts/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        await p.bankAccount.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ═══ Bank Transaction CRUD ═══════════════════════════════════════════════════
router.get('/hkd/bank-transactions', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)
        const txs = await p.bankTransaction.findMany({ where: { date: { gte: start, lte: end } }, include: { bankAccount: true }, orderBy: { date: 'asc' } })
        res.json({ success: true, data: txs })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})
router.post('/hkd/bank-transactions', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { bankAccountId, type, amount, description, reference, date } = req.body
        if (!description?.trim()) return res.status(400).json({ success: false, error: 'Diễn giải bắt buộc' })
        if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, error: 'Số tiền phải > 0' })
        const tx = await p.bankTransaction.create({ data: { bankAccountId: bankAccountId || null, type: type || 'deposit', amount: Number(amount), description: description.trim(), reference: reference?.trim() || null, date: date ? new Date(date) : new Date() } })
        res.status(201).json({ success: true, data: tx })
    } catch (err) { console.error('POST /bank-transactions:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})
router.put('/hkd/bank-transactions/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { bankAccountId, type, amount, description, reference, date } = req.body
        const tx = await p.bankTransaction.update({ where: { id: req.params.id }, data: { bankAccountId: bankAccountId || null, type, amount: Number(amount), description: description?.trim(), reference: reference?.trim() || null, ...(date && { date: new Date(date) }) } })
        res.json({ success: true, data: tx })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})
router.delete('/hkd/bank-transactions/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        await p.bankTransaction.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S6: Sổ chi tiết tiền (S2e) — Tiền mặt auto, Tiền gửi từ BankTransaction
router.get('/hkd/s6', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)
        
        // ═══ TIỀN MẶT (auto từ POS + Expense) ═══
        // Đầu kỳ tiền mặt
        const prevTxs = await p.transaction.findMany({ where: { status: 'completed', createdAt: { lt: start } } })
        const prevExps = await p.expense.findMany({ where: { date: { lt: start } } })
        let tienMatDauKy = 0
        for (const t of prevTxs) { if (t.paymentMethod === 'Tiền mặt') tienMatDauKy += (t.totalAmount || 0) }
        for (const e of prevExps) {
            if (e.paidBy !== 'Tiền mặt') continue
            tienMatDauKy += e.category === 'hkd_cash_thu' ? (e.amount||0) : -(e.amount||0)
        }
        // Giao dịch tiền mặt trong kỳ
        const txs = await p.transaction.findMany({ where: { status: 'completed', createdAt: { gte: start, lte: end } }, orderBy: { createdAt: 'asc' } })
        const expenses = await p.expense.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { date: 'asc' } })
        const tmEvents: any[] = []
        for (const t of txs) {
            if (t.paymentMethod !== 'Tiền mặt') continue
            tmEvents.push({ id: t.id, rawDate: t.transactionDate || t.createdAt, soChungTu: t.receiptNumber || `HD-${t.id.slice(-6)}`, dienGiai: `Thu tiền bán hàng - ${t.customerName || 'Khách lẻ'}`, thu: t.totalAmount, chi: 0, isManual: false })
        }
        for (const e of expenses) {
            if (e.paidBy !== 'Tiền mặt') continue
            const isThu = e.category === 'hkd_cash_thu'
            const hdMatch = (e.description || '').match(/^\[([^\]]+)\]\s*(.+)$/)
            tmEvents.push({ id: e.id, rawDate: e.date, soChungTu: hdMatch ? hdMatch[1] : (isThu ? `THU-${e.id.slice(-6)}` : `CHI-${e.id.slice(-6)}`), dienGiai: hdMatch ? hdMatch[2] : (e.description || ''), thu: isThu ? e.amount : 0, chi: isThu ? 0 : e.amount, isManual: ['hkd_cash_thu','hkd_cash_chi'].includes(e.category) })
        }
        tmEvents.sort((a, b) => new Date(a.rawDate).getTime() - new Date(b.rawDate).getTime())
        const tienMatRows: any[] = []; let tmBal = tienMatDauKy, tmThu = 0, tmChi = 0, sttTM = 1
        for (const e of tmEvents) {
            tmBal += e.thu - e.chi; tmThu += e.thu; tmChi += e.chi
            tienMatRows.push({ ...e, ngay: fmtDate(e.rawDate), tonCuoi: tmBal, stt: sttTM++ })
        }

        // ═══ TIỀN GỬI (từ BankTransaction — nhập tay) ═══
        let tienGuiDauKy = 0
        try {
            const prevBankTxs = await p.bankTransaction.findMany({ where: { date: { lt: start } } })
            for (const bt of prevBankTxs) { tienGuiDauKy += bt.type === 'deposit' ? bt.amount : -bt.amount }
        } catch (_) { /* BankTransaction table may not exist yet */ }

        const tienGuiRows: any[] = []; let tgBal = tienGuiDauKy, tgThu = 0, tgChi = 0, sttTG = 1
        try {
            const bankTxs = await p.bankTransaction.findMany({ where: { date: { gte: start, lte: end } }, include: { bankAccount: true }, orderBy: { date: 'asc' } })
            for (const bt of bankTxs) {
                const isDep = bt.type === 'deposit'
                const thu = isDep ? bt.amount : 0, chi = isDep ? 0 : bt.amount
                tgBal += thu - chi; tgThu += thu; tgChi += chi
                tienGuiRows.push({ id: bt.id, stt: sttTG++, ngay: fmtDate(bt.date), soChungTu: bt.reference || '', dienGiai: bt.description, thu, chi, tonCuoi: tgBal, isManual: true, bankName: bt.bankAccount?.bankName || '' })
            }
        } catch (_) { /* BankTransaction table may not exist yet */ }

        res.json({ 
            success: true, 
            data: { 
                year, month,
                tienMat: { dauKy: tienMatDauKy, rows: tienMatRows, tongThu: tmThu, tongChi: tmChi, cuoiKy: tmBal },
                tienGui: { dauKy: tienGuiDauKy, rows: tienGuiRows, tongThu: tgThu, tongChi: tgChi, cuoiKy: tgBal }
            } 
        })
    } catch (err) { console.error('GET /hkd/s6:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S6 CRUD — Thêm/Sửa/Xóa entry sổ quỹ thủ công
router.post('/hkd/s6', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { ngay, soChungTu, dienGiai, thu, chi, phuongThucTT } = req.body
        if (!dienGiai?.trim()) return res.status(400).json({ success: false, error: 'Diễn giải bắt buộc' })
        const isThu = !!(thu && Number(thu) > 0)
        const amount = isThu ? Number(thu) : Number(chi)
        if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Số tiền phải > 0' })
        // Format description = [soChungTu] dienGiai nếu có số CT
        const description = soChungTu?.trim() ? `[${soChungTu.trim()}] ${dienGiai.trim()}` : dienGiai.trim()
        const entry = await p.expense.create({
            data: { description, amount, category: isThu ? 'hkd_cash_thu' : 'hkd_cash_chi', paidBy: phuongThucTT || 'Tiền mặt', date: ngay ? new Date(ngay) : new Date(), recurring: false }
        })
        res.status(201).json({ success: true, data: entry })
    } catch (err) { console.error('POST /hkd/s6:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

router.put('/hkd/s6/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const { ngay, soChungTu, dienGiai, thu, chi, phuongThucTT } = req.body
        const isThu = !!(thu && Number(thu) > 0)
        const amount = isThu ? Number(thu) : Number(chi)
        const description = soChungTu?.trim() ? `[${soChungTu.trim()}] ${dienGiai.trim()}` : dienGiai.trim()
        const entry = await p.expense.update({
            where: { id: req.params.id },
            data: { description, amount, category: isThu ? 'hkd_cash_thu' : 'hkd_cash_chi', paidBy: phuongThucTT || 'Tiền mặt', ...(ngay && { date: new Date(ngay) }) }
        })
        res.json({ success: true, data: entry })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

router.delete('/hkd/s6/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        await p.expense.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// S7: Nhat ky thu chi tien gui ngan hang — fix Promise.all
router.get('/hkd/s7', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const p = req.storePrisma! as any
        const year = Number(req.query.year) || new Date().getFullYear()
        const month = req.query.month ? Number(req.query.month) : undefined
        const { start, end } = hkdDateRange(year, month)
        const txOrDate7 = { OR: [{ transactionDate: { gte: start, lte: end } }, { transactionDate: null, createdAt: { gte: start, lte: end } }] }
        const BANK_KEYWORDS = ['bank','transfer','banking','chuyen_khoan','momo','vnpay','zalopay','atm','Bank','Transfer']
        const [allTxs, allExp] = await Promise.all([
            p.transaction.findMany({ where: { status: 'completed', ...txOrDate7 }, orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }] }),
            p.expense.findMany({ where: { date: { gte: start, lte: end }, paidBy: { in: BANK_KEYWORDS } }, orderBy: { date: 'asc' } }),
        ])
        const bankTxs = allTxs.filter((t: any) => BANK_KEYWORDS.includes((t.paymentMethod || '').toLowerCase()))
        const items = [
            ...bankTxs.map((t: any) => ({ ngay: fmtDate(t.transactionDate || t.createdAt), soChungTu: t.receiptNumber || '', dienGiai: `Thu - ${t.customerName || 'Khách'}`, thu: t.total || 0, chi: 0, phuongThucTT: t.paymentMethod || 'bank' })),
            ...allExp.map((e: any) => ({ ngay: fmtDate(e.date), soChungTu: `CP-${e.id.slice(-6)}`, dienGiai: e.description || e.category || 'Chi', thu: 0, chi: e.amount || 0, phuongThucTT: e.paidBy || 'bank' })),
        ].sort((a, b) => a.ngay.localeCompare(b.ngay))
        let balance = 0
        const rows = items.map((item, i) => { balance += item.thu - item.chi; return { stt: i + 1, ...item, tonCuoi: balance } })
        res.json({ success: true, data: { rows, summary: { tongThu: rows.reduce((s, r) => s + r.thu, 0), tongChi: rows.reduce((s, r) => s + r.chi, 0), tonCuoiKy: balance }, year, month } })
    } catch (err) { console.error('GET /hkd/s7:', err); res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// ─── Z-REPORTS (Báo cáo Z — chốt ca cuối ngày POS) ───────────────────────────

// Normalize an arbitrary date string/Date into midnight UTC of that calendar day.
// Used as the canonical key on ZReport so (registerId, date) uniqueness fires
// regardless of what time-of-day the client sends.
function zReportDayKey(input: any): Date | null {
    if (!input) return null
    const d = input instanceof Date ? input : new Date(String(input))
    if (isNaN(d.getTime())) return null
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// GET /api/tax/z-reports/calculate?date=YYYY-MM-DD&registerId=...
// Computes Z-Report figures from POS transactions for the given day.
// Returns calculated values for the frontend to review before persisting.
// NOTE: Transaction has no registerId column today, so `registerId` is echoed
// back but does not filter the orders query — date + branch isolation only.
router.get('/z-reports/calculate', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const dateStr = req.query.date as string | undefined
        const registerId = (req.query.registerId as string | undefined) || ''
        const day = zReportDayKey(dateStr)
        if (!day) return res.status(400).json({ success: false, error: 'date là bắt buộc (YYYY-MM-DD)' })
        const dayStart = day
        const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1)

        const branchFilter = getBranchFilter(req as any)
        // Transactions for the day: prefer transactionDate, fall back to createdAt
        const txWhere: any = {
            status: 'completed',
            OR: [
                { transactionDate: { gte: dayStart, lte: dayEnd } },
                { transactionDate: null, createdAt: { gte: dayStart, lte: dayEnd } },
            ],
            ...branchFilter,
        }
        const txs = await prisma.transaction.findMany({
            where: txWhere,
            include: { payments: true },
        })

        let totalSales = 0
        let totalDiscounts = 0
        let cashSales = 0
        let cardSales = 0
        for (const tx of txs) {
            totalSales += Number(tx.total) || 0
            totalDiscounts += Number(tx.discount) || 0
            for (const p of (tx.payments || [])) {
                const t = String(p.type || '').toLowerCase()
                const amt = Number(p.amount) || 0
                if (t === 'cash' || t === 'tiền mặt') cashSales += amt
                else if (t === 'card' || t === 'credit_card' || t === 'debit_card' || t === 'pos') cardSales += amt
            }
        }

        // Returns: ReturnOrder refunded/processed during the day
        const returns = await prisma.returnOrder.findMany({
            where: {
                status: { in: ['refunded', 'approved', 'processing', 'exchanged'] },
                OR: [
                    { refundedAt: { gte: dayStart, lte: dayEnd } },
                    { processedAt: { gte: dayStart, lte: dayEnd } },
                    { refundedAt: null, processedAt: null, createdAt: { gte: dayStart, lte: dayEnd } },
                ],
                ...branchFilter,
            },
        })
        const totalReturns = returns.reduce((s: number, r: any) => s + (Number(r.totalRefund || r.refundAmount) || 0), 0)
        const netSales = totalSales - totalReturns - totalDiscounts

        res.json({
            success: true,
            data: {
                date: dateStr,
                registerId,
                cashSales,
                cardSales,
                totalSales,
                totalReturns,
                totalDiscounts,
                netSales,
                transactionCount: txs.length,
                returnCount: returns.length,
            },
        })
    } catch (err) {
        console.error('GET /z-reports/calculate error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/tax/z-reports?from=&to=&registerId=
router.get('/z-reports', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const from = req.query.from ? zReportDayKey(req.query.from) : null
        const to = req.query.to ? zReportDayKey(req.query.to) : null
        const registerId = req.query.registerId as string | undefined

        const where: any = { ...getBranchFilter(req as any) }
        if (from || to) {
            where.date = {}
            if (from) where.date.gte = from
            if (to) where.date.lte = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1)
        }
        if (registerId) where.registerId = registerId

        const data = await prisma.zReport.findMany({ where, orderBy: { date: 'desc' } })
        res.json({ success: true, data })
    } catch (err) {
        console.error('GET /z-reports error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// GET /api/tax/z-reports/:id
router.get('/z-reports/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
        const data = await prisma.zReport.findFirst({ where: { id, ...getBranchFilter(req as any) } })
        if (!data) return res.status(404).json({ success: false, error: 'Z-Report not found' })
        res.json({ success: true, data })
    } catch (err) {
        console.error('GET /z-reports/:id error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// POST /api/tax/z-reports
router.post('/z-reports', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const {
            date, registerId,
            cashStart, cashEnd, cashSales, cardSales,
            totalSales, totalReturns, totalDiscounts, netSales, cashDifference,
            notes,
        } = req.body

        if (!date) return res.status(400).json({ success: false, error: 'date là bắt buộc' })
        if (!registerId?.toString().trim()) return res.status(400).json({ success: false, error: 'registerId là bắt buộc' })
        const day = zReportDayKey(date)
        if (!day) return res.status(400).json({ success: false, error: 'date không hợp lệ' })

        const regId = registerId.toString().trim()
        const existing = await prisma.zReport.findFirst({ where: { registerId: regId, date: day } })
        if (existing) {
            return res.status(409).json({
                success: false,
                error: `Đã có Z-Report cho máy ${regId} ngày ${day.toISOString().slice(0, 10)}`,
                data: existing,
            })
        }

        const num = (v: any) => Number(v) || 0
        const created = await prisma.zReport.create({
            data: {
                date: day,
                registerId: regId,
                cashStart: num(cashStart),
                cashEnd: num(cashEnd),
                cashSales: num(cashSales),
                cardSales: num(cardSales),
                totalSales: num(totalSales),
                totalReturns: num(totalReturns),
                totalDiscounts: num(totalDiscounts),
                netSales: num(netSales),
                cashDifference: num(cashDifference),
                notes: notes || null,
                branchId: getBranchId(req as any) || null,
                createdBy: req.user?.userId || null,
            },
        })
        res.status(201).json({ success: true, data: created })
    } catch (err) {
        console.error('POST /z-reports error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
