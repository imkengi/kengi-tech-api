/* ═══════════════════════════════════════════════════════════════════════════════
 *  KENGI VAULT v4 — /api/storage (20/10/2026, chủ shop: "update cực mạnh Kengi Vault")
 *
 *  Bản cũ: ghi đĩa tạm Cloud Run (tệp mất sau mỗi lần deploy — 5/5 tệp prod 404), danh sách không bao giờ
 *  nạp từ máy chủ (FE đòi mảng, BE trả {data}), quyền chỉ chặn ở giao diện. Viết lại toàn bộ:
 *
 *   · Lưu ở bucket RIÊNG TƯ, tải thẳng từ trình duyệt (lib/khoTaiLieu.ts), xem/tải qua link ký 30 phút.
 *   · Thư mục, nhãn, ghim, gắn khách/NCC/xe/nhân viên, ngày hết hạn + nhắc trước, phiên bản, thùng rác
 *     30 ngày, chia sẻ link có hạn/thu hồi/đếm lượt, tải nhiều tệp thành ZIP, nhật ký từng tệp,
 *     AI đọc tài liệu (lib/vaultAi.ts) để tìm theo NỘI DUNG và tự gợi ý hạn/nhãn.
 *   · Quyền kiểm ở MÁY CHỦ: storage.view (xem) / download (tải về, ZIP) / upload / edit (sửa, thư mục,
 *     AI) / delete / share. owner/admin toàn quyền. Chỉ có quyền tải lên ⇒ chỉ thấy tệp CHÍNH MÌNH tải.
 *
 *  ⛔ PROD PRISMA_POOL_SIZE=1 — truy vấn TUẦN TỰ, không Promise.all.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import express, { Router, Request, Response } from 'express'
import crypto from 'crypto'
import multer from 'multer'
import { errMsg } from '../lib/errorResponse'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { getStorePrisma } from '../lib/prisma'
import { effectivePermissions, permissionSatisfied, ROLE_PERMISSIONS } from '../lib/rolePermissions'
import * as kho from '../lib/khoTaiLieu'
import { BoGhiZip } from '../lib/vaultZip'
import { LoiAiTaiLieu, cachGuiAi } from '../lib/vaultAi'
import { layCaiDat, aiDocMotTep, ghiLoiAi, xoaVinhVien, THUNG_RAC_NGAY } from '../lib/vaultViec'
import { CO_DAU, KHONG_DAU, boDauTim } from '../lib/danhSachTonKho'
import { Prisma as StoreNS } from '../generated/store-client'

const router = Router()

export const NHOM_TAI_LIEU = ['contracts_customer', 'docs_supplier', 'internal', 'other'] as const
export const LOAI_LIEN_KET = ['customer', 'supplier', 'vehicle', 'employee', 'product', 'other'] as const
const TRAN_CUA_HANG = Number(process.env.VAULT_TRAN_CUA_HANG_GB || 50) * 1024 ** 3
const ZIP_TOI_DA_TEP = 150
const ZIP_TOI_DA_BYTE = 1_000_000_000 // Cloud Run cắt yêu cầu sau 900 giây — 1 GB cần ~9 Mbps là kịp
const NGUON_DUOC_PHEP = ['https://kengi.vn', 'https://www.kengi.vn', 'http://localhost:3000', 'http://localhost:3001', 'http://localhost:3007']

type Quyen = { xem: boolean; taiVe: boolean; taiLen: boolean; sua: boolean; xoa: boolean; chiaSe: boolean; quanTri: boolean }
interface Ngu { prisma: any; schema: string; userId: string; email: string; role: string; q: Quyen }

class LoiVault extends Error { constructor(public status: number, msg: string) { super(msg) } }
const loi = (status: number, msg: string) => new LoiVault(status, msg)

function traLoi(res: Response, e: any, nhan: string) {
    if (e instanceof LoiVault) { res.status(e.status).json({ success: false, error: e.message }); return }
    console.error(`[Vault] ${nhan}:`, e?.message || e)
    res.status(500).json({ success: false, error: errMsg(e) })
}

// ─── Quyền ───────────────────────────────────────────────────────────────────
async function quyenVault(req: AuthRequest): Promise<Quyen> {
    const role = String(req.user?.role || '').toLowerCase()
    if (ROLE_PERMISSIONS[role]?.includes('*')) return { xem: true, taiVe: true, taiLen: true, sua: true, xoa: true, chiaSe: true, quanTri: true }
    let stored: string[] = []
    try {
        const u = await req.storePrisma!.user.findUnique({ where: { id: req.user!.userId }, select: { permissions: true } })
        stored = JSON.parse((u as any)?.permissions || '[]')
    } catch { stored = [] }
    const g = effectivePermissions(role, Array.isArray(stored) ? stored : [])
    const co = (k: string) => permissionSatisfied(k, g)
    return { xem: co('storage.view'), taiVe: co('storage.download'), taiLen: co('storage.upload'), sua: co('storage.edit'), xoa: co('storage.delete'), chiaSe: co('storage.share'), quanTri: false }
}

async function moKho(req: AuthRequest): Promise<Ngu> {
    const schema = kho.kiemSchema(String(req.user?.branchSchema || req.user?.storeSchema || ''))
    const prisma = req.storePrisma!
    await kho.damBaoBangVault(prisma, schema)
    const q = await quyenVault(req)
    if (!q.xem && !q.taiLen) throw loi(403, 'Bạn chưa có quyền dùng Kho tài liệu — nhờ chủ cửa hàng cấp quyền "Kho lưu trữ"')
    return { prisma, schema, userId: String(req.user!.userId), email: String(req.user?.email || ''), role: String(req.user?.role || ''), q }
}

const TEN_NGUOI = new Map<string, { ten: string; luc: number }>()
async function tenNguoi(n: Ngu): Promise<string> {
    const k = `${n.schema}:${n.userId}`
    const c = TEN_NGUOI.get(k)
    if (c && Date.now() - c.luc < 10 * 60_000) return c.ten
    let ten = n.email || 'Người dùng'
    try {
        const u = await n.prisma.user.findUnique({ where: { id: n.userId }, select: { name: true } })
        if (u?.name) ten = u.name
    } catch { /* giữ email */ }
    TEN_NGUOI.set(k, { ten, luc: Date.now() })
    return ten
}

async function ghiHD(n: Ngu | { prisma: any }, fileId: string | null, action: string, detail?: string, actor?: string) {
    try {
        const nguoi = actor ?? ('userId' in n ? await tenNguoi(n as Ngu) : 'Hệ thống')
        await n.prisma.storageActivity.create({
            data: { fileId, action, actor: nguoi.slice(0, 120), actorId: 'userId' in n ? (n as Ngu).userId : null, detail: detail ? detail.slice(0, 500) : null },
        })
    } catch (e: any) { console.warn('[Vault] ghi nhật ký hỏng:', e?.message || e) }
}

/** Ai được nhìn tệp này: có quyền xem, hoặc chính người tải lên */
const coTheThay = (n: Ngu, f: any) => n.q.xem || (!!f.uploaderId && f.uploaderId === n.userId)
const coTheSua = (n: Ngu, f: any) => n.q.sua || (n.q.taiLen && !!f.uploaderId && f.uploaderId === n.userId && Date.now() - new Date(f.createdAt).getTime() < 24 * 3600_000)

