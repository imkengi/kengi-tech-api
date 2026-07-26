import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import registryPrisma from '../lib/prisma'

// ═══════════════════════════════════════════════════════════════════════════════
// Livestream Studio API — backend cho app Kengi Stream (kengi.vn/ai-livestream)
//
// Gồm 5 nhóm:
//   1. /session-token  — đổi JWT đăng nhập hệ thống lấy studio token 12h
//   2. /state          — lưu/đọc snapshot cấu hình studio (JSONB)
//   3. /videos         — thư viện avatar video (bytea trong Postgres, serve có Range)
//   4. /tts            — proxy Microsoft Edge TTS (+ Google fallback)
//   5. /shopee         — proxy ký HMAC-SHA256 cho Shopee Open Platform (User-type API)
//
// Auth: PHẢI đăng nhập bằng tài khoản hệ thống (store thuộc allowlist, mặc định
// KENGIONLINE) rồi đổi lấy studio token qua /session-token. Token nhận qua header
// `x-studio-token`, `Authorization: Bearer` hoặc query `?token=` (audio/video
// element không gửi được header). Token tĩnh LIVESTREAM_STUDIO_TOKEN vẫn được
// chấp nhận làm lối phụ cho script/cron.
// Bảng nằm ở schema public (registry) — KHÔNG đụng schema cửa hàng.
// ═══════════════════════════════════════════════════════════════════════════════

const router = Router()

// ─── Token guard ─────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || ''
const STUDIO_SCOPE = 'livestream-studio'
// Store được phép vào studio — studio dùng state chung nên không mở cho mọi tenant
const ALLOWED_STORES = (process.env.LIVESTREAM_ALLOWED_STORES || 'KENGIONLINE')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)

function isAllowedStore(storeCode: unknown): boolean {
    return typeof storeCode === 'string' && ALLOWED_STORES.includes(storeCode.toUpperCase())
}

function extractToken(req: Request): string {
    const auth = req.headers.authorization
    if (auth && auth.startsWith('Bearer ')) return auth.slice(7)
    return (req.headers['x-studio-token'] as string) || String(req.query.token || '')
}

