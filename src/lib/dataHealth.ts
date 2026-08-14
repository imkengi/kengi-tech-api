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
    muc.push({
        ma: 'pham-vi-du-lieu',
        ten: 'Dữ liệu bán phủ được bao nhiêu kỳ',
        muc: soNgayCoBan === 0 ? 'nang' : tyLePhu < 60 ? 'nang' : tyLePhu < 85 ? 'vua' : 'on',
        so: soNgayCoBan === 0 ? 'không có ngày nào' : `${soNgayCoBan}/${soNgayKy} ngày (${tyLePhu}%)${somNhat ? ` · sớm nhất ${somNhat}` : ''}`,
        anhHuong: tyLePhu < 60
            ? 'Mọi con số "cả kỳ" đang tính trên phần dữ liệu có sẵn, nên chúng là MỨC SÀN chứ không phải mức đúng: doanh thu, thuế phải nộp, sức bán để tính điểm đặt hàng đều thấp hơn thực tế.'
            : 'Dữ liệu phủ gần trọn kỳ nên các báo cáo theo kỳ dùng được.',
        canLam: tyLePhu < 60
            ? 'Nhập nốt dữ liệu bán của quãng còn thiếu, hoặc chỉ đọc báo cáo trong khoảng đã có dữ liệu.'
            : 'Không cần làm gì.',
    })

    // ── 2. Tồn kho âm ────────────────────────────────────────────────────
    const tonAm: any = await thu('tonAm', thieu, () => prisma.product.aggregate({
        where: { stock: { lt: 0 } }, _count: true, _sum: { stock: true },
    }), null)
    if (tonAm) {
        const so = Number(tonAm?._count) || 0
        muc.push({
            ma: 'ton-am',
            ten: 'Mã hàng có tồn âm',
            muc: so === 0 ? 'on' : so > 50 ? 'nang' : 'vua',
            so: so === 0 ? 'không có' : `${so} mã · tổng ${lam(tonAm?._sum?.stock)}`,
            anhHuong: so === 0
                ? 'Tồn kho khớp sổ.'
                : 'Tồn âm gần như luôn là lệch sổ sách (bán không trừ kho, nhập chưa ghi, đồng bộ sót) chứ không phải hàng đang thiếu. Nó làm bảng đề xuất đặt hàng đòi mua thừa đúng bằng phần lệch, và làm giá vốn hàng bán sai.',
            canLam: so === 0 ? 'Không cần làm gì.' : 'Kiểm kê nhóm mã này rồi chỉnh tồn về đúng thực tế; xong thì chạy lại đối chiếu kho.',
        })
    }

    // ── 3. Hoá đơn phát hành hỏng ────────────────────────────────────────
    const hong: any[] = await thu('hoaDonHong', thieu, () => prisma.eInvoice.findMany({
        where: { invoiceDate: { gte: ky.from, lte: ky.to }, status: 'ERROR' },
        select: { totalAmount: true, errorMessage: true },
    }), [])
    const soTrungKhoa = hong.filter(h => /fkey/i.test(String(h.errorMessage || '')) && /đã được sử dụng|already/i.test(String(h.errorMessage || ''))).length
    muc.push({
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
                ? 'Mở Hoá Đơn VAT → bảng hoá đơn hỏng. Nhóm báo trùng khoá thì bấm ghi bù (ĐỪNG xuất lại — sẽ hỏng tiếp); các nhóm còn lại sửa theo hướng dẫn từng nguyên nhân.'
                : 'Mở Hoá Đơn VAT → bảng hoá đơn hỏng để xem nguyên nhân từng nhóm.',
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

    // ── 5. Số dư ngân hàng đã nhập chưa ──────────────────────────────────
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
