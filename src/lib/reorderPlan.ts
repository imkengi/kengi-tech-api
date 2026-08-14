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
    /** Nhu cầu giật cục (vài đơn sỉ lớn) — số đề xuất kém tin cậy hơn hẳn. */
    nhuCauGiatCuc: boolean
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
        soMaGiatCuc: number
        tienCanBoNgayGiatCuc: number
        soMaTonDong: number
        soMaChuaDuLichSu: number
        /** Ma dang co ton AM — dau hieu lech so sach, phai soat kho chu khong phai dat hang. */
        soMaTonAm: number
        tongTonAm: number
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
                 WHERE t.status IN ('completed', 'partial') AND t."createdAt" >= $1
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
        let giatCuc = false
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
            /* ── NHU CẦU GIẬT CỤC LÀM CÔNG THỨC TỒN AN TOÀN VÔ NGHĨA ─────────
             *
             * `z * sigma * sqrt(cho)` giả định nhu cầu mỗi ngày dao động quanh
             * một mức trung bình theo phân phối chuẩn. Bán lẻ pha sỉ KHÔNG như
             * vậy: phần lớn ngày bán 0-2 cái, thỉnh thoảng một đơn sỉ vài trăm
             * cái. Khi đó sigma lớn gấp nhiều lần mu và công thức đòi trữ một
             * núi hàng để "phòng" một cú sỉ có thể không bao giờ lặp lại.
             *
             * Đo trên dữ liệu thật (KENGISTORE): SHD4038 bán 6,58 cái/ngày mà
             * sigma 52,1 → tồn an toàn 228 cái, đề xuất đặt 300 cái = 327 triệu
             * cho MỘT mã. Ba mã mẫu đều có sigma gấp 6,7–7,9 lần mức bán.
             *
             * Phân loại theo Syntetos–Boylan: ADI = số ngày trong kỳ / số ngày
             * có bán; nhu cầu là "giật cục" khi ADI ≥ 1,32 VÀ CV² ≥ 0,49. Với
             * nhóm này, chặn tồn an toàn ở đúng một quãng chờ nhu cầu trung
             * bình — vẫn có đệm, nhưng không để một cú sỉ quyết định cả đơn
             * hàng. Và phải NÓI RA là đã chặn, kèm con số công thức gốc đòi,
             * để người biết hàng của mình tự quyết. */
            const adi = b.soNgay > 0 ? soNgayLichSu / b.soNgay : Infinity
            const cv2 = mu > 0 ? (sigma / mu) ** 2 : 0
            giatCuc = adi >= 1.32 && cv2 >= 0.49

            const theoCongThuc = Math.ceil(z * sigma * Math.sqrt(cho))
            if (giatCuc) {
                const chan = Math.ceil(mu * cho)
                tonAnToan = Math.min(theoCongThuc, chan)
                if (theoCongThuc > chan) {
                    canhBao.push(
                        `Nhu cầu giật cục: ${b.soNgay} ngày có bán trong ${soNgayLichSu} ngày, mức dao động gấp ${(sigma / mu).toFixed(1)} lần mức bán trung bình — gần như chắc chắn do vài đơn sỉ lớn chứ không phải bán đều. `
                        + `Công thức tồn an toàn đòi trữ ${theoCongThuc}; đã chặn xuống ${tonAnToan} (bằng một quãng chờ ${cho} ngày) để một cú sỉ không quyết định cả đơn hàng. `
                        + `Nếu biết chắc sắp có đơn sỉ nữa thì đặt thêm theo đơn đó, đừng dựa vào con số này.`)
                }
            } else {
                tonAnToan = theoCongThuc
            }
            diemDatHang = Math.ceil(mu * cho + tonAnToan)
            conBanDuoc = Math.floor(ton / mu)
            /* Đặt đủ dùng cho quãng chờ CỘNG một chu kỳ đặt: nếu chỉ đặt đủ cho
             * quãng chờ thì hàng vừa về đã lại chạm điểm đặt, tuần nào cũng phải
             * đặt gấp. */
            const canCo = Math.ceil(mu * (cho + chuKyDat) + tonAnToan)
            /* TỒN ÂM KHÔNG PHẢI NHU CẦU CHƯA ĐÁP ỨNG.
             *
             * Công thức `canCo - ton - ve` với ton = -557 sẽ cộng thêm 557 cái
             * vào lượng đề xuất đặt, như thể có 557 khách đang xếp hàng chờ.
             * Thực tế tồn âm gần như luôn là LỆCH SỔ SÁCH (bán không trừ kho,
             * nhập chưa ghi, đồng bộ sót) — đặt hàng theo nó là mua thừa bằng
             * đúng phần lệch.
             *
             * Đo trên dữ liệu thật 14/08/2026: một cửa hàng có 286 mã tồn âm,
             * sâu nhất -557, và bảng đề xuất báo "cần bỏ ngay 2,5 TỶ". Chốt tồn
             * về 0 khi tính, rồi nói riêng chỗ tồn âm để người dùng đi soát kho
             * — đó mới là việc cần làm, không phải đi mua hàng. */
            const tonDeTinh = Math.max(0, ton)
            nenDat = Math.max(0, canCo - tonDeTinh - ve)
            if (ton < 0) {
                /* Không khẳng định nguyên nhân: cửa hàng bật "cho phép bán khi
                 * hết tồn" thì tồn âm là bán trước, hoàn toàn cố ý. Nói chắc
                 * "lệch sổ sách" là buộc tội oan đúng cái họ chủ động chọn. */
                canhBao.push(`Tồn đang ÂM ${Math.abs(lam(ton))} — hoặc là đã bán trước khi hàng về, hoặc là lệch sổ sách. Dù là gì thì số đề xuất ở đây cũng đã BỎ QUA phần âm, để không bảo bạn mua thừa đúng bằng phần đang âm.`)
            }

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
            nhuCauGiatCuc: giatCuc,
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
    /* Tồn âm phải NÓI RA ở cấp tổng, không chỉ nằm trong cảnh báo từng mã: nó
     * đổi bản chất của cả bảng đề xuất. Người đọc thấy "cần bỏ ngay X tỷ" mà
     * không biết một phần đến từ lệch sổ sách thì sẽ đi mua thật. */
    const soTonAm = tatCa.filter(m => m.tonHienTai < 0).length
    if (soTonAm > 0) {
        /* ĐỌC CỜ TRƯỚC RỒI MỚI NÓI NGUYÊN NHÂN.
         *
         * StoreSettings.allowNegativeStock là lựa chọn thật: cửa hàng bán trước
         * rồi hàng mới về thì bật cờ đó. Với họ tồn âm là cố ý, không phải lệch
         * sổ sách — khẳng định ngược lại là buộc tội oan đúng cái họ chủ động
         * chọn, và lần sau họ bỏ qua luôn cảnh báo thật.
         *
         * Cảnh báo ở TỪNG MÃ đã sửa theo hướng này; ghi chú tổng phải nói cùng
         * một điều, nếu không cùng một màn hình lại nói hai kiểu. */
        /* try/catch chứ KHÔNG chỉ .catch(): nếu client không có model
         * storeSettings thì `prisma.storeSettings` là undefined và lỗi xảy ra
         * NGAY khi truy cập .findFirst — .catch() không đỡ được, cả báo cáo đặt
         * hàng sập vì một dòng ghi chú. Chính bộ test bắt được điều này. */
        let choBanAm = false
        try {
            const cd = await prisma.storeSettings.findFirst({ select: { allowNegativeStock: true } })
            choBanAm = cd?.allowNegativeStock === true
        } catch { /* không đọc được cài đặt → nói kiểu không khẳng định nguyên nhân */ }
        ghiChu.push(choBanAm
            ? `${soTonAm} mã đang có tồn ÂM. Cửa hàng đang bật "cho phép bán khi hết tồn" nên đây là bán trước, hàng về sẽ bù — không phải lỗi dữ liệu. Số đề xuất đặt đã BỎ QUA phần âm để không cộng dồn phần chưa về vào lượng cần mua.`
            : `${soTonAm} mã đang có tồn ÂM, trong khi cửa hàng KHÔNG bật cho phép bán âm — nên đây là lệch sổ sách (bán không trừ kho, nhập chưa ghi, đồng bộ sót) chứ không phải hàng đang thiếu. Số đề xuất đặt đã BỎ QUA phần âm để không bảo bạn mua thừa đúng bằng phần lệch. Việc cần làm với nhóm này là soát kho, không phải đặt hàng.`)
    }

    ghiChu.push(`Tồn an toàn tính theo mức phục vụ ${Math.round(mucPhucVu * 100)}%: cứ 100 lần đặt hàng thì khoảng ${Math.round(mucPhucVu * 100)} lần không bị hụt giữa lúc chờ hàng. Muốn chắc hơn thì nâng mức này lên, đổi lại vốn nằm trong kho dày hơn.`)

    /* Con số "cần bỏ ra ngay" là lời khuyên tiêu tiền. Nếu phần lớn nó đến từ
     * mã bán giật cục thì phải nói trước khi người ta rút ví. */
    {
        const dsTien = [...hetHang, ...canDat]
        const tongTien = dsTien.reduce((s2, m) => s2 + m.tienCanBo, 0)
        const tienGiatCuc = dsTien.filter(m => m.nhuCauGiatCuc).reduce((s2, m) => s2 + m.tienCanBo, 0)
        const soGiatCuc = dsTien.filter(m => m.nhuCauGiatCuc).length
        if (soGiatCuc > 0 && tongTien > 0) {
            const pt = Math.round(tienGiatCuc / tongTien * 100)
            ghiChu.push(
                `${soGiatCuc} mã trong danh sách có nhu cầu GIẬT CỤC — phần lớn ngày bán rất ít, thỉnh thoảng một đơn sỉ lớn. `
                + `Chúng chiếm ${pt}% số tiền đề xuất bỏ ra (${Math.round(tienGiatCuc).toLocaleString('vi-VN')} ₫ trên ${Math.round(tongTien).toLocaleString('vi-VN')} ₫). `
                + `Công thức tồn an toàn giả định bán đều mỗi ngày nên với nhóm này nó đòi trữ quá tay; hệ thống đã chặn bớt, nhưng vẫn nên đặt theo đơn khách đã chốt thay vì theo trung bình.`)
        }
    }

    return {
        ky: { tuNgay: tuNgay.toISOString().slice(0, 10), soNgay: soNgayLichSu },
        thamSo: { mucPhucVu, heSoZ: z, soNgayChoMacDinh, chuKyDat },
        tomTat: {
            soMaXet: tatCa.length,
            soMaHetHang: hetHang.length,
            soMaCanDat: canDat.length,
            soMaTonDong: tonDong.length,
            soMaChuaDuLichSu: tatCa.filter(m => m.co === 'chua-du-lich-su').length,
            soMaTonAm: tatCa.filter(m => m.tonHienTai < 0).length,
            tongTonAm: lam(tatCa.reduce((s2, m) => s2 + Math.min(0, m.tonHienTai), 0)),
            tienCanBoNgay: lam([...hetHang, ...canDat].reduce((s, m) => s + m.tienCanBo, 0)),
            /* Tách riêng phần tiền thuộc mã bán giật cục. Một con số tổng gộp
             * chung dễ đọc thành "phải bỏ ngay ngần này" trong khi phần lớn có
             * thể đến từ vài mã có đơn sỉ bất thường — người dùng cần thấy được
             * bao nhiêu trong đó là chắc chắn. */
            soMaGiatCuc: [...hetHang, ...canDat].filter(m => m.nhuCauGiatCuc).length,
            tienCanBoNgayGiatCuc: lam([...hetHang, ...canDat]
                .filter(m => m.nhuCauGiatCuc).reduce((s, m) => s + m.tienCanBo, 0)),
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
