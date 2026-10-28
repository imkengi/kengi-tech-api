/**
 * Kiểm GIỚI THIỆU SẢN PHẨM MỖI NGÀY qua Zalo — npx tsx scripts/check-zalo-gioi-thieu-sp.ts
 *
 * Chủ shop 28/10/2026: "thêm giới thiệu sản phẩm, sẽ gồm ảnh và 1 vài thông tin sản phẩm để giới thiệu cho khách mỗi ngày".
 * Lõi lib/zaloGioiThieuSp.ts, nối vào lib/zaloLichGui.ts. Sai ở đây là: hai hôm gửi cùng một món khi còn món khác, gửi món
 * hết hàng / không ảnh / ngừng kinh doanh, gửi "Giá: " trống, xem trước làm lệch vòng xoay, nguồn trống mà im lặng.
 * Prisma giả, không gọi Zalo thật.
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'ab'.repeat(32)

import {
    docGioiThieu, dungBienGioiThieu, ungVienGioiThieu, chonSanPhamHomNay, thuTuSapToi, ghiDaGioiThieu, bienGioiThieu, rutGonMoTa,
    TOI_DA_NHO, type GioiThieuSp,
} from '../src/lib/zaloGioiThieuSp'
import { dienMau } from '../src/lib/zaloGui'
import { docDuLieuLich, soanNguoiNhan, chayLich, type LichGui } from '../src/lib/zaloLichGui'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

// ─── Dữ liệu giả ─────────────────────────────────────────────────────────────
const CAT = [
    { id: 'c1', name: 'Sunhouse', parentId: null },
    { id: 'c2', name: 'Bếp Gas', parentId: 'c1' },          // con của c1
    { id: 'c3', name: 'Quạt Senko', parentId: null },
]
const MO_TA_DAI = 'Nồi cơm điện lòng niêu dày 2mm, nấu cơm dẻo thơm. '.repeat(12)   // > 400 ký tự
const SP = [
    { id: 'sp1', name: 'Nồi cơm điện A', sku: 'NCA', sellingPrice: 850000, baseUnit: 'cái', description: MO_TA_DAI, stock: 5, categoryId: 'c1', productType: 'goods', mergedIntoId: null,
      brand: { name: 'Sunhouse' }, category: { name: 'Sunhouse' }, images: [{ url: 'https://img/2.jpg', isPrimary: false }, { url: 'https://img/1.jpg', isPrimary: true }, { url: 'http://khong-https/3.jpg', isPrimary: false }, { url: 'https://img/4.jpg', isPrimary: false }] },
    { id: 'sp2', name: 'Ấm siêu tốc B', sku: 'ASB', sellingPrice: 300000, baseUnit: 'cái', description: 'Ấm 1.8L', stock: 0, categoryId: 'c1', productType: 'goods', mergedIntoId: null,
      brand: null, category: { name: 'Sunhouse' }, images: [{ url: 'https://img/b.jpg', isPrimary: true }] },
    { id: 'sp3', name: 'Bếp gas C', sku: 'BGC', sellingPrice: 0, baseUnit: 'bộ', description: null, stock: 3, categoryId: 'c2', productType: 'goods', mergedIntoId: null,
      brand: null, category: { name: 'Bếp Gas' }, images: [] },
    { id: 'sp4', name: 'Quạt D', sku: 'QD', sellingPrice: 500000, baseUnit: 'cái', description: '[NGỪNG KINH DOANH bên KiotViet] quạt cũ', stock: 2, categoryId: 'c3', productType: 'goods', mergedIntoId: null,
      brand: null, category: { name: 'Quạt Senko' }, images: [{ url: 'https://img/d.jpg', isPrimary: true }] },
    { id: 'sp5', name: 'Máy xay E', sku: 'MXE', sellingPrice: 1200000, baseUnit: 'cái', description: 'Máy xay 2 cối', stock: 1, categoryId: 'c2', productType: 'goods', mergedIntoId: null,
      brand: { name: 'Sunhouse' }, category: { name: 'Bếp Gas' }, images: [{ url: 'https://img/e.jpg', isPrimary: true }] },
    { id: 'sp6', name: 'Dịch vụ lắp đặt', sku: 'DV', sellingPrice: 100000, baseUnit: 'lần', description: null, stock: 0, categoryId: 'c1', productType: 'service', mergedIntoId: null, brand: null, category: null, images: [] },
    { id: 'sp7', name: 'Mã đã gộp', sku: 'GOP', sellingPrice: 100000, baseUnit: 'cái', description: null, stock: 9, categoryId: 'c1', productType: 'goods', mergedIntoId: 'sp1', brand: null, category: null, images: [{ url: 'https://img/g.jpg', isPrimary: true }] },
]
const NHOM = [
    { groupId: '1000000001', customerId: 'k1', tenNhom: 'TS002 Trãi Thu' },
    { groupId: '1000000002', customerId: 'k2', tenNhom: 'TP051 Phú' },
]
const KHACH = [{ id: 'k1', code: 'TS002', name: 'Trãi Thu', debt: 0 }, { id: 'k2', code: 'TP051', name: 'Phú', debt: 0 }]

/** Prisma giả: lọc product.findMany theo where như Prisma; ghi lại SQL ghi trạng thái; không có nhóm chờ gửi */
function giaSp() {
    const st = { dot: [] as any[], dong: [] as any[], thongBao: [] as any[], daGui: null as any, sqlDaGui: 0, lich: [] as any[] }
    const locSp = (where: any) => SP.filter(p => {
        if (where.productType && p.productType !== where.productType) return false
        if ('mergedIntoId' in where && p.mergedIntoId !== where.mergedIntoId) return false
        if (where.id?.in && !where.id.in.includes(p.id)) return false
        if (where.categoryId?.in && !where.categoryId.in.includes(p.categoryId)) return false
        if (where.stock?.gt !== undefined && !(p.stock > where.stock.gt)) return false
        if (where.images?.some && !p.images.length) return false
        return true
    })
    const sp: any = {
        __schema: 'kiem_gioi_thieu',
        $executeRawUnsafe: async (sql: string, ...p: any[]) => {
            if (/UPDATE "ZaloLichGui" SET "gioiThieuDaGui"/.test(sql)) { st.sqlDaGui++; st.daGui = JSON.parse(p[1]); return 1 }
            if (/INSERT INTO "ZaloDotTuyChon"/.test(sql)) return 1
            if (/UPDATE "ZaloLichGui" SET "lanCuoi"/.test(sql)) return 1
            return 0
        },
        $queryRawUnsafe: async (sql: string) => {
            if (/to_regclass/.test(sql)) return [{ co: true }]
            if (/FROM "ZaloPhien"/.test(sql)) return [{ id: 'default', duLieu: 'x', phienSo: 'p', trangThai: 'song', uid: '1', ten: 'T', anh: null, loiCuoi: null, nguoiDangNhap: null, dangNhapLuc: new Date(), dungLuc: null, giuLuc: null }]
            return []
        },
        product: { findMany: async ({ where, take }: any) => locSp(where).slice(0, take || 9999).sort((a, b) => a.name.localeCompare(b.name, 'vi')).map(p => ({ ...p })) },
        category: { findMany: async () => CAT.map(c => ({ ...c })) },
        zaloNhom: { findMany: async ({ where }: any) => NHOM.filter(n => where.groupId ? where.groupId.in.includes(n.groupId) : n.customerId) },
        zaloNhomQuet: { findMany: async () => [] },
        customer: { findMany: async ({ where }: any) => KHACH.filter(k => where.id.in.includes(k.id)) },
        zaloCauHinh: { findUnique: async () => ({ n8nGuiUrl: null, guiMoiPhut: 4 }) },
        zaloDotGui: { create: async ({ data }: any) => { const d = { id: `dot${st.dot.length + 1}`, ...data }; st.dot.push(d); return d } },
        zaloDotGuiNhom: { createMany: async ({ data }: any) => { st.dong.push(...data); return { count: data.length } }, count: async () => 0 },
        kiotVietConfig: { findUnique: async () => null },
        kiotVietSyncLog: { findFirst: async () => null },
        notification: {
            findFirst: async () => null,
            create: async ({ data }: any) => { st.thongBao.push(data); return { id: `tb${st.thongBao.length}` } },
        },
    }
    return { sp, st }
}

