/**
 * ĐIỂM ĐẶT HÀNG TÍNH TỪ DỮ LIỆU BÁN THẬT
 *
 * Phần mềm bán lẻ nào cũng có ô "tồn tối thiểu" — một con số ai đó gõ tay một
 * lần rồi quên, không đổi khi hàng bán chạy lên gấp ba hay khi nhà cung cấp
 * giao chậm thêm một tuần. Hệ quả là hai kiểu mất tiền cùng lúc: hết hàng đúng
 * lúc đang bán được, và ôm tồn những mã không ai mua.
 *
 * Ở đây điểm đặt hàng được TÍNH, từ ba thứ đo được:
 *
 *   Điểm đặt hàng = (bán trung bình mỗi ngày × số ngày chờ hàng) + tồn an toàn
 *   Tồn an toàn   = z × độ dao động của sức bán × căn(số ngày chờ)
 *
 * Tồn an toàn không phải "cộng thêm cho chắc": nó chính là phần đệm cho những
 * ngày bán vọt lên bất thường trong lúc chờ hàng về. Mã bán đều thì đệm mỏng,
 * mã lúc bán 2 lúc bán 40 thì đệm dày — dù hai mã có cùng mức bán trung bình.
 * Đó là chỗ mà một con số gõ tay không bao giờ diễn tả được.
 *
 * BA GIỚI HẠN PHẢI NÓI THẲNG, không được giấu sau con số đẹp:
 *  - Sức bán đo được LUÔN THẤP HƠN nhu cầu thật ở những mã từng hết hàng: ngày
 *    hết hàng bán bằng 0 không phải vì không ai muốn mua. Hệ thống không lưu
 *    lịch sử tồn nên không bù lại được — chỉ nêu cảnh báo.
 *  - Mã mới bán vài hôm thì KHÔNG tính điểm đặt hàng. Ba ngày dữ liệu không đủ
 *    để nói gì về độ dao động, và một con số bịa ở đây làm người ta ôm vốn.
 *  - Số ngày chờ hàng lấy từ lịch sử đơn đặt của chính nhà cung cấp đó; không
 *    đủ mẫu thì dùng mặc định và GHI RÕ là mặc định.
 */

export type CoNgay = 'het-hang' | 'can-dat-ngay' | 'du-hang' | 'ton-dong' | 'chua-du-lich-su'

export interface MatHangDatHang {
    productId: string
    ten: string
    sku: string
    nhaCungCap: string | null
    /** Nhóm hàng (danh mục) — để gom xem theo ngành hàng. */
    nhomHang: string | null
    tonHienTai: number
    dangVe: number
    /** Bán trung bình mỗi ngày, tính trên TOÀN kỳ (kể cả ngày không bán). */
    banMoiNgay: number
    /** Độ dao động sức bán theo ngày — càng lớn càng phải trữ dày. */
    doDaoDong: number
    soNgayCoBan: number
    /** Số ngày chờ hàng dùng để tính, và nó từ đâu ra. */
    soNgayCho: number
    nguonSoNgayCho: 'đo từ lịch sử đặt hàng' | 'mặc định'
    diemDatHang: number | null
    tonAnToan: number | null
    /** Còn bán được bao nhiêu ngày nữa với tồn hiện tại. */
    conBanDuoc: number | null
    /** Nên đặt bao nhiêu ngay bây giờ. */
    nenDat: number
    tienCanBo: number
    co: CoNgay
    /** Mất doanh thu ước tính mỗi ngày nếu đang hết hàng. */
    matMoiNgay: number
    /** Vốn đang nằm chết ở mã không bán được. */
    vonKet: number
    canhBao: string[]
}

