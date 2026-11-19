/* Kiểm chứng LÃI DỰ KIẾN ĐƠN SÀN MỚI + BÁO ĐỘNG LỖ (18/11/2026) — npx tsx scripts/check-lai-du-kien.ts
 *
 * Chủ shop: "Tiếp tục khi nhận đơn online mới thì hãy tự động tính toán lãi dự kiến, nếu lỗ báo động ngay nha". Canh:
 *  A. lib/giaShopee.phiSanCuaDon: đơn một dòng / cùng mô hình = phiSanCuaGia; đơn nhiều ngành (phí công thức) = đúng công thức
 *     escrow Shopee của CẢ đơn (trần dịch vụ theo đơn, phí mỗi đơn một lần); danhGiaGia không đổi số.
 *  B. phiDuKienCuaDon: chưa biết phí ⇒ null (không bịa); phí khai / đo từ sổ / công thức đúng nguồn + câu mô tả; ngành chưa rõ ⇒ tạm.
 *  C. ketLuanLaiDuKien + tinBaoLo: phần đã biết âm ⇒ LỖ CHẮC (kể cả thiếu vốn / chưa biết phí); phần đã biết dương mà thiếu ⇒
 *     không kết luận; tin báo nói đủ phép tính.
 *  D. xetLaiDuKienDonMoi trên prisma giả: báo ĐÚNG MỘT lần; đơn lãi im; đơn cũ / huỷ / kéo bù / không phải sàn bỏ; mẻ lớn gộp một
 *     tin; đọc phí hỏng không lưu (xét lại sau); ghi tin hỏng ⇒ gỡ dòng giành; thua giành ⇒ im; công tắc tắt báo; quy đổi đơn vị.
 *     Dòng chưa mang giá ⇒ không báo oan; tin nêu tên mặt hàng; bảng phí đệm 5 phút.
 *  G. Lưới vét (vetLaiDuKienDonMoi) đúng kênh / cửa sổ, vét lại chỉ một truy vấn; CSDL hỏng ⇒ webhook / vét KHÔNG ném.
 *  E. docLaiDuKien: đọc lại dòng đã lưu; bảng chưa có ⇒ rỗng, không đọc bảng.
 *  F. Soát nguồn: MỌI đường tạo đơn sàn gọi (webhook: xetLaiDuKienAnToan cuối handler; đồng bộ: lưới vét) — trừ kéo bù / dữ liệu
 *     mẫu / đơn tay; route trả laiDuKien.
 *  H. THEO TỪNG SKU (19/11/2026 — "phải tính theo SKU và phí của SKU đó chứ"): phiSanTungDong Σ = phiSanCuaDon, mỗi SKU chịu % của
 *     CHÍNH ngành nó; laiTungDong Σ dòng = ĐÚNG số cả đơn (phí, vốn, lãi — kể cả làm tròn); giá vốn từng dòng theo quy đổi; SKU lỗ
 *     trong đơn lãi ⇒ BÁO (tin nêu tên + [SKU] + phép tính); quà tặng 0đ không báo oan; đơn một dòng không nói hai lần; dòng cũ
 *     chưa có theo SKU được lưới vét tính lại (giữ baoLuc, không báo lại), ngoài 3 ngày / không tính được thì thôi.
 */
import fs from 'fs'
import path from 'path'
import { danhGiaGia, phiSanCuaGia, phiSanCuaDon, phiSanTungDong, type MauPhi, type AffiliateDo } from '../src/lib/giaShopee'
import { mauPhiCongThuc, phiDichVu, type BieuPhi } from '../src/lib/bieuPhiShopee'
import {
    phiDuKienCuaDon, ketLuanLaiDuKien, tinBaoLo, tenHangChinh, xetLaiDuKienDonMoi, xetLaiDuKienAnToan, vetLaiDuKienDonMoi, docLaiDuKien,
    laiTungDong, moTaPhiDong, phepTinhSku, CUA_SO_DON_MOI_MS, CUA_SO_NANG_CAP_MS, type DongGia, type DongVaoLai,
} from '../src/lib/laiDuKienDon'
import { computeOrderProfits } from '../src/lib/onlineOrderProfit'

