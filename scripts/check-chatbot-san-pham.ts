/**
 * Bộ soát TRA SẢN PHẨM CHO CHATBOT (lib/chatbotSanPham.ts + lib/phamViKhoaApi.ts) — 20/10/2026. Hàm thuần, không DB.
 *   npx tsx scripts/check-chatbot-san-pham.ts
 * Canh: tham số lạ bị chặn; mọi giá trị người dùng chỉ nằm trong mảng tham số SQL; KHÔNG BAO GIỜ trả giá vốn / số tồn;
 * giá từng sàn (đo: 78/78 hàng nhiều sàn lệch giá); Shopee giá 0 ⇒ null + link sàn; tồn kho ≤ 0 KHÔNG được thành "hết hàng"
 * (đo 20/10: 434/493 hàng đang bán tồn ≤ 0 mà vẫn bán); khoá scope 'chatbot' chỉ gọi được /api/chatbot.
 */
import { docThamSoSanPham, tuKhoa, cauTimListing, cauTimHang, tinhTrang, tinhTrangKho, tinhTrangSan, tongTinhTrang, linkSan, catMoTa, gomSanPham, LISTING_DANG_BAN } from '../src/lib/chatbotSanPham'
import { lyDoChanKhoa, khoaDoiDuocToken } from '../src/lib/phamViKhoaApi'
import { timKienThuc, kiemShopChatbot, docTinNhan, tachCoNhanVien, soanPromptChatbot, layPhien, ghiPhien, homNayVN, DAU_NHAN_VIEN, TRA_LOI_DU_PHONG } from '../src/lib/chatbotKienThuc'
import fs from 'fs'
import path from 'path'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet?: unknown) => {
    if (!ok) loi++
    console.log(`${ok ? '✓' : '✗'} ${ten}${!ok && chiTiet !== undefined ? ' — ' + JSON.stringify(chiTiet) : ''}`)
}
const soThamSo = (sql: string) => Math.max(0, ...Array.from(sql.matchAll(/\$(\d+)/g)).map(m => Number(m[1])))

// 1. tham số
const md = docThamSoSanPham({})
dung('mặc định: 5 kết quả, không shop / sàn / mã', md.limit === 5 && md.shop === '' && md.san === '' && md.ma === '' && md.q === '', md)
const la = docThamSoSanPham({ limit: '999', san: 'amazon', q: '  máy   xay  ', shop: '  Kengi   Store ' })
dung('trần 10 kết quả, sàn lạ bỏ, gom khoảng trắng', la.limit === 10 && la.san === '' && la.q === 'máy xay' && la.shop === 'Kengi Store', la)
dung('sàn hợp lệ không phân biệt hoa thường', docThamSoSanPham({ san: 'TikTok' }).san === 'tiktok')

// 2. từ khoá
dung('bỏ dấu + thường + bỏ ký tự lạ', JSON.stringify(tuKhoa('Máy XAY sinh-tố Sunhouse!')) === JSON.stringify(['may', 'xay', 'sinh', 'to', 'sunhouse']), tuKhoa('Máy XAY sinh-tố Sunhouse!'))
dung('bỏ từ 1 ký tự, trùng; tối đa 6 từ', tuKhoa('a b quạt quạt c d e f g h i j k').length <= 6 && !tuKhoa('a quạt').includes('a'))
dung('đ → d', tuKhoa('Đèn điện').join(' ') === 'den dien')

// 3. SQL: giá trị người dùng chỉ ở mảng tham số
const doc = `'; DROP TABLE "Product"; --`
const c1 = cauTimListing(['k1', `k2'x`], tuKhoa(doc + ' quạt'), '')
dung('listing: số $n khớp số tham số, không chuỗi người dùng trong SQL', soThamSo(c1.sql) === c1.tham.length && !c1.sql.includes('DROP') && !c1.sql.includes(`k2'x`), { n: soThamSo(c1.sql), tham: c1.tham.length })
dung('listing: chỉ listing đang bán + đúng kênh', c1.sql.includes('op."channelId" IN') && LISTING_DANG_BAN.every(s => c1.tham.includes(s)) && c1.sql.includes('op.status IN'))
dung('listing: KHÔNG chọn giá vốn', !/costPrice|giaVon/i.test(c1.sql))
const c2 = cauTimListing(['k1'], [], 'SHD5114')
dung('listing theo mã: so nguyên mã, không LIKE', c2.tham.includes('shd5114') && !c2.sql.includes("LIKE '%'"), c2.tham)
dung('listing: chưa nối kho ⇒ khớp hàng kho theo SKU trùng đúng (chỉ mục UNIQUE), giữ liên kết có sẵn',
    c1.sql.includes('COALESCE(op."localProductId"') && c1.sql.includes('p2.sku = op.sku') && c1.sql.includes('p.id AS "hangId"'))
