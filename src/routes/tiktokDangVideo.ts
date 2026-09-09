// ═══════════════════════════════════════════════════════════════════════════════
//  ĐĂNG VIDEO LÊN TIKTOK — các đường gọi cho tab Media
//
//  Uỷ quyền đi VÒNG QUA WEB giống hệt Shopee Video: callback của TikTok không mang
//  JWT nên máy chủ không biết cửa hàng nào; web có JWT sẽ gọi lại để đổi mã.
//
//  Xem lib/tiktokDangVideo.ts để biết vì sao đây KHÔNG phải TikTok Shop.
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'

const router = Router()

/** Cột ttPost* mới thêm 09/09/2026 — cửa hàng chưa chạy /admin/migrate thì SELECT
 *  rộng ném P2022. Nói ĐÚNG bệnh thay vì để thành "lỗi hệ thống". */
function laThieuCot(e: any): boolean {
    return /P2022|column .* does not exist/i.test(String(e?.code || '') + ' ' + String(e?.message || ''))
}
const loiThieuCot = {
    success: false,
    error: 'Cửa hàng chưa có cột lưu kết nối TikTok. Chạy POST /api/admin/migrate rồi thử lại.',
    canMigrate: true,
}

function duongVe(req: AuthRequest): string {
    const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`
    return `${base}/api/tiktok-dang-video/callback`
}

// ─── Khai khoá ứng dụng TikTok ────────────────────────────────────────────────
// KHÔNG trả secret ngược ra giao diện, chỉ 4 ký tự cuối để chủ shop nhận ra.
router.put('/app', authMiddleware, requirePermission('online_orders.edit', 'online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const clientKey = String(req.body?.clientKey || '').trim()
        const clientSecret = String(req.body?.clientSecret || '').trim()
        if (!clientKey) { res.status(400).json({ success: false, error: 'Thiếu Client key' }); return }
        if (clientSecret.length < 10) { res.status(400).json({ success: false, error: 'Client secret quá ngắn — lấy ở developers.tiktok.com, mục Manage apps' }); return }

        const cai = await prisma.storeSettings.findFirst()
        if (!cai) { res.status(400).json({ success: false, error: 'Cửa hàng chưa có bản ghi cài đặt' }); return }

        /* Đổi app là đổi bộ token: token cũ cấp bởi app cũ không dùng được với app
         * mới, giữ lại chỉ sinh lỗi khó hiểu. Xoá để bắt kết nối lại. */
        const doiApp = cai.ttPostClientKey && cai.ttPostClientKey !== clientKey
        await prisma.storeSettings.update({
            where: { id: cai.id },
            data: {
                ttPostClientKey: clientKey, ttPostClientSecret: clientSecret,
                ...(doiApp ? {
                    ttPostOpenId: null, ttPostAccessToken: null, ttPostRefreshToken: null,
                    ttPostExpiresAt: null, ttPostScopes: null, ttPostDisplayName: null,
                    ttPostAvatar: null, ttPostAuthAt: null,
                } : {}),
            } as any,
        })
        res.json({ success: true, data: { clientKey, secretDuoi4: clientSecret.slice(-4), daXoaKetNoiCu: !!doiApp } })
    } catch (err: any) {
        if (laThieuCot(err)) { res.status(503).json(loiThieuCot); return }
        res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 400) })
    }
})

// ─── Link đưa chủ tài khoản sang TikTok ───────────────────────────────────────
router.get('/auth-url', authMiddleware, requirePermission('online_orders.edit', 'online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { credTikTok, linkUyQuyen, scopeCanXin } = await import('../lib/tiktokDangVideo')
        const cai = await prisma.storeSettings.findFirst()
        const { key } = credTikTok(cai)
        const dangThang = String(req.query.dangThang || '') === '1'

        /* `state` BẮT BUỘC với TikTok và phải kiểm lúc quay về. Nhét mã cửa hàng
         * vào để callback biết đường quay lại đúng chỗ, kèm chuỗi ngẫu nhiên. */
        const state = Buffer.from(JSON.stringify({
            store: req.user?.storeCode || '',
            r: (await import('crypto')).randomBytes(12).toString('hex'),
            dangThang,
        })).toString('base64url')

        res.json({
            success: true,
            data: {
                authUrl: linkUyQuyen(key, duongVe(req), state, dangThang),
                redirectUri: duongVe(req),
                scope: scopeCanXin(dangThang),
            },
        })
    } catch (err: any) {
        if (laThieuCot(err)) { res.status(503).json(loiThieuCot); return }
        res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 400) })
    }
})

// ─── TikTok trả mã về đây (KHÔNG có JWT) → đẩy sang web để web đổi token ──────
router.get('/callback', async (req: AuthRequest, res: Response) => {
    try {
        const { code, state, error, error_description } = req.query as any
        const fe = process.env.FRONTEND_URL || 'https://kengi.vn'
        if (error) {
            res.redirect(`${fe}/dashboard-media/?tt_error=${encodeURIComponent(String(error_description || error))}`)
            return
        }
        if (!code) { res.status(400).send('Thiếu mã uỷ quyền (code)'); return }
        res.redirect(`${fe}/dashboard-media/?tt_code=${encodeURIComponent(String(code))}&tt_state=${encodeURIComponent(String(state || ''))}`)
    } catch (err: any) {
        res.status(500).send('Lỗi uỷ quyền TikTok: ' + err.message)
    }
})

// ─── Web gọi lại để đổi mã lấy token ──────────────────────────────────────────
router.post('/exchange-token', authMiddleware, requirePermission('online_orders.edit', 'online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const { credTikTok, doiMaLayToken } = await import('../lib/tiktokDangVideo')
        const code = String(req.body?.code || '').trim()
        if (!code) { res.status(400).json({ success: false, error: 'Thiếu code' }); return }

        const cai = await prisma.storeSettings.findFirst()
        const { key, secret } = credTikTok(cai)
        const t = await doiMaLayToken(key, secret, code, duongVe(req))
        if (!t.openId || !t.accessToken) {
            res.status(502).json({ success: false, error: 'TikTok không trả open_id / access_token' })
            return
        }

        /* Lấy tên hiển thị để chủ shop NHÌN THẤY mình vừa nối tài khoản nào —
         * nối nhầm tài khoản cá nhân là video đăng sai chỗ mà không ai biết. */
        let ten: string | null = null
        let anh: string | null = null
        try {
            const r = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', {
                headers: { 'Authorization': `Bearer ${t.accessToken}` },
            })
            const j: any = await r.json()
            ten = j?.data?.user?.display_name || null
            anh = j?.data?.user?.avatar_url || null
        } catch { /* thiếu tên không chặn kết nối */ }

        await prisma.storeSettings.update({
            where: { id: cai.id },
            data: {
                ttPostOpenId: t.openId,
                ttPostAccessToken: t.accessToken,
                ttPostRefreshToken: t.refreshToken,
                ttPostExpiresAt: new Date(Date.now() + t.expiresIn * 1000),
                ttPostScopes: t.scopes,
                ttPostDisplayName: ten,
                ttPostAvatar: anh,
                ttPostAuthAt: new Date(),
            } as any,
        })

        /* Kiểm QUYỀN THẬT TikTok cấp, đừng tin cái mình xin: xin 3 mà họ cấp 2 thì
         * lúc đăng mới vỡ, và lúc đó rất khó lần ra vì sao. */
        const daCap = t.scopes.split(',').map(s => s.trim()).filter(Boolean)
        res.json({
            success: true,
            data: {
                openId: t.openId, tenHienThi: ten, anhDaiDien: anh,
                scopeDaCap: daCap,
                coDangThang: daCap.includes('video.publish'),
                coTaiLen: daCap.includes('video.upload'),
            },
        })
    } catch (err: any) {
        if (laThieuCot(err)) { res.status(503).json(loiThieuCot); return }
        console.error('POST /tiktok-dang-video/exchange-token lỗi:', err?.message || err)
        res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 400) })
    }
})

// ─── Tình trạng kết nối, cho tab Media hiển thị ───────────────────────────────
router.get('/trang-thai', authMiddleware, requirePermission('online_orders.view'), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        let cai: any = null
        try {
            cai = await prisma.storeSettings.findFirst({
                select: {
                    ttPostClientKey: true, ttPostClientSecret: true, ttPostOpenId: true,
                    ttPostScopes: true, ttPostDisplayName: true, ttPostAvatar: true, ttPostAuthAt: true,
                } as any,
            })
        } catch (e: any) {
            if (laThieuCot(e)) { res.json({ success: true, data: { chuaMigrate: true } }); return }
            throw e
        }
        const scopes = String(cai?.ttPostScopes || '').split(',').map((s: string) => s.trim()).filter(Boolean)
        res.json({
            success: true,
            data: {
                coApp: !!(cai?.ttPostClientKey && cai?.ttPostClientSecret),
                clientKey: cai?.ttPostClientKey || null,
                secretDuoi4: cai?.ttPostClientSecret ? String(cai.ttPostClientSecret).slice(-4) : null,
                daKetNoi: !!cai?.ttPostOpenId,
                tenHienThi: cai?.ttPostDisplayName || null,
                anhDaiDien: cai?.ttPostAvatar || null,
                ketNoiLuc: cai?.ttPostAuthAt || null,
                scopeDaCap: scopes,
                coTaiLen: scopes.includes('video.upload'),
                coDangThang: scopes.includes('video.publish'),
            },
        })
    } catch (err: any) {
        res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 400) })
    }
})

export default router
