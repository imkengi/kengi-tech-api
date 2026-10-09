/**
 * ĐẨY DỮ LIỆU KENGI LÊN MISA AMIS KẾ TOÁN (09/10/2026)
 *
 * Chiều NGƯỢC với misaSync.ts: Kengi là nguồn, MISA là nơi nhận. Tài liệu đọc ở
 * developer.misa.vn/products-openapi/AMISKT (xem đầu services/misa.ts).
 *
 * Bốn loại đẩy:
 *   vattu     save_dictionary  dictionary_type = 3   từ Product
 *   doituong  save_dictionary  dictionary_type = 1   từ Customer + Supplier
 *   banhang   save             voucher_type   = 13   (Chứng từ bán hàng) từ Transaction
 *   muahang   save             voucher_type   = 18   (Mua hàng nhập kho) từ ImportReceipt
 *
 * BẢNG SỐ CHIỀU ĐẨY KHÁC CHIỀU LẤY: lấy về Kho = 3 nhưng đẩy lên Kho = 5; lấy
 * về Vật tư = 2 nhưng đẩy lên Vật tư = 3. Đừng dùng MISA_DATA_TYPE ở đây.
 *
 * MISA xử lý BẤT ĐỒNG BỘ: Success = true chỉ là "đã xếp hàng". Chứng từ lên
 * MISA dưới dạng ĐỀ NGHỊ sinh chứng từ — kế toán còn phải duyệt bên MISA mới
 * thành sổ. Kết quả xử lý tra bằng get_call_back_detail_error (`ketQuaXuLy`).
 *
 * Luật an toàn (skill data-sync-gate):
 *   - Mọi lượt đẩy đều dựng lại KẾ HOẠCH từ DB phía máy chủ; trình duyệt chỉ gửi
 *     id được chọn, không bao giờ gửi thân chứng từ.
 *   - Phiếu mang mã `MISA-` là phiếu ĐỔ TỪ MISA VỀ (cửa hàng gương HUTITAX) —
 *     đẩy ngược lên là nhân đôi sổ, luôn bỏ qua.
 *   - KHÔNG suy diễn "đã thu": chỉ ghi bán thu tiền ngay khi phiếu thanh toán
 *     đủ tiền, giống hệt autoJournal (sổ Kengi và sổ MISA phải kể cùng câu chuyện).
 *   - Mã hàng / mã khách chưa có trên MISA ⇒ chứng từ đứng ở "thiếu", nói rõ
 *     thiếu gì; không đẩy để MISA tự từ chối.
 *   - Mỗi (loai, localId) một dòng MisaPushItem; org_refid sinh tất định nên
 *     đẩy lại cùng phiếu vẫn trùng khoá bên MISA.
 */

import crypto from 'crypto'
import { MISA, MisaError, misaTime, type MisaCreds } from './misa'
import { detectOnlinePlatform } from '../lib/autoJournal'

export const LOAI_DAY = ['vattu', 'doituong', 'banhang', 'muahang'] as const
export type LoaiDay = typeof LOAI_DAY[number]

export const NHAN_LOAI_DAY: Record<LoaiDay, string> = {
    vattu: 'Vật tư, hàng hoá',
    doituong: 'Khách hàng & NCC',
    banhang: 'Chứng từ bán hàng',
    muahang: 'Mua hàng nhập kho',
}

/** voucher_type / dictionary_type CHIỀU ĐẨY theo tài liệu developer.misa.vn */
export const MA_LOAI_MISA: Record<LoaiDay, number> = { vattu: 3, doituong: 1, banhang: 13, muahang: 18 }
const LA_CHUNG_TU: Record<LoaiDay, boolean> = { vattu: false, doituong: false, banhang: true, muahang: true }

// ─── Thiết lập đẩy (MisaConfig.pushConfig) ──────────────────────────────────

export interface CaiDatDay {
    /** branch_id MISA — lấy từ danh mục Cơ cấu tổ chức (data_type 6) */
    branchId: string | null
    /** Mã kho MISA ghi vào từng dòng hàng (stock_code bắt buộc) */
    maKho: string | null
    tenKho: string | null
    /** Đối tượng MISA dùng cho phiếu KHÔNG gắn khách (khách lẻ) */
    maKhachLe: string | null
    /** Đối tượng MISA cho đơn sàn TMĐT — trống thì dùng khách lẻ */
    maKhachSan: string | null
    /** NCC MISA cho phiếu nhập không ghi NCC — trống thì phiếu đó đứng ở "thiếu" */
    maNccMacDinh: string | null
    /** Chứng từ bán hàng kiêm phiếu xuất kho (is_sale_with_outward) */
    kiemXuatKho: boolean
    /** purchase_purpose_id cho dòng mua hàng (mã nhóm HHDV mua vào của MISA) */
    purchasePurposeId: string | null
    tk: {
        tienMat: string; nganHang: string; phaiThu: string
        doanhThu: string; doanhThuDV: string; thueRa: string
        kho: string; phaiTra: string; thueVao: string; giaVon: string
    }
}

export const CAI_DAT_MAC_DINH: CaiDatDay = {
    branchId: null, maKho: null, tenKho: null,
    maKhachLe: null, maKhachSan: null, maNccMacDinh: null,
    kiemXuatKho: true,
    purchasePurposeId: null,
    tk: {
        tienMat: '1111', nganHang: '1121', phaiThu: '131',
        doanhThu: '5111', doanhThuDV: '5113', thueRa: '33311',
        kho: '1561', phaiTra: '331', thueVao: '1331', giaVon: '632',
    },
}