let loi = 0, dat = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (ok) dat++; else loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet && !ok ? ' — ' + chiTiet : ''}`) }
const gan = (a: number, b: number, sai = 1) => Math.abs(a - b) <= sai

/* ── Biểu phí Shopee giả (đúng dạng đo 18/11/2026) ──────────────────────────────────────────────────────────────────────── */
const BAY = Date.UTC(2026, 10, 18, 5, 0, 0)
const B: BieuPhi = {
    phienBan: 1, doLuc: BAY, hopLe: true, soMau: 40, soKhop: 40,
    thanhToan: 0.06, dichVu: { tyLe: 0.055, moiDon: 3000, tran: 50_000 }, thue: 0.015, baoVe: 2700, khac: 0,
    voucher: 0.01, ship: 20_000, aff: { tyLeTB: 0.008, tyLeMax: 0.12, soMau: 40, soCo: 10 },
    nganh: {
        '100': { tyLe: 0.13, soMau: 3, min: 0.13, max: 0.13, lech: false },
        '200': { tyLe: 0.16, soMau: 2, min: 0.16, max: 0.16, lech: false },
    },
}
const AFF: AffiliateDo = { tachRieng: true, tyLeTB: 0.008, tyLeMax: 0.12, soDonBiet: 40, soDonCo: 10 }
const ganAff = (m: MauPhi): MauPhi => ({ ...m, affiliate: AFF })
const M100 = { ...ganAff(mauPhiCongThuc(B, 0.13, { soMauNganh: 3 })), nganh: '100' }
const M200 = { ...ganAff(mauPhiCongThuc(B, 0.16, { soMauNganh: 2 })), nganh: '200' }
const MTB = ganAff(mauPhiCongThuc(B, 0.145, { soMauNganh: 0 }))
const BANG_CONG_THUC = {
    chon(n?: string | number | null): MauPhi {
        const k = n == null ? '' : String(n)
        if (k === '100') return M100
        if (k === '200') return M200
        return k ? { ...MTB, thayNganh: k } : { ...MTB, chuaRoNganh: true }
    },
}
/** Phí Shopee của CẢ đơn theo công thức escrow (tính tay — đối chứng A3 / D1). */
function phiShopeeTay(dong: { gia: number; r: number }[]): number {
    const osp = dong.reduce((s, d) => s + d.gia, 0), v = B.voucher, q = 1 - v, Q = q * osp
    return v * osp + dong.reduce((s, d) => s + d.r * q * d.gia, 0) + B.thanhToan * (Q + B.ship) + phiDichVu(B.dichVu, Q)
        + B.thue * osp + B.baoVe + B.khac * osp + AFF.tyLeTB * osp
}
const MAU_SO: MauPhi = { tyLe: 0.22, coDinh: 4000, nguon: 'hoi-quy-don', soDon: 120, ghiChu: 'đo từ sổ' }
const MAU_KHAI: MauPhi = { tyLe: 0.25, coDinh: 0, nguon: 'cau-hinh-kenh', soDon: 3, ghiChu: 'khai', khai: true }
const MAU_CHUA_BIET: MauPhi = { tyLe: 0.06, coDinh: 0, nguon: 'cau-hinh-kenh', soDon: 0, ghiChu: 'chưa biết', chuaBiet: true }
const bangMot = (m: MauPhi) => ({ chon: () => m })

/* ── prisma giả ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
interface TuyChonGia { bangCo?: boolean; hongTin?: boolean; thuaGianh?: boolean; hongTaoBang?: boolean; hongVet?: boolean }
function taoPrisma(du: { don: any[]; kenh: any[]; sp: any[]; map?: any[]; nganh?: Record<string, string> }, tc: TuyChonGia = {}) {
    const bang = new Map<string, any>()
    let coBang = tc.bangCo ?? false
    const tin: any[] = [], cau: string[] = []
    const p: any = {
        bang, tin, cau,
        get coBang() { return coBang },
        async $executeRawUnsafe(sql: string, ...a: any[]) {
            cau.push(sql)
            if (/CREATE TABLE IF NOT EXISTS "LaiDuKienDon"/.test(sql)) { if (tc.hongTaoBang) throw new Error('mất kết nối'); coBang = true; return 0 }
            if (/DELETE FROM "LaiDuKienDon"/.test(sql)) { let n = 0; for (const id of a[0]) if (bang.has(id) && !bang.get(id).baoLuc) { bang.delete(id); n++ } return n }
            if (/UPDATE "LaiDuKienDon" SET "baoLuc"/.test(sql)) { for (const id of a[0]) if (bang.has(id)) bang.get(id).baoLuc = a[1]; return a[0].length }
            if (/UPDATE "LaiDuKienDon" SET "doanhThu"/.test(sql)) {
                // tính lại theo SKU: chỉ dòng CÒN thiếu chiTiet.dong; chiTiet = cũ || mới (jsonb ||)
                const r = bang.get(a[0])
                if (!r || r.chiTiet?.dong !== undefined) return 0
                Object.assign(r, { doanhThu: a[1], phiDuKien: a[2], giaVon: a[3], lai: a[4], thieuGiaVon: a[5], nguonPhi: a[6], chiTiet: { ...(r.chiTiet || {}), ...JSON.parse(a[7]) } })
                return 1
            }
            if (/UPDATE "LaiDuKienDon" SET "chiTiet" = COALESCE\("chiTiet", '\{\}'::jsonb\) \|\| '\{"dong": \[\]\}'::jsonb/.test(sql)) {
                let n = 0
                for (const id of a[0]) { const r = bang.get(id); if (r && r.chiTiet?.dong === undefined) { r.chiTiet = { ...(r.chiTiet || {}), dong: [] }; n++ } }
                return n
            }
            throw new Error('execute lạ: ' + sql.slice(0, 80))
        },
        async $queryRawUnsafe(sql: string, ...a: any[]) {
            cau.push(sql)
            if (/to_regclass\('"LaiDuKienDon"'\)/.test(sql)) return [{ co: coBang }]
            if (!coBang && /"LaiDuKienDon"/.test(sql)) throw new Error('relation "LaiDuKienDon" does not exist (42P01)')
            if (/INSERT INTO "LaiDuKienDon"/.test(sql)) {
                if (tc.thuaGianh || bang.has(a[0])) return []
                bang.set(a[0], { orderId: a[0], doanhThu: a[1], phiDuKien: a[2], giaVon: a[3], lai: a[4], thieuGiaVon: a[5], nguonPhi: a[6], chiTiet: JSON.parse(a[7]), xetLuc: new Date(BAY), baoLuc: null })
                return [{ orderId: a[0] }]
            }
            if (/SELECT o\.id, \(l\."orderId" IS NOT NULL\) AS "daCo"\s+FROM "OnlineOrder" o LEFT JOIN "LaiDuKienDon" l/.test(sql)) {
                // lưới vét: $1 mốc 24 giờ, $2 sàn, $3 trạng thái huỷ, $4 mốc 3 ngày, $5 kênh — đơn CHƯA có dòng ≤ 24 giờ, hoặc dòng
                // CHƯA có chiTiet.dong ≤ 3 ngày; đơn chưa có dòng lên trước
                if (tc.hongVet) throw new Error('mất kết nối')
                return du.don.filter(d => d.createdAt >= a[3] && a[1].includes(String(d.platform).toLowerCase()) && !a[2].includes(d.status)
                    && (a[4] == null || d.channelId === a[4])
                    && ((!bang.has(d.id) && d.createdAt >= a[0]) || (bang.has(d.id) && bang.get(d.id).chiTiet?.dong === undefined)))
                    .sort((x, y) => Number(bang.has(x.id)) - Number(bang.has(y.id)) || y.createdAt - x.createdAt)
                    .map(d => ({ id: d.id, daCo: bang.has(d.id) }))
            }
            if (/SELECT "orderId" FROM "LaiDuKienDon"/.test(sql)) return [...bang.values()].filter(r => a[0].includes(r.orderId)).map(r => ({ orderId: r.orderId }))
            if (/FROM "LaiDuKienDon" WHERE/.test(sql)) return [...bang.values()].filter(r => a[0].includes(r.orderId))
            if (/SELECT p\."categoryId" FROM "OnlineProduct"/.test(sql)) {
                const ra: any[] = []
                for (const d of du.don) if (a[0].includes(d.id)) for (const i of d.items) ra.push({ id: i.id, nganh: du.nganh?.[i.id] ?? null })
                return ra
            }
            throw new Error('query lạ: ' + sql.slice(0, 80))
        },
        onlineOrder: {
            async findMany({ where }: any) {
                return du.don.filter(d => where.id.in.includes(d.id) && (!where.createdAt?.gte || d.createdAt >= where.createdAt.gte))
            },
        },
        onlineChannel: { async findMany({ where }: any) { return du.kenh.filter(k => where.id.in.includes(k.id)) } },
        notification: {
            async create({ data }: any) {
                if (tc.hongTin) throw new Error('ghi tin hỏng')
                const r = { id: `tin${tin.length + 1}`, ...data }; tin.push(r); return r
            },
        },
        skuMapping: { async findMany() { return du.map || [] } },
        product: {
            async findMany({ where }: any) {
                if (where.id?.in) return du.sp.filter(s => where.id.in.includes(s.id)).map(s => ({ id: s.id, costPrice: s.costPrice, bundleId: null, mergedIntoId: null, mergedRate: 1 }))
                if (where.sku?.in) return du.sp.filter(s => where.sku.in.includes(s.sku)).map(s => ({ sku: s.sku, costPrice: s.costPrice }))
                return []
            },
        },
        bundle: { async findMany() { return [] } },
    }
    return p
}
const don = (id: string, o: Partial<{ platform: string; status: string; note: string; tuoiGio: number; kenh: string; items: any[] }> = {}) => ({
    id, orderNumber: `SPE-${id.toUpperCase()}`, platform: o.platform || 'shopee', status: o.status || 'READY_TO_SHIP', note: o.note ?? null,
    subtotal: (o.items || []).reduce((s, i) => s + i.lineTotal, 0), netRevenue: 0, channelId: o.kenh || 'k1', channelName: 'Kengi Store',
    createdAt: new Date(BAY - (o.tuoiGio ?? 1) * 3600_000), items: o.items || [],
})
const dong = (id: string, gia: number, productId: string | null, sku: string | null = null, quantity = 1, productName = `Hàng ${id}`) =>
    ({ id, productId, sku, quantity, lineTotal: gia, externalItemId: null, productName })
const KENH = [{ id: 'k1', name: 'Kengi Store', platform: 'shopee' }, { id: 'k2', name: 'TikTok Store', platform: 'tiktok' }]
const SP = [{ id: 'p1', sku: 'A1', costPrice: 85_000 }, { id: 'p2', sku: 'A2', costPrice: 100_000 }, { id: 'p3', sku: 'A3', costPrice: 0 }, { id: 'p4', sku: 'VI', costPrice: 9_000 },
    { id: 'p5', sku: 'B48', costPrice: 48_000 }, { id: 'p6', sku: 'QUA', costPrice: 20_000 }]
const pushGia = () => { const goi: any[] = []; const f = async (_p: any, title: string, body: string, extra: any) => { goi.push({ title, body, extra }); return 2 }; return { goi, f } }
const docBangGia = (theoKenh: Record<string, any>) => async (_p: any, ch: any) => {
    const b = theoKenh[ch.id]
    if (b instanceof Error) throw b
    return b
}

async function main() {
    /* ── A. phiSanCuaDon ───────────────────────────────────────────────────────────────────────────────────────────────── */
    {
        for (const gia of [80_000, 300_000, 1_500_000]) {
            dung(`A1 đơn một dòng ${gia.toLocaleString('vi-VN')}đ: phiSanCuaDon = phiSanCuaGia`, gan(phiSanCuaDon([{ gia, phi: M100 }]), phiSanCuaGia(M100, gia), 1e-6))
            dung(`A1b ${gia.toLocaleString('vi-VN')}đ: phí công thức = công thức escrow tính tay`, gan(phiSanCuaGia(M100, gia), phiShopeeTay([{ gia, r: 0.13 }]), 0.5),
                `${phiSanCuaGia(M100, gia)} vs ${phiShopeeTay([{ gia, r: 0.13 }])}`)
        }
        dung('A2 hai dòng cùng ngành = phiSanCuaGia(tổng) (trần dịch vụ theo ĐƠN, phí mỗi đơn một lần)',
            gan(phiSanCuaDon([{ gia: 600_000, phi: M100 }, { gia: 700_000, phi: M100 }]), phiSanCuaGia(M100, 1_300_000), 1e-6))
        for (const [a, b2] of [[100_000, 150_000], [900_000, 800_000]]) {
            const tay = phiShopeeTay([{ gia: a!, r: 0.13 }, { gia: b2!, r: 0.16 }])
            const may = phiSanCuaDon([{ gia: a!, phi: M100 }, { gia: b2!, phi: M200 }])
            dung(`A3 hai ngành ${a}+${b2}: = công thức escrow cả đơn (% từng ngành, trần + phí đơn một lần)`, gan(may, tay, 0.5), `${may} vs ${tay}`)
        }
        // danhGiaGia: phiSan không đổi sau khi tách phiSanCuaGia
        const cu = (gia: number, qua: boolean) => (M100.tyLe + (qua ? 0 : 0.008)) * gia + M100.coDinh - (M100.tran && gia > M100.tran.tuGia ? M100.tran.giam * (gia - M100.tran.tuGia) : 0)
        dung('A4 danhGiaGia giữ nguyên số phí (kỳ vọng + qua affiliate, hai bên trần)',
            [200_000, 2_000_000].every(g => [false, true].every(q => danhGiaGia(g, { giaVon: 1, phi: M100 }, q).phiSan === Math.round(cu(g, q)))))
        dung('A5 dòng giá 0 (quà tặng) không tính phí; đơn toàn dòng 0 ⇒ 0', phiSanCuaDon([{ gia: 0, phi: M100 }]) === 0
            && gan(phiSanCuaDon([{ gia: 0, phi: M200 }, { gia: 100_000, phi: M100 }]), phiSanCuaGia(M100, 100_000), 1e-6))
    }

    /* ── B. phiDuKienCuaDon ────────────────────────────────────────────────────────────────────────────────────────────── */
    {
        const d1: DongGia[] = [{ gia: 100_000, nganh: '100' }]
        const cb = phiDuKienCuaDon(d1, bangMot(MAU_CHUA_BIET))
        dung('B1 gian CHƯA BIẾT phí ⇒ phi null, nguồn chua-biet (không bịa 6%)', cb.phi === null && cb.nguon === 'chua-biet' && /CHƯA BIẾT/.test(cb.moTa))
        const kh = phiDuKienCuaDon(d1, bangMot(MAU_KHAI))
        dung('B2 phí KHAI ⇒ nguồn khai, phí = % khai × giá', kh.nguon === 'khai' && kh.phi === 25_000 && /KHAI/.test(kh.moTa))
        const ct = phiDuKienCuaDon(d1, BANG_CONG_THUC)
        dung('B3 phí công thức ⇒ nguồn cong-thuc, nói % ngành, không tạm', ct.nguon === 'cong-thuc' && !ct.tam && /13%/.test(ct.moTa)
            && ct.phi === Math.round(phiShopeeTay([{ gia: 100_000, r: 0.13 }])), JSON.stringify(ct))
        const tam = phiDuKienCuaDon([{ gia: 100_000, nganh: '999' }, { gia: 50_000, nganh: null }], BANG_CONG_THUC)
        dung('B4 ngành chưa có mẫu / chưa rõ ngành ⇒ tạm + nói "trung bình"', tam.tam && /trung bình/.test(tam.moTa) && tam.phi != null)
        const so = phiDuKienCuaDon(d1, bangMot(MAU_SO))
        dung('B5 phí đo từ sổ ⇒ nguồn do-so, nói số đơn', so.nguon === 'do-so' && /120 đơn/.test(so.moTa) && so.phi === 26_000)
        dung('B6 đơn không dòng nào có giá ⇒ phi null', phiDuKienCuaDon([{ gia: 0, nganh: '100' }], BANG_CONG_THUC).phi === null)
    }

    /* ── C. ketLuanLaiDuKien + tinBaoLo ────────────────────────────────────────────────────────────────────────────────── */
    {
        const p = phiDuKienCuaDon([{ gia: 100_000, nganh: '100' }], BANG_CONG_THUC)
        const c1 = ketLuanLaiDuKien(100_000, p, { cost: 85_000, missingCost: false })
        dung('C1 đủ dữ liệu, âm ⇒ lỗ, du', c1.lo && c1.du && c1.lai === 100_000 - p.phi! - 85_000)
        const c2 = ketLuanLaiDuKien(100_000, p, { cost: 20_000, missingCost: true })
        dung('C2 thiếu giá vốn mà phần đã biết dương ⇒ KHÔNG kết luận lỗ, không du', !c2.lo && !c2.du)
        const c3 = ketLuanLaiDuKien(100_000, p, { cost: 90_000, missingCost: true })
        dung('C3 thiếu giá vốn nhưng phần đã biết đã âm ⇒ LỖ CHẮC', c3.lo && !c3.du)
        const pcb = phiDuKienCuaDon([{ gia: 100_000, nganh: '100' }], bangMot(MAU_CHUA_BIET))
        dung('C4 chưa biết phí: bán < vốn ⇒ lỗ chắc; bán > vốn ⇒ không kết luận',
            ketLuanLaiDuKien(100_000, pcb, { cost: 120_000, missingCost: false }).lo
            && !ketLuanLaiDuKien(100_000, pcb, { cost: 60_000, missingCost: false }).lo
            && !ketLuanLaiDuKien(100_000, pcb, { cost: 60_000, missingCost: false }).du)
        const t = tinBaoLo({ ma: 'SPE-ABC', san: 'shopee', kenh: 'Kengi Store' }, c1)
        dung('C5 tin báo: tiêu đề có mã đơn + LỖ + số lỗ; thân có đủ phép tính + nguồn phí', /SPE-ABC/.test(t.tieuDe) && /LỖ/.test(t.tieuDe)
            && t.tieuDe.includes(Math.round(-c1.lai).toLocaleString('vi-VN')) && /phí sàn dự kiến/.test(t.noiDung) && /biểu phí Shopee/.test(t.noiDung)
            && /SHOPEE · Kengi Store/.test(t.noiDung), `${t.tieuDe} | ${t.noiDung}`)
        dung('C6 tin báo thiếu giá vốn nói "lỗ thật còn lớn hơn"', /chưa có giá vốn/.test(tinBaoLo({ ma: 'X', san: 'shopee' }, c3).noiDung))
        const h = tenHangChinh([{ productName: 'Ốc vít', quantity: 1, lineTotal: 5_000 }, { productName: '  Máy sấy tóc   SHD2306 ', quantity: 2, lineTotal: 600_000 }])
        const t7 = tinBaoLo({ ma: 'SPE-ABC', san: 'tiktok', kenh: 'Kengi Store', hang: h }, c1)
        dung('C7 tên mặt hàng chính = dòng giá cao nhất, gọn khoảng trắng, ×SL, (+n mặt hàng); tin báo nêu tên hàng',
            h === 'Máy sấy tóc SHD2306 ×2 (+1 mặt hàng)' && t7.noiDung.startsWith('Máy sấy tóc SHD2306 ×2 (+1 mặt hàng) — TIKTOK · Kengi Store')
            && tenHangChinh([]) === '' && tenHangChinh([{ productName: 'x'.repeat(100), quantity: 1, lineTotal: 1 }]).length === 70
            && tenHangChinh([{ productName: '[Hàng Chính Hãng] 【Freeship】 Bàn Là Khô SHD2017', quantity: 1, lineTotal: 1 }]) === 'Bàn Là Khô SHD2017'
            && tenHangChinh([{ productName: '[Combo 2]', quantity: 1, lineTotal: 1 }]) === '[Combo 2]', `${h} | ${t7.noiDung}`)
        const c8 = ketLuanLaiDuKien(0, phiDuKienCuaDon([{ gia: 0, nganh: '100' }], BANG_CONG_THUC), { cost: 85_000, missingCost: false })
        dung('C8 đơn chưa mang giá (bán 0đ) ⇒ KHÔNG kết luận lỗ (thiếu số ≠ lỗ)', !c8.lo && !c8.du)
    }

    /* ── D. xetLaiDuKienDonMoi ─────────────────────────────────────────────────────────────────────────────────────────── */
    const nen = { k1: BANG_CONG_THUC, k2: bangMot(MAU_SO) }
    {
        const du = { don: [don('d1', { items: [dong('i1', 100_000, 'p1')] })], kenh: KENH, sp: SP, nganh: { i1: '100' } }
        const p = taoPrisma(du), push = pushGia()
        const r = await xetLaiDuKienDonMoi(p, ['d1'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f, nguon: 'webhook' })
        const phi = Math.round(phiShopeeTay([{ gia: 100_000, r: 0.13 }]))
        dung('D1 đơn lỗ: lưu một dòng đúng số, MỘT tin loi_nhuan_thap có mã đơn, MỘT push đúng type/route/id, đánh dấu đã báo',
            r.daLuu === 1 && r.lo === 1 && r.daBao === 1 && p.bang.get('d1')?.lai === 100_000 - phi - 85_000 && p.bang.get('d1')?.baoLuc
            && p.tin.length === 1 && p.tin[0].type === 'loi_nhuan_thap' && /SPE-D1/.test(p.tin[0].title)
            && push.goi.length === 1 && push.goi[0].extra.type === 'loi_nhuan_thap' && push.goi[0].extra.route === 'online-orders'
            && push.goi[0].extra.id === 'tin1' && r.push === 2, JSON.stringify({ r, row: p.bang.get('d1'), tin: p.tin }))
        const r2 = await xetLaiDuKienDonMoi(p, ['d1', 'd1'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        dung('D2 gọi lại (webhook đổi trạng thái / lượt đồng bộ) ⇒ không tin, không push mới', r2.xet === 0 && p.tin.length === 1 && push.goi.length === 1)
    }
    {
        const du = { don: [don('d3', { items: [dong('i3', 300_000, 'p2')] })], kenh: KENH, sp: SP, nganh: { i3: '100' } }
        const p = taoPrisma(du), push = pushGia()
        const r = await xetLaiDuKienDonMoi(p, ['d3'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        dung('D3 đơn lãi: lưu dòng (để trang đơn hiện lãi dự kiến), không tin, không push', r.daLuu === 1 && r.lo === 0 && p.bang.get('d3')?.lai > 0 && !p.tin.length && !push.goi.length)
    }
    {
        const du = {
            don: [
                don('cu', { tuoiGio: 30, items: [dong('a', 100_000, 'p1')] }),
                don('huy', { status: 'CANCELLED', items: [dong('b', 100_000, 'p1')] }),
                don('keobu', { note: '[Kéo bù đơn cũ] x', items: [dong('c', 100_000, 'p1')] }),
                don('tay', { platform: 'manual', items: [dong('e', 100_000, 'p1')] }),
                don('rong', { items: [] }),
            ], kenh: KENH, sp: SP,
        }
        const p = taoPrisma(du), push = pushGia()
        const { DAU_KEO_BU } = await import('../src/lib/dauKeoBu')
        du.don[2]!.note = `${DAU_KEO_BU} 12/11`
        const r = await xetLaiDuKienDonMoi(p, du.don.map(d => d.id), { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        dung(`D4 đơn cũ hơn ${CUA_SO_DON_MOI_MS / 3600_000} giờ / huỷ / kéo bù / không phải sàn / không dòng ⇒ bỏ, không lưu, không báo`,
            r.daLuu === 0 && r.xet === 0 && r.boQua === 5 && !p.tin.length && !push.goi.length && p.bang.size === 0, JSON.stringify(r))
    }
    {
        const ds = Array.from({ length: 10 }, (_, i) => don(`m${i}`, { items: [dong(`mi${i}`, 100_000, 'p1')] }))
        const du = { don: ds, kenh: KENH, sp: SP, nganh: Object.fromEntries(ds.map((_, i) => [`mi${i}`, '100'])) }
        const p = taoPrisma(du), push = pushGia()
        const r = await xetLaiDuKienDonMoi(p, ds.map(d => d.id), { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f, nguon: 'dong-bo' })
        dung('D5 mẻ 10 đơn lỗ (lượt đồng bộ vớt) ⇒ MỘT tin gộp + MỘT push, cả 10 đã đánh dấu',
            r.lo === 10 && r.daBao === 10 && p.tin.length === 1 && /10 đơn/.test(p.tin[0].title) && push.goi.length === 1
            && [...p.bang.values()].every((x: any) => x.baoLuc), JSON.stringify({ r, tin: p.tin.map((t: any) => t.title) }))
    }
    {
        const du = {
            don: [don('x1', { kenh: 'k1', items: [dong('x1i', 100_000, 'p1')] }), don('x2', { kenh: 'k2', platform: 'tiktok', items: [dong('x2i', 100_000, 'p1')] })],
            kenh: KENH, sp: SP,
        }
        const p = taoPrisma(du), push = pushGia()
        const r = await xetLaiDuKienDonMoi(p, ['x1', 'x2'], { bayGio: BAY, docBang: docBangGia({ k1: new Error('mất kết nối'), k2: bangMot(MAU_SO) }), guiPush: push.f })
        dung('D6 đọc phí một gian hỏng ⇒ đơn gian đó KHÔNG lưu (xét lại sau); gian kia vẫn tính (TikTok phí đo từ sổ)',
            !p.bang.has('x1') && p.bang.has('x2') && p.bang.get('x2')?.nguonPhi === 'do-so' && !!r.loi, JSON.stringify(r))
    }
    {
        const du = { don: [don('h1', { items: [dong('h1i', 100_000, 'p1')] })], kenh: KENH, sp: SP, nganh: { h1i: '100' } }
        const p = taoPrisma(du, { hongTin: true }), push = pushGia()
        const r = await xetLaiDuKienDonMoi(p, ['h1'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        dung('D7 ghi tin hỏng ⇒ GỠ dòng giành (lần sau báo lại), không push', !p.bang.has('h1') && r.daBao === 0 && !push.goi.length && r.daLuu === 0, JSON.stringify(r))
        const p2 = taoPrisma(du, { thuaGianh: true }), push2 = pushGia()
        await xetLaiDuKienDonMoi(p2, ['h1'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push2.f })
        dung('D8 thua giành (bản khác vừa xét) ⇒ im', !p2.tin.length && !push2.goi.length)
    }
    {
        const du = { don: [don('t1', { items: [dong('t1i', 100_000, 'p1'), dong('t1j', 20_000, 'p3')] })], kenh: KENH, sp: SP, nganh: { t1i: '100', t1j: '100' } }
        const p = taoPrisma(du), push = pushGia()
        await xetLaiDuKienDonMoi(p, ['t1'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        dung('D9 thiếu giá vốn một mặt hàng mà phần đã biết đã lỗ ⇒ VẪN báo, nói "chưa có giá vốn"',
            p.tin.length === 1 && /chưa có giá vốn/.test(p.tin[0].message) && p.bang.get('t1')?.thieuGiaVon === true, JSON.stringify(p.tin))
    }
    {
        const du = { don: [don('s1', { items: [dong('s1i', 100_000, 'p1')] })], kenh: KENH, sp: SP, nganh: { s1i: '100' } }
        const p = taoPrisma(du), push = pushGia()
        process.env.BAO_DONG_LO_DU_KIEN = '0'
        const r = await xetLaiDuKienDonMoi(p, ['s1'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        delete process.env.BAO_DONG_LO_DU_KIEN
        dung('D10 công tắc BAO_DONG_LO_DU_KIEN=0 ⇒ vẫn tính + lưu, không báo', r.daLuu === 1 && r.lo === 1 && !p.tin.length && !push.goi.length)
    }
    {
        // vỉ 10 cái: SKU sàn VI10 ánh xạ p4 hệ số 10 ⇒ giá vốn 90.000 (không phải 9.000)
        const du = {
            don: [don('v1', { items: [{ ...dong('v1i', 100_000, 'p4', 'VI10'), productId: 'p4' }] })], kenh: KENH, sp: SP, nganh: { v1i: '100' },
            map: [{ platformSku: 'VI10', platform: 'shopee', productId: 'p4', conversionRate: 10, bundleId: null }],
        }
        const p = taoPrisma(du), push = pushGia()
        await xetLaiDuKienDonMoi(p, ['v1'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        dung('D11 giá vốn theo QUY ĐỔI đơn vị sàn → kho (vỉ 10 cái) ⇒ lỗ được phát hiện', p.bang.get('v1')?.giaVon === 90_000 && p.tin.length === 1,
            JSON.stringify(p.bang.get('v1')))
    }
    {
        // đơn về mà dòng hàng chưa mang giá: không lưu, không báo — lần sau (đã có giá) xét lại được
        const du = { don: [don('g0', { items: [dong('g0i', 0, 'p1')] })], kenh: KENH, sp: SP, nganh: { g0i: '100' } }
        const p = taoPrisma(du), push = pushGia()
        const r = await xetLaiDuKienDonMoi(p, ['g0'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        du.don[0]!.items[0]!.lineTotal = 100_000
        const r2 = await xetLaiDuKienDonMoi(p, ['g0'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        dung('D12 dòng hàng chưa mang giá ⇒ chưa lưu, không báo oan "lỗ = −giá vốn"; có giá rồi ⇒ xét + báo',
            r.chuaCoGia === 1 && r.daLuu === 0 && r2.daLuu === 1 && r2.lo === 1 && p.tin.length === 1, JSON.stringify({ r, r2 }))
    }
    {
        const du = { don: [don('n1', { items: [dong('n1i', 100_000, 'p1', null, 1, 'Máy sấy tóc Sunhouse SHD2306')] })], kenh: KENH, sp: SP, nganh: { n1i: '100' } }
        const p = taoPrisma(du), push = pushGia()
        let soLanDoc = 0
        const dem = async (pr: any, ch: any) => { soLanDoc++; return docBangGia(nen)(pr, ch) }
        await xetLaiDuKienDonMoi(p, ['n1'], { bayGio: BAY, docBang: dem, guiPush: push.f })
        dung('D13 tin + push nêu TÊN mặt hàng (biết ngay hàng nào đang bán lỗ)', /Máy sấy tóc Sunhouse SHD2306/.test(p.tin[0]?.message || '')
            && /Máy sấy tóc Sunhouse SHD2306/.test(push.goi[0]?.body || ''), JSON.stringify({ tin: p.tin, push: push.goi }))
        du.don.push(don('n2', { items: [dong('n2i', 300_000, 'p2')] }))
        await xetLaiDuKienDonMoi(p, ['n2'], { bayGio: BAY + 60_000, docBang: dem, guiPush: push.f })
        await xetLaiDuKienDonMoi(p, ['n2'], { bayGio: BAY + 6 * 60_000, docBang: dem, guiPush: push.f })
        du.don.push(don('n3', { items: [dong('n3i', 300_000, 'p2')] }))
        await xetLaiDuKienDonMoi(p, ['n3'], { bayGio: BAY + 6 * 60_000, docBang: dem, guiPush: push.f })
        dung('D14 bảng phí gian ĐỆM 5 phút (giờ livestream không đọc lại sổ 90 ngày cho từng đơn), hết hạn thì đọc lại', soLanDoc === 2, `đọc ${soLanDoc} lần`)
    }

    /* ── G. Lưới vét + gọi an toàn ─────────────────────────────────────────────────────────────────────────────────────── */
    {
        const du = {
            don: [
                don('w1', { items: [dong('w1i', 100_000, 'p1')] }),                      // lỗ, chưa xét (webhook lỡ)
                don('w2', { items: [dong('w2i', 300_000, 'p2')] }),                      // lãi, chưa xét
                don('w3', { tuoiGio: 30, items: [dong('w3i', 100_000, 'p1')] }),         // cũ hơn 24 giờ
                don('w4', { status: 'CANCELLED', items: [dong('w4i', 100_000, 'p1')] }), // huỷ
                don('w5', { kenh: 'k2', platform: 'tiktok', items: [dong('w5i', 100_000, 'p1')] }), // kênh khác
            ], kenh: KENH, sp: SP, nganh: { w1i: '100', w2i: '100' },
        }
        const p = taoPrisma(du), push = pushGia()
        const r = await vetLaiDuKienDonMoi(p, KENH[0]!, 'dong-bo', { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        dung('G1 lưới vét: đơn ≤ 24 giờ CHƯA xét của đúng kênh ⇒ xét + báo; bỏ đơn cũ / huỷ / kênh khác',
            r?.daLuu === 2 && r?.lo === 1 && p.bang.has('w1') && p.bang.has('w2') && !p.bang.has('w3') && !p.bang.has('w4') && !p.bang.has('w5')
            && p.tin.length === 1 && /SPE-W1/.test(p.tin[0].title), JSON.stringify(r))
        const soCau = p.cau.length
        const r2 = await vetLaiDuKienDonMoi(p, KENH[0]!, 'dong-bo', { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        dung('G2 vét lại: không còn đơn chưa xét ⇒ MỘT truy vấn, không tin mới', r2 === null && p.cau.length - soCau === 1 && p.tin.length === 1)
        const p3 = taoPrisma(du)
        dung('G3 kênh không phải sàn (Facebook / tay) ⇒ không truy vấn gì',
            (await vetLaiDuKienDonMoi(p3, { id: 'fb', platform: 'facebook' }, 'dong-bo')) === null && p3.cau.length === 0)
        const p4 = taoPrisma(du, { hongVet: true })
        const p5 = taoPrisma(du, { hongTaoBang: true })
        let nem = false
        try {
            const a = await vetLaiDuKienDonMoi(p4, KENH[0]!, 'dong-bo', { bayGio: BAY, docBang: docBangGia(nen) })
            const b = await xetLaiDuKienAnToan(p5, ['w1'], 'webhook', { bayGio: BAY, docBang: docBangGia(nen) })
            nem = a !== null || b !== null
        } catch { nem = true }
        dung('G4 CSDL hỏng giữa chừng ⇒ lưới vét / gọi từ webhook KHÔNG ném (không làm hỏng việc nhận đơn), trả null', !nem)
    }

    /* ── E. docLaiDuKien ───────────────────────────────────────────────────────────────────────────────────────────────── */
    {
        const du = { don: [don('e1', { items: [dong('e1i', 100_000, 'p1')] }), don('e2', { items: [dong('e2i', 300_000, 'p2')] })], kenh: KENH, sp: SP, nganh: { e1i: '100', e2i: '100' } }
        const p = taoPrisma(du), push = pushGia()
        await xetLaiDuKienDonMoi(p, ['e1', 'e2'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        const m = await docLaiDuKien(p, ['e1', 'e2', 'khong'])
        dung('E1 đọc lại: đơn lỗ lo + baoLuc, đơn lãi lo=false, nguồn phí + câu mô tả, đơn chưa xét không có',
            m.get('e1')?.lo === true && !!m.get('e1')?.baoLuc && m.get('e2')?.lo === false && m.get('e2')?.nguonPhi === 'cong-thuc'
            && /biểu phí Shopee/.test(m.get('e2')?.moTaPhi || '') && !m.has('khong'), JSON.stringify([...m]))
        const p0 = taoPrisma(du)
        const m0 = await docLaiDuKien(p0, ['e1'])
        dung('E2 bảng chưa có ⇒ Map rỗng, KHÔNG đọc bảng (chỉ dò to_regclass)', m0.size === 0 && p0.cau.every((c: string) => /to_regclass/.test(c)))
    }

    /* ── H. Theo từng SKU (19/11/2026) ─────────────────────────────────────────────────────────────────────────────────── */
    {
        // H1. phiSanTungDong: Σ = phiSanCuaDon; mỗi SKU chịu % CHÍNH ngành nó; phần chung chia theo tỷ trọng giá; quà 0đ ⇒ 0
        const vao = [{ gia: 100_000, phi: M100 }, { gia: 150_000, phi: M200 }, { gia: 0, phi: M100 }]
        const t = phiSanTungDong(vao)
        const chung = t[0]!.phiChung + t[1]!.phiChung
        dung('H1 phí từng SKU: Σ = phí cả đơn; % riêng của ngành từng SKU (13% / 16% + phần chung); phần chung theo tỷ trọng giá; quà 0đ = 0',
            gan(t.reduce((s, x) => s + x.phi, 0), phiSanCuaDon(vao), 1e-6)
            && gan(t[0]!.phiTyLe, (M100.tyLe + 0.008) * 100_000, 1e-6) && gan(t[1]!.phiTyLe, (M200.tyLe + 0.008) * 150_000, 1e-6)
            && t[1]!.tyLe - t[0]!.tyLe > 0.029 && gan(t[0]!.phiChung / chung, 0.4, 1e-9) && t[2]!.phi === 0 && t[2]!.tyLe === 0,
            JSON.stringify(t))

        // H2. laiTungDong: Σ dòng = ĐÚNG số cả đơn (phí, vốn, lãi), kể cả phần lẻ làm tròn
        const dv: DongVaoLai[] = [
            { id: 'a', sku: 'A2', ten: 'Máy sấy', sl: 1, gia: 100_001, nganh: '100' },
            { id: 'b', sku: 'B48', ten: 'Bàn là', sl: 2, gia: 70_003, nganh: '200' },
            { id: 'c', sku: 'C1', ten: 'Ốc', sl: 3, gia: 9_999, nganh: null },
        ]
        const p = phiDuKienCuaDon(dv, BANG_CONG_THUC)
        const von = { cost: Math.round(10_000.4 + 20_000.4 + 30_000.4), missingCost: false, dong: [
            { id: 'a', cost: 10_000.4, missingCost: false }, { id: 'b', cost: 20_000.4, missingCost: false }, { id: 'c', cost: 30_000.4, missingCost: false }] }
        const k = ketLuanLaiDuKien(dv.reduce((s, x) => s + x.gia, 0), p, von)
        const ld = laiTungDong(dv, BANG_CONG_THUC, p, von)
        const tong = (f: (x: any) => number) => ld.reduce((s, x) => s + f(x), 0)
        dung('H2 Σ SKU = ĐÚNG cả đơn: phí, giá vốn (phần lẻ dồn vào dòng lớn), lãi; % phí của từng SKU theo ngành CHÍNH nó',
            tong(x => x.phi) === p.phi && tong(x => x.giaVon) === von.cost && tong(x => x.lai) === k.lai && ld[2]!.giaVon === 30_001
            && gan(ld[0]!.tyLePhi!, M100.tyLe + 0.008, 1e-4) && gan(ld[1]!.tyLePhi!, M200.tyLe + 0.008, 1e-4) && ld[2]!.tamPhi && !ld[0]!.tamPhi
            && ld[1]!.sl === 2 && ld[1]!.sku === 'B48', JSON.stringify({ p: p.phi, k: k.lai, ld }))

        // H3. SKU lỗ trong đơn lãi
        const dv3: DongVaoLai[] = [{ id: 'a', sku: 'A2', ten: 'Máy sấy', sl: 1, gia: 300_000, nganh: '100' }, { id: 'b', sku: 'B48', ten: 'Bàn là', sl: 1, gia: 50_000, nganh: '200' }]
        const p3 = phiDuKienCuaDon(dv3, BANG_CONG_THUC)
        const v3 = { cost: 148_000, missingCost: false, dong: [{ id: 'a', cost: 100_000, missingCost: false }, { id: 'b', cost: 48_000, missingCost: false }] }
        const k3 = ketLuanLaiDuKien(350_000, p3, v3)
        const l3 = laiTungDong(dv3, BANG_CONG_THUC, p3, v3)
        dung('H3 cả đơn LÃI mà một SKU bán LỖ ⇒ SKU đó lo, SKU kia không, cả đơn không lo', !k3.lo && k3.lai > 0 && l3[1]!.lo && l3[1]!.lai < 0 && !l3[0]!.lo,
            JSON.stringify({ k3, l3 }))
        // H4. thiếu giá vốn từng dòng ⇒ không đoán chia theo giá bán
        const l4 = laiTungDong(dv3, BANG_CONG_THUC, p3, { cost: 148_000, missingCost: false })
        dung('H4 thiếu giá vốn từng dòng (von.dong) ⇒ mọi SKU "thiếu giá vốn", vốn 0 — không chia bừa theo giá bán', l4.every(x => x.thieuGiaVon && x.giaVon === 0))
        // H5. chưa biết phí
        const pcb = phiDuKienCuaDon(dv3, bangMot(MAU_CHUA_BIET))
        const l5 = laiTungDong(dv3, bangMot(MAU_CHUA_BIET), pcb, { cost: 360_000, missingCost: false, dong: [{ id: 'a', cost: 310_000, missingCost: false }, { id: 'b', cost: 50_000, missingCost: false }] })
        dung('H5 gian CHƯA BIẾT phí ⇒ phí từng SKU null, không % (không bịa); bán < vốn vẫn là LỖ CHẮC, bán = vốn thì không',
            l5.every(x => x.phi === null && x.tyLePhi === null && x.moTaPhi === 'gian chưa biết phí') && l5[0]!.lo && !l5[1]!.lo, JSON.stringify(l5))
        // H6. quà tặng 0đ
        const dv6: DongVaoLai[] = [{ id: 'a', sku: 'A2', ten: 'Máy sấy', sl: 1, gia: 300_000, nganh: '100' }, { id: 'q', sku: 'QUA', ten: 'Quà tặng', sl: 1, gia: 0, nganh: '100' }]
        const p6 = phiDuKienCuaDon(dv6, BANG_CONG_THUC)
        const l6 = laiTungDong(dv6, BANG_CONG_THUC, p6, { cost: 120_000, missingCost: false, dong: [{ id: 'a', cost: 100_000, missingCost: false }, { id: 'q', cost: 20_000, missingCost: false }] })
        dung('H6 quà tặng 0đ: phí 0, lãi = −giá vốn nhưng KHÔNG gắn lỗ (khuyến mãi, đã nằm trong số cả đơn); phí cả đơn dồn hết vào SKU có giá',
            l6[1]!.phi === 0 && l6[1]!.lai === -20_000 && !l6[1]!.lo && l6[1]!.tyLePhi === null && l6[0]!.phi === p6.phi, JSON.stringify(l6))
        // H7. câu nguồn phí từng SKU
        const ten = { tenNganh: new Map([['300', 'Điện gia dụng']]) }
        dung('H7 câu nguồn phí của SKU: biểu phí Shopee + % ngành / tạm % trung bình / đo từ đơn của ngành (có tên) / cả gian / khai / chưa biết',
            /biểu phí Shopee: ngành 13% \+ phí chung/.test(moTaPhiDong(M100)) && /tạm % trung bình/.test(moTaPhiDong({ ...MTB, thayNganh: '999' }))
            && moTaPhiDong({ ...MAU_SO, nganh: '300' }, ten) === 'đo từ 120 đơn của ngành Điện gia dụng' && moTaPhiDong(MAU_SO) === 'đo từ 120 đơn của cả gian'
            && moTaPhiDong(MAU_KHAI) === 'phí KHAI của gian' && moTaPhiDong(MAU_CHUA_BIET) === 'gian chưa biết phí'
            && /ngành chưa đủ đơn — tạm phí cả gian \(120 đơn\)/.test(moTaPhiDong({ ...MAU_SO, thayNganh: '400' })),
            [moTaPhiDong(M100), moTaPhiDong({ ...MAU_SO, thayNganh: '400' })].join(' | '))
        // H8. tin báo SKU lỗ trong đơn lãi + phép tính một SKU
        const t8 = tinBaoLo({ ma: 'SPE-SKU', san: 'shopee', kenh: 'Kengi Store', hang: 'Máy sấy (+1 mặt hàng)' }, k3, [l3[1]!])
        const pt = phepTinhSku(l3[1]!)
        dung('H8 tin báo SKU lỗ (cả đơn lãi): tiêu đề "một SKU dự kiến LỖ" + số lỗ của SKU; thân nêu tên + [mã SKU] + phép tính có % phí của SKU + "Cả đơn vẫn lãi"',
            t8.tieuDe === `🚨 Đơn SPE-SKU: một SKU dự kiến LỖ ${Math.round(-l3[1]!.lai).toLocaleString('vi-VN')}đ` && t8.noiDung.startsWith('SHOPEE · Kengi Store: Bàn là [B48]: bán 50.000đ − phí ')
            && /của SKU/.test(t8.noiDung) && /Cả đơn vẫn lãi/.test(t8.noiDung) && pt.endsWith(`= ${Math.round(l3[1]!.lai).toLocaleString('vi-VN')}đ`),
            `${t8.tieuDe} | ${t8.noiDung}`)
    }
    {
        // H9. computeOrderProfits: giá vốn TỪNG dòng (quy đổi vỉ 10, dòng thiếu giá vốn, SL 2), Σ = giá vốn đơn
        const du = {
            don: [don('c1', { items: [{ ...dong('c1a', 100_000, 'p4', 'VI10'), productId: 'p4' }, dong('c1b', 20_000, 'p3'), dong('c1c', 200_000, 'p1', null, 2)] })],
            kenh: KENH, sp: SP, map: [{ platformSku: 'VI10', platform: 'shopee', productId: 'p4', conversionRate: 10, bundleId: null }],
        }
        const m = await computeOrderProfits(taoPrisma(du), du.don)
        const r = m.get('c1')!
        dung('H9 giá vốn TỪNG dòng: vỉ 10 = 90.000, dòng chưa khai giá vốn = thiếu, ×2 = 170.000; Σ = giá vốn đơn; đúng id dòng',
            JSON.stringify(r.dong?.map(x => [x.id, x.cost, x.missingCost])) === JSON.stringify([['c1a', 90_000, false], ['c1b', 0, true], ['c1c', 170_000, false]])
            && r.cost === 260_000 && r.missingCost, JSON.stringify(r))
    }
    {
        // D15–D18 trên prisma giả: SKU lỗ trong đơn lãi ⇒ báo; đơn một dòng không nói hai lần; quà 0đ không báo
        const du = {
            don: [
                don('k1', { items: [dong('k1a', 300_000, 'p2', 'A2', 1, 'Máy sấy tóc SHD2306'), dong('k1b', 50_000, 'p5', 'B48', 1, 'Bàn là khô SHD2017')] }),
                don('k2', { items: [dong('k2a', 100_000, 'p1', 'A1', 1, 'Quạt mini')] }),
                don('k3', { items: [dong('k3a', 100_000, 'p1', 'A1', 1, 'Quạt mini'), dong('k3b', 50_000, 'p5', 'B48', 1, 'Bàn là khô SHD2017')] }),
                don('k4', { items: [dong('k4a', 300_000, 'p2', 'A2', 1, 'Máy sấy tóc SHD2306'), dong('k4b', 0, 'p6', 'QUA', 1, 'Quà tặng túi vải')] }),
            ],
            kenh: KENH, sp: SP, nganh: { k1a: '100', k1b: '200', k2a: '100', k3a: '100', k3b: '200', k4a: '100', k4b: '100' },
        }
        const p = taoPrisma(du), push = pushGia()
        const r = await xetLaiDuKienDonMoi(p, ['k1'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f, nguon: 'webhook' })
        const row = p.bang.get('k1')
        const dongLuu = row?.chiTiet?.dong || []
        dung('D15 cả đơn LÃI mà SKU B48 bán LỖ ⇒ BÁO (tin + push nêu tên + [B48] + "Cả đơn vẫn lãi"); lưu từng SKU, Σ lãi SKU = lãi đơn',
            r.lo === 0 && r.loSku === 1 && r.daBao === 1 && row?.lai > 0 && dongLuu.length === 2 && row?.chiTiet?.soSkuLo === 1
            && dongLuu.reduce((s: number, x: any) => s + x.lai, 0) === row?.lai && dongLuu[1].lo === true && dongLuu[0].lo === false
            && /một SKU dự kiến LỖ/.test(p.tin[0]?.title || '') && /Bàn là khô SHD2017 \[B48\]/.test(p.tin[0]?.message || '')
            && /Cả đơn vẫn lãi/.test(p.tin[0]?.message || '') && push.goi.length === 1 && /\[B48\]/.test(push.goi[0]?.body || '') && !!row?.baoLuc,
            JSON.stringify({ r, row, tin: p.tin }))
        await xetLaiDuKienDonMoi(p, ['k2'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        dung('D16 đơn MỘT dòng lỗ ⇒ tin cả đơn như cũ, KHÔNG nhắc lại "Lỗ ở SKU" (một SKU = cả đơn)',
            p.tin.length === 2 && /SPE-K2 dự kiến LỖ/.test(p.tin[1]?.title || '') && !/Lỗ ở SKU/.test(p.tin[1]?.message || ''), JSON.stringify(p.tin[1]))
        await xetLaiDuKienDonMoi(p, ['k3'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        dung('D17 đơn nhiều dòng LỖ cả đơn ⇒ tin cả đơn + "Lỗ ở SKU:" nêu từng SKU lỗ',
            p.tin.length === 3 && /SPE-K3 dự kiến LỖ/.test(p.tin[2]?.title || '') && /Lỗ ở SKU: .*Quạt mini \[A1\].*Bàn là khô SHD2017 \[B48\]/.test(p.tin[2]?.message || ''),
            JSON.stringify(p.tin[2]))
        const r4 = await xetLaiDuKienDonMoi(p, ['k4'], { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        const d4 = p.bang.get('k4')?.chiTiet?.dong || []
        dung('D18 quà tặng 0đ trong đơn lãi ⇒ KHÔNG báo; giá vốn quà vẫn trừ vào cả đơn; dòng quà lưu lo=false',
            r4.lo === 0 && r4.loSku === 0 && p.tin.length === 3 && d4.length === 2 && d4[1].lo === false && d4[1].lai === -20_000
            && p.bang.get('k4')?.giaVon === 120_000, JSON.stringify({ r4, d4 }))
        // E3. đọc lại theo SKU
        p.bang.set('cu', { orderId: 'cu', doanhThu: 1, phiDuKien: 0, giaVon: 0, lai: 1, thieuGiaVon: false, nguonPhi: 'cong-thuc', chiTiet: { moTaPhi: 'x' }, xetLuc: new Date(BAY), baoLuc: null })
        const m = await docLaiDuKien(p, ['k1', 'cu'])
        dung('E3 docLaiDuKien trả từng SKU + số SKU lỗ; dòng tính trước 19/11 (chưa có theo SKU) ⇒ dong null, 0 SKU lỗ',
            m.get('k1')?.dong?.length === 2 && m.get('k1')?.soSkuLo === 1 && m.get('k1')?.dong?.[1]?.sku === 'B48' && m.get('k1')?.dong?.[1]?.tyLePhi! > 0.1
            && m.get('cu')?.dong === null && m.get('cu')?.soSkuLo === 0, JSON.stringify([...m]))
    }
    {
        // D19. mẻ gộp có đơn chỉ lỗ ở SKU ⇒ tiêu đề nói rõ
        const ds = Array.from({ length: 8 }, (_, i) => don(`g${i}`, { items: [dong(`g${i}i`, 100_000, 'p1')] }))
        ds.push(don('gs', { items: [dong('gsa', 300_000, 'p2', 'A2'), dong('gsb', 50_000, 'p5', 'B48')] }))
        const du = { don: ds, kenh: KENH, sp: SP, nganh: { ...Object.fromEntries(ds.map((_, i) => [`g${i}i`, '100'])), gsa: '100', gsb: '200' } }
        const p = taoPrisma(du), push = pushGia()
        const r = await xetLaiDuKienDonMoi(p, ds.map(d => d.id), { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f, nguon: 'dong-bo' })
        dung('D19 mẻ 9 đơn (8 lỗ cả đơn + 1 chỉ lỗ ở SKU) ⇒ MỘT tin gộp "9 đơn mới dự kiến LỖ (1 đơn chỉ lỗ ở SKU)" + MỘT push',
            r.lo === 8 && r.loSku === 1 && r.daBao === 9 && p.tin.length === 1 && p.tin[0].title === '🚨 9 đơn mới dự kiến LỖ (1 đơn chỉ lỗ ở SKU)'
            && push.goi.length === 1 && push.goi[0].title === p.tin[0].title, JSON.stringify({ r, tin: p.tin.map((t: any) => t.title) }))
    }
    {
        // G5–G8. Lưới vét TÍNH LẠI theo SKU dòng cũ (≤ 3 ngày), giữ baoLuc + nguồn, KHÔNG báo lại
        const du = {
            don: [
                don('u1', { tuoiGio: 30, items: [dong('u1a', 300_000, 'p2', 'A2'), dong('u1b', 50_000, 'p5', 'B48')] }), // 30 giờ — quá 24 giờ, trong 3 ngày
                don('u2', { tuoiGio: 80, items: [dong('u2a', 100_000, 'p1')] }),                                        // 80 giờ — quá 3 ngày
                don('u3', { tuoiGio: 5, items: [] }),                                                                   // hết dòng hàng
            ],
            kenh: KENH, sp: SP, nganh: { u1a: '100', u1b: '200', u2a: '100' },
        }
        const p = taoPrisma(du, { bangCo: true }), push = pushGia()
        const cu = (id: string) => ({ orderId: id, doanhThu: 1, phiDuKien: 0, giaVon: 0, lai: 1, thieuGiaVon: false, nguonPhi: 'cong-thuc',
            chiTiet: { moTaPhi: 'cũ', nguon: 'webhook' }, xetLuc: new Date(BAY - 3600_000), baoLuc: new Date(BAY - 3600_000) })
        for (const id of ['u1', 'u2', 'u3']) p.bang.set(id, cu(id))
        const r = await vetLaiDuKienDonMoi(p, KENH[0]!, 'dong-bo', { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        const u1 = p.bang.get('u1')
        dung('G5 dòng cũ ≤ 3 ngày chưa có theo SKU ⇒ TÍNH LẠI (Σ SKU = cả đơn), giữ baoLuc + nguồn cũ, KHÔNG tin, KHÔNG push (dù có SKU lỗ)',
            r?.nangCap === 1 && u1.chiTiet.dong?.length === 2 && u1.chiTiet.dong.reduce((s: number, x: any) => s + x.lai, 0) === u1.lai && u1.lai > 1
            && u1.chiTiet.nguon === 'webhook' && !!u1.chiTiet.tinhLaiTheoSku && +u1.baoLuc === BAY - 3600_000 && !p.tin.length && !push.goi.length,
            JSON.stringify({ r, u1 }))
        dung('G6 dòng cũ quá 3 ngày ⇒ để nguyên; đơn hết dòng hàng ⇒ đánh dấu dong=[] để thôi nhặt lại',
            p.bang.get('u2').chiTiet.dong === undefined && Array.isArray(p.bang.get('u3').chiTiet.dong) && p.bang.get('u3').chiTiet.dong.length === 0
            && CUA_SO_NANG_CAP_MS === 3 * 24 * 3600_000, JSON.stringify([p.bang.get('u2'), p.bang.get('u3')]))
        const soCau = p.cau.length
        const r2 = await vetLaiDuKienDonMoi(p, KENH[0]!, 'dong-bo', { bayGio: BAY, docBang: docBangGia(nen), guiPush: push.f })
        dung('G7 vét lại sau khi đã tính lại ⇒ MỘT truy vấn, không gì để làm', r2 === null && p.cau.length - soCau === 1, `${p.cau.length - soCau} câu`)
        const p2 = taoPrisma(du, { bangCo: true })
        p2.bang.set('u1', cu('u1'))
        const r3 = await vetLaiDuKienDonMoi(p2, KENH[0]!, 'dong-bo', { bayGio: BAY, docBang: docBangGia({ k1: new Error('mất kết nối'), k2: bangMot(MAU_SO) }) })
        dung('G8 đọc phí gian hỏng lúc tính lại ⇒ để nguyên dòng cũ (lượt sau thử lại), không ném', r3?.nangCap === 0 && p2.bang.get('u1').chiTiet.dong === undefined,
            JSON.stringify(r3))
    }

    /* ── F. Soát nguồn ─────────────────────────────────────────────────────────────────────────────────────────────────── */
    {
        const GOC = path.resolve(__dirname, '..')
        const doc = (t: string) => fs.readFileSync(path.join(GOC, t), 'utf8')
        const GOI = /\b(xetLaiDuKienDonMoi|xetLaiDuKienAnToan|vetLaiDuKienDonMoi)\(/
        const wh = doc('src/routes/webhooks.ts')
        // hai lời gọi (Shopee, TikTok), mỗi lời gọi đứng SAU nhánh tạo đơn của chính sàn đó (cuối handler)
        const viTri = [...wh.matchAll(/xetLaiDuKienAnToan\(storePrisma, \[idXetLai\], 'webhook'\)/g)].map(m => m.index!)
        const taoDon = [...wh.matchAll(/storePrisma\.onlineOrder\.create\(/g)].map(m => m.index!)
        dung('F1 webhook Shopee + TikTok: gọi xetLaiDuKienAnToan cuối handler, SAU khi tạo đơn + liên kết hàng (cả nhánh đơn đã có ≤ 24 giờ)',
            viTri.length === 2 && taoDon.length === 2 && viTri[0]! > taoDon[0]! && viTri[0]! < taoDon[1]! && viTri[1]! > taoDon[1]!
            && (wh.match(/idXetLai = newOrder\.id/g) || []).length === 2 && (wh.match(/< CUA_SO_DON_MOI_MS \? existing\.id : null/g) || []).length === 2,
            JSON.stringify({ viTri, taoDon }))
        dung('F2 lượt đồng bộ cron (autoSync) + đồng bộ tay (/sync) chạy lưới vét vetLaiDuKienDonMoi',
            /vetLaiDuKienDonMoi\(storePrisma, channel, 'dong-bo'\)/.test(doc('src/cron/autoSync.ts'))
            && /vetLaiDuKienDonMoi\(prisma, channel, 'dong-bo-tay'\)/.test(doc('src/routes/onlineOrders.ts')))
        dung('F3 kéo bù đơn cũ KHÔNG gọi (đơn cũ nhiều tháng không phải "đơn mới")', !/LaiDuKien/.test(doc('src/lib/keoBuDonSan.ts')))
        // mọi chỗ tạo OnlineOrder phải được phân loại: có gọi, hoặc nằm trong danh sách được miễn (có lý do)
        const MIEN: Record<string, string> = {
            'src/lib/keoBuDonSan.ts': 'kéo bù đơn cũ', 'src/routes/tax.ts': 'dữ liệu mẫu demo', 'src/routes/onlineOrders.ts': 'có gọi (+ đơn tay POST /)',
        }
        const lac: string[] = []
        const duyet = (thu: string) => {
            for (const e of fs.readdirSync(path.join(GOC, thu), { withFileTypes: true })) {
                const r = `${thu}/${e.name}`
                if (e.isDirectory()) { if (e.name !== 'generated' && e.name !== 'node_modules') duyet(r) }
                else if (/\.ts$/.test(e.name)) {
                    const s = doc(r)
                    if (/onlineOrder\.create\(/.test(s) && !GOI.test(s) && !MIEN[r]) lac.push(r)
                }
            }
        }
        duyet('src')
        dung('F4 mọi tệp TẠO OnlineOrder đều gọi xetLaiDuKienDonMoi hoặc được miễn có lý do', !lac.length, lac.join(', '))
        const oo = doc('src/routes/onlineOrders.ts')
        dung('F5 GET /online-orders trả laiDuKien (docLaiDuKien) cho owner/admin — cả đơn có lẫn không có số lợi nhuận',
            /docLaiDuKien\(prisma, orders/.test(oo) && /donHoanTra: p\.hoanTra === true,\s*laiDuKien,/.test(oo) && /\.\.\.oa, laiDuKien \}/.test(oo))
        const lib = doc('src/lib/laiDuKienDon.ts')
        dung('F6 báo bằng type loi_nhuan_thap (đã khai đủ 3 chỗ BE / Android / web) — không type mới',
            /type: 'loi_nhuan_thap'/.test(lib) && !/type: '(?!loi_nhuan_thap)[a-z_]+'/.test(lib))
    }

    console.log(`\n${dat}/${dat + loi} ca đạt`)
    if (loi) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
