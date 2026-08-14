/**
 * CỖ MÁY CƠ HỘI TĂNG TRƯỞNG — bốn câu hỏi chiến lược của một cửa hàng bán lẻ:
 *
 *   1. SỈ HAY LẺ?   Nhóm nào thực sự nuôi cửa hàng, nhóm nào chỉ làm đẹp doanh thu.
 *   2. BÁN KÈM GÌ?  Cặp hàng nào hay đi cùng nhau hơn mức ngẫu nhiên → dựng combo.
 *   3. DỒN HAY TRẢI? Lãi đang dựa vào bao nhiêu mã hàng, bao nhiêu khách — dồn lực
 *                    thì nhanh nhưng gãy một chân là gãy cả bàn.
 *   4. MÙA NÀO?     Doanh thu lên xuống theo tháng, theo thứ, theo giờ ra sao.
 *
 * Đặt ở backend chứ không ở giao diện, vì cùng bộ số này phải phục vụ hai nơi:
 * trang Chiến Lược trên web và trợ lý AI qua MCP. Hai bản chép tay sớm muộn lệch
 * nhau, và lúc đó không ai biết bên nào đúng.
 *
 * BA QUY TẮC TỰ ÁP:
 *  - Không đủ dữ liệu thì trả `duocKetLuan: false` kèm lý do, KHÔNG hạ ngưỡng
 *    xuống cho có kết quả. Một combo dựng từ 2 lần trùng hợp là mê tín, không
 *    phải phân tích.
 *  - Mọi con số "tiềm năng" đều phải lộ rõ giả định đứng sau nó. Người đọc sẽ
 *    dựa vào đó để bỏ vốn.
 *  - Ngưỡng phân loại (sỉ/lẻ) suy từ chính dữ liệu cửa hàng, không dùng hằng số
 *    áp đặt — mỗi ngành có tầm giá khác nhau.
 */

export interface KyPhanTich {
    tu: Date
    den: Date
    moTa: string
}

/* ─────────────────────────────────────────────────────── kiểu dữ liệu ra */

export interface NhomBan {
    ten: string
    soDon: number
    doanhThu: number
    loiNhuan: number
    bienLai: number | null
    donTrungBinh: number
    soKhachDinhDanh: number
    tyTrongDoanhThu: number
    tyTrongLoiNhuan: number
}

export interface CapBanKem {
    a: string
    b: string
    tenA: string
    tenB: string
    soDonCoCa2: number
    /** Trong các đơn có A, bao nhiêu phần trăm cũng có B. */
    tyLeKemTheo: number
    /** >1 nghĩa là đi cùng nhau nhiều hơn mức ngẫu nhiên. 2.0 = gấp đôi. */
    lift: number
    donCoAChuaCoB: number
    giaTriTrungBinhB: number
    laiTrungBinhB: number
    tiemNangDoanhThu: number
    tiemNangLoiNhuan: number
}

export interface MatHangMua {
    productId: string
    ten: string
    /** Chỉ số mùa vụ theo tháng: 100 = đúng mức trung bình của chính mặt hàng. */
    theoThang: { thang: number; chiSo: number; doanhThu: number }[]
    thangCaoNhat: number
    thangThapNhat: number
    bienDo: number
}

export interface MatHangNhayGia {
    productId: string
    ten: string
    /** Số ngày có bán, dùng làm số quan sát cho phép hồi quy. */
    soNgay: number
    giaThapNhat: number
    giaCaoNhat: number
    giaHienTai: number
    /** Độ co giãn: giá tăng 1% thì lượng bán đổi bao nhiêu %. Âm là bình thường. */
    doCoGian: number
    /** Phép hồi quy giải thích được bao nhiêu phần biến động lượng bán, 0–1. */
    doTinCay: number
    nhay: 'ít nhạy' | 'nhạy'
    bienLai: number | null
    /** Nếu tăng giá 5%: lượng bán, doanh thu, lợi nhuận đổi bao nhiêu phần trăm. */
    tang5: { luong: number; doanhThu: number; loiNhuan: number | null }
    /** Nếu giảm giá 5%. */
    giam5: { luong: number; doanhThu: number; loiNhuan: number | null }
    /** Hướng nên thử, viết bằng lời. */
    goiY: string
}

export interface KetQuaCoHoi {
    ky: { tu: string; den: string; moTa: string }
    quyMo: { soDon: number; soDongHang: number; doanhThu: number; loiNhuan: number; daCatBot: boolean }

    siLe: {
        duocKetLuan: boolean
        lyDo?: string
        nguongSi: number
        cachChia: string
        nhom: NhomBan[]
        nhanXet: string
        danhDoi: string
    }

    banKem: {
        duocKetLuan: boolean
        lyDo?: string
        soDonNhieuMon: number
        tyLeDonNhieuMon: number
        tyLeChuyenDoiGiaDinh: number
        cap: CapBanKem[]
        tongTiemNangLoiNhuan: number
    }

    tapTrung: {
        duocKetLuan: boolean
        lyDo?: string
        soMaHang: number
        soMaTao80LaiSuat: number
        tyLeMaTao80: number
        hhiHang: number
        mucTapTrungHang: 'phân tán' | 'vừa' | 'cao'
        topKhachChiemTyLe: number | null
        soKhachChiem50: number | null
        maHangDauTau: { ten: string; loiNhuan: number; tyTrong: number }[]
        canhBao: string[]
        nhanXet: string
    }

    muaVu: {
        duocKetLuan: boolean
        lyDo?: string
        soNgayDuLieu: number
        theoThu: { thu: number; ten: string; doanhThu: number; soNgay: number; chiSo: number }[]
        theoGio: { gio: number; doanhThu: number; chiSo: number }[]
        theoThang: { thang: number; doanhThu: number; soNgay: number; chiSo: number }[] | null
        gioVang: string
        ngayVang: string
        xuHuong: { nuaDau: number; nuaSau: number; thayDoi: number; nhan: string } | null
        matHangTheoMua: MatHangMua[]
        nhanXet: string
    }

    doNhayGia: {
        duocKetLuan: boolean
        lyDo?: string
        soMaDoDuoc: number
        soMaDaXet: number
        matHang: MatHangNhayGia[]
        canhBao: string
    }

    khuyenNghi: { ma: string; tieuDe: string; viSao: string; lamGi: string; danhDoi: string; uocTinh: number | null }[]
    ghiChu: string[]
    thieu: string[]
}

/* ─────────────────────────────────────────────────────────────── tiện ích */

const lam = (n: any) => Math.round(Number(n) || 0);
const so = (n: any) => (Number.isFinite(Number(n)) ? Number(n) : 0)
const VN_OFFSET_MS = 7 * 3600 * 1000
const TEN_THU = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

/** Tách phần ngày/giờ theo múi giờ Việt Nam — DB lưu UTC. */
function vn(d: any) {
    const t = new Date(new Date(d).getTime() + VN_OFFSET_MS)
    return {
        ngay: t.toISOString().slice(0, 10),
        thu: t.getUTCDay(),
        gio: t.getUTCHours(),
        thang: t.getUTCMonth() + 1,
    }
}

