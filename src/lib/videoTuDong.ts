/* ═══════════════════════════════════════════════════════════════════════════════
 *  TỰ TẠO VIDEO THEO GIỜ (14/10/2026)
 *
 *  Chủ shop: "Tự động tới giờ sẽ tạo video". Video chỉ DỰNG được trên trình duyệt (WebCodecs, giọng đọc ở
 *  127.0.0.1 máy shop) — Cloud Run không dựng được. Nên chia việc:
 *    · MÁY CHỦ giữ lịch + chỉ tiêu (mỗi gian Shopee N video mỗi ngày, từ giờ tạo), CHỌN mã cho từng lượt (còn
 *      hàng, đang bán ở gian đó, ít video nhất trước, chưa làm hôm nay, chưa hỏng gần đây), giữ chỗ chống hai máy
 *      cùng làm, ghi nhật ký, dựng xong thì tự xếp lịch đăng (lib/xepLichVideo.ts).
 *    · MÁY DỰNG = một tab kengi.vn trên máy được chỉ định (FE: cờ trên trình duyệt đó) — gọi nhan-viec, dựng biến
 *      thể chưa trùng nội dung của mã, tải lên Drive, POST /san-media (tuDong = ngày), rồi xong-viec.
 *  Không có máy dựng nào mở thì việc nằm chờ — /api/cron/tick báo chuông một lần mỗi ngày (nhipNhacMayDung).
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { chonSanPham, demKho } from './lamVideoSanPham'
import { chuanXep, laGio, mocVN, ngayVN, XEP_MAC_DINH, type CauHinhXep } from './xepLichVideo'

export const MAU_KENGI = ['thuong-hieu', 'studio', 'den', 'gia-soc', 'tap-chi'] as const
export type CauHinhTuDong = {
    /** giờ VN bắt đầu dựng mỗi ngày */
    gioTao: string
    /** số video MỖI GIAN MỖI NGÀY */
    moiGian: number
    /** channelId Shopee; rỗng = mọi gian Shopee đã uỷ quyền video */
    gian: string[]
    /** mẫu luân phiên; rỗng = cả 5 mẫu Kengi */
    mau: string[]
    doDai: 'ngan' | 'day-du' | 'xen-ke'
    dungPoster: boolean
    hienGia: boolean
    giong: boolean
    giongMau: string
    /** lời khai AI cho Shopee (aigc_label) — CHỦ SHOP quyết (14/10 18:4x: "các video tạo ra phải tick không AI").
     *  null = chưa khai ⇒ video để Nháp, không tự hẹn */
    khaiAI: boolean | null
    /** dựng xong tự xếp lịch đăng */
    henGio: boolean
    chiConHang: boolean
    xepLich: CauHinhXep
}
export const TU_DONG_MAC_DINH: CauHinhTuDong = {
    gioTao: '06:00', moiGian: 1, gian: [], mau: [], doDai: 'xen-ke', dungPoster: true, hienGia: true,
    giong: true, giongMau: '', khaiAI: false, henGio: true, chiConHang: true, xepLich: { ...XEP_MAC_DINH },
}

const ID = 'mac-dinh'
const NGAY_MS = 86400_000
const GIU_CHO_MS = 20 * 60_000

export function chuanTuDong(x: any): CauHinhTuDong {
    const m = TU_DONG_MAC_DINH
    const so = (v: unknown, d: number, a: number, b: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d }
    const bool = (v: unknown, d: boolean) => typeof v === 'boolean' ? v : d
    const giong = bool(x?.giong, m.giong)
    return {
        gioTao: laGio(x?.gioTao) ? x.gioTao : m.gioTao,
        // trần 50 (bản đầu 10 — chủ shop 14/10: "sao chỗ này bị giới hạn thế"); trần THẬT là số mã đủ điều kiện của gian (soMaDu)
        moiGian: so(x?.moiGian, m.moiGian, 1, 50),
        gian: Array.from(new Set((Array.isArray(x?.gian) ? x.gian : []).map(String).filter((s: string) => /^[A-Za-z0-9_-]{4,64}$/.test(s)))).slice(0, 20) as string[],
        mau: Array.from(new Set((Array.isArray(x?.mau) ? x.mau : []).filter((s: any) => (MAU_KENGI as readonly string[]).includes(s)))) as string[],
        doDai: ['ngan', 'day-du', 'xen-ke'].includes(x?.doDai) ? x.doDai : m.doDai,
        dungPoster: bool(x?.dungPoster, m.dungPoster),
        hienGia: bool(x?.hienGia, m.hienGia),
        giong,
        giongMau: typeof x?.giongMau === 'string' ? x.giongMau.slice(0, 120) : '',
        // Lời khai của CHỦ SHOP, không ép theo giọng (bản đầu ép "Có AI" khi có giọng — chủ shop 14/10 bảo phải "Không AI")
        khaiAI: typeof x?.khaiAI === 'boolean' ? x.khaiAI : m.khaiAI,
        henGio: bool(x?.henGio, m.henGio),
        chiConHang: bool(x?.chiConHang, m.chiConHang),
        xepLich: chuanXep(x?.xepLich),
    }
}

