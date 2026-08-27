// ═══════════════════════════════════════════════════════════════════════════════
//  NGUYỆT CÁC TAROT — đăng nhập Google + lưu lịch sử trải bài
//
//  Trang tarot (kengi.vn/tarot) là công cụ ĐỨNG RIÊNG, KHÔNG dùng chung tài khoản
//  với hệ bán lẻ: người xem bài không thuộc cửa hàng nào. Vì vậy:
//   • Đăng nhập bằng Google Identity Services (nút "Sign in with Google" ở trang),
//     trình duyệt gửi ID token lên đây, máy chủ tự xác minh chữ ký với Google.
//   • Sau khi xác minh, máy chủ phát JWT RIÊNG có `typ: 'tarot'`. Token cửa hàng
//     KHÔNG vào được API này và ngược lại — hai hệ tách hẳn nhau.
//   • Lịch sử trải bài lưu ở bảng registry TarotReading thay vì localStorage
//     (đổi máy hay xoá cache là mất sạch).
//
//  Bảng TarotUser/TarotReading nằm ở schema public (registry). Prod phải chạy
//  POST /api/admin/migrate một lần để tạo bảng trước khi các route dưới đây
//  dùng được.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { registryPrisma } from '../lib/prisma'
import { errMsg } from '../lib/errorResponse'
import { kiemTraYeuCau, luanGiai, kiemTraYeuCauCosmic, luanGiaiCosmic, kiemTraYeuCauChiTay, luanGiaiChiTay } from '../lib/tarotAi'

const router = Router()
const prisma = registryPrisma as any

const JWT_SECRET = process.env.JWT_SECRET || ''
const TOKEN_TTL = '30d'

/** Số lượt trải bài giữ lại cho mỗi người — cũ hơn thì dọn để bảng không phình. */
const MAX_READINGS_PER_USER = 200

/* Client ID Google được chấp nhận. Mặc định dùng chung client của Drive OAuth
 * (đã có sẵn trong env Cloud Run) để không phải thêm biến môi trường mới; đặt
 * TAROT_GOOGLE_CLIENT_ID nếu sau này muốn tách client riêng cho trang tarot.
 *
 * LƯU Ý VẬN HÀNH: client ID dùng cho nút đăng nhập phải khai "Authorized
 * JavaScript origins" = đúng origin của trang (https://kengi.vn) trong Google
 * Cloud Console, nếu không nút sẽ không hiện và console báo origin_mismatch. */
function googleClientIds(): string[] {
    return [process.env.TAROT_GOOGLE_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_ID]
        .map(v => (v || '').trim())
        .filter(Boolean)
}

function primaryClientId(): string {
    return googleClientIds()[0] || ''
}

// ─── Xác minh ID token Google ────────────────────────────────────────────────

interface GoogleProfile {
    sub: string
    email: string
    name?: string
    picture?: string
    locale?: string
}

async function verifyGoogleIdToken(credential: string): Promise<GoogleProfile> {
    const audience = googleClientIds()
    if (!audience.length) throw new Error('CHUA_CAU_HINH_GOOGLE')

    const { OAuth2Client } = await import('google-auth-library')
    const client = new OAuth2Client()
    const ticket = await client.verifyIdToken({ idToken: credential, audience })
    const payload = ticket.getPayload()

    if (!payload?.sub) throw new Error('TOKEN_KHONG_HOP_LE')
    // Google chỉ đảm bảo email đã xác minh khi email_verified = true. Không có
    // email thì vẫn cho vào (định danh đi theo `sub`), nhưng không được coi là
    // email tin cậy để hiển thị.
    if (payload.email && payload.email_verified === false) throw new Error('EMAIL_CHUA_XAC_MINH')

    return {
        sub: payload.sub,
        email: payload.email || '',
        name: payload.name || payload.given_name || '',
        picture: payload.picture || '',
        locale: (payload as any).locale || '',
    }
}

// ─── JWT riêng của tarot ─────────────────────────────────────────────────────

interface TarotAuthRequest extends Request {
    tarotUser?: { id: string; email: string; laKhach?: boolean }
}

/* ─── Danh tính KHÁCH VÃNG LAI ────────────────────────────────────────────────
 *
 * Trang không bắt đăng nhập nữa: ai vào cũng xem bài và xem chi tiết được, vẫn
 * ghi log đầy đủ. Khách được nhận diện bằng một mã tự sinh ở trình duyệt gửi
 * kèm header 'x-tarot-guest', lưu thành userId = 'guest:<mã>'.
 *
 * Mã này KHÔNG phải bằng chứng danh tính — xoá localStorage là có mã mới. Nó chỉ
 * để gom lịch sử của một máy lại với nhau. Việc chặn lạm dụng khoá AI dựa thêm
 * vào trần theo IP (xem aiDailyLimitIp). */
const TIEN_TO_KHACH = 'guest:'

function locMaKhach(v: any): string {
    const s = typeof v === 'string' ? v.trim() : ''
    // Chỉ nhận chữ/số/gạch, tối đa 64 ký tự — tránh nhét rác vào cột userId.
    return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : ''
}

function layIp(req: Request): string {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    return (xff || req.ip || '').slice(0, 60)
}

/** Cho qua cả người đã đăng nhập lẫn khách có mã. Không có gì thì 401. */
function tarotAuthMem(req: TarotAuthRequest, res: Response, next: NextFunction) {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''

    if (token && JWT_SECRET) {
        try {
            const payload = jwt.verify(token, JWT_SECRET) as any
            if (payload?.typ === 'tarot' && payload?.tarotUserId) {
                req.tarotUser = { id: String(payload.tarotUserId), email: String(payload.email || ''), laKhach: false }
                next()
                return
            }
        } catch { /* token hỏng/hết hạn → thử tiếp đường khách */ }
    }

    const ma = locMaKhach(req.headers['x-tarot-guest'])
    if (ma) {
        req.tarotUser = { id: TIEN_TO_KHACH + ma, email: '', laKhach: true }
        next()
        return
    }

    res.status(401).json({ error: 'Thiếu danh tính phiên. Hãy tải lại trang.' })
}

function issueToken(user: { id: string; email: string }): string {
    return jwt.sign({ tarotUserId: user.id, email: user.email, typ: 'tarot' }, JWT_SECRET, { expiresIn: TOKEN_TTL })
}

