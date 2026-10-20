// ─────────────────────────────────────────────────────────────────────────────
//  /api/yeu-cau-hoa-don — TRANG KHÁCH TỰ LẤY HOÁ ĐƠN kengi.vn/hoadon (20/10/2026). CÔNG KHAI, KHÔNG đăng nhập.
//
//  Chủ shop: "thêm mục kengi.vn/hoadon/ để khách nhập đơn hàng lấy hoá đơn" + "khách nhập mã đơn để lấy hoá đơn
//  bảo hành nữa". Khách nhập MÃ ĐƠN SÀN (Shopee / TikTok / Lazada) rồi:
//    · tải HOÁ ĐƠN ĐIỆN TỬ THẬT (PDF có QR + chữ ký, lấy từ cổng VNPT như nút "Bản VNPT" của nhân viên) — dùng làm
//      chứng từ mua hàng khi bảo hành;
//    · gửi thông tin xuất HĐ có MST (công ty / hộ KD / cá nhân) ⇒ ghi Transaction.vatBuyerInfo, ĐÚNG chỗ đường xuất
//      20:30 đọc (cron/einvoiceQueue: phiếu có vatBuyerInfo luôn tự xuất khi giao xong + gửi email). Đơn ĐÃ xuất HĐ
//      thì chỉ còn đường HĐ THAY THẾ ⇒ thông báo nhân viên; form "Thay thế" tự điền sẵn từ vatBuyerInfo
//      (GET /einvoice/:id/yeu-cau-khach).
//
//  Mọi đường đều POST (mã đơn đi trong thân, KHÔNG nằm trên URL / nhật ký truy cập) và có giới hạn lượt theo IP.
//  Ai có mã đơn cũng tra được ⇒ chỉ trả thứ khách cần: không tên / SĐT / địa chỉ người nhận; thông tin HĐ đã gửi
//  thì che bớt (MST ***678, email k***@…). Cửa hàng nhận yêu cầu: biến môi trường HOA_DON_KHACH_CUA_HANG
//  (mặc định KENGISTORE — đo 20/10 là cửa hàng duy nhất dùng HĐĐT thật), phải còn hoạt động và có cấu hình HĐĐT bật.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { traMst, LoiTraMst } from '../lib/traMst'
import {
    ungVienMaDon, kiemYeuCau, trangThaiDonKhach, cheMst, cheEmail, ngayVN, cuaHangNhanYeuCau, KENH_THEO_TIEN_TO,
} from '../lib/yeuCauHoaDon'

const router = Router()

const gioiHan = (phut: number, max: number, loi: string) => rateLimit({
    windowMs: phut * 60_000, max, standardHeaders: true, legacyHeaders: false,
    message: { success: false, error: loi },
})
const gioiHanTraCuu = gioiHan(10, 30, 'Bạn tra cứu quá nhiều lần — vui lòng thử lại sau 10 phút.')
const gioiHanGui = gioiHan(30, 10, 'Bạn gửi quá nhiều yêu cầu — vui lòng thử lại sau 30 phút.')
const gioiHanTai = gioiHan(10, 15, 'Bạn tải hoá đơn quá nhiều lần — vui lòng thử lại sau 10 phút.')
/* Tra MST đi qua VietQR, nguồn CHUNG với nhân viên và đường xuất HĐ (lib/traMst: ~20 lượt rồi khoá 10 phút theo IP
 * MÁY CHỦ). Siết theo IP khách VÀ trần chung cả máy để trang công khai không làm khoá tra MST của cửa hàng. */
const gioiHanMst = gioiHan(10, 6, 'Bạn tra mã số thuế quá nhiều lần — vui lòng tự điền tên và địa chỉ.')
const TRAN_MST_CHUNG = 20
let demMstChung: number[] = []

const TRANG_THAI_HD_DA_XUAT = ['ISSUING', 'issued', 'SIGNED', 'SENT']

interface CuaHang { code: string; prisma: any }

/** Các cửa hàng nhận yêu cầu: còn hoạt động + có cấu hình HĐĐT đang bật. Nhớ 60 giây — trang công khai, đừng hỏi
 *  registry + cấu hình HĐĐT ở MỌI lượt gõ của khách. */
