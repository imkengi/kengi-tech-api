/**
 * PHÂN LOẠI LỖI KHI GỌI NỀN TẢNG (Facebook / Instagram / TikTok / YouTube)
 * Chuyển từ `scratch/fanpage-dashboard/marketing/providers.js` — 05/09/2026.
 *
 * ĐÂY LÀ PHẦN QUAN TRỌNG NHẤT CỦA CẢ MODULE, và cũng là phần dễ làm sai nhất.
 *
 * Một lời gọi hỏng có thể ở BA tình huống khác hẳn nhau, và xử lý giống nhau là
 * hỏng thật:
 *
 *   1. THỬ LẠI ĐƯỢC  (`thuLaiDuoc`) — chắc chắn CHƯA có gì xảy ra phía nền tảng.
 *      Ví dụ: 429 giới hạn tốc độ, hoặc 5xx trên một lời gọi CHỈ ĐỌC.
 *
 *   2. MƠ HỒ         (`moHo`) — ⛔ ĐÃ GỬI ĐI RỒI MÀ KHÔNG BIẾT KẾT QUẢ.
 *      Ví dụ: đứt mạng giữa chừng một lệnh POST, hoặc nền tảng trả 5xx sau khi
 *      đã nhận bài. Bài CÓ THỂ đã lên. Tự thử lại là ĐĂNG TRÙNG lên trang khách
 *      hàng — sai lầm không sửa được, vì xoá bài đi thì người theo dõi đã thấy.
 *      ⇒ Trạng thái này PHẢI dừng lại chờ người xem, tuyệt đối không tự chạy tiếp.
 *
 *   3. HỎNG HẲN      (không cờ nào) — chắc chắn không lên, và thử lại cũng vô ích.
 *      Ví dụ: 401 token hết hạn, thiếu quyền, nội dung sai định dạng.
 *      ⇒ Phải người sửa (nối lại kênh / sửa bài) rồi mới gửi lại.
 *
 * Chỗ tinh tế nhất: CÙNG một lỗi mạng, nhưng trên GET thì `thuLaiDuoc`, trên POST
 * thì `moHo`. Vì GET không đổi gì phía bên kia, còn POST thì có thể đã đổi rồi.
 */

/** Lỗi từ nền tảng, kèm cách xử lý an toàn. */
export class LoiNenTang extends Error {
    code: string
    /** Chắc chắn chưa xảy ra gì → hệ thống tự thử lại được. */
    thuLaiDuoc: boolean
    /** ⛔ Đã gửi mà không biết kết quả → KHÔNG BAO GIỜ tự thử lại. */
    moHo: boolean
    /** Số giây nên chờ trước khi thử lại (429 trả về trong header). */
    choGiay: number

    constructor(
        thongDiep: string,
        opt: { code?: string; thuLaiDuoc?: boolean; moHo?: boolean; choGiay?: number } = {}
    ) {
        super(thongDiep)
        this.name = 'LoiNenTang'
        this.code = opt.code || 'PROVIDER_ERROR'
        this.thuLaiDuoc = !!opt.thuLaiDuoc
        this.moHo = !!opt.moHo
        this.choGiay = opt.choGiay ?? 60
    }
}

/** Mã lỗi nghĩa là token hỏng/hết hạn — phải nối lại kênh, thử lại vô ích. */
const MA_TOKEN_HONG = new Set(['190', 'access_token_invalid', 'access_token_expired'])
/** Mã lỗi nghĩa là bị giới hạn tốc độ — chờ rồi thử lại được. */
const MA_GIOI_HAN = new Set(['rate_limit_exceeded', '4', '32', '613'])

export interface TuyChonGoi {
    method?: string
    body?: any
    headers?: Record<string, string>
    /** Lời gọi CHỈ ĐỌC dù dùng method POST (vd: hỏi trạng thái upload).
     *  Đánh dấu đúng chỗ này quyết định lỗi mạng thành `thuLaiDuoc` hay `moHo`. */
    chiDoc?: boolean
    /** Trả nguyên `Response` thay vì JSON (dùng cho upload nhiều khúc). */
    tho?: boolean
    timeoutMs?: number
}

