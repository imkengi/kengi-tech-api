/**
 * NHÓM ZALO ↔ KHÁCH HÀNG — 13/10/2026
 *
 * HUTI bán sỉ cho đại lý; mỗi đại lý một nhóm Zalo (Zalo CÁ NHÂN của công ty) chung
 * với tài khoản Hưng Tín. n8n đọc tin các nhóm đó; trước đây ghi vào Google Sheet và
 * bị Sheets chặn vì quá 60 lần ghi/phút. Nay n8n gọi thẳng /api/zalo (routes/zalo.ts).
 *
 * File nguồn kh.xlsx (chủ shop gửi 13/10): CODE | TÊN NHÓM | GROUP ID — CODE là mã khách
 * bên KiotViet cũ, nay là Customer.code của HUTI. Đo file: 150 dòng, 142 mã, 8 mã có
 * HAI nhóm, groupId đều là CHUỖI 18–19 chữ số (vượt Number.MAX_SAFE_INTEGER — đọc thành
 * số là mất chữ số cuối, nên mọi chỗ đều giữ dạng chuỗi), có mã viết thường ("hn17").
 *
 * Luật nhập (skill data-sync-gate):
 *   - Mặc định CHẠY THỬ; `apply` mới ghi.
 *   - Mã không có trên Kengi: vẫn lưu nhóm với customerId = null và BÁO LẠI — không tự
 *     tạo khách (khách thật phải do người tạo, kèm thông tin xuất hoá đơn).
 *   - Nhóm đã nối khách KHÁC: không đổi, trừ khi bật `ghiDe` — nối nhầm nhóm là gửi
 *     hoá đơn của khách này vào nhóm khách kia.
 */

import { TRANG_THAI_TINH } from './tinhLaiTongMuaKhach'

export interface DongNhomZalo {
    maKhach: string
    tenNhom?: string | null
    groupId: string
}

export interface KetQuaNhapNhom {
    apply: boolean
    tongDong: number
    soNhom: number
    khopKhach: number
    taoMoi: number
    capNhat: number
    giuNguyen: number
    chuaCoKhach: Array<{ maKhach: string; tenNhom: string | null; groupId: string }>
    xungDot: Array<{ groupId: string; tenNhom: string | null; lyDo: string }>
    loi: Array<{ dong: number; lyDo: string }>
}

const chuanMa = (s: any) => String(s ?? '').trim()
/** groupId Zalo: chỉ chữ số. Nhận cả số Excel đã lỡ thành dạng 1.23E+18 thì TỪ CHỐI, không đoán. */
const laGroupId = (s: string) => /^\d{6,25}$/.test(s)

/** Tìm khách theo mã, không phân biệt hoa thường. Trả Map MÃ-IN-HOA → danh sách khách. */
export async function timKhachTheoMa(sp: any, ma: string[]): Promise<Map<string, Array<{ id: string; code: string; name: string }>>> {
    const kq = new Map<string, Array<{ id: string; code: string; name: string }>>()
    const hoa = [...new Set(ma.map(m => m.toUpperCase()).filter(Boolean))]
    for (let i = 0; i < hoa.length; i += 500) {
        const rows: any[] = await sp.$queryRawUnsafe(
            `SELECT "id", "code", "name" FROM "Customer" WHERE UPPER("code") = ANY($1::text[])`,
            hoa.slice(i, i + 500),
        )
        for (const r of rows) {
            const k = String(r.code).toUpperCase()
            kq.set(k, [...(kq.get(k) || []), { id: r.id, code: r.code, name: r.name }])
        }
    }
    return kq
}

