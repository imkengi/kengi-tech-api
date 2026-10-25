/**
 * ZALO CÁ NHÂN QUA n8n — QUÉT NHÓM + GỢI Ý GHÉP + GỬI TIN CHO KHÁCH (18/10/2026)
 *
 * Kengi không tự đọc/gửi được Zalo cá nhân. Mọi việc với Zalo đi qua webhook n8n mà chủ
 * shop dán vào trang Khách Hàng › Chăm Sóc Khách Hàng (bảng ZaloCauHinh):
 *
 *   n8nQuetUrl  Kengi POST {storeCode, callbackUrl} → n8n lấy danh sách nhóm của tài khoản
 *               Zalo rồi TRẢ NGAY trong phản hồi ({groups:[{groupId,name}]}) hoặc POST về
 *               callbackUrl (/api/zalo/nhom/quet). Nhận nhiều kiểu dữ liệu — xem docNhomTuN8n.
 *   n8nGuiUrl   Kengi POST MỘT tin cho MỘT nhóm {groupId, noiDung, anh:[link]} — n8n gửi vào nhóm.
 *
 * GỬI GIÃN NHỊP: Zalo cá nhân gửi dồn hàng trăm nhóm là bị khoá tài khoản. Đợt gửi vào hàng
 * đợi ZaloDotGuiNhom; nhịp /api/cron/tick mỗi phút gửi tối đa `guiMoiPhut` nhóm/cửa hàng.
 * Giành dòng bằng CAS (cho → dang) nên hai bản máy chạy song song không gửi trùng.
 * Dòng kẹt ở 'dang' (máy chết giữa lúc gọi n8n) KHÔNG tự gửi lại — không biết tin đã đi
 * chưa, gửi lại là khách nhận hai lần; đánh dấu lỗi để người xem quyết.
 */

import { registryPrisma, getStorePrisma } from './prisma'

// ─── Gợi ý ghép nhóm ↔ khách ────────────────────────────────────────────────

const boDau = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()

/** Từ không mang nghĩa nhận diện khách: tên công ty, "cửa hàng", "NPP"… (đo trên kh.xlsx 13/10) */
const TU_BO = new Set([
    'hung', 'tin', 'sg', 'npp', 'ch', 'cua', 'hang', 'cty', 'cong', 'ty', 'tnhh', 'dl', 'dai', 'ly',
    'dm', 'dien', 'may', 'vlxd', 'shop', 'tap', 'hoa', 'nha', 'phan', 'phoi', 'tind',
])

/** Mã khách viết trong tên nhóm: "TS09", "TP051.HU", "hn17", "AL002.DU", "T1" */
const MA_RE = /^[a-z]{1,4}\d{1,4}(\.[a-z]{1,3})?$/i

export function tachMaTrongTen(ten: string): string[] {
    return String(ten || '').split(/[\s\-–_,()]+/).map(x => x.trim()).filter(x => MA_RE.test(x)).map(x => x.toUpperCase())
}

function tuKhoa(ten: string): string[] {
    return boDau(ten).split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !TU_BO.has(t) && !MA_RE.test(t))
}

export interface KhachGon { id: string; code: string; name: string; phone?: string | null }
export interface GoiY { customerId: string; code: string; name: string; diem: number; lyDo: string; chacChan: boolean }

export interface ChiMucKhach {
    theoMa: Map<string, KhachGon[]>
    theoTu: Map<string, KhachGon[]>
    tuCua: Map<string, string[]>
}

export function lapChiMuc(khach: KhachGon[]): ChiMucKhach {
    const theoMa = new Map<string, KhachGon[]>(), theoTu = new Map<string, KhachGon[]>(), tuCua = new Map<string, string[]>()
    for (const k of khach) {
        const ma = String(k.code || '').trim().toUpperCase()
        if (ma) theoMa.set(ma, [...(theoMa.get(ma) || []), k])
        const tu = [...new Set(tuKhoa(k.name))]
        tuCua.set(k.id, tu)
        for (const t of tu) {
            const ds = theoTu.get(t)
            if (!ds) theoTu.set(t, [k]); else if (ds.length < 400) ds.push(k)   // từ quá phổ biến không giúp phân biệt
        }
    }
    return { theoMa, theoTu, tuCua }
}

