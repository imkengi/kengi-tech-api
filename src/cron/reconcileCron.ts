import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { doiChieuBaChieu } from '../lib/revenueReconcile'

/**
 * NHẮC ĐỐI CHIẾU BA CHIỀU SAU KHI CHỐT SỔ THÁNG — chạy ngày 05 hằng tháng, 09:00 VN.
 *
 * Vì sao ngày 05: tháng trước đã đóng, hoá đơn và sao kê phần lớn đã về, nhưng
 * vẫn còn xa hạn nộp tờ khai GTGT (ngày 20). Phát hiện lệch lúc này thì còn kịp
 * xuất bù hoá đơn hoặc điều chỉnh trước khi khai — phát hiện sau ngày 20 thì
 * phải khai bổ sung, phiền hơn nhiều.
 *
 * NGUYÊN TẮC IM LẶNG (quan trọng hơn nguyên tắc báo động):
 *  - Chỉ nhắc khi lệch VƯỢT NGƯỠNG cả về số tuyệt đối lẫn tỷ lệ. Cửa hàng nhỏ
 *    lệch 200k không đáng để đánh thức ai; cửa hàng lớn lệch 0,3% cũng vậy.
 *  - Chiều nào `duocKetLuan: false` thì bỏ qua hoàn toàn, không nhắc. Chưa nhập
 *    sao kê không phải là sai phạm, và một thông báo tháng nào cũng dội về việc
 *    "chưa giải trình được tiền vào" sẽ bị tắt ngay lần thứ hai.
 *  - Mỗi kỳ nhắc đúng MỘT lần, dựa vào chính bảng Notification để biết đã nhắc
 *    chưa — không thêm cột trạng thái mới cho một việc chạy mỗi tháng một lần.
 */

const RUN_DAY = 5               // ngày 05 hằng tháng
const RUN_HOUR_UTC = 2          // 09:00 giờ VN
const LOAI_TB = 'tax-reconcile'

/** Ngưỡng đáng nhắc: phải vượt CẢ HAI thì mới lên tiếng. */
const NGUONG_TIEN = 2_000_000
const NGUONG_TY_LE = 0.02       // 2% doanh thu kỳ

let timer: NodeJS.Timeout | null = null
let lastRunMonth = ''
let running = false

const tien = (n: number) => Math.round(n).toLocaleString('vi-VN') + 'đ'

/** Kỳ cần đối chiếu = tháng liền trước ngày `homNay` (chuỗi YYYY-MM-DD giờ VN). */
export function kyThangTruoc(homNay: string): { from: string; to: string; maKy: string; nhan: string } {
    const y = Number(homNay.slice(0, 4))
    const m = Number(homNay.slice(5, 7))
    const dau = new Date(Date.UTC(y, m - 2, 1))
    const cuoi = new Date(Date.UTC(y, m - 1, 0))
    const from = dau.toISOString().slice(0, 10)
    const to = cuoi.toISOString().slice(0, 10)
    return { from, to, maKy: from.slice(0, 7), nhan: `tháng ${dau.getUTCMonth() + 1}/${dau.getUTCFullYear()}` }
}

/**
 * Quyết định có nhắc hay không, và nhắc câu gì. Tách riêng khỏi phần chạm DB để
 * test được từng luật mà không cần dựng cả cron.
 */
export function dungLoiNhac(kq: any): { tieuDe: string; noiDung: string } | null {
    const dong: string[] = []
    const dt = Number(kq?.soSach?.tong) || 0
    const dangKe = (v: number) => v >= NGUONG_TIEN && (dt <= 0 || v / dt >= NGUONG_TY_LE)

    /* Cả hai chiều lệch sổ↔hoá đơn chỉ được xét khi CẢ HAI chiều đều đọc được.
     * Thiếu một bên thì phép trừ không có nghĩa. */
    const soSanhDuoc = kq?.soSach?.duocKetLuan && kq?.hoaDon?.duocKetLuan
    if (soSanhDuoc && dangKe(Number(kq.lech?.chuaXuatHoaDon) || 0)) {
        dong.push(`• Còn ${tien(kq.lech.chuaXuatHoaDon)} doanh thu chưa có hoá đơn (mới xuất ${kq.lech.tyLeXuatHoaDon}%).`)
    }
    if (soSanhDuoc && dangKe(Number(kq.lech?.hoaDonVuotSo) || 0)) {
        dong.push(`• Hoá đơn nhiều hơn sổ ${tien(kq.lech.hoaDonVuotSo)} — cần soát lại, chiều lệch này nặng hơn.`)
    }
    if (kq?.dongTien?.duocKetLuan && dangKe(Number(kq.dongTien?.chuaGiaiThich) || 0)) {
        dong.push(`• ${tien(kq.dongTien.chuaGiaiThich)} vào tài khoản chưa gắn được với doanh thu nào.`)
    }
    const soChi = kq?.chiTienMatLon?.danhSach?.length || 0
    const vatMat = Number(kq?.chiTienMatLon?.tongVatMat) || 0
    if (soChi > 0 && vatMat >= 500_000) {
        dong.push(`• ${soChi} khoản mua vào từ 5 triệu trả tiền mặt — mất khấu trừ ${tien(vatMat)} thuế GTGT.`)
    }

    if (dong.length === 0) return null

    return {
        tieuDe: `🔍 Đối chiếu ${kq.ky.nhan}: có ${dong.length} điểm cần xử lý`,
        noiDung:
            `Đã đối chiếu sổ bán hàng với hoá đơn đã phát hành và tiền vào tài khoản:\n` +
            dong.join('\n') +
            `\n\nSửa trước ngày 20 thì chỉ cần khai đúng; để sau hạn phải khai bổ sung. ` +
            `Mở Thuế → Thanh tra thuế → Đối chiếu ba chiều để xem lệch rơi vào ngày nào.`,
    }
}

