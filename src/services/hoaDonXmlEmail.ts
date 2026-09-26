/* ═══════════════════════════════════════════════════════════════════════════════
 *  HOÁ ĐƠN XML TỪ EMAIL → HÀNG ĐỢI NHẬP HÀNG / PHIẾU CHI CHỜ DUYỆT (26/09/2026)
 *
 *  Chủ shop: "trong phần email có file xml thì sẽ tự động nhập hàng hoặc lấy chi
 *  phí" → "cuối ngày quét 1 lần thôi". Đã chốt: KHÔNG gì tự vào sổ — hàng hoá thì
 *  chờ nhập, dịch vụ thì phiếu chi chờ duyệt; chủ shop soát rồi mới bấm.
 *
 *  Vì sao là HÀNG ĐỢI chứ không phải phiếu nhập nháp: ImportReceiptItem.productId
 *  bắt buộc — phiếu nháp không chứa được dòng hoá đơn CHƯA khớp mã hàng, mà đó
 *  chính là phần cần người quyết (liên kết mã có sẵn hay tạo mã mới). Nên hoá đơn
 *  nằm trong hàng đợi; bấm "Nhập hàng" là mở vào ĐÚNG form Nhập hàng hiện có, y hệt
 *  khi chọn file XML tay (lib/hoaDonDauVao.ts dùng chung).
 *
 *  Luồng quét (chỉ ĐỌC hộp thư — không đánh dấu đã đọc, không xoá thư):
 *    1. tìm thư từ mốc lần quét trước, lọc thư có tệp .xml / .zip (xem cấu trúc
 *       thư trước, chỉ tải thư có tệp)
 *    2. đọc XML hoá đơn TT78 (zip thì giải nén lấy .xml)
 *    3. bỏ: không phải hoá đơn, hoá đơn BÁN RA của chính cửa hàng
 *    4. chống trùng: đã trong hàng đợi (khoá MST|ký hiệu|số) hoặc ĐÃ trong sổ
 *       (phiếu nhập / phiếu chi cùng MST + số HĐ) → ghi 'da-co', không làm gì thêm
 *    5. phân loại hàng hoá / dịch vụ / chưa rõ (xem phanLoai)
 *    6. dịch vụ rõ ràng → phiếu chi CHỜ DUYỆT; còn lại → hàng đợi Nhập Hàng
 *
 *  Đường quay lại: phiếu chi chờ duyệt tạo nhầm → "Chuyển sang nhập hàng" huỷ
 *  phiếu chi (chỉ khi còn chờ duyệt) và đưa hoá đơn về hàng đợi.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { loadMailboxCfg, withImap } from '../lib/hopThuImap'
import {
    parseVnEInvoiceXml, laXmlHoaDon, khopSanPhamHoaDon, hoaDonDaCo, mstCuaHang,
    chuanMst, chuanSoHoaDon, type HoaDonXml, type ParsedInvoiceItem,
} from '../lib/hoaDonDauVao'
import { layXmlTrongZip } from '../lib/giaiNenZip'
import { moTaLoi } from '../lib/gomLoi'

const BANG = '"HoaDonEmailXml"'
const BANG_LUOT = '"HoaDonEmailLuotQuet"'

/* Chặn cứng để một hộp thư lớn không kéo sập máy 512 MiB / pool 1 kết nối */
const TOI_DA_THU_XET = 800            // số thư xem cấu trúc mỗi lượt
const TOI_DA_THU_TAI = 200            // số thư có tệp được tải về
const TOI_DA_BYTE_THU = 25 * 1024 * 1024
const TOI_DA_BYTE_XML = 2 * 1024 * 1024
const TOI_DA_TONG_BYTE = 40 * 1024 * 1024
const TOI_DA_NGAY = 45

// ─── Bảng (tạo lười trong schema cửa hàng — cùng nếp UpgradeRequest) ─────────
const daTaoBang = new Set<string>()
async function tenSchema(prisma: any): Promise<string> {
    const s = (prisma as any).__schema
    if (typeof s === 'string' && s) return s
    const r: any[] = await prisma.$queryRawUnsafe('SELECT current_schema() AS s')
    return String(r[0]?.s || 'mac-dinh')
}

