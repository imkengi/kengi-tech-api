// ─────────────────────────────────────────────────────────────────────────────
//  HOÁ ĐƠN ĐẦU VÀO (HĐĐT chuẩn TT78) — ĐỌC XML + KHỚP MÃ HÀNG
//
//  Tách từ routes/importData.ts (26/09/2026) để DÙNG CHUNG cho hai đường:
//    - POST /import-data/parse-invoice  — người dùng chọn file XML ở Nhập Hàng
//    - services/hoaDonXmlEmail.ts       — tự đọc file XML đính kèm thư, cuối ngày
//  Cùng một hàm đọc + cùng một hàm khớp ⇒ hoá đơn lấy từ email mở ra trong form
//  Nhập hàng Y HỆT khi chọn file tay (khớp mã, nhớ liên kết, quy đổi đơn vị).
//
//  XML theo schema quốc gia cố định (HDon → DLHDon → TTChung / NDHDon → DSHHDVu
//  → HHDVu) — đọc bằng regex, không thêm thư viện XML. Tên dòng giữ NGUYÊN chuỗi
//  (không giải mã &amp;…): liên kết đã nhớ (SkuMapping platform='invoice') lưu
//  khoá bằng chính chuỗi đó, đổi cách đọc là mọi liên kết cũ trượt.
// ─────────────────────────────────────────────────────────────────────────────

export type ParsedInvoiceItem = {
    name: string; unit: string; quantity: number; unitPrice: number; amount: number
    // Thuế GTGT theo TỪNG DÒNG — giá nhập kho tính GỒM VAT (HKD không khấu trừ đầu vào)
    vatRate?: number; vatAmount?: number
    productId?: string; productSku?: string; matched?: boolean; created?: boolean
    // Hệ số đã quy đổi từ ĐVT hoá đơn sang ĐVT kho (vd 1 vỉ = 10 cái → 10)
    convertedBy?: number
}

export function xmlTag(block: string, tag: string): string {
    const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
    return m ? m[1].trim() : ''
}
export function xmlNum(block: string, tag: string): number {
    const raw = xmlTag(block, tag).replace(/,/g, '.')
    const n = parseFloat(raw)
    return Number.isFinite(n) ? n : 0
}

export interface HoaDonXml {
    format: 'xml'
    invoiceNumber: string
    invoiceDate: string
    sellerName: string
    sellerTaxCode: string
    /** Tổng CHUẨN in trên hoá đơn — FE dùng để cân phần lẻ làm tròn từng dòng */
    totals: { subtotal: number; vatTotal: number; grandTotal: number }
    items: ParsedInvoiceItem[]
    /** Ký hiệu mẫu số (KHMSHDon, vd "1") + ký hiệu hoá đơn (KHHDon, vd "C26TSG") */
    mauSo: string
    kyHieu: string
    buyerName: string
    buyerTaxCode: string
    /** TTHDLQuan/TCHDon: 1 = hoá đơn THAY THẾ, 2 = hoá đơn ĐIỀU CHỈNH; null = hoá đơn gốc */
    tinhChat: 'thay-the' | 'dieu-chinh' | null
    /** Số hoá đơn bị thay thế / điều chỉnh (SHDCLQuan) */
    hoaDonLienQuan: string | null
}

/** Có phải file XML hoá đơn điện tử VN không (loại tờ khai thuế, XML lạ…). */
export function laXmlHoaDon(xml: string): boolean {
    return /<HDon[\s>]/i.test(xml) && /<HHDVu>/i.test(xml)
}

