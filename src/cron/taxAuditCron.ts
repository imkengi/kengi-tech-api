import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { kiemTraThue } from '../lib/taxAudit'

/**
 * SOÁT THUẾ TỰ ĐỘNG HẰNG THÁNG.
 *
 * Vì sao cần: trang "Sẵn Sàng Thanh Tra" chỉ soát khi có người mở ra xem. Mà
 * người hay mở nhất là lúc đã có giấy mời làm việc của cơ quan thuế — quá muộn
 * để sửa. Cron này chạy vào NGÀY 16 hằng tháng (sau hạn nộp tờ khai tháng trước
 * là ngày 20 chưa tới, còn kịp khai bổ sung mà không bị phạt chậm) để soát kỳ
 * tháng trước và ghi kết quả vào lịch sử tự rà soát.
 *
 * Ghi vào TaxAuditLog (action='self-audit-auto') — vừa là cảnh báo sớm, vừa là
 * bằng chứng doanh nghiệp có rà soát định kỳ (tình tiết giảm nhẹ khi bị phát
 * hiện sai sót).
 *
 * Nguyên tắc vận hành: chạy TUẦN TỰ từng cửa hàng và bọc try/catch riêng —
 * pool Prisma mỗi cửa hàng rất nhỏ, một cửa hàng lỗi không được kéo sập cả vòng.
 */

const RUN_DAY = 16          // ngày 16 hằng tháng
const RUN_HOUR_UTC = 1      // 08:00 giờ VN
let timer: NodeJS.Timeout | null = null
let lastRunMonth = ''       // YYYY-MM đã chạy — chống chạy lặp trong tháng
let running = false

/** Kỳ cần soát = THÁNG TRƯỚC tháng hiện tại */
function kyThangTruoc(now: Date): { year: number; month: number } {
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth() + 1   // 1-12
    return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 }
}

/**
 * Soát một cửa hàng. Nhận prisma từ ngoài thay vì tự lấy theo schema — nhờ vậy
 * kiểm chứng được bằng client giả, không phải dựng cả cơ sở dữ liệu.
 */
