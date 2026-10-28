/**
 * Kiểm NHẮC MUA LẠI TRƯỚC NGÀY HAY MUA — npx tsx scripts/check-zalo-nhac-mua-lai.ts
 *
 * Chủ shop 28/10/2026: "khi đã xác định được số ngày hay mua thì bên gửi tin chăm sóc khách hàng sẽ có mục chăm sóc khách
 * hàng, nghĩa là trước 1 ngày sẽ gợi ý những mặt hàng đã lâu rồi không mua (những mặt hàng này sẽ là được chọn nhóm hàng
 * gợi ý)". Lõi ở lib/zaloNhacMuaLai.ts, nối vào lib/zaloLichGui.ts soanNguoiNhan.
 * Sai ở đây là: nhắn khách sai ngày (múi giờ), gán "thói quen" cho khách mới mua 2 lần, nhắc món khách đã bỏ từ năm ngoái,
 * gửi dòng "mấy món này lâu chưa lấy:" trống, hay lọc nhóm hàng mà quên nhóm con — mỗi thứ một ca. Prisma giả.
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'ab'.repeat(32)

import { thuHayMua, monLauKhongMua, thuNgayMaiVN, maiLaNgayHayMua, bienNhacMuaLai, dungBienNhacMuaLai, thoiQuenMuaCuaKhach, TEN_THU, TOI_DA_MON } from '../src/lib/zaloNhacMuaLai'
import { soanNguoiNhan, tinMau, docDoiTuong, moTaBo } from '../src/lib/zaloLichGui'
import { dienMau } from '../src/lib/zaloGui'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const T = (s: string) => new Date(s)
const NGAY = (s: string) => new Date(Date.parse(`${s}T00:00:00+07:00`))

/** Prisma giả: hai câu SQL của thoiQuenMuaCuaKhach + nhóm Zalo / khách cho soanNguoiNhan */
function giaSp(o: { theoThu?: any[]; mon?: any[]; nhom?: any[]; khach?: any[]; danhMuc?: any[] } = {}) {
    const st = { sql: [] as { sql: string; p: any[] }[] }
    const sp: any = {
        __schema: 'kiem_nhac',
        $queryRawUnsafe: async (sql: string, ...p: any[]) => {
            st.sql.push({ sql, p })
            if (/EXTRACT\(DOW/.test(sql)) return (o.theoThu || []).filter(r => p[0].includes(r.k))
            if (/array_agg/.test(sql)) return (o.mon || []).filter(r => p[0].includes(r.k) && (!p[3] || p[3].includes(r.cat)))
            return []
        },
        $executeRawUnsafe: async () => 0,
        category: { findMany: async () => o.danhMuc || [] },
        zaloNhom: { findMany: async ({ where }: any) => (o.nhom || []).filter((n: any) => where.groupId ? where.groupId.in.includes(n.groupId) : n.customerId) },
        zaloNhomQuet: { findMany: async () => [] },
        customer: { findMany: async ({ where }: any) => (o.khach || []).filter((k: any) => where.id.in.includes(k.id)) },
    }
    return { sp, st }
}
// Phiếu theo thứ: mảng 7 số (CN..T7) ⇒ dòng SQL
const dongThu = (k: string, dem: number[]) => dem.map((so, thu) => ({ k, thu, so })).filter(r => r.so > 0)

async function main() {
    console.log('\n▶ Nhắc mua lại trước ngày hay mua\n')

    /* 1 — Thứ hay mua: cùng luật thẻ "Hay mua vào" ở Sơ đồ mua hàng */
    {
        ok('1a. Không phiếu ⇒ không rõ, không đỉnh', !thuHayMua([]).ro && thuHayMua([]).dinh.length === 0)
        ok('1b. 3 phiếu đều thứ Bảy ⇒ CHƯA đủ phiếu (cần ≥ 4), đừng gán thói quen', !thuHayMua([0, 0, 0, 0, 0, 0, 3]).ro)
        const t4 = thuHayMua([0, 0, 0, 0, 0, 0, 4])
        ok('1c. 4 phiếu đều thứ Bảy ⇒ rõ, đỉnh = 6', t4.ro && t4.dinh.length === 1 && t4.dinh[0] === 6 && t4.tong === 4 && t4.max === 4)
        ok('1d. 10 phiếu, thứ Bảy 3 (30%) ⇒ rõ', thuHayMua([1, 1, 1, 1, 1, 2, 3]).ro && thuHayMua([1, 1, 1, 1, 1, 2, 3]).dinh[0] === 6)
        ok('1e. 10 phiếu rải: cao nhất 2 (20% < 25%) ⇒ rải đều, không rõ', !thuHayMua([2, 2, 1, 1, 1, 1, 2]).ro)
        ok('1f. Ba thứ ngang nhau 2-2-2/6 ⇒ không rõ (tối đa 2 thứ)', !thuHayMua([0, 2, 0, 2, 0, 2, 0]).ro)
        const hai = thuHayMua([0, 3, 0, 0, 0, 0, 3])
        ok('1g. Hai thứ ngang nhau 3-3/8 (≥ 25%) ⇒ rõ, đỉnh = [1, 6]', hai.ro && hai.dinh.join(',') === '1,6')
        ok('1h. Mảng thiếu phần tử / số âm vẫn đọc được', thuHayMua([5]).ro && thuHayMua([5]).dinh[0] === 0 && !thuHayMua([-1, -1]).ro)
    }

    /* 2 — Món lâu chưa mua: nhịp ≥ 2 lần, tới lượt (−3 ngày), chưa thôi mua */
    {
        const ba = [NGAY('2026-01-01'), NGAY('2026-01-31'), NGAY('2026-03-02')]   // nhịp 30 ngày, lần cuối 02/03
        ok('2a. Mua 1 lần ⇒ không có nhịp ⇒ null', monLauKhongMua([NGAY('2026-01-01')], T('2026-10-28T10:00:00Z')) === null)
        const kq = monLauKhongMua(ba, NGAY('2026-03-29'))   // qua 27 = 30 − 3
        ok('2b. Nhịp 30 ngày, qua 27 ngày (= nhịp − 3) ⇒ tới lượt', !!kq && kq.nhipNgay === 30 && kq.quaNgay === 27 && kq.lanCuoi.getTime() === NGAY('2026-03-02').getTime(), kq)
        ok('2c. Qua 23 ngày (< nhịp − 3) ⇒ chưa tới lượt', monLauKhongMua(ba, NGAY('2026-03-25')) === null)
        ok('2d. Qua 60 ngày (quá hạn, chưa thôi mua vì ≤ nhịp + 90) ⇒ vẫn nhắc', monLauKhongMua(ba, NGAY('2026-05-01'))?.quaNgay === 60)
        ok('2e. Qua 300 ngày (> max(4 × 30, 30 + 90) = 120) ⇒ THÔI MUA, không nhắc', monLauKhongMua(ba, T('2026-10-28T10:00:00Z')) === null)
        ok('2f. Nhịp dài 200 ngày, qua 500 ngày (≤ 4 × 200) ⇒ vẫn nhắc', monLauKhongMua([NGAY('2024-01-01'), NGAY('2024-07-19')], NGAY('2025-12-01')) !== null)
        ok('2g. Hai lần cùng ngày = một ngày ⇒ không có nhịp', monLauKhongMua([NGAY('2026-01-01'), NGAY('2026-01-01')], NGAY('2026-03-01')) === null)
        ok('2h. Ngày mua sau "bây giờ" (lệch giờ) ⇒ null, không ra số âm', monLauKhongMua(ba, NGAY('2026-03-01')) === null)
        ok('2i. Ngày lặp (phiếu cùng ngày) chỉ đếm một lần khi tính nhịp', monLauKhongMua([...ba, NGAY('2026-03-02')], NGAY('2026-03-29'))?.nhipNgay === 30)
    }

    /* 3 — "Mai" theo giờ VN */
    {
        ok('3a. 17:00 VN thứ Tư 28/10 ⇒ mai thứ Năm (4)', thuNgayMaiVN(T('2026-10-28T10:00:00Z')) === 4)
        ok('3b. 00:30 VN thứ Năm 29/10 (UTC vẫn thứ Tư) ⇒ mai thứ Sáu (5)', thuNgayMaiVN(T('2026-10-28T17:30:00Z')) === 5)
        ok('3c. 23:30 VN thứ Bảy ⇒ mai Chủ nhật (0)', thuNgayMaiVN(T('2026-10-31T16:30:00Z')) === 0)
        const tq = { thu: thuHayMua([0, 0, 0, 0, 0, 0, 4]), mon: [] }
        ok('3d. Khách hay mua thứ Bảy: tối thứ Sáu ⇒ mai là ngày hay mua; tối thứ Bảy ⇒ không', maiLaNgayHayMua(tq, T('2026-10-30T10:00:00Z')) && !maiLaNgayHayMua(tq, T('2026-10-31T10:00:00Z')))
        ok('3e. Không có thói quen / undefined ⇒ không', !maiLaNgayHayMua(undefined, T('2026-10-30T10:00:00Z')) && !maiLaNgayHayMua({ thu: thuHayMua([0, 0, 0, 0, 0, 0, 3]), mon: [] }, T('2026-10-30T10:00:00Z')))
    }

    /* 4 — Biến + bỏ dòng khi thiếu */
    {
        const MAU = 'Chào {tenKhach}, mai là {thuHayMua}.\nMấy món lâu chưa lấy:\n{hangLauKhongMua}\nCảm ơn!'
        ok('4a. Nhận ra biến nhắc mua lại trong tin', dungBienNhacMuaLai(MAU) && dungBienNhacMuaLai('{ soMonLauKhongMua }') && !dungBienNhacMuaLai('{congNo}'))
        ok('4b. Không có thói quen ⇒ không biến nào', Object.keys(bienNhacMuaLai(undefined)).length === 0)
        const chiThu = bienNhacMuaLai({ thu: thuHayMua([0, 3, 0, 0, 0, 0, 3]), mon: [] })
        ok('4c. Rõ thứ mà không có món ⇒ chỉ {thuHayMua} = "Thứ Hai và Thứ Bảy"', chiThu.thuHayMua === 'Thứ Hai và Thứ Bảy' && !('hangLauKhongMua' in chiThu) && !('soMonLauKhongMua' in chiThu))
        const mon = [
            { productId: 'p1', ten: 'Dầu ăn 1L', sku: 'DA1L', lanCuoi: NGAY('2026-03-02'), nhipNgay: 30, quaNgay: 60, soLan: 3, slMoiLan: 12 },
            { productId: 'p2', ten: 'Nước mắm', sku: null, lanCuoi: NGAY('2026-10-05'), nhipNgay: 14, quaNgay: 12, soLan: 5, slMoiLan: 2 },
        ]
        const b = bienNhacMuaLai({ thu: thuHayMua([0, 0, 0, 0, 0, 0, 4]), mon })
        ok('4d. Danh sách món: mỗi dòng "- tên (lần cuối dd/mm, hay lấy N)", đếm đúng', b.hangLauKhongMua === '- Dầu ăn 1L (lần cuối 02/03, hay lấy 12)\n- Nước mắm (lần cuối 05/10, hay lấy 2)' && b.soMonLauKhongMua === '2' && b.thuHayMua === 'Thứ Bảy', b)
        const tin = dienMau(MAU, { tenKhach: 'Phú', bien: b })
        ok('4e. Điền đủ: thứ + danh sách nhiều dòng', tin === 'Chào Phú, mai là Thứ Bảy.\nMấy món lâu chưa lấy:\n- Dầu ăn 1L (lần cuối 02/03, hay lấy 12)\n- Nước mắm (lần cuối 05/10, hay lấy 2)\nCảm ơn!', tin)
        const thieu = dienMau(MAU, { tenKhach: 'Phú', bien: chiThu })
        ok('4f. Không có món ⇒ dòng {hangLauKhongMua} BỎ, dòng còn lại giữ (không gửi danh sách trống)', thieu === 'Chào Phú, mai là Thứ Hai và Thứ Bảy.\nMấy món lâu chưa lấy:\nCảm ơn!', thieu)
        ok('4g. Không có thói quen ⇒ cả dòng {thuHayMua} cũng bỏ', dienMau(MAU, { tenKhach: 'Phú', bien: {} }) === 'Mấy món lâu chưa lấy:\nCảm ơn!')
        ok('4h. TEN_THU theo getDay: 0 = Chủ nhật, 6 = Thứ Bảy', TEN_THU[0] === 'Chủ nhật' && TEN_THU[6] === 'Thứ Bảy' && TEN_THU.length === 7)
    }

    /* 5 — thoiQuenMuaCuaKhach: hai câu SQL gộp, lọc nhóm hàng kể cả nhóm con, xếp + cắt */
    {
        const luc = T('2026-10-30T10:00:00Z')   // 17:00 VN thứ Sáu
        const { sp, st } = giaSp({
            theoThu: [...dongThu('k1', [0, 0, 0, 0, 0, 1, 5]), ...dongThu('k2', [1, 1, 1, 0, 0, 0, 0])],
            mon: [
                // k1: 3 món tới lượt + 1 chưa tới + 1 thôi mua; dầu ăn mua nhiều nhất
                { k: 'k1', p: 'p1', ten: 'Dầu ăn 1L', sku: 'DA1L', cat: 'c-thuc-pham', ngay: ['2026-07-01', '2026-07-31', '2026-08-30'], sl: 36 },     // nhịp 30, qua 61
                { k: 'k1', p: 'p2', ten: 'Nước mắm', sku: null, cat: 'c-gia-vi', ngay: ['2026-09-01', '2026-09-15', '2026-09-29', '2026-10-13'], sl: 8 }, // nhịp 14, qua 17
                { k: 'k1', p: 'p3', ten: 'Bột ngọt', sku: 'BN', cat: 'c-gia-vi', ngay: ['2026-08-01', '2026-10-01'], sl: 2 },                         // nhịp 61, qua 29 ⇒ chưa
                { k: 'k1', p: 'p4', ten: 'Nồi chiên', sku: 'NC', cat: 'c-gia-dung', ngay: ['2025-01-01', '2025-02-01'], sl: 2 },                       // thôi mua
                { k: 'k1', p: 'p5', ten: 'Gạo 5kg', sku: 'G5', cat: 'c-thuc-pham', ngay: ['2026-09-01', '2026-10-01'], sl: 4 },                        // nhịp 30, qua 29
                { k: 'k2', p: 'p1', ten: 'Dầu ăn 1L', sku: 'DA1L', cat: 'c-thuc-pham', ngay: ['2026-01-01'], sl: 1 },                                  // mua 1 lần
            ],
            danhMuc: [{ id: 'c-thuc-pham', name: 'Thực phẩm', parentId: null }, { id: 'c-gia-vi', name: 'Gia vị', parentId: 'c-thuc-pham' }, { id: 'c-gia-dung', name: 'Gia dụng', parentId: null }],
        })
        const ra = await thoiQuenMuaCuaKhach(sp, ['k1', 'k2', 'k3'], { luc })
        const k1 = ra.get('k1')!, k2 = ra.get('k2')!, k3 = ra.get('k3')!
        ok('5a. k1: thứ Bảy 5/6 ⇒ rõ; k2: 3 phiếu ⇒ chưa; k3 không có phiếu vẫn có dòng (không rõ, 0 món)',
            k1.thu.ro && k1.thu.dinh[0] === 6 && !k2.thu.ro && !!k3 && !k3.thu.ro && k3.mon.length === 0)
        ok('5b. k1: 3 món tới lượt (bỏ "chưa tới" + "thôi mua"), quá lượt nhiều nhất lên đầu', k1.mon.map(m => m.productId).join(',') === 'p1,p2,p5', k1.mon.map(m => `${m.productId}:${m.quaNgay}/${m.nhipNgay}`))
        ok('5c. Số lần + hay lấy mỗi lần: dầu ăn 36/3 = 12', k1.mon[0]!.soLan === 3 && k1.mon[0]!.slMoiLan === 12 && k1.mon[0]!.ten === 'Dầu ăn 1L')
        ok('5d. k2 mua 1 lần ⇒ 0 món', k2.mon.length === 0)
        const sqlThu = st.sql.find(x => /EXTRACT\(DOW/.test(x.sql))!, sqlMon = st.sql.find(x => /array_agg/.test(x.sql))!
        ok('5e. SQL thứ: + interval 7 giờ trước khi lấy DOW, lọc completed+partial, 12 tháng',
            /interval '7 hours'/.test(sqlThu.sql) && sqlThu.p[1].join() === 'completed,partial' && Math.abs((luc.getTime() - sqlThu.p[2].getTime()) / 86400000 - 366) < 1)
        ok('5f. SQL món: gom NGÀY VN dạng text, cửa sổ 24 tháng, không lọc nhóm khi chưa chọn (chỉ 3 tham số)',
            /to_char\(COALESCE\(t\."transactionDate", t\."createdAt"\) \+ interval '7 hours', 'YYYY-MM-DD'\)/.test(sqlMon.sql) && !/categoryId/.test(sqlMon.sql) && sqlMon.p.length === 3 && Math.abs((luc.getTime() - sqlMon.p[2].getTime()) / 86400000 - 732) < 1)

        // Lọc nhóm hàng: chọn "Thực phẩm" ⇒ gồm cả nhóm con "Gia vị", bỏ "Gia dụng"
        const { sp: sp2, st: st2 } = giaSp({ theoThu: dongThu('k1', [0, 0, 0, 0, 0, 1, 5]), mon: (sp as any).__mon, danhMuc: [{ id: 'c-thuc-pham', name: 'Thực phẩm', parentId: null }, { id: 'c-gia-vi', name: 'Gia vị', parentId: 'c-thuc-pham' }, { id: 'c-gia-dung', name: 'Gia dụng', parentId: null }] })
        ;(sp2 as any).$queryRawUnsafe = sp.$queryRawUnsafe   // dùng lại dữ liệu món ở trên
        const ra2 = await thoiQuenMuaCuaKhach(sp2, ['k1'], { luc, categoryIds: ['c-thuc-pham'] })
        const sqlMon2 = st.sql.filter(x => /array_agg/.test(x.sql)).pop()!
        ok('5g. Chọn nhóm cha ⇒ SQL có $4 = cha + con (kể cả Gia vị), không có Gia dụng',
            /p\."categoryId" = ANY\(\$4::text\[\]\)/.test(sqlMon2.sql) && sqlMon2.p[3].includes('c-thuc-pham') && sqlMon2.p[3].includes('c-gia-vi') && !sqlMon2.p[3].includes('c-gia-dung'), sqlMon2.p[3])
        ok('5h. Kết quả lọc vẫn ra 3 món thực phẩm/gia vị của k1', ra2.get('k1')!.mon.map(m => m.productId).join(',') === 'p1,p2,p5')
        const { sp: sp3 } = giaSp({ danhMuc: [{ id: 'c-khac', name: 'Khác', parentId: null }] })
        const ra3 = await thoiQuenMuaCuaKhach(sp3, ['k1'], { luc, categoryIds: ['c-da-xoa'] })
        ok('5i. Nhóm đã chọn không còn trong danh mục ⇒ không món nào, không ném lỗi', ra3.size === 0)
        void st2

        // Trần số món trong một tin
        const nhieu = Array.from({ length: 12 }, (_, i) => ({ k: 'k9', p: `m${i}`, ten: `Món ${i}`, sku: null, cat: 'c', ngay: ['2026-07-01', '2026-07-31', '2026-08-30'], sl: 3 }))
        const { sp: sp4 } = giaSp({ theoThu: dongThu('k9', [0, 0, 0, 0, 0, 0, 4]), mon: nhieu })
        const ra4 = await thoiQuenMuaCuaKhach(sp4, ['k9'], { luc })
        ok(`5j. 12 món tới lượt ⇒ tin chỉ nêu ${TOI_DA_MON} món; toiDaMon=2 ⇒ 2`, ra4.get('k9')!.mon.length === TOI_DA_MON && (await thoiQuenMuaCuaKhach(sp4, ['k9'], { luc, toiDaMon: 2 })).get('k9')!.mon.length === 2)
        ok('5k. Không khách ⇒ Map rỗng, không hỏi DB', (await thoiQuenMuaCuaKhach(giaSp().sp, [], { luc })).size === 0)
    }

    /* 6 — Nối vào lịch gửi: lọc "mai là ngày hay mua", biến vào tin, đếm bỏ */
    {
        const luc = T('2026-10-30T10:00:00Z')   // 17:00 VN thứ Sáu ⇒ mai thứ Bảy
        const MAU = 'Chào {tenKhach}, mai là {thuHayMua} — ngày anh/chị hay ghé.\nMấy món lâu rồi chưa thấy lấy:\n{hangLauKhongMua}\nCần thì nhắn shop nhé!'
        const nhom = [
            { groupId: '1000000001', customerId: 'k1', tenNhom: 'A' },   // hay mua T7, có món tới lượt ⇒ GỬI
            { groupId: '1000000002', customerId: 'k2', tenNhom: 'B' },   // hay mua T7, không món nào ⇒ bỏ
            { groupId: '1000000003', customerId: 'k3', tenNhom: 'C' },   // hay mua T2 ⇒ bỏ
            { groupId: '1000000004', customerId: null, tenNhom: 'D' },   // chưa nối khách ⇒ "tất cả nhóm đã nối" không lấy từ đầu
        ]
        const khach = [{ id: 'k1', code: 'A1', name: 'An', debt: 0 }, { id: 'k2', code: 'B1', name: 'Bình', debt: 0 }, { id: 'k3', code: 'C1', name: 'Cúc', debt: 0 }]
        const theoThu = [...dongThu('k1', [0, 0, 0, 0, 0, 0, 4]), ...dongThu('k2', [0, 0, 0, 0, 0, 0, 4]), ...dongThu('k3', [0, 4, 0, 0, 0, 0, 0])]
        const mon = [
            { k: 'k1', p: 'p1', ten: 'Dầu ăn 1L', sku: 'DA1L', cat: 'c1', ngay: ['2026-07-01', '2026-07-31', '2026-08-30'], sl: 36 },
            { k: 'k3', p: 'p1', ten: 'Dầu ăn 1L', sku: 'DA1L', cat: 'c1', ngay: ['2026-07-01', '2026-07-31', '2026-08-30'], sl: 36 },
        ]
        const doiTuong = docDoiTuong({ loai: 'tat_ca', chiKhachMaiHayMua: true, nhomHangGoiY: ['c1', 'c1', ''] })
        ok('6a. docDoiTuong đọc cờ + nhóm hàng gợi ý (bỏ trùng, bỏ rỗng)', typeof doiTuong !== 'string' && doiTuong.chiKhachMaiHayMua === true && doiTuong.nhomHangGoiY!.join() === 'c1')
        ok('6b. Quá 50 nhóm hàng gợi ý ⇒ lỗi chữ', typeof docDoiTuong({ loai: 'tat_ca', nhomHangGoiY: Array.from({ length: 51 }, (_, i) => `c${i}`) }) === 'string')
        const { sp } = giaSp({ theoThu, mon, nhom, khach, danhMuc: [{ id: 'c1', name: 'Thực phẩm', parentId: null }] })
        const soan = await soanNguoiNhan(sp, { noiDung: MAU, doiTuong: doiTuong as any, doanhSo: null }, luc)
        ok('6c. Chỉ k1 được gửi; k2 (không món) + k3 (mai không phải ngày hay mua) ⇒ boKhongDenLuot = 2; nhóm chưa nối không vào danh sách',
            soan.dong.length === 1 && soan.dong[0]!.customerId === 'k1' && soan.boKhongDenLuot === 2 && soan.boChuaNoi === 0, { dong: soan.dong.map(d => d.customerId), bo: soan.boKhongDenLuot, chuaNoi: soan.boChuaNoi })
        const tin = tinMau(MAU, soan.dong[0])
        ok('6d. Tin mẫu điền đủ thứ + món', tin === 'Chào An, mai là Thứ Bảy — ngày anh/chị hay ghé.\nMấy món lâu rồi chưa thấy lấy:\n- Dầu ăn 1L (lần cuối 30/08, hay lấy 12)\nCần thì nhắn shop nhé!', tin)
        ok('6e. moTaBo nói rõ vì sao bỏ', moTaBo(soan) === '2 khách mai không phải ngày hay mua / không có món lâu chưa mua', moTaBo(soan))
        // Chọn đích danh nhóm chưa nối khách ⇒ tin cần số của khách ⇒ bỏ, đếm boChuaNoi
        const soanChon = await soanNguoiNhan(sp, { noiDung: MAU, doiTuong: { ...(doiTuong as any), loai: 'chon', groupIds: ['1000000001', '1000000004'] }, doanhSo: null }, luc)
        ok('6e2. Chọn nhóm chưa nối khách ⇒ bỏ (boChuaNoi = 1), k1 vẫn nhận', soanChon.dong.length === 1 && soanChon.boChuaNoi === 1 && moTaBo(soanChon).includes('1 nhóm chưa nối khách'), moTaBo(soanChon))

        // Không bật lọc: ai cũng nhận, nhưng khách không có thói quen thì tin bỏ dòng biến (không gửi chữ "{thuHayMua}")
        const soan2 = await soanNguoiNhan(sp, { noiDung: MAU, doiTuong: { loai: 'tat_ca', groupIds: [], chiKhachCoNo: false, noToiThieu: 0 }, doanhSo: null }, luc)
        const tinK2 = tinMau(MAU, soan2.dong.find(d => d.customerId === 'k2'))
        ok('6f. Không lọc ⇒ 3 khách nối đều nhận; k2 không có món ⇒ dòng món bỏ, dòng thứ giữ', soan2.dong.length === 3 && soan2.boKhongDenLuot === 0 && tinK2 === 'Chào Bình, mai là Thứ Bảy — ngày anh/chị hay ghé.\nMấy món lâu rồi chưa thấy lấy:\nCần thì nhắn shop nhé!', tinK2)
        ok('6g. Tin không có biến nhắc + không lọc ⇒ không hỏi SQL thói quen', await (async () => {
            const { sp: s, st } = giaSp({ nhom, khach })
            await soanNguoiNhan(s, { noiDung: 'Chào {tenKhach}', doiTuong: { loai: 'tat_ca', groupIds: [], chiKhachCoNo: false, noToiThieu: 0 }, doanhSo: null }, luc)
            return !st.sql.some(x => /EXTRACT\(DOW|array_agg/.test(x.sql))
        })())
        // Tối thứ Bảy chạy cùng lịch ⇒ mai Chủ nhật ⇒ k1 không tới lượt
        const soan3 = await soanNguoiNhan(sp, { noiDung: MAU, doiTuong: doiTuong as any, doanhSo: null }, T('2026-10-31T10:00:00Z'))
        ok('6h. Tối thứ Bảy ⇒ mai Chủ nhật ⇒ không ai nhận (lịch hằng ngày chỉ bắn đúng hôm trước ngày hay mua)', soan3.dong.length === 0 && soan3.boKhongDenLuot === 3)
    }

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    process.exit(hong ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
