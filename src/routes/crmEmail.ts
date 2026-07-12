import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { sendEmailWithSmtp, verifySmtp, SmtpConfig } from '../services/emailService'
import { scanRepliesViaImap } from '../services/emailReplyService'
import { errMsg } from '../lib/errorResponse'

const router = Router()

const PASS_MASK = '••••••••'

// Đọc cấu hình SMTP công ty từ StoreSettings.smtpConfig (JSON)
async function loadSmtpConfig(prisma: any): Promise<SmtpConfig | null> {
    try {
        const s = await prisma.storeSettings.findUnique({ where: { id: 'default' }, select: { smtpConfig: true } })
        if (!s?.smtpConfig) return null
        const cfg = JSON.parse(s.smtpConfig)
        if (!cfg.host || !cfg.user || !cfg.pass) return null
        return { host: cfg.host, port: Number(cfg.port) || 587, user: cfg.user, pass: cfg.pass, fromName: cfg.fromName || undefined, secure: !!cfg.secure }
    } catch { return null }
}

// GET /api/crm/email-settings — trả cấu hình (che mật khẩu)
router.get('/email-settings', authMiddleware, requirePermission('settings.view'), async (req: AuthRequest, res: Response) => {
    try {
        const cfg = await loadSmtpConfig(req.storePrisma!)
        if (!cfg) return res.json({ success: true, data: { configured: false } })
        res.json({ success: true, data: { configured: true, host: cfg.host, port: cfg.port, user: cfg.user, pass: PASS_MASK, fromName: cfg.fromName || '', secure: !!cfg.secure } })
    } catch (err) { res.status(500).json({ success: false, error: errMsg(err) }) }
})

// PUT /api/crm/email-settings — lưu cấu hình. pass = mask thì giữ mật khẩu cũ.
router.put('/email-settings', authMiddleware, requirePermission('settings.edit_store'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { host, port, user, pass, fromName, secure } = req.body
        if (!host?.trim() || !user?.trim()) return res.status(400).json({ success: false, error: 'Thiếu máy chủ SMTP hoặc email đăng nhập' })
        let realPass = String(pass || '')
        if (!realPass || realPass === PASS_MASK) {
            const old = await loadSmtpConfig(prisma)
            if (!old?.pass) return res.status(400).json({ success: false, error: 'Thiếu mật khẩu ứng dụng (App Password)' })
            realPass = old.pass
        }
        const cfg: SmtpConfig = { host: host.trim(), port: Number(port) || 587, user: user.trim(), pass: realPass, fromName: (fromName || '').trim() || undefined, secure: !!secure }
        // Xác thực đăng nhập SMTP trước khi lưu — sai pass là biết ngay
        try { await verifySmtp(cfg) } catch (e: any) {
            return res.status(400).json({ success: false, error: `Đăng nhập SMTP thất bại: ${String(e?.message || e).slice(0, 180)}` })
        }
        await prisma.storeSettings.upsert({
            where: { id: 'default' },
            update: { smtpConfig: JSON.stringify(cfg) },
            create: { id: 'default', name: 'Cửa hàng', smtpConfig: JSON.stringify(cfg) },
        })
        res.json({ success: true, data: { configured: true, user: cfg.user } })
    } catch (err) { console.error('Save SMTP config error:', err); res.status(500).json({ success: false, error: errMsg(err) }) }
})

// Giới hạn mỗi lần gửi để không vượt quota SMTP (Gmail ~500/ngày)
const MAX_RECIPIENTS_PER_CALL = 100
const DELAY_BETWEEN_SENDS_MS = 400

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Thay {{name}} {{code}} trong subject/nội dung bằng thông tin từng khách
function personalize(tpl: string, c: { name: string; code: string }): string {
    return tpl.replace(/\{\{\s*name\s*\}\}/gi, c.name).replace(/\{\{\s*code\s*\}\}/gi, c.code)
}