// ─── Nhóm loại tệp (lọc + biểu tượng) ────────────────────────────────────────
export function nhomLoai(mime: string, ten: string): string {
    const m = String(mime || '').toLowerCase(), d = String(ten || '').toLowerCase().split('.').pop() || ''
    if (m.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'avif', 'jfif'].includes(d)) return 'image'
    if (m === 'application/pdf' || d === 'pdf') return 'pdf'
    if (m.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(d)) return 'video'
    if (m.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'ogg', 'aac'].includes(d)) return 'audio'
    if (/spreadsheet|ms-excel|csv/.test(m) || ['xlsx', 'xls', 'csv', 'ods'].includes(d)) return 'excel'
    if (/wordprocessing|msword|opendocument\.text/.test(m) || ['doc', 'docx', 'odt', 'rtf'].includes(d)) return 'word'
    if (/zip|rar|7z|tar|gzip/.test(m) || ['zip', 'rar', '7z', 'tar', 'gz'].includes(d)) return 'archive'
    if (m.startsWith('text/') || ['txt', 'md', 'json', 'xml'].includes(d)) return 'text'
    return 'other'
}
function dieuKienNhom(nhom: string): any | null {
    const duoi = (ds: string[]) => ds.map(d => ({ name: { endsWith: `.${d}`, mode: 'insensitive' } }))
    switch (nhom) {
        case 'image': return { OR: [{ type: { startsWith: 'image/' } }, ...duoi(['jpg', 'jpeg', 'png', 'heic', 'webp', 'jfif'])] }
        case 'pdf': return { OR: [{ type: 'application/pdf' }, ...duoi(['pdf'])] }
        case 'video': return { OR: [{ type: { startsWith: 'video/' } }, ...duoi(['mp4', 'mov', 'webm'])] }
        case 'audio': return { OR: [{ type: { startsWith: 'audio/' } }, ...duoi(['mp3', 'm4a', 'wav'])] }
        case 'excel': return { OR: [{ type: { contains: 'spreadsheet' } }, { type: { contains: 'excel' } }, ...duoi(['xlsx', 'xls', 'csv'])] }
        case 'word': return { OR: [{ type: { contains: 'wordprocessing' } }, { type: { contains: 'msword' } }, ...duoi(['doc', 'docx'])] }
        case 'archive': return { OR: [{ type: { contains: 'zip' } }, { type: { contains: 'rar' } }, ...duoi(['zip', 'rar', '7z'])] }
        default: return null
    }
}

// ─── Đổi dòng CSDL → dữ liệu trả về ──────────────────────────────────────────
function dto(f: any, schema: string, kemAnh = true) {
    const ai = f.aiData && typeof f.aiData === 'object' ? f.aiData : null
    return {
        id: f.id, name: f.name, size: f.size, type: f.type, nhom: nhomLoai(f.type, f.name),
        category: f.category, folderId: f.folderId ?? null, tags: f.tags ?? [],
        referenceType: f.referenceType ?? null, referenceId: f.referenceId ?? null, referenceName: f.referenceName ?? null,
        description: f.description ?? null, uploadedBy: f.uploadedBy, uploaderId: f.uploaderId ?? null,
        uploadedAt: new Date(f.createdAt).toISOString(), createdAt: f.createdAt, updatedAt: f.updatedAt, updatedBy: f.updatedBy ?? null,
        status: f.status, pinned: !!f.pinned, expiresAt: f.expiresAt ?? null, remindDays: f.remindDays ?? null,
        version: f.version ?? 1, md5: f.md5 ?? null,
        aiStatus: f.aiStatus ?? null, aiError: f.aiError ?? null, aiAt: f.aiAt ?? null, aiData: ai,
        deletedAt: f.deletedAt ?? null, deletedBy: f.deletedBy ?? null,
        matTep: !f.objectKey && f.status !== 'uploading',
        xemTaiCho: kho.laXemTaiCho(f.type),
        thumbUrl: kemAnh && f.thumbKey && f.objectKey ? kho.duongXem(schema, f.id, 'nho') : null,
    }
}

