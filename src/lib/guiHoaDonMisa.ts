/**
 * GỬI HOÁ ĐƠN MISA meInvoice CHO KHÁCH QUA NHÓM ZALO (29/10/2026, chủ shop: "làm phần gửi luôn đi")
 *
 * Ai được gửi: đúng luật soi (lib/hoaDonMisaZalo.ts — khách gõ /hoadon hoặc "Luôn lấy hoá đơn", đã nối nhóm Zalo).
 * Nguồn hoá đơn: danh sách ĐÃ PHÁT HÀNH /invoice/paging (lib/meInvoice.ts dsHoaDonPhatHanh — đo HUTI 29/10/2026).
 *
 * TỰ ĐỘNG: một hoá đơn đi qua 4 cửa, hỏng cửa nào dừng ở đó, KHÔNG gửi:
 *   1. Trạng thái MISA ngay lúc gửi (/invoice/status — hình đo 29/10/2026, bảng mã theo tài liệu): không bị xoá / huỷ (EInvoiceStatus 2) /
 *      BỊ thay thế (RefInvoiceStatus 3), thuế chấp nhận (SendTaxStatus 2). Hoá đơn THAY THẾ (3) / ĐIỀU CHỈNH (5) là hoá đơn hợp lệ ⇒ gửi.
 *      Chưa cấp mã ⇒ lượt sau thử lại; xoá / huỷ / bị thay thế / thuế từ chối ⇒ bỏ hẳn.
 *   2. Tải được PDF thật (/invoice/Download, phải mở đầu "%PDF") — link gửi khách không được là link chết.
 *   3. GIÀNH hoá đơn trong bảng MeInvoiceDaGui (khoá chính = mã tra cứu; INSERT … ON CONFLICT … WHERE trangThai = 'loi') — nhiều
 *      bản máy chạy cùng lúc thì chỉ một bên được xếp; đã xếp rồi thì KHÔNG BAO GIỜ xếp lại.
 *   4. Xếp vào hàng đợi Zalo có sẵn (ZaloDotGui / ZaloDotGuiNhom — MỘT đợt cho mỗi hoá đơn, mỗi nhóm của khách một dòng). nhipGuiZalo
 *      gửi giãn nhịp, phiên Zalo hết hạn thì tạm dừng chờ quét lại QR (lib/zaloGui.ts).
 *
 * Link trong tin: {PUBLIC_API_URL}/api/meinvoice/hd/<mã cửa hàng>/<token> — mở ra là tải PDF có chữ ký số từ MISA ngay lúc đó (link
 * xem của MISA có hạn; link này bền). Token ngẫu nhiên 144 bit, lưu ở MeInvoiceDaGui.
 *
 * Tự động (nhipGuiHoaDonMisa — cron mỗi 10 phút, 7–21 giờ VN): chỉ cửa hàng BẬT, chỉ hoá đơn có ngày ≥ ngày bật (không dội hoá đơn
 * cũ vào nhóm khách), xét hôm nay + LUI_NGAY ngày trước (hoá đơn lập muộn / ghi lùi ngày).
 * GỬI TAY = BẮT BUỘC GỬI (chủ shop 29/10/2026: "khi gửi tay thì bắt buộc gửi"): không qua cửa 1–2 (chỉ báo lưu ý), gửi được cả hoá đơn
 * đã gửi / đã bỏ / khách không yêu cầu; chỉ dừng khi không thể gửi (chưa đăng nhập Zalo, không ra khách, khách chưa nối nhóm).
 */

import crypto from 'crypto'
import { registryPrisma, getStorePrisma } from './prisma'
import { tenSchema } from './zaloKengi'
import { chonKenhGui, CAU_CHUA_CO_KENH } from './zaloGui'
import {
    LoiMeInvoice, docKetNoi, goiApi, docTruong, moChuoiJson, docHoaDon, dsHoaDonPhatHanh, type KetNoiMeInvoice, type HoaDonMisa,
} from './meInvoice'
import { xemTruocGui, type DongXemTruoc } from './hoaDonMisaZalo'

const BANG_GUI = '"MeInvoiceDaGui"'
const BANG_CAI_DAT = '"MeInvoiceGuiCaiDat"'
const ID = 'mac-dinh'

const GIO_BAT_DAU = 7
const GIO_KET_THUC = 21
/** Tự động xét hôm nay + bấy nhiêu ngày trước */
const LUI_NGAY = 3
const TOI_DA_MOI_NHIP = 15
/** Tự động thử lại hoá đơn lỗi (chưa cấp mã, MISA chưa trả PDF…) tối đa bấy nhiêu lượt; gửi tay thì không giới hạn */
export const LAN_TU_DONG_TOI_DA = 5
/** Dòng kẹt 'dang_xep' (máy dừng giữa lúc xếp) quá bấy lâu thì soát lại */
const KET_MS = 10 * 60_000

export const ngayVN = (d: Date = new Date()) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
const congNgay = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
export const trongGioGui = (d: Date = new Date()) => { const h = (d.getUTCHours() + 7) % 24; return h >= GIO_BAT_DAU && h < GIO_KET_THUC }

// ─── Bảng (tạo lười — cùng nếp lib/meInvoice.ts) ───────────────────────────────

const daTaoBang = new Set<string>()
/** Lý do "bỏ" của luật CŨ (sáng 29/10/2026: mọi EInvoiceStatus ≠ 1) — chặn oan hoá đơn thay thế / điều chỉnh ⇒ xét lại */
const BO_OAN = 'Trạng thái hoá đơn trên MISA = %'

