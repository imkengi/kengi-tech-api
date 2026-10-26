/**
 * Kiểm GỬI ĐỊNH KỲ QUA ZALO — npx tsx scripts/check-zalo-lich-gui.ts
 *
 * Chủ shop 26/10/2026: "chưa có mấy cái như gửi công nợ định kỳ theo ngày hoặc theo tháng á".
 * Lõi ở lib/zaloLichGui.ts. Sai ở đây là: nhắc nợ lệch giờ / lệch ngày (múi giờ, tháng 30 ngày, tháng 2),
 * gửi số nợ CŨ khi KiotViet ngừng đồng bộ, gửi hai đợt chồng nhau, hai bản máy cùng gửi một lượt,
 * hay gửi trễ 12 tiếng — nên mỗi thứ một ca. Prisma giả, không gọi Zalo / KiotViet thật.
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'ab'.repeat(32)

import fs from 'fs'
import path from 'path'
import {
    tinhLanToi, lanDau, docTanSuat, moTaTanSuat, kyTuongDoi, docDoiTuong, docDuLieuLich, bienCongNo, gioVN,
    kiemSoNoTuoi, soanNguoiNhan, chayLich, nhipLichGui, type LichGui, type TanSuat,
} from '../src/lib/zaloLichGui'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const iso = (d: Date) => d.toISOString()
const T = (s: string) => new Date(s)

// ─── Prisma giả ─────────────────────────────────────────────────────────────
let soSchema = 0
function giaSp(o: {
    nhom?: any[]; khach?: any[]; quet?: any[]; kv?: any; doiChieu?: Date | null; webhook?: Date | null
    phien?: 'song' | 'het_han' | null; lich?: any[]; dangCho?: Record<string, number>
} = {}) {
    const st = {
        lich: (o.lich || []).map(l => ({ ...l })), dot: [] as any[], dong: [] as any[], thongBao: [] as any[],
        tuyChon: [] as any[], sql: [] as string[],
    }
    const phien = o.phien === undefined ? 'song' : o.phien
    const sp: any = {
        __schema: `kiem_lich_${++soSchema}`,
        $executeRawUnsafe: async (sql: string, ...p: any[]) => {
            st.sql.push(sql)
            if (/CREATE TABLE/.test(sql)) return 0
            if (/INSERT INTO "ZaloDotTuyChon"/.test(sql)) { st.tuyChon.push({ dotId: p[0], tuyChon: JSON.parse(p[1]) }); return 1 }
            if (/UPDATE "ZaloLichGui" SET "lanToi" = \$2::timestamp\(3\), "updatedAt" = now\(\) WHERE "id" = \$1 AND "lanToi" = \$3/.test(sql)) {
                const l = st.lich.find(x => x.id === p[0])
                if (l && new Date(l.lanToi + 'Z').toISOString() === new Date(p[2] + 'Z').toISOString()) { l.lanToi = p[1]; return 1 }
                return 0
            }
            if (/UPDATE "ZaloLichGui" SET "lanCuoi"/.test(sql)) {
                const l = st.lich.find(x => x.id === p[0]); if (!l) return 0
                l.lanCuoi = p[1]; l.lanCuoiKetQua = p[2]; if (p[3]) l.lanCuoiDotId = p[3]; return 1
            }
            return 0
        },
        $queryRawUnsafe: async (sql: string, ...p: any[]) => {
            if (/to_regclass\('"ZaloLichGui"'\)/.test(sql)) return [{ co: true }]
            if (/to_regclass/.test(sql)) return [{ co: true }]
            if (/FROM "ZaloPhien"/.test(sql)) return phien ? [{ id: 'default', duLieu: 'x', phienSo: 'p', trangThai: phien, uid: '1', ten: 'T', anh: null, loiCuoi: null, nguoiDangNhap: null, dangNhapLuc: new Date(), dungLuc: null, giuLuc: null }] : []
            if (/FROM "ZaloLichGui" WHERE "bat" = true/.test(sql)) {
                const now = Date.now()
                return st.lich.filter(l => l.bat && l.lanToi && Date.parse(l.lanToi + 'Z') <= now).map(l => ({ ...l, lanToi: new Date(l.lanToi + 'Z') }))
            }
            if (/FROM "ZaloLichGui" WHERE "id" = \$1/.test(sql)) return st.lich.filter(l => l.id === p[0]).map(l => ({ ...l }))
            return []
        },
        zaloNhom: { findMany: async ({ where }: any) => (o.nhom || []).filter((n: any) => where.groupId ? where.groupId.in.includes(n.groupId) : n.customerId) },
        zaloNhomQuet: { findMany: async ({ where }: any) => (o.quet || []).filter((q: any) => where.groupId.in.includes(q.groupId)) },
        customer: { findMany: async ({ where }: any) => (o.khach || []).filter((k: any) => where.id.in.includes(k.id)) },
        zaloCauHinh: { findUnique: async () => ({ n8nGuiUrl: null, guiMoiPhut: 4 }) },
        zaloDotGui: { create: async ({ data }: any) => { const d = { id: `dot${st.dot.length + 1}`, ...data }; st.dot.push(d); return d } },
        zaloDotGuiNhom: {
            createMany: async ({ data }: any) => { st.dong.push(...data); return { count: data.length } },
            count: async ({ where }: any) => (o.dangCho || {})[where.dotId] || 0,
        },
        kiotVietConfig: { findUnique: async () => o.kv ?? null },
        kiotVietSyncLog: {
            findFirst: async ({ where }: any) => {
                if (where.entity === 'doi-chieu-no') return o.doiChieu ? { startedAt: o.doiChieu } : null
                if (where.mode === 'webhook') return o.webhook ? { startedAt: o.webhook } : null
                return null
            },
        },
        notification: {
            findFirst: async ({ where }: any) => st.thongBao.find(t => String(t.message).includes(where?.message?.contains)) || null,
            create: async ({ data }: any) => { st.thongBao.push(data); return { id: `tb${st.thongBao.length}` } },
        },
    }
    return { sp, st }
}

const lichMau = (x: Partial<LichGui> = {}): LichGui => ({
    id: 'lich-1111-2222', ten: 'Nhắc công nợ đầu tháng', noiDung: 'Chào {tenKhach}, nợ tới {ngayChot}: [đậm]{congNo}[/đậm]', anh: [],
    tuyChon: { mucDo: 1, nhacCaNhom: false, tuXoa: 0, henGio: null },
    doiTuong: { loai: 'tat_ca', groupIds: [], chiKhachCoNo: true, noToiThieu: 100_000 },
    doanhSo: null, tanSuat: { loai: 'thang', gio: '08:00', ngay: 1 },
    bat: true, lanToi: null, lanCuoi: null, lanCuoiDotId: null, lanCuoiKetQua: null, nguoiTao: null, createdAt: '', updatedAt: '', ...x,
})
const NHOM = [
    { groupId: '1000000001', customerId: 'k1', tenNhom: 'TS002 Trãi Thu' },
    { groupId: '1000000002', customerId: 'k2', tenNhom: 'TP051 Phú' },
    { groupId: '1000000003', customerId: 'k3', tenNhom: 'HN73 Phúc Hải' },
]
const KHACH = [
    { id: 'k1', code: 'TS002', name: 'Trãi Thu', debt: 12_125_955 },
    { id: 'k2', code: 'TP051', name: 'Phú', debt: 50_000 },     // dưới mức 100.000đ
    { id: 'k3', code: 'HN73', name: 'Phúc Hải', debt: 0 },
]

async function main() {
    console.log('\n▶ Gửi định kỳ qua Zalo — lịch, công nợ, an toàn\n')

    /* 1 — Giờ chạy kế tiếp (giờ VN) */
    {
        const ngay: TanSuat = { loai: 'ngay', gio: '08:00' }
        ok('1a. Hằng ngày 08:00, lúc 07:30 VN ⇒ 08:00 HÔM NAY', iso(tinhLanToi(ngay, T('2026-10-26T00:30:00Z'))) === '2026-10-26T01:00:00.000Z')
        ok('1b. Đúng 08:00 ⇒ sang mai (lớn hơn hẳn, không chạy hai lần)', iso(tinhLanToi(ngay, T('2026-10-26T01:00:00Z'))) === '2026-10-27T01:00:00.000Z')
        ok('1c. 03:00 VN ngày 27 (vẫn là 20:00Z ngày 26) ⇒ 08:00 VN ngày 27', iso(tinhLanToi(ngay, T('2026-10-26T20:00:00Z'))) === '2026-10-27T01:00:00.000Z')
        ok('1d. 00:30 VN — qua nửa đêm VN trước nửa đêm UTC', iso(tinhLanToi({ loai: 'ngay', gio: '00:30' }, T('2026-10-26T17:20:00Z'))) === '2026-10-26T17:30:00.000Z')
        ok('1e. Thứ Hai 08:00, sáng thứ Hai 07:30 ⇒ hôm nay', iso(tinhLanToi({ loai: 'tuan', gio: '08:00', thu: 1 }, T('2026-10-26T00:30:00Z'))) === '2026-10-26T01:00:00.000Z')
        ok('1f. Thứ Hai 08:00, thứ Hai 09:00 ⇒ thứ Hai tuần sau', iso(tinhLanToi({ loai: 'tuan', gio: '08:00', thu: 1 }, T('2026-10-26T02:00:00Z'))) === '2026-11-02T01:00:00.000Z')
        ok('1g. Chủ Nhật 20:00 ⇒ CN 01/11 20:00 VN', iso(tinhLanToi({ loai: 'tuan', gio: '20:00', thu: 7 }, T('2026-10-26T02:00:00Z'))) === '2026-11-01T13:00:00.000Z')
        ok('1h. Ngày 31 hằng tháng, tháng 11 (30 ngày) ⇒ 30/11', iso(tinhLanToi({ loai: 'thang', gio: '08:00', ngay: 31 }, T('2026-11-05T00:00:00Z'))) === '2026-11-30T01:00:00.000Z')
        ok('1i. Cuối tháng, tháng 2/2027 ⇒ 28/02', iso(tinhLanToi({ loai: 'thang', gio: '08:00', ngay: 0 }, T('2027-02-10T00:00:00Z'))) === '2027-02-28T01:00:00.000Z')
        ok('1j. Mùng 1, lúc 06:30 VN ngày 1/11 (vẫn 31/10 UTC) ⇒ 08:00 VN 1/11', iso(tinhLanToi({ loai: 'thang', gio: '08:00', ngay: 1 }, T('2026-10-31T23:30:00Z'))) === '2026-11-01T01:00:00.000Z')
        ok('1k. Qua năm: ngày 15 từ 20/12/2026 ⇒ 15/01/2027', iso(tinhLanToi({ loai: 'thang', gio: '09:15', ngay: 15 }, T('2026-12-20T00:00:00Z'))) === '2027-01-15T02:15:00.000Z')
        ok('1l. Mô tả dễ đọc', moTaTanSuat({ loai: 'thang', gio: '08:00', ngay: 0 }) === 'Ngày cuối hằng tháng lúc 08:00' && moTaTanSuat({ loai: 'tuan', gio: '07:30', thu: 1 }) === 'Thứ Hai hằng tuần lúc 07:30')
        ok('1m. gioVN đổi đúng múi giờ', gioVN(T('2026-10-31T23:30:00Z')) === '06:30 01/11/2026')
        // "Bắt đầu từ" (tab Gửi tin: hẹn giờ + lặp lại) — lần đầu không sớm hơn giờ hẹn
        const sang = T('2026-10-26T00:30:00Z')   // 07:30 VN thứ Hai 26/10
        ok('1n. Hằng ngày 08:00, hẹn bắt đầu 08:00 MAI ⇒ lần đầu 08:00 mai (không phải 08:00 hôm nay)',
            iso(lanDau(ngay, T('2026-10-27T01:00:00Z'), sang)) === '2026-10-27T01:00:00.000Z')
        ok('1o. Hẹn bắt đầu đúng 08:00 hôm nay ⇒ chạy luôn 08:00 hôm nay', iso(lanDau(ngay, T('2026-10-26T01:00:00Z'), sang)) === '2026-10-26T01:00:00.000Z')
        ok('1p. Mốc bắt đầu đã qua ⇒ như không hẹn', iso(lanDau(ngay, T('2026-10-20T01:00:00Z'), sang)) === '2026-10-26T01:00:00.000Z')
        ok('1q. Ngày 1 hằng tháng, bắt đầu từ 10/11 ⇒ 01/12', iso(lanDau({ loai: 'thang', gio: '08:00', ngay: 1 }, T('2026-11-10T01:00:00Z'), sang)) === '2026-12-01T01:00:00.000Z')
    }

    /* 2 — Kiểm dữ liệu */
    {
        ok('2a. Giờ 25:00 / thiếu thứ / ngày 32 ⇒ lỗi', typeof docTanSuat({ loai: 'ngay', gio: '25:00' }) === 'string' && typeof docTanSuat({ loai: 'tuan', gio: '08:00' }) === 'string' && typeof docTanSuat({ loai: 'thang', gio: '08:00', ngay: 32 }) === 'string')
        const tc = docTanSuat({ loai: 'thang', gio: '08:00', ngay: 0 })
        ok('2b. Cuối tháng (ngay 0) hợp lệ', typeof tc === 'object' && tc.ngay === 0)
        ok('2c. "Chọn nhóm" mà không chọn nhóm nào ⇒ lỗi', typeof docDoiTuong({ loai: 'chon', groupIds: [] }) === 'string')
        const dt = docDoiTuong({ loai: 'tat_ca', groupIds: ['1234567'], chiKhachCoNo: true, noToiThieu: -5 })
        ok('2d. "Tất cả" bỏ groupIds, mức nợ âm ⇒ 0', typeof dt === 'object' && dt.groupIds.length === 0 && dt.noToiThieu === 0 && dt.chiKhachCoNo, dt)
        ok('2e. Tin có {doanhSo} mà không chọn kỳ ⇒ lỗi', typeof docDuLieuLich({ ten: 'x', noiDung: 'DS {doanhSo}', doiTuong: { loai: 'tat_ca' }, tanSuat: { loai: 'ngay', gio: '08:00' } }) === 'string')
        ok('2f. Không tên / tin trống ⇒ lỗi', typeof docDuLieuLich({ noiDung: 'x', doiTuong: { loai: 'tat_ca' }, tanSuat: { loai: 'ngay', gio: '08:00' } }) === 'string'
            && typeof docDuLieuLich({ ten: 'x', noiDung: ' ', doiTuong: { loai: 'tat_ca' }, tanSuat: { loai: 'ngay', gio: '08:00' } }) === 'string')
        const b = bienCongNo(12_125_955, T('2026-11-01T01:00:00Z'))
        ok('2g. {congNo} 12.125.955đ, {ngayChot} giờ VN', b.congNo === '12.125.955đ' && b.ngayChot === '08:00 01/11/2026', b)
        ok('2h. Nợ âm (trả dư) không hiện số âm', bienCongNo(-2_300_000, new Date()).congNo === '0đ')
    }

    /* 3 — Kỳ doanh số tương đối */
    {
        const sang1 = T('2026-11-01T01:00:00Z')   // CN 08:00 VN 01/11
        ok('3a. Hôm qua (sáng 1/11) ⇒ 31/10', JSON.stringify(kyTuongDoi('hom_qua', sang1)) === JSON.stringify({ tu: '2026-10-31', den: '2026-10-31' }))
        ok('3b. Tháng trước ⇒ cả tháng 10', JSON.stringify(kyTuongDoi('thang_truoc', sang1)) === JSON.stringify({ tu: '2026-10-01', den: '2026-10-31' }))
        ok('3c. Tháng này (mùng 1) ⇒ đúng ngày 1', JSON.stringify(kyTuongDoi('thang_nay', sang1)) === JSON.stringify({ tu: '2026-11-01', den: '2026-11-01' }))
        ok('3d. Tuần trước (CN 1/11) ⇒ T2 19/10 – CN 25/10', JSON.stringify(kyTuongDoi('tuan_truoc', sang1)) === JSON.stringify({ tu: '2026-10-19', den: '2026-10-25' }))
        ok('3e. Tuần trước (T2 2/11) ⇒ T2 26/10 – CN 1/11', JSON.stringify(kyTuongDoi('tuan_truoc', T('2026-11-02T01:00:00Z'))) === JSON.stringify({ tu: '2026-10-26', den: '2026-11-01' }))
        ok('3f. 01:00 VN 1/11 (18:00Z 31/10): hôm qua vẫn là 31/10', JSON.stringify(kyTuongDoi('hom_qua', T('2026-10-31T18:00:00Z'))) === JSON.stringify({ tu: '2026-10-31', den: '2026-10-31' }))
    }

    /* 4 — Số nợ còn mới không */
    {
        const bay = T('2026-10-26T07:00:00Z')
        ok('4a. Không nối KiotViet ⇒ Kengi là sổ, luôn được', (await kiemSoNoTuoi(giaSp().sp, bay)).ok)
        let t = await kiemSoNoTuoi(giaSp({ kv: { enabled: true }, doiChieu: T('2026-10-24T04:00:00Z'), webhook: T('2026-10-26T06:00:00Z') }).sp, bay)
        ok('4b. Đối chiếu KiotViet cách 51 giờ ⇒ CHẶN, nói rõ lần cuối', !t.ok && /48 giờ/.test(t.lyDo || '') && /lần cuối/.test(t.lyDo || ''), t)
        t = await kiemSoNoTuoi(giaSp({ kv: { enabled: true }, doiChieu: T('2026-10-25T11:40:00Z'), webhook: T('2026-10-25T05:00:00Z') }).sp, bay)
        ok('4c. Đối chiếu mới nhưng webhook im 26 giờ ⇒ CHẶN', !t.ok && /webhook/.test(t.lyDo || ''), t)
        t = await kiemSoNoTuoi(giaSp({ kv: { enabled: true }, doiChieu: T('2026-10-25T11:40:00Z'), webhook: T('2026-10-26T06:59:00Z') }).sp, bay)
        ok('4d. Đúng số đo 26/10 (đối chiếu 19 giờ trước, webhook 1 phút trước) ⇒ được', t.ok, t)
        ok('4e. KiotViet tắt (enabled=false) ⇒ không xét', (await kiemSoNoTuoi(giaSp({ kv: { enabled: false } }).sp, bay)).ok)
    }

    /* 5 — Ai nhận */
    {
        const luc = T('2026-11-01T01:00:00Z')
        let { sp } = giaSp({ nhom: NHOM, khach: KHACH })
        let s = await soanNguoiNhan(sp, lichMau(), luc)
        ok('5a. Chỉ khách nợ ≥ 100.000đ: 1 nhóm, bỏ 2 (nợ 50k, nợ 0)', s.dong.length === 1 && s.dong[0].groupId === '1000000001' && s.boKhongNo === 2, s)
        ok('5b. …biến công nợ CHỐT đúng của khách đó', s.dong[0].bien?.congNo === '12.125.955đ' && s.dong[0].bien?.ngayChot === '08:00 01/11/2026', s.dong[0].bien)
        s = await soanNguoiNhan(sp, lichMau({ doiTuong: { loai: 'tat_ca', groupIds: [], chiKhachCoNo: false, noToiThieu: 0 } }), luc)
        ok('5c. Không lọc nợ ⇒ cả 3 nhóm, khách nợ 0 nhận "0đ"', s.dong.length === 3 && s.dong.find(d => d.groupId === '1000000003')?.bien?.congNo === '0đ', s.dong.map(d => d.bien))
        ;({ sp } = giaSp({ nhom: NHOM, khach: KHACH, quet: [{ groupId: '9000000009', tenNhom: 'Nhóm lạ' }] }))
        s = await soanNguoiNhan(sp, lichMau({ doiTuong: { loai: 'chon', groupIds: ['1000000001', '9000000009'], chiKhachCoNo: false, noToiThieu: 0 } }), luc)
        ok('5d. Chọn nhóm chưa nối khách + tin cần số nợ ⇒ bỏ nhóm đó (boChuaNoi)', s.dong.length === 1 && s.boChuaNoi === 1, s)
        s = await soanNguoiNhan(sp, lichMau({ noiDung: 'Chúc mừng năm mới!', doiTuong: { loai: 'chon', groupIds: ['1000000001', '9000000009'], chiKhachCoNo: false, noToiThieu: 0 } }), luc)
        ok('5e. Tin thường (không biến của khách) ⇒ nhóm chưa nối vẫn nhận', s.dong.length === 2 && s.dong.some(d => d.groupId === '9000000009' && d.tenNhom === 'Nhóm lạ'), s.dong)
    }

    /* 6 — Chạy một lượt */
    {
        const luc = T('2026-11-01T01:00:00Z')
        let g = giaSp({ nhom: NHOM, khach: KHACH, lich: [{ id: 'lich-1111-2222', lanCuoiDotId: 'dotCu' }], dangCho: { dotCu: 5 } })
        let kq = await chayLich(g.sp, lichMau({ lanCuoiDotId: 'dotCu' }), { bayGio: luc })
        ok('6a. Lượt trước còn 5 nhóm chưa gửi ⇒ bỏ lượt, không tạo đợt chồng', kq.boQua && !g.st.dot.length && /chưa gửi xong/.test(kq.ketQua), kq)
        ok('6b. …và báo chuông (lượt tự động)', g.st.thongBao.length === 1 && /Nhắc công nợ đầu tháng/.test(g.st.thongBao[0].title), g.st.thongBao)

        g = giaSp({ nhom: NHOM, khach: KHACH, phien: null, lich: [{ id: 'lich-1111-2222' }] })
        kq = await chayLich(g.sp, lichMau(), { bayGio: luc })
        ok('6c. Chưa có cách gửi (không phiên, không n8n) ⇒ bỏ + báo', kq.boQua && !g.st.dot.length && g.st.thongBao.length === 1, kq)

        const cu = { kv: { enabled: true }, doiChieu: T('2026-10-29T00:00:00Z'), webhook: T('2026-11-01T00:59:00Z') }
        g = giaSp({ nhom: NHOM, khach: KHACH, lich: [{ id: 'lich-1111-2222' }], ...cu })
        kq = await chayLich(g.sp, lichMau(), { bayGio: luc })
        ok('6d. Tự động + số nợ KiotViet cũ (đối chiếu 73 giờ trước) ⇒ KHÔNG gửi + báo', kq.boQua && !g.st.dot.length && g.st.thongBao.length === 1 && /48 giờ/.test(kq.ketQua), kq)
        g = giaSp({ nhom: NHOM, khach: KHACH, lich: [{ id: 'lich-1111-2222' }], ...cu })
        kq = await chayLich(g.sp, lichMau(), { bayGio: luc, thuCong: true })
        ok('6e. Bấm "Chạy ngay" khi số cũ ⇒ hỏi xác nhận (canXacNhan), chưa gửi, không báo chuông', !!kq.canXacNhan && !g.st.dot.length && !g.st.thongBao.length, kq)
        kq = await chayLich(g.sp, lichMau(), { bayGio: luc, thuCong: true, boQuaKiemTraNo: true })
        ok('6f. …người bấm xác nhận ⇒ tạo đợt', !kq.boQua && g.st.dot.length === 1 && kq.soNhom === 1, kq)

        g = giaSp({ nhom: NHOM, khach: KHACH, lich: [{ id: 'lich-1111-2222' }] })
        kq = await chayLich(g.sp, lichMau(), { bayGio: luc })
        const d = g.st.dot[0]
        ok('6g. Tạo đợt: đánh dấu "lich:<id>", tiêu đề kèm ngày', d?.nguoiTao === 'lich:lich-1111-2222' && /Nhắc công nợ đầu tháng — 08:00 01\/11/.test(d?.tieuDe || ''), d)
        ok('6h. Hàng chờ mang biến công nợ đã chốt', g.st.dong.length === 1 && JSON.parse(g.st.dong[0].bien).congNo === '12.125.955đ', g.st.dong)
        ok('6i. Tuỳ chọn (Quan trọng) ghi TRƯỚC hàng chờ', g.st.tuyChon.length === 1 && g.st.tuyChon[0].tuyChon.mucDo === 1
            && g.st.sql.findIndex(s => /INSERT INTO "ZaloDotTuyChon"/.test(s)) >= 0, g.st.tuyChon)
        ok('6j. Ghi kết quả + đợt cuối vào lịch', /Đã xếp 1 nhóm/.test(g.st.lich[0].lanCuoiKetQua || '') && g.st.lich[0].lanCuoiDotId === 'dot1', g.st.lich[0])

        g = giaSp({ nhom: NHOM, khach: KHACH.map(k => ({ ...k, debt: 0 })), lich: [{ id: 'lich-1111-2222' }] })
        kq = await chayLich(g.sp, lichMau(), { bayGio: luc })
        ok('6k. Không ai còn nợ ⇒ không tạo đợt rỗng, KHÔNG báo chuông (bình thường)', kq.boQua && !g.st.dot.length && !g.st.thongBao.length && /Không có nhóm nào/.test(kq.ketQua), kq)
    }

    /* 7 — Nhịp mỗi phút */
    {
        const now = new Date()
        const truoc = (ms: number) => new Date(now.getTime() - ms).toISOString().replace('Z', '')
        const dongLich = (x: any) => ({
            id: 'lich-aaaa', ten: 'Nhắc nợ', noiDung: 'Nợ {congNo}', anh: '[]', tuyChon: '{"mucDo":0}',
            doiTuong: JSON.stringify({ loai: 'tat_ca', groupIds: [], chiKhachCoNo: true, noToiThieu: 0 }), doanhSo: null,
            tanSuat: JSON.stringify({ loai: 'ngay', gio: '08:00' }), bat: true, lanCuoiDotId: null, ...x,
        })
        let g = giaSp({ nhom: NHOM, khach: KHACH, lich: [dongLich({ lanToi: truoc(60_000) })] })
        let ra = await nhipLichGui(g.sp, now)
        ok('7a. Tới giờ ⇒ giành lượt, tạo đợt, đẩy lanToi sang lượt kế', g.st.dot.length === 1 && Date.parse(g.st.lich[0].lanToi + 'Z') > now.getTime() && /\+/.test(ra), { ra, lanToi: g.st.lich[0].lanToi })
        ra = await nhipLichGui(g.sp, now)
        ok('7b. Nhịp sau trong cùng phút ⇒ không chạy lại', g.st.dot.length === 1, ra)

        g = giaSp({ nhom: NHOM, khach: KHACH, lich: [dongLich({ lanToi: truoc(5 * 3600_000) })] })
        ra = await nhipLichGui(g.sp, now)
        ok('7c. Trễ 5 giờ ⇒ "lỡ lượt", không gửi, có báo chuông', !g.st.dot.length && /lo-luot/.test(ra) && /Lỡ lượt/.test(g.st.lich[0].lanCuoiKetQua || '') && g.st.thongBao.length === 1, { ra, kq: g.st.lich[0].lanCuoiKetQua })

        g = giaSp({ nhom: NHOM, khach: KHACH, lich: [dongLich({ lanToi: truoc(60_000) })] })
        const goc = g.sp.$executeRawUnsafe
        g.sp.$executeRawUnsafe = async (sql: string, ...p: any[]) => (/AND "lanToi" = \$3/.test(sql) ? 0 : goc(sql, ...p))   // bản máy khác giành trước
        ra = await nhipLichGui(g.sp, now)
        ok('7d. Bản máy khác đã giành lượt ⇒ bản này bỏ qua, không tạo đợt', !g.st.dot.length && ra === '', ra)

        g = giaSp({ nhom: NHOM, khach: KHACH, lich: [dongLich({ lanToi: truoc(60_000), bat: false })] })
        ra = await nhipLichGui(g.sp, now)
        ok('7e. Lịch đang tắt ⇒ không chạy', !g.st.dot.length && ra === '')
    }

    /* 8 — Soát nối dây */
    {
        const goc = path.join(__dirname, '..', 'src')
        const gui = fs.readFileSync(path.join(goc, 'lib', 'zaloGui.ts'), 'utf8')
        const route = fs.readFileSync(path.join(goc, 'routes', 'zalo.ts'), 'utf8')
        const lich = fs.readFileSync(path.join(goc, 'lib', 'zaloLichGui.ts'), 'utf8')
        ok('8a. nhipGuiZalo gọi nhipLichGui (nạp động — tránh vòng import)', /await import\('\.\/zaloLichGui'\)/.test(gui) && /nhipLichGui\(sp\)/.test(gui))
        ok('8b. zaloLichGui không nạp tĩnh ngược lại vòng (zaloGui không import tĩnh zaloLichGui)', !/from '\.\/zaloLichGui'/.test(gui))
        ok('8c. /dot-gui có {congNo}: kiểm số nợ còn mới, 409 canXacNhan', /dungBienCongNo\(noiDung\)/.test(route) && /canXacNhan: true/.test(route))
        ok('8d. Có đủ route lịch: GET, xem, POST, PUT, bật, DELETE, chạy ngay', ["router.get('/lich-gui'", "router.post('/lich-gui/xem'", "router.post('/lich-gui'", "router.put('/lich-gui/:id'", "router.post('/lich-gui/:id/bat'", "router.delete('/lich-gui/:id'", "router.post('/lich-gui/:id/chay-ngay'"].every(s => route.includes(s)))
        ok('8e. Giành lượt bằng so-và-ghi trên lanToi', /AND "lanToi" = \$3::timestamp\(3\)/.test(lich))
    }

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