export async function nhapNhomZalo(
    sp: any, dong: DongNhomZalo[], opts: { apply: boolean; ghiDe?: boolean },
): Promise<KetQuaNhapNhom> {
    const kq: KetQuaNhapNhom = {
        apply: opts.apply, tongDong: dong.length, soNhom: 0, khopKhach: 0,
        taoMoi: 0, capNhat: 0, giuNguyen: 0, chuaCoKhach: [], xungDot: [], loi: [],
    }

    // 1. Làm sạch + gộp theo groupId (một nhóm chỉ thuộc MỘT khách)
    const theoNhom = new Map<string, { maKhach: string; tenNhom: string | null }>()
    dong.forEach((d, i) => {
        const ma = chuanMa(d.maKhach)
        const gid = chuanMa(d.groupId)
        const ten = chuanMa(d.tenNhom) || null
        if (!ma && !gid) return
        if (!gid || !laGroupId(gid)) { kq.loi.push({ dong: i + 2, lyDo: `GROUP ID "${gid}" không phải dãy số (Excel làm tròn thành 1.2E+18?)` }); return }
        if (!ma) { kq.loi.push({ dong: i + 2, lyDo: `nhóm ${gid} thiếu mã khách` }); return }
        const cu = theoNhom.get(gid)
        if (cu && cu.maKhach.toUpperCase() !== ma.toUpperCase()) {
            kq.xungDot.push({ groupId: gid, tenNhom: ten, lyDo: `cùng nhóm mà file ghi hai mã: ${cu.maKhach} và ${ma}` })
            return
        }
        theoNhom.set(gid, { maKhach: ma, tenNhom: ten || cu?.tenNhom || null })
    })
    kq.soNhom = theoNhom.size

    // 2. Khớp mã khách
    const khach = await timKhachTheoMa(sp, [...theoNhom.values()].map(x => x.maKhach))

    // 3. So với bảng đang có
    const ids = [...theoNhom.keys()]
    const coSan = new Map<string, any>()
    for (let i = 0; i < ids.length; i += 500) {
        const rows = await sp.zaloNhom.findMany({ where: { groupId: { in: ids.slice(i, i + 500) } } })
        for (const r of rows) coSan.set(r.groupId, r)
    }

    for (const [gid, x] of theoNhom) {
        const ds = khach.get(x.maKhach.toUpperCase()) || []
        if (ds.length > 1) {
            kq.xungDot.push({ groupId: gid, tenNhom: x.tenNhom, lyDo: `mã ${x.maKhach} khớp ${ds.length} khách (${ds.map(k => k.code).join(', ')}) — sửa mã trùng trước` })
            continue
        }
        const k = ds[0] || null
        if (k) kq.khopKhach++
        else kq.chuaCoKhach.push({ maKhach: x.maKhach, tenNhom: x.tenNhom, groupId: gid })

        const data = { maKhach: k?.code || x.maKhach, tenNhom: x.tenNhom, customerId: k?.id || null }
        const cu = coSan.get(gid)
        if (!cu) {
            if (opts.apply) await sp.zaloNhom.create({ data: { groupId: gid, ...data } })
            kq.taoMoi++
            continue
        }
        const doiKhach = (cu.customerId || null) !== data.customerId
        if (doiKhach && cu.customerId && !opts.ghiDe) {
            kq.xungDot.push({ groupId: gid, tenNhom: x.tenNhom, lyDo: `nhóm đang nối khách ${cu.maKhach}, file ghi ${x.maKhach} — bật "ghi đè" nếu đúng là đổi khách` })
            continue
        }
        if (!doiKhach && cu.tenNhom === data.tenNhom && cu.maKhach === data.maKhach) { kq.giuNguyen++; continue }
        if (opts.apply) await sp.zaloNhom.update({ where: { id: cu.id }, data })
        kq.capNhat++
    }
    return kq
}

/** Đọc file Excel 3 cột CODE | TÊN NHÓM | GROUP ID — dò cột THEO TÊN, không theo vị trí. */
export function docFileNhomZalo(rows: any[][]): { dong: DongNhomZalo[]; loi: string | null } {
    if (!rows.length) return { dong: [], loi: 'File trống' }
    const dau = rows[0].map(c => String(c ?? '').trim().toUpperCase())
    const cot = (...ten: string[]) => dau.findIndex(c => ten.some(t => c === t || c.replace(/\s+/g, '') === t.replace(/\s+/g, '')))
    const cMa = cot('CODE', 'MÃ', 'MÃ KHÁCH', 'MÃ KH')
    const cTen = cot('TÊN NHÓM', 'TEN NHOM', 'NHÓM')
    const cGid = cot('GROUP ID', 'GROUPID', 'ID NHÓM')
    if (cMa < 0 || cGid < 0) return { dong: [], loi: `Không thấy cột CODE và GROUP ID ở dòng đầu (đọc được: ${dau.join(' | ')})` }
    return {
        dong: rows.slice(1).map(r => ({
            maKhach: String(r[cMa] ?? ''),
            tenNhom: cTen >= 0 ? String(r[cTen] ?? '') : null,
            // Ô SỐ quá 2^53 thì String(n) vẫn ra toàn chữ số nhưng ĐÃ SAI chữ số cuối
            // (286557705360395658 → "286557705360395650") — regex không bắt được, phải chặn ở đây
            groupId: typeof r[cGid] === 'number'
                ? (Number.isSafeInteger(r[cGid]) ? String(r[cGid]) : `ô số đã mất chữ số (${r[cGid]}) — định dạng cột GROUP ID là Text rồi dán lại`)
                : String(r[cGid] ?? ''),
        })),
        loi: null,
    }
}

