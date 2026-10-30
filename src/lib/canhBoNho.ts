// ═══════════════════════════════════════════════════════════════════════════════
//  CANH BỘ NHỚ (27/10/2026) — để lần sau Cloud Run giết vì vượt 512 MiB thì log có
//  sẵn bằng chứng: RAM cgroup (con số Cloud Run dùng để giết), rss/heap/arrayBuffers
//  và các yêu cầu ĐANG CHẠY lúc đó (gom theo đường dẫn đã bỏ mã).
//
//  Vì sao cần: Cloud Monitoring lấy mẫu RAM mỗi phút ⇒ không thấy cú vọt vài giây;
//  dòng "Memory limit exceeded" chỉ kèm yêu cầu bị cắt — thường là /api/cron/tick vì
//  nó gần như lúc nào cũng đang chạy ⇒ dễ đổ oan. Lần 26–27/10 phải ghép log từng bản
//  máy bằng tay mới thấy thủ phạm là khối video (lib/khoiVideo.ts).
//  Lấy mẫu 2 giây/lần; cpu-throttling ⇒ lúc không có yêu cầu hẹn giờ đứng im, không tốn.
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'fs'

const MB = 1048576
const CACH_LOG_MS = 15_000

function docSo(duong: string): number | null {
    try {
        const n = Number(readFileSync(duong, 'utf8').trim())
        return Number.isFinite(n) ? n : null      // memory.max = "max" khi không đặt trần
    } catch { return null }
}
/* Cloud Run gen1 (gVisor) chỉ có cgroup v1 (/sys/fs/cgroup/memory/…), không có v2 (memory.max / memory.current) — đo
 * 30/10/2026: bản đầu chỉ đọc v2 ⇒ trần rơi về 512 cứng, mức dùng rơi về rss, dù dịch vụ đã 1Gi. Đọc v2 trước, v1 sau;
 * v1 không đặt trần thì trả số khổng lồ (~2^63) ⇒ coi như không biết. Không đọc được thì 1024 = trần đang cấu hình. */
const docTranMB = (): number => {
    const v2 = docSo('/sys/fs/cgroup/memory.max')
    const v1 = v2 ? null : docSo('/sys/fs/cgroup/memory/memory.limit_in_bytes')
    const n = v2 ?? v1
    return n && n < 64 * 1024 * MB ? Math.round(n / MB) : 1024
}
const TRAN_MB = docTranMB()
const docDungMB = (): number | null => {
    const n = docSo('/sys/fs/cgroup/memory.current') ?? docSo('/sys/fs/cgroup/memory/memory.usage_in_bytes')
    return n === null ? null : Math.round(n / MB)
}
// Ngưỡng cảnh báo = 84% trần (430MB khi trần 512, ~860MB khi trần 1Gi — nâng 30/10/2026); đặt cứng bằng CANH_BO_NHO_MB
const NGUONG_MB = Number(process.env.CANH_BO_NHO_MB) || Math.round(TRAN_MB * 0.84)

const dangChay = new Map<string, number>()

/** Đường dẫn bỏ mã: đoạn có chữ số hoặc dài (cuid, token webhook…) thành ':x' — không ghi khoá vào log. */
export function duongGon(method: string, duong: string): string {
    const doan = duong.split('/').map(d => (!d || /^[a-z][a-z-]{0,29}$/i.test(d)) ? d : ':x')
    return `${method} ${doan.join('/')}`
}

/** Đánh dấu một yêu cầu đang chạy; trả hàm gỡ (gắn vào res 'close'). Gọi gỡ hai lần vẫn đúng. */
export function batDauYeuCau(khoa: string): () => void {
    dangChay.set(khoa, (dangChay.get(khoa) || 0) + 1)
    let daGo = false
    return () => {
        if (daGo) return
        daGo = true
        const n = (dangChay.get(khoa) || 1) - 1
        if (n <= 0) dangChay.delete(khoa)
        else dangChay.set(khoa, n)
    }
}

export interface AnhBoNho {
    luc: string
    cgroupMB: number | null
    tranMB: number
    rssMB: number
    heapMB: number
    arrayBuffersMB: number
    dangChay: string
}

export function chupBoNho(): AnhBoNho {
    const m = process.memoryUsage()
    const cgMB = docDungMB()
    const ds = [...dangChay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, n]) => n > 1 ? `${k}×${n}` : k).join(', ')
    return {
        luc: new Date().toISOString(),
        cgroupMB: cgMB,
        tranMB: TRAN_MB,
        rssMB: Math.round(m.rss / MB),
        heapMB: Math.round(m.heapUsed / MB),
        arrayBuffersMB: Math.round(m.arrayBuffers / MB),
        dangChay: ds,
    }
}

const mucCua = (a: AnhBoNho) => a.cgroupMB ?? a.rssMB

let dinh: AnhBoNho | null = null
let logLuc = 0
function kiem(): void {
    const a = chupBoNho()
    if (!dinh || mucCua(a) > mucCua(dinh)) dinh = a
    if (mucCua(a) >= NGUONG_MB && Date.now() - logLuc >= CACH_LOG_MS) {
        logLuc = Date.now()
        console.warn(`[RAM] ${mucCua(a)}/${a.tranMB}MB — rss ${a.rssMB}, heap ${a.heapMB}, arrayBuffers ${a.arrayBuffersMB} · đang chạy: ${a.dangChay || '(không)'}`)
    }
}

/** Đỉnh RAM từ lúc bản máy khởi động + các yêu cầu đang chạy lúc đó (GET /admin/do-bo-nho). */
export function dinhBoNho(): AnhBoNho | null {
    return dinh
}

const hen = setInterval(kiem, 2000)
if (typeof hen.unref === 'function') hen.unref()