let dsCuaHangNho: { at: number; ds: CuaHang[] } | null = null
async function moCuaHang(): Promise<CuaHang[]> {
    if (dsCuaHangNho && Date.now() - dsCuaHangNho.at < 60_000) return dsCuaHangNho.ds
    const ds = await docCuaHang()
    dsCuaHangNho = { at: Date.now(), ds }
    return ds
}
async function docCuaHang(): Promise<CuaHang[]> {
    const ma = cuaHangNhanYeuCau()
    const ds: any[] = await registryPrisma.store.findMany({
        where: { code: { in: ma }, status: 'active' }, select: { code: true, schema: true },
    })
    const ra: CuaHang[] = []
    for (const code of ma) {
        const s = ds.find(x => x.code === code)
        if (!s?.schema || s.schema === 'pending') continue
        const prisma: any = getStorePrisma(s.schema)
        const hddt = await prisma.eInvoiceConfig.findFirst({ where: { isActive: true }, select: { id: true } }).catch(() => null)
        if (hddt) ra.push({ code, prisma })
    }
    return ra
}

/** Tìm đơn theo mã khách nhập trong các cửa hàng nhận yêu cầu — đơn sàn + phiếu bán + hoá đơn đã xuất (nếu có). */
async function timDon(ungVien: string[]) {
    for (const ch of await moCuaHang()) {
        const o = await ch.prisma.onlineOrder.findFirst({
            where: { orderNumber: { in: ungVien } },
            select: {
                orderNumber: true, platform: true, channelName: true, status: true, total: true, createdAt: true, deliveredAt: true,
                items: { select: { productName: true, quantity: true, unitPrice: true, lineTotal: true } },
            },
        })
        if (!o) continue
        const tx = await ch.prisma.transaction.findFirst({
            where: { receiptNumber: `ONLINE-${o.orderNumber}` }, select: { id: true, vatBuyerInfo: true },
        })
        // Chỉ HĐ BÁN / THAY THẾ — HĐ điều chỉnh (trả hàng) cùng phiếu thì không phải tờ khách cần, tải theo Fkey cũng lệch số
        const hd = tx ? await ch.prisma.eInvoice.findFirst({
            where: { transactionId: tx.id, status: { in: TRANG_THAI_HD_DA_XUAT }, invoiceType: { in: ['SALE', 'REPLACEMENT'] } },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true, invoiceNumber: true, invoiceSymbol: true, issuedAt: true, createdAt: true,
                buyerTaxCode: true, invoiceType: true, replacesInvoiceId: true, transactionId: true,
            },
        }).catch(() => null) : null
        return { ch, o, tx, hd }
    }
    return null
}

function docThongTin(s: string | null | undefined): any {
    try { const j = s ? JSON.parse(s) : null; return j && typeof j === 'object' ? j : null } catch { return null }
}

const KHONG_THAY = 'Không tìm thấy đơn hàng. Kiểm tra lại mã đơn: Shopee 14 ký tự, TikTok 18 số, Lazada 15 số (xem trong mục Đơn mua của ứng dụng).'
const SAI_DANG = 'Mã đơn chưa đúng dạng — nhập mã đơn Shopee (14 ký tự), TikTok (18 số) hoặc Lazada (15 số).'

/** Khách chưa gửi được thì vì sao — null = gửi được */
function lyDoChuaGui(trangThai: string): string | null {
    if (trangThai === 'da_huy') return 'Đơn đã huỷ nên không xuất hoá đơn.'
    if (trangThai === 'tra_hang') return 'Đơn có trả hàng / hoàn tiền — vui lòng nhắn cửa hàng để được hỗ trợ hoá đơn.'
    if (trangThai === 'cho_xac_nhan') return 'Đơn đang chờ cửa hàng xác nhận. Bạn quay lại sau khi đơn được gửi đi (thường trong 24 giờ) để nhập thông tin xuất hoá đơn.'
    return null
}