export async function doiChieuChoStore(prisma: any, tenStore: string, homNay: string): Promise<boolean> {
    const ky = kyThangTruoc(homNay)

    /* Đã nhắc kỳ này rồi thì thôi — dùng chính Notification làm dấu, tránh thêm
     * một bảng trạng thái cho việc chạy mỗi tháng một lần. */
    const daNhac = await prisma.notification.findFirst({
        where: { type: LOAI_TB, message: { contains: ky.nhan } },
        select: { id: true },
    }).catch(() => null)
    if (daNhac) return false

    const kq = await doiChieuBaChieu(prisma, {
        from: ky.from,
        to: ky.to,
        start: new Date(`${ky.from}T00:00:00+07:00`),
        end: new Date(new Date(`${ky.to}T00:00:00+07:00`).getTime() + 86400_000),
        nhan: ky.nhan,
    })

    /* Không đọc được dữ liệu thì im hẳn. Gửi thông báo dựa trên số rỗng là buộc
     * tội oan, và người dùng sẽ tắt loại thông báo này vĩnh viễn. */
    if (kq.thieu.length > 0) {
        console.log(`🔍 [${tenStore}] bỏ qua đối chiếu ${ky.nhan}: chưa đọc được ${kq.thieu.length} bảng`)
        return false
    }

    const loi = dungLoiNhac(kq)
    if (!loi) return false

    await prisma.notification.create({
        data: { type: LOAI_TB, title: loi.tieuDe, message: loi.noiDung.slice(0, 1500) },
    }).catch(() => { /* store cũ chưa có bảng Notification — không chặn vòng chạy */ })

    console.log(`🔍 [${tenStore}] đã nhắc đối chiếu ${ky.nhan}`)
    return true
}

async function runDoiChieu(): Promise<void> {
    if (running) return
    running = true
    try {
        const homNay = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
        const stores = await registryPrisma.store.findMany({ where: { status: 'active' } as any }) as any[]
        // Tuần tự từng cửa hàng: mỗi lượt đối chiếu là vài truy vấn nặng, chạy
        // song song nhiều store sẽ đụng trần kết nối của cả cụm.
        for (const store of stores) {
            try {
                await doiChieuChoStore(getStorePrisma(store.schema), store.name, homNay)
            } catch (e: any) {
                console.error(`Đối chiếu ba chiều lỗi ở store ${store.name}:`, e?.message || e)
            }
        }
    } catch (e: any) {
        console.error('Đối chiếu ba chiều lỗi:', e?.message || e)
    } finally {
        running = false
    }
}

export function startReconcileCron(): void {
    if (timer) return
    console.log(`🔍 Reconcile cron started (ngày ${RUN_DAY} hằng tháng, ${RUN_HOUR_UTC}:00 UTC = 09:00 VN)`)
    timer = setInterval(() => {
        const vn = new Date(Date.now() + 7 * 3600 * 1000)
        const thang = vn.toISOString().slice(0, 7)
        if (lastRunMonth === thang) return
        if (vn.getUTCDate() < RUN_DAY) return
        if (new Date().getUTCHours() < RUN_HOUR_UTC) return
        lastRunMonth = thang
        runDoiChieu()
    }, 60 * 60 * 1000)
}

export function stopReconcileCron(): void {
    if (timer) { clearInterval(timer); timer = null }
}

/** Cho phép gọi tay (endpoint admin) khi cần chạy ngay. */
export const chayDoiChieuNgay = runDoiChieu