export async function damBaoBang(prisma: any): Promise<void> {
    const schema = await tenSchema(prisma)
    if (daTaoBang.has(schema)) return
    const cau = [
        `CREATE TABLE IF NOT EXISTS ${BANG} (
            "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            "khoa" TEXT NOT NULL,
            "sellerTaxCode" TEXT, "sellerName" TEXT,
            "buyerTaxCode" TEXT, "buyerName" TEXT,
            "mauSo" TEXT, "kyHieu" TEXT, "invoiceNo" TEXT, "invoiceDate" TIMESTAMP(3),
            "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
            "vatTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
            "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
            "soDong" INTEGER NOT NULL DEFAULT 0,
            "soDongKhop" INTEGER NOT NULL DEFAULT 0,
            "loai" TEXT NOT NULL,
            "lyDoPhanLoai" TEXT,
            "trangThai" TEXT NOT NULL DEFAULT 'cho',
            "tinhChat" TEXT, "canhBao" TEXT, "daCoO" TEXT,
            "xml" TEXT NOT NULL,
            "tenTep" TEXT, "emailFrom" TEXT, "emailSubject" TEXT, "emailDate" TIMESTAMP(3),
            "importReceiptId" TEXT, "expenseId" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonEmailXml_khoa_key" ON ${BANG} ("khoa")`,
        `CREATE INDEX IF NOT EXISTS "HoaDonEmailXml_trangThai_idx" ON ${BANG} ("trangThai")`,
        `CREATE TABLE IF NOT EXISTS ${BANG_LUOT} (
            "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            "cheDo" TEXT NOT NULL,
            "batDau" TIMESTAMP(3) NOT NULL DEFAULT now(),
            "xong" TIMESTAMP(3),
            "tuNgay" TIMESTAMP(3),
            "trangThai" TEXT NOT NULL DEFAULT 'dang',
            "soThu" INTEGER NOT NULL DEFAULT 0, "soTep" INTEGER NOT NULL DEFAULT 0,
            "moiHang" INTEGER NOT NULL DEFAULT 0, "moiChiPhi" INTEGER NOT NULL DEFAULT 0,
            "moiChuaRo" INTEGER NOT NULL DEFAULT 0, "daCo" INTEGER NOT NULL DEFAULT 0,
            "boQua" INTEGER NOT NULL DEFAULT 0, "loi" INTEGER NOT NULL DEFAULT 0,
            "ketQua" TEXT
        )`,
    ]
    for (const c of cau) {
        try { await prisma.$executeRawUnsafe(c) }
        catch (e: any) {
            // Hai bản máy cùng tạo một lúc: Postgres có thể ném trùng dù có IF NOT EXISTS
            if (!/already exists|duplicate key value/i.test(String(e?.message || ''))) throw e
        }
    }
    daTaoBang.add(schema)
}

async function coBang(prisma: any): Promise<boolean> {
    const r: any[] = await prisma.$queryRawUnsafe(`SELECT to_regclass('"HoaDonEmailXml"') IS NOT NULL AS co`)
    return !!r[0]?.co
}

// ─── Phân loại hàng hoá / dịch vụ ────────────────────────────────────────────
/* Từ khoá dịch vụ — so theo TỪ NGUYÊN VẸN (\p{L} hai bên): "phí" không được bắt
 * "bàn phím", "thuê" không bắt "thuế". Cố ý KHÔNG có "máy chủ"/"lưu trữ" — trùng tên
 * hàng thật (máy chủ Dell, ổ cứng lưu trữ). Chỉ dùng khi KHÔNG dòng nào khớp mã hàng
 * và NCC chưa từng có phiếu nhập — tức là lời gợi ý, người vẫn duyệt. */
const TU_DICH_VU = /(?<!\p{L})(cước|phí|dịch vụ|thuê|thuê bao|tiền điện|điện năng|điện sinh hoạt|tiền nước|nước sinh hoạt|internet|viễn thông|truyền hình|vận chuyển|giao hàng|chuyển phát|quảng cáo|hoa hồng|phần mềm|bản quyền|gia hạn|tên miền|hosting|bảo hiểm|sửa chữa|bảo trì|bảo dưỡng|lắp đặt|tư vấn|đào tạo|kiểm định|xăng|dầu diesel)(?!\p{L})/iu
const DVT_DICH_VU = /^(tháng|kwh|m3|m³|lần|gói|năm|chuyến|km|giờ|dịch vụ|dv|kỳ)$/iu

