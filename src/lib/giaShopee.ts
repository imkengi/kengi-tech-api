/* ═══════════════════════════════════════════════════════════════════════════════
 *  TÍNH GIÁ ĐĂNG SHOPEE — lõi thuần (không DB, không mạng) cho AI tự quản shop
 *  (31/10/2026)
 *
 *  Chủ shop: "AI tự quản lý 1 trang Shopee riêng, tự đăng sản phẩm, tính toán mức
 *  giá để đăng và bán hàng". Phần này là "tính toán mức giá".
 *
 *  ─── MÔ HÌNH PHÍ ──────────────────────────────────────────────────────────────
 *  Phí Shopee của MỘT đơn = tyLe × giá bán + coDinh (phí cố định/đơn, vd phí hạ
 *  tầng). Hai tham số lấy từ CHÍNH DỮ LIỆU ĐƠN ĐÃ ĐỐI SOÁT của gian đó
 *  (OnlineOrder.platformFee = giá bán − thực nhận, xem ShopeeService.getEscrowDetail)
 *  — không gõ cứng biểu phí, vì biểu phí đổi theo ngành, theo gói Freeship/Voucher
 *  Xtra mà gian có tham gia hay không, và Shopee đổi biểu phí vài lần mỗi năm.
 *
 *  Gian chưa đủ SO_DON_TOI_THIEU đơn đối soát để đo (09/11/2026, chủ shop: "xem phí phải ghi rõ ra không thể
 *  mượn được") ⇒ KHÔNG mượn số đo của gian khác (Mall / thường, ngành hàng khác nhau ⇒ phí khác nhau), mà:
 *   - chủ shop đã KHAI phí sàn của gian (OnlineChannel.commissionRate > 0 và khác PHI_KENH_MAC_DINH) ⇒ dùng số
 *     khai, gắn `khai` và NÓI RÕ là số khai — người duyệt được, máy không tự đăng mới / hạ giá;
 *   - chưa khai (vẫn mức mặc định 6% của schema, hoặc 0) ⇒ CHƯA BIẾT PHÍ (`chuaBiet`) — không tính giá.
 *
 *  HOA HỒNG AFFILIATE ĐO TỪNG ĐƠN (01/11/2026, OnlineOrder.affiliateFee = escrow
 *  order_ams_commission_fee, nằm TRONG platformFee): đủ SO_DON_TU_GHI đơn và ≥ 90% mẫu biết
 *  hoa hồng ⇒ mô hình trên đo trên phí − hoa hồng (phí KHÔNG gồm affiliate, `affiliate.tachRieng`),
 *  kèm phần doanh thu trả affiliate trung bình (tyLeTB) và mức cao nhất một đơn (tyLeMax).
 *  Ít đơn biết hơn (đang bù dần) ⇒ giữ mô hình gộp như cũ, nhưng tyLeMax vẫn vào giá sàn.
 *
 *  ─── CÔNG THỨC GIÁ ────────────────────────────────────────────────────────────
 *  Lãi = P − (tyLe·P + coDinh) − giáVốn − phíĐóngGói − quảngCáo%·P − thuếGTGT·P [− affiliate%·P]
 *  Muốn Lãi = biên%·P  ⇒  P = (giáVốn + coDinh + phíĐóngGói) / (1 − tyLe − biên% − quảngCáo% − thuếGTGT [− affiliate%])
 *  thuếGTGT = v/(1+v): phần thuế đầu ra nằm trong giá bán của doanh nghiệp khấu trừ — escrow
 *  Shopee KHÔNG trừ khoản này nên phí đo từ đơn không có nó (hộ kinh doanh: Shopee khấu trừ
 *  thuế khoán ngay trong escrow ⇒ đã nằm trong phí đo, để 0).
 *  Giá MỤC TIÊU dùng phí đo thật (đã gồm hoa hồng affiliate TRUNG BÌNH của mọi đơn — mô
 *  hình tách affiliate thì cộng lại tyLeTB).
 *  GIÁ SÀN (01/11/2026, chủ shop chọn) tính như MỌI đơn đều qua affiliate: phí đo + trọn
 *  hoa hồng affiliate, mức hoa hồng = max(mức khai trong chính sách, tyLeMax đo được) — mô
 *  hình gộp thì dư một chút vì phí đo đã gồm phần affiliate trung bình, chủ ý thận trọng:
 *  đơn affiliate bán đúng giá sàn vẫn đạt biên tối thiểu. Giá đề xuất ≥ giá sàn.
 *  Giá hoà vốn = công thức sàn với biên = 0 (hoà vốn kể cả đơn qua affiliate).
 *  Tính cho đơn 1 sản phẩm (phí cố định gánh trọn) — chủ ý thận trọng.
 *
 *  ─── LUẬT AN TOÀN ─────────────────────────────────────────────────────────────
 *  - Thiếu giá vốn ⇒ KHÔNG tính giá (hopLe=false). Không biết vốn thì không biết lỗ.
 *  - Chưa biết phí sàn của gian (`chuaBiet`, 09/11/2026) ⇒ KHÔNG tính giá (hopLe=false) — cùng lẽ: không biết
 *    phí thì không biết lỗ. Không ai ghi được giá nào (người lẫn máy) tới khi khai phí hoặc đủ đơn để đo.
 *  - Giá dưới SÀN (biên tối thiểu, mặc định 5% — cùng ngưỡng NGUONG_LOI_NHUAN_THAP,
 *    không bao giờ < 0) ⇒ công cụ ghi giá phải từ chối. AI không được bán lỗ.
 * ═══════════════════════════════════════════════════════════════════════════════ */

