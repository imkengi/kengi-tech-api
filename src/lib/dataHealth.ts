/**
 * SỨC KHOẺ DỮ LIỆU — đọc báo cáo nào cũng nên liếc qua đây trước.
 *
 * Cả ngày 14/08/2026 soát năm cỗ máy phân tích trên dữ liệu thật, và mọi lỗi
 * nặng đều cùng một hình dạng: KHÔNG PHẢI phép tính sai, mà là dữ liệu nền
 * không như phần mềm tưởng.
 *
 *   - Hệ thống chỉ có 31 ngày dữ liệu trong cửa sổ 365 ngày → mọi con số "cả
 *     năm" đều là mức sàn, nhưng module thuế vẫn ghi "kỳ đủ dài".
 *   - 262 mã tồn âm → bảng đặt hàng đề xuất mua thừa hơn 1 tỷ.
 *   - Chi phí ghi sổ bằng 0,4% doanh thu → lịch tiền vẽ một đường đi lên rất đẹp.
 *   - 66 hoá đơn ở trạng thái hỏng thật ra đã phát hành xong → tỷ lệ phủ hoá đơn
 *     bị báo thấp hơn thực tế.
 *
 * Từng module đã tự cảnh báo phần của mình, nhưng người dùng phải mở đủ năm chỗ
 * mới thấy hết. Gom về một nơi để trả lời đúng một câu: DỮ LIỆU CỦA TÔI CÓ ĐỦ
 * TIN ĐỂ ĐỌC BÁO CÁO KHÔNG, và nếu chưa thì phải sửa gì trước.
 *
 * NGUYÊN TẮC: mỗi mục nói VÌ SAO nó làm sai báo cáo nào, chứ không chỉ báo "có
 * vấn đề". Người dùng không sửa một cảnh báo mà họ không hiểu hậu quả.
 */

export type MucDo = 'nang' | 'vua' | 'on'

export interface MucSucKhoe {
    ma: string
    ten: string
    muc: MucDo
    /** Con số cụ thể, để trống khi không đọc được. */
    so: string | null
    /** Ảnh hưởng tới báo cáo nào, nói bằng lời. */
    anhHuong: string
    canLam: string
    /** Vài bản ghi cụ thể để người dùng bắt đầu từ đâu. Một con số tổng không
     *  nói được phải mở cái gì ra trước. */
    viDu?: Array<{ id?: string; nhan: string; phu?: string }>
}

export interface KetQuaSucKhoe {
    ky: { from: string; to: string }
    diem: number
    xepLoai: 'tốt' | 'cần dọn' | 'chưa tin được'
    muc: MucSucKhoe[]
    thieu: string[]
}

const lam = (n: any) => Math.round(Number(n) || 0)
const tien = (n: number) => lam(n).toLocaleString('vi-VN') + 'đ'

async function thu<T>(ten: string, thieu: string[], fn: () => Promise<T>, macDinh: T): Promise<T> {
    try { return await fn() } catch (e: any) {
        thieu.push(`${ten}: ${String(e?.message || e).slice(0, 120)}`)
        return macDinh
    }
}