/**
 * Tối đa 3 gợi ý cho một tên nhóm. Trùng MÃ (duy nhất) = chắc chắn; còn lại xếp theo tỷ lệ
 * từ khoá trùng. Không có từ khoá nào trùng thì KHÔNG gợi ý — thà trống còn hơn gợi ý bừa.
 */
export function goiYKhach(cm: ChiMucKhach, tenNhom: string | null | undefined): GoiY[] {
    if (!tenNhom) return []
    const kq = new Map<string, GoiY>()
    for (const ma of tachMaTrongTen(tenNhom)) {
        const ds = cm.theoMa.get(ma) || []
        for (const k of ds) kq.set(k.id, { customerId: k.id, code: k.code, name: k.name, diem: 100, lyDo: `trùng mã ${ma}`, chacChan: ds.length === 1 })
    }
    const tuNhom = [...new Set(tuKhoa(tenNhom))]
    if (tuNhom.length) {
        const dem = new Map<string, { k: KhachGon; trung: number }>()
        for (const t of tuNhom) for (const k of cm.theoTu.get(t) || []) {
            const x = dem.get(k.id) || { k, trung: 0 }
            x.trung++
            dem.set(k.id, x)
        }
        for (const { k, trung } of dem.values()) {
            if (kq.has(k.id)) continue
            const tuK = cm.tuCua.get(k.id) || []
            const diem = Math.round(100 * trung / Math.max(tuNhom.length, tuK.length, 1))
            if (diem < 50) continue
            kq.set(k.id, { customerId: k.id, code: k.code, name: k.name, diem, lyDo: `tên giống ${diem}%`, chacChan: false })
        }
    }
    return [...kq.values()].sort((a, b) => b.diem - a.diem).slice(0, 3)
}

export async function docChiMucKhach(sp: any): Promise<ChiMucKhach> {
    const khach: KhachGon[] = await sp.customer.findMany({ select: { id: true, code: true, name: true, phone: true }, take: 50000 })
    return lapChiMuc(khach)
}

// ─── Gọi n8n ────────────────────────────────────────────────────────────────

/** Chỉ cho https và máy chủ công khai — đường dẫn do người dùng dán, đừng để Kengi gọi vào mạng nội bộ */
export function kiemUrlN8n(url: string): string | null {
    let u: URL
    try { u = new URL(String(url).trim()) } catch { return 'Địa chỉ không hợp lệ' }
    if (u.protocol !== 'https:') return 'Chỉ nhận địa chỉ https://'
    const h = u.hostname.toLowerCase()
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '[::1]' || h === 'metadata.google.internal') {
        return 'Không gọi được địa chỉ mạng nội bộ'
    }
    return null
}

export async function goiN8n(url: string, body: any, timeoutMs = 60_000): Promise<{ ok: boolean; status: number; data: any; text: string }> {
    const loi = kiemUrlN8n(url)
    if (loi) return { ok: false, status: 0, data: null, text: loi }
    const ctrl = new AbortController()
    const hen = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal, redirect: 'error' } as any)
        const text = await r.text()
        let data: any = null
        try { data = text ? JSON.parse(text) : null } catch { data = null }
        return { ok: r.ok, status: r.status, data, text: text.slice(0, 500) }
    } catch (e: any) {
        return { ok: false, status: 0, data: null, text: e?.name === 'AbortError' ? `n8n không trả lời sau ${timeoutMs / 1000} giây` : String(e?.message || e) }
    } finally { clearTimeout(hen) }
}

// ─── Nhóm quét được ─────────────────────────────────────────────────────────

export interface NhomQuet { groupId: string; tenNhom: string | null; soThanhVien: number | null }

