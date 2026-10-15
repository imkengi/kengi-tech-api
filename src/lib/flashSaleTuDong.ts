/* FLASH SALE TỰ ĐỘNG (15/10/2026). Chủ shop: "trong phần flash sale hãy tự động tới giờ là set 1 sản phẩm 10 mẫu còn hàng" —
 * hỏi lại, chốt: MỖI khung giờ Shopee tự tạo một đợt gồm 10 mã KHÁC NHAU còn hàng, mỗi mã 1 cái, xoay vòng giữa các khung;
 * bật cho cả 3 gian (Kengi Electric hiện không mã nào đạt điều kiện giá −1đ — bật cũng chỉ ghi lý do, không tạo đợt).
 *
 * Phần THUẦN (kiểm chứng được) + chọn mã. Bộ hẹn giờ (cron/flashSaleScheduler.ts) gọi mỗi nhịp 3 phút.
 */

import { kiemGiaFlashSale, phanTramGiam, type DieuKienFlashSale, type KetQuaKiemGia } from './flashSaleKiemGia'

/** Đẩy trước đợt kế khi còn ≤ 60 phút nữa tới giờ (khung Shopee nối liền nhau — đợi đợt trước hết mới đẩy là lỡ khung).
 *  Chủ shop 15/10/2026 16:45: "chừa 60p nó tạo 1 lần là ổn nhất" (bản đầu 90 phút) — mỗi khung tạo trước 60 phút, từng đợt một. */
export const LEAD_MS = 60 * 60_000

export interface CauHinhTuDong {
    channelId: string
    bat: boolean
    soMa: number
    tonMoiMa: number
    gioiHanMua: number
    kieuGia: 'tru-1d' | 'phan-tram'
    phanTram: number
}

/**
 * Được đẩy đợt kế tiếp lên Shopee chưa. Shopee GIỮ tồn campaign ngay khi thêm hàng ⇒ tối đa 1 đợt ĐANG CHẠY + 1 đợt CHỜ:
 * - đã có một đợt chờ (đã lên Shopee mà chưa tới giờ / đang đẩy) ⇒ không;
 * - không có đợt nào đang chạy ⇒ được;
 * - đang có đợt chạy ⇒ chỉ khi đợt kế còn ≤ leadMs nữa tới giờ (bản cũ đợi đợt trước HẾT mới đẩy ⇒ khung nối liền luôn bị
 *   bỏ "lỡ khung giờ").
 */
export function duocDayDotKe(o: { sapToi: number; dangChay: number; batDau: number; now: number; leadMs?: number }): boolean {
    if (o.sapToi > 0) return false
    if (o.dangChay === 0) return true
    return o.batDau - o.now <= (o.leadMs ?? LEAD_MS)
}

/** Khung giờ kế tiếp cho đợt tự động: sớm nhất, còn ≥ 5 phút để đẩy, trong tầm leadMs, chưa có đợt, chưa xét. */
export function chonKhungTuDong(
    slots: { timeslot_id: number; start_time: number; end_time: number }[],
    daCoKhung: Set<number>, now: number, leadMs = LEAD_MS, khungDaXet: number | null = null,
): { timeslot_id: number; start_time: number; end_time: number } | null {
    const ds = slots
        .filter(s => s.start_time * 1000 >= now + 5 * 60_000 && s.start_time * 1000 - now <= leadMs)
        .filter(s => !daCoKhung.has(Number(s.timeslot_id)) && Number(s.timeslot_id) !== Number(khungDaXet))
        .sort((a, b) => a.start_time - b.start_time)
    return ds[0] || null
}

/** Giá flash sale theo cách của đợt tự động — CÙNG công thức chuanBiHang (−1đ từ giá đang hiển thị; % làm tròn trăm). */
export function giaTuDong(cfg: Pick<CauHinhTuDong, 'kieuGia' | 'phanTram'>, goc: number, dangBan: number): number {
    return cfg.kieuGia === 'phan-tram'
        ? Math.max(100, Math.floor((goc * (1 - cfg.phanTram / 100)) / 100) * 100)
        : Math.max(1, Math.round(dangBan) - 1)
}