const cfgNhom = (x: Partial<GioiThieuSp> = {}): GioiThieuSp => ({ nguon: 'nhom', sanPham: [], categoryIds: ['c1'], chiConHang: true, chiCoAnh: true, soAnh: 2, ...x })
const lichMau = (x: Partial<LichGui> = {}): LichGui => ({
    id: 'lich-gt-1111', ten: 'Giới thiệu sản phẩm mỗi ngày', noiDung: 'Hôm nay: [đậm]{tenSanPham}[/đậm]\nGiá: {giaBan}/{donVi}\n{moTaSanPham}', anh: ['https://x/qr.png'],
    tuyChon: { mucDo: 0, nhacCaNhom: false, tuXoa: 0, henGio: null },
    doiTuong: { loai: 'tat_ca', groupIds: [], chiKhachCoNo: false, noToiThieu: 0 },
    doanhSo: null, gioiThieu: cfgNhom(), gioiThieuDaGui: null, tanSuat: { loai: 'ngay', gio: '09:00' },
    bat: true, lanToi: null, lanCuoi: null, lanCuoiDotId: null, lanCuoiKetQua: null, nguoiTao: null, createdAt: '', updatedAt: '', ...x,
})

async function main() {
    console.log('\n▶ Giới thiệu sản phẩm mỗi ngày qua Zalo\n')

    /* 1 — Đọc cấu hình */
    {
        ok('1a. Không có ⇒ null', docGioiThieu(undefined) === null && docGioiThieu(null) === null)
        ok('1b. Nguồn lạ ⇒ lỗi', typeof docGioiThieu({ nguon: 'x' }) === 'string')
        ok('1c. Chọn từng món mà không có món ⇒ lỗi', typeof docGioiThieu({ nguon: 'chon', sanPham: [] }) === 'string')
        const c = docGioiThieu({ nguon: 'chon', sanPham: [{ id: 'a', name: 'A' }, { id: 'a', name: 'A lặp' }, { id: ' b ', name: 'B' }, { id: '' }], categoryIds: ['c9'] }) as GioiThieuSp
        ok('1d. Chọn từng món: bỏ trùng / rỗng, giữ thứ tự, không giữ nhóm hàng, soAnh mặc định 1', typeof c === 'object' && c.sanPham.map(x => x.id).join(',') === 'a,b' && c.categoryIds.length === 0 && c.soAnh === 1 && c.chiConHang && c.chiCoAnh, c)
        const n = docGioiThieu({ nguon: 'nhom', categoryIds: ['c1', 'c1', ' c2 '], sanPham: [{ id: 'a' }], soAnh: 5, chiConHang: false }) as GioiThieuSp
        ok('1e. Theo nhóm: bỏ trùng, không giữ danh sách món, soAnh kẹp 3, chiConHang false giữ false', typeof n === 'object' && n.categoryIds.join(',') === 'c1,c2' && n.sanPham.length === 0 && n.soAnh === 3 && n.chiConHang === false && n.chiCoAnh === true, n)
        ok('1f. soAnh âm ⇒ 0, chuỗi "2" ⇒ 2', (docGioiThieu({ nguon: 'nhom', soAnh: -2 }) as GioiThieuSp).soAnh === 0 && (docGioiThieu({ nguon: 'nhom', soAnh: '2' }) as GioiThieuSp).soAnh === 2)
        ok('1g. Quá 200 món / quá 50 nhóm ⇒ lỗi',
            typeof docGioiThieu({ nguon: 'chon', sanPham: Array.from({ length: 201 }, (_, i) => ({ id: `p${i}`, name: 'x' })) }) === 'string'
            && typeof docGioiThieu({ nguon: 'nhom', categoryIds: Array.from({ length: 51 }, (_, i) => `c${i}`) }) === 'string')
        ok('1h. Nhận biết biến sản phẩm', dungBienGioiThieu('x {tenSanPham}') && dungBienGioiThieu('{ giaBan }') && !dungBienGioiThieu('{congNo} {doanhSo}'))
    }

    /* 2 — Ứng viên */
    {
        const { sp } = giaSp()
        const uv = await ungVienGioiThieu(sp, cfgNhom())
        ok('2a. Nhóm c1 (mở rộng cả nhóm con c2): còn hàng + có ảnh ⇒ đúng sp1, sp5; loại hết hàng, không ảnh, dịch vụ, mã gộp',
            uv.map(x => x.id).sort().join(',') === 'sp1,sp5', uv.map(x => x.id))
        const uv2 = await ungVienGioiThieu(sp, cfgNhom({ chiConHang: false, chiCoAnh: false }))
        ok('2b. Bỏ hai bộ lọc ⇒ thêm sp2 (hết hàng) và sp3 (không ảnh), vẫn không dịch vụ / mã gộp', uv2.map(x => x.id).sort().join(',') === 'sp1,sp2,sp3,sp5', uv2.map(x => x.id))
        const uv3 = await ungVienGioiThieu(sp, cfgNhom({ categoryIds: ['c3'] }))
        ok('2c. Hàng đánh dấu NGỪNG KINH DOANH bị loại dù đủ điều kiện khác', uv3.length === 0, uv3.map(x => x.id))
        const uv4 = await ungVienGioiThieu(sp, cfgNhom({ categoryIds: [] }))
        ok('2d. Không chọn nhóm = mọi nhóm', uv4.map(x => x.id).sort().join(',') === 'sp1,sp5', uv4.map(x => x.id))
        const uv5 = await ungVienGioiThieu(sp, { nguon: 'chon', sanPham: [{ id: 'sp5', name: '' }, { id: 'sp1', name: '' }, { id: 'sp2', name: '' }], categoryIds: [], chiConHang: true, chiCoAnh: true, soAnh: 1 })
        ok('2e. Chọn từng món: giữ ĐÚNG thứ tự chọn (sp5 trước sp1), sp2 hết hàng bị loại', uv5.map(x => x.id).join(',') === 'sp5,sp1', uv5.map(x => x.id))
        const sp1 = uv.find(x => x.id === 'sp1')!
        ok('2f. Ảnh: đại diện đứng đầu, bỏ link không https', sp1.anh.join(',') === 'https://img/1.jpg,https://img/2.jpg,https://img/4.jpg', sp1.anh)
        ok('2g. Mô tả dài cắt ở ranh giới câu, ≤ 402 ký tự, kết bằng ". …"', !!sp1.moTa && sp1.moTa.length <= 402 && /\. …$/.test(sp1.moTa), { dai: sp1.moTa?.length, duoi: sp1.moTa?.slice(-12) })
        ok('2h. Mô tả ngắn giữ nguyên; rỗng ⇒ null', rutGonMoTa('  Ấm 1.8L\r\n') === 'Ấm 1.8L' && rutGonMoTa('') === null && rutGonMoTa(null) === null)
        const uv6 = await ungVienGioiThieu(sp, cfgNhom({ categoryIds: ['khong-co'] }))
        ok('2i. Nhóm đã xoá ⇒ không ứng viên (không rơi về mọi nhóm)', uv6.length === 0)
    }

    /* 3 — Xoay vòng */
    {
        const uv = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]
        const t0 = '2026-10-26T02:00:00.000Z', t1 = '2026-10-27T02:00:00.000Z', t2 = '2026-10-28T02:00:00.000Z'
        ok('3a. Chưa gửi món nào ⇒ món ĐẦU theo thứ tự', chonSanPhamHomNay(uv, null)?.id === 'A' && chonSanPhamHomNay(uv, {})?.id === 'A')
        ok('3b. Đã gửi A ⇒ B (chưa gửi bao giờ ưu tiên hơn A)', chonSanPhamHomNay(uv, { A: t0 })?.id === 'B')
        ok('3c. Đã gửi A, B ⇒ C', chonSanPhamHomNay(uv, { A: t0, B: t1 })?.id === 'C')
        ok('3d. Hết vòng ⇒ món gửi LÂU NHẤT (A)', chonSanPhamHomNay(uv, { A: t0, B: t1, C: t2 })?.id === 'A')
        ok('3e. Vòng hai: A gửi lại ⇒ B là món lâu nhất', chonSanPhamHomNay(uv, { A: '2026-10-29T02:00:00.000Z', B: t1, C: t2 })?.id === 'B')
        ok('3f. Không ứng viên ⇒ null', chonSanPhamHomNay([], { A: t0 }) === null)
        ok('3g. Giờ gửi hỏng dạng ⇒ coi như chưa gửi', chonSanPhamHomNay(uv, { A: t0, B: 'rác', C: t2 })?.id === 'B')
        ok('3h. Món ngoài danh sách (đã bỏ khỏi nguồn) không ảnh hưởng', chonSanPhamHomNay(uv, { Z: t0, A: t1, B: t2, C: t2 })?.id === 'A')
        ok('3i. Thứ tự sắp tới: chưa gửi trước, rồi lâu nhất; giới hạn n', thuTuSapToi(uv, { A: t0, B: t1 }, 5).map(x => x.id).join(',') === 'C,A,B' && thuTuSapToi(uv, null, 2).map(x => x.id).join(',') === 'A,B')
        const to = Object.fromEntries(Array.from({ length: TOI_DA_NHO + 4 }, (_, i) => [`p${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()]))
        const sau = ghiDaGioiThieu(to, 'moi', new Date('2026-10-28T02:00:00Z'))
        ok(`3j. Sổ "đã gửi" kẹp ${TOI_DA_NHO} món: bỏ món cũ nhất, giữ món vừa ghi`, Object.keys(sau).length === TOI_DA_NHO && !('p0' in sau) && !('p4' in sau) && 'p5' in sau && sau.moi === '2026-10-28T02:00:00.000Z', Object.keys(sau).length)
        ok('3k. Ghi lại không làm hỏng sổ cũ (bản sao)', (() => { const g = { A: t0 }; const s2 = ghiDaGioiThieu(g, 'B', new Date(t1)); return g.B === undefined && s2.A === t0 && s2.B === t1 })())
    }

    /* 4 — Biến + bỏ dòng thiếu dữ liệu */
    {
        const { sp } = giaSp()
        const uv = await ungVienGioiThieu(sp, cfgNhom({ chiConHang: false, chiCoAnh: false }))
        const sp1 = uv.find(x => x.id === 'sp1')!, sp3 = uv.find(x => x.id === 'sp3')!
        const b1 = bienGioiThieu(sp1)
        ok('4a. Biến đủ: tên, mã, giá định dạng đ, đơn vị, mô tả, thương hiệu, nhóm hàng', b1.tenSanPham === 'Nồi cơm điện A' && b1.maSanPham === 'NCA' && b1.giaBan === '850.000đ' && b1.donVi === 'cái' && !!b1.moTaSanPham && b1.thuongHieu === 'Sunhouse' && b1.nhomHangSp === 'Sunhouse', b1)
        const b3 = bienGioiThieu(sp3)
        ok('4b. Giá 0 / không mô tả / không thương hiệu ⇒ KHÔNG đặt biến', !('giaBan' in b3) && !('moTaSanPham' in b3) && !('thuongHieu' in b3) && b3.donVi === 'bộ', b3)
        const mau = 'Hôm nay: {tenSanPham}\nGiá: {giaBan}/{donVi}\n{moTaSanPham}\nHãng: {thuongHieu}\nNhắn Hưng Tín nhé!'
        const tin3 = dienMau(mau, { bien: b3 })
        ok('4c. dienMau bỏ CẢ DÒNG "Giá:", mô tả, hãng khi thiếu — không gửi "Giá: /bộ"', tin3 === 'Hôm nay: Bếp gas C\nNhắn Hưng Tín nhé!', tin3)
        const tin1 = dienMau(mau, { bien: b1 })
        ok('4d. Đủ dữ liệu thì giữ đủ dòng', tin1.startsWith('Hôm nay: Nồi cơm điện A\nGiá: 850.000đ/cái\n') && tin1.includes('Hãng: Sunhouse') && tin1.endsWith('Nhắn Hưng Tín nhé!'), tin1)
    }

    /* 5 — Thân request lịch */
    {
        const goc = { ten: 'GT', doiTuong: { loai: 'tat_ca' }, tanSuat: { loai: 'ngay', gio: '09:00' } }
        ok('5a. Tin có {tenSanPham} mà không chọn nguồn ⇒ lỗi', typeof docDuLieuLich({ ...goc, noiDung: 'Giới thiệu {tenSanPham}' }) === 'string')
        const d = docDuLieuLich({ ...goc, noiDung: 'Giới thiệu {tenSanPham}', gioiThieu: { nguon: 'nhom', categoryIds: ['c1'], soAnh: 3 } })
        ok('5b. Có nguồn ⇒ nhận, giữ cấu hình', typeof d === 'object' && d.gioiThieu?.nguon === 'nhom' && d.gioiThieu.soAnh === 3, d)
        const d2 = docDuLieuLich({ ...goc, noiDung: 'Tin thường' })
        ok('5c. Lịch thường ⇒ gioiThieu null', typeof d2 === 'object' && d2.gioiThieu === null)
        ok('5d. Cấu hình sai ⇒ lỗi của chính nó', typeof docDuLieuLich({ ...goc, noiDung: 'x {tenSanPham}', gioiThieu: { nguon: 'chon', sanPham: [] } }) === 'string')
    }

    /* 6 — Nối vào lịch: soạn, chạy, xoay vòng, không ghi khi xem trước */
    {
        const { sp, st } = giaSp()
        const lich = lichMau()
        const luc = new Date('2026-10-29T02:00:00Z')
        const soan = await soanNguoiNhan(sp, lich, luc)
        const dauTien = soan.gioiThieu?.sanPham?.id
        ok('6a. Soạn: 2 nhóm nhận, cùng MỘT món, biến sản phẩm có trong từng dòng', soan.dong.length === 2 && !!dauTien && soan.dong.every(d => d.bien?.tenSanPham === soan.gioiThieu?.sanPham?.name && d.bien?.giaBan), soan.dong.map(d => d.bien))
        ok('6b. soUngVien = 2, sắp tới liệt kê đủ 2 món, món đầu = món lượt này', soan.gioiThieu?.soUngVien === 2 && soan.gioiThieu?.sapToi.length === 2 && soan.gioiThieu?.sapToi[0]?.id === dauTien, soan.gioiThieu?.sapToi.map(x => x.id))
        ok('6c. Xem trước (soạn) KHÔNG ghi trạng thái', st.sqlDaGui === 0)

        const kq = await chayLich(sp, lich, { bayGio: luc })
        const dot = st.dot[0]
        const anhDot = JSON.parse(dot?.anh || '[]')
        const spDaGui = SP.find(p => p.id === dauTien)!
        ok('6d. Chạy: tạo đợt, không bỏ', !kq.boQua && kq.soNhom === 2 && st.dot.length === 1 && st.dong.length === 2, kq)
        // Ảnh mong đợi: tối đa soAnh = 2 ảnh https của món được chọn, ảnh đại diện trước, rồi tới ảnh QR của lịch
        const anhMong = [...spDaGui.images].filter(i => /^https:\/\//.test(i.url)).sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary)).slice(0, 2).map(i => i.url)
        ok('6e. Ảnh đợt = ảnh sản phẩm (≤ soAnh, đại diện trước) rồi tới ảnh QR của lịch', anhDot.join(',') === [...anhMong, 'https://x/qr.png'].join(','), { anhDot, anhMong })
        ok('6f. Tiêu đề đợt + kết quả nêu tên món', String(dot.tieuDe).includes(spDaGui.name) && kq.ketQua.includes(`giới thiệu "${spDaGui.name}"`), { tieuDe: dot.tieuDe, ketQua: kq.ketQua })
        ok('6g. Ghi trạng thái: đúng món, đúng giờ', st.sqlDaGui === 1 && st.daGui?.[dauTien!] === luc.toISOString(), st.daGui)

        const kq2 = await chayLich(sp, { ...lich, gioiThieuDaGui: st.daGui }, { bayGio: new Date('2026-10-30T02:00:00Z') })
        const dot2 = st.dot[1]
        ok('6h. Lượt sau xoay sang món KHÁC', !kq2.boQua && dot2 && !String(dot2.tieuDe).includes(spDaGui.name) && Object.keys(st.daGui).length === 2, { tieuDe: dot2?.tieuDe, daGui: st.daGui })
        const kq3 = await chayLich(sp, { ...lich, gioiThieuDaGui: st.daGui }, { bayGio: new Date('2026-10-31T02:00:00Z') })
        ok('6i. Hết vòng ⇒ quay lại món đầu', !kq3.boQua && String(st.dot[2]?.tieuDe).includes(spDaGui.name), st.dot[2]?.tieuDe)
    }

    /* 7 — Nguồn trống / lịch thường */
    {
        const { sp, st } = giaSp()
        const lich = lichMau({ gioiThieu: { nguon: 'chon', sanPham: [{ id: 'sp2', name: 'Ấm siêu tốc B' }], categoryIds: [], chiConHang: true, chiCoAnh: true, soAnh: 1 } })
        const kq = await chayLich(sp, lich, { bayGio: new Date('2026-10-29T02:00:00Z') })
        ok('7a. Chỉ chọn món hết hàng ⇒ bỏ lượt, nêu lý do, KHÔNG tạo đợt', kq.boQua && /Không có sản phẩm nào đủ điều kiện/.test(kq.ketQua) && st.dot.length === 0, kq)
        ok('7b. Lượt tự động bỏ vì nguồn trống ⇒ BÁO CHUÔNG (không bình thường như "không ai nợ")', st.thongBao.length === 1 && /Không có sản phẩm/.test(String(st.thongBao[0]?.message)), st.thongBao)
        ok('7c. Trạng thái không ghi', st.sqlDaGui === 0)

        const { sp: sp2, st: st2 } = giaSp()
        const thuong = lichMau({ noiDung: 'Tin thường {tenKhach}', gioiThieu: null })
        const kqT = await chayLich(sp2, thuong, { bayGio: new Date('2026-10-29T02:00:00Z') })
        ok('7d. Lịch thường không đụng gì: đợt dùng ảnh của lịch, không ghi trạng thái, không truy sản phẩm', !kqT.boQua && JSON.parse(st2.dot[0].anh).join(',') === 'https://x/qr.png' && st2.sqlDaGui === 0 && !kqT.ketQua.includes('giới thiệu'), kqT)
        const soanT = await soanNguoiNhan(sp2, thuong, new Date())
        ok('7e. Lịch thường: gioiThieu null trong kết quả soạn, biến không có gì thừa', soanT.gioiThieu === null && soanT.dong.every(d => d.bien === null), soanT.dong.map(d => d.bien))
    }

    console.log(`\n${hong ? '✗' : '✓'} ${dat} đạt · ${hong} hỏng\n`)
    process.exit(hong ? 1 : 0)
}
main().catch(e => { console.error('LỖI:', e); process.exit(1) })