function laDongDichVu(it: ParsedInvoiceItem): boolean {
    return TU_DICH_VU.test(it.name) || DVT_DICH_VU.test(String(it.unit || '').trim())
}

async function nccCoPhieuNhap(prisma: any, mst: string, ten: string): Promise<boolean> {
    const r: any[] = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM "ImportReceipt" r LEFT JOIN "Supplier" s ON s.id = r."supplierId"
          WHERE r.status <> 'cancelled'
            AND (($1 <> '' AND regexp_replace(COALESCE(s."taxCode", ''), '[^0-9-]', '', 'g') = $1)
                 OR ($2 <> '' AND lower(trim(COALESCE(r."supplierName", ''))) = $2))
          LIMIT 1`, mst, ten.trim().toLowerCase())
    return r.length > 0
}

async function nccCoChiPhiDaDuyet(prisma: any, mst: string): Promise<boolean> {
    if (!mst) return false
    // Chỉ phiếu chi ĐÃ DUYỆT mới là bằng chứng — phiếu chờ có thể chính là phiếu
    // tự tạo nhầm (quét thân thư không phân biệt hàng/dịch vụ)
    const r: any[] = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM "Expense" WHERE status = 'active'
            AND regexp_replace(COALESCE("supplierTaxCode", ''), '[^0-9-]', '', 'g') = $1 LIMIT 1`, mst)
    return r.length > 0
}

export async function phanLoai(prisma: any, hd: HoaDonXml, soDongKhop: number): Promise<{ loai: 'hang' | 'chiphi' | 'chua-ro'; lyDo: string }> {
    const n = hd.items.length
    const mst = chuanMst(hd.sellerTaxCode)
    if (soDongKhop > 0) return { loai: 'hang', lyDo: `${soDongKhop}/${n} dòng khớp mã hàng trong kho` }
    if (await nccCoPhieuNhap(prisma, mst, hd.sellerName)) return { loai: 'hang', lyDo: 'NCC này từng có phiếu nhập hàng' }
    if (await nccCoChiPhiDaDuyet(prisma, mst)) return { loai: 'chiphi', lyDo: 'NCC này trước đây đã duyệt vào chi phí' }
    const dv = hd.items.filter(laDongDichVu)
    if (n > 0 && dv.length === n) return { loai: 'chiphi', lyDo: `mọi dòng là dịch vụ (${dv[0].name.slice(0, 60)})` }
    return {
        loai: 'chua-ro',
        lyDo: dv.length ? `${dv.length}/${n} dòng giống dịch vụ, còn lại chưa khớp mã hàng` : 'chưa khớp mã hàng nào, NCC chưa từng nhập',
    }
}