export interface DongPhiDon {
    /** giá bán của đơn trên sàn (thực nhận + phí) */
    giaBan: number
    /** tổng phí sàn đã khấu trừ */
    phi: number
    /** hoa hồng affiliate của đơn — đã nằm trong `phi`. null / thiếu = chưa đọc được (KHÁC 0) */
    aff?: number | null
}

/** Hoa hồng affiliate đo từ từng đơn đã đối soát (OnlineOrder.affiliateFee). */
export interface AffiliateDo {
    /** true ⇒ tyLe / coDinh / saiSo của mô hình là phí KHÔNG gồm affiliate (đo trên phí − hoa hồng) */
    tachRieng: boolean
    /** Σ hoa hồng / Σ giá bán các đơn biết hoa hồng (0..1) — phần doanh thu trả affiliate trung bình */
    tyLeTB: number
    /** hoa hồng / giá bán cao nhất trong MỘT đơn (0..0,5) — trường hợp xấu nhất, vào giá sàn */
    tyLeMax: number
    /** số đơn biết hoa hồng (kể cả 0) / số đơn có hoa hồng > 0 */
    soDonBiet: number
    soDonCo: number
}

export interface MauPhi {
    /** tỷ lệ phí theo giá bán, 0..1 */
    tyLe: number
    /** phí cố định mỗi đơn, VND */
    coDinh: number
    nguon: 'hoi-quy-don' | 'ty-le-don' | 'cau-hinh-kenh'
    soDon: number
    ghiChu: string
    /** khoảng giá bán và giá bán TRUNG BÌNH của các đơn đã đo (không có khi chưa đo) */
    giaBanMin?: number
    giaBanMax?: number
    giaBanTB?: number
    /** sai số của phép đo — để biết ở mức giá nào phí đo đủ chắc cho máy tự ghi (saiSoTyLePhi) */
    saiSo?: { kieu: 'hoi-quy'; s2: number; n: number; tbX: number; sxx: number } | { kieu: 'ty-le'; se: number }
    /** không có khi chưa đơn nào đọc được hoa hồng */
    affiliate?: AffiliateDo
    /** Mô hình đo RIÊNG cho ngành này (mã ngành trên sàn) — từ đơn chỉ có hàng của ngành đó. Không có = cả gian. */
    nganh?: string
    /** Sản phẩm thuộc ngành này nhưng ngành CHƯA đủ đơn để đo riêng ⇒ đang dùng phí cả gian (02/11/2026, chủ shop:
     *  "mỗi ngành hàng lại 1 % phí khác nhau") — đủ để người xem, KHÔNG đủ để máy tự đăng / hạ giá (lyDoPhiChuaDuTin). */
    thayNganh?: string
    /** Gian đã đo ra phí từng ngành khác nhau mà sản phẩm CHƯA RÕ ngành trên sàn ⇒ đang dùng phí cả gian (cùng rào như thayNganh). */
    chuaRoNganh?: boolean
    /** Phí KHAI (09/11/2026): gian chưa đủ SO_DON_TOI_THIEU đơn đối soát để đo, chủ shop đã khai phí sàn của gian ở kênh
     *  (OnlineChannel.commissionRate > 0, khác PHI_KENH_MAC_DINH) ⇒ tyLe = số khai. Người duyệt từng kế hoạch được; máy KHÔNG
     *  tự đăng mới / hạ giá (lyDoPhiChuaDuTin) — số khai không phải số đo. Chỉ có khi nguon = 'cau-hinh-kenh'. */
    khai?: boolean
    /** CHƯA BIẾT PHÍ (09/11/2026, chủ shop: "xem phí phải ghi rõ ra không thể mượn được"): gian chưa đủ đơn đối soát để đo
     *  VÀ chưa khai phí (commissionRate vẫn mặc định PHI_KENH_MAC_DINH, hoặc ≤ 0) ⇒ tinhGiaDeXuat không tính giá (hopLe=false),
     *  không lệnh nào ghi được giá — như thiếu giá vốn. Không còn mượn số đo của gian khác cùng sàn: gian Mall và gian thường,
     *  ngành hàng khác nhau thì phí khác nhau ("mall lại phí khác á"). Chỉ có khi nguon = 'cau-hinh-kenh'; tyLe vẫn là số cấu
     *  hình nhưng KHÔNG được dùng để tính giá. */
    chuaBiet?: boolean
}

export const SO_DON_TOI_THIEU = 8
/** Mức phí sàn mặc định của kênh — khớp schema-store.prisma `OnlineChannel.commissionRate Float @default(6)` (và cột thêm bằng
 *  /admin/migrate: DEFAULT 6). Gian còn đúng mức này là CHƯA AI KHAI phí (09/11/2026): 6% thấp xa phí sàn thật (~20–30%), tính
 *  giá theo nó là bán lỗ mà tưởng lãi ⇒ coi là chưa biết phí (MauPhi.chuaBiet). Đổi default schema thì đổi cả hằng này. */
export const PHI_KENH_MAC_DINH = 6
/** Chỗ chủ shop khai phí sàn của gian — nhãn đúng như trên kengi.vn (dò ChannelManagerModal 09/11/2026: trang Đơn Hàng Online,
 *  nút «Kênh bán hàng» mở hộp "Kênh Bán Hàng Online", nút «Key» ở dòng của gian mở chi tiết, ô «Phí sàn (%)» + Lưu ⇒ PUT
 *  /api/online-orders/channels/:id/fee-config). Nói trong mọi lý do "chưa biết phí": chủ shop cần đường bấm, không cần lời khuyên. */