async function damBaoBangGui(sp: any): Promise<void> {
    const schema = await tenSchema(sp)
    if (daTaoBang.has(schema)) return
    for (const sql of [
        `CREATE TABLE IF NOT EXISTS ${BANG_GUI} (
            "maTraCuu" TEXT PRIMARY KEY,
            "token" TEXT NOT NULL UNIQUE,
            "refId" TEXT, "kyHieu" TEXT, "so" TEXT, "ngay" TEXT, "tongTien" DOUBLE PRECISION,
            "customerId" TEXT, "maKhach" TEXT, "mtt" BOOLEAN NOT NULL DEFAULT false,
            "trangThai" TEXT NOT NULL,
            "loi" TEXT, "lanThu" INTEGER NOT NULL DEFAULT 0,
            "dotId" TEXT, "soNhom" INTEGER NOT NULL DEFAULT 0,
            "nguon" TEXT, "nguoi" TEXT,
            "taoLuc" BIGINT NOT NULL, "capNhatLuc" BIGINT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS ${BANG_CAI_DAT} (
            "id" TEXT PRIMARY KEY,
            "tuDong" BOOLEAN NOT NULL DEFAULT false,
            "guiTuNgay" TEXT,
            "mauTin" TEXT,
            "nguoiSua" TEXT,
            "capNhatLuc" BIGINT NOT NULL
        )`,
    ]) {
        try { await sp.$executeRawUnsafe(sql) } catch (e: any) {
            if (!/already exists|duplicate key value/i.test(String(e?.message || ''))) throw e
        }
    }
    // Bị chặn oan ⇒ trả về 'loi' cho tự động xét lại theo bảng mã đúng (dòng 'bo_qua' chưa từng có tin nào đi)
    await sp.$executeRawUnsafe(`UPDATE ${BANG_GUI} SET "trangThai"='loi', "lanThu"=0, "loi"=$1 WHERE "trangThai"='bo_qua' AND "loi" LIKE $2`,
        'Xét lại theo bảng mã MISA (trước bị chặn oan)', BO_OAN)
    daTaoBang.add(schema)
}

// ─── Cài đặt: tự động gửi + mẫu tin ──────────────────────────────────────────

export const MAU_MAC_DINH = [
    'Kính gửi {tenKhach},',
    '{loaiHoaDon} số {soHoaDon} (ký hiệu {kyHieu}) ngày {ngayHoaDon} — tổng tiền {tongTien}.',
    'Mã tra cứu: {maTraCuu}',
    'Tải hoá đơn PDF có chữ ký số: {linkHoaDon}',
].join('\n')

export const BIEN_HOA_DON: [string, string][] = [
    ['tenKhach', 'tên khách trong Kengi'],
    ['maKhach', 'mã khách'],
    ['loaiHoaDon', 'tên loại hoá đơn, vd "Hóa đơn giá trị gia tăng"'],
    ['soHoaDon', 'số hoá đơn'],
    ['kyHieu', 'ký hiệu hoá đơn'],
    ['ngayHoaDon', 'ngày hoá đơn dd/mm/yyyy'],
    ['tongTien', 'tổng tiền, vd 15.593.000đ'],
    ['maTraCuu', 'mã tra cứu trên MISA'],
    ['linkHoaDon', 'link tải PDF có chữ ký số'],
    ['nguoiMua', 'tên người mua ghi trên hoá đơn'],
]

export interface CaiDatGui { tuDong: boolean; guiTuNgay: string | null; mauTin: string | null; nguoiSua: string | null; capNhatLuc: number | null }

export async function docCaiDat(sp: any): Promise<CaiDatGui> {
    await damBaoBangGui(sp)
    const d: any = ((await sp.$queryRawUnsafe(`SELECT * FROM ${BANG_CAI_DAT} WHERE "id" = $1`, ID)) as any[])[0]
    return {
        tuDong: d?.tuDong === true,
        guiTuNgay: d?.guiTuNgay || null,
        mauTin: d?.mauTin || null,
        nguoiSua: d?.nguoiSua || null,
        capNhatLuc: d?.capNhatLuc === null || d?.capNhatLuc === undefined ? null : Number(d.capNhatLuc),
    }
}

/** Bật tự động (từ tắt sang bật) ⇒ chỉ gửi hoá đơn từ HÔM NAY trở đi. Mẫu rỗng = mẫu mặc định. */
export async function luuCaiDat(sp: any, b: { tuDong?: boolean; mauTin?: string | null }, nguoi: string, bayGio = new Date()): Promise<CaiDatGui> {
    const cu = await docCaiDat(sp)
    const tuDong = typeof b.tuDong === 'boolean' ? b.tuDong : cu.tuDong
    const mauTin = b.mauTin === undefined ? cu.mauTin : (String(b.mauTin ?? '').trim() || null)
    if (mauTin && mauTin.length > 2000) throw new LoiMeInvoice('Mẫu tin tối đa 2.000 ký tự.')
    if (mauTin && !/\{\s*(linkHoaDon|maTraCuu)\s*\}/i.test(mauTin)) {
        throw new LoiMeInvoice('Mẫu tin phải có {linkHoaDon} hoặc {maTraCuu} — không thì khách không lấy được hoá đơn.')
    }
    const guiTuNgay = tuDong && !cu.tuDong ? ngayVN(bayGio) : cu.guiTuNgay
    await sp.$executeRawUnsafe(
        `INSERT INTO ${BANG_CAI_DAT} ("id","tuDong","guiTuNgay","mauTin","nguoiSua","capNhatLuc") VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT ("id") DO UPDATE SET "tuDong"=$2,"guiTuNgay"=$3,"mauTin"=$4,"nguoiSua"=$5,"capNhatLuc"=$6`,
        ID, tuDong, guiTuNgay, mauTin, nguoi || null, bayGio.getTime())
    return docCaiDat(sp)
}

// ─── Trạng thái + PDF trên MISA ────────────────────────────────────────────────

export interface KetLuanTrangThai { guiDuoc: boolean; vinhVien: boolean; lyDo: string | null; ghiChu?: string | null }

/**
 * Kết luận TỰ ĐỘNG từ MỘT bản ghi /invoice/status (hình đo 29/10/2026) — hàm thuần. Bảng mã theo tài liệu MISA (đọc lại 29/10/2026 sau khi
 * chủ shop gặp HĐ "= 3" bị chặn oan): EInvoiceStatus 1 gốc · 2 BỊ HUỶ · 3 hoá đơn THAY THẾ · 5 (4) hoá đơn ĐIỀU CHỈNH — 3/5 là hoá đơn hợp lệ
 * phải gửi; hoá đơn BỊ thay thế nhận ra bằng RefInvoiceStatus 3 (bị điều chỉnh = 5, vẫn còn hiệu lực ⇒ vẫn gửi).
 * SendTaxStatus 0 chưa gửi CQT · 1 đã gửi · 2 hợp lệ (thuế chấp nhận / đã cấp mã) · 3 không hợp lệ (thuế từ chối) · 4 TĐ không hợp lệ.
 * Gửi TAY không qua cửa này (chủ shop 29/10/2026: "khi gửi tay thì bắt buộc gửi") — chỉ lấy lyDo làm lưu ý.
 */