function tarotAuth(req: TarotAuthRequest, res: Response, next: NextFunction) {
    if (!JWT_SECRET) {
        res.status(500).json({ success: false, error: 'Máy chủ chưa cấu hình JWT_SECRET.' })
        return
    }
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token) {
        res.status(401).json({ success: false, error: 'Bạn cần đăng nhập để dùng chức năng này.' })
        return
    }
    try {
        const payload = jwt.verify(token, JWT_SECRET) as any
        // Chặn token của hệ bán lẻ dùng chéo sang đây (và ngược lại).
        if (payload?.typ !== 'tarot' || !payload?.tarotUserId) {
            res.status(401).json({ success: false, error: 'Phiên đăng nhập không hợp lệ.' })
            return
        }
        req.tarotUser = { id: String(payload.tarotUserId), email: String(payload.email || '') }
        next()
    } catch {
        res.status(401).json({ success: false, error: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' })
    }
}

// ─── Tiện ích ────────────────────────────────────────────────────────────────

function cleanText(value: any, max: number): string {
    if (typeof value !== 'string') return ''
    // Bỏ ký tự điều khiển (trừ xuống dòng/tab) để không lưu rác vào DB.
    let out = ""
    for (const ch of value) {
        const ma = ch.charCodeAt(0)
        // Bỏ ký tự điều khiển, giữ lại xuống dòng (10, 13) và tab (9).
        if (ma === 127) continue
        if (ma < 32 && ma !== 9 && ma !== 10 && ma !== 13) continue
        out += ch
    }
    return out.trim().slice(0, max)
}

/** Gói lá bài thành JSON gọn — chỉ giữ trường cần để hiển thị lại lịch sử. */
function packCards(value: any): string {
    const list = Array.isArray(value) ? value.slice(0, 8) : []
    const cards = list.map((card: any) => ({
        cardId: cleanText(card?.cardId, 40),
        name: cleanText(card?.name, 120),
        vi: cleanText(card?.vi ?? card?.vietnameseName, 120),
        position: cleanText(card?.position, 120),
        reversed: Boolean(card?.reversed),
        keys: Array.isArray(card?.keys) ? card.keys.slice(0, 6).map((k: any) => cleanText(k, 60)) : [],
    }))
    return JSON.stringify(cards)
}

/* Hàng rào trước khi tiêu khoá AI của chủ trang.
 *
 * Mở cho khách vãng lai nghĩa là ai cũng gọi được, nên phải chặn hai tầng:
 *   • theo danh tính (người đăng nhập hoặc mã khách) — aiDailyLimit
 *   • theo IP — aiDailyLimitIp, vì khách xoá localStorage là có mã mới ngay
 * Trả về chuỗi lỗi nếu chặn, null nếu cho qua. */
async function chanLamDung(cauHinh: any, req: TarotAuthRequest): Promise<string | null> {
    /* TÍNH NĂNG CHUYÊN SÂU (AI) LUÔN PHẢI ĐĂNG NHẬP.
     *
     * Xem bài, tính thần số học/tử vi/bản đồ sao thì mở tự do cho khách — phần
     * đó chạy ngay ở trình duyệt, không tốn gì của chủ trang. Còn luận giải AI
     * tiêu khoá DeepSeek/OpenAI thật, nên bắt buộc có tài khoản: vừa để đếm
     * đúng ai dùng bao nhiêu, vừa để một người xoá localStorage không thể lấy
     * danh tính mới rồi xin thêm lượt. */
    if (req.tarotUser?.laKhach) return 'DANG_NHAP'

    const dauNgay = new Date()
    dauNgay.setHours(0, 0, 0, 0)

    /* Bật thu credit thì trần theo NGƯỜI do thuPhiAi() lo (lượt miễn phí trong
     * ngày + credit đã mua). Giữ thêm aiDailyLimit ở đây nữa là người vừa trả
     * tiền xong vẫn bị chặn — mất tiền mà không xem được gì. Trần theo IP bên
     * dưới thì GIỮ NGUYÊN: nó bảo vệ hạ tầng, không phải bảo vệ ví. */
    const tran = cauHinh?.creditEnabled ? 0 : Number(cauHinh?.aiDailyLimit ?? 20)
    if (tran > 0) {
        const daDung = await prisma.tarotReading.count({
            where: { userId: req.tarotUser!.id, createdAt: { gte: dauNgay }, aiAnswer: { not: null } },
        }).catch(() => 0)
        if (daDung >= tran) return `Hôm nay bạn đã dùng hết ${tran} lượt luận giải AI. Mai quay lại nhé.`
    }

    const tranIp = Number(cauHinh?.aiDailyLimitIp ?? 60)
    const ip = layIp(req)
    if (tranIp > 0 && ip) {
        const daDungIp = await prisma.tarotReading.count({
            where: { ip, createdAt: { gte: dauNgay }, aiAnswer: { not: null } },
        }).catch(() => 0)
        if (daDungIp >= tranIp) {
            return `Mạng của bạn đã dùng hết ${tranIp} lượt luận giải AI hôm nay. Hãy quay lại vào ngày mai.`
        }
    }
    return null
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  CREDIT — thu tiền lượt luận giải AI, nạp bằng chuyển khoản QR VietQR
 *
 *  VÌ SAO TRỪ TIỀN Ở ĐÂY MÀ KHÔNG PHẢI Ở TRÌNH DUYỆT: bản chạy ở máy
 *  (nc_credits_dating.js) để trang tự gọi /api/credits/spend rồi mới gọi AI.
 *  Cách đó không giữ được tiền: mở DevTools gọi thẳng /api/tarot/ai-reading là
 *  xem chùa, credit chỉ còn là hình vẽ. Nên ở bản máy chủ này, trừ credit nằm
 *  TRONG chính đường đi của lượt AI — không có cửa nào vòng qua.
 *
 *  ĐỐI SOÁT LÀ DUYỆT TAY (chủ trang chốt 27/08/2026): không có webhook ngân
 *  hàng nào cộng credit tự động. VietQR chỉ sinh ảnh mã QR, nó KHÔNG biết tiền
 *  đã về hay chưa — muốn tự động phải mua thêm dịch vụ đọc biến động số dư.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Bảng gói mặc định; chủ trang sửa được ở admin (lưu JSON vào creditPackages). */
const GOI_NAP_MAC_DINH = [
    { id: 'nc5', vnd: 10000, credits: 5 },
    { id: 'nc18', vnd: 30000, credits: 18 },
    { id: 'nc35', vnd: 50000, credits: 35 },
    { id: 'nc80', vnd: 100000, credits: 80 },
]

/** Giá một lượt theo tính năng. Đồng giá, tách ra để sau này chỉnh riêng được. */
const GIA_LUOT: Record<string, number> = { tarot: 1, cosmic: 1, palm: 1 }

/** Bảng gói đang hiệu lực — JSON hỏng thì lùi về bảng mặc định, không để trang trắng. */
function layGoiNap(cauHinh: any): Array<{ id: string; vnd: number; credits: number }> {
    const raw = parseJson(cauHinh?.creditPackages)
    if (!Array.isArray(raw) || !raw.length) return GOI_NAP_MAC_DINH
    const sach = raw
        .map((g: any) => ({
            id: cleanText(g?.id, 20),
            vnd: Math.round(Number(g?.vnd)),
            credits: Math.round(Number(g?.credits)),
        }))
        .filter(g => g.id && Number.isFinite(g.vnd) && g.vnd > 0 && Number.isFinite(g.credits) && g.credits > 0)
        .slice(0, 8)
    return sach.length ? sach : GOI_NAP_MAC_DINH
}

/** Đủ hai mảnh (BIN + số tài khoản) mới dựng được QR; thiếu là không mở nạp được. */
function coTaiKhoanNhan(cauHinh: any): boolean {
    return !!(String(cauHinh?.bankBin || '').trim() && String(cauHinh?.bankAccountNo || '').trim())
}

/* Ảnh QR do img.vietqr.io dựng — miễn phí, không cần khoá. Nhúng sẵn số tiền và
 * nội dung nên người nạp không phải gõ tay, đỡ sai mã rồi mất công tra. */
function anhQrVietQr(cauHinh: any, soTien: number, noiDung: string): string {
    const bin = String(cauHinh?.bankBin || '').trim()
    const stk = String(cauHinh?.bankAccountNo || '').trim()
    if (!bin || !stk) return ''
    const q = new URLSearchParams({
        amount: String(Math.round(soTien)),
        addInfo: noiDung,
        accountName: String(cauHinh?.bankAccountName || '').trim(),
    })
    return `https://img.vietqr.io/image/${bin}-${stk}-compact2.png?${q.toString()}`
}

/** Đầu ngày hôm nay theo giờ máy chủ — dùng chung cho mọi phép đếm theo ngày. */
function dauNgayHomNay(): Date {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
}

/* Số lượt AI đã phục vụ trong ngày, đếm từ SỔ CÁI chứ không từ TarotReading.
 *
 * TarotReading chỉ có dòng khi trang chủ động gọi POST /readings để lưu; lượt
 * nào trang không lưu là phép đếm hụt — với hạn mức miễn phí thì hụt vài lượt
 * không chết ai, nhưng với tiền thì hụt nghĩa là KHÔNG BAO GIỜ thu được đồng
 * nào. Mỗi lượt AI ở đây luôn ghi một dòng sổ (miễn phí ghi delta = 0). */
async function soLuotAiHomNay(userId: string): Promise<number> {
    return await prisma.tarotCreditLedger.count({
        where: {
            userId,
            createdAt: { gte: dauNgayHomNay() },
            OR: [{ reason: { startsWith: 'free:' } }, { reason: { startsWith: 'spend:' } }],
        },
    })
}

interface KetQuaThuPhi {
    /** Có nội dung là CHẶN, đem trả thẳng cho người xem. */
    chan?: string
    ma?: string
    status?: number
    /** Gọi khi AI hỏng: trả lại credit và xoá dòng sổ, coi như lượt này chưa xảy ra. */
    hoanLai?: () => Promise<void>
}

/* Cổng vào của MỌI lượt luận giải AI: chặn lạm dụng, rồi thu tiền nếu đang bật.
 *
 * Thứ tự có chủ ý — kiểm tra rẻ trước, ghi đĩa sau cùng — để lượt bị chặn không
 * tốn một vòng ghi nào (pool DB chỉ 1 kết nối). */
async function thuPhiAi(cauHinh: any, req: TarotAuthRequest, tinhNang: string): Promise<KetQuaThuPhi> {
    const chan = await chanLamDung(cauHinh, req)
    if (chan === 'DANG_NHAP') return { chan: 'DANG_NHAP', ma: 'CAN_DANG_NHAP', status: 401 }
    if (chan) return { chan, status: 429 }

    // Công tắc tắt → trang chạy y hệt như trước khi có credit.
    if (!cauHinh?.creditEnabled) return {}

    const userId = req.tarotUser!.id
    const gia = GIA_LUOT[tinhNang] ?? 1

    /* Bảng credit chưa tạo (chưa chạy migrate-tarot) thì KHÔNG được chặn người
     * xem: bật nhầm công tắc mà cả trang tắt AI là hỏng chuyện lớn hơn nhiều so
     * với vài lượt xem không thu được tiền. Kêu vào log cho chủ trang thấy. */
    let daDung: number
    try {
        daDung = await soLuotAiHomNay(userId)
    } catch (e: any) {
        console.error('[tarot] BẬT credit nhưng chưa có bảng — gọi POST /api/admin/migrate-tarot:', e?.message)
        return {}
    }

    const soFree = Math.max(0, Number(cauHinh?.freeDailyLimit ?? 3))
    if (daDung < soFree) {
        // Lượt miễn phí vẫn ghi sổ (delta = 0) để lần sau đếm đúng.
        await ghiSo(userId, 0, `free:${tinhNang}`, await soDuCua(userId), null)
        return { hoanLai: () => xoaSoGanNhat(userId, `free:${tinhNang}`) }
    }

    /* TRỪ CREDIT ATOMIC — điều kiện balance >= giá nằm trong chính câu UPDATE.
     * Hai tab bấm cùng lúc thì câu thứ hai không khớp điều kiện nữa và trả về
     * count = 0; không có cửa nào tiêu quá số dư. Đừng thay bằng đọc-rồi-ghi. */
    const tru = await prisma.tarotCreditAccount.updateMany({
        where: { userId, balance: { gte: gia } },
        data: { balance: { decrement: gia } },
    })
    if (!tru.count) {
        return {
            chan: soFree > 0
                ? `Bạn đã dùng hết ${soFree} lượt miễn phí hôm nay. Nạp thêm credit để xem tiếp nhé.`
                : 'Bạn chưa đủ credit cho lượt luận giải này. Nạp thêm rồi thử lại nhé.',
            ma: 'KHONG_DU_CREDIT',
            status: 402,
        }
    }

    await ghiSo(userId, -gia, `spend:${tinhNang}`, await soDuCua(userId), null)

    return {
        hoanLai: async () => {
            /* AI hỏng thì lượt này coi như chưa từng xảy ra: trả credit VÀ xoá
             * dòng sổ. Giữ dòng sổ lại là người xem mất một lượt miễn phí trong
             * ngày chỉ vì máy chủ AI trục trặc. */
            await prisma.tarotCreditAccount.updateMany({
                where: { userId },
                data: { balance: { increment: gia } },
            }).catch(() => null)
            await xoaSoGanNhat(userId, `spend:${tinhNang}`)
        },
    }
}

async function soDuCua(userId: string): Promise<number> {
    const tk = await prisma.tarotCreditAccount.findUnique({ where: { userId } }).catch(() => null)
    return Number(tk?.balance ?? 0)
}

async function ghiSo(userId: string, delta: number, reason: string, balance: number, orderId: string | null) {
    // Sổ hỏng thì KHÔNG được làm gãy lượt xem — số dư đã đổi ở bảng tài khoản rồi.
    await prisma.tarotCreditLedger.create({
        data: { userId, delta, reason, balance, orderId },
    }).catch((e: any) => console.error('[tarot] không ghi được sổ credit:', e?.message))
}

async function xoaSoGanNhat(userId: string, reason: string) {
    const dong = await prisma.tarotCreditLedger.findFirst({
        where: { userId, reason },
        orderBy: { createdAt: 'desc' },
    }).catch(() => null)
    if (dong) await prisma.tarotCreditLedger.delete({ where: { id: dong.id } }).catch(() => null)
}

/** "NC" + 6 số — đủ ngắn để gõ tay vào nội dung chuyển khoản mà không sai. */
function maNoiDungMoi(): string {
    let ra = 'NC'
    for (let i = 0; i < 6; i += 1) ra += Math.floor(Math.random() * 10)
    return ra
}

/** "Nguyễn Minh Anh (17/03/1995 12:00)" — đủ để nhận ra xem cho ai. */
function moTaChuLaSo(ctx: any): string | null {
    if (!ctx || typeof ctx !== 'object') return null
    const ten = cleanText(ctx.name, 100)
    const ngay = cleanText(ctx.birthDate, 20)
    const gio = cleanText(ctx.birthTime, 10)
    const phu = [ngay.split('-').reverse().join('/'), gio].filter(Boolean).join(' ')
    if (!ten && !phu) return null
    return (ten ? ten : 'Không ghi tên') + (phu ? ` (${phu})` : '')
}

function parseJson(value: any) {
    if (typeof value !== 'string' || !value) return null
    try { return JSON.parse(value) } catch { return null }
}

function readingRa(row: any) {
    return {
        id: row.id,
        tool: row.tool || 'tarot',
        question: row.question,
        readerName: row.readerName || '',
        topic: row.topic || '',
        spread: row.spread,
        cards: parseJson(row.cards) || [],
        summary: row.summary || '',
        aiAnswer: row.aiAnswer || '',
        aiReading: parseJson(row.aiReading),
        aiModel: row.aiModel || '',
        createdAt: row.createdAt,
    }
}

/* Bảng tarot nằm ở registry và chỉ được tạo sau khi chạy /api/admin/migrate.
 * Nếu chưa chạy, Prisma ném P2021 (table does not exist) — trả lời rõ ràng thay
 * vì để trang báo "lỗi máy chủ" khó đoán. */
function loiDb(e: any, res: Response, fallback: string) {
    if (e?.code === 'P2021' || /does not exist/i.test(String(e?.message || ''))) {
        res.status(503).json({
            success: false,
            error: 'Máy chủ chưa tạo bảng dữ liệu tarot. Quản trị viên cần gọi POST /api/admin/migrate một lần.',
            code: 'CHUA_MIGRATE',
        })
        return
    }
    console.error('[tarot]', fallback, e?.message)
    res.status(500).json({ success: false, error: errMsg(e, fallback) })
}

// ─── GET /api/tarot/config — trang tự lấy client ID, không hardcode trong HTML ─

router.get('/config', async (_req: Request, res: Response) => {
    // Trang cần biết AI có sẵn không để hiện đúng thông báo thay vì để người xem
    // bấm rồi mới nhận lỗi. Bảng chưa tạo thì coi như chưa bật, không phải lỗi.
    let aiEnabled = false
    let batBuocDangNhap = false
    let thuCredit = false
    let soFree = 0
    try {
        const cf: any = await prisma.tarotSetting.findUnique({ where: { id: 'default' } })
        aiEnabled = !!cf?.openaiApiKey
        batBuocDangNhap = !!cf?.requireLogin
        thuCredit = !!cf?.creditEnabled
        soFree = Math.max(0, Number(cf?.freeDailyLimit ?? 3))
    } catch { /* chưa migrate → chưa bật */ }

    res.json({
        success: true,
        data: {
            googleClientId: primaryClientId(),
            loginEnabled: !!(primaryClientId() && JWT_SECRET),
            aiEnabled,
            // Mặc định KHÔNG bắt đăng nhập — trang mở cho khách vãng lai, chỉ
            // bật cờ này ở admin khi muốn siết lại.
            requireLogin: !!batBuocDangNhap,
            /* Trang dựa vào cờ này để hiện (hay giấu) chip credit. Tắt thì
             * người xem không thấy bóng dáng chuyện tiền nong ở đâu cả. */
            creditEnabled: thuCredit,
            freeDailyLimit: soFree,
        },
    })
})

// ─── POST /api/tarot/auth/google — đổi ID token Google lấy phiên tarot ───────

router.post('/auth/google', async (req: Request, res: Response) => {
    const credential = cleanText(req.body?.credential, 4096)
    if (!credential) {
        res.status(400).json({ success: false, error: 'Thiếu mã đăng nhập Google.' })
        return
    }
    if (!JWT_SECRET) {
        res.status(500).json({ success: false, error: 'Máy chủ chưa cấu hình JWT_SECRET.' })
        return
    }

    let profile: GoogleProfile
    try {
        profile = await verifyGoogleIdToken(credential)
    } catch (e: any) {
        const ma = String(e?.message || '')
        if (ma === 'CHUA_CAU_HINH_GOOGLE') {
            res.status(503).json({ success: false, error: 'Máy chủ chưa cấu hình Google Client ID cho trang tarot.' })
            return
        }
        if (ma === 'EMAIL_CHUA_XAC_MINH') {
            res.status(403).json({ success: false, error: 'Email Google này chưa được xác minh.' })
            return
        }
        console.warn('[tarot] xác minh Google thất bại:', ma)
        res.status(401).json({ success: false, error: 'Không xác minh được tài khoản Google. Hãy thử đăng nhập lại.' })
        return
    }

    try {
        const now = new Date()
        const user = await prisma.tarotUser.upsert({
            where: { googleSub: profile.sub },
            create: {
                googleSub: profile.sub,
                email: profile.email,
                name: profile.name || null,
                picture: profile.picture || null,
                locale: profile.locale || null,
                lastLoginAt: now,
            },
            // Tên/ảnh đại diện đổi bên Google thì cập nhật theo, khỏi phải sửa tay.
            update: {
                email: profile.email,
                name: profile.name || null,
                picture: profile.picture || null,
                locale: profile.locale || null,
                lastLoginAt: now,
            },
        })

        /* Gộp lịch sử đã xem lúc chưa đăng nhập vào tài khoản vừa đăng nhập.
         * Không có bước này thì đăng nhập xong là "mất" hết những lượt vừa xem —
         * chúng vẫn nằm trong DB nhưng gắn với mã khách, không ai thấy nữa. */
        let daGop = 0
        const maKhach = locMaKhach(req.body?.guestId)
        if (maKhach) {
            try {
                const kq = await prisma.tarotReading.updateMany({
                    where: { userId: TIEN_TO_KHACH + maKhach },
                    data: { userId: user.id },
                })
                daGop = kq.count
            } catch { /* gộp hỏng không được chặn đăng nhập */ }
        }

        res.json({
            success: true,
            data: {
                token: issueToken(user),
                user: { id: user.id, email: user.email, name: user.name || '', picture: user.picture || '' },
                daGopLuot: daGop,
            },
        })
    } catch (e: any) {
        loiDb(e, res, 'Không lưu được tài khoản tarot.')
    }
})

// ─── GET /api/tarot/me — trang kiểm tra phiên còn hiệu lực khi tải lại ───────

// /me chỉ dành cho tài khoản thật — khách vãng lai không có hồ sơ để trả về.
router.get('/me', tarotAuth, async (req: TarotAuthRequest, res: Response) => {
    try {
        const user = await prisma.tarotUser.findUnique({ where: { id: req.tarotUser!.id } })
        if (!user) {
            res.status(401).json({ success: false, error: 'Tài khoản không còn tồn tại.' })
            return
        }
        const soLuot = await prisma.tarotReading.count({ where: { userId: user.id } }).catch(() => 0)
        res.json({
            success: true,
            data: {
                user: { id: user.id, email: user.email, name: user.name || '', picture: user.picture || '' },
                soLuot,
            },
        })
    } catch (e: any) {
        loiDb(e, res, 'Không đọc được tài khoản.')
    }
})

// ─── POST /api/tarot/visit — ghi một lượt TRUY CẬP trang ─────────────────────
//
// Không cần đăng nhập, không chặn gì: mục đích chỉ là đếm có bao nhiêu người
// vào. Ghi hỏng cũng trả 200 — không đáng để một lỗi thống kê làm hỏng trải
// nghiệm người xem.

router.post('/visit', async (req: TarotAuthRequest, res: Response) => {
    try {
        const ma = locMaKhach(req.headers['x-tarot-guest'])
        let userId: string | null = ma ? TIEN_TO_KHACH + ma : null

        // Đã đăng nhập thì ghi theo tài khoản để biết khách quen hay người mới.
        const header = req.headers.authorization || ''
        const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
        if (token && JWT_SECRET) {
            try {
                const payload = jwt.verify(token, JWT_SECRET) as any
                if (payload?.typ === 'tarot' && payload?.tarotUserId) userId = String(payload.tarotUserId)
            } catch { /* token hỏng → cứ ghi theo mã khách */ }
        }

        await prisma.tarotVisit.create({
            data: {
                userId,
                ip: layIp(req) || null,
                tool: cleanText(req.body?.tool, 30) || 'tarot',
                userAgent: cleanText(req.headers['user-agent'], 300) || null,
            },
        })
    } catch (e: any) {
        if (!(e?.code === 'P2021' || /does not exist/i.test(String(e?.message || '')))) {
            console.error('[tarot] ghi lượt truy cập:', e?.message)
        }
    }
    res.json({ success: true })
})

// ─── GET /api/tarot/readings — lịch sử trải bài ──────────────────────────────

router.get('/readings', tarotAuthMem, async (req: TarotAuthRequest, res: Response) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)
        /* Mặc định chỉ trả lượt TAROT: bảng lịch sử của trang tarot in tên lá,
         * mà bản "xem chi tiết" của thần số học/tử vi không có lá nào. Muốn lấy
         * loại khác thì ?tool=numerology, hoặc ?tool=all cho tất cả. */
        const tool = String(req.query.tool || 'tarot')
        const rows = await prisma.tarotReading.findMany({
            where: { userId: req.tarotUser!.id, ...(tool === 'all' ? {} : { tool }) },
            orderBy: { createdAt: 'desc' },
            take: limit,
        })
        res.json({ success: true, data: rows.map(readingRa) })
    } catch (e: any) {
        loiDb(e, res, 'Không đọc được lịch sử trải bài.')
    }
})

