/* Kiểm chứng TỰ XẾP LỊCH ĐĂNG VIDEO (lib/xepLichVideo.ts) bằng prisma giả — 14/10/2026.
 *   npx tsx scripts/check-xep-lich-video.ts
 * Mỗi luật có ca "phải xếp" lẫn ca "phải chừa": không hai video một giờ trên cùng gian, tối đa N/gian/ngày (tính
 * cả video đã hẹn/đã đăng), cùng mã cách ≥ Y ngày, ≥20 phút tới, video thiếu điều kiện thì nói lý do. */
import { lapLich, mocVN, ngayVN, chuanXep, oTrongNgay } from '../src/lib/xepLichVideo'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }

type M = any
function prismaGia(media: M[], kenh: M[]) {
    const khop = (m: M, w: any): boolean => {
        if (!w) return true
        if (w.OR) return w.OR.some((x: any) => khop(m, x))
        for (const [k, v] of Object.entries<any>(w)) {
            if (k === 'OR') continue
            const gt = m[k]
            if (v && typeof v === 'object' && !(v instanceof Date)) {
                if ('in' in v && !v.in.includes(gt)) return false
                if ('gte' in v && !(gt && new Date(gt) >= v.gte)) return false
                if ('lte' in v && !(gt && new Date(gt) <= v.lte)) return false
            } else if (gt !== v) return false
        }
        return true
    }
    return {
        sanMedia: { findMany: async (q: any) => media.filter(m => khop(m, q.where)).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)) },
        onlineChannel: { findMany: async () => kenh },
    }
}

const nay = mocVN('2026-10-15', '10:00')
const homNay = ngayVN(nay), mai = ngayVN(nay + 86400_000), mot = ngayVN(nay + 2 * 86400_000), ba = ngayVN(nay + 3 * 86400_000)
const kenh = [{ id: 'A', name: 'Kengi Store', videoUserId: 'u1' }, { id: 'B', name: 'Kengi Tools', videoUserId: null }]
let tao = 0
const nhap = (ten: string, sku: string, o: any = {}) => ({
    id: ten, ten, kenh: 'shopee', channelId: 'A', nguon: 'drive', nguonId: 'f-' + ten, coNoiDungAI: true, thoiLuongS: 25,
    trangThai: 'nhap', createdAt: new Date(nay - 86400_000 + (tao++) * 60_000), sanPham: [{ sku }], ...o,
})
const xep = chuanXep({ khung: ['20:00', '11:30'], moiNgay: 2, cachPhut: 120, cungMaCachNgay: 3 })