// ─── YÊU CẦU HOÁ ĐƠN QUA "/hoadon" (18/10/2026) ─────────────────────────────
//
// Chủ shop: khách nhắn "/hoadon" trong nhóm = lấy hoá đơn cho các phiếu bán của khách
// trong NGÀY (giờ VN) đó. Lưu tin (ZaloTin.yeuCauHoaDon = true) + bật cột RIÊNG
// Transaction.layHoaDon trên các phiếu đó; người quét đơn thấy cột là xuất HĐ (bên MISA).
// Chủ shop: "chỉ cần thêm 1 cột bên giao dịch là có lấy hoá đơn".
//
// ⛔ KHÔNG ghi Transaction.vatBuyerInfo: đó là dấu "khách yêu cầu HĐ" của luồng HĐĐT
// trong Kengi (màn HĐĐT coi là phải xuất; hàng đợi 20:30 tự xuất với đơn sàn) ⇒ ghi vào
// là mời xuất TRÙNG với hoá đơn MISA. Bản đầu 18/10 có ghi — gỡ trước khi deploy.
//
// Phiếu tạo SAU tin trong cùng ngày (HUTI về qua webhook KiotViet): nhịp /api/cron/tick
// gọi `apYeuCauHoaDonGanDay` mỗi 5 phút, xét cả HÔM QUA để phiếu 23:5x không lọt.
// CHỈ BẬT, không bao giờ tự tắt — tắt là việc người bấm tay.

/** "/hoadon", "/hoá đơn", "/HOADON cho em" — lệnh phải đứng ĐẦU tin; "/hoadon2" không tính */
export function laLenhHoaDon(noiDung: string): boolean {
    const s = String(noiDung || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/gi, 'd').toLowerCase()
    return /^\/\s*hoa\s*don(?![a-z0-9])/.test(s)
}

/** Ngày giờ VN 'YYYY-MM-DD' của một thời điểm */
export const ngayVN = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
export const khoangNgayVN = (ymd: string) => ({
    tu: new Date(`${ymd}T00:00:00+07:00`), den: new Date(`${ymd}T23:59:59.999+07:00`),
})

/** Thông tin người mua từ HỒ SƠ KHÁCH — chỉ để TRẢ RA (lập HĐ bên MISA), không ghi đâu cả */
export function thongTinHoaDonTuKhach(k: any) {
    const congTy = k.invoiceType === 'company' || (!k.invoiceType && /^\d{10}(-\d{3})?$/.test(String(k.taxCode || '').trim()))
    return {
        type: k.invoiceType || (congTy ? 'company' : 'personal'),
        name: congTy ? (k.invoiceCompanyName || k.name || '') : (k.invoiceBuyerName || k.name || ''),
        taxCode: String(k.taxCode || '').trim(),
        address: k.invoiceAddress || k.address || '',
        email: k.invoiceEmail || k.email || '',
        phone: k.invoicePhone || k.phone || '',
        nationalId: k.invoiceIdNo || '',
    }
}

const CHON_KHACH_HD = {
    id: true, code: true, name: true, phone: true, address: true, email: true, taxCode: true,
    invoiceType: true, invoiceCompanyName: true, invoiceBuyerName: true, invoiceAddress: true,
    invoiceEmail: true, invoicePhone: true, invoiceIdNo: true,
} as const

/** Phiếu đã bán (gồm ghi nợ) của khách trong ngày VN, kèm dòng hàng */
async function phieuTrongNgay(sp: any, customerId: string, ymd: string) {
    const { tu, den } = khoangNgayVN(ymd)
    return sp.transaction.findMany({
        where: {
            customerId, status: { in: [...TRANG_THAI_TINH] },
            OR: [{ transactionDate: { gte: tu, lte: den } }, { transactionDate: null, createdAt: { gte: tu, lte: den } }],
        },
        select: {
            id: true, receiptNumber: true, transactionDate: true, createdAt: true, status: true, channel: true,
            subtotal: true, discount: true, discountType: true, tax: true, total: true,
            items: { select: { sku: true, productName: true, quantity: true, unitPrice: true, discount: true, lineTotal: true, product: { select: { baseUnit: true, invoiceUnit: true } } } },
        },
        orderBy: { createdAt: 'asc' },
    })
}