export const DUONG_KHAI_PHI = 'Kênh bán online: Bán Hàng Online → Đơn Hàng Online → nút «Kênh bán hàng» → nút «Key» ở dòng của gian → ô «Phí sàn (%)» → Lưu'
/** Bản gọn cho dòng kết quả chu kỳ (thông báo chủ shop cắt mỗi dòng ở 180 ký tự). */
const DUONG_KHAI_PHI_GON = 'Đơn Hàng Online → «Kênh bán hàng» → «Key» → ô «Phí sàn (%)»'
/** Chỉ nơi (không cả đường bấm) — câu về phí ĐÃ khai: chủ shop đã tìm ra chỗ đó một lần. */
const NOI_KHAI_PHI = 'Kênh bán online (ô «Phí sàn (%)» của gian)'

/** Lý do "chưa biết phí" — MỘT câu dùng chung cho kết quả tính giá, trạng thái Pilot, tool AI: nói vì sao + đường bấm khai. */
export function lyDoChuaBietPhi(soDon?: number, tenGian?: string): string {
    const n = Math.max(0, Math.round(Number(soDon) || 0))
    const ten = String(tenGian || '').trim()
    return `Chưa biết phí sàn của gian${ten ? ` "${ten}"` : ''}: mới có ${n}/${SO_DON_TOI_THIEU} đơn đã đối soát (chưa đủ để đo phí thật) ` +
        `và chưa khai phí — không tính được giá, không ghi được giá nào. Khai phí sàn của gian ở ${DUONG_KHAI_PHI}.`
}

/**
 * Dòng kết quả chu kỳ Pilot khi CẢ gian chưa biết phí (09/11/2026) — MỘT dòng cho cả lượt, không mỗi mã một dòng (chuông chủ
 * shop không bị spam; khoá báo của lib/pilotBaoChuShop giữ nguyên qua các lượt ⇒ chỉ báo một lần). Chữ "CHƯA BIẾT PHÍ" là thứ
 * canNguoi nhận ra. Đường bấm đi TRƯỚC số đơn: dòng dài bị cắt ở 180 ký tự thì mất phần đuôi chứ không mất cách sửa.
 * `viec` = việc máy bỏ lượt này, vd "chưa đổi giá / đăng mới mã nào".
 */
export function dongChuKyChuaBietPhi(soDon: number | undefined, tenGian: string | undefined, viec: string): string {
    const n = Math.max(0, Math.round(Number(soDon) || 0))
    const ten = String(tenGian || '').trim()
    return `CHƯA BIẾT PHÍ sàn của gian${ten ? ` "${ten}"` : ''} — khai ở ${DUONG_KHAI_PHI_GON}. ` +
        `Gian mới có ${n}/${SO_DON_TOI_THIEU} đơn đã đối soát: ${viec}.`
}
const SO_DON_HOI_QUY = 15
/** Máy (chu kỳ Tự động, tool AI) chỉ tự đăng mới / hạ giá khi phí đo từ ít nhất chừng này đơn, và sai số đo ×HE_SO_SAI_SO
 *  không vượt biên tối thiểu — xem lyDoPhiChuaDuTin. Dưới mức đó: kế hoạch chờ người duyệt (TĂNG giá vẫn tự làm). */
export const SO_DON_TU_GHI = 30
const HE_SO_SAI_SO = 4

const phanTram = (r: number) => `${round2(r * 100)}%`

/**
 * Ước lượng phí sàn từ đơn đã đối soát. Đủ đơn và giá trải rộng ⇒ hồi quy phí = a·giá + b
 * (tách được phí cố định/đơn). Không thì tỷ lệ tổng phí / tổng giá.
 * Dưới SO_DON_TOI_THIEU đơn ⇒ phí KHAI của kênh (`khai`) hoặc CHƯA BIẾT PHÍ (`chuaBiet`) — xem doMauPhi; `tenGian` chỉ
 * để câu ghiChu nói rõ gian nào (09/11/2026).
 * Đơn biết hoa hồng affiliate (`aff`) ⇒ kèm `affiliate`; đủ SO_DON_TU_GHI đơn và ≥ 90% mẫu biết thì đo
 * phí trên phí − hoa hồng của chính những đơn đó (tách affiliate ra khỏi phí).
 */
export function uocLuongPhi(dong: DongPhiDon[], tyLeCauHinhPct: number, tenGian?: string): MauPhi {
    const ds = (dong || []).filter(d =>
        Number.isFinite(d.giaBan) && Number.isFinite(d.phi) && d.giaBan > 0 && d.phi >= 0 && d.phi < d.giaBan)
    // Hoa hồng nằm TRONG phí: dòng có hoa hồng > phí là số lệch (escrow đổi sau lúc đối soát) — coi như chưa biết
    const biet = ds.filter(d => d.aff != null && Number.isFinite(d.aff) && d.aff >= 0 && d.aff <= d.phi)
    if (!biet.length) return doMauPhi(ds, tyLeCauHinhPct, tenGian)
    const affCua = (d: DongPhiDon) => Number(d.aff) || 0
    const aff: AffiliateDo = {
        // Tách khi đủ đơn VÀ gần trọn mẫu đã biết hoa hồng (đang bù dần thì chưa): tách trên một phần nhỏ của mẫu thì
        // hoa hồng chỉ được nhìn qua ít đơn, dễ sót hẳn đơn affiliate mà mô hình gộp trên cả mẫu vẫn thấy (trong phí TB).
        tachRieng: biet.length >= SO_DON_TU_GHI && biet.length >= 0.9 * ds.length,
        tyLeTB: biet.reduce((s, d) => s + affCua(d), 0) / biet.reduce((s, d) => s + d.giaBan, 0),
        tyLeMax: Math.min(0.5, biet.reduce((m, d) => Math.max(m, affCua(d) / d.giaBan), 0)),
        soDonBiet: biet.length,
        soDonCo: biet.filter(d => affCua(d) > 0).length,
    }
    const mau = aff.tachRieng
        ? doMauPhi(biet.map(d => ({ giaBan: d.giaBan, phi: d.phi - affCua(d) })), tyLeCauHinhPct, tenGian)
        : doMauPhi(ds, tyLeCauHinhPct, tenGian)
    return { ...mau, affiliate: aff, ghiChu: `${mau.ghiChu} ${ghiChuAffiliate(aff)}` }
}

