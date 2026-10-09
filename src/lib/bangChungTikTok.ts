// ─────────────────────────────────────────────────────────────────────────────
//  TIKTOK: 24 GIỜ XÁC NHẬN "ĐÃ ĐỦ BẰNG CHỨNG" SAU KHI KHIẾU NẠI (09/10/2026)
//
//  Chủ shop: "với tiktok thì sau khi khiếu nại thì trong vòng 24 giờ nó bắt xác nhận đã đủ bằng
//  chứng thì cứ 1 tiếng spam vào check 1 lần cho đến khi ấn nút ok".
//
//  ĐO 09/10 (GET /admin/do-vu-tiktok-da-khieu-nai, KENGISTORE): shop khiếu nại TikTok ngay trên
//  Seller Center (không qua app); khi khách đưa vụ lên sàn, TikTok trả `arbitration_status:
//  IN_PROGRESS` (sự kiện BUYER_SUBMIT_ARBITRATION_AFTER_SELLER_REJECT_APPLICATION) rồi SUPPORT_BUYER /
//  …; `seller_next_action_response` TRỐNG — API KHÔNG báo bước "xác nhận đủ bằng chứng". Nên mốc
//  24 giờ lấy từ hai nơi hệ thống tự biết:
//    · "[Từ chối TikTok] <giờ VN> — …"           — shop khiếu nại qua app (onlineOrders)
//    · "[Tranh chấp TikTok] IN_PROGRESS … — từ <giờ>" — returnSync ghi khi TikTok chuyển vụ sang
//      tranh chấp, mốc = update_time của vụ (đúng lúc khách đưa lên sàn, không phải lúc mình thấy)
//  Hết nhắc khi: "[Đã xác nhận bằng chứng TikTok]" (nút OK trong Kengi) sau mốc, sàn đã phân xử
//  (tranh chấp khác IN_PROGRESS / vụ COMPLETE·SUCCESS·CANCEL), hoặc quá 24 giờ.
//
//  THUẦN — không DB — để Việc cần làm, cron nhắc và route OK dùng chung MỘT luật.
//  Bản sao web: ChiTietVuTra.tsx (mocBangChungTikTok) — sửa một bên nhớ sửa bên kia.
// ─────────────────────────────────────────────────────────────────────────────

export const DAU_TU_CHOI_TT = '[Từ chối TikTok]'
export const DAU_TRANH_CHAP_TT = '[Tranh chấp TikTok]'
export const DAU_XAC_NHAN_BC_TT = '[Đã xác nhận bằng chứng TikTok]'
export const HAN_XAC_NHAN_MS = 24 * 3600_000

const NHAN_TRANH_CHAP: Record<string, string> = {
    IN_PROGRESS: 'sàn đang phân xử — xác nhận đủ bằng chứng trong 24 giờ',
    SUPPORT_BUYER: 'sàn xử cho khách',
    SUPPORT_SELLER: 'sàn xử cho shop',
}

/** Giờ Việt Nam ngắn: "19:35 06/10/2026". */
export const gioVN = (d: Date) => d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric',
})

/** Đọc giờ VN trong dòng ghi chú: "21:32:47 9/10/2026" (toLocaleString mặc định) hoặc "19:35 06/10/2026". */
export function docGioVN(s: string): Date | null {
    const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
    if (!m) return null
    const [, hh, mi, ss, d, mo, y] = m
    const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh) - 7, Number(mi), Number(ss || 0))
    return isNaN(t) ? null : new Date(t)
}

/** Dòng returnSync ghi khi arbitration_status đổi. Mã đứng ngay sau dấu để đọc lại được. */
export function dongTranhChap(trangThai: string, tu: Date): string {
    const nhan = NHAN_TRANH_CHAP[trangThai]
    return `${DAU_TRANH_CHAP_TT} ${trangThai}${nhan ? ` (${nhan})` : ''} — từ ${gioVN(tu)}`
}

/** Trạng thái tranh chấp CUỐI đã ghi (để chỉ ghi khi đổi). */
export function tranhChapCuoi(notes?: string | null): string | null {
    const d = String(notes || '').split(/\r?\n/).map(x => x.trim()).filter(x => x.startsWith(DAU_TRANH_CHAP_TT)).pop()
    if (!d) return null
    return (/^\S+/.exec(d.slice(DAU_TRANH_CHAP_TT.length).trim()) || [])[0] || null
}

export interface MocXacNhan {
    batDau: Date
    hetHan: Date
    nguon: 'khieu-nai-app' | 'tranh-chap'
    /** đã bấm OK sau mốc này */
    daXacNhan: boolean
    /** sàn đã phân xử / vụ đã đóng sau mốc này */
    daKetThuc: boolean
}

/** Mốc 24 giờ GẦN NHẤT của vụ + tình trạng sau mốc. null = chưa từng khiếu nại / tranh chấp. */
export function mocXacNhanBangChung(notes?: string | null): MocXacNhan | null {
    const dong = String(notes || '').split(/\r?\n/).map(x => x.trim())
    let viTri = -1
    let batDau: Date | null = null
    let nguon: MocXacNhan['nguon'] = 'khieu-nai-app'
    for (let i = 0; i < dong.length; i++) {
        const d = dong[i]!
        if (d.startsWith(DAU_TU_CHOI_TT)) {
            const t = docGioVN(d.slice(DAU_TU_CHOI_TT.length))
            if (t) { viTri = i; batDau = t; nguon = 'khieu-nai-app' }
        } else if (d.startsWith(DAU_TRANH_CHAP_TT) && /^\s*IN_PROGRESS\b/.test(d.slice(DAU_TRANH_CHAP_TT.length))) {
            const t = docGioVN(d.split(' — từ ').pop() || '')
            if (t) { viTri = i; batDau = t; nguon = 'tranh-chap' }
        }
    }
    if (!batDau || viTri < 0) return null
    let daXacNhan = false, daKetThuc = false
    for (const d of dong.slice(viTri + 1)) {
        if (d.startsWith(DAU_XAC_NHAN_BC_TT)) daXacNhan = true
        else if (d.startsWith(DAU_TRANH_CHAP_TT) && !/^\s*IN_PROGRESS\b/.test(d.slice(DAU_TRANH_CHAP_TT.length))) daKetThuc = true
        else if (/^\[TikTok\]\s*(?:Status:\s*)?\S*(COMPLETE|SUCCESS|CANCEL)/.test(d)) daKetThuc = true
    }
    return { batDau, hetHan: new Date(batDau.getTime() + HAN_XAC_NHAN_MS), nguon, daXacNhan, daKetThuc }
}

/** Đang trong 24 giờ, chưa bấm OK, sàn chưa phân xử ⇒ PHẢI nhắc. */
export function canNhacXacNhan(notes?: string | null, now: Date = new Date()): (MocXacNhan & { conPhut: number }) | null {
    const m = mocXacNhanBangChung(notes)
    if (!m || m.daXacNhan || m.daKetThuc) return null
    const con = m.hetHan.getTime() - now.getTime()
    if (con <= 0) return null
    return { ...m, conPhut: Math.ceil(con / 60_000) }
}

/** "3 giờ 20 phút" / "45 phút". */
export const conGioChu = (phut: number) =>
    phut >= 60 ? `${Math.floor(phut / 60)} giờ${phut % 60 ? ` ${phut % 60} phút` : ''}` : `${Math.max(0, phut)} phút`
