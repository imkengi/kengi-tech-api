import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { errMsg } from '../lib/errorResponse'

// CRM (kengi.vn/crm) — công việc, cơ hội bán hàng (pipeline), nhật ký hoạt động,
// thông báo và số liệu tổng quan. Trước đây các mảng này chỉ nằm ở localStorage
// của trình duyệt nên mỗi máy một dữ liệu; nay lưu ở DB cửa hàng để cả đội dùng
// chung. Mount cùng tiền tố /api/crm với crmEmail.ts.

const router = Router()

const TASK_STATUS = ['todo', 'doing', 'done']
const TASK_PRIORITY = ['low', 'medium', 'high']
const DEAL_STAGES = ['lead', 'contact', 'demo', 'negotiate', 'won', 'lost']

function toDate(v: any): Date | null {
    if (!v) return null
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
}

// Tên khách để hiển thị: client thường chỉ gửi customerId. Tra tên một lần khi
// ghi để danh sách/thông báo không phải join lại mỗi lần đọc.
async function resolveCustomerName(prisma: any, customerId?: string | null, given?: string | null) {
    if (given) return given
    if (!customerId) return null
    try {
        const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } })
        return c?.name || null
    } catch { return null }
}

// Ghi nhật ký — không được làm hỏng thao tác chính nếu lỗi
async function writeActivity(prisma: any, req: AuthRequest, entry: {
    module: string; action: string; description: string
    entityId?: string | null; entityName?: string | null; metadata?: any
}) {
    try {
        await prisma.crmActivity.create({
            data: {
                module: entry.module,
                action: entry.action,
                description: entry.description,
                userId: req.user?.userId || null,
                userName: (req.user as any)?.fullName || (req.user as any)?.name || (req.user as any)?.username || null,
                entityId: entry.entityId || null,
                entityName: entry.entityName || null,
                metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
            },
        })
    } catch { /* nhật ký hỏng không được chặn nghiệp vụ */ }
}

// ─── Công việc ────────────────────────────────────────────────────────────────