// ─── POST /api/tarot/readings — lưu một lượt trải bài ────────────────────────

router.post('/readings', tarotAuthMem, async (req: TarotAuthRequest, res: Response) => {
    try {
        const question = cleanText(req.body?.question, 2000)
        const cards = packCards(req.body?.cards)

        /* `tool` cho phép lưu cả lượt TÍNH CHỈ SỐ của thần số học / tử vi / bản
         * đồ sao, không chỉ trải bài tarot. Ba công cụ kia không có lá bài nào
         * nên chỉ bắt buộc có lá khi tool = 'tarot'. */
        const CONG_CU = ['tarot', 'numerology', 'tuvi', 'birth-chart', 'photobooth', 'love', 'laso', 'palm', 'calendar']
        const toolVao = cleanText(req.body?.tool, 30) || 'tarot'
        const tool = CONG_CU.includes(toolVao) ? toolVao : 'tarot'

        if (tool === 'tarot' && JSON.parse(cards).length === 0) {
            res.status(400).json({ success: false, error: 'Chưa có lá bài nào để lưu.' })
            return
        }

        const row = await prisma.tarotReading.create({
            data: {
                userId: req.tarotUser!.id,
                ip: layIp(req) || null,
                tool,
                question: question || (tool === 'tarot' ? 'Thông điệp tổng quan' : `Xem ${tool}`),
                readerName: cleanText(req.body?.readerName, 100) || null,
                topic: cleanText(req.body?.topic, 60) || null,
                spread: cleanText(req.body?.spread, 40) || tool,
                cards,
                summary: cleanText(req.body?.summary, 4000) || null,
            },
        })

        /* Dọn phần vượt hạn mức. Xoá theo danh sách id lấy được thay vì
         * `skip` trong deleteMany (Prisma không hỗ trợ skip khi xoá). */
        try {
            const thua = await prisma.tarotReading.findMany({
                where: { userId: req.tarotUser!.id },
                orderBy: { createdAt: 'desc' },
                skip: MAX_READINGS_PER_USER,
                select: { id: true },
            })
            if (thua.length) {
                await prisma.tarotReading.deleteMany({ where: { id: { in: thua.map((r: any) => r.id) } } })
            }
        } catch { /* dọn hỏng không được chặn việc lưu */ }

        res.json({ success: true, data: readingRa(row) })
    } catch (e: any) {
        loiDb(e, res, 'Không lưu được lượt trải bài.')
    }
})