/**
 * Lấy danh sách nhóm từ phản hồi n8n — CHẤP NHẬN NHIỀU KIỂU vì node Zalo cá nhân mỗi bản trả
 * một dạng: mảng thẳng, {groups:[…]}, {data:[…]}, map {gridInfoMap:{id:{name}}} (zca-js),
 * item n8n [{json:{…}}]. Mỗi nhóm đọc id ở groupId|id|grid|groupID|threadId, tên ở
 * name|groupName|tenNhom|title. Id luôn giữ dạng CHUỖI (19 chữ số — đọc thành số là mất).
 */
export function docNhomTuN8n(raw: any): NhomQuet[] {
    const kq = new Map<string, NhomQuet>()
    const them = (o: any, idNgoai?: string) => {
        if (!o || typeof o !== 'object') return
        const x = o.json && typeof o.json === 'object' ? o.json : o
        const id = String(idNgoai ?? x.groupId ?? x.groupID ?? x.grid ?? x.id ?? x.threadId ?? x.group_id ?? '').trim()
        if (!/^\d{6,25}$/.test(id)) return
        const ten = String(x.name ?? x.groupName ?? x.tenNhom ?? x.title ?? x.displayName ?? '').trim() || null
        const tv = Number(x.totalMember ?? x.memberCount ?? x.soThanhVien ?? x.members?.length)
        kq.set(id, { groupId: id, tenNhom: ten, soThanhVien: Number.isFinite(tv) && tv > 0 ? tv : null })
    }
    const duyet = (v: any, sau = 0) => {
        if (sau > 4 || v == null) return
        // Mỗi phần tử có thể là 1 nhóm, hoặc 1 lần gọi zca-js getGroupInfo: { success, response: { gridInfoMap } }
        if (Array.isArray(v)) { for (const o of v) { them(o); duyet(o, sau + 1) } return }
        if (typeof v !== 'object') return
        for (const k of ['groups', 'data', 'items', 'nhom', 'result', 'response', 'json']) if (v[k] != null) duyet(v[k], sau + 1)
        const map = v.gridInfoMap || v.groupInfoMap
        if (map && typeof map === 'object') for (const [id, o] of Object.entries(map)) them(o, id)
        if (!Array.isArray(v) && (v.groupId || v.grid || v.groupID)) them(v)
    }
    duyet(raw)
    return [...kq.values()]
}

/** Lưu nhóm quét được; nhóm ĐÃ NỐI mà chưa có tên thì điền tên (không đè tên đang có). */
export async function luuNhomQuet(sp: any, ds: NhomQuet[]): Promise<{ soNhom: number; moi: number; dienTen: number }> {
    let moi = 0, dienTen = 0
    const coSan = new Set<string>((await sp.zaloNhomQuet.findMany({ select: { groupId: true } })).map((r: any) => r.groupId))
    for (const n of ds) {
        if (!coSan.has(n.groupId)) moi++
        await sp.zaloNhomQuet.upsert({
            where: { groupId: n.groupId },
            create: { groupId: n.groupId, tenNhom: n.tenNhom, soThanhVien: n.soThanhVien },
            update: { tenNhom: n.tenNhom, soThanhVien: n.soThanhVien, quetLuc: new Date() },
        })
        if (n.tenNhom) {
            const r = await sp.zaloNhom.updateMany({ where: { groupId: n.groupId, OR: [{ tenNhom: null }, { tenNhom: '' }] }, data: { tenNhom: n.tenNhom } })
            dienTen += r.count
        }
    }
    await sp.zaloCauHinh.upsert({
        where: { id: 'default' },
        create: { id: 'default', quetLuc: new Date(), quetKetQua: `${ds.length} nhóm (${moi} mới)` },
        update: { quetLuc: new Date(), quetKetQua: `${ds.length} nhóm (${moi} mới)` },
    })
    return { soNhom: ds.length, moi, dienTen }
}

// ─── Gửi tin ────────────────────────────────────────────────────────────────

