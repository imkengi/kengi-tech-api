/**
 * NHẮC HẠN THANH TOÁN NHÀ CUNG CẤP — đẩy thông báo TRƯỚC 3 NGÀY, nhắc lại mỗi ngày
 * cho tới khi trả đủ hoặc có phiếu giảm trừ công nợ. (2026-08-21, chủ shop đặt)
 *
 * VÌ SAO CẦN CRON RIÊNG: `GET /notifications` ĐÃ dựng sẵn danh sách phiếu tới hạn (cũng mốc
 * 3 ngày), nhưng nó tính **tại chỗ khi mở app** — tức chỉ thấy khi người ta chủ động vào xem.
 * Đúng bệnh của cả tháng này: cảnh báo không tới được mắt người thì bằng không có. Cron này
 * lo phần ĐẨY RA (FCM + một dòng tổng kết trong chuông).
 *
 * ĐIỀU KIỆN DỪNG (chủ shop nêu): "cho đến khi có phiếu thu giảm trừ công nợ hoặc thanh toán đủ".
 * Cả hai đều quy về **còn nợ ≤ 0** hoặc `paymentStatus = 'paid'` — không cần cờ riêng, và cũng
 * KHÔNG được thêm cờ riêng: cờ nào cũng có ngày lệch khỏi số tiền thật.
 *
 * BỐN NGUYÊN TẮC:
 *  1. **MỘT LẦN MỖI NGÀY.** Nhắc mỗi lượt cron (5–10 phút) thì hai hôm là người ta tắt thông báo,
 *     và hôm quá hạn thật cũng tắt cùng. Dùng chính Notification làm dấu đã gửi — cùng cách
 *     `weeklyBriefCron` làm, khỏi đẻ bảng trạng thái cho việc chạy mỗi ngày một lần.
 *  2. **ĐỌC HỎNG ≠ KHÔNG CÓ GÌ TỚI HẠN.** Cửa hàng nào lỗi thì ghi log và đi tiếp, KHÔNG im lặng
 *     coi như sạch — im lặng ở đây nghĩa là nợ tới hạn mà không ai được báo.
 *  3. **Cắt ngày theo GIỜ VIỆT NAM.** Cloud Run chạy UTC; lấy giờ máy chủ thì mốc "hôm nay" rơi
 *     vào 07:00 VN, phiếu đến hạn hôm nay bị gọi là quá hạn.
 *  4. **Loại `type` phải là loại giao diện HIỆN.** `payment_due` nằm trong `LOAI_HIEN` và cả hai
 *     màn hình đều nhận. Đặt loại lạ là thông báo rơi vào hư không (xem `check:thongbaolac`).
 *
 * ⛔ PROD `PRISMA_POOL_SIZE=1` — duyệt cửa hàng TUẦN TỰ, không `Promise.all`.
 */
import { registryPrisma, getStorePrisma, giuClient } from '../lib/prisma'
import { chayNeuLanhDao } from '../lib/leaderLock'
import { moTaLoi } from '../lib/gomLoi'

/** Báo trước bao nhiêu ngày. Chủ shop chốt 3. */
const BAO_TRUOC_NGAY = 3
/** 01:00 UTC = 08:00 giờ VN — đầu giờ làm việc, không phiền lúc nửa đêm. */
const GIO_CHAY_UTC = 1
const PHUT_CHAY = 0

const VN_MS = 7 * 3600_000

/** Ngày theo giờ VN, dạng YYYY-MM-DD — dùng làm dấu "đã nhắc hôm nay". */
function ngayVN(d: Date = new Date()): string {
    return new Date(d.getTime() + VN_MS).toISOString().slice(0, 10)
}

/** Mốc 00:00 giờ VN của hôm nay, trả về đúng thời điểm UTC tương ứng. */
function dauNgayVN(d: Date = new Date()): Date {
    const v = new Date(d.getTime() + VN_MS)
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()) - VN_MS)
}

const tien = (n: number) => Math.round(n).toLocaleString('vi-VN') + 'đ'

export interface KetQuaNhac {
    store: string
    quaHan: number
    sapToiHan: number
    tongConNo: number
    daGui: boolean
    pushGui: number
    lyDoBoQua?: string
}

