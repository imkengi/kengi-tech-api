/**
 * CỔNG API TÀI CHÍNH TIKTOK (17/11/2026)
 *
 * Bệnh (đo log prod 7 ngày 11–17/11/2026): 963 lần TikTok trả 36009002 "shared app-group rate limit" cho
 * /finance/202309/orders/{id}/statement_transactions, trong 32 đợt, dồn đúng lúc FeeSync chạy (2 luồng + nghỉ 350 ms
 * ≈ 2,7 lời gọi/giây); nút "Lấy phí" (/sync-fees) còn chạy 6 luồng KHÔNG nghỉ. 16/11 04:23 bị từ chối 71 lần, lượt
 * đó không ghi được phí TikTok nào — mà getOrderSettlement trả null cho MỌI mã lỗi nên bị đếm nhầm là "sàn chưa có số".
 *
 * Nay mọi lời gọi /finance/* của TikTokService trong MỘT bản máy đi qua cổng này:
 *  • MỖI LẦN MỘT lời gọi, hai lần bắt đầu cách nhau ≥ TIKTOK_TAI_CHINH_GIAN_CACH_MS (mặc định 700 ms ≈ 1,4 lời gọi/giây);
 *  • TikTok trả 36009002 (hoặc HTTP 429) ⇒ cổng ĐÓNG TIKTOK_TAI_CHINH_NGHI_MS (mặc định 60 s): lời gọi đó ném
 *    LoiTikTokGioiHan, mọi lời gọi tới cổng trong lúc đóng cũng ném NGAY mà KHÔNG gửi gì sang TikTok (chuaGui = true);
 *  • chờ trong hàng quá TIKTOK_TAI_CHINH_CHO_TOI_DA_MS (mặc định 90 s) ⇒ bỏ, không gửi — URL đã ký kèm timestamp lúc dựng.
 * Bên gọi nhận ra bằng laLoiTikTokGioiHan: DỪNG lượt, đếm riêng "TikTok bóp hạn mức", đơn KHÔNG bị coi là "chưa có số"
 * và KHÔNG bị đánh dấu nghỉ — lượt sau hỏi lại.
 *
 * Hạn mức của TikTok tính CHUNG cả nhóm app (mọi gian, mọi bản máy); cổng chỉ giữ được trong một bản. Đo 7 ngày: chưa
 * lần nào hai bản cùng gọi API tài chính trong 5 phút (FeeSync đi theo lịch), nên đủ dùng; cho lịch nền chạy MỘT bản
 * là việc kế (prod không có Redis — xem lib/leaderLock).
 */

export const MA_TIKTOK_GIOI_HAN = 36009002

const gioVN = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(11, 19)

export class LoiTikTokGioiHan extends Error {
    readonly tikTokGioiHan = true
    /** true = lời gọi CHƯA gửi sang TikTok (cổng đang đóng / chờ quá lâu); false = TikTok vừa từ chối chính lời gọi này */
    readonly chuaGui: boolean
    readonly moLaiLuc: number
    constructor(moLaiLuc: number, chuaGui: boolean, chiTiet = '') {
        super(`TikTok đang bóp hạn mức API tài chính (${MA_TIKTOK_GIOI_HAN}) — tạm nghỉ tới ${gioVN(moLaiLuc)} giờ VN, để lượt sau`
            + (chiTiet ? ` (${chiTiet})` : ''))
        this.name = 'LoiTikTokGioiHan'
        this.chuaGui = chuaGui
        this.moLaiLuc = moLaiLuc
    }
}

export function laLoiTikTokGioiHan(e: any): boolean {
    return !!e && (e.tikTokGioiHan === true || e.name === 'LoiTikTokGioiHan')
}

/** Phản hồi TikTok (đã parse JSON) có phải lời từ chối vì hạn mức không. */
export function laPhanHoiGioiHan(d: any): boolean {
    return Number(d?.code) === MA_TIKTOK_GIOI_HAN
}

/** Lời gọi tới đường /finance/* của Open API TikTok. */
export function laDuongTaiChinhTikTok(url: string): boolean {
    try { return new URL(url).pathname.startsWith('/finance/') } catch { return false }
}

export interface TuyChonCong {
    gianCachMs: number          // khoảng cách tối thiểu giữa hai lần BẮT ĐẦU gọi
    nghiMs: number              // bị từ chối vì hạn mức ⇒ đóng cổng bao lâu
    choToiDaMs: number          // chờ trong hàng quá lâu ⇒ bỏ, không gửi
    bayGio?: () => number       // bộ kiểm thay đồng hồ
    ngu?: (ms: number) => Promise<void>
    ghiLog?: (dong: string) => void
}