export function parseVnEInvoiceXml(xml: string): HoaDonXml {
    const items: ParsedInvoiceItem[] = []
    const rows = xml.match(/<HHDVu>[\s\S]*?<\/HHDVu>/gi) || []
    for (const row of rows) {
        const name = xmlTag(row, 'THHDVu')
        if (!name) continue
        const quantity = xmlNum(row, 'SLuong')
        const unitPrice = xmlNum(row, 'DGia')
        const amount = xmlNum(row, 'ThTien') || quantity * unitPrice
        // TSuat dạng "8%"/"10%"/"KCT"; TThue = tiền thuế dòng (có thể thiếu → tự tính)
        const vatRate = parseFloat(xmlTag(row, 'TSuat').replace('%', '')) || 0
        const vatAmount = xmlNum(row, 'TThue') || (vatRate > 0 ? Math.round(amount * vatRate / 100) : 0)
        items.push({ name, unit: xmlTag(row, 'DVTinh') || 'cái', quantity: quantity || 1, unitPrice, amount, vatRate, vatAmount })
    }
    const sellerBlock = (xml.match(/<NBan>[\s\S]*?<\/NBan>/i) || [''])[0]
    const buyerBlock = (xml.match(/<NMua>[\s\S]*?<\/NMua>/i) || [''])[0]
    const lienQuan = (xml.match(/<TTHDLQuan>[\s\S]*?<\/TTHDLQuan>/i) || [''])[0]
    const tc = lienQuan ? xmlTag(lienQuan, 'TCHDon') : ''
    return {
        format: 'xml',
        invoiceNumber: xmlTag(xml, 'SHDon'),
        invoiceDate: xmlTag(xml, 'NLap'),
        sellerName: xmlTag(sellerBlock, 'Ten'),
        sellerTaxCode: xmlTag(sellerBlock, 'MST'),
        totals: {
            subtotal: xmlNum(xml, 'TgTCThue'),
            vatTotal: xmlNum(xml, 'TgTThue'),
            grandTotal: xmlNum(xml, 'TgTTTBSo'),
        },
        items,
        mauSo: xmlTag(xml, 'KHMSHDon'),
        kyHieu: xmlTag(xml, 'KHHDon'),
        buyerName: xmlTag(buyerBlock, 'Ten'),
        buyerTaxCode: xmlTag(buyerBlock, 'MST'),
        tinhChat: tc === '1' ? 'thay-the' : tc === '2' ? 'dieu-chinh' : null,
        hoaDonLienQuan: lienQuan ? (xmlTag(lienQuan, 'SHDCLQuan') || null) : null,
    }
}

/** "00002057" → "2057"; so sánh số hoá đơn giữa nguồn có/không có số 0 đứng đầu. */
export function chuanSoHoaDon(so: unknown): string {
    return String(so ?? '').replace(/\D/g, '').replace(/^0+/, '')
}
/** MST chỉ giữ số và gạch nối (chi nhánh 0101234567-001). */
export function chuanMst(mst: unknown): string {
    return String(mst ?? '').replace(/[^\d-]/g, '')
}

/** MST của CHÍNH cửa hàng (cấu hình HĐĐT + cài đặt thuế) — để không nhận nhầm mình là NCC. */
export async function mstCuaHang(prisma: any): Promise<string[]> {
    const ds = new Set<string>()
    const a = await prisma.eInvoiceConfig.findFirst({ select: { taxCode: true } }).catch(() => null)
    const b = await prisma.storeSettings.findUnique({ where: { id: 'default' }, select: { taxCode: true } }).catch(() => null)
    for (const x of [a?.taxCode, b?.taxCode]) { const m = chuanMst(x); if (m) ds.add(m) }
    return [...ds]
}

/**
 * Khớp từng dòng hoá đơn vào mã hàng trong kho (SỬA TẠI CHỖ `items`):
 *   1. tên dòng = tên SP (không phân biệt hoa thường) hoặc = SKU
 *   2. LIÊN KẾT ĐÃ NHỚ: SkuMapping platform='invoice' (khoá = tên dòng) — kèm hệ số
 *      quy đổi đơn vị (5 vỉ × 10 = 50 cái, thành tiền giữ nguyên)
 *   3. `autoCreate` → chưa có thì tạo mã mới (chỉ đường chọn file tay dùng)
 */