export function ketLuanTrangThai(st: any, coMa: boolean): KetLuanTrangThai {
    if (!st || typeof st !== 'object') return { guiDuoc: false, vinhVien: false, lyDo: 'MISA không trả trạng thái hoá đơn — thử lại lượt sau' }
    const xoa = docTruong(st, 'IsDelete')
    if (xoa === true || xoa === 'true') {
        const lyDo = docTruong(st, 'DeletedReason')
        return { guiDuoc: false, vinhVien: true, lyDo: `Hoá đơn đã bị xoá trên MISA${lyDo ? ` (${String(lyDo).slice(0, 120)})` : ''}` }
    }
    const ei = Number(docTruong(st, 'EInvoiceStatus'))
    const lienQuan = Number(docTruong(st, 'RefInvoiceStatus'))
    if (ei === 2) return { guiDuoc: false, vinhVien: true, lyDo: 'Hoá đơn đã bị huỷ trên MISA' }
    if (lienQuan === 3) return { guiDuoc: false, vinhVien: true, lyDo: 'Hoá đơn đã bị thay thế bởi hoá đơn khác — khách nhận hoá đơn thay thế' }
    const thue = Number(docTruong(st, 'SendTaxStatus'))
    if (thue === 3 || thue === 4) return { guiDuoc: false, vinhVien: true, lyDo: 'Cơ quan thuế không chấp nhận hoá đơn (không hợp lệ)' }
    if (coMa && thue !== 2) {
        return { guiDuoc: false, vinhVien: false, lyDo: `Chưa được cơ quan thuế cấp mã (trạng thái ${Number.isFinite(thue) ? thue : '?'}) — thử lại lượt sau` }
    }
    const ghiChu = ei === 3 ? 'hoá đơn thay thế' : ei === 5 || ei === 4 ? 'hoá đơn điều chỉnh' : lienQuan === 5 ? 'hoá đơn đã có hoá đơn điều chỉnh' : null
    return { guiDuoc: true, vinhVien: false, lyDo: null, ghiChu }
}

/** Trạng thái nhiều hoá đơn theo mã tra cứu (≤ 50 mã / lời gọi) */
export async function trangThaiNhieu(sp: any, kn: KetNoiMeInvoice, ma: string[], mtt = false): Promise<Map<string, any>> {
    const ra = new Map<string, any>()
    for (let i = 0; i < ma.length; i += 50) {
        const data = await goiApi(sp, kn, 'tichHop', `/invoice/status?inputType=1&invoiceWithCode=${kn.coMa ? 'true' : 'false'}&invoiceCalcu=${mtt ? 'true' : 'false'}`, ma.slice(i, i + 50))
        const d = moChuoiJson(data)
        for (const st of Array.isArray(d) ? d : []) {
            const k = String(docTruong(st, 'TransactionID') ?? '')
            if (k) ra.set(k, st)
        }
    }
    return ra
}

/** PDF trong trả về /invoice/Download — hàm thuần. Tài liệu: Data = [{TransactionID, data (base64), ErrorCode}] (dò nhiều tên). */
export function docPdf(data: any, maTraCuu: string): Buffer {
    const d = moChuoiJson(data)
    const ds: any[] = Array.isArray(d) ? d : d && typeof d === 'object' ? [d] : []
    // có ghi mã mà không mã nào khớp ⇒ KHÔNG lấy bừa tệp đầu (gửi nhầm hoá đơn người khác); chỉ khi MISA không ghi mã mới lấy tệp duy nhất
    const coMa = ds.filter(x => docTruong(x, 'TransactionID') !== undefined)
    const muc = coMa.length ? coMa.find(x => String(docTruong(x, 'TransactionID')) === maTraCuu) : ds.length === 1 ? ds[0] : undefined
    if (!muc || typeof muc !== 'object') throw new LoiMeInvoice('MISA không trả tệp hoá đơn.')
    const b64 = docTruong(muc, 'Data', 'FileData', 'Content', 'File')
    const maLoi = docTruong(muc, 'ErrorCode')
    if (typeof b64 !== 'string' || !b64) throw new LoiMeInvoice(`MISA không trả tệp hoá đơn${maLoi ? ` (${maLoi})` : ''}.`)
    const buf = Buffer.from(b64, 'base64')
    if (buf.subarray(0, 4).toString('latin1') !== '%PDF') throw new LoiMeInvoice('Tệp MISA trả về không phải PDF.')
    return buf
}

export async function taiPdf(sp: any, kn: KetNoiMeInvoice, maTraCuu: string, mtt = false): Promise<Buffer> {
    const data = await goiApi(sp, kn, 'tichHop',
        `/invoice/Download?downloadDataType=Pdf&invoiceWithCode=${kn.coMa ? 'true' : 'false'}&invoiceCalcu=${mtt ? 'true' : 'false'}`, [maTraCuu])
    return docPdf(data, maTraCuu)
}

/** Trang tra cứu hoá đơn chính thức của MISA (đo 29/10/2026: 200, "Tra Cứu Hóa Đơn Điện Tử … | meInvoice.vn") */
export const TRANG_TRA_CUU_MISA = 'https://www.meinvoice.vn/tra-cuu'

