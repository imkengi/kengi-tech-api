import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { deriveImapHost } from '../services/emailReplyService'
import type { SmtpConfig } from '../services/emailService'
import { errMsg } from '../lib/errorResponse'

// ═══════════════════════════════════════════════════════════════════════════════
//  HỘP THƯ CỬA HÀNG (2026-08-04) — check mail ngay trong dashboard.
//
//  KHÔNG cấu hình riêng: dùng lại StoreSettings.smtpConfig (email + app password
//  đã khai ở màn cài đặt email cho CRM). SMTP gửi được thì IMAP đọc được cùng
//  tài khoản — Gmail cần App Password (2FA), đã là điều kiện của màn cài đặt cũ.
//  Đọc CHỈ-XEM (mailbox mở readOnly) — không đánh dấu đã đọc, không xoá thư.
// ═══════════════════════════════════════════════════════════════════════════════

const router = Router()

async function loadSmtp(prisma: any): Promise<(SmtpConfig & { imapHost?: string }) | null> {
    try {
        const s = await prisma.storeSettings.findUnique({ where: { id: 'default' }, select: { smtpConfig: true } })
        if (!s?.smtpConfig) return null
        const cfg = JSON.parse(s.smtpConfig)
        return cfg?.host && cfg?.user && cfg?.pass ? cfg : null
    } catch { return null }
}

async function withImap<T>(cfg: SmtpConfig & { imapHost?: string }, fn: (client: any) => Promise<T>): Promise<T> {
    const { ImapFlow } = require('imapflow') as typeof import('imapflow')
    const client = new ImapFlow({
        host: deriveImapHost(cfg),
        port: 993,
        secure: true,
        auth: { user: cfg.user, pass: cfg.pass },
        logger: false,
        // Hộp thư nghẽn không được kéo sập request — fail nhanh còn báo lỗi tử tế
        socketTimeout: 30_000,
    })
    await client.connect()
    try {
        return await fn(client)
    } finally {
        await client.logout().catch(() => { })
    }
}

// GET /api/mailbox/status — đã gắn mail chưa, là địa chỉ nào
router.get('/status', authMiddleware, requirePermission('mailbox.view'), async (req: AuthRequest, res: Response) => {
    const cfg = await loadSmtp(req.storePrisma!)
    res.json({ success: true, data: { configured: !!cfg, email: cfg?.user || null, imapHost: cfg ? deriveImapHost(cfg) : null } })
})

// GET /api/mailbox/messages?limit=30 — thư mới nhất trong INBOX (mới → cũ)
router.get('/messages', authMiddleware, requirePermission('mailbox.view'), async (req: AuthRequest, res: Response) => {
    try {
        const cfg = await loadSmtp(req.storePrisma!)
        if (!cfg) return res.status(400).json({ success: false, error: 'Chưa cấu hình email — vào Cài đặt → Email (SMTP) khai email + App Password trước' })
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30))

        const rows = await withImap(cfg, async (client) => {
            const lock = await client.getMailboxLock('INBOX', { readOnly: true })
            try {
                const total = Number(client.mailbox?.exists || 0)
                if (total === 0) return { total: 0, unseen: 0, messages: [] as any[] }
                const status = await client.status('INBOX', { unseen: true })
                const from = Math.max(1, total - limit + 1)
                const out: any[] = []
                for await (const msg of client.fetch(`${from}:*`, { uid: true, envelope: true, flags: true, internalDate: true })) {
                    const env = msg.envelope || {}
                    const sender = (env.from && env.from[0]) || {}
                    out.push({
                        uid: msg.uid,
                        subject: env.subject || '(không tiêu đề)',
                        fromName: sender.name || '',
                        fromAddress: sender.address || '',
                        date: (msg.internalDate || env.date || new Date()).toISOString?.() || String(msg.internalDate),
                        seen: msg.flags?.has ? msg.flags.has('\\Seen') : false,
                    })
                }
                out.sort((a, b) => (a.date < b.date ? 1 : -1))
                return { total, unseen: Number(status?.unseen || 0), messages: out }
            } finally {
                lock.release()
            }
        })
        res.json({ success: true, data: rows })
    } catch (err: any) {
        // Sai App Password / Gmail chặn là lỗi hay gặp nhất — nói thẳng thay vì 500 câm
        const m = String(err?.message || err)
        const auth = /auth|credential|password|application-specific/i.test(m)
        res.status(auth ? 400 : 500).json({
            success: false,
            error: auth
                ? `Đăng nhập hộp thư bị từ chối — kiểm tra App Password ở Cài đặt → Email. (${m.slice(0, 120)})`
                : errMsg(err),
        })
    }
})

// GET /api/mailbox/messages/:uid — nội dung đầy đủ một thư
router.get('/messages/:uid', authMiddleware, requirePermission('mailbox.view'), async (req: AuthRequest, res: Response) => {
    try {
        const cfg = await loadSmtp(req.storePrisma!)
        if (!cfg) return res.status(400).json({ success: false, error: 'Chưa cấu hình email' })
        const uid = Number(req.params.uid)
        if (!uid) return res.status(400).json({ success: false, error: 'uid không hợp lệ' })

        const data = await withImap(cfg, async (client) => {
            const lock = await client.getMailboxLock('INBOX', { readOnly: true })
            try {
                const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
                if (!msg?.source) return null
                const { simpleParser } = require('mailparser') as typeof import('mailparser')
                const mail = await simpleParser(msg.source)
                return {
                    uid,
                    subject: mail.subject || '(không tiêu đề)',
                    from: mail.from?.text || '',
                    to: Array.isArray(mail.to) ? mail.to.map(t => t.text).join(', ') : (mail.to?.text || ''),
                    date: mail.date?.toISOString() || null,
                    text: mail.text || '',
                    // FE sanitize bằng DOMPurify trước khi render — server trả thô
                    html: typeof mail.html === 'string' ? mail.html : null,
                    attachments: (mail.attachments || []).map(a => ({ filename: a.filename || 'file', size: a.size || 0 })),
                }
            } finally {
                lock.release()
            }
        })
        if (!data) return res.status(404).json({ success: false, error: 'Không tìm thấy thư' })
        res.json({ success: true, data })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

export default router