export interface KetQuaDatHang {
    ky: { tuNgay: string; soNgay: number }
    thamSo: {
        mucPhucVu: number
        heSoZ: number
        soNgayChoMacDinh: number
        chuKyDat: number
    }
    tomTat: {
        soMaXet: number
        soMaHetHang: number
        soMaCanDat: number
        soMaTonDong: number
        soMaChuaDuLichSu: number
        tienCanBoNgay: number
        matMoiNgayDoHetHang: number
        vonKetODongHang: number
    }
    /** Chỉ những thiếu sót LÀM SAI kết luận: mất lịch sử bán hoặc mất danh mục
     *  hàng. Thiếu nguồn nhập hay thiếu hàng đang về chỉ làm số kém chính xác
     *  hơn, đã có đường lùi — không được phép làm câm cả báo cáo. */
    thieuChinh: string[]
    canDat: MatHangDatHang[]
    hetHang: MatHangDatHang[]
    tonDong: MatHangDatHang[]
    ghiChu: string[]
    thieu: string[]
}

/** Hệ số z theo mức phục vụ — bao nhiêu phần lần đặt hàng không bị hụt giữa chừng. */
export const HE_SO_Z: Record<string, number> = {
    '0.80': 0.84, '0.85': 1.04, '0.90': 1.28, '0.95': 1.65, '0.98': 2.05, '0.99': 2.33,
}

function zTheoMucPhucVu(p: number): number {
    const khoa = Object.keys(HE_SO_Z)
        .map(Number)
        .reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a), 0.95)
    return HE_SO_Z[khoa.toFixed(2)] ?? 1.65
}

/** Mô tả lỗi cho người đọc log. Nhiều lỗi Prisma/pg có message RỖNG — chỉ in
 *  message là ra chuỗi cụt, không chẩn được gì. */
function moTaLoi(e: any): string {
    const m = String(e?.message || '').trim()
    if (m) return m.slice(0, 160)
    const phu = [e?.name, e?.code, e?.meta && JSON.stringify(e.meta)].filter(Boolean).join(' ')
    return (phu || String(e) || 'lỗi không rõ').slice(0, 160)
}

const lam = (n: any) => Math.round(Number(n) || 0)
const so = (n: any) => (Number.isFinite(Number(n)) ? Number(n) : 0)

