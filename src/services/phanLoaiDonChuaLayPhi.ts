/**
 * PHÂN LOẠI ĐƠN SÀN ĐÃ XOÁ MÀ SÀN KHÔNG TRẢ SỐ PHÍ — hỏi sàn + đọc sổ, KHÔNG GHI GÌ.
 * Luật phân loại ở lib/phanLoaiDonChuaLayPhi.ts. Dùng cho GET /admin/phan-loai-don-chua-lay-phi.
 *
 * Mỗi đơn Shopee: dò gian bằng get_escrow_detail (sai gian ⇒ not_found), gian nhận
 * thì hỏi thêm vận đơn (get_tracking_info) và chi tiết đơn theo lô 50 (order_status,
 * cancel_by, cancel_reason). TikTok: chi tiết đơn theo lô 50 + dòng quyết toán.
 * Rồi đọc sổ của chính phiếu: còn trừ kho không, bút toán đã đảo chưa, đã có hoá đơn
 * chưa, có phiếu trả từ sàn không, kho mẹ đã trừ không — để chủ shop thấy sửa gì.
 */
import { ShopeeService, TikTokService } from './platforms'
import { mapWithConcurrency } from '../lib/prisma'
import { moTaLoi } from '../lib/gomLoi'
import { maBenSan, xepGianTheoSoDon } from '../lib/phiSanGiuLai'
import {
    type DuLieuSan, type LoaiDon, phanLoaiDon, laSaiGianShopee, maButToanCuaPhieu,
    SQL_PHIEU_CHUA_LAY_PHI, SQL_SO_KHO, SQL_BUT_TOAN, SQL_PHIEU_TRA, SQL_SO_KHO_ME,
} from '../lib/phanLoaiDonChuaLayPhi'

export interface GianSan {
    id: string; name: string; platform: string
    apiKey?: string | null; apiSecret?: string | null; accessToken?: string | null
    refreshToken?: string | null; shopId?: string | null
}

type EscrowShopee = { saiGian: boolean; loi?: string; du?: Partial<DuLieuSan> }
type ChiTiet = { trangThai?: string; huyBoi?: string; lyDoHuy?: string; thanhToan?: string }

/** Cổng hỏi sàn của MỘT gian — bộ kiểm thay bằng bản giả. */
export interface CongSan {
    escrowShopee(sn: string): Promise<EscrowShopee>
    vanDonShopee(sn: string): Promise<string | undefined>
    chiTiet(ma: string[]): Promise<Map<string, ChiTiet>>          // mã không thuộc gian ⇒ không có trong Map
    quyetToanTikTok(id: string): Promise<{ soGiaoDich: number; thucNhan: number | null }>
}