// POST /tra-cuu — { maDon } ⇒ tóm tắt đơn, hoá đơn đã xuất chưa, đã gửi thông tin chưa (che bớt)
router.post('/tra-cuu', gioiHanTraCuu, async (req: Request, res: Response) => {
    try {
        const ung = ungVienMaDon(req.body?.maDon)
        if (!ung) return res.status(400).json({ success: false, error: SAI_DANG })
        const f = await timDon(ung)
        if (!f) return res.status(404).json({ success: false, error: KHONG_THAY })
        const { ch, o, tx, hd } = f
        const trangThai = trangThaiDonKhach(o, !!tx)
        // Lần lượt, không Promise.all — prod pool 1 kết nối/cửa hàng (bộ nhớ prisma-pool-promiseall-trap)
        const cai = await ch.prisma.storeSettings.findFirst({ select: { name: true, phone: true, address: true } }).catch(() => null)
        const hddt = await ch.prisma.eInvoiceConfig.findFirst({ where: { isActive: true }, select: { companyName: true, taxCode: true, companyAddress: true } }).catch(() => null)
        const vbi = docThongTin(tx?.vatBuyerInfo)
        const tienTo = String(o.orderNumber).split('-')[0]
        res.json({
            success: true,
            data: {
                cuaHang: {
                    // Tên GIAN HÀNG khách đã mua ("Kengi Store", "Kengi Tools" — đo 20/10) chứ không phải mã cửa hàng nội bộ
                    ten: o.channelName || cai?.name || hddt?.companyName || ch.code,
                    tenPhapLy: hddt?.companyName || '', mst: hddt?.taxCode || '',
                    diaChi: hddt?.companyAddress || cai?.address || '', sdt: cai?.phone || '',
                },
                don: {
                    ma: String(o.orderNumber).slice(tienTo.length + 1),
                    kenh: KENH_THEO_TIEN_TO[tienTo] || o.platform || 'Sàn',
                    ngayDat: ngayVN(o.createdAt), ngayGiao: ngayVN(o.deliveredAt),
                    tongTien: Number(o.total) || 0, trangThai,
                    mon: (o.items || []).slice(0, 60).map((i: any) => ({
                        ten: String(i.productName || ''), sl: Number(i.quantity) || 0,
                        gia: Number(i.unitPrice) || 0, thanhTien: Number(i.lineTotal) || 0,
                    })),
                },
                hoaDon: hd
                    ? { daXuat: true, so: hd.invoiceNumber || '', kyHieu: hd.invoiceSymbol || '', ngay: ngayVN(hd.issuedAt || hd.createdAt), coMst: !!hd.buyerTaxCode, thayThe: hd.invoiceType === 'REPLACEMENT' }
                    : { daXuat: false },
                yeuCau: vbi && (vbi.taxCode || vbi.name || vbi.email)
                    ? { loai: vbi.loai || (vbi.taxCode ? 'cong_ty' : 'ca_nhan'), mst: cheMst(vbi.taxCode || ''), email: cheEmail(vbi.email || ''), luc: ngayVN(vbi.luc), tuKhach: vbi.nguon === 'khach-web' }
                    : null,
                lyDoChuaGui: lyDoChuaGui(trangThai),
            },
        })
    } catch (err: any) {
        console.error('[yeu-cau-hoa-don/tra-cuu]', err?.message || err)
        res.status(500).json({ success: false, error: 'Hệ thống đang bận — vui lòng thử lại sau ít phút.' })
    }
})