// ─── Tiện ích ────────────────────────────────────────────────────────────────
function ngayHd(s: string): Date | null {
    const t = String(s || '').trim()
    if (!t) return null
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00:00+07:00` : t)
    return isNaN(d.getTime()) ? null : d
}

function khoaHoaDon(hd: HoaDonXml): string {
    return `${chuanMst(hd.sellerTaxCode) || 'NA'}|${`${hd.mauSo}${hd.kyHieu}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}|${chuanSoHoaDon(hd.invoiceNumber)}`
}

function moTaChiPhi(hd: HoaDonXml): string {
    const dong = hd.items.slice(0, 3).map(i => i.name).join('; ')
    const them = hd.items.length > 3 ? ` (+${hd.items.length - 3} dòng)` : ''
    return `HĐ ${hd.mauSo}${hd.kyHieu} số ${hd.invoiceNumber} — ${hd.sellerName || 'NCC'}: ${dong}${them}`.slice(0, 500)
}

async function taoPhieuChiCho(prisma: any, hd: HoaDonXml, khoa: string): Promise<string> {
    const e = await prisma.expense.create({
        data: {
            description: moTaChiPhi(hd),
            amount: hd.totals.grandTotal,
            category: 'Hoá đơn đầu vào',
            date: ngayHd(hd.invoiceDate) || new Date(),
            status: 'pending',               // CHỜ DUYỆT — chưa vào thống kê
            vatAmount: hd.totals.vatTotal || 0,
            supplierName: hd.sellerName || null,
            supplierTaxCode: chuanMst(hd.sellerTaxCode) || null,
            invoiceNo: hd.invoiceNumber,
            invoiceSymbol: `${hd.mauSo}${hd.kyHieu}` || null,
            invoiceDate: ngayHd(hd.invoiceDate),
            sourceRef: khoa,
        },
        select: { id: true },
    })
    return e.id
}

/** Tệp XML lấy từ một thư (kèm thông tin thư để còn lần ngược). */
interface TepXml { ten: string; xml: string; emailFrom: string; emailSubject: string; emailDate: Date | null }

function coTepHoaDon(node: any): boolean {
    if (!node) return false
    const ten = String(node.dispositionParameters?.filename || node.parameters?.name || '').toLowerCase()
    const kieu = String(node.type || '').toLowerCase()
    if (/\.(xml|zip)$/.test(ten)) return true
    if (/(\/xml|\/zip|x-zip)/.test(kieu) && !/^text\/html/.test(kieu)) return true
    return Array.isArray(node.childNodes) && node.childNodes.some(coTepHoaDon)
}

// ─── QUÉT ────────────────────────────────────────────────────────────────────
export type CheDoQuet = 'tu-dong' | 'tay' | 'chay-thu'
export interface KetQuaQuet {
    cheDo: CheDoQuet
    tuNgay: string
    soThu: number
    soTep: number
    moiHang: number
    moiChiPhi: number
    moiChuaRo: number
    daCo: number
    boQua: number
    loi: string[]
    ghiChu: string[]
    mau: Array<{ ncc: string; mst: string; so: string; ngay: string; tong: number; loai: string; lyDo: string; ketQua: string }>
}

export async function quetHoaDonXmlEmail(prisma: any, opts: { cheDo: CheDoQuet; soNgay?: number }): Promise<KetQuaQuet> {
    const cfg = await loadMailboxCfg(prisma)
    if (!cfg) throw new Error('Chưa gắn hộp thư (Hộp Thư → Kết nối Gmail)')
    const ghi = opts.cheDo !== 'chay-thu'
    if (ghi) await damBaoBang(prisma)
    const daCoBang = ghi || await coBang(prisma)

    /* MỐC: lần quét thành công gần nhất lùi 1 ngày (IMAP SINCE tính theo NGÀY, và
     * thư có thể tới trễ) — trùng lặp đã có khoá chống; chưa quét bao giờ → 7 ngày. */
    let tuNgay: Date
    if (opts.soNgay) {
        tuNgay = new Date(Date.now() - Math.min(TOI_DA_NGAY, Math.max(1, opts.soNgay)) * 86400_000)
    } else {
        const cuoi: any[] = daCoBang ? await prisma.$queryRawUnsafe(
            `SELECT "batDau" FROM ${BANG_LUOT} WHERE "trangThai" = 'xong' AND "cheDo" <> 'chay-thu' ORDER BY "batDau" DESC LIMIT 1`) : []
        const moc = cuoi[0]?.batDau ? new Date(cuoi[0].batDau).getTime() - 86400_000 : Date.now() - 7 * 86400_000
        tuNgay = new Date(Math.max(moc, Date.now() - TOI_DA_NGAY * 86400_000))
    }

    const kq: KetQuaQuet = {
        cheDo: opts.cheDo, tuNgay: tuNgay.toISOString(), soThu: 0, soTep: 0,
        moiHang: 0, moiChiPhi: 0, moiChuaRo: 0, daCo: 0, boQua: 0, loi: [], ghiChu: [], mau: [],
    }
    let luotId: string | null = null
    if (ghi) {
        const r: any[] = await prisma.$queryRawUnsafe(
            `INSERT INTO ${BANG_LUOT} ("cheDo", "tuNgay") VALUES ($1, $2) RETURNING "id"`, opts.cheDo, tuNgay)
        luotId = r[0]?.id || null
    }

    try {
        // ── 1–2. Đọc hộp thư: gom XML vào bộ nhớ rồi ĐÓNG kết nối IMAP trước khi đụng DB ──
        const tep: TepXml[] = []
        const { simpleParser } = require('mailparser') as typeof import('mailparser')
        await withImap(cfg, async (client) => {
            const lock = await client.getMailboxLock('INBOX', { readOnly: true })
            try {
                const uids = (await client.search({ since: tuNgay }, { uid: true }) as number[]) || []
                const xet = uids.slice(-TOI_DA_THU_XET)
                if (uids.length > xet.length) kq.ghiChu.push(`Hộp thư có ${uids.length} thư từ mốc quét — chỉ xét ${xet.length} thư mới nhất`)
                const canTai: number[] = []
                if (xet.length) {
                    for await (const m of client.fetch(xet.join(','), { uid: true, bodyStructure: true, size: true }, { uid: true })) {
                        if (Number(m.size) > TOI_DA_BYTE_THU) continue
                        if (coTepHoaDon(m.bodyStructure)) canTai.push(Number(m.uid))
                    }
                }
                const tai = canTai.slice(-TOI_DA_THU_TAI)
                if (canTai.length > tai.length) kq.ghiChu.push(`${canTai.length} thư có tệp — lượt này chỉ đọc ${tai.length} thư mới nhất, lượt sau đọc tiếp`)
                let tongByte = 0
                for (const uid of tai) {
                    if (tongByte > TOI_DA_TONG_BYTE) { kq.ghiChu.push('Chạm trần dung lượng một lượt — phần còn lại để lượt sau'); break }
                    const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
                    if (!msg?.source) continue
                    kq.soThu++
                    const mail = await simpleParser(msg.source)
                    const meta = {
                        emailFrom: String(mail.from?.text || '').slice(0, 300),
                        emailSubject: String(mail.subject || '').slice(0, 500),
                        emailDate: mail.date instanceof Date ? mail.date : null,
                    }
                    for (const a of mail.attachments || []) {
                        const ten = String(a.filename || '').trim()
                        const noiDung: Buffer | undefined = a.content
                        if (!noiDung?.length) continue
                        if (/\.zip$/i.test(ten) || /zip/i.test(String(a.contentType || ''))) {
                            for (const z of layXmlTrongZip(noiDung)) {
                                if (z.noiDung.length > TOI_DA_BYTE_XML) continue
                                tongByte += z.noiDung.length
                                tep.push({ ten: `${ten} › ${z.ten}`, xml: z.noiDung.toString('utf8'), ...meta })
                            }
                        } else if (/\.xml$/i.test(ten) || /xml/i.test(String(a.contentType || ''))) {
                            if (noiDung.length > TOI_DA_BYTE_XML) continue
                            tongByte += noiDung.length
                            tep.push({ ten, xml: noiDung.toString('utf8'), ...meta })
                        }
                    }
                }
            } finally { lock.release() }
        })
        kq.soTep = tep.length

        // ── 3–6. Xử lý TUẦN TỰ (pool 1 kết nối — không Promise.all) ──
        const mstMinh = await mstCuaHang(prisma)
        const daXuLy = new Set<string>()
        for (const t of tep) {
            try {
                if (!laXmlHoaDon(t.xml)) { kq.boQua++; continue }      // tờ khai thuế, XML lạ…
                const hd = parseVnEInvoiceXml(t.xml)
                if (!hd.invoiceNumber || hd.items.length === 0) { kq.boQua++; continue }
                const mstBan = chuanMst(hd.sellerTaxCode)
                if (mstBan && mstMinh.includes(mstBan)) { kq.boQua++; continue }   // hoá đơn BÁN RA của mình
                const khoa = khoaHoaDon(hd)
                if (daXuLy.has(khoa)) continue                               // cùng hoá đơn gửi 2 lần trong lượt
                daXuLy.add(khoa)

                if (daCoBang) {
                    const tonTai: any[] = await prisma.$queryRawUnsafe(`SELECT 1 FROM ${BANG} WHERE "khoa" = $1 LIMIT 1`, khoa)
                    if (tonTai.length) { kq.daCo++; continue }             // lượt trước đã lấy
                }

                const ngay = ngayHd(hd.invoiceDate)
                const trongSo = await hoaDonDaCo(prisma, {
                    mst: mstBan, so: hd.invoiceNumber, kyHieu: hd.kyHieu,
                    tenNcc: hd.sellerName, nam: ngay ? ngay.getFullYear() : null,
                })

                // Khớp mã hàng trên BẢN SAO dòng — dữ liệu gốc của hoá đơn giữ nguyên trong XML
                const banSao = hd.items.map(i => ({ ...i }))
                await khopSanPhamHoaDon(prisma, banSao, { autoCreate: false })
                const soDongKhop = banSao.filter(i => i.matched).length
                const pl = await phanLoai(prisma, hd, soDongKhop)

                const canhBao: string[] = []
                const mstMua = chuanMst(hd.buyerTaxCode)
                if (mstMua && mstMinh.length && !mstMinh.includes(mstMua)) canhBao.push(`MST người mua ${mstMua} không phải MST cửa hàng`)
                if (hd.tinhChat) canhBao.push(`Hoá đơn ${hd.tinhChat === 'thay-the' ? 'THAY THẾ' : 'ĐIỀU CHỈNH'} cho HĐ số ${hd.hoaDonLienQuan || '?'} — kiểm HĐ gốc trước khi nhập`)
                if (!(hd.totals.grandTotal > 0)) canhBao.push('XML thiếu tổng tiền thanh toán')

                // Chỉ dịch vụ RÕ RÀNG và không vướng cảnh báo mới tự thành phiếu chi chờ duyệt
                const tuChiPhi = !trongSo && pl.loai === 'chiphi' && canhBao.length === 0
                const trangThai = trongSo ? 'da-co' : tuChiPhi ? 'da-chi-phi' : 'cho'
                const ketQua = trongSo ? `đã có trong sổ (${trongSo.ma})`
                    : tuChiPhi ? 'phiếu chi chờ duyệt'
                    : pl.loai === 'chiphi' ? 'chờ xem (giống chi phí nhưng có cảnh báo)'
                    : 'chờ nhập hàng'

                if (kq.mau.length < 30) kq.mau.push({
                    ncc: hd.sellerName.slice(0, 80), mst: mstBan, so: hd.invoiceNumber,
                    ngay: hd.invoiceDate, tong: hd.totals.grandTotal, loai: pl.loai, lyDo: pl.lyDo, ketQua,
                })
                if (trongSo) kq.daCo++
                else if (tuChiPhi) kq.moiChiPhi++
                else if (pl.loai === 'hang') kq.moiHang++
                else kq.moiChuaRo++
                if (!ghi) continue

                let expenseId: string | null = null
                if (tuChiPhi) expenseId = await taoPhieuChiCho(prisma, hd, khoa)
                await prisma.$executeRawUnsafe(
                    `INSERT INTO ${BANG} ("khoa", "sellerTaxCode", "sellerName", "buyerTaxCode", "buyerName",
                        "mauSo", "kyHieu", "invoiceNo", "invoiceDate", "subtotal", "vatTotal", "grandTotal",
                        "soDong", "soDongKhop", "loai", "lyDoPhanLoai", "trangThai", "tinhChat", "canhBao", "daCoO",
                        "xml", "tenTep", "emailFrom", "emailSubject", "emailDate", "expenseId")
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
                     ON CONFLICT ("khoa") DO NOTHING`,
                    khoa, mstBan || null, hd.sellerName || null, mstMua || null, hd.buyerName || null,
                    hd.mauSo || null, hd.kyHieu || null, hd.invoiceNumber, ngay,
                    hd.totals.subtotal || 0, hd.totals.vatTotal || 0, hd.totals.grandTotal || 0,
                    hd.items.length, soDongKhop, pl.loai, pl.lyDo, trangThai, hd.tinhChat,
                    canhBao.join(' · ') || null, trongSo ? trongSo.ma : null,
                    t.xml, t.ten.slice(0, 300), t.emailFrom || null, t.emailSubject || null, t.emailDate, expenseId,
                )
            } catch (e) {
                kq.loi.push(`${t.ten}: ${moTaLoi(e).slice(0, 200)}`)
            }
        }

        if (luotId) await prisma.$executeRawUnsafe(
            `UPDATE ${BANG_LUOT} SET "trangThai" = 'xong', "xong" = now(), "soThu" = $2, "soTep" = $3,
                "moiHang" = $4, "moiChiPhi" = $5, "moiChuaRo" = $6, "daCo" = $7, "boQua" = $8, "loi" = $9, "ketQua" = $10
              WHERE "id" = $1`,
            luotId, kq.soThu, kq.soTep, kq.moiHang, kq.moiChiPhi, kq.moiChuaRo, kq.daCo, kq.boQua, kq.loi.length,
            [...kq.ghiChu, ...kq.loi.slice(0, 10)].join('\n').slice(0, 4000) || null)
        return kq
    } catch (e) {
        if (luotId) await prisma.$executeRawUnsafe(
            `UPDATE ${BANG_LUOT} SET "trangThai" = 'loi', "xong" = now(), "ketQua" = $2 WHERE "id" = $1`,
            luotId, moTaLoi(e).slice(0, 2000)).catch(() => { })
        throw e
    }
}

// ─── HÀNG ĐỢI: danh sách + thao tác ──────────────────────────────────────────
const COT_DS = `"id", "sellerTaxCode", "sellerName", "mauSo", "kyHieu", "invoiceNo", "invoiceDate",
    "subtotal", "vatTotal", "grandTotal", "soDong", "soDongKhop", "loai", "lyDoPhanLoai", "trangThai",
    "tinhChat", "canhBao", "daCoO", "tenTep", "emailSubject", "emailDate", "expenseId", "importReceiptId", "createdAt"`

export async function danhSachHoaDonXml(prisma: any): Promise<{ cho: any[]; chiPhiGanDay: any[]; luotCuoi: any | null; daGanHopThu: boolean }> {
    const daGanHopThu = !!(await loadMailboxCfg(prisma))
    if (!(await coBang(prisma))) return { cho: [], chiPhiGanDay: [], luotCuoi: null, daGanHopThu }

    /* Dọn trước khi liệt kê: hoá đơn đang chờ mà người dùng đã nhập TAY bằng file
     * (không qua hàng đợi) → đánh dấu 'da-co' để danh sách không mời nhập lần hai. */
    const cho: any[] = await prisma.$queryRawUnsafe(`SELECT ${COT_DS} FROM ${BANG} WHERE "trangThai" = 'cho' ORDER BY "invoiceDate" DESC NULLS LAST LIMIT 200`)
    const conLai: any[] = []
    for (const r of cho) {
        const ngay = r.invoiceDate ? new Date(r.invoiceDate) : null
        const trongSo = await hoaDonDaCo(prisma, { mst: r.sellerTaxCode || '', so: r.invoiceNo, kyHieu: r.kyHieu, tenNcc: r.sellerName, nam: ngay ? ngay.getFullYear() : null })
        if (trongSo) {
            await prisma.$executeRawUnsafe(
                `UPDATE ${BANG} SET "trangThai" = 'da-co', "daCoO" = $2, "updatedAt" = now() WHERE "id" = $1 AND "trangThai" = 'cho'`,
                r.id, trongSo.ma)
            continue
        }
        conLai.push(r)
    }
    const chiPhiGanDay: any[] = await prisma.$queryRawUnsafe(
        `SELECT ${COT_DS} FROM ${BANG} WHERE "trangThai" = 'da-chi-phi' AND "updatedAt" > now() - interval '14 days'
          ORDER BY "invoiceDate" DESC NULLS LAST LIMIT 50`)
    const luot: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM ${BANG_LUOT} ORDER BY "batDau" DESC LIMIT 1`)
    return { cho: conLai, chiPhiGanDay, luotCuoi: luot[0] || null, daGanHopThu }
}

async function docDong(prisma: any, id: string): Promise<any> {
    await damBaoBang(prisma)
    const r: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM ${BANG} WHERE "id" = $1`, id)
    if (!r.length) throw Object.assign(new Error('Không tìm thấy hoá đơn trong hàng đợi'), { status: 404 })
    return r[0]
}

