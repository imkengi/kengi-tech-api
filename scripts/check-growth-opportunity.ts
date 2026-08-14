/**
 * Kiểm chứng CỖ MÁY CƠ HỘI TĂNG TRƯỞNG.
 *
 * Chạy:  npx tsx scripts/check-growth-opportunity.ts
 *
 * Module này khuyên người ta bỏ vốn: dựng combo, nhập hàng theo mùa, cắt bớt
 * mã hàng. Khuyên sai thì họ mất tiền thật, nên bộ test soi hai phía:
 *  - dữ liệu mỏng thì PHẢI từ chối kết luận, không được hạ ngưỡng cho có kết quả;
 *  - dữ liệu có tín hiệu thật thì phải bắt được, không được bỏ sót.
 */

import { coHoiTangTruong } from '../src/lib/growthOpportunity'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const KY = {
    tu: new Date('2026-04-01T00:00:00+07:00'),
    den: new Date('2026-06-30T23:59:59+07:00'),
    moTa: '2026-04-01 → 2026-06-30',
}

/* ─── kho giả ─────────────────────────────────────────────────────────── */

interface Kho { transactions: any[]; products: any[] }

function fakePrisma(k: Kho, hong?: { transaction?: boolean; product?: boolean }) {
    const trongKhoang = (v: any, w: any) => {
        if (!w) return true
        const t = new Date(v).getTime()
        if (w.gte !== undefined && t < new Date(w.gte).getTime()) return false
        if (w.lte !== undefined && t > new Date(w.lte).getTime()) return false
        return true
    }
    return {
        transaction: {
            findMany: async ({ where, take }: any) => {
                if (hong?.transaction) throw new Error('The table `Transaction` does not exist')
                let ds = k.transactions.filter(t =>
                    trongKhoang(t.createdAt, where?.createdAt) &&
                    (!where?.status || t.status === where.status))
                if (take) ds = ds.slice(0, take)
                return ds
            },
        },
        product: {
            findMany: async ({ where }: any) => {
                if (hong?.product) throw new Error('The table `Product` does not exist')
                const ids: string[] = where?.id?.in || []
                return k.products.filter(p => ids.includes(p.id))
            },
        },
    }
}

/** Sinh đơn hàng: ngày, giờ, danh sách [productId, số lượng, đơn giá]. */
let dem = 0
function don(ngay: string, gio: number, hang: [string, number, number][], khach?: string) {
    dem++
    const items = hang.map(([pid, sl, gia]) => ({
        productId: pid, productName: 'Hàng ' + pid, quantity: sl, unitPrice: gia, lineTotal: sl * gia,
    }))
    return {
        id: 'T' + dem,
        // Giờ VN → UTC: trừ 7 tiếng để lib cộng lại ra đúng giờ mong đợi.
        createdAt: new Date(`${ngay}T${String(gio).padStart(2, '0')}:00:00+07:00`),
        total: items.reduce((s, i) => s + i.lineTotal, 0),
        status: 'completed',
        customerId: khach || null,
        items,
    }
}

const SAN_PHAM = [
    { id: 'P1', name: 'Cà phê hạt', costPrice: 60_000 },
    { id: 'P2', name: 'Phin pha', costPrice: 20_000 },
    { id: 'P3', name: 'Đường phèn', costPrice: 8_000 },
    { id: 'P4', name: 'Quạt mini', costPrice: 100_000 },
    { id: 'P5', name: 'Ly giữ nhiệt', costPrice: 90_000 },
]

