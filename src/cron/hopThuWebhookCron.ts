/* Quét hộp thư webhook sàn mỗi phút: chạy lại push hỏng tới hạn, gỡ push kẹt khi máy
 * bị giết giữa chừng, dọn dòng cũ. Chỉ bản lãnh đạo chạy (nhặt dòng đã có
 * FOR UPDATE SKIP LOCKED nên lỡ hai bản cùng chạy cũng không xử lý trùng).
 * Xem services/hopThuWebhook.ts. */
import { chayNeuLanhDao } from '../lib/leaderLock'
import { quetHopThu } from '../services/hopThuWebhook'
import { moTaLoi } from '../lib/gomLoi'

const CHU_KY = 60_000
let timer: NodeJS.Timeout | null = null
let dangChay = false

async function luot(): Promise<void> {
    if (dangChay) return
    dangChay = true
    try {
        await chayNeuLanhDao('hop-thu-webhook', CHU_KY - 5_000, () => quetHopThu())
    } catch (e) {
        console.error(`[Hộp thư webhook] lượt quét hỏng: ${moTaLoi(e)}`)
    } finally {
        dangChay = false
    }
}

export function startHopThuWebhookCron(): void {
    if (timer) return
    const dau = setTimeout(luot, 20_000)
    if (typeof dau.unref === 'function') dau.unref()
    timer = setInterval(luot, CHU_KY)
    if (typeof timer.unref === 'function') timer.unref()
}

export function stopHopThuWebhookCron(): void {
    if (timer) clearInterval(timer)
    timer = null
}