function docNgay(v: unknown): Date | null | undefined {
    if (v === undefined) return undefined
    if (v === null || v === '') return null
    const d = new Date(String(v))
    if (isNaN(d.getTime())) throw loi(400, 'Ngày không hợp lệ')
    return d
}
function docNhan(v: unknown): string[] | undefined {
    if (v === undefined) return undefined
    const ds = Array.isArray(v) ? v : String(v || '').split(',')
    return Array.from(new Set(ds.map(x => String(x).replace(/\s+/g, ' ').trim().toLowerCase().replace(/^#/, '').slice(0, 30)).filter(Boolean))).slice(0, 15)
}
function docTen(v: unknown): string {
    const t = String(v ?? '').split(/[\\/]/).pop()!.replace(/[\x00-\x1f]/g, '').trim().slice(0, 200)
    if (!t) throw loi(400, 'Thiếu tên tệp')
    return t
}

async function thuMucTonTai(prisma: any, id: string | null | undefined): Promise<string | null> {
    if (!id) return null
    const f = await prisma.storageFolder.findUnique({ where: { id: String(id) }, select: { id: true } })
    if (!f) throw loi(400, 'Thư mục không tồn tại')
    return f.id
}
/** id các thư mục con cháu (kể cả chính nó) */
async function thuMucConChau(prisma: any, goc: string): Promise<string[]> {
    const tat: any[] = await prisma.storageFolder.findMany({ select: { id: true, parentId: true } })
    const con = new Map<string, string[]>()
    for (const t of tat) if (t.parentId) con.set(t.parentId, [...(con.get(t.parentId) || []), t.id])
    const ra: string[] = []
    const di = (id: string, sau: number) => { if (sau > 20 || ra.includes(id)) return; ra.push(id); for (const c of con.get(id) || []) di(c, sau + 1) }
    di(goc, 0)
    return ra
}
async function duongThuMuc(prisma: any, id: string | null): Promise<{ id: string; name: string }[]> {
    const ra: { id: string; name: string }[] = []
    let cur = id
    for (let i = 0; cur && i < 20; i++) {
        const f = await prisma.storageFolder.findUnique({ where: { id: cur }, select: { id: true, name: true, parentId: true } })
        if (!f) break
        ra.unshift({ id: f.id, name: f.name })
        cur = f.parentId
    }
    return ra
}

// ═══════════════════════════════ ĐƯỜNG CÔNG KHAI (ký HMAC) ═══════════════════════════════

/** Phát một object: hỗ trợ Range (video/PDF lớn tua được), chặn chạy mã */
async function phatTep(req: Request, res: Response, key: string, mime: string, tenTai: string, cheDo: 'inline' | 'attachment', tuoiGiay: number) {
    const tt = await kho.thongTin(key)
    if (!tt) { res.status(404).json({ success: false, error: 'Tệp không còn trong kho' }); return }
    const co = tt.size
    const kieu = cheDo === 'inline' && kho.laXemTaiCho(mime) ? 'inline' : 'attachment'
    res.setHeader('Content-Type', mime || 'application/octet-stream')
    res.setHeader('Content-Disposition', kho.contentDisposition(kieu, tenTai))
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Cache-Control', `private, max-age=${Math.max(0, Math.floor(tuoiGiay))}, no-transform`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
    // helmet mặc định X-Frame-Options: SAMEORIGIN ⇒ khung xem PDF trên kengi.vn (khác origin api.kengi.vn) bị chặn.
    // Thay bằng frame-ancestors chỉ cho đúng các trang Kengi nhúng.
    res.removeHeader('X-Frame-Options')
    const nhung = `frame-ancestors 'self' ${NGUON_DUOC_PHEP.join(' ')}`
    res.setHeader('Content-Security-Policy', kieu === 'attachment' ? `sandbox; default-src 'none'; ${nhung}` : nhung)
    let tu = 0, den = co - 1, mot = false
    const r = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''))
    if (r && co > 0) {
        if (r[1] === '' && r[2]) { tu = Math.max(0, co - Number(r[2])); den = co - 1 }
        else { tu = Number(r[1] || 0); den = r[2] ? Math.min(Number(r[2]), co - 1) : co - 1 }
        if (tu > den || tu >= co) { res.status(416).setHeader('Content-Range', `bytes */${co}`); res.end(); return }
        mot = true
    }
    res.status(mot ? 206 : 200)
    res.setHeader('Content-Length', String(co ? den - tu + 1 : 0))
    if (mot) res.setHeader('Content-Range', `bytes ${tu}-${den}/${co}`)
    if (req.method === 'HEAD' || co === 0) { res.end(); return }
    const luong = kho.luongDoc(key, tu, den)
    luong.on('error', (e: any) => { console.error('[Vault] luồng đọc gãy:', e?.message || e); res.destroy(e) })
    req.on('close', () => { try { luong.destroy() } catch { /* đã đóng */ } })
    luong.pipe(res)
}

router.get('/xem/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id || ''), schema = String(req.query.s || ''), het = Number(req.query.h) || 0, cheDo = String(req.query.c || 'xem')
    try {
        const kq = kho.kiemXem(schema, id, het, cheDo, req.query.k)
        if (kq === 'sai') { res.status(403).json({ success: false, error: 'Link xem tệp không hợp lệ' }); return }
        if (kq === 'het-han') { res.status(403).json({ success: false, error: 'Link đã hết hạn — mở lại tệp trong Kengi Vault' }); return }
        const prisma: any = getStorePrisma(schema)
        await kho.damBaoBangVault(prisma, schema)
        const f = await prisma.storageFile.findUnique({ where: { id }, select: { name: true, type: true, objectKey: true, thumbKey: true, status: true } })
        if (!f || f.status === 'uploading') { res.status(404).json({ success: false, error: 'Không thấy tệp' }); return }
        const key = cheDo === 'nho' ? f.thumbKey : f.objectKey
        if (!key || !kho.khoaCuaCuaHang(key, schema)) { res.status(404).json({ success: false, error: cheDo === 'nho' ? 'Tệp chưa có ảnh nhỏ' : 'Tệp gốc đã mất (lưu trên ổ tạm của máy chủ cũ)' }); return }
        const conLai = (het - Date.now()) / 1000
        if (cheDo === 'nho') await phatTep(req, res, key, 'image/jpeg', `${f.name}.jpg`, 'inline', conLai)
        else await phatTep(req, res, key, f.type, f.name, cheDo === 'tai' ? 'attachment' : 'inline', conLai)
    } catch (e: any) {
        if (!res.headersSent) traLoi(res, e, 'xem')
        else res.destroy()
    }
})

router.get('/zip', async (req: Request, res: Response) => {
    const schema = String(req.query.s || ''), ds = String(req.query.ids || ''), het = Number(req.query.h) || 0
    try {
        const kq = kho.kiemZip(schema, ds, het, req.query.k)
        if (kq !== 'ok') { res.status(403).json({ success: false, error: kq === 'het-han' ? 'Link ZIP đã hết hạn — chọn lại tệp' : 'Link ZIP không hợp lệ' }); return }
        const ids = ds.split(',').filter(Boolean).slice(0, ZIP_TOI_DA_TEP)
        const prisma: any = getStorePrisma(schema)
        await kho.damBaoBangVault(prisma, schema)
        const tep: any[] = await prisma.storageFile.findMany({ where: { id: { in: ids }, status: { in: ['ready', 'version'] }, objectKey: { not: null } } })
        if (!tep.length) { res.status(404).json({ success: false, error: 'Không còn tệp nào để nén' }); return }
        const thuMuc: any[] = await prisma.storageFolder.findMany({ select: { id: true, name: true, parentId: true } })
        const tm = new Map(thuMuc.map(t => [t.id, t]))
        const duong = (id: string | null) => {
            const p: string[] = []
            for (let cur = id, i = 0; cur && i < 20; i++) { const t = tm.get(cur); if (!t) break; p.unshift(t.name); cur = t.parentId }
            return p.join('/')
        }
        const ngay = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
        res.status(200)
        res.setHeader('Content-Type', 'application/zip')
        res.setHeader('Content-Disposition', kho.contentDisposition('attachment', `Kengi-Vault-${ngay}.zip`))
        res.setHeader('Cache-Control', 'private, no-store, no-transform')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        const zip = new BoGhiZip(res)
        let dong = false
        req.on('close', () => { dong = true })
        for (const f of tep) {
            if (dong) return
            if (!kho.khoaCuaCuaHang(f.objectKey, schema)) continue
            const thu = duong(f.folderId)
            const ten = f.status === 'version' ? `${f.name} (phiên bản ${f.version})` : f.name
            await zip.themMuc(thu ? `${thu}/${ten}` : ten, new Date(f.createdAt), kho.luongDoc(f.objectKey))
        }
        await zip.ketThuc()
        res.end()
    } catch (e: any) {
        if (!res.headersSent) traLoi(res, e, 'zip')
        else { console.error('[Vault] ZIP gãy giữa chừng:', e?.message || e); res.destroy() }
    }
})

/** Link chia sẻ công khai (gửi khách/NCC qua Zalo…) — hạn, thu hồi, đếm lượt ở bảng StorageShare */
router.get('/chia-se/:ma', async (req: Request, res: Response) => {
    try {
        const ma = kho.docMaChiaSe(String(req.params.ma || ''))
        if (!ma) { res.status(404).type('text/plain; charset=utf-8').send('Link chia sẻ không hợp lệ.'); return }
        const prisma: any = getStorePrisma(ma.schema)
        await kho.damBaoBangVault(prisma, ma.schema)
        const s = await prisma.storageShare.findUnique({ where: { id: ma.shareId } })
        const f = s ? await prisma.storageFile.findUnique({ where: { id: s.fileId }, select: { name: true, type: true, objectKey: true, status: true } }) : null
        const lyDo = !s || !f ? 'Link chia sẻ không tồn tại.'
            : s.revokedAt ? 'Link chia sẻ đã bị thu hồi.'
                : new Date(s.expiresAt).getTime() < Date.now() ? 'Link chia sẻ đã hết hạn.'
                    : f.status !== 'ready' || !f.objectKey ? 'Tệp không còn được chia sẻ.' : null
        if (lyDo) { res.status(410).type('text/plain; charset=utf-8').send(lyDo); return }
        const range = String(req.headers.range || '')
        const lanMoi = req.method !== 'HEAD' && (!range || /^bytes=0-/.test(range))
        if (lanMoi) {
            // Đếm lượt NGUYÊN TỬ: chạm trần maxViews thì thôi, không để hai người cùng lọt lượt cuối
            const n = await prisma.$executeRawUnsafe(
                `UPDATE "${ma.schema}"."StorageShare" SET "views" = "views" + 1, "lastViewAt" = now() WHERE "id" = $1 AND ("maxViews" IS NULL OR "views" < "maxViews")`, ma.shareId)
            if (!n) { res.status(410).type('text/plain; charset=utf-8').send('Link chia sẻ đã hết lượt xem.'); return }
        }
        const conLai = Math.min(3600, (new Date(s.expiresAt).getTime() - Date.now()) / 1000)
        await phatTep(req, res, f.objectKey, f.type, f.name, req.query.tai ? 'attachment' : 'inline', conLai)
    } catch (e: any) {
        if (!res.headersSent) traLoi(res, e, 'chia-se')
        else res.destroy()
    }
})

/** Giả lập GCS resumable — CHỈ khi VAULT_DRIVER=local (máy dev/thử) */
router.put('/cuc-bo/:token', express.raw({ type: () => true, limit: '20mb' }), async (req: Request, res: Response) => {
    try {
        res.setHeader('Access-Control-Expose-Headers', 'Range')
        const than = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
        const kq = await kho.nhanKhoiCucBo(String(req.params.token), req.headers['content-range'] as string | undefined, than)
        if (kq.range) res.setHeader('Range', kq.range)
        if (kq.status === 308) { res.status(308).end(); return }
        if (kq.status === 200) { res.status(200).json({ success: true }); return }
        res.status(kq.status).json({ success: false, error: kq.loi })
    } catch (e: any) { traLoi(res, e, 'cuc-bo') }
})

// ═══════════════════════════════ ĐƯỜNG CẦN ĐĂNG NHẬP ═══════════════════════════════
router.use(authMiddleware)

router.get('/quyen', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        res.json({ success: true, data: { ...n.q, caiDat: await layCaiDat(n.prisma), toiDaTep: kho.TOI_DA_TEP, khoi: kho.KHOI_TAI_LEN, cucBo: kho.laCucBo() } })
    } catch (e: any) { traLoi(res, e, 'quyen') }
})