// GET /api/crm/tasks?status=&customerId=&assignee=&limit=
router.get('/tasks', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { status, customerId, assignee } = req.query as Record<string, string>
        const where: any = {}
        if (status && TASK_STATUS.includes(status)) where.status = status
        if (customerId) where.customerId = customerId
        if (assignee) where.assignee = assignee
        const limit = Math.min(Number(req.query.limit) || 500, 1000)
        const tasks = await prisma.crmTask.findMany({
            where,
            orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
            take: limit,
        })
        res.json({ success: true, data: tasks })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// POST /api/crm/tasks
router.post('/tasks', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        if (!String(b.title || '').trim()) return res.status(400).json({ success: false, error: 'Thiếu tiêu đề công việc' })
        const status = TASK_STATUS.includes(b.status) ? b.status : 'todo'
        const task = await prisma.crmTask.create({
            data: {
                title: String(b.title).trim(),
                description: b.description ? String(b.description) : null,
                customerId: b.customerId || null,
                customerName: await resolveCustomerName(prisma, b.customerId, b.customerName),
                status,
                priority: TASK_PRIORITY.includes(b.priority) ? b.priority : 'medium',
                type: b.type || null,
                dueDate: toDate(b.dueDate),
                assignee: b.assignee || null,
                createdBy: (req.user as any)?.fullName || req.user?.userId || null,
                completedAt: status === 'done' ? new Date() : null,
            },
        })
        await writeActivity(prisma, req, {
            module: 'tasks', action: 'task.created',
            description: `Tạo công việc "${task.title}"${task.customerName ? ` — ${task.customerName}` : ''}`,
            entityId: task.id, entityName: task.title,
        })
        res.status(201).json({ success: true, data: task })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// PUT /api/crm/tasks/:id
router.put('/tasks/:id', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        const old = await prisma.crmTask.findUnique({ where: { id: String(req.params.id) } })
        if (!old) return res.status(404).json({ success: false, error: 'Không tìm thấy công việc' })

        const data: any = {}
        if (b.title !== undefined) data.title = String(b.title).trim()
        if (b.description !== undefined) data.description = b.description || null
        if (b.customerId !== undefined) {
            data.customerId = b.customerId || null
            // đổi khách thì tên hiển thị phải theo — nếu client không gửi kèm tên
            if (b.customerName === undefined) data.customerName = await resolveCustomerName(prisma, b.customerId, null)
        }
        if (b.customerName !== undefined) data.customerName = b.customerName || null
        if (b.status !== undefined && TASK_STATUS.includes(b.status)) {
            data.status = b.status
            data.completedAt = b.status === 'done' ? (old.completedAt || new Date()) : null
        }
        if (b.priority !== undefined && TASK_PRIORITY.includes(b.priority)) data.priority = b.priority
        if (b.type !== undefined) data.type = b.type || null
        if (b.dueDate !== undefined) data.dueDate = toDate(b.dueDate)
        if (b.assignee !== undefined) data.assignee = b.assignee || null

        const task = await prisma.crmTask.update({ where: { id: String(req.params.id) }, data })
        if (data.status && data.status !== old.status) {
            const label: Record<string, string> = { todo: 'Cần làm', doing: 'Đang làm', done: 'Hoàn thành' }
            await writeActivity(prisma, req, {
                module: 'tasks', action: 'task.status',
                description: `Công việc "${task.title}" → ${label[task.status] || task.status}`,
                entityId: task.id, entityName: task.title,
            })
        }
        res.json({ success: true, data: task })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// DELETE /api/crm/tasks/:id
router.delete('/tasks/:id', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const task = await prisma.crmTask.findUnique({ where: { id: String(req.params.id) } })
        if (!task) return res.status(404).json({ success: false, error: 'Không tìm thấy công việc' })
        await prisma.crmTask.delete({ where: { id: String(req.params.id) } })
        await writeActivity(prisma, req, {
            module: 'tasks', action: 'task.deleted',
            description: `Xoá công việc "${task.title}"`, entityId: task.id, entityName: task.title,
        })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// ─── Cơ hội bán hàng (pipeline) ───────────────────────────────────────────────

// GET /api/crm/deals?stage=&customerId=
router.get('/deals', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { stage, customerId } = req.query as Record<string, string>
        const where: any = {}
        if (stage && DEAL_STAGES.includes(stage)) where.stage = stage
        if (customerId) where.customerId = customerId
        const deals = await prisma.crmDeal.findMany({
            where,
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
            take: Math.min(Number(req.query.limit) || 500, 1000),
        })
        res.json({ success: true, data: deals })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// POST /api/crm/deals
router.post('/deals', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        if (!String(b.title || '').trim()) return res.status(400).json({ success: false, error: 'Thiếu tên cơ hội' })
        const stage = DEAL_STAGES.includes(b.stage) ? b.stage : 'lead'
        const deal = await prisma.crmDeal.create({
            data: {
                title: String(b.title).trim(),
                customerId: b.customerId || null,
                customerName: await resolveCustomerName(prisma, b.customerId, b.customerName),
                value: Number(b.value) || 0,
                stage,
                probability: Math.max(0, Math.min(100, Number(b.probability) || 0)),
                assignee: b.assignee || null,
                note: b.note || null,
                sortOrder: Number(b.sortOrder) || 0,
                expectedCloseDate: toDate(b.expectedCloseDate),
                closedAt: stage === 'won' || stage === 'lost' ? new Date() : null,
                createdBy: (req.user as any)?.fullName || req.user?.userId || null,
            },
        })
        await writeActivity(prisma, req, {
            module: 'pipeline', action: 'deal.created',
            description: `Tạo cơ hội "${deal.title}"${deal.value ? ` — ${deal.value.toLocaleString('vi-VN')}đ` : ''}`,
            entityId: deal.id, entityName: deal.title,
        })
        res.status(201).json({ success: true, data: deal })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// PUT /api/crm/deals/:id
router.put('/deals/:id', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        const old = await prisma.crmDeal.findUnique({ where: { id: String(req.params.id) } })
        if (!old) return res.status(404).json({ success: false, error: 'Không tìm thấy cơ hội' })

        const data: any = {}
        if (b.title !== undefined) data.title = String(b.title).trim()
        if (b.customerId !== undefined) {
            data.customerId = b.customerId || null
            if (b.customerName === undefined) data.customerName = await resolveCustomerName(prisma, b.customerId, null)
        }
        if (b.customerName !== undefined) data.customerName = b.customerName || null
        if (b.value !== undefined) data.value = Number(b.value) || 0
        if (b.stage !== undefined && DEAL_STAGES.includes(b.stage)) {
            data.stage = b.stage
            data.closedAt = (b.stage === 'won' || b.stage === 'lost') ? (old.closedAt || new Date()) : null
        }
        if (b.probability !== undefined) data.probability = Math.max(0, Math.min(100, Number(b.probability) || 0))
        if (b.assignee !== undefined) data.assignee = b.assignee || null
        if (b.note !== undefined) data.note = b.note || null
        if (b.sortOrder !== undefined) data.sortOrder = Number(b.sortOrder) || 0
        if (b.expectedCloseDate !== undefined) data.expectedCloseDate = toDate(b.expectedCloseDate)

        const deal = await prisma.crmDeal.update({ where: { id: String(req.params.id) }, data })
        if (data.stage && data.stage !== old.stage) {
            const label: Record<string, string> = {
                lead: 'Tiềm năng', contact: 'Đã liên hệ', demo: 'Demo/Báo giá',
                negotiate: 'Đàm phán', won: 'Chốt thành công', lost: 'Thất bại',
            }
            await writeActivity(prisma, req, {
                module: 'pipeline', action: 'deal.stage',
                description: `Cơ hội "${deal.title}" → ${label[deal.stage] || deal.stage}`,
                entityId: deal.id, entityName: deal.title,
            })
        }
        res.json({ success: true, data: deal })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// DELETE /api/crm/deals/:id
router.delete('/deals/:id', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const deal = await prisma.crmDeal.findUnique({ where: { id: String(req.params.id) } })
        if (!deal) return res.status(404).json({ success: false, error: 'Không tìm thấy cơ hội' })
        await prisma.crmDeal.delete({ where: { id: String(req.params.id) } })
        await writeActivity(prisma, req, {
            module: 'pipeline', action: 'deal.deleted',
            description: `Xoá cơ hội "${deal.title}"`, entityId: deal.id, entityName: deal.title,
        })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// ─── Nhật ký hoạt động ────────────────────────────────────────────────────────

// GET /api/crm/activities?module=&limit=
router.get('/activities', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { module: mod, entityId } = req.query as Record<string, string>
        const where: any = {}
        if (mod && mod !== 'all') where.module = mod
        if (entityId) where.entityId = entityId
        const list = await prisma.crmActivity.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: Math.min(Number(req.query.limit) || 200, 500),
        })
        res.json({ success: true, data: list })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// POST /api/crm/activities — cho FE ghi nhật ký các thao tác không đi qua route này
router.post('/activities', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        if (!b.module || !b.action || !b.description) {
            return res.status(400).json({ success: false, error: 'Thiếu module/action/description' })
        }
        await writeActivity(prisma, req, {
            module: String(b.module), action: String(b.action), description: String(b.description),
            entityId: b.entityId, entityName: b.entityName, metadata: b.metadata,
        })
        res.status(201).json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// ─── Nhật ký Zalo ─────────────────────────────────────────────────────────────

// GET /api/crm/zalo?customerId=
router.get('/zalo', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { customerId } = req.query as Record<string, string>
        const list = await prisma.crmZaloLog.findMany({
            where: customerId ? { customerId } : {},
            orderBy: { createdAt: 'asc' },
            take: Math.min(Number(req.query.limit) || 500, 2000),
        })
        res.json({ success: true, data: list })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// POST /api/crm/zalo
router.post('/zalo', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        if (!b.customerId) return res.status(400).json({ success: false, error: 'Thiếu khách hàng' })
        if (!String(b.content || '').trim()) return res.status(400).json({ success: false, error: 'Thiếu nội dung' })
        const msg = await prisma.crmZaloLog.create({
            data: {
                customerId: String(b.customerId),
                customerName: await resolveCustomerName(prisma, b.customerId, b.customerName),
                direction: b.direction === 'in' ? 'in' : 'out',
                content: String(b.content).trim(),
                staffName: (req.user as any)?.fullName || null,
                starred: !!b.starred,
            },
        })
        res.status(201).json({ success: true, data: msg })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// PUT /api/crm/zalo/:id — hiện chỉ dùng để gắn/bỏ sao
router.put('/zalo/:id', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        const data: any = {}
        if (b.starred !== undefined) data.starred = !!b.starred
        if (b.content !== undefined) data.content = String(b.content)
        const msg = await prisma.crmZaloLog.update({ where: { id: String(req.params.id) }, data })
        res.json({ success: true, data: msg })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// DELETE /api/crm/zalo/:id
router.delete('/zalo/:id', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        await req.storePrisma!.crmZaloLog.delete({ where: { id: String(req.params.id) } })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// ─── Chiến dịch chăm sóc ──────────────────────────────────────────────────────

const CAMPAIGN_STATUS = ['draft', 'scheduled', 'sending', 'sent', 'completed']
const CAMPAIGN_CHANNEL = ['email', 'zalo', 'sms']

// targetTiers lưu JSON trong DB nhưng client dùng mảng — quy đổi ở biên
function outCampaign(c: any) {
    let tiers: string[] = []
    try { tiers = JSON.parse(c.targetTiers || '[]') } catch { tiers = [] }
    return { ...c, targetTiers: Array.isArray(tiers) ? tiers : [] }
}

// GET /api/crm/campaigns
router.get('/campaigns', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const list = await req.storePrisma!.crmCampaign.findMany({ orderBy: { createdAt: 'desc' }, take: 300 })
        res.json({ success: true, data: list.map(outCampaign) })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// POST /api/crm/campaigns
router.post('/campaigns', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        if (!String(b.name || '').trim()) return res.status(400).json({ success: false, error: 'Thiếu tên chiến dịch' })
        const c = await prisma.crmCampaign.create({
            data: {
                name: String(b.name).trim(),
                channel: CAMPAIGN_CHANNEL.includes(b.channel) ? b.channel : 'email',
                status: CAMPAIGN_STATUS.includes(b.status) ? b.status : 'draft',
                template: String(b.template || ''),
                targetTiers: JSON.stringify(Array.isArray(b.targetTiers) ? b.targetTiers : []),
                targetCount: Number(b.targetCount) || 0,
                scheduledAt: toDate(b.scheduledAt),
                createdBy: (req.user as any)?.fullName || req.user?.userId || null,
            },
        })
        await writeActivity(prisma, req, {
            module: 'campaigns', action: 'campaign.created',
            description: `Tạo chiến dịch "${c.name}"`, entityId: c.id, entityName: c.name,
        })
        res.status(201).json({ success: true, data: outCampaign(c) })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// PUT /api/crm/campaigns/:id
router.put('/campaigns/:id', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const b = req.body || {}
        const old = await prisma.crmCampaign.findUnique({ where: { id: String(req.params.id) } })
        if (!old) return res.status(404).json({ success: false, error: 'Không tìm thấy chiến dịch' })

        const data: any = {}
        if (b.name !== undefined) data.name = String(b.name).trim()
        if (b.channel !== undefined && CAMPAIGN_CHANNEL.includes(b.channel)) data.channel = b.channel
        if (b.status !== undefined && CAMPAIGN_STATUS.includes(b.status)) {
            data.status = b.status
            if ((b.status === 'sent' || b.status === 'completed') && !old.sentAt) data.sentAt = new Date()
        }
        if (b.template !== undefined) data.template = String(b.template)
        if (b.targetTiers !== undefined) data.targetTiers = JSON.stringify(Array.isArray(b.targetTiers) ? b.targetTiers : [])
        if (b.targetCount !== undefined) data.targetCount = Number(b.targetCount) || 0
        if (b.sentCount !== undefined) data.sentCount = Number(b.sentCount) || 0
        if (b.openRate !== undefined) data.openRate = Number(b.openRate) || 0
        if (b.responseRate !== undefined) data.responseRate = Number(b.responseRate) || 0
        if (b.scheduledAt !== undefined) data.scheduledAt = toDate(b.scheduledAt)

        const c = await prisma.crmCampaign.update({ where: { id: String(req.params.id) }, data })
        if (data.status && data.status !== old.status) {
            await writeActivity(prisma, req, {
                module: 'campaigns', action: 'campaign.status',
                description: `Chiến dịch "${c.name}" → ${c.status}`, entityId: c.id, entityName: c.name,
            })
        }
        res.json({ success: true, data: outCampaign(c) })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// DELETE /api/crm/campaigns/:id
router.delete('/campaigns/:id', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const c = await prisma.crmCampaign.findUnique({ where: { id: String(req.params.id) } })
        if (!c) return res.status(404).json({ success: false, error: 'Không tìm thấy chiến dịch' })
        await prisma.crmCampaign.delete({ where: { id: String(req.params.id) } })
        await writeActivity(prisma, req, {
            module: 'campaigns', action: 'campaign.deleted',
            description: `Xoá chiến dịch "${c.name}"`, entityId: c.id, entityName: c.name,
        })
        res.json({ success: true })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// ─── Thông báo (suy ra từ dữ liệu, không lưu bảng riêng) ──────────────────────

// GET /api/crm/notifications
router.get('/notifications', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const now = new Date()
        const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999)
        const in7d = new Date(now.getTime() + 7 * 86400000)

        const [overdue, dueToday, replies, bigDebt, closingDeals] = await Promise.all([
            prisma.crmTask.findMany({
                where: { status: { not: 'done' }, dueDate: { lt: now } },
                orderBy: { dueDate: 'asc' }, take: 20,
            }),
            prisma.crmTask.findMany({
                where: { status: { not: 'done' }, dueDate: { gte: now, lte: endOfToday } },
                orderBy: { dueDate: 'asc' }, take: 20,
            }),
            prisma.crmEmailLog.findMany({
                where: { repliedAt: { not: null } },
                orderBy: { repliedAt: 'desc' }, take: 20,
            }),
            prisma.customer.findMany({
                where: { debt: { gt: 0 } },
                orderBy: { debt: 'desc' }, take: 5,
                select: { id: true, name: true, debt: true },
            }),
            prisma.crmDeal.findMany({
                where: { stage: { notIn: ['won', 'lost'] }, expectedCloseDate: { gte: now, lte: in7d } },
                orderBy: { expectedCloseDate: 'asc' }, take: 10,
            }),
        ])

        const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN') + 'đ'
        const items: any[] = []
        for (const t of overdue) items.push({
            id: `task-overdue-${t.id}`, type: 'error', module: 'tasks',
            title: 'Công việc quá hạn',
            message: `"${t.title}"${t.customerName ? ` — ${t.customerName}` : ''}`,
            actionUrl: '/crm/tasks', createdAt: (t.dueDate || t.createdAt).toISOString(),
        })
        for (const t of dueToday) items.push({
            id: `task-today-${t.id}`, type: 'warning', module: 'tasks',
            title: 'Đến hạn hôm nay',
            message: `"${t.title}"${t.customerName ? ` — ${t.customerName}` : ''}`,
            actionUrl: '/crm/tasks', createdAt: (t.dueDate || t.createdAt).toISOString(),
        })
        for (const r of replies) items.push({
            id: `reply-${r.id}`, type: 'success', module: 'email',
            title: 'Khách phản hồi email',
            message: `${r.customerName} đã trả lời "${r.subject}"`,
            actionUrl: '/crm/email', createdAt: r.repliedAt!.toISOString(),
        })
        for (const d of closingDeals) items.push({
            id: `deal-close-${d.id}`, type: 'info', module: 'pipeline',
            title: 'Cơ hội sắp đến hạn chốt',
            message: `"${d.title}" — ${fmt(d.value)}`,
            actionUrl: '/crm/pipeline', createdAt: d.expectedCloseDate!.toISOString(),
        })
        for (const c of bigDebt) items.push({
            id: `debt-${c.id}`, type: 'warning', module: 'debt',
            title: 'Công nợ cần thu',
            message: `${c.name} còn nợ ${fmt(c.debt)}`,
            actionUrl: '/crm/debt', createdAt: now.toISOString(),
        })

        items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        res.json({ success: true, data: items })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// ─── Tổng quan dashboard (gộp 1 lần gọi) ──────────────────────────────────────

// GET /api/crm/overview?days=30
router.get('/overview', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 365)
        const now = new Date()
        const from = new Date(now.getTime() - days * 86400000)
        const prevFrom = new Date(from.getTime() - days * 86400000)
        const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999)

        const [
            totalCustomers, newCustomers, prevNewCustomers, debtAgg,
            deals, tasksOpen, tasksOverdue, tasksDoneRecently,
            emailsSent, emailsReplied, revenueRows, topCustomers, tierRows,
        ] = await Promise.all([
            prisma.customer.count(),
            prisma.customer.count({ where: { createdAt: { gte: from } } }),
            prisma.customer.count({ where: { createdAt: { gte: prevFrom, lt: from } } }),
            prisma.customer.aggregate({ _sum: { debt: true }, where: { debt: { gt: 0 } } }),
            prisma.crmDeal.findMany({ select: { stage: true, value: true } }),
            prisma.crmTask.count({ where: { status: { not: 'done' } } }),
            prisma.crmTask.count({ where: { status: { not: 'done' }, dueDate: { lt: now } } }),
            prisma.crmTask.count({ where: { status: 'done', completedAt: { gte: from } } }),
            prisma.crmEmailLog.count({ where: { sentAt: { gte: from } } }),
            prisma.crmEmailLog.count({ where: { sentAt: { gte: from }, repliedAt: { not: null } } }),
            prisma.$queryRawUnsafe<any[]>(
                `SELECT to_char("createdAt", 'YYYY-MM-DD') AS day,
                        COALESCE(SUM(total), 0)::float8 AS revenue,
                        COUNT(*)::int AS orders
                 FROM "Transaction"
                 WHERE status = 'completed' AND "createdAt" >= $1
                 GROUP BY 1 ORDER BY 1`, from),
            prisma.customer.findMany({
                orderBy: { totalPurchases: 'desc' }, take: 8,
                select: { id: true, name: true, phone: true, totalPurchases: true, totalOrders: true, tier: true, debt: true },
            }),
            prisma.customer.groupBy({ by: ['tier'], _count: { _all: true } }),
        ])

        const stageOrder = DEAL_STAGES
        const pipeline = stageOrder.map(stage => {
            const list = deals.filter((d: any) => d.stage === stage)
            return { stage, count: list.length, value: list.reduce((s: number, d: any) => s + (d.value || 0), 0) }
        })
        const openPipelineValue = pipeline
            .filter(p => p.stage !== 'won' && p.stage !== 'lost')
            .reduce((s, p) => s + p.value, 0)
        const wonValue = pipeline.find(p => p.stage === 'won')?.value || 0

        const revenue = revenueRows.map(r => ({
            day: r.day, revenue: Number(r.revenue) || 0, orders: Number(r.orders) || 0,
        }))
        const totalRevenue = revenue.reduce((s, r) => s + r.revenue, 0)

        res.json({
            success: true,
            data: {
                days,
                customers: {
                    total: totalCustomers,
                    new: newCustomers,
                    prevNew: prevNewCustomers,
                    growth: prevNewCustomers > 0
                        ? Math.round(((newCustomers - prevNewCustomers) / prevNewCustomers) * 100)
                        : (newCustomers > 0 ? 100 : 0),
                    byTier: tierRows.map((t: any) => ({ tier: t.tier, count: t._count._all })),
                },
                debt: { total: debtAgg._sum.debt || 0 },
                pipeline,
                pipelineSummary: { open: openPipelineValue, won: wonValue, count: deals.length },
                tasks: { open: tasksOpen, overdue: tasksOverdue, doneInPeriod: tasksDoneRecently },
                email: {
                    sent: emailsSent, replied: emailsReplied,
                    replyRate: emailsSent > 0 ? Math.round((emailsReplied / emailsSent) * 100) : 0,
                },
                revenue,
                totalRevenue,
                topCustomers,
                generatedAt: endOfToday.toISOString(),
            },
        })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

export default router
