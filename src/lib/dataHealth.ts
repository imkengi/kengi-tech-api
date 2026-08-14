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
        `SELECT COUNT(DISTINCT (t."createdAt" + interval '7 hours')::date)::int AS "soNgay",
                MIN(t."createdAt") AS "somNhat",
                MAX(t."createdAt") AS "muonNhat"
         FROM "Transaction" t
         WHERE t.status IN ('completed','partial') AND t."createdAt" >= $1 AND t."createdAt" < $2`,
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

    if (tonAm) {
        const so = Number(tonAm?._count) || 0
        muc.push({
            viDu: tonAmTop.map((p: any) => ({
                id: String(p.id),
                nhan: `${p.name}${p.sku ? ` (${p.sku})` : ''}`,
                phu: `tồn ${lam(p.stock)}`,
            })),
            ma: 'ton-am',
            ten: choBanAm ? 'Mã hàng có tồn âm (cửa hàng cho bán âm)' : 'Mã hàng có tồn âm',
            muc: so === 0 ? 'on' : choBanAm ? 'vua' : so > 50 ? 'nang' : 'vua',
            so: so === 0 ? 'không có' : `${so} mã · tổng ${lam(tonAm?._sum?.stock)}`,
            anhHuong: so === 0
                ? 'Tồn kho khớp sổ.'
                : choBanAm
                    ? 'Cửa hàng đang bật "cho phép bán khi hết tồn", nên tồn âm ở đây là bán trước — hàng về sẽ bù. KHÔNG phải lỗi dữ liệu. Nhưng trong lúc còn âm thì bảng đề xuất đặt hàng và giá vốn hàng bán vẫn tính trên số âm đó.'
                    : 'Cửa hàng KHÔNG bật cho phép bán âm, nên tồn âm ở đây là lệch sổ sách (bán không trừ kho, nhập chưa ghi, đồng bộ sót) chứ không phải bán trước. Nó làm bảng đề xuất đặt hàng đòi mua thừa đúng bằng phần lệch, và làm giá vốn hàng bán sai.',
            canLam: so === 0
                ? 'Không cần làm gì.'
                : choBanAm
                    ? 'Nhập bù cho những mã đang âm sâu nhất; mã nào âm lâu mà hàng không về thì kiểm kê lại.'
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

    /* Điểm: mỗi mục nặng trừ 25, vừa trừ 10. Không phải thang khoa học — chỉ để
     * xếp thứ tự ưu tiên và cho người dùng thấy tiến bộ khi dọn dần. */
    const diem = Math.max(0, 100 - muc.reduce((s, m) => s + (m.muc === 'nang' ? 25 : m.muc === 'vua' ? 10 : 0), 0))
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
