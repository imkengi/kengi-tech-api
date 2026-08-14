/**
 * LỊCH TIỀN 90 NGÀY TỚI — cửa hàng chết vì hết tiền, không phải vì hết lãi.
 *
 * Một cửa hàng có thể lãi đều tháng nào cũng có mà vẫn sập: hàng nhập trả tiền
 * ngay, khách mua ghi nợ, thuế đến hạn đúng tuần nhà cung cấp đòi. Báo cáo lãi
 * lỗ không nhìn thấy chuyện đó vì nó nói về KỲ, còn tiền thì nói về NGÀY.
 *
 * Cỗ máy này xếp mọi khoản đã biết lên một trục thời gian rồi cộng dồn số dư,
 * để trả lời đúng một câu: NGÀY NÀO TIỀN CHẠM ĐÁY, và lúc đó thiếu bao nhiêu.
 *
 * PHÂN BIỆT HAI LOẠI SỐ, không được trộn:
 *   CHẮC CHẮN  — có chứng từ và có ngày: nợ nhà cung cấp đến hạn, mốc thuế.
 *   ƯỚC TÍNH   — suy từ quá khứ: tiền bán hàng hằng ngày, chi phí vận hành.
 * Trộn hai loại rồi hiện một con số duy nhất là biến dự báo thành lời hứa.
 * Ở đây mỗi dòng đều mang cờ `chacChan`, và bản tóm tắt nói rõ phần nào là đoán.
 *
 * BA THỨ CỐ Ý KHÔNG ĐOÁN:
 *  - Công nợ khách: sổ không lưu hạn thu từng khoản, nên KHÔNG rải bừa lên lịch.
 *    Tổng nợ được để riêng như một khoản "có thể thu nếu đòi", không cộng vào
 *    số dư chiếu — cộng vào là tự trấn an bằng tiền chưa chắc về.
 *  - Mốc thuế chưa có tờ khai: biết NGÀY nhưng không biết SỐ. Hiện ngày kèm
 *    "chưa biết số tiền" thay vì đoán một con số.
 *  - Cửa hàng chưa nhập số dư tài khoản: không lấy 0 làm điểm xuất phát, vì như
 *    thế mọi cửa hàng đều trông như sắp vỡ nợ. Trả cờ `coSoDuDau: false`.
 */

import { TRANG_THAI_MOC_DA_XONG } from './taxCalendar'

export interface DongTienMuc {
    ngay: string
    loai: 'thu' | 'chi'
    nhom: 'ban-hang' | 'no-khach' | 'no-ncc' | 'chi-phi' | 'thue' | 'khac'
    moTa: string
    soTien: number
    /** true = có chứng từ và có ngày. false = suy từ quá khứ. */
    chacChan: boolean
}

export interface NgayTien {
    ngay: string
    thu: number
    chi: number
    /** Số dư cuối ngày, cộng dồn từ số dư đầu. */
    soDu: number
    muc: DongTienMuc[]
}

export interface KetQuaDuBaoTien {
    moc: { tuNgay: string; denNgay: string; soNgay: number }
    soDuDau: {
        coSoDuDau: boolean
        lyDo?: string
        tienNganHang: number
        soTaiKhoan: number
    }
    /** Ước tính từ quá khứ, kèm cách tính để người dùng phản bác được. */
    uocTinh: {
        thuMoiNgay: number
        chiVanHanhMoiNgay: number
        /** Số ngày THỰC SỰ có phát sinh thu tiền trong cửa sổ đo. */
        soNgayDoDuoc: number
        /** Mẫu số của phép trung bình — bằng 60, hoặc tuổi cửa hàng nếu nhỏ hơn. */
        soNgayLayTrungBinh: number
        cachTinh: string
    }
    ngay: NgayTien[]
    diemChamDay: { ngay: string; soDu: number } | null
    ngayCanTien: string | null
    tomTat: {
        tongThuUocTinh: number
        tongChiChacChan: number
        tongChiUocTinh: number
        soDuCuoiKy: number
        noNccDenHan: number
        thueDenHan: number
        thueChuaRoSoTien: number
        noKhachChuaCoHan: number
    }
    canhBao: string[]
    ghiChu: string[]
    thieu: string[]
    /** Thiếu sót LÀM SAI kết luận về tiền. Thiếu công nợ khách chỉ mất một ô
     *  hiển thị; thiếu nợ nhà cung cấp thì lịch tiền trông nhẹ hơn thực tế và
     *  cảnh báo trở nên nguy hiểm. */
    thieuChinh: string[]
}