// ─── PATCH /api/tarot/readings/:id — gắn luận giải AI vào lượt đã lưu ────────
// Luận giải AI về SAU khi lá bài đã lật xong nên lưu làm hai nhịp.

router.patch('/readings/:id', tarotAuthMem, async (req: TarotAuthRequest, res: Response) => {
    try {
        const row = await prisma.tarotReading.findUnique({ where: { id: req.params.id } })
        if (!row || row.userId !== req.tarotUser!.id) {
            res.status(404).json({ success: false, error: 'Không tìm thấy lượt trải bài.' })
            return
        }

        const data: any = {}
        if (req.body?.aiAnswer !== undefined) data.aiAnswer = cleanText(req.body.aiAnswer, 40000) || null
        if (req.body?.aiReading !== undefined) {
            data.aiReading = req.body.aiReading ? JSON.stringify(req.body.aiReading).slice(0, 60000) : null
        }
        if (req.body?.aiModel !== undefined) data.aiModel = cleanText(req.body.aiModel, 80) || null
        if (req.body?.summary !== undefined) data.summary = cleanText(req.body.summary, 4000) || null
        if (!Object.keys(data).length) {
            res.status(400).json({ success: false, error: 'Không có gì để cập nhật.' })
            return
        }

        const updated = await prisma.tarotReading.update({ where: { id: row.id }, data })
        res.json({ success: true, data: readingRa(updated) })
    } catch (e: any) {
        loiDb(e, res, 'Không cập nhật được lượt trải bài.')
    }
})

