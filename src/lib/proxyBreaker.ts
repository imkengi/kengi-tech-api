/**
 * NGẮT MẠCH CHO PROXY CHUYỂN TIẾP (Tino)
 *
 * Mọi call Shopee và Lazada đều đi qua proxy trên kengi.vn để mượn IP tĩnh đã
 * whitelist. Khi proxy không kết nối được (01/08/2026: Cloud Run bị chặn ở tầng
 * TCP, `ConnectTimeoutError ... kengi.vn:443`), mỗi lệnh gọi vẫn thử đủ 3 lần,
 * mỗi lần chờ tới 10s trước khi undici bỏ cuộc. Một lượt đồng bộ vài trăm đơn
 * biến thành hàng nghìn kết nối chết:
 *
 *   - đốt sạch ngân sách 300s của Cloud Run → 504, không việc gì xong
 *   - và tệ hơn: hosting dùng chung thường TỰ BAN khi thấy dồn dập, nên chính
 *     việc thử lại liên tục có thể kéo dài thời gian bị chặn
 *
 * Ngắt mạch: sau N lần hỏng liên tiếp thì nghỉ COOLDOWN, trong lúc nghỉ mọi lệnh
 * gọi trả lỗi NGAY kèm lý do rõ ràng, thay vì mỗi cái treo 30s. Có một lần thành
 * công là đóng lại ngay.
 *
 * Trạng thái nằm trong tiến trình (không dùng Redis) — cố ý: mỗi instance Cloud
 * Run tự quan sát đường mạng của chính nó, và mất trạng thái khi khởi động lại
 * chỉ nghĩa là thử lại sớm hơn, không gây hại.
 */

const FAIL_THRESHOLD = 5          // số lần hỏng liên tiếp thì mở mạch
const COOLDOWN_MS = 2 * 60_000    // nghỉ 2 phút rồi cho thử lại

let consecutiveFailures = 0
let openedAt = 0

/** Mạch đang mở (đang nghỉ) → chưa nên gọi proxy. */
export function proxyCircuitOpen(): boolean {
    if (openedAt === 0) return false
    if (Date.now() - openedAt > COOLDOWN_MS) {
        // Hết giờ nghỉ: cho MỘT lượt đi thử. Hỏng nữa thì mở lại ngay vì
        // consecutiveFailures vẫn đang ở ngưỡng.
        openedAt = 0
        return false
    }
    return true
}

/** Đầu câu lỗi ngắt mạch — bên xử lý hay bọc lỗi lại thành chuỗi mới (mất cờ), nên nhận diện cả theo chữ. */
const DAU_NGAT_MACH = 'Proxy chuyển tiếp đang mất kết nối'

/** `chuaGui: true` — ngắt mạch chặn TRƯỚC khi gửi: lệnh ghi chắc chắn chưa tới sàn (khác lỗi mạng giữa chừng = không rõ, X-22).
 *  `ngatMachProxy: true` — để hộp thư webhook biết đây là "chưa gửi được", không phải "gửi rồi hỏng". */
export function proxyCircuitError(): Error {
    const conLai = Math.max(0, COOLDOWN_MS - (Date.now() - openedAt))
    return Object.assign(new Error(
        `${DAU_NGAT_MACH} (${consecutiveFailures} lần hỏng liên tiếp) — ` +
        `tạm dừng gọi ${Math.ceil(conLai / 1000)}s nữa. Kiểm tra firewall/IP whitelist ở hosting Tino.`
    ), { chuaGui: true, ngatMachProxy: true })
}

/** Lỗi do ngắt mạch chặn (lệnh CHƯA gửi tới proxy) — kể cả khi bị bọc thành chuỗi khác ở tầng trên. */
export function laLoiNgatMachProxy(e: any): boolean {
    if (!e) return false
    if (e.ngatMachProxy === true) return true
    return String(e.message ?? e).includes(DAU_NGAT_MACH)
}

export function noteProxySuccess(): void {
    if (consecutiveFailures > 0) {
        console.log(`[Proxy] kết nối lại được sau ${consecutiveFailures} lần hỏng — đóng ngắt mạch`)
    }
    consecutiveFailures = 0
    openedAt = 0
}

export function noteProxyFailure(): void {
    consecutiveFailures++
    if (consecutiveFailures >= FAIL_THRESHOLD && openedAt === 0) {
        openedAt = Date.now()
        console.error(
            `[Proxy] MỞ NGẮT MẠCH sau ${consecutiveFailures} lần hỏng liên tiếp — ` +
            `nghỉ ${COOLDOWN_MS / 1000}s. Gọi tiếp lúc này chỉ đốt thời gian và có thể kéo dài thời gian bị chặn.`
        )
    }
}