function trungVi(xs: number[]): number {
    if (xs.length === 0) return 0
    const s = [...xs].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function phanVi(xs: number[], p: number): number {
    if (xs.length === 0) return 0
    const s = [...xs].sort((a, b) => a - b)
    const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))
    return s[i]
}

/* ─────────────────────────────────────────────────────────────── chính */

export async function coHoiTangTruong(
    prisma: any,
    ky: KyPhanTich,
    tuyChon?: { tyLeChuyenDoi?: number; nguongSoLuongSi?: number; tranDon?: number },
): Promise<KetQuaCoHoi> {
    const thieu: string[] = []
    const ghiChu: string[] = []
    const tyLeChuyenDoi = Math.min(1, Math.max(0.01, tuyChon?.tyLeChuyenDoi ?? 0.15))
    const nguongSoLuongSi = Math.max(2, tuyChon?.nguongSoLuongSi ?? 10)
    const tranDon = Math.max(500, Math.min(30000, tuyChon?.tranDon ?? 15000))

    /* Truy vấn TUẦN TỰ — pool Prisma mỗi cửa hàng chỉ vài kết nối; bắn song song
     * là một lượt xem báo cáo có thể hút cạn pool đúng lúc cron đang chạy. */
    let donHang: any[] = []
    try {
        donHang = await prisma.transaction.findMany({
            where: { createdAt: { gte: ky.tu, lte: ky.den }, status: 'completed' },
            select: {
                id: true, createdAt: true, total: true, customerId: true,
                items: { select: { productId: true, productName: true, quantity: true, unitPrice: true, lineTotal: true } },
            },
            orderBy: { createdAt: 'asc' },
            take: tranDon,
        })
    } catch (e: any) {
        thieu.push(`Không đọc được đơn hàng: ${String(e?.message || e).slice(0, 120)}`)
    }
    const daCatBot = donHang.length >= tranDon
    if (daCatBot) ghiChu.push(`Kỳ này có rất nhiều đơn — phần mềm chỉ phân tích ${tranDon.toLocaleString('vi-VN')} đơn đầu kỳ để không làm nghẽn máy chủ. Thu hẹp khoảng ngày sẽ cho kết quả phủ trọn vẹn.`)

    // Giá vốn: lấy một lượt cho toàn bộ mã hàng xuất hiện trong kỳ.
    const idHang = Array.from(new Set(donHang.flatMap((d: any) => (d.items || []).map((i: any) => String(i.productId))).filter(Boolean)))
    const giaVon = new Map<string, number>()
    const tenHang = new Map<string, string>()
    if (idHang.length > 0) {
        try {
            const ds = await prisma.product.findMany({
                where: { id: { in: idHang } },
                select: { id: true, name: true, costPrice: true },
            })
            for (const p of ds) { giaVon.set(String(p.id), so(p.costPrice)); tenHang.set(String(p.id), String(p.name || '')) }
        } catch (e: any) {
            thieu.push(`Không đọc được giá vốn: ${String(e?.message || e).slice(0, 120)}`)
            ghiChu.push('Chưa đọc được giá vốn — phần lợi nhuận đang để trống, KHÔNG được hiểu là lãi bằng 0.')
        }
    }
    const coGiaVon = giaVon.size > 0

    /* Chuẩn hoá mỗi đơn về: doanh thu, lãi gộp, tập mã hàng, số lượng lớn nhất.
     * lineTotal đã trừ chiết khấu dòng nên dùng thẳng; đơn giá dùng để đo mùa vụ
     * chứ không dùng để cộng doanh thu. */
    interface Don { id: string; tien: number; lai: number; hang: string[]; slMax: number; khach: string | null; luc: any }
    const don: Don[] = donHang.map((d: any) => {
        const items = d.items || []
        let lai = 0, slMax = 0
        for (const i of items) {
            const sl = so(i.quantity)
            if (sl > slMax) slMax = sl
            const gv = giaVon.get(String(i.productId))
            if (gv !== undefined) lai += so(i.lineTotal) - gv * sl
            if (!tenHang.has(String(i.productId))) tenHang.set(String(i.productId), String(i.productName || ''))
        }
        return {
            id: String(d.id),
            tien: so(d.total),
            lai,
            hang: Array.from(new Set(items.map((i: any) => String(i.productId)).filter(Boolean))),
            slMax,
            khach: d.customerId ? String(d.customerId) : null,
            luc: vn(d.createdAt),
        }
    })

    const tongDoanhThu = don.reduce((s, d) => s + d.tien, 0)
    const tongLai = don.reduce((s, d) => s + d.lai, 0)
    const tongDong = donHang.reduce((s: number, d: any) => s + (d.items?.length || 0), 0)

    // ══════════════════════════════════════════════════ 1. SỈ vs LẺ
    const siLe = phanTichSiLe(don, tongDoanhThu, tongLai, nguongSoLuongSi, coGiaVon)

    // ══════════════════════════════════════════════════ 2. BÁN KÈM
    const banKem = phanTichBanKem(don, tenHang, giaVon, donHang, tyLeChuyenDoi, coGiaVon)

    // ══════════════════════════════════════════════════ 3. TẬP TRUNG
    const tapTrung = phanTichTapTrung(donHang, don, tenHang, giaVon, tongDoanhThu, coGiaVon)

    // ══════════════════════════════════════════════════ 4. MÙA VỤ
    const muaVu = phanTichMuaVu(don, donHang, tenHang, ky)

    // ══════════════════════════════════════════════════ 5. ĐỘ NHẠY GIÁ
    const doNhayGia = phanTichDoNhayGia(donHang, tenHang, giaVon, coGiaVon)

    // ══════════════════════════════════════════════════ Khuyến nghị
    const khuyenNghi = dungKhuyenNghi(siLe, banKem, tapTrung, muaVu, doNhayGia)

    ghiChu.push('Mọi con số "tiềm năng" là ước tính dựa trên giả định ghi ngay cạnh nó, không phải cam kết kết quả.')
    if (!coGiaVon) ghiChu.push('Thiếu giá vốn nên mọi kết luận về LÃI ở trang này chưa dùng được — chỉ đọc phần doanh thu.')

    const nhan = (d: Date) => new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10)
    return {
        ky: { tu: nhan(ky.tu), den: nhan(ky.den), moTa: ky.moTa },
        quyMo: { soDon: don.length, soDongHang: tongDong, doanhThu: lam(tongDoanhThu), loiNhuan: coGiaVon ? lam(tongLai) : 0, daCatBot },
        siLe, banKem, tapTrung, muaVu, doNhayGia, khuyenNghi, ghiChu, thieu,
    }
}

/* ══════════════════════════════════════════════════ 1. SỈ vs LẺ */

