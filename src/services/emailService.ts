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
    const title = isReset ? 'Đặt lại mật khẩu' : 'Xác thực đăng nhập'
    const headerSubtitle = isReset ? 'Yêu cầu đặt lại mật khẩu' : 'Xác thực hai lớp (2FA)'
    const intro = isReset
        ? 'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Vui lòng sử dụng mã xác minh bên dưới để tiếp tục.'
        : 'Để bảo vệ tài khoản, vui lòng nhập mã xác minh bên dưới để hoàn tất đăng nhập.'
    const subject = isReset
        ? `Đặt lại mật khẩu Kengi Tech: ${code}`
        : `Mã xác thực đăng nhập Kengi Tech: ${code}`
    const text = `${title} - Kengi Tech\n\nMã xác minh của bạn: ${code}\n\nMã có hiệu lực trong 10 phút. Không chia sẻ với bất kỳ ai.\nNếu bạn không yêu cầu mã này, vui lòng bỏ qua email này.`
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
                <div style="color:#6d28d9;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">Mã xác minh của bạn</div>
                <div style="font-size:36px;font-weight:700;color:#4c1d95;letter-spacing:8px;font-family:'Courier New',Courier,monospace;">${spacedCode}</div>
              </div>
            </td></tr>
          </table>
          <p style="margin:28px 0 0;color:#6b7280;font-size:14px;text-align:center;line-height:1.6;">
            Mã có hiệu lực trong <strong style="color:#6d28d9;">10 phút</strong>.
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;">
            <tr><td style="background-color:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px;padding:14px 16px;">
              <div style="color:#92400e;font-size:13px;line-height:1.55;">
                <strong>Lưu ý bảo mật:</strong> Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email này. Tuyệt đối không chia sẻ mã với bất kỳ ai, kể cả nhân viên Kengi Tech.
              </div>
            </td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="background-color:#f9fafb;padding:24px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <div style="color:#374151;font-size:13px;font-weight:600;margin-bottom:6px;">Kengi Tech</div>
          <div style="color:#9ca3af;font-size:12px;line-height:1.6;">
            Giải pháp quản lý bán hàng thông minh<br>
            © ${year} Kengi Tech. Bảo lưu mọi quyền.
          </div>
        </td>
      </tr>
    </table>
    <p style="color:#9ca3af;font-size:12px;margin:16px 0 0;text-align:center;">Email tự động — vui lòng không trả lời email này.</p>
  </td></tr>
</table>
</body>
</html>`
    return { subject, html, text }
}