const so = (v: any): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export function taoCongThat(g: GianSan): CongSan {
    const creds = {
        apiKey: g.apiKey || '', apiSecret: g.apiSecret || '',
        accessToken: g.accessToken || undefined, refreshToken: g.refreshToken || undefined,
        shopId: g.shopId || undefined,
    }
    if (g.platform === 'tiktok') {
        const svc: any = new TikTokService(creds)
        return {
            async escrowShopee() { throw new Error('không phải gian Shopee') },
            async vanDonShopee() { return undefined },
            async chiTiet(ma) {
                const ra = new Map<string, ChiTiet>()
                for (let i = 0; i < ma.length; i += 50) {
                    const d = await svc.goiTho('GET', '/order/202309/orders', { ids: ma.slice(i, i + 50).join(',') })
                    if (d?.code !== 0) throw new Error(`TikTok chi tiết đơn [${d?.code}] ${d?.message || ''}`)
                    for (const o of d?.data?.orders || []) {
                        ra.set(String(o.id), {
                            trangThai: o.status, huyBoi: o.cancellation_initiator, lyDoHuy: o.cancel_reason,
                            thanhToan: o.is_cod ? 'COD' : (o.payment_method_name || undefined),
                        })
                    }
                }
                return ra
            },
            async quyetToanTikTok(id) {
                const d = await svc.goiTho('GET', `/finance/202309/orders/${id}/statement_transactions`)
                if (d?.code !== 0) return { soGiaoDich: 0, thucNhan: null }
                const tx: any[] = d?.data?.statement_transactions || []
                return { soGiaoDich: tx.length, thucNhan: tx.length ? tx.reduce((s, t) => s + (Number(t.settlement_amount) || 0), 0) : null }
            },
        }
    }
    const svc: any = new ShopeeService(creds)
    const goi = (path: string, q: string) => svc.httpGet(svc.apiUrl(path) + q)
    return {
        async escrowShopee(sn) {
            const d = await goi('/api/v2/payment/get_escrow_detail', `&order_sn=${encodeURIComponent(sn)}`)
            if (d?.error) return laSaiGianShopee(d) ? { saiGian: true } : { saiGian: false, loi: `${d.error} ${d.message || ''}`.trim() }
            const inc = d?.response?.order_income || {}
            return {
                saiGian: false,
                du: {
                    thucNhan: so(inc.escrow_amount), giaBan: so(inc.order_selling_price), khachTra: so(inc.buyer_total_amount),
                    hoanChoKhach: so(inc.seller_return_refund), phiShipHoan: so(inc.final_return_to_seller_shipping_fee),
                    thanhToan: inc.buyer_payment_method || d?.response?.buyer_payment_info?.buyer_payment_method || undefined,
                },
            }
        },
        async vanDonShopee(sn) {
            const d = await goi('/api/v2/logistics/get_tracking_info', `&order_sn=${encodeURIComponent(sn)}`)
            return d?.error ? undefined : (d?.response?.logistics_status || undefined)
        },
        async chiTiet(ma) {
            const ra = new Map<string, ChiTiet>()
            for (let i = 0; i < ma.length; i += 50) {
                const d = await goi('/api/v2/order/get_order_detail',
                    `&order_sn_list=${ma.slice(i, i + 50).join(',')}&response_optional_fields=order_status,cancel_by,cancel_reason,payment_method`)
                if (d?.error) throw new Error(`Shopee chi tiết đơn: ${d.error} ${d.message || ''}`)
                for (const o of d?.response?.order_list || []) {
                    ra.set(String(o.order_sn), { trangThai: o.order_status, huyBoi: o.cancel_by || undefined, lyDoHuy: o.cancel_reason || undefined, thanhToan: o.payment_method || undefined })
                }
            }
            return ra
        },
        async quyetToanTikTok() { return { soGiaoDich: 0, thucNhan: null } },
    }
}

export interface DbPhanLoai {
    $queryRawUnsafe<T = any>(sql: string, ...p: any[]): Promise<T>
    onlineChannel: { findMany(a: any): Promise<GianSan[]> }
    onlineOrder: { groupBy(a: any): Promise<Array<{ channelId: string | null; _count: { _all: number } }>> }
}

export interface KhoMeDoc { maCon: string; sp: { $queryRawUnsafe<T = any>(sql: string, ...p: any[]): Promise<T> } }

export interface DonPhanLoai {
    ma: string; san: string; gian: string | null; loai: LoaiDon; lyDo: string
    tienPhieu: number; ngayBan: string; thangTaoPhieu: string; trangThaiPhieu: string
    vatStatus: string | null; coSoHoaDon: boolean
    butToan: { goc: number; daDao: number }
    kho: { daTru: number; daHoan: number }
    khoMeRong: number | null
    phieuTra: Array<{ code: string; status: string }>
    sanBao: Partial<DuLieuSan>
}

export interface TongLoai {
    soDon: number; tienPhieu: number; coHoaDon: number; conButToanChuaDao: number
    conTruKho: number; khoMeConTru: number; coPhieuTra: number
}

const ngayVN = (d: any) => {
    const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
    return Number.isFinite(t) ? new Date(t + 7 * 3600_000).toISOString().slice(0, 10) : '?'
}

