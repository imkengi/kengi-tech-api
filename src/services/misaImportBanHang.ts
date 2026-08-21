/**
 * ĐỔ SỔ CHI TIẾT BÁN HÀNG MISA VÀO KENGI (2026-08-21)
 *
 * Đổ vào ba bảng RIÊNG (`MisaImportBatch` / `MisaSaleDoc` / `MisaSaleLine`), **không** đẻ ra
 * `Transaction`. Lý do viết ra đây để lần sau đừng ai "tối ưu" bằng cách tạo đơn bán:
 * POS đã ghi đơn thật rồi — đổ thêm một bộ từ MISA là **đếm trùng doanh thu**, và đếm trùng
 * không ai phát hiện được vì từng bản ghi đều trông hợp lệ. Để hai sổ riêng thì mới đối chiếu
 * được chúng với nhau, mà đối chiếu mới là thứ đang cần.
 *
 * BỐN NGUYÊN TẮC (giữ nguyên của `misaSync.ts`):
 *   1. Mặc định **chạy thử** — `apply !== true` thì không ghi một dòng nào.
 *   2. **Không ghi đè dữ liệu Kengi.** Chỉ nối (`customerId`/`productId`), không sửa
 *      Customer/Product. Khách MISA có mà Kengi chưa có thì **báo cáo**, không tự tạo.
 *   3. **Chống trùng** bằng `soChungTu` — đổ lại cùng file thì cập nhật, không nhân đôi.
 *   4. **Đọc hỏng ≠ bằng 0** — mọi dòng không đọc được đều vào `boQuaChiTiet` kèm lý do.
 *
 * ⛔ PROD chạy `PRISMA_POOL_SIZE=1`. Tuyệt đối **không** `Promise.all` trên truy vấn —
 *    xem [[prisma-pool-promiseall-trap]]. Mọi vòng lặp ở đây là tuần tự, cố ý.
 */
import { docSoBanHang, gomChungTu, type ChungTuBanHangMisa } from './misaExcel'

export interface KetQuaDoBanHang {
    apply: boolean
    tenFile: string
    kyBaoCao: string
    tuNgay: string | null
    denNgay: string | null

    tongDong: number
    docDuoc: number
    boQua: number
    boQuaChiTiet: Array<{ dong: number; lyDo: string }>
    tieuDeThieu: string[]

    soChungTu: number
    chungTuMoi: number
    chungTuCapNhat: number
    tongDoanhSo: number
    tongThue: number

    khachKhop: number
    khachChuaCo: string[]        // tên khách MISA có mà Kengi chưa có
    khachVotDienGiai: number
    khachKhongTen: number

    hangKhop: number
    hangChuaCo: string[]         // SKU MISA có mà Kengi chưa có
    /** Số mã nối được NHỜ ánh xạ MisaMap mà so SKU thuần sẽ trượt (thường là hàng đã đổi/gộp SKU). */
    hangQuaAnhXa: number

    thieuGiaVon: boolean
    canhBao: string[]
    batchId: string | null
}

/** Bỏ dấu + thường hoá, để so tên khách bất kể hoa/thường/dấu. */
function chuanTen(s: string): string {
    return String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/gi, 'd')
        .replace(/[^a-z0-9]+/gi, ' ')
        .trim().toLowerCase()
}

const ISO = (d: Date | null) => d ? d.toISOString().slice(0, 10) : null

/**
 * Trên ngưỡng này thì cảnh báo nguy cơ bị cắt ở 300 giây của Cloud Run.
 * Cỡ đo được: 20 ngày ≈ 61 chứng từ ⇒ 400 ≈ hơn một quý. Một tháng thì không bao giờ chạm.
 */
const NGUONG_CANH_BAO_CHUNG_TU = 400