/** Một câu cho người đọc về hoa hồng affiliate đo được — nối sau ghiChu của mô hình phí. */
export function ghiChuAffiliate(a: AffiliateDo): string {
    if (!a.soDonCo) return `Hoa hồng affiliate đọc được ở ${a.soDonBiet} đơn: chưa đơn nào qua affiliate.`
    return a.tachRieng
        ? `Hoa hồng affiliate đo riêng từ ${a.soDonBiet} đơn (${a.soDonCo} đơn qua affiliate): trung bình ${phanTram(a.tyLeTB)} doanh thu, ` +
            `cao nhất ${phanTram(a.tyLeMax)} một đơn — phí trên KHÔNG gồm hoa hồng; giá sàn tính hoa hồng ít nhất ${phanTram(a.tyLeMax)}.`
        : `Hoa hồng affiliate mới đọc được ở ${a.soDonBiet} đơn (${a.soDonCo} đơn qua affiliate, cao nhất ${phanTram(a.tyLeMax)} một đơn) — ` +
            `chưa đủ để tách, phí trên vẫn gộp hoa hồng trung bình; giá sàn tính hoa hồng ít nhất ${phanTram(a.tyLeMax)}.`
}

function doMauPhi(ds: DongPhiDon[], tyLeCauHinhPct: number, tenGian?: string): MauPhi {
    const cauHinh = Math.min(Math.max(Number(tyLeCauHinhPct) || 0, 0), 60) / 100

    if (ds.length < SO_DON_TOI_THIEU) {
        /* 09/11/2026 (chủ shop: "xem phí phải ghi rõ ra không thể mượn được"): không đủ đơn của CHÍNH gian thì chỉ có số chủ
         * shop tự khai cho gian này; còn mức mặc định 6% của schema (chưa ai đổi) hay 0 là CHƯA BIẾT PHÍ — 6% thấp xa phí
         * thật ~20–30%, trước đây tính giá theo nó là giá sàn lỗ mà tưởng lãi. */
        const r = Number(tyLeCauHinhPct)
        const khai = Number.isFinite(r) && r > 0 && r !== PHI_KENH_MAC_DINH
        const ten = String(tenGian || '').trim()
        const khongMuon = 'Không mượn số đo của gian khác: gian Mall / gian thường, ngành hàng khác nhau thì phí khác nhau.'
        if (!khai) {
            return { tyLe: cauHinh, coDinh: 0, nguon: 'cau-hinh-kenh', soDon: ds.length, chuaBiet: true, ghiChu: `${lyDoChuaBietPhi(ds.length, ten)} ${khongMuon}` }
        }
        return {
            tyLe: cauHinh, coDinh: 0, nguon: 'cau-hinh-kenh', soDon: ds.length, khai: true,
            ghiChu: `Gian${ten ? ` "${ten}"` : ''} mới có ${ds.length}/${SO_DON_TOI_THIEU} đơn đã đối soát — CHƯA ĐO được phí thật, đang dùng phí KHAI ` +
                `${round2(cauHinh * 100)}% ở ${NOI_KHAI_PHI}. Số khai không phải số đo: phí sàn thật gồm cả phí cố định, phí thanh toán, ` +
                `Freeship/Voucher Xtra — giá tính ra có thể lãi ít hơn dự kiến. ${khongMuon}`,
        }
    }

    const tongGia = ds.reduce((s, d) => s + d.giaBan, 0)
    const tongPhi = ds.reduce((s, d) => s + d.phi, 0)
    const tyLeTong = tongPhi / tongGia
    const giaBanMin = Math.min(...ds.map(d => d.giaBan)), giaBanMax = Math.max(...ds.map(d => d.giaBan))
    const giaBanTB = tongGia / ds.length

    if (ds.length >= SO_DON_HOI_QUY) {
        const n = ds.length
        let varGia = 0
        for (const d of ds) varGia += (d.giaBan - giaBanTB) ** 2
        const doLech = Math.sqrt(varGia / n) / giaBanTB   // hệ số biến thiên của giá
        if (varGia > 0 && doLech >= 0.2) {
            /* Hồi quy TỶ LỆ phí theo 1/giá (01/11/2026): phí/giá = a + b·(1/giá) — tương đương bình phương tối thiểu
             * trọng số 1/giá² trên phí = a·giá + b. Nhiễu phí sàn TỶ LỆ với giá (hoa hồng affiliate, voucher % chỉ có ở
             * một số đơn): hồi quy thẳng trên phí để vài đơn đắt kéo lệch phí cố định b cả nghìn đồng, mà b quyết định
             * giá sàn của hàng rẻ. Dữ liệu không nhiễu thì hai cách ra cùng a, b. */
            const xs = ds.map(d => 1 / d.giaBan), ys = ds.map(d => d.phi / d.giaBan)
            const tbX = xs.reduce((s, v) => s + v, 0) / n, tbY = ys.reduce((s, v) => s + v, 0) / n
            let cov = 0, varX = 0
            for (let i = 0; i < n; i++) { cov += (xs[i]! - tbX) * (ys[i]! - tbY); varX += (xs[i]! - tbX) ** 2 }
            const b = varX > 0 ? cov / varX : NaN
            const a = tbY - b * tbX
            if (a > 0 && a < 0.5 && b >= -1 && b <= 50_000) {
                const coDinh = Math.max(0, Math.round(b))
                let rss = 0
                for (let i = 0; i < n; i++) rss += (ys[i]! - a - b * xs[i]!) ** 2
                return {
                    tyLe: a, coDinh, nguon: 'hoi-quy-don', soDon: n, giaBanMin, giaBanMax, giaBanTB,
                    saiSo: { kieu: 'hoi-quy', s2: rss / (n - 2), n, tbX, sxx: varX },
                    ghiChu: `Đo từ ${n} đơn đã đối soát: phí ≈ ${round2(a * 100)}% giá bán + ${coDinh.toLocaleString('vi-VN')}đ/đơn.`,
                }
            }
        }
    }
    // sai số chuẩn của ước lượng tỷ số Σphí/Σgiá
    let e2 = 0
    for (const d of ds) e2 += (d.phi - tyLeTong * d.giaBan) ** 2
    const se = Math.sqrt(e2 / (ds.length - 1)) / (Math.sqrt(ds.length) * giaBanTB)
    return {
        tyLe: tyLeTong, coDinh: 0, nguon: 'ty-le-don', soDon: ds.length, giaBanMin, giaBanMax, giaBanTB, saiSo: { kieu: 'ty-le', se },
        ghiChu: `Đo từ ${ds.length} đơn đã đối soát: phí trung bình ${round2(tyLeTong * 100)}% giá bán (đã gồm phí cố định chia đều).`,
    }
}

