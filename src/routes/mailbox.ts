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

// POST /api/mailbox/scan-transactions {bankAccountId, days?}
// Quét thư báo giao dịch ngân hàng → tạo BankTransaction CHƯA đối soát, chảy
// vào đúng màn E-Banking sẵn có (đối soát, gắn phiếu thu/chi).
router.post('/scan-transactions', authMiddleware, requirePermission('mailbox.manage'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const cfg = await loadMailboxCfg(prisma)
        if (!cfg) return res.status(400).json({ success: false, error: 'Chưa gắn hộp thư' })

        const bankAccountId = String(req.body?.bankAccountId || '').trim()
        if (!bankAccountId) return res.status(400).json({ success: false, error: 'Chọn tài khoản ngân hàng để ghi giao dịch vào' })
        const acc = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } }).catch(() => null)
        if (!acc) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản ngân hàng' })

        const days = Math.min(180, Math.max(1, Number(req.body?.days) || 30))
        const since = new Date(Date.now() - days * 86400_000)
        const CAP = 200

        const { parseBankEmail } = await import('../services/bankEmailParser')
        const { simpleParser } = require('mailparser') as typeof import('mailparser')

        const parsed: any[] = []
        let scanned = 0
        await withImap(cfg, async (client) => {
            const lock = await client.getMailboxLock('INBOX', { readOnly: true })
            try {
                const uids = await client.search({ since, from: 'mbbank.com.vn' }, { uid: true }) as number[]
                if (!uids?.length) return
                for (const uid of uids.slice(-CAP)) {
                    const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true })
                    if (!msg?.source) continue
                    scanned++
                    const mail = await simpleParser(msg.source)
                    const tx = parseBankEmail({
                        subject: mail.subject || '',
                        from: mail.from?.text || '',
                        text: mail.text || '',
                        html: typeof mail.html === 'string' ? mail.html : null,
                        receivedAt: mail.date || undefined,
                    })
                    if (tx) parsed.push(tx)
                }
            } finally { lock.release() }
        })

        // Chống trùng theo SỐ THAM CHIẾU — quét lại nhiều lần vẫn không nhân đôi
        const refs = parsed.map(p => p.referenceNo)
        const existing = refs.length
            ? await prisma.bankTransaction.findMany({ where: { referenceNo: { in: refs } }, select: { referenceNo: true } })
            : []
        const seen = new Set(existing.map((e: any) => e.referenceNo))

        let created = 0, duplicate = 0
        const samples: any[] = []
        for (const p of parsed) {
            if (seen.has(p.referenceNo)) { duplicate++; continue }
            seen.add(p.referenceNo)
            await prisma.bankTransaction.create({
                data: {
                    bankAccountId, type: p.type, amount: p.amount,
                    description: p.description,
                    transactionDate: p.transactionDate, date: p.transactionDate,
                    reference: p.referenceNo, referenceNo: p.referenceNo,
                    counterpartyName: p.counterpartyName || null,
                    counterpartyAccount: p.counterpartyAccount || null,
                    isReconciled: false,
                    notes: 'Bóc tự động từ email ngân hàng',
                    branchId: acc.branchId || null,
                },
            })
            created++
            if (samples.length < 5) samples.push({ ref: p.referenceNo, type: p.type, amount: p.amount, desc: p.description.slice(0, 60) })
        }

        // CỐ Ý KHÔNG cộng/trừ số dư tài khoản: email chỉ là lát cắt (có thư bị
        // xoá, lọc vào thư mục khác, ngân hàng khác chưa hỗ trợ). Lấy số dư từ
        // nguồn không đầy đủ sẽ làm lệch sổ mà không ai biết. Số dư vẫn do sao
        // kê CSV / nhập tay quyết định.
        res.json({
            success: true,
            data: {
                scanned, parsed: parsed.length, created, duplicate,
                skipped: scanned - parsed.length,
                samples,
                message: `Quét ${scanned} thư ngân hàng: thêm ${created} giao dịch mới` +
                    `${duplicate ? `, bỏ qua ${duplicate} đã có` : ''}` +
                    `${scanned - parsed.length ? `, ${scanned - parsed.length} thư không phải giao dịch thành công` : ''}. ` +
                    `Vào E-Banking để đối soát và lên phiếu thu/chi.`,
            },
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
    }
})