export async function phanLoaiDonChuaLayPhi(
    db: DbPhanLoai,
    opts: { tu: number; gioiHan: number; hanMs: number; khoMe?: KhoMeDoc | null; nghiTikTokMs?: number },
    taoCong: (g: GianSan) => CongSan = taoCongThat,
): Promise<{ tong: number; daXet: number; hetGio: number; theoLoai: Record<string, TongLoai>; don: DonPhanLoai[] }> {
    const batDau = Date.now()
    const phieu: any[] = await db.$queryRawUnsafe(SQL_PHIEU_CHUA_LAY_PHI, opts.tu, opts.gioiHan)
    const tong = Number(phieu[0]?.tong) || 0
    const tatCaGian = await db.onlineChannel.findMany({
        where: { platform: { in: ['shopee', 'tiktok'] }, status: 'active', accessToken: { not: null } },
    })
    const dem = await db.onlineOrder.groupBy({ by: ['channelId'], _count: { _all: true } })
    const soDon = new Map<string, number>(dem.filter(d => d.channelId).map(d => [String(d.channelId), d._count._all]))
    const gianTheoSan = (san: string) => xepGianTheoSoDon(tatCaGian.filter(g => g.platform === san), soDon)
        .map(g => ({ g, cong: taoCong(g) }))
    const tenGian = new Map(tatCaGian.map(g => [g.id, g.name]))

    const sanBao = new Map<string, DuLieuSan>()   // orderNumber → dữ liệu sàn
    let hetGio = 0

    // ── Shopee: dò gian + vận đơn từng đơn, rồi chi tiết theo lô từng gian ──
    const shopee = phieu.filter(p => String(p.orderNumber).startsWith('SPE-'))
    const cacGianShopee = gianTheoSan('shopee')
    await mapWithConcurrency(shopee, async (p: any) => {
        if (Date.now() - batDau > opts.hanMs) { hetGio++; return }
        const sn = maBenSan(p.orderNumber)
        const d: DuLieuSan = { san: 'shopee', gianId: null }
        const loi: string[] = []
        try {
            for (const { g, cong } of cacGianShopee) {
                const r = await cong.escrowShopee(sn)
                if (r.saiGian) continue
                if (r.loi) { loi.push(`${g.name}: ${r.loi}`); continue }
                Object.assign(d, r.du, { gianId: g.id })
                d.vanDon = await cong.vanDonShopee(sn).catch(() => undefined)
                break
            }
        } catch (e) { loi.push(moTaLoi(e)) }
        if (!d.gianId && loi.length) d.loiHoi = loi.join(' | ').slice(0, 200)
        sanBao.set(p.orderNumber, d)
    }, 6)
    for (const { g, cong } of cacGianShopee) {
        const cuaGian = shopee.filter(p => sanBao.get(p.orderNumber)?.gianId === g.id)
        if (!cuaGian.length) continue
        try {
            const ct = await cong.chiTiet(cuaGian.map(p => maBenSan(p.orderNumber)))
            for (const p of cuaGian) Object.assign(sanBao.get(p.orderNumber)!, ct.get(maBenSan(p.orderNumber)) || {})
        } catch (e) {
            // Thiếu trạng thái đơn vẫn phân loại được bằng vận đơn + escrow — chỉ ghi chú, không bỏ đơn
            for (const p of cuaGian) sanBao.get(p.orderNumber)!.lyDoHuy ||= `(không đọc được chi tiết đơn: ${moTaLoi(e).slice(0, 80)})`
        }
    }

    // ── TikTok: chi tiết theo lô từng gian, rồi dòng quyết toán từng đơn ──
    const tiktok = phieu.filter(p => String(p.orderNumber).startsWith('TIK-'))
    const cacGianTikTok = gianTheoSan('tiktok')
    const conLai = new Set(tiktok.map(p => maBenSan(p.orderNumber)))
    const loiTikTok: string[] = []
    let hoiHetGianTikTok = true
    for (const { g, cong } of cacGianTikTok) {
        if (!conLai.size) break
        if (Date.now() - batDau > opts.hanMs) { hoiHetGianTikTok = false; break }
        try {
            const ct = await cong.chiTiet([...conLai])
            for (const [id, v] of ct) {
                conLai.delete(id)
                sanBao.set(`TIK-${id}`, { san: 'tiktok', gianId: g.id, ...v })
            }
        } catch (e) { loiTikTok.push(`${g.name}: ${moTaLoi(e)}`.slice(0, 200)) }
    }
    // Chưa hỏi đủ mọi gian vì hết giờ thì CHƯA được nói "không tìm thấy" — để lượt sau
    if (hoiHetGianTikTok) {
        for (const id of conLai) sanBao.set(`TIK-${id}`, { san: 'tiktok', gianId: null, loiHoi: loiTikTok.join(' | ') || undefined })
    } else hetGio += conLai.size
    const nghi = opts.nghiTikTokMs ?? 350
    await mapWithConcurrency(tiktok.filter(p => sanBao.get(p.orderNumber)?.gianId), async (p: any) => {
        if (Date.now() - batDau > opts.hanMs) return
        const d = sanBao.get(p.orderNumber)!
        const cong = cacGianTikTok.find(x => x.g.id === d.gianId)!.cong
        try {
            const q = await cong.quyetToanTikTok(maBenSan(p.orderNumber))
            d.soGiaoDichQuyetToan = q.soGiaoDich
            d.thucNhan = q.thucNhan
        } catch { /* thiếu quyết toán vẫn phân loại được theo trạng thái */ }
        if (nghi > 0) await new Promise(r => setTimeout(r, nghi))
    }, 2)

    // ── Đọc sổ của chính các phiếu (tuần tự — pool mỗi cửa hàng 1 kết nối) ──
    const daXet = phieu.filter(p => sanBao.has(p.orderNumber))
    const soPhieu = daXet.map(p => String(p.receiptNumber))
    const kho = new Map<string, any>((await db.$queryRawUnsafe<any[]>(SQL_SO_KHO, soPhieu)).map(r => [r.ref, r]))
    const butToan = new Set((await db.$queryRawUnsafe<any[]>(SQL_BUT_TOAN, soPhieu.flatMap(maButToanCuaPhieu))).map(r => r.reference))
    const tra = await db.$queryRawUnsafe<any[]>(SQL_PHIEU_TRA, daXet.flatMap(p => [p.orderNumber, maBenSan(p.orderNumber)]))
    let khoMe: Map<string, number> | null = null
    if (opts.khoMe) {
        const refs = daXet.map(p => `${opts.khoMe!.maCon}:${p.orderNumber}`)
        khoMe = new Map((await opts.khoMe.sp.$queryRawUnsafe<any[]>(SQL_SO_KHO_ME, refs)).map(r => [r.ref, Number(r.rong)]))
    }

    const don: DonPhanLoai[] = []
    const theoLoai: Record<string, TongLoai> = {}
    for (const p of daXet) {
        const d = sanBao.get(p.orderNumber)!
        const { loai, lyDo } = phanLoaiDon(d)
        const rn = String(p.receiptNumber)
        const goc = maButToanCuaPhieu(rn).filter(r => !r.startsWith('REV-') && butToan.has(r))
        const k = kho.get(rn)
        const dong: DonPhanLoai = {
            ma: p.orderNumber, san: d.san, gian: d.gianId ? (tenGian.get(d.gianId) || d.gianId) : null, loai, lyDo,
            tienPhieu: Number(p.total) || 0, ngayBan: ngayVN(p.transactionDate || p.createdAt),
            thangTaoPhieu: ngayVN(p.createdAt).slice(0, 7), trangThaiPhieu: String(p.status),
            vatStatus: p.vatStatus ?? null, coSoHoaDon: !!p.coSoHoaDon,
            butToan: { goc: goc.length, daDao: goc.filter(r => butToan.has(`REV-${r}`)).length },
            kho: { daTru: Number(k?.da_tru) || 0, daHoan: Number(k?.da_hoan) || 0 },
            khoMeRong: khoMe ? (khoMe.get(`${opts.khoMe!.maCon}:${p.orderNumber}`) ?? 0) : null,
            phieuTra: tra.filter(r => r.originalInvoice === p.orderNumber || r.originalInvoice === maBenSan(p.orderNumber))
                .map(r => ({ code: r.code, status: r.status })),
            sanBao: { trangThai: d.trangThai, vanDon: d.vanDon, thucNhan: d.thucNhan, giaBan: d.giaBan, khachTra: d.khachTra, hoanChoKhach: d.hoanChoKhach, thanhToan: d.thanhToan, huyBoi: d.huyBoi, lyDoHuy: d.lyDoHuy },
        }
        don.push(dong)
        const t = (theoLoai[loai] ||= { soDon: 0, tienPhieu: 0, coHoaDon: 0, conButToanChuaDao: 0, conTruKho: 0, khoMeConTru: 0, coPhieuTra: 0 })
        t.soDon++
        t.tienPhieu += dong.tienPhieu
        if (dong.coSoHoaDon || dong.vatStatus === 'issued') t.coHoaDon++   // vatStatus: none | issued | cancelled
        if (dong.butToan.goc > dong.butToan.daDao) t.conButToanChuaDao++
        if (dong.kho.daTru + dong.kho.daHoan < 0) t.conTruKho++
        if ((dong.khoMeRong ?? 0) < 0) t.khoMeConTru++
        if (dong.phieuTra.length) t.coPhieuTra++
    }
    return { tong, daXet: daXet.length, hetGio, theoLoai, don }
}
