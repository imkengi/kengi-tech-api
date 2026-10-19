/* Kiểm chứng BỘ LỌC truyện AI (lib/aiCauChuyen.ts → locTruyen) — 17/10/2026.
 *   npx tsx scripts/check-ai-cau-chuyen.ts
 * Truyện là hư cấu nhưng điều nói về SẢN PHẨM phải đúng mô tả, và không được lẫn quảng cáo / đánh giá giả / dẫn ra ngoài sàn.
 * Mỗi luật có ca PHẢI GIỮ lẫn ca PHẢI BỎ. */
import { locTruyen, BIEU_TUONG, LOI_TOI_DA, LOI_TONG_TOI_THIEU, NHIP_TOI_DA } from '../src/lib/aiCauChuyen'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }

const ten = 'Nồi cơm điện 1.8L Sunhouse Mama SHD8666G'
const moTa = 'Dung tích 1.8L. Công suất 700W. Mâm nhiệt lớn tỏa nhiệt đều. Lòng nồi dạng niêu giúp cơm dẻo ngon. Nút gạt điều khiển dễ dùng.'
const nhip = (loai: string, chu: string, loi = chu + '.', bieuTuong = '😊') => ({ loai, chu, loi, bieuTuong })
// v3 (19/10): lời kể 2–3 câu cho video ≥ 1 phút — cả truyện ~900 ký tự lời
const tot = (them: any = {}) => ({
    tieuDe: 'Chuyện bữa sáng nhà chị Mai',
    nhip: [
        nhip('mo', 'Sáng nào nhà chị Mai cũng tất bật', 'Sáng nào nhà chị Mai cũng tất bật từ lúc trời còn tối. Chị vừa chuẩn bị đồ cho hai đứa nhỏ đi học, vừa lo nồi cơm cho cả nhà kịp ăn.', '⏰'),
        nhip('roi', 'Nồi cũ nấu cơm chín không đều', 'Chiếc nồi cũ dùng đã lâu, nấu xong cơm chỗ khô chỗ nhão. Có hôm chị phải nấu lại nồi khác, cả nhà ngồi chờ mà ai cũng sốt ruột vì sắp muộn.', '😩'),
        nhip('ngoat', 'Rồi chị đổi sang nồi 1.8L mới', 'Rồi chị Mai quyết định đổi sang chiếc nồi cơm điện 1.8L mới. Nút gạt điều khiển đơn giản nên bà nội cũng tự nấu được, chẳng cần ai chỉ.', '✨'),
        nhip('loi-ich', 'Công suất 700W nấu nhanh', 'Công suất 700W giúp cơm chín nhanh hơn hẳn. Chị chỉ cần vo gạo, gạt nút rồi đi chuẩn bị thức ăn, quay lại là cơm đã chín thơm cả gian bếp.', '🔥'),
        nhip('loi-ich', 'Lòng nồi dạng niêu, cơm dẻo ngon', 'Lòng nồi dạng niêu và mâm nhiệt lớn tỏa nhiệt đều, hạt cơm chín mềm, dẻo ngon từ trên xuống dưới. Không còn cảnh cơm sống ở giữa như trước.', '🍚'),
        nhip('ket', 'Bữa cơm giờ ngon hơn hẳn', 'Giờ bữa sáng nhà chị Mai nhẹ nhàng hơn nhiều. Cả nhà ăn ngon, đi học đi làm đúng giờ, còn chị có thêm chút thời gian ngồi uống tách trà nóng.', '😊'),
    ],
    ...them,
})
const doi = (i: number, n: any) => { const t = tot(); t.nhip[i] = { ...t.nhip[i]!, ...n }; return t }