function phanTichSiLe(don: any[], tongDT: number, tongLai: number, nguongSL: number, coGiaVon: boolean): KetQuaCoHoi['siLe'] {
    if (don.length < 20) {
        return {
            duocKetLuan: false,
            lyDo: `Kỳ này mới có ${don.length} đơn — quá ít để tách nhóm sỉ và lẻ một cách có nghĩa. Cần ít nhất 20 đơn.`,
            nguongSi: 0, cachChia: '', nhom: [], nhanXet: '', danhDoi: '',
        }
    }

    /* Ngưỡng suy TỪ DỮ LIỆU của chính cửa hàng: đơn lớn gấp 3 lần đơn trung vị
     * thì không còn là mua lẻ nữa. Dùng hằng số cứng (ví dụ "trên 2 triệu là sỉ")
     * sẽ sai hoàn toàn khi đem sang cửa hàng ngành khác. */
    const nguongTien = Math.max(1, trungVi(don.map(d => d.tien)) * 3)

    const laSi = (d: any) => d.slMax >= nguongSL || d.tien >= nguongTien
    const nhomSi = don.filter(laSi)
    const nhomLe = don.filter((d: any) => !laSi(d))

    const dungNhom = (ten: string, ds: any[]): NhomBan => {
        const dt = ds.reduce((s, d) => s + d.tien, 0)
        const li = ds.reduce((s, d) => s + d.lai, 0)
        return {
            ten,
            soDon: ds.length,
            doanhThu: lam(dt),
            loiNhuan: coGiaVon ? lam(li) : 0,
            bienLai: coGiaVon && dt > 0 ? Math.round((li / dt) * 1000) / 10 : null,
            donTrungBinh: ds.length ? lam(dt / ds.length) : 0,
            soKhachDinhDanh: new Set(ds.map(d => d.khach).filter(Boolean)).size,
            tyTrongDoanhThu: tongDT > 0 ? Math.round((dt / tongDT) * 1000) / 10 : 0,
            tyTrongLoiNhuan: coGiaVon && tongLai !== 0 ? Math.round((li / tongLai) * 1000) / 10 : 0,
        }
    }

    const nhom = [dungNhom('Đơn sỉ / mua nhiều', nhomSi), dungNhom('Đơn lẻ', nhomLe)]
    const [S, L] = nhom

    let nhanXet: string
    let danhDoi: string
    if (S.soDon === 0) {
        nhanXet = 'Kỳ này chưa có đơn nào đạt ngưỡng sỉ — cửa hàng đang thuần bán lẻ.'
        danhDoi = 'Mở mảng sỉ sẽ kéo doanh thu lên nhanh nhưng biên lãi mỏng hơn và cần vốn hàng lớn hơn; nếu vốn đang căng thì đừng vội.'
    } else if (S.bienLai !== null && L.bienLai !== null) {
        const chenh = Math.round((L.bienLai - S.bienLai) * 10) / 10
        nhanXet = `Đơn sỉ chiếm ${S.tyTrongDoanhThu}% doanh thu nhưng chỉ ${S.tyTrongLoiNhuan}% lợi nhuận; biên lãi sỉ ${S.bienLai}% so với lẻ ${L.bienLai}%` +
            (chenh > 0 ? ` — mỗi đồng doanh thu sỉ mang về ít hơn lẻ ${chenh} điểm phần trăm.` : ` — nhóm sỉ đang lãi tốt ngang hoặc hơn lẻ, đây là điều hiếm và đáng giữ.`)
        danhDoi = chenh > 5
            ? 'Đẩy mạnh sỉ sẽ làm doanh thu đẹp lên nhưng kéo biên lãi chung xuống; chỉ đáng làm nếu nó giúp quay vòng hàng nhanh hơn hoặc giành được giá nhập tốt hơn từ nhà cung cấp.'
            : 'Sỉ đang không làm hỏng biên lãi — có thể đẩy thêm, nhưng theo dõi công nợ vì khách sỉ hay xin nợ.'
    } else {
        nhanXet = `Đơn sỉ chiếm ${S.tyTrongDoanhThu}% doanh thu. Chưa có giá vốn nên chưa so được biên lãi hai nhóm.`
        danhDoi = 'Nhập giá vốn cho hàng hoá rồi xem lại — quyết định đẩy sỉ hay lẻ mà không biết biên lãi là quyết định mù.'
    }

    return {
        duocKetLuan: true,
        nguongSi: lam(nguongTien),
        cachChia: `Đơn được xếp vào nhóm sỉ khi có một mặt hàng mua từ ${nguongSL} đơn vị trở lên, HOẶC tổng đơn từ ${lam(nguongTien).toLocaleString('vi-VN')}đ (gấp 3 lần đơn trung vị của chính cửa hàng này).`,
        nhom, nhanXet, danhDoi,
    }
}

/* ══════════════════════════════════════════════════ 2. BÁN KÈM */

