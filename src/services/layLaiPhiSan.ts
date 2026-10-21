/**
 * LẤY LẠI PHÍ SÀN CHO ĐƠN SÀN ĐÃ BỊ CRON DỌN XOÁ (21/10/2026) — ghi vào bảng PhiSanDon.
 *
 * Đơn gốc mất rồi nhưng phiếu bán 'ONLINE-<mã đơn>' còn, và sàn vẫn giữ số: đo 21/10/2026
 * escrow Shopee trả số thật cho đơn 112 ngày tuổi, statement TikTok cho đơn 70 ngày.
 * Cột channelId mất theo đơn nên không biết đơn thuộc gian nào ⇒ hỏi LẦN LƯỢT từng gian
 * cùng sàn, gian nhiều đơn trước. Hỏi nhầm gian thì sàn từ chối (`order_not_found … does
 * not belong to you`), không bao giờ ra số của đơn khác.
 *
 * Song song y như cron đối soát phí: Shopee 6 luồng, TikTok 2 luồng + nghỉ 350ms (đẩy cao
 * hơn từng bị chặn IP / dính 36009002). Chỉ ghi PhiSanDon — không đụng phiếu, đơn, sổ.
 * Không gọi canhBaoLoiNhuanThap: nó làm việc trên OnlineOrder (đơn ở đây đã mất), và báo
 * "lãi thấp" cho đơn đã bán từ nhiều tháng trước chỉ là tiếng ồn.
 */
import { ShopeeService, TikTokService } from './platforms'
import { mapWithConcurrency } from '../lib/prisma'
import { moTaLoi } from '../lib/gomLoi'
import {
    type DbThuan, type San, type SoPhi,
    SO_LAN_HOI_TOI_DA, SQL_GHI_CHUA_CO, SQL_GHI_LAY_DUOC,
    maBenSan, soTuEscrow, soTuStatement, sqlDonMatGoc, xepGianTheoSoDon,
} from '../lib/phiSanGiuLai'

export interface Gian {
    id: string
    name: string
    platform: string
    apiKey?: string | null
    apiSecret?: string | null
    accessToken?: string | null
    refreshToken?: string | null
    shopId?: string | null
}

/** Hỏi một đơn ở một gian: ra số, hoặc null khi gian đó không có số cho đơn này.
 *  NÉM lỗi = lỗi mạng/lỗi lạ — đơn đó KHÔNG bị đánh dấu, lượt sau hỏi lại. */
export type HoiGian = (maSan: string) => Promise<SoPhi | null>

export function taoHoiGianThat(g: Gian): HoiGian {
    const creds = {
        apiKey: g.apiKey || '', apiSecret: g.apiSecret || '',
        accessToken: g.accessToken || undefined, refreshToken: g.refreshToken || undefined,
        shopId: g.shopId || undefined,
    }
    if (g.platform === 'tiktok') {
        const svc: any = new TikTokService(creds)
        return async ma => soTuStatement(await svc.getOrderSettlement(ma))
    }
    const svc: any = new ShopeeService(creds)
    return async ma => soTuEscrow(await svc.getEscrowDetail(ma, { imLang: true }))
}

export interface DbLayLai extends DbThuan {
    onlineChannel: { findMany(a: any): Promise<Gian[]> }
    onlineOrder: { groupBy(a: any): Promise<Array<{ channelId: string | null; _count: { _all: number } }>> }
}

export interface TuyChonLayLai {
    apply: boolean
    gioiHan: number            // số phiếu tối đa mỗi sàn trong một lượt
    san?: San                  // bỏ trống = cả hai sàn
    tuNgay?: Date | null       // theo ngày bán trên phiếu
    denNgay?: Date | null      // TRƯỚC ngày này
    hanMs: number              // quá từng ấy ms kể từ lúc bắt đầu thì thôi nhận đơn mới
    nghiTikTokMs?: number      // mặc định 350 — bộ kiểm đặt 0
}

export interface KetQuaSan {
    san: San
    gian: string[]
    khopDieuKien: number       // phiếu khớp điều kiện, TRƯỚC khi cắt theo giới hạn
    quet: number
    layDuoc: number
    chuaCo: number
    loi: number
    hetGio: number             // chưa kịp hỏi vì hết giờ — lượt sau hỏi
    loiDauTien: string
    daGhi: boolean
    theoThang: Record<string, { layDuoc: number; chuaCo: number }>
    tienPhieuLayDuoc: number
    khauTruLayDuoc: number
    mau: Array<{ ma: string; thang: string; tienPhieu: number; phi: number; thucNhan: number; kenhId: string }>
}