/** Kho đủ dày: 3 tháng, có cặp bán kèm thật, có hàng mùa hè, có đơn sỉ. */
function khoDay(): Kho {
    const txs: any[] = []
    const thang = [4, 5, 6]
    for (const th of thang) {
        for (let ngay = 1; ngay <= 28; ngay++) {
            const d = `2026-${String(th).padStart(2, '0')}-${String(ngay).padStart(2, '0')}`
            // Nhịp ngày: 3 đơn lẻ buổi sáng, 2 đơn chiều
            for (let i = 0; i < 3; i++) {
                // Cặp P1+P2 đi cùng nhau ở phần lớn đơn có P1 → phải bắt được
                const kem: [string, number, number][] = ngay % 4 === 0
                    ? [['P1', 1, 100_000]]
                    : [['P1', 1, 100_000], ['P2', 1, 40_000]]
                txs.push(don(d, 9, kem, `K${(ngay + i) % 12}`))
            }
            txs.push(don(d, 19, [['P3', 2, 15_000]], `K${ngay % 20}`))
            // Ly giữ nhiệt bán đều, ít — để có đủ 5 mã cho phần phân tích tập trung
            if (ngay % 3 === 0) txs.push(don(d, 19, [['P5', 1, 150_000]], `K${ngay % 9}`))
            // Quạt mini chỉ bán mạnh tháng 6 (mùa nóng) → phải nhận ra tính mùa
            if (th === 6) txs.push(don(d, 15, [['P4', 3, 200_000]]))
            else if (ngay % 14 === 0) txs.push(don(d, 15, [['P4', 1, 200_000]]))
            // Đơn sỉ: mỗi tuần một đơn số lượng lớn, biên lãi mỏng
            if (ngay % 7 === 0) txs.push(don(d, 11, [['P1', 50, 70_000]], 'SI1'))
        }
    }
    return { transactions: txs, products: SAN_PHAM }
}

/* ─── các ca ──────────────────────────────────────────────────────────── */