export interface ThamSoGia {
    /** giá vốn 1 đơn vị bán */
    giaVon: number
    /** mô hình phí (MauPhi) — có `affiliate` thì dùng hoa hồng đo được, xem tyLeAffiliate / tyLePhiKyVong.
     *  `chuaBiet` (MauPhi.chuaBiet, 09/11/2026) ⇒ không tính giá; `soDon` chỉ để lý do nói gian có bao nhiêu đơn đối soát. */
    phi: { tyLe: number; coDinh: number; affiliate?: AffiliateDo; chuaBiet?: boolean; soDon?: number }
    /** biên lãi mục tiêu trên giá bán, % */
    bienLoiNhuanPct: number
    /** biên tối thiểu — dưới mức này là "giá sàn", công cụ ghi từ chối. Mặc định 5, không < 0 */
    bienToiThieuPct?: number
    /** chi phí đóng gói / vật tư mỗi đơn, VND */
    phiDongGoi?: number
    /** % giá bán dành cho quảng cáo / voucher shop */
    phiQuangCaoPct?: number
    /** hoa hồng affiliate khai trong chính sách, % giá bán — CHỈ vào giá sàn / hoà vốn (như mọi đơn đều qua
     *  affiliate). Một đơn đã đo được hoa hồng cao hơn (phi.affiliate.tyLeMax) thì lấy số đo. */
    phiAffiliatePct?: number
    /** thuế suất GTGT đầu ra, % (doanh nghiệp khấu trừ) — phần thuế trong giá = v/(1+v) */
    thueGtgtPct?: number
    /** bước làm tròn LÊN, mặc định 1.000đ */
    lamTron?: number
    /** giới hạn giá của Shopee (get_item_limit) nếu biết */
    giaShopeeMin?: number
    giaShopeeMax?: number
}

export interface DanhGiaGia {
    gia: number
    phiSan: number
    /** thuế GTGT đầu ra nằm trong giá (0 nếu không khai) */
    thueGtgt: number
    /** hoa hồng affiliate (chỉ khi đánh giá đơn qua affiliate) */
    hoaHongAffiliate: number
    loiNhuan: number
    bienPct: number
}

export interface KetQuaGia {
    hopLe: boolean
    lyDo?: string
    giaDeXuat: number
    /** giá thấp nhất được phép (đạt biên tối thiểu) */
    giaSan: number
    giaHoaVon: number
    duKien: DanhGiaGia | null
    /** cùng giá đề xuất nhưng đơn đi qua affiliate (trường hợp xấu nhất) */
    duKienAffiliate: DanhGiaGia | null
    canhBao: string[]
    thamSo: {
        /** tyLePhiPct = mô hình phí (KHÔNG gồm affiliate khi đo tách); phiAffiliatePct = hoa hồng giá sàn dùng
         *  (max mức khai, mức đo cao nhất); phiAffiliateTBPct = hoa hồng trung bình cộng vào giá mục tiêu khi đo tách */
        giaVon: number; tyLePhiPct: number; phiCoDinh: number; phiDongGoi: number; phiQuangCaoPct: number
        phiAffiliatePct: number; phiAffiliateTBPct: number; thueGtgtPct: number; bienMucTieuPct: number; bienToiThieuPct: number; lamTron: number
    }
}

const round2 = (n: number) => Math.round(n * 100) / 100
const lamTronLen = (n: number, buoc: number) => Math.ceil(n / buoc) * buoc