const docJson = (s: unknown, d: any) => { try { const v = typeof s === 'string' && s ? JSON.parse(s) : null; return v ?? d } catch { return d } }

export type DongNhatKy = { luc: string; ngay: string; loai: string; sku?: string; channelId?: string; tenGian?: string; mediaId?: string; thongDiep?: string }
export type MayDung = { id: string; ten: string; luc: string; coGiong?: boolean; phienBan?: number; trangThai?: string; tamDungDen?: string | null; loiMay?: string | null }

export async function docTuDong(prisma: any) {
    const r = await prisma.sanMediaTuDong.findUnique({ where: { id: ID } })
    return {
        bat: !!r?.bat,
        cauHinh: chuanTuDong(docJson(r?.cauHinh, {})),
        giuChoBoi: r?.giuChoBoi || null,
        giuChoDen: r?.giuChoDen ? new Date(r.giuChoDen).toISOString() : null,
        mayDung: docJson(r?.mayDung, null) as MayDung | null,
        nhatKy: (docJson(r?.nhatKy, []) as DongNhatKy[]).slice(-60),
        coDong: !!r,
    }
}

export async function luuTuDong(prisma: any, bat: boolean, cauHinh: CauHinhTuDong) {
    const data = { bat, cauHinh: JSON.stringify(cauHinh) }
    await prisma.sanMediaTuDong.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data })
}

/** Nhật ký ngắn — đọc-sửa-ghi (một máy dựng giữ chỗ tại một thời điểm nên không đua) */
export async function ghiNhatKy(prisma: any, dong: Omit<DongNhatKy, 'luc' | 'ngay'>, now = Date.now()) {
    const r = await prisma.sanMediaTuDong.findUnique({ where: { id: ID }, select: { nhatKy: true } })
    const ds: DongNhatKy[] = docJson(r?.nhatKy, [])
    ds.push({ luc: new Date(now).toISOString(), ngay: ngayVN(now), ...dong, thongDiep: dong.thongDiep ? String(dong.thongDiep).slice(0, 300) : undefined })
    await prisma.sanMediaTuDong.upsert({ where: { id: ID }, create: { id: ID, nhatKy: JSON.stringify(ds.slice(-60)) }, update: { nhatKy: JSON.stringify(ds.slice(-60)) } })
}

async function ghiMay(prisma: any, may: MayDung) {
    await prisma.sanMediaTuDong.upsert({ where: { id: ID }, create: { id: ID, mayDung: JSON.stringify(may) }, update: { mayDung: JSON.stringify(may) } })
}

/** Giữ chỗ máy dựng: so-và-ghi trên dòng cấu hình — ai ghi được thì người đó làm (Prod không có Redis). */
export async function giuCho(prisma: any, mayId: string, now = Date.now()): Promise<boolean> {
    const r = await prisma.sanMediaTuDong.updateMany({
        where: { id: ID, OR: [{ giuChoDen: null }, { giuChoDen: { lt: new Date(now) } }, { giuChoBoi: mayId }] },
        data: { giuChoBoi: mayId, giuChoDen: new Date(now + GIU_CHO_MS) },
    })
    return r.count === 1
}
export async function traCho(prisma: any, mayId: string) {
    await prisma.sanMediaTuDong.updateMany({ where: { id: ID, giuChoBoi: mayId }, data: { giuChoBoi: null, giuChoDen: null } })
}