// ─── DELETE /api/tarot/readings/:id — xoá một lượt ───────────────────────────

router.delete('/readings/:id', tarotAuthMem, async (req: TarotAuthRequest, res: Response) => {
    try {
        const kq = await prisma.tarotReading.deleteMany({
            where: { id: req.params.id, userId: req.tarotUser!.id },
        })
        if (!kq.count) {
            res.status(404).json({ success: false, error: 'Không tìm thấy lượt trải bài.' })
            return
        }
        res.json({ success: true, data: { deleted: kq.count } })
    } catch (e: any) {
        loiDb(e, res, 'Không xoá được lượt trải bài.')
    }
})

// ─── POST /api/tarot/ai-reading — luận giải AI (khoá nhập ở admin) ───────────
//
// Nhà cung cấp chọn ở admin: OpenAI hoặc DeepSeek (xem src/lib/tarotAi.ts).
// BẮT BUỘC đăng nhập: khoá là của chủ trang, để mở thì ai cũng đốt được
// hạn mức. Thêm trần lượt/ngày cho mỗi người vì cùng lý do.

router.post('/ai-reading', tarotAuthMem, async (req: TarotAuthRequest, res: Response) => {
    let yeuCau
    try {
        yeuCau = kiemTraYeuCau(req.body)
    } catch (e: any) {
        res.status(e?.status || 400).json({ error: e?.message || 'Dữ liệu trải bài không hợp lệ.' })
        return
    }

    let cauHinh: any
    try {
        cauHinh = await prisma.tarotSetting.findUnique({ where: { id: 'default' } })
    } catch (e: any) {
        if (e?.code === 'P2021' || /does not exist/i.test(String(e?.message || ''))) {
            res.status(503).json({ error: 'Máy chủ chưa tạo bảng cấu hình tarot. Quản trị viên gọi POST /api/admin/migrate-tarot.' })
            return
        }
        console.error('[tarot] đọc cấu hình AI:', e?.message)
        res.status(500).json({ error: 'Không đọc được cấu hình AI.' })
        return
    }

    if (!cauHinh?.openaiApiKey) {
        // Gọi tên đúng nhà cung cấp đang chọn — báo "OpenAI" khi chủ trang dùng
        // DeepSeek chỉ khiến người ta đi tìm nhầm chỗ.
        const tenNha = String(cauHinh?.provider || 'openai').toLowerCase() === 'deepseek' ? 'DeepSeek' : 'OpenAI'
        res.status(503).json({ error: `Trang chưa được nhập ${tenNha} API key. Chủ trang vào kengi.vn/admin → tab Tarot để nhập.` })
        return
    }

    /* Thu tiền TRƯỚC khi gọi AI: gọi xong mới trừ thì lượt nào máy chủ AI trả
     * chậm rồi người xem đóng tab là mất trắng một lượt không ai trả. Hỏng thì
     * hoàn lại ở khối catch bên dưới. */
    const phi = await thuPhiAi(cauHinh, req, 'tarot')
    if (phi.ma === 'CAN_DANG_NHAP') {
        res.status(401).json({ error: 'Phần luận giải AI cần đăng nhập. Bấm Đăng nhập ở góc trên rồi thử lại.', code: 'CAN_DANG_NHAP' })
        return
    }
    if (phi.chan) {
        res.status(phi.status || 429).json({ error: phi.chan, code: phi.ma })
        return
    }

    try {
        const kq = await luanGiai(yeuCau, {
            apiKey: cauHinh.openaiApiKey,
            provider: cauHinh.provider,
            model: cauHinh.model,
            reasoningEffort: cauHinh.reasoningEffort,
        })
        // Trả đúng hình dạng trang đang chờ (giống tarot-server.js chạy ở máy).
        res.json(kq)
    } catch (e: any) {
        // Không xem được thì không lấy tiền — trả credit lại ngay.
        await phi.hoanLai?.().catch(() => null)
        const status = Number(e?.status) || 500
        if (status >= 500) console.error('[tarot] luận giải AI hỏng:', e?.message)
        res.status(status).json({ error: e?.message || 'Không luận giải được.' })
    }
})