// POST /gui — { maDon, loai, ten, mst, diaChi, email, cccd } ⇒ ghi vatBuyerInfo; đã xuất HĐ thì báo nhân viên lập HĐ thay thế
router.post('/gui', gioiHanGui, async (req: Request, res: Response) => {
    try {
        const ung = ungVienMaDon(req.body?.maDon)
        if (!ung) return res.status(400).json({ success: false, error: SAI_DANG })
        const kq = kiemYeuCau(req.body)
        if (!kq.ok) return res.status(400).json({ success: false, error: kq.loi })
        const f = await timDon(ung)
        if (!f) return res.status(404).json({ success: false, error: KHONG_THAY })
        const { ch, o, tx, hd } = f
        const lyDo = lyDoChuaGui(trangThaiDonKhach(o, !!tx))
        if (lyDo) return res.status(409).json({ success: false, error: lyDo })

        /* Đơn ĐÃ GIAO mà chưa có phiếu bán (mã hàng sàn chưa nối hàng kho — đo 20/10: 748 đơn): chưa có chỗ ghi
         * vatBuyerInfo, cũng chưa xuất HĐ được. Nhận yêu cầu bằng thông báo cho nhân viên, mang ĐỦ thông tin khách. */
        if (!tx) {
            const tin = await ch.prisma.notification.create({
                data: {
                    type: 'einvoice',
                    title: `🧾 Khách gửi thông tin xuất HĐ qua kengi.vn/hoadon — đơn ${o.orderNumber} CHƯA có phiếu bán`,
                    message: (`Đơn đã giao nhưng chưa lên phiếu (mã hàng sàn chưa nối hàng kho). Khách gửi: ${kq.info.name}`
                        + `${kq.info.taxCode ? ` — MST ${kq.info.taxCode}` : ''}${kq.info.address ? ` — ${kq.info.address}` : ''}`
                        + `${kq.info.nationalId ? ` — CCCD ${kq.info.nationalId}` : ''} — email ${kq.info.email}. `
                        + `Nối listing cho đơn, lên phiếu lại, rồi nhập thông tin này ở chi tiết đơn (Đơn hàng online).`).slice(0, 500),
                },
            }).catch(() => null)
            if (!tin) return res.status(500).json({ success: false, error: 'Hệ thống đang bận — vui lòng thử lại sau ít phút.' })
            const { sendPushToStore } = await import('./notifications')
            sendPushToStore(ch.prisma, tin.title, tin.message, { id: tin.id, type: 'einvoice' }).catch(() => { })
            return res.json({
                success: true,
                data: {
                    ketQua: 'cho_xu_ly',
                    thongDiep: `Cửa hàng đã nhận thông tin của bạn. Đơn đang được hoàn tất chứng từ — hoá đơn sẽ gửi về ${kq.info.email} trong 1–3 ngày làm việc.`,
                },
            })
        }

        // Gửi lại y hệt (bấm hai lần, tải lại trang) ⇒ không ghi lại, không báo nhân viên lần hai
        const cu = docThongTin(tx.vatBuyerInfo)
        const khoa = (x: any) => JSON.stringify([x?.loai, x?.name, x?.taxCode, x?.address, x?.email, x?.nationalId])
        const trung = !!cu && cu.nguon === 'khach-web' && khoa(cu) === khoa(kq.info)
        if (!trung) {
            await ch.prisma.transaction.update({ where: { id: tx.id }, data: { vatBuyerInfo: JSON.stringify(kq.info) } })
        }

        if (hd) {
            if (!trung) {
                const tin = await ch.prisma.notification.create({
                    data: {
                        type: 'einvoice',
                        title: `🧾 Khách gửi thông tin xuất HĐ qua kengi.vn/hoadon — đơn ${o.orderNumber} cần HĐ THAY THẾ`,
                        message: (`Đơn đã xuất HĐ ${hd.invoiceSymbol || ''} ${hd.invoiceNumber || ''}`.trim()
                            + `${hd.buyerTaxCode ? ` (MST ${hd.buyerTaxCode})` : ' (bán lẻ, không MST)'}. Khách gửi: ${kq.info.name}`
                            + `${kq.info.taxCode ? ` — MST ${kq.info.taxCode}` : ''} — email ${kq.info.email}. `
                            + `Mở chi tiết đơn (Đơn hàng online), bấm "Xuất HĐ thay thế với thông tin này" — đã điền sẵn.`).slice(0, 500),
                    },
                }).catch(() => null)
                if (tin) {
                    const { sendPushToStore } = await import('./notifications')
                    sendPushToStore(ch.prisma, tin.title, tin.message, { id: tin.id, type: 'einvoice' }).catch(() => { })
                }
            }
            return res.json({
                success: true,
                data: {
                    ketQua: 'can_thay_the',
                    thongDiep: `Đơn này đã xuất hoá đơn${hd.buyerTaxCode ? '' : ' bán lẻ'} trước đó. Cửa hàng đã nhận thông tin của bạn và sẽ lập hoá đơn THAY THẾ, gửi về ${kq.info.email} trong 1–2 ngày làm việc.`,
                },
            })
        }
        const daGiao = trangThaiDonKhach(o, true) === 'da_giao'
        res.json({
            success: true,
            data: {
                ketQua: 'cho_xuat',
                thongDiep: daGiao
                    ? `Đã ghi nhận. Hoá đơn sẽ được xuất trong vài ngày tới và gửi về ${kq.info.email}.`
                    : `Đã ghi nhận. Hoá đơn sẽ được xuất sau khi đơn giao thành công và gửi về ${kq.info.email}.`,
            },
        })
    } catch (err: any) {
        console.error('[yeu-cau-hoa-don/gui]', err?.message || err)
        res.status(500).json({ success: false, error: 'Hệ thống đang bận — vui lòng thử lại sau ít phút.' })
    }
})

