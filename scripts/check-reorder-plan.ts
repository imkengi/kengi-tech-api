/**
 * Kiểm chứng ĐIỂM ĐẶT HÀNG TÍNH TỪ DỮ LIỆU BÁN.
 *
 * Chạy:  npx tsx scripts/check-reorder-plan.ts
 *
 * Module này bảo người ta bỏ tiền nhập hàng. Đề xuất thừa thì kẹt vốn, đề xuất
 * thiếu thì đứt hàng giữa mùa. Bộ test soi ba nhóm:
 *  - công thức phải đúng (kiểm bằng số tính tay, không phải bằng "trông hợp lý");
 *  - dữ liệu mỏng thì PHẢI từ chối tính chứ không hạ ngưỡng;
 *  - đọc hỏng bảng thì không được biến thành "hàng không bán được".
 */

import { keHoachDatHang, HE_SO_Z } from '../src/lib/reorderPlan'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

interface Kho {
    /** productId → chuỗi số lượng bán mỗi ngày (dài bằng số ngày lịch sử). */
    ban: Record<string, number[]>
    hang: any[]
    /** productId → supplierId */
    nguon?: Record<string, string>
    /** supplierId → mảng số ngày chờ của các đơn đã nhận */
    cho?: Record<string, number[]>
    /** productId → số lượng đang về */
    dangVe?: Record<string, number>
    choBanAm?: boolean
    /** Cửa hàng bán lần đầu cách đây bao nhiêu ngày (null = lâu hơn kỳ đang xét). */
    tuoiCuaHang?: number | null
}

function fakePrisma(k: Kho, loi?: { ban?: boolean; hang?: boolean; dangVe?: boolean; caiDat?: boolean }) {
    return {
        $queryRawUnsafe: async (sql: string) => {
            if (/FROM "TransactionItem"/.test(sql)) {
                if (loi?.ban) throw new Error('relation "TransactionItem" does not exist')
                return Object.entries(k.ban).map(([productId, ds]) => ({
                    productId,
                    tong: ds.reduce((s, v) => s + v, 0),
                    tongBinhPhuong: ds.reduce((s, v) => s + v * v, 0),
                    soNgayCoBan: ds.filter(v => v > 0).length,
                    /* Giao dịch đầu tiên của CẢ cửa hàng — cùng giá trị trên mọi
                     * dòng, đúng như scalar subquery bên SQL thật. */
                    banDauTien: k.tuoiCuaHang == null ? null
                        : new Date(Date.now() - k.tuoiCuaHang * 86400_000).toISOString(),
                }))
            }
            if (/FROM "ImportReceiptItem"/.test(sql)) {
                return Object.entries(k.nguon || {}).map(([productId, supplierId]) => ({ productId, supplierId }))
            }
            if (/FROM "PurchaseOrderItem"/.test(sql)) {
                if (loi?.dangVe) throw new Error('column "sku" does not exist')
                return Object.entries(k.dangVe || {}).map(([productId, q]) => ({ productId, q }))
            }
            return []
        },
        product: {
            findMany: async () => {
                if (loi?.hang) throw new Error('relation "Product" does not exist')
                return k.hang
            },
        },
        /* Cài đặt kho: cửa hàng có CỐ Ý cho bán khi hết tồn không. Mặc định
         * không — để các ca cũ giữ nguyên hành vi. */
        storeSettings: {
            findFirst: async () => {
                if (loi?.caiDat) throw new Error('The table `StoreSettings` does not exist')
                return { allowNegativeStock: k.choBanAm ?? false }
            },
        },
        purchaseOrder: {
            findMany: async () => {
                const ra: any[] = []
                for (const [supplierId, ds] of Object.entries(k.cho || {})) {
                    for (const n of ds) {
                        const nhan = new Date('2026-07-01T00:00:00Z')
                        ra.push({
                            supplierId, supplierName: 'NCC ' + supplierId,
                            createdAt: new Date(nhan.getTime() - n * 86400_000),
                            receivedDate: nhan,
                        })
                    }
                }
                return ra
            },
        },
    }
}

const hangMau = (id: string, sua: any = {}) => ({
    id, name: 'Hàng ' + id, sku: 'SKU' + id, stock: 100, minStock: 5,
    costPrice: 50_000, sellingPrice: 80_000, ...sua,
})