dung('listing: trả mã sản phẩm sàn + shop id (dựng link), KHÔNG khoá / token kênh',
    c1.sql.includes('"maSpSan"') && c1.sql.includes('ch."shopId"') && !/accessToken|apiSecret|refreshToken|apiKey|webhookSecret/i.test(c1.sql))
const rong = cauTimListing(['k1'], [], ''), rong2 = cauTimHang([], '')
dung('không từ khoá, không mã ⇒ điều kiện FALSE (không lỗi cú pháp, không trả cả kho)', /AND FALSE\s+LIMIT/.test(rong.sql) && /AND FALSE\s+LIMIT/.test(rong2.sql))
const c3 = cauTimHang(tuKhoa('nồi cơm'), '')
dung('hàng kho: số $n khớp, bỏ hàng gộp / dịch vụ, KHÔNG giá vốn', soThamSo(c3.sql) === c3.tham.length && c3.sql.includes('"mergedIntoId" IS NULL') && c3.sql.includes("<> 'service'") && !/costPrice/i.test(c3.sql))

// 4. tình trạng
dung('tình trạng theo ngưỡng', tinhTrang(0) === 'het_hang' && tinhTrang(-3) === 'het_hang' && tinhTrang(3) === 'sap_het' && tinhTrang(6) === 'con_hang' && tinhTrang(8, 10) === 'sap_het' && tinhTrang(null) === 'chua_ro')
dung('tồn KHO ≤ 0 ⇒ chưa rõ (KHÔNG "hết hàng"); dương ⇒ theo ngưỡng', tinhTrangKho(0) === 'chua_ro' && tinhTrangKho(-5) === 'chua_ro' && tinhTrangKho(null) === 'chua_ro' && tinhTrangKho(3) === 'sap_het' && tinhTrangKho(12) === 'con_hang')
dung('tồn SÀN: TikTok 0 ⇒ hết (khách thấy hết trên sàn); Shopee 0 ⇒ chưa rõ; Shopee dương ⇒ tin',
    tinhTrangSan('tiktok', 0) === 'het_hang' && tinhTrangSan('TikTok', 9) === 'con_hang' && tinhTrangSan('shopee', 0) === 'chua_ro' && tinhTrangSan('shopee', 20) === 'con_hang' && tinhTrangSan('lazada', 0) === 'chua_ro')
dung('gộp tình trạng: một nguồn còn là còn; hết chỉ khi mọi nguồn hết; rỗng ⇒ chưa rõ',
    tongTinhTrang(['het_hang', 'chua_ro']) === 'chua_ro' && tongTinhTrang(['het_hang', 'con_hang']) === 'con_hang' && tongTinhTrang(['het_hang']) === 'het_hang' && tongTinhTrang([]) === 'chua_ro' && tongTinhTrang(['sap_het', 'chua_ro']) === 'sap_het')

// 4b. link sàn
dung('link Shopee shopee.vn/product/<shop>/<item>', linkSan('shopee', '123456789', '23456789012') === 'https://shopee.vn/product/123456789/23456789012')
dung('link TikTok shop.tiktok.com/view/product/<id>', linkSan('tiktok', 'cipherABC', '1729384756102938475') === 'https://shop.tiktok.com/view/product/1729384756102938475?region=VN&locale=vi-VN')
dung('không dựng link khi thiếu shop id Shopee / mã không phải số / sàn khác',
    linkSan('shopee', null, '23456789012') === null && linkSan('shopee', '12x', '23456789012') === null && linkSan('tiktok', '', '12"><script>') === null && linkSan('lazada', '1', '123456') === null)

// 5. cắt mô tả
const dai = 'Máy xay đa năng. '.repeat(100)
const cat = catMoTa(dai, 600)
dung('cắt mô tả ở ranh giới từ, có dấu …', cat.length <= 601 && cat.endsWith('…') && !cat.endsWith(' …'), cat.length)
dung('mô tả ngắn giữ nguyên, gom dòng trống', catMoTa('a\n\n\n\nb  c', 600) === 'a\n\nb c')

