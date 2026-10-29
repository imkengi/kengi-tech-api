/**
 * Kiểm MỘT NHÓM ZALO NỐI NHIỀU MÃ KHÁCH — npx tsx scripts/check-zalo-nhom-khach.ts
 *
 * Chủ shop 29/10/2026: "chỗ nối khách vào zalo thì nhiều mã có thể nối 1 khách". Lõi ở lib/zaloNhomKhach.ts (bảng lười mã
 * thêm + cặp gộp), nối vào 3 lib tính số (doanh số, tổng kết ngày, nhắc mua lại), soanNguoiNhan, /hoadon, chụp nợ đầu ngày.
 * Sai ở đây là: nợ gửi khách thiếu mã kia, "/hoadon" chỉ bật phiếu của một mã, một khách hai nhóm bị cộng đôi, nợ đầu ngày
 * đoán 0 khi thiếu ảnh chụp của một mã, hay mua xen kẽ hai mã mà không thấy nhịp — mỗi thứ một ca. Prisma giả.
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'ab'.repeat(32)

import {
    khachCuaNhom, capGopTheoNhom, bangGop, docKhachThem, ghiKhachThem, xoaKhachThem, nhomCoKhachThem, sqlKhachDangNoi, coBangNhomKhach, TOI_DA_MA,
} from '../src/lib/zaloNhomKhach'
import { tinhDoanhSo } from '../src/lib/zaloDoanhSo'
import { soNgayCuaKhach, chupNoDauNgay } from '../src/lib/zaloGiaoDichNgay'
import { thoiQuenMuaCuaKhach } from '../src/lib/zaloNhacMuaLai'
import { soanNguoiNhan } from '../src/lib/zaloLichGui'
import { apYeuCauHoaDonGanDay, danhDauLayHoaDonNhom, dsYeuCauHoaDon, ngayVN } from '../src/lib/zaloNhom'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const T = (s: string) => new Date(s)
const NGAY = (s: string) => new Date(Date.parse(`${s}T00:00:00+07:00`))
let soSchema = 0

const NHOM = [
    { id: 'n1', groupId: 'G1', customerId: 'k1', tenNhom: 'Đại lý A', maKhach: 'KA' },
    { id: 'n2', groupId: 'G2', customerId: 'k3', tenNhom: 'Đại lý B', maKhach: 'KB' },
]
const KHACH = [
    { id: 'k1', code: 'KA', name: 'Đại lý A', debt: 60_000, luonLayHoaDon: false },
    { id: 'k2', code: 'KA2', name: 'Đại lý A (mã 2)', debt: 70_000, luonLayHoaDon: false },
    { id: 'k3', code: 'KB', name: 'Đại lý B', debt: 200_000, luonLayHoaDon: false },
]

/** Prisma giả: bảng mã thêm (có/không), các câu SQL của 3 lib tính số, ảnh chụp nợ đầu ngày, tin /hoadon */
function giaSp(o: {
    coBang?: boolean; them?: Array<{ groupId: string; customerId: string; thuTu: number }>
    ban?: any[]; tra?: any[]; mua?: any[]; phieu?: any[]; chup?: Record<string, number> | null
    theoThu?: any[]; mon?: any[]; tin?: any[]; nhom?: any[]; khach?: any[]
} = {}) {
    const st = {
        coBang: !!o.coBang, them: [...(o.them || [])], sql: [] as string[], thamSo: [] as any[][], chay: [] as string[],
        batHoaDon: [] as string[],
    }
    const nhom = o.nhom || NHOM
    const khach = o.khach || KHACH
    const sp: any = {
        __schema: `kiem_nhom_khach_${++soSchema}`,
        $queryRawUnsafe: async (sql: string, ...p: any[]) => {
            st.sql.push(sql); st.thamSo.push(p)
            if (/to_regclass\('"ZaloNhomKhach"'\)/.test(sql)) return [{ co: st.coBang }]
            if (/FROM "ZaloNhomKhach" WHERE "groupId" = ANY/.test(sql)) return st.them.filter(t => p[0].includes(t.groupId)).sort((a, b) => a.thuTu - b.thuTu)
            if (/FROM "ZaloNhomKhach" WHERE "customerId" = ANY/.test(sql)) return st.them.filter(t => p[0].includes(t.customerId))
            if (/FROM "DebtEntry" d/.test(sql)) return (o.phieu || []).filter(r => p[0].includes(r.k))
            if (/EXTRACT\(DOW/.test(sql)) return (o.theoThu || []).filter(r => p[0].includes(r.k))
            if (/array_agg/.test(sql)) return (o.mon || []).filter(r => p[0].includes(r.k))
            if (/FROM "ReturnOrder" r/.test(sql)) return (o.tra || []).filter(r => p[0].includes(r.k))
            if (/JOIN "TransactionItem" ti/.test(sql)) return (o.ban || []).filter(r => p[0].includes(r.k))
            if (/to_regclass\('"NoKhachDauNgay"'\)/.test(sql)) return [{ co: o.chup !== null && o.chup !== undefined }]
            if (/"customerId" = '__xong__'/.test(sql)) return o.chup ? [{ chupLuc: T('2026-10-25T17:01:00Z') }] : []
            if (/SELECT "customerId", "debt" FROM "NoKhachDauNgay"/.test(sql)) return Object.entries(o.chup || {}).filter(([id]) => p[1].includes(id)).map(([customerId, debt]) => ({ customerId, debt }))
            if (/AS tien, COUNT\(\*\)::int AS don/.test(sql)) return (o.mua || []).filter(r => p[0].includes(r.k))
            return []
        },
        $executeRawUnsafe: async (sql: string, ...p: any[]) => {
            st.chay.push(sql)
            if (/CREATE TABLE IF NOT EXISTS "ZaloNhomKhach"/.test(sql)) { st.coBang = true; return 0 }
            if (/CREATE/.test(sql)) return 0
            if (/DELETE FROM "ZaloNhomKhach"/.test(sql)) { const truoc = st.them.length; st.them = st.them.filter(t => t.groupId !== p[0]); return truoc - st.them.length }
            if (/INSERT INTO "ZaloNhomKhach"/.test(sql)) { st.them.push({ groupId: p[0], customerId: p[1], thuTu: p[2] }); return 1 }
            if (/VALUES \(\$1, '__xong__'/.test(sql)) return 1
            if (/INSERT INTO "NoKhachDauNgay"[\s\S]*SELECT/.test(sql)) return 3
            return 0
        },
        category: { findMany: async () => [] },
        zaloNhom: {
            findMany: async ({ where }: any) => nhom.filter((n: any) => where?.groupId ? where.groupId.in.includes(n.groupId) : n.customerId).map((n: any) => ({ ...n })),
            count: async () => nhom.length,
        },
        zaloNhomQuet: { findMany: async () => [] },
        customer: {
            findMany: async ({ where }: any) => where?.luonLayHoaDon ? khach.filter((k: any) => k.luonLayHoaDon) : khach.filter((k: any) => where.id.in.includes(k.id)).map((k: any) => ({ ...k })),
            findUnique: async ({ where }: any) => khach.find((k: any) => k.id === where.id) || null,
        },
        zaloTin: { findMany: async () => (o.tin || []).map(t => ({ ...t })) },
        transaction: {
            findMany: async () => [],
            updateMany: async ({ where }: any) => { st.batHoaDon.push(where.customerId); return { count: 1 } },
            count: async () => 1,
        },
    }
    return { sp, st }
}

async function main() {
    console.log('\n▶ Một nhóm Zalo nối nhiều mã khách\n')

    /* 1 — Hàm thuần: mã của nhóm, cặp gộp, bảng tra */
    {
        ok('1a. Nhóm chưa nối ⇒ không mã nào', khachCuaNhom(null).length === 0 && khachCuaNhom(undefined, ['k2']).length === 1)
        ok('1b. Mã chính đứng đầu, bỏ trùng, bỏ trống', khachCuaNhom('k1', ['k2', 'k1', '', 'k3']).join(',') === 'k1,k2,k3')
        const them = new Map([['G1', ['k2']]])
        const gop = capGopTheoNhom([...NHOM, { groupId: 'G3', customerId: null }, { groupId: 'G4', customerId: 'k1' }], them)
        ok('1c. Cặp gộp: mỗi mã của nhóm → khoá = groupId; nhóm chưa nối không có cặp', gop.map(c => `${c.id}>${c.key}`).join(' ') === 'k1>G1 k2>G1 k3>G2 k1>G4', gop)
        const g = bangGop(gop)
        ok('1d. Mã ở hai nhóm ⇒ hai khoá; khoá ⇒ đủ mã thành viên', g.coGop && g.khoaCua('k1').join(',') === 'G1,G4' && g.idsCua('G1').join(',') === 'k1,k2' && g.khoa.join(',') === 'G1,G2,G4' && g.ids.join(',') === 'k1,k2,k3')
        const kg = bangGop()
        ok('1e. Không cặp gộp ⇒ khoá = chính mã (như cũ)', !kg.coGop && kg.khoaCua('x').join() === 'x' && kg.idsCua('x').join() === 'x' && kg.khoa.length === 0)
        ok('1f. Trần mã một nhóm = 20', TOI_DA_MA === 20)
    }

    /* 2 — Bảng lười mã thêm */
    {
        const { sp, st } = giaSp()
        const rong = await docKhachThem(sp, ['G1'])
        ok('2a. Cửa hàng chưa có bảng ⇒ Map rỗng, chỉ hỏi to_regclass, không SELECT bảng', rong.size === 0 && st.sql.length === 1 && /to_regclass/.test(st.sql[0]!))
        await xoaKhachThem(sp, 'G1')
        ok('2b. Chưa có bảng ⇒ bỏ mã thêm không chạy DELETE', !st.chay.some(s => /DELETE/.test(s)))
        await ghiKhachThem(sp, 'G1', ['k2', 'k3', 'k2'])
        const chen = st.chay.filter(s => /INSERT INTO "ZaloNhomKhach"/.test(s))
        ok('2c. Ghi mã thêm: tạo bảng + xoá cũ + chèn từng mã theo thứ tự (bỏ trùng)', st.coBang && st.chay.some(s => /CREATE TABLE IF NOT EXISTS "ZaloNhomKhach"/.test(s)) && chen.length === 2 && st.them.map(t => `${t.customerId}:${t.thuTu}`).join(',') === 'k2:0,k3:1', st.them)
        const doc = await docKhachThem(sp, ['G1', 'G9'])
        ok('2d. Đọc lại: đúng thứ tự, nhóm không có mã thêm thì không có khoá', doc.get('G1')?.join(',') === 'k2,k3' && !doc.has('G9'))
        ok('2e. Tra ngược: khách là mã thêm của nhóm nào', (await nhomCoKhachThem(sp, ['k3', 'k1'])).get('k3')?.join() === 'G1' && !(await nhomCoKhachThem(sp, ['k1'])).has('k1'))
        ok('2f. Câu con chụp nợ: có bảng ⇒ UNION mã thêm', /UNION SELECT "customerId" FROM "ZaloNhomKhach"/.test(await sqlKhachDangNoi(sp)))
        await ghiKhachThem(sp, 'G1', [])
        ok('2g. Danh sách rỗng = xoá hết mã thêm, không chèn', st.them.length === 0 && (await docKhachThem(sp, ['G1'])).size === 0)
        const khong = giaSp()
        ok('2h. Chưa có bảng ⇒ câu con chụp nợ như cũ (không UNION)', !/UNION/.test(await sqlKhachDangNoi(khong.sp)))
        ok('2i. Prisma giả cũ không có $queryRawUnsafe ⇒ coi như chưa có bảng, không nổ', (await coBangNhomKhach({ __schema: 'x' })) === false && (await docKhachThem({ __schema: 'x' }, ['G1'])).size === 0)
    }

    /* 3 — Doanh số gộp */
    {
        const cfg = { categoryIds: [], tu: '2026-10-01', den: '2026-10-31' }
        const ban = [{ k: 'k1', tien: 1_000_000, sl: 10, don: 2 }, { k: 'k2', tien: 500_000, sl: 5, don: 1 }]
        const tra = [{ k: 'k2', tien: 200_000, sl: 2 }]
        const { sp } = giaSp({ ban, tra })
        const cu = (await tinhDoanhSo(sp, cfg, ['k1', 'k2'])).theoKhach
        ok('3a. Không gộp: từng mã như cũ (k2 đã trừ hàng trả)', cu.get('k1')?.tien === 1_000_000 && cu.get('k2')?.tien === 300_000 && cu.get('k2')?.soLuong === 3, [...cu])
        const gop = [{ id: 'k1', key: 'G1' }, { id: 'k2', key: 'G1' }, { id: 'k1', key: 'G4' }]
        const { sp: sp2, st } = giaSp({ ban, tra })
        const m = (await tinhDoanhSo(sp2, cfg, [], gop)).theoKhach
        ok('3b. Gộp G1 = k1 + k2: tiền, số lượng, số đơn cộng dồn; trả hàng trừ vào nhóm', m.get('G1')?.tien === 1_300_000 && m.get('G1')?.soLuong === 13 && m.get('G1')?.soDon === 3, m.get('G1'))
        ok('3c. k1 còn ở nhóm G4 một mình ⇒ G4 nhận đủ số của k1; không còn khoá theo mã', m.get('G4')?.tien === 1_000_000 && !m.has('k1'))
        ok('3d. Không truyền danh sách mã vẫn hỏi SQL đủ mã trong cặp gộp', st.thamSo.some(p => Array.isArray(p[0]) && p[0].includes('k1') && p[0].includes('k2')))
        const vuot = giaSp({ ban, tra: [{ k: 'k2', tien: 900_000, sl: 9 }] })
        const v = (await tinhDoanhSo(vuot.sp, cfg, [], gop)).theoKhach
        ok('3e. Trả nhiều hơn mua của một mã ⇒ trừ vào tổng nhóm, kẹp ≥ 0', v.get('G1')?.tien === 600_000 && v.get('G1')?.soLuong === 6, v.get('G1'))
    }

    /* 4 — Tổng kết hôm nay gộp */
    {
        const LUC = T('2026-10-26T08:00:00Z')
        const mua = [{ k: 'k1', tien: 10_000_000, don: 2, thu: 3_000_000 }, { k: 'k2', tien: 2_000_000, don: 1, thu: 0 }]
        const phieu = [{ k: 'k2', tien: 2_000_000 }]
        const khach = [{ id: 'k1', debt: 5_000_000 }, { id: 'k2', debt: 1_000_000 }, { id: 'k3', debt: 0 }]
        const gop = [{ id: 'k1', key: 'G1' }, { id: 'k2', key: 'G1' }, { id: 'k3', key: 'G2' }]
        const { sp } = giaSp({ mua, phieu, chup: { k1: 5_000_000, k2: 1_000_000, k3: 0 } })
        const s = (await soNgayCuaKhach(sp, khach, LUC, gop)).theoKhach
        ok('4a. G1 = k1 + k2: mua 12tr (3 đơn), đã trả 5tr, nợ 6tr, nợ đầu ngày 6tr', s.get('G1')?.mua === 12_000_000 && s.get('G1')?.soDon === 3 && s.get('G1')?.daTra === 5_000_000 && s.get('G1')?.noNay === 6_000_000 && s.get('G1')?.noDau === 6_000_000, s.get('G1'))
        ok('4b. G2 (một mã) như cũ; không còn khoá theo mã', s.get('G2')?.mua === 0 && s.get('G2')?.noDau === 0 && !s.has('k1'))
        const thieu = giaSp({ mua, phieu, chup: { k1: 5_000_000, k3: 0 } })   // k2 nối thêm SAU 0 giờ ⇒ không có ảnh chụp
        const t = (await soNgayCuaKhach(thieu.sp, khach, LUC, gop)).theoKhach
        ok('4c. Thiếu ảnh chụp của MỘT mã ⇒ nợ đầu ngày của nhóm = null (không đoán 0), mua / đã trả vẫn đủ', t.get('G1')?.noDau === null && t.get('G1')?.mua === 12_000_000 && t.get('G1')?.daTra === 5_000_000, t.get('G1'))
        const cu = (await soNgayCuaKhach(thieu.sp, khach, LUC)).theoKhach
        ok('4d. Không gộp: Map theo mã như cũ', cu.get('k1')?.mua === 10_000_000 && cu.get('k2')?.daTra === 2_000_000 && cu.get('k2')?.noDau === null)
    }

    /* 5 — Thói quen mua gộp: thứ hay mua đếm chung, nhịp từng món trên lịch sử hợp nhất */
    {
        const theoThu = [{ k: 'k1', thu: 6, so: 3 }, { k: 'k2', thu: 6, so: 2 }]
        // Dầu ăn: k1 mua 01/01 và 02/03, k2 mua 31/01 ⇒ gộp = nhịp 30 ngày; riêng k1 = nhịp 60 ngày (chưa tới lượt ngày 29/03)
        const mon = [
            { k: 'k1', p: 'p1', ten: 'Dầu ăn', sku: null, dv: 'chai', ngay: ['2026-01-01', '2026-03-02'], sl: 4 },
            { k: 'k2', p: 'p1', ten: 'Dầu ăn', sku: null, dv: 'chai', ngay: ['2026-01-31'], sl: 2 },
        ]
        const luc = NGAY('2026-03-29')
        const gop = [{ id: 'k1', key: 'G1' }, { id: 'k2', key: 'G1' }]
        const { sp } = giaSp({ theoThu, mon })
        const g = (await thoiQuenMuaCuaKhach(sp, [], { luc, gop })).get('G1')!
        ok('5a. Thứ hay mua: 3 + 2 phiếu thứ Bảy ⇒ RÕ (riêng từng mã chưa đủ 4 phiếu)', g.thu.ro && g.thu.dinh.join() === '6' && g.thu.tong === 5, g.thu)
        ok('5b. Món mua xen kẽ hai mã ⇒ nhịp 30 ngày, qua 27 ngày = tới lượt; 3 lần, thường lấy 2 chai', g.mon.length === 1 && g.mon[0]!.nhipNgay === 30 && g.mon[0]!.quaNgay === 27 && g.mon[0]!.soLan === 3 && g.mon[0]!.slMoiLan === 2 && g.mon[0]!.donVi === 'chai', g.mon)
        const rieng = await thoiQuenMuaCuaKhach(sp, ['k1', 'k2'], { luc })
        ok('5c. Không gộp: k1 một mình chưa rõ thứ, chưa món nào tới lượt (như cũ)', !rieng.get('k1')!.thu.ro && rieng.get('k1')!.mon.length === 0 && rieng.get('k2')!.mon.length === 0)
    }

    /* 6 — Soạn người nhận của lịch gửi: nhóm G1 = k1 (chính) + k2 (thêm), G2 = k3 */
    {
        const them = [{ groupId: 'G1', customerId: 'k2', thuTu: 0 }]
        const luc = T('2026-10-30T10:00:00Z')   // 17:00 VN thứ Sáu ⇒ mai thứ Bảy
        const { sp } = giaSp({ coBang: true, them })
        const no = await soanNguoiNhan(sp, { noiDung: 'Nợ {congNo}', doiTuong: { loai: 'tat_ca', groupIds: [], chiKhachCoNo: true, noToiThieu: 100_000 } as any, doanhSo: null }, luc)
        const d1 = no.dong.find(d => d.groupId === 'G1')!
        ok('6a. Nợ nhóm = 60k + 70k = 130k ⇒ qua mức 100k (riêng mã chính 60k thì bị bỏ); tên / mã trong tin vẫn của mã chính', !!d1 && d1.no === 130_000 && d1.bien?.congNo === '130.000đ' && d1.maKhach === 'KA' && d1.tenKhach === 'Đại lý A' && d1.soMaThem === 1 && no.boKhongNo === 0, no.dong)
        ok('6b. Nhóm một mã: soMaThem = 0, nợ như cũ', no.dong.find(d => d.groupId === 'G2')?.no === 200_000 && no.dong.find(d => d.groupId === 'G2')?.soMaThem === 0)

        const nhac = giaSp({
            coBang: true, them,
            theoThu: [{ k: 'k1', thu: 6, so: 3 }, { k: 'k2', thu: 6, so: 2 }],
            mon: [{ k: 'k1', p: 'p1', ten: 'Dầu ăn', sku: null, dv: 'chai', ngay: ['2026-08-01', '2026-09-30'], sl: 4 }, { k: 'k2', p: 'p1', ten: 'Dầu ăn', sku: null, dv: 'chai', ngay: ['2026-08-31'], sl: 2 }],
        })
        const n = await soanNguoiNhan(nhac.sp, { noiDung: 'Mai {thuHayMua}:\n{hangLauKhongMua}', doiTuong: { loai: 'tat_ca', groupIds: [], chiKhachCoNo: false, noToiThieu: 0, chiKhachMaiHayMua: true } as any, doanhSo: null }, luc)
        ok('6c. Nhắc mua lại: G1 nhận tin nhờ phiếu hai mã cộng dồn, món nhịp gộp; G2 không tới lượt', n.dong.length === 1 && n.dong[0]!.groupId === 'G1' && n.dong[0]!.bien?.thuHayMua === 'Thứ Bảy' && n.dong[0]!.bien?.hangLauKhongMua === '1. Dầu ăn – đã 30 ngày' && n.boKhongDenLuot === 1, n.dong)

        const ngay = giaSp({ coBang: true, them, mua: [{ k: 'k1', tien: 1_000_000, don: 1, thu: 0 }, { k: 'k2', tien: 500_000, don: 1, thu: 500_000 }] })
        const h = await soanNguoiNhan(ngay.sp, { noiDung: 'Mua {muaHomNay} ({soDonHomNay} đơn), trả {daTraHomNay}', doiTuong: { loai: 'tat_ca', groupIds: [], chiKhachCoNo: false, noToiThieu: 0, chiKhachCoGiaoDich: true } as any, doanhSo: null }, luc)
        ok('6d. Tổng kết hôm nay: G1 = 1,5tr / 2 đơn / đã trả 500k; G2 không giao dịch bị bỏ', h.dong.length === 1 && h.dong[0]!.bien?.muaHomNay === '1.500.000đ' && h.dong[0]!.bien?.soDonHomNay === '2' && h.dong[0]!.bien?.daTraHomNay === '500.000đ' && h.boKhongGiaoDich === 1, h.dong)

        const chon = giaSp({ coBang: true, them, ban: [{ k: 'k1', tien: 1_000_000, sl: 1, don: 1 }, { k: 'k2', tien: 250_000, sl: 1, don: 1 }] })
        const ds = await soanNguoiNhan(chon.sp, { noiDung: 'Doanh số {doanhSo}', doiTuong: { loai: 'chon', groupIds: ['G1'], chiKhachCoNo: false, noToiThieu: 0 } as any, doanhSo: { ky: 'thang_nay', categoryIds: [], chiKhachCoDoanhSo: true } as any }, luc)
        ok('6e. Doanh số theo lịch: nhóm chọn tay G1 = 1,25tr (hai mã)', ds.dong.length === 1 && ds.dong[0]!.bien?.doanhSo === '1.250.000đ', ds.dong)
    }

    /* 7 — "/hoadon": bật Lấy HĐ cho phiếu của MỌI mã trong nhóm */
    {
        const them = [{ groupId: 'G1', customerId: 'k2', thuTu: 0 }]
        const bayGio = new Date()
        const { sp, st } = giaSp({ coBang: true, them, tin: [{ id: 't1', customerId: 'k1', groupId: 'G1', thoiDiem: bayGio, nguoiGui: 'Anh A', noiDung: '/hoadon' }] })
        const kq = await apYeuCauHoaDonGanDay(sp)
        ok('7a. Nhịp 5 phút: tin của nhóm hai mã ⇒ bật cho cả k1 lẫn k2 (2 cặp khách|ngày)', kq.soKhachNgay === 2 && kq.daBat === 2 && st.batHoaDon.join(',') === 'k1,k2', { kq, bat: st.batHoaDon })
        const mot = await danhDauLayHoaDonNhom(sp, 'G1', 'k1', ngayVN(bayGio))
        ok('7b. Lúc nhận tin: bật cho 2 mã, đếm phiếu cộng dồn', mot.soMa === 2 && mot.daBat === 2 && mot.tongPhieu === 2, mot)
        const ds = await dsYeuCauHoaDon(sp, ngayVN(bayGio))
        ok('7c. Danh sách yêu cầu HĐ trong ngày: cả hai mã, cùng một tin', ds.soKhach === 2 && ds.khachHang.map((x: any) => x.khach.id).join(',') === 'k1,k2' && ds.khachHang.every((x: any) => x.yeuCau[0].tinId === 't1'), ds.khachHang)
        const rieng = giaSp({ tin: [{ id: 't1', customerId: 'k3', groupId: 'G2', thoiDiem: bayGio, noiDung: '/hoadon' }] })
        const r = await apYeuCauHoaDonGanDay(rieng.sp)
        ok('7d. Nhóm một mã như cũ: một cặp, một lần bật', r.soKhachNgay === 1 && rieng.st.batHoaDon.join(',') === 'k3')
    }

    /* 8 — Chụp nợ đầu ngày gồm mã thêm */
    {
        const co = giaSp({ coBang: true, them: [{ groupId: 'G1', customerId: 'k2', thuTu: 0 }] })
        const r = await chupNoDauNgay(co.sp, T('2026-10-25T17:02:00Z'))   // 00:02 VN
        const chen = co.st.chay.find(s => /INSERT INTO "NoKhachDauNgay"[\s\S]*SELECT/.test(s)) || ''
        ok('8a. Có bảng mã thêm ⇒ câu chụp UNION mã thêm', /chup 3/.test(r) && /UNION SELECT "customerId" FROM "ZaloNhomKhach"/.test(chen), chen)
        const khong = giaSp()
        await chupNoDauNgay(khong.sp, T('2026-10-25T17:02:00Z'))
        const chenCu = khong.st.chay.find(s => /INSERT INTO "NoKhachDauNgay"[\s\S]*SELECT/.test(s)) || ''
        ok('8b. Chưa có bảng ⇒ câu chụp như cũ', chenCu.length > 0 && !/UNION/.test(chenCu))
    }

    console.log(`\n${hong ? '✗' : '✓'} ${dat} đạt, ${hong} hỏng\n`)
    process.exit(hong ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