/**
 * Rút gọn kết quả để ĐEM ĐI GHI NHẬT KÝ — kẹp từng danh sách rồi mới chuyển chuỗi.
 *
 * KHÔNG được `JSON.stringify(kq).slice(n)`: cắt giữa chuỗi thì bản ghi thành JSON hỏng,
 * và mọi lượt đọc về sau chỉ nhận lỗi phân tích — lỗi CÂM, vì không ai đọc nhật ký hằng ngày.
 * Đo thật: một file nhiều dòng lỗi cho 68.672 ký tự, cắt ở 20.000 là "Unterminated string".
 *
 * Bị kẹp bao nhiêu thì ghi ra bấy nhiêu (`…ConLai`) — cắt mà không khai là nói dối bằng im lặng.
 */
export function tomTatDeGhiLog(kq: KetQuaDoBanHang, gioiHan = 50) {
    const kep = <T>(a: T[]) => ({ lay: a.slice(0, gioiHan), conLai: Math.max(0, a.length - gioiHan) })
    const bq = kep(kq.boQuaChiTiet), hg = kep(kq.hangChuaCo), kh = kep(kq.khachChuaCo)
    return {
        ...kq,
        boQuaChiTiet: bq.lay, boQuaConLai: bq.conLai,
        hangChuaCo: hg.lay, hangChuaCoConLai: hg.conLai,
        khachChuaCo: kh.lay, khachChuaCoConLai: kh.conLai,
    }
}

/**
 * @param sp   Prisma client của CỬA HÀNG đang đăng nhập (không gắn cứng cửa hàng nào).
 * @param rows Mảng hai chiều đọc từ sheet.
 */