router.get('/tong-quan', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        const chiCuaToi = !n.q.xem ? { uploaderId: n.userId } : {}
        const p = n.prisma
        const theoNhom: any[] = await p.storageFile.groupBy({ by: ['category'], where: { status: 'ready', ...chiCuaToi }, _count: { _all: true }, _sum: { size: true } })
        const tatCa: any[] = await p.storageFile.findMany({ where: { status: { in: ['ready', 'trash', 'version'] }, ...chiCuaToi }, select: { status: true, size: true, type: true, name: true, objectKey: true, createdAt: true, expiresAt: true, aiStatus: true, pinned: true } })
        const bayNgay = Date.now() - 7 * 86400_000
        const now = Date.now()
        const theoLoai: Record<string, number> = {}
        let dungLuong = 0, ganDay = 0, sapHetHan = 0, daHetHan = 0, thungRac = 0, matTep = 0, aiCho = 0, ghim = 0, phienBan = 0, tong = 0
        for (const f of tatCa) {
            if (f.objectKey) dungLuong += f.size
            if (f.status === 'trash') { thungRac++; continue }
            if (f.status === 'version') { phienBan++; continue }
            tong++
            if (!f.objectKey) matTep++
            const nh = nhomLoai(f.type, f.name)
            theoLoai[nh] = (theoLoai[nh] || 0) + 1
            if (new Date(f.createdAt).getTime() > bayNgay) ganDay++
            if (f.pinned) ghim++
            if (f.aiStatus === 'pending') aiCho++
            if (f.expiresAt) {
                const con = new Date(f.expiresAt).getTime() - now
                if (con < 0) daHetHan++
                else if (con <= 30 * 86400_000) sapHetHan++
            }
        }
        const soThuMuc = await p.storageFolder.count()
        res.json({
            success: true,
            data: {
                tong, dungLuong, ganDay, sapHetHan, daHetHan, thungRac, matTep, aiCho, ghim, phienBan, soThuMuc,
                theoNhom: Object.fromEntries(theoNhom.map(x => [x.category, { count: x._count._all, size: x._sum.size || 0 }])),
                theoLoai, mienPhi: 5 * 1024 ** 3, tran: TRAN_CUA_HANG,
            },
        })
    } catch (e: any) { traLoi(res, e, 'tong-quan') }
})

/** id tệp khớp chuỗi tìm (không dấu, mọi từ phải có) ở tên, mô tả, đối tượng, nhãn, CHỮ AI ĐỌC ĐƯỢC */
async function timTheoChu(n: Ngu, q: string): Promise<string[]> {
    const tu = boDauTim(q).split(/\s+/).filter(Boolean).slice(0, 6)
    if (!tu.length) return []
    const cot = [`"name"`, `coalesce("description",'')`, `coalesce("referenceName",'')`, `coalesce("aiText",'')`, `array_to_string("tags",' ')`, `coalesce("aiData"->>'tieuDe','')`]
    const thamSo: any[] = [CO_DAU, KHONG_DAU]
    const dk = tu.map(t => {
        thamSo.push(`%${t.replace(/[\\%_]/g, m => '\\' + m)}%`)
        const i = thamSo.length
        return '(' + cot.map(c => `translate(lower(${c}), $1, $2) LIKE $${i}`).join(' OR ') + ')'
    })
    const rows: any[] = await n.prisma.$queryRawUnsafe(`SELECT "id" FROM "${n.schema}"."StorageFile" WHERE ${dk.join(' AND ')} LIMIT 5000`, ...thamSo)
    return rows.map(r => r.id)
}

router.get('/files', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        const qs = req.query as Record<string, string>
        const where: any = { AND: [] as any[] }
        const xemTrangThai = String(qs.status || 'ready')
        if (xemTrangThai === 'trash') where.status = 'trash'
        else if (xemTrangThai === 'lost') { where.status = 'ready'; where.objectKey = null }
        else where.status = 'ready'
        if (!n.q.xem) where.uploaderId = n.userId
        if (qs.folderId === 'root') where.folderId = null
        else if (qs.folderId && qs.folderId !== 'all') {
            where.folderId = qs.deQuy === '1' ? { in: await thuMucConChau(n.prisma, qs.folderId) } : qs.folderId
        }
        if (qs.category && qs.category !== 'all') where.category = qs.category
        if (qs.referenceType) where.referenceType = qs.referenceType
        if (qs.referenceId) where.referenceId = qs.referenceId
        if (qs.tag) where.tags = { has: String(qs.tag).toLowerCase() }
        if (qs.pinned === '1') where.pinned = true
        if (qs.nguoiTai) where.uploaderId = qs.nguoiTai
        if (qs.view === 'recent') where.createdAt = { gte: new Date(Date.now() - 7 * 86400_000) }
        if (qs.view === 'expiring') where.expiresAt = { not: null, lte: new Date(Date.now() + 30 * 86400_000) }
        if (qs.view === 'ai-pending') where.aiStatus = 'pending'
        const nh = qs.type && qs.type !== 'all' ? dieuKienNhom(qs.type) : null
        if (nh) where.AND.push(nh)
        if (qs.q && String(qs.q).trim()) where.id = { in: await timTheoChu(n, String(qs.q).slice(0, 100)) }
        if (!where.AND.length) delete where.AND
        const sapXep = String(qs.sort || 'date'), chieu = qs.dir === 'asc' ? 'asc' : 'desc'
        const orderBy: any[] = []
        if (qs.view !== 'expiring' && sapXep !== 'expires') orderBy.push({ pinned: 'desc' })
        if (sapXep === 'name') orderBy.push({ name: chieu })
        else if (sapXep === 'size') orderBy.push({ size: chieu })
        else if (sapXep === 'expires' || qs.view === 'expiring') orderBy.push({ expiresAt: qs.dir === 'desc' ? 'desc' : 'asc' })
        else if (xemTrangThai === 'trash') orderBy.push({ deletedAt: 'desc' })
        else orderBy.push({ createdAt: chieu })
        const page = Math.max(1, Number(qs.page) || 1)
        const pageSize = Math.min(200, Math.max(1, Number(qs.pageSize) || 60))
        const total = await n.prisma.storageFile.count({ where })
        const rows = await n.prisma.storageFile.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, omit: { aiText: true } as any })
        res.json({ success: true, data: rows.map((f: any) => dto(f, n.schema)), total, page, pageSize })
    } catch (e: any) { traLoi(res, e, 'files') }
})

router.get('/files/:id', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        const f = await n.prisma.storageFile.findUnique({ where: { id: String(req.params.id) } })
        if (!f || f.status === 'uploading' || f.status === 'version' || !coTheThay(n, f)) throw loi(404, 'Không thấy tệp')
        const hoatDong = await n.prisma.storageActivity.findMany({ where: { fileId: f.id }, orderBy: { createdAt: 'desc' }, take: 40 })
        const phienBan = await n.prisma.storageFile.findMany({ where: { versionOf: f.id, status: 'version' }, orderBy: { version: 'desc' }, omit: { aiText: true } as any })
        const chiaSe = n.q.chiaSe ? await n.prisma.storageShare.findMany({ where: { fileId: f.id }, orderBy: { createdAt: 'desc' }, take: 20 }) : []
        const trung = f.md5 ? await n.prisma.storageFile.findMany({ where: { md5: f.md5, id: { not: f.id }, status: 'ready' }, select: { id: true, name: true, folderId: true }, take: 5 }) : []
        res.json({
            success: true,
            data: {
                ...dto(f, n.schema),
                aiTextTrich: f.aiText ? String(f.aiText).slice(0, 4000) : null,
                thuMuc: await duongThuMuc(n.prisma, f.folderId),
                hoatDong, trungNoiDung: trung,
                phienBan: phienBan.map((v: any) => dto(v, n.schema, false)),
                chiaSe: chiaSe.map((s: any) => ({
                    id: s.id, url: `/storage/chia-se/${kho.maChiaSe(n.schema, s.id)}`, note: s.note, expiresAt: s.expiresAt, maxViews: s.maxViews,
                    views: s.views, revokedAt: s.revokedAt, lastViewAt: s.lastViewAt, createdAt: s.createdAt, createdBy: s.createdBy,
                    conHieuLuc: !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now() && (s.maxViews == null || s.views < s.maxViews),
                })),
            },
        })
    } catch (e: any) { traLoi(res, e, 'file') }
})