export type GianHomNay = { channelId: string; tenGian: string; uyQuyen: boolean; can: number; daTao: number; hetMa: boolean; /** số mã đủ điều kiện làm video ở gian (chỉ khi demMa) */ soMaDu?: number }
/** Chỉ tiêu hôm nay của từng gian (đếm video tuDong = hôm nay) + đã tới giờ tạo chưa. `demMa` = đếm thêm số mã đủ điều kiện
 *  của từng gian (trần THẬT: mỗi mã một video mỗi gian mỗi ngày) — chỉ cho màn hình, máy dựng xin việc thì khỏi đếm. */
export async function chiTieuHomNay(prisma: any, cauHinh: CauHinhTuDong, nhatKy: DongNhatKy[], now = Date.now(), demMa = false) {
    const ngay = ngayVN(now)
    const gioTao = mocVN(ngay, cauHinh.gioTao)
    const kenh: any[] = await prisma.onlineChannel.findMany({
        where: { platform: 'shopee' }, select: { id: true, name: true, status: true, videoUserId: true } as any, orderBy: { name: 'asc' },
    })
    const chon = kenh.filter(c => c.status !== 'inactive' && (cauHinh.gian.length ? cauHinh.gian.includes(c.id) : !!c.videoUserId))
    const dem: any[] = chon.length ? await prisma.sanMedia.groupBy({
        by: ['channelId'], where: { tuDong: ngay, channelId: { in: chon.map(c => c.id) } }, _count: { _all: true },
    }) : []
    const daTao = new Map<string, number>(dem.map(d => [d.channelId, d._count?._all || 0]))
    const hetMa = new Set(nhatKy.filter(d => d.ngay === ngay && d.loai === 'het-ma' && d.channelId).map(d => d.channelId!))
    const gian: GianHomNay[] = chon.map(c => ({
        channelId: c.id, tenGian: c.name, uyQuyen: !!c.videoUserId, can: cauHinh.moiGian, daTao: daTao.get(c.id) || 0, hetMa: hetMa.has(c.id),
    }))
    if (demMa) for (const g of gian) {   // POOL 1 ⇒ tuần tự
        g.soMaDu = (await demKho(prisma, { chiConHang: cauHinh.chiConHang, chiTrenSan: true, channelId: g.channelId, san: 'shopee' })).du
    }
    return { ngay, gioTao: new Date(gioTao).toISOString(), denGio: now >= gioTao, gian }
}

/** SKU không giao cho máy dựng: đã làm tự động hôm nay CHO GIAN NÀY, hỏng vì chính mã đó gần đây, hết biến thể / mô tả lệch
 *  mã. Bản đầu tính "hôm nay" trên MỌI gian ⇒ mã bán ở hai gian thì gian thứ hai không được làm — trần ngầm (14/10/2026).
 *  Mỗi gian một video/mã/ngày; nội dung vẫn không trùng nhờ biến thể + vân tay trên SKU. */
async function skuBoQua(prisma: any, nhatKy: DongNhatKy[], ngay: string, now: number, channelId: string): Promise<string[]> {
    const homNay: any[] = await prisma.sanMediaSanPham.findMany({ where: { media: { tuDong: ngay, channelId } }, select: { sku: true } })
    const ra = new Set<string>(homNay.map(x => x.sku))
    for (const d of nhatKy) {
        if (!d.sku) continue
        const tuoi = now - Date.parse(d.luc)
        if (d.loai === 'loi-sp' && tuoi < 3 * NGAY_MS) ra.add(d.sku)
        if ((d.loai === 'het-bien-the' || d.loai === 'mo-ta-lech') && tuoi < 30 * NGAY_MS) ra.add(d.sku)
    }
    return Array.from(ra)
}

export type Viec = {
    ngay: string; channelId: string; tenGian: string; productId: string; sku: string; ten: string
    doDai: 'ngan' | 'day-du'; mau: string[]; thu: number; can: number
}

/**
 * Máy dựng xin việc. Trả việc kế tiếp, hoặc lý do chưa có việc (tắt / chưa tới giờ / đủ chỉ tiêu / máy khác đang
 * làm / tạm dừng vì máy hỏng / hết mã). Lời xin việc cũng là nhịp của máy dựng.
 */
