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
    const isReset = purpose === 'reset'
    const title = isReset ? 'Quên mật khẩu rồi hả? 🤔' : 'Chào mừng quay lại! 👋'
    const headerSubtitle = isReset ? 'Đặt lại mật khẩu cho khoẻ 🔑' : 'Xác thực 2 lớp cho an toàn 🛡️'
    const intro = isReset
        ? 'Có vẻ như bạn quên mất mật khẩu rồi 😅 Đừng lo, dùng mã bí mật bên dưới để đặt lại nha!'
        : 'Để chắc chắn là bạn chứ không phải ai khác 👀 nhập giúp mình mã bí mật bên dưới nha!'
    const subject = isReset
        ? `🔑 Đặt lại mật khẩu Kengi Tech: ${code}`
        : `🔐 Mã đăng nhập Kengi Tech: ${code}`
    const text = `${title} - Kengi Tech\n\nĐây là mã bí mật của bạn nè: ${code}\n\nMã này chỉ sống được 10 phút thôi nha ⏰ Nhanh tay lên!\nĐừng chia sẻ mã cho ai hết nha, kể cả nhân viên Kengi Tech 🤫\nNếu bạn không yêu cầu mã này thì cứ bỏ qua email này nha — không sao đâu 😉`
    const year = new Date().getFullYear()
    const spacedCode = code.split('').join(' ')
    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title} - Kengi Tech</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f4f6;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(76,29,149,0.10);">
      <tr>
        <td style="background:linear-gradient(135deg,#7c3aed 0%,#4f46e5 100%);background-color:#7c3aed;padding:40px 32px;text-align:center;">
          <div style="display:inline-block;width:64px;height:64px;background-color:rgba(255,255,255,0.20);border-radius:16px;text-align:center;margin-bottom:16px;">
            <div style="font-size:32px;font-weight:800;color:#ffffff;line-height:64px;">K</div>
          </div>
          <div style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:0.5px;">Kengi Tech</div>
          <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:6px;">${headerSubtitle}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:40px 32px 24px 32px;">
          <h1 style="margin:0 0 12px;color:#111827;font-size:22px;font-weight:700;text-align:center;">${title}</h1>
          <p style="margin:0 0 28px;color:#4b5563;font-size:15px;line-height:1.6;text-align:center;">${intro}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr><td align="center">
              <div style="background:linear-gradient(135deg,#f5f3ff 0%,#ede9fe 100%);background-color:#f5f3ff;border:2px dashed #8b5cf6;border-radius:12px;padding:24px 32px;display:inline-block;">
                <div style="color:#6d28d9;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">🔐 Mã bí mật của bạn nè</div>
                <div style="font-size:36px;font-weight:700;color:#4c1d95;letter-spacing:8px;font-family:'Courier New',Courier,monospace;">${spacedCode}</div>
              </div>
            </td></tr>
          </table>
          <p style="margin:28px 0 0;color:#6b7280;font-size:14px;text-align:center;line-height:1.6;">
            ⏰ Mã này chỉ sống được <strong style="color:#6d28d9;">10 phút</strong> thôi nha — nhanh tay lên!
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;">
            <tr><td style="background-color:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px;padding:14px 16px;">
              <div style="color:#92400e;font-size:13px;line-height:1.55;">
                <strong>🤫 Bí mật nha:</strong> Đừng chia sẻ mã này cho ai hết, kể cả nhân viên Kengi Tech. Nếu bạn không yêu cầu mã này thì cứ bỏ qua email này nha — không sao đâu! 😉
              </div>
            </td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background-color:#f9fafb;padding:24px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <div style="color:#374151;font-size:13px;font-weight:600;margin-bottom:6px;">Kengi Tech</div>
          <div style="color:#9ca3af;font-size:12px;line-height:1.6;">
            Bán hàng vui như đi chơi 🎉<br>
            © ${year} Kengi Tech. Made with 💜 in Vietnam.
          </div>
        </td>
      </tr>
    </table>
    <p style="color:#9ca3af;font-size:12px;margin:16px 0 0;text-align:center;">Email này được gửi tự động 🤖 — bạn trả lời mình cũng không nghe được đâu nha 🙉</p>
  </td></tr>
</table>
</body>
</html>`
    return { subject, html, text }
}