/** Chuỗi bán đều: đúng `moiNgay` cái mỗi ngày trong `soNgay` ngày. */
const deu = (moiNgay: number, soNgay: number) => Array(soNgay).fill(moiNgay)

async function main() {
    const N = 90

    console.log('\n▶ Công thức — kiểm bằng số tính tay\n')

    /* Bán đều 10 cái/ngày → độ dao động = 0 → tồn an toàn = 0,
     * điểm đặt hàng = 10 × 7 ngày chờ = 70. */
    const r1 = await keHoachDatHang(fakePrisma({
        ban: { P1: deu(10, N) },
        hang: [hangMau('P1', { stock: 500 })],
    }), { soNgayLichSu: N, soNgayChoMacDinh: 7 })
    const m1 = [...r1.canDat, ...r1.hetHang].find(m => m.productId === 'P1')
        || (await keHoachDatHang(fakePrisma({ ban: { P1: deu(10, N) }, hang: [hangMau('P1', { stock: 500 })] }), { soNgayLichSu: N })).canDat[0]
    // Mã tồn 500 thì "đủ hàng", không nằm trong ba danh sách — kiểm qua bản tồn thấp:
    const r1b = await keHoachDatHang(fakePrisma({
        ban: { P1: deu(10, N) },
        hang: [hangMau('P1', { stock: 50 })],
    }), { soNgayLichSu: N, soNgayChoMacDinh: 7, chuKyDat: 7 })
    const p1 = r1b.canDat[0]
    ok('bán đều → độ dao động bằng 0', p1?.doDaoDong === 0, p1?.doDaoDong)
    ok('… nên tồn an toàn bằng 0', p1?.tonAnToan === 0, p1?.tonAnToan)
    ok('bán 10/ngày, chờ 7 ngày → điểm đặt hàng 70', p1?.diemDatHang === 70, p1?.diemDatHang)
    ok('tồn 50 < điểm đặt 70 → cờ "cần đặt ngay"', p1?.co === 'can-dat-ngay', p1?.co)
    ok('còn bán được 5 ngày', p1?.conBanDuoc === 5, p1?.conBanDuoc)
    /* Cần có = 10 × (7 chờ + 7 chu kỳ) + 0 = 140; đang có 50 → đặt 90. */
    ok('nên đặt 90 cái', p1?.nenDat === 90, p1?.nenDat)
    ok('tiền cần bỏ = 90 × 50.000 = 4,5tr', p1?.tienCanBo === 4_500_000, p1?.tienCanBo)

    /* Hàng đang về phải được TRỪ ra, nếu không sẽ đặt chồng đơn.
     * 15 cái đang về: tồn+đang về = 65, vẫn dưới điểm đặt 70 nên vẫn phải đặt,
     * nhưng số cần đặt giảm đúng 15 (từ 90 xuống 75). */
    const r1c = await keHoachDatHang(fakePrisma({
        ban: { P1: deu(10, N) },
        hang: [hangMau('P1', { stock: 50 })],
        dangVe: { P1: 15 },
    }), { soNgayLichSu: N, soNgayChoMacDinh: 7, chuKyDat: 7 })
    ok('trừ hàng đang về khỏi số cần đặt', r1c.canDat[0]?.nenDat === 75, r1c.canDat[0]?.nenDat)

    /* Đủ hàng đang về thì KHÔNG giục đặt nữa — đây là chỗ dễ sinh đơn chồng đơn:
     * tồn 50 + về 40 = 90 đã vượt điểm đặt 70. */
    const r1d = await keHoachDatHang(fakePrisma({
        ban: { P1: deu(10, N) },
        hang: [hangMau('P1', { stock: 50 })],
        dangVe: { P1: 40 },
    }), { soNgayLichSu: N, soNgayChoMacDinh: 7, chuKyDat: 7 })
    ok('hàng về đủ qua điểm đặt → không giục đặt thêm', r1d.canDat.length === 0, r1d.canDat.map(m => m.ten))

    console.log('\n▶ Hàng bán thất thường phải trữ dày hơn hàng bán đều\n')

    /* Hai mã CÙNG mức bán trung bình 10/ngày: một mã đều, một mã lúc 0 lúc 20. */
    const thatThuong = Array.from({ length: N }, (_, i) => (i % 2 ? 20 : 0))
    const r2 = await keHoachDatHang(fakePrisma({
        ban: { DEU: deu(10, N), LOAN: thatThuong },
        hang: [hangMau('DEU', { stock: 10 }), hangMau('LOAN', { stock: 10 })],
    }), { soNgayLichSu: N, soNgayChoMacDinh: 7 })
    const deuM = r2.canDat.find(m => m.productId === 'DEU')
    const loan = r2.canDat.find(m => m.productId === 'LOAN')
    ok('hai mã cùng mức bán trung bình', deuM?.banMoiNgay === loan?.banMoiNgay, [deuM?.banMoiNgay, loan?.banMoiNgay])
    ok('nhưng mã thất thường có tồn an toàn DÀY hơn hẳn',
        (loan?.tonAnToan ?? 0) > (deuM?.tonAnToan ?? 0), [deuM?.tonAnToan, loan?.tonAnToan])
    ok('… nên điểm đặt hàng cũng cao hơn', (loan?.diemDatHang ?? 0) > (deuM?.diemDatHang ?? 0))
    ok('… và có cảnh báo giải thích vì sao trữ nhiều',
        !!loan?.canhBao.some(c => /thất thường/.test(c)), loan?.canhBao)

    console.log('\n▶ Mức phục vụ càng cao thì trữ càng dày\n')

    const r95 = await keHoachDatHang(fakePrisma({ ban: { LOAN: thatThuong }, hang: [hangMau('LOAN', { stock: 10 })] }), { soNgayLichSu: N, mucPhucVu: 0.95 })
    const r99 = await keHoachDatHang(fakePrisma({ ban: { LOAN: thatThuong }, hang: [hangMau('LOAN', { stock: 10 })] }), { soNgayLichSu: N, mucPhucVu: 0.99 })
    ok('mức 99% trữ dày hơn mức 95%',
        (r99.canDat[0]?.tonAnToan ?? 0) > (r95.canDat[0]?.tonAnToan ?? 0),
        [r95.canDat[0]?.tonAnToan, r99.canDat[0]?.tonAnToan])
    ok('hệ số z lấy đúng bảng', r95.thamSo.heSoZ === HE_SO_Z['0.95'] && r99.thamSo.heSoZ === HE_SO_Z['0.99'])
    ok('nói rõ đánh đổi của mức phục vụ', r95.ghiChu.some(g => /vốn nằm trong kho/.test(g)), r95.ghiChu)

    console.log('\n▶ Thời gian chờ — đo được thì dùng, không thì nói là mặc định\n')

    const rCho = await keHoachDatHang(fakePrisma({
        ban: { P1: deu(10, N) },
        hang: [hangMau('P1', { stock: 50 })],
        nguon: { P1: 'S1' },
        cho: { S1: [14, 15, 13, 14] },
    }), { soNgayLichSu: N, soNgayChoMacDinh: 7 })
    ok('đo được 14 ngày chờ từ lịch sử', rCho.canDat[0]?.soNgayCho === 14, rCho.canDat[0]?.soNgayCho)
    ok('… và ghi rõ nguồn là đo được', rCho.canDat[0]?.nguonSoNgayCho === 'đo từ lịch sử đặt hàng')
    ok('… điểm đặt hàng tăng theo (10 × 14 = 140)', rCho.canDat[0]?.diemDatHang === 140, rCho.canDat[0]?.diemDatHang)

    /* Chỉ 2 lần nhập thì chưa đủ để nói "nhà cung cấp này giao trong N ngày". */
    const rChoIt = await keHoachDatHang(fakePrisma({
        ban: { P1: deu(10, N) },
        hang: [hangMau('P1', { stock: 50 })],
        nguon: { P1: 'S1' },
        cho: { S1: [14, 15] },
    }), { soNgayLichSu: N, soNgayChoMacDinh: 7 })
    ok('2 lần nhập → chưa dám kết luận, dùng mặc định',
        rChoIt.canDat[0]?.soNgayCho === 7 && rChoIt.canDat[0]?.nguonSoNgayCho === 'mặc định',
        [rChoIt.canDat[0]?.soNgayCho, rChoIt.canDat[0]?.nguonSoNgayCho])
    ok('… và nói ra là đang tạm dùng mặc định',
        !!rChoIt.canDat[0]?.canhBao.some(c => /tạm dùng/.test(c)), rChoIt.canDat[0]?.canhBao)

    /* Mẫu vô lý (nhận trước ngày đặt, chờ quá 90 ngày) phải bị loại. */
    const rChoBan = await keHoachDatHang(fakePrisma({
        ban: { P1: deu(10, N) },
        hang: [hangMau('P1', { stock: 50 })],
        nguon: { P1: 'S1' },
        cho: { S1: [14, 14, 14, -5, 200] },
    }), { soNgayLichSu: N, soNgayChoMacDinh: 7 })
    ok('loại mẫu vô lý, vẫn ra 14 ngày', rChoBan.canDat[0]?.soNgayCho === 14, rChoBan.canDat[0]?.soNgayCho)

    console.log('\n▶ Hết hàng — phải báo và phải nói nhu cầu thật cao hơn\n')

    const rHet = await keHoachDatHang(fakePrisma({
        ban: { P1: deu(10, N) },
        hang: [hangMau('P1', { stock: 0 })],
    }), { soNgayLichSu: N })
    ok('tồn 0 → cờ hết hàng', rHet.hetHang[0]?.co === 'het-hang')
    ok('ước tính mất 300k lãi mỗi ngày (10 × 30.000)', rHet.hetHang[0]?.matMoiNgay === 300_000, rHet.hetHang[0]?.matMoiNgay)
    ok('cảnh báo sức bán đo được đã bị kéo xuống',
        !!rHet.hetHang[0]?.canhBao.some(c => /nhu cầu thật cao hơn/.test(c)), rHet.hetHang[0]?.canhBao)
    ok('ghi chú chung cũng nhắc giới hạn này', rHet.ghiChu.some(g => /thấp hơn nhu cầu thật/.test(g)))

    console.log('\n▶ Dữ liệu mỏng — PHẢI từ chối tính, không bịa\n')

    const banIt = Array(N).fill(0); banIt[0] = 3; banIt[1] = 2; banIt[2] = 1
    const rMong = await keHoachDatHang(fakePrisma({
        ban: { P1: banIt },
        hang: [hangMau('P1', { stock: 20 })],
    }), { soNgayLichSu: N })
    const mong = [...rMong.canDat, ...rMong.hetHang, ...rMong.tonDong].find(m => m.productId === 'P1')
    ok('3 ngày có bán → KHÔNG xếp vào danh sách cần đặt', !mong || mong.co === 'chua-du-lich-su', mong?.co)
    ok('… được đếm riêng ở mục chưa đủ lịch sử', rMong.tomTat.soMaChuaDuLichSu === 1, rMong.tomTat)

    console.log('\n▶ Hàng đọng vốn — nhận ra và quy ra tiền\n')

    const rDong = await keHoachDatHang(fakePrisma({
        ban: { P1: deu(10, N) },
        hang: [hangMau('P1', { stock: 50 }), hangMau('P2', { stock: 200, costPrice: 30_000 })],
    }), { soNgayLichSu: N })
    const dong = rDong.tonDong.find(m => m.productId === 'P2')
    ok('mã không bán được món nào → cờ tồn đọng', dong?.co === 'ton-dong', dong?.co)
    ok('quy ra vốn kẹt 200 × 30.000 = 6tr', dong?.vonKet === 6_000_000, dong?.vonKet)
    ok('tổng vốn kẹt vào bảng tóm tắt', rDong.tomTat.vonKetODongHang === 6_000_000, rDong.tomTat.vonKetODongHang)
    ok('KHÔNG đề xuất đặt thêm hàng đọng', dong?.nenDat === 0, dong?.nenDat)

    console.log('\n▶ Tồn ÂM — lệch sổ sách, không phải nhu cầu chưa đáp ứng\n')

    /* Ca lộ ra khi chạy trên dữ liệu thật 14/08/2026: một cửa hàng có 286 mã tồn
     * âm, sâu nhất -557, và bảng đề xuất báo "cần bỏ ngay 2,5 TỶ" vì công thức
     * `canCo - ton - ve` cộng thẳng phần âm vào lượng đặt — như thể có 557 khách
     * đang xếp hàng chờ. */
    const tonAm = await keHoachDatHang(fakePrisma({
        ban: { A1: Array.from({ length: 90 }, () => 5) },
        hang: [{ id: 'A1', name: 'Hàng tồn âm', sku: 'A1', stock: -500, costPrice: 100_000, sellingPrice: 150_000, categoryId: null }],
    }))
    const mA = [...tonAm.hetHang, ...tonAm.canDat, ...tonAm.tonDong].find(m => m.productId === 'A1')
    ok('tồn âm KHÔNG bị cộng vào lượng nên đặt', !!mA && mA.nenDat < 200, mA?.nenDat)
    ok('… nên tiền cần bỏ không bị thổi lên', tonAm.tomTat.tienCanBoNgay < 20_000_000, tonAm.tomTat.tienCanBoNgay)
    ok('đếm riêng số mã tồn âm', tonAm.tomTat.soMaTonAm === 1, tonAm.tomTat.soMaTonAm)
    ok('… và tổng phần âm', tonAm.tomTat.tongTonAm === -500, tonAm.tomTat.tongTonAm)
    ok('cảnh báo tại mã nói rõ là lệch sổ sách',
        !!mA && mA.canhBao.some(c => /lệch sổ sách/.test(c)), mA?.canhBao)
    ok('ghi chú tổng bảo đi SOÁT KHO chứ không phải đặt hàng',
        tonAm.ghiChu.some(g => /soát kho, không phải đặt hàng/.test(g)), tonAm.ghiChu)
    ok('… và nói rõ vì sao: cửa hàng KHÔNG bật cho bán âm',
        tonAm.ghiChu.some(g => /KHÔNG bật cho phép bán âm/.test(g)), tonAm.ghiChu)

    /* Cửa hàng CỐ Ý cho bán khi hết tồn: tồn âm là bán trước, không phải lệch sổ.
     * Ghi chú tổng phải nói cùng điều với cảnh báo từng mã — nếu không thì cùng
     * một màn hình lại nói hai kiểu. */
    const tonAmCoY = await keHoachDatHang(fakePrisma({
        ban: { A1: Array.from({ length: 90 }, () => 5) },
        hang: [{ id: 'A1', name: 'Hàng tồn âm', sku: 'A1', stock: -500, costPrice: 100_000, sellingPrice: 150_000, categoryId: null }],
        choBanAm: true,
    }))
    ok('cửa hàng cho bán âm → KHÔNG gọi là lệch sổ sách',
        !tonAmCoY.ghiChu.some(g => /lệch sổ sách/.test(g)), tonAmCoY.ghiChu)
    ok('… mà nói là bán trước, hàng về sẽ bù',
        tonAmCoY.ghiChu.some(g => /hàng về sẽ bù/.test(g)), tonAmCoY.ghiChu)
    ok('… vẫn bỏ qua phần âm khi tính số nên đặt',
        [...tonAmCoY.hetHang, ...tonAmCoY.canDat].find(m => m.productId === 'A1')!.nenDat < 200)

    /* Không đọc được cài đặt thì KHÔNG được sập cả báo cáo — một dòng ghi chú
     * không đáng để mất toàn bộ bảng đặt hàng. */
    const hongCaiDat = await keHoachDatHang(fakePrisma({
        ban: { A1: Array.from({ length: 90 }, () => 5) },
        hang: [{ id: 'A1', name: 'Hàng tồn âm', sku: 'A1', stock: -500, costPrice: 100_000, sellingPrice: 150_000, categoryId: null }],
    }, { caiDat: true }))
    ok('đọc hỏng cài đặt kho → báo cáo vẫn chạy', hongCaiDat.tomTat.soMaXet > 0, hongCaiDat.tomTat)

    const tonDuong = await keHoachDatHang(fakePrisma({
        ban: { B1: Array.from({ length: 90 }, () => 5) },
        hang: [{ id: 'B1', name: 'Hàng bình thường', sku: 'B1', stock: 10, costPrice: 100_000, sellingPrice: 150_000, categoryId: null }],
    }))
    ok('không có tồn âm → KHÔNG dựng ghi chú thừa',
        tonDuong.tomTat.soMaTonAm === 0 && !tonDuong.ghiChu.some(g => /soát kho, không phải đặt hàng/.test(g)))

    console.log('\n▶ Đọc hỏng bảng — không được biến thành "hàng không bán được"\n')

    const rHong = await keHoachDatHang(fakePrisma({
        ban: { P1: deu(10, N) },
        hang: [hangMau('P1', { stock: 200 })],
    }, { ban: true }), { soNgayLichSu: N })
    ok('hỏng bảng bán → ghi vào mục thiếu', rHong.thieu.length > 0, rHong.thieu)
    ok('… KHÔNG kết luận 200 cái là hàng đọng vốn',
        rHong.tonDong.length === 0, rHong.tonDong.map(m => m.ten))

    const rHongVe = await keHoachDatHang(fakePrisma({
        ban: { P1: deu(10, N) },
        hang: [hangMau('P1', { stock: 50 })],
    }, { dangVe: true }), { soNgayLichSu: N })
    ok('hỏng bảng hàng đang về → vẫn tính được, nhưng nói rõ có thể đặt dư',
        rHongVe.canDat.length === 1 && rHongVe.ghiChu.some(g => /cao hơn thực tế/.test(g)), rHongVe.ghiChu)

    console.log('\n▶ Nhu cầu giật cục — một cú sỉ không được quyết định cả đơn hàng\n')
    /** Bán thưa: hầu hết ngày bằng 0, thỉnh thoảng một đơn sỉ lớn. */
    const giatCuc = (soNgay: number, cuSi: number, moiBaoNhieuNgay: number) =>
        Array.from({ length: soNgay }, (_, i) => (i % moiBaoNhieuNgay === 0 ? cuSi : 0))
    {
        // 90 ngày, cứ 10 ngày một đơn 60 cái → mu = 6/ngày nhưng sigma rất lớn
        const r = await keHoachDatHang(fakePrisma({
            ban: { P1: giatCuc(N, 60, 10) },
            hang: [hangMau('P1', { stock: 5 })],
        }), { soNgayLichSu: N, soNgayChoMacDinh: 7, chuKyDat: 7 })
        const m = r.canDat[0] || r.hetHang[0]
        ok('nhận ra nhu cầu giật cục', !!m && m.nhuCauGiatCuc === true, m && [m.banMoiNgay, m.doDaoDong])
        ok('tồn an toàn bị chặn ở đúng một quãng chờ nhu cầu trung bình',
            !!m && m.tonAnToan === Math.ceil(m.banMoiNgay * 7), m && [m.tonAnToan, m.banMoiNgay])
        ok('nói rõ đã chặn và công thức gốc đòi bao nhiêu',
            !!m && m.canhBao.some((c: string) => /Công thức tồn an toàn đòi trữ/.test(c)), m?.canhBao)
        ok('câu cảnh báo bảo đặt theo đơn khách đã chốt',
            !!m && m.canhBao.some((c: string) => /đơn sỉ nữa thì đặt thêm/.test(c)), m?.canhBao)
        ok('ghi chú tổng nêu tỷ trọng tiền của nhóm giật cục',
            r.ghiChu.some(g => /nhu cầu GIẬT CỤC/.test(g) && /% số tiền đề xuất/.test(g)), r.ghiChu)
        ok('tổng có tách riêng phần tiền giật cục',
            r.tomTat.soMaGiatCuc === 1 && r.tomTat.tienCanBoNgayGiatCuc > 0,
            [r.tomTat.soMaGiatCuc, r.tomTat.tienCanBoNgayGiatCuc])
    }
    {
        /* Bán ĐỀU thì tuyệt đối không được đụng vào: chặn nhầm nhóm này là bảo
         * người ta trữ thiếu, đứt hàng ngay giữa quãng chờ. */
        const r = await keHoachDatHang(fakePrisma({
            ban: { P1: deu(10, N) },
            hang: [hangMau('P1', { stock: 5 })],
        }), { soNgayLichSu: N, soNgayChoMacDinh: 7, chuKyDat: 7 })
        const m = r.canDat[0] || r.hetHang[0]
        ok('bán đều thì KHÔNG bị gắn nhãn giật cục', !!m && m.nhuCauGiatCuc === false, m?.nhuCauGiatCuc)
        ok('… và không có ghi chú giật cục nào',
            !r.ghiChu.some(g => /GIẬT CỤC/.test(g)), r.ghiChu)
        ok('… tổng phần giật cục bằng 0',
            r.tomTat.soMaGiatCuc === 0 && r.tomTat.tienCanBoNgayGiatCuc === 0)
    }
    {
        /* Dao động vừa phải (CV² < 0,49) cũng không được chặn — ngưỡng phải
         * bám phân loại Syntetos–Boylan chứ không phải "hễ lệch là chặn". */
        const nhap = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 11 : 9))
        const r = await keHoachDatHang(fakePrisma({
            ban: { P1: nhap },
            hang: [hangMau('P1', { stock: 5 })],
        }), { soNgayLichSu: N, soNgayChoMacDinh: 7, chuKyDat: 7 })
        const m = r.canDat[0] || r.hetHang[0]
        ok('dao động nhẹ quanh mức trung bình không bị coi là giật cục',
            !!m && m.nhuCauGiatCuc === false, m && [m.banMoiNgay, m.doDaoDong])
    }

    console.log('\n▶ Cửa sổ lịch sử có thật — không chia cho ngày cửa hàng chưa tồn tại\n')
    {
        /* Bán 10 cái/ngày suốt 30 ngày, cửa hàng mới mở 30 ngày. Chia cho 90
         * ngày của kỳ sẽ ra 3,33 cái/ngày — hụt 2/3 — rồi đặt thiếu hàng. */
        const ban30 = [...Array(N - 30).fill(0), ...deu(10, 30)]
        const r = await keHoachDatHang(fakePrisma({
            ban: { P1: ban30 },
            hang: [hangMau('P1', { stock: 5 })],
            tuoiCuaHang: 30,
        }), { soNgayLichSu: N, soNgayChoMacDinh: 7, chuKyDat: 7 })
        const m = r.canDat[0] || r.hetHang[0]
        ok('mức bán chia theo số ngày cửa hàng thật sự có dữ liệu',
            !!m && Math.abs(m.banMoiNgay - 10) < 0.35, m?.banMoiNgay)
        ok('trả về số ngày có dữ liệu để đối chiếu được',
            r.ky.soNgayCoDuLieu === 30 && r.ky.soNgay === N, [r.ky.soNgayCoDuLieu, r.ky.soNgay])
        ok('ghi chú nói rõ vì sao không chia cho cả kỳ',
            r.ghiChu.some(g => /chỉ mới có dữ liệu bán khoảng 30 ngày/.test(g)), r.ghiChu)
        ok('bán đều mỗi ngày thì KHÔNG bị xếp là giật cục dù kỳ dài 90 ngày',
            !!m && m.nhuCauGiatCuc === false, [m?.nhuCauGiatCuc, m?.banMoiNgay, m?.doDaoDong])
    }
    {
        // Cửa hàng lâu năm thì giữ nguyên mẫu số của kỳ
        const r = await keHoachDatHang(fakePrisma({
            ban: { P1: deu(10, N) },
            hang: [hangMau('P1', { stock: 5 })],
            tuoiCuaHang: null,
        }), { soNgayLichSu: N, soNgayChoMacDinh: 7, chuKyDat: 7 })
        ok('cửa hàng có dữ liệu dài hơn kỳ thì giữ mẫu số của kỳ',
            r.ky.soNgayCoDuLieu === N && !r.ghiChu.some(g => /chỉ mới có dữ liệu/.test(g)),
            r.ky.soNgayCoDuLieu)
    }
    {
        /* Cửa hàng mới hơn kỳ NHƯNG bán giật cục thật thì vẫn phải bắt được —
         * sửa mẫu số không được làm mất phép phát hiện giật cục. */
        // 6 ngày có bán trong 30 ngày — vừa đủ qua ngưỡng 5 ngày tối thiểu
        const ds = Array.from({ length: N }, (_, i) => (i < N - 30 ? 0 : (i % 5 === 0 ? 60 : 0)))
        const r = await keHoachDatHang(fakePrisma({
            ban: { P1: ds },
            hang: [hangMau('P1', { stock: 5 })],
            tuoiCuaHang: 30,
        }), { soNgayLichSu: N, soNgayChoMacDinh: 7, chuKyDat: 7 })
        const m = r.canDat[0] || r.hetHang[0]
        ok('cửa hàng mới mà bán giật cục thật thì vẫn bị bắt',
            !!m && m.nhuCauGiatCuc === true, [m?.banMoiNgay, m?.doDaoDong])
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
