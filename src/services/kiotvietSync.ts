/**
 * ĐỒNG BỘ DỮ LIỆU KIOTVIET → KENGI (2026-08-05)
 *
 * NGUYÊN TẮC AN TOÀN (đây là dữ liệu sản xuất, đọc hết trước khi sửa):
 *
 *  1. MẶC ĐỊNH CHẠY THỬ. Không truyền `apply: true` thì chỉ đếm và liệt kê,
 *     không ghi một dòng nào. Giống hệt /admin/adjust-stock.
 *
 *  2. KHÔNG GHI ĐÈ dữ liệu Kengi trừ khi người dùng bật cờ tương ứng
 *     (overwriteNames/Prices/Stock). Mặc định chỉ TẠO MỚI và ĐIỀN CHỖ TRỐNG.
 *     Lý do: cửa hàng đã sửa giá/tên trên Kengi thì một lần đồng bộ không được
 *     phép nuốt mất công sức đó.
 *
 *  3. CHỐNG TRÙNG bằng bảng KiotVietMap (kvId ↔ localId) + khoá nghiệp vụ
 *     (sku/code/receiptNumber). Chạy lại đợt đồng bộ cũ phải ra "cập nhật",
 *     KHÔNG được đẻ thêm bản ghi.
 *
 *  4. BẤT BIẾN TỒN KHO: Product.stock phải bằng tổng WarehouseStock của các kho
 *     `main`. Mọi thay đổi tồn đều ghi CẢ HAI nơi trong một transaction, kèm
 *     một dòng InventoryTransaction để còn truy vết được ai/khi nào/tại sao.
 *
 *  5. HOÁ ĐƠN KHÔNG TRỪ KHO. Tồn lấy từ `onHand` của KiotViet vốn ĐÃ trừ các
 *     hoá đơn đó rồi; trừ thêm lần nữa là âm kho khống. Hoá đơn nhập vào chỉ để
 *     có lịch sử doanh thu.
 */

import crypto from 'crypto'
import { createJournalEntriesForTransaction } from '../lib/autoJournal'
import { postImportReceiptJournal, postReturnJournal, postExpenseJournal } from '../lib/autoJournalPurchase'
import { thuGhiSo, coKhauTruVat } from '../lib/ghiSoDongBo'
import { KV } from './kiotviet'
import { tongPhieuChuaTraTheoNcc, soDuDauKyTuKV } from '../lib/congNoNcc'

export interface SyncCounters {
    fetched: number
    created: number
    updated: number
    skipped: number
    failed: number
    errors: string[]
    samples: any[]
}

export function newCounters(): SyncCounters {
    return { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [], samples: [] }
}

function noteError(c: SyncCounters, msg: string) {
    c.failed++
    if (c.errors.length < 20) c.errors.push(msg.slice(0, 200))
}

function noteSample(c: SyncCounters, s: any) {
    if (c.samples.length < 10) c.samples.push(s)
}

/**
 * Bỏ qua CÓ GHI LÝ DO. Bỏ qua im lặng làm nhật ký chỉ còn con số "bỏ qua 1",
 * không ai lần ra được vì sao webhook hoá đơn về mà không lưu (dính 08/08/2026).
 */
function boQua(c: SyncCounters, lyDo: string) {
    c.skipped++
    if (c.errors.length < 20) c.errors.push(`bỏ qua — ${lyDo}`.slice(0, 200))
}

/**
 * Dựng dòng hàng Kengi từ `invoiceDetails` của KiotViet — dùng chung cho cả
 * nhánh tạo mới lẫn nhánh dựng lại (rebuildLines), để hai đường không bao giờ
 * lệch quy ước nhau.
 *
 * GIẢM GIÁ: KiotViet tính theo MỖI ĐƠN VỊ, Kengi theo CẢ DÒNG.
 *
 * Bê thẳng con số qua là hoá đơn không cộng ra tổng. Đo trên HĐ HD030345
 * (11/08/2026): KiotViet ghi giảm 35.333 cho mã BS1112TV — đúng 39,7% của đơn
 * giá 89.000, tức mỗi cái. Kengi lưu y số đó rồi hiểu là giảm cho cả 20 cái,
 * nên dòng thành 1.744.667 thay vì 1.073.340. Ba dòng cộng lại 4.510.104
 * trong khi tổng phiếu vẫn là 2.817.040 lấy từ kv.total — lệch 1,7 triệu.
 *
 * `subTotal` mới là số tiền dòng có thẩm quyền bên KiotViet nên suy ngược
 * giảm giá từ nó: đúng dù họ có đổi quy ước. Không có subTotal thì mới nhân
 * số giảm mỗi đơn vị với số lượng.
 */
async function dungDongHoaDon(sp: any, kv: any): Promise<{ lines: any[]; missing: string[] }> {
    const details: any[] = Array.isArray(kv?.invoiceDetails) ? kv.invoiceDetails : []
    const lines: any[] = []
    const missing: string[] = []
    for (const d of details) {
        const sku = String(d?.productCode || '').trim()
        if (!sku) continue
        const p = await sp.product.findUnique({
            where: { sku }, select: { id: true, name: true, sku: true },
        }).catch(() => null)
        if (!p) { missing.push(sku); continue }
        const qty = Math.round(Number(d?.quantity) || 0)
        const unitPrice = Number(d?.price) || 0
        const giamMoiCai = Number(d?.discount) || 0
        const gop = qty * unitPrice
        const sub = Number(d?.subTotal)
        const disc = Number.isFinite(sub) && sub > 0
            ? Math.min(gop, Math.max(0, gop - sub))
            : Math.min(gop, giamMoiCai * qty)
        lines.push({
            productId: p.id, productName: p.name, sku: p.sku,
            quantity: qty, unitPrice, discount: disc,
            // Luôn cho khớp với discount ở trên, đừng lấy subTotal thô:
            // hai số lệch nhau là giao diện lại hiện một đằng, tổng một nẻo
            lineTotal: gop - disc,
        })
    }
    return { lines, missing }
}

export interface SyncOptions {
    apply: boolean
    overwriteNames?: boolean
    overwritePrices?: boolean
    overwriteStock?: boolean
    /**
     * DỰNG LẠI DÒNG HÀNG của hoá đơn ĐÃ CÓ trong sổ.
     *
     * Công tắc riêng vì đây là ghi đè phá huỷ: xoá sạch dòng cũ rồi tạo lại
     * theo KiotViet. Mặc định TẮT — nhánh cập nhật chỉ đụng thanh toán.
     *
     * Có nó vì trước đây nhánh cập nhật `continue` trước khi tới đoạn dựng
     * dòng, nên hoá đơn nào nhập thiếu dòng thì đồng bộ lại bao nhiêu lần cũng
     * đứng yên vĩnh viễn (đo 11/08/2026: 1.392 phiếu ở HUTI có dòng hàng
     * không cộng ra tổng, ví dụ HD030283 tổng 3.957.860 mà dòng chỉ 480.000).
     */
    rebuildLines?: boolean
    /**
     * CHỈ CẬP NHẬT phiếu đã có, không tạo mới.
     *
     * Dùng khi quét lát ngày cũ để sửa phiếu hỏng: vùng 2024–2025 có hàng
     * nghìn hoá đơn KiotViet chưa từng nhập vào Kengi — không có cờ này thì
     * lát quét "đi sửa 35 phiếu" sẽ tiện tay ĐẺ THÊM cả nghìn phiếu cũ, đúng
     * vụ mở rộng phạm vi 9.012 phiếu đang treo quyết định (11/08/2026).
     */
    updateOnly?: boolean
    defaultCategoryId?: string | null
    defaultWarehouseId?: string | null
    branchIds?: number[]
    /** Người tạo cho bản ghi nhập từ KiotViet (bắt buộc với hoá đơn) */
    systemUserId?: string | null
    /**
     * NHỊP TIM. Gọi sau mỗi vài bản ghi để đóng dấu "còn sống" vào nhật ký.
     * Không có nó thì đợt chạy nền chết giữa chừng vẫn hiện "đang chạy" mãi mãi
     * và người dùng không biết nên chờ hay bấm lại (dính 06/08/2026).
     * Bên gọi tự giới hạn tần suất ghi DB.
     */
    onProgress?: (c: SyncCounters) => void
    /**
     * Mã phiếu thu ĐÃ tính vào hoá đơn trong CHÍNH lượt chạy này.
     * Bảng map chỉ được ghi khi chạy thật, nên chạy thử cần chỗ nhớ tạm — thiếu
     * nó thì số liệu chạy thử lệch hẳn với chạy thật ở phần sổ quỹ.
     */
    invoicePaymentCodes?: Set<string>
    /**
     * Khách được TẠO MỚI trong chính lượt chạy này, với debt seed = số dư
     * KiotViet. Số dư đó ĐÃ GỒM các hoá đơn nợ sắp nhập ngay sau trong cùng
     * lượt — bước hoá đơn mà cộng nợ cho họ nữa là ĐẾM ĐÔI. Bước hoá đơn phải
     * tra tập này và bỏ qua phần cộng nợ cho khách vừa seed.
     */
    seededCustomerIds?: Set<string>
    /** Creds KiotViet — để hỏi lại số dư khách ngay khi chứng từ đụng tới họ */
    creds?: any
    /** Khách đã làm tươi trong lượt này — khỏi hỏi KV trùng */
    daTuoiNo?: Set<string>
    /**
     * GẮN THẺ KHO CHO PHIẾU NHẬP (25/08/2026) — hai mốc thời gian, cả hai do
     * runner đặt trước khi chạy các pha:
     *
     * `mocBatDauDot` — thời điểm bắt đầu CHÍNH đợt này. Pha tồn kho (products)
     * chạy TRƯỚC pha phiếu nhập, nên phần tồn của phiếu mới đã bị hấp thụ vào
     * một dòng `adjustment` VÔ DANH sinh sau mốc này. Pha phiếu nhập sẽ TÁCH
     * NHÃN dòng đó: đẻ dòng `import` mang mã phiếu + để phần dư lại — tổng theo
     * dấu không đổi một li, tồn kho không bị đụng, thẻ kho thì kể được sự thật
     * "Nhập kho theo phiếu PN00xxxx" thay vì một con số không tên.
     *
     * `mocPhienTruocProducts` — mốc của lượt đồng bộ tồn GẦN NHẤT TRƯỚC đợt này.
     * Phiếu có ngày chứng từ TRƯỚC mốc đó đã bị lượt trước hấp thụ rồi; gắn nữa
     * là ăn gian dòng của đợt này (đẻ ra một cặp +/− bịa). Backfill nhiều tháng
     * phiếu cũ vì thế tự động bị loại — đúng như phải thế.
     */
    mocBatDauDot?: Date
    mocPhienTruocProducts?: Date | null
    /**
     * Bản ghi đến từ WEBHOOK — payload customer/supplier.update của KiotViet KHÔNG mang
     * Debt (18/08/2026). Bật cờ này là KHÔNG BAO GIỜ lấy công nợ từ payload (kể cả khi
     * họ gửi `Debt: 0` cho có) — khách thì hỏi lại KV bằng lamTuoiNoKhach, NCC để cron
     * đối chiếu 24h. Đường REST (danh sách mang debt thật) không bật cờ.
     */
    tuWebhook?: boolean
}

/**
 * ĐỌC CÔNG NỢ TỪ MỘT BẢN GHI KIOTVIET — THIẾU ≠ 0.
 *
 * Trả về số khi bản ghi có `debt` hữu hạn; trả về null khi KHÔNG có (undefined/
 * null/không phải số). Bản cũ viết `Number(kv?.debt) || 0` — biến "không biết"
 * thành "0", và webhook customer.update/supplier.update của KiotViet KHÔNG mang
 * Debt, nên mỗi lần khách được sửa hồ sơ bên KV là Kengi ghi đè 0 lên nợ thật
 * (bắt quả tang 18/08/2026, HUTI: 7 khách về 0 đúng mili-giây webhook; gốc của
 * 39 khách / 857,7tr giấu nợ). Bên gọi: null → KHÔNG đụng debt/payable.
 */
