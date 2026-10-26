/**
 * Kiểm TỔNG KẾT TRONG NGÀY QUA ZALO — npx tsx scripts/check-zalo-giao-dich-ngay.ts
 *
 * Chủ shop 26/10/2026: "không phải công nợ ngày mà hôm nay đã mua bao nhiêu và thanh toán bao nhiêu á".
 * Lõi ở lib/zaloGiaoDichNgay.ts: đã trả hôm nay = nợ ĐẦU NGÀY (ảnh chụp 0 giờ) + mua hôm nay − nợ HIỆN TẠI.
 * Sai ở đây là báo khách "đã trả 0đ" khi họ vừa trả, hay báo số âm — nên mỗi ca một phép. Prisma giả.
 * Mục 7 (26/10 tối, chủ shop "có [mua] mà sao lại không có"): ngày đầu chưa có ảnh chụp ⇒ khách CÓ MUA vẫn nhận tin, chỉ
 * bỏ dòng "đã trả" (dienMau) — trước đó bỏ cả khách ⇒ 18 khách mua mà xem trước "0 nhóm".
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'ab'.repeat(32)

import fs from 'fs'
import path from 'path'
import { chupNoDauNgay, soNgayCuaKhach, bienHomNay, dungBienHomNay, canNoDauNgay, ngayVN } from '../src/lib/zaloGiaoDichNgay'
import { soanNguoiNhan, chayLich, type LichGui } from '../src/lib/zaloLichGui'
import { dienMau } from '../src/lib/zaloGui'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const T = (s: string) => new Date(s)
let soSchema = 0

/** Prisma giả: mua trong ngày, phiếu trả, ảnh chụp nợ đầu ngày */
function giaSp(o: { mua?: any[]; traHang?: string[]; chup?: Record<string, number> | null; chupLuc?: Date; nhom?: any[]; khach?: any[]; demNhom?: number; mocMoi?: boolean } = {}) {
    const st = { sql: [] as string[], chen: 0 }
    const sp: any = {
        __schema: `kiem_ngay_${++soSchema}`,
        $executeRawUnsafe: async (sql: string) => {
            st.sql.push(sql)
            if (/CREATE TABLE/.test(sql)) return 0
            if (/VALUES \(\$1, '__xong__'/.test(sql)) return o.mocMoi === false ? 0 : 1
            if (/INSERT INTO "NoKhachDauNgay"[\s\S]*SELECT/.test(sql)) { st.chen++; return 166 }
            return 0
        },
        $queryRawUnsafe: async (sql: string) => {
            if (/FROM "Transaction" t/.test(sql)) return o.mua || []
            if (/FROM "ReturnOrder" r/.test(sql)) return (o.traHang || []).map(k => ({ k }))
            if (/to_regclass\('"NoKhachDauNgay"'\)/.test(sql)) return [{ co: o.chup !== null && o.chup !== undefined }]
            if (/"customerId" = '__xong__'/.test(sql)) return o.chup ? [{ chupLuc: o.chupLuc || T('2026-10-25T17:01:00Z') }] : []
            if (/SELECT "customerId", "debt" FROM "NoKhachDauNgay"/.test(sql)) return Object.entries(o.chup || {}).map(([customerId, debt]) => ({ customerId, debt }))
            if (/FROM "ZaloPhien"/.test(sql)) return [{ id: 'default', duLieu: 'x', phienSo: 'p', trangThai: 'song', uid: '1', ten: 'T', anh: null, loiCuoi: null, nguoiDangNhap: null, dangNhapLuc: new Date(), dungLuc: null, giuLuc: null }]
            if (/to_regclass/.test(sql)) return [{ co: true }]
            return []
        },
        zaloNhom: {
            count: async () => o.demNhom ?? 0,
            findMany: async ({ where }: any) => (o.nhom || []).filter((n: any) => where.groupId ? where.groupId.in.includes(n.groupId) : n.customerId),
        },
        zaloNhomQuet: { findMany: async () => [] },
        customer: { findMany: async ({ where }: any) => (o.khach || []).filter((k: any) => where.id.in.includes(k.id)) },
        zaloCauHinh: { findUnique: async () => ({ guiMoiPhut: 4 }) },
        zaloDotGui: { create: async ({ data }: any) => ({ id: 'dot1', ...data }) },
        zaloDotGuiNhom: { createMany: async ({ data }: any) => ({ count: data.length }), count: async () => 0 },
        kiotVietConfig: { findUnique: async () => ({ enabled: true }) },
        kiotVietSyncLog: { findFirst: async () => ({ startedAt: T('2026-10-20T00:00:00Z') }) },   // đối chiếu cũ 6 ngày
        notification: { findFirst: async () => null, create: async ({ data }: any) => ({ id: 'tb1', ...data }) },
    }
    return { sp, st }
}

const LUC = T('2026-10-26T12:00:00Z')   // 19:00 VN thứ Hai 26/10
const CHUP = { k1: 5_000_000, k2: 8_000_000, k3: 0, k4: 1_000_000, k6: 0, k7: 2_000_000 }
const KHACH = [
    { id: 'k1', code: 'A1', name: 'Mua chịu một phần', debt: 12_000_000 },
    { id: 'k2', code: 'A2', name: 'Chỉ trả nợ cũ', debt: 6_000_000 },
    { id: 'k3', code: 'A3', name: 'Mua trả đủ', debt: 0 },
    { id: 'k4', code: 'A4', name: 'Có trả hàng', debt: 400_000 },
    { id: 'k5', code: 'A5', name: 'Nối nhóm sau 0 giờ', debt: 3_000_000 },
    { id: 'k6', code: 'A6', name: 'Hoá đơn ngày cũ', debt: 2_000_000 },
    { id: 'k7', code: 'A7', name: 'Không giao dịch', debt: 2_000_000 },
]
const MUA = [
    { k: 'k1', tien: 10_000_000, don: 2 },
    { k: 'k3', tien: 1_000_000, don: 1 },
    { k: 'k4', tien: 0, don: 0 },
]

async function main() {
    console.log('\n▶ Tổng kết trong ngày — hôm nay mua bao nhiêu, thanh toán bao nhiêu\n')

    /* 1 — Chụp nợ đầu ngày */
    {
        let g = giaSp({ demNhom: 166 })
        ok('1a. 08:00 sáng ⇒ không chụp (chụp trễ là lẫn giao dịch sáng)', (await chupNoDauNgay(g.sp, T('2026-10-26T01:00:00Z'))) === '' && g.st.sql.length === 0)
        g = giaSp({ demNhom: 0 })
        ok('1b. Cửa hàng không có nhóm Zalo nối khách ⇒ không tạo bảng', (await chupNoDauNgay(g.sp, T('2026-10-25T17:02:00Z'))) === '' && !g.st.sql.some(s => /CREATE TABLE/.test(s)))
        g = giaSp({ demNhom: 166 })
        const r = await chupNoDauNgay(g.sp, T('2026-10-25T17:02:00Z'))   // 00:02 VN 26/10
        ok('1c. 00:02 VN ⇒ chèn dòng đánh dấu + chụp 166 khách, dọn bản cũ', /chup 166/.test(r) && g.st.chen === 1 && g.st.sql.some(s => /DELETE FROM "NoKhachDauNgay"/.test(s)), r)
        ok('1d. Nhịp sau cùng ngày (cùng bản máy) ⇒ không làm lại', (await chupNoDauNgay(g.sp, T('2026-10-25T17:03:00Z'))) === '' && g.st.chen === 1)
        g = giaSp({ demNhom: 166, mocMoi: false })
        ok('1e. Bản máy khác đã chèn dòng đánh dấu ⇒ bản này KHÔNG chụp lần hai', (await chupNoDauNgay(g.sp, T('2026-10-25T17:02:00Z'))) === '' && g.st.chen === 0)
        ok('1f. ngayVN: 17:30Z ngày 25 là ngày 26 ở VN', ngayVN(T('2026-10-25T17:30:00Z')) === '2026-10-26')
    }

    /* 2 — Công thức đã trả */
    {
        const { sp } = giaSp({ mua: MUA, traHang: ['k4'], chup: CHUP })
        const { theoKhach } = await soNgayCuaKhach(sp, KHACH, LUC)
        const s = (k: string) => theoKhach.get(k)!
        ok('2a. Mua chịu một phần: đầu 5tr + mua 10tr − nay 12tr ⇒ đã trả 3tr', s('k1').mua === 10_000_000 && s('k1').soDon === 2 && s('k1').daTra === 3_000_000, s('k1'))
        ok('2b. Không mua, trả nợ cũ: 8tr − 6tr ⇒ đã trả 2tr (cộng phiếu thu thì ra 0đ — đo 26/10)', s('k2').mua === 0 && s('k2').daTra === 2_000_000, s('k2'))
        ok('2c. Mua 1tr trả đủ ⇒ đã trả 1tr, nợ 0', s('k3').daTra === 1_000_000, s('k3'))
        ok('2d. Có phiếu trả hàng hôm nay ⇒ KHÔNG tính (tra_hang)', s('k4').daTra === null && s('k4').lyDoKhongTinh === 'tra_hang', s('k4'))
        ok('2e. Không có ảnh chụp (nối nhóm sau 0 giờ) ⇒ KHÔNG đoán 0 (chua_chup)', s('k5').daTra === null && s('k5').noDau === null && s('k5').lyDoKhongTinh === 'chua_chup', s('k5'))
        ok('2f. Âm (đầu 0 + mua 0 − nay 2tr) ⇒ không khớp, không báo số âm', s('k6').daTra === null && s('k6').lyDoKhongTinh === 'khong_khop', s('k6'))
        ok('2g. Không giao dịch ⇒ đã trả 0, mua 0', s('k7').daTra === 0 && s('k7').mua === 0, s('k7'))
        const g2 = giaSp({ mua: [{ k: 'k1', tien: 1_000_000, don: 1 }], chup: { k1: 0 } })
        const lech = (await soNgayCuaKhach(g2.sp, [{ id: 'k1', debt: 1_000_400 }], LUC)).theoKhach.get('k1')!
        ok('2h. Lệch làm tròn −400đ ⇒ coi như trả 0đ (không phải "không khớp")', lech.daTra === 0 && lech.lyDoKhongTinh === null, lech)
        const g3 = giaSp({ mua: MUA, chup: CHUP, chupLuc: T('2026-10-26T00:30:00Z') })   // chụp lúc 07:30 VN
        const tre = (await soNgayCuaKhach(g3.sp, KHACH, LUC)).theoKhach.get('k1')!
        ok('2i. Ảnh chụp lúc 07:30 sáng (trễ) ⇒ không tin, chua_chup', tre.daTra === null && tre.lyDoKhongTinh === 'chua_chup', tre)
    }

    /* 3 — Biến */
    {
        const s = { mua: 10_000_000, soDon: 2, noNay: 12_000_000, noDau: 5_000_000, daTra: 3_000_000, lyDoKhongTinh: null }
        const b = bienHomNay(s, LUC, true)!
        ok('3a. {muaHomNay} {soDonHomNay} {daTraHomNay} {noDauNgay} {homNay}', b.muaHomNay === '10.000.000đ' && b.soDonHomNay === '2' && b.daTraHomNay === '3.000.000đ' && b.noDauNgay === '5.000.000đ' && b.homNay === '26/10/2026', b)
        ok('3b. Tin cần "đã trả" mà không tính được ⇒ null (nơi gọi lấy bộ biến KHÔNG có "đã trả", dienMau bỏ dòng — xem mục 7)', bienHomNay({ ...s, daTra: null, lyDoKhongTinh: 'tra_hang' }, LUC, true) === null)
        const chiMua = bienHomNay({ ...s, daTra: null, noDau: null, lyDoKhongTinh: 'chua_chup' }, LUC, false)
        ok('3c. Tin chỉ có {muaHomNay} ⇒ vẫn gửi được khi chưa có ảnh chụp', !!chiMua && chiMua.muaHomNay === '10.000.000đ' && !('daTraHomNay' in chiMua!), chiMua)
        ok('3d. Nhận diện biến', dungBienHomNay('Hôm nay mua {muaHomNay}') && !canNoDauNgay('Hôm nay mua {muaHomNay}') && canNoDauNgay('đã trả {daTraHomNay}'))
    }

    /* 4 — Người nhận: chỉ khách có giao dịch */
    {
        const nhom = KHACH.map((k, i) => ({ groupId: `100000000${i}`, customerId: k.id, tenNhom: k.code }))
        const { sp } = giaSp({ mua: MUA, traHang: ['k4'], chup: CHUP, nhom, khach: KHACH })
        const lich = { noiDung: 'Hôm nay mua {muaHomNay}, đã trả {daTraHomNay}, còn nợ {congNo}', doanhSo: null,
            doiTuong: { loai: 'tat_ca' as const, groupIds: [], chiKhachCoNo: false, noToiThieu: 0, chiKhachCoGiaoDich: true } }
        const s = await soanNguoiNhan(sp, lich, LUC)
        const ma = s.dong.map(d => d.maKhach).sort()
        ok('4a. Gửi k1 (mua), k2 (chỉ trả nợ), k3 (mua trả đủ)', JSON.stringify(ma) === JSON.stringify(['A1', 'A2', 'A3']), ma)
        ok('4b. Bỏ k7 (không mua, không trả) vào "không giao dịch"', s.boKhongGiaoDich === 1, s)
        ok('4c. Bỏ k4 (trả hàng), k5 (chưa chụp), k6 (không khớp) — báo đúng lý do', s.boHomNay.tra_hang === 1 && s.boHomNay.chua_chup === 1 && s.boHomNay.khong_khop === 1, s.boHomNay)
        const k1 = s.dong.find(d => d.maKhach === 'A1')!
        ok('4d. Biến của k1 đủ: mua 10tr, đã trả 3tr, còn nợ 12tr', k1.bien?.muaHomNay === '10.000.000đ' && k1.bien?.daTraHomNay === '3.000.000đ' && k1.bien?.congNo === '12.000.000đ', k1.bien)
    }

    /* 5 — Lượt tự động dừng khi số dư KiotViet cũ */
    {
        const nhom = [{ groupId: '1000000001', customerId: 'k1', tenNhom: 'A1' }]
        const { sp } = giaSp({ mua: MUA, chup: CHUP, nhom, khach: KHACH })
        const lich: LichGui = {
            id: 'lich-ngay', ten: 'Tổng kết hôm nay', noiDung: 'Hôm nay mua {muaHomNay}, đã trả {daTraHomNay}', anh: [],
            tuyChon: { mucDo: 0, nhacCaNhom: false, tuXoa: 0, henGio: null },
            doiTuong: { loai: 'tat_ca', groupIds: [], chiKhachCoNo: false, noToiThieu: 0, chiKhachCoGiaoDich: true }, doanhSo: null,
            tanSuat: { loai: 'ngay', gio: '19:00' }, bat: true, lanToi: null, lanCuoi: null, lanCuoiDotId: null, lanCuoiKetQua: null, nguoiTao: null, createdAt: '', updatedAt: '',
        }
        const kq = await chayLich(sp, lich, { bayGio: LUC })
        ok('5a. Tin có {daTraHomNay} (suy từ số dư) + đối chiếu KiotViet 6 ngày trước ⇒ KHÔNG gửi', kq.boQua && /48 giờ/.test(kq.ketQua), kq)
    }

    /* 6 — Nối dây */
    {
        const goc = path.join(__dirname, '..', 'src')
        const gui = fs.readFileSync(path.join(goc, 'lib', 'zaloGui.ts'), 'utf8')
        const route = fs.readFileSync(path.join(goc, 'routes', 'zalo.ts'), 'utf8')
        ok('6a. nhipGuiZalo chụp nợ đầu ngày mỗi nhịp', /chupNoDauNgay\(sp\)/.test(gui))
        ok('6b. /gui-thu + /dot-gui điền biến hôm nay', (route.match(/dungBienHomNay\(/g) || []).length >= 2 && /bienHomNay\(s, luc, canNoDauNgay\(/.test(route))
        ok('6c. /dot-gui kiểm số dư còn mới cả khi chỉ dùng {daTraHomNay}', /\(dungBienCongNo\(noiDung\) \|\| canNoDauNgay\(noiDung\)\) && b\.boQuaKiemTraNo !== true/.test(route))
        ok('6d. /gui-thu + /dot-gui: thiếu số "đã trả" ⇒ lấy bộ biến không có "đã trả" (không báo lỗi / bỏ khách)',
            /bienHomNay\(s, luc, canNoDauNgay\(b\.noiDung\)\) \?\? bienHomNay\(s, luc, false\)/.test(route) && /bh = bienHomNay\(s, luc, false\); if \(bh\) thieuTra\+\+/.test(route))
    }

    /* 7 — Thiếu số nợ 0 giờ mà CÓ MUA ⇒ vẫn gửi, bỏ dòng "đã trả" */
    {
        const mau = 'Chào {tenKhach}:\n- Hôm nay mua: [đậm]{muaHomNay}[/đậm] ({soDonHomNay} đơn)\n- Đã thanh toán: [đậm]{daTraHomNay}[/đậm]\n- Công nợ hiện tại: {congNo}\nCảm ơn!'
        const thieu = dienMau(mau, { tenKhach: 'A8', bien: { muaHomNay: '2.000.000đ', soDonHomNay: '1', congNo: '5.000.000đ' } })
        ok('7a. Thiếu {daTraHomNay} ⇒ bỏ CẢ DÒNG "Đã thanh toán", giữ các dòng khác, không lọt chữ "{daTraHomNay}"',
            !/daTraHomNay|Đã thanh toán/.test(thieu) && /Hôm nay mua: \[đậm\]2\.000\.000đ\[\/đậm\] \(1 đơn\)/.test(thieu) && /Công nợ hiện tại: 5\.000\.000đ/.test(thieu) && /Cảm ơn!$/.test(thieu), thieu)
        const du = dienMau(mau, { tenKhach: 'A1', bien: { muaHomNay: '10.000.000đ', soDonHomNay: '2', daTraHomNay: '3.000.000đ', congNo: '12.000.000đ' } })
        ok('7b. Đủ số ⇒ giữ nguyên dòng "Đã thanh toán"', /Đã thanh toán: \[đậm\]3\.000\.000đ\[\/đậm\]/.test(du) && du.split('\n').length === 5, du)

        const KH8 = [...KHACH, { id: 'k8', code: 'A8', name: 'Mua, chưa có ảnh chụp', debt: 5_000_000 }]
        const nhom = KH8.map((k, i) => ({ groupId: `200000000${i}`, customerId: k.id, tenNhom: k.code }))
        const lich = { noiDung: mau, doanhSo: null, doiTuong: { loai: 'tat_ca' as const, groupIds: [], chiKhachCoNo: false, noToiThieu: 0, chiKhachCoGiaoDich: true } }
        const { sp } = giaSp({ mua: [...MUA, { k: 'k8', tien: 2_000_000, don: 1 }], traHang: ['k4'], chup: CHUP, nhom, khach: KH8 })
        const s = await soanNguoiNhan(sp, lich, LUC)
        const k8 = s.dong.find(d => d.maKhach === 'A8')
        ok('7c. Có mua mà chưa có số nợ 0 giờ ⇒ VẪN gửi (trước: bỏ cả khách); bien không có daTraHomNay; đếm thieuTra',
            !!k8 && s.thieuTra === 1 && !('daTraHomNay' in (k8?.bien || {})) && k8?.bien?.muaHomNay === '2.000.000đ', { thieuTra: s.thieuTra, k8 })
        ok('7d. Khách đủ số vẫn có "đã trả"; khách KHÔNG mua mà chưa có số vẫn bị bỏ (không biết có trả không)',
            s.dong.find(d => d.maKhach === 'A1')?.bien?.daTraHomNay === '3.000.000đ' && s.boHomNay.chua_chup === 1, s.boHomNay)

        const dau = giaSp({ mua: [{ k: 'k1', tien: 10_000_000, don: 2 }], chup: null, nhom, khach: KH8 })
        const s2 = await soanNguoiNhan(dau.sp, lich, LUC)
        ok('7e. Ngày ĐẦU (chưa có bảng ảnh chụp): khách có mua vẫn nhận tin — không còn "0 nhóm"',
            s2.dong.length === 1 && s2.dong[0]!.maKhach === 'A1' && s2.thieuTra === 1, { dong: s2.dong.map(d => d.maKhach), thieuTra: s2.thieuTra, bo: s2.boHomNay })
    }

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