/** Mã này vào được đợt tự động không: còn hàng + giá đạt điều kiện Shopee (ít nhất một phân loại, nếu có phân loại). */
export function datDieuKienTuDong(k: KetQuaKiemGia, cfg: Pick<CauHinhTuDong, 'kieuGia' | 'phanTram' | 'tonMoiMa'>): boolean {
    if (k.loi) return false
    const dk: DieuKienFlashSale | null = k.dieuKien
    const min = dk?.giamToiThieu ?? 0, max = dk?.giamToiDa ?? 100
    const tonMin = Math.max(1, dk?.tonToiThieu ?? 1)
    const dat = (goc: number, dangBan: number, ton: number) => {
        if (!(goc > 0) || !(dangBan > 0) || ton < 1) return false
        if (Math.min(ton, cfg.tonMoiMa) < tonMin) return false
        const g = phanTramGiam(goc, giaTuDong(cfg, goc, dangBan))
        return g >= min && g <= max
    }
    if (!k.coPhanLoai) return dat(k.giaGoc, k.giaDangBan, k.ton)
    return k.phanLoai.some(m => dat(m.giaGoc, m.giaDangBan, m.ton))
}

const mang = (v: any): any[] => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : [] } catch { return [] } }

/**
 * Chọn tối đa cfg.soMa mã cho một khung: xoay vòng (mã chưa lên flash sale trong 3 ngày trước — xáo ngẫu nhiên để đổi mẫu —
 * rồi tới mã lên lâu nhất), tránh mã Shopee TỪ CHỐI cả mã trong 3 ngày; đọc giá/tồn SỐNG theo lô 20 (tồn đồng bộ không tin
 * được — đo 15/10: 0 cho cả 50 mã Electric dù 24 mã còn hàng), xét tối đa `gioiHanXet` mã mỗi lượt.
 */
export async function chonMaTuDong(
    service: any, sps: { platformProductId: string; name: string }[], lichSu: { items: any; failedItems: any; startTime: any }[],
    cfg: CauHinhTuDong, theoNganh?: Map<number, DieuKienFlashSale> | null, gioiHanXet = 80, xao: (n: number) => number = n => Math.random() * n,
): Promise<{ items: any[]; daXet: number }> {
    const lanCuoi = new Map<number, number>()
    const biTuChoi = new Set<number>()
    for (const r of lichSu) {
        const t = new Date(r.startTime).getTime()
        for (const it of mang(r.items)) { const id = Number(it?.itemId); if (id) lanCuoi.set(id, Math.max(lanCuoi.get(id) || 0, t)) }
        // Shopee từ chối CẢ mã (có err_code, không gắn phân loại) ⇒ tránh; lý do của máy chủ (hết tồn, vượt trần…) thì không
        for (const f of mang(r.failedItems)) if (f?.err_code != null && !f?.model_id && f?.item_id) biTuChoi.add(Number(f.item_id))
    }
    const ungVien = sps
        .map(s => ({ id: Number(s.platformProductId), name: s.name, khoa: 0 }))
        .filter(x => x.id > 0 && !biTuChoi.has(x.id))
    for (const x of ungVien) x.khoa = lanCuoi.has(x.id) ? lanCuoi.get(x.id)! : -1 - xao(1)   // chưa lên: âm ngẫu nhiên ⇒ trước, xáo
    ungVien.sort((a, b) => a.khoa - b.khoa)

    const chon: any[] = []
    let daXet = 0
    for (let i = 0; i < ungVien.length && chon.length < cfg.soMa && daXet < gioiHanXet; i += 20) {
        const lo = ungVien.slice(i, i + 20)
        daXet += lo.length
        let kq: KetQuaKiemGia[] = []
        try { kq = await kiemGiaFlashSale(service, lo.map(x => x.id), theoNganh ?? undefined) } catch { continue }
        for (const k of kq) {
            if (chon.length >= cfg.soMa) break
            if (!datDieuKienTuDong(k, cfg)) continue
            const sp = lo.find(x => x.id === k.itemId)
            chon.push({
                itemId: k.itemId, name: sp?.name || String(k.itemId),
                // hàng có phân loại: giá nằm ở từng phân loại, máy chủ tự đọc lúc đẩy
                price: k.coPhanLoai ? 0 : k.giaDangBan, giaGoc: k.coPhanLoai ? 0 : k.giaGoc, ton: k.ton,
            })
        }
    }
    return { items: chon, daXet }
}