// 6. gom sản phẩm
const hang = { hangId: 'p1', tenHang: 'Máy xay sinh tố Sunhouse SHD5114', maHang: 'SHD5114', giaLe: 459000, tonKho: 12, tonToiThieu: 0, moTa: dai, thuongHieu: 'Sunhouse', nhomHang: 'Gia dụng', anhHang: 'https://anh/1.jpg' }
const rows = [
    { ...hang, id: 'l1', platform: 'shopee', tenSan: '[Freeship] Máy Xay Sinh Tố Sunhouse SHD5114', maSan: 'SHD5114', giaSan: 0, tonSan: 0, shopSan: '998877', maSpSan: '22334455667' },
    { ...hang, id: 'l2', platform: 'tiktok', tenSan: 'Máy xay Sunhouse SHD5114', maSan: 'SHD5114', giaSan: 449000, tonSan: 7 },
    { ...hang, id: 'l3', platform: 'tiktok', tenSan: 'Máy xay Sunhouse SHD5114 (đăng trùng)', maSan: 'SHD5114', giaSan: 439000, tonSan: 7 },
    // listing CHƯA nối kho: Shopee ⇒ tồn chưa rõ; TikTok ⇒ tồn trên sàn
    { id: 'l4', platform: 'shopee', tenSan: 'Quạt đứng Senko', maSan: 'QD01', giaSan: 350000, tonSan: 0, hangId: null },
    { id: 'l5', platform: 'tiktok', tenSan: 'Quạt bàn Senko', maSan: 'QB02', giaSan: 250000, tonSan: 0, hangId: null },
]
const kq = gomSanPham(rows, tuKhoa('máy xay'), '', 5)
const may = kq.find(s => s.ma === 'SHD5114')
dung('cùng hàng kho ⇒ MỘT sản phẩm, giá / tình trạng / link từng sàn; Shopee giá 0 ⇒ null + link; đăng trùng giữ giá thấp nhất',
    !!may && kq.filter(s => s.ma === 'SHD5114').length === 1
    && JSON.stringify(may.giaTheoSan) === JSON.stringify([
        { san: 'Shopee', gia: null, tinhTrang: 'chua_ro', link: 'https://shopee.vn/product/998877/22334455667' },
        { san: 'TikTok', gia: 439000, tinhTrang: 'con_hang', link: null }]) && may.gia === 439000, may?.giaTheoSan)
dung('đã nối kho ⇒ tình trạng theo TỒN KHO (12 ⇒ còn hàng), không theo tồn sàn Shopee 0', may?.tinhTrang === 'con_hang', may?.tinhTrang)
const moiKhoa = (o: any): string[] => o && typeof o === 'object' ? Object.keys(o).flatMap(k => [k, ...moiKhoa(o[k])]) : []
dung('KHÔNG trả giá vốn / số tồn / mã nội bộ sàn trong kết quả (kể cả lồng)', !kq.some(s => moiKhoa(s).some(k => /cost|giaVon|tonKho|tonSan|stock|shopSan|maSpSan|hangId/i.test(k))), moiKhoa(may))
dung('mô tả tìm kiếm bị cắt ≤ 600', (may?.moTa.length || 0) <= 601)
const chiTiet = gomSanPham(rows, [], 'SHD5114', 1, true)
dung('tra theo mã: 1 kết quả, mô tả dài hơn', chiTiet.length === 1 && chiTiet[0].moTa.length > 601 && chiTiet[0].moTa.length <= 2501, chiTiet[0]?.moTa.length)
const qd = kq.find(s => s.ma === 'QD01'), qb = kq.find(s => s.ma === 'QB02')
dung('chưa nối kho: Shopee ⇒ chưa rõ; TikTok tồn 0 ⇒ hết hàng', qd?.tinhTrang === 'chua_ro' && qb?.tinhTrang === 'het_hang', { qd: qd?.tinhTrang, qb: qb?.tinhTrang })
dung('xếp: khớp từ khoá ở tên + còn hàng lên đầu', kq[0]?.ma === 'SHD5114', kq.map(s => s.ma))
dung('hàng kho (không shop): giá lẻ', gomSanPham([{ ...hang, id: null, platform: null }], tuKhoa('máy xay'), '', 5)[0]?.gia === 459000)
// tồn kho ≤ 0 — đo 20/10 phần lớn hàng đang bán như vậy: KHÔNG được nói hết hàng
const ttCua = (ds: any[]) => gomSanPham(ds, tuKhoa('máy xay'), '', 5)[0]?.tinhTrang
dung('kho âm + chỉ Shopee ⇒ chưa rõ (không phải hết)', ttCua([{ ...hang, tonKho: -4, id: 'a', platform: 'shopee', giaSan: 459000, tonSan: 0 }]) === 'chua_ro')
dung('kho âm + TikTok còn ⇒ còn hàng', ttCua([{ ...hang, tonKho: -4, id: 'a', platform: 'tiktok', giaSan: 449000, tonSan: 9 }]) === 'con_hang')
dung('kho 0 + TikTok tồn 0 (shop chỉ bán TikTok) ⇒ hết hàng', ttCua([{ ...hang, tonKho: 0, id: 'a', platform: 'tiktok', giaSan: 449000, tonSan: 0 }]) === 'het_hang')
dung('kho dương + TikTok 0 ⇒ chung còn hàng, riêng TikTok hết', (() => { const s = gomSanPham([{ ...hang, tonKho: 20, id: 'a', platform: 'tiktok', giaSan: 449000, tonSan: 0 }], tuKhoa('máy xay'), '', 5)[0]; return s?.tinhTrang === 'con_hang' && s.giaTheoSan[0].tinhTrang === 'het_hang' })())
dung('hàng kho (không shop) tồn 0 / âm ⇒ chưa rõ; tồn 3 ⇒ sắp hết',
    ttCua([{ ...hang, tonKho: 0, id: null, platform: null }]) === 'chua_ro' && ttCua([{ ...hang, tonKho: -2, id: null, platform: null }]) === 'chua_ro' && ttCua([{ ...hang, tonKho: 3, id: null, platform: null }]) === 'sap_het')