export function docCaiDat(raw: string | null | undefined): CaiDatDay {
    let o: any = {}
    try { o = raw ? JSON.parse(raw) : {} } catch { o = {} }
    const s = (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const tk: any = { ...CAI_DAT_MAC_DINH.tk }
    for (const k of Object.keys(tk)) if (s(o?.tk?.[k])) tk[k] = s(o.tk[k])
    return {
        branchId: s(o.branchId), maKho: s(o.maKho), tenKho: s(o.tenKho),
        maKhachLe: s(o.maKhachLe), maKhachSan: s(o.maKhachSan), maNccMacDinh: s(o.maNccMacDinh),
        kiemXuatKho: typeof o.kiemXuatKho === 'boolean' ? o.kiemXuatKho : CAI_DAT_MAC_DINH.kiemXuatKho,
        purchasePurposeId: s(o.purchasePurposeId),
        tk,
    }
}

// ─── Khoá tất định ──────────────────────────────────────────────────────────

/**
 * GUID tất định từ (cửa hàng, loại, id Kengi). Đẩy lại cùng một phiếu ra
 * CÙNG org_refid ⇒ MISA nhận ra là một yêu cầu, và xoá đề nghị dùng lại được
 * khoá mà không cần hỏi MISA.
 */
export function guidTatDinh(schema: string, loai: string, localId: string): string {
    const h = crypto.createHash('sha1').update(`kengi|${schema}|${loai}|${localId}`).digest('hex')
    const v = (parseInt(h[16], 16) & 0x3 | 0x8).toString(16)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

// ─── Danh mục hiện có bên MISA (đọc sống) ───────────────────────────────────

export interface DanhMucMisa {
    vatTuTheoMa: Map<string, { id: string; ten: string; dvt: string | null }>
    vatTuTheoId: Map<string, string>
    doiTuongTheoMa: Map<string, { id: string; ten: string; laKhach: boolean; laNcc: boolean }>
    doiTuongTheoId: Map<string, string>
    kho: Array<{ id: string; ma: string; ten: string }>
    chiNhanh: Array<{ id: string; ma: string; ten: string; loai: number }>
    layLuc: number
    canhBao: string[]
}

const pick = (o: any, ...keys: string[]) => {
    for (const k of keys) {
        const v = o?.[k]
        if (v !== undefined && v !== null && v !== '') return v
    }
    return undefined
}
const chuoi = (v: any) => (v === undefined || v === null ? '' : String(v).trim())
/** So mã không phân biệt hoa thường — MISA và Kengi đều có người gõ tay */
const khoaMa = (m: string) => m.trim().toUpperCase()

const boNhoDanhMuc = new Map<string, DanhMucMisa>()
const DANH_MUC_SONG_MS = 10 * 60_000

/**
 * Đọc TRỌN danh mục vật tư / đối tượng / kho / cơ cấu tổ chức bên MISA.
 * Danh mục luôn lấy trọn bộ, không lọc ngày (skill data-sync-gate: lọc ngày
 * lên danh mục là thiếu mã cũ ⇒ báo "chưa có" oan rồi đẩy trùng).
 */
export async function docDanhMucMisa(creds: MisaCreds, khoaBoNho: string, lamMoi = false): Promise<DanhMucMisa> {
    const cu = boNhoDanhMuc.get(khoaBoNho)
    if (!lamMoi && cu && Date.now() - cu.layLuc < DANH_MUC_SONG_MS) return cu

    const canhBao: string[] = []
    // TUẦN TỰ — không Promise.all: MISA không nói giới hạn tần suất, đừng thử
    const vt = await MISA.danhMuc(creds, 2, {}, { maxPages: 300 })
    const dt = await MISA.danhMuc(creds, 1, {}, { maxPages: 300 })
    const kh = await MISA.danhMuc(creds, 3, {}, { maxPages: 5 })
    const cc = await MISA.danhMuc(creds, 6, {}, { maxPages: 5 })
    if (vt.truncated) canhBao.push('Danh mục vật tư MISA quá 30.000 mã — phần sau bị cắt, kết quả "chưa có trên MISA" có thể sai.')
    if (dt.truncated) canhBao.push('Danh mục đối tượng MISA quá 30.000 — phần sau bị cắt.')

    const vatTuTheoMa = new Map<string, { id: string; ten: string; dvt: string | null }>()
    const vatTuTheoId = new Map<string, string>()
    for (const m of vt.items) {
        const ma = chuoi(pick(m, 'inventory_item_code', 'InventoryItemCode'))
        const id = chuoi(pick(m, 'inventory_item_id', 'InventoryItemID'))
        if (!ma) continue
        vatTuTheoMa.set(khoaMa(ma), {
            id, ten: chuoi(pick(m, 'inventory_item_name', 'InventoryItemName')),
            dvt: chuoi(pick(m, 'unit_name', 'UnitName')) || null,
        })
        if (id) vatTuTheoId.set(id, ma)
    }
    const doiTuongTheoMa = new Map<string, { id: string; ten: string; laKhach: boolean; laNcc: boolean }>()
    const doiTuongTheoId = new Map<string, string>()
    for (const m of dt.items) {
        const ma = chuoi(pick(m, 'account_object_code', 'AccountObjectCode'))
        const id = chuoi(pick(m, 'account_object_id', 'AccountObjectID'))
        if (!ma) continue
        doiTuongTheoMa.set(khoaMa(ma), {
            id, ten: chuoi(pick(m, 'account_object_name', 'AccountObjectName')),
            laKhach: !!pick(m, 'is_customer', 'IsCustomer'), laNcc: !!pick(m, 'is_vendor', 'IsVendor'),
        })
        if (id) doiTuongTheoId.set(id, ma)
    }
    const dm: DanhMucMisa = {
        vatTuTheoMa, vatTuTheoId, doiTuongTheoMa, doiTuongTheoId,
        kho: kh.items.map((m: any) => ({
            id: chuoi(pick(m, 'stock_id', 'StockID')),
            ma: chuoi(pick(m, 'stock_code', 'StockCode')),
            ten: chuoi(pick(m, 'stock_name', 'StockName')),
        })).filter(k => k.ma),
        chiNhanh: cc.items.map((m: any) => ({
            id: chuoi(pick(m, 'organization_unit_id', 'OrganizationUnitID')),
            ma: chuoi(pick(m, 'organization_unit_code', 'OrganizationUnitCode')),
            ten: chuoi(pick(m, 'organization_unit_name', 'OrganizationUnitName')),
            loai: Number(pick(m, 'organization_unit_type_id', 'OrganizationUnitTypeID')) || 0,
        }))
            // 1 = tổng công ty/công ty, 2 = chi nhánh — phòng ban (3, 4) không phải branch_id
            .filter(c => c.id && (c.loai === 1 || c.loai === 2)),
        layLuc: Date.now(),
        canhBao,
    }
    boNhoDanhMuc.set(khoaBoNho, dm)
    return dm
}

export function quenDanhMuc(khoaBoNho: string) { boNhoDanhMuc.delete(khoaBoNho) }

// ─── Kế hoạch đẩy ───────────────────────────────────────────────────────────

/**
 * san_sang  đủ điều kiện, sẽ đẩy
 * da_day    đã đẩy và MISA đã nhận (không đẩy lại trừ khi người dùng xoá đề nghị)
 * da_co     danh mục đã có sẵn trên MISA (theo mã)
 * thieu     thiếu điều kiện (mã chưa có trên MISA, chưa chọn kho…) — nói rõ thiếu gì
 * bo_qua    cố ý không đẩy (phiếu từ MISA về, mã đã gộp…)
 */
export type TrangThaiDong = 'san_sang' | 'da_day' | 'da_co' | 'thieu' | 'bo_qua'

export interface DongKeHoach {
    localId: string
    refNo: string
    ngay: string | null
    doiTuong: string
    soTien: number
    trangThai: TrangThaiDong
    lyDo: string[]
    canhBao: string[]
    /** Lần đẩy trước (nếu có) */
    lanTruoc: { trangThai: string; guiLuc: string; loi: string | null; lanGui: number } | null
    orgRefid: string
    payload?: any
}

export interface KetQuaKeHoach {
    loai: LoaiDay
    dong: DongKeHoach[]
    dem: Record<TrangThaiDong, number>
    tongTienSanSang: number
    /** Số bản ghi thoả điều kiện ngày — lớn hơn dong.length là đã chạm trần */
    tongTimThay: number
    tran: number
    canhBaoChung: string[]
}

export interface ThamSoKeHoach {
    loai: LoaiDay
    tu: Date
    den: Date
    /** Danh mục: 'trong_ky' = chỉ mã/đối tượng xuất hiện trên phiếu trong kỳ; 'tat_ca' */
    phamVi?: 'trong_ky' | 'tat_ca'
    schema: string
}

const TRAN_CHUNG_TU = 2000
const TRAN_DANH_MUC = 5000
const MAX_DONG_CHUNG_TU = 500   // tài liệu: tối đa 500 dòng chi tiết/chứng từ

const lam = (n: number) => Math.round(n)
const ngayVN = (d: Date | null | undefined) => (d ? misaTime(d) : null)
const THUE_HOP_LE = [0, 5, 8, 10]

/** Chia `tong` theo trọng số, dòng cuối nhận phần dư — tổng LUÔN khớp đến từng đồng. */
function chiaTheoTyLe(tong: number, trongSo: number[]): number[] {
    const sum = trongSo.reduce((s, x) => s + Math.max(0, x), 0)
    if (!tong || !trongSo.length) return trongSo.map(() => 0)
    if (sum <= 0) return trongSo.map((_, i) => (i === trongSo.length - 1 ? tong : 0))
    const kq = trongSo.map(x => lam(tong * Math.max(0, x) / sum))
    const lech = tong - kq.reduce((s, x) => s + x, 0)
    kq[kq.length - 1] += lech
    return kq
}

/**
 * Thuế suất MISA từ tiền thuế / tiền trước thuế. Sát một mức hợp lệ (±0,6 điểm)
 * thì lấy mức đó; không thì "KHAC" (-3) kèm thuế suất thật — không làm tròn
 * bừa về 10% rồi để tiền thuế và thuế suất cãi nhau.
 */
function thueSuat(thue: number, truocThue: number): { vat_rate?: number; other_vat_rate?: number; lech?: string } {
    if (!thue) return {}
    if (truocThue <= 0) return { vat_rate: 10, lech: 'có thuế nhưng tiền hàng bằng 0' }
    const eff = thue * 100 / truocThue
    const gan = THUE_HOP_LE.reduce((a, b) => (Math.abs(b - eff) < Math.abs(a - eff) ? b : a), 10)
    if (Math.abs(gan - eff) <= 0.6) return { vat_rate: gan }
    return { vat_rate: -3, other_vat_rate: Math.round(eff * 100) / 100, lech: `thuế suất thực ${eff.toFixed(2)}% không phải mức chuẩn — gửi dạng "Khác"` }
}

function demRong(): Record<TrangThaiDong, number> {
    return { san_sang: 0, da_day: 0, da_co: 0, thieu: 0, bo_qua: 0 }
}

async function docLanTruoc(sp: any, loai: LoaiDay, ids: string[]) {
    const map = new Map<string, any>()
    for (let i = 0; i < ids.length; i += 1000) {
        const rows = await sp.misaPushItem.findMany({
            where: { loai, localId: { in: ids.slice(i, i + 1000) } },
            select: { localId: true, trangThai: true, guiLuc: true, loi: true, lanGui: true },
        })
        for (const r of rows) map.set(r.localId, r)
    }
    return map
}

/** Áp lần đẩy trước lên một dòng đang "sẵn sàng". */
function apLanTruoc(d: DongKeHoach, truoc: any) {
    if (!truoc) return
    d.lanTruoc = {
        trangThai: truoc.trangThai, guiLuc: new Date(truoc.guiLuc).toISOString(),
        loi: truoc.loi || null, lanGui: truoc.lanGui || 1,
    }
    if (d.trangThai !== 'san_sang') return
    // MISA đã nhận và chưa báo lỗi ⇒ không gửi lại. Lỗi / đã xoá đề nghị ⇒ được gửi lại.
    if (truoc.trangThai === 'da_gui' || truoc.trangThai === 'misa_ok') {
        d.trangThai = 'da_day'
        d.lyDo.push(`Đã đẩy lúc ${misaTime(truoc.guiLuc)} — muốn gửi lại thì xoá đề nghị bên MISA trước`)
    } else {
        d.canhBao.push(`Gửi lại lần ${(truoc.lanGui || 1) + 1} (lần trước: ${truoc.trangThai}${truoc.loi ? ` — ${String(truoc.loi).slice(0, 160)}` : ''})`)
    }
}

/** Bản đồ id Kengi → mã MISA qua MisaMap (dữ liệu từng kéo từ MISA về). */
async function maMisaQuaMap(sp: any, entity: string, localIds: string[], theoId: Map<string, string>) {
    const kq = new Map<string, string>()
    if (!localIds.length) return kq
    for (let i = 0; i < localIds.length; i += 1000) {
        const rows = await sp.misaMap.findMany({
            where: { entity, localId: { in: localIds.slice(i, i + 1000) } },
            select: { localId: true, misaId: true, misaCode: true },
        }).catch(() => [])
        for (const r of rows) {
            // Ưu tiên mã MISA đang sống (theo id) — misaCode lưu có thể là mã bên Kengi
            const ma = theoId.get(String(r.misaId)) || r.misaCode
            if (ma) kq.set(r.localId, ma)
        }
    }
    return kq
}

const khoangNgay = (tu: Date, den: Date) => ({
    OR: [
        { transactionDate: { gte: tu, lte: den } },
        { transactionDate: null, createdAt: { gte: tu, lte: den } },
    ],
})

export async function lapKeHoach(
    sp: any, creds: MisaCreds, caiDat: CaiDatDay, dm: DanhMucMisa, ts: ThamSoKeHoach,
): Promise<KetQuaKeHoach> {
    switch (ts.loai) {
        case 'banhang': return keHoachBanHang(sp, caiDat, dm, ts)
        case 'muahang': return keHoachMuaHang(sp, caiDat, dm, ts)
        case 'vattu': return keHoachVatTu(sp, caiDat, dm, ts)
        case 'doituong': return keHoachDoiTuong(sp, caiDat, dm, ts)
    }
}

function tongKet(loai: LoaiDay, dong: DongKeHoach[], tongTimThay: number, tran: number, canhBaoChung: string[]): KetQuaKeHoach {
    const dem = demRong()
    let tien = 0
    for (const d of dong) {
        dem[d.trangThai]++
        if (d.trangThai === 'san_sang') tien += d.soTien
    }
    if (tongTimThay > dong.length) {
        canhBaoChung.unshift(`Tìm thấy ${tongTimThay} bản ghi nhưng chỉ xét ${dong.length} (trần ${tran}/lượt) — thu hẹp khoảng ngày để xét nốt phần còn lại.`)
    }
    return { loai, dong, dem, tongTienSanSang: tien, tongTimThay, tran, canhBaoChung }
}

/** Điều kiện chung mà mọi CHỨNG TỪ cần — thiếu thì cả lô đứng ở "thiếu". */
function thieuChung(caiDat: CaiDatDay, dm: DanhMucMisa): string[] {
    const t: string[] = []
    if (!caiDat.branchId) t.push('Chưa chọn chi nhánh MISA (branch_id)')
    else if (dm.chiNhanh.length && !dm.chiNhanh.some(c => c.id === caiDat.branchId)) t.push('Chi nhánh MISA đã chọn không còn trong danh mục MISA')
    if (!caiDat.maKho) t.push('Chưa chọn kho MISA')
    else if (dm.kho.length && !dm.kho.some(k => khoaMa(k.ma) === khoaMa(caiDat.maKho!))) t.push(`Kho "${caiDat.maKho}" không có trong danh mục kho MISA`)
    return t
}

// ── Chứng từ bán hàng (voucher_type 13) ─────────────────────────────────────

async function keHoachBanHang(sp: any, caiDat: CaiDatDay, dm: DanhMucMisa, ts: ThamSoKeHoach): Promise<KetQuaKeHoach> {
    const where = { status: { in: ['completed', 'partial'] }, ...khoangNgay(ts.tu, ts.den) }
    const tong = await sp.transaction.count({ where })
    const txs = await sp.transaction.findMany({
        where,
        include: {
            items: { include: { product: { select: { id: true, sku: true, name: true, baseUnit: true, productType: true } } } },
            payments: { select: { type: true, amount: true } },
            customer: {
                select: {
                    id: true, code: true, name: true, address: true, taxCode: true,
                    invoiceType: true, invoiceCompanyName: true, invoiceAddress: true,
                },
            },
        },
        orderBy: { createdAt: 'asc' },
        take: TRAN_CHUNG_TU,
    })

    const canhBaoChung: string[] = []
    const chung = thieuChung(caiDat, dm)
    const lanTruoc = await docLanTruoc(sp, 'banhang', txs.map((t: any) => t.id))
    const maHangQuaMap = await maMisaQuaMap(sp, 'product',
        [...new Set<string>(txs.flatMap((t: any) => t.items.map((i: any) => i.productId)))], dm.vatTuTheoId)
    const maKhachQuaMap = await maMisaQuaMap(sp, 'customer',
        [...new Set<string>(txs.map((t: any) => t.customerId).filter(Boolean))], dm.doiTuongTheoId)

    const kho = dm.kho.find(k => caiDat.maKho && khoaMa(k.ma) === khoaMa(caiDat.maKho))
    const dong: DongKeHoach[] = []

    for (const tx of txs) {
        const ngay = tx.transactionDate || tx.createdAt
        const d: DongKeHoach = {
            localId: tx.id, refNo: tx.receiptNumber, ngay: ngayVN(ngay),
            doiTuong: tx.customer?.name || tx.customerName || 'Khách lẻ',
            soTien: Number(tx.total) || 0,
            trangThai: 'san_sang', lyDo: [], canhBao: [], lanTruoc: null,
            orgRefid: guidTatDinh(ts.schema, 'banhang', tx.id),
        }
        dong.push(d)

        if (String(tx.receiptNumber || '').startsWith('MISA-')) {
            d.trangThai = 'bo_qua'
            d.lyDo.push('Phiếu đổ từ sổ MISA về — đẩy ngược lên là nhân đôi sổ')
            continue
        }
        if (chung.length) { d.trangThai = 'thieu'; d.lyDo.push(...chung) }

        // ── Đối tượng ──
        const san = detectOnlinePlatform(tx.receiptNumber)
        let maKhach: string | null = null
        if (tx.customer) {
            maKhach = maKhachQuaMap.get(tx.customer.id) || tx.customer.code
        } else if (san) {
            maKhach = caiDat.maKhachSan || caiDat.maKhachLe
            if (!maKhach) d.lyDo.push('Đơn sàn không gắn khách — chưa đặt "mã khách sàn" hay "mã khách lẻ"')
        } else {
            maKhach = caiDat.maKhachLe
            if (!maKhach) d.lyDo.push('Phiếu không gắn khách — chưa đặt "mã khách lẻ" MISA')
        }
        const dtMisa = maKhach ? dm.doiTuongTheoMa.get(khoaMa(maKhach)) : undefined
        if (maKhach && !dtMisa) d.lyDo.push(`Khách "${maKhach}" chưa có trên MISA — đẩy "Khách hàng & NCC" trước`)

        // ── Dòng hàng ──
        const items = (tx.items || []).filter((i: any) => Number(i.quantity) !== 0 || Number(i.lineTotal) !== 0)
        if (!items.length) d.lyDo.push('Phiếu không có dòng hàng')
        if (items.length > MAX_DONG_CHUNG_TU) d.lyDo.push(`Phiếu ${items.length} dòng — MISA nhận tối đa ${MAX_DONG_CHUNG_TU} dòng/chứng từ`)

        const thieuMa: string[] = []
        const maHang = items.map((it: any) => {
            const ma = maHangQuaMap.get(it.productId) || it.product?.sku || it.sku
            if (!dm.vatTuTheoMa.has(khoaMa(String(ma || '')))) thieuMa.push(String(ma || '(trống)'))
            return String(ma || '')
        })
        if (thieuMa.length) {
            const ds = [...new Set(thieuMa)]
            d.lyDo.push(`${ds.length} mã hàng chưa có trên MISA: ${ds.slice(0, 5).join(', ')}${ds.length > 5 ? '…' : ''} — đẩy "Vật tư" trước`)
        }
        if (d.lyDo.length && d.trangThai === 'san_sang') d.trangThai = 'thieu'

        // ── Tiền: khớp ĐÚNG cách autoJournal ghi sổ Kengi ──
        const subtotal = Number(tx.subtotal) || items.reduce((s: number, i: any) => s + (Number(i.lineTotal) || 0), 0)
        const giamGiaPhieu = String(tx.discountType || '') === 'percent'
            ? lam(subtotal * (Number(tx.discount) || 0) / 100)
            : lam(Number(tx.discount) || 0)
        const thue = lam(Number(tx.tax) || 0)
        const tongDong = items.reduce((s: number, i: any) => s + (Number(i.lineTotal) || 0), 0)
        if (Math.abs(tongDong - subtotal) > 1) d.canhBao.push(`Tổng dòng hàng ${lam(tongDong)} ≠ tiền hàng phiếu ${lam(subtotal)}`)

        const giamGiaDong = chiaTheoTyLe(giamGiaPhieu, items.map((i: any) => Number(i.lineTotal) || 0))
        const thueDong = chiaTheoTyLe(thue, items.map((i: any, k: number) => (Number(i.lineTotal) || 0) - giamGiaDong[k]))
        const ts_ = thueSuat(thue, subtotal - giamGiaPhieu)
        if (ts_.lech) d.canhBao.push(`Thuế: ${ts_.lech}`)

        const daThu = (tx.payments || []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0) || Number(tx.amountReceived) || 0
        const tongPhieu = Number(tx.total) || 0
        const thuDu = daThu >= tongPhieu - 0.5
        const loaiTT = String(tx.payments?.[0]?.type || 'cash')
        const laNganHang = loaiTT === 'bank' || loaiTT === 'transfer'
        if (new Set((tx.payments || []).map((p: any) => p.type)).size > 1) {
            d.canhBao.push('Thanh toán nhiều hình thức — ghi theo hình thức đầu tiên (giống sổ Kengi)')
        }
        // 3530 chưa thu · 3531 thu tiền mặt · 3537 chuyển khoản. Đơn sàn: sàn nợ ⇒ chưa thu.
        let reftype = 3530
        let tkNo = caiDat.tk.phaiThu
        if (!san && thuDu && tongPhieu > 0) {
            reftype = laNganHang ? 3537 : 3531
            tkNo = laNganHang ? caiDat.tk.nganHang : caiDat.tk.tienMat
        } else if (!san && daThu > 0) {
            d.canhBao.push(`Đã thu ${lam(daThu).toLocaleString('vi-VN')}đ / ${lam(tongPhieu).toLocaleString('vi-VN')}đ — ghi BÁN CHỊU cả phiếu; phần đã thu kế toán lập phiếu thu bên MISA`)
        }

        let tienHang = 0, tienGiam = 0
        const detail = items.map((it: any, k: number) => {
            const sl = Number(it.quantity) || 0
            const gia = Number(it.unitPrice) || 0
            const thanhTienDong = Number(it.lineTotal) || 0
            const goc = Math.max(lam(sl * gia), lam(thanhTienDong))
            const giam = Math.max(0, goc - lam(thanhTienDong)) + giamGiaDong[k]
            tienHang += goc
            tienGiam += giam
            const dv = it.product?.productType === 'service'
            const dvt = it.product?.baseUnit || 'Cái'
            return {
                sort_order: k + 1,
                inventory_item_code: maHang[k],
                inventory_item_name: it.productName || it.product?.name || maHang[k],
                description: it.productName || it.product?.name || maHang[k],
                inventory_item_type: dv ? 2 : 0,
                account_object_code: maKhach || undefined,
                account_object_name: dtMisa?.ten || d.doiTuong,
                stock_code: caiDat.maKho, stock_name: kho?.ten || caiDat.tenKho || caiDat.maKho,
                debit_account: tkNo,
                credit_account: dv ? caiDat.tk.doanhThuDV : caiDat.tk.doanhThu,
                unit_name: dvt, main_unit_name: dvt, main_convert_rate: 1,
                quantity: sl, main_quantity: sl,
                unit_price: gia, main_unit_price: gia,
                amount_oc: goc, amount: goc,
                discount_rate: goc > 0 ? Math.round(giam * 10000 / goc) / 100 : 0,
                discount_amount_oc: giam, discount_amount: giam,
                ...(ts_.vat_rate !== undefined ? { vat_rate: ts_.vat_rate } : {}),
                ...(ts_.other_vat_rate !== undefined ? { other_vat_rate: ts_.other_vat_rate } : {}),
                vat_amount_oc: thueDong[k], vat_amount: thueDong[k],
                vat_account: thue ? caiDat.tk.thueRa : undefined,
                is_promotion: goc > 0 && thanhTienDong === 0,
                is_description: false,
                exchange_rate_operator: '*',
            }
        })
        const tongTT = tienHang - tienGiam + thue
        if (Math.abs(tongTT - tongPhieu) > 1) {
            d.canhBao.push(`Tổng thanh toán dựng lại ${tongTT.toLocaleString('vi-VN')}đ ≠ tổng phiếu ${lam(tongPhieu).toLocaleString('vi-VN')}đ`)
        }

        const doiTuong = {
            account_object_code: maKhach || undefined,
            account_object_name: dtMisa?.ten || (tx.customer?.invoiceType === 'company' && tx.customer?.invoiceCompanyName) || d.doiTuong,
            account_object_address: tx.customer?.invoiceAddress || tx.customer?.address || undefined,
            account_object_tax_code: tx.customer?.taxCode || undefined,
        }
        const thoiDiem = ngayVN(ngay)
        d.payload = {
            voucher_type: 13,
            org_refid: d.orgRefid,
            org_refno: tx.receiptNumber,
            org_reftype_name: 'Phiếu bán hàng Kengi',
            reftype,
            branch_id: caiDat.branchId,
            ...doiTuong,
            currency_id: 'VND', exchange_rate: 1,
            discount_type: tienGiam > 0 ? 1 : 0,
            discount_rate_voucher: 0,
            is_sale_with_outward: caiDat.kiemXuatKho,
            include_invoice: 0,
            journal_memo: `Bán hàng ${tx.receiptNumber}${d.doiTuong ? ' - ' + d.doiTuong : ''}${tx.vatInvoiceNumber ? ` (HĐ ${tx.vatInvoiceNumber})` : ''}`.slice(0, 250),
            posted_date: thoiDiem, refdate: thoiDiem,
            total_sale_amount_oc: tienHang, total_sale_amount: tienHang,
            total_discount_amount_oc: tienGiam, total_discount_amount: tienGiam,
            total_vat_amount_oc: thue, total_vat_amount: thue,
            total_amount_oc: tongTT, total_amount: tongTT,
            ...(caiDat.kiemXuatKho ? {
                in_outward: {
                    reftype: 2020,
                    branch_id: caiDat.branchId,
                    ...doiTuong,
                    journal_memo: `Xuất kho bán hàng ${tx.receiptNumber}`,
                    posted_date: thoiDiem, refdate: thoiDiem, in_reforder: thoiDiem,
                },
            } : {}),
            detail,
        }
    }
    return tongKet('banhang', dong.map(d => { apLanTruoc(d, lanTruoc.get(d.localId)); return d }), tong, TRAN_CHUNG_TU, canhBaoChung)
}

// ── Mua hàng nhập kho (voucher_type 18) ─────────────────────────────────────

async function keHoachMuaHang(sp: any, caiDat: CaiDatDay, dm: DanhMucMisa, ts: ThamSoKeHoach): Promise<KetQuaKeHoach> {
    const where = { status: 'completed', ...khoangNgay(ts.tu, ts.den) }
    const tong = await sp.importReceipt.count({ where })
    const phieu = await sp.importReceipt.findMany({
        where,
        include: { items: { include: { product: { select: { id: true, sku: true, name: true, baseUnit: true, productType: true } } } } },
        orderBy: { createdAt: 'asc' },
        take: TRAN_CHUNG_TU,
    })
    const nccIds = [...new Set<string>(phieu.map((p: any) => p.supplierId).filter(Boolean))]
    const nccs = nccIds.length
        ? await sp.supplier.findMany({ where: { id: { in: nccIds } }, select: { id: true, code: true, name: true, address: true, taxCode: true } })
        : []
    const nccTheoId = new Map<string, any>(nccs.map((n: any) => [n.id, n]))
    const maNccQuaMap = await maMisaQuaMap(sp, 'supplier', nccIds, dm.doiTuongTheoId)
    const maHangQuaMap = await maMisaQuaMap(sp, 'product',
        [...new Set<string>(phieu.flatMap((p: any) => p.items.map((i: any) => i.productId)))], dm.vatTuTheoId)
    const lanTruoc = await docLanTruoc(sp, 'muahang', phieu.map((p: any) => p.id))
    const chung = thieuChung(caiDat, dm)
    const canhBaoChung: string[] = []
    if (!caiDat.purchasePurposeId) {
        canhBaoChung.push('Chưa đặt purchase_purpose_id (nhóm HHDV mua vào) — tài liệu MISA đánh dấu bắt buộc; nếu MISA báo lỗi thiếu trường này thì lấy mã trong MISA rồi điền ở Thiết lập.')
    }
    const kho = dm.kho.find(k => caiDat.maKho && khoaMa(k.ma) === khoaMa(caiDat.maKho))
    const dong: DongKeHoach[] = []

    for (const p of phieu) {
        const ngay = p.transactionDate || p.createdAt
        const ncc = p.supplierId ? nccTheoId.get(p.supplierId) : null
        const d: DongKeHoach = {
            localId: p.id, refNo: p.code, ngay: ngayVN(ngay),
            doiTuong: ncc?.name || p.supplierName || '(không ghi NCC)',
            soTien: 0, trangThai: 'san_sang', lyDo: [], canhBao: [], lanTruoc: null,
            orgRefid: guidTatDinh(ts.schema, 'muahang', p.id),
        }
        dong.push(d)
        if (String(p.code || '').startsWith('MISA-')) {
            d.trangThai = 'bo_qua'
            d.lyDo.push('Phiếu nhập đổ từ sổ MISA về — đẩy ngược lên là nhân đôi sổ')
            continue
        }
        if (chung.length) d.lyDo.push(...chung)

        const maNcc = ncc ? (maNccQuaMap.get(ncc.id) || ncc.code) : caiDat.maNccMacDinh
        if (!maNcc) d.lyDo.push('Phiếu không gắn NCC và chưa đặt "NCC mặc định" MISA')
        const dtMisa = maNcc ? dm.doiTuongTheoMa.get(khoaMa(maNcc)) : undefined
        if (maNcc && !dtMisa) d.lyDo.push(`NCC "${maNcc}" chưa có trên MISA — đẩy "Khách hàng & NCC" trước`)

        const items = (p.items || []).filter((i: any) => Number(i.quantity) !== 0 || Number(i.total) !== 0)
        if (!items.length) d.lyDo.push('Phiếu không có dòng hàng')
        if (items.length > MAX_DONG_CHUNG_TU) d.lyDo.push(`Phiếu ${items.length} dòng — MISA nhận tối đa ${MAX_DONG_CHUNG_TU} dòng/chứng từ`)
        const thieuMa: string[] = []
        const maHang = items.map((it: any) => {
            const ma = maHangQuaMap.get(it.productId) || it.product?.sku || it.productSku
            if (!dm.vatTuTheoMa.has(khoaMa(String(ma || '')))) thieuMa.push(String(ma || '(trống)'))
            return String(ma || '')
        })
        if (thieuMa.length) {
            const ds = [...new Set(thieuMa)]
            d.lyDo.push(`${ds.length} mã hàng chưa có trên MISA: ${ds.slice(0, 5).join(', ')}${ds.length > 5 ? '…' : ''} — đẩy "Vật tư" trước`)
        }
        if (d.lyDo.length) d.trangThai = 'thieu'

        const phi = (Number(p.shippingFee) || 0) + (Number(p.importTax) || 0) + (Number(p.otherFees) || 0)
        if (phi > 0) d.canhBao.push(`Phí vận chuyển/thuế NK/phí khác ${lam(phi).toLocaleString('vi-VN')}đ CHƯA đưa vào chứng từ — kế toán phân bổ chi phí mua hàng trong MISA`)
        if (p.paymentStatus === 'paid' || (Number(p.paidAmount) || 0) > 0) {
            d.canhBao.push(`Đã trả NCC ${lam(Number(p.paidAmount) || 0).toLocaleString('vi-VN')}đ — chứng từ ghi MUA CHƯA THANH TOÁN (Có ${caiDat.tk.phaiTra}); phiếu chi lập bên MISA`)
        }

        const giamPhieu = lam(Number(p.totalDiscount) || 0)
        const thue = lam(Number(p.vatAmount) || 0)
        const giamDong = chiaTheoTyLe(giamPhieu, items.map((i: any) => Number(i.total) || 0))
        const thueDong = chiaTheoTyLe(thue, items.map((i: any, k: number) => (Number(i.total) || 0) - giamDong[k]))
        let tienHang = 0, tienGiam = 0
        const detail = items.map((it: any, k: number) => {
            const sl = Number(it.quantity) || 0
            const gia = Number(it.costPrice) || 0
            const thanhTienDong = Number(it.total) || 0
            const goc = Math.max(lam(sl * gia), lam(thanhTienDong))
            const giam = Math.max(0, goc - lam(thanhTienDong)) + giamDong[k]
            tienHang += goc
            tienGiam += giam
            const dvt = it.product?.baseUnit || 'Cái'
            const tsDong = thueSuat(thueDong[k], goc - giam)
            return {
                sort_order: k + 1,
                inventory_item_code: maHang[k],
                inventory_item_name: it.productName || it.product?.name || maHang[k],
                description: it.productName || it.product?.name || maHang[k],
                inventory_item_type: it.product?.productType === 'service' ? 2 : 0,
                ...(caiDat.purchasePurposeId ? { purchase_purpose_id: caiDat.purchasePurposeId } : {}),
                stock_code: caiDat.maKho, stock_name: kho?.ten || caiDat.tenKho || caiDat.maKho,
                debit_account: caiDat.tk.kho, credit_account: caiDat.tk.phaiTra,
                unit_name: dvt, main_unit_name: dvt, main_convert_rate: 1,
                quantity: sl, main_quantity: sl,
                unit_price: gia,
                amount_oc: goc, amount: goc,
                discount_rate: goc > 0 ? Math.round(giam * 10000 / goc) / 100 : 0,
                discount_amount_oc: giam, discount_amount: giam,
                ...(tsDong.vat_rate !== undefined ? { vat_rate: tsDong.vat_rate } : {}),
                ...(tsDong.other_vat_rate !== undefined ? { other_vat_rate: tsDong.other_vat_rate } : {}),
                vat_amount_oc: thueDong[k], vat_amount: thueDong[k],
                vat_account: thue ? caiDat.tk.thueVao : undefined,
                inventory_resale_type_id: 0,
                exchange_rate_operator: '*',
            }
        })
        const tongTT = tienHang - tienGiam + thue
        d.soTien = tongTT
        const tongKengi = lam(Number(p.totalCost) || 0)
        // totalCost có thể gồm hoặc không gồm thuế tuỳ luồng tạo phiếu — so cả hai mốc
        if (Math.abs(tongTT - tongKengi) > 1 && Math.abs(tongTT - thue - tongKengi) > 1 && Math.abs(tongTT + phi - tongKengi) > 1) {
            d.canhBao.push(`Tổng dựng lại ${tongTT.toLocaleString('vi-VN')}đ không khớp tổng phiếu Kengi ${tongKengi.toLocaleString('vi-VN')}đ`)
        }
        const thoiDiem = ngayVN(ngay)
        d.payload = {
            voucher_type: 18,
            org_refid: d.orgRefid,
            org_refno: p.code,
            org_reftype_name: 'Phiếu nhập hàng Kengi',
            reftype: 302,   // mua trong nước nhập kho CHƯA THANH TOÁN
            branch_id: caiDat.branchId,
            account_object_code: maNcc || undefined,
            account_object_name: dtMisa?.ten || d.doiTuong,
            account_object_address: ncc?.address || undefined,
            currency_id: 'VND', exchange_rate: 1,
            discount_type: tienGiam > 0 ? 1 : 0,
            include_invoice: 0,
            ...(caiDat.purchasePurposeId ? { purchase_purpose_id: caiDat.purchasePurposeId } : {}),
            journal_memo: `Mua hàng ${p.code}${d.doiTuong ? ' - ' + d.doiTuong : ''}${p.vatInvoiceNo ? ` (HĐ ${p.vatInvoiceNo})` : ''}`.slice(0, 250),
            posted_date: thoiDiem, refdate: thoiDiem, in_reforder: thoiDiem,
            ...(p.dueDate ? { due_date: ngayVN(p.dueDate) } : {}),
            total_sale_amount_oc: tienHang, total_sale_amount: tienHang,
            total_discount_amount_oc: tienGiam, total_discount_amount: tienGiam,
            total_vat_amount_oc: thue, total_vat_amount: thue,
            total_amount_oc: tongTT, total_amount: tongTT,
            detail,
        }
    }
    return tongKet('muahang', dong.map(d => { apLanTruoc(d, lanTruoc.get(d.localId)); return d }), tong, TRAN_CHUNG_TU, canhBaoChung)
}

// ── Danh mục vật tư (dictionary_type 3) ─────────────────────────────────────

async function idSanPhamTrongKy(sp: any, tu: Date, den: Date): Promise<string[]> {
    const ban: any[] = await sp.$queryRawUnsafe(
        `SELECT DISTINCT ti."productId" AS id FROM "TransactionItem" ti
           JOIN "Transaction" t ON t."id" = ti."transactionId"
          WHERE t."status" IN ('completed','partial')
            AND COALESCE(t."transactionDate", t."createdAt") BETWEEN $1 AND $2`, tu, den)
    const mua: any[] = await sp.$queryRawUnsafe(
        `SELECT DISTINCT ii."productId" AS id FROM "ImportReceiptItem" ii
           JOIN "ImportReceipt" r ON r."id" = ii."receiptId"
          WHERE r."status" = 'completed'
            AND COALESCE(r."transactionDate", r."createdAt") BETWEEN $1 AND $2`, tu, den)
    return [...new Set([...ban, ...mua].map(r => String(r.id)))]
}

async function keHoachVatTu(sp: any, caiDat: CaiDatDay, dm: DanhMucMisa, ts: ThamSoKeHoach): Promise<KetQuaKeHoach> {
    const phamVi = ts.phamVi || 'trong_ky'
    let where: any = {}
    if (phamVi === 'trong_ky') where = { id: { in: await idSanPhamTrongKy(sp, ts.tu, ts.den) } }
    const tong = await sp.product.count({ where })
    const sps = await sp.product.findMany({
        where,
        select: { id: true, sku: true, name: true, baseUnit: true, productType: true, costPrice: true, sellingPrice: true, mergedIntoId: true },
        orderBy: { sku: 'asc' },
        take: TRAN_DANH_MUC,
    })
    const maQuaMap = await maMisaQuaMap(sp, 'product', sps.map((s: any) => s.id), dm.vatTuTheoId)
    const lanTruoc = await docLanTruoc(sp, 'vattu', sps.map((s: any) => s.id))
    const canhBaoChung = [...dm.canhBao]
    if (!caiDat.branchId) canhBaoChung.push('Chưa chọn chi nhánh MISA — danh mục cần branch_id')
    const daThay = new Set<string>()
    const dong: DongKeHoach[] = []

    for (const s of sps) {
        const ma = String(maQuaMap.get(s.id) || s.sku || '').trim()
        const d: DongKeHoach = {
            localId: s.id, refNo: ma, ngay: null, doiTuong: s.name,
            soTien: Number(s.sellingPrice) || 0, trangThai: 'san_sang', lyDo: [], canhBao: [], lanTruoc: null,
            orgRefid: guidTatDinh(ts.schema, 'vattu', s.id),
        }
        dong.push(d)
        if (s.mergedIntoId) { d.trangThai = 'bo_qua'; d.lyDo.push('Mã đã gộp vào mã khác bên Kengi'); continue }
        if (!ma) { d.trangThai = 'thieu'; d.lyDo.push('Sản phẩm không có mã (SKU)'); continue }
        const co = dm.vatTuTheoMa.get(khoaMa(ma))
        if (co) {
            d.trangThai = 'da_co'
            d.lyDo.push(`Đã có trên MISA${co.ten && co.ten !== s.name ? ` (tên MISA: ${co.ten})` : ''}`)
            if (co.dvt && s.baseUnit && co.dvt.toLowerCase() !== String(s.baseUnit).toLowerCase()) {
                d.canhBao.push(`ĐVT lệch: MISA "${co.dvt}" ≠ Kengi "${s.baseUnit}" — chứng từ gửi theo ĐVT Kengi, MISA có thể từ chối`)
            }
            continue
        }
        if (daThay.has(khoaMa(ma))) { d.trangThai = 'thieu'; d.lyDo.push(`Trùng mã "${ma}" với sản phẩm khác trong lượt này`); continue }
        daThay.add(khoaMa(ma))
        if (!caiDat.branchId) { d.trangThai = 'thieu'; d.lyDo.push('Chưa chọn chi nhánh MISA') }
        const dv = s.productType === 'service'
        d.payload = {
            dictionary_type: 3,
            inventory_item_id: d.orgRefid,
            inventory_item_code: ma,
            inventory_item_name: s.name,
            inventory_item_type: dv ? 2 : 0,
            description: s.name,
            branch_id: caiDat.branchId,
            inactive: false,
            unit_name: s.baseUnit || 'Cái',
            unit_price: lam(Number(s.costPrice) || 0),
            sale_price1: lam(Number(s.sellingPrice) || 0),
            ...(dv ? {} : { inventory_account: caiDat.tk.kho }),
            cogs_account: caiDat.tk.giaVon,
            sale_account: dv ? caiDat.tk.doanhThuDV : caiDat.tk.doanhThu,
            state: 1,
        }
    }
    return tongKet('vattu', dong.map(d => { apLanTruoc(d, lanTruoc.get(d.localId)); return d }), tong, TRAN_DANH_MUC, canhBaoChung)
}

// ── Danh mục đối tượng (dictionary_type 1) ──────────────────────────────────

async function keHoachDoiTuong(sp: any, caiDat: CaiDatDay, dm: DanhMucMisa, ts: ThamSoKeHoach): Promise<KetQuaKeHoach> {
    const phamVi = ts.phamVi || 'trong_ky'
    let whereKh: any = {}, whereNcc: any = {}
    if (phamVi === 'trong_ky') {
        const kh: any[] = await sp.$queryRawUnsafe(
            `SELECT DISTINCT "customerId" AS id FROM "Transaction"
              WHERE "customerId" IS NOT NULL AND "status" IN ('completed','partial')
                AND COALESCE("transactionDate","createdAt") BETWEEN $1 AND $2`, ts.tu, ts.den)
        const ncc: any[] = await sp.$queryRawUnsafe(
            `SELECT DISTINCT "supplierId" AS id FROM "ImportReceipt"
              WHERE "supplierId" IS NOT NULL AND "status" = 'completed'
                AND COALESCE("transactionDate","createdAt") BETWEEN $1 AND $2`, ts.tu, ts.den)
        whereKh = { id: { in: kh.map(r => String(r.id)) } }
        whereNcc = { id: { in: ncc.map(r => String(r.id)) } }
    }
    const tong = (await sp.customer.count({ where: whereKh })) + (await sp.supplier.count({ where: whereNcc }))
    const khs = await sp.customer.findMany({
        where: whereKh,
        select: {
            id: true, code: true, name: true, address: true, taxCode: true,
            invoiceType: true, invoiceCompanyName: true, invoiceAddress: true,
        },
        orderBy: { code: 'asc' }, take: TRAN_DANH_MUC,
    })
    const nccs = await sp.supplier.findMany({
        where: whereNcc,
        select: { id: true, code: true, name: true, address: true, taxCode: true },
        orderBy: { code: 'asc' }, take: Math.max(0, TRAN_DANH_MUC - khs.length),
    })
    const maKh = await maMisaQuaMap(sp, 'customer', khs.map((k: any) => k.id), dm.doiTuongTheoId)
    const maNcc = await maMisaQuaMap(sp, 'supplier', nccs.map((n: any) => n.id), dm.doiTuongTheoId)
    const ds = [
        ...khs.map((k: any) => ({ ...k, laKhach: true, localId: `kh:${k.id}`, ma: maKh.get(k.id) || k.code })),
        ...nccs.map((n: any) => ({ ...n, laKhach: false, localId: `ncc:${n.id}`, ma: maNcc.get(n.id) || n.code })),
    ]
    const lanTruoc = await docLanTruoc(sp, 'doituong', ds.map(x => x.localId))
    const canhBaoChung = [...dm.canhBao]
    if (!caiDat.branchId) canhBaoChung.push('Chưa chọn chi nhánh MISA — danh mục cần branch_id')
    const daThay = new Map<string, string>()
    const dong: DongKeHoach[] = []

    for (const x of ds) {
        const ma = String(x.ma || '').trim()
        const laToChuc = x.laKhach
            ? (x.invoiceType === 'company' || (!x.invoiceType && /^\d{10}(-\d{3})?$/.test(String(x.taxCode || ''))))
            : true
        const ten = x.laKhach && x.invoiceType === 'company' && x.invoiceCompanyName ? x.invoiceCompanyName : x.name
        const d: DongKeHoach = {
            localId: x.localId, refNo: ma, ngay: null,
            doiTuong: `${x.laKhach ? 'Khách' : 'NCC'} · ${ten}`,
            soTien: 0, trangThai: 'san_sang', lyDo: [], canhBao: [], lanTruoc: null,
            orgRefid: guidTatDinh(ts.schema, 'doituong', x.localId),
        }
        dong.push(d)
        if (!ma) { d.trangThai = 'thieu'; d.lyDo.push('Không có mã'); continue }
        const co = dm.doiTuongTheoMa.get(khoaMa(ma))
        if (co) {
            d.trangThai = 'da_co'
            d.lyDo.push(`Đã có trên MISA${co.ten ? ` (${co.ten})` : ''}`)
            if (x.laKhach && !co.laKhach) d.canhBao.push('Bên MISA mã này KHÔNG đánh dấu là khách hàng')
            if (!x.laKhach && !co.laNcc) d.canhBao.push('Bên MISA mã này KHÔNG đánh dấu là nhà cung cấp')
            continue
        }
        const truoc = daThay.get(khoaMa(ma))
        if (truoc) { d.trangThai = 'thieu'; d.lyDo.push(`Trùng mã "${ma}" với ${truoc} — MISA gộp khách & NCC chung một danh mục, phải đổi mã một bên`); continue }
        daThay.set(khoaMa(ma), d.doiTuong)
        if (!caiDat.branchId) { d.trangThai = 'thieu'; d.lyDo.push('Chưa chọn chi nhánh MISA') }
        d.payload = {
            dictionary_type: 1,
            account_object_id: d.orgRefid,
            account_object_code: ma,
            account_object_name: ten,
            account_object_type: laToChuc ? 0 : 1,
            is_customer: x.laKhach,
            is_vendor: !x.laKhach,
            is_employee: false,
            inactive: false,
            address: (x.laKhach ? (x.invoiceAddress || x.address) : x.address) || '',
            company_tax_code: x.taxCode || '',
            branch_id: caiDat.branchId,
            state: 1,
        }
    }
    return tongKet('doituong', dong.map(d => { apLanTruoc(d, lanTruoc.get(d.localId)); return d }), tong, TRAN_DANH_MUC, canhBaoChung)
}

// ─── Gửi ────────────────────────────────────────────────────────────────────

export interface KetQuaGui {
    daGui: number
    loi: Array<{ refNo: string; loi: string }>
    /** localId đã xử lý ở lượt này (gửi được + bị từ chối) — lượt sau không gửi lại */
    xuLy: string[]
}

const CO_LO: Record<LoaiDay, number> = { vattu: 50, doituong: 50, banhang: 10, muahang: 10 }

async function ghiSo(sp: any, loai: LoaiDay, d: DongKeHoach, trangThai: string, loi: string | null) {
    const data = {
        refNo: d.refNo, orgRefid: d.orgRefid, voucherType: MA_LOAI_MISA[loai],
        ngay: d.ngay ? new Date(d.ngay.replace(' ', 'T') + '+07:00') : null,
        soTien: d.soTien, trangThai, loi: loi ? loi.slice(0, 2000) : null,
        payload: d.payload ? JSON.stringify(d.payload).slice(0, 30000) : null,
        guiLuc: new Date(), ketQuaLuc: null,
    }
    await sp.misaPushItem.upsert({
        where: { loai_localId: { loai, localId: d.localId } },
        create: { loai, localId: d.localId, ...data },
        update: { ...data, lanGui: { increment: 1 } },
    })
}

const loiChu = (e: any) => {
    if (e instanceof MisaError || e?.name === 'MisaError') {
        return `${e.message}${e.body && !String(e.message).includes(String(e.body).slice(0, 40)) ? ` — ${String(e.body).slice(0, 300)}` : ''}`
    }
    return String(e?.message || e)
}

/**
 * Gửi các dòng "sẵn sàng" theo lô. Lô bị MISA từ chối ⇒ gửi lại TỪNG CÁI một để
 * chỉ đúng bản ghi hỏng, không bắt cả lô chịu chung một câu lỗi mơ hồ.
 * Ghi sổ MisaPushItem ngay sau mỗi lô — gãy giữa chừng vẫn giữ phần đã gửi.
 */
export async function guiDi(sp: any, creds: MisaCreds, loai: LoaiDay, dong: DongKeHoach[]): Promise<KetQuaGui> {
    const kq: KetQuaGui = { daGui: 0, loi: [], xuLy: [] }
    const lo = CO_LO[loai]
    const goi = (ds: DongKeHoach[]) => LA_CHUNG_TU[loai]
        ? MISA.save(creds, ds.map(d => d.payload))
        : MISA.saveDictionary(creds, ds.map(d => d.payload))

    for (let i = 0; i < dong.length; i += lo) {
        const nhom = dong.slice(i, i + lo)
        try {
            await goi(nhom)
            for (const d of nhom) { await ghiSo(sp, loai, d, 'da_gui', null); kq.xuLy.push(d.localId) }
            kq.daGui += nhom.length
        } catch (e: any) {
            // Lỗi MẠNG/token thì gửi lẻ cũng chết — dừng hẳn, nói nguyên văn
            if (!(e instanceof MisaError) || !e.status) throw e
            if (nhom.length === 1) {
                await ghiSo(sp, loai, nhom[0], 'loi_gui', loiChu(e))
                kq.loi.push({ refNo: nhom[0].refNo, loi: loiChu(e) })
                kq.xuLy.push(nhom[0].localId)
                continue
            }
            for (const d of nhom) {
                try {
                    await goi([d])
                    await ghiSo(sp, loai, d, 'da_gui', null)
                    kq.daGui++
                    kq.xuLy.push(d.localId)
                } catch (e2: any) {
                    if (!(e2 instanceof MisaError) || !e2.status) throw e2
                    await ghiSo(sp, loai, d, 'loi_gui', loiChu(e2))
                    kq.loi.push({ refNo: d.refNo, loi: loiChu(e2) })
                    kq.xuLy.push(d.localId)
                }
            }
        }
    }
    return kq
}

// ─── Kết quả xử lý bất đồng bộ ──────────────────────────────────────────────

const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Câu lỗi trong một dòng kết quả — tài liệu không nêu tên trường nên dò nhiều tên. */
function cauLoi(row: any): string {
    for (const k of ['ErrorMessage', 'error_message', 'errorMessage', 'Message', 'message', 'error', 'Error', 'description', 'Description', 'ErrorDetail', 'error_detail']) {
        const v = row?.[k]
        if (v && typeof v === 'string') return v
        if (v && typeof v === 'object') return JSON.stringify(v).slice(0, 600)
    }
    return JSON.stringify(row).slice(0, 600)
}

const laThanhCong = (row: any) =>
    row?.Success === true || row?.success === true || row?.is_success === true || row?.IsSuccess === true

/**
 * Hỏi MISA kết quả xử lý trong khoảng ngày rồi khớp về sổ MisaPushItem bằng
 * org_refid (dò mọi GUID trong dòng — không đoán tên trường). Dòng không khớp
 * vẫn trả về nguyên văn để người vận hành đọc.
 */
export async function hoiKetQua(sp: any, creds: MisaCreds, tuNgay: string, denNgay: string) {
    const tatCa: any[] = []
    let custom: any = null
    for (let trang = 0; trang < 20; trang++) {
        const r = await MISA.ketQuaXuLy(creds, tuNgay, denNgay, trang * 100, 100)
        custom = r.custom ?? custom
        tatCa.push(...r.items)
        if (r.items.length < 100) break
    }
    const ids = new Set<string>()
    const theoDong = tatCa.map(row => {
        const s = JSON.stringify(row)
        const g = [...new Set((s.match(GUID_RE) || []).map(x => x.toLowerCase()))]
        g.forEach(x => ids.add(x))
        return { row, guid: g }
    })
    const so = ids.size
        ? await sp.misaPushItem.findMany({ where: { orgRefid: { in: [...ids] } }, select: { id: true, orgRefid: true, refNo: true, loai: true } })
        : []
    const theoGuid = new Map<string, any>(so.map((x: any) => [x.orgRefid.toLowerCase(), x]))
    let baoLoi = 0, thanhCong = 0
    const dong: any[] = []
    for (const { row, guid } of theoDong) {
        const khop = guid.map(g => theoGuid.get(g)).find(Boolean)
        const ok = laThanhCong(row)
        if (khop) {
            await sp.misaPushItem.update({
                where: { id: khop.id },
                data: ok
                    ? { trangThai: 'misa_ok', loi: null, ketQuaLuc: new Date() }
                    : { trangThai: 'misa_bao_loi', loi: cauLoi(row).slice(0, 2000), ketQuaLuc: new Date() },
            })
            ok ? thanhCong++ : baoLoi++
        }
        dong.push({ khop: khop ? `${NHAN_LOAI_DAY[khop.loai as LoaiDay] || khop.loai} ${khop.refNo || ''}` : null, thanhCong: ok, loi: ok ? null : cauLoi(row), tho: row })
    }
    return { tongDong: tatCa.length, khop: baoLoi + thanhCong, baoLoi, thanhCong, custom, dong: dong.slice(0, 200) }
}