function phanTichBanKem(
    don: any[], tenHang: Map<string, string>, giaVon: Map<string, number>,
    donHang: any[], tyLeChuyenDoi: number, coGiaVon: boolean,
): KetQuaCoHoi['banKem'] {
    const nhieuMon = don.filter(d => d.hang.length >= 2)
    const N = don.length
    const tyLeNhieuMon = N > 0 ? Math.round((nhieuMon.length / N) * 1000) / 10 : 0

    if (nhieuMon.length < 30) {
        return {
            duocKetLuan: false,
            lyDo: `Chỉ có ${nhieuMon.length} đơn mua từ 2 mặt hàng trở lên. Dựng combo từ vài chục lần trùng hợp là đoán mò — cần ít nhất 30 đơn nhiều món.`,
            soDonNhieuMon: nhieuMon.length, tyLeDonNhieuMon: tyLeNhieuMon,
            tyLeChuyenDoiGiaDinh: tyLeChuyenDoi, cap: [], tongTiemNangLoiNhuan: 0,
        }
    }

    /* Đếm số đơn chứa từng mã trên TOÀN BỘ đơn, kể cả đơn một món — còn cặp thì
     * đương nhiên chỉ đếm được ở đơn nhiều món.
     *
     * Vì sao phải thế: nếu chỉ đếm trong nhóm đơn nhiều món, một cặp luôn đi
     * cùng nhau sẽ có lift đúng bằng 1,0 (cả hai xuất hiện 100% trong nhóm đó)
     * và bị loại — tức là cặp bán kèm MẠNH NHẤT lại là cặp bị bỏ sót. Mẫu số
     * phải là toàn bộ giỏ hàng thì "hơn mức ngẫu nhiên" mới có nghĩa. */
    const demMon = new Map<string, number>()
    const demCap = new Map<string, number>()
    for (const d of don) for (const h of d.hang) demMon.set(h, (demMon.get(h) || 0) + 1)
    for (const d of nhieuMon) {
        const hs = d.hang.slice(0, 20).sort()   // chặn đơn "quét cả kho" làm nổ số cặp
        for (let i = 0; i < hs.length; i++) {
            for (let j = i + 1; j < hs.length; j++) {
                const k = `${hs[i]}|${hs[j]}`
                demCap.set(k, (demCap.get(k) || 0) + 1)
            }
        }
    }

    // Doanh thu và lãi trung bình mỗi đơn CÓ mặt hàng đó — dùng để quy cơ hội ra tiền.
    const tienMon = new Map<string, { dt: number; lai: number }>()
    for (const d of donHang) {
        for (const i of (d.items || [])) {
            const id = String(i.productId)
            const o = tienMon.get(id) || { dt: 0, lai: 0 }
            o.dt += so(i.lineTotal)
            const gv = giaVon.get(id)
            if (gv !== undefined) o.lai += so(i.lineTotal) - gv * so(i.quantity)
            tienMon.set(id, o)
        }
    }

    /* Ngưỡng chống mê tín: cặp phải xuất hiện ít nhất 5 lần VÀ chiếm từ 1% số đơn
     * nhiều món. Lift phải vượt 1.3 — dưới mức đó chỉ là hai món bán chạy tình cờ
     * gặp nhau, gắn combo sẽ không đổi được gì. */
    const toiThieu = Math.max(5, Math.ceil(nhieuMon.length * 0.01))
    const M = don.length          // mẫu số là TOÀN BỘ giỏ hàng, xem ghi chú ở trên
    const cap: CapBanKem[] = []

    for (const [k, cAB] of demCap) {
        if (cAB < toiThieu) continue
        const [x, y] = k.split('|')
        const cX = demMon.get(x) || 0, cY = demMon.get(y) || 0
        if (!cX || !cY) continue
        const lift = (cAB * M) / (cX * cY)
        if (lift < 1.3) continue

        /* Hướng gợi ý chạy từ mặt hàng PHỔ BIẾN HƠN sang mặt hàng ít hơn: gắn
         * thêm món phụ vào món chính mới là bán kèm, ngược lại là ép khách. */
        const [a, b] = cX >= cY ? [x, y] : [y, x]
        const cA = Math.max(cX, cY), cB = Math.min(cX, cY)
        const tB = tienMon.get(b) || { dt: 0, lai: 0 }
        const giaTriB = cB > 0 ? tB.dt / cB : 0
        const laiB = cB > 0 ? tB.lai / cB : 0
        const thieuB = cA - cAB

        cap.push({
            a, b,
            tenA: tenHang.get(a) || a,
            tenB: tenHang.get(b) || b,
            soDonCoCa2: cAB,
            tyLeKemTheo: Math.round((cAB / cA) * 1000) / 10,
            lift: Math.round(lift * 100) / 100,
            donCoAChuaCoB: thieuB,
            giaTriTrungBinhB: lam(giaTriB),
            laiTrungBinhB: coGiaVon ? lam(laiB) : 0,
            tiemNangDoanhThu: lam(thieuB * giaTriB * tyLeChuyenDoi),
            tiemNangLoiNhuan: coGiaVon ? lam(thieuB * laiB * tyLeChuyenDoi) : 0,
        })
    }

    cap.sort((p, q) => (q.tiemNangLoiNhuan || q.tiemNangDoanhThu) - (p.tiemNangLoiNhuan || p.tiemNangDoanhThu))
    const top = cap.slice(0, 12)

    return {
        duocKetLuan: top.length > 0,
        lyDo: top.length === 0
            ? 'Không có cặp hàng nào đi cùng nhau nhiều hơn mức ngẫu nhiên đủ rõ. Giỏ hàng của cửa hàng này khá độc lập — combo sẽ không phải đòn bẩy mạnh, nên dồn sức vào hướng khác.'
            : undefined,
        soDonNhieuMon: nhieuMon.length,
        tyLeDonNhieuMon: tyLeNhieuMon,
        tyLeChuyenDoiGiaDinh: tyLeChuyenDoi,
        cap: top,
        tongTiemNangLoiNhuan: lam(top.reduce((s, c) => s + (c.tiemNangLoiNhuan || 0), 0)),
    }
}

/* ══════════════════════════════════════════════════ 3. TẬP TRUNG */