dung('giá chung = giá THẤP NHẤT có thật, không phụ thuộc thứ tự dòng',
    gomSanPham([...rows.slice(0, 3)].reverse(), tuKhoa('máy xay'), '', 5)[0]?.gia === 439000)
dung('ảnh: ưu tiên ảnh hàng kho', may?.anh === 'https://anh/1.jpg')

// 7. phạm vi khoá chatbot
dung('khoá chatbot gọi được webhook / tra sản phẩm / kênh', ['/api/chatbot/webhook', '/api/chatbot/san-pham?q=x', '/api/chatbot/kenh', '/api/chatbot/webhook/'].every(u => lyDoChanKhoa(' Chatbot ', u) === null))
dung('khoá chatbot bị chặn ở đường khác (kho kiến thức, khách hàng, MCP, sản phẩm, đường giả dạng)',
    ['/api/chatbot/shops', '/api/chatbot/shops/mac-dinh', '/api/chatbot', '/api/customers', '/api/mcp', '/api/products?search=a', '/api/chatbotx', '/api/chatbot-gia/x', '/api/x/api/chatbot/webhook', '/api/chatbot/webhook/x'].every(u => !!lyDoChanKhoa('chatbot', u)))
dung('scope khác không bị đụng (đọc / ghi tự kiểm ở authMiddleware)', lyDoChanKhoa('read', '/api/customers') === null && lyDoChanKhoa('read,write', '/api/products') === null && lyDoChanKhoa(undefined, '/api/x') === null)
// POST /api/auth/token đổi khoá ⇒ JWT KHÔNG mang scope: khoá chatbot đổi được là thoát phạm vi
dung('khoá chatbot KHÔNG đổi được token; scope cũ giữ nguyên', !khoaDoiDuocToken('chatbot') && !khoaDoiDuocToken(' ChatBot ') && khoaDoiDuocToken('read') && khoaDoiDuocToken('admin') && khoaDoiDuocToken(undefined))
const nguonAuth = fs.readFileSync(path.join(__dirname, '../src/routes/auth.ts'), 'utf8')
const doanToken = nguonAuth.slice(nguonAuth.indexOf("router.post('/token'"), nguonAuth.indexOf('jwt.sign(payload', nguonAuth.indexOf("router.post('/token'")))
dung('POST /auth/token gọi khoaDoiDuocToken TRƯỚC khi ký JWT, SAU khi khớp secret',
    doanToken.includes('khoaDoiDuocToken(apiKey.scopes)') && doanToken.indexOf('bcrypt.compare(clientSecret') < doanToken.indexOf('khoaDoiDuocToken(apiKey.scopes)'))

