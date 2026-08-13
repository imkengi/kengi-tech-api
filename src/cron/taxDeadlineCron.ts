import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { suyHoSoThue, gieoLichNghiaVu, locMocCanNhac } from '../lib/taxCalendarStore'

/**
 * NHẮC HẠN NỘP THUẾ — chạy hằng ngày 08:00 giờ VN.
 *
 * Vì sao cần: bảng TaxDeadline có sẵn cột `reminderSent` từ lâu nhưng chưa dòng
 * code nào dùng — tính năng nhắc được thiết kế rồi bỏ dở. Lịch chỉ được gieo khi
 * có người mở trang thuế, nên cửa hàng không mở trang thì không có lịch, không
 * có nhắc, và biết mình trễ hạn khi nhận thông báo phạt.
 *
 * Cron này gieo lịch (dùng CHUNG hàm với route, không tự suy kiểu khác) rồi:
 *  - nhắc mốc sắp tới hạn trong 7 ngày, mỗi mốc đúng MỘT lần;
 *  - báo mốc vừa quá hạn đúng một lần rồi chuyển trạng thái sang 'overdue'.
 *
 * Gộp tất cả vào MỘT thông báo mỗi cửa hàng mỗi lần chạy. Bắn mỗi mốc một thông
 * báo thì đầu tháng có ngày dội 5-6 cái, và người dùng sẽ tắt thông báo của cả
 * ứng dụng — mất luôn những cảnh báo quan trọng khác.
 */

const RUN_HOUR_UTC = 1          // 08:00 giờ VN
const SO_NGAY_BAO_TRUOC = 7
let timer: NodeJS.Timeout | null = null
let lastRunDay = ''             // YYYY-MM-DD đã chạy — chống chạy lặp trong ngày
let running = false

const nhanLoai: Record<string, string> = {
    '01_GTGT': 'Tờ khai GTGT', '01_GTGT_Q': 'Tờ khai GTGT', '01_CNKD': 'Tờ khai hộ kinh doanh',
    '05_KK_TNCN': 'Tờ khai TNCN', '06_TNCN': 'Tờ khai TNCN', '05_QTT_TNCN': 'Quyết toán TNCN',
    'TNDN_TAM_NOP': 'Tạm nộp TNDN', '03_TNDN': 'Quyết toán TNDN',
    'MON_BAI': 'Lệ phí môn bài', 'BCTC': 'Báo cáo tài chính',
}
const ten = (t: string) => nhanLoai[t] || t

export async function nhacChoStore(prisma: any, tenStore: string, homNay: string): Promise<number> {
    const year = Number(homNay.slice(0, 4))

    // Gieo lịch trước khi nhắc — cửa hàng chưa mở trang thuế thì bảng còn rỗng
    const hoSo = await suyHoSoThue(prisma, year)
    await gieoLichNghiaVu(prisma, year, hoSo)

    const dangCo: any[] = await prisma.taxDeadline.findMany({
        select: {
            id: true, taxType: true, period: true, dueDate: true,
            status: true, reminderSent: true, description: true,
        },
    })

    const { sapToiHan, vuaQuaHan } = locMocCanNhac(dangCo, homNay, SO_NGAY_BAO_TRUOC)
    if (sapToiHan.length === 0 && vuaQuaHan.length === 0) return 0

    const dong: string[] = []
    for (const m of vuaQuaHan) {
        dong.push(`⚠️ QUÁ HẠN: ${ten(m.taxType)} ${m.period} (hạn ${m.dueDate})`)
    }
    for (const m of sapToiHan) {
        dong.push(m.conNgay === 0
            ? `🔴 HÔM NAY là hạn: ${ten(m.taxType)} ${m.period}`
            : `• Còn ${m.conNgay} ngày: ${ten(m.taxType)} ${m.period} (hạn ${m.dueDate})`)
    }

    const tieuDe = vuaQuaHan.length > 0
        ? `⚠️ ${vuaQuaHan.length} nghĩa vụ thuế ĐÃ QUÁ HẠN`
        : sapToiHan.some(m => m.conNgay <= 1)
            ? `🔴 Hạn nộp thuế đến hôm nay/ngày mai`
            : `📅 ${sapToiHan.length} hạn nộp thuế trong ${SO_NGAY_BAO_TRUOC} ngày tới`

    await prisma.notification.create({
        data: {
            type: 'tax-deadline',
            title: tieuDe,
            message: dong.join('\n').slice(0, 900) +
                (vuaQuaHan.length > 0
                    ? '\nNộp muộn bị phạt hành chính và tính tiền chậm nộp 0,03%/ngày (Điều 59 Luật Quản lý thuế).'
                    : ''),
        },
    }).catch(() => { /* thiếu bảng Notification ở store cũ — không chặn vòng chạy */ })

    // Đánh dấu đã nhắc để không lặp lại mỗi ngày
    if (sapToiHan.length > 0) {
        await prisma.taxDeadline.updateMany({
            where: { id: { in: sapToiHan.map(m => m.id) } },
            data: { reminderSent: true },
        }).catch(() => { })
    }
    // Chuyển trạng thái để mỗi mốc chỉ báo quá hạn đúng một lần
    if (vuaQuaHan.length > 0) {
        await prisma.taxDeadline.updateMany({
            where: { id: { in: vuaQuaHan.map(m => m.id) } },
            data: { status: 'overdue' },
        }).catch(() => { })
    }

    console.log(`📅 [${tenStore}] nhắc hạn nộp: ${sapToiHan.length} sắp tới, ${vuaQuaHan.length} quá hạn`)
    return sapToiHan.length + vuaQuaHan.length
}

async function runNhac(): Promise<void> {
    if (running) return
    running = true
    try {
        // Hôm nay theo giờ VN — máy chủ chạy UTC, lệch múi là nhắc sai ngày
        const homNay = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
        const stores = await registryPrisma.store.findMany({ where: { status: 'active' } as any }) as any[]
        for (const store of stores) {
            try {
                await nhacChoStore(getStorePrisma(store.schema), store.name, homNay)
            } catch (e: any) {
                console.error(`Nhắc hạn nộp thuế lỗi ở store ${store.name}:`, e?.message || e)
            }
        }
    } catch (e: any) {
        console.error('Nhắc hạn nộp thuế lỗi:', e?.message || e)
    } finally {
        running = false
    }
}

export function startTaxDeadlineCron(): void {
    if (timer) return
    console.log(`📅 Tax deadline cron started (hằng ngày ${RUN_HOUR_UTC}:00 UTC = 08:00 VN)`)
    timer = setInterval(() => {
        const now = new Date()
        const ngay = now.toISOString().slice(0, 10)
        if (lastRunDay === ngay) return
        if (now.getUTCHours() >= RUN_HOUR_UTC) {
            lastRunDay = ngay
            runNhac()
        }
    }, 30 * 60 * 1000)
}

export function stopTaxDeadlineCron(): void {
    if (timer) { clearInterval(timer); timer = null }
}

/** Cho phép gọi tay khi cần nhắc ngay (endpoint admin/test) */
export const chayNhacHanNopNgay = runNhac