// POST /tra-mst — { mst } ⇒ tên + địa chỉ đăng ký (điền sẵn form). Tra hỏng thì khách tự điền, không chặn gửi.
router.post('/tra-mst', gioiHanMst, async (req: Request, res: Response) => {
    const bayGio = Date.now()
    demMstChung = demMstChung.filter(t => bayGio - t < 10 * 60_000)
    if (demMstChung.length >= TRAN_MST_CHUNG) {
        return res.status(429).json({ success: false, error: 'Tra mã số thuế đang quá tải — vui lòng tự điền tên và địa chỉ.' })
    }
    demMstChung.push(bayGio)
    try {
        const k = await traMst(String(req.body?.mst || ''), { timeoutMs: 8000 })
        res.json({ success: true, data: { ten: k.ten, diaChi: k.diaChi, tinhTrang: k.tinhTrang } })
    } catch (err: any) {
        if (err instanceof LoiTraMst) {
            const ma = err.ma === 'khong_hop_le' ? 400 : err.ma === 'khong_co' ? 404 : err.ma === 'qua_tai' ? 429 : 502
            return res.status(ma).json({ success: false, error: err.message })
        }
        res.status(502).json({ success: false, error: 'Chưa tra được mã số thuế — vui lòng tự điền tên và địa chỉ.' })
    }
})

// POST /tai-hoa-don — { maDon } ⇒ bản HOÁ ĐƠN THẬT (PDF có QR + chữ ký) từ cổng VNPT — chứng từ mua hàng để bảo hành
router.post('/tai-hoa-don', gioiHanTai, async (req: Request, res: Response) => {
    try {
        const ung = ungVienMaDon(req.body?.maDon)
        if (!ung) return res.status(400).json({ success: false, error: SAI_DANG })
        const f = await timDon(ung)
        if (!f) return res.status(404).json({ success: false, error: KHONG_THAY })
        const hd = f.hd
        if (!hd?.transactionId) return res.status(404).json({ success: false, error: 'Đơn này chưa xuất hoá đơn điện tử.' })
        const cfg = await f.ch.prisma.eInvoiceConfig.findFirst({ where: { isActive: true } }).catch(() => null)
        if (String(cfg?.provider || '').toLowerCase() !== 'vnpt') {
            return res.status(409).json({ success: false, error: 'Cửa hàng chưa hỗ trợ tải hoá đơn trực tuyến — vui lòng nhắn cửa hàng.' })
        }
        const { VnptProvider, vnptFkey } = await import('../services/einvoice/vnpt')
        // Cùng luật với GET /einvoice/:id/vnpt-file: HĐ thay thế phát hành với Fkey "<id gốc>R"
        const fkey = hd.invoiceType === 'REPLACEMENT' && hd.replacesInvoiceId ? vnptFkey(`${hd.replacesInvoiceId}R`) : vnptFkey(hd.transactionId)
        const file = await new VnptProvider().downloadInvoice(cfg, fkey)
        const ten = `HoaDon-${hd.invoiceSymbol || ''}${hd.invoiceNumber || ''}`.replace(/[^A-Za-z0-9_-]/g, '') || 'HoaDon'
        if (file.kind === 'pdf' && file.base64) {
            res.set('Content-Type', 'application/pdf')
            res.set('Content-Disposition', `inline; filename="${ten}.pdf"`)
            res.set('Cache-Control', 'no-store')
            return res.send(Buffer.from(file.base64, 'base64'))
        }
        if (file.kind === 'zip' && file.base64) {
            res.set('Content-Type', 'application/zip')
            res.set('Content-Disposition', `attachment; filename="${ten}.zip"`)
            res.set('Cache-Control', 'no-store')
            return res.send(Buffer.from(file.base64, 'base64'))
        }
        if (file.kind === 'url' && file.raw) return res.json({ success: true, data: { url: file.raw } })
        console.error('[yeu-cau-hoa-don/tai-hoa-don] VNPT trả dạng lạ:', file.kind)
        res.status(502).json({ success: false, error: 'Chưa lấy được hoá đơn từ nhà cung cấp — vui lòng thử lại sau ít phút.' })
    } catch (err: any) {
        console.error('[yeu-cau-hoa-don/tai-hoa-don]', err?.message || err)
        res.status(502).json({ success: false, error: 'Chưa lấy được hoá đơn từ nhà cung cấp — vui lòng thử lại sau ít phút.' })
    }
})

export default router
