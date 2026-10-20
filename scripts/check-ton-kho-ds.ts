/**
 * Bộ soát DANH SÁCH TỒN KHO trang Kho — lib/danhSachTonKho.ts (GET /api/inventory/ton-kho, 20/10/2026).
 * Hàm thuần, không DB. Đã chạy thử CHỈ ĐỌC trên prod 20/10/2026: HUTI 3.610 mã, KENGISTORE 3.263 mã — đếm theo trạng thái khớp
 * /overview, 150–200 ms/lượt; trang Kho cũ chỉ tải được 1.000 mã.
 */
import { docThamSoTonKho, cauTonKho, boDauTim, CO_DAU, KHONG_DAU } from '../src/lib/danhSachTonKho'

let loi = 0
const dung = (ten: string, dk: boolean, chiTiet?: unknown) => {
    if (dk) console.log(`✓ ${ten}`)
    else { loi++; console.log(`✗ ${ten}`, chiTiet === undefined ? '' : JSON.stringify(chiTiet)) }
}
const soThamSo = (sql: string) => Math.max(0, ...Array.from(sql.matchAll(/\$(\d+)/g)).map(m => Number(m[1])))

// 1. đọc tham số
const md = docThamSoTonKho({})
dung('mặc định: trang 1, 50 dòng, tồn tăng dần, không lọc', md.trang === 1 && md.soDong === 50 && md.sapXep === 'ton' && md.chieu === 'asc' && md.trangThai === '' && md.q === '' && md.khoId === null, md)
const la = docThamSoTonKho({ soDong: '100000', trang: '-5', sapXep: 'DROP TABLE', trangThai: 'xyz', chieu: 'sideways', tonTu: 'abc', tonDen: '', giaTriTu: '1e6' })
dung('chặn tham số lạ: ≤100 dòng, trang ≥1, sắp xếp / trạng thái lạ ⇒ mặc định, số hỏng ⇒ bỏ',
    la.soDong === 100 && la.trang === 1 && la.sapXep === 'ton' && la.trangThai === '' && la.chieu === 'asc' && la.tonTu === null && la.tonDen === null && la.giaTriTu === 1e6, la)

// 2. câu mặc định
const c0 = cauTonKho(md)
dung('mặc định: không tham số, không lọc ngoài, ORDER BY tồn tăng, LIMIT 50 OFFSET 0, bỏ dịch vụ + mã đã gộp',
    c0.tham.length === 0 && !/\) WHERE |FROM ds WHERE/.test(c0.sqlDong) && /ORDER BY ton ASC, ten ASC, id ASC LIMIT 50 OFFSET 0$/.test(c0.sqlDong)
    && c0.sqlTong.includes(`<> 'service'`) && c0.sqlTong.includes('"mergedIntoId" IS NULL') && !c0.theoKho && !c0.theoChiNhanh)

// 3. chống chèn SQL: mọi giá trị người dùng chỉ nằm trong mảng tham số
const doc = `'; DROP TABLE "Product"; --`
const c1 = cauTonKho(docThamSoTonKho({ q: doc, danhMuc: `a'b,${doc}`, khoId: `k'; --`, tonTu: '5', giaTriDen: '9' }))
dung('chống chèn SQL: chuỗi người gõ / id danh mục / id kho chỉ ở tham số, không lọt vào câu SQL',
    !c1.sqlTong.includes('DROP') && !c1.sqlDong.includes('DROP') && !c1.sqlDong.includes(`a'b`) && !c1.sqlDong.includes(`k'`)
    && c1.tham.includes(`a'b`) && c1.tham.includes(doc) && c1.tham.includes(`k'; --`))
dung('đánh số tham số liền mạch, hai câu dùng cùng bộ ($1..$n = độ dài mảng)',
    soThamSo(c1.sqlTong) === c1.tham.length && soThamSo(c1.sqlDong) === c1.tham.length, { tong: soThamSo(c1.sqlTong), dong: soThamSo(c1.sqlDong), n: c1.tham.length })
dung('khoảng tồn / giá trị ép kiểu float8', /ton >= \$\d+::float8/.test(c1.sqlTong) && /"giaTri" <= \$\d+::float8/.test(c1.sqlTong))

// 4. trạng thái = vị từ lib/tonKho.ts trên tồn đang xem
const vt = (tt: string) => cauTonKho(docThamSoTonKho({ trangThai: tt })).sqlTong
dung('trạng thái: hết = tồn ≤ 0 · sắp hết = 0 < tồn ≤ tối thiểu · còn = tồn > tối thiểu · âm = tồn < 0',
    vt('het').includes('WHERE ton <= 0') && vt('sap-het').includes('WHERE ton > 0 AND ton <= "tonToiThieu"')
    && vt('con').includes('WHERE ton > "tonToiThieu"') && vt('am').includes('WHERE ton < 0'))

