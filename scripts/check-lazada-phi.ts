/**
 * check-lazada-phi — lấy phí thật của đơn Lazada (14/11/2026, chủ shop duyệt bước 1 trước Lazada Pilot).
 *
 *  E. docGiaoDichTaiChinh (QueryTransactionDetails) với httpGet giả: kiểm ngày YYYY-MM-DD + khoảng < 180 ngày TRƯỚC khi gọi,
 *     lật trang 500 dòng theo offset, chỉ gửi đúng tham số, lỗi Lazada ném nguyên văn, chạm giới hạn trang thì báo catTai.
 *
 * Không gọi mạng, không đụng CSDL. Chạy: npm run check:lazada-phi
 */
import { LazadaService } from '../src/services/platforms/lazada'

let dat = 0, hong = 0
function ca(ten: string, dung: boolean, them = '') { if (dung) dat++; else { hong++; console.log(`  ✗ ${ten}${them ? ` — ${them}` : ''}`) } }

const KHOA_CHUNG = ['app_key', 'timestamp', 'sign_method', 'access_token', 'sign']
const dongGD = (i: number, them: any = {}) => ({
    order_no: String(400000000000 + Math.floor(i / 4)), orderItem_no: String(500000000000 + i), amount: '-1000.00',
    transaction_type: 'Payment Fee', fee_name: 'Payment Fee', fee_type: '13', paid_status: 'Not paid',
    transaction_date: '12 Nov 2026', statement: '10 Nov 2026 - 16 Nov 2026', ...them,
})

async function main() {
    // ─── E. docGiaoDichTaiChinh ──────────────────────────────────────────────────
    {
        const svc: any = new LazadaService({ apiKey: 'k', apiSecret: 's', accessToken: 't' } as any)
        let goi = 0
        svc.httpGet = async () => { goi++; return { code: '0', data: [] } }
        const nem = async (o: any) => { try { await svc.docGiaoDichTaiChinh(o); return '' } catch (e: any) { return String(e?.message || e) } }
        const l1 = await nem({ tu: '2026/11/01', den: '2026-11-14' })
        const l2 = await nem({ tu: '2026-01-01', den: '2026-11-14' })
        const l3 = await nem({ tu: '2026-11-14', den: '2026-11-01' })
        ca('E1 ngày sai dạng / khoảng > 179 ngày / đảo ngược ⇒ NÉM, KHÔNG gọi Lazada lần nào',
            /YYYY-MM-DD/.test(l1) && /317 ngày/.test(l2) && /-13 ngày/.test(l3) && goi === 0, JSON.stringify({ l1, l2, l3, goi }))
        const l4 = await nem({ tu: '2026-05-19', den: '2026-11-14' })
        ca('E2 đúng 179 ngày ⇒ được gọi', l4 === '' && goi === 1, JSON.stringify({ l4, goi }))

        const tatCa = Array.from({ length: 1234 }, (_, i) => dongGD(i))
        const thamSo: string[] = [], offsets: number[] = []
        svc.httpGet = async (url: string) => {
            const u = new URL(url)
            if (!u.pathname.endsWith('/finance/transaction/details/get')) throw new Error('bộ kiểm: lời gọi ngoài dự kiến ' + u.pathname)
            thamSo.push([...u.searchParams.keys()].filter(k => !KHOA_CHUNG.includes(k)).sort().join(','))
            const off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'))
            offsets.push(off)
            return { code: '0', data: tatCa.slice(off, off + lim) }
        }
        const r = await svc.docGiaoDichTaiChinh({ tu: '2026-10-15', den: '2026-11-14' })
        ca('E3 lật trang offset 0, 500, 1000 (limit 500) rồi dừng khi trang thiếu — đủ 1234 dòng, không catTai',
            offsets.join() === '0,500,1000' && r.dong.length === 1234 && !r.catTai, JSON.stringify({ offsets, n: r.dong.length, catTai: r.catTai }))
        ca('E4 chỉ gửi start_time / end_time / offset / limit khi không lọc', thamSo.every(t => t === 'end_time,limit,offset,start_time'), JSON.stringify(thamSo))
        thamSo.length = 0; offsets.length = 0
        await svc.docGiaoDichTaiChinh({ tu: '2026-10-15', den: '2026-11-14', maDon: '400000000001', loai: '-1' })
        ca('E5 lọc theo đơn + loại ⇒ thêm trade_order_id / trans_type', thamSo[0] === 'end_time,limit,offset,start_time,trade_order_id,trans_type', JSON.stringify(thamSo))
        offsets.length = 0
        const cat = await svc.docGiaoDichTaiChinh({ tu: '2026-10-15', den: '2026-11-14', toiDaTrang: 2 })
        ca('E6 chạm giới hạn trang ⇒ trả phần đã đọc KÈM catTai (không giả là đủ)',
            cat.dong.length === 1000 && /1000 dòng/.test(cat.catTai || '') && offsets.join() === '0,500', JSON.stringify({ n: cat.dong.length, catTai: cat.catTai, offsets }))

        svc.httpGet = async () => ({ code: 'IllegalAccessToken', message: 'The specified access token is invalid or expired' })
        const l5 = await nem({ tu: '2026-10-15', den: '2026-11-14' })
        ca('E7 lỗi token ⇒ NÉM "Lazada từ chối kênh" + nguyên văn', /Lazada từ chối kênh: \[IllegalAccessToken\] The specified access token is invalid/.test(l5), l5)
        svc.httpGet = async (url: string) => Number(new URL(url).searchParams.get('offset')) === 500
            ? { code: '1000012', message: 'endTime - startTime must should be less than 180 days' }
            : { code: '0', data: tatCa.slice(0, 500) }
        const l6 = await nem({ tu: '2026-10-15', den: '2026-11-14' })
        ca('E8 hỏng giữa chừng ⇒ NÉM kèm khoảng ngày, offset, mã + lời Lazada (không trả nửa danh sách)',
            /finance\/transaction\/details\/get \(2026-10-15 → 2026-11-14, offset 500\): \[1000012\] endTime - startTime/.test(l6), l6)
        svc.httpGet = async () => ({ code: 0, data: null })
        const rong = await svc.docGiaoDichTaiChinh({ tu: '2026-11-14', den: '2026-11-14' })
        ca('E9 code số 0 + data null ⇒ không dòng nào, không lỗi (0 ngày là khoảng hợp lệ)', rong.dong.length === 0 && !rong.catTai, JSON.stringify(rong))
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