/** Nhiều lỗi Prisma/pg có message RỖNG — in mỗi message là ra chuỗi cụt. */
function moTaLoi(e: any): string {
    const m = String(e?.message || '').trim()
    if (m) return m.slice(0, 160)
    const phu = [e?.name, e?.code, e?.meta && JSON.stringify(e.meta)].filter(Boolean).join(' ')
    return (phu || String(e) || 'lỗi không rõ').slice(0, 160)
}

const VN_OFFSET_MS = 7 * 3600 * 1000
const lam = (n: any) => Math.round(Number(n) || 0)
const so = (n: any) => (Number.isFinite(Number(n)) ? Number(n) : 0)
const ngayVN = (d: any) => new Date(new Date(d).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10)

export async function duBaoDongTien(
    prisma: any,
    tuyChon?: { soNgay?: number; tienMatDauKy?: number },
): Promise<KetQuaDuBaoTien> {
    const thieu: string[] = []
    const thieuChinh: string[] = []
    const ghiChu: string[] = []
    const canhBao: string[] = []

    const soNgay = Math.max(14, Math.min(180, tuyChon?.soNgay ?? 90))
    const homNay = ngayVN(Date.now())
    const denNgay = ngayVN(Date.now() + soNgay * 86400_000)

    /* Truy vấn TUẦN TỰ — pool mỗi cửa hàng rất nhỏ. */

    // ── Số dư đầu: tiền trong tài khoản ngân hàng ────────────────────────
    let taiKhoan: any[] = []
    try {
        taiKhoan = await prisma.bankAccount.findMany({
            where: { status: 'active' },
            select: { id: true, bankName: true, balance: true },
        })
    } catch (e: any) {
        thieuChinh.push(`Không đọc được tài khoản ngân hàng: ${moTaLoi(e)}`)
    }
    const tienNganHang = taiKhoan.reduce((s: number, t: any) => s + so(t.balance), 0)
    const tienMatDauKy = so(tuyChon?.tienMatDauKy)
    /* Số dư ngân hàng bằng 0 ở MỌI tài khoản gần như luôn nghĩa là chưa ai nhập,
     * chứ không phải cửa hàng thật sự hết sạch tiền. Lấy 0 làm điểm xuất phát sẽ
     * khiến mọi cửa hàng trông như sắp vỡ nợ và cảnh báo mất hết giá trị. */
    const coSoDuDau = taiKhoan.length > 0 && (tienNganHang > 0 || tienMatDauKy > 0)
    const soDuBanDau = tienNganHang + tienMatDauKy

    // ── Ước tính tiền bán vào mỗi ngày ───────────────────────────────────
    const NGAY_DO = 60
    let thuMoiNgay = 0
    let chiVanHanhMoiNgay = 0
    let soNgayDoDuoc = 0
    /* Mẫu số của phép trung bình. Mặc định là 60, NHƯNG cửa hàng mới mở chưa
     * sống đủ 60 ngày thì chia cho 60 là dìm tốc độ thu xuống — cửa hàng mới 20
     * ngày tuổi bị chia như thể có 60 ngày sẽ ra tốc độ chỉ bằng 1/3 thực tế,
     * và lịch tiền báo "sắp cạn tiền" cho một cửa hàng đang khỏe. Báo động giả
     * kiểu này còn nguy hơn im lặng: chủ cửa hàng dừng nhập hàng, hoặc đi vay
     * khoản không cần vay. */
    let mauSoNgay = NGAY_DO
    let ngayCoMatDauTien: Date | null = null
    try {
        const tuDo = new Date(Date.now() - NGAY_DO * 86400_000)
        const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT COALESCE(SUM(p.amount), 0)::float8 AS tien,
                    COUNT(DISTINCT (t."createdAt" + interval '7 hours')::date)::int AS "soNgay",
                    /* Cố ý KHÔNG join sang Payment ở đây: chỉ cần một cận dưới
                     * cho tuổi cửa hàng, mà MIN trên cột có @@index([createdAt])
                     * đọc thẳng chỉ mục, còn join cả bảng Payment thì quét nặng
                     * trên cửa hàng nhiều dữ liệu. Đơn hàng đầu tiên luôn có
                     * trước hoặc cùng lúc với lần thu tiền đầu tiên, nên mẫu số
                     * ra lớn hơn hoặc bằng — lệch về phía thận trọng. */
                    (SELECT MIN(t2."createdAt") FROM "Transaction" t2) AS "lanThuDauTien"
             FROM "Payment" p
             JOIN "Transaction" t ON t.id = p."transactionId"
             WHERE t.status IN ('completed', 'partial') AND t."createdAt" >= $1`,
            tuDo,
        )
        /* Dùng PHIẾU THU chứ không dùng tổng đơn: đơn ghi nợ chưa mang tiền về,
         * cộng nó vào dòng tiền là vẽ ra tiền chưa tồn tại. */
        soNgayDoDuoc = Number(rows?.[0]?.soNgay) || 0

        /* Lần thu ĐẦU TIÊN của cả cửa hàng (không giới hạn cửa sổ). Nằm trong
         * 60 ngày qua nghĩa là cửa hàng chưa từng thu tiền trước đó, tức là
         * lịch sử ngắn hơn cửa sổ đo. Khác hẳn chuyện "có 60 ngày lịch sử
         * nhưng chỉ bán 32 ngày" — trường hợp đó chia cho 60 mới đúng, vì
         * ngày nghỉ vẫn là ngày trong lịch dự báo. */
        const ld = rows?.[0]?.lanThuDauTien
        ngayCoMatDauTien = ld ? new Date(ld) : null
        if (ngayCoMatDauTien && ngayCoMatDauTien.getTime() > tuDo.getTime()) {
            const songDuoc = Math.ceil((Date.now() - ngayCoMatDauTien.getTime()) / 86400_000)
            /* Mẫu số không được nhỏ hơn SỐ NGÀY THỰC SỰ CÓ BÁN: không thể bán
             * 32 ngày khác nhau trong một cửa hàng mới sống 31 ngày. Hai con số
             * đo hai thứ khác nhau (số ngày trôi qua so với số ngày trong lịch
             * có phát sinh) nên lệch nhau một ngày ở ranh giới múi giờ +7 là
             * chuyện thường — nhưng để mẫu số nhỏ hơn thì tốc độ thu bị thổi
             * lên, và lịch tiền lạc quan quá đà còn nguy hơn bi quan. */
            mauSoNgay = Math.min(NGAY_DO, Math.max(1, songDuoc, soNgayDoDuoc))
        }
        thuMoiNgay = soNgayDoDuoc > 0 ? so(rows[0].tien) / mauSoNgay : 0
    } catch (e: any) {
        thieuChinh.push(`Không đọc được tiền bán hàng đã thu: ${moTaLoi(e)}`)
    }

    try {
        const tuDo = new Date(Date.now() - NGAY_DO * 86400_000)
        const chi = await prisma.expense.aggregate({
            where: { status: 'active', date: { gte: tuDo } },
            _sum: { amount: true },
        })
        // Cùng mẫu số với vế thu: cửa hàng mới thì vế chi cũng chỉ có bấy nhiêu ngày.
        chiVanHanhMoiNgay = so(chi?._sum?.amount) / mauSoNgay
    } catch (e: any) {
        thieuChinh.push(`Không đọc được chi phí vận hành: ${moTaLoi(e)}`)
    }

    // ── Nợ nhà cung cấp đến hạn (CHẮC CHẮN, có ngày) ─────────────────────
    const muc: DongTienMuc[] = []
    let noNccDenHan = 0
    try {
        const phieu = await prisma.importReceipt.findMany({
            where: {
                paymentStatus: { in: ['unpaid', 'partial'] },
                dueDate: { not: null, lte: new Date(Date.now() + soNgay * 86400_000) },
            },
            select: { code: true, supplierName: true, totalCost: true, paidAmount: true, dueDate: true },
        })
        for (const p of phieu) {
            const conNo = so(p.totalCost) - so(p.paidAmount)
            if (conNo <= 0) continue
            /* Khoản đã quá hạn dồn vào NGÀY MAI chứ không để ở ngày cũ: nó vẫn
             * đang phải trả, và bỏ nó ra ngoài cửa sổ là giấu mất áp lực tiền
             * sát nhất. */
            const han = ngayVN(p.dueDate)
            const ngayXep = han < homNay ? ngayVN(Date.now() + 86400_000) : han
            muc.push({
                ngay: ngayXep,
                loai: 'chi', nhom: 'no-ncc',
                moTa: `Trả ${p.supplierName || 'nhà cung cấp'} — phiếu ${p.code}${han < homNay ? ` (đã quá hạn ${han})` : ''}`,
                soTien: lam(conNo),
                chacChan: true,
            })
            noNccDenHan += conNo
        }
    } catch (e: any) {
        thieuChinh.push(`Không đọc được công nợ nhà cung cấp: ${moTaLoi(e)}`)
    }

    // ── Nghĩa vụ thuế sắp tới ────────────────────────────────────────────
    let thueDenHan = 0
    let thueChuaRoSoTien = 0
    try {
        const moc = await prisma.taxDeadline.findMany({
            /* Ở lịch tiền thì hướng an toàn NGƯỢC với bên soát thuế: bỏ sót một
             * mốc còn phải nộp là thiếu tiền lúc đến hạn, nên loại đúng nhóm đã
             * xong và giữ lại mọi trạng thái lạ. Bản trước loại theo 'filed' —
             * giá trị không chỗ nào ghi cho bảng này — nên mốc đã đánh dấu nộp
             * ('submitted') vẫn nằm trong dự trù, lịch tiền nặng hơn thực tế. */
            where: { dueDate: { gte: homNay, lte: denNgay }, status: { notIn: [...TRANG_THAI_MOC_DA_XONG] } },
            select: { taxType: true, period: true, dueDate: true, description: true },
        })
        /* Số tiền lấy từ tờ khai CÙNG KỲ nếu đã lập. Chưa lập thì biết NGÀY mà
         * không biết SỐ — hiện mốc kèm "chưa biết số tiền", không đoán. */
        /* Số thuế phải nộp nằm ở [38]; [40a] là đề nghị hoàn nên hệ thống để 0.
         * Đọc nhầm cột là mọi mốc thuế đều thành "chưa biết số tiền" và lịch tiền
         * trông nhẹ hơn thực tế. Cùng quy ước với module khai bổ sung. */
        const toKhai = await prisma.taxDeclaration.findMany({
            select: { period: true, ct38: true, ct40a: true },
        }).catch(() => [] as any[])
        const tienTheoKy = new Map<string, number>()
        for (const t of toKhai) {
            const v = so(t.ct38) !== 0 ? so(t.ct38) : so(t.ct40a)
            if (v > 0) tienTheoKy.set(String(t.period), v)
        }
        const maKy = (p: string) => {
            const t = String(p || '').match(/T?(\d{1,2})\/(\d{4})/)
            if (t) return `${t[2]}-${String(Number(t[1])).padStart(2, '0')}`
            const q = String(p || '').match(/Q(\d)\/(\d{4})/)
            if (q) return `${q[2]}-Q${q[1]}`
            return String(p || '')
        }
        for (const m of moc) {
            const tien = tienTheoKy.get(maKy(m.period)) ?? 0
            if (tien > 0) {
                muc.push({
                    ngay: String(m.dueDate), loai: 'chi', nhom: 'thue',
                    moTa: `${m.description || m.taxType} ${m.period}`,
                    soTien: lam(tien), chacChan: true,
                })
                thueDenHan += tien
            } else {
                muc.push({
                    ngay: String(m.dueDate), loai: 'chi', nhom: 'thue',
                    moTa: `${m.description || m.taxType} ${m.period} — chưa biết số tiền (chưa lập tờ khai)`,
                    soTien: 0, chacChan: true,
                })
                thueChuaRoSoTien++
            }
        }
    } catch (e: any) {
        thieuChinh.push(`Không đọc được lịch nghĩa vụ thuế: ${moTaLoi(e)}`)
    }

    // ── Công nợ khách: KHÔNG rải lên lịch ────────────────────────────────
    let noKhachChuaCoHan = 0
    try {
        const kh = await prisma.customer.aggregate({ where: { debt: { gt: 0 } }, _sum: { debt: true } })
        noKhachChuaCoHan = so(kh?._sum?.debt)
    } catch (e: any) {
        thieu.push(`Không đọc được công nợ khách: ${moTaLoi(e)}`)
    }
    if (noKhachChuaCoHan > 0) {
        ghiChu.push(`Khách đang nợ ${lam(noKhachChuaCoHan).toLocaleString('vi-VN')}đ nhưng sổ không lưu hạn thu từng khoản, nên KHÔNG được rải lên lịch này. Đây là khoản có thể thu nếu đi đòi — đừng cộng sẵn vào số dư rồi yên tâm.`)
    }

    // ── Dựng lịch ngày ───────────────────────────────────────────────────
    const theoNgay = new Map<string, DongTienMuc[]>()
    for (const m of muc) {
        if (m.ngay < homNay || m.ngay > denNgay) continue
        if (!theoNgay.has(m.ngay)) theoNgay.set(m.ngay, [])
        theoNgay.get(m.ngay)!.push(m)
    }

    const ngay: NgayTien[] = []
    let soDu = soDuBanDau
    let tongThuUoc = 0, tongChiChac = 0, tongChiUoc = 0
    for (let i = 0; i < soNgay; i++) {
        const d = ngayVN(Date.now() + i * 86400_000)
        const ds = [...(theoNgay.get(d) || [])]

        if (thuMoiNgay > 0) {
            ds.push({ ngay: d, loai: 'thu', nhom: 'ban-hang', moTa: 'Tiền bán hàng (ước tính theo 60 ngày qua)', soTien: lam(thuMoiNgay), chacChan: false })
            tongThuUoc += thuMoiNgay
        }
        if (chiVanHanhMoiNgay > 0) {
            ds.push({ ngay: d, loai: 'chi', nhom: 'chi-phi', moTa: 'Chi phí vận hành (ước tính theo 60 ngày qua)', soTien: lam(chiVanHanhMoiNgay), chacChan: false })
            tongChiUoc += chiVanHanhMoiNgay
        }

        const thu = ds.filter(x => x.loai === 'thu').reduce((s, x) => s + x.soTien, 0)
        const chi = ds.filter(x => x.loai === 'chi').reduce((s, x) => s + x.soTien, 0)
        tongChiChac += ds.filter(x => x.loai === 'chi' && x.chacChan).reduce((s, x) => s + x.soTien, 0)
        soDu += thu - chi
        ngay.push({ ngay: d, thu: lam(thu), chi: lam(chi), soDu: lam(soDu), muc: ds })
    }

    // ── Điểm chạm đáy ────────────────────────────────────────────────────
    let diemChamDay: { ngay: string; soDu: number } | null = null
    for (const n of ngay) {
        if (!diemChamDay || n.soDu < diemChamDay.soDu) diemChamDay = { ngay: n.ngay, soDu: n.soDu }
    }
    const ngayCanTien = ngay.find(n => n.soDu < 0)?.ngay ?? null

    /* CHI PHÍ GHI SỔ QUÁ MỎNG SO VỚI TIỀN THU → đường số dư đang lạc quan giả.
     *
     * Đo trên dữ liệu thật 14/08/2026: một cửa hàng thu ước 95,6 triệu/ngày mà
     * chi phí vận hành ghi sổ chỉ 400 nghìn/ngày — 0,4%. Không cửa hàng nào vận
     * hành với chi phí bằng 0,4% doanh thu; nghĩa là tiền thuê, lương, điện nước
     * chưa được ghi. Lịch tiền khi đó vẽ ra một đường đi lên rất đẹp và sai.
     *
     * Ngưỡng 5% đặt rất rộng để không làm phiền cửa hàng có biên lãi mỏng thật;
     * dưới mức đó gần như chắc chắn là CHƯA GHI ĐỦ chứ không phải chi ít. */
    if (thuMoiNgay > 0 && chiVanHanhMoiNgay >= 0 && chiVanHanhMoiNgay < thuMoiNgay * 0.05) {
        const tyLe = Math.round((chiVanHanhMoiNgay / thuMoiNgay) * 1000) / 10
        canhBao.push(`Chi phí vận hành đã ghi sổ chỉ bằng ${tyLe}% tiền thu (${lam(chiVanHanhMoiNgay).toLocaleString('vi-VN')}đ so với ${lam(thuMoiNgay).toLocaleString('vi-VN')}đ mỗi ngày). Nhiều khả năng tiền thuê, lương, điện nước chưa được ghi vào sổ chi phí — nếu vậy thì số dư thật sẽ THẤP HƠN đường vẽ ở đây khá nhiều.`)
    }

    if (!coSoDuDau) {
        canhBao.push('Chưa có số dư tài khoản để làm điểm xuất phát, nên đường số dư dưới đây chỉ cho thấy TIỀN VÀO RA CHÊNH NHAU bao nhiêu, không phải số dư thật. Nhập số dư ngân hàng ở mục Tài khoản để lịch này dùng được.')
    } else if (ngayCanTien) {
        canhBao.push(`Theo lịch này, tiền chạm âm vào ngày ${ngayCanTien}. Cần thu nợ khách, giãn hạn nhà cung cấp, hoặc chuẩn bị nguồn trước ngày đó.`)
    } else if (diemChamDay && diemChamDay.soDu < soDuBanDau * 0.2 && soDuBanDau > 0) {
        canhBao.push(`Tiền không âm nhưng chạm đáy ${lam(diemChamDay.soDu).toLocaleString('vi-VN')}đ vào ${diemChamDay.ngay} — mỏng hơn nhiều so với hiện tại, đừng nhập hàng lớn quanh ngày đó.`)
    }

    if (thueChuaRoSoTien > 0) {
        ghiChu.push(`${thueChuaRoSoTien} mốc thuế trong kỳ chưa lập tờ khai nên chưa biết số tiền — chúng đang được tính bằng 0 trên lịch, tức là số dư thật sẽ THẤP HƠN đường vẽ ở đây.`)
    }
    if (soNgayDoDuoc < 20) {
        ghiChu.push(`Chỉ có ${soNgayDoDuoc} ngày phát sinh thu tiền trong 60 ngày qua — mức thu ước tính mỗi ngày còn yếu, đừng dựa vào nó để quyết định lớn.`)
    }
    ghiChu.push('Tiền bán hàng ước tính lấy từ PHIẾU THU thực tế, không lấy tổng đơn — đơn ghi nợ chưa mang tiền về nên không được tính vào dòng tiền.')

    return {
        moc: { tuNgay: homNay, denNgay, soNgay },
        soDuDau: {
            coSoDuDau,
            lyDo: coSoDuDau ? undefined : 'Chưa có tài khoản ngân hàng nào có số dư, và cũng chưa nhập tiền mặt đầu kỳ.',
            tienNganHang: lam(tienNganHang),
            soTaiKhoan: taiKhoan.length,
        },
        uocTinh: {
            thuMoiNgay: lam(thuMoiNgay),
            chiVanHanhMoiNgay: lam(chiVanHanhMoiNgay),
            soNgayDoDuoc,
            soNgayLayTrungBinh: mauSoNgay,
            cachTinh: mauSoNgay < NGAY_DO
                /* KHÔNG viết "thu tiền lần đầu cách đây N ngày": mẫu số còn được
                 * nâng lên bằng số ngày có bán, nên N có thể lệch một ngày so
                 * với mốc thật. Câu chữ chỉ được nói đúng cái phép tính đã làm. */
                ? `Cửa hàng mới có khoảng ${mauSoNgay} ngày dữ liệu nên lấy trung bình theo ${mauSoNgay} ngày đó, không chia cho ${NGAY_DO} — chia cho ${NGAY_DO} sẽ dìm tốc độ thu xuống và vẽ ra cảnh sắp cạn tiền không có thật.`
                : `Trung bình ${NGAY_DO} ngày gần nhất: tổng tiền đã thu chia cho ${NGAY_DO}, tổng chi phí đã ghi sổ chia cho ${NGAY_DO}. Ngày không bán vẫn tính là một ngày, vì lịch dự báo cũng chạy theo ngày trong lịch.`,
        },
        ngay,
        diemChamDay,
        ngayCanTien,
        tomTat: {
            tongThuUocTinh: lam(tongThuUoc),
            tongChiChacChan: lam(tongChiChac),
            tongChiUocTinh: lam(tongChiUoc),
            soDuCuoiKy: lam(soDu),
            noNccDenHan: lam(noNccDenHan),
            thueDenHan: lam(thueDenHan),
            thueChuaRoSoTien,
            noKhachChuaCoHan: lam(noKhachChuaCoHan),
        },
        canhBao, ghiChu, thieu, thieuChinh,
    }
}