// 5. sắp xếp + phân trang
const sx = (o: any) => cauTonKho(docThamSoTonKho(o)).sqlDong
dung('sắp xếp: giá trị giảm · tên tăng · mới nhất; trang 3 × 20 dòng ⇒ OFFSET 40',
    sx({ sapXep: 'gia-tri', chieu: 'desc' }).includes('ORDER BY "giaTri" DESC') && sx({ sapXep: 'ten' }).includes('ORDER BY ten ASC')
    && sx({ sapXep: 'moi', chieu: 'desc' }).includes('ORDER BY "taoLuc" DESC') && /LIMIT 20 OFFSET 40$/.test(sx({ trang: '3', soDong: '20' })))

// 6. kho / chi nhánh
const k = cauTonKho(docThamSoTonKho({ khoId: 'kho-1' }))
const tsCn = docThamSoTonKho({}); tsCn.khoChiNhanhId = 'kho-cn'
const cn = cauTonKho(tsCn)
const tsCa = docThamSoTonKho({ khoId: 'kho-1' }); tsCa.khoChiNhanhId = 'kho-cn'
const ca = cauTonKho(tsCa)
dung('lọc kho: JOIN chỉ mã có tồn ≠ 0 ở kho đó, tồn = WarehouseStock', k.sqlTong.includes('JOIN "WarehouseStock" ws ON') && k.sqlTong.includes('ws.quantity <> 0') && k.sqlTong.includes('(ws.quantity)::float8 AS ton') && k.theoKho && k.tham[0] === 'kho-1')
dung('chi nhánh: LEFT JOIN kho chính, mọi mã, tồn thiếu dòng = 0', cn.sqlTong.includes('LEFT JOIN "WarehouseStock" ws') && cn.sqlTong.includes('COALESCE(ws.quantity, 0)') && cn.theoChiNhanh && !cn.theoKho)
dung('chọn kho thì bỏ qua kho chi nhánh', ca.theoKho && !ca.theoChiNhanh && !ca.tham.includes('kho-cn'))

// 7. tìm không dấu
dung('bảng bỏ dấu: thường + HOA cùng độ dài với bảng không dấu (translate lệch là ra chữ sai)', CO_DAU.length === KHONG_DAU.length && CO_DAU.length === 134, { a: CO_DAU.length, b: KHONG_DAU.length })
const translateJs = (s: string, tu: string, sang: string) => Array.from(s).map(ch => { const i = Array.from(tu).indexOf(ch); return i < 0 ? ch : Array.from(sang)[i] }).join('')
const tu = ['Nồi Cơm Điện Sunhouse', 'ĐÈN LED ỐP TRẦN', 'Ấm siêu tốc', 'Quạt đứng Senko', 'Bút lông dầu', 'Ổ cắm điện', 'Máy lọc nước R.O', 'ỷ ỹ ự ữ ợ ỡ']
const lech = tu.filter(w => translateJs(w.toLowerCase(), CO_DAU, KHONG_DAU) !== boDauTim(w))
dung('translate(lower(tên)) mô phỏng = boDauTim(tên) trên tên hàng thật (Đ/đ, Ổ, Ấm, ỹ…)', lech.length === 0, lech.map(w => [w, translateJs(w.toLowerCase(), CO_DAU, KHONG_DAU), boDauTim(w)]))
dung('boDauTim: "Nồi Cơm ĐIỆN" ⇒ "noi com dien"; chữ đã không dấu giữ nguyên', boDauTim('Nồi Cơm ĐIỆN') === 'noi com dien' && boDauTim('noi com') === 'noi com')
const cq = cauTonKho(docThamSoTonKho({ q: 'Nồi 50%_' }))
dung('tìm: tên so KHÔNG DẤU qua translate, SKU/mã vạch so nguyên chuỗi; %, _ người gõ được thoát',
    cq.sqlTong.includes('translate(lower(p.name)') && cq.tham.includes('%noi 50\\%\\_%') && cq.tham.includes('%Nồi 50\\%\\_%') && cq.tham.includes(CO_DAU) && cq.tham.includes(KHONG_DAU)
    && soThamSo(cq.sqlTong) === cq.tham.length, cq.tham)

console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
if (loi) process.exitCode = 1