{
    const r = locTruyen({ dungDuoc: true, truyen: [tot()] }, ten, moTa)
    dung('truyện đúng luật ⇒ giữ nguyên 6 nhịp', r.truyen.length === 1 && r.truyen[0]!.nhip.length === 6 && r.dungDuoc, JSON.stringify(r.truyen[0]?.nhip.map(x => x.loai)))
    dung('số có trong mô tả ở bước ngoặt / lợi ích (1.8L, 700W) ⇒ giữ', r.truyen[0]!.nhip.some(x => /700W/.test(x.chu)))
}
{
    const r = locTruyen({ truyen: [doi(3, { chu: 'Tiết kiệm 50% điện', loi: 'Tiết kiệm 50% điện mỗi tháng.' })] }, ten, moTa)
    dung('số BỊA ở lợi ích ⇒ bỏ riêng nhịp đó, truyện vẫn còn (còn lợi ích khác)', r.truyen.length === 1 && !r.truyen[0]!.nhip.some(x => /50%/.test(x.chu)) && r.truyen[0]!.nhip.filter(x => x.loai === 'loi-ich').length === 1)
}
{
    const r = locTruyen({ truyen: [doi(0, { chu: '6 giờ sáng nhà chị Mai đã dậy', loi: '6 giờ sáng nhà chị Mai đã dậy.' })] }, ten, moTa)
    dung('chữ số ở nhịp mở truyện ⇒ bỏ CẢ truyện (nhịp bắt buộc hỏng)', r.truyen.length === 0 && !r.dungDuoc, r.lyDo)
}
for (const [ten2, n] of [
    ['khuyến mãi', { chu: 'Đang giảm giá sốc', loi: 'Đang giảm giá sốc hôm nay.' }],
    ['đánh giá giả', { chu: 'Khách hàng khen hết lời', loi: 'Khách hàng khen hết lời.' }],
    ['"tốt nhất"', { chu: 'Nồi cơm tốt nhất', loi: 'Đây là nồi cơm tốt nhất.' }],
    ['bảo hành', { chu: 'Bảo hành dài lâu', loi: 'Được bảo hành dài lâu.' }],
    ['câu hỏi', { chu: 'Ai mà không thích', loi: 'Ai mà không thích cơm ngon?' }],
    ['dẫn ra ngoài sàn', { chu: 'Nhắn Zalo đặt ngay', loi: 'Nhắn Zalo 0912345678 đặt ngay.' }],
] as [string, any][]) {
    const r = locTruyen({ truyen: [doi(5, n)] }, ten, moTa)
    dung(`${ten2} ở nhịp kết ⇒ bỏ cả truyện`, r.truyen.length === 0)
}
{
    const r = locTruyen({ truyen: [doi(1, { bieuTuong: '🎁' }), doi(2, { bieuTuong: '' })] }, ten, moTa)
    const t = r.truyen[0]!
    dung('emoji ngoài danh sách (🎁 gợi quà) ⇒ thay biểu tượng mặc định', t.nhip[1]!.bieuTuong === '😩' && BIEU_TUONG.includes(t.nhip[1]!.bieuTuong), t.nhip[1]!.bieuTuong)
}
{
    const thieu = tot(); thieu.nhip = thieu.nhip.filter(x => x.loai !== 'ngoat')
    const r = locTruyen({ truyen: [thieu] }, ten, moTa)
    dung('thiếu nhịp bước ngoặt ⇒ bỏ truyện', r.truyen.length === 0)
}
{
    const lon = tot(); lon.nhip = [lon.nhip[5]!, lon.nhip[3]!, lon.nhip[0]!, lon.nhip[2]!, lon.nhip[1]!]
    const r = locTruyen({ truyen: [lon] }, ten, moTa)
    dung('nhịp lộn thứ tự ⇒ xếp lại mở → rắc rối → ngoặt → lợi ích → kết', r.truyen[0]?.nhip.map(x => x.loai).join(',') === 'mo,roi,ngoat,loi-ich,ket', r.truyen[0]?.nhip.map(x => x.loai).join(','))
}
{
    const r = locTruyen({ truyen: [tot(), tot({ tieuDe: 'Bản sao' })] }, ten, moTa)
    dung('hai truyện cùng câu mở ⇒ giữ một', r.truyen.length === 1)
}
{
    const r = locTruyen({ truyen: [tot({ tieuDe: 'Giảm giá 50% hôm nay' })] }, ten, moTa)
    dung('tên truyện quảng cáo ⇒ xoá tên, giữ truyện', r.truyen.length === 1 && r.truyen[0]!.tieuDe === '')
}
{
    const r = locTruyen({ dungDuoc: false, lyDo: 'Mô tả là của sản phẩm khác', truyen: [] }, ten, moTa)
    dung('AI bảo mô tả không dùng được ⇒ dungDuoc=false kèm lý do', !r.dungDuoc && /sản phẩm khác/.test(r.lyDo))
}
{
    // đo 17/10 trên máy sấy tóc thật: "57 độ C" bị bỏ oan vì mẫu giá khớp "57 đ"; mô tả có 57 thì phải giữ
    const moTa57 = moTa + ' Nhiệt độ ổn định 57 độ C.'
    const r = locTruyen({ truyen: [doi(3, { chu: 'Nhiệt độ ổn định 57 độ C', loi: 'Nhiệt độ ổn định 57 độ C, tóc không khô xơ.' })] }, ten, moTa57)
    dung('"57 độ C" (số có trong mô tả) ở lợi ích ⇒ GIỮ, không tưởng là giá', r.truyen[0]?.nhip.some(x => /57 độ C/.test(x.chu)) === true)
    for (const [ten3, gia] of [['57đ', 'Chỉ 57đ một lần sấy'], ['57 đồng', 'Chỉ 57 đồng một lần sấy'], ['57k', 'Chỉ 57k một lần sấy']] as const) {
        const r2 = locTruyen({ truyen: [doi(3, { chu: gia, loi: gia + '.' })] }, ten, moTa57)
        dung(`giá tiền "${ten3}" ở lợi ích ⇒ bỏ nhịp đó`, !r2.truyen[0]?.nhip.some(x => x.chu === gia))
    }
    const r3 = locTruyen({ truyen: [doi(5, { chu: 'An toàn tuyệt đối cho cả nhà', loi: 'An toàn tuyệt đối cho cả nhà.' })] }, ten, moTa)
    dung('khẳng định "tuyệt đối" ở nhịp kết ⇒ bỏ cả truyện', r3.truyen.length === 0)
}
{
    const t = tot(); t.nhip[0] = { ...t.nhip[0]!, chu: 'Một câu chữ trên hình dài quá mức cho phép của khung video ngắn' }
    const r = locTruyen({ truyen: [t] }, ten, moTa)
    dung('chữ lên hình dài quá khung ⇒ bỏ (nhịp mở hỏng ⇒ cả truyện)', r.truyen.length === 0)
}
// ── ĐỘ DÀI (v3 19/10/2026, chủ shop: "ít gì cũng phải 1p chứ có vài giây sao mà xem") ──
{
    const tong = tot().nhip.reduce((s, x) => s + x.loi.length, 0)
    dung(`truyện mẫu đủ lời cho 1 phút (${tong} ≥ ${LOI_TONG_TOI_THIEU} ký tự, mỗi nhịp ≤ ${LOI_TOI_DA})`, tong >= LOI_TONG_TOI_THIEU && tot().nhip.every(x => x.loi.length <= LOI_TOI_DA))
}
{
    // bản v2: mỗi nhịp một câu ngắn ⇒ video ~25 giây ⇒ nay phải bỏ
    const ngan = tot(); ngan.nhip = ngan.nhip.map(x => ({ ...x, loi: x.chu + '.' }))
    const nk: string[] = []
    const r = locTruyen({ truyen: [ngan] }, ten, moTa, nk)
    dung('lời kể quá ngắn (video < 1 phút) ⇒ bỏ truyện, nhật ký nói rõ', r.truyen.length === 0 && nk.some(x => /lời kể ngắn/.test(x)), nk.find(x => /BỎ/.test(x)))
}
{
    const t = doi(3, { loi: 'Công suất 700W giúp cơm chín nhanh. '.repeat(7).trim() })
    const r = locTruyen({ truyen: [t] }, ten, moTa)
    dung(`lời một nhịp lợi ích dài quá ${LOI_TOI_DA} ký tự ⇒ bỏ riêng nhịp đó`, r.truyen.length === 1 && r.truyen[0]!.nhip.filter(x => x.loai === 'loi-ich').length === 1)
    const t2 = doi(1, { loi: 'Chiếc nồi cũ nấu cơm chỗ khô chỗ nhão. '.repeat(7).trim() })
    dung(`lời nhịp rắc rối dài quá ${LOI_TOI_DA} ký tự ⇒ bỏ cả truyện`, locTruyen({ truyen: [t2] }, ten, moTa).truyen.length === 0)
}
{
    // 2 rắc rối + 3 lợi ích + mở/ngoặt/kết = 8 nhịp > máy dựng chịu được (8 cảnh kể cả cảnh giá) ⇒ bớt lợi ích cuối
    const dai = tot(); const n = dai.nhip
    dai.nhip = [n[0]!, n[1]!, { ...n[1]!, chu: 'Cơm nguội nhanh, cả nhà ăn không ngon', loi: 'Mới dọn ra một lúc cơm đã nguội, cả nhà ăn không ngon miệng. Chị Mai nhìn bát cơm thừa mà thấy tiếc công nấu cả buổi sáng.' },
        n[2]!, n[3]!, n[4]!, { ...n[4]!, chu: 'Nút gạt điều khiển dễ dùng', loi: 'Nút gạt điều khiển dễ dùng, bà nội tự nấu được mà không cần hỏi ai. Ông nội cũng học cách nấu chỉ sau một lần xem.' }, n[5]!]
    const r = locTruyen({ truyen: [dai] }, ten, moTa)
    const loai = r.truyen[0]?.nhip.map(x => x.loai).join(',')
    dung(`8 nhịp ⇒ còn ${NHIP_TOI_DA}: giữ 2 rắc rối đúng thứ tự, bớt lợi ích cuối`, loai === 'mo,roi,roi,ngoat,loi-ich,loi-ich,ket'
        && r.truyen[0]!.nhip[2]!.chu.startsWith('Cơm nguội') && !r.truyen[0]!.nhip.some(x => x.chu === 'Nút gạt điều khiển dễ dùng'), loai)
}

console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
process.exit(loi ? 1 : 0)
