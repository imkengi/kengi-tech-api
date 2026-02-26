import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { authMiddleware } from '../middleware/auth'

const router = Router()

// GET /api/drivers
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { search, status } = req.query
        const where: any = {}
        if (status && status !== 'all') where.status = status
        if (search) { const q = String(search); where.OR = [{ name: { contains: q } }, { code: { contains: q } }, { phone: { contains: q } }] }
        const data = await prisma.driver.findMany({ where, orderBy: { createdAt: 'desc' } })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// POST /api/drivers
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, phone, vehicleType, vehiclePlate, notes } = req.body
        if (!name?.trim() || !phone?.trim()) return res.status(400).json({ success: false, error: 'Name and phone required' })
        const count = await prisma.driver.count()
        const code = `TX-${String(count + 1).padStart(3, '0')}`
        const data = await prisma.driver.create({ data: { code, name, phone, vehicleType, vehiclePlate, notes } })
        res.status(201).json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// PUT /api/drivers/:id
router.put('/:id', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { name, phone, vehicleType, vehiclePlate, status, notes } = req.body
        const d: any = {}
        if (name) d.name = name; if (phone) d.phone = phone; if (vehicleType) d.vehicleType = vehicleType
        if (vehiclePlate !== undefined) d.vehiclePlate = vehiclePlate; if (status) d.status = status; if (notes !== undefined) d.notes = notes
        const data = await prisma.driver.update({ where: { id: req.params.id }, data: d })
        res.json({ success: true, data })
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

// DELETE /api/drivers/:id
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    try { await prisma.driver.delete({ where: { id: req.params.id } }); res.json({ success: true }) }
    catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }) }
})

export default router