// ─── POST /api/tarot/cosmic-reading — "Xem chi tiết" của 3 công cụ kia ───────
//
// HỢP ĐỒNG DO TRANG ĐỊNH SẴN, KHÔNG ĐƯỢC ĐỔI: cosmic-tools.js gửi lên
// {view, focus, context, localReading} và dựng DOM từ payload.reading với đúng
// các khoá headline / synthesis / chapters[] / timing / actionPlan / reflection
// / safetyNote. Đổi tên khoá ở đây là phần "Xem chi tiết" trắng bóc mà không
// báo lỗi gì.

router.post('/cosmic-reading', tarotAuthMem, async (req: TarotAuthRequest, res: Response) => {
    let yeuCau
    try {
        yeuCau = kiemTraYeuCauCosmic(req.body)
    } catch (e: any) {
        res.status(e?.status || 400).json({ error: e?.message || 'Dữ liệu chưa hợp lệ.' })
        return
    }

    let cauHinh: any
    try {
        cauHinh = await prisma.tarotSetting.findUnique({ where: { id: 'default' } })
    } catch (e: any) {
        if (e?.code === 'P2021' || /does not exist/i.test(String(e?.message || ''))) {
            res.status(503).json({ error: 'Máy chủ chưa tạo bảng cấu hình. Quản trị viên gọi POST /api/admin/migrate-tarot.' })
            return
        }
        console.error('[tarot] đọc cấu hình AI (cosmic):', e?.message)
        res.status(500).json({ error: 'Không đọc được cấu hình AI.' })
        return
    }
    if (!cauHinh?.openaiApiKey) {
        const tenNha = String(cauHinh?.provider || 'openai').toLowerCase() === 'deepseek' ? 'DeepSeek' : 'OpenAI'
        res.status(503).json({ error: `Trang chưa được nhập ${tenNha} API key. Chủ trang vào kengi.vn/admin → tab Tarot để nhập.` })
        return
    }

    // Trần lượt và ví credit dùng CHUNG với tarot — cùng một hạn mức API của chủ trang.
    const phi = await thuPhiAi(cauHinh, req, 'cosmic')
    if (phi.ma === 'CAN_DANG_NHAP') {
        res.status(401).json({ error: 'Phần xem chi tiết cần đăng nhập. Bấm Đăng nhập ở góc trên rồi thử lại.', code: 'CAN_DANG_NHAP' })
        return
    }
    if (phi.chan) {
        res.status(phi.status || 429).json({ error: phi.chan, code: phi.ma })
        return
    }

    try {
        const kq = await luanGiaiCosmic(yeuCau, {
            apiKey: cauHinh.openaiApiKey,
            provider: cauHinh.provider,
            model: cauHinh.model,
            reasoningEffort: cauHinh.reasoningEffort,
        })

        /* LƯU LẠI cho người xem — bản chi tiết tốn tiền gọi AI, mất là mất hẳn.
         * Lưu hỏng thì vẫn trả bài về, không để lỗi ghi đĩa cướp mất kết quả
         * người ta vừa chờ cả phút. */
        try {
            /* Lượt TÍNH CHỈ SỐ đã tạo một dòng khi người dùng bấm "Tính"; bản
             * xem chi tiết là phần bổ sung cho chính lượt đó, KHÔNG phải lượt
             * mới. Gắn vào dòng gần nhất cùng công cụ, chưa có AI, trong 2 giờ
             * — không thì thống kê đếm gấp đôi. */
            const gan = await prisma.tarotReading.findFirst({
                where: {
                    userId: req.tarotUser!.id,
                    tool: yeuCau.view,
                    aiAnswer: null,
                    createdAt: { gte: new Date(Date.now() - 2 * 3600 * 1000) },
                },
                orderBy: { createdAt: 'desc' },
                select: { id: true },
            })

            if (gan) {
                await prisma.tarotReading.update({
                    where: { id: gan.id },
                    data: {
                        question: yeuCau.focus || `Xem chi tiết ${yeuCau.view}`,
                        aiAnswer: kq.answer.slice(0, 40000),
                        aiReading: JSON.stringify(kq.reading).slice(0, 60000),
                        aiModel: kq.model,
                    },
                })
                res.json({ reading: kq.reading, model: kq.model })
                return
            }

            await prisma.tarotReading.create({
                data: {
                    userId: req.tarotUser!.id,
                    ip: layIp(req) || null,
                    tool: yeuCau.view,
                    question: yeuCau.focus || `Xem chi tiết ${yeuCau.view}`,
                    /* CHỦ LÁ SỐ, không phải người đăng nhập — một tài khoản có
                     * thể xem cho nhiều người. Kèm ngày sinh để phân biệt hai
                     * người trùng tên. */
                    readerName: moTaChuLaSo(yeuCau.context),
                    topic: yeuCau.view,
                    spread: yeuCau.view,
                    cards: JSON.stringify([]),
                    summary: yeuCau.localReading.slice(0, 4000) || null,
                    aiAnswer: kq.answer.slice(0, 40000),
                    aiReading: JSON.stringify(kq.reading).slice(0, 60000),
                    aiModel: kq.model,
                },
            })
        } catch (e: any) {
            console.error('[tarot] không lưu được bản xem chi tiết:', e?.message)
        }

        res.json({ reading: kq.reading, model: kq.model })
    } catch (e: any) {
        const status = Number(e?.status) || 500
        await phi.hoanLai?.().catch(() => null)
        if (status >= 500) console.error('[tarot] xem chi tiết hỏng:', e?.message)
        res.status(status).json({ error: e?.message || 'Chưa thể mở phần xem chi tiết.' })
    }
})