/** {tenKhach} {maKhach} {tenNhom} trong nội dung → giá trị của từng nhóm */
export function dienMau(noiDung: string, v: { tenKhach?: string | null; maKhach?: string | null; tenNhom?: string | null; bien?: Record<string, string> | null }): string {
    let s = String(noiDung || '')
        .replace(/\{\s*tenKhach\s*\}/gi, v.tenKhach || 'Quý khách')
        .replace(/\{\s*maKhach\s*\}/gi, v.maKhach || '')
        .replace(/\{\s*tenNhom\s*\}/gi, v.tenNhom || '')
    // Biến doanh số chốt lúc tạo đợt (lib/zaloDoanhSo.ts): {doanhSo} {soLuong} {soDon} {nhomHang} {tuNgay} {denNgay}
    for (const [k, gt] of Object.entries(v.bien || {})) {
        if (/^[a-zA-Z]+$/.test(k)) s = s.replace(new RegExp(`\\{\\s*${k}\\s*\\}`, 'gi'), () => String(gt))
    }
    return s
}

/** Câu lỗi n8n trả về + GỢI Ý cách xử lý (25/10/2026 — chủ shop "sao gửi k được": webhook n8n chỉ trả
 *  "Workflow execution failed", lý do thật "zpw_sek bị thiếu hoặc không đúng" = phiên đăng nhập Zalo của
 *  node Zalo đã hết hạn — chỉ thấy khi mở n8n). */
export function loiGuiN8n(thongBao: string): string {
    const s = String(thongBao || '').slice(0, 200)
    if (/zpw_sek|cookie|imei|đăng nhập|dang nhap|login|session|phiên/i.test(s))
        return `n8n: ${s} — phiên đăng nhập Zalo trong n8n đã hết hạn: đăng nhập lại Zalo ở credential của node Zalo trong n8n rồi bấm "Gửi lại tin lỗi"`
    if (/workflow execution failed|error in workflow|workflow could not be started|problem in node/i.test(s))
        return `n8n: ${s} — mở n8n › Executions xem node nào lỗi (hay gặp nhất: phiên đăng nhập Zalo hết hạn, cần đăng nhập lại Zalo trong n8n)`
    return `n8n: ${s}`
}

/** Gửi MỘT tin vào MỘT nhóm qua n8n (dùng cho cả gửi thử lẫn hàng đợi) */
export async function guiMotNhom(url: string, tin: {
    dotId: string | null; groupId: string; noiDung: string; anh: string[]; tieuDe?: string | null
    maKhach?: string | null; tenKhach?: string | null; tenNhom?: string | null; bien?: Record<string, string> | null
}): Promise<{ ok: boolean; loi: string | null }> {
    const r = await goiN8n(url, {
        loai: 'gui_tin', ...tin,
        noiDung: dienMau(tin.noiDung, tin),
    }, 30_000)
    if (r.ok && !(r.data && (r.data.success === false || r.data.ok === false))) return { ok: true, loi: null }
    const thongBao = r.data?.error || r.data?.message || r.text || `HTTP ${r.status}`
    return { ok: false, loi: loiGuiN8n(thongBao) }
}

const LAN_THU_TOI_DA = 3