function phanTichTapTrung(
    donHang: any[], don: any[], tenHang: Map<string, string>, giaVon: Map<string, number>,
    tongDT: number, coGiaVon: boolean,
): KetQuaCoHoi['tapTrung'] {
    const theoHang = new Map<string, { dt: number; lai: number }>()
    for (const d of donHang) {
        for (const i of (d.items || [])) {
            const id = String(i.productId)
            const o = theoHang.get(id) || { dt: 0, lai: 0 }
            o.dt += so(i.lineTotal)
            const gv = giaVon.get(id)
            if (gv !== undefined) o.lai += so(i.lineTotal) - gv * so(i.quantity)
            theoHang.set(id, o)
        }
    }
    const soMa = theoHang.size
    if (soMa < 5) {
        return {
            duocKetLuan: false,
            lyDo: `Kỳ này chỉ bán ${soMa} mã hàng — chưa đủ để nói về mức độ tập trung.`,
            soMaHang: soMa, soMaTao80LaiSuat: 0, tyLeMaTao80: 0, hhiHang: 0, mucTapTrungHang: 'phân tán',
            topKhachChiemTyLe: null, soKhachChiem50: null, maHangDauTau: [], canhBao: [], nhanXet: '',
        }
    }

    /* Pareto tính trên LÃI chứ không trên doanh thu: mã bán nhiều mà lãi mỏng
     * không phải trụ cột, nó chỉ là mã kéo khách. Thiếu giá vốn thì đành quay về
     * doanh thu và nói rõ điều đó. */
    const dungLai = coGiaVon
    const xep = Array.from(theoHang.entries())
        .map(([id, v]) => ({ id, ten: tenHang.get(id) || id, giaTri: dungLai ? v.lai : v.dt, dt: v.dt }))
        .filter(x => x.giaTri > 0)
        .sort((a, b) => b.giaTri - a.giaTri)

    const tongGiaTri = xep.reduce((s, x) => s + x.giaTri, 0)
    let luy = 0, soMa80 = 0
    for (const x of xep) { luy += x.giaTri; soMa80++; if (luy >= tongGiaTri * 0.8) break }

    // HHI trên doanh thu: tổng bình phương thị phần nội bộ, thang 0–10.000.
    const hhi = tongDT > 0
        ? Math.round(Array.from(theoHang.values()).reduce((s, v) => s + Math.pow(v.dt / tongDT, 2), 0) * 10000)
        : 0
    const mucTapTrung: 'phân tán' | 'vừa' | 'cao' = hhi > 2500 ? 'cao' : hhi > 1500 ? 'vừa' : 'phân tán'

    // Tập trung phía khách hàng — chỉ tính trên phần đơn có định danh khách.
    const donCoKhach = don.filter(d => d.khach)
    let topKhach: number | null = null, soKhach50: number | null = null
    if (donCoKhach.length >= 20) {
        const theoKhach = new Map<string, number>()
        for (const d of donCoKhach) theoKhach.set(d.khach, (theoKhach.get(d.khach) || 0) + d.tien)
        const ds = Array.from(theoKhach.values()).sort((a, b) => b - a)
        const tongKhach = ds.reduce((s, v) => s + v, 0)
        if (tongKhach > 0) {
            const top10 = ds.slice(0, Math.max(1, Math.ceil(ds.length * 0.1))).reduce((s, v) => s + v, 0)
            topKhach = Math.round((top10 / tongKhach) * 1000) / 10
            let l = 0, n = 0
            for (const v of ds) { l += v; n++; if (l >= tongKhach * 0.5) break }
            soKhach50 = n
        }
    }

    const canhBao: string[] = []
    if (mucTapTrung === 'cao') {
        canhBao.push(`Doanh thu dồn vào rất ít mã hàng (chỉ số tập trung ${hhi}/10.000). Nhà cung cấp của những mã này tăng giá hay ngừng hàng là cửa hàng gãy ngay — nên có sẵn nguồn thay thế trước khi bị động.`)
    }
    if (topKhach !== null && topKhach > 50) {
        canhBao.push(`10% khách hàng lớn nhất đang chiếm ${topKhach}% doanh thu (trong nhóm khách có định danh). Mất một vài khách trong nhóm này là mất mảng lớn — đừng để họ chỉ quen một nhân viên duy nhất.`)
    }
    if (soMa80 <= Math.max(3, Math.ceil(soMa * 0.05))) {
        canhBao.push(`Chỉ ${soMa80} mã tạo ra 80% ${dungLai ? 'lợi nhuận' : 'doanh thu'} trong tổng số ${soMa} mã đang bán. Phần đuôi rất dài mà gần như không sinh lãi — nó đang ăn vốn tồn kho và chỗ trên kệ.`)
    }

    const tyLe80 = Math.round((soMa80 / soMa) * 1000) / 10
    const nhanXet = `${soMa80} trên ${soMa} mã hàng (${tyLe80}%) tạo ra 80% ${dungLai ? 'lợi nhuận' : 'doanh thu'} của kỳ. ` +
        (tyLe80 < 20
            ? 'Đây là cấu trúc rất tập trung: dồn lực vào nhóm đầu tàu sẽ hiệu quả hơn nhiều so với dàn đều, nhưng đổi lại rủi ro phụ thuộc cao.'
            : tyLe80 < 40
                ? 'Cấu trúc tập trung ở mức lành mạnh — vẫn có nhóm đầu tàu rõ ràng nhưng không đặt hết trứng vào một giỏ.'
                : 'Lợi nhuận trải khá đều. An toàn, nhưng cũng có nghĩa là chưa có mặt hàng nào đủ mạnh để làm thương hiệu cho cửa hàng.')

    return {
        duocKetLuan: true,
        soMaHang: soMa,
        soMaTao80LaiSuat: soMa80,
        tyLeMaTao80: tyLe80,
        hhiHang: hhi,
        mucTapTrungHang: mucTapTrung,
        topKhachChiemTyLe: topKhach,
        soKhachChiem50: soKhach50,
        maHangDauTau: xep.slice(0, 8).map(x => ({
            ten: x.ten,
            loiNhuan: lam(x.giaTri),
            tyTrong: tongGiaTri > 0 ? Math.round((x.giaTri / tongGiaTri) * 1000) / 10 : 0,
        })),
        canhBao, nhanXet,
    }
}

/* ══════════════════════════════════════════════════ 4. MÙA VỤ */