/**
 * Danh sách yêu cầu HĐ của một ngày — CHỈ ĐỌC. Mỗi khách: thông tin người mua + các tin
 * "/hoadon" + phiếu trong ngày kèm dòng hàng (đủ để lập HĐ bên MISA). Phiếu tạo SAU tin
 * trong cùng ngày vẫn hiện vì tính sống lúc đọc.
 */
export async function dsYeuCauHoaDon(sp: any, ymd: string) {
    const { tu, den } = khoangNgayVN(ymd)
    const tin = await sp.zaloTin.findMany({
        where: { yeuCauHoaDon: true, thoiDiem: { gte: tu, lte: den } },
        orderBy: { thoiDiem: 'asc' },
    })
    const theoKhach = new Map<string, any[]>()
    const chuaNoi: any[] = []
    for (const t of tin) {
        if (!t.customerId) { chuaNoi.push({ groupId: t.groupId, thoiDiem: t.thoiDiem, nguoiGui: t.nguoiGui, noiDung: t.noiDung }); continue }
        theoKhach.set(t.customerId, [...(theoKhach.get(t.customerId) || []), t])
    }
    const khachHang: any[] = []
    for (const [customerId, ds] of theoKhach) {
        const k = await sp.customer.findUnique({ where: { id: customerId }, select: CHON_KHACH_HD })
        const phieu = await phieuTrongNgay(sp, customerId, ymd)
        // Phiếu đã có HĐĐT xuất từ Kengi thì nói ra để khỏi xuất lại bên MISA
        let daXuat = new Map<string, string>()
        if (phieu.length) {
            const hd: any[] = await sp.$queryRawUnsafe(
                `SELECT "transactionId", "invoiceNumber" FROM "EInvoice" WHERE "transactionId" = ANY($1::text[]) AND status IN ('issued','SENT')`,
                phieu.map((p: any) => p.id),
            ).catch(() => [])   // cửa hàng chưa dùng HĐĐT thì chưa có bảng — không có HĐ nào là đúng
            daXuat = new Map(hd.map(h => [h.transactionId, h.invoiceNumber]))
        }
        khachHang.push({
            khach: k ? { id: k.id, code: k.code, name: k.name } : { id: customerId },
            thongTinHoaDon: k ? thongTinHoaDonTuKhach(k) : null,
            thieuMst: k ? !String(k.taxCode || '').trim() : true,
            yeuCau: ds.map((t: any) => ({ tinId: t.id, groupId: t.groupId, thoiDiem: t.thoiDiem, nguoiGui: t.nguoiGui, noiDung: t.noiDung })),
            phieu: phieu.map((p: any) => ({
                id: p.id, soPhieu: p.receiptNumber, ngay: p.transactionDate || p.createdAt, trangThai: p.status, kenh: p.channel,
                tienHang: p.subtotal, giamGia: p.discount, loaiGiamGia: p.discountType, thue: p.tax, tongTien: p.total,
                daXuatHoaDonKengi: daXuat.get(p.id) || null,
                dong: (p.items || []).map((i: any) => ({
                    maHang: i.sku, tenHang: i.productName, soLuong: i.quantity,
                    donVi: i.product?.invoiceUnit || i.product?.baseUnit || null,
                    donGia: i.unitPrice, giamGia: i.discount, thanhTien: i.lineTotal,
                })),
            })),
        })
    }
    return {
        ngay: ymd, soYeuCau: tin.length, soKhach: khachHang.length,
        soPhieu: khachHang.reduce((s, x) => s + x.phieu.length, 0),
        khachHang, chuaNoi,
    }
}

/** Bật "Lấy HĐ" cho mọi phiếu đã bán của khách trong ngày VN. Idempotent; trả số phiếu VỪA bật. */
export async function danhDauLayHoaDon(sp: any, customerId: string, ymd: string): Promise<{ ngay: string; daBat: number; tongPhieu: number }> {
    const { tu, den } = khoangNgayVN(ymd)
    const where = {
        customerId, status: { in: [...TRANG_THAI_TINH] },
        OR: [{ transactionDate: { gte: tu, lte: den } }, { transactionDate: null, createdAt: { gte: tu, lte: den } }],
    }
    const r = await sp.transaction.updateMany({ where: { ...where, layHoaDon: false }, data: { layHoaDon: true } })
    const tongPhieu = await sp.transaction.count({ where })
    return { ngay: ymd, daBat: r.count, tongPhieu }
}