/** Gửi tiếp hàng đợi của MỘT cửa hàng — tối đa `guiMoiPhut` nhóm. */
export async function guiTiepCuaHang(sp: any, nganSachMs = 40_000): Promise<{ daGui: number; loi: number }> {
    const batDau = Date.now()
    const ch = await sp.zaloCauHinh.findUnique({ where: { id: 'default' } })
    if (!ch?.n8nGuiUrl) return { daGui: 0, loi: 0 }
    // Dòng kẹt 'dang' > 10 phút: máy chết giữa lúc gọi n8n — không rõ đã gửi chưa ⇒ báo, không tự gửi lại
    await sp.zaloDotGuiNhom.updateMany({
        where: { trangThai: 'dang', guiLuc: { lt: new Date(Date.now() - 10 * 60_000) } },
        data: { trangThai: 'loi', loi: 'Không rõ đã gửi chưa (máy dừng giữa lúc gọi n8n) — kiểm trong nhóm Zalo rồi gửi lại tay nếu cần' },
    })
    const toiDa = Math.min(30, Math.max(1, Number(ch.guiMoiPhut) || 4))
    const hang = await sp.zaloDotGuiNhom.findMany({ where: { trangThai: 'cho' }, orderBy: { id: 'asc' }, take: toiDa })
    let daGui = 0, loi = 0
    const dotCache = new Map<string, any>()
    for (const h of hang) {
        if (Date.now() - batDau > nganSachMs) break   // phần còn lại để nhịp sau — đừng giữ nhịp cron quá lâu
        // Giành dòng: hai bản máy cùng chạy nhịp thì chỉ một bên gửi
        const g = await sp.zaloDotGuiNhom.updateMany({ where: { id: h.id, trangThai: 'cho' }, data: { trangThai: 'dang', guiLuc: new Date(), lanThu: { increment: 1 } } })
        if (g.count !== 1) continue
        let dot = dotCache.get(h.dotId)
        if (!dot) { dot = await sp.zaloDotGui.findUnique({ where: { id: h.dotId } }); dotCache.set(h.dotId, dot) }
        if (!dot || dot.trangThai === 'huy') { await sp.zaloDotGuiNhom.update({ where: { id: h.id }, data: { trangThai: 'huy' } }); continue }
        const k = h.customerId ? await sp.customer.findUnique({ where: { id: h.customerId }, select: { code: true, name: true } }) : null
        let anh: string[] = []
        try { anh = dot.anh ? JSON.parse(dot.anh) : [] } catch { anh = [] }
        let bien: Record<string, string> | null = null
        try { bien = h.bien ? JSON.parse(h.bien) : null } catch { bien = null }
        const kq = await guiMotNhom(ch.n8nGuiUrl, {
            dotId: dot.id, groupId: h.groupId, noiDung: dot.noiDung, anh, tieuDe: dot.tieuDe,
            maKhach: k?.code || null, tenKhach: k?.name || null, tenNhom: h.tenNhom, bien,
        })
        if (kq.ok) { daGui++; await sp.zaloDotGuiNhom.update({ where: { id: h.id }, data: { trangThai: 'da_gui', loi: null, guiLuc: new Date() } }) }
        else {
            loi++
            const conThu = (h.lanThu + 1) < LAN_THU_TOI_DA
            await sp.zaloDotGuiNhom.update({ where: { id: h.id }, data: { trangThai: conThu ? 'cho' : 'loi', loi: kq.loi } })
        }
        await new Promise(r => setTimeout(r, 1500 + Math.floor(Math.random() * 2500)))   // giãn trong cùng một phút
    }
    // Đợt không còn gì chờ ⇒ xong
    for (const dotId of dotCache.keys()) {
        const con = await sp.zaloDotGuiNhom.count({ where: { dotId, trangThai: { in: ['cho', 'dang'] } } })
        if (!con) await sp.zaloDotGui.updateMany({ where: { id: dotId, trangThai: 'dang_gui' }, data: { trangThai: 'xong' } })
    }
    return { daGui, loi }
}

/** Nhịp ngoài /api/cron/tick — mọi cửa hàng đang hoạt động, TUẦN TỰ */
export async function nhipGuiZalo(): Promise<string> {
    const stores: any[] = await (registryPrisma as any).store.findMany({ where: { status: 'active' }, select: { schema: true, code: true } })
    const ra: string[] = []
    for (const s of stores) {
        try {
            const sp = getStorePrisma(s.schema) as any
            const coViec = await sp.zaloDotGuiNhom.count({ where: { trangThai: 'cho' } }).catch(() => 0)
            if (!coViec) continue
            const kq = await guiTiepCuaHang(sp)
            ra.push(`${s.code}:+${kq.daGui}${kq.loi ? `/loi${kq.loi}` : ''}`)
        } catch (e: any) { ra.push(`${s.code}:loi ${String(e?.message || e).slice(0, 80)}`) }
    }
    return ra.join(' ') || 'khong-co-gi'
}