const LO_GHI = 200
const thangVN = (d: any) => {
    const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
    return Number.isFinite(t) ? new Date(t + 7 * 3600_000).toISOString().slice(0, 7) : '?'
}

export async function layLaiPhiDonDaXoa(
    db: DbLayLai,
    opts: TuyChonLayLai,
    taoHoi: (g: Gian) => HoiGian = taoHoiGianThat,
): Promise<KetQuaSan[]> {
    const batDau = Date.now()
    const nghi = opts.nghiTikTokMs ?? 350
    const tatCaGian = await db.onlineChannel.findMany({
        where: { platform: { in: ['shopee', 'tiktok'] }, status: 'active', accessToken: { not: null } },
    })
    const dem = await db.onlineOrder.groupBy({ by: ['channelId'], _count: { _all: true } })
    const soDon = new Map<string, number>(dem.filter(d => d.channelId).map(d => [String(d.channelId), d._count._all]))

    const ra: KetQuaSan[] = []
    for (const san of (opts.san ? [opts.san] : ['shopee', 'tiktok']) as San[]) {
        const gian = xepGianTheoSoDon(tatCaGian.filter(g => g.platform === san), soDon)
        const kq: KetQuaSan = {
            san, gian: gian.map(g => g.name), khopDieuKien: 0, quet: 0, layDuoc: 0, chuaCo: 0, loi: 0,
            hetGio: 0, loiDauTien: '', daGhi: false, theoThang: {}, tienPhieuLayDuoc: 0, khauTruLayDuoc: 0, mau: [],
        }
        ra.push(kq)
        if (!gian.length) continue

        const phieu = await db.$queryRawUnsafe<any[]>(
            sqlDonMatGoc(san), opts.gioiHan, opts.tuNgay ?? null, opts.denNgay ?? null, SO_LAN_HOI_TOI_DA)
        kq.khopDieuKien = Number(phieu[0]?.tong) || 0
        const cacGian = gian.map(g => ({ id: g.id, hoi: taoHoi(g) }))
        const layDuoc: Array<{ ma: string; so: SoPhi; kenhId: string }> = []
        const chuaCo: string[] = []

        await mapWithConcurrency(phieu, async (p: any) => {
            if (Date.now() - batDau > opts.hanMs) { kq.hetGio++; return }
            kq.quet++
            const ma = String(p.orderNumber)
            const thang = thangVN(p.ngay)
            const o = (kq.theoThang[thang] ||= { layDuoc: 0, chuaCo: 0 })
            try {
                let so: SoPhi | null = null
                let kenhId = ''
                for (const g of cacGian) {
                    so = await g.hoi(maBenSan(ma))
                    if (san === 'tiktok' && nghi > 0) await new Promise(r => setTimeout(r, nghi))
                    if (so) { kenhId = g.id; break }
                }
                if (!so) { chuaCo.push(ma); o.chuaCo++; return }
                layDuoc.push({ ma, so, kenhId })
                o.layDuoc++
                const tien = Number(p.total) || 0
                kq.tienPhieuLayDuoc += tien
                kq.khauTruLayDuoc += tien - so.netRevenue
                if (kq.mau.length < 8) kq.mau.push({ ma, thang, tienPhieu: tien, phi: so.platformFee, thucNhan: so.netRevenue, kenhId })
            } catch (e) {
                kq.loi++
                if (!kq.loiDauTien) kq.loiDauTien = `${ma}: ${moTaLoi(e)}`.slice(0, 300)
            }
        }, san === 'tiktok' ? 2 : 6)

        kq.layDuoc = layDuoc.length
        kq.chuaCo = chuaCo.length
        kq.tienPhieuLayDuoc = Math.round(kq.tienPhieuLayDuoc)
        kq.khauTruLayDuoc = Math.round(kq.khauTruLayDuoc)
        if (!opts.apply) continue

        // Ghi TUẦN TỰ sau khi hỏi xong: pool mỗi cửa hàng chỉ 1 kết nối.
        for (let i = 0; i < layDuoc.length; i += LO_GHI) {
            const lo = layDuoc.slice(i, i + LO_GHI)
            await db.$executeRawUnsafe(SQL_GHI_LAY_DUOC,
                lo.map(x => x.ma), lo.map(() => san), lo.map(x => x.so.platformFee),
                lo.map(x => x.so.netRevenue), lo.map(x => x.kenhId))
        }
        for (let i = 0; i < chuaCo.length; i += LO_GHI) {
            const lo = chuaCo.slice(i, i + LO_GHI)
            await db.$executeRawUnsafe(SQL_GHI_CHUA_CO, lo, lo.map(() => san))
        }
        kq.daGhi = true
    }
    return ra
}