// Bọc nội dung vào layout email thương hiệu (cùng phong cách buildOtpEmail)
function wrapBrandedEmail(bodyHtml: string, storeName: string): string {
    const year = new Date().getFullYear()
    return `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f4f6;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(76,29,149,0.10);">
      <tr>
        <td style="background:linear-gradient(135deg,#7c3aed 0%,#4f46e5 100%);background-color:#7c3aed;padding:28px 32px;text-align:center;">
          <div style="color:#ffffff;font-size:20px;font-weight:700;">${storeName}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;font-size:15px;line-height:1.7;color:#374151;">
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="background-color:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <div style="color:#374151;font-size:13px;font-weight:600;margin-bottom:4px;">${storeName}</div>
          <div style="color:#9ca3af;font-size:12px;">© ${year} · Gửi từ Kengi CRM</div>
        </td>
      </tr>
    </table>
    <p style="color:#9ca3af;font-size:11px;margin:14px 0 0;text-align:center;">Nếu quý khách không muốn nhận email này, vui lòng phản hồi để chúng tôi ngừng gửi.</p>
  </td></tr>
</table>
</body></html>`
}

// POST /api/crm/email-campaign — gửi email chào hàng cho danh sách khách
// body: { subject, html, customerIds?: string[], extraEmails?: string[], testTo?: string, storeName?: string }
// subject/html hỗ trợ {{name}}, {{code}}. testTo = gửi thử 1 email, không cần customerIds.
// extraEmails = email nhập tay ngoài danh sách khách ({{name}} → "Quý khách").
router.post('/email-campaign', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { subject, html, customerIds, extraEmails, testTo } = req.body
        const storeName = (req.body.storeName || 'Kengi Tech').toString().slice(0, 120)

        if (!subject?.trim() || !html?.trim()) {
            return res.status(400).json({ success: false, error: 'Thiếu subject hoặc nội dung email' })
        }

        // Bắt buộc cấu hình email công ty trước khi gửi
        const smtp = await loadSmtpConfig(prisma)
        if (!smtp) {
            return res.status(400).json({ success: false, errorCode: 'SMTP_NOT_CONFIGURED', error: 'Chưa cấu hình email công ty. Vào "Cấu hình email" để kết nối email gửi đi trước.' })
        }

        // ── Gửi thử ──
        if (testTo) {
            const fake = { name: 'Khách hàng', code: 'TEST' }
            await sendEmailWithSmtp(smtp, String(testTo), personalize(subject, fake), wrapBrandedEmail(personalize(html, fake), storeName))
            return res.json({ success: true, data: { test: true, to: testTo, from: smtp.user } })
        }

        const ids = Array.isArray(customerIds) ? customerIds : []
        const manual = (Array.isArray(extraEmails) ? extraEmails : [])
            .map((e: any) => String(e).trim())
            .filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
        if (ids.length === 0 && manual.length === 0) {
            return res.status(400).json({ success: false, error: 'Chưa chọn khách hàng hoặc nhập email nào' })
        }
        if (ids.length + manual.length > MAX_RECIPIENTS_PER_CALL) {
            return res.status(400).json({ success: false, error: `Tối đa ${MAX_RECIPIENTS_PER_CALL} người nhận mỗi lần gửi` })
        }

        const customers = ids.length > 0 ? await prisma.customer.findMany({
            where: { id: { in: ids.map(String) } },
            select: { id: true, code: true, name: true, email: true },
        }) : []

        // Email nhập tay: {{name}} → "Quý khách"; bỏ email trùng với khách đã chọn
        const customerEmails = new Set(customers.map((c: any) => (c.email || '').toLowerCase()).filter(Boolean))
        for (const e of manual) {
            if (customerEmails.has(e.toLowerCase())) continue
            customerEmails.add(e.toLowerCase())
            customers.push({ id: '', code: '', name: 'Quý khách', email: e } as any)
        }

        const results: { customerId: string; name: string; email: string | null; ok: boolean; error?: string }[] = []
        for (const c of customers) {
            if (!c.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) {
                results.push({ customerId: c.id, name: c.name, email: c.email, ok: false, error: 'Không có email hợp lệ' })
                continue
            }
            try {
                const info: any = await sendEmailWithSmtp(smtp, c.email, personalize(subject, c), wrapBrandedEmail(personalize(html, c), storeName))
                // Lưu log để theo dõi phản hồi qua IMAP
                try {
                    await prisma.crmEmailLog.create({
                        data: { customerId: c.id || null, customerName: c.name, email: c.email, subject: personalize(subject, c), messageId: info?.messageId || null },
                    })
                } catch { /* bảng chưa migrate — không chặn việc gửi */ }
                results.push({ customerId: c.id, name: c.name, email: c.email, ok: true })
            } catch (e: any) {
                results.push({ customerId: c.id, name: c.name, email: c.email, ok: false, error: errMsg(e, 'Gửi thất bại') })
            }
            await sleep(DELAY_BETWEEN_SENDS_MS)
        }

        const succeeded = results.filter(r => r.ok).length
        console.log(`[CRM Email] Campaign "${subject}" gửi ${succeeded}/${results.length} email`)
        res.json({ success: true, data: { total: results.length, succeeded, failed: results.length - succeeded, results } })
    } catch (err) {
        console.error('CRM email campaign error:', err)
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// Quét IMAP tìm phản hồi cho 1 store — dùng chung cho endpoint check-now và cron
export async function checkRepliesForStore(prisma: any): Promise<{ checked: number; newReplies: any[] }> {
    const smtp = await loadSmtpConfig(prisma)
    if (!smtp) return { checked: 0, newReplies: [] }
    // Chỉ dò các email gửi trong 14 ngày chưa có phản hồi
    const pending = await prisma.crmEmailLog.findMany({
        where: { repliedAt: null, sentAt: { gte: new Date(Date.now() - 14 * 86400_000) } },
        select: { id: true, email: true, subject: true, messageId: true, sentAt: true },
        take: 500,
    })
    if (pending.length === 0) return { checked: 0, newReplies: [] }
    const hits = await scanRepliesViaImap(smtp as any, pending, 7)
    const newReplies: any[] = []
    for (const h of hits) {
        const updated = await prisma.crmEmailLog.update({
            where: { id: h.logId },
            data: { repliedAt: h.replyDate, replySubject: h.replySubject },
        })
        newReplies.push(updated)
    }
    if (newReplies.length > 0) console.log(`[CRM Email] ${newReplies.length} khách phản hồi email`)
    return { checked: pending.length, newReplies }
}

// GET /api/crm/email-replies — lịch sử gửi + phản hồi (server-side, thay localStorage)
// ?repliedOnly=1 → chỉ các thư đã được trả lời; ?afterId= → phản hồi mới hơn mốc (FE poll)
router.get('/email-replies', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const { repliedOnly, after } = req.query
        const where: any = {}
        if (repliedOnly === '1') where.repliedAt = { not: null }
        if (after) where.repliedAt = { not: null, gt: new Date(String(after)) }
        const items = await prisma.crmEmailLog.findMany({
            where,
            orderBy: [{ repliedAt: 'desc' }, { sentAt: 'desc' }],
            take: 100,
        })
        const repliedCount = await prisma.crmEmailLog.count({ where: { repliedAt: { not: null } } })
        res.json({ success: true, data: { items, repliedCount } })
    } catch (err) { console.error('Email replies list error:', err); res.status(500).json({ success: false, error: errMsg(err) }) }
})

// POST /api/crm/email-replies/check — quét hộp thư ngay (nút "Kiểm tra phản hồi")
router.post('/email-replies/check', authMiddleware, requirePermission('customers.view'), async (req: AuthRequest, res: Response) => {
    try {
        const smtp = await loadSmtpConfig(req.storePrisma!)
        if (!smtp) return res.status(400).json({ success: false, errorCode: 'SMTP_NOT_CONFIGURED', error: 'Chưa cấu hình email công ty' })
        const result = await checkRepliesForStore(req.storePrisma!)
        res.json({ success: true, data: result })
    } catch (err: any) {
        console.error('Check replies error:', err)
        res.status(500).json({ success: false, error: `Không quét được hộp thư: ${String(err?.message || '').slice(0, 160)}` })
    }
})

export default router