export async function nhanViec(prisma: any, may: MayDung, now = Date.now()) {
    const td = await docTuDong(prisma)
    const tamDung = td.mayDung?.id === may.id && td.mayDung?.tamDungDen && Date.parse(td.mayDung.tamDungDen) > now ? td.mayDung.tamDungDen : null
    await ghiMay(prisma, { ...may, luc: new Date(now).toISOString(), tamDungDen: tamDung, loiMay: tamDung ? td.mayDung?.loiMay ?? null : null })
    if (!td.bat) return { viec: null, lyDo: 'tat' as const }
    const ct = await chiTieuHomNay(prisma, td.cauHinh, td.nhatKy, now)
    if (!ct.denGio) return { viec: null, lyDo: 'chua-den-gio' as const, gioTao: ct.gioTao }
    if (tamDung) return { viec: null, lyDo: 'tam-dung' as const, den: tamDung, loiMay: td.mayDung?.loiMay || null }
    const thieu = ct.gian.filter(g => g.daTao < g.can && !g.hetMa).sort((a, b) => a.daTao - b.daTao)
    if (!thieu.length) {
        await traCho(prisma, may.id)
        return { viec: null, lyDo: (ct.gian.length ? 'du-roi' : 'khong-co-gian') as 'du-roi' | 'khong-co-gian', gian: ct.gian }
    }
    if (!(await giuCho(prisma, may.id, now))) {
        return { viec: null, lyDo: 'may-khac' as const, mayKhac: td.mayDung && td.mayDung.id !== may.id ? td.mayDung.ten : null, den: td.giuChoDen }
    }
    for (const g of thieu) {
        const boQuaSku = await skuBoQua(prisma, td.nhatKy, ct.ngay, now, g.channelId)
        const uv = await chonSanPham(prisma, {
            soLuong: 1, chiConHang: td.cauHinh.chiConHang, chiTrenSan: true, channelId: g.channelId, san: 'shopee', sapXep: 'it-video', boQuaSku,
        })
        const u = uv[0]
        if (!u) {
            // gian này hết mã đủ điều kiện hôm nay — ghi lại để lượt sau chuyển sang gian khác, không xoay vòng mãi
            await ghiNhatKy(prisma, { loai: 'het-ma', channelId: g.channelId, tenGian: g.tenGian, thongDiep: 'Hết mã đủ điều kiện (còn hàng, đang bán ở gian, có mô tả + ảnh, chưa làm hôm nay)' }, now)
            continue
        }
        const doDai = td.cauHinh.doDai === 'xen-ke' ? (g.daTao % 2 ? 'ngan' : 'day-du') : td.cauHinh.doDai
        const viec: Viec = {
            ngay: ct.ngay, channelId: g.channelId, tenGian: g.tenGian, productId: u.id, sku: u.sku, ten: u.ten,
            doDai, mau: td.cauHinh.mau.length ? td.cauHinh.mau : [...MAU_KENGI], thu: g.daTao + 1, can: g.can,
        }
        return { viec, lyDo: null, cauHinh: td.cauHinh, giuChoDen: new Date(now + GIU_CHO_MS).toISOString() }
    }
    await traCho(prisma, may.id)
    return { viec: null, lyDo: 'het-ma' as const, gian: ct.gian }
}

/**
 * Máy dựng báo xong một việc. `loai`: 'xong' (có mediaId) · 'loi-sp' (hỏng vì chính mã đó — bỏ mã 3 ngày) ·
 * 'het-bien-the' / 'mo-ta-lech' (bỏ mã 30 ngày) · 'loi-may' (máy dựng hỏng: giọng đọc, Drive, mạng — KHÔNG bỏ mã,
 * tạm dừng 15 phút để khỏi đốt hết danh sách mã). Xong thì tự xếp lịch đăng nếu cấu hình bật.
 */