/** Sửa thông tin một tệp — trả về bản mới */
async function suaTep(n: Ngu, f: any, b: any): Promise<any> {
    const data: any = {}
    const doi: string[] = []
    if (b.name !== undefined) { const t = docTen(b.name); if (t !== f.name) { data.name = t; doi.push(`tên "${t}"`) } }
    if (b.description !== undefined) { data.description = b.description ? String(b.description).slice(0, 2000) : null; doi.push('mô tả') }
    if (b.category !== undefined) {
        if (!(NHOM_TAI_LIEU as readonly string[]).includes(b.category)) throw loi(400, 'Phân loại không hợp lệ')
        if (b.category !== f.category) { data.category = b.category; doi.push('phân loại') }
    }
    if (b.folderId !== undefined) { const fo = await thuMucTonTai(n.prisma, b.folderId); if (fo !== f.folderId) { data.folderId = fo; doi.push('thư mục') } }
    const nhan = docNhan(b.tags)
    if (nhan) { data.tags = nhan; doi.push('nhãn') }
    if (b.referenceType !== undefined) {
        if (b.referenceType && !(LOAI_LIEN_KET as readonly string[]).includes(b.referenceType)) throw loi(400, 'Loại liên kết không hợp lệ')
        data.referenceType = b.referenceType || null
        data.referenceId = b.referenceType ? (b.referenceId ? String(b.referenceId).slice(0, 64) : null) : null
        data.referenceName = b.referenceType ? (b.referenceName ? String(b.referenceName).slice(0, 200) : null) : null
        doi.push('liên kết')
    }
    const het = docNgay(b.expiresAt)
    if (het !== undefined) {
        const cu = f.expiresAt ? new Date(f.expiresAt).getTime() : null
        if ((het?.getTime() ?? null) !== cu) { data.expiresAt = het; data.reminded = null; doi.push(het ? `hạn ${het.toISOString().slice(0, 10)}` : 'bỏ hạn') }
    }
    if (b.remindDays !== undefined) {
        const r = b.remindDays === null || b.remindDays === '' ? null : Number(b.remindDays)
        if (r !== null && (!Number.isInteger(r) || r < 0 || r > 365)) throw loi(400, 'Số ngày nhắc phải từ 0 tới 365')
        data.remindDays = r
    }
    if (b.pinned !== undefined) data.pinned = !!b.pinned
    if (!Object.keys(data).length) return f
    data.updatedBy = await tenNguoi(n)
    const moi = await n.prisma.storageFile.update({ where: { id: f.id }, data })
    if (doi.length) await ghiHD(n, f.id, data.folderId !== undefined && doi.length === 1 ? 'di_chuyen' : 'sua', `Đổi ${doi.join(', ')}`)
    return moi
}

router.patch('/files/:id', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        const f = await n.prisma.storageFile.findUnique({ where: { id: String(req.params.id) } })
        if (!f || !['ready', 'trash'].includes(f.status) || !coTheThay(n, f)) throw loi(404, 'Không thấy tệp')
        if (!coTheSua(n, f)) throw loi(403, 'Bạn không có quyền sửa tệp này')
        const moi = await suaTep(n, f, req.body || {})
        res.json({ success: true, data: dto(moi, n.schema) })
    } catch (e: any) { traLoi(res, e, 'sua') }
})

async function boVaoThungRac(n: Ngu, f: any) {
    await n.prisma.storageFile.update({ where: { id: f.id }, data: { status: 'trash', deletedAt: new Date(), deletedBy: await tenNguoi(n) } })
    await n.prisma.storageShare.updateMany({ where: { fileId: f.id, revokedAt: null }, data: { revokedAt: new Date() } })
    await ghiHD(n, f.id, 'xoa', `Bỏ vào thùng rác (tự xoá hẳn sau ${THUNG_RAC_NGAY} ngày)`)
}

router.delete('/files/:id', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        const f = await n.prisma.storageFile.findUnique({ where: { id: String(req.params.id) } })
        if (!f) { res.json({ success: true }); return }
        const cuaToiMoiTai = n.q.taiLen && f.uploaderId === n.userId && Date.now() - new Date(f.createdAt).getTime() < 24 * 3600_000
        if (!n.q.xoa && !cuaToiMoiTai) throw loi(403, 'Bạn không có quyền xoá tệp')
        if (req.query.vinhVien === '1' || f.status === 'trash' || f.status === 'uploading' || !f.objectKey) {
            if (f.status === 'ready' && f.objectKey) throw loi(400, 'Bỏ vào thùng rác trước rồi mới xoá vĩnh viễn')
            await xoaVinhVien(n.prisma, n.schema, f)
            await ghiHD(n, null, 'xoa_vinh_vien', `Xoá vĩnh viễn "${f.name}"`)
        } else {
            await boVaoThungRac(n, f)
        }
        res.json({ success: true })
    } catch (e: any) { traLoi(res, e, 'xoa') }
})

router.post('/files/:id/khoi-phuc', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        if (!n.q.xoa) throw loi(403, 'Bạn không có quyền khôi phục tệp')
        const f = await n.prisma.storageFile.findUnique({ where: { id: String(req.params.id) } })
        if (!f || f.status !== 'trash') throw loi(404, 'Tệp không nằm trong thùng rác')
        // Thư mục cũ đã bị xoá ⇒ khôi phục ra ngoài cùng
        const fo = f.folderId ? await n.prisma.storageFolder.findUnique({ where: { id: f.folderId }, select: { id: true } }) : null
        const moi = await n.prisma.storageFile.update({ where: { id: f.id }, data: { status: 'ready', deletedAt: null, deletedBy: null, folderId: fo ? f.folderId : null } })
        await ghiHD(n, f.id, 'khoi_phuc', 'Khôi phục từ thùng rác')
        res.json({ success: true, data: dto(moi, n.schema) })
    } catch (e: any) { traLoi(res, e, 'khoi-phuc') }
})

router.post('/files/bulk', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        const b = req.body || {}
        const ids: string[] = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 500) : []
        if (!ids.length) throw loi(400, 'Chưa chọn tệp nào')
        const viec = String(b.action || '')
        const can: Record<string, keyof Quyen> = { move: 'sua', tag: 'sua', untag: 'sua', category: 'sua', pin: 'sua', unpin: 'sua', link: 'sua', expires: 'sua', trash: 'xoa', restore: 'xoa', purge: 'xoa' }
        if (!can[viec]) throw loi(400, 'Thao tác không hợp lệ')
        if (!n.q[can[viec]]) throw loi(403, 'Bạn không có quyền làm việc này')
        const tep: any[] = await n.prisma.storageFile.findMany({ where: { id: { in: ids }, status: { in: viec === 'restore' || viec === 'purge' ? ['trash'] : ['ready'] } } })
        let xong = 0
        const fo = viec === 'move' ? await thuMucTonTai(n.prisma, b.folderId || null) : null
        for (const f of tep) {
            if (viec === 'trash') await boVaoThungRac(n, f)
            else if (viec === 'restore') {
                const coTM = f.folderId ? await n.prisma.storageFolder.findUnique({ where: { id: f.folderId }, select: { id: true } }) : null
                await n.prisma.storageFile.update({ where: { id: f.id }, data: { status: 'ready', deletedAt: null, deletedBy: null, folderId: coTM ? f.folderId : null } })
                await ghiHD(n, f.id, 'khoi_phuc', 'Khôi phục từ thùng rác')
            } else if (viec === 'purge') {
                await xoaVinhVien(n.prisma, n.schema, f)
                await ghiHD(n, null, 'xoa_vinh_vien', `Xoá vĩnh viễn "${f.name}"`)
            } else if (viec === 'move') await suaTep(n, f, { folderId: fo })
            else if (viec === 'category') await suaTep(n, f, { category: b.category })
            else if (viec === 'tag') await suaTep(n, f, { tags: [...(f.tags || []), ...(docNhan(b.tags) || [])] })
            else if (viec === 'untag') { const bo = new Set(docNhan(b.tags) || []); await suaTep(n, f, { tags: (f.tags || []).filter((t: string) => !bo.has(t)) }) }
            else if (viec === 'pin' || viec === 'unpin') await suaTep(n, f, { pinned: viec === 'pin' })
            else if (viec === 'link') await suaTep(n, f, { referenceType: b.referenceType || null, referenceId: b.referenceId, referenceName: b.referenceName })
            else if (viec === 'expires') await suaTep(n, f, { expiresAt: b.expiresAt ?? null })
            xong++
        }
        res.json({ success: true, data: { xong, boQua: ids.length - xong } })
    } catch (e: any) { traLoi(res, e, 'bulk') }
})