/**
 * Gọi API nền tảng và ném `LoiNenTang` đã phân loại sẵn.
 * `fetcher` tiêm được để kiểm thử không cần mạng thật.
 */
export async function goiNenTang(
    url: string,
    token: string | null,
    tuyChon: TuyChonGoi = {},
    fetcher: typeof fetch = fetch
): Promise<any> {
    const method = tuyChon.method || 'GET'
    /* "Ghi" = có thể đổi trạng thái phía nền tảng. GET và các lời gọi tự khai
     * `chiDoc` thì không. Phân biệt này quyết định lỗi mạng thành mơ hồ hay không. */
    const laGhi = method !== 'GET' && !tuyChon.chiDoc

    const coBody = tuyChon.body !== undefined && tuyChon.body !== null
    const bodyLaForm = coBody && typeof URLSearchParams !== 'undefined' && tuyChon.body instanceof URLSearchParams
    const bodyLaBuffer = coBody && Buffer.isBuffer(tuyChon.body)

    let res: Response
    try {
        res = await fetcher(url, {
            method,
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(coBody && !bodyLaForm && !bodyLaBuffer ? { 'Content-Type': 'application/json' } : {}),
                ...(tuyChon.headers || {}),
            },
            body: !coBody ? undefined
                : (bodyLaForm || bodyLaBuffer) ? (tuyChon.body as any)
                    : JSON.stringify(tuyChon.body),
            /* `redirect: 'error'` CỐ Ý: đi theo chuyển hướng có thể gửi kèm
             * Authorization sang một máy chủ khác — rò token. */
            redirect: 'error',
            signal: AbortSignal.timeout(tuyChon.timeoutMs ?? 45_000),
        } as any)
    } catch {
        /* ⛔ ĐÂY LÀ NHÁNH QUAN TRỌNG NHẤT CẢ FILE.
         * Không nhận được phản hồi ≠ không có gì xảy ra. Yêu cầu có thể đã tới nơi
         * và đã được xử lý, chỉ là ta không nghe được câu trả lời. */
        throw new LoiNenTang(
            'Không nhận được phản hồi từ nền tảng. Phải đối soát trước khi gửi lại.',
            { code: 'NETWORK_ERROR', thuLaiDuoc: !laGhi, moHo: laGhi }
        )
    }

    if (tuyChon.tho && (res.ok || res.status === 308)) return res

    const json: any = await res.json().catch(() => ({}))
    const loi = json?.error
    const coLoiTrongThan = loi && loi.code !== undefined && !['ok', 0].includes(loi.code)

    if (!res.ok || coLoiTrongThan) {
        const code = String(loi?.code ?? res.status).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
        const tokenHong = res.status === 401 || MA_TOKEN_HONG.has(code)
        const gioiHan = res.status === 429 || MA_GIOI_HAN.has(code)
        const loi5xx = res.status >= 500

        throw new LoiNenTang(
            tokenHong ? 'Token hết hạn hoặc thiếu quyền. Phải nối lại kênh.'
                : gioiHan ? 'Nền tảng giới hạn tốc độ. Sẽ chờ rồi thử lại.'
                    : `Nền tảng từ chối (${code}). Kiểm tra quyền và định dạng nội dung.`,
            {
                code,
                /* 5xx trên lời gọi GHI = mơ hồ: nền tảng có thể đã nhận bài rồi mới hỏng. */
                moHo: loi5xx && laGhi,
                thuLaiDuoc: gioiHan || (loi5xx && !laGhi),
                choGiay: Math.max(30, Math.min(3600, Number(res.headers.get('retry-after')) || 60)),
            }
        )
    }
    return json
}

/** Quy lỗi về trạng thái lưu vào `MktPublication.status`. */
export function trangThaiTuLoi(err: any): 'uncertain' | 'failed' {
    /* Không phải LoiNenTang (lỗi lập trình, lỗi CSDL…) thì coi là hỏng hẳn —
     * KHÔNG coi là mơ hồ, vì mơ hồ là trạng thái phải có người vào xử lý tay. */
    return err instanceof LoiNenTang && err.moHo ? 'uncertain' : 'failed'
}