export async function doBanHangMisa(
    sp: any,
    rows: any[][],
    opts: { tenFile: string; apply: boolean; userId?: string | null; userName?: string | null },
): Promise<KetQuaDoBanHang> {
    const doc = docSoBanHang(rows)
    const ct = gomChungTu(doc.dong)
    const ngay = doc.dong.map(d => d.ngayChungTu || d.ngayHachToan).filter(Boolean) as Date[]

    const kq: KetQuaDoBanHang = {
        apply: opts.apply,
        tenFile: opts.tenFile,
        kyBaoCao: doc.kyBaoCao,
        tuNgay: ngay.length ? ISO(new Date(Math.min(...ngay.map(d => +d)))) : null,
        denNgay: ngay.length ? ISO(new Date(Math.max(...ngay.map(d => +d)))) : null,
        tongDong: doc.tongDong,
        docDuoc: doc.docDuoc,
        boQua: doc.boQua.length,
        boQuaChiTiet: doc.boQua,
        tieuDeThieu: doc.tieuDeThieu,
        soChungTu: ct.length,
        chungTuMoi: 0,
        chungTuCapNhat: 0,
        tongDoanhSo: doc.dong.reduce((s, d) => s + d.doanhSo, 0),
        tongThue: doc.dong.reduce((s, d) => s + d.thueGtgt, 0),
        khachKhop: 0,
        khachChuaCo: [],
        khachVotDienGiai: ct.filter(c => c.nguonTenKhach === 'dienGiai').length,
        khachKhongTen: ct.filter(c => c.nguonTenKhach === 'khong').length,
        hangKhop: 0,
        hangChuaCo: [],
        hangQuaAnhXa: 0,
        thieuGiaVon: doc.dong.some(d => d.giaVon === null || d.giaVon === 0),
        canhBao: [],
        batchId: null,
    }

    // Không đọc được file thì DỪNG — không phải "đọc ra 0 chứng từ".
    if (doc.tieuDeThieu.length) {
        kq.canhBao.push(
            `Không đọc được file: thiếu cột bắt buộc (${doc.tieuDeThieu.join(', ')}). `
            + `Có thể là file khác mẫu "Sổ chi tiết bán hàng", hoặc MISA đã đổi tên cột. `
            + `KHÔNG được hiểu là "file không có dữ liệu".`,
        )
        return kq
    }
    if (!ct.length) {
        kq.canhBao.push('Đọc được file nhưng không có chứng từ nào — kiểm tra lại kỳ xuất báo cáo bên MISA.')
        return kq
    }

    /* ── Nối sang dữ liệu Kengi (chỉ ĐỌC, không sửa) ─────────────────────── */

    /*
     * HÀNG HOÁ — nối hai tầng, `MisaMap` trước rồi mới tới SKU.
     *
     * Vì sao không so mỗi SKU: `MisaMap` là ánh xạ do chính cổng đồng bộ MISA ghi lại
     * (`entity='product'`, `misaCode` = mã vật tư MISA). Nó **bền với việc đổi SKU** —
     * hàng bị gộp mã hoặc đổi SKU bên Kengi thì so SKU trượt, còn ánh xạ vẫn trỏ đúng.
     * Cổng đồng bộ cũng tra theo đúng thứ tự này (`misaSync.ts`: findMap → sku).
     *
     * Mỗi tầng một truy vấn, KHÔNG N+1, và chạy tuần tự (pool prod = 1).
     */
    const maHang = [...new Set(doc.dong.map(d => d.maHang).filter(Boolean))]
    const anhXaHang: Array<{ misaCode: string | null; localId: string }> = maHang.length
        ? await sp.misaMap.findMany({
            where: { entity: 'product', misaCode: { in: maHang } },
            select: { misaCode: true, localId: true },
        })
        : []
    // Lấy sản phẩm theo CẢ HAI đường trong một truy vấn — vừa để tra theo SKU, vừa để
    // xác nhận `localId` trong ánh xạ còn trỏ tới hàng có thật (ánh xạ có thể trỏ hàng đã xoá).
    const idTuAnhXa = [...new Set(anhXaHang.map(m => m.localId))]
    const sanPham: Array<{ id: string; sku: string }> = (maHang.length || idTuAnhXa.length)
        ? await sp.product.findMany({
            where: { OR: [{ sku: { in: maHang } }, { id: { in: idTuAnhXa } }] },
            select: { id: true, sku: true },
        })
        : []
    const idCoThat = new Set(sanPham.map(p => p.id))
    const theoSku = new Map(sanPham.map(p => [p.sku, p.id]))

    const theoMa = new Map<string, string>()
    for (const m of anhXaHang) {
        if (m.misaCode && idCoThat.has(m.localId)) theoMa.set(m.misaCode, m.localId)
    }
    const timHang = (ma: string): string | null => theoMa.get(ma) || theoSku.get(ma) || null

    kq.hangKhop = maHang.filter(m => timHang(m)).length
    kq.hangChuaCo = maHang.filter(m => !timHang(m))
    kq.hangQuaAnhXa = maHang.filter(m => theoMa.has(m) && !theoSku.has(m)).length

    /*
     * KHÁCH — ba tầng, chắc chắn giảm dần: ánh xạ MISA → mã khách → tên.
     * Tầng tên là kém chắc nhất (trùng tên là có thật) nên để cuối, và chỉ dùng khi hai
     * tầng trên trượt. Không có tầng nào tự tạo khách mới.
     */
    const maKhach = [...new Set(ct.map(c => c.maKhach).filter(Boolean))]
    const tenKhach = [...new Set(ct.map(c => c.tenKhach).filter(Boolean))]

    const anhXaKhach: Array<{ misaCode: string | null; localId: string }> = maKhach.length
        ? await sp.misaMap.findMany({
            where: { entity: 'customer', misaCode: { in: maKhach } },
            select: { misaCode: true, localId: true },
        })
        : []
    const idKhachAnhXa = [...new Set(anhXaKhach.map(m => m.localId))]

    const khach: Array<{ id: string; code: string; name: string }> =
        (maKhach.length || tenKhach.length || idKhachAnhXa.length)
            ? await sp.customer.findMany({
                where: {
                    OR: [
                        { code: { in: maKhach } },
                        { name: { in: tenKhach } },
                        { id: { in: idKhachAnhXa } },
                    ],
                },
                select: { id: true, code: true, name: true },
            })
            : []
    const khachCoThat = new Set(khach.map(k => k.id))
    const bangMa = new Map(khach.map(k => [k.code, k.id]))
    const bangTen = new Map(khach.map(k => [chuanTen(k.name), k.id]))
    const bangAnhXa = new Map<string, string>()
    for (const m of anhXaKhach) {
        if (m.misaCode && khachCoThat.has(m.localId)) bangAnhXa.set(m.misaCode, m.localId)
    }

    const timKhach = (c: ChungTuBanHangMisa): string | null =>
        (c.maKhach && (bangAnhXa.get(c.maKhach) || bangMa.get(c.maKhach)))
        || (c.tenKhach && bangTen.get(chuanTen(c.tenKhach)))
        || null

    const chuaCo = new Set<string>()
    for (const c of ct) {
        if (timKhach(c)) kq.khachKhop++
        else if (c.tenKhach) chuaCo.add(c.tenKhach)
    }
    kq.khachChuaCo = [...chuaCo]

    /* ── Cảnh báo: nói thẳng, đừng để người đọc tự suy ra ────────────────── */

    if (kq.thieuGiaVon) {
        kq.canhBao.push(
            'MISA không xuất giá vốn (cột "Giá vốn" trống hoặc bằng 0). '
            + 'Dữ liệu này CHỈ dùng để đối chiếu doanh thu/thuế, KHÔNG tính được lãi/lỗ. '
            + 'Nếu coi giá vốn = 0 thì mọi báo cáo sẽ cho lãi đúng bằng doanh thu.',
        )
    }
    if (kq.hangChuaCo.length) {
        kq.canhBao.push(
            `${kq.hangChuaCo.length}/${maHang.length} mã hàng chưa có trong Kengi — dòng vẫn được lưu `
            + `nhưng không nối được sang hàng hoá. Đồng bộ "Vật tư, hàng hoá" trước sẽ nối được nhiều hơn.`,
        )
    }
    if (kq.khachChuaCo.length) {
        kq.canhBao.push(
            `${kq.khachChuaCo.length} khách chưa có trong Kengi — chứng từ vẫn lưu, chỉ chưa nối được. `
            + `KHÔNG tự tạo khách mới (tránh đẻ khách trùng).`,
        )
    }
    if (kq.khachVotDienGiai) {
        kq.canhBao.push(
            `${kq.khachVotDienGiai} chứng từ bỏ trống cột "Tên khách hàng", tên phải vớt từ "Diễn giải chung". `
            + `Đó là khách MISA chưa khai thành đối tượng — nên soát lại trước khi tin.`,
        )
    }
    if (kq.boQua) {
        kq.canhBao.push(`${kq.boQua} dòng không đọc được, đã liệt kê kèm lý do (thường là dòng tổng cộng).`)
    }
    /*
     * Cloud Run cắt yêu cầu ở 300 giây. Mỗi chứng từ tốn 2 truy vấn TUẦN TỰ (pool prod = 1),
     * nên file quá dài sẽ bị cắt giữa chừng: một phần đã ghi, người bấm thấy báo lỗi.
     * Không nguy hiểm về dữ liệu (chống trùng theo `soChungTu` nên chạy lại là bù đủ) nhưng
     * PHẢI nói trước, kẻo họ tưởng hỏng rồi đổ lại từ đầu bằng file khác.
     * Ngưỡng đặt thấp có chủ ý: thà cảnh báo thừa còn hơn để họ ngồi chờ rồi ăn lỗi.
     */
    if (ct.length > NGUONG_CANH_BAO_CHUNG_TU) {
        kq.canhBao.push(
            `File có ${ct.length} chứng từ — khá dài. Máy chủ cắt yêu cầu ở 300 giây, lượt ghi có thể `
            + `bị cắt giữa chừng và báo lỗi dù đã ghi được một phần. Chống trùng theo số chứng từ nên `
            + `CHẠY LẠI ĐÚNG FILE ĐÓ là bù đủ, không nhân đôi. Muốn chắc thì xuất Excel theo từng tháng.`,
        )
    }

    if (!opts.apply) return kq   // ── chạy thử: dừng ở đây, chưa ghi gì ──

    /* ── Ghi thật ────────────────────────────────────────────────────────── */

    const batch = await sp.misaImportBatch.create({
        data: {
            loai: 'sales',
            tenFile: opts.tenFile,
            kyBaoCao: kq.kyBaoCao || null,
            tongDong: kq.tongDong,
            docDuoc: kq.docDuoc,
            boQua: kq.boQua,
            soChungTu: kq.soChungTu,
            tongTien: kq.tongDoanhSo,
            tongThue: kq.tongThue,
            // Kẹp danh sách TRƯỚC khi chuyển chuỗi — xem `tomTatDeGhiLog`.
            chiTiet: JSON.stringify({
                boQua: kq.boQuaChiTiet.slice(0, 200),
                boQuaConLai: Math.max(0, kq.boQuaChiTiet.length - 200),
                canhBao: kq.canhBao,
            }),
            apply: true,
            userId: opts.userId || null,
            userName: opts.userName || null,
        },
        select: { id: true },
    })
    kq.batchId = batch.id

    // TUẦN TỰ — pool prod = 1. Mỗi chứng từ một giao dịch: hỏng một cái không kéo đổ cả lượt.
    for (const c of ct) {
        const customerId = timKhach(c)
        const duLieu = {
            soHoaDon: c.soHoaDon || null,
            ngayChungTu: c.ngay,
            ngayHachToan: c.dong[0]?.ngayHachToan ?? null,
            ngayHoaDon: c.dong[0]?.ngayHoaDon ?? null,
            maKhach: c.maKhach || null,
            tenKhach: c.tenKhach || null,
            nguonTenKhach: c.nguonTenKhach,
            dienGiai: c.dienGiai || null,
            customerId,
            tongDoanhSo: c.tongDoanhSo,
            tongThue: c.tongThue,
            tongChietKhau: c.tongChietKhau,
            tongTra: c.tongTra,
            thieuGiaVon: c.thieuGiaVon,
            batchId: batch.id,
        }
        const dongHang = c.dong.map(d => ({
            maHang: d.maHang,
            tenHang: d.tenHang || null,
            dvt: d.dvt || null,
            soLuong: d.soLuong,
            donGia: d.donGia,
            doanhSo: d.doanhSo,
            chietKhau: d.chietKhau,
            soLuongTra: d.soLuongTra,
            giaTriTra: d.giaTriTra,
            giamGia: d.giamGia,
            thueGtgt: d.thueGtgt,
            tkThueGtgt: d.tkThueGtgt || null,
            // 0 ⇒ ghi null. MISA điền đúng chữ "0" vào ô giá vốn khi không xuất, mà 0 lưu xuống
            // thì mọi phép SUM() sau này trả về một con số trông hợp lệ ⇒ lãi bằng đúng doanh thu.
            // Lưu null thì SUM() trả null, tức là BUỘC người đọc thấy chỗ thiếu thay vì lướt qua.
            giaVon: d.giaVon === 0 ? null : d.giaVon,
            productId: timHang(d.maHang),
            dongSo: d.dongSo,
        }))

        const cu = await sp.misaSaleDoc.findUnique({ where: { soChungTu: c.soChungTu }, select: { id: true } })
        if (cu) {
            // Đổ lại cùng chứng từ: thay dòng hàng, không nhân đôi.
            await sp.$transaction([
                sp.misaSaleLine.deleteMany({ where: { docId: cu.id } }),
                sp.misaSaleDoc.update({ where: { id: cu.id }, data: { ...duLieu, lines: { create: dongHang } } }),
            ])
            kq.chungTuCapNhat++
        } else {
            await sp.misaSaleDoc.create({ data: { soChungTu: c.soChungTu, ...duLieu, lines: { create: dongHang } } })
            kq.chungTuMoi++
        }
    }

    return kq
}