/** Mở hoá đơn vào form Nhập hàng: trả ĐÚNG dạng của POST /import-data/parse-invoice. */
export async function phanTichHoaDonXml(prisma: any, id: string): Promise<any> {
    const r = await docDong(prisma, id)
    const hd = parseVnEInvoiceXml(String(r.xml || ''))
    await khopSanPhamHoaDon(prisma, hd.items, { autoCreate: false })
    return { ...hd, hoaDonEmailId: r.id, trangThai: r.trangThai, canhBao: r.canhBao || null }
}

export async function danhDauDaNhap(prisma: any, id: string, importReceiptId: string): Promise<void> {
    const r = await docDong(prisma, id)
    const pn = await prisma.importReceipt.findUnique({ where: { id: String(importReceiptId) }, select: { id: true } })
    if (!pn) throw Object.assign(new Error('Không tìm thấy phiếu nhập vừa tạo'), { status: 400 })
    await prisma.$executeRawUnsafe(
        `UPDATE ${BANG} SET "trangThai" = 'da-nhap', "importReceiptId" = $2, "updatedAt" = now() WHERE "id" = $1`,
        r.id, pn.id)
}

export async function chuyenThanhChiPhi(prisma: any, id: string): Promise<{ expenseId: string }> {
    const r = await docDong(prisma, id)
    if (r.trangThai === 'da-nhap') throw Object.assign(new Error('Hoá đơn này đã nhập hàng — không chuyển sang chi phí được'), { status: 409 })
    if (r.expenseId) {
        const e = await prisma.expense.findUnique({ where: { id: r.expenseId }, select: { id: true, status: true } })
        if (e && e.status !== 'cancelled') {
            await prisma.$executeRawUnsafe(`UPDATE ${BANG} SET "trangThai" = 'da-chi-phi', "updatedAt" = now() WHERE "id" = $1`, r.id)
            return { expenseId: e.id }
        }
    }
    const hd = parseVnEInvoiceXml(String(r.xml || ''))
    const ngay = ngayHd(hd.invoiceDate)
    const trongSo = await hoaDonDaCo(prisma, { mst: chuanMst(hd.sellerTaxCode), so: hd.invoiceNumber, kyHieu: hd.kyHieu, tenNcc: hd.sellerName, nam: ngay ? ngay.getFullYear() : null })
    if (trongSo) throw Object.assign(new Error(`Hoá đơn đã có trong sổ (${trongSo.ma}) — không tạo thêm phiếu chi`), { status: 409 })
    const expenseId = await taoPhieuChiCho(prisma, hd, r.khoa)
    await prisma.$executeRawUnsafe(
        `UPDATE ${BANG} SET "trangThai" = 'da-chi-phi', "loai" = 'chiphi', "expenseId" = $2, "updatedAt" = now() WHERE "id" = $1`,
        r.id, expenseId)
    return { expenseId }
}

