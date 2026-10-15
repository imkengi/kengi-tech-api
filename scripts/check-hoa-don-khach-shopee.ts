/* Kiểm chứng TỰ LẤY THÔNG TIN XUẤT HĐ khách khai trên Shopee (lib/hoaDonKhachShopee.ts) — 15/10/2026.
 *   npx tsx scripts/check-hoa-don-khach-shopee.ts
 * Canh: chỉ HĐ công ty / hộ KD có MST RÕ mới ghi lên phiếu (cá nhân Shopee che tên/địa chỉ — ghi là đổi chính sách xuất của
 * cửa hàng); trường bị che (A****b) không bao giờ lên phiếu; không đè thông tin nhân viên đã có; lỗi Shopee không làm sập lượt. */
import { thongTinDungDuoc, layHoaDonKhachShopee } from '../src/lib/hoaDonKhachShopee'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (!ok) loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`) }

async function main() {
    // ── 1. luật "dùng được" ──
    const congTy = thongTinDungDuoc({ invoiceType: 'company', name: 'Nguyễn Văn A', companyName: 'Công ty TNHH Kengi', companyTaxId: '0312 345 678', companyAddress: '12 Lê Lợi, Q1', companyEmail: 'ketoan@kengi.vn' })
    dung('công ty: tên ĐƠN VỊ làm tên người mua, MST bỏ khoảng trắng, email công ty',
        congTy?.name === 'Công ty TNHH Kengi' && congTy?.taxCode === '0312345678' && congTy?.email === 'ketoan@kengi.vn' && congTy?.tuDong === true, JSON.stringify(congTy))
    const ho = thongTinDungDuoc({ invoiceType: 'household', name: 'Trần Thị B', companyName: 'Hộ KD Tạp hoá B', taxId: '079123456789', address: '5 Hai Bà Trưng', email: 'b@gmail.com' })
    dung('hộ KD: tên người + MST cá nhân (tên hộ do tra MST điền lúc xuất)', ho?.name === 'Trần Thị B' && ho?.taxCode === '079123456789', JSON.stringify(ho))
    dung('cá nhân bị che ⇒ KHÔNG dùng', thongTinDungDuoc({ invoiceType: 'personal', name: 'N****n', address: 'H****i', email: 'khach@gmail.com' }) === null)
    dung('cá nhân KHÔNG che cũng không tự ghi (không có MST — giữ chính sách xuất)', thongTinDungDuoc({ invoiceType: 'personal', name: 'Lê C', email: 'c@x.vn' }) === null)
    dung('công ty mà MST bị che ⇒ KHÔNG dùng', thongTinDungDuoc({ invoiceType: 'company', companyName: 'Cty X', companyTaxId: '03****78' }) === null)
    const cheEmail = thongTinDungDuoc({ invoiceType: 'company', companyName: 'Cty Y', companyTaxId: '0101010101', companyEmail: 'k****n@y.vn' })
    dung('trường bị che (email) bỏ trống, phần rõ vẫn dùng', cheEmail?.email === '' && cheEmail?.taxCode === '0101010101', JSON.stringify(cheEmail))
    dung('null / thiếu loại ⇒ null', thongTinDungDuoc(null) === null && thongTinDungDuoc({ invoiceType: '' }) === null)

    // ── 2. hỏi theo lô + ghi lên phiếu ──
    const phieu: Record<string, any> = {
        t1: { id: 't1', receiptNumber: 'ONLINE-SPE-AAA', vatBuyerInfo: null },          // công ty ⇒ ghi
        t2: { id: 't2', receiptNumber: 'ONLINE-SPE-BBB', vatBuyerInfo: null },          // cá nhân che ⇒ không
        t3: { id: 't3', receiptNumber: 'ONLINE-SPE-CCC', vatBuyerInfo: '{"name":"tay"}' }, // đã có ⇒ không đè
        t4: { id: 't4', receiptNumber: 'ONLINE-TIK-DDD', vatBuyerInfo: null },          // TikTok ⇒ bỏ
        t5: { id: 't5', receiptNumber: 'ONLINE-SPE-EEE', vatBuyerInfo: null },          // khách không khai
    }
    const don = [
        { orderNumber: 'SPE-AAA', externalOrderId: 'AAA', channelId: 'k1' },
        { orderNumber: 'SPE-BBB', externalOrderId: 'BBB', channelId: 'k1' },
        { orderNumber: 'SPE-CCC', externalOrderId: 'CCC', channelId: 'k1' },
        { orderNumber: 'SPE-EEE', externalOrderId: 'EEE', channelId: 'k1' },
    ]
    const goiShopee: string[][] = []
    const shopee = {
        async getBuyerInvoiceInfoBatch(sns: string[]) {
            goiShopee.push(sns)
            const thongTin = new Map<string, any>()
            for (const sn of sns) {
                if (sn === 'AAA') thongTin.set(sn, { invoiceType: 'company', companyName: 'Cty AAA', companyTaxId: '0300000001', companyEmail: 'a@a.vn' })
                else if (sn === 'BBB') thongTin.set(sn, { invoiceType: 'personal', name: 'N****n', address: 'H****i', email: 'b@b.vn' })
                else if (sn === 'CCC') thongTin.set(sn, { invoiceType: 'company', companyName: 'Cty CCC', companyTaxId: '0300000003' })
                else thongTin.set(sn, null)
            }
            return { thongTin, loiDong: { 'receipt settings not found': sns.filter(s => s === 'EEE').length } }
        },
    }
    const prismaGia = {
        onlineOrder: { async findMany(a: any) { return don.filter(d => a.where.orderNumber.in.includes(d.orderNumber)) } },
        onlineChannel: { async findUnique() { return { id: 'k1', name: 'Kengi Store', platform: 'shopee', accessToken: 'tk' } } },
        transaction: {
            async updateMany(a: any) {
                const p = phieu[a.where.id]
                if (!p || p.vatBuyerInfo !== null) return { count: 0 }
                p.vatBuyerInfo = a.data.vatBuyerInfo
                return { count: 1 }
            },
        },
    }
    const kq = await layHoaDonKhachShopee(prismaGia, Object.values(phieu), { ghi: true, dichVu: async () => shopee })
    dung('chỉ hỏi Shopee cho đơn Shopee (bỏ TikTok)', goiShopee.flat().sort().join() === 'AAA,BBB,CCC,EEE', goiShopee.flat().join())
    dung('đếm: 4 hỏi, 3 có khai, 1 cá nhân bị che, 2 dùng được', kq.daHoi === 4 && kq.coKhai === 3 && kq.caNhanBiChe === 1 && kq.dungDuoc === 2, JSON.stringify(kq))
    dung('ghi phiếu công ty đang trống (t1)', kq.daGhiPhieu.join() === 't1' && JSON.parse(phieu.t1.vatBuyerInfo).taxCode === '0300000001', phieu.t1.vatBuyerInfo)
    dung('KHÔNG ghi cá nhân bị che (t2 vẫn trống)', phieu.t2.vatBuyerInfo === null)
    dung('KHÔNG đè thông tin đã có (t3 giữ của nhân viên)', phieu.t3.vatBuyerInfo === '{"name":"tay"}')
    dung('trả mã đơn đã ghi để báo', kq.daGhiDon.join() === 'SPE-AAA')

    // chế độ chỉ đo (ghi: false) — không đụng phiếu
    phieu.t1.vatBuyerInfo = null
    const kqDo = await layHoaDonKhachShopee(prismaGia, [phieu.t1], { dichVu: async () => shopee })
    dung('ghi:false ⇒ chỉ đếm, không ghi', kqDo.dungDuoc === 1 && kqDo.daGhiPhieu.length === 0 && phieu.t1.vatBuyerInfo === null)

    // ── 3. lô 50 + lỗi Shopee không làm sập ──
    const nhieu = Array.from({ length: 120 }, (_, i) => ({ orderNumber: `SPE-N${i}`, externalOrderId: `N${i}`, channelId: 'k1' }))
    const lo: number[] = []
    let lan = 0
    const shopeeHong = {
        async getBuyerInvoiceInfoBatch(sns: string[]) {
            lo.push(sns.length)
            if (++lan === 2) throw new Error('Shopee error_server: Something wrong')
            return { thongTin: new Map(sns.map(s => [s, null])), loiDong: {} }
        },
    }
    const prisma2 = { ...prismaGia, onlineOrder: { async findMany() { return nhieu } } }
    const kq3 = await layHoaDonKhachShopee(prisma2, nhieu.map((d, i) => ({ id: `x${i}`, receiptNumber: `ONLINE-${d.orderNumber}` })), { ghi: true, dichVu: async () => shopeeHong })
    dung('hỏi theo lô 50 (50, 50, 20)', lo.join() === '50,50,20', lo.join())
    dung('một lô lỗi ⇒ ghi lỗi, các lô khác vẫn chạy', kq3.loi.length === 1 && /error_server/.test(kq3.loi[0]) && kq3.daHoi === 70, JSON.stringify(kq3.loi))

    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