const pctKep = (v: any, max: number) => Math.min(Math.max(Number(v) || 0, 0), max)
/** Phần thuế GTGT đầu ra trong giá bán đã gồm thuế: v/(1+v). */
const tyLeThue = (t: { thueGtgtPct?: number }) => { const v = pctKep(t.thueGtgtPct, 10) / 100; return v / (1 + v) }
/** Hoa hồng affiliate XẤU NHẤT (giá sàn, hoà vốn, đơn qua affiliate): mức khai hoặc mức cao nhất đo được ở một đơn. */
const tyLeAffiliate = (t: { phiAffiliatePct?: number; phi?: ThamSoGia['phi'] }) =>
    Math.max(pctKep(t.phiAffiliatePct, 50), pctKep((Number(t.phi?.affiliate?.tyLeMax) || 0) * 100, 50)) / 100
/** Phần hoa hồng trung bình cộng lại vào phí KỲ VỌNG — chỉ khi mô hình phí đo tách affiliate (không thì đã gộp sẵn). */
const tyLeAffiliateTB = (phi: ThamSoGia['phi']) => (phi.affiliate?.tachRieng ? pctKep((Number(phi.affiliate.tyLeTB) || 0) * 100, 50) / 100 : 0)

/**
 * Lãi của MỘT mức giá cụ thể (đơn 1 sản phẩm). `quaAffiliate` = đơn đi qua affiliate (trừ thêm
 * trọn hoa hồng) — trường hợp xấu nhất, là thứ giá sàn phải giữ. Không qua affiliate = đơn kỳ vọng
 * (phí đo, gồm hoa hồng trung bình).
 */
export function danhGiaGia(gia: number, t: Pick<ThamSoGia, 'giaVon' | 'phi' | 'phiDongGoi' | 'phiQuangCaoPct' | 'phiAffiliatePct' | 'thueGtgtPct'>, quaAffiliate = false): DanhGiaGia {
    const phiSan = (t.phi.tyLe + (quaAffiliate ? 0 : tyLeAffiliateTB(t.phi))) * gia + t.phi.coDinh
    const quangCao = ((t.phiQuangCaoPct || 0) / 100) * gia
    const thue = tyLeThue(t) * gia
    const aff = quaAffiliate ? tyLeAffiliate(t) * gia : 0
    const loiNhuan = gia - phiSan - t.giaVon - (t.phiDongGoi || 0) - quangCao - thue - aff
    return {
        gia: Math.round(gia),
        phiSan: Math.round(phiSan),
        thueGtgt: Math.round(thue),
        hoaHongAffiliate: Math.round(aff),
        loiNhuan: Math.round(loiNhuan),
        bienPct: gia > 0 ? round2((loiNhuan / gia) * 100) : 0,
    }
}

/** Giá đạt đúng biên `bienPct` (chưa làm tròn). Infinity nếu mẫu số ≤ 0. */
function giaDatBien(t: ThamSoGia, bienPct: number, quaAffiliate: boolean): number {
    const mau = 1 - t.phi.tyLe - bienPct / 100 - (t.phiQuangCaoPct || 0) / 100 - tyLeThue(t) - (quaAffiliate ? tyLeAffiliate(t) : tyLeAffiliateTB(t.phi))
    if (mau <= 0.02) return Infinity
    return (t.giaVon + t.phi.coDinh + (t.phiDongGoi || 0)) / mau
}