function phanTichMuaVu(don: any[], donHang: any[], tenHang: Map<string, string>, ky: KyPhanTich): KetQuaCoHoi['muaVu'] {
    const soNgay = Math.max(1, Math.round((ky.den.getTime() - ky.tu.getTime()) / 86400000))
    if (don.length < 30 || soNgay < 14) {
        return {
            duocKetLuan: false,
            lyDo: `Kỳ dài ${soNgay} ngày với ${don.length} đơn — quá ngắn để tách nhịp mùa vụ khỏi biến động ngẫu nhiên. Cần từ 14 ngày và 30 đơn trở lên.`,
            soNgayDuLieu: soNgay, theoThu: [], theoGio: [], theoThang: null,
            gioVang: '', ngayVang: '', xuHuong: null, matHangTheoMua: [], nhanXet: '',
        }
    }

    // ── Theo thứ trong tuần: phải chia cho SỐ LẦN thứ đó xuất hiện, không chia đều.
    const dtThu = new Array(7).fill(0)
    const ngayCuaThu = [new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>()]
    const dtGio = new Array(24).fill(0)
    const dtThang = new Map<number, number>()
    const ngayCuaThang = new Map<number, Set<string>>()
    const moiNgay = new Set<string>()

    for (const d of don) {
        dtThu[d.luc.thu] += d.tien
        ngayCuaThu[d.luc.thu].add(d.luc.ngay)
        dtGio[d.luc.gio] += d.tien
        dtThang.set(d.luc.thang, (dtThang.get(d.luc.thang) || 0) + d.tien)
        if (!ngayCuaThang.has(d.luc.thang)) ngayCuaThang.set(d.luc.thang, new Set())
        ngayCuaThang.get(d.luc.thang)!.add(d.luc.ngay)
        moiNgay.add(d.luc.ngay)
    }

    const tongDT = don.reduce((s, d) => s + d.tien, 0)
    const tbMoiNgay = moiNgay.size > 0 ? tongDT / moiNgay.size : 0

    const theoThu = dtThu.map((dt, thu) => {
        const n = ngayCuaThu[thu].size
        return {
            thu, ten: TEN_THU[thu], doanhThu: lam(dt), soNgay: n,
            chiSo: n > 0 && tbMoiNgay > 0 ? Math.round((dt / n / tbMoiNgay) * 100) : 0,
        }
    })

    const gioCoBan = dtGio.filter(v => v > 0).length || 1
    const tbMoiGio = tongDT / gioCoBan
    const theoGio = dtGio.map((dt, gio) => ({
        gio, doanhThu: lam(dt),
        chiSo: tbMoiGio > 0 ? Math.round((dt / tbMoiGio) * 100) : 0,
    })).filter(g => g.doanhThu > 0)

    /* Chỉ nói về mùa vụ theo THÁNG khi kỳ trải qua ít nhất 3 tháng có dữ liệu —
     * so hai tháng với nhau rồi gọi là "mùa" là kết luận ẩu. */
    const theoThang = ngayCuaThang.size >= 3
        ? Array.from(dtThang.entries()).map(([thang, dt]) => {
            const n = ngayCuaThang.get(thang)!.size
            return { thang, doanhThu: lam(dt), soNgay: n, chiSo: n > 0 && tbMoiNgay > 0 ? Math.round((dt / n / tbMoiNgay) * 100) : 0 }
        }).sort((a, b) => a.thang - b.thang)
        : null

    const thuTop = [...theoThu].filter(t => t.soNgay > 0).sort((a, b) => b.chiSo - a.chiSo)
    const gioTop = [...theoGio].sort((a, b) => b.doanhThu - a.doanhThu)
    const top3Gio = gioTop.slice(0, 3)
    const tyLeTop3 = tongDT > 0 ? Math.round((top3Gio.reduce((s, g) => s + g.doanhThu, 0) / tongDT) * 100) : 0

    const gioVang = top3Gio.length
        ? `${top3Gio.map(g => `${String(g.gio).padStart(2, '0')}h`).join(', ')} gom ${tyLeTop3}% doanh thu cả kỳ`
        : ''
    const ngayVang = thuTop.length
        ? `${thuTop[0].ten} mạnh nhất (chỉ số ${thuTop[0].chiSo}/100), ${thuTop[thuTop.length - 1].ten} yếu nhất (${thuTop[thuTop.length - 1].chiSo}/100)`
        : ''

    // ── Xu hướng trong kỳ: nửa đầu so nửa sau, quy về doanh thu mỗi ngày.
    const giua = ky.tu.getTime() + (ky.den.getTime() - ky.tu.getTime()) / 2
    const nuaDau = don.filter(d => new Date(d.luc.ngay + 'T00:00:00Z').getTime() < giua)
    const nuaSau = don.filter(d => new Date(d.luc.ngay + 'T00:00:00Z').getTime() >= giua)
    const ngayNua = Math.max(1, soNgay / 2)
    const dtDau = nuaDau.reduce((s, d) => s + d.tien, 0) / ngayNua
    const dtSau = nuaSau.reduce((s, d) => s + d.tien, 0) / ngayNua
    const thayDoi = dtDau > 0 ? Math.round(((dtSau - dtDau) / dtDau) * 1000) / 10 : 0
    const xuHuong = {
        nuaDau: lam(dtDau), nuaSau: lam(dtSau), thayDoi,
        nhan: Math.abs(thayDoi) < 5 ? 'đi ngang' : thayDoi > 0 ? 'đang lên' : 'đang xuống',
    }

    // ── Mặt hàng nào có tính mùa: chỉ xét khi kỳ trải ≥3 tháng.
    const matHangTheoMua: MatHangMua[] = []
    if (theoThang && theoThang.length >= 3) {
        const bang = new Map<string, Map<number, number>>()
        for (const d of donHang) {
            const t = vn(d.createdAt).thang
            for (const i of (d.items || [])) {
                const id = String(i.productId)
                if (!bang.has(id)) bang.set(id, new Map())
                const m = bang.get(id)!
                m.set(t, (m.get(t) || 0) + so(i.lineTotal))
            }
        }
        const soThang = theoThang.length
        for (const [id, m] of bang) {
            if (m.size < 3) continue
            const tong = Array.from(m.values()).reduce((s, v) => s + v, 0)
            if (tong <= 0) continue
            const tb = tong / soThang
            const rows = theoThang.map(t => ({ thang: t.thang, doanhThu: lam(m.get(t.thang) || 0), chiSo: tb > 0 ? Math.round(((m.get(t.thang) || 0) / tb) * 100) : 0 }))
            const cao = rows.reduce((a, b) => (b.chiSo > a.chiSo ? b : a))
            const thap = rows.reduce((a, b) => (b.chiSo < a.chiSo ? b : a))
            const bienDo = cao.chiSo - thap.chiSo
            /* Chỉ gọi là "hàng mùa vụ" khi tháng cao gấp đôi tháng thấp trở lên
             * VÀ doanh số đủ lớn để đáng đặt hàng theo mùa. */
            if (bienDo >= 100 && tong >= 1_000_000) {
                matHangTheoMua.push({ productId: id, ten: tenHang.get(id) || id, theoThang: rows, thangCaoNhat: cao.thang, thangThapNhat: thap.thang, bienDo })
            }
        }
        matHangTheoMua.sort((a, b) => b.bienDo - a.bienDo)
        matHangTheoMua.splice(10)
    }

    const nhanXet = [
        gioVang && `Khung giờ vàng: ${gioVang}.`,
        ngayVang && `Nhịp tuần: ${ngayVang}.`,
        `Doanh thu mỗi ngày nửa sau kỳ ${xuHuong.nhan}${Math.abs(thayDoi) >= 5 ? ` ${Math.abs(thayDoi)}%` : ''} so với nửa đầu.`,
        matHangTheoMua.length ? `${matHangTheoMua.length} mặt hàng có tính mùa rõ rệt — đặt hàng theo mùa sẽ tránh vừa thiếu vừa ế.` : '',
    ].filter(Boolean).join(' ')

    return {
        duocKetLuan: true,
        soNgayDuLieu: soNgay,
        theoThu, theoGio, theoThang,
        gioVang, ngayVang, xuHuong, matHangTheoMua, nhanXet,
    }
}

/* ══════════════════════════════════════════════════ 5. ĐỘ NHẠY GIÁ

 * Đo bằng chính lịch sử bán: gom theo NGÀY để có (giá bán bình quân, số lượng
 * bán), rồi hồi quy ln(lượng) theo ln(giá). Hệ số góc chính là độ co giãn —
 * giá tăng 1% thì lượng đổi bao nhiêu phần trăm.
 *
 * Vì sao gom theo ngày chứ không theo từng dòng bán: từng dòng chỉ nói "một
 * khách mua 2 cái", không nói gì về phản ứng của thị trường. Phải có một khoảng
 * thời gian ở một mức giá rồi so với khoảng khác ở mức giá khác.
 *
 * GIỚI HẠN PHẢI NÓI THẲNG: đây là tương quan, không phải nhân quả. Cửa hàng
 * thường giảm giá đúng lúc hàng ế hoặc đúng dịp lễ, nên một phần biến động
 * lượng bán là do dịp chứ không do giá. Vì vậy kết quả ở đây là GỢI Ý THỬ
 * NGHIỆM, không phải lệnh đổi giá.
 */

