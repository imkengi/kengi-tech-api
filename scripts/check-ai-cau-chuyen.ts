/* Kiểm chứng BỘ LỌC truyện AI (lib/aiCauChuyen.ts → locTruyen) — 17/10/2026.
 *   npx tsx scripts/check-ai-cau-chuyen.ts
 * Truyện là hư cấu nhưng điều nói về SẢN PHẨM phải đúng mô tả, và không được lẫn quảng cáo / đánh giá giả / dẫn ra ngoài sàn.
 * Mỗi luật có ca PHẢI GIỮ lẫn ca PHẢI BỎ. */
import { locTruyen, BIEU_TUONG } from '../src/lib/aiCauChuyen'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }

const ten = 'Nồi cơm điện 1.8L Sunhouse Mama SHD8666G'
const moTa = 'Dung tích 1.8L. Công suất 700W. Mâm nhiệt lớn tỏa nhiệt đều. Lòng nồi dạng niêu giúp cơm dẻo ngon. Nút gạt điều khiển dễ dùng.'
const nhip = (loai: string, chu: string, loi = chu + '.', bieuTuong = '😊') => ({ loai, chu, loi, bieuTuong })
const tot = (them: any = {}) => ({
    tieuDe: 'Chuyện bữa sáng nhà chị Mai',
    nhip: [
        nhip('mo', 'Sáng nào nhà chị Mai cũng tất bật', 'Sáng nào nhà chị Mai cũng tất bật lo bữa cơm.', '⏰'),
        nhip('roi', 'Nồi cũ nấu cơm chín không đều', 'Nồi cũ nấu cơm chỗ khô chỗ nhão.', '😩'),
        nhip('ngoat', 'Rồi chị đổi sang nồi 1.8L mới', 'Rồi chị Mai đổi sang nồi cơm điện 1.8L.', '✨'),
        nhip('loi-ich', 'Công suất 700W nấu nhanh', 'Công suất 700W, cơm chín nhanh.', '🔥'),
        nhip('loi-ich', 'Lòng nồi dạng niêu, cơm dẻo ngon', 'Lòng nồi dạng niêu, cơm dẻo ngon hơn.', '🍚'),
        nhip('ket', 'Bữa cơm giờ ngon hơn hẳn', 'Giờ bữa cơm nhà chị ngon hơn hẳn.', '😊'),
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
    const t = tot(); t.nhip[0] = { ...t.nhip[0]!, chu: 'Một câu chữ trên hình dài quá mức cho phép của khung video ngắn' }
    const r = locTruyen({ truyen: [t] }, ten, moTa)
    dung('chữ lên hình dài quá khung ⇒ bỏ (nhịp mở hỏng ⇒ cả truyện)', r.truyen.length === 0)
}

console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
process.exit(loi ? 1 : 0)