export function tinhGiaDeXuat(t: ThamSoGia): KetQuaGia {
    const lamTron = t.lamTron && t.lamTron > 0 ? t.lamTron : 1000
    const bienToiThieu = Math.max(0, Number.isFinite(t.bienToiThieuPct as number) ? Number(t.bienToiThieuPct) : 5)
    const bienMucTieu = Math.max(bienToiThieu, Number(t.bienLoiNhuanPct) || 0)
    const thamSo = {
        giaVon: Math.round(t.giaVon || 0),
        tyLePhiPct: round2(t.phi.tyLe * 100),
        phiCoDinh: Math.round(t.phi.coDinh),
        phiDongGoi: Math.round(t.phiDongGoi || 0),
        phiQuangCaoPct: t.phiQuangCaoPct || 0,
        phiAffiliatePct: round2(tyLeAffiliate(t) * 100),
        phiAffiliateTBPct: round2(tyLeAffiliateTB(t.phi) * 100),
        thueGtgtPct: round2(pctKep(t.thueGtgtPct, 10)),
        bienMucTieuPct: bienMucTieu,
        bienToiThieuPct: bienToiThieu,
        lamTron,
    }
    const hong = (lyDo: string): KetQuaGia => ({ hopLe: false, lyDo, giaDeXuat: 0, giaSan: 0, giaHoaVon: 0, duKien: null, duKienAffiliate: null, canhBao: [], thamSo })

    if (!(t.giaVon > 0)) return hong('Sản phẩm CHƯA CÓ GIÁ VỐN — không tính được lãi/lỗ nên không đề xuất giá. Cập nhật giá vốn trước.')
    // Sau giá vốn (thiếu vốn là việc của TỪNG sản phẩm, phí là việc của cả gian — báo cái cần sửa ở sản phẩm trước).
    // giaSan = 0 ⇒ chanGiaDuoiSan chặn MỌI lệnh ghi giá: đăng mới, đổi giá, khuyến mãi, người lẫn máy (09/11/2026).
    if (t.phi.chuaBiet) return hong(lyDoChuaBietPhi(t.phi.soDon))

    const tp: ThamSoGia = { ...t, bienLoiNhuanPct: bienMucTieu, bienToiThieuPct: bienToiThieu }
    const hoaVon = giaDatBien(tp, 0, true)
    const san = giaDatBien(tp, bienToiThieu, true)
    const mucTieu = giaDatBien(tp, bienMucTieu, false)
    if (!Number.isFinite(mucTieu) || !Number.isFinite(san)) {
        // mục tiêu không đạt ⇒ phí kỳ vọng (gồm hoa hồng trung bình); chỉ sàn không đạt ⇒ phí đo + hoa hồng xấu nhất
        const tren = [`phí sàn ${Number.isFinite(mucTieu) ? thamSo.tyLePhiPct : round2(thamSo.tyLePhiPct + thamSo.phiAffiliateTBPct)}%`, `quảng cáo ${thamSo.phiQuangCaoPct}%`,
            thamSo.thueGtgtPct ? `thuế GTGT ${thamSo.thueGtgtPct}%` : '',
            Number.isFinite(mucTieu) && thamSo.phiAffiliatePct ? `affiliate ${thamSo.phiAffiliatePct}%` : ''].filter(Boolean)
        return hong(`Biên lãi ${Number.isFinite(mucTieu) ? bienToiThieu : bienMucTieu}% + ${tren.join(' + ')} đã gần/vượt 100% giá bán — không có giá nào đạt. Giảm biên, quảng cáo hoặc affiliate.`)
    }

    const canhBao: string[] = []
    const giaSan = lamTronLen(san, 100)
    // Mục tiêu tính với phí đo trung bình; affiliate cao có thể đẩy sàn lên trên mục tiêu ⇒ đề xuất không dưới sàn
    let giaDeXuat = lamTronLen(Math.max(mucTieu, giaSan), lamTron)
    if (t.giaShopeeMin && giaDeXuat < t.giaShopeeMin) {
        giaDeXuat = lamTronLen(t.giaShopeeMin, lamTron)
        canhBao.push(`Giá tính ra thấp hơn mức tối thiểu Shopee cho phép (${t.giaShopeeMin.toLocaleString('vi-VN')}đ) — đã nâng lên.`)
    }
    if (t.giaShopeeMax && giaDeXuat > t.giaShopeeMax) {
        return { ...hong(`Giá cần để đạt biên (${giaDeXuat.toLocaleString('vi-VN')}đ) vượt trần Shopee cho phép (${t.giaShopeeMax.toLocaleString('vi-VN')}đ).`), giaSan, giaHoaVon: Math.ceil(hoaVon) }
    }
    return {
        hopLe: true,
        giaDeXuat,
        giaSan,
        giaHoaVon: Math.ceil(hoaVon),
        duKien: danhGiaGia(giaDeXuat, tp),
        duKienAffiliate: danhGiaGia(giaDeXuat, tp, true),
        canhBao,
        thamSo,
    }
}

/**
 * Chặn giá trước khi GHI lên Shopee. Trả null nếu được, chuỗi lý do nếu bị chặn.
 * Dùng chung cho đăng mới và đổi giá — AI không có đường nào ghi giá dưới sàn.
 */
export function chanGiaDuoiSan(gia: number, kq: KetQuaGia): string | null {
    if (!kq.hopLe && kq.giaSan <= 0) return kq.lyDo || 'Không tính được giá sàn'
    if (!Number.isFinite(gia) || gia <= 0) return 'Giá không hợp lệ'
    if (gia < kq.giaSan) {
        const aff = kq.thamSo.phiAffiliatePct ? ` kể cả đơn qua affiliate ${kq.thamSo.phiAffiliatePct}%` : ''
        return `Giá ${Math.round(gia).toLocaleString('vi-VN')}đ thấp hơn GIÁ SÀN ${kq.giaSan.toLocaleString('vi-VN')}đ ` +
            `(biên tối thiểu ${kq.thamSo.bienToiThieuPct}%${aff}; hoà vốn ${kq.giaHoaVon.toLocaleString('vi-VN')}đ) — không ghi.`
    }
    return null
}

/**
 * Phí sàn có đủ tin để MÁY tự đăng mới / hạ giá về mức này không (chu kỳ tự động, tool AI). null = được.
 * Người duyệt từng kế hoạch thì chỉ cảnh báo — đây là rào cho lúc không ai xem. Có lý do mà máy TĂNG giá
 * thì vẫn được (lãi mỗi đơn tăng theo giá) — doiGiaShopee soát chiều tăng với giá đọc thẳng từ Shopee.
 *  - Chưa đo được phí (09/11/2026): gian chưa khai phí ⇒ chưa biết phí (tinhGiaDeXuat đã không tính giá); gian đã
 *    khai ⇒ số khai không phải số đo (phí Shopee thật ~20–30%, gồm phí cố định / phí thanh toán), giá sàn có thể lỗ.
 *  - Phí đo kiểu TỶ LỆ TRUNG BÌNH (không tách được phí cố định/đơn) mà giá thấp hơn giá trung bình các
 *    đơn đã đo: tỷ lệ trung bình = a + b/giáTB, hàng rẻ hơn giáTB chịu b/giá > b/giáTB ⇒ thiếu phí.
 *    Từ giáTB trở lên thì tỷ lệ trung bình chỉ có DƯ phí, nên an toàn.
 *  - Mới đo phí từ ít đơn (dưới SO_DON_TU_GHI): loại phí chỉ có ở một phần đơn (affiliate, voucher, phí dịch vụ
 *    theo chương trình) có thể chưa lọt vào mẫu — sai số tính từ mẫu không thấy được thứ mẫu chưa gặp.
 *  - Hồi quy tách được phí cố định nhưng giá thấp hơn MỌI đơn đã đo ⇒ đang ngoại suy, không tự ghi.
 *  - Phí các đơn lệch nhau nhiều (affiliate, voucher chỉ có ở vài đơn): sai số tỷ lệ phí ở mức giá đó
 *    (HE_SO_SAI_SO lần sai số chuẩn) lớn hơn biên tối thiểu ⇒ sai số đo có thể ăn hết biên, không tự ghi.
 *  Đo bằng mô phỏng (scripts/check-pilot-khong-lo.ts, phần D2 — phí biến động KHÔNG khai trong chính sách):
 *  3σ từ 8 đơn ⇒ ~0,1% giá máy tự ghi lỗ kỳ vọng, tệ nhất −5%; 4σ + ≥ 30 đơn ⇒ 0 giá lỗ.
 */