function trungVi(xs: number[]): number {
    if (!xs.length) return 0
    const s = [...xs].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export async function keHoachDatHang(
    prisma: any,
    tuyChon?: {
        soNgayLichSu?: number
        mucPhucVu?: number
        soNgayChoMacDinh?: number
        chuKyDat?: number
        soMaToiDa?: number
    },
): Promise<KetQuaDatHang> {
    const thieu: string[] = []
    const thieuChinh: string[] = []
    const ghiChu: string[] = []

    const soNgayLichSu = Math.max(14, Math.min(365, tuyChon?.soNgayLichSu ?? 90))
    const mucPhucVu = Math.max(0.8, Math.min(0.99, tuyChon?.mucPhucVu ?? 0.95))
    const z = zTheoMucPhucVu(mucPhucVu)
    const soNgayChoMacDinh = Math.max(1, Math.min(90, tuyChon?.soNgayChoMacDinh ?? 7))
    const chuKyDat = Math.max(1, Math.min(60, tuyChon?.chuKyDat ?? 7))
    const soMaToiDa = Math.max(10, Math.min(500, tuyChon?.soMaToiDa ?? 60))

    const tuNgay = new Date(Date.now() - soNgayLichSu * 86400_000)

    /* Truy vấn TUẦN TỰ. Gộp bán hàng bằng SQL hai tầng thay vì kéo hết dòng bán
     * về Node: một cửa hàng 90 ngày có thể vài trăm nghìn dòng, kéo về là vừa
     * chậm vừa ngốn bộ nhớ của tiến trình dùng chung cho mọi cửa hàng. */
    let banRows: any[] = []
    let docDuocBan = false
    try {
        banRows = await prisma.$queryRawUnsafe(
            `SELECT s."productId"                      AS "productId",
                    COALESCE(SUM(s.q), 0)::float8      AS tong,
                    COALESCE(SUM(s.q * s.q), 0)::float8 AS "tongBinhPhuong",
                    COUNT(*)::int                      AS "soNgayCoBan"
             FROM (
                 SELECT ti."productId" AS "productId",
                        (t."createdAt" + interval '7 hours')::date AS ngay,
                        SUM(COALESCE(NULLIF(ti."baseQuantity", 0), ti.quantity))::float8 AS q
                 FROM "TransactionItem" ti
                 JOIN "Transaction" t ON t.id = ti."transactionId"
                 WHERE t.status = 'completed' AND t."createdAt" >= $1
                 GROUP BY 1, 2
             ) s
             GROUP BY 1`,
            tuNgay,
        )
        docDuocBan = true
    } catch (e: any) {
        thieuChinh.push(`Không đọc được lịch sử bán: ${moTaLoi(e)}`)
    }
    const ban = new Map<string, { tong: number; tongBp: number; soNgay: number }>()
    for (const r of banRows) {
        ban.set(String(r.productId), {
            tong: so(r.tong), tongBp: so(r.tongBinhPhuong), soNgay: Number(r.soNgayCoBan) || 0,
        })
    }

    // ── Hàng hoá đang bán ────────────────────────────────────────────────
    let hang: any[] = []
    try {
        hang = await prisma.product.findMany({
            /* Bỏ dịch vụ (không có tồn để đặt) và mã đã gộp vào mã khác — đề xuất
             * đặt hàng cho một mã đã bị gộp là bảo người ta nhập thứ không còn
             * dùng nữa. */
            where: { productType: { not: 'service' }, mergedIntoId: null },
            select: {
                id: true, name: true, sku: true, stock: true, minStock: true,
                costPrice: true, sellingPrice: true, createdAt: true, categoryId: true,
            },
        })
    } catch (e: any) {
        thieuChinh.push(`Không đọc được danh mục hàng hoá: ${moTaLoi(e)}`)
    }

    /* Tên nhóm hàng: đặt hàng thực tế gom theo NHÀ CUNG CẤP (mỗi bên một đơn),
     * còn nhóm hàng để soát theo ngành hàng. Nạp một lượt, không N+1. */
    const tenNhom = new Map<string, string>()
    try {
        const dm = await prisma.category.findMany({ select: { id: true, name: true } })
        for (const c of dm) tenNhom.set(String(c.id), String(c.name || ''))
    } catch (e: any) {
        thieu.push(`Không đọc được nhóm hàng: ${moTaLoi(e)}`)
    }

    /* Product không có cột nhà cung cấp — suy từ phiếu nhập GẦN NHẤT của chính
     * mặt hàng đó. Đây là cách duy nhất đúng với dữ liệu đang có, và cũng hợp lý
     * hơn một cột cố định: hàng đổi nguồn thì thời gian chờ cũng đổi theo. */
    const nccCuaHang = new Map<string, string>()
    try {
        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT DISTINCT ON (iri."productId")
                    iri."productId" AS "productId", ir."supplierId" AS "supplierId"
             FROM "ImportReceiptItem" iri
             JOIN "ImportReceipt" ir ON ir.id = iri."receiptId"
             WHERE ir."supplierId" IS NOT NULL
             ORDER BY iri."productId", ir."createdAt" DESC`,
        )
        for (const r of rows) nccCuaHang.set(String(r.productId), String(r.supplierId))
    } catch (e: any) {
        thieu.push(`Không đọc được nguồn nhập của hàng hoá: ${moTaLoi(e)}`)
    }

    // ── Số ngày chờ hàng thật, theo từng nhà cung cấp ────────────────────
    const choTheoNcc = new Map<string, number>()
    const tenNcc = new Map<string, string>()
    try {
        const po = await prisma.purchaseOrder.findMany({
            where: { receivedDate: { not: null } },
            select: { supplierId: true, supplierName: true, createdAt: true, receivedDate: true },
            orderBy: { receivedDate: 'desc' },
            take: 500,
        })
        const gom = new Map<string, number[]>()
        for (const p of po) {
            const id = String(p.supplierId || '')
            if (!id) continue
            const ngay = (new Date(p.receivedDate).getTime() - new Date(p.createdAt).getTime()) / 86400_000
            /* Bỏ mẫu vô lý: nhận trước ngày đặt (nhập bù chứng từ) hoặc chờ quá
             * 90 ngày (đơn bị bỏ quên rồi mới đóng). Cả hai đều không phải thời
             * gian chờ thật, để lại sẽ kéo lệch trung vị. */
            if (ngay < 0 || ngay > 90) continue
            if (!gom.has(id)) gom.set(id, [])
            gom.get(id)!.push(ngay)
            if (p.supplierName) tenNcc.set(id, String(p.supplierName))
        }
        for (const [id, ds] of gom) {
            // Cần ít nhất 3 lần nhập mới dám nói "nhà cung cấp này giao trong N ngày"
            if (ds.length >= 3) choTheoNcc.set(id, Math.max(1, Math.round(trungVi(ds))))
        }
    } catch (e: any) {
        thieu.push(`Không đọc được lịch sử đặt hàng: ${moTaLoi(e)}`)
    }

    // ── Hàng đang trên đường về ──────────────────────────────────────────
    const dangVe = new Map<string, number>()
    try {
        /* PurchaseOrderItem khong luu productId, chi luu sku — noi qua bang
         * Product bang sku. Ma nao don dat ghi sai sku thi khong khop, hau qua
         * la de xuat dat DU chu khong thieu. */
        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT p.id AS "productId", COALESCE(SUM(poi.quantity), 0)::float8 AS q
             FROM "PurchaseOrderItem" poi
             JOIN "PurchaseOrder" po ON po.id = poi."purchaseOrderId"
             JOIN "Product" p ON p.sku = poi.sku
             WHERE po."receivedDate" IS NULL AND po.status NOT IN ('cancelled', 'draft', 'rejected')
             GROUP BY 1`,
        )
        for (const r of rows) dangVe.set(String(r.productId), so(r.q))
    } catch (e: any) {
        /* Không đọc được thì coi như chưa có hàng về — sẽ đề xuất đặt DƯ chứ
         * không đề xuất thiếu. Đặt dư thì kẹt vốn, đề xuất thiếu thì đứt hàng;
         * chọn hướng an toàn hơn nhưng phải nói ra. */
        thieu.push(`Không đọc được hàng đang về: ${moTaLoi(e)}`)
        ghiChu.push('Chưa đọc được lượng hàng đang trên đường về — số đề xuất đặt có thể cao hơn thực tế cần.')
    }

    // ── Tính cho từng mã ─────────────────────────────────────────────────
    const tatCa: MatHangDatHang[] = []
    for (const p of hang) {
        const id = String(p.id)
        const b = ban.get(id) || { tong: 0, tongBp: 0, soNgay: 0 }
        const ton = so(p.stock)
        const ve = dangVe.get(id) || 0
        const giaVon = so(p.costPrice)
        const giaBan = so(p.sellingPrice)
        const nccId = nccCuaHang.get(id) || ''
        const choDo = nccId ? choTheoNcc.get(nccId) : undefined
        const cho = choDo ?? soNgayChoMacDinh

        const mu = b.tong / soNgayLichSu
        /* Phương sai tính trên TOÀN kỳ: những ngày không bán đóng góp 0 vào tổng
         * bình phương nhưng vẫn nằm ở mẫu số. Chia cho riêng số ngày có bán sẽ
         * làm mọi mã bán thưa trông như bán rất đều. */
        const phuongSai = Math.max(0, b.tongBp / soNgayLichSu - mu * mu)
        const sigma = Math.sqrt(phuongSai)

        const canhBao: string[] = []
        let co: CoNgay
        let diemDatHang: number | null = null
        let tonAnToan: number | null = null
        let conBanDuoc: number | null = null
        let nenDat = 0

        /* Hàng vừa đưa vào danh mục thì chưa bán được gì là chuyện bình thường —
         * gọi nó là "đọng vốn" rồi giục thanh lý là sai. Mốc 30 ngày để một mã
         * mới có thời gian chứng minh. */
        const ngayTuoi = (Date.now() - new Date(p.createdAt || 0).getTime()) / 86400_000
        const laHangMoi = Number.isFinite(ngayTuoi) && ngayTuoi < 30

        if (b.tong <= 0) {
            /* Không bán được món nào suốt cả kỳ. Đây KHÔNG phải "thiếu lịch sử":
             * chính việc không bán được mới là dữ liệu. Nhưng phải có tồn thì mới
             * là đọng vốn — tồn 0 và không bán thì đơn giản là mã không dùng. */
            /* docDuocBan = false nghĩa là truy vấn bán hàng hỏng, KHÔNG phải cửa
             * hàng không bán được gì. Gán "đọng vốn" lúc này là bảo người ta
             * thanh lý sạch kho vì một lỗi đọc dữ liệu. */
            if (ton > 0 && !laHangMoi && docDuocBan) {
                co = 'ton-dong'
            } else {
                co = 'chua-du-lich-su'
                if (laHangMoi && ton > 0) {
                    canhBao.push(`Mã mới có trong danh mục ${Math.round(ngayTuoi)} ngày — chưa đủ thời gian để kết luận là bán được hay không.`)
                }
            }
        } else if (b.soNgay < 5) {
            /* Dưới 5 ngày có bán thì không đủ để nói gì về độ dao động. Không bịa
             * điểm đặt hàng — nhưng vẫn báo nếu đang hết sạch mà có người mua. */
            co = ton <= 0 ? 'het-hang' : 'chua-du-lich-su'
            if (co === 'chua-du-lich-su') {
                canhBao.push(`Mới có ${b.soNgay} ngày phát sinh bán trong ${soNgayLichSu} ngày — chưa đủ để tính điểm đặt hàng.`)
            }
        } else {
            tonAnToan = Math.ceil(z * sigma * Math.sqrt(cho))
            diemDatHang = Math.ceil(mu * cho + tonAnToan)
            conBanDuoc = Math.floor(ton / mu)
            /* Đặt đủ dùng cho quãng chờ CỘNG một chu kỳ đặt: nếu chỉ đặt đủ cho
             * quãng chờ thì hàng vừa về đã lại chạm điểm đặt, tuần nào cũng phải
             * đặt gấp. */
            const canCo = Math.ceil(mu * (cho + chuKyDat) + tonAnToan)
            nenDat = Math.max(0, canCo - ton - ve)

            if (ton <= 0) co = 'het-hang'
            else if (ton + ve <= diemDatHang) co = 'can-dat-ngay'
            else co = 'du-hang'

            /* Mã lúc bán 2 lúc bán 40 cần đệm dày hơn hẳn — nói ra để người dùng
             * hiểu vì sao đề xuất trữ nhiều so với mức bán trung bình. */
            if (sigma >= mu && mu > 0) {
                canhBao.push('Sức bán mặt hàng này rất thất thường, nên tồn an toàn phải dày hơn mức bán trung bình gợi ý.')
            }
        }

        if (ton <= 0 && mu > 0) {
            canhBao.push('Đang hết hàng — con số "bán mỗi ngày" đo được đã bị kéo xuống bởi chính những ngày hết hàng, nhu cầu thật cao hơn.')
        }
        if (co === 'ton-dong' && ton > 0) {
            canhBao.push(`Không bán được món nào trong ${soNgayLichSu} ngày qua.`)
        }
        if (!choDo && nccId) {
            canhBao.push(`Chưa đủ lịch sử đặt hàng của nhà cung cấp này, đang tạm dùng ${soNgayChoMacDinh} ngày chờ.`)
        }

        tatCa.push({
            productId: id,
            ten: String(p.name || ''),
            sku: String(p.sku || ''),
            nhaCungCap: nccId ? (tenNcc.get(nccId) || null) : null,
            nhomHang: p.categoryId ? (tenNhom.get(String(p.categoryId)) || null) : null,
            tonHienTai: lam(ton),
            dangVe: lam(ve),
            banMoiNgay: Math.round(mu * 100) / 100,
            doDaoDong: Math.round(sigma * 100) / 100,
            soNgayCoBan: b.soNgay,
            soNgayCho: cho,
            nguonSoNgayCho: choDo ? 'đo từ lịch sử đặt hàng' : 'mặc định',
            diemDatHang,
            tonAnToan,
            conBanDuoc,
            nenDat,
            tienCanBo: lam(nenDat * giaVon),
            co,
            matMoiNgay: ton <= 0 && mu > 0 ? lam(mu * Math.max(0, giaBan - giaVon)) : 0,
            vonKet: co === 'ton-dong' ? lam(ton * giaVon) : 0,
            canhBao,
        })
    }

    const hetHang = tatCa.filter(m => m.co === 'het-hang').sort((a, b) => b.matMoiNgay - a.matMoiNgay)
    const canDat = tatCa.filter(m => m.co === 'can-dat-ngay').sort((a, b) => (a.conBanDuoc ?? 999) - (b.conBanDuoc ?? 999))
    const tonDong = tatCa.filter(m => m.co === 'ton-dong').sort((a, b) => b.vonKet - a.vonKet)

    if (!docDuocBan) {
        ghiChu.push('Chưa đọc được lịch sử bán nên KHÔNG kết luận mã nào là hàng đọng vốn — "không đọc được" khác "không bán được".')
    }
    if (hetHang.length > 0 || canDat.length > 0) {
        ghiChu.push('Sức bán đo được ở mã từng hết hàng LUÔN thấp hơn nhu cầu thật — ngày hết hàng bán bằng 0 không phải vì không ai muốn mua. Hệ thống chưa lưu lịch sử tồn nên không bù lại được phần này.')
    }
    ghiChu.push(`Tồn an toàn tính theo mức phục vụ ${Math.round(mucPhucVu * 100)}%: cứ 100 lần đặt hàng thì khoảng ${Math.round(mucPhucVu * 100)} lần không bị hụt giữa lúc chờ hàng. Muốn chắc hơn thì nâng mức này lên, đổi lại vốn nằm trong kho dày hơn.`)

    return {
        ky: { tuNgay: tuNgay.toISOString().slice(0, 10), soNgay: soNgayLichSu },
        thamSo: { mucPhucVu, heSoZ: z, soNgayChoMacDinh, chuKyDat },
        tomTat: {
            soMaXet: tatCa.length,
            soMaHetHang: hetHang.length,
            soMaCanDat: canDat.length,
            soMaTonDong: tonDong.length,
            soMaChuaDuLichSu: tatCa.filter(m => m.co === 'chua-du-lich-su').length,
            tienCanBoNgay: lam([...hetHang, ...canDat].reduce((s, m) => s + m.tienCanBo, 0)),
            matMoiNgayDoHetHang: lam(hetHang.reduce((s, m) => s + m.matMoiNgay, 0)),
            vonKetODongHang: lam(tonDong.reduce((s, m) => s + m.vonKet, 0)),
        },
        thieuChinh,
        canDat: canDat.slice(0, soMaToiDa),
        hetHang: hetHang.slice(0, soMaToiDa),
        tonDong: tonDong.slice(0, soMaToiDa),
        ghiChu, thieu,
    }
}
