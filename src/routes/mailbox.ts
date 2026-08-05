import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'


import { errMsg } from '../lib/errorResponse'

// ═══════════════════════════════════════════════════════════════════════════════
//  HỘP THƯ CỬA HÀNG (2026-08-04) — check mail ngay trong dashboard.
//
//  Cấu hình RIÊNG (StoreSettings.mailboxConfig): Gmail check thư là tài khoản
//  KHÁC với mail gửi CRM (smtpConfig) — gắn ngay trên trang Hộp Thư bằng
//  email + App Password (Gmail: bật 2FA rồi tạo ở myaccount.google.com/apppasswords).
//  Đọc CHỈ-XEM (mailbox mở readOnly) — không đánh dấu đã đọc, không xoá thư.
// ═══════════════════════════════════════════════════════════════════════════════

const router = Router()

// Cấu hình RIÊNG (StoreSettings.mailboxConfig) — Gmail check thư là tài khoản
// KHÁC với mail gửi CRM (smtpConfig), không dùng chung, không fallback.
interface MailboxCfg { user: string; pass: string; host?: string }

async function loadMailboxCfg(prisma: any): Promise<MailboxCfg | null> {
    try {
        const s = await prisma.storeSettings.findUnique({ where: { id: 'default' }, select: { mailboxConfig: true } })
        if (!s?.mailboxConfig) return null
        const cfg = JSON.parse(s.mailboxConfig)
        return cfg?.user && cfg?.pass ? cfg : null
    } catch { return null }
}

function imapHostOf(cfg: MailboxCfg): string {
    const h = (cfg.host || '').trim()
    if (!h) return 'imap.gmail.com'                    // mặc định Gmail
    return h.startsWith('smtp.') ? h.replace(/^smtp\./i, 'imap.') : h
}

async function withImap<T>(cfg: MailboxCfg, fn: (client: any) => Promise<T>): Promise<T> {
    const { ImapFlow } = require('imapflow') as typeof import('imapflow')
    const client = new ImapFlow({
        host: imapHostOf(cfg),
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
    const cfg = await loadMailboxCfg(req.storePrisma!)
    res.json({ success: true, data: { configured: !!cfg, email: cfg?.user || null, imapHost: cfg ? imapHostOf(cfg) : null } })
})

// POST /api/mailbox/connect {email, appPassword, host?} — THỬ ĐĂNG NHẬP THẬT
// trước khi lưu: sai App Password thì báo ngay tại chỗ, không lưu cấu hình hỏng.
router.post('/connect', authMiddleware, requirePermission('mailbox.manage'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma!
        const email = String(req.body?.email || '').trim()
        const pass = String(req.body?.appPassword || '').replace(/\s+/g, '') // App Password Google hay dán kèm khoảng trắng
        const host = String(req.body?.host || '').trim() || undefined
        if (!email || !pass) return res.status(400).json({ success: false, error: 'Cần email và App Password' })

        const cfg: MailboxCfg = { user: email, pass, host }
        await withImap(cfg, async (client) => {
            const lock = await client.getMailboxLock('INBOX', { readOnly: true })
            lock.release()
        })

        await prisma.storeSettings.upsert({
            where: { id: 'default' },
            update: { mailboxConfig: JSON.stringify(cfg) } as any,
            create: { id: 'default', name: 'Cửa hàng', mailboxConfig: JSON.stringify(cfg) } as any,
        })
        res.json({ success: true, data: { email, imapHost: imapHostOf(cfg) } })
    } catch (err: any) {
        const m = String(err?.message || err)
        res.status(400).json({
            success: false,
            error: /auth|credential|password|application-specific/i.test(m)
                ? 'Gmail từ chối đăng nhập — kiểm tra lại App Password (phải tạo ở myaccount.google.com/apppasswords, KHÔNG phải mật khẩu thường)'
                : `Không kết nối được hộp thư: ${m.slice(0, 160)}`,
        })
    }
})

// DELETE /api/mailbox — gỡ hộp thư
router.delete('/', authMiddleware, requirePermission('mailbox.manage'), async (req: AuthRequest, res: Response) => {
    await req.storePrisma!.storeSettings.update({
        where: { id: 'default' },
        data: { mailboxConfig: null } as any,
    }).catch(() => { })
    res.json({ success: true })
})

// GET /api/mailbox/messages?limit=30 — thư mới nhất trong INBOX (mới → cũ)
router.get('/messages', authMiddleware, requirePermission('mailbox.view'), async (req: AuthRequest, res: Response) => {
    try {
        const cfg = await loadMailboxCfg(req.storePrisma!)
        if (!cfg) return res.status(400).json({ success: false, error: 'Chưa gắn hộp thư — dùng thẻ Kết nối Gmail ngay trên trang Hộp Thư' })
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30))
        const q = String(req.query.search || '').trim()
        const unreadOnly = String(req.query.unread || '') === '1'

        const rows = await withImap(cfg, async (client) => {
            const lock = await client.getMailboxLock('INBOX', { readOnly: true })
            try {
                const total = Number(client.mailbox?.exists || 0)
                if (total === 0) return { total: 0, unseen: 0, messages: [] as any[] }
                const status = await client.status('INBOX', { unseen: true })

                // Tìm kiếm chạy TRÊN SÀN GMAIL (IMAP SEARCH) chứ không lọc mảng
                // 40 thư đã tải — gõ tên shop/mã đơn là moi được thư cũ nhiều
                // tháng. Không có từ khoá thì lấy N thư mới nhất như cũ.
                let range: string | number[]
                let matched: number | null = null
                if (q || unreadOnly) {
                    const criteria: any = q
                        ? { or: [{ subject: q }, { from: q }, { body: q }] }
                        : {}
                    if (unreadOnly) criteria.seen = false
                    const uids = await client.search(criteria, { uid: true }) as number[]
                    matched = uids?.length || 0
                    // `searched: true` để FE BIẾT CHẮC server đã lọc thật. Thiếu cờ này
                    // thì bản server cũ (chưa có tìm kiếm) lặng lẽ trả 40 thư mới nhất
                    // và màn hình vẫn ghi "40 kết quả" — đúng cảnh vừa gặp.
                    if (matched === 0) return { total, unseen: Number(status?.unseen || 0), matched: 0, searched: true, messages: [] as any[] }
                    range = uids.slice(-limit)   // mảng UID → fetch đúng những thư khớp
                } else {
                    range = `${Math.max(1, total - limit + 1)}:*`
                }

                const out: any[] = []
                const fetchOpts = { uid: true, envelope: true, flags: true, internalDate: true }
                const iter = Array.isArray(range)
                    ? client.fetch(range as any, fetchOpts, { uid: true })
                    : client.fetch(range, fetchOpts)
                for await (const msg of iter) {
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
                return { total, unseen: Number(status?.unseen || 0), matched, searched: matched !== null, messages: out }
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
                ? `Đăng nhập hộp thư bị từ chối — bấm "Đổi tài khoản" nhập lại App Password. (${m.slice(0, 120)})`
                : errMsg(err),
        })
    }
})

// GET /api/mailbox/messages/:uid — nội dung đầy đủ một thư
router.get('/messages/:uid', authMiddleware, requirePermission('mailbox.view'), async (req: AuthRequest, res: Response) => {
    try {
        const cfg = await loadMailboxCfg(req.storePrisma!)
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