async function main() {
    console.log('\n▶ Dữ liệu mỏng — PHẢI từ chối kết luận\n')

    const mong = await coHoiTangTruong(fakePrisma({ transactions: [don('2026-05-01', 9, [['P1', 1, 100_000]])], products: SAN_PHAM }), KY)
    ok('5 đơn → không kết luận sỉ/lẻ', !mong.siLe.duocKetLuan)
    ok('… và nêu lý do bằng lời', !!mong.siLe.lyDo && mong.siLe.lyDo.length > 20)
    ok('không dựng combo từ dữ liệu mỏng', !mong.banKem.duocKetLuan && mong.banKem.cap.length === 0)
    ok('không phán mùa vụ từ dữ liệu mỏng', !mong.muaVu.duocKetLuan)
    ok('không tự bịa khuyến nghị khi chưa kết luận được gì', mong.khuyenNghi.length === 0, mong.khuyenNghi.map(k => k.ma))

    console.log('\n▶ Kỳ quá ngắn — mùa vụ phải im dù nhiều đơn\n')
    const kyNgan = { tu: new Date('2026-06-01T00:00:00+07:00'), den: new Date('2026-06-07T23:59:59+07:00'), moTa: '1 tuần' }
    const ngan = await coHoiTangTruong(fakePrisma(khoDay()), kyNgan)
    ok('kỳ 7 ngày → KHÔNG kết luận mùa vụ', !ngan.muaVu.duocKetLuan, ngan.muaVu.lyDo)
    ok('… nhưng vẫn tách được sỉ/lẻ vì đủ đơn', ngan.siLe.duocKetLuan)

    console.log('\n▶ Dữ liệu dày — phải bắt được tín hiệu thật\n')
    const r = await coHoiTangTruong(fakePrisma(khoDay()), KY)

    ok('có đơn và có doanh thu', r.quyMo.soDon > 300 && r.quyMo.doanhThu > 0, r.quyMo)
    ok('lợi nhuận tính được vì có giá vốn', r.quyMo.loiNhuan > 0)

    // — Sỉ / lẻ
    ok('tách được hai nhóm sỉ và lẻ', r.siLe.duocKetLuan && r.siLe.nhom.length === 2)
    const si = r.siLe.nhom[0], le = r.siLe.nhom[1]
    /* 12 đơn "50 cái" chắc chắn phải vào nhóm sỉ; ngoài ra còn các đơn quạt
     * 600k cũng vượt ngưỡng tiền — đó là ý đồ của luật, không phải bắt nhầm. */
    ok('nhóm sỉ gom đủ 12 đơn số lượng lớn', si.soDon >= 12, si.soDon)
    ok('nhóm sỉ không nuốt gần hết đơn (ngưỡng không quá lỏng)', si.soDon < r.quyMo.soDon * 0.2, [si.soDon, r.quyMo.soDon])
    ok('đơn sỉ trung bình lớn hơn đơn lẻ nhiều lần', si.donTrungBinh > le.donTrungBinh * 5, [si.donTrungBinh, le.donTrungBinh])
    ok('biên lãi sỉ mỏng hơn lẻ (đúng như dữ liệu dựng)', (si.bienLai ?? 99) < (le.bienLai ?? 0), [si.bienLai, le.bienLai])
    ok('tỷ trọng doanh thu hai nhóm cộng lại xấp xỉ 100%',
        Math.abs(si.tyTrongDoanhThu + le.tyTrongDoanhThu - 100) < 0.3,
        si.tyTrongDoanhThu + le.tyTrongDoanhThu)
    ok('ngưỡng sỉ suy từ dữ liệu, không phải hằng số tròn', r.siLe.nguongSi > 0 && r.siLe.cachChia.includes('trung vị'))
    ok('luôn nói ra đánh đổi khi khuyên ngả sỉ/lẻ', r.siLe.danhDoi.length > 30)

    // — Bán kèm
    ok('bắt được cặp bán kèm', r.banKem.duocKetLuan && r.banKem.cap.length > 0)
    const capDau = r.banKem.cap[0]
    ok('cặp mạnh nhất đúng là P1 + P2', [capDau.a, capDau.b].sort().join() === 'P1,P2', [capDau.a, capDau.b])
    ok('lift > 1 (đi cùng nhau hơn mức ngẫu nhiên)', capDau.lift > 1, capDau.lift)
    ok('gợi ý chạy từ món phổ biến hơn sang món ít hơn', capDau.a === 'P1', capDau.a)
    ok('tiềm năng quy ra tiền và không âm', capDau.tiemNangLoiNhuan >= 0)
    ok('lộ rõ giả định tỷ lệ chuyển đổi', r.banKem.tyLeChuyenDoiGiaDinh === 0.15)

    /* Tiềm năng phải TỶ LỆ THUẬN với giả định: nếu đổi giả định mà con số không
     * đổi thì nó là số bịa, không phải số tính. */
    const rGiaDinhCao = await coHoiTangTruong(fakePrisma(khoDay()), KY, { tyLeChuyenDoi: 0.30 })
    const capCao = rGiaDinhCao.banKem.cap.find(c => c.a === capDau.a && c.b === capDau.b)
    ok('nhân đôi giả định → tiềm năng nhân đôi theo',
        !!capCao && Math.abs(capCao.tiemNangLoiNhuan - capDau.tiemNangLoiNhuan * 2) <= 2,
        [capDau.tiemNangLoiNhuan, capCao?.tiemNangLoiNhuan])

    // — Tập trung
    ok('tính được mức tập trung', r.tapTrung.duocKetLuan)
    ok('số mã tạo 80% không vượt tổng số mã', r.tapTrung.soMaTao80LaiSuat <= r.tapTrung.soMaHang)
    ok('HHI nằm trong thang 0–10.000', r.tapTrung.hhiHang >= 0 && r.tapTrung.hhiHang <= 10000, r.tapTrung.hhiHang)
    ok('mã đầu tàu xếp giảm dần theo đóng góp',
        r.tapTrung.maHangDauTau.every((m, i, a) => i === 0 || a[i - 1].loiNhuan >= m.loiNhuan))

    // — Mùa vụ
    ok('kết luận được mùa vụ với 3 tháng dữ liệu', r.muaVu.duocKetLuan)
    ok('có bảng theo tháng vì kỳ trải 3 tháng', !!r.muaVu.theoThang && r.muaVu.theoThang.length === 3)
    ok('nhận ra quạt mini là hàng mùa', r.muaVu.matHangTheoMua.some(m => m.productId === 'P4'), r.muaVu.matHangTheoMua.map(m => m.productId))
    const quat = r.muaVu.matHangTheoMua.find(m => m.productId === 'P4')
    ok('… và chỉ đúng tháng 6 là đỉnh', quat?.thangCaoNhat === 6, quat?.thangCaoNhat)
    ok('chỉ số theo thứ chia cho SỐ LẦN thứ đó xuất hiện',
        r.muaVu.theoThu.every(t => t.soNgay === 0 || t.chiSo > 0))
    ok('giờ vàng nói ra được', r.muaVu.gioVang.includes('%'))

    /* Dữ liệu chỉ dựng đơn ở 9h, 11h, 15h, 19h GIỜ VN. DB lưu UTC, nếu lib quên
     * cộng 7 tiếng thì doanh thu sẽ rơi vào 2h, 4h, 8h, 12h — bảng "giờ vàng"
     * sẽ khuyên chủ shop xếp người vào lúc 2h sáng. */
    const GIO_THAT = [9, 11, 15, 19]
    ok('không lệch múi giờ: mọi doanh thu nằm đúng 4 khung giờ đã dựng',
        r.muaVu.theoGio.every(g => GIO_THAT.includes(g.gio)),
        r.muaVu.theoGio.map(g => g.gio))
    ok('… và không có đồng nào rơi vào rạng sáng',
        !r.muaVu.theoGio.some(g => g.gio >= 0 && g.gio <= 5 && g.doanhThu > 0))

    // — Khuyến nghị
    ok('có khuyến nghị', r.khuyenNghi.length > 0)
    ok('MỌI khuyến nghị đều nêu đánh đổi', r.khuyenNghi.every(k => k.danhDoi && k.danhDoi.length > 20),
        r.khuyenNghi.filter(k => !k.danhDoi || k.danhDoi.length <= 20).map(k => k.ma))
    ok('mọi khuyến nghị đều nói vì sao', r.khuyenNghi.every(k => k.viSao && k.viSao.length > 20))

    console.log('\n▶ Độ nhạy giá — chỉ được kết luận khi giá THỰC SỰ có đổi\n')

    /* Kho khoDay bán mọi thứ ở một mức giá cố định → không có gì để so, phải
     * nói thẳng là không đo được thay vì trả một con số cho có. */
    ok('giá không đổi → KHÔNG kết luận độ nhạy giá', !r.doNhayGia.duocKetLuan, r.doNhayGia.matHang.map(m => m.ten))
    ok('… và lý do nói rõ phải thử đổi giá mới đo được',
        !!r.doNhayGia.lyDo && /đổi giá|không đổi/.test(r.doNhayGia.lyDo), r.doNhayGia.lyDo)

    /* Kho có đổi giá thật: giá đi từ 100k xuống 80k, lượng bán tăng theo đúng
     * quan hệ co giãn -0,5 (ít nhạy). Lib phải đo lại đúng dấu và đúng nhóm. */
    const khoDoiGia: Kho = { transactions: [], products: [{ id: 'E1', name: 'Hàng thử giá', costPrice: 50_000 }] }
    for (let i = 0; i < 28; i++) {
        const gia = 100_000 - (i % 5) * 5_000            // 100k, 95k, 90k, 85k, 80k
        /* Sản lượng nền phải LỚN: nếu để 10 cái/ngày thì phép làm tròn nuốt hết
         * tín hiệu (10 hay 11 cái) và phép đo sẽ không thấy gì — đúng như lần
         * dựng fixture đầu tiên đã dính. */
        const luong = Math.max(1, Math.round(200 * Math.pow(gia / 100_000, -0.5)))
        const ngay = `2026-05-${String(i + 1).padStart(2, '0')}`
        khoDoiGia.transactions.push(don(ngay, 10, [['E1', luong, gia]]))
    }
    const rGia = await coHoiTangTruong(fakePrisma(khoDoiGia), KY)
    ok('có đổi giá → đo được độ nhạy', rGia.doNhayGia.duocKetLuan, rGia.doNhayGia.lyDo)
    const e1 = rGia.doNhayGia.matHang.find(m => m.productId === 'E1')
    ok('độ co giãn mang dấu ÂM (giá lên thì bán ít đi)', !!e1 && e1.doCoGian < 0, e1?.doCoGian)
    ok('đo ra xấp xỉ -0,5 đúng như dữ liệu dựng', !!e1 && Math.abs(e1.doCoGian + 0.5) < 0.25, e1?.doCoGian)
    ok('xếp đúng nhóm "ít nhạy"', e1?.nhay === 'ít nhạy', e1?.nhay)
    ok('mặt hàng ít nhạy → tăng giá 5% thì doanh thu tăng', (e1?.tang5.doanhThu ?? -1) > 0, e1?.tang5)
    ok('… và lợi nhuận tăng mạnh hơn doanh thu (vì giá vốn không đổi)',
        (e1?.tang5.loiNhuan ?? 0) > (e1?.tang5.doanhThu ?? 0), [e1?.tang5.loiNhuan, e1?.tang5.doanhThu])
    ok('luôn kèm cảnh báo tương quan ≠ nhân quả', /tương quan/i.test(rGia.doNhayGia.canhBao), rGia.doNhayGia.canhBao)
    ok('khuyến nghị giá có nêu đánh đổi', rGia.khuyenNghi.filter(k => k.ma === 'gia').every(k => k.danhDoi.length > 30))

    console.log('\n▶ Truy vấn hỏng — KHÔNG được quy thành "cửa hàng không có gì"\n')

    const hongTx = await coHoiTangTruong(fakePrisma(khoDay(), { transaction: true }), KY)
    ok('đọc hỏng bảng đơn hàng → không sập', !!hongTx.ky)
    ok('… ghi vào mục thiếu', hongTx.thieu.length > 0, hongTx.thieu)
    ok('… và KHÔNG đưa ra khuyến nghị nào', hongTx.khuyenNghi.length === 0, hongTx.khuyenNghi.map(k => k.ma))

    const hongSp = await coHoiTangTruong(fakePrisma(khoDay(), { product: true }), KY)
    ok('mất giá vốn → vẫn phân tích được doanh thu', hongSp.quyMo.doanhThu > 0)
    ok('… nhưng nói rõ lãi chưa dùng được, không im lặng để 0',
        hongSp.ghiChu.some(g => g.includes('giá vốn')), hongSp.ghiChu)
    ok('… và không so biên lãi sỉ/lẻ bằng số rỗng',
        hongSp.siLe.nhom.every(n => n.bienLai === null), hongSp.siLe.nhom.map(n => n.bienLai))

    console.log('\n▶ Không có tín hiệu thật — không được bịa combo\n')

    /* Mỗi đơn một món khác nhau: không có cặp nào đi cùng nhau. Nếu lib vẫn trả
     * về combo thì nó đang đọc nhiễu thành tín hiệu. */
    const roiRac: Kho = {
        transactions: Array.from({ length: 200 }, (_, i) =>
            don(`2026-05-${String((i % 28) + 1).padStart(2, '0')}`, 10, [[`X${i % 40}`, 1, 50_000]])),
        products: Array.from({ length: 40 }, (_, i) => ({ id: `X${i}`, name: 'Hàng ' + i, costPrice: 30_000 })),
    }
    const rr = await coHoiTangTruong(fakePrisma(roiRac), KY)
    ok('giỏ hàng một món → không dựng combo', rr.banKem.cap.length === 0, rr.banKem.cap.length)
    ok('… và nói thẳng combo không phải đòn bẩy ở đây', !!rr.banKem.lyDo)
    ok('… không có khuyến nghị combo', !rr.khuyenNghi.some(k => k.ma === 'combo'))

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
