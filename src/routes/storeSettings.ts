import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { registryPrisma } from '../lib/prisma'
import { cacheGet, cacheSet, cacheDel } from '../lib/cache'

const router = Router()

const DEFAULT_SHIFT_CONFIG = {
    morning: { start: '08:00', end: '14:00' },
    afternoon: { start: '14:00', end: '20:00' },
    evening: { start: '20:00', end: '23:00' },
}

// GET /api/store-settings
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const schema = req.user?.storeSchema || 'default'
        const cacheKey = `${schema}:storeSettings:${JSON.stringify(req.query)}`
        const cached = await cacheGet(cacheKey)
        if (cached) return res.json(cached)
        const prisma = req.storePrisma!
        const store = await prisma.storeSettings.findFirst() as any
        let shiftConfig = DEFAULT_SHIFT_CONFIG
        if (store?.shiftConfig) {
            try { shiftConfig = JSON.parse(store.shiftConfig) } catch { /* use default */ }
        }
        // Get plan info from registry
        let plan = 'full'
        let addOns: string[] = []
        let extraBranches = 0
        try {
            const storeCode = req.user?.storeCode
            if (storeCode) {
                const regStore = await registryPrisma.store.findUnique({ where: { code: storeCode } }) as any
                if (regStore) {
                    plan = regStore.plan || 'full'
                    try { addOns = JSON.parse(regStore.addOns || '[]') } catch { addOns = [] }
                    extraBranches = regStore.extraBranches || 0
                }
            }
        } catch { /* ignore */ }

        // Count current branches
        let branchCount = 0
        try {
            branchCount = await prisma.branch.count()
        } catch { /* branch table might not exist */ }

        res.json({
            success: true,
            data: {
                name: store?.name || '',
                address: store?.address || '',
                phone: store?.phone || '',
                logo: store?.logo || '',
                costPriceMethod: store?.costPriceMethod || 'fixed',
                trackSerial: store?.trackSerial ?? false,
                trackBatch: store?.trackBatch ?? false,
                allowNegativeStock: store?.allowNegativeStock ?? false,
                shiftConfig,
                notifyLowStock: store?.notifyLowStock ?? true,
                notifyNewOrder: store?.notifyNewOrder ?? true,
                notifyDailyReport: store?.notifyDailyReport ?? false,
                notifyWeeklyReport: store?.notifyWeeklyReport ?? true,
                openTime: store?.openTime ?? null,
                closeTime: store?.closeTime ?? null,
                dailyRevenueTarget: store?.dailyRevenueTarget ?? null,
                monthlyRevenueTarget: store?.monthlyRevenueTarget ?? null,
                dailyOrderTarget: store?.dailyOrderTarget ?? null,
                plan,
                addOns,
                extraBranches,
                branchCount,
            },
        })
    } catch (err) {
        console.error('Get store settings error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

// PUT /api/store-settings
router.put('/', authMiddleware, requireRole('admin'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { name, address, phone, logo, costPriceMethod, trackSerial, trackBatch, allowNegativeStock, shiftConfig,
            notifyLowStock, notifyNewOrder, notifyDailyReport, notifyWeeklyReport,
            openTime, closeTime, dailyRevenueTarget, monthlyRevenueTarget, dailyOrderTarget } = req.body

        if (costPriceMethod && !['fixed', 'average', 'lastImport'].includes(costPriceMethod)) {
            res.status(400).json({ success: false, error: 'Invalid cost price method' })
            return
        }

        const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
        for (const [key, val] of [['openTime', openTime], ['closeTime', closeTime]] as const) {
            if (val !== undefined && val !== null && val !== '' && !TIME_RE.test(String(val))) {
                res.status(400).json({ success: false, error: `Invalid ${key} - expected "HH:mm"` })
                return
            }
        }

        const coerceNum = (v: any): number | null => {
            if (v === null || v === '' || v === undefined) return null
            const n = Number(v)
            return Number.isFinite(n) && n >= 0 ? n : (NaN as any)
        }
        const targetFields: Array<[string, any]> = [
            ['dailyRevenueTarget', dailyRevenueTarget],
            ['monthlyRevenueTarget', monthlyRevenueTarget],
            ['dailyOrderTarget', dailyOrderTarget],
        ]
        for (const [key, val] of targetFields) {
            if (val === undefined) continue
            const n = coerceNum(val)
            if (Number.isNaN(n)) {
                res.status(400).json({ success: false, error: `Invalid ${key} - expected non-negative number` })
                return
            }
        }

        const data: any = {}
        if (name !== undefined) data.name = name
        if (address !== undefined) data.address = address
        if (phone !== undefined) data.phone = phone
        if (logo !== undefined) data.logo = logo
        if (costPriceMethod !== undefined) data.costPriceMethod = costPriceMethod
        if (trackSerial !== undefined) data.trackSerial = Boolean(trackSerial)
        if (trackBatch !== undefined) data.trackBatch = Boolean(trackBatch)
        if (allowNegativeStock !== undefined) data.allowNegativeStock = Boolean(allowNegativeStock)
        if (shiftConfig !== undefined) data.shiftConfig = JSON.stringify(shiftConfig)
        if (notifyLowStock !== undefined) data.notifyLowStock = Boolean(notifyLowStock)
        if (notifyNewOrder !== undefined) data.notifyNewOrder = Boolean(notifyNewOrder)
        if (notifyDailyReport !== undefined) data.notifyDailyReport = Boolean(notifyDailyReport)
        if (notifyWeeklyReport !== undefined) data.notifyWeeklyReport = Boolean(notifyWeeklyReport)
        if (openTime !== undefined) data.openTime = openTime === '' ? null : openTime
        if (closeTime !== undefined) data.closeTime = closeTime === '' ? null : closeTime
        if (dailyRevenueTarget !== undefined) data.dailyRevenueTarget = coerceNum(dailyRevenueTarget)
        if (monthlyRevenueTarget !== undefined) data.monthlyRevenueTarget = coerceNum(monthlyRevenueTarget)
        if (dailyOrderTarget !== undefined) {
            const n = coerceNum(dailyOrderTarget)
            data.dailyOrderTarget = n === null ? null : Math.trunc(n)
        }

        const updated = await prisma.storeSettings.upsert({
            where: { id: 'default' },
            create: { id: 'default', name: name || 'My Store', updatedAt: new Date(), ...data },
            update: data,
        })

        let parsedShift = DEFAULT_SHIFT_CONFIG
        if (updated.shiftConfig) {
            try { parsedShift = JSON.parse(updated.shiftConfig) } catch { /* use default */ }
        }

        res.json({ success: true, data: { ...updated, shiftConfig: parsedShift } })
    } catch (err) {
        console.error('Update store settings error:', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
    }
})

export default router