function phanTichDoNhayGia(
    donHang: any[], tenHang: Map<string, string>, giaVon: Map<string, number>, coGiaVon: boolean,
): KetQuaCoHoi['doNhayGia'] {
    // productId → ngày → { tiền, lượng }
    const bang = new Map<string, Map<string, { tien: number; luong: number }>>()
    for (const d of donHang) {
        const ngay = vn(d.createdAt).ngay
        for (const i of (d.items || [])) {
            const id = String(i.productId)
            const sl = so(i.quantity)
            if (sl <= 0) continue
            if (!bang.has(id)) bang.set(id, new Map())
            const m = bang.get(id)!
            const o = m.get(ngay) || { tien: 0, luong: 0 }
            o.tien += so(i.lineTotal)
            o.luong += sl
            m.set(ngay, o)
        }
    }

    const ra: MatHangNhayGia[] = []
    let daXet = 0
    /* Đếm riêng từng lý do bị loại. Gộp hết vào một câu "giá không đổi" là
     * khẳng định một nguyên nhân mình chưa hề kiểm — đúng cái lỗi mà cả bộ
     * thư viện này đang cố tránh. */
    let loaiViGiaKhongDoi = 0
    let loaiViDoYeu = 0

    for (const [id, theoNgay] of bang) {
        if (theoNgay.length !== undefined) { /* Map không có length — giữ chỗ cho ts */ }
        const diem = Array.from(theoNgay.entries())
            .map(([ngay, v]) => ({ ngay, gia: v.tien / v.luong, luong: v.luong }))
            .filter(p => p.gia > 0 && p.luong > 0)
        if (diem.length < 10) continue
        daXet++

        const gia = diem.map(p => p.gia)
        const gTb = gia.reduce((s, v) => s + v, 0) / gia.length
        const doLech = Math.sqrt(gia.reduce((s, v) => s + (v - gTb) ** 2, 0) / gia.length)
        const heSoBienThien = gTb > 0 ? doLech / gTb : 0
        const mucGia = new Set(gia.map(g => Math.round(g / 100) * 100)).size

        /* Không đổi giá bao giờ thì không đo được — và đó là câu trả lời đúng,
         * không phải lý do để nới ngưỡng xuống cho ra một con số nào đó. */
        if (heSoBienThien < 0.03 || mucGia < 3) { loaiViGiaKhongDoi++; continue }

        // Hồi quy bình phương nhỏ nhất trên thang log.
        const X = diem.map(p => Math.log(p.gia))
        const Y = diem.map(p => Math.log(p.luong))
        const n = X.length
        const xTb = X.reduce((s, v) => s + v, 0) / n
        const yTb = Y.reduce((s, v) => s + v, 0) / n
        let sxy = 0, sxx = 0, syy = 0
        for (let i = 0; i < n; i++) {
            sxy += (X[i] - xTb) * (Y[i] - yTb)
            sxx += (X[i] - xTb) ** 2
            syy += (Y[i] - yTb) ** 2
        }
        if (sxx <= 0 || syy <= 0) { loaiViGiaKhongDoi++; continue }
        const b = sxy / sxx
        const r2 = (sxy * sxy) / (sxx * syy)

        /* Bỏ qua khi phép đo quá yếu, hoặc khi hệ số DƯƠNG (giá tăng mà bán
         * nhiều hơn) — dấu dương gần như luôn là do mùa vụ hoặc đợt sỉ chen vào,
         * đem nó đi khuyên tăng giá là nguy hiểm. */
        if (r2 < 0.3 || b >= 0) { loaiViDoYeu++; continue }

        const giaCuoi = diem[diem.length - 1].gia
        const gv = giaVon.get(id)
        const bienLai = coGiaVon && gv !== undefined && giaCuoi > 0
            ? Math.round(((giaCuoi - gv) / giaCuoi) * 1000) / 10
            : null

        /* Với độ co giãn không đổi: lượng mới = lượng cũ × m^b, doanh thu mới =
         * cũ × m^(1+b). Lợi nhuận phải tính qua giá vốn chứ không suy từ doanh thu. */
        const moPhong = (m: number) => {
            const luong = (Math.pow(m, b) - 1) * 100
            const doanhThu = (Math.pow(m, 1 + b) - 1) * 100
            let loiNhuan: number | null = null
            if (coGiaVon && gv !== undefined && giaCuoi > gv) {
                const cu = giaCuoi - gv
                const moi = (giaCuoi * m - gv) * Math.pow(m, b)
                loiNhuan = Math.round(((moi - cu) / cu) * 1000) / 10
            }
            return { luong: Math.round(luong * 10) / 10, doanhThu: Math.round(doanhThu * 10) / 10, loiNhuan }
        }
        const tang5 = moPhong(1.05)
        const giam5 = moPhong(0.95)
        const itNhay = b > -1

        ra.push({
            productId: id,
            ten: tenHang.get(id) || id,
            soNgay: n,
            giaThapNhat: lam(Math.min(...gia)),
            giaCaoNhat: lam(Math.max(...gia)),
            giaHienTai: lam(giaCuoi),
            doCoGian: Math.round(b * 100) / 100,
            doTinCay: Math.round(r2 * 100) / 100,
            nhay: itNhay ? 'ít nhạy' : 'nhạy',
            bienLai,
            tang5, giam5,
            goiY: itNhay
                ? `Khách ít phản ứng với giá (giá lên 1% chỉ mất ${Math.abs(b).toFixed(2)}% lượng bán). Thử nâng 5% trên một chi nhánh trong 2 tuần: ước tính doanh thu ${tang5.doanhThu >= 0 ? '+' : ''}${tang5.doanhThu}%${tang5.loiNhuan !== null ? `, lợi nhuận ${tang5.loiNhuan >= 0 ? '+' : ''}${tang5.loiNhuan}%` : ''}.`
                : `Khách phản ứng mạnh với giá (giá lên 1% mất ${Math.abs(b).toFixed(2)}% lượng bán). Đừng tăng giá mặt hàng này; nếu biên lãi còn dày thì thử giảm 5% để lấy lượng: ước tính doanh thu ${giam5.doanhThu >= 0 ? '+' : ''}${giam5.doanhThu}%${giam5.loiNhuan !== null ? `, lợi nhuận ${giam5.loiNhuan >= 0 ? '+' : ''}${giam5.loiNhuan}%` : ''}.`,
        })
    }

    ra.sort((a, b2) => b2.doTinCay - a.doTinCay)
    const top = ra.slice(0, 12)

    return {
        duocKetLuan: top.length > 0,
        lyDo: top.length === 0
            ? (daXet === 0
                ? 'Chưa mặt hàng nào bán đủ 10 ngày trong kỳ để đo phản ứng của khách với giá. Kéo dài khoảng ngày rồi xem lại.'
                : loaiViDoYeu > loaiViGiaKhongDoi
                    ? `Đã xét ${daXet} mặt hàng, giá có dao động nhưng lượng bán không đi theo giá một cách rõ ràng — biến động phần lớn đến từ thứ khác (dịp lễ, hàng về, khách sỉ). Không đủ căn cứ để nói khách nhạy giá đến đâu.`
                    : `Đã xét ${daXet} mặt hàng bán đủ ngày nhưng giá gần như không đổi trong kỳ, nên không có gì để so. Muốn biết khách nhạy giá đến đâu thì phải thực sự thử đổi giá một mặt hàng trong vài tuần rồi đo.`)
            : undefined,
        soMaDoDuoc: top.length,
        soMaDaXet: daXet,
        matHang: top,
        canhBao: 'Đây là TƯƠNG QUAN, không phải nhân quả: cửa hàng thường giảm giá đúng lúc hàng ế hoặc đúng dịp lễ, nên một phần biến động lượng bán là do dịp chứ không do giá. Hãy coi đây là gợi ý để THỬ NGHIỆM có kiểm soát (một chi nhánh, hai tuần, giữ nguyên mọi thứ khác), không phải lệnh đổi giá.',
    }
}

