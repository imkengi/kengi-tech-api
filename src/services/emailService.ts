import nodemailer, { Transporter } from 'nodemailer'

// Configurable SMTP — defaults to Gmail. Set in .env:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com'
const SMTP_PORT = Number(process.env.SMTP_PORT || 587)
const SMTP_SECURE = process.env.SMTP_SECURE === 'true' || SMTP_PORT === 465
const SMTP_USER = process.env.SMTP_USER || ''
const SMTP_PASS = process.env.SMTP_PASS || ''
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@kengi.vn'

let cached: Transporter | null = null

function getTransporter(): Transporter {
    if (cached) return cached
    cached = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
    return cached
}

export async function sendEmail(to: string, subject: string, html: string, text?: string) {
    if (!SMTP_USER) {
        // Dev fallback: log instead of failing — lets the OTP show up in server logs
        console.log(`📧 [EmailService:dev] To=${to} Subject="${subject}"\n${text || html}`)
        return { dev: true }
    }
    const info = await getTransporter().sendMail({ from: SMTP_FROM, to, subject, html, text })
    console.log(`📧 [EmailService] Sent ${info.messageId} → ${to}`)
    return info
}

export function buildOtpEmail(code: string, purpose: 'login' | 'reset'): { subject: string; html: string; text: string } {
    const purposeText = purpose === 'login' ? 'đăng nhập (xác thực 2 lớp)' : 'đặt lại mật khẩu'
    const subject = `Mã xác minh KengiTech: ${code}`
    const text = `Mã xác minh ${purposeText} của bạn là: ${code}\nMã có hiệu lực trong 10 phút. Không chia sẻ với bất kỳ ai.`
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #eee;border-radius:8px">
            <h2 style="color:#0f172a">Mã xác minh ${purposeText}</h2>
            <p>Mã xác minh của bạn:</p>
            <p style="font-size:32px;font-weight:bold;letter-spacing:6px;background:#f1f5f9;padding:12px 16px;border-radius:6px;text-align:center">${code}</p>
            <p style="color:#64748b">Mã có hiệu lực trong <strong>10 phút</strong>. Không chia sẻ với bất kỳ ai.</p>
            <p style="color:#94a3b8;font-size:12px">Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email.</p>
        </div>
    `
    return { subject, html, text }
}