const LAN_XEM = new Map<string, number>()
router.get('/files/:id/link', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        const f = await n.prisma.storageFile.findUnique({ where: { id: String(req.params.id) } })
        if (!f || f.status === 'uploading' || !coTheThay(n, f)) throw loi(404, 'Không thấy tệp')
        let dich = f
        if (req.query.ban) {
            const v = await n.prisma.storageFile.findUnique({ where: { id: String(req.query.ban) } })
            if (!v || v.versionOf !== f.id) throw loi(404, 'Không thấy phiên bản này')
            dich = v
        }
        if (!dich.objectKey) throw loi(410, 'Tệp gốc đã mất (lưu trên ổ tạm của máy chủ cũ) — hãy tải lại bản gốc')
        const tai = req.query.che === 'tai'
        if (tai && !n.q.taiVe && f.uploaderId !== n.userId) throw loi(403, 'Bạn không có quyền tải tệp về máy')
        const het = Date.now() + kho.HAN_LINK_MS
        // Nhật ký: mỗi người mỗi tệp tối đa 1 dòng "xem" / 10 phút (xem trước bấm liên tục là chuyện thường)
        const khoaXem = `${n.schema}:${n.userId}:${f.id}:${tai ? 't' : 'x'}`
        if (Date.now() - (LAN_XEM.get(khoaXem) || 0) > 10 * 60_000) {
            LAN_XEM.set(khoaXem, Date.now())
            if (LAN_XEM.size > 5000) LAN_XEM.clear()
            await ghiHD(n, f.id, tai ? 'tai_ve' : 'xem', dich.id !== f.id ? `Phiên bản ${dich.version}` : undefined)
        }
        res.json({ success: true, data: { url: kho.duongXem(n.schema, dich.id, tai ? 'tai' : 'xem', het), expiresAt: het, xemTaiCho: kho.laXemTaiCho(dich.type) } })
    } catch (e: any) { traLoi(res, e, 'link') }
})

// ─── Tải lên (phiên resumable thẳng vào bucket) ──────────────────────────────
router.post('/tai-len/bat-dau', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        if (!n.q.taiLen) throw loi(403, 'Bạn không có quyền tải tệp lên')
        const b = req.body || {}
        const name = docTen(b.name)
        const size = Number(b.size)
        if (!Number.isInteger(size) || size <= 0) throw loi(400, 'Tệp rỗng hoặc cỡ tệp không hợp lệ')
        if (size > kho.TOI_DA_TEP) throw loi(413, `Tệp quá lớn — tối đa ${(kho.TOI_DA_TEP / 1e9).toFixed(0)} GB mỗi tệp`)
        const type = String(b.type || 'application/octet-stream').slice(0, 120).toLowerCase() || 'application/octet-stream'
        const dung: any[] = await n.prisma.$queryRawUnsafe(`SELECT coalesce(sum("size"),0)::bigint AS s FROM "${n.schema}"."StorageFile" WHERE "objectKey" IS NOT NULL`)
        if (Number(dung[0]?.s || 0) + size > TRAN_CUA_HANG) throw loi(413, `Kho tài liệu của cửa hàng đã chạm trần ${Math.round(TRAN_CUA_HANG / 1024 ** 3)} GB — dọn thùng rác hoặc liên hệ Kengi`)
        let thayCho: any = null
        if (b.thayChoId) {
            thayCho = await n.prisma.storageFile.findUnique({ where: { id: String(b.thayChoId) } })
            if (!thayCho || thayCho.status !== 'ready' || !coTheThay(n, thayCho)) throw loi(404, 'Không thấy tệp cần thay phiên bản')
            if (!coTheSua(n, thayCho)) throw loi(403, 'Bạn không có quyền tải phiên bản mới cho tệp này')
        }
        const lienKet = b.referenceType && (LOAI_LIEN_KET as readonly string[]).includes(b.referenceType) ? String(b.referenceType) : null
        const nhom = (NHOM_TAI_LIEU as readonly string[]).includes(b.category) ? b.category
            : lienKet === 'customer' ? 'contracts_customer' : lienKet === 'supplier' ? 'docs_supplier' : 'internal'
        const id = `v${crypto.randomBytes(12).toString('hex')}`
        const key = kho.khoaMoi(n.schema, id)
        await n.prisma.storageFile.create({
            data: {
                id, name, url: `vault:${id}`, size, type, category: thayCho ? thayCho.category : nhom,
                status: 'uploading', objectKey: key,
                folderId: thayCho ? thayCho.folderId : await thuMucTonTai(n.prisma, b.folderId || null),
                tags: thayCho ? [] : (docNhan(b.tags) || []),
                referenceType: thayCho ? null : lienKet,
                referenceId: thayCho || !lienKet ? null : (b.referenceId ? String(b.referenceId).slice(0, 64) : null),
                referenceName: thayCho || !lienKet ? null : (b.referenceName ? String(b.referenceName).slice(0, 200) : null),
                description: thayCho ? null : (b.description ? String(b.description).slice(0, 2000) : null),
                expiresAt: thayCho ? null : (docNgay(b.expiresAt) ?? null),
                versionOf: thayCho ? thayCho.id : null,
                uploadedBy: await tenNguoi(n), uploaderId: n.userId,
            },
        })
        const origin = String(req.headers.origin || '')
        let uploadUrl: string
        try {
            uploadUrl = await kho.taoPhienTaiLen(key, type, size, NGUON_DUOC_PHEP.includes(origin) ? origin : undefined)
        } catch (e: any) {
            await n.prisma.storageFile.delete({ where: { id } }).catch(() => {})
            console.error('[Vault] mở phiên tải lên hỏng:', e?.message || e)
            throw loi(503, `Kho lưu trữ chưa sẵn sàng: ${String(e?.message || e).slice(0, 160)}`)
        }
        res.json({ success: true, data: { id, uploadUrl, khoi: kho.KHOI_TAI_LEN, cucBo: kho.laCucBo() } })
    } catch (e: any) { traLoi(res, e, 'bat-dau') }
})

/** Đánh dấu cần AI đọc (nếu bật tự động + loại đọc được) — FE gọi /ai-doc ngay sau, cron đọc nốt nếu tab đóng */
function canAi(caiDat: { aiTuDong: boolean }, f: any): boolean {
    return caiDat.aiTuDong && !!cachGuiAi(f.type, f.name, f.size).kieu
}

router.post('/tai-len/:id/xong', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        const f = await n.prisma.storageFile.findUnique({ where: { id: String(req.params.id) } })
        if (!f || f.status !== 'uploading') throw loi(404, 'Không thấy phiên tải lên (có thể đã xong hoặc đã huỷ)')
        if (f.uploaderId !== n.userId && !n.q.sua) throw loi(403, 'Phiên tải lên của người khác')
        const tt = await kho.thongTin(f.objectKey)
        if (!tt) throw loi(409, 'Tệp chưa lên tới kho — tải lại')
        if (tt.size !== f.size) {
            await kho.xoa(f.objectKey)
            await n.prisma.storageFile.delete({ where: { id: f.id } })
            throw loi(400, `Tệp lên kho ${tt.size} byte, khác cỡ đã khai ${f.size} — đã huỷ, tải lại`)
        }
        const dau = await kho.docDoan(f.objectKey, 0, Math.min(tt.size, 8192) - 1)
        const { mime } = kho.mimePhat(f.type, dau)
        const caiDat = await layCaiDat(n.prisma)
        let ketQua: any
        if (f.versionOf) {
            // Phiên bản mới: GIỮ id tệp hiện hành (link, liên kết, thư mục không đổi), đẩy nội dung cũ thành dòng phiên bản
            const goc = await n.prisma.storageFile.findUnique({ where: { id: f.versionOf } })
            if (!goc || goc.status !== 'ready') { await kho.xoa(f.objectKey); await n.prisma.storageFile.delete({ where: { id: f.id } }); throw loi(404, 'Tệp gốc không còn') }
            await n.prisma.storageFile.create({
                data: {
                    id: `v${crypto.randomBytes(12).toString('hex')}`, name: goc.name, url: goc.url, size: goc.size, type: goc.type, category: goc.category,
                    status: 'version', objectKey: goc.objectKey, thumbKey: goc.thumbKey, md5: goc.md5, version: goc.version, versionOf: goc.id,
                    uploadedBy: goc.uploadedBy, uploaderId: goc.uploaderId, createdAt: goc.createdAt, aiData: goc.aiData ?? undefined,
                },
            })
            const tamThumb = f.thumbKey
            await n.prisma.storageFile.delete({ where: { id: f.id } })
            ketQua = await n.prisma.storageFile.update({
                where: { id: goc.id },
                data: {
                    name: f.name, size: tt.size, type: mime, md5: tt.md5, objectKey: f.objectKey, thumbKey: tamThumb ?? null,
                    version: (goc.version || 1) + 1, uploadedBy: f.uploadedBy, uploaderId: f.uploaderId, updatedBy: f.uploadedBy,
                    aiStatus: canAi(caiDat, { ...f, type: mime, size: tt.size }) ? 'pending' : null, aiData: StoreNS.DbNull, aiText: null, aiError: null, aiAt: null,
                },
            })
            await ghiHD(n, goc.id, 'phien_ban', `Tải phiên bản ${ketQua.version}: "${f.name}"`)
        } else {
            ketQua = await n.prisma.storageFile.update({
                where: { id: f.id },
                data: { status: 'ready', type: mime, md5: tt.md5, aiStatus: canAi(caiDat, { ...f, type: mime, size: tt.size }) ? 'pending' : null },
            })
            await ghiHD(n, f.id, 'tai_len', `${(tt.size / 1048576).toFixed(2)} MB`)
        }
        const trung = tt.md5 ? await n.prisma.storageFile.findMany({ where: { md5: tt.md5, id: { not: ketQua.id }, status: 'ready' }, select: { id: true, name: true }, take: 3 }) : []
        res.json({ success: true, data: { ...dto(ketQua, n.schema), trungNoiDung: trung } })
    } catch (e: any) { traLoi(res, e, 'xong') }
})