export async function xongViec(prisma: any, may: MayDung, b: { loai: string; channelId?: string; tenGian?: string; sku?: string; mediaId?: string; thongDiep?: string }, now = Date.now()) {
    const loai = ['xong', 'loi-sp', 'het-bien-the', 'mo-ta-lech', 'loi-may'].includes(b.loai) ? b.loai : 'loi-sp'
    await ghiNhatKy(prisma, { loai, channelId: b.channelId, tenGian: b.tenGian, sku: b.sku, mediaId: b.mediaId, thongDiep: b.thongDiep }, now)
    const td = await docTuDong(prisma)
    if (loai === 'loi-may') {
        await ghiMay(prisma, { ...may, luc: new Date(now).toISOString(), tamDungDen: new Date(now + 15 * 60_000).toISOString(), loiMay: String(b.thongDiep || '').slice(0, 300) })
        await traCho(prisma, may.id)
        return { henGio: null }
    }
    await giuCho(prisma, may.id, now)   // còn làm tiếp ⇒ gia hạn chỗ
    if (loai !== 'xong' || !b.mediaId || !td.cauHinh.henGio) return { henGio: null }
    const { lapLich, apDungLich } = await import('./xepLichVideo')
    const kh = await lapLich(prisma, { ids: [b.mediaId], xep: td.cauHinh.xepLich, now })
    if (!kh.ke.length) return { henGio: { ok: false, lyDo: kh.boQua[0]?.lyDo || 'Không xếp được lịch' } }
    const kq = (await apDungLich(prisma, kh.ke))[0]!
    return { henGio: kq.ok ? { ok: true, henDangLuc: kq.henDangLuc } : { ok: false, lyDo: kq.loi || 'Không hẹn được' } }
}

/* ─── NHẮC KHI KHÔNG CÓ MÁY DỰNG (nhịp ngoài /api/cron/tick, mỗi 10 phút) ──────────────────────────
 * Tới giờ tạo đã 45 phút mà còn gian thiếu chỉ tiêu và không máy dựng nào xin việc trong 30 phút qua ⇒ báo
 * chuông MỘT lần mỗi ngày: không nói thì chủ shop tưởng máy chủ tự làm, tối mới thấy hôm nay không có video. */
export async function nhipNhacMayDung(): Promise<string> {
    const { registryPrisma, getStorePrisma, giuClient } = await import('./prisma')
    const { baoChuong } = await import('./henGioDangVideo')
    const now = Date.now()
    const ra: string[] = []
    const stores = await registryPrisma.store.findMany({ where: { status: 'active' }, select: { code: true, schema: true } }) as any[]
    for (const st of stores) {
        const schema = String(st.schema || '').replace(/[^A-Za-z0-9_]/g, '')
        if (!schema) continue
        let dong: any[] = []
        try { dong = await registryPrisma.$queryRawUnsafe(`SELECT bat, "cauHinh", "mayDung" FROM "${schema}"."SanMediaTuDong" WHERE id = 'mac-dinh' AND bat = true`) } catch { continue }
        if (!dong.length) continue
        const cauHinh = chuanTuDong(docJson(dong[0].cauHinh, {}))
        const ngay = ngayVN(now)
        if (now < mocVN(ngay, cauHinh.gioTao) + 45 * 60_000) continue
        const may: MayDung | null = docJson(dong[0].mayDung, null)
        if (may?.luc && now - Date.parse(may.luc) < 30 * 60_000) continue
        const nha = giuClient(st.schema)
        try {
            const sp: any = getStorePrisma(st.schema)
            const td = await docTuDong(sp)
            const ct = await chiTieuHomNay(sp, td.cauHinh, td.nhatKy, now)
            const thieu = ct.gian.reduce((a, g) => a + Math.max(0, g.can - g.daTao), 0)
            if (!thieu) continue
            await baoChuong(sp, 'warning', 'Chưa có máy nào dựng video tự động hôm nay',
                `Còn ${thieu} video chờ dựng từ ${cauHinh.gioTao}. Mở kengi.vn trên máy đã chọn làm máy dựng (máy có giọng đọc) — tab mở là tự làm.`
                + (may?.luc ? ` Máy dựng xin việc lần cuối ${new Date(may.luc).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.` : ' Chưa máy nào được chọn làm máy dựng.'),
                `[may-dung-vang:${ngay}]`)
            ra.push(`${st.code}: nhac ${thieu}`)
        } catch (e: any) {
            ra.push(`${st.code}: loi ${String(e?.message || e).slice(0, 80)}`)
        } finally {
            nha()
        }
    }
    return ra.join('; ') || 'khong-co-viec'
}