/* ══════════════════════════════════════════════════ Khuyến nghị */

function dungKhuyenNghi(
    siLe: KetQuaCoHoi['siLe'], banKem: KetQuaCoHoi['banKem'],
    tapTrung: KetQuaCoHoi['tapTrung'], muaVu: KetQuaCoHoi['muaVu'],
    doNhayGia: KetQuaCoHoi['doNhayGia'],
): KetQuaCoHoi['khuyenNghi'] {
    const ra: KetQuaCoHoi['khuyenNghi'] = []

    /* Đòn bẩy giá đứng đầu danh sách khi đo được: nó không tốn thêm đồng vốn
     * nào, khác hẳn combo (tốn công gợi ý) hay mùa vụ (tốn vốn nhập trước). */
    const itNhay = doNhayGia.matHang.filter(m => m.nhay === 'ít nhạy' && (m.tang5.loiNhuan ?? 0) > 0)
    if (itNhay.length > 0) {
        const m = itNhay[0]
        ra.push({
            ma: 'gia',
            tieuDe: `Thử nâng giá ${m.ten} 5%`,
            viSao: `Đo trên ${m.soNgay} ngày bán thật: giá mặt hàng này lên 1% thì lượng bán chỉ giảm ${Math.abs(m.doCoGian).toFixed(2)}% — khách ít phản ứng với giá. Giá trong kỳ đã dao động từ ${m.giaThapNhat.toLocaleString('vi-VN')}đ đến ${m.giaCaoNhat.toLocaleString('vi-VN')}đ nên phép đo có cơ sở để so.`,
            lamGi: `Nâng 5% ở MỘT chi nhánh (hoặc một kênh) trong 2 tuần, giữ nguyên mọi thứ khác, rồi so lượng bán với chi nhánh đối chứng. Ước tính lợi nhuận mặt hàng này +${m.tang5.loiNhuan}%.`,
            danhDoi: 'Đây là tương quan chứ chưa phải nhân quả — có thể lượng bán biến động do dịp lễ hay hàng ế chứ không do giá. Thử trên diện hẹp trước, và nhớ rằng khách quen nhận ra giá tăng có thể mất thiện cảm dù vẫn mua.',
            uocTinh: null,
        })
    }

    if (banKem.duocKetLuan && banKem.cap.length > 0) {
        const c = banKem.cap[0]
        ra.push({
            ma: 'combo',
            tieuDe: `Dựng combo "${c.tenA} + ${c.tenB}"`,
            viSao: `Hai món này đã đi cùng nhau trong ${c.soDonCoCa2} đơn, tức là gấp ${c.lift} lần mức ngẫu nhiên. Vẫn còn ${c.donCoAChuaCoB.toLocaleString('vi-VN')} đơn mua ${c.tenA} mà chưa mua ${c.tenB}.`,
            lamGi: `Để hai món cạnh nhau, gợi ý bán kèm ngay trên máy tính tiền, hoặc gộp thành combo giảm nhẹ. Chỉ cần ${Math.round(banKem.tyLeChuyenDoiGiaDinh * 100)}% số đơn còn thiếu mua thêm là đã có phần lợi nhuận ước tính bên cạnh.`,
            danhDoi: 'Giảm giá combo sẽ ăn vào biên lãi của món đang bán tốt; đừng giảm sâu hơn phần lãi tăng thêm từ món kèm.',
            uocTinh: banKem.tongTiemNangLoiNhuan || null,
        })
    }

    if (tapTrung.duocKetLuan && tapTrung.tyLeMaTao80 < 20) {
        ra.push({
            ma: 'don-luc',
            tieuDe: `Dồn lực vào ${tapTrung.soMaTao80LaiSuat} mã đầu tàu`,
            viSao: tapTrung.nhanXet,
            lamGi: 'Ưu tiên vốn nhập, chỗ trưng bày và khuyến mãi cho nhóm đầu tàu; nhóm đuôi thì cắt bớt mã trùng công dụng để thu hồi vốn tồn kho.',
            danhDoi: 'Cắt đuôi làm giảm độ đa dạng, một số khách quen món lạ sẽ mất. Cắt dần từng nhóm nhỏ và theo dõi lượng khách, đừng cắt một lượt.',
            uocTinh: null,
        })
    }

    for (const cb of tapTrung.canhBao) {
        ra.push({ ma: 'rui-ro-tap-trung', tieuDe: 'Rủi ro phụ thuộc', viSao: cb, lamGi: 'Chuẩn bị nguồn hàng và tệp khách thay thế TRƯỚC khi cần đến.', danhDoi: 'Việc này tốn công mà không sinh lãi ngay — nó là bảo hiểm, không phải đòn bẩy.', uocTinh: null })
    }

    if (muaVu.duocKetLuan && muaVu.matHangTheoMua.length > 0) {
        const m = muaVu.matHangTheoMua[0]
        ra.push({
            ma: 'mua-vu',
            tieuDe: `Đặt hàng theo mùa cho ${m.ten}`,
            viSao: `Mặt hàng này bán mạnh nhất vào tháng ${m.thangCaoNhat} và yếu nhất tháng ${m.thangThapNhat}, chênh nhau ${m.bienDo} điểm chỉ số.`,
            lamGi: `Tăng lượng nhập trước tháng ${m.thangCaoNhat} khoảng 3–4 tuần, giảm nhập trước tháng ${m.thangThapNhat} để không ôm tồn.`,
            danhDoi: 'Nhập trước mùa cần vốn nằm chờ và chỗ chứa; đoán sai mùa là ôm hàng qua cả chu kỳ.',
            uocTinh: null,
        })
    }

    if (muaVu.duocKetLuan && muaVu.gioVang) {
        ra.push({
            ma: 'gio-vang',
            tieuDe: 'Xếp người theo khung giờ vàng',
            viSao: `${muaVu.gioVang}. ${muaVu.ngayVang}.`,
            lamGi: 'Dồn nhân sự mạnh nhất và hàng tươi/hàng mới vào các khung này; khung yếu thì giảm ca hoặc dùng để làm kho, kiểm hàng.',
            danhDoi: 'Cắt ca giờ vắng tiết kiệm lương nhưng nếu khách quen đến giờ đó thấy đóng cửa thì mất luôn khách.',
            uocTinh: null,
        })
    }

    if (siLe.duocKetLuan && siLe.nhom.length === 2) {
        ra.push({
            ma: 'si-le',
            tieuDe: 'Chọn ngả sỉ hay ngả lẻ',
            viSao: siLe.nhanXet,
            lamGi: 'Nếu chọn sỉ: đàm phán lại giá nhập theo sản lượng và siết hạn nợ khách sỉ. Nếu chọn lẻ: đầu tư vào trưng bày, bán kèm và giữ chân khách quen.',
            danhDoi: siLe.danhDoi,
            uocTinh: null,
        })
    }

    return ra
}