/* ─── HÀNG CHỜ GỌI PROXY (17/11/2026) ─────────────────────────────────────────
 *
 * 16/11/2026 13:43:45 Shopee dồn ~140 push trong 5 giây vào MỘT bản Cloud Run; mỗi push gọi ngược
 * Shopee qua proxy NGAY ⇒ cả trăm kết nối cùng lúc từ một IP tới hosting dùng chung Tino. Một phút
 * sau bản đó "fetch failed" liền 770 lần tới 19:42, trong khi bản khác vẫn gọi được (15:18, 15:50)
 * ⇒ tường lửa Tino chặn RIÊNG IP đó ~6 giờ: 804 push bỏ cuộc, flash sale tự xếp hỏng, đồng bộ đơn
 * đứng (AutoSync kéo bù lúc 20:16). Ngày 01/08 cũng từng bị chặn ở tầng TCP như vậy.
 *
 * Nay mỗi bản chỉ cho tối đa PROXY_DONG_THOI_TOI_DA (mặc định 6) lời gọi proxy cùng lúc; phần còn
 * lại XẾP HÀNG theo thứ tự tới (chỗ trống trao thẳng cho người đợi lâu nhất). Một đợt 140 push vẫn
 * được nhận đủ (hộp thư ghi trước khi gọi), chỉ phần gọi ngược Shopee giãn ra vài chục giây.
 *  - Hẹn giờ của từng lời gọi tính từ lúc CÓ CHỖ — chờ hàng không ăn vào hạn 30s (bên gọi lo).
 *  - Bên gọi đọc HẾT thân phản hồi trong `viec` — kết nối chỉ rảnh khi thân đã về.
 *  - Có chỗ rồi mới xét lại ngắt mạch: mạch mở trong lúc chờ ⇒ hỏng NGAY (lệnh chưa gửi), khỏi để
 *    cả hàng lần lượt đâm vào một proxy đang chết.
 * Trạng thái trong tiến trình như ngắt mạch: mỗi bản tự giữ hàng của mình. */
const MAC_DINH_DONG_THOI = 6
const toiDaDongThoi = () => Math.max(1, parseInt(process.env.PROXY_DONG_THOI_TOI_DA || '', 10) || MAC_DINH_DONG_THOI)
let dangGoi = 0
const hangCho: Array<() => void> = []
let daGoi = 0
let daPhaiCho = 0
let choLauNhatMs = 0
let lanBaoHangCho = 0

/** Chạy một lời gọi proxy khi tới lượt. `viec` phải gồm cả việc đọc hết thân phản hồi. */
export async function goiQuaProxy<T>(viec: () => Promise<T>): Promise<T> {
    if (dangGoi < toiDaDongThoi()) {
        dangGoi++
    } else {
        const tu = Date.now()
        daPhaiCho++
        await new Promise<void>(r => {
            hangCho.push(r)
            if (hangCho.length >= 20 && tu - lanBaoHangCho > 60_000) {
                lanBaoHangCho = tu
                console.warn(`[Proxy] hàng chờ ${hangCho.length} lời gọi (đang gọi ${dangGoi}/${toiDaDongThoi()}) — đợt dồn, gọi Tino từ từ cho khỏi bị chặn`)
            }
        })
        choLauNhatMs = Math.max(choLauNhatMs, Date.now() - tu)
        // Được trao chỗ: người trả chỗ giữ nguyên dangGoi cho mình (xem finally).
    }
    try {
        if (proxyCircuitOpen()) throw proxyCircuitError()
        daGoi++
        return await viec()
    } finally {
        const keTiep = dangGoi <= toiDaDongThoi() ? hangCho.shift() : undefined
        if (keTiep) keTiep()
        else dangGoi--
    }
}

/** Đọc HẾT thân rồi dựng lại Response y hệt (byte nguyên vẹn, giữ status/headers) — để kết nối tới Tino
 *  rảnh ngay trong lúc còn giữ chỗ, và hẹn giờ của lời gọi phủ cả phần thân. */
export async function docHetPhanHoi(res: Response): Promise<Response> {
    const than = await res.arrayBuffer()
    const khongThan = res.status === 204 || res.status === 205 || res.status === 304
    return new Response(khongThan ? null : than, { status: res.status, statusText: res.statusText, headers: res.headers })
}

export function thongKeHangChoProxy() {
    return { toiDa: toiDaDongThoi(), dangGoi, dangCho: hangCho.length, daGoi, daPhaiCho, choLauNhatMs }
}