router.post('/tai-len/:id/huy', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        const f = await n.prisma.storageFile.findUnique({ where: { id: String(req.params.id) } })
        if (f && f.status === 'uploading' && (f.uploaderId === n.userId || n.q.sua)) {
            if (kho.khoaCuaCuaHang(f.objectKey, n.schema)) await kho.xoa(f.objectKey)
            await n.prisma.storageFile.delete({ where: { id: f.id } })
        }
        res.json({ success: true })
    } catch (e: any) { traLoi(res, e, 'huy') }
})

/** Ảnh nhỏ do trình duyệt vẽ sẵn (ảnh chụp, trang đầu PDF…) — JPEG base64 ≤ 300KB */
router.post('/files/:id/anh-nho', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        const f = await n.prisma.storageFile.findUnique({ where: { id: String(req.params.id) } })
        if (!f || !f.objectKey || !['ready', 'uploading'].includes(f.status)) throw loi(404, 'Không thấy tệp')
        if (f.uploaderId !== n.userId && !n.q.sua) throw loi(403, 'Không có quyền')
        const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''))
        if (!m) throw loi(400, 'Ảnh nhỏ phải là JPEG base64')
        const buf = Buffer.from(m[1]!, 'base64')
        if (buf.length > 300 * 1024 || kho.nhanDangByte(buf) !== 'image/jpeg') throw loi(400, 'Ảnh nhỏ sai định dạng hoặc quá 300KB')
        const key = kho.khoaAnhNho(f.objectKey)
        await kho.ghi(key, buf, 'image/jpeg')
        await n.prisma.storageFile.update({ where: { id: f.id }, data: { thumbKey: key } })
        res.json({ success: true, data: { thumbUrl: kho.duongXem(n.schema, f.id, 'nho') } })
    } catch (e: any) { traLoi(res, e, 'anh-nho') }
})

router.post('/files/:id/ai-doc', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        const f = await n.prisma.storageFile.findUnique({ where: { id: String(req.params.id) } })
        if (!f || f.status !== 'ready' || !coTheThay(n, f)) throw loi(404, 'Không thấy tệp')
        if (!coTheSua(n, f)) throw loi(403, 'Bạn không có quyền cho AI đọc tệp này')
        try {
            const moi = await aiDocMotTep(n.prisma, n.schema, f)
            await ghiHD(n, f.id, 'ai_doc', moi.aiData?.tieuDe ? `AI: ${moi.aiData.tieuDe}` : 'AI đã đọc')
            res.json({ success: true, data: dto(moi, n.schema) })
        } catch (e: any) {
            if (!(e instanceof LoiAiTaiLieu)) throw e
            await ghiLoiAi(n.prisma, f.id, e)
            res.status(e.tamThoi ? 503 : 422).json({ success: false, error: e.message, khongCoKey: e.khongCoKey })
        }
    } catch (e: any) { traLoi(res, e, 'ai-doc') }
})

// ─── Chia sẻ ─────────────────────────────────────────────────────────────────
router.post('/files/:id/chia-se', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        if (!n.q.chiaSe) throw loi(403, 'Bạn không có quyền chia sẻ tệp')
        const f = await n.prisma.storageFile.findUnique({ where: { id: String(req.params.id) } })
        if (!f || f.status !== 'ready') throw loi(404, 'Không thấy tệp')
        if (!f.objectKey) throw loi(410, 'Tệp gốc đã mất — không chia sẻ được')
        const gio = Math.min(24 * 90, Math.max(1, Number(req.body?.hanGio) || 72))
        const toiDa = req.body?.toiDaLuot ? Math.min(10_000, Math.max(1, Math.floor(Number(req.body.toiDaLuot)))) : null
        const soDangMo = await n.prisma.storageShare.count({ where: { fileId: f.id, revokedAt: null, expiresAt: { gt: new Date() } } })
        if (soDangMo >= 20) throw loi(429, 'Tệp này đã có 20 link chia sẻ còn hạn — thu hồi bớt trước')
        const s = await n.prisma.storageShare.create({
            data: { id: crypto.randomBytes(16).toString('hex'), fileId: f.id, createdBy: await tenNguoi(n), note: req.body?.ghiChu ? String(req.body.ghiChu).slice(0, 200) : null, expiresAt: new Date(Date.now() + gio * 3600_000), maxViews: toiDa },
        })
        await ghiHD(n, f.id, 'chia_se', `Link ${gio >= 48 ? `${Math.round(gio / 24)} ngày` : `${gio} giờ`}${toiDa ? `, tối đa ${toiDa} lượt` : ''}${s.note ? ` — ${s.note}` : ''}`)
        res.json({ success: true, data: { id: s.id, url: `/storage/chia-se/${kho.maChiaSe(n.schema, s.id)}`, expiresAt: s.expiresAt, maxViews: s.maxViews } })
    } catch (e: any) { traLoi(res, e, 'chia-se') }
})

router.delete('/chia-se/:shareId', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        if (!n.q.chiaSe) throw loi(403, 'Bạn không có quyền thu hồi link chia sẻ')
        const s = await n.prisma.storageShare.findUnique({ where: { id: String(req.params.shareId) } })
        if (!s) throw loi(404, 'Không thấy link chia sẻ')
        if (!s.revokedAt) {
            await n.prisma.storageShare.update({ where: { id: s.id }, data: { revokedAt: new Date() } })
            await ghiHD(n, s.fileId, 'huy_chia_se', `Thu hồi link (đã xem ${s.views} lượt)`)
        }
        res.json({ success: true })
    } catch (e: any) { traLoi(res, e, 'thu-hoi') }
})

// ─── ZIP ─────────────────────────────────────────────────────────────────────
router.post('/zip-link', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        if (!n.q.taiVe) throw loi(403, 'Bạn không có quyền tải tệp về máy')
        const ids: string[] = Array.isArray(req.body?.ids) ? Array.from(new Set(req.body.ids.map(String))) as string[] : []
        if (!ids.length) throw loi(400, 'Chưa chọn tệp nào')
        if (ids.length > ZIP_TOI_DA_TEP) throw loi(400, `Mỗi lần nén tối đa ${ZIP_TOI_DA_TEP} tệp`)
        const tep: any[] = await n.prisma.storageFile.findMany({ where: { id: { in: ids }, status: 'ready', objectKey: { not: null } }, select: { id: true, size: true } })
        if (!tep.length) throw loi(404, 'Không có tệp nào tải được (tệp đời cũ đã mất)')
        const tong = tep.reduce((s, f) => s + f.size, 0)
        if (tong > ZIP_TOI_DA_BYTE) throw loi(413, `Tổng ${(tong / 1e9).toFixed(1)} GB — mỗi lần nén tối đa 1 GB, chọn bớt tệp`)
        await ghiHD(n, null, 'zip', `Tải ZIP ${tep.length} tệp (${(tong / 1048576).toFixed(1)} MB)`)
        res.json({ success: true, data: { url: kho.duongZip(n.schema, tep.map(f => f.id)), soTep: tep.length, tongByte: tong } })
    } catch (e: any) { traLoi(res, e, 'zip-link') }
})

// ─── Thư mục ─────────────────────────────────────────────────────────────────
router.get('/folders', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        const ds: any[] = await n.prisma.storageFolder.findMany({ orderBy: { name: 'asc' } })
        const dem: any[] = await n.prisma.storageFile.groupBy({ by: ['folderId'], where: { status: 'ready', ...(n.q.xem ? {} : { uploaderId: n.userId }) }, _count: { _all: true } })
        const m = new Map(dem.map(d => [d.folderId, d._count._all]))
        res.json({ success: true, data: ds.map(f => ({ ...f, soTep: m.get(f.id) || 0 })), ngoaiCung: m.get(null) || 0 })
    } catch (e: any) { traLoi(res, e, 'folders') }
})