// POST /api/mailbox/scan-invoices {days?} — bóc HOÁ ĐƠN ĐẦU VÀO từ thư thông
// báo phát hành HĐĐT của nhà cung cấp → phiếu chi CHỜ DUYỆT (status 'pending',
// không lọt vào thống kê cho tới khi người dùng duyệt).
router.post('/scan-invoices', authMiddleware, requirePermission('mailbox.manage'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma = req.storePrisma! as any
        const cfg = await loadMailboxCfg(prisma)
        if (!cfg) return res.status(400).json({ success: false, error: 'Chưa gắn hộp thư' })

        const days = Math.min(365, Math.max(1, Number(req.body?.days) || 90))
        const since = new Date(Date.now() - days * 86400_000)
        const CAP = 300

        // MST của chính cửa hàng — để không nhận nhầm mình làm nhà cung cấp
        const ownTaxCode = await prisma.eInvoiceConfig.findFirst({ select: { taxCode: true } })
            .then((c: any) => c?.taxCode || '').catch(() => '')

        const { parseEInvoiceEmail } = await import('../services/einvoiceEmailParser')
        const { simpleParser } = require('mailparser') as typeof import('mailparser')

        const found: any[] = []
        let scanned = 0
        await withImap(cfg, async (client) => {
            const lock = await client.getMailboxLock('INBOX', { readOnly: true })
            try {
                // Quét theo TIÊU ĐỀ chứ không theo người gửi: mỗi NCC dùng một
                // nhà cung cấp phần mềm HĐĐT khác nhau (softdreams, vnpt, viettel,
                // misa…), lọc theo địa chỉ gửi sẽ sót hàng loạt.
                const uids = await client.search({ since, or: [{ subject: 'hóa đơn điện tử' }, { subject: 'hoá đơn điện tử' }, { subject: 'Hoa don dien tu' }] }, { uid: true }) as number[]
                if (!uids?.length) return
                for (const uid of uids.slice(-CAP)) {
                    const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
                    if (!msg?.source) continue
                    scanned++
                    const mail = await simpleParser(msg.source)
                    const inv = parseEInvoiceEmail({
                        subject: mail.subject || '',
                        from: mail.from?.text || '',
                        text: mail.text || '',
                        html: typeof mail.html === 'string' ? mail.html : null,
                        ownTaxCode,
                    })
                    if (inv) found.push(inv)
                }
            } finally { lock.release() }
        })

        const keys = found.map(f => f.dedupKey)
        const existing = keys.length
            ? await prisma.expense.findMany({ where: { sourceRef: { in: keys } }, select: { sourceRef: true } })
            : []
        const seen = new Set(existing.map((e: any) => e.sourceRef))

        let created = 0, duplicate = 0
        const samples: any[] = []
        for (const inv of found) {
            if (seen.has(inv.dedupKey)) { duplicate++; continue }
            seen.add(inv.dedupKey)
            await prisma.expense.create({
                data: {
                    description: `HĐ ${inv.invoiceSymbol || ''} số ${inv.invoiceNo} — ${inv.sellerName || 'NCC'}`.slice(0, 300),
                    amount: inv.totalAmount,
                    category: 'Hoá đơn đầu vào',
                    date: inv.invoiceDate || new Date(),
                    status: 'pending',           // CHỜ DUYỆT — chưa vào thống kê
                    vatAmount: inv.vatAmount || 0,
                    supplierName: inv.sellerName || null,
                    supplierTaxCode: inv.sellerTaxCode || null,
                    invoiceNo: inv.invoiceNo,
                    invoiceSymbol: inv.invoiceSymbol || null,
                    invoiceDate: inv.invoiceDate || null,
                    lookupCode: inv.lookupCode || null,
                    taxAuthorityCode: inv.taxAuthorityCode || null,
                    sourceRef: inv.dedupKey,
                    branchId: (req.user as any)?.branchId || null,
                },
            })
            created++
            if (samples.length < 5) samples.push({ no: inv.invoiceNo, seller: inv.sellerName, total: inv.totalAmount, vat: inv.vatAmount })
        }

        res.json({
            success: true,
            data: {
                scanned, parsed: found.length, created, duplicate, samples,
                message: `Quét ${scanned} thư hoá đơn: thêm ${created} phiếu chi CHỜ DUYỆT` +
                    `${duplicate ? `, bỏ qua ${duplicate} đã có` : ''}. Vào Chi phí để soát rồi duyệt — phiếu chờ chưa tính vào sổ.`,
            },
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: errMsg(err) })
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