export async function soatChoStore(prisma: any, tenStore: string, year: number, month: number): Promise<void> {
    const p2 = (n: number) => String(n).padStart(2, '0')
    const cuoi = new Date(year, month, 0).getDate()
    const from = `${year}-${p2(month)}-01`
    const to = `${year}-${p2(month)}-${p2(cuoi)}`

    const h = await kiemTraThue(prisma, {
        from, to,
        maKy: `${year}-${p2(month)}`,
        nhan: `tháng ${month}/${year}`,
        start: new Date(`${from}T00:00:00.000Z`),
        end: new Date(new Date(`${to}T23:59:59.999Z`).getTime() + 7 * 3600 * 1000),
    })

    // Kỳ không phát sinh gì thì không ghi log — tránh làm loãng lịch sử rà soát
    if (h.doanhThu.so === 0 && h.canhBao.length === 0) return

    await prisma.taxAuditLog.create({
        data: {
            action: 'self-audit-auto',
            entityType: 'tax-audit',
            entityId: `${year}-${p2(month)}`,
            userName: 'Hệ thống (tự động)',
            changes: JSON.stringify({
                maKy: `${year}-${p2(month)}`,
                nhan: `tháng ${month}/${year}`,
                diem: h.diem,
                xepLoai: h.xepLoai,
                soCanhBao: h.canhBao.length,
                soNang: h.canhBao.filter(c => c.muc === 'cao').length,
                truyThu: h.uocTinhPhat.truyThu,
                tongUocTinh: h.uocTinhPhat.tong,
                ma: h.canhBao.map(c => c.code),
                doanhThuSo: h.doanhThu.so,
            }),
        },
    }).catch(() => { /* thiếu bảng TaxAuditLog — bỏ qua, không chặn vòng chạy */ })

    const nang = h.canhBao.filter(c => c.muc === 'cao').length
    if (nang > 0) {
        console.log(`⚖️  [${tenStore}] soát thuế tháng ${month}/${year}: ${h.diem}/100 — ${nang} dấu hiệu rủi ro cao, ước tính ${Math.round(h.uocTinhPhat.tong).toLocaleString('vi-VN')}đ`)
    }

    /* Ghi log thôi thì vẫn câm: người dùng chỉ biết khi tự mở trang, mà lúc họ
     * chịu mở thường là đã có giấy mời làm việc. Đẩy thông báo để họ thấy ngay
     * trên web và app — nhưng CHỈ khi có dấu hiệu nặng, kẻo tháng nào cũng kêu
     * thì thành tiếng ồn và bị bỏ qua đúng lúc cần nghe nhất. */
    if (nang === 0) return

    const han = `${month === 12 ? year + 1 : year}-${p2(month === 12 ? 1 : month + 1)}-20`
    const conNgay = Math.ceil((new Date(han + 'T00:00:00.000Z').getTime() - Date.now()) / 86400_000)
    const tien = Math.round(h.uocTinhPhat.tong)

    await prisma.notification.create({
        data: {
            type: 'tax-audit',
            title: `⚖️ Soát thuế tháng ${month}/${year}: ${nang} dấu hiệu rủi ro cao`,
            message:
                `Điểm sẵn sàng ${h.diem}/100 (${h.xepLoai}).` +
                (tien > 0 ? ` Ước tính phải nộp thêm ${tien.toLocaleString('vi-VN')}đ nếu bị phát hiện.` : '') +
                ` Vấn đề chính: ${h.canhBao.filter(c => c.muc === 'cao').slice(0, 3).map(c => c.tieuDe).join('; ')}.` +
                (conNgay > 0
                    ? ` Còn ${conNgay} ngày tới hạn nộp tờ khai — khai bổ sung trước hạn thì không bị phạt 20% khai sai.`
                    : ' Đã qua hạn nộp tờ khai kỳ này; tự khai bổ sung vẫn nhẹ hơn để cơ quan thuế phát hiện.'),
        },
    }).catch(() => { /* thiếu bảng Notification — không chặn vòng chạy */ })
}

async function runSoat(): Promise<void> {
    if (running) return
    running = true
    try {
        const { year, month } = kyThangTruoc(new Date())
        const stores = await registryPrisma.store.findMany({ where: { status: 'active' } as any }) as any[]
        for (const store of stores) {
            try {
                await soatChoStore(getStorePrisma(store.schema), store.name, year, month)
            } catch (e: any) {
                console.error(`Soát thuế tự động lỗi ở store ${store.name}:`, e?.message || e)
            }
        }
    } catch (e: any) {
        console.error('Soát thuế tự động lỗi:', e?.message || e)
    } finally {
        running = false
    }
}

export function startTaxAuditCron(): void {
    if (timer) return
    console.log(`⚖️  Tax audit cron started (ngày ${RUN_DAY} hằng tháng, ${RUN_HOUR_UTC}:00 UTC = 08:00 VN)`)
    // Tick 30 phút: tới ngày/giờ + chưa chạy tháng này → chạy. Instance restart
    // giữa chừng không sao vì ghi log là idempotent theo tháng (lastRunMonth).
    timer = setInterval(() => {
        const now = new Date()
        const thang = now.toISOString().slice(0, 7)
        if (lastRunMonth === thang) return
        if (now.getUTCDate() === RUN_DAY && now.getUTCHours() >= RUN_HOUR_UTC) {
            lastRunMonth = thang
            runSoat()
        }
    }, 30 * 60 * 1000)
}

export function stopTaxAuditCron(): void {
    if (timer) { clearInterval(timer); timer = null }
}

/** Cho phép gọi tay khi cần soát ngay (dùng trong endpoint admin/test) */
export const chaySoatThueNgay = runSoat