export function lyDoPhiChuaDuTin(gia: number, phi: MauPhi, bienToiThieuPct = 5): string | null {
    const d = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`
    if (phi.nguon === 'cau-hinh-kenh') {
        // 09/11/2026: không còn nhánh "mượn số đo gian khác" — gian chưa đủ đơn chỉ có số KHAI hoặc chưa biết phí
        if (phi.chuaBiet) return `${lyDoChuaBietPhi(phi.soDon)} Máy không tự đăng mới / hạ giá: không biết phí thì không biết lỗ.`
        if (phi.khai) {
            return `Phí sàn CHƯA ĐO được (${phi.soDon}/${SO_DON_TOI_THIEU} đơn đã đối soát) — đang dùng phí KHAI ${round2(phi.tyLe * 100)}% ở ` +
                `${NOI_KHAI_PHI}; số khai không phải số đo (phí sàn thật thường 20–30%), giá sàn tính ra có thể vẫn lỗ. ` +
                'Máy không tự đăng mới / hạ giá: người duyệt từng kế hoạch trên Pilot.'
        }
        return `Phí sàn CHƯA ĐO được (${phi.soDon}/${SO_DON_TOI_THIEU} đơn đã đối soát) — đang dùng ${round2(phi.tyLe * 100)}% cấu hình kênh, ` +
            'phí sàn thật thường 20–30%, giá sàn tính ra có thể vẫn lỗ. Máy không tự đăng mới / hạ giá: người duyệt từng kế hoạch trên Pilot.'
    }
    if (phi.thayNganh) {
        return `Ngành của sản phẩm (${phi.thayNganh}) chưa đủ đơn đối soát để đo phí riêng — đang dùng phí trung bình cả gian, mà mỗi ngành ` +
            'phí một khác. Máy không tự đăng mới / hạ giá: người duyệt từng kế hoạch trên Pilot.'
    }
    if (phi.chuaRoNganh) {
        return 'Sản phẩm chưa rõ ngành trên sàn — đang dùng phí trung bình cả gian, mà mỗi ngành phí một khác. ' +
            'Máy không tự đăng mới / hạ giá: người duyệt từng kế hoạch trên Pilot.'
    }
    if (!(phi.soDon >= SO_DON_TU_GHI)) {
        return `Phí sàn mới đo từ ${phi.soDon}/${SO_DON_TU_GHI} đơn đã đối soát — ít đơn thì loại phí chỉ có ở một phần đơn (affiliate, voucher, ` +
            'phí dịch vụ theo chương trình) có thể chưa lọt vào số đo. Máy không tự đăng mới / hạ giá: người duyệt từng kế hoạch trên Pilot.'
    }
    if (phi.nguon === 'ty-le-don' && phi.giaBanTB && gia < phi.giaBanTB) {
        return `Giá ${d(gia)} thấp hơn giá trung bình các đơn đã đo phí (${d(phi.giaBanTB)}) — phí đo là tỷ lệ trung bình, chưa tách được ` +
            'phí cố định mỗi đơn nên hàng rẻ hơn mức đó có thể bị tính thiếu phí. Máy không tự đăng / hạ giá về mức này: người duyệt trên Pilot.'
    }
    if (phi.nguon === 'hoi-quy-don' && phi.giaBanMin && gia < phi.giaBanMin) {
        return `Giá ${d(gia)} thấp hơn mọi đơn đã đo phí (rẻ nhất ${d(phi.giaBanMin)}) — phí cố định mỗi đơn chưa được đo ở vùng giá này. ` +
            'Máy không tự đăng / hạ giá về mức này: người duyệt trên Pilot.'
    }
    const se = saiSoTyLePhi(gia, phi)
    const nguong = Math.max(Number(bienToiThieuPct) || 0, 1) / 100
    if (se != null && HE_SO_SAI_SO * se > nguong) {
        return `Phí sàn ở mức giá ${d(gia)} đo chưa đủ chắc: phí các đơn đã đo lệch nhau nhiều, sai số ±${round2(HE_SO_SAI_SO * se * 100)} điểm % — ` +
            `lớn hơn biên tối thiểu ${round2(nguong * 100)}%, cần thêm đơn đối soát. Máy không tự đăng / hạ giá về mức này: người duyệt trên Pilot.`
    }
    return null
}

/** Sai số chuẩn của TỶ LỆ phí đo được ở mức giá `gia` (0..1). null = không có số đo (phí cấu hình kênh). */
export function saiSoTyLePhi(gia: number, phi: MauPhi): number | null {
    const s = phi.saiSo
    if (!s) return null
    if (s.kieu === 'ty-le') return Number.isFinite(s.se) ? s.se : null
    if (!(gia > 0) || !(s.sxx > 0) || !Number.isFinite(s.s2)) return null
    return Math.sqrt(s.s2 * (1 / s.n + (1 / gia - s.tbX) ** 2 / s.sxx))
}
