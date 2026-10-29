/**
 * Kiểm TỔNG KẾT TRONG NGÀY QUA ZALO — npx tsx scripts/check-zalo-giao-dich-ngay.ts
 *
 * Chủ shop 26/10/2026: "không phải công nợ ngày mà hôm nay đã mua bao nhiêu và thanh toán bao nhiêu á".
 * Lõi ở lib/zaloGiaoDichNgay.ts. 26/10 tối chủ shop: "phần thanh toán là lấy trong phần giao dịch chứ k có gắn trên phiếu
 * mà" ⇒ đã trả hôm nay = tiền đã thu trên hoá đơn HÔM NAY + phiếu thu nợ ghi ngày hôm nay — KHÔNG còn suy từ ảnh chụp
 * nợ 0 giờ (bản đó ngày đầu không ai có số). Ảnh chụp chỉ còn cho {noDauNgay}.
 * Sai ở đây là báo khách "đã trả 0đ" khi họ vừa trả, hay đếm đôi một khoản — nên mỗi ca một phép. Prisma giả; câu SQL
 * thật thử riêng trên Postgres (xem mục 6).
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'ab'.repeat(32)

import fs from 'fs'
import path from 'path'
import { chupNoDauNgay, soNgayCuaKhach, bienHomNay, dungBienHomNay, canNoDauNgay, ngayVN } from '../src/lib/zaloGiaoDichNgay'
import { soanNguoiNhan, chayLich, tinMau, type LichGui } from '../src/lib/zaloLichGui'
import { dienMau } from '../src/lib/zaloGui'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const T = (s: string) => new Date(s)
let soSchema = 0

/** Prisma giả: mua + tiền đã thu trong ngày, phiếu thu nợ có ngày, ảnh chụp nợ đầu ngày */
function giaSp(o: { mua?: any[]; phieu?: any[]; chup?: Record<string, number> | null; chupLuc?: Date; nhom?: any[]; khach?: any[]; demNhom?: number; mocMoi?: boolean } = {}) {
    const st = { sql: [] as string[], chen: 0, dot: 0, thamSoPhieu: null as any[] | null }
    const sp: any = {
        __schema: `kiem_ngay_${++soSchema}`,
        $executeRawUnsafe: async (sql: string) => {
            st.sql.push(sql)
            if (/CREATE TABLE/.test(sql)) return 0
            if (/VALUES \(\$1, '__xong__'/.test(sql)) return o.mocMoi === false ? 0 : 1
            if (/INSERT INTO "NoKhachDauNgay"[\s\S]*SELECT/.test(sql)) { st.chen++; return 166 }
            return 0
        },
        $queryRawUnsafe: async (sql: string, ...ts: any[]) => {
            st.sql.push(sql)
            if (/FROM "DebtEntry" d/.test(sql)) { st.thamSoPhieu = ts; return o.phieu || [] }
            if (/FROM "Transaction" t/.test(sql)) return o.mua || []
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
        zaloDotGui: { create: async ({ data }: any) => { st.dot++; return { id: 'dot1', ...data } } },
        zaloDotGuiNhom: { createMany: async ({ data }: any) => ({ count: data.length }), count: async () => 0 },
        kiotVietConfig: { findUnique: async () => ({ enabled: true }) },
        kiotVietSyncLog: { findFirst: async () => ({ startedAt: T('2026-10-20T00:00:00Z') }) },   // đối chiếu cũ 6 ngày
        notification: { findFirst: async () => null, create: async ({ data }: any) => ({ id: 'tb1', ...data }) },
    }
    return { sp, st }
}

const LUC = T('2026-10-26T12:00:00Z')   // 19:00 VN thứ Hai 26/10
const CHUP = { k1: 5_000_000, k2: 8_000_000, k3: 0, k4: 7_500_000, k7: 2_000_000 }   // k5 nối nhóm sau 0 giờ
const KHACH = [
    { id: 'k1', code: 'A1', name: 'Mua chịu một phần', debt: 12_000_000 },
    { id: 'k2', code: 'A2', name: 'Chỉ trả nợ cũ (phiếu thu có ngày)', debt: 6_000_000 },
    { id: 'k3', code: 'A3', name: 'Mua trả đủ', debt: 0 },
    { id: 'k4', code: 'A4', name: 'Trả dư trên hoá đơn cho nợ cũ', debt: 0 },
    { id: 'k5', code: 'A5', name: 'Nối nhóm sau 0 giờ', debt: 3_000_000 },
    { id: 'k7', code: 'A7', name: 'Không giao dịch', debt: 2_000_000 },
]
// `thu` = Σ tiền đã thu trên các hoá đơn hôm nay của khách (SQL lấy max(amountReceived − change, Σ Payment khác credit) từng đơn)
const MUA = [
    { k: 'k1', tien: 10_000_000, don: 2, thu: 3_000_000 },
    { k: 'k3', tien: 1_000_000, don: 1, thu: 1_000_000 },
    { k: 'k4', tien: 500_000, don: 1, thu: 8_000_000 },
    { k: 'k5', tien: 2_000_000, don: 1, thu: 0 },
]
const PHIEU = [{ k: 'k2', tien: 2_000_000 }]
const MAU = 'Chào {tenKhach}:\n- Hôm nay mua: [đậm]{muaHomNay}[/đậm] ({soDonHomNay} đơn)\n- Đã thanh toán: [đậm]{daTraHomNay}[/đậm]\n- Công nợ hiện tại: {congNo}\nCảm ơn!'

async function main() {
    console.log('\n▶ Tổng kết trong ngày — hôm nay mua bao nhiêu, thanh toán bao nhiêu\n')

    /* 1 — Chụp nợ đầu ngày (cho {noDauNgay}) */
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

    /* 2 — Đã trả lấy từ giao dịch */
    {
        const { sp } = giaSp({ mua: MUA, phieu: PHIEU, chup: CHUP })
        const { theoKhach } = await soNgayCuaKhach(sp, KHACH, LUC)
        const s = (k: string) => theoKhach.get(k)!
        ok('2a. Mua 10tr (2 đơn), thu trên đơn 3tr ⇒ đã trả 3tr, nợ đầu ngày 5tr', s('k1').mua === 10_000_000 && s('k1').soDon === 2 && s('k1').daTra === 3_000_000 && s('k1').noDau === 5_000_000, s('k1'))
        ok('2b. Không mua, phiếu thu nợ có ngày hôm nay 2tr ⇒ đã trả 2tr', s('k2').mua === 0 && s('k2').daTra === 2_000_000, s('k2'))
        ok('2c. Mua 1tr trả đủ ⇒ đã trả 1tr', s('k3').daTra === 1_000_000, s('k3'))
        ok('2d. Trả dư trên hoá đơn 500k (đem trừ nợ cũ) ⇒ đã trả ĐỦ 8tr, không cắt về tổng đơn', s('k4').mua === 500_000 && s('k4').daTra === 8_000_000, s('k4'))
        ok('2e. Nối nhóm sau 0 giờ: vẫn có đã trả (0đ), chỉ thiếu nợ đầu ngày', s('k5').daTra === 0 && s('k5').mua === 2_000_000 && s('k5').noDau === null, s('k5'))
        ok('2f. Không giao dịch ⇒ đã trả 0, mua 0', s('k7').daTra === 0 && s('k7').mua === 0, s('k7'))

        const dau = giaSp({ mua: MUA, phieu: PHIEU, chup: null })
        const ngayDau = (await soNgayCuaKhach(dau.sp, KHACH, LUC)).theoKhach
        ok('2g. NGÀY ĐẦU (chưa có bảng ảnh chụp) ⇒ đã trả VẪN có số (3tr / 2tr) — lỗi chủ shop báo 26/10',
            ngayDau.get('k1')!.daTra === 3_000_000 && ngayDau.get('k2')!.daTra === 2_000_000 && ngayDau.get('k1')!.noDau === null, [...ngayDau.values()])
        const tre = giaSp({ mua: MUA, chup: CHUP, chupLuc: T('2026-10-26T00:30:00Z') })   // chụp lúc 07:30 VN
        const k1Tre = (await soNgayCuaKhach(tre.sp, KHACH, LUC)).theoKhach.get('k1')!
        ok('2h. Ảnh chụp lúc 07:30 sáng (trễ) ⇒ không tin nợ đầu ngày; đã trả không đổi', k1Tre.noDau === null && k1Tre.daTra === 3_000_000, k1Tre)
        const le = giaSp({ mua: [{ k: 'k1', tien: 1_000_000, don: 1, thu: 999_999.6 }], phieu: [{ k: 'k1', tien: 0.3 }] })
        ok('2i. Làm tròn đồng', (await soNgayCuaKhach(le.sp, [{ id: 'k1', debt: 0 }], LUC)).theoKhach.get('k1')!.daTra === 1_000_000)
    }

    /* 3 — Biến */
    {
        const s = { mua: 10_000_000, soDon: 2, noNay: 12_000_000, noDau: 5_000_000, daTra: 3_000_000 }
        const b = bienHomNay(s, LUC)
        ok('3a. {muaHomNay} {soDonHomNay} {daTraHomNay} {noDauNgay} {homNay}', b.muaHomNay === '10.000.000đ' && b.soDonHomNay === '2' && b.daTraHomNay === '3.000.000đ' && b.noDauNgay === '5.000.000đ' && b.homNay === '26/10/2026', b)
        const chuaChup = bienHomNay({ ...s, noDau: null }, LUC)
        ok('3b. Chưa có ảnh chụp ⇒ không có {noDauNgay}, VẪN có {daTraHomNay}', !('noDauNgay' in chuaChup) && chuaChup.daTraHomNay === '3.000.000đ', chuaChup)
        ok('3c. Nhận diện biến: chỉ {noDauNgay} cần ảnh chụp, {daTraHomNay} thì không',
            dungBienHomNay('Hôm nay mua {muaHomNay}') && !canNoDauNgay('đã trả {daTraHomNay}') && canNoDauNgay('nợ đầu ngày {noDauNgay}'))
    }

    /* 4 — Người nhận: chỉ khách có giao dịch */
    {
        const nhom = KHACH.map((k, i) => ({ groupId: `100000000${i}`, customerId: k.id, tenNhom: k.code }))
        const { sp } = giaSp({ mua: MUA, phieu: PHIEU, chup: CHUP, nhom, khach: KHACH })
        const lich = { noiDung: 'Hôm nay mua {muaHomNay}, đã trả {daTraHomNay}, còn nợ {congNo}', doanhSo: null,
            doiTuong: { loai: 'tat_ca' as const, groupIds: [], chiKhachCoNo: false, noToiThieu: 0, chiKhachCoGiaoDich: true } }
        const s = await soanNguoiNhan(sp, lich, LUC)
        const ma = s.dong.map(d => d.maKhach).sort()
        ok('4a. Gửi k1 (mua), k2 (chỉ trả nợ), k3, k4, k5 (mua — dù chưa có ảnh chụp)', JSON.stringify(ma) === JSON.stringify(['A1', 'A2', 'A3', 'A4', 'A5']), ma)
        ok('4b. Bỏ k7 (không mua, không trả) vào "không giao dịch"', s.boKhongGiaoDich === 1 && s.thieuNoDau === 0, s)
        const k1 = s.dong.find(d => d.maKhach === 'A1')!
        ok('4c. Biến của k1 đủ: mua 10tr, đã trả 3tr, còn nợ 12tr', k1.bien?.muaHomNay === '10.000.000đ' && k1.bien?.daTraHomNay === '3.000.000đ' && k1.bien?.congNo === '12.000.000đ', k1.bien)
        const coNoDau = await soanNguoiNhan(giaSp({ mua: MUA, phieu: PHIEU, chup: CHUP, nhom, khach: KHACH }).sp, { ...lich, noiDung: 'Nợ đầu ngày {noDauNgay}, đã trả {daTraHomNay}' }, LUC)
        const k5 = coNoDau.dong.find(d => d.maKhach === 'A5')
        ok('4d. Tin có {noDauNgay}: k5 chưa có ảnh chụp ⇒ VẪN gửi, đếm thieuNoDau, bien không có noDauNgay',
            !!k5 && coNoDau.thieuNoDau === 1 && !('noDauNgay' in (k5?.bien || {})) && k5?.bien?.daTraHomNay === '0đ' && coNoDau.dong.find(d => d.maKhach === 'A1')?.bien?.noDauNgay === '5.000.000đ',
            { thieuNoDau: coNoDau.thieuNoDau, k5 })
    }

    /* 5 — Lượt tự động và số dư KiotViet cũ */
    {
        const nhom = [{ groupId: '1000000001', customerId: 'k1', tenNhom: 'A1' }]
        const lich = (noiDung: string): LichGui => ({
            id: 'lich-ngay', ten: 'Tổng kết hôm nay', noiDung, anh: [],
            tuyChon: { mucDo: 0, nhacCaNhom: false, tuXoa: 0, henGio: null },
            doiTuong: { loai: 'tat_ca', groupIds: [], chiKhachCoNo: false, noToiThieu: 0, chiKhachCoGiaoDich: true }, doanhSo: null,
            tanSuat: { loai: 'ngay', gio: '19:00' }, bat: true, lanToi: null, lanCuoi: null, lanCuoiDotId: null, lanCuoiKetQua: null, nguoiTao: null, createdAt: '', updatedAt: '',
        })
        const a = giaSp({ mua: MUA, chup: CHUP, nhom, khach: KHACH })
        const kqA = await chayLich(a.sp, lich('Nợ đầu ngày {noDauNgay}, hôm nay mua {muaHomNay}'), { bayGio: LUC })
        ok('5a. Tin có {noDauNgay} (ảnh chụp số dư) + đối chiếu KiotViet 6 ngày trước ⇒ KHÔNG gửi', kqA.boQua && /48 giờ/.test(kqA.ketQua) && a.st.dot === 0, kqA)
        const b = giaSp({ mua: MUA, chup: CHUP, nhom, khach: KHACH })
        const kqB = await chayLich(b.sp, lich('Hôm nay mua {muaHomNay}, đã trả {daTraHomNay}'), { bayGio: LUC })
        ok('5b. Tin chỉ có {muaHomNay} {daTraHomNay} (lấy từ giao dịch) ⇒ không đợi số dư, VẪN gửi', !kqB.boQua && kqB.soNhom === 1 && b.st.dot === 1, kqB)
    }

    /* 6 — Nối dây */
    {
        const goc = path.join(__dirname, '..', 'src')
        const doc = (...p: string[]) => fs.readFileSync(path.join(goc, ...p), 'utf8')
        const gui = doc('lib', 'zaloGui.ts')
        const route = doc('routes', 'zalo.ts')
        const lib = doc('lib', 'zaloGiaoDichNgay.ts')
        ok('6a. nhipGuiZalo chụp nợ đầu ngày mỗi nhịp', /chupNoDauNgay\(sp\)/.test(gui))
        // 29/10/2026: số tra theo groupId (nhóm nối nhiều mã, lib/zaloNhomKhach.ts) — gửi thử lấy theoKhach.get(gid)
        ok('6b. /gui-thu + /dot-gui điền biến hôm nay', (route.match(/dungBienHomNay\(/g) || []).length >= 2 && /bienHomNay\(theoKhach\.get\(gid\)!, luc\)/.test(route) && /\.\.\.bienHomNay\(s, luc\)/.test(route))
        ok('6c. /dot-gui kiểm số dư còn mới khi có {congNo} / {noDauNgay}', /\(dungBienCongNo\(noiDung\) \|\| canNoDauNgay\(noiDung\)\) && b\.boQuaKiemTraNo !== true/.test(route))
        ok('6d. /dot-gui: thiếu số nợ 0 giờ ⇒ đếm thieuNoDau, không bỏ khách', /if \(canNoDauNgay\(noiDung\) && s\.noDau === null\) thieuNoDau\+\+/.test(route) && !/LY_DO_BO|boHomNay/.test(route))
        ok('6e. Tiền đã thu MỖI đơn = max(amountReceived − change, Σ Payment khác credit), chỉ đơn completed + partial',
            /GREATEST\(COALESCE\(t\."amountReceived", 0\) - COALESCE\(t\."change", 0\),\s*\(SELECT COALESCE\(SUM\(p\."amount"\), 0\) FROM "Payment" p WHERE p\."transactionId" = t\."id" AND p\."type" <> 'credit'\), 0\)/.test(lib)
            && /t\."status" = ANY\(\$2::text\[\]\)/.test(lib))

        // Mô tả DebtEntry phải khớp đúng chuỗi mà code ghi — đổi bên đó mà quên bên này là trả hàng thành "đã trả" / đếm đôi
        const g = giaSp({ mua: MUA, phieu: PHIEU })
        await soNgayCuaKhach(g.sp, KHACH, LUC)
        const [, , , , tra, thuNo] = g.st.thamSoPhieu || []
        const sqlPhieu = g.st.sql.find(s => /FROM "DebtEntry" d/.test(s)) || ''
        const returns = doc('routes', 'returns.ts')
        const tx = doc('routes', 'transactions.ts')
        ok('6f. Phiếu thu nợ: chỉ DebtEntry \'payment\', bỏ dòng "Giảm nợ do trả hàng" — khớp chuỗi routes/returns.ts',
            /d\."type" = 'payment'/.test(sqlPhieu) && /NOT LIKE \$5/.test(sqlPhieu) && typeof tra === 'string' && tra.endsWith('%')
            && returns.includes(`type: 'payment',`) && returns.includes(`description: \`${tra.slice(0, -1)} - phiếu \${returnOrder.code}\``), tra)
        ok('6g. Thu nợ của CHÍNH hoá đơn hôm nay (đã thành Payment) không cộng lần hai — khớp chuỗi routes/transactions.ts /pay-debt',
            /NOT EXISTS[\s\S]*d\."description" = \$6::text \|\| t\."receiptNumber"/.test(sqlPhieu) && typeof thuNo === 'string'
            && tx.includes(`description: \`${thuNo}\${existing.receiptNumber}\``) && /tx\.payment\.create\(/.test(tx), thuNo)
        ok('6h. Không còn đọc ReturnOrder / suy đã trả từ số dư', !/ReturnOrder/.test(lib) && !/dau \+ m\.tien - noNay/.test(lib))
    }

    /* 7 — dienMau + ngày đầu dùng */
    {
        const mauDau = 'Chào {tenKhach}:\n- Nợ đầu ngày: {noDauNgay}\n- Đã thanh toán: [đậm]{daTraHomNay}[/đậm]\nCảm ơn!'
        const thieu = dienMau(mauDau, { tenKhach: 'A5', bien: { daTraHomNay: '0đ' } })
        ok('7a. Thiếu {noDauNgay} ⇒ bỏ CẢ DÒNG "Nợ đầu ngày", giữ "Đã thanh toán", không lọt chữ "{noDauNgay}"',
            !/noDauNgay|Nợ đầu ngày/.test(thieu) && /Đã thanh toán: \[đậm\]0đ\[\/đậm\]/.test(thieu) && /Cảm ơn!$/.test(thieu), thieu)
        const du = dienMau(MAU, { tenKhach: 'A1', bien: { muaHomNay: '10.000.000đ', soDonHomNay: '2', daTraHomNay: '3.000.000đ', congNo: '12.000.000đ' } })
        ok('7b. Đủ số ⇒ giữ nguyên dòng "Đã thanh toán"', /Đã thanh toán: \[đậm\]3\.000\.000đ\[\/đậm\]/.test(du) && du.split('\n').length === 5, du)

        const nhom = KHACH.map((k, i) => ({ groupId: `200000000${i}`, customerId: k.id, tenNhom: k.code }))
        const lich = { noiDung: MAU, doanhSo: null, doiTuong: { loai: 'tat_ca' as const, groupIds: [], chiKhachCoNo: false, noToiThieu: 0, chiKhachCoGiaoDich: true } }
        const dau = giaSp({ mua: MUA, phieu: PHIEU, chup: null, nhom, khach: KHACH })
        const s = await soanNguoiNhan(dau.sp, lich, LUC)
        const k1 = s.dong.find(d => d.maKhach === 'A1')
        const tin = tinMau(MAU, k1)
        ok('7c. NGÀY ĐẦU, mẫu mặc định: tin CÓ dòng "Đã thanh toán" với số lấy từ giao dịch (trước: bỏ dòng, chờ ảnh chụp 0 giờ)',
            s.dong.length === 5 && s.thieuNoDau === 0 && /Đã thanh toán: \[đậm\]3\.000\.000đ\[\/đậm\]/.test(tin) && /Công nợ hiện tại: 12\.000\.000đ/.test(tin), { tin, dong: s.dong.length })
        const k2 = s.dong.find(d => d.maKhach === 'A2')
        ok('7d. Khách không mua mà trả nợ hôm nay (phiếu thu có ngày) ⇒ nhận tin "mua 0đ, đã thanh toán 2tr"',
            k2?.bien?.muaHomNay === '0đ' && k2?.bien?.daTraHomNay === '2.000.000đ', k2?.bien)
    }

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