export function docCongNoKV(kv: any): number | null {
    const raw = kv?.debt ?? kv?.data?.debt
    if (raw === undefined || raw === null || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
}

/** Đập nhịp mỗi 25 bản ghi — đủ dày để thấy tiến độ, đủ thưa để không nghẽn DB. */
function beat(opts: SyncOptions, c: SyncCounters) {
    if (opts.onProgress && c.fetched % 25 === 0) opts.onProgress(c)
}

/**
 * Lấy MỘT số điện thoại dùng được từ ô liên hệ của KiotViet.
 *
 * Ô đó là văn bản tự do, khách hay nhập 2 số: "02563 847 745 - 0903 596 729".
 * Bóc thô kiểu bỏ hết ký tự không phải số sẽ dán chúng lại thành chuỗi 21 chữ
 * số vô nghĩa, gọi không được mà đối chiếu trùng khách cũng hỏng (đo 06/08/2026).
 * Ở đây tách theo dấu phân cách rồi lấy số ĐẦU TIÊN có độ dài hợp lệ.
 */
export function firstPhone(raw: any): string {
    const s = String(raw || '').trim()
    if (!s) return ''
    const parts = s.split(/[^\d+]{2,}|[,;/|]|\s-\s|–|—/).map(p => p.replace(/[^\d+]/g, '')).filter(Boolean)
    for (const p of parts) {
        const digits = p.replace(/\D/g, '')
        if (digits.length >= 8 && digits.length <= 12) return p
    }
    // Không tách được: chỉ nhận khi cả chuỗi đã là một số hợp lệ, còn lại bỏ
    const all = s.replace(/[^\d+]/g, '')
    const d = all.replace(/\D/g, '')
    return d.length >= 8 && d.length <= 12 ? all : ''
}

// ─── Bản đồ id KiotViet ↔ id Kengi ──────────────────────────────────────────

async function findMap(sp: any, entity: string, kvId: string | number): Promise<string | null> {
    const row = await sp.kiotVietMap.findUnique({
        where: { entity_kvId: { entity, kvId: String(kvId) } },
        select: { localId: true },
    }).catch(() => null)
    return row?.localId || null
}

/**
 * LÀM TƯƠI SỐ DƯ MỘT KHÁCH TỪ KIOTVIET.
 *
 * Đây là cách duy nhất giữ Customer.debt đúng theo thời gian thực mà không
 * drift: chứng từ về (hoá đơn/thu nợ) thì hỏi thẳng KV "khách này giờ nợ
 * bao nhiêu" — KHÔNG tự cộng trừ (đã trả giá 12/08/2026: lịch sử Kengi
 * thiếu hoá đơn cũ nên cộng trừ theo chứng từ ăn dần công nợ về 0).
 * KV lỗi thì giữ số cũ, không đoán.
 */
/** Key KiotViet nào đã từng trả `debt` cho một khách trong tiến trình này — bằng chứng key có quyền xem
 *  công nợ. Có nó thì bản ghi khách BỎ TRỐNG debt được hiểu là 0 (KV bỏ khoá khi = 0, đo 18/08/2026), để
 *  khách trả hết không bị treo nợ cũ mãi; chưa có thì giữ số cũ (không đoán). */
const keyDaThayDebt = new Set<string>()

export async function lamTuoiNoKhach(sp: any, opts: SyncOptions, kvCustomerId: any) {
    const key = String(kvCustomerId || '')
    if (!key || !opts.creds || !opts.apply) return
    if (!opts.daTuoiNo) opts.daTuoiNo = new Set()
    if (opts.daTuoiNo.has(key)) return
    opts.daTuoiNo.add(key)
    try {
        /* Thử lại MỘT lần sau 600ms: KiotViet hay hụt một nhịp; hụt là khách kẹt số cũ
         * cho tới chứng từ kế tiếp — mà khách ít mua thì "kế tiếp" là hàng tuần. */
        let kvCus: any
        try { kvCus = await KV.customerById(opts.creds, key) }
        catch (e1) { await new Promise(r => setTimeout(r, 600)); kvCus = await KV.customerById(opts.creds, key) }
        let debt = docCongNoKV(kvCus)
        const keyId = String(opts.creds?.clientId || opts.creds?.retailer || '')
        if (debt !== null) keyDaThayDebt.add(keyId)
        const localId = await findMap(sp, 'customer', key)
        if (!localId) return
        if (debt === null && kvCus && typeof kvCus === 'object' && kvCus.id !== undefined && keyDaThayDebt.has(keyId)) {
            // Bản ghi khách thật, key có quyền thấy debt, mà bỏ trống ⇒ KV nói 0 (khách đã trả hết).
            // Bảo hiểm: nếu sổ Kengi đang ≠ 0 thì hỏi KV LẦN HAI — bỏ trống thoáng qua không được phép xoá nợ thật.
            const hienTai = await sp.customer.findUnique({ where: { id: localId }, select: { debt: true } }).catch(() => null)
            if (!hienTai) return   // đọc sổ hỏng ≠ sổ đang 0 — giữ nguyên, không ghi 0 (rà soát 19/08)
            if (Math.round(Number(hienTai.debt) || 0) !== 0) {
                await new Promise(r => setTimeout(r, 600))
                const kv2 = await KV.customerById(opts.creds, key).catch(() => null)
                const d2 = docCongNoKV(kv2)
                if (d2 !== null) debt = d2
                else if (kv2 && typeof kv2 === 'object' && kv2.id !== undefined) debt = 0   // hai lần đều trống → 0
                else return   // lần hai lỗi/không phải khách → giữ số cũ, không đoán
            } else debt = 0
        }
        if (debt === null) return   // KV bỏ trống mà chưa có bằng chứng key thấy debt = không biết, giữ số cũ
        /* KHÔNG nuốt lỗi ở lệnh GHI này (21/08/2026): `.catch(() => {})` cũ khiến `catch` bên dưới
         * KHÔNG BAO GIỜ chạy, tức là **chống lại đúng ý định ghi trong chú thích của chính nó**
         * ("giữ số cũ — nhưng PHẢI ĐỂ DẤU VẾT"). Ghi nợ hỏng thì lặng thinh, khách kẹt số cũ mà
         * không một dòng log — đúng ca Phúc Hải mô tả ngay dưới. Nay để ném, `catch` ghi cảnh báo. */
        await sp.customer.update({ where: { id: localId }, data: { debt } })
    } catch (e: any) {
        /* Giữ số cũ — nhưng PHẢI ĐỂ DẤU VẾT. Bản đầu nuốt im lặng: Phúc Hải (HUTI, HN73)
         * kẹt 0 trong khi KiotViet nói 220 triệu, không một dòng log nào để lần
         * (phát hiện 18/08/2026 nhờ hỏi thẳng KiotViet qua /admin/kiotviet-no-khach). */
        console.warn(`[KiotViet] làm tươi nợ khách kvId=${key} thất bại — giữ số cũ: ${String(e?.message || e).slice(0, 160)}`)
    }
}

/**
 * Hoá đơn đồng bộ về xong → TỰ GẮN phiếu sửa chữa ĐÃ XONG của đúng khách đó
 * (bán bên KiotViet là luồng chính của cửa hàng nối KV — khách lấy máy sửa
 * xong, nhân viên lên đơn bên KV, không đi qua POS Kengi; báo 13/08/2026).
 *
 * Chỉ khớp theo DẤU VẾT CHẮC: customerId đã nối hoặc SĐT trùng (so số trần).
 * KHÔNG so tên — đồng bộ chạy hàng loạt không có người nhìn, trùng tên là
 * gắn nhầm hồ sơ tiền nong. Các rào còn lại:
 *   - đơn cũ quá 7 ngày (re-import lịch sử) không gắn
 *   - phiếu xong SAU ngày đơn quá 1 ngày không gắn (không phải đơn trả máy này)
 *   - phiếu đổi-mới đang giữ kho (replacedStockAt) để luồng tay xử — tự flip
 *     'returned' ở đây sẽ nhảy cóc bước xuất kho máy mới
 * Ghi MỘT lần (transactionId đã có thì thôi), lỗi nuốt tại chỗ — gắn hụt
 * không được phá đợt đồng bộ.
 */
async function ganPhieuSuaChuaKhiSync(sp: any, opts: SyncOptions, localCustomerId: any, txId: string, code: string, ngayDon: Date) {
    if (!opts.apply || !localCustomerId || !txId) return
    try {
        const ngay = ngayDon && !isNaN(ngayDon.getTime()) ? ngayDon.getTime() : Date.now()
        if (Date.now() - ngay > 7 * 864e5) return
        const kh = await sp.customer.findUnique({ where: { id: String(localCustomerId) }, select: { phone: true } }).catch(() => null)
        const soDT = String(kh?.phone || '').replace(/\D/g, '')
        const phieux: any[] = await sp.repair.findMany({
            where: { status: 'done', transactionId: null, replacedStockAt: null },
            take: 50,
        }).catch(() => [])
        for (const p of phieux) {
            const khopId = p.customerId && String(p.customerId) === String(localCustomerId)
            const khopSDT = soDT.length >= 8 && String(p.customerPhone || '').replace(/\D/g, '') === soDT
            if (!khopId && !khopSDT) continue
            if (p.completedDate && new Date(p.completedDate).getTime() > ngay + 864e5) continue
            await sp.repair.update({
                where: { id: p.id },
                data: { status: 'returned', transactionId: txId, soldReceiptNumber: code },
            }).catch(() => { })
        }
    } catch { /* không phá đồng bộ */ }
}

async function saveMap(sp: any, entity: string, kvId: string | number, kvCode: string | null, localId: string) {
    await sp.kiotVietMap.upsert({
        where: { entity_kvId: { entity, kvId: String(kvId) } },
        create: { entity, kvId: String(kvId), kvCode: kvCode || null, localId, syncedAt: new Date() },
        update: { localId, kvCode: kvCode || null, syncedAt: new Date() },
    }).catch(() => { /* bảng map hỏng không được giết cả đợt đồng bộ */ })
}

// ─── Danh mục ───────────────────────────────────────────────────────────────

/**
 * Id giả dùng trong CHẠY THỬ khi nhóm hàng chưa tồn tại.
 *
 * Chạy thử không được tạo nhóm thật, nhưng cũng KHÔNG được báo lỗi: lần chạy
 * thật sẽ tạo nhóm đó và sản phẩm vào bình thường. Trước đây trả null ở đây làm
 * cửa hàng chưa có nhóm hàng nào bị báo lỗi 100% sản phẩm khi chạy thử — nhìn
 * như hỏng nặng trong khi thực ra chạy thật là chạy được (dính 06/08/2026).
 * Chỉ xuất hiện khi apply=false nên không bao giờ chạm tới DB.
 */
const DRYRUN_CATEGORY = '__CHAY_THU_SE_TAO_NHOM__'

/** Id của nhóm tạm "Chưa phân loại" (do luồng nhập liệu khác tạo). null nếu chưa có.
 *  Tra một lần rồi nhớ trong cache — vòng lặp hàng hoá chạy hàng nghìn lượt, pool prod = 1. */
async function idNhomTam(sp: any, cache: Map<string, string>): Promise<string | null> {
    const dem = '#nhomtam'
    if (cache.has(dem)) return cache.get(dem) || null
    const c = await sp.category
        .findFirst({ where: { name: { equals: 'Chưa phân loại', mode: 'insensitive' } }, select: { id: true } })
        .catch(() => null)
    cache.set(dem, c?.id || '')
    return c?.id || null
}

/**
 * Lấy/tạo Category cho một mặt hàng KiotViet. Có bộ nhớ đệm trong một đợt đồng bộ.
 *
 * THỨ TỰ TRA CÓ Ý NGHĨA — **mã KiotViet trước, TÊN sau**:
 *
 * KiotViet để danh mục **3 cấp**, mà bản trước chỉ đọc `categoryName` (một chuỗi phẳng) nên
 * cây bị ép về 1 cấp. Nay `dongBoCayDanhMuc()` dựng lại cây và ghi ánh xạ `KiotVietMap`
 * (`entity='category'`), nên tra theo **`categoryId`** là bám đúng nhánh lá — kể cả khi hai
 * nhánh khác nhau có cùng tên lá ("Bình 12kg" nằm dưới cả "Gas" lẫn "Vỏ bình" chẳng hạn).
 * Tra theo tên chỉ còn là đường lùi cho cửa hàng chưa chạy đồng bộ danh mục.
 */
async function resolveCategory(
    sp: any, name: string | undefined, fallbackId: string | null | undefined,
    cache: Map<string, string>, apply: boolean, kvCategoryId?: any,
): Promise<string | null> {
    // 1) Theo mã KiotViet — chắc chắn nhất, phân biệt được lá trùng tên khác nhánh
    const kvId = String(kvCategoryId ?? '').trim()
    if (kvId) {
        const dem = `#kv:${kvId}`
        if (cache.has(dem)) return cache.get(dem)!
        const anhXa = await sp.kiotVietMap.findUnique({
            where: { entity_kvId: { entity: 'category', kvId } },
            select: { localId: true },
        }).catch(() => null)
        if (anhXa?.localId) {
            const con = await sp.category.findUnique({ where: { id: anhXa.localId }, select: { id: true } }).catch(() => null)
            if (con) { cache.set(dem, con.id); return con.id }   // ánh xạ có thể trỏ danh mục đã xoá
        }
    }

    // 2) Đường lùi: theo tên (hành vi cũ, giữ nguyên cho cửa hàng chưa đồng bộ cây danh mục)
    const key = (name || '').trim() || 'Nhập từ KiotViet'
    if (cache.has(key)) return cache.get(key)!

    const found = await sp.category.findFirst({ where: { name: key }, select: { id: true } }).catch(() => null)
    if (found) { cache.set(key, found.id); return found.id }

    // Chưa có nhóm này: chạy thật thì tạo, chạy thử thì coi như sẽ tạo được
    if (!apply) return fallbackId || DRYRUN_CATEGORY

    const created = await sp.category.create({ data: { name: key, description: 'Đồng bộ từ KiotViet' } })
        .catch(() => null)
    if (created) { cache.set(key, created.id); return created.id }
    return fallbackId || null
}

/**
 * Lấy/tạo Thương hiệu theo `tradeMarkName` của KiotViet.
 *
 * KiotViet LƯỢC BỎ trường khi hàng không gắn thương hiệu, nên đừng kết luận
 * "API không trả" chỉ vì xem trúng vài mã trống. Product.brandId cho phép rỗng
 * nên không tìm thấy thì để trống — không phải lỗi.
 */
async function resolveBrand(
    sp: any, name: string | undefined, cache: Map<string, string | null>, apply: boolean,
): Promise<string | null> {
    const key = String(name || '').trim()
    if (!key) return null
    if (cache.has(key)) return cache.get(key)!

    const found = await sp.brand.findFirst({ where: { name: key }, select: { id: true } }).catch(() => null)
    if (found) { cache.set(key, found.id); return found.id }

    if (!apply) { cache.set(key, null); return null }   // chạy thử không tạo thật
    const created = await sp.brand.create({ data: { name: key, description: 'Đồng bộ từ KiotViet' } })
        .catch(() => null)
    cache.set(key, created?.id || null)
    return created?.id || null
}

// ─── HÀNG HOÁ ───────────────────────────────────────────────────────────────

/**
 * KiotViet `code` chính là SKU nghiệp vụ → ánh xạ thẳng sang Product.sku.
 * Thứ tự dò: bảng map (chắc nhất) → sku → barcode. Không tìm thấy thì tạo mới.
 */
export async function syncProducts(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    const catCache = new Map<string, string>()
    const brandCache = new Map<string, string | null>()

    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            const name = String(kv?.name || '').trim()
            if (!kvId || !code || !name) { c.skipped++; continue }

            // Dịch vụ / combo của KiotViet: productType 1=combo, 2=hàng thường, 3=dịch vụ
            const productType = Number(kv?.productType) === 3 ? 'service' : 'goods'

            let localId = await findMap(sp, 'product', kvId)
            let existing = localId
                ? await sp.product.findUnique({ where: { id: localId } }).catch(() => null)
                : null
            if (!existing) {
                existing = await sp.product.findUnique({ where: { sku: code } }).catch(() => null)
            }
            if (!existing && kv?.barCode) {
                existing = await sp.product.findFirst({ where: { barcode: String(kv.barCode) } }).catch(() => null)
            }

            // Tồn: cộng onHand của các chi nhánh được chọn (không chọn = cộng hết)
            const invs: any[] = Array.isArray(kv?.inventories) ? kv.inventories : []
            const picked = opts.branchIds?.length
                ? invs.filter(i => opts.branchIds!.includes(Number(i?.branchId)))
                : invs
            const onHand = Math.round(picked.reduce((s, i) => s + (Number(i?.onHand) || 0), 0))

            const price = Number(kv?.basePrice) || 0
            /**
             * GIÁ VỐN NẰM TRONG `inventories`, KHÔNG Ở CẤP SẢN PHẨM.
             *
             * Đo trên dữ liệu thật (HUTI 08/08/2026): `cost`/`costPrice` ở cấp
             * sản phẩm luôn null, còn `inventories[i].cost` mới có số thật
             * (NA105 → 3.720). Đọc sai chỗ nên mọi mặt hàng nhập vào đều giá
             * vốn 0 — hỏng luôn lãi gộp và giá trị tồn kho.
             *
             * Nhiều chi nhánh thì lấy giá vốn của chi nhánh có tồn (giá vốn
             * bình quân chỉ có nghĩa khi còn hàng); không chi nhánh nào có tồn
             * thì lấy giá vốn khác 0 đầu tiên.
             */
            const cost = (() => {
                const coTon = picked.find(i => (Number(i?.onHand) || 0) > 0 && (Number(i?.cost) || 0) > 0)
                if (coTon) return Number(coTon.cost)
                const batKy = picked.find(i => (Number(i?.cost) || 0) > 0)
                if (batKy) return Number(batKy.cost)
                return Number(kv?.cost ?? kv?.costPrice) || 0
            })()
            const brandName = String(kv?.tradeMarkName || '').trim()

            if (existing) {
                const data: any = {}
                if (opts.overwriteNames && name && name !== existing.name) data.name = name
                if (opts.overwritePrices) {
                    if (price > 0 && price !== existing.sellingPrice) data.sellingPrice = price
                    if (cost > 0 && cost !== existing.costPrice) data.costPrice = cost
                } else {
                    // Không ghi đè: chỉ ĐIỀN CHỖ TRỐNG
                    if (!existing.sellingPrice && price > 0) data.sellingPrice = price
                    if (!existing.costPrice && cost > 0) data.costPrice = cost
                }
                if (!existing.barcode && kv?.barCode) data.barcode = String(kv.barCode)
                // Thương hiệu: điền khi hàng bên Kengi đang trống. Không ghi đè
                // trừ khi người dùng bật, vì cửa hàng có thể đã tự gán khác.
                if (brandName && (!existing.brandId || opts.overwriteNames)) {
                    const bId = await resolveBrand(sp, brandName, brandCache, opts.apply)
                    if (bId && bId !== existing.brandId) data.brandId = bId
                }

                /* DANH MỤC — nhánh CẬP NHẬT trước đây KHÔNG hề gán, chỉ nhánh tạo mới có.
                 * Hệ quả: hàng đã có sẵn trong Kengi thì đồng bộ bao nhiêu lần cũng vẫn
                 * "Chưa phân loại". Đo HUTI 22/08/2026: 431 sản phẩm chưa phân loại,
                 * chiếm 88% doanh thu — báo cáo theo nhóm hàng gần như vô dụng.
                 *
                 * CHỈ ĐIỀN KHI TRỐNG, hoặc khi đang nằm ở nhóm tạm "Chưa phân loại"
                 * (nhóm đó là chỗ đổ khi chưa biết xếp đâu, KHÔNG phải cách xếp của người
                 * dùng). Cách xếp thật của người dùng thì không đụng vào. */
                if (!existing.categoryId || existing.categoryId === (await idNhomTam(sp, catCache))) {
                    const cId = await resolveCategory(
                        sp, kv?.categoryName, opts.defaultCategoryId, catCache, opts.apply, kv?.categoryId,
                    )
                    if (cId && cId !== existing.categoryId && cId !== DRYRUN_CATEGORY) data.categoryId = cId
                }

                // Thiếu ≠ 0 (cùng bài công nợ 18/08/2026): bản ghi KHÔNG mang `inventories` thì
                // onHand=0 chỉ là "không biết" — không được coi là hết hàng mà ghi đè tồn.
                const coTonKho = Array.isArray(kv?.inventories)
                const stockChanged = coTonKho && opts.overwriteStock && onHand !== existing.stock

                if (!Object.keys(data).length && !stockChanged) {
                    c.skipped++
                    await saveMap(sp, 'product', kvId, code, existing.id)
                    continue
                }

                if (opts.apply) {
                    if (Object.keys(data).length) {
                        await sp.product.update({ where: { id: existing.id }, data })
                    }
                    if (stockChanged) {
                        await applyStock(sp, existing, onHand, opts, `KiotViet đồng bộ tồn (mã ${code})`)
                    }
                    await saveMap(sp, 'product', kvId, code, existing.id)
                }
                c.updated++
                noteSample(c, { sku: code, name, hanhDong: 'cập nhật', truong: Object.keys(data), tonCu: existing.stock, tonMoi: stockChanged ? onHand : existing.stock })
            } else {
                const categoryId = await resolveCategory(sp, kv?.categoryName, opts.defaultCategoryId, catCache, opts.apply, kv?.categoryId)
                if (!categoryId) {
                    noteError(c, `Mã ${code}: chưa có nhóm hàng mặc định để gán`)
                    continue
                }

                const brandId = await resolveBrand(sp, brandName, brandCache, opts.apply)
                if (opts.apply) {
                    const created = await sp.product.create({
                        data: {
                            name,
                            sku: code,
                            barcode: kv?.barCode ? String(kv.barCode) : null,
                            categoryId,
                            brandId,
                            productType,
                            sellingPrice: price,
                            costPrice: cost,
                            stock: 0,          // đặt qua applyStock để giữ bất biến kho
                            baseUnit: String(kv?.unit || 'cái').slice(0, 50),
                            // Hàng NGỪNG KINH DOANH vẫn phải nhập: hoá đơn cũ
                            // tham chiếu tới nó, bỏ đi là mất dòng hàng. Kengi
                            // chưa có cờ ngừng bán nên ghi vào mô tả để nhìn ra.
                            description: [
                                kv?.isActive === false ? '[NGỪNG KINH DOANH bên KiotViet]' : '',
                                kv?.description ? String(kv.description) : '',
                            ].filter(Boolean).join(' ').slice(0, 1000) || null,
                        },
                    })
                    if (onHand > 0) {
                        await applyStock(sp, { ...created, stock: 0 }, onHand, opts, `KiotViet nhập tồn ban đầu (mã ${code})`)
                    }
                    await saveMap(sp, 'product', kvId, code, created.id)
                }
                c.created++
                noteSample(c, { sku: code, name, hanhDong: 'tạo mới', ton: onHand, gia: price, thuongHieu: brandName || '(không có)' })
            }
        } catch (e: any) {
            noteError(c, `Mã ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

/**
 * Đặt tồn cho một sản phẩm, GIỮ BẤT BIẾN Product.stock == tổng kho `main`.
 * Ghi cả WarehouseStock lẫn Product.stock trong một transaction, kèm thẻ kho.
 */
async function applyStock(sp: any, product: any, target: number, opts: SyncOptions, reason: string): Promise<void> {
    const whId = opts.defaultWarehouseId
    const delta = target - (Number(product.stock) || 0)
    if (!delta) return

    await sp.$transaction(async (tx: any) => {
        if (whId) {
            /* Tồn hiện tại đọc hỏng KHÔNG được coi là 0: newQty sẽ thành đúng `delta`, tức là
             * GHI ĐÈ tồn kho bằng một con số bịa. Trong transaction nên ném là an toàn — cả lượt
             * bị huỷ, tồn giữ nguyên (20/08/2026). */
            const cur = await tx.warehouseStock.findUnique({
                where: { warehouseId_productId: { warehouseId: whId, productId: product.id } },
                select: { quantity: true },
            })
            const newQty = (Number(cur?.quantity) || 0) + delta
            await tx.warehouseStock.upsert({
                where: { warehouseId_productId: { warehouseId: whId, productId: product.id } },
                create: {
                    warehouseId: whId, productId: product.id,
                    productName: product.name, productSku: product.sku,
                    quantity: newQty < 0 ? 0 : newQty,
                },
                update: { quantity: newQty < 0 ? 0 : newQty },
            })
        }
        await tx.product.update({ where: { id: product.id }, data: { stock: target < 0 ? 0 : target } })
        await tx.inventoryTransaction.create({
            data: {
                /**
                 * SỐ LƯỢNG CÓ DẤU — cả hệ thống quy ước vậy.
                 * Thẻ kho chia cột Nhập/Xuất theo DẤU của quantity (dương = nhập,
                 * âm = xuất), `runningBalance` và Tổng nhập/Tổng xuất cũng cộng
                 * theo dấu. Ghi Math.abs() thì dòng giảm tồn vẫn nhảy vào cột
                 * Nhập, tổng nhập phồng lên và tồn luỹ kế ra số âm vô nghĩa
                 * (đã thấy trên SHD4568 ngày 09/08/2026).
                 *
                 * `adjustment` là đúng bản chất: đây là điều chỉnh tồn cho khớp
                 * KiotViet, không phải nhập mua hay bán ra. Dùng đúng từ vựng
                 * của app ('in'/'out' không có trong các báo cáo lọc theo type).
                 */
                type: 'adjustment',
                productId: product.id,
                productName: product.name,
                productSku: product.sku,
                quantity: delta,
                reason,
                referenceType: 'kiotviet',
                userName: 'KiotViet Sync',
            },
        }).catch(() => { /* thẻ kho lỗi không được cuộn ngược cả tồn */ })
    })
}

// ─── KHÁCH HÀNG ─────────────────────────────────────────────────────────────

export async function syncCustomers(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            const name = String(kv?.name || '').trim()
            if (!kvId || !name) { c.skipped++; continue }

            const phone = firstPhone(kv?.contactNumber)

            let localId = await findMap(sp, 'customer', kvId)
            let existing = localId
                ? await sp.customer.findUnique({ where: { id: localId } }).catch(() => null)
                : null
            if (!existing && code) {
                existing = await sp.customer.findUnique({ where: { code } }).catch(() => null)
            }
            // Trùng số điện thoại = cùng một người → gộp, KHÔNG đẻ khách trùng
            if (!existing && phone) {
                existing = await sp.customer.findFirst({ where: { phone } }).catch(() => null)
            }

            // CÔNG NỢ lấy từ KiotViet — hệ thống đang là nguồn gốc dữ liệu.
            // Chỉ ĐIỀN khi bên Kengi đang là 0 (chưa ai đụng tới), hoặc khi
            // người dùng bật ghi đè giá/công nợ. Đè bừa là xoá mất khoản thu nợ
            // mà cửa hàng đã ghi trên Kengi.
            //
            // ⛔ THỦ PHẠM GIẤU NỢ (bắt quả tang 18/08/2026, HUTI): payload webhook
            // customer.update KHÔNG mang Debt → bản cũ `Number(kv.debt) || 0` = 0 →
            // với overwritePrices bật là ghi đè 0 lên nợ thật. 7 khách vừa được đối
            // chiếu về đúng số lúc 08:56Z (HN06 96,6tr, HN01 64,1tr…) bị về 0 lại đúng
            // mili-giây các webhook 09:12–09:19Z (updatedAt ↔ log). Đây cũng là gốc
            // của 39 khách / 857,7tr "Kengi giấu nợ" đo buổi sáng — không phải
            // lamTuoiNoKhach hụt nhịp như đoán ban đầu.
            // Luật mới: KHÔNG có debt hữu hạn trong bản ghi → KHÔNG đụng debt (thiếu
            // ≠ 0). Có creds (đường webhook) thì hỏi lại KV số dư thật ngay sau.
            const noKV = opts.tuWebhook ? null : docCongNoKV(kv)   // webhook: không tin debt trong payload
            const coDebt = noKV !== null
            const kvDebt = noKV ?? 0

            if (existing) {
                const data: any = {}
                if (opts.overwriteNames && name !== existing.name) data.name = name
                if (!existing.phone && phone) data.phone = phone
                if (!existing.address && kv?.address) data.address = String(kv.address).slice(0, 500)
                if (!existing.email && kv?.email) data.email = String(kv.email)
                if (coDebt && kvDebt !== existing.debt && (!existing.debt || opts.overwritePrices)) data.debt = kvDebt

                if (!Object.keys(data).length) {
                    c.skipped++
                    if (opts.apply) await saveMap(sp, 'customer', kvId, code, existing.id)
                    if (!coDebt && opts.tuWebhook) await lamTuoiNoKhach(sp, opts, kvId)   // webhook không mang debt → hỏi KV. REST bỏ trống debt: KHÔNG ghi 0 ở đây (cron đối chiếu đêm xử với gác hai lượt)
                    continue
                }
                if (opts.apply) {
                    await sp.customer.update({ where: { id: existing.id }, data })
                    await saveMap(sp, 'customer', kvId, code, existing.id)
                }
                c.updated++
                noteSample(c, { code, name, hanhDong: 'cập nhật', truong: Object.keys(data) })
                if (!coDebt && opts.tuWebhook) await lamTuoiNoKhach(sp, opts, kvId)   // REST thiếu debt = nợ rỗng, khỏi hỏi lại
            } else {
                // code là @unique — thiếu thì tự sinh để không đụng bản ghi khác
                const finalCode = code || `KV${kvId}`
                if (opts.apply) {
                    const created = await sp.customer.create({
                        data: {
                            code: finalCode,
                            name,
                            phone,                       // Kengi bắt buộc có trường này (chuỗi rỗng vẫn hợp lệ)
                            email: kv?.email ? String(kv.email) : null,
                            address: kv?.address ? String(kv.address).slice(0, 500) : null,
                            gender: kv?.gender === true ? 'male' : kv?.gender === false ? 'female' : null,
                            debt: kvDebt,
                            notes: 'Đồng bộ từ KiotViet',
                        },
                    })
                    await saveMap(sp, 'customer', kvId, finalCode, created.id)
                    // Đánh dấu để bước hoá đơn KHÔNG cộng nợ lần nữa — xem SyncOptions
                    opts.seededCustomerIds?.add(created.id)
                    // Khách mới từ webhook (payload không mang debt) → seed 0 rồi hỏi KV số dư thật
                    if (!coDebt && opts.tuWebhook) await lamTuoiNoKhach(sp, opts, kvId)   // REST thiếu debt = nợ rỗng, khỏi hỏi lại
                }
                c.created++
                noteSample(c, { code: finalCode, name, phone, congNo: coDebt ? kvDebt : 'không có trong payload', hanhDong: 'tạo mới' })
            }
        } catch (e: any) {
            noteError(c, `Khách ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

// ─── NHÀ CUNG CẤP ───────────────────────────────────────────────────────────

export async function syncSuppliers(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            const name = String(kv?.name || '').trim()
            if (!kvId || !name) { c.skipped++; continue }

            let localId = await findMap(sp, 'supplier', kvId)
            let existing = localId
                ? await sp.supplier.findUnique({ where: { id: localId } }).catch(() => null)
                : null
            if (!existing && code) {
                existing = await sp.supplier.findUnique({ where: { code } }).catch(() => null)
            }

            // CÔNG NỢ PHẢI TRẢ + tổng đã mua, lấy từ KiotViet (nguồn gốc dữ liệu).
            // Cùng quy tắc với công nợ khách: chỉ điền khi Kengi đang là 0, hoặc
            // khi người dùng bật ghi đè giá/công nợ.
            // Thiếu ≠ 0: webhook supplier.update không mang Debt (cùng bệnh giấu nợ khách, 18/08/2026)
            // → không đụng payable; danh sách REST mang debt thì so như cũ.
            const noNccKV = opts.tuWebhook ? null : docCongNoKV(kv)   // webhook: không tin debt trong payload
            const coPayable = noNccKV !== null
            const kvPayable = noNccKV ?? 0
            const kvBought = Number(kv?.totalInvoiced) || 0

            if (existing) {
                const data: any = {}
                if (opts.overwriteNames && name !== existing.name) data.name = name
                if (!existing.phone && firstPhone(kv?.contactNumber)) data.phone = firstPhone(kv.contactNumber)
                if (!existing.address && kv?.address) data.address = String(kv.address).slice(0, 500)
                if (!existing.taxCode && kv?.taxCode) data.taxCode = String(kv.taxCode)
                if (!existing.email && kv?.email) data.email = String(kv.email)
                /* payable = SỐ DƯ ĐẦU KỲ (app cộng thêm Σ phiếu chưa trả khi hiển thị). kv.debt là TỔNG nợ
                 * hiện tại đã gồm các PO đã thành phiếu ⇒ phải ghi PHẦN DƯ = kv.debt − Σ phiếu chưa trả,
                 * nếu không là đếm đôi (HUTI 18/08/2026: hiện 40,49 tỷ trong khi KV nói 20,15). lib/congNoNcc.ts */
                if (coPayable) {
                    // Không đọc được phiếu ⇒ KHÔNG ghi payable (không đọc được ≠ 0) — chỉ noteError, các trường khác vẫn cập nhật
                    let phieu: number | null = null
                    try { phieu = (await tongPhieuChuaTraTheoNcc(sp, [existing.id])).get(existing.id)?.tong || 0 }
                    catch (e: any) { noteError(c, `NCC ${code}: không đọc được phiếu chưa trả — giữ payable cũ (${e?.message || e})`) }
                    if (phieu !== null) {
                        const soDuDauKy = soDuDauKyTuKV(kvPayable, phieu)
                        if (soDuDauKy !== existing.payable && (!existing.payable || opts.overwritePrices)) data.payable = soDuDauKy
                    }
                }
                if (kvBought && kvBought !== existing.totalValue && (!existing.totalValue || opts.overwritePrices)) data.totalValue = kvBought

                if (!Object.keys(data).length) {
                    c.skipped++
                    if (opts.apply) await saveMap(sp, 'supplier', kvId, code, existing.id)
                    continue
                }
                if (opts.apply) {
                    await sp.supplier.update({ where: { id: existing.id }, data })
                    await saveMap(sp, 'supplier', kvId, code, existing.id)
                }
                c.updated++
                noteSample(c, { code, name, hanhDong: 'cập nhật' })
            } else {
                const finalCode = code || `KVNCC${kvId}`
                if (opts.apply) {
                    const created = await sp.supplier.create({
                        data: {
                            code: finalCode, name,
                            phone: firstPhone(kv?.contactNumber) || null,
                            email: kv?.email ? String(kv.email) : null,
                            address: kv?.address ? String(kv.address).slice(0, 500) : null,
                            taxCode: kv?.taxCode ? String(kv.taxCode) : null,
                            payable: kvPayable,
                            totalValue: kvBought,
                            notes: 'Đồng bộ từ KiotViet',
                        },
                    })
                    await saveMap(sp, 'supplier', kvId, finalCode, created.id)
                }
                c.created++
                noteSample(c, { code: finalCode, name, phaiTra: kvPayable, daMua: kvBought, hanhDong: 'tạo mới' })
            }
        } catch (e: any) {
            noteError(c, `NCC ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

// ─── HOÁ ĐƠN BÁN ────────────────────────────────────────────────────────────

/**
 * KHÔNG TRỪ KHO (xem nguyên tắc 5 đầu file). Dòng hàng nào chưa có sản phẩm
 * tương ứng bên Kengi thì BỎ QUA DÒNG ĐÓ và ghi rõ trong lỗi — chứ không tự
 * đẻ sản phẩm ma từ hoá đơn.
 */
export async function syncInvoices(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    if (!opts.systemUserId) {
        noteError(c, 'Chưa xác định được người dùng hệ thống để gán cho hoá đơn — bỏ qua toàn bộ')
        return
    }
    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            if (!kvId || !code) { boQua(c, 'thiếu id hoặc mã hoá đơn'); continue }

            // CHỈ LẤY HOÁ ĐƠN HOÀN THÀNH.
            // Trạng thái đo trên dữ liệu thật (HUTI 06/08/2026):
            //   1 = "Hoàn thành" · 2 = "Đã hủy" · 3 = "Đang xử lý"
            // Bản trước tôi ghi 3 là huỷ → hoá đơn ĐÃ HUỶ (2) lọt vào sổ như
            // doanh thu thật, còn đơn đang xử lý bị gắn nhãn huỷ. Sai cả hai đầu.
            if (Number(kv?.status) !== 1) {
                // ĐÃ VÀO SỔ RỒI MÀ NAY BỊ HUỶ/QUAY LẠI XỬ LÝ → phải rút khỏi
                // doanh thu. Webhook `invoice.update` bắn đúng lúc này; bỏ qua
                // im lặng là để lại doanh thu ma trong sổ.
                const daCo = await sp.transaction.findUnique({
                    where: { receiptNumber: code },
                    select: { id: true, status: true, customerId: true, total: true, amountReceived: true },
                })   // đọc hỏng ⇒ tưởng không có phiếu ⇒ BỎ QUA lệnh huỷ: hoá đơn đã huỷ bên KV
                     // vẫn nằm trong doanh thu Kengi (20/08/2026)
                if (daCo && daCo.status !== 'voided') {
                    if (opts.apply) {
                        await sp.transaction.update({ where: { id: daCo.id }, data: { status: 'voided' } })
                        await lamTuoiNoKhach(sp, opts, kv?.customerId)
                        // Đơn nợ bị huỷ thì phần chưa thu phải RÚT khỏi số dư khách,
                        // không thì khách gánh nợ của một hoá đơn không còn tồn tại
                        const noTreo = Math.max(0, (daCo.total || 0) - (daCo.amountReceived ?? 0))
                        if (noTreo > 0 && daCo.customerId) {
                            /* HOTFIX 12/08/2026: NGUNG cong-tru debt theo chung tu — so du chi lay tu dong bo khach (kvDebt). Doc-driven drift lam cong no an dan ve 0. */
                        }
                    }
                    c.updated++
                    noteSample(c, { code, hanhDong: 'huỷ khỏi sổ', trangThaiKiotViet: kv?.status })
                } else {
                    boQua(c, `HĐ ${code}: trạng thái ${kv?.status} (chỉ nhận hoàn thành = 1)`)
                }
                continue
            }

            const kvPayments: any[] = Array.isArray(kv?.payments) ? kv.payments : []
            // Ghi mã phiếu thu vào bộ nhớ lượt chạy TRƯỚC khi kiểm hoá đơn đã
            // tồn tại. Hoá đơn cũ vẫn `continue` ở dưới, nhưng phiếu thu của nó
            // thì bước sổ quỹ vẫn phải biết mà tránh — nếu không, đổ lại sổ quỹ
            // trên nền hoá đơn đã có sẽ nhân đôi tiền y như cũ.
            for (const p of kvPayments) {
                if (p?.code) opts.invoicePaymentCodes?.add(String(p.code))
            }

            /* Đây là CHỐT CHỐNG TRÙNG. Nuốt lỗi đọc thành null ⇒ tưởng hoá đơn chưa có ⇒ tạo thêm
             * một phiếu nữa cho cùng mã KiotViet ⇒ doanh thu đếm đôi, đúng họ với vụ 40 tỷ NCC.
             * Đọc không được thì để lượt đồng bộ sau làm lại (20/08/2026). */
            const existing = await sp.transaction.findUnique({ where: { receiptNumber: code } })
            if (existing) {
                if (opts.apply) {
                    await saveMap(sp, 'invoice', kvId, code, existing.id)
                    // Hoá đơn nhập bằng bản cũ chưa có bản đồ phiếu thu — vá lại
                    for (const p of kvPayments) {
                        if (p?.code) await saveMap(sp, 'invoicePayment', String(p.code), String(p.code), existing.id)
                    }
                }

                /**
                 * HOÁ ĐƠN ĐÃ CÓ VẪN PHẢI CẬP NHẬT.
                 * `invoice.update` nghĩa là hoá đơn THAY ĐỔI — thường là vừa
                 * thu thêm tiền. Bản trước chỉ biết TẠO MỚI, gặp hoá đơn đã có
                 * là bỏ qua, nên webhook về đều đặn mà sổ không nhúc nhích.
                 */
                const thuMoi = kvPayments
                    .filter((p: any) => Number(p?.status) !== 1)
                    .reduce((s: number, p: any) => s + (Number(p?.amount) || 0), 0)
                const data: any = {}
                /**
                 * PHẢI CHỈNH CẢ KHI THU VỀ 0.
                 *
                 * Bản trước để `thuMoi > 0` mới đụng vào. Nghe hợp lý nhưng nó
                 * khoá đúng những hoá đơn cần sửa nhất: hoá đơn KHÔNG có phiếu
                 * thu nào (thuMoi = 0) mà bản cũ đã lỡ ghi "đã thu đủ" thì chạy
                 * lại bao nhiêu lần cũng không nhúc nhích (đo 10/08/2026 khi đi
                 * sửa vụ HD030321 — Duy Khương ghi thu 14.332.320 trong khi
                 * KiotViet totalPayment = 0).
                 *
                 * Nay: số đã thu LUÔN kéo về đúng tổng phiếu thu thật.
                 */
                if (thuMoi !== existing.amountReceived) {
                    data.amountReceived = thuMoi
                    data.change = thuMoi > existing.total ? thuMoi - existing.total : 0
                }
                const trangThaiDung = thuMoi >= existing.total ? 'completed' : 'partial'
                // 'voided' = huỷ rồi mở lại; các trạng thái khác cũng kéo về cho
                // khớp số tiền vừa tính, đừng để 'completed' treo trên đơn chưa thu
                if (existing.status !== trangThaiDung) data.status = trangThaiDung

                /**
                 * GIỮ Customer.debt SỐNG THEO CHỨNG TỪ — như luồng POS gốc
                 * (bán nợ increment, thu nợ decrement). Trước đây sync ghi hoá
                 * đơn nợ mà không đụng số dư khách → khách có đơn ghi nợ mới
                 * qua webhook nhưng debt vẫn là ảnh chụp cũ; lịch sử công nợ
                 * neo dòng cuối vào debt nên CẢ SỔ trượt xuống đúng phần thiếu,
                 * và "Nợ cũ" trên hoá đơn in ra số âm vô nghĩa (đo 11/08/2026:
                 * Phượng Dung debt=0, đơn nợ 2.817.040 → in "Nợ cũ −2.817.040").
                 *
                 * Delta từ số đang lưu về số đúng nên chạy lại bao nhiêu lần
                 * cũng không cộng trùng; đơn đang 'voided' coi nợ cũ = 0.
                 */
                const noCu = existing.status === 'voided' ? 0
                    : Math.max(0, existing.total - (existing.amountReceived ?? 0))
                const noMoi = Math.max(0, existing.total - thuMoi)
                const deltaNo = noMoi - noCu

                /**
                 * DỰNG LẠI DÒNG HÀNG (chỉ khi bật rebuildLines).
                 *
                 * Ba cổng phải qua HẾT mới được đụng vào dòng cũ — thiếu cổng
                 * nào cũng là đổi "thiếu một phần" thành "hỏng nặng hơn":
                 *   1. đủ 100% mã hàng (thiếu mã mà xoá dòng cũ là mất thêm dòng)
                 *   2. có ít nhất một dòng
                 *   3. dòng cộng ra ĐÚNG tổng phiếu (± giảm giá phiếu)
                 * Không qua thì để nguyên và ghi lý do — sửa xong danh mục chạy
                 * lại sẽ vào.
                 */
                let dongMoi: any[] | null = null
                if (opts.rebuildLines) {
                    const dung = await dungDongHoaDon(sp, kv)
                    const tongDong = dung.lines.reduce((s: number, l: any) => s + l.lineTotal, 0)
                    const giamHD = Number(kv?.discount) || 0
                    if (dung.missing.length) {
                        noteError(c, `HĐ ${code}: KHÔNG dựng lại dòng — thiếu ${dung.missing.length} mã hàng (${dung.missing.slice(0, 3).join(', ')}…) — đồng bộ hàng hoá trước rồi chạy lại`)
                    } else if (!dung.lines.length) {
                        noteError(c, `HĐ ${code}: KHÔNG dựng lại dòng — payload KiotViet không có dòng nào`)
                    } else if (Math.abs(tongDong - giamHD - (Number(kv?.total) || 0)) > 1) {
                        noteError(c, `HĐ ${code}: KHÔNG dựng lại — dòng cộng ${Math.round(tongDong)} − giảm ${Math.round(giamHD)} ≠ tổng ${Math.round(Number(kv?.total) || 0)}`)
                    } else {
                        dongMoi = dung.lines
                        data.subtotal = tongDong
                    }
                }

                if (!Object.keys(data).length && !dongMoi) {
                    boQua(c, `HĐ ${code}: đã có trong sổ và không có gì đổi`)
                    continue
                }
                if (opts.apply) {
                    if (dongMoi) {
                        // Xoá rồi tạo lại trong CÙNG transaction — đứt giữa chừng
                        // không được để hoá đơn trắng dòng
                        await sp.$transaction(async (tx: any) => {
                            await tx.transactionItem.deleteMany({ where: { transactionId: existing.id } })
                            await tx.transactionItem.createMany({
                                data: dongMoi!.map((l: any) => ({ ...l, transactionId: existing.id })),
                            })
                        })
                    }
                    await sp.transaction.update({ where: { id: existing.id }, data })
                    await lamTuoiNoKhach(sp, opts, kv?.customerId)
                    await ganPhieuSuaChuaKhiSync(sp, opts, existing.customerId, existing.id, code, existing.createdAt)
                    if (deltaNo !== 0 && existing.customerId) {
                        /* HOTFIX 12/08/2026: NGUNG cong-tru debt theo chung tu — so du chi lay tu dong bo khach (kvDebt). Doc-driven drift lam cong no an dan ve 0. */
                    }
                    // Dựng lại phiếu thu cho khớp KiotViet. XOÁ TRƯỚC, kể cả khi
                    // KiotViet không còn phiếu nào — phiếu thu bị huỷ bên đó mà
                    // Kengi vẫn giữ thì sổ quỹ tiếp tục đếm tiền không có thật.
                    /* KHÔNG nuốt lỗi ở lệnh XOÁ (21/08/2026) — chính chú thích ngay trên đã nói vì
                     * sao phải xoá. Xoá hỏng mà bị nuốt thì `createMany` bên dưới **cộng thêm** dòng
                     * mới vào dòng cũ ⇒ **phiếu thu bị TRÙNG**, và từ 21/08 sổ quỹ tiền mặt S6 tính
                     * tiền THẲNG TỪ bảng `Payment` ⇒ **tiền mặt trong sổ nhân đôi**.
                     * Ném ra là đúng: vòng ngoài đã có `catch` ghi `noteError(c, 'HĐ …')`, nên hỏng
                     * thì chỉ hoá đơn đó bị bỏ qua VÀ ĐƯỢC GHI LẠI, không im lặng. */
                    await sp.payment.deleteMany({ where: { transactionId: existing.id } })
                    const rows = kvPayments
                        .filter((p: any) => Number(p?.status) !== 1 && (Number(p?.amount) || 0) > 0)
                        .map((p: any) => ({
                            transactionId: existing.id,
                            type: /transfer|bank/i.test(String(p?.method || '')) ? 'bank_transfer' : 'cash',
                            amount: Number(p.amount) || 0,
                            reference: p?.code ? String(p.code) : null,
                        }))
                    // Cùng lý do: tạo hỏng mà nuốt thì hoá đơn mất phiếu thu, sổ quỹ hụt tiền.
                    if (rows.length) await sp.payment.createMany({ data: rows })
                    /**
                     * Phiếu thu từng nhập ĐỘC LẬP qua sổ quỹ (webhook sổ quỹ tới
                     * trước) nay gắn vào hoá đơn: xoá bản độc lập + map của nó,
                     * và CỘNG TRẢ phần nợ nó đã trừ — deltaNo ở trên là lần trừ
                     * duy nhất theo đường hoá đơn. Thiếu bước này thì cùng một
                     * khoản tiền trừ nợ hai lần và lịch sử công nợ hiện đúp.
                     */
                    let buLai = 0
                    for (const p of kvPayments) {
                        const maPhieu = p?.code ? String(p.code) : null
                        if (!maPhieu) continue
                        const cu = await findMap(sp, 'debtPayment', maPhieu)
                        if (!cu) continue
                        await sp.debtEntry.delete({ where: { id: cu } }).catch(() => { })
                        await sp.kiotVietMap.delete({
                            where: { entity_kvId: { entity: 'debtPayment', kvId: maPhieu } },
                        }).catch(() => { })
                        buLai += Number(p?.amount) || 0
                    }
                    if (buLai > 0 && existing.customerId) {
                        /* HOTFIX 12/08/2026: NGUNG cong-tru debt theo chung tu — so du chi lay tu dong bo khach (kvDebt). Doc-driven drift lam cong no an dan ve 0. */
                    }
                }
                c.updated++
                noteSample(c, {
                    code,
                    hanhDong: dongMoi ? 'cập nhật + DỰNG LẠI DÒNG' : 'cập nhật thanh toán',
                    daThu: thuMoi,
                    ...(dongMoi ? { soDong: dongMoi.length } : {}),
                    truong: Object.keys(data),
                })
                continue
            }

            // Từ đây trở xuống là ĐƯỜNG TẠO MỚI — updateOnly thì dừng ở đây
            if (opts.updateOnly) {
                boQua(c, `HĐ ${code}: chưa có trong sổ — updateOnly nên không tạo mới`)
                continue
            }

            const details: any[] = Array.isArray(kv?.invoiceDetails) ? kv.invoiceDetails : []
            const { lines, missing } = await dungDongHoaDon(sp, kv)
            // CHẠY THỬ: hàng hoá chưa được tạo (chạy thử không ghi gì) nên mọi
            // dòng đều "không tìm thấy". Báo lỗi ở đây là báo oan — chạy thật
            // đồng bộ hàng hoá trước thì có đủ (dính 06/08/2026: 24462 lỗi ảo).
            if (!opts.apply) {
                if (missing.length && c.errors.length < 3) {
                    c.errors.push(`Chạy thử: ${missing.length} mã hàng của HĐ ${code} chưa có bên Kengi — chạy thật sẽ có sau khi đồng bộ hàng hoá`)
                }
                c.created++
                noteSample(c, { code, tong: Number(kv?.total) || 0, soDong: details.length, hanhDong: 'sẽ tạo' })
                continue
            }
            if (missing.length) {
                noteError(c, `HĐ ${code}: ${missing.length} mã hàng chưa có bên Kengi (${missing.slice(0, 3).join(', ')}) — đồng bộ hàng hoá trước`)
            }
            if (!lines.length) {
                boQua(c, `HĐ ${code}: không dựng được dòng hàng nào` +
                    `${details.length ? ` (${details.length} dòng nhưng không khớp mã bên Kengi)` : ' — payload không có invoiceDetails'}`)
                continue
            }

            // Khách: chỉ GẮN nếu đã có, không tự đẻ khách từ hoá đơn
            let customerId: string | null = null
            if (kv?.customerId) customerId = await findMap(sp, 'customer', kv.customerId)

            /**
             * ĐÃ THU HAY CHƯA THU LÀ VIỆC CỦA PHIẾU THU, KHÔNG SUY DIỄN.
             *
             * Bản trước ở đây có quy tắc "khách không còn nợ thì hoá đơn coi
             * như đã thu đủ" — dựng lên để chặn 82 khách nợ ảo hồi 07/08/2026.
             * Nó SAI và đã gây hậu quả ngược (đo 10/08/2026):
             *
             *   KiotViet HD030321 — Duy Khương: total 14.332.320,
             *   totalPayment = 0, KHÔNG có phiếu thu nào, khách đang nợ
             *   89.751.811. Vậy mà Kengi ghi amountReceived = total,
             *   status 'completed', không có dòng Payment nào → sổ quỹ thấy
             *   "đơn hoàn thành mà không có phiếu thu" liền coi là đã thu đủ
             *   và cộng 14.332.320 vào TIỀN VÀO. Tiền chưa hề về.
             *
             * `khachConNo` còn hỏng thêm một nước: khách chưa map thì
             * customerId = null → mặc định coi như KHÔNG nợ → mọi hoá đơn của
             * khách lạ đều thành "đã thu".
             *
             * Còn lý do dựng nó lên thì nay không còn: /debts/summary đã đọc
             * thẳng `Customer.debt` (số KiotViet đồng bộ sang), chứ không suy
             * người nợ từ hoá đơn chưa thu nữa; lịch sử công nợ cũng neo dòng
             * cuối vào `Customer.debt` bằng dòng dư đầu kỳ. Nên để hoá đơn
             * 'partial' KHÔNG đẻ ra khách nợ ảo.
             *
             * Từ đây: có phiếu thu bao nhiêu ghi bấy nhiêu.
             */
            const total = Number(kv?.total) || 0
            const when = kv?.purchaseDate ? new Date(kv.purchaseDate) : new Date()

            /**
             * THANH TOÁN LÀ PHIẾU THU, KHÔNG PHẢI MỘT CON SỐ.
             *
             * `payments[]` của hoá đơn chính là các phiếu thu — mã dạng
             * `TTHD016712` (gắn hoá đơn) hoặc `TT011815` (thu chung). CHÍNH
             * NHỮNG MÃ ẤY CŨNG NẰM TRONG /cashflow. Bản trước tôi vừa đặt
             * amountReceived trên hoá đơn vừa tạo phiếu thu riêng từ sổ quỹ →
             * cùng một khoản tiền vào sổ HAI LẦN (đo 07/08/2026).
             *
             * Nay: phiếu thu của hoá đơn thành Payment gắn vào hoá đơn, và mã
             * của chúng được ghi vào bảng map để bước sổ quỹ BỎ QUA.
             */
            const paymentRows = kvPayments
                .filter(p => Number(p?.status) !== 1)          // bỏ phiếu đã huỷ
                .map(p => ({
                    type: /transfer|bank/i.test(String(p?.method || '')) ? 'bank_transfer' : 'cash',
                    amount: Number(p?.amount) || 0,
                    reference: p?.code ? String(p.code) : null,
                }))
                .filter(p => p.amount > 0)
            // Không có phiếu thu nào thì hoá đơn CHƯA thu tiền — dù KiotViet có
            // điền totalPayment, vì tiền thật nằm ở phiếu thu.
            const paid = paymentRows.reduce((s, p) => s + p.amount, 0)
            // Có phiếu thu bao nhiêu ghi bấy nhiêu — xem khối ghi chú ở trên
            const thuDu = paid >= total
            const amountReceived = paid

            /**
             * CHỐT TỰ KIỂM: dòng hàng phải cộng ra đúng tổng phiếu.
             *
             * Tổng lấy thẳng từ `kv.total` còn dòng hàng thì tự dựng, nên khi
             * hiểu sai quy ước một trường nào đó (đã dính với `discount`) hoá
             * đơn vẫn lưu trót lọt, chỉ vỡ ra lúc người dùng mở phiếu. Lệch thì
             * ghi vào nhật ký — KHÔNG tính là hỏng, phiếu vẫn tạo, nhưng phải
             * có dấu vết để lần ra thay vì im lặng như lần trước.
             */
            const tongDong = lines.reduce((s, l) => s + l.lineTotal, 0)
            const giamHoaDon = Number(kv?.discount) || 0
            if (Math.abs(tongDong - giamHoaDon - total) > 1 && c.errors.length < 20) {
                c.errors.push(
                    `⚠ HĐ ${code}: dòng hàng cộng ${Math.round(tongDong)} − giảm ${Math.round(giamHoaDon)} ` +
                    `≠ tổng ${Math.round(total)} (lệch ${Math.round(tongDong - giamHoaDon - total)}) — soát lại quy ước giảm giá`,
                )
            }

            if (opts.apply) {
                const created = await sp.transaction.create({
                    include: {
                        // Bút toán cần dòng hàng (giá vốn) và cách trả (chọn 111/112/131)
                        items: { include: { product: { select: { costPrice: true } } } },
                        payments: true,
                    },
                    data: {
                        receiptNumber: code,
                        customerId,
                        customerName: kv?.customerName ? String(kv.customerName) : null,
                        subtotal: lines.reduce((s, l) => s + l.lineTotal, 0),
                        discount: Number(kv?.discount) || 0,
                        total,
                        amountReceived,
                        // Khách đưa dư (một lần trả cho nhiều hoá đơn) thì phần
                        // dư là tiền thối, không phải doanh thu
                        change: amountReceived > total ? amountReceived - total : 0,
                        // CHƯA THU ĐỦ = 'partial'. Kengi suy công nợ ra từ đơn
                        // 'partial' (total − amountReceived); nhập tất cả thành
                        // 'completed' là báo cáo công nợ ra 0 trong khi khách
                        // vẫn đang nợ thật (đo 07/08/2026: 14/40 khách có nợ).
                        status: thuDu ? 'completed' : 'partial',
                        createdBy: opts.systemUserId,
                        createdByName: 'KiotViet Sync',
                        // Người dùng bỏ ghi chú nguồn trên hoá đơn (12/08/2026)
                        // — bản in từng hiện "*GC: Nhập từ KiotViet (mã ...)"
                        notes: null,
                        transactionDate: isNaN(when.getTime()) ? new Date() : when,
                        // NGÀY CHỨNG TỪ, KHÔNG PHẢI NGÀY ĐỒNG BỘ. Báo cáo doanh
                        // thu lọc theo `createdAt` chứ không phải transactionDate,
                        // để mặc định now() là 24 nghìn hoá đơn cũ dồn hết vào
                        // "hôm nay" (dính 06/08/2026).
                        createdAt: isNaN(when.getTime()) ? new Date() : when,
                        channel: 'direct',
                        items: { create: lines },
                        ...(paymentRows.length ? { payments: { create: paymentRows } } : {}),
                    },
                })
                await saveMap(sp, 'invoice', kvId, code, created.id)

                /* GHI SỔ (03/09/2026 — điểm đứt 1). Trước bản này đồng bộ KiotViet
                 * tạo hoá đơn rồi dừng, không sinh bút toán nào; đo trên HUTI thì
                 * sổ TK 511 chỉ có 35% doanh thu thật. Khoá SALE-<số phiếu> lo phần
                 * chống ghi hai lần nên chạy lại đồng bộ không đẻ thêm bút toán. */
                await thuGhiSo(`HĐ ${code}`, () => createJournalEntriesForTransaction(sp, created as any, {
                    branchId: (created as any).branchId ?? null,
                    userId: opts.systemUserId ?? null,
                }))
                /* Tổng mua của khách là số TỔNG HỢP SẴN mà chỉ đường POS duy
                 * trì — đồng bộ KiotViet trước nay không đụng tới, nên cửa hàng
                 * nhập bán từ KiotViet có khách mua hàng tỷ mà danh sách hiện
                 * "0 đơn · 0đ" (đo HUTI 16/08/2026). TÍNH LẠI chứ không cộng
                 * dồn: đồng bộ chạy lại hay lỗi giữa chừng thì cộng dồn sai
                 * vĩnh viễn, còn tính lại chạy bao nhiêu lần cũng một kết quả. */
                if (customerId) {
                    const { tinhLaiChoKhach } = await import('../lib/tinhLaiTongMuaKhach')
                    await tinhLaiChoKhach(sp, customerId)
                }
                await lamTuoiNoKhach(sp, opts, kv?.customerId)
                await ganPhieuSuaChuaKhiSync(sp, opts, customerId, created.id, code, when)
                /**
                 * Đơn nợ mới → Customer.debt tăng theo, như luồng POS gốc.
                 *
                 * TRỪ khách vừa được seed trong CHÍNH lượt này: debt seed lấy từ
                 * KiotViet đã GỒM các hoá đơn nợ sắp nhập đây — cộng nữa là đếm
                 * đôi (khách mới 10 đơn nợ sẽ thành nợ ×2).
                 */
                const noDonMoi = Math.max(0, total - amountReceived)
                if (noDonMoi > 0 && customerId && !opts.seededCustomerIds?.has(customerId)) {
                    /* HOTFIX 12/08/2026: NGUNG cong-tru debt theo chung tu — so du chi lay tu dong bo khach (kvDebt). Doc-driven drift lam cong no an dan ve 0. */
                }
                // Đánh dấu các mã phiếu thu đã tính vào hoá đơn, để bước sổ quỹ
                // không tạo lại chúng thành phiếu thu độc lập (tránh nhân đôi)
                for (const p of paymentRows) {
                    if (p.reference) await saveMap(sp, 'invoicePayment', p.reference, p.reference, created.id)
                }
                // Phiếu thu từng nhập ĐỘC LẬP trước khi hoá đơn về (webhook sổ
                // quỹ nhanh chân hơn): xoá bản độc lập + cộng trả phần nợ nó đã
                // trừ — xem ghi chú cùng tên ở nhánh cập nhật
                let buLaiTaoMoi = 0
                for (const p of paymentRows) {
                    if (!p.reference) continue
                    const cu = await findMap(sp, 'debtPayment', p.reference)
                    if (!cu) continue
                    await sp.debtEntry.delete({ where: { id: cu } }).catch(() => { })
                    await sp.kiotVietMap.delete({
                        where: { entity_kvId: { entity: 'debtPayment', kvId: p.reference } },
                    }).catch(() => { })
                    buLaiTaoMoi += Number(p.amount) || 0
                }
                if (buLaiTaoMoi > 0 && customerId) {
                    /* HOTFIX 12/08/2026: NGUNG cong-tru debt theo chung tu — so du chi lay tu dong bo khach (kvDebt). Doc-driven drift lam cong no an dan ve 0. */
                }
            }
            c.created++
            noteSample(c, { code, total, daThu: paid, soDong: lines.length, hanhDong: 'tạo mới', ngay: when.toISOString().slice(0, 10) })
        } catch (e: any) {
            noteError(c, `HĐ ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

// ─── PHIẾU NHẬP HÀNG ────────────────────────────────────────────────────────

/**
 * "Nhập hàng" của KiotViet → PHIẾU NHẬP KHO (ImportReceipt) của Kengi.
 *
 * VÌ SAO KHÔNG PHẢI PurchaseOrder: Kengi tách hai module — `PurchaseOrder` là
 * ĐƠN ĐẶT hàng nhập (có cổng kiểm hàng draft→pending→checking→received), còn
 * `ImportReceipt` mới là PHIẾU NHẬP KHO đã hoàn tất (có giá vốn, công nợ NCC,
 * hoá đơn VAT). `/purchaseorders` của KiotViet là chứng từ hàng ĐÃ VỀ, nên
 * thuộc về ImportReceipt. Bản trước đổ vào PurchaseOrder nên trang "Phiếu nhập
 * hàng" trống trơn dù đã nhập 758 phiếu (dính 09/08/2026).
 *
 * KHÔNG CỘNG KHO (cùng lý do với hoá đơn: `onHand` bên KiotViet đã tính rồi,
 * cộng thêm lần nữa là tồn khống gấp đôi).
 */
/**
 * Tách nhãn dòng `adjustment` vô danh của CHÍNH đợt này thành dòng `import` mang
 * mã phiếu nhập + phần dư. KHÔNG đụng tồn kho — chỉ đổi cách thẻ kho kể chuyện.
 *
 * Trả 'ok' khi gắn được; 'giu' khi giữ nguyên dạng điều chỉnh (phiếu cũ đã bị
 * lượt trước hấp thụ, tồn không đổi trong đợt này, hoặc pha tồn kho không chạy).
 * 'giu' KHÔNG phải lỗi — nó nghĩa là không có dòng nào của đợt này để tách.
 */
async function ganTheKhoPhieuNhap(
    sp: any, opts: SyncOptions,
    phieu: { code: string; ngay: Date; supplierId: string | null; supplierName: string },
    line: { productId: string; productName: string; productSku: string; quantity: number; costPrice: number },
): Promise<'ok' | 'giu'> {
    if (!opts.mocBatDauDot || !(line.quantity > 0)) return 'giu'
    if (opts.mocPhienTruocProducts && phieu.ngay < opts.mocPhienTruocProducts) return 'giu'
    const adj = await sp.inventoryTransaction.findFirst({
        where: {
            productId: line.productId,
            referenceType: 'kiotviet',
            type: 'adjustment',
            createdAt: { gte: opts.mocBatDauDot },
        },
        orderBy: { createdAt: 'desc' },
    }).catch(() => null)
    if (!adj) return 'giu'

    const conLai = (Number(adj.quantity) || 0) - line.quantity
    await sp.$transaction(async (tx: any) => {
        await tx.inventoryTransaction.create({
            data: {
                type: 'import',
                productId: line.productId,
                productName: line.productName,
                productSku: line.productSku,
                // SỐ LƯỢNG CÓ DẤU — dương = nhập, đúng quy ước cả hệ thống
                quantity: line.quantity,
                reason: `Nhập kho theo phiếu ${phieu.code} (KiotViet)`,
                referenceId: phieu.code,
                referenceType: 'import_receipt',
                unitPrice: line.costPrice || 0,
                supplierId: phieu.supplierId,
                supplierName: phieu.supplierName,
                userName: 'KiotViet Sync',
                /* Cùng thời điểm với dòng điều chỉnh gốc: tồn luỹ kế của thẻ kho
                 * cộng theo thứ tự thời gian — đặt lệch là cong lịch sử. */
                createdAt: adj.createdAt,
            },
        })
        if (conLai === 0) {
            await tx.inventoryTransaction.delete({ where: { id: adj.id } })
        } else {
            await tx.inventoryTransaction.update({ where: { id: adj.id }, data: { quantity: conLai } })
        }
    })
    return 'ok'
}

export async function syncPurchaseOrders(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    /* Hộ kinh doanh không được khấu trừ VAT đầu vào → VAT nằm trong giá vốn.
     * Đọc MỘT lần cho cả lượt: pool prod mỗi cửa hàng chỉ 1 kết nối. */
    const khauTruVat = await coKhauTruVat(sp)
    let ganOk = 0, ganGiu = 0
    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            if (!kvId || !code) { c.skipped++; continue }

            const existing = await sp.importReceipt.findUnique({ where: { code }, select: { id: true, supplierId: true, totalCost: true, paidAmount: true, paymentStatus: true } })   // chốt chống trùng: nuốt lỗi đọc ⇒ tạo bản ghi thứ hai (20/08/2026)
            if (existing) {
                /* PHIẾU ĐÃ CÓ: bản đầu bỏ qua hoàn toàn ⇒ paidAmount/paymentStatus chỉ ghi lúc tạo, phiếu HUTI đã
                 * trả bên KV vẫn "chưa trả" mãi trên Hạn Thanh Toán / MCP / Lịch tiền (rà soát độc lập 19/08/2026).
                 * Nay: KV `totalPayment` khác paidAmount → cập nhật đúng hai trường thanh toán (không đụng dòng
                 * hàng/tổng), rồi làm tươi phần dư payable của NCC để sổ = KV. Thiếu ≠ 0: KV bỏ trống totalPayment thì
                 * không đụng. */
                const kvDaTra = kv?.totalPayment
                if (kvDaTra !== undefined && kvDaTra !== null && Number.isFinite(Number(kvDaTra))) {
                    const daTraMoi = Number(kvDaTra)
                    const tong = Number(existing.totalCost) || 0
                    const ttMoi = daTraMoi >= tong ? 'paid' : daTraMoi > 0 ? 'partial' : 'unpaid'
                    if (Math.round(daTraMoi) !== Math.round(Number(existing.paidAmount) || 0) || ttMoi !== existing.paymentStatus) {
                        if (opts.apply) await sp.importReceipt.update({ where: { id: existing.id }, data: { paidAmount: daTraMoi, paymentStatus: ttMoi } })
                        c.updated++
                        noteSample(c, { code, hanhDong: 'cập nhật thanh toán', daTraCu: existing.paidAmount, daTraMoi, paymentStatus: ttMoi })
                        if (opts.apply) await saveMap(sp, 'purchaseOrder', kvId, code, existing.id)
                        continue
                    }
                }
                c.skipped++
                if (opts.apply) await saveMap(sp, 'purchaseOrder', kvId, code, existing.id)
                continue
            }

            // CHỈ LẤY PHIẾU NHẬP HOÀN THÀNH.
            // Phiếu đã xoá vẫn được KiotViet trả về, gắn hậu tố {DEL} vào mã;
            // 10/10 phiếu {DEL} đều status 4 (đo HUTI 06/08/2026). Status 3 là
            // nhóm phiếu bình thường (60/60). Chỉ nhận 3, bỏ hết phần còn lại —
            // nuốt phiếu huỷ vào là thổi phồng lịch sử mua hàng.
            if (/\{DEL\}/i.test(code) || Number(kv?.status) !== 3) { c.skipped++; continue }

            // NHÀ CUNG CẤP: KiotViet LƯỢC BỎ trường khi phiếu không gắn NCC, nên
            // có phiếu thấy supplierName/supplierCode, có phiếu không. Đừng kết
            // luận "API không trả NCC" chỉ vì xem trúng một phiếu cũ không gắn.
            // (`purchaseName` là NGƯỜI TẠO PHIẾU — không phải nhà cung cấp.)
            let supplierId: string | null = null
            if (kv?.supplierId) supplierId = await findMap(sp, 'supplier', kv.supplierId)
            const supplierName = String(
                kv?.supplierName || kv?.supplierCode || 'Không rõ (phiếu không gắn NCC)'
            ).slice(0, 200)

            // ImportReceiptItem.productId là KHOÁ NGOẠI BẮT BUỘC → chỉ dựng được
            // dòng cho mã đã có bên Kengi. Thiếu mã thì ghi rõ, không đẻ SP ma.
            const details: any[] = Array.isArray(kv?.purchaseOrderDetails) ? kv.purchaseOrderDetails
                : Array.isArray(kv?.details) ? kv.details : []
            const lines: any[] = []
            const missing: string[] = []
            for (const d of details) {
                const sku = String(d?.productCode || '').trim()
                const qty = Math.round(Number(d?.quantity) || 0)
                const gia = Number(d?.price) || 0
                const p = sku
                    ? await sp.product.findUnique({ where: { sku }, select: { id: true, name: true, sku: true } }).catch(() => null)
                    : null
                if (!p) { if (sku) missing.push(sku); continue }
                lines.push({
                    productId: p.id,
                    productName: p.name,
                    productSku: p.sku,
                    quantity: qty,
                    costPrice: gia,
                    discount: Number(d?.discount) || 0,
                    total: Number(d?.subTotal ?? (qty * gia)) || 0,
                })
            }
            if (missing.length) {
                noteError(c, `Phiếu nhập ${code}: ${missing.length} mã hàng chưa có bên Kengi (${missing.slice(0, 3).join(', ')}) — đồng bộ Hàng hoá trước`)
            }

            const total = Number(kv?.total) || 0
            const daTra = Number(kv?.totalPayment) || 0
            const when = kv?.purchaseDate ? new Date(kv.purchaseDate) : null
            const ngay = when && !isNaN(when.getTime()) ? when : new Date()

            if (opts.apply) {
                const created = await sp.importReceipt.create({
                    data: {
                        code, supplierId, supplierName,
                        totalCost: total,
                        totalItems: lines.reduce((s, l) => s + l.quantity, 0),
                        status: 'completed',          // KiotViet status 3 = đã hoàn tất
                        // Công nợ NCC suy từ số đã trả — mặc định của model là
                        // 'paid', để nguyên là mọi phiếu nợ đều biến mất khỏi báo cáo
                        paidAmount: daTra,
                        paymentStatus: daTra >= total ? 'paid' : daTra > 0 ? 'partial' : 'unpaid',
                        note: 'Nhập từ KiotViet',
                        userId: opts.systemUserId || '',
                        userName: 'KiotViet Sync',
                        transactionDate: ngay,
                        createdAt: ngay,              // ngày chứng từ gốc
                        ...(lines.length ? { items: { create: lines } } : {}),
                    },
                })
                await saveMap(sp, 'purchaseOrder', kvId, code, created.id)
                // GHI SỔ: Nợ 156 / Có 331 (+ 1331 nếu được khấu trừ) — điểm đứt 1
                await thuGhiSo(`Phiếu nhập ${code}`, () => postImportReceiptJournal(sp, created as any, {
                    branchId: (created as any).branchId ?? null,
                    userId: opts.systemUserId ?? null,
                    vatKhauTru: khauTruVat,
                }))
                // Thẻ kho: tách nhãn dòng điều chỉnh vô danh của đợt này (xem helper)
                for (const l of lines) {
                    const kq = await ganTheKhoPhieuNhap(sp, opts, { code, ngay, supplierId, supplierName }, l)
                    if (kq === 'ok') ganOk++
                    else ganGiu++
                }
            }
            c.created++
            noteSample(c, { code, ncc: supplierName, tong: total, daTra, soDong: lines.length, ngay: ngay.toISOString().slice(0, 10) })
        } catch (e: any) {
            noteError(c, `Phiếu nhập ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
    /* Không dùng noteError — nó tăng failed, mà đây là dòng THÔNG TIN. 'giữ' không
     * phải lỗi: phiếu cũ đã bị lượt trước hấp thụ thì đúng ra là phải giữ. */
    if (ganOk || ganGiu) {
        c.errors.push(`Thẻ kho: gắn ${ganOk} dòng theo mã phiếu nhập · giữ ${ganGiu} dòng dạng điều chỉnh (đã hấp thụ từ trước / tồn không đổi)`)
    }
}

// ─── TRẢ HÀNG BÁN (khách trả lại) ───────────────────────────────────────────

/**
 * KiotViet `/returns` → ReturnOrder + ReturnItem của Kengi.
 *
 * KHÔNG CỘNG KHO (`restocked: false`): tồn lấy từ `onHand` của KiotViet vốn đã
 * tính hàng trả về rồi. Chỉ lấy phiếu ĐÃ TRẢ XONG (status 1 = "Đã trả", đo trên
 * dữ liệu thật HUTI 06/08/2026).
 *
 * TRẢ HÀNG MUA (trả lại nhà cung cấp) KHÔNG CÓ trong Public API của KiotViet —
 * đã thử /purchaseReturns, /returnsupplier, /purchasereturns, /returnSuppliers,
 * /supplierreturns đều lỗi, và danh sách phiếu nhập chỉ có tiền tố PN (không có
 * phiếu trả trộn vào). Không dựng được thì nói thẳng, không bịa.
 */
export async function syncReturns(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            if (!kvId || !code) { c.skipped++; continue }
            // Chỉ nhận phiếu đã trả xong
            if (Number(kv?.status) !== 1) { c.skipped++; continue }

            const existing = await sp.returnOrder.findUnique({ where: { code } })   // chốt chống trùng: nuốt lỗi đọc ⇒ tạo bản ghi thứ hai (20/08/2026)
            if (existing) {
                c.skipped++
                if (opts.apply) await saveMap(sp, 'return', kvId, code, existing.id)
                continue
            }

            // Gắn về hoá đơn gốc nếu hoá đơn đó đã được đồng bộ
            let transactionId: string | null = null
            let originalInvoice = kv?.invoiceId ? `KV#${kv.invoiceId}` : code
            if (kv?.invoiceId) {
                transactionId = await findMap(sp, 'invoice', kv.invoiceId)
                if (transactionId) {
                    const tx = await sp.transaction.findUnique({
                        where: { id: transactionId }, select: { receiptNumber: true },
                    }).catch(() => null)
                    if (tx?.receiptNumber) originalInvoice = tx.receiptNumber
                }
            }

            const details: any[] = Array.isArray(kv?.returnDetails) ? kv.returnDetails : []
            const lines: any[] = []
            for (const d of details) {
                const sku = String(d?.productCode || '').trim()
                // productId của ReturnItem cho phép rỗng → thiếu hàng vẫn giữ được dòng
                const p = sku
                    ? await sp.product.findUnique({ where: { sku }, select: { id: true } }).catch(() => null)
                    : null
                lines.push({
                    productId: p?.id || null,
                    productName: String(d?.productName || sku || 'Hàng trả').slice(0, 200),
                    sku: sku || null,
                    quantity: Math.round(Number(d?.quantity) || 0),
                    unitPrice: Number(d?.price ?? d?.sellPrice) || 0,
                    restocked: false,   // kho đã phản ánh bên KiotViet, xem ghi chú trên
                })
            }
            if (!lines.length) { c.skipped++; continue }

            const when = kv?.returnDate ? new Date(kv.returnDate) : new Date()
            const date = isNaN(when.getTime()) ? new Date() : when
            const total = Number(kv?.returnTotal) || 0

            if (opts.apply) {
                const created = await sp.returnOrder.create({
                    data: {
                        code,
                        originalInvoice,
                        transactionId,
                        customerName: String(kv?.customerName || 'Khách lẻ').slice(0, 200),
                        status: 'refunded',            // đã trả xong bên KiotViet
                        reason: 'Nhập từ KiotViet',
                        refundAmount: Number(kv?.totalPayment) || total,
                        totalRefund: total,
                        notes: `Phí trả hàng: ${Number(kv?.returnFee) || 0}`,
                        processedAt: date,
                        refundedAt: date,
                        createdAt: date,               // ngày chứng từ gốc
                        items: { create: lines },
                    },
                })
                await saveMap(sp, 'return', kvId, code, created.id)
                /* GHI SỔ: Nợ 5212 / Có 111|131 + nhập lại kho — điểm đứt 1.
                 * KiotViet không cho biết giá vốn hàng trả nên KHÔNG ghi vế nhập
                 * lại kho (Nợ 156 / Có 632): ghi bừa một con số là làm sai giá vốn,
                 * còn bỏ trống thì bộ đối chiếu soi ra được. */
                await thuGhiSo(`Trả hàng ${code}`, () => postReturnJournal(sp, {
                    code,
                    customerName: String(kv?.customerName || '') || null,
                    originalInvoice,
                    totalRefund: total,
                    refundMethod: 'cash',
                    costValue: 0,
                    createdAt: date,
                }, { userId: opts.systemUserId ?? null }))
            }
            c.created++
            noteSample(c, { code, khach: kv?.customerName, tien: total, soDong: lines.length, ngay: date.toISOString().slice(0, 10) })
        } catch (e: any) {
            noteError(c, `Trả hàng ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

// ─── SỔ QUỸ: PHIẾU THU / PHIẾU CHI ──────────────────────────────────────────

/**
 * Một bản ghi sổ quỹ KiotViet ra PHIẾU THU (CashReceipt) hoặc PHIẾU CHI
 * (Expense) tuỳ chiều tiền.
 *
 * Tài liệu công khai không mô tả rõ trường nào chỉ chiều, nên dò theo nhiều dấu
 * hiệu và KHÔNG ĐOÁN BỪA: không suy được chiều thì BỎ QUA. Ghi nhầm chiều tiền
 * còn tệ hơn không ghi vì nó lặng lẽ làm lệch sổ quỹ.
 *
 * Phiếu chi vào trạng thái 'pending' (chờ duyệt) — giống phiếu bóc từ email —
 * để tiền chỉ vào sổ sau khi người dùng soát.
 */
export async function syncCashflow(sp: any, items: any[], opts: SyncOptions, c: SyncCounters): Promise<void> {
    for (const kv of items) {
        c.fetched++
        beat(opts, c)
        try {
            const kvId = kv?.id
            const code = String(kv?.code || '').trim()
            const amount = Math.abs(Number(kv?.amount) || 0)
            if (!kvId || !code || !amount) { c.skipped++; continue }

            // TRẠNG THÁI — đo trên dữ liệu thật của HUTI (06/08/2026):
            //   status 0 = "Đã thanh toán"  ← HỢP LỆ
            //   status 1 = "Đã hủy"          ← bỏ
            // Bản đầu tôi làm NGƯỢC (loại status 0), nên loại sạch 515/523 phiếu
            // hợp lệ và chỉ nhận đúng mấy phiếu đã huỷ. Đừng đảo lại lần nữa.
            if (Number(kv?.status) === 1 || /hủy|huỷ|cancel|void/i.test(String(kv?.statusValue || ''))) { c.skipped++; continue }

            const dir = cashflowDirection(kv)
            if (!dir) {
                noteError(c, `Sổ quỹ ${code}: không xác định được thu hay chi — bỏ qua để khỏi lệch sổ`)
                continue
            }

            // PHIẾU THU CỦA HOÁ ĐƠN ĐÃ TÍNH RỒI — bỏ qua, nếu không cùng một
            // khoản tiền vào sổ hai lần (xem ghi chú trong syncInvoices).
            if (dir === 'in' && (opts.invoicePaymentCodes?.has(code) || await findMap(sp, 'invoicePayment', code))) {
                c.skipped++; continue
            }

            const entity = dir === 'in' ? 'cashReceipt' : 'expense'
            const mapped = await findMap(sp, entity, kvId)
            if (mapped) { c.skipped++; continue }

            const when = kv?.transDate ? new Date(kv.transDate) : new Date()
            const date = isNaN(when.getTime()) ? new Date() : when
            // Tên đối tác nằm ở partnerName (đã đo trên dữ liệu thật)
            const partner = String(kv?.partnerName || kv?.contactName || '').trim()
            const note = [String(kv?.cashGroup || 'Sổ quỹ KiotViet'), partner].filter(Boolean).join(' — ').slice(0, 300)
            const viaBank = /transfer|bank|chuy/i.test(String(kv?.method || ''))

            /**
             * KHÁCH TRẢ NỢ → DebtEntry, KHÔNG PHẢI CashReceipt.
             *
             * Kengi ghi việc thu nợ vào sổ công nợ (DebtEntry type='payment') —
             * đó là thứ trang "Lịch sử công nợ" đọc. Bản trước tôi đổ hết phiếu
             * thu vào CashReceipt nên tiền có trong sổ quỹ nhưng lịch sử công nợ
             * TRỐNG TRƠN, khách nợ bao nhiêu cũng không thấy đã trả lần nào
             * (dính 07/08/2026).
             *
             * Customer.debt GIẢM theo phiếu thu — đổi thiết kế 11/08/2026.
             * Trước đây chỗ này ghi "không đụng debt vì số dư lấy thẳng từ
             * KiotViet", nhưng ảnh chụp đó chỉ tươi tại thời điểm đồng bộ
             * khách; webhook ghi chứng từ mới mà debt đứng yên là sổ trượt
             * (vụ in "Nợ cũ −2.817.040"). Nay MỌI chứng từ nợ qua sync đều
             * chỉnh debt như luồng POS gốc; chống trùng đã có map debtPayment.
             * `balance` để 0 vì trang tự tính lại luỹ kế khi hiển thị.
             */
            const laKhachTraNo = dir === 'in'
                && String(kv?.partnerType || '').toUpperCase() === 'C'
                && kv?.partnerId
            if (laKhachTraNo) {
                const localCus = await findMap(sp, 'customer', kv.partnerId)
                if (localCus) {
                    if (await findMap(sp, 'debtPayment', code)) { c.skipped++; continue }
                    /**
                     * CÙNG MỘT PHIẾU THU về qua HAI cửa: gắn trên hoá đơn
                     * (invoice.payments) VÀ nằm trong sổ quỹ. Webhook là các
                     * lượt chạy riêng nên bộ nhớ trong-lượt không đỡ được —
                     * phải hỏi map BỀN do đường hoá đơn ghi. Thiếu chốt này là
                     * cùng khoản tiền trừ nợ HAI lần (đo 11/08/2026: Việt Nhật
                     * −6.029.562, hoá đơn in "Nợ cũ −135.000").
                     */
                    if (opts.invoicePaymentCodes?.has(code) || await findMap(sp, 'invoicePayment', code)) {
                        boQua(c, `Phiếu thu ${code}: đã tính vào hoá đơn — không ghi lần hai`)
                        continue
                    }
                    if (opts.apply) {
                        const cus = await sp.customer.findUnique({
                            where: { id: localCus }, select: { name: true, phone: true },
                        }).catch(() => null)
                        const created = await sp.debtEntry.create({
                            data: {
                                customerId: localCus,
                                customerName: cus?.name || partner || 'Khách hàng',
                                phone: cus?.phone || null,
                                type: 'payment',
                                amount,
                                description: `Trả nợ — phiếu thu ${code} (KiotViet)`,
                                balance: 0,
                                createdAt: date,
                            },
                        })
                        await saveMap(sp, 'debtPayment', code, code, created.id)
                        await lamTuoiNoKhach(sp, opts, kv.partnerId)
                        /* HOTFIX 12/08/2026: NGUNG cong-tru debt theo chung tu — so du chi lay tu dong bo khach (kvDebt). Doc-driven drift lam cong no an dan ve 0. */
                    }
                    c.created++
                    noteSample(c, { code, chieu: 'THU NỢ', soTien: amount, khach: partner, ngay: date.toISOString().slice(0, 10) })
                    continue
                }
            }

            if (dir === 'in') {
                const dup = await sp.cashReceipt.findFirst({ where: { reference: code } })   // chốt chống trùng: nuốt lỗi đọc ⇒ tạo bản ghi thứ hai (20/08/2026)
                if (dup) { c.skipped++; if (opts.apply) await saveMap(sp, entity, kvId, code, dup.id); continue }
                if (opts.apply) {
                    const created = await sp.cashReceipt.create({
                        data: {
                            description: note, amount, category: 'other', date,
                            receivedVia: viaBank ? 'Chuyển khoản' : 'Tiền mặt',
                            customerName: partner ? partner.slice(0, 200) : null,
                            reference: code, status: 'active',
                            createdAt: date,   // ngày chứng từ gốc
                        },
                    })
                    await saveMap(sp, entity, kvId, code, created.id)
                }
            } else {
                const dup = await sp.expense.findFirst({ where: { sourceRef: `KV|${code}` } })   // chốt chống trùng: nuốt lỗi đọc ⇒ tạo bản ghi thứ hai (20/08/2026)
                if (dup) { c.skipped++; if (opts.apply) await saveMap(sp, entity, kvId, code, dup.id); continue }
                if (opts.apply) {
                    /* KHÔNG ghi sổ ở đây (điểm đứt 1 — cố ý chừa lại): phiếu chi
                     * này vào trạng thái `pending` = CHỜ DUYỆT, chưa được tính vào
                     * thống kê. Ghi bút toán cho một khoản chưa duyệt là đưa chi phí
                     * chưa ai xác nhận vào báo cáo lãi lỗ. Bút toán sinh khi chủ shop
                     * duyệt phiếu, theo đúng đường expenses.ts. */
                    const created = await sp.expense.create({
                        data: {
                            description: note, amount, category: 'Sổ quỹ KiotViet', date,
                            status: 'pending',        // CHỜ DUYỆT — chưa vào thống kê
                            supplierName: partner ? partner.slice(0, 200) : null,
                            sourceRef: `KV|${code}`,
                            createdAt: date,   // ngày chứng từ gốc
                        },
                    })
                    await saveMap(sp, entity, kvId, code, created.id)
                }
            }
            c.created++
            noteSample(c, { code, chieu: dir === 'in' ? 'THU' : 'CHI', soTien: amount, ngay: date.toISOString().slice(0, 10) })
        } catch (e: any) {
            noteError(c, `Sổ quỹ ${kv?.code || kv?.id}: ${e?.message || e}`)
        }
    }
}

/**
 * Dò chiều tiền của bản ghi sổ quỹ. Không chắc thì trả null (xem ghi chú trên).
 *
 * CHỐT TỪ DỮ LIỆU THẬT (HUTI, 06/08/2026 — không phải suy diễn từ tài liệu):
 *   THU: code TT…/TTHD… · cashGroup "Tiền khách trả" · origin "Pay"      ·
 *        partnerType "C" · amount DƯƠNG
 *   CHI: code PC…        · cashGroup "Tiền trả NCC"   · origin "Purchase" ·
 *        partnerType "S" · amount ÂM
 * Năm dấu hiệu này đi cùng nhau; xét lần lượt để một trường đổi tên bên KiotViet
 * không làm câm cả bộ.
 */
function cashflowDirection(kv: any): 'in' | 'out' | null {
    // 1. Nhóm sổ quỹ — chuỗi người đọc được, rõ nghĩa nhất
    const g = String(kv?.cashGroup || '').toLowerCase()
    if (/trả ncc|tra ncc|chi/.test(g)) return 'out'
    if (/khách trả|khach tra|thu/.test(g)) return 'in'

    // 2. Nguồn phát sinh
    const o = String(kv?.origin || '').toLowerCase()
    if (o === 'purchase') return 'out'
    if (o === 'pay') return 'in'

    // 3. Tiền tố mã phiếu
    const code = String(kv?.code || '').toUpperCase()
    if (/^(PC|CT|TC)/.test(code)) return 'out'
    if (/^TT/.test(code)) return 'in'

    // 4. Đối tác: S = nhà cung cấp (chi), C = khách hàng (thu)
    const p = String(kv?.partnerType || '').toUpperCase()
    if (p === 'S') return 'out'
    if (p === 'C') return 'in'

    // 5. Dấu của số tiền
    const raw = Number(kv?.amount)
    if (Number.isFinite(raw) && raw !== 0) return raw > 0 ? 'in' : 'out'

    return null
}

// ─── WEBHOOK ────────────────────────────────────────────────────────────────

/**
 * Chuẩn hoá payload webhook. KiotViet gửi khoá VIẾT HOA (`Notifications`,
 * `Action`, `Data`) nhưng tài liệu công khai không cam kết — nhận cả hai kiểu
 * để một lần đổi chữ hoa/thường bên họ không làm câm cả cổng nhận.
 */
export function parseWebhookPayload(body: any): { action: string; data: any[] }[] {
    const notis = body?.Notifications || body?.notifications
    if (!Array.isArray(notis)) return []
    return notis.map((n: any) => ({
        action: String(n?.Action || n?.action || '').toLowerCase(),
        data: Array.isArray(n?.Data || n?.data) ? (n.Data || n.data).map(chuanHoaKhoa) : [],
    })).filter(n => n.action)
}

/**
 * ĐƯA TÊN TRƯỜNG WEBHOOK VỀ CÙNG DẠNG VỚI REST API.
 *
 * KiotViet dùng HAI kiểu đặt tên tuỳ sự kiện (đo trên payload thật 08/08/2026):
 *   customer.update → PascalCase: Id, Code, Name, ContactNumber, TaxCode…
 *   stock.update    → PascalCase: ProductId, ProductCode, OnHand…
 *   invoice.update  → camelCase : id, code, purchaseDate, invoiceDetails…
 *
 * Các hàm đồng bộ viết theo REST API (camelCase), nên payload PascalCase vào là
 * mọi trường đều `undefined` → bản ghi bị bỏ qua lặng lẽ. Webhook khách hàng vì
 * vậy CHƯA BAO GIỜ chạy được. Hạ chữ đầu của mọi khoá là xong, và làm luôn cho
 * cả cấp con để phòng khi họ đổi thêm chỗ khác.
 */
function chuanHoaKhoa(v: any): any {
    if (Array.isArray(v)) return v.map(chuanHoaKhoa)
    if (!v || typeof v !== 'object' || v instanceof Date) return v
    const out: any = {}
    for (const [k, val] of Object.entries(v)) {
        if (k.startsWith('__')) continue          // __type: rác của .NET, bỏ
        const key = k.charAt(0).toLowerCase() + k.slice(1)
        // Giữ cả khoá gốc nếu đụng nhau, ưu tiên khoá đã chuẩn hoá
        out[key] = chuanHoaKhoa(val)
    }
    return out
}

/**
 * Kiểm chữ ký webhook.
 *
 * Tài liệu công khai của KiotViet KHÔNG mô tả công thức ký (đã tra 05/08/2026);
 * nguồn cộng đồng nói `x-signature` = HMAC-SHA256 của (data + timestamp +
 * retailerCode + secretKey) nhưng không rõ đâu là KHOÁ đâu là THÔNG ĐIỆP.
 * Nên ở đây thử vài biến thể hợp lý; khớp một cái là đạt.
 *
 * LỚP BẢO VỆ CHÍNH KHÔNG PHẢI CHỮ KÝ mà là TOKEN BÍ MẬT TRONG URL (32 byte
 * ngẫu nhiên) — kẻ lạ không đoán được đường dẫn thì không gọi tới được. Chữ ký
 * là lớp thứ hai: chưa bật `strictSignature` thì sai chữ ký vẫn nhận nhưng ghi
 * cờ để soi lại; bật rồi thì từ chối thẳng.
 */
export function verifyWebhookSignature(
    rawBody: string, signature: string, timestamp: string, retailer: string, secret: string,
): boolean {
    if (!secret || !signature) return false
    const candidates = [
        // (thông điệp, khoá)
        [rawBody + timestamp + retailer, secret],
        [rawBody + timestamp + retailer + secret, secret],
        [rawBody, secret],
        [rawBody + timestamp, secret],
        [timestamp + rawBody, secret],
    ]
    const given = signature.trim().toLowerCase()
    for (const [msg, key] of candidates) {
        const hex = crypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex').toLowerCase()
        const b64 = crypto.createHmac('sha256', key).update(msg, 'utf8').digest('base64')
        if (given === hex || signature.trim() === b64) return true
    }
    return false
}