function requireToken(req: Request, res: Response, next: NextFunction) {
    const got = extractToken(req)
    if (!got) {
        return res.status(401).json({ success: false, error: 'Chưa đăng nhập — thiếu studio token' })
    }
    // Lối phụ: token tĩnh (script/cron, không dành cho browser)
    const staticToken = process.env.LIVESTREAM_STUDIO_TOKEN
    if (staticToken && got === staticToken) return next()

    // Lối chính: JWT — studio token (scope riêng) hoặc access token đăng nhập
    // của store thuộc allowlist (gọi API trực tiếp không cần đổi token)
    if (JWT_SECRET) {
        try {
            const payload = jwt.verify(got, JWT_SECRET, { algorithms: ['HS256'] }) as any
            if (payload?.scope === STUDIO_SCOPE || isAllowedStore(payload?.storeCode)) return next()
            return res.status(403).json({ success: false, error: 'Tài khoản này không có quyền vào livestream studio' })
        } catch { /* token sai/hết hạn → 401 bên dưới */ }
    }
    return res.status(401).json({ success: false, error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' })
}

// ═══════════════════════ 1. SESSION TOKEN ═══════════════════════════════════
// Access token đăng nhập chỉ sống 15 phút — quá ngắn cho một phiên live và làm
// URL video/audio (nhúng ?token=) đổi liên tục. FE đăng nhập xong gọi endpoint
// này để lấy studio token 12h dùng cho mọi request còn lại.

router.get('/session-token', (req: Request, res: Response) => {
    if (!JWT_SECRET) {
        return res.status(503).json({ success: false, error: 'Server chưa cấu hình JWT_SECRET' })
    }
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Cần đăng nhập trước (Authorization: Bearer <access token>)' })
    }
    try {
        const payload = jwt.verify(auth.slice(7), JWT_SECRET, { algorithms: ['HS256'] }) as any
        if (payload?.scope === STUDIO_SCOPE) {
            return res.status(400).json({ success: false, error: 'Phải dùng access token đăng nhập, không dùng studio token' })
        }
        if (!isAllowedStore(payload?.storeCode)) {
            return res.status(403).json({ success: false, error: 'Tài khoản này không có quyền vào livestream studio' })
        }
        const studioToken = jwt.sign(
            { scope: STUDIO_SCOPE, storeCode: payload.storeCode, userId: payload.userId, email: payload.email },
            JWT_SECRET,
            { expiresIn: '12h' },
        )
        res.json({ success: true, data: { studioToken, expiresInSeconds: 12 * 3600 } })
    } catch {
        return res.status(401).json({ success: false, error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' })
    }
})

// ─── Khởi tạo bảng (lazy, chạy 1 lần) ────────────────────────────────────────

let tablesReady: Promise<void> | null = null
function ensureTables(): Promise<void> {
    if (!tablesReady) {
        tablesReady = (async () => {
            await registryPrisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS public.livestream_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )`)
            await registryPrisma.$executeRawUnsafe(`
                CREATE TABLE IF NOT EXISTS public.livestream_video (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    data BYTEA NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )`)
        })().catch((e) => {
            tablesReady = null // cho phép thử lại lần sau nếu init lỗi
            throw e
        })
    }
    return tablesReady
}

// ═══════════════════════════ 1. STATE ═══════════════════════════════════════

router.get('/state', requireToken, async (_req: Request, res: Response) => {
    try {
        await ensureTables()
        const rows = await registryPrisma.$queryRawUnsafe<{ data: unknown; updated_at: Date }[]>(
            `SELECT data, updated_at FROM public.livestream_state WHERE id = 'default'`)
        if (rows.length === 0) return res.json({ success: true, data: null })
        res.json({ success: true, data: rows[0].data, updatedAt: rows[0].updated_at })
    } catch (e: any) {
        res.status(500).json({ success: false, error: e?.message || 'Lỗi đọc state' })
    }
})

router.put('/state', requireToken, async (req: Request, res: Response) => {
    try {
        await ensureTables()
        const json = JSON.stringify(req.body ?? {})
        if (json.length > 2_000_000) {
            return res.status(413).json({ success: false, error: 'State quá lớn (>2MB)' })
        }
        await registryPrisma.$executeRaw`
            INSERT INTO public.livestream_state (id, data, updated_at)
            VALUES ('default', ${json}::jsonb, now())
            ON CONFLICT (id) DO UPDATE SET data = ${json}::jsonb, updated_at = now()`
        res.json({ success: true })
    } catch (e: any) {
        res.status(500).json({ success: false, error: e?.message || 'Lỗi lưu state' })
    }
})

// ═══════════════════════════ 2. VIDEOS ══════════════════════════════════════

const VIDEO_MODES = ['talking', 'presenting', 'greeting', 'reacting', 'emphasis', 'idle', 'rest']
const videoUpload = multer({
    storage: multer.memoryStorage(),
    // Cloud Run giới hạn request 32MB — chặn sớm ở 30MB
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        cb(null, ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.mimetype))
    },
})

router.get('/videos', requireToken, async (_req: Request, res: Response) => {
    try {
        await ensureTables()
        const rows = await registryPrisma.$queryRawUnsafe<
            { id: string; name: string; mode: string; mime_type: string; size_bytes: number; created_at: Date }[]
        >(`SELECT id, name, mode, mime_type, size_bytes, created_at
           FROM public.livestream_video ORDER BY created_at ASC`)
        res.json({
            success: true,
            data: rows.map((r) => ({
                id: r.id,
                name: r.name,
                mode: r.mode,
                mimeType: r.mime_type,
                sizeBytes: Number(r.size_bytes),
                createdAt: r.created_at,
            })),
        })
    } catch (e: any) {
        res.status(500).json({ success: false, error: e?.message || 'Lỗi đọc danh sách video' })
    }
})

router.post('/videos', requireToken, videoUpload.single('file'), async (req: Request, res: Response) => {
    try {
        await ensureTables()
        if (!req.file) return res.status(400).json({ success: false, error: 'Thiếu file video (field "file", mp4/webm)' })
        const mode = String(req.body.mode || 'talking')
        if (!VIDEO_MODES.includes(mode)) {
            return res.status(400).json({ success: false, error: `mode không hợp lệ (${VIDEO_MODES.join('/')})` })
        }
        const name = String(req.body.name || req.file.originalname || 'video').slice(0, 200)
        const id = crypto.randomUUID()
        await registryPrisma.$executeRaw`
            INSERT INTO public.livestream_video (id, name, mode, mime_type, size_bytes, data)
            VALUES (${id}, ${name}, ${mode}, ${req.file.mimetype}, ${req.file.size}, ${req.file.buffer})`
        res.json({ success: true, data: { id, name, mode, mimeType: req.file.mimetype, sizeBytes: req.file.size } })
    } catch (e: any) {
        res.status(500).json({ success: false, error: e?.message || 'Lỗi upload video' })
    }
})

router.patch('/videos/:id', requireToken, async (req: Request, res: Response) => {
    try {
        await ensureTables()
        const id = String(req.params.id)
        const name = typeof req.body.name === 'string' ? req.body.name.slice(0, 200) : null
        const mode = typeof req.body.mode === 'string' && VIDEO_MODES.includes(req.body.mode) ? req.body.mode : null
        if (!name && !mode) return res.status(400).json({ success: false, error: 'Cần name hoặc mode' })
        await registryPrisma.$executeRaw`
            UPDATE public.livestream_video
            SET name = COALESCE(${name}, name), mode = COALESCE(${mode}, mode)
            WHERE id = ${id}`
        res.json({ success: true })
    } catch (e: any) {
        res.status(500).json({ success: false, error: e?.message || 'Lỗi cập nhật video' })
    }
})

router.delete('/videos/:id', requireToken, async (req: Request, res: Response) => {
    try {
        await ensureTables()
        await registryPrisma.$executeRaw`DELETE FROM public.livestream_video WHERE id = ${String(req.params.id)}`
        res.json({ success: true })
    } catch (e: any) {
        res.status(500).json({ success: false, error: e?.message || 'Lỗi xóa video' })
    }
})

// Serve file video — hỗ trợ Range để <video> seek/loop mượt (Safari bắt buộc Range).
router.get('/videos/:id/file', requireToken, async (req: Request, res: Response) => {
    try {
        await ensureTables()
        const rows = await registryPrisma.$queryRaw<{ mime_type: string; data: Buffer }[]>`
            SELECT mime_type, data FROM public.livestream_video WHERE id = ${String(req.params.id)}`
        if (rows.length === 0) return res.status(404).json({ success: false, error: 'Không có video này' })
        const { mime_type, data } = rows[0]
        const total = data.length
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Cache-Control', 'private, max-age=86400')
        res.setHeader('Content-Type', mime_type)
        // Helmet mặc định gắn CORP same-origin — phải nới thành cross-origin,
        // nếu không <video> trên kengi.vn sẽ bị browser chặn load (media stall readyState=0).
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')

        const range = req.headers.range
        if (range) {
            const m = /^bytes=(\d*)-(\d*)$/.exec(range)
            if (m) {
                const start = m[1] ? parseInt(m[1], 10) : 0
                const end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1
                if (start >= total || start > end) {
                    res.setHeader('Content-Range', `bytes */${total}`)
                    return res.status(416).end()
                }
                res.status(206)
                res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
                res.setHeader('Content-Length', end - start + 1)
                return res.end(data.subarray(start, end + 1))
            }
        }
        res.setHeader('Content-Length', total)
        res.end(data)
    } catch (e: any) {
        res.status(500).json({ success: false, error: e?.message || 'Lỗi đọc video' })
    }
})

// ═══════════════════════════ 3. TTS ═════════════════════════════════════════
// Port từ app Next (src/app/api/tts/route.ts): Edge TTS + retry + Google fallback.

type VoiceInstance = { tts: MsEdgeTTS; voice: string }
let currentTts: VoiceInstance | null = null

async function getOrCreateTts(voice: string): Promise<MsEdgeTTS> {
    if (currentTts && currentTts.voice === voice) return currentTts.tts
    if (currentTts) {
        try { currentTts.tts.close() } catch { /* noop */ }
        currentTts = null
    }
    const tts = new MsEdgeTTS()
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
    currentTts = { tts, voice }
    return tts
}

function invalidateTts(): void {
    if (currentTts) {
        try { currentTts.tts.close() } catch { /* noop */ }
        currentTts = null
    }
}

let activeEdge = 0
const edgeQueue: (() => void)[] = []
async function acquireEdge(): Promise<void> {
    if (activeEdge < 1) { activeEdge++; return }
    await new Promise<void>((resolve) => edgeQueue.push(resolve))
    activeEdge++
}
function releaseEdge(): void {
    activeEdge--
    const next = edgeQueue.shift()
    if (next) next()
}

function sanitizePercent(p: string): string {
    const m = p.trim().match(/^([+-])?(\d+)%$/)
    if (!m) return '+0%'
    return `${m[1] ?? '+'}${m[2]}%`
}

async function synthEdgeOnce(voice: string, text: string, rate: string, pitch: string): Promise<Buffer | null> {
    try {
        const tts = await getOrCreateTts(voice)
        const { audioStream } = tts.toStream(text, { rate, pitch })
        const chunks: Buffer[] = []
        for await (const c of audioStream as AsyncIterable<Buffer>) chunks.push(c)
        const out = Buffer.concat(chunks)
        return out.length < 100 ? null : out
    } catch (e) {
        console.error('[livestream/tts] edge error:', e)
        invalidateTts()
        return null
    }
}

async function synthEdge(text: string, voice: string, rate: string, pitch: string): Promise<Buffer | null> {
    const safeRate = sanitizePercent(rate)
    const safePitch = sanitizePercent(pitch)
    await acquireEdge()
    try {
        for (let attempt = 0; attempt < 3; attempt++) {
            const result = await synthEdgeOnce(voice, text, safeRate, safePitch)
            if (result) return result
            invalidateTts()
            if (attempt < 2) await new Promise((r) => setTimeout(r, Math.round(500 * Math.pow(1.5, attempt))))
        }
        return null
    } finally {
        releaseEdge()
    }
}

function splitTextForGoogle(text: string, maxLen = 180): string[] {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!clean) return []
    const out: string[] = []
    const sentences = clean.split(/(?<=[.!?…])\s+/)
    let buf = ''
    for (const s of sentences) {
        const candidate = (buf ? buf + ' ' : '') + s
        if (candidate.length <= maxLen) buf = candidate
        else {
            if (buf) out.push(buf)
            buf = s.length <= maxLen ? s : s.slice(0, maxLen)
            if (s.length > maxLen) {
                for (let i = maxLen; i < s.length; i += maxLen) out.push(s.slice(i, i + maxLen))
                buf = ''
            }
        }
    }
    if (buf) out.push(buf)
    return out
}

async function synthGoogle(text: string, lang: string): Promise<Buffer | null> {
    const chunks = splitTextForGoogle(text)
    if (chunks.length === 0) return null
    const buffers: Buffer[] = []
    for (const chunk of chunks) {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${encodeURIComponent(lang)}&client=tw-ob&ttsspeed=1`
        try {
            const r = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                    Referer: 'https://translate.google.com/',
                },
            })
            if (!r.ok) continue
            buffers.push(Buffer.from(await r.arrayBuffer()))
        } catch { continue }
    }
    return buffers.length === 0 ? null : Buffer.concat(buffers)
}

router.get('/tts', requireToken, async (req: Request, res: Response) => {
    const text = String(req.query.text ?? '').slice(0, 1200)
    const lang = String(req.query.lang ?? 'vi')
    const voice = String(req.query.voice ?? 'vi-VN-HoaiMyNeural')
    const rate = String(req.query.rate ?? '+0%')
    const pitch = String(req.query.pitch ?? '+0%')
    const engine = String(req.query.engine ?? 'edge')

    if (!text.trim()) return res.status(400).json({ success: false, error: 'missing text' })

    let usedEngine = engine
    let data = engine === 'google' ? await synthGoogle(text, lang) : await synthEdge(text, voice, rate, pitch)
    if (!data && engine !== 'google') {
        console.warn('[livestream/tts] edge failed, falling back to google')
        data = await synthGoogle(text, lang)
        if (data) usedEngine = 'google'
    }
    if (!data) return res.status(502).json({ success: false, error: 'tts synthesis failed' })

    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', data.byteLength)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.setHeader('X-TTS-Engine', usedEngine)
    // Nới CORP để <audio> trên kengi.vn phát được (helmet mặc định same-origin)
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.end(data)
})

// ═══════════════════════════ 4. SHOPEE PROXY ════════════════════════════════
// Livestream API là User-type: sign = HMAC-SHA256(partner_key,
//   partner_id + api_path + timestamp + access_token + user_id)
// Public API (get/refresh token): sign = HMAC-SHA256(partner_key, partner_id + api_path + timestamp)

const SHOPEE_HOSTS: Record<string, string> = {
    live: 'https://partner.shopeemobile.com',
    sandbox: 'https://openplatform.sandbox.test-stable.shopee.sg',
}

function shopeeSign(partnerKey: string, base: string): string {
    return crypto.createHmac('sha256', partnerKey).update(base).digest('hex')
}

function buildShopeeUrl(body: {
    env?: string
    apiPath: string
    credentials: { partnerId: string; partnerKey: string; userId?: string; accessToken?: string }
    query?: Record<string, string | number | boolean>
}): { url: string } | { error: string } {
    const { apiPath, credentials, env = 'live', query = {} } = body
    if (!apiPath || !apiPath.startsWith('/api/v2/')) return { error: 'apiPath không hợp lệ' }
    if (!credentials?.partnerId || !credentials?.partnerKey) return { error: 'Thiếu partner_id hoặc partner_key' }

    const host = SHOPEE_HOSTS[env] ?? SHOPEE_HOSTS.live
    const timestamp = Math.floor(Date.now() / 1000)
    const params = new URLSearchParams()
    params.set('partner_id', credentials.partnerId)
    params.set('timestamp', String(timestamp))

    if (apiPath.startsWith('/api/v2/public/')) {
        params.set('sign', shopeeSign(credentials.partnerKey, `${credentials.partnerId}${apiPath}${timestamp}`))
    } else {
        if (!credentials.accessToken || !credentials.userId) return { error: 'Livestream API cần access_token và user_id' }
        const base = `${credentials.partnerId}${apiPath}${timestamp}${credentials.accessToken}${credentials.userId}`
        params.set('access_token', credentials.accessToken)
        params.set('user_id', credentials.userId)
        params.set('sign', shopeeSign(credentials.partnerKey, base))
    }
    for (const [k, v] of Object.entries(query)) params.set(k, String(v))
    return { url: `${host}${apiPath}?${params.toString()}` }
}

router.post('/shopee', requireToken, async (req: Request, res: Response) => {
    const built = buildShopeeUrl(req.body || {})
    if ('error' in built) return res.status(400).json({ error: 'proxy_error', message: built.error })
    const method = req.body.method === 'GET' ? 'GET' : 'POST'
    try {
        const upstream = await fetch(built.url, {
            method,
            headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
            body: method === 'POST' && req.body.body !== undefined ? JSON.stringify(req.body.body) : undefined,
        })
        const text = await upstream.text()
        try {
            res.status(upstream.status).json(JSON.parse(text))
        } catch {
            res.status(502).json({ error: 'proxy_upstream', message: `Shopee trả về non-JSON (HTTP ${upstream.status}): ${text.slice(0, 300)}` })
        }
    } catch (e: any) {
        res.status(502).json({ error: 'proxy_network', message: `Không gọi được Shopee: ${e?.message || e}` })
    }
})

const coverUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        cb(null, ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'].includes(file.mimetype))
    },
})

router.post('/shopee-upload', requireToken, coverUpload.single('image'), async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'proxy_error', message: "Thiếu file ảnh (field 'image')" })
    const built = buildShopeeUrl({
        env: String(req.body.env || 'live'),
        apiPath: '/api/v2/livestream/upload_image',
        credentials: {
            partnerId: String(req.body.partnerId || ''),
            partnerKey: String(req.body.partnerKey || ''),
            userId: String(req.body.userId || ''),
            accessToken: String(req.body.accessToken || ''),
        },
    })
    if ('error' in built) return res.status(400).json({ error: 'proxy_error', message: built.error })
    try {
        const form = new FormData()
        form.set('image', new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }), req.file.originalname || 'cover.jpg')
        const upstream = await fetch(built.url, { method: 'POST', body: form })
        const text = await upstream.text()
        try {
            res.status(upstream.status).json(JSON.parse(text))
        } catch {
            res.status(502).json({ error: 'proxy_upstream', message: `Shopee trả về non-JSON (HTTP ${upstream.status}): ${text.slice(0, 300)}` })
        }
    } catch (e: any) {
        res.status(502).json({ error: 'proxy_network', message: `Không gọi được Shopee: ${e?.message || e}` })
    }
})

export default router
