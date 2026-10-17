/* Kiểm chứng cấu hình VIDEO TỰ ĐỘNG theo KIỂU NỘI DUNG (lib/videoTuDong.ts) — 17/10/2026.
 *   npx tsx scripts/check-video-tu-dong.ts
 * Kiểu mới (câu chuyện / lý do nên chọn) mở ra nội dung mới cho mã đã "hết biến thể" kiểu giới thiệu — nhưng chỉ khi cấu hình
 * thật sự dùng kiểu mới; mã hết biến thể SAU khi đã có kiểu mới thì vẫn phải nghỉ 30 ngày. */
import { chuanTuDong, kieuDung, skuBoQua, MOC_KIEU_VIDEO, KIEU_VIDEO } from '../src/lib/videoTuDong'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }

async function main() {
    {
        const c = chuanTuDong({})
        dung('cấu hình cũ (không có kieu) ⇒ rỗng = cả 3 kiểu', c.kieu.length === 0 && kieuDung(c).join(',') === KIEU_VIDEO.join(','), kieuDung(c).join(','))
        const c2 = chuanTuDong({ kieu: ['cau-chuyen', 'bay-ba', 'cau-chuyen', 7, 'gioi-thieu'] })
        dung('kiểu lạ / trùng bị lọc, giữ thứ tự', c2.kieu.join(',') === 'cau-chuyen,gioi-thieu', c2.kieu.join(','))
        dung('chỉ chọn giới thiệu ⇒ kieuDung đúng một kiểu', kieuDung(chuanTuDong({ kieu: ['gioi-thieu'] })).join(',') === 'gioi-thieu')
    }
    const prisma = { sanMediaSanPham: { findMany: async () => [{ sku: 'DA-LAM-HOM-NAY' }] } }
    const now = MOC_KIEU_VIDEO + 2 * 86400_000
    const luc = (ms: number) => new Date(ms).toISOString()
    const nhatKy = [
        { luc: luc(MOC_KIEU_VIDEO - 5 * 86400_000), ngay: '', loai: 'het-bien-the', sku: 'HET-CU' },
        { luc: luc(MOC_KIEU_VIDEO + 86400_000), ngay: '', loai: 'het-bien-the', sku: 'HET-MOI' },
        { luc: luc(MOC_KIEU_VIDEO - 5 * 86400_000), ngay: '', loai: 'mo-ta-lech', sku: 'LECH-CU' },
        { luc: luc(now - 86400_000), ngay: '', loai: 'loi-sp', sku: 'LOI-SP' },
    ]
    {
        const r = await skuBoQua(prisma, nhatKy, '2026-10-19', now, 'kenh1', [...KIEU_VIDEO])
        dung('có kiểu mới ⇒ mã hết biến thể TRƯỚC mốc được làm tiếp', !r.includes('HET-CU'), r.join(','))
        dung('có kiểu mới ⇒ mã hết biến thể SAU mốc vẫn nghỉ', r.includes('HET-MOI'))
        dung('mô tả lệch / lỗi mã / đã làm hôm nay vẫn bị bỏ qua', r.includes('LECH-CU') && r.includes('LOI-SP') && r.includes('DA-LAM-HOM-NAY'))
    }
    {
        const r = await skuBoQua(prisma, nhatKy, '2026-10-19', now, 'kenh1', ['gioi-thieu'])
        dung('chỉ kiểu giới thiệu ⇒ mã hết biến thể cũ vẫn nghỉ như trước', r.includes('HET-CU') && r.includes('HET-MOI'), r.join(','))
    }
    {
        const r = await skuBoQua(prisma, nhatKy, '2026-10-19', now, 'kenh1')
        dung('gọi kiểu cũ (không truyền kiểu) ⇒ như trước', r.includes('HET-CU'))
    }
    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