// ─── POST /api/tarot/palm-reading — AI NHÌN ảnh lòng bàn tay ─────────────────
//
// Khác mọi endpoint AI khác: ở đây AI phải tự nhìn ảnh, nên dùng khoá THỊ GIÁC
// riêng (OpenAI/Gemini) chứ không phải khoá chữ — DeepSeek không xem được ảnh.

router.post('/palm-reading', tarotAuthMem, async (req: TarotAuthRequest, res: Response) => {
    let yeuCau
    try {
        yeuCau = kiemTraYeuCauChiTay(req.body)
    } catch (e: any) {
        res.status(e?.status || 400).json({ error: e?.message || 'Dữ liệu chưa hợp lệ.' })
        return
    }

    let cauHinh: any
    try {
        cauHinh = await prisma.tarotSetting.findUnique({ where: { id: 'default' } })
    } catch (e: any) {
        if (e?.code === 'P2021' || /does not exist/i.test(String(e?.message || ''))) {
            res.status(503).json({ error: 'Máy chủ chưa tạo bảng cấu hình. Quản trị viên gọi POST /api/admin/migrate-tarot.' })
            return
        }
        console.error('[tarot] đọc cấu hình thị giác:', e?.message)
        res.status(500).json({ error: 'Không đọc được cấu hình AI.' })
        return
    }

    const phi = await thuPhiAi(cauHinh, req, 'palm')
    if (phi.ma === 'CAN_DANG_NHAP') {
        res.status(401).json({ error: 'Xem chỉ tay bằng AI cần đăng nhập. Bấm Đăng nhập ở góc trên rồi thử lại.', code: 'CAN_DANG_NHAP' })
        return
    }
    if (phi.chan) {
        res.status(phi.status || 429).json({ error: phi.chan, code: phi.ma })
        return
    }

    try {
        const kq = await luanGiaiChiTay(yeuCau, {
            visionProvider: cauHinh.visionProvider,
            visionApiKey: cauHinh.visionApiKey,
            visionModel: cauHinh.visionModel,
        })

        /* Lưu bản đọc — KHÔNG lưu tấm ảnh.
         * Ảnh lòng bàn tay là dữ liệu sinh trắc của người ta; giữ lại chỉ để
         * thống kê là cái giá quá đắt so với lợi ích. Chỉ lưu phần chữ. */
        try {
            await prisma.tarotReading.create({
                data: {
                    userId: req.tarotUser!.id,
                    ip: layIp(req) || null,
                    tool: 'palm',
                    question: yeuCau.focus || 'Xem chỉ tay',
                    readerName: yeuCau.ten || null,
                    topic: 'palm',
                    spread: yeuCau.banTay,
                    cards: JSON.stringify([]),
                    summary: yeuCau.banDoc.slice(0, 4000) || null,
                    aiAnswer: kq.answer.slice(0, 40000),
                    aiReading: JSON.stringify(kq.reading).slice(0, 60000),
                    aiModel: kq.model,
                },
            })
        } catch (e: any) {
            console.error('[tarot] không lưu được bản xem chỉ tay:', e?.message)
        }

        res.json({ reading: kq.reading, model: kq.model })
    } catch (e: any) {
        const status = Number(e?.status) || 500
        await phi.hoanLai?.().catch(() => null)
        if (status >= 500) console.error('[tarot] xem chỉ tay hỏng:', e?.message)
        res.status(status).json({ error: e?.message || 'Chưa thể xem chỉ tay lúc này.' })
    }
})

