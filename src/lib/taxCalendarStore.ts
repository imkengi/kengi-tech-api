/**
 * GIEO LỊCH NGHĨA VỤ THUẾ CHO MỘT CỬA HÀNG — phần chạm cơ sở dữ liệu.
 *
 * Tách riêng khỏi taxCalendar.ts (thuần, chỉ tính) vì hai nơi cần dùng chung:
 * route GET /tax/deadlines khi người dùng mở trang, và cron nhắc hạn nộp chạy
 * hằng ngày. Nếu mỗi bên tự suy hồ sơ theo cách riêng thì sớm muộn cũng lệch
 * nhau, và người dùng sẽ thấy thông báo nhắc một mốc mà mở trang ra không có.
 */

import { lichNghiaVuThue, suyKyKeKhai, mocCanDon, type KyKeKhai, type LoaiHinh, type MocNghiaVu } from './taxCalendar'

export interface HoSoThueCuaHang {
    loaiHinh: LoaiHinh
    kyKeKhai: KyKeKhai
    coNhanVien: boolean
}

/**
 * Suy hồ sơ thuế của cửa hàng.
 *
 * Thứ tự ưu tiên cho kỳ kê khai: tham số ép → tờ khai cửa hàng ĐANG lập thật →
 * doanh thu năm trước so với ngưỡng 50 tỷ (Điều 9 NĐ 126/2020). Không biết gì
 * thì mặc định quý: sinh ít mốc hơn và không đẻ ra loạt "quá hạn" giả.
 */
export async function suyHoSoThue(
    prisma: any,
    year: number,
    epKyKeKhai?: string,
): Promise<HoSoThueCuaHang> {
    const cauHinh = await prisma.storeSettings.findFirst({
        select: { businessType: true },
    }).catch(() => null)
    const loaiHinh: LoaiHinh = cauHinh?.businessType === 'household' ? 'household' : 'company'

    let kyKeKhai: KyKeKhai
    if (epKyKeKhai === 'month' || epKyKeKhai === 'quarter') {
        kyKeKhai = epKyKeKhai
    } else {
        const daKhai: any[] = await prisma.taxDeclaration.findMany({
            where: { formType: { in: ['01_GTGT', '01_CNKD'] } },
            select: { periodType: true },
            take: 24,
            orderBy: { createdAt: 'desc' },
        }).catch(() => [])
        if (daKhai.length > 0) {
            const soThang = daKhai.filter(d => d.periodType === 'month').length
            kyKeKhai = soThang > daKhai.length / 2 ? 'month' : 'quarter'
        } else {
            const bt: any[] = await prisma.journalEntry.findMany({
                where: { date: { gte: `${year - 1}-01-01`, lte: `${year - 1}-12-31` } },
                select: { creditAccount: true, debitAccount: true, amount: true },
            }).catch(() => [])
            const dt = bt.reduce((s: number, e: any) =>
                s + (String(e.creditAccount || '').startsWith('511') ? e.amount : 0)
                - (String(e.debitAccount || '').startsWith('511') ? e.amount : 0), 0)
            kyKeKhai = suyKyKeKhai(bt.length ? dt : null)
        }
    }

    const coNhanVien = await prisma.payrollEntry.count()
        .then((n: number) => n > 0).catch(() => false)

    return { loaiHinh, kyKeKhai, coNhanVien }
}

/**
 * Gieo lịch của năm vào bảng TaxDeadline và dọn mốc không còn đúng.
 * Trả về danh sách mốc chuẩn để nơi gọi dùng tiếp (gắn tiền, gắn căn cứ…).
 */
export async function gieoLichNghiaVu(
    prisma: any,
    year: number,
    hoSo: HoSoThueCuaHang,
): Promise<MocNghiaVu[]> {
    const seeds = lichNghiaVuThue(year, hoSo)

    for (const s of seeds) {
        await prisma.taxDeadline.upsert({
            where: { taxType_period: { taxType: s.taxType, period: s.period } },
            create: {
                taxType: s.taxType, period: s.period, dueDate: s.dueDate,
                description: s.description, status: 'pending',
            },
            update: { dueDate: s.dueDate, description: s.description },
        })
    }

    /* Dọn mốc do bản cũ sinh ra mà nay không còn đúng — nhưng CHỈ mốc chưa ai
     * động tới. Mốc đã nộp, đã gắn tờ khai hay có ghi chú thì giữ nguyên. */
    try {
        const dangCo: any[] = await prisma.taxDeadline.findMany({
            select: {
                id: true, taxType: true, period: true, status: true,
                dueDate: true, filedAt: true, declarationId: true, notes: true,
            },
        })
        const cuaNam = dangCo.filter(d =>
            String(d.period || '').includes(String(year)) ||
            String(d.dueDate || '').startsWith(String(year)))
        const canXoa = mocCanDon(cuaNam, seeds)
        if (canXoa.length > 0) {
            await prisma.taxDeadline.deleteMany({ where: { id: { in: canXoa } } })
            console.log(`[Deadlines] dọn ${canXoa.length} mốc không còn đúng hồ sơ (kỳ kê khai ${hoSo.kyKeKhai}, loại hình ${hoSo.loaiHinh})`)
        }
    } catch { /* dọn dẹp là việc phụ, hỏng thì bỏ qua chứ không chặn luồng chính */ }

    return seeds
}

export interface KetQuaNhac {
    sapToiHan: Array<{ id: string; taxType: string; period: string; dueDate: string; conNgay: number; description: string }>
    vuaQuaHan: Array<{ id: string; taxType: string; period: string; dueDate: string; description: string }>
}

/**
 * Tìm mốc cần nhắc và mốc vừa quá hạn.
 *
 * Chỉ nhắc MỘT LẦN cho mỗi mốc (cột reminderSent có sẵn trong bảng từ lâu nhưng
 * chưa dòng nào dùng). Nhắc lại mỗi ngày thì đúng một tuần sau người dùng đã tắt
 * thông báo của cả ứng dụng.
 */
export function locMocCanNhac(
    dangCo: Array<{ id: string; taxType: string; period: string; dueDate: string; status: string; reminderSent?: boolean | null; description?: string | null }>,
    homNay: string,
    soNgayBaoTruoc = 7,
): KetQuaNhac {
    const cach = (d: string) => Math.round(
        (new Date(d + 'T00:00:00.000Z').getTime() - new Date(homNay + 'T00:00:00.000Z').getTime()) / 86400_000)

    const sapToiHan = dangCo
        .filter(d => d.status === 'pending' && !d.reminderSent)
        .map(d => ({ ...d, conNgay: cach(String(d.dueDate).slice(0, 10)) }))
        .filter(d => d.conNgay >= 0 && d.conNgay <= soNgayBaoTruoc)
        .map(d => ({
            id: d.id, taxType: d.taxType, period: d.period,
            dueDate: String(d.dueDate).slice(0, 10), conNgay: d.conNgay,
            description: d.description || d.taxType,
        }))
        .sort((a, b) => a.conNgay - b.conNgay)

    /* Vừa quá hạn = còn đang 'pending' mà ngày đã qua. Sau khi báo sẽ chuyển
     * trạng thái sang 'overdue' nên mỗi mốc chỉ báo quá hạn đúng một lần. */
    const vuaQuaHan = dangCo
        .filter(d => d.status === 'pending' && cach(String(d.dueDate).slice(0, 10)) < 0)
        .map(d => ({
            id: d.id, taxType: d.taxType, period: d.period,
            dueDate: String(d.dueDate).slice(0, 10),
            description: d.description || d.taxType,
        }))

    return { sapToiHan, vuaQuaHan }
}