// 8. WEBHOOK trả lời khách (lib/chatbotKienThuc.ts + routes/chatbot.ts)
const ngay = '2026-10-20'
const tl = (o: any = {}) => ({ id: 'doi-tra', title: 'Chính sách đổi trả', category: 'returns', status: 'published', visibility: 'customer',
    content: 'Đổi trả trong 7 ngày nếu sản phẩm còn nguyên tem, lỗi do nhà sản xuất.', keywords: ['đổi trả', 'hoàn tiền'], source: 'Quy định shop',
    approved_by: 'NGUOI_DUYET_BI_MAT', editor_note: 'GHI_CHU_NOI_BO', updated_at: '2026-10-01', valid_from: '2026-10-01', valid_until: '2026-12-31', ...o })
const kho = [tl(), tl({ id: 'nhap', status: 'draft' }), tl({ id: 'noi-bo', visibility: 'internal' }), tl({ id: 'het-han', valid_until: '2026-10-19' }), tl({ id: 'chua-toi', valid_from: '2026-10-21' })]
const kt1 = timKienThuc(kho, 'shop ơi DOI TRA thế nào vậy', ngay)
dung('kiến thức: tìm không dấu, chỉ tài liệu ĐÃ DUYỆT + cho khách + còn hiệu lực', kt1.status === 'candidates_found' && kt1.results.length === 1 && kt1.results[0].id === 'doi-tra', kt1)
dung('kiến thức: KHÔNG trả người duyệt / ghi chú nội bộ', !JSON.stringify(kt1).includes('NGUOI_DUYET_BI_MAT') && !JSON.stringify(kt1).includes('GHI_CHU_NOI_BO'))
dung('kiến thức: câu toàn từ dừng / rỗng / không có kho ⇒ cần người, không bịa',
    timKienThuc(kho, 'shop ơi cho mình hỏi', ngay).status === 'invalid_query' && timKienThuc(kho, '', ngay).needs_human
    && timKienThuc([tl({ status: 'draft' })], 'đổi trả', ngay).status === 'knowledge_unavailable' && timKienThuc(kho, 'giao hàng hoả tốc', ngay).needs_human)
dung('kiến thức: hôm nay theo giờ VN', homNayVN(new Date('2026-10-20T17:30:00Z')) === '2026-10-21' && homNayVN(new Date('2026-10-20T16:59:00Z')) === '2026-10-20')

const ks = kiemShopChatbot('shop-ab12', { ten: '  Kengi   Store ', kenh: 'Kengi Store', san: 'tiktok', kienThuc: { schema_version: 1, documents: [tl()] } })
dung('lưu shop: làm sạch tên, giữ kênh + sàn, kho thành JSON', 'shop' in ks && ks.shop.ten === 'Kengi Store' && ks.shop.kenh === 'Kengi Store' && ks.shop.san === 'tiktok' && JSON.parse(ks.shop.kienThuc).documents.length === 1, ks)
const ks2 = kiemShopChatbot('mac-dinh', { ten: 'A', kenh: null, san: 'amazon', kienThuc: { schema_version: 1, documents: [] } })
dung('lưu shop: kênh null (chưa chọn) khác "" (giá lẻ); sàn lạ bỏ', 'shop' in ks2 && ks2.shop.kenh === null && ks2.shop.san === ''
    && (() => { const r = kiemShopChatbot('mac-dinh', { ten: 'A', kenh: '', kienThuc: { schema_version: 1, documents: [] } }); return 'shop' in r && r.shop.kenh === '' })())
dung('lưu shop: chặn mã lạ, thiếu tên, sai định dạng, trùng mã tài liệu, quá nhiều tài liệu',
    ['../x', 'A B', '', 'x'.repeat(41)].every(m => 'loi' in kiemShopChatbot(m, { ten: 'A', kienThuc: { schema_version: 1, documents: [] } }))
    && 'loi' in kiemShopChatbot('a', { ten: ' ', kienThuc: { schema_version: 1, documents: [] } })
    && 'loi' in kiemShopChatbot('a', { ten: 'A', kienThuc: { documents: [] } })
    && 'loi' in kiemShopChatbot('a', { ten: 'A', kienThuc: { schema_version: 1, documents: [tl(), tl()] } })
    && 'loi' in kiemShopChatbot('a', { ten: 'A', kienThuc: { schema_version: 1, documents: Array.from({ length: 301 }, (_, i) => tl({ id: `t${i}` })) } }))

