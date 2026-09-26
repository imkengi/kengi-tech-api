// ─────────────────────────────────────────────────────────────────────────────
//  HỘP THƯ CỬA HÀNG — cấu hình + kết nối IMAP dùng chung (tách từ
//  routes/mailbox.ts 26/09/2026 để cron đọc hoá đơn XML dùng cùng một đường).
//
//  Cấu hình RIÊNG (StoreSettings.mailboxConfig): Gmail check thư là tài khoản
//  KHÁC với mail gửi CRM (smtpConfig), không dùng chung, không fallback.
//  Mọi thao tác mở hộp thư ở chế độ CHỈ ĐỌC — không đánh dấu đã đọc, không xoá.
// ─────────────────────────────────────────────────────────────────────────────

export interface MailboxCfg { user: string; pass: string; host?: string }

export async function loadMailboxCfg(prisma: any): Promise<MailboxCfg | null> {
    try {
        const s = await prisma.storeSettings.findUnique({ where: { id: 'default' }, select: { mailboxConfig: true } })
        if (!s?.mailboxConfig) return null
        const cfg = JSON.parse(s.mailboxConfig)
        return cfg?.user && cfg?.pass ? cfg : null
    } catch { return null }
}

export function imapHostOf(cfg: MailboxCfg): string {
    const h = (cfg.host || '').trim()
    if (!h) return 'imap.gmail.com'                    // mặc định Gmail
    return h.startsWith('smtp.') ? h.replace(/^smtp\./i, 'imap.') : h
}

export async function withImap<T>(cfg: MailboxCfg, fn: (client: any) => Promise<T>): Promise<T> {
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