function tenThuMuc(v: unknown): string {
    const t = String(v ?? '').replace(/[\x00-\x1f\\/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!t) throw loi(400, 'Thiếu tên thư mục')
    return t
}

router.post('/folders', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        if (!n.q.sua) throw loi(403, 'Bạn không có quyền tạo thư mục')
        const name = tenThuMuc(req.body?.name)
        const parentId = await thuMucTonTai(n.prisma, req.body?.parentId || null)
        if (parentId && (await duongThuMuc(n.prisma, parentId)).length >= 6) throw loi(400, 'Thư mục lồng tối đa 6 cấp')
        const trung = await n.prisma.storageFolder.findFirst({ where: { parentId, name: { equals: name, mode: 'insensitive' } } })
        if (trung) throw loi(409, `Đã có thư mục "${trung.name}" ở đây`)
        const f = await n.prisma.storageFolder.create({ data: { name, parentId, color: req.body?.color ? String(req.body.color).slice(0, 20) : null, createdBy: await tenNguoi(n) } })
        await ghiHD(n, null, 'thu_muc', `Tạo thư mục "${name}"`)
        res.json({ success: true, data: { ...f, soTep: 0 } })
    } catch (e: any) { traLoi(res, e, 'tao-thu-muc') }
})

router.patch('/folders/:id', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        if (!n.q.sua) throw loi(403, 'Bạn không có quyền sửa thư mục')
        const f = await n.prisma.storageFolder.findUnique({ where: { id: String(req.params.id) } })
        if (!f) throw loi(404, 'Không thấy thư mục')
        const data: any = {}
        if (req.body?.name !== undefined) data.name = tenThuMuc(req.body.name)
        if (req.body?.color !== undefined) data.color = req.body.color ? String(req.body.color).slice(0, 20) : null
        if (req.body?.parentId !== undefined) {
            const cha = await thuMucTonTai(n.prisma, req.body.parentId || null)
            if (cha && (await thuMucConChau(n.prisma, f.id)).includes(cha)) throw loi(400, 'Không chuyển thư mục vào chính nó hoặc thư mục con của nó')
            data.parentId = cha
        }
        const ten = data.name ?? f.name, cha = data.parentId !== undefined ? data.parentId : f.parentId
        const trung = await n.prisma.storageFolder.findFirst({ where: { parentId: cha, name: { equals: ten, mode: 'insensitive' }, id: { not: f.id } } })
        if (trung) throw loi(409, `Đã có thư mục "${trung.name}" ở đó`)
        const moi = await n.prisma.storageFolder.update({ where: { id: f.id }, data })
        await ghiHD(n, null, 'thu_muc', `Sửa thư mục "${moi.name}"`)
        res.json({ success: true, data: moi })
    } catch (e: any) { traLoi(res, e, 'sua-thu-muc') }
})

/** Xoá thư mục: tệp + thư mục con chuyển lên thư mục cha (KHÔNG xoá tệp nào) */
router.delete('/folders/:id', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        if (!n.q.sua) throw loi(403, 'Bạn không có quyền xoá thư mục')
        const f = await n.prisma.storageFolder.findUnique({ where: { id: String(req.params.id) } })
        if (!f) { res.json({ success: true }); return }
        const soTep = await n.prisma.storageFile.updateMany({ where: { folderId: f.id }, data: { folderId: f.parentId } })
        await n.prisma.storageFolder.updateMany({ where: { parentId: f.id }, data: { parentId: f.parentId } })
        await n.prisma.storageFolder.delete({ where: { id: f.id } })
        await ghiHD(n, null, 'thu_muc', `Xoá thư mục "${f.name}" — ${soTep.count} tệp chuyển lên thư mục cha`)
        res.json({ success: true, data: { chuyenTep: soTep.count } })
    } catch (e: any) { traLoi(res, e, 'xoa-thu-muc') }
})

// ─── Nhật ký + cài đặt ───────────────────────────────────────────────────────
router.get('/hoat-dong', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        if (!n.q.xem) throw loi(403, 'Bạn không có quyền xem nhật ký kho')
        const ds: any[] = await n.prisma.storageActivity.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(300, Number(req.query.limit) || 100) })
        const ids = Array.from(new Set(ds.map(d => d.fileId).filter(Boolean)))
        const ten: any[] = ids.length ? await n.prisma.storageFile.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, status: true } }) : []
        const m = new Map(ten.map(t => [t.id, t]))
        res.json({ success: true, data: ds.map(d => ({ ...d, tenTep: m.get(d.fileId)?.name ?? null, trangThaiTep: m.get(d.fileId)?.status ?? null })) })
    } catch (e: any) { traLoi(res, e, 'hoat-dong') }
})

router.put('/cai-dat', async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        if (!n.q.quanTri) throw loi(403, 'Chỉ chủ cửa hàng / quản trị đổi cài đặt kho')
        const cu = await layCaiDat(n.prisma)
        const moi = {
            aiTuDong: req.body?.aiTuDong !== undefined ? !!req.body.aiTuDong : cu.aiTuDong,
            nhacTruocNgay: Array.isArray(req.body?.nhacTruocNgay)
                ? Array.from(new Set(req.body.nhacTruocNgay.map(Number).filter((x: number) => Number.isInteger(x) && x >= 0 && x <= 365))).sort((a: any, b: any) => b - a).slice(0, 5)
                : cu.nhacTruocNgay,
        }
        await n.prisma.storageConfig.upsert({ where: { key: 'cai-dat' }, create: { key: 'cai-dat', value: JSON.stringify(moi) }, update: { value: JSON.stringify(moi) } })
        res.json({ success: true, data: moi })
    } catch (e: any) { traLoi(res, e, 'cai-dat') }
})

// ─── Đường cũ (API công khai trong tài liệu dashboard-api-docs) ───────────────
// multipart ≤ 25MB đi qua máy chủ — vẫn chạy, nhưng nay lưu vào bucket riêng tư thay vì đĩa tạm.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })
/** busboy đọc tên tệp theo latin1 ⇒ "Há»£p Ä‘á»“ng.pdf"; đổi về UTF-8, trừ khi tên vốn đã đúng (ra ký tự thay thế) */
function tenMulter(s: string): string {
    const t = Buffer.from(String(s || ''), 'latin1').toString('utf8')
    return t.includes('�') ? s : t
}
router.post('/upload', upload.single('file'), async (req: AuthRequest, res: Response) => {
    try {
        const n = await moKho(req)
        if (!n.q.taiLen) throw loi(403, 'Bạn không có quyền tải tệp lên')
        if (!req.file) throw loi(400, 'Không có tệp (trường "file")')
        const b = req.body || {}
        const id = `v${crypto.randomBytes(12).toString('hex')}`
        const key = kho.khoaMoi(n.schema, id)
        const { mime } = kho.mimePhat(req.file.mimetype, req.file.buffer.subarray(0, 8192))
        await kho.ghi(key, req.file.buffer, mime)
        const lienKet = b.referenceType && (LOAI_LIEN_KET as readonly string[]).includes(b.referenceType) ? String(b.referenceType) : null
        const f = await n.prisma.storageFile.create({
            data: {
                id, name: docTen(tenMulter(req.file.originalname)), url: `vault:${id}`, size: req.file.size, type: mime,
                category: (NHOM_TAI_LIEU as readonly string[]).includes(b.category) ? b.category : 'internal',
                referenceType: lienKet, referenceId: b.referenceId || null, referenceName: b.referenceName || null, description: b.description || null,
                status: 'ready', objectKey: key, md5: crypto.createHash('md5').update(req.file.buffer).digest('hex'),
                uploadedBy: await tenNguoi(n), uploaderId: n.userId, folderId: await thuMucTonTai(n.prisma, b.folderId || null),
            },
        })
        await ghiHD(n, f.id, 'tai_len', `${(req.file.size / 1048576).toFixed(2)} MB (multipart)`)
        res.json({ success: true, ...dto(f, n.schema), data: dto(f, n.schema) })
    } catch (e: any) { traLoi(res, e, 'upload') }
})

export default router