export interface CongGioiHan {
    /** Chạy `goi` khi tới lượt. Ném LoiTikTokGioiHan khi TikTok bóp hạn mức / cổng đang đóng / chờ quá lâu. */
    qua<T>(goi: () => Promise<T>): Promise<T>
    dangDong(): boolean
    /** Số lần TikTok từ chối vì hạn mức kể từ lúc bật máy — bên gọi so trước/sau để biết lượt mình có bị chặn không. */
    soLanBiChan(): number
    trangThai(): { dongDen: number; daGoi: number; biChan: number; boKhiDong: number; boViChoLau: number; dangCho: number }
}

export function taoCongGioiHan(tc: TuyChonCong): CongGioiHan {
    const bayGio = tc.bayGio ?? Date.now
    const ngu = tc.ngu ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
    const ghiLog = tc.ghiLog ?? ((dong: string) => console.warn(dong))
    let duoiHang: Promise<unknown> = Promise.resolve()
    let batDauCuoi = Number.NEGATIVE_INFINITY
    let dongDen = 0
    let dangCho = 0
    const tk = { daGoi: 0, biChan: 0, boKhiDong: 0, boViChoLau: 0 }

    const dongCong = (chiTiet: string): LoiTikTokGioiHan => {
        const nay = bayGio()
        const vuaDong = nay >= dongDen
        dongDen = nay + tc.nghiMs
        tk.biChan++
        if (vuaDong) {
            ghiLog(`[TikTok tài chính] TikTok bóp hạn mức (${MA_TIKTOK_GIOI_HAN}${chiTiet ? `: ${chiTiet}` : ''}) — đóng cổng `
                + `${Math.round(tc.nghiMs / 1000)} s tới ${gioVN(dongDen)} giờ VN; lời gọi tài chính khác dừng, để lượt sau`)
        }
        return new LoiTikTokGioiHan(dongDen, false, chiTiet)
    }

    function qua<T>(goi: () => Promise<T>): Promise<T> {
        const vaoLuc = bayGio()
        dangCho++
        const luot = duoiHang.then(async () => {
            dangCho--
            if (bayGio() < dongDen) { tk.boKhiDong++; throw new LoiTikTokGioiHan(dongDen, true) }
            const cho = batDauCuoi + tc.gianCachMs - bayGio()
            if (cho > 0) await ngu(cho)
            if (bayGio() < dongDen) { tk.boKhiDong++; throw new LoiTikTokGioiHan(dongDen, true) }
            if (bayGio() - vaoLuc > tc.choToiDaMs) {
                tk.boViChoLau++
                throw new LoiTikTokGioiHan(bayGio(), true, `chờ trong hàng quá ${Math.round(tc.choToiDaMs / 1000)} s`)
            }
            batDauCuoi = bayGio()
            tk.daGoi++
            let kq: T
            try {
                kq = await goi()
            } catch (e: any) {
                // Phản hồi không phải JSON mang HTTP 429 (parseResponse ném "HTTP 429 …") — cũng là bóp hạn mức
                if (/^HTTP 429\b/.test(String(e?.message || ''))) throw dongCong('HTTP 429')
                throw e
            }
            if (laPhanHoiGioiHan(kq)) throw dongCong(String((kq as any)?.message || '').slice(0, 120))
            return kq
        })
        // Lời gọi hỏng không làm gãy hàng; lượt kế chờ lượt này XONG (kể cả hỏng) mới chạy ⇒ mỗi lần đúng một lời gọi.
        duoiHang = luot.catch(() => undefined)
        return luot
    }

    return {
        qua,
        dangDong: () => bayGio() < dongDen,
        soLanBiChan: () => tk.biChan,
        trangThai: () => ({ dongDen, ...tk, dangCho }),
    }
}

const soEnv = (ten: string, macDinh: number) => {
    const n = Number(process.env[ten])
    return Number.isFinite(n) && n >= 0 && process.env[ten] !== '' && process.env[ten] !== undefined ? n : macDinh
}

/** Cổng dùng chung của cả tiến trình — TikTokService.httpGet/httpPost đưa mọi đường /finance/* qua đây. */
export const congTaiChinhTikTok: CongGioiHan = taoCongGioiHan({
    gianCachMs: soEnv('TIKTOK_TAI_CHINH_GIAN_CACH_MS', 700),
    nghiMs: soEnv('TIKTOK_TAI_CHINH_NGHI_MS', 60_000),
    choToiDaMs: soEnv('TIKTOK_TAI_CHINH_CHO_TOI_DA_MS', 90_000),
})