const t1 = docTinNhan({ action: 'sendMessage', chatInput: '  quạt đứng giá sao ', sessionId: 'abc', shop: 'mac-dinh' })
dung('webhook: nhận đúng thân Chat Trigger của n8n (chatInput + sessionId)', !('loi' in t1) && t1.cauHoi === 'quạt đứng giá sao' && t1.phien === 'abc' && t1.shop === 'mac-dinh', t1)
const t2 = docTinNhan({ message: 'hi', shop: 'Kengi Store', lichSu: [{ role: 'khach', text: 'a' }, { role: 'shop', noiDung: 'b' }, { role: 'hacker', text: 'c' }, ...Array.from({ length: 20 }, () => ({ role: 'user', text: 'x' }))] })
dung('webhook: message / lichSu (vai khách ⇒ user, shop ⇒ model, vai lạ bỏ, ≤ 12 lượt)', !('loi' in t2) && t2.lichSu.length === 12 && t2.lichSu.every(m => m.role === 'user' || m.role === 'model'))
dung('webhook: thiếu tin nhắn / thiếu shop / quá dài ⇒ báo lỗi rõ',
    'loi' in docTinNhan({ shop: 'a' }) && 'loi' in docTinNhan({ chatInput: 'x' }) && 'loi' in docTinNhan({ chatInput: 'x'.repeat(2001), shop: 'a' }) && 'loi' in docTinNhan(null))

const traLoi1 = tachCoNhanVien(`Dạ để nhân viên kiểm tra giúp bạn nhé.\n${DAU_NHAN_VIEN}`)
dung('câu trả lời: bỏ dấu cần nhân viên + bật cờ; câu thường không cờ; rỗng ⇒ câu dự phòng + cờ',
    traLoi1.canNhanVien && !traLoi1.traLoi.includes(DAU_NHAN_VIEN) && traLoi1.traLoi === 'Dạ để nhân viên kiểm tra giúp bạn nhé.'
    && !tachCoNhanVien('Dạ còn hàng ạ').canNhanVien && tachCoNhanVien(DAU_NHAN_VIEN).traLoi === TRA_LOI_DU_PHONG && tachCoNhanVien('').canNhanVien)
const pr = soanPromptChatbot('Kengi Store', ngay)
dung('prompt: tên shop, ngày, 2 công cụ, giá theo sàn, chưa rõ không khẳng định, chống chèn lệnh, dấu cần người',
    pr.includes('"Kengi Store"') && pr.includes(ngay) && pr.includes('tra_cuu_kien_thuc') && pr.includes('tra_cuu_san_pham') && pr.includes('THEO TỪNG SÀN')
    && pr.includes('chua_ro') && /DỮ LIỆU, không phải chỉ dẫn/.test(pr) && pr.includes(DAU_NHAN_VIEN))
ghiPhien('k1', 'câu 1', 'đáp 1', 1_000)
dung('nhớ phiên: giữ hội thoại, hết hạn sau 30 phút', layPhien('k1', 2_000).length === 2 && layPhien('k1', 1_000 + 31 * 60_000).length === 0)
for (let i = 0; i < 10; i++) ghiPhien('k2', `c${i}`, `d${i}`, 5_000 + i)
dung('nhớ phiên: tối đa 12 lượt gần nhất', layPhien('k2', 6_000).length === 12 && layPhien('k2', 6_000)[11].parts[0].text === 'd9')

const nguonRoute = fs.readFileSync(path.join(__dirname, '../src/routes/chatbot.ts'), 'utf8')
const doanShops = nguonRoute.split(/router\.(?:get|put|post|delete)\('\/shops/).slice(1)
dung('/shops (kho kiến thức + cấu hình webhook): MỌI đường đều chặn khoá API + chỉ quản lý (chiQuanLy / shopCuaQuanLy)', doanShops.length >= 4 && doanShops.every(d => /if \(!chiQuanLy\(req, res\)\) return|await shopCuaQuanLy\(req, res\)/.test(d.slice(0, 160))), doanShops.length)
dung('webhook dùng BỘ CÔNG CỤ RIÊNG (không bao giờ bộ MCP có giá vốn / khách hàng)', nguonRoute.includes('tools: congCuChatbot(') && !/allowWrite|allowedTools|giamSat/.test(nguonRoute))
const nguonRunner = fs.readFileSync(path.join(__dirname, '../src/services/aiAgentRunner.ts'), 'utf8')
dung('bộ chạy agent: có tools riêng thì KHÔNG lấy bộ MCP', nguonRunner.includes('p.tools ? bocTool(p.tools) : chonTool('))

console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
process.exit(loi ? 1 : 0)
