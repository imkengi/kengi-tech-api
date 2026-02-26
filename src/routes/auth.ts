import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma'
import { authMiddleware, AuthRequest } from '../middleware/auth'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'open-retail-super-secret-key'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
    try {
        const { email, password, storeCode } = req.body

        if (!email || !password) {
            res.status(400).json({ success: false, error: 'Email and password required' })
            return
        }

        // If storeCode provided, find the store first
        let storeId: string | null = null
        let store: any = null
        if (storeCode) {
            store = await prisma.store.findUnique({ where: { code: storeCode } })
            if (!store) {
                res.status(401).json({ success: false, error: 'Mã cửa hàng không tồn tại' })
                return
            }
            if (store.status !== 'active') {
                res.status(401).json({ success: false, error: 'Cửa hàng đã bị vô hiệu hóa' })
                return
            }
            storeId = store.id
        }

        // Find user by email (and optionally by storeId)
        const user = storeId
            ? await prisma.user.findFirst({ where: { email, storeId } })
            : await prisma.user.findFirst({ where: { email } })

        if (!user) {
            res.status(401).json({ success: false, error: 'Email hoặc mật khẩu không đúng' })
            return
        }

        const valid = await bcrypt.compare(password, user.password)
        if (!valid) {
            res.status(401).json({ success: false, error: 'Email hoặc mật khẩu không đúng' })
            return
        }

        // Get the user's store if not already loaded
        if (!store && user.storeId) {
            store = await prisma.store.findUnique({ where: { id: user.storeId } })
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role, storeId: user.storeId },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        )

        res.json({
            success: true,
            data: {
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    phone: user.phone,
                    avatar: user.avatar,
                },
                store: store ? {
                    id: store.id,
                    code: store.code,
                    name: store.name,
                    address: store.address,
                    phone: store.phone,
                    logo: store.logo,
                } : null,
            },
        })
    } catch (err: any) {
        console.error('Login error:', err?.message || err)
        console.error('Login error stack:', err?.stack)
        console.error('Login error code:', err?.code)
        res.status(500).json({ success: false, error: 'Internal server error', detail: err?.message })
    }
})

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
            select: { id: true, email: true, name: true, role: true, phone: true, avatar: true, storeId: true },
        })

        if (!user) {
            res.status(404).json({ success: false, error: 'User not found' })
            return
        }

        let store = null
        if (user.storeId) {
            store = await prisma.store.findUnique({
                where: { id: user.storeId },
                select: { id: true, code: true, name: true, address: true, phone: true, logo: true },
            })
        }

        res.json({ success: true, data: { ...user, store } })
    } catch (err) {
        console.error('Get me error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
