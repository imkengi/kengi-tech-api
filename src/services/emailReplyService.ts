import { ImapFlow } from 'imapflow'
import { SmtpConfig } from './emailService'

// Suy host IMAP từ host SMTP (smtp.gmail.com → imap.gmail.com); cho override qua config
export function deriveImapHost(cfg: SmtpConfig & { imapHost?: string }): string {
    if (cfg.imapHost) return cfg.imapHost
    return cfg.host.replace(/^smtp\./i, 'imap.')
}

export interface ReplyHit {
    logId: string
    fromEmail: string
    replySubject: string
    replyDate: Date
}

/**
 * Quét hộp thư đến tìm thư trả lời cho các email chào hàng đã gửi.
 * Khớp 2 cách: In-Reply-To/References trúng messageId đã lưu, hoặc
 * người gửi trùng email khách + tiêu đề dạng "Re: <tiêu đề đã gửi>".
 * Trả về danh sách logId trúng — caller tự cập nhật DB.
 */
export async function scanRepliesViaImap(
    cfg: SmtpConfig & { imapHost?: string },
    pendingLogs: { id: string; email: string; subject: string; messageId: string | null; sentAt: Date }[],
    sinceDays = 7,
): Promise<ReplyHit[]> {
    if (pendingLogs.length === 0) return []

    const byMessageId = new Map<string, typeof pendingLogs[number]>()
    const byEmail = new Map<string, typeof pendingLogs[number][]>()
    for (const l of pendingLogs) {
        if (l.messageId) byMessageId.set(l.messageId.replace(/[<>]/g, ''), l)
        const key = l.email.toLowerCase()
        if (!byEmail.has(key)) byEmail.set(key, [])
        byEmail.get(key)!.push(l)
    }

    const client = new ImapFlow({
        host: deriveImapHost(cfg),
        port: 993,
        secure: true,
        auth: { user: cfg.user, pass: cfg.pass },
        logger: false,
    })

    const hits: ReplyHit[] = []
    const seenLogIds = new Set<string>()

    await client.connect()
    try {
        const lock = await client.getMailboxLock('INBOX')
        try {
            const since = new Date(Date.now() - sinceDays * 86400_000)
            for await (const msg of client.fetch({ since }, { envelope: true })) {
                const env = msg.envelope
                if (!env) continue
                const fromAddr = (env.from?.[0]?.address || '').toLowerCase()
                if (!fromAddr) continue

                // Cách 1: In-Reply-To trúng messageId đã lưu
                const inReplyTo = (env.inReplyTo || '').replace(/[<>]/g, '').trim()
                let matched = inReplyTo ? byMessageId.get(inReplyTo) : undefined

                // Cách 2: đúng khách + tiêu đề "Re: ..." khớp tiêu đề đã gửi
                if (!matched) {
                    const candidates = byEmail.get(fromAddr)
                    if (candidates) {
                        const subj = (env.subject || '').trim()
                        const stripped = subj.replace(/^((re|tr|trả lời|fwd?)\s*:\s*)+/i, '').trim().toLowerCase()
                        matched = candidates.find(c =>
                            /^((re|tr|trả lời)\s*:)/i.test(subj) &&
                            stripped === c.subject.trim().toLowerCase() &&
                            env.date && new Date(env.date) > new Date(c.sentAt)
                        )
                    }
                }

                if (matched && !seenLogIds.has(matched.id)) {
                    seenLogIds.add(matched.id)
                    hits.push({
                        logId: matched.id,
                        fromEmail: fromAddr,
                        replySubject: (env.subject || '').slice(0, 300),
                        replyDate: env.date ? new Date(env.date) : new Date(),
                    })
                }
            }
        } finally {
            lock.release()
        }
    } finally {
        await client.logout().catch(() => { })
    }

    return hits
}