export async function khopSanPhamHoaDon(prisma: any, items: ParsedInvoiceItem[], opts: { autoCreate?: boolean } = {}): Promise<void> {
    let defaultCategory: any = null
    for (const it of items) {
        const found = await prisma.product.findFirst({
            where: { OR: [{ name: { equals: it.name, mode: 'insensitive' } }, { sku: it.name }] },
        })
        if (found) {
            it.productId = found.id; it.productSku = found.sku; it.matched = true
            continue
        }
        // LIÊN KẾT ĐÃ NHỚ: người dùng từng link dòng hoá đơn cùng tên vào SP kho
        // (SkuMapping platform='invoice', key = tên dòng) → hoá đơn sau TỰ khớp,
        // không phải link lại từng lần.
        const remembered = await prisma.skuMapping.findFirst({
            where: { platform: 'invoice', platformSku: { equals: it.name, mode: 'insensitive' } },
            include: { product: { select: { id: true, sku: true, baseUnit: true } } },
        }).catch(() => null)
        if (remembered?.product) {
            it.productId = remembered.product.id; it.productSku = remembered.product.sku; it.matched = true
            // HỆ SỐ QUY ĐỔI: hoá đơn ghi 5 vỉ, kho đếm cái, vỉ = 10 cái → 50 cái,
            // đơn giá chia 10. THÀNH TIỀN GIỮ NGUYÊN (không đụng vào tiền của HĐ).
            const rate = Number((remembered as any).conversionRate) || 1
            if (rate > 0 && rate !== 1) {
                it.quantity = (Number(it.quantity) || 0) * rate
                it.unitPrice = it.quantity > 0 ? (Number(it.amount) || 0) / it.quantity : it.unitPrice
                it.convertedBy = rate
                it.unit = remembered.product.baseUnit || it.unit
            }
            continue
        }
        if (opts.autoCreate) {
            if (!defaultCategory) {
                defaultCategory = await prisma.category.findFirst({ where: { name: { equals: 'Chưa phân loại', mode: 'insensitive' } } })
                    || await prisma.category.create({ data: { name: 'Chưa phân loại' } })
            }
            const sku = 'SP' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase()
            const created = await prisma.product.create({
                data: {
                    name: it.name, sku, categoryId: defaultCategory.id,
                    costPrice: it.unitPrice, sellingPrice: it.unitPrice,
                    baseUnit: it.unit || 'cái', stock: 0,
                },
            })
            it.productId = created.id; it.productSku = created.sku; it.created = true
        }
    }
}

/**
 * Hoá đơn này ĐÃ nằm trong sổ chưa (phiếu nhập / phiếu chi, trừ phiếu đã huỷ)?
 * Khoá so: MST người bán + số hoá đơn (bỏ số 0 đầu). Ký hiệu chỉ dùng để LOẠI khi
 * cả hai bên đều có mà khác nhau (cùng NCC, cùng số, khác năm/ký hiệu là hai HĐ).
 * Dùng chung cho quét XML email và quét thân thư — một hoá đơn không được vào sổ hai lần.
 */
export async function hoaDonDaCo(prisma: any, p: {
    mst: string; so: string; kyHieu?: string | null; tenNcc?: string | null; nam?: number | null
}): Promise<{ loai: 'phieu-nhap' | 'phieu-chi'; id: string; ma: string } | null> {
    const so = chuanSoHoaDon(p.so)
    const mst = chuanMst(p.mst)
    if (!so) return null
    const kh = String(p.kyHieu || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()

    if (mst) {
        const chi: any[] = await prisma.$queryRawUnsafe(
            `SELECT id, "invoiceSymbol", status FROM "Expense"
              WHERE status <> 'cancelled'
                AND regexp_replace(COALESCE("supplierTaxCode", ''), '[^0-9-]', '', 'g') = $1
                AND regexp_replace(regexp_replace(COALESCE("invoiceNo", ''), '\\D', '', 'g'), '^0+', '') = $2
              LIMIT 5`, mst, so)
        for (const e of chi) {
            const ek = String(e.invoiceSymbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
            if (kh && ek && !ek.endsWith(kh) && !kh.endsWith(ek)) continue
            return { loai: 'phieu-chi', id: e.id, ma: `phiếu chi ${e.status === 'pending' ? 'chờ duyệt' : 'đã duyệt'}` }
        }
    }

    const nhap: any[] = await prisma.$queryRawUnsafe(
        `SELECT r.id, r.code, r."transactionDate", r."createdAt", s."taxCode" AS mst, r."supplierName"
           FROM "ImportReceipt" r LEFT JOIN "Supplier" s ON s.id = r."supplierId"
          WHERE r.status <> 'cancelled'
            AND regexp_replace(regexp_replace(COALESCE(r."vatInvoiceNo", ''), '\\D', '', 'g'), '^0+', '') = $1
          LIMIT 20`, so)
    const ten = String(p.tenNcc || '').trim().toLowerCase()
    for (const r of nhap) {
        const cungNcc = (mst && chuanMst(r.mst) === mst) || (!!ten && String(r.supplierName || '').trim().toLowerCase() === ten)
        if (!cungNcc) continue
        const ngay = r.transactionDate || r.createdAt
        if (p.nam && ngay && new Date(ngay).getFullYear() !== p.nam) continue
        return { loai: 'phieu-nhap', id: r.id, ma: `phiếu nhập ${r.code}` }
    }
    return null
}