/** Nhắc cho MỘT cửa hàng. Trả về kết quả để nơi gọi ghi log — không tự nuốt. */
export async function nhacHanChoStore(sp: any, storeCode: string): Promise<KetQuaNhac> {
    const kq: KetQuaNhac = { store: storeCode, quaHan: 0, sapToiHan: 0, tongConNo: 0, daGui: false, pushGui: 0 }

    const homNay = dauNgayVN()
    const han = new Date(homNay.getTime() + BAO_TRUOC_NGAY * 86400_000 + 86399_999)
    const dauNgay = ngayVN()

    /* ĐÃ NHẮC HÔM NAY CHƯA — dùng chính Notification làm dấu.
     * Tra theo type + chuỗi ngày nhúng trong message; các thông báo payment_due khác không
     * mang chuỗi `[nhac:YYYY-MM-DD]` nên không khớp nhầm. */
    const daNhac = await sp.notification.findFirst({
        where: { type: 'payment_due', message: { contains: `[nhac:${dauNgay}]` } },
        select: { id: true },
    }).catch(() => null)
    if (daNhac) { kq.lyDoBoQua = 'đã nhắc hôm nay'; return kq }

    const phieu: any[] = await sp.importReceipt.findMany({
        where: {
            dueDate: { not: null, lte: han },
            paymentStatus: { not: 'paid' },
            status: { not: 'cancelled' },
        },
        select: {
            id: true, code: true, supplierName: true,
            totalCost: true, paidAmount: true, dueDate: true,
        },
        orderBy: { dueDate: 'asc' },
        take: 300,
    })

    /* CÒN NỢ ≤ 0 ⇒ BỎ QUA. Đây là chỗ "phiếu thu giảm trừ công nợ" tự động có tác dụng:
     * giảm trừ làm `paidAmount` tăng lên bằng `totalCost`, phiếu rụng khỏi danh sách này
     * mà không cần ai tắt nhắc thủ công. */
    const conNo = phieu
        .map(r => ({ ...r, conLai: Math.max(0, (r.totalCost || 0) - (r.paidAmount || 0)) }))
        .filter(r => r.conLai > 0)

    if (!conNo.length) { kq.lyDoBoQua = 'không phiếu nào tới hạn'; return kq }

    for (const r of conNo) {
        if (r.dueDate && new Date(r.dueDate) < homNay) kq.quaHan++
        else kq.sapToiHan++
        kq.tongConNo += r.conLai
    }

    const nang = conNo.slice(0, 3).map(r =>
        `${r.code}${r.supplierName ? ' — ' + r.supplierName : ''}: ${tien(r.conLai)}`).join(' · ')

    const tieuDe = kq.quaHan
        ? `⚠️ ${kq.quaHan} phiếu QUÁ HẠN thanh toán NCC`
        : `💰 ${kq.sapToiHan} phiếu tới hạn thanh toán trong ${BAO_TRUOC_NGAY} ngày`
    const noiDung =
        (kq.quaHan ? `${kq.quaHan} phiếu quá hạn` : '')
        + (kq.quaHan && kq.sapToiHan ? ', ' : '')
        + (kq.sapToiHan ? `${kq.sapToiHan} phiếu tới hạn trong ${BAO_TRUOC_NGAY} ngày` : '')
        + `. Tổng còn nợ ${tien(kq.tongConNo)}.`
        + (nang ? ` Lớn nhất: ${nang}.` : '')

    // Dấu ngày để không nhắc lại trong cùng ngày. Nhắc lại NGÀY MAI nếu vẫn chưa trả — đúng
    // yêu cầu "lặp lại cho đến khi thanh toán đủ".
    await sp.notification.create({
        data: { type: 'payment_due', title: tieuDe, message: `${noiDung} [nhac:${dauNgay}]` },
    })
    kq.daGui = true

    // Đẩy ra ngoài — phần mà bản cũ thiếu. Push hỏng KHÔNG được làm hỏng lượt nhắc.
    try {
        const { sendPushToStore } = await import('../routes/notifications')
        kq.pushGui = await sendPushToStore(sp, tieuDe, noiDung.slice(0, 300))
    } catch (e: any) {
        console.warn(`[HanThanhToan] ${storeCode}: push hỏng — ${moTaLoi(e)} (thông báo trong app vẫn có)`)
    }

    return kq
}

export async function runHanThanhToan(): Promise<void> {
    let stores: any[] = []
    try {
        stores = await registryPrisma.store.findMany({
            where: { status: 'active' }, select: { code: true, schema: true },
        }) as any[]
    } catch (e: any) {
        console.error('[HanThanhToan] không đọc được danh sách cửa hàng:', moTaLoi(e))
        return                                    // KHÔNG coi là "không cửa hàng nào tới hạn"
    }

    for (const store of stores) {
        const nhaClient = giuClient(store.schema)   // xem giuClient() ở lib/prisma.ts
        try {
            const sp = getStorePrisma(store.schema) as any
            const kq = await nhacHanChoStore(sp, store.code)
            if (kq.daGui) {
                console.log(`[HanThanhToan] ${store.code}: quá hạn ${kq.quaHan}, tới hạn ${kq.sapToiHan}, `
                    + `còn nợ ${tien(kq.tongConNo)} — đã đẩy ${kq.pushGui} thiết bị`)
            } else if (kq.lyDoBoQua && kq.lyDoBoQua !== 'không phiếu nào tới hạn') {
                console.log(`[HanThanhToan] ${store.code}: ${kq.lyDoBoQua}`)
            }
        } catch (e: any) {
            // Cửa hàng lỗi thì đi tiếp — nhưng PHẢI ghi ra, im lặng ở đây = nợ tới hạn không ai báo
            console.error(`[HanThanhToan] ${store.code}: ${moTaLoi(e)}`)
        } finally {
            nhaClient()
        }
    }
}

let timer: NodeJS.Timeout | null = null

export function startHanThanhToanCron(): void {
    if (timer) return
    console.log(`💰 Nhắc hạn thanh toán NCC: mỗi ngày ${GIO_CHAY_UTC}:${String(PHUT_CHAY).padStart(2, '0')} UTC `
        + `(= ${GIO_CHAY_UTC + 7}:00 giờ VN), báo trước ${BAO_TRUOC_NGAY} ngày`)

    /* Dò mỗi 10 phút thay vì hẹn đúng một mốc: Cloud Run thay máy bất cứ lúc nào, hẹn cứng
     * một mốc thì lượt rơi vào lúc container vừa chết là mất luôn ngày đó. Dấu ngày trong
     * Notification lo phần không nhắc trùng. */
    const dò = () => {
        const gioVN = new Date(Date.now() + VN_MS)
        const h = gioVN.getUTCHours()
        if (h < GIO_CHAY_UTC + 7) return              // chưa tới giờ VN
        chayNeuLanhDao('han-thanh-toan', 30 * 60_000, runHanThanhToan)
            .catch(e => console.error('[HanThanhToan]', e?.message || e))
    }
    setTimeout(dò, 3 * 60_000)                        // chờ máy khởi động xong
    timer = setInterval(dò, 10 * 60_000)
}

export function stopHanThanhToanCron(): void {
    if (timer) { clearInterval(timer); timer = null }
}