export async function sucKhoeDuLieu(
    prisma: any,
    ky: { from: string; to: string; start: Date; end: Date },
): Promise<KetQuaSucKhoe> {
    const thieu: string[] = []
    const muc: MucSucKhoe[] = []

    /* Truy vấn TUẦN TỰ — pool mỗi cửa hàng chỉ vài kết nối. */

    // ── 1. Dữ liệu bán có phủ hết kỳ không ───────────────────────────────
    const soNgayKy = Math.max(1, Math.round((ky.end.getTime() - ky.start.getTime()) / 86400_000))
    const phu: any[] = await thu('phamViBan', thieu, () => prisma.$queryRawUnsafe(
        /* Đếm theo NGÀY BÁN. Cửa hàng nhập lịch sử từ phần mềm cũ có `createdAt`
         * là cửa sổ chạy nhập vài tuần, nên đếm theo nó sẽ ra "31/91 ngày →
         * dữ liệu rải rác, thiếu nhiều quãng giữa kỳ" cho một cửa hàng bán
         * liên tục suốt 5 tháng — chê nhầm chất lượng dữ liệu của họ.
         *
         * Chuyện kỳ báo cáo đang bị cắt theo ngày ghi sổ là vấn đề KHÁC, và đã
         * có mục `ky-ghi-so-lech-ky-ban` bên dưới nói riêng. Hai sự thật khác
         * nhau thì phải nói ở hai chỗ, đừng trộn vào một con số. */
        `SELECT COUNT(DISTINCT (COALESCE(t."transactionDate", t."createdAt") + interval '7 hours')::date)::int AS "soNgay",
                MIN(COALESCE(t."transactionDate", t."createdAt")) AS "somNhat",
                MAX(COALESCE(t."transactionDate", t."createdAt")) AS "muonNhat"
         FROM "Transaction" t
         WHERE t.status IN ('completed','partial')
           AND COALESCE(t."transactionDate", t."createdAt") >= $1
           AND COALESCE(t."transactionDate", t."createdAt") < $2`,
        ky.start, ky.end,
    ), [])
    const soNgayCoBan = Number(phu?.[0]?.soNgay) || 0
    const somNhat = phu?.[0]?.somNhat ? new Date(phu[0].somNhat).toISOString().slice(0, 10) : null
    const tyLePhu = Math.round((soNgayCoBan / soNgayKy) * 100)

    /* MỚI BẮT ĐẦU DÙNG PHẦN MỀM ≠ THIẾU DỮ LIỆU.
     *
     * Đo trên dữ liệu thật 14/08/2026: một cửa hàng có 31/91 ngày, nhưng dữ liệu
     * LIÊN TỤC từ 15/07 tới nay — họ mới bắt đầu dùng phần mềm, không hề bỏ sót
     * ngày nào. Gắn cờ "phải sửa" cho họ là buộc tội oan, và họ sẽ bỏ qua luôn
     * những cảnh báo thật ở lần sau.
     *
     * Phân biệt bằng tính LIÊN TỤC: nếu số ngày có bán xấp xỉ số ngày kể từ lần
     * bán đầu tiên thì không có lỗ hổng nào — chỉ là bắt đầu muộn. Còn thưa thớt
     * rải rác giữa kỳ mới là dữ liệu bị thiếu thật. */
    const ngaySomNhat = phu?.[0]?.somNhat ? new Date(phu[0].somNhat).getTime() : null
    const soNgayTuLucBatDau = ngaySomNhat
        ? Math.max(1, Math.round((ky.end.getTime() - ngaySomNhat) / 86400_000))
        : soNgayKy
    const lienTuc = soNgayCoBan > 0 && soNgayCoBan >= soNgayTuLucBatDau * 0.85
    const batDauMuon = lienTuc && soNgayCoBan < soNgayKy * 0.85

    muc.push({
        ma: 'pham-vi-du-lieu',
        ten: batDauMuon ? 'Dữ liệu bán bắt đầu từ giữa kỳ' : 'Dữ liệu bán phủ được bao nhiêu kỳ',
        /* KHÔNG BÁN GÌ TRONG KỲ ≠ DỮ LIỆU HỎNG.
         *
         * Cửa hàng mới lập, cửa hàng dùng thử, hoặc người dùng chọn nhầm khoảng
         * ngày — cả ba đều ra "không có ngày nào" mà chẳng có gì phải sửa. Gắn
         * cờ "phải sửa" ở đây là doạ một cửa hàng chưa làm gì sai, và họ sẽ học
         * cách bỏ qua bảng này ngay từ ngày đầu tiên.
         *
         * Đo trên dữ liệu thật 14/08/2026: hai cửa hàng chưa phát sinh bán bị
         * chấm 65/100 "cần dọn" trong khi không có gì để dọn. */
        muc: soNgayCoBan === 0 ? 'vua' : batDauMuon ? 'vua' : tyLePhu < 60 ? 'nang' : tyLePhu < 85 ? 'vua' : 'on',
        so: soNgayCoBan === 0 ? 'không có ngày nào' : `${soNgayCoBan}/${soNgayKy} ngày (${tyLePhu}%)${somNhat ? ` · sớm nhất ${somNhat}` : ''}`,
        anhHuong: soNgayCoBan === 0
            ? 'Kỳ này không có giao dịch bán nào nên mọi báo cáo theo kỳ đều rỗng. Đây KHÔNG phải lỗi dữ liệu: có thể cửa hàng chưa bắt đầu bán, hoặc khoảng ngày đang chọn nằm ngoài quãng có dữ liệu.'
            : batDauMuon
                ? `Dữ liệu LIÊN TỤC từ ${somNhat} tới nay, không sót ngày nào — nhiều khả năng cửa hàng bắt đầu dùng phần mềm từ ngày đó. Không phải lỗi dữ liệu. Nhưng các con số "cả kỳ" vẫn chỉ tính phần từ ${somNhat}, nên đừng đem so với một kỳ trọn vẹn.`
                : tyLePhu < 60
                    ? 'Ngày có bán nằm rải rác, thiếu nhiều quãng giữa kỳ. Mọi con số "cả kỳ" đang tính trên phần dữ liệu có sẵn, nên chúng là MỨC SÀN chứ không phải mức đúng: doanh thu, thuế phải nộp, sức bán để tính điểm đặt hàng đều thấp hơn thực tế.'
                    : 'Dữ liệu phủ gần trọn kỳ nên các báo cáo theo kỳ dùng được.',
        canLam: soNgayCoBan === 0
            ? 'Kiểm tra lại khoảng ngày đang chọn.'
            : batDauMuon
                ? `Đọc báo cáo trong khoảng từ ${somNhat} trở đi. Nếu cửa hàng đã bán trước ngày đó thì nhập bổ sung phần cũ.`
                : tyLePhu < 60
                    ? 'Nhập nốt dữ liệu bán của những quãng còn thiếu, hoặc chỉ đọc báo cáo trong khoảng đã có dữ liệu.'
                    : 'Không cần làm gì.',
    })

    // ── 2. Tồn kho âm ────────────────────────────────────────────────────
    /* CỬA HÀNG CÓ THỂ ĐANG CỐ Ý CHO BÁN ÂM.
     *
     * StoreSettings.allowNegativeStock là một lựa chọn thật: nhiều cửa hàng bán
     * trước rồi hàng mới về, và họ bật cờ đó để POS không chặn. Với những cửa
     * hàng ấy, tồn âm KHÔNG phải lệch sổ sách — nói "gần như luôn là lệch sổ" là
     * buộc tội oan đúng cái họ chủ động chọn, và lần sau họ bỏ qua luôn cảnh báo
     * thật.
     *
     * Vẫn phải nhắc, vì tồn âm dù cố ý vẫn làm bảng đặt hàng và giá vốn lệch —
     * nhưng nhắc bằng lời khác và ở mức nhẹ hơn. */
    const chapNhanAm: any = await thu('caiDatKho', thieu, () => prisma.storeSettings.findFirst({
        select: { allowNegativeStock: true },
    }), null)
    const choBanAm = chapNhanAm?.allowNegativeStock === true

    const tonAm: any = await thu('tonAm', thieu, () => prisma.product.aggregate({
        where: { stock: { lt: 0 } }, _count: true, _sum: { stock: true },
    }), null)
    /* Kèm mã âm SÂU NHẤT: "234 mã tồn âm" không nói được phải mở cái gì trước.
     * Âm sâu nhất thường cũng là chỗ lệch rõ nhất và dễ tìm ra nguyên nhân nhất. */
    const tonAmTop: any[] = (Number(tonAm?._count) || 0) > 0
        ? await thu('tonAmChiTiet', thieu, () => prisma.product.findMany({
            where: { stock: { lt: 0 } },
            select: { id: true, name: true, sku: true, stock: true },
            orderBy: { stock: 'asc' },
            take: 8,
        }), [])
        : []

    /* ── LỊCH SỬ NHẬP HÀNG CÓ NGẮN HƠN LỊCH SỬ BÁN KHÔNG? ────────────────────
     * Cửa hàng chuyển từ phần mềm cũ thường nhập được lịch sử BÁN nhưng không
     * nhập lịch sử NHẬP HÀNG; hàng bán ra không có phiếu nhập tương ứng nên tồn
     * âm hàng loạt. Bộ soát Sẵn Sàng Thanh Tra đã nói đúng điều này rồi — bảng
     * này nằm CÙNG MỘT TRANG với nó, nên không được nói khác đi.
     *
     * Đo trên KENGISTORE: bán trải 147 ngày, nhập chỉ 42 phiếu trải 44 ngày. */
    let khoangTrongNhap: { soNgay: number; tuNgay: string } | null = null
    {
        const r: any[] | null = await thu<any[] | null>('moc BanNhap', thieu, () => prisma.$queryRawUnsafe(
            `SELECT (SELECT MIN(COALESCE(t."transactionDate", t."createdAt"))
                       FROM "Transaction" t WHERE t.status IN ('completed','partial')) AS "banDau",
                    (SELECT MIN(COALESCE(i."transactionDate", i."createdAt"))
                       FROM "ImportReceipt" i WHERE i.status <> 'cancelled') AS "nhapDau"`), null)
        const bd = r?.[0]?.banDau ? new Date(r[0].banDau) : null
        const nd = r?.[0]?.nhapDau ? new Date(r[0].nhapDau) : null
        if (bd && nd) {
            const cach = Math.round((nd.getTime() - bd.getTime()) / 86400_000)
            if (cach >= 30) khoangTrongNhap = { soNgay: cach, tuNgay: nd.toISOString().slice(0, 10) }
        }
    }

    if (tonAm) {
        const so = Number(tonAm?._count) || 0
        muc.push({
            viDu: tonAmTop.map((p: any) => ({
                id: String(p.id),
                nhan: `${p.name}${p.sku ? ` (${p.sku})` : ''}`,
                phu: `tồn ${lam(p.stock)}`,
            })),
            ma: 'ton-am',
            ten: choBanAm ? 'Mã hàng có tồn âm (cửa hàng cho bán âm)'
                : khoangTrongNhap ? 'Mã hàng có tồn âm (thiếu lịch sử nhập hàng)' : 'Mã hàng có tồn âm',
            muc: so === 0 ? 'on' : (choBanAm || khoangTrongNhap) ? 'vua' : so > 50 ? 'nang' : 'vua',
            so: so === 0 ? 'không có' : `${so} mã · tổng ${lam(tonAm?._sum?.stock)}`,
            anhHuong: so === 0
                ? 'Tồn kho khớp sổ.'
                : choBanAm
                    ? 'Cửa hàng đang bật "cho phép bán khi hết tồn", nên tồn âm ở đây là bán trước — hàng về sẽ bù. KHÔNG phải lỗi dữ liệu. Nhưng trong lúc còn âm thì bảng đề xuất đặt hàng và giá vốn hàng bán vẫn tính trên số âm đó.'
                    : khoangTrongNhap
                        ? `Phần mềm chỉ có phiếu nhập từ ${khoangTrongNhap.tuNgay}, trong khi lịch sử bán bắt đầu sớm hơn ${khoangTrongNhap.soNgay} ngày. Hàng bán trong quãng trống đó không có phiếu nhập tương ứng nên tồn tụt xuống âm — gần như luôn là do CHƯA NHẬP lịch sử mua hàng từ phần mềm cũ, chứ không phải bán không trừ kho. Trong lúc còn âm thì bảng đề xuất đặt hàng và giá vốn hàng bán vẫn tính trên số âm đó.`
                        : 'Cửa hàng KHÔNG bật cho phép bán âm, nên tồn âm ở đây là lệch sổ sách (bán không trừ kho, nhập chưa ghi, đồng bộ sót) chứ không phải bán trước. Nó làm bảng đề xuất đặt hàng đòi mua thừa đúng bằng phần lệch, và làm giá vốn hàng bán sai.',
            canLam: so === 0
                ? 'Không cần làm gì.'
                : choBanAm
                    ? 'Nhập bù cho những mã đang âm sâu nhất; mã nào âm lâu mà hàng không về thì kiểm kê lại.'
                    : khoangTrongNhap
                        ? `Nhập bổ sung phiếu nhập của quãng trước ${khoangTrongNhap.tuNgay} rồi soát lại — làm việc này trước sẽ tự hết phần lớn số mã âm. Kiểm kê ${so} mã ngay bây giờ là công vô ích nếu nguyên nhân chỉ là thiếu lịch sử nhập.`
                        : 'Kiểm kê nhóm mã này rồi chỉnh tồn về đúng thực tế; xong thì chạy lại đối chiếu kho.',
        })
    }

    // ── 3. Hoá đơn phát hành hỏng ────────────────────────────────────────
    const hong: any[] = await thu('hoaDonHong', thieu, () => prisma.eInvoice.findMany({
        where: { invoiceDate: { gte: ky.from, lte: ky.to }, status: 'ERROR' },
        select: { totalAmount: true, errorMessage: true },
    }), [])
    const soTrungKhoa = hong.filter(h => /fkey/i.test(String(h.errorMessage || '')) && /đã được sử dụng|already/i.test(String(h.errorMessage || ''))).length

    /* NGUYÊN NHÂN PHẢI HIỆN NGAY TẠI ĐÂY, không chỉ ở trang Hoá Đơn VAT.
     *
     * Menu "Hóa Đơn VAT" có cờ companyOnly — hộ kinh doanh KHÔNG thấy nó, trong
     * khi từ 2026 họ vẫn phải dùng hoá đơn điện tử máy tính tiền (NĐ 70/2025) và
     * vẫn nhận được cảnh báo này. Chỉ họ sang một trang họ không vào được là
     * cảnh báo đi nửa đường — tương đương không có cảnh báo.
     *
     * Trang Sẵn Sàng Thanh Tra (nơi đặt bảng sức khoẻ) thì mọi loại hình đều mở
     * được, nên gom nguyên nhân về đây là đủ cho cả hai nhóm. */
    const nhomLoi = new Map<string, number>()
    for (const h of hong) {
        const k = String(h.errorMessage || '(không ghi lý do)')
            .replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 90)
        nhomLoi.set(k, (nhomLoi.get(k) || 0) + 1)
    }

    muc.push({
        viDu: Array.from(nhomLoi.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([lyDo, n]) => ({ nhan: lyDo, phu: `${n} tờ` })),
        ma: 'hoa-don-hong',
        ten: 'Hoá đơn phát hành hỏng',
        muc: hong.length === 0 ? 'on' : hong.length > 20 ? 'nang' : 'vua',
        so: hong.length === 0 ? 'không có' : `${hong.length} tờ · ${tien(hong.reduce((s, h) => s + (Number(h.totalAmount) || 0), 0))}${soTrungKhoa ? ` · trong đó ${soTrungKhoa} tờ thật ra ĐÃ phát hành xong` : ''}`,
        anhHuong: hong.length === 0
            ? 'Không có tờ nào kẹt.'
            : 'Về mặt thuế, hoá đơn hỏng giống như chưa lập hoá đơn. Chúng cũng không được tính vào phần "đã xuất" nên tỷ lệ phủ hoá đơn đang bị báo THẤP HƠN thực tế.',
        canLam: hong.length === 0
            ? 'Không cần làm gì.'
            : soTrungKhoa > 0
                ? 'Mở Hóa Đơn VAT → bảng hoá đơn hỏng. Nhóm báo trùng khoá thì bấm ghi bù (ĐỪNG xuất lại — sẽ hỏng tiếp); các nhóm còn lại sửa theo hướng dẫn từng nguyên nhân.'
                : 'Mở Hóa Đơn VAT → bảng hoá đơn hỏng để xem nguyên nhân từng nhóm.',
    })

    // ── 4. Chi phí ghi sổ có tương xứng doanh thu không ──────────────────
    const dt: any = await thu('doanhThu', thieu, () => prisma.transaction.aggregate({
        where: { createdAt: { gte: ky.start, lt: ky.end }, status: { in: ['completed', 'partial'] } },
        _sum: { total: true },
    }), null)
    const cp: any = await thu('chiPhi', thieu, () => prisma.expense.aggregate({
        where: { date: { gte: ky.start, lt: ky.end }, status: 'active' }, _sum: { amount: true },
    }), null)
    if (dt && cp) {
        const doanhThu = Number(dt?._sum?.total) || 0
        const chiPhi = Number(cp?._sum?.amount) || 0
        const tyLe = doanhThu > 0 ? Math.round((chiPhi / doanhThu) * 1000) / 10 : null
        muc.push({
            ma: 'chi-phi-ghi-so',
            ten: 'Chi phí đã ghi sổ so với doanh thu',
            muc: doanhThu === 0 ? 'on' : (tyLe ?? 0) < 5 ? 'nang' : (tyLe ?? 0) < 10 ? 'vua' : 'on',
            so: doanhThu === 0 ? 'chưa có doanh thu để so' : `${tyLe}% (${tien(chiPhi)} trên ${tien(doanhThu)})`,
            anhHuong: doanhThu > 0 && (tyLe ?? 0) < 5
                ? 'Không cửa hàng nào vận hành với chi phí dưới 5% doanh thu — nhiều khả năng tiền thuê, lương, điện nước chưa được ghi. Khi đó lãi đang bị báo CAO HƠN thực tế và lịch tiền vẽ ra một đường đi lên không có thật.'
                : 'Chi phí ghi sổ ở mức hợp lý so với doanh thu.',
            canLam: doanhThu > 0 && (tyLe ?? 0) < 5
                ? 'Ghi các khoản chi cố định hằng tháng vào sổ chi phí (thuê mặt bằng, lương, điện nước, vận chuyển).'
                : 'Không cần làm gì.',
        })
    }

    /* ── 5. Phiếu nhập trùng số hoá đơn cùng một nhà cung cấp ─────────────
     *
     * Mỗi phiếu nhập cộng tồn kho, tính lại giá vốn, ghi công nợ nhà cung cấp và
     * sinh bút toán. Nhập trùng là sai đủ BỐN chỗ cùng lúc, cộng thêm khai trùng
     * chi phí được trừ khi quyết toán.
     *
     * Đo trên dữ liệu thật 14/08/2026: một cửa hàng có 4 cặp trùng, 138,7 triệu
     * chi phí ghi hai lần — ba cặp là do nhập lại đúng những phiếu đã nhập tuần
     * trước, số tiền giống hệt tới từng đồng.
     *
     * Chỉ gom theo nhà cung cấp: trùng số ở HAI nhà cung cấp khác nhau là bình
     * thường vì mỗi bên có dải số riêng. */
    const phieuNhap: any[] = await thu('phieuNhapTrung', thieu, () => prisma.importReceipt.findMany({
        where: { createdAt: { gte: ky.start, lt: ky.end }, status: { not: 'cancelled' }, vatInvoiceNo: { not: null } },
        select: { code: true, vatInvoiceNo: true, supplierId: true, supplierName: true, totalCost: true },
        take: 3000,
    }), [])
    if (phieuNhap.length > 0 || !thieu.some(t => t.startsWith('phieuNhapTrung'))) {
        const chuan = (v: any) => String(v || '').replace(/\s+/g, '').toLowerCase()
        const nhom = new Map<string, any[]>()
        for (const r of phieuNhap) {
            const so = chuan(r.vatInvoiceNo)
            const ncc = r.supplierId || chuan(r.supplierName)
            if (!so || !ncc) continue
            const k = `${ncc}|${so}`
            if (!nhom.has(k)) nhom.set(k, [])
            nhom.get(k)!.push(r)
        }
        const trung = Array.from(nhom.values()).filter(v => v.length > 1)
        // Tiền ghi thừa = các phiếu SAU trong mỗi nhóm; phiếu đầu mới là phiếu thật.
        const tienThua = trung.reduce((s, v) => s + v.slice(1).reduce((s2: number, r: any) => s2 + (Number(r.totalCost) || 0), 0), 0)
        muc.push({
            ma: 'phieu-nhap-trung',
            ten: 'Phiếu nhập trùng số hoá đơn',
            muc: trung.length === 0 ? 'on' : 'nang',
            so: trung.length === 0 ? 'không có' : `${trung.length} cặp · ghi thừa ${tien(tienThua)}`,
            anhHuong: trung.length === 0
                ? 'Mỗi số hoá đơn chỉ dùng một lần cho mỗi nhà cung cấp.'
                : 'Mỗi phiếu nhập cộng tồn kho, tính lại giá vốn, ghi công nợ nhà cung cấp và sinh bút toán — nhập trùng là sai đủ bốn chỗ cùng lúc. Khi quyết toán còn thành khai trùng chi phí được trừ, mà bên bán chỉ phát hành một tờ cho mỗi số.',
            canLam: trung.length === 0
                ? 'Không cần làm gì.'
                : 'Mở Nhập Hàng, lọc theo số hoá đơn ở danh sách bên dưới, giữ phiếu ĐẦU TIÊN và huỷ phiếu nhập sau — huỷ sẽ tự trừ lại tồn kho và đảo bút toán.',
        })
    }

    // ── 6. Số dư ngân hàng đã nhập chưa ──────────────────────────────────
    const tk: any[] = await thu('taiKhoan', thieu, () => prisma.bankAccount.findMany({
        select: { balance: true },
    }), [])
    const coSoDu = tk.some(t => Number(t?.balance) > 0)
    muc.push({
        ma: 'so-du-ngan-hang',
        ten: 'Số dư tài khoản ngân hàng',
        muc: tk.length === 0 ? 'vua' : coSoDu ? 'on' : 'vua',
        so: tk.length === 0 ? 'chưa khai tài khoản nào' : coSoDu ? `${tk.length} tài khoản có số dư` : `${tk.length} tài khoản nhưng số dư đang để 0`,
        anhHuong: coSoDu
            ? 'Lịch tiền tới có điểm xuất phát thật.'
            : 'Không có số dư đầu thì lịch tiền tới chỉ cho thấy TIỀN VÀO RA CHÊNH NHAU bao nhiêu, không phải số dư thật — không dùng để trả lời "khi nào hết tiền" được.',
        canLam: coSoDu ? 'Không cần làm gì.' : 'Nhập số dư hiện tại của từng tài khoản ở mục Tài khoản ngân hàng.',
    })

    /* ── 7. Kỳ ghi sổ lệch kỳ bán ────────────────────────────────────────
     *
     * Cửa hàng nhập lịch sử từ phần mềm cũ (kiotvietSync ghi `transactionDate`
     * = ngày bán thật, `createdAt` = lúc chạy nhập) sẽ có nhiều tháng bán hàng
     * mang cùng một khoảng `createdAt` vài tuần. Mọi báo cáo theo kỳ — kể cả tờ
     * khai thuế — đang cắt theo `createdAt`, nên doanh thu rơi vào THÁNG NHẬP
     * chứ không phải tháng bán.
     *
     * Đo trên KENGISTORE: tháng 7 hiện 5.008.923.223 ₫ trong khi bán thật
     * 975.813.049 ₫; tháng 3–6 hiện 0 ₫ dù bán hơn 4 tỷ.
     *
     * Ở đây CHỈ NÊU RA, không tự sửa: đổi cách cắt kỳ là thay đổi doanh thu đã
     * kê khai, việc đó phải do người dùng quyết. Và phải nói cho đúng chỗ đau:
     * đây là cách PHẦN MỀM đang tính, KHÔNG phải cửa hàng khai sai. */
    {
        /* macDinh = null CỐ Ý, không phải []: `[]` nghĩa là "đọc được, không có
         * đơn nào lệch" — kết luận ngược hẳn với "không đọc được". */
        const lech: any[] | null = await thu<any[] | null>('lechKyGhiSo', thieu, () => prisma.$queryRawUnsafe(
            `SELECT to_char("createdAt" + interval '7 hours', 'YYYY-MM')                      AS "thangGhiSo",
                    to_char(COALESCE("transactionDate","createdAt") + interval '7 hours', 'YYYY-MM') AS "thangBan",
                    COUNT(*)::int                                                             AS so,
                    COALESCE(SUM(total), 0)::float8                                           AS tien
               FROM "Transaction"
              WHERE status IN ('completed','partial')
                AND "transactionDate" IS NOT NULL
                AND to_char("createdAt" + interval '7 hours', 'YYYY-MM')
                 <> to_char("transactionDate" + interval '7 hours', 'YYYY-MM')
              GROUP BY 1, 2
              ORDER BY tien DESC`), null)

        /* Phiếu nhập cũng có `transactionDate` (= ngày trên hoá đơn mua). Route
         * Nhập Hàng đã lọc đúng theo nó, nhưng các cỗ máy soát thuế thì cắt
         * theo `createdAt` — nên cùng một phiếu hiện ở tháng này trên màn hình
         * Nhập Hàng mà lại tính vào tháng khác khi soát thuế. Lệch ở đây kéo
         * theo VAT đầu vào và giá vốn, không chỉ doanh thu. */
        const lechNhap: any[] | null = await thu<any[] | null>('lechKyNhap', thieu, () => prisma.$queryRawUnsafe(
            `SELECT to_char("createdAt" + interval '7 hours', 'YYYY-MM')       AS "thangGhiSo",
                    to_char("transactionDate" + interval '7 hours', 'YYYY-MM') AS "thangNhap",
                    COUNT(*)::int                                              AS so,
                    COALESCE(SUM("totalCost"), 0)::float8                      AS tien
               FROM "ImportReceipt"
              WHERE status <> 'cancelled'
                AND "transactionDate" IS NOT NULL
                AND to_char("createdAt" + interval '7 hours', 'YYYY-MM')
                 <> to_char("transactionDate" + interval '7 hours', 'YYYY-MM')
              GROUP BY 1, 2
              ORDER BY tien DESC`), null)

        if (lech === null) {
            /* Không đọc được thì nói là không đọc được. Im lặng ở đây khiến
             * người dùng tin mọi kỳ đều khớp, đúng kiểu ngược lại với sự thật. */
            muc.push({
                ma: 'ky-ghi-so-lech-ky-ban', ten: 'Kỳ ghi sổ so với kỳ bán', muc: 'vua',
                so: null,
                anhHuong: 'Chưa đọc được để đối chiếu ngày bán với ngày ghi sổ. Đây KHÔNG phải kết luận là có lệch.',
                canLam: 'Thử lại sau; nếu vẫn không đọc được thì báo kỹ thuật.',
            })
        } else {
            const dsNhap = lechNhap || []
            const tongTien = lech.reduce((s, r) => s + (Number(r.tien) || 0), 0)
                + dsNhap.reduce((s, r) => s + (Number(r.tien) || 0), 0)
            const soBan = lech.reduce((s, r) => s + (Number(r.so) || 0), 0)
            const soNhap = dsNhap.reduce((s, r) => s + (Number(r.so) || 0), 0)
            const tongSo = soBan + soNhap
            const phanBan = soBan > 0 ? `${soBan.toLocaleString('vi-VN')} đơn bán` : ''
            const phanNhap = soNhap > 0 ? `${soNhap.toLocaleString('vi-VN')} phiếu nhập` : ''
            muc.push({
                ma: 'ky-ghi-so-lech-ky-ban',
                ten: 'Kỳ ghi sổ so với kỳ bán / kỳ nhập',
                /* Nặng khi số tiền lệch đủ lớn để đổi kết quả một kỳ thuế. */
                muc: tongSo === 0 ? 'on' : tongTien >= 100_000_000 ? 'nang' : 'vua',
                so: tongSo === 0 ? 'không có chứng từ nào lệch kỳ'
                    : `${[phanBan, phanNhap].filter(Boolean).join(' · ')} · ${tien(tongTien)} nằm sai kỳ`,
                anhHuong: tongSo === 0
                    ? 'Ngày trên chứng từ và ngày ghi sổ nằm cùng một tháng ở mọi bản ghi.'
                    : 'Những chứng từ này có NGÀY THẬT ở tháng khác với tháng ghi vào phần mềm — thường gặp khi nhập lịch sử từ phần mềm cũ. Mọi báo cáo theo kỳ, KỂ CẢ TỜ KHAI THUẾ, đang cắt kỳ theo ngày ghi sổ, nên tháng nhập liệu bị phồng lên còn các tháng thật hiện thiếu hoặc bằng 0.'
                    + (soNhap > 0 ? ' Phần phiếu nhập còn kéo theo VAT đầu vào và giá vốn, không chỉ doanh thu — và màn hình Nhập Hàng lọc theo ngày hoá đơn nên nó hiện KHÁC với số khi soát thuế.' : '')
                    + ' Đây là cách phần mềm đang tính, KHÔNG phải cửa hàng khai sai.',
                canLam: tongSo === 0
                    ? 'Không cần làm gì.'
                    : 'Đối chiếu từng tháng với sổ của phần mềm cũ trước khi nộp tờ khai. Kỳ nào đã nộp theo số cũ thì cân nhắc khai bổ sung. Muốn phần mềm cắt kỳ theo ngày thật trên chứng từ thì báo để đổi — đổi xong số của các kỳ đã nộp sẽ khác đi.',
                viDu: [
                    ...lech.slice(0, 4).map((r: any) => ({
                        nhan: `Bán tháng ${r.thangBan} nhưng ghi sổ tháng ${r.thangGhiSo}`,
                        phu: `${r.so} đơn · ${tien(Number(r.tien) || 0)}`,
                    })),
                    ...dsNhap.slice(0, 3).map((r: any) => ({
                        nhan: `Nhập tháng ${r.thangNhap} nhưng ghi sổ tháng ${r.thangGhiSo}`,
                        phu: `${r.so} phiếu · ${tien(Number(r.tien) || 0)}`,
                    })),
                ],
            })
        }
    }

    /* ── 8. Đồng bộ KiotViet có còn mang hoá đơn về không ────────────────
     *
     * Đo thật ngày 15/08/2026 ở HUTI: webhook `invoice.update` bị TẮT phía
     * KiotViet (customer/product vẫn bật), nên đơn hàng chỉ về khi có người bấm
     * đồng bộ tay. Hôm 14/08 ai đó bấm → 23 phiếu; hôm 15/08 không ai bấm →
     * KHÔNG CÓ ĐƠN NÀO, và không một dòng log nào báo động.
     *
     * Đây là kiểu hỏng tệ nhất: im lặng. Người dùng chỉ phát hiện khi tự thấy
     * "hôm nay chưa có đơn nào". Phép soát này biến nó thành một dòng đỏ.
     *
     * Chỉ soát khi cửa hàng CÓ dùng KiotViet — không có bảng hoặc chưa từng
     * đồng bộ thì im, không phải cửa hàng nào cũng nối KiotViet. */
    {
        /* try/catch chứ KHÔNG dùng `thu()`: cửa hàng không nối KiotViet là
         * chuyện bình thường, ghi nó vào mục "chưa đọc được" là thêm một dòng
         * nhiễu cho mọi cửa hàng không dùng tính năng này. */
        let kv: any[] | null = null
        try {
            kv = await prisma.kiotVietSyncLog.findMany({
                where: { entity: { contains: 'invoice' } },
                orderBy: { startedAt: 'desc' }, take: 1,
                select: { startedAt: true, mode: true, created: true, updated: true, fetched: true },
            })
        } catch { kv = null }

        // null = không đọc được (store chưa có bảng) → im hẳn, đây không phải lỗi.
        if (kv !== null && kv.length > 0) {
            const lanCuoi = new Date(kv[0].startedAt)
            const soGio = Math.floor((Date.now() - lanCuoi.getTime()) / 3600_000)
            const ngayVN = new Date(lanCuoi.getTime() + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
            muc.push({
                ma: 'dong-bo-kiotviet',
                ten: 'Đồng bộ hoá đơn từ KiotViet',
                /* 24 giờ: một ngày bán không có đơn nào về là đủ để nghi. Dưới
                 * mốc đó thì có thể chỉ là cửa hàng chưa bán, không nên kêu. */
                muc: soGio >= 48 ? 'nang' : soGio >= 24 ? 'vua' : 'on',
                so: `lần cuối ${ngayVN} (${soGio} giờ trước) · ${kv[0].mode === 'manual' ? 'chạy tay' : 'webhook'} · tạo ${kv[0].created}`,
                anhHuong: soGio < 24
                    ? 'Hoá đơn từ KiotViet vẫn đang về bình thường.'
                    : `Đã ${soGio} giờ không có đợt đồng bộ hoá đơn nào từ KiotViet. Nếu cửa hàng vẫn bán thì doanh thu, tồn kho và mọi báo cáo theo kỳ đang THIẾU phần bán qua KiotViet — không phải cửa hàng bán ít đi.`
                    + (kv[0].mode === 'manual' ? ' Đợt gần nhất là CHẠY TAY, tức webhook không mang hoá đơn về: nhiều khả năng webhook invoice.update đang bị tắt ở phía KiotViet.' : ''),
                canLam: soGio < 24
                    ? 'Không cần làm gì.'
                    : 'Mở Cài đặt → KiotViet, bấm "Đồng bộ" để kéo đơn còn thiếu. Sau đó kiểm mục webhook trên trang đó: loại invoice.update phải đang BẬT và trỏ về Kengi — KiotViet tự tắt webhook sau nhiều lần giao hỏng.',
            })
        }
    }

    /* Điểm: mỗi mục nặng cắt 28% phần CÒN LẠI, vừa cắt 10%. Không phải thang
     * khoa học — mục đích là xếp thứ tự ưu tiên và **cho người dùng thấy tiến
     * bộ khi dọn dần**, nên trừ theo tỷ lệ chứ không trừ thẳng rồi kẹp sàn.
     *
     * Bản trước trừ tuyến tính: KENGISTORE có 5 mục nặng + 2 mục vừa ra
     * 100−125−20 = −45, kẹp về 0. Họ dọn xong 2 mục nặng vẫn thấy 0/100 — kim
     * không nhúc nhích thì người ta bỏ dở. Cách nhân không bao giờ chạm 0 và ở
     * vùng ít lỗi cho kết quả gần y hệt cách cũ (1 mục nặng: 75 điểm ở cả hai
     * cách), nên cửa hàng đang sạch không thấy khác gì. Hệ số chọn sao cho MỌI
     * nhãn xếp loại trùng khớp cách cũ ở vùng ít lỗi — đã đối chiếu từng tổ hợp,
     * và có ca test khoá lại. Cùng cách chấm với bộ
     * soát Sẵn Sàng Thanh Tra — hai bảng nằm cùng một trang thì không được
     * chấm điểm theo hai triết lý khác nhau. */
    const conLai = muc.reduce((s, m) => s * (m.muc === 'nang' ? 0.72 : m.muc === 'vua' ? 0.90 : 1), 1)
    const diem = Math.max(0, Math.min(100, Math.round(100 * conLai)))
    return {
        ky: { from: ky.from, to: ky.to },
        diem,
        xepLoai: diem >= 85 ? 'tốt' : diem >= 55 ? 'cần dọn' : 'chưa tin được',
        muc: muc.sort((a, b) => {
            const w = { nang: 0, vua: 1, on: 2 }
            return w[a.muc] - w[b.muc]
        }),
        thieu,
    }
}