/** Link XEM trong trả về /invoice/publishview — hàm thuần. Tài liệu: Data = [{TransactionID, Link}] (chưa đo ⇒ dò nhiều tên; chỉ nhận https). */
export function docLinkXem(data: any, maTraCuu: string): string {
    const d = moChuoiJson(data)
    if (typeof d === 'string') {
        if (/^https:\/\//i.test(d.trim())) return d.trim()
        throw new LoiMeInvoice('MISA không trả link xem hoá đơn.')
    }
    const ds: any[] = Array.isArray(d) ? d : d && typeof d === 'object' ? [d] : []
    const coMa = ds.filter(x => x && typeof x === 'object' && docTruong(x, 'TransactionID') !== undefined)
    const muc = coMa.length ? coMa.find(x => String(docTruong(x, 'TransactionID')) === maTraCuu) : ds.length === 1 ? ds[0] : undefined
    const link = typeof muc === 'string' ? muc : muc && typeof muc === 'object' ? docTruong(muc, 'Link', 'Url', 'ViewLink', 'LinkView') : undefined
    if (typeof link !== 'string' || !/^https:\/\//i.test(link.trim())) {
        const maLoi = muc && typeof muc === 'object' ? docTruong(muc, 'ErrorCode') : null
        throw new LoiMeInvoice(`MISA không trả link xem hoá đơn${maLoi ? ` (${maLoi})` : ''}.`)
    }
    return link.trim()
}

/** Link xem hoá đơn chính thức trên MISA — CÓ HẠN, nên chỉ lấy đúng lúc khách bấm */
export async function linkXemMisa(sp: any, kn: KetNoiMeInvoice, maTraCuu: string): Promise<string> {
    return docLinkXem(await goiApi(sp, kn, 'tichHop', '/invoice/publishview', [maTraCuu]), maTraCuu)
}

export type CachMo = { loai: 'pdf'; buf: Buffer } | { loai: 'xem'; link: string; loiPdf: string }

/**
 * Mở hoá đơn cho khách: PDF có chữ ký số, không được thì trang xem của MISA. ĐO 29/10/2026 HUTI: HĐ ngày 26/10 (cả HĐ không gửi) đều
 * "TemplateNotSupport" khi tải PDF, từ 27/10 thì tải được — trạng thái MISA giống hệt ⇒ đổi mẫu hoá đơn; link xem là đường dự phòng.
 */
export async function moHoaDon(sp: any, kn: KetNoiMeInvoice, maTraCuu: string, mtt = false): Promise<CachMo> {
    try {
        return { loai: 'pdf', buf: await taiPdf(sp, kn, maTraCuu, mtt) }
    } catch (e: any) {
        if (!(e instanceof LoiMeInvoice)) throw e
        try {
            return { loai: 'xem', link: await linkXemMisa(sp, kn, maTraCuu), loiPdf: e.message }
        } catch (e2: any) {
            if (!(e2 instanceof LoiMeInvoice)) throw e2
            throw new LoiMeInvoice(`${e.message} Link xem: ${e2.message}`)
        }
    }
}

// ─── Link bền + biến của tin ───────────────────────────────────────────────────

/** Gốc API công khai — cloudbuild đặt PUBLIC_API_URL KHÔNG có /api; vẫn đỡ kiểu có /api */
const GOC_API = (process.env.PUBLIC_API_URL || 'https://api.kengi.vn').replace(/\/+$/, '').replace(/\/api$/, '')
export const linkHoaDon = (maCuaHang: string, token: string) => `${GOC_API}/api/meinvoice/hd/${encodeURIComponent(maCuaHang)}/${token}`
const taoToken = () => crypto.randomBytes(18).toString('base64url')
export const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/

/** Biến của MỘT hoá đơn cho mẫu tin (dienMau của lib/zaloGui.ts thay — tên biến chỉ chữ cái) — hàm thuần */
export function bienHoaDon(hd: HoaDonMisa, raw: any, link: string): Record<string, string> {
    return {
        loaiHoaDon: String(docTruong(raw, 'InvoiceName') ?? '').trim() || 'Hoá đơn',
        soHoaDon: hd.so || '',
        kyHieu: hd.kyHieu || '',
        ngayHoaDon: hd.ngay ? hd.ngay.split('-').reverse().join('/') : '',
        tongTien: hd.tongTien === null ? '' : `${Math.round(hd.tongTien).toLocaleString('vi-VN')}đ`,
        maTraCuu: hd.maTraCuu || '',
        linkHoaDon: link,
        nguoiMua: hd.tenNguoiMua || '',
    }
}

// ─── Sổ đã gửi ─────────────────────────────────────────────────────────────────

export interface DongDaGui {
    maTraCuu: string; token: string; refId: string | null; kyHieu: string | null; so: string | null; ngay: string | null
    tongTien: number | null; customerId: string | null; maKhach: string | null; mtt: boolean
    trangThai: 'dang_xep' | 'da_xep' | 'loi' | 'bo_qua'; loi: string | null; lanThu: number
    dotId: string | null; soNhom: number; nguon: string | null; nguoi: string | null; taoLuc: number; capNhatLuc: number
}

const docDong = (x: any): DongDaGui => ({
    maTraCuu: String(x.maTraCuu), token: String(x.token), refId: x.refId ?? null, kyHieu: x.kyHieu ?? null, so: x.so ?? null, ngay: x.ngay ?? null,
    tongTien: x.tongTien === null || x.tongTien === undefined ? null : Number(x.tongTien), customerId: x.customerId ?? null, maKhach: x.maKhach ?? null,
    mtt: x.mtt === true, trangThai: x.trangThai, loi: x.loi ?? null, lanThu: Number(x.lanThu) || 0, dotId: x.dotId ?? null,
    soNhom: Number(x.soNhom) || 0, nguon: x.nguon ?? null, nguoi: x.nguoi ?? null, taoLuc: Number(x.taoLuc), capNhatLuc: Number(x.capNhatLuc),
})

export async function docDaGui(sp: any, ma: string[]): Promise<Map<string, DongDaGui>> {
    await damBaoBangGui(sp)
    const ra = new Map<string, DongDaGui>()
    const ds = [...new Set(ma.filter(Boolean))]
    for (let i = 0; i < ds.length; i += 500) {
        const r: any[] = await sp.$queryRawUnsafe(`SELECT * FROM ${BANG_GUI} WHERE "maTraCuu" = ANY($1::text[])`, ds.slice(i, i + 500))
        for (const x of r) ra.set(String(x.maTraCuu), docDong(x))
    }
    return ra
}

export async function dsGanDay(sp: any, gioiHan = 30): Promise<DongDaGui[]> {
    await damBaoBangGui(sp)
    const r: any[] = await sp.$queryRawUnsafe(`SELECT * FROM ${BANG_GUI} ORDER BY "capNhatLuc" DESC LIMIT $1`, Math.min(200, Math.max(1, gioiHan)))
    return r.map(docDong)
}

interface GhiHd { refId: string | null; kyHieu: string | null; so: string | null; ngay: string | null; tongTien: number | null; customerId: string | null; maKhach: string | null; mtt: boolean }

const COT = `"maTraCuu","token","refId","kyHieu","so","ngay","tongTien","customerId","maKhach","mtt","trangThai","loi","lanThu","nguon","nguoi","taoLuc","capNhatLuc"`

/** Ghi lỗi / bỏ — CHỈ đè dòng đang 'loi' (dòng đã xếp gửi không bao giờ bị hạ xuống) */
async function ghiKhongGui(sp: any, ma: string, g: GhiHd, trangThai: 'loi' | 'bo_qua', lyDo: string, nguon: string, nguoi: string | null, luc: number) {
    await sp.$executeRawUnsafe(
        `INSERT INTO ${BANG_GUI} (${COT}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,$15,$15)
         ON CONFLICT ("maTraCuu") DO UPDATE SET "trangThai"=EXCLUDED."trangThai", "loi"=EXCLUDED."loi", "lanThu"=${BANG_GUI}."lanThu"+1,
             "nguon"=EXCLUDED."nguon", "nguoi"=EXCLUDED."nguoi", "capNhatLuc"=EXCLUDED."capNhatLuc"
         WHERE ${BANG_GUI}."trangThai" = 'loi'`,
        ma, taoToken(), g.refId, g.kyHieu, g.so, g.ngay, g.tongTien, g.customerId, g.maKhach, g.mtt, trangThai, lyDo.slice(0, 500), nguon, nguoi, luc)
}

/** GIÀNH hoá đơn để xếp gửi: chưa có dòng, hoặc dòng đang 'loi'. Trả token (giữ token cũ nếu có) hoặc null = đã có bên khác giành / đã gửi. */
async function gianh(sp: any, ma: string, g: GhiHd, nguon: string, nguoi: string | null, luc: number): Promise<string | null> {
    const r: any[] = await sp.$queryRawUnsafe(
        `INSERT INTO ${BANG_GUI} (${COT}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'dang_xep',NULL,0,$11,$12,$13,$13)
         ON CONFLICT ("maTraCuu") DO UPDATE SET "trangThai"='dang_xep', "loi"=NULL, "nguon"=EXCLUDED."nguon", "nguoi"=EXCLUDED."nguoi",
             "customerId"=EXCLUDED."customerId", "maKhach"=EXCLUDED."maKhach", "capNhatLuc"=EXCLUDED."capNhatLuc"
         WHERE ${BANG_GUI}."trangThai" = 'loi'
         RETURNING "token"`,
        ma, taoToken(), g.refId, g.kyHieu, g.so, g.ngay, g.tongTien, g.customerId, g.maKhach, g.mtt, nguon, nguoi, luc)
    return r[0]?.token ? String(r[0].token) : null
}

/** Giành ÉP cho gửi tay (chủ shop bấm = bắt buộc gửi, kể cả HĐ đã gửi / đã bỏ): luôn được, GIỮ token cũ ⇒ link cũ vẫn chạy */
async function gianhEp(sp: any, ma: string, g: GhiHd, nguoi: string | null, luc: number): Promise<string> {
    const r: any[] = await sp.$queryRawUnsafe(
        `INSERT INTO ${BANG_GUI} (${COT}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'dang_xep',NULL,0,'tay',$11,$12,$12)
         ON CONFLICT ("maTraCuu") DO UPDATE SET "trangThai"='dang_xep', "loi"=NULL, "nguon"='tay', "nguoi"=EXCLUDED."nguoi",
             "customerId"=EXCLUDED."customerId", "maKhach"=EXCLUDED."maKhach", "capNhatLuc"=EXCLUDED."capNhatLuc"
         RETURNING "token"`,
        ma, taoToken(), g.refId, g.kyHieu, g.so, g.ngay, g.tongTien, g.customerId, g.maKhach, g.mtt, nguoi, luc)
    return String(r[0].token)
}

/**
 * Dòng kẹt 'dang_xep' (máy dừng giữa lúc xếp): đợt đã có dòng hàng đợi ⇒ coi như đã xếp (hàng đợi sẽ gửi); chưa có dòng nào ⇒
 * chưa tin nào đi ⇒ huỷ đợt rỗng, trả về 'loi' để thử lại. Không bao giờ để một hoá đơn được xếp hai lần.
 */
async function donKet(sp: any, bayGio = Date.now()) {
    await damBaoBangGui(sp)
    const ket: any[] = await sp.$queryRawUnsafe(`SELECT "maTraCuu","dotId" FROM ${BANG_GUI} WHERE "trangThai" = 'dang_xep' AND "capNhatLuc" < $1`, bayGio - KET_MS)
    for (const k of ket) {
        const soDong = k.dotId ? await sp.zaloDotGuiNhom.count({ where: { dotId: k.dotId } }) : 0
        if (soDong > 0) {
            await sp.$executeRawUnsafe(`UPDATE ${BANG_GUI} SET "trangThai"='da_xep', "soNhom"=$2, "capNhatLuc"=$3 WHERE "maTraCuu"=$1 AND "trangThai"='dang_xep'`, k.maTraCuu, soDong, bayGio)
        } else {
            if (k.dotId) await sp.zaloDotGui.updateMany({ where: { id: k.dotId }, data: { trangThai: 'huy' } })
            await sp.$executeRawUnsafe(`UPDATE ${BANG_GUI} SET "trangThai"='loi', "loi"=$2, "capNhatLuc"=$3 WHERE "maTraCuu"=$1 AND "trangThai"='dang_xep'`,
                k.maTraCuu, 'Máy dừng giữa lúc xếp gửi (chưa tin nào đi) — sẽ thử lại', bayGio)
        }
    }
}

// ─── Xếp gửi ───────────────────────────────────────────────────────────────────

export type KetQuaXep =
    | { ketQua: 'da_xep'; dotId: string; soNhom: number; lyDo: null; luuY?: string[] }
    | { ketQua: 'da_co' | 'bo_qua' | 'loi'; lyDo: string }

export interface UngVien { dong: DongXemTruoc; raw: any; mtt: boolean }

/**
 * Một hoá đơn đã có kết luận trạng thái: tải thử PDF → giành → tạo đợt Zalo (đợt trước, ghi dotId, rồi mới tạo dòng hàng đợi).
 * `batBuoc` (gửi tay — chủ shop 29/10/2026: "khi gửi tay thì bắt buộc gửi"): KHÔNG qua cửa trạng thái / PDF (người gọi đã hỏi, chỉ để
 * báo), giành ÉP — gửi cả hoá đơn đã gửi / đã bỏ; link giữ nguyên.
 */
export async function xepMot(
    sp: any, maCuaHang: string, kn: KetNoiMeInvoice, uv: UngVien, st: KetLuanTrangThai, mau: string, nguon: 'tu_dong' | 'tay', nguoi: string | null,
    batBuoc = false,
): Promise<KetQuaXep> {
    const hd = uv.dong.hoaDon
    const ma = hd.maTraCuu
    const khach = uv.dong.khach
    if (!ma) return { ketQua: 'bo_qua', lyDo: 'Hoá đơn không có mã tra cứu' }
    if (!khach || !uv.dong.nhom.length) return { ketQua: 'bo_qua', lyDo: 'Không có khách / nhóm Zalo để gửi' }
    const g: GhiHd = { refId: hd.refId, kyHieu: hd.kyHieu, so: hd.so, ngay: hd.ngay, tongTien: hd.tongTien, customerId: khach.id, maKhach: khach.code, mtt: uv.mtt }
    let token: string | null
    if (batBuoc) {
        token = await gianhEp(sp, ma, g, nguoi, Date.now())
    } else {
        if (!st.guiDuoc) {
            const tt = st.vinhVien ? 'bo_qua' : 'loi'
            await ghiKhongGui(sp, ma, g, tt, st.lyDo || 'Không gửi được', nguon, nguoi, Date.now())
            return { ketQua: tt, lyDo: st.lyDo || 'Không gửi được' }
        }
        try {
            // PDF hoặc trang xem của MISA — một trong hai mở được thì link trong tin không chết
            await moHoaDon(sp, kn, ma, uv.mtt)
        } catch (e: any) {
            if (!(e instanceof LoiMeInvoice)) throw e
            const lyDo = `Chưa mở được hoá đơn trên MISA: ${e.message}`.slice(0, 400)
            await ghiKhongGui(sp, ma, g, 'loi', lyDo, nguon, nguoi, Date.now())
            return { ketQua: 'loi', lyDo }
        }
        token = await gianh(sp, ma, g, nguon, nguoi, Date.now())
        if (!token) return { ketQua: 'da_co', lyDo: 'Hoá đơn đã được xếp gửi trước đó' }
    }
    let dotId: string | null = null
    try {
        const bien = bienHoaDon(hd, uv.raw, linkHoaDon(maCuaHang, token))
        const dot = await sp.zaloDotGui.create({
            data: {
                tieuDe: `Hoá đơn MISA ${hd.kyHieu || ''}-${hd.so || ''} · ${khach.code}`.slice(0, 200), noiDung: mau, anh: null,
                soNhom: uv.dong.nhom.length, nguoiTao: (nguon === 'tay' ? `meinvoice:tay:${nguoi || ''}` : 'meinvoice:tu_dong').slice(0, 120),
            },
        })
        dotId = dot.id
        // ghi dotId TRƯỚC khi có dòng hàng đợi — máy dừng giữa chừng thì donKet biết đợt nào để soát
        await sp.$executeRawUnsafe(`UPDATE ${BANG_GUI} SET "dotId"=$2, "capNhatLuc"=$3 WHERE "maTraCuu"=$1`, ma, dot.id, Date.now())
        await sp.zaloDotGuiNhom.createMany({
            data: uv.dong.nhom.map(n => ({ dotId: dot.id, groupId: n.groupId, customerId: khach.id, tenNhom: n.tenNhom, bien: JSON.stringify(bien) })),
            skipDuplicates: true,
        })
        await sp.$executeRawUnsafe(`UPDATE ${BANG_GUI} SET "trangThai"='da_xep', "soNhom"=$2, "loi"=NULL, "capNhatLuc"=$3 WHERE "maTraCuu"=$1`, ma, uv.dong.nhom.length, Date.now())
        return { ketQua: 'da_xep', dotId: dot.id, soNhom: uv.dong.nhom.length, lyDo: null }
    } catch (e: any) {
        // Dòng hàng đợi đã có ⇒ để donKet kết luận (có thể đã gửi) — KHÔNG hạ về 'loi' kẻo gửi hai lần
        const coDong = dotId ? await sp.zaloDotGuiNhom.count({ where: { dotId } }).catch(() => 1) : 0
        if (!coDong) {
            if (dotId) await sp.zaloDotGui.updateMany({ where: { id: dotId }, data: { trangThai: 'huy' } }).catch(() => null)
            await sp.$executeRawUnsafe(`UPDATE ${BANG_GUI} SET "trangThai"='loi', "loi"=$2, "dotId"=NULL, "capNhatLuc"=$3 WHERE "maTraCuu"=$1 AND "trangThai"='dang_xep'`,
                ma, `Lỗi khi xếp vào hàng đợi Zalo: ${String(e?.message || e).slice(0, 200)}`, Date.now()).catch(() => null)
        }
        throw e
    }
}

async function kiemKenhZalo(sp: any): Promise<{ ok: boolean; lyDo: string | null }> {
    const ch = await sp.zaloCauHinh.findUnique({ where: { id: 'default' } }).catch(() => null)
    const { kenh, tamDung } = await chonKenhGui(sp, ch)
    return kenh ? { ok: true, lyDo: null } : { ok: false, lyDo: tamDung || CAU_CHUA_CO_KENH }
}

/** Trạng thái kênh Zalo cho màn hình cài đặt */
export async function moTaKenhZalo(sp: any): Promise<{ ok: boolean; lyDo: string | null }> {
    return kiemKenhZalo(sp)
}

/**
 * Gửi TAY một hoá đơn — chủ shop 29/10/2026: "khi gửi tay thì bắt buộc gửi". Đọc lại hoá đơn từ MISA (không tin dữ liệu trình duyệt),
 * rồi gửi bất kể trạng thái MISA / khách có yêu cầu hay không / đã gửi rồi; trạng thái + tải thử PDF chỉ để BÁO (luuY).
 * Chỉ dừng khi KHÔNG THỂ gửi: chưa đăng nhập Zalo, không ra khách Kengi, khách chưa nối nhóm Zalo.
 */
export async function guiTay(sp: any, maCuaHang: string, maTraCuu: string, ngay: string, nguoi: string): Promise<KetQuaXep> {
    const kn = await docKetNoi(sp)
    if (!kn) throw new LoiMeInvoice('Cửa hàng chưa nhập kết nối meInvoice.')
    await donKet(sp)
    const kenh = await kiemKenhZalo(sp)
    if (!kenh.ok) throw new LoiMeInvoice(kenh.lyDo || CAU_CHUA_CO_KENH)
    const ph = await dsHoaDonPhatHanh(sp, kn, ngay, ngay)
    const i = ph.tho.findIndex(r => docHoaDon(r).maTraCuu === maTraCuu)
    if (i < 0) throw new LoiMeInvoice('Không thấy hoá đơn này trong danh sách MISA của ngày đó — soi lại rồi thử.')
    const { dong } = await xemTruocGui(sp, [docHoaDon(ph.tho[i])], true)
    const d = dong[0]
    if (!d.khach) throw new LoiMeInvoice(`Không gửi được: ${d.lyDo}`)
    if (!d.nhom.length) throw new LoiMeInvoice(`Không gửi được: khách ${d.khach.code} chưa nối nhóm Zalo nào`)
    const mtt = ph.dong[i].nguon === 'mtt'
    const luuY: string[] = []
    if (d.ketQua === 'khong_yeu_cau') luuY.push('Khách không yêu cầu hoá đơn — gửi theo lệnh tay')
    try {
        const kl = ketLuanTrangThai((await trangThaiNhieu(sp, kn, [maTraCuu], mtt)).get(maTraCuu), kn.coMa)
        if (!kl.guiDuoc && kl.lyDo) luuY.push(kl.lyDo)
        else if (kl.ghiChu) luuY.push(`Đây là ${kl.ghiChu}`)
    } catch (e: any) { luuY.push(`Không hỏi được trạng thái MISA: ${String(e?.message || e).slice(0, 160)}`) }
    try {
        const mo = await moHoaDon(sp, kn, maTraCuu, mtt)
        if (mo.loai === 'xem') luuY.push(`MISA không cho tải PDF hoá đơn này (${mo.loiPdf.slice(0, 100)}) — link trong tin sẽ mở trang xem hoá đơn của MISA`)
    } catch (e: any) {
        luuY.push(`Chưa mở được hoá đơn trên MISA (${String(e?.message || e).slice(0, 140)}) — khách tra bằng mã tra cứu tại meinvoice.vn/tra-cuu; link tự thử lại khi khách mở`)
    }
    const cd = await docCaiDat(sp)
    const kq = await xepMot(sp, maCuaHang, kn, { dong: d, raw: ph.tho[i], mtt }, { guiDuoc: true, vinhVien: false, lyDo: null }, cd.mauTin || MAU_MAC_DINH, 'tay', nguoi, true)
    return kq.ketQua === 'da_xep' && luuY.length ? { ...kq, luuY } : kq
}

/** Ứng viên tự động: "sẽ gửi", có mã tra cứu, ngày ≥ mốc bật, chưa xếp / chưa bỏ / lỗi chưa quá lượt — hàm thuần */
export function chonUngVien(
    dong: DongXemTruoc[], tho: any[], nguon: ('thuong' | 'mtt')[], daGui: Map<string, DongDaGui>, guiTuNgay: string, toiDa = TOI_DA_MOI_NHIP,
): UngVien[] {
    const ra: UngVien[] = []
    for (let i = 0; i < dong.length && ra.length < toiDa; i++) {
        const d = dong[i]
        const hd = d.hoaDon
        if (d.ketQua !== 'se_gui' || !hd.maTraCuu || !hd.ngay || hd.ngay < guiTuNgay) continue
        const r = daGui.get(hd.maTraCuu)
        if (r && !(r.trangThai === 'loi' && r.lanThu < LAN_TU_DONG_TOI_DA)) continue
        ra.push({ dong: d, raw: tho[i], mtt: nguon[i] === 'mtt' })
    }
    return ra
}

/** Một lượt TỰ ĐỘNG cho một cửa hàng. null = không có việc (chưa từng dùng / chưa bật) — không tạo bảng cho cửa hàng chưa dùng. */
export async function guiTuDongCuaHang(sp: any, maCuaHang: string, bayGio = new Date(), nganSachMs = 45_000): Promise<string | null> {
    const batDau = Date.now()
    const co: any[] = await sp.$queryRawUnsafe(`SELECT to_regclass('${BANG_CAI_DAT}')::text AS t`)
    if (!co[0]?.t) return null
    const cd = await docCaiDat(sp)
    if (!cd.tuDong || !cd.guiTuNgay) return null
    const kn = await docKetNoi(sp)
    if (!kn) return 'chua-ket-noi-meinvoice'
    await donKet(sp)
    const kenh = await kiemKenhZalo(sp)
    if (!kenh.ok) return 'cho-zalo'
    const homNay = ngayVN(bayGio)
    const lui = congNgay(homNay, -LUI_NGAY)
    const tu = cd.guiTuNgay > lui ? cd.guiTuNgay : lui
    if (tu > homNay) return null
    const ph = await dsHoaDonPhatHanh(sp, kn, tu, homNay)
    if (!ph.tho.length) return '0'
    const { dong } = await xemTruocGui(sp, ph.tho.map(docHoaDon), true)
    const daGui = await docDaGui(sp, dong.map(d => d.hoaDon.maTraCuu || ''))
    const ung = chonUngVien(dong, ph.tho, ph.dong.map(d => d.nguon), daGui, cd.guiTuNgay)
    if (!ung.length) return `0/${ph.tho.length}`
    // trạng thái theo lô — HĐ thường và máy tính tiền hỏi riêng (tham số invoiceCalcu)
    const st = new Map<string, any>()
    for (const mtt of [false, true]) {
        const ma = ung.filter(u => u.mtt === mtt).map(u => u.dong.hoaDon.maTraCuu!)
        if (ma.length) for (const [k, v] of await trangThaiNhieu(sp, kn, ma, mtt)) st.set(k, v)
    }
    const mau = cd.mauTin || MAU_MAC_DINH
    let xep = 0, loi = 0, bo = 0
    for (const u of ung) {
        if (Date.now() - batDau > nganSachMs) break   // phần còn lại để lượt sau
        const kq = await xepMot(sp, maCuaHang, kn, u, ketLuanTrangThai(st.get(u.dong.hoaDon.maTraCuu!), kn.coMa), mau, 'tu_dong', null)
        if (kq.ketQua === 'da_xep') xep++
        else if (kq.ketQua === 'loi') loi++
        else if (kq.ketQua === 'bo_qua') bo++
    }
    return `xep${xep}${loi ? `/loi${loi}` : ''}${bo ? `/bo${bo}` : ''}`
}

/** Nhịp ngoài /api/cron/tick — mọi cửa hàng đang hoạt động, TUẦN TỰ; ngoài 7–21 giờ VN thì nghỉ */
export async function nhipGuiHoaDonMisa(bayGio = new Date()): Promise<string> {
    if (!trongGioGui(bayGio)) return 'ngoai-gio'
    const stores: any[] = await (registryPrisma as any).store.findMany({ where: { status: 'active' }, select: { schema: true, code: true } })
    const ra: string[] = []
    for (const s of stores) {
        try {
            const kq = await guiTuDongCuaHang(getStorePrisma(s.schema), s.code, bayGio)
            if (kq) ra.push(`${s.code}:${kq}`)
        } catch (e: any) { ra.push(`${s.code}:loi ${String(e?.message || e).slice(0, 80)}`) }
    }
    return ra.join(' ') || 'khong-co-gi'
}

// ─── Link công khai: tải PDF theo token ────────────────────────────────────────

export type MoTheoToken =
    | { loai: 'pdf'; buf: Buffer; ten: string }
    | { loai: 'xem'; link: string }
    | { loai: 'loi'; maTraCuu: string; so: string | null }

/**
 * Dòng đã xếp gửi theo token ⇒ PDF từ MISA, không được thì link xem của MISA, không được nữa thì mã tra cứu để khách tự tra.
 * null = token không có / chưa từng gửi.
 */
export async function moTheoToken(sp: any, token: string): Promise<MoTheoToken | null> {
    if (!TOKEN_RE.test(token)) return null
    const co: any[] = await sp.$queryRawUnsafe(`SELECT to_regclass('${BANG_GUI}')::text AS t`)
    if (!co[0]?.t) return null
    const r: any = ((await sp.$queryRawUnsafe(`SELECT * FROM ${BANG_GUI} WHERE "token" = $1 AND "trangThai" IN ('da_xep','dang_xep')`, token)) as any[])[0]
    if (!r) return null
    const ma = String(r.maTraCuu)
    const kn = await docKetNoi(sp)
    if (!kn) return { loai: 'loi', maTraCuu: ma, so: r.so ?? null }
    try {
        const mo = await moHoaDon(sp, kn, ma, r.mtt === true)
        if (mo.loai === 'xem') return { loai: 'xem', link: mo.link }
        const ten = `HoaDon-${String(r.kyHieu || '').replace(/[^0-9A-Za-z]/g, '')}-${String(r.so || '').replace(/[^0-9A-Za-z]/g, '')}.pdf`
        return { loai: 'pdf', buf: mo.buf, ten }
    } catch (e: any) {
        if (!(e instanceof LoiMeInvoice)) throw e
        console.error('[meinvoice/hd]', ma.slice(0, 4) + '…', e.message)
        return { loai: 'loi', maTraCuu: ma, so: r.so ?? null }
    }
}

// ─── Màn hình: trạng thái gửi của từng hoá đơn ────────────────────────────────

export interface TrangThaiHienThi { ma: 'da_gui' | 'dang' | 'loi_gui' | 'loi' | 'bo_qua'; nhan: string; chiTiet: string | null; luc: number }

/** Dòng sổ + dòng hàng đợi Zalo của đợt ⇒ một nhãn cho màn hình — hàm thuần */
export function nhanTrangThaiGui(r: DongDaGui, hangDoi: { trangThai: string; loi: string | null }[]): TrangThaiHienThi {
    const luc = r.capNhatLuc
    if (r.trangThai === 'bo_qua') return { ma: 'bo_qua', nhan: 'Không gửi', chiTiet: r.loi, luc }
    if (r.trangThai === 'loi') return { ma: 'loi', nhan: 'Chưa gửi được', chiTiet: `${r.loi || ''}${r.lanThu ? ` (đã thử ${r.lanThu} lần)` : ''}`.trim(), luc }
    if (r.trangThai === 'dang_xep') return { ma: 'dang', nhan: 'Đang xếp gửi', chiTiet: null, luc }
    const con = hangDoi.filter(h => h.trangThai !== 'huy')
    if (hangDoi.length && !con.length) return { ma: 'bo_qua', nhan: 'Đã huỷ gửi', chiTiet: 'Đợt gửi Zalo của hoá đơn này đã bị huỷ', luc }
    if (con.length && con.every(h => h.trangThai === 'da_gui')) return { ma: 'da_gui', nhan: 'Đã gửi Zalo', chiTiet: `${con.length} nhóm`, luc }
    const loi = con.filter(h => h.trangThai === 'loi')
    if (loi.length && !con.some(h => h.trangThai === 'cho' || h.trangThai === 'dang')) {
        return { ma: 'loi_gui', nhan: 'Gửi Zalo lỗi', chiTiet: loi[0].loi, luc }
    }
    return { ma: 'dang', nhan: 'Đang chờ gửi Zalo', chiTiet: con.length ? `${con.filter(h => h.trangThai === 'da_gui').length}/${con.length} nhóm` : null, luc }
}

/** Nhãn gửi cho nhiều hoá đơn (mã tra cứu ⇒ nhãn) */
export async function trangThaiGuiNhieu(sp: any, ma: string[]): Promise<Map<string, TrangThaiHienThi & { nguon: string | null; nguoi: string | null }>> {
    const so = await docDaGui(sp, ma)
    const dotIds = [...new Set([...so.values()].map(r => r.dotId).filter((x): x is string => !!x))]
    const theoDot = new Map<string, { trangThai: string; loi: string | null }[]>()
    for (let i = 0; i < dotIds.length; i += 500) {
        const rows: any[] = await sp.zaloDotGuiNhom.findMany({ where: { dotId: { in: dotIds.slice(i, i + 500) } }, select: { dotId: true, trangThai: true, loi: true } })
        for (const x of rows) {
            const ds = theoDot.get(x.dotId) || []
            ds.push({ trangThai: x.trangThai, loi: x.loi ?? null })
            theoDot.set(x.dotId, ds)
        }
    }
    const ra = new Map<string, TrangThaiHienThi & { nguon: string | null; nguoi: string | null }>()
    for (const [k, r] of so) ra.set(k, { ...nhanTrangThaiGui(r, r.dotId ? theoDot.get(r.dotId) || [] : []), nguon: r.nguon, nguoi: r.nguoi })
    return ra
}