/**
 * Quét lại yêu cầu /hoadon của HÔM NAY và HÔM QUA (giờ VN) — bắt phiếu tạo sau tin nhắn.
 * Một khách một ngày chỉ làm một lần. Bảng ZaloTin chưa có (cửa hàng chưa migrate) ⇒ bỏ qua.
 */
export async function apYeuCauHoaDonGanDay(sp: any): Promise<{ soKhachNgay: number; daBat: number }> {
    const homNay = ngayVN(new Date())
    const homQua = ngayVN(new Date(Date.now() - 86400_000))
    const tu = khoangNgayVN(homQua).tu
    const tin: any[] = await sp.zaloTin.findMany({
        where: { yeuCauHoaDon: true, customerId: { not: null }, thoiDiem: { gte: tu } },
        select: { customerId: true, thoiDiem: true },
    }).catch((e: any) => { if (/ZaloTin|does not exist/i.test(String(e?.message))) return []; throw e })
    const cap = new Set<string>()
    for (const t of tin) {
        const ngay = ngayVN(new Date(t.thoiDiem))
        if (ngay === homNay || ngay === homQua) cap.add(`${t.customerId}|${ngay}`)
    }
    let daBat = 0
    for (const k of cap) {
        const [customerId, ngay] = k.split('|')
        daBat += (await danhDauLayHoaDon(sp, customerId, ngay)).daBat
    }
    daBat += await batLayHoaDonKhachLuonLay(sp, tu)
    return { soKhachNgay: cap.size, daBat }
}

/**
 * Khách "luôn lấy hoá đơn" (Customer.luonLayHoaDon — chủ shop 19/10/2026: "2 dạng khách: 1 khách luôn luôn lấy hoá đơn,
 * còn 1 dạng thì tuỳ hứng"): phiếu bán từ mốc `tu` (HÔM QUA trở đi) tự bật Lấy HĐ — như khách nhắn /hoadon mỗi ngày.
 * Phiếu CŨ hơn KHÔNG tự bật (bật lại phiếu cũ là mời người quét đơn xuất HĐ trùng); đẩy MISA tự coi phiếu của khách này là
 * phiếu lấy HĐ (services/misaPush). CHỈ BẬT, không tự tắt — như /hoadon.
 */
export async function batLayHoaDonKhachLuonLay(sp: any, tu: Date): Promise<number> {
    // Lọc theo danh sách id (scalar `in`) thay vì lọc qua quan hệ `customer: { is }` — repo chưa chỗ nào chạy kiểu đó trên prod
    const ids = await idKhachLuonLayHoaDon(sp)
    if (!ids.length) return 0
    const r = await sp.transaction.updateMany({
        where: {
            layHoaDon: false, status: { in: [...TRANG_THAI_TINH] }, customerId: { in: ids },
            OR: [{ transactionDate: { gte: tu } }, { transactionDate: null, createdAt: { gte: tu } }],
        },
        data: { layHoaDon: true },
    })
    return Number(r?.count) || 0
}

/** id các khách "luôn lấy hoá đơn" (Customer.luonLayHoaDon) — dùng chung cho nhịp này và đẩy MISA (services/misaPush) */
export async function idKhachLuonLayHoaDon(sp: any): Promise<string[]> {
    const ds: { id: string }[] = await sp.customer.findMany({ where: { luonLayHoaDon: true }, select: { id: true } })
    return ds.map(k => k.id)
}

/** Nhịp ngoài: mọi cửa hàng đang hoạt động — gọi từ routes/cronTick.ts */
export async function nhipLayHoaDon(): Promise<string> {
    const { registryPrisma, getStorePrisma } = await import('./prisma')
    const stores: any[] = await (registryPrisma as any).store.findMany({ where: { status: 'active' }, select: { schema: true, code: true } })
    const ra: string[] = []
    for (const s of stores) {   // TUẦN TỰ — pool prod nhỏ, đừng Promise.all
        try {
            const kq = await apYeuCauHoaDonGanDay(getStorePrisma(s.schema) as any)
            if (kq.daBat) ra.push(`${s.code}:+${kq.daBat}`)
        } catch (e: any) { ra.push(`${s.code}:loi ${String(e?.message || e).slice(0, 80)}`) }
    }
    return ra.join(' ') || 'khong-co-gi'
}