export async function boQuaHoaDonXml(prisma: any, id: string): Promise<void> {
    const r = await docDong(prisma, id)
    if (r.trangThai !== 'cho') throw Object.assign(new Error('Chỉ bỏ qua được hoá đơn đang chờ'), { status: 409 })
    await prisma.$executeRawUnsafe(`UPDATE ${BANG} SET "trangThai" = 'bo-qua', "updatedAt" = now() WHERE "id" = $1`, r.id)
}

/** Phiếu chi tự tạo nhầm (thật ra là hàng) → huỷ phiếu chi CHỜ DUYỆT, đưa về hàng đợi nhập hàng. */
export async function veNhapHang(prisma: any, id: string): Promise<void> {
    const r = await docDong(prisma, id)
    if (r.trangThai !== 'da-chi-phi') throw Object.assign(new Error('Hoá đơn này không ở dạng phiếu chi'), { status: 409 })
    if (r.expenseId) {
        const e = await prisma.expense.findUnique({ where: { id: r.expenseId }, select: { id: true, status: true } })
        if (e && e.status === 'active') {
            throw Object.assign(new Error('Phiếu chi đã được DUYỆT — huỷ phiếu chi ở trang Chi phí trước rồi mới chuyển sang nhập hàng'), { status: 409 })
        }
        if (e && e.status === 'pending') {
            await prisma.expense.update({
                where: { id: e.id },
                data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Chuyển sang nhập hàng (hoá đơn XML từ email)' },
            })
        }
    }
    await prisma.$executeRawUnsafe(
        `UPDATE ${BANG} SET "trangThai" = 'cho', "loai" = 'hang', "expenseId" = NULL, "updatedAt" = now() WHERE "id" = $1`, r.id)
}

/** Quét thân thư (scan-invoices) hỏi: hoá đơn này đã nằm trong hàng đợi XML chưa? */
export async function trongHangDoiXml(prisma: any, mst: string, so: string): Promise<boolean> {
    if (!(await coBang(prisma))) return false
    const r: any[] = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM ${BANG} WHERE "trangThai" IN ('cho', 'da-nhap', 'da-chi-phi')
            AND COALESCE("sellerTaxCode", '') = $1
            AND regexp_replace(regexp_replace(COALESCE("invoiceNo", ''), '\\D', '', 'g'), '^0+', '') = $2 LIMIT 1`,
        chuanMst(mst), chuanSoHoaDon(so))
    return r.length > 0
}