;(async () => {
    // 1. Ô đã chiếm 20:00 hôm nay ⇒ video đầu vào 11:30 hôm nay, sau đó mai 11:30, mai 20:00…
    const media = [
        { id: 'H', ten: 'đã hẹn', kenh: 'shopee', channelId: 'A', trangThai: 'hen_gio', henDangLuc: new Date(mocVN(homNay, '20:00')), sanPham: [{ sku: 'X0' }] },
        nhap('v1', 'S1'), nhap('v2', 'S2'), nhap('v3', 'S3'), nhap('v4', 'S4'),
    ]
    const kh = await lapLich(prismaGia(media, kenh), { xep, now: nay })
    const gio = (id: string) => kh.ke.find(k => k.id === id)?.henDangLuc
    dung('khung giờ được xếp theo thứ tự trong ngày (nhập 20:00, 11:30)', xep.khung.join() === '11:30,20:00')
    dung('v1 vào 11:30 hôm nay (20:00 đã có video)', gio('v1') === new Date(mocVN(homNay, '11:30')).toISOString(), gio('v1'))
    dung('v2 sang mai 11:30 (hôm nay đủ 2)', gio('v2') === new Date(mocVN(mai, '11:30')).toISOString(), gio('v2'))
    dung('v3 mai 20:00', gio('v3') === new Date(mocVN(mai, '20:00')).toISOString(), gio('v3'))
    dung('v4 ngày kia 11:30', gio('v4') === new Date(mocVN(mot, '11:30')).toISOString(), gio('v4'))
    dung('đếm ô đã chiếm', kh.daChiem === 1, String(kh.daChiem))

    // 2. Không hai video cùng giờ trên một gian; đủ N/ngày tính cả video ĐÃ ĐĂNG hôm nay
    const media2 = [
        { id: 'D', ten: 'đã đăng', kenh: 'shopee', channelId: 'A', trangThai: 'da_dang', dangLuc: new Date(mocVN(homNay, '08:00')), sanPham: [{ sku: 'Z' }] },
        { id: 'L', ten: 'Shopee giữ lịch', kenh: 'shopee', channelId: 'A', trangThai: 'da_len_lich', henDangLuc: new Date(mocVN(homNay, '11:30')), sanPham: [{ sku: 'Y' }] },
        nhap('w1', 'T1'),
    ]
    const kh2 = await lapLich(prismaGia(media2, kenh), { xep, now: nay })
    dung('hôm nay đã đăng 1 + đã lên lịch 1 ⇒ w1 sang mai', kh2.ke[0]?.henDangLuc === new Date(mocVN(mai, '11:30')).toISOString(), kh2.ke[0]?.henDangLuc)

    // 3. Cùng mã cách ≥3 ngày trên cùng gian
    const media3 = [nhap('m1', 'SKU'), nhap('m2', 'SKU'), nhap('m3', 'KHAC')]
    const kh3 = await lapLich(prismaGia(media3, kenh), { xep, now: nay })
    const g3 = (id: string) => kh3.ke.find(k => k.id === id)?.henDangLuc || ''
    dung('m1 hôm nay 11:30', g3('m1') === new Date(mocVN(homNay, '11:30')).toISOString(), g3('m1'))
    dung('m3 (mã khác) chen 20:00 hôm nay', g3('m3') === new Date(mocVN(homNay, '20:00')).toISOString(), g3('m3'))
    dung('m2 cùng mã ⇒ cách 3 ngày', g3('m2') === new Date(mocVN(ba, '11:30')).toISOString(), g3('m2'))
    const kh3b = await lapLich(prismaGia(media3, kenh), { xep: { ...xep, cungMaCachNgay: 0 }, now: nay })
    dung('tắt luật cùng mã ⇒ m2 vào ngay 20:00 hôm nay', kh3b.ke.find(k => k.id === 'm2')?.henDangLuc === new Date(mocVN(homNay, '20:00')).toISOString(), kh3b.ke.find(k => k.id === 'm2')?.henDangLuc)

    // 4. Sát giờ: 11:20 thì 11:30 không kịp (Shopee cần ≥15 phút, mình chừa 20)
    const kh4 = await lapLich(prismaGia([nhap('s1', 'Q')], kenh), { xep, now: mocVN(homNay, '11:20') })
    dung('11:20 ⇒ bỏ ô 11:30, vào 20:00', kh4.ke[0]?.henDangLuc === new Date(mocVN(homNay, '20:00')).toISOString(), kh4.ke[0]?.henDangLuc)

    // 5. Khoảng cách tối thiểu: mốc 11:30 + 12:00, cách 120 phút, 3/ngày ⇒ k2 KHÔNG vào 12:00 (cách 11:30 chỉ 30 phút)
    //    mà vào ô sau mốc 12:00 cách 120 phút (14:00) — vẫn trong ngày vì còn chỉ tiêu
    const kh5 = await lapLich(prismaGia([nhap('k1', 'K1'), nhap('k2', 'K2')], kenh), { xep: chuanXep({ khung: ['11:30', '12:00'], moiNgay: 3, cachPhut: 120, cungMaCachNgay: 0 }), now: nay })
    dung('cách 120 phút ⇒ k2 không vào 12:00, vào 14:00', kh5.ke.find(k => k.id === 'k2')?.henDangLuc === new Date(mocVN(homNay, '14:00')).toISOString(), kh5.ke.find(k => k.id === 'k2')?.henDangLuc)

    // 5b. Ô QUANH MỐC: 12 video/ngày với 3 mốc cách 30 phút ⇒ đủ 12 ô, xoay vòng giữa các mốc, không lấn mốc sau
    const o12 = oTrongNgay(chuanXep({ khung: ['11:30', '17:00', '20:00'], moiNgay: 12, cachPhut: 30, cungMaCachNgay: 0 }))
    dung('3 mốc, 12/ngày ⇒ 12 ô', o12.length === 12, o12.join(' '))
    dung('xoay vòng: 3 ô đầu là đúng 3 mốc', o12.slice(0, 3).join() === '11:30,17:00,20:00', o12.slice(0, 6).join(' '))
    dung('ô thứ 4–6 là mốc + 30 phút', o12.slice(3, 6).join() === '12:00,17:30,20:30')
    dung('số/ngày ≤ số mốc ⇒ chỉ đúng các mốc', oTrongNgay(chuanXep({ khung: ['11:30', '20:00'], moiNgay: 2, cachPhut: 120, cungMaCachNgay: 0 })).join() === '11:30,20:00')
    // Mốc quá sát nhau (cấu hình thật 14/10: 14:01, 14:02, 14:30 với cách 30 phút) ⇒ chỉ nhận một, rồi bù ô quanh mốc cho đủ
    const thatCH = chuanXep({ khung: ['11:30', '12:00', '12:30', '13:30', '14:01', '14:02', '14:30', '15:30', '16:30', '17:00', '17:30', '20:00'], moiNgay: 12, cachPhut: 30, cungMaCachNgay: 0 })
    const oThat = oTrongNgay(thatCH)
    const phutO = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
    const cachDeu = oThat.every((x, i) => oThat.every((y, j) => i === j || Math.abs(phutO(x) - phutO(y)) >= 30))
    dung('mốc sát nhau bị bỏ, mọi ô cách nhau ≥30 phút', cachDeu && !oThat.includes('14:02') && !oThat.includes('14:30'), oThat.join(' '))
    dung('vẫn đủ ô cho 12 video/ngày nhờ bù ô quanh mốc (dư thì bộ xếp có thêm lựa chọn)', oThat.length >= 12, String(oThat.length))
    dung('12 ô đầu theo ưu tiên: các mốc trước, rồi ô bù 13:00, 15:00', oThat.slice(0, 12).join() === '11:30,12:00,12:30,13:30,14:01,15:30,16:30,17:00,17:30,20:00,13:00,15:00', oThat.slice(0, 12).join(' '))
    const o40 = oTrongNgay(chuanXep({ khung: ['20:00'], moiNgay: 12, cachPhut: 60, cungMaCachNgay: 0 }))
    dung('không quá 23:30', o40.every(g => g <= '23:30') && o40.length === 4, o40.join(' '))
    const kh5b = await lapLich(prismaGia(Array.from({ length: 12 }, (_, i) => nhap('q' + i, 'Q' + i)), kenh), { xep: chuanXep({ khung: ['11:30', '17:00', '20:00'], moiNgay: 12, cachPhut: 30, cungMaCachNgay: 0 }), now: mocVN(homNay, '06:00') })
    const ngayQ = new Set(kh5b.ke.map(k => ngayVN(Date.parse(k.henDangLuc))))
    dung('12 video ⇒ cùng một ngày, 12 giờ khác nhau', kh5b.ke.length === 12 && ngayQ.size === 1 && new Set(kh5b.ke.map(k => k.henDangLuc)).size === 12, `${kh5b.ke.length} video, ${ngayQ.size} ngày, ô/ngày ${kh5b.oMoiNgay}`)

    // 6. Thiếu điều kiện ⇒ nói lý do, KHÔNG xếp
    const media6 = [
        nhap('chuaKhai', 'C1', { coNoiDungAI: null }), nhap('gianB', 'C2', { channelId: 'B' }), nhap('tiktok', 'C3', { kenh: 'tiktok' }),
        nhap('lienKet', 'C4', { nguon: 'lien_ket', nguonId: null }), nhap('khongGian', 'C5', { channelId: null }), nhap('dai', 'C6', { thoiLuongS: 200 }),
    ]
    const kh6 = await lapLich(prismaGia(media6, kenh), { xep, now: nay })
    const ly = (id: string) => kh6.boQua.find(b => b.id === id)?.lyDo || ''
    dung('không xếp video thiếu điều kiện', kh6.ke.length === 0, String(kh6.ke.length))
    dung('chưa khai AI', /khai/.test(ly('chuaKhai')), ly('chuaKhai'))
    dung('gian chưa uỷ quyền', /uỷ quyền/.test(ly('gianB')), ly('gianB'))
    dung('TikTok', /TikTok/.test(ly('tiktok')), ly('tiktok'))
    dung('không ở Drive', /Drive/.test(ly('lienKet')), ly('lienKet'))
    dung('chưa chọn gian', /gian/.test(ly('khongGian')), ly('khongGian'))
    dung('quá 180 giây', /180/.test(ly('dai')), ly('dai'))

    // 7. Hết chỗ 30 ngày ⇒ báo, không xếp quá 30 ngày
    const nhieu = Array.from({ length: 70 }, (_, i) => nhap('n' + i, 'N' + i))
    const kh7 = await lapLich(prismaGia(nhieu, kenh), { xep, now: nay })
    const muonNhat = Math.max(...kh7.ke.map(k => Date.parse(k.henDangLuc)))
    dung('không hẹn quá 30 ngày', muonNhat <= nay + 30 * 86400_000, new Date(muonNhat).toISOString())
    dung('phần dư báo hết ô', kh7.boQua.length === 70 - kh7.ke.length && kh7.boQua.every(b => /Hết ô/.test(b.lyDo)), `${kh7.ke.length} xếp, ${kh7.boQua.length} chờ`)
    const theoGio = new Set(kh7.ke.map(k => k.henDangLuc))
    dung('không hai video trùng giờ', theoGio.size === kh7.ke.length)

    console.log(loi ? `\n✗ ${loi} ca sai` : '\n✓ Tự xếp lịch: mọi ca đúng')
    process.exit(loi ? 1 : 0)
})()