// ─── DELETE /api/tarot/readings — xoá toàn bộ lịch sử của chính mình ─────────

router.delete('/readings', tarotAuthMem, async (req: TarotAuthRequest, res: Response) => {
    try {
        const kq = await prisma.tarotReading.deleteMany({ where: { userId: req.tarotUser!.id } })
        res.json({ success: true, data: { deleted: kq.count } })
    } catch (e: any) {
        loiDb(e, res, 'Không xoá được lịch sử trải bài.')
    }
})

/* ═══════════════════════════════════════════════════════════════════════════
 *  API CREDIT CHO TRANG XEM
 *
 *  Đều đòi ĐĂNG NHẬP THẬT (tarotAuth, không phải tarotAuthMem): credit là tiền
 *  của người ta. Gắn số dư vào mã khách trong localStorage thì xoá cache một
 *  cái là mất, mà không có đường nào chứng minh để trả lại.
 * ═══════════════════════════════════════════════════════════════════════════ */

// ─── GET /api/tarot/credits/me — số dư, lượt free còn lại, bảng gói ─────────

router.get('/credits/me', tarotAuth, async (req: TarotAuthRequest, res: Response) => {
    try {
        const cauHinh: any = await prisma.tarotSetting.findUnique({ where: { id: 'default' } })
        const userId = req.tarotUser!.id
        const soFree = Math.max(0, Number(cauHinh?.freeDailyLimit ?? 3))
        const daDung = await soLuotAiHomNay(userId).catch(() => 0)

        res.json({
            success: true,
            data: {
                creditEnabled: !!cauHinh?.creditEnabled,
                balance: await soDuCua(userId),
                gia: GIA_LUOT.tarot,
                freeDailyLimit: soFree,
                freeConLai: Math.max(0, soFree - daDung),
                packages: layGoiNap(cauHinh),
                /* Chưa khai tài khoản nhận tiền thì trang phải nói "chưa mở nạp"
                 * chứ không được hiện một mã QR rỗng cho người ta quét. */
                bankReady: coTaiKhoanNhan(cauHinh),
                bankName: String(cauHinh?.bankAccountName || ''),
                bankAccountNo: String(cauHinh?.bankAccountNo || ''),
            },
        })
    } catch (e: any) {
        loiDb(e, res, 'Không đọc được số dư credit.')
    }
})

// ─── POST /api/tarot/credits/topup — tạo đơn nạp, trả mã + ảnh QR ──────────

router.post('/credits/topup', tarotAuth, async (req: TarotAuthRequest, res: Response) => {
    try {
        const cauHinh: any = await prisma.tarotSetting.findUnique({ where: { id: 'default' } })
        if (!coTaiKhoanNhan(cauHinh)) {
            res.status(503).json({ success: false, error: 'Chủ trang chưa khai tài khoản nhận tiền nên chưa nạp được. Hãy quay lại sau.' })
            return
        }

        const goi = layGoiNap(cauHinh).find(g => g.id === cleanText(req.body?.packageId, 20))
        if (!goi) {
            res.status(400).json({ success: false, error: 'Gói nạp không còn hiệu lực. Hãy tải lại trang rồi chọn lại.' })
            return
        }

        /* Đơn CŨ CÒN CHỜ của cùng người + cùng gói thì dùng lại, đừng đẻ đơn mới.
         * Người sốt ruột bấm ba lần là ba mã khác nhau, chuyển tiền theo mã nào
         * cũng đúng nhưng hai đơn kia treo mãi trong danh sách chờ của admin. */
        const cu = await prisma.tarotTopupOrder.findFirst({
            where: {
                userId: req.tarotUser!.id,
                status: 'pending',
                vnd: goi.vnd,
                createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
            },
            orderBy: { createdAt: 'desc' },
        })
        if (cu) {
            res.json({
                success: true,
                data: {
                    orderId: cu.id, code: cu.code, vnd: cu.vnd, credits: cu.credits,
                    qrUrl: anhQrVietQr(cauHinh, cu.vnd, cu.code),
                    bankAccountNo: String(cauHinh?.bankAccountNo || ''),
                    bankAccountName: String(cauHinh?.bankAccountName || ''),
                },
            })
            return
        }

        /* Mã trùng thì cột code (UNIQUE) ném P2002 — thử lại vài lần thay vì để
         * người nạp nhận lỗi. Xác suất trùng rất thấp nhưng không phải là không. */
        let don: any = null
        for (let i = 0; i < 5 && !don; i += 1) {
            try {
                don = await prisma.tarotTopupOrder.create({
                    data: {
                        code: maNoiDungMoi(),
                        userId: req.tarotUser!.id,
                        email: req.tarotUser!.email || null,
                        name: cleanText(req.body?.name, 120) || null,
                        vnd: goi.vnd,
                        credits: goi.credits,
                        status: 'pending',
                    },
                })
            } catch (e: any) {
                if (e?.code !== 'P2002') throw e
            }
        }
        if (!don) {
            res.status(500).json({ success: false, error: 'Chưa tạo được mã nạp. Thử lại giúp mình nhé.' })
            return
        }

        res.json({
            success: true,
            data: {
                orderId: don.id, code: don.code, vnd: don.vnd, credits: don.credits,
                qrUrl: anhQrVietQr(cauHinh, don.vnd, don.code),
                bankAccountNo: String(cauHinh?.bankAccountNo || ''),
                bankAccountName: String(cauHinh?.bankAccountName || ''),
            },
        })
    } catch (e: any) {
        loiDb(e, res, 'Không tạo được đơn nạp credit.')
    }
})

/* ─── GET /api/tarot/credits/topup/:id — trang hỏi lại xem đã duyệt chưa ─────
 *
 * Đối soát là DUYỆT TAY nên chuyển khoản xong chưa cộng ngay được: trang cứ hỏi
 * lại vài giây một lần, tới lúc chủ trang bấm duyệt ở admin thì status đổi sang
 * 'paid'. Nói rõ điều đó ở giao diện, đừng để người ta ngồi đợi tưởng treo. */
router.get('/credits/topup/:id', tarotAuth, async (req: TarotAuthRequest, res: Response) => {
    try {
        const don = await prisma.tarotTopupOrder.findUnique({ where: { id: String(req.params.id || '') } })
        // Chỉ chủ đơn xem được — nếu không thì dò id là biết ai nạp bao nhiêu.
        if (!don || don.userId !== req.tarotUser!.id) {
            res.status(404).json({ success: false, error: 'Không tìm thấy đơn nạp này.' })
            return
        }
        res.json({
            success: true,
            data: {
                status: don.status,
                code: don.code,
                vnd: don.vnd,
                credits: don.credits,
                balance: await soDuCua(req.tarotUser!.id),
            },
        })
    } catch (e: any) {
        loiDb(e, res, 'Không đọc được trạng thái đơn nạp.')
    }
})

export default router
