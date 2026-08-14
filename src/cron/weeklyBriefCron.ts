import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { duBaoDongTien } from '../lib/cashForecast'
import { keHoachDatHang } from '../lib/reorderPlan'

/**
 * BẢN TIN ĐẦU TUẦN — sáng thứ Hai 08:00 giờ VN.
 *
 * Lịch tiền và đề xuất đặt hàng chỉ có giá trị nếu tin đến TRƯỚC ngày xảy ra.
 * Một cửa hàng biết mình cạn tiền vào đúng hôm cạn thì chỉ còn cách đi vay nóng;
 * biết trước hai tuần thì còn kịp thu nợ hoặc xin giãn hạn nhà cung cấp.
 *
 * NHƯNG: đây là thông báo GỬI ĐỀU HẰNG TUẦN, nên nó là loại dễ trở thành rác
 * nhất trong cả phần mềm. Một bản tin nhạt nhẽo tuần thứ ba là người dùng tắt
 * vĩnh viễn, và tuần thứ mười có tin thật thì không ai đọc. Vì vậy:
 *
 *   - Không có gì đáng nói thì KHÔNG GỬI GÌ CẢ. Im lặng là mặc định, không phải
 *     ngoại lệ. Tuyệt đối không gửi kiểu "tuần này mọi thứ ổn".
 *   - Mỗi mục phải VƯỢT NGƯỠNG mới được vào tin, và ngưỡng đặt ở mức người ta
 *     phải hành động chứ không phải mức đáng biết.
 *   - Thiếu dữ liệu thì bỏ qua mục đó, không suy diễn. Cửa hàng chưa nhập số dư
 *     tài khoản thì không bao giờ được nhận câu "sắp hết tiền".
 */

const RUN_HOUR_UTC = 1          // 08:00 giờ VN
const THU_HAI = 1
const LOAI_TB = 'weekly-brief'

/** Chỉ báo cạn tiền khi nó rơi trong tầm còn xoay kịp. */
const TAM_NHIN_NGAY = 30
/** Mã hết hàng chỉ đáng nhắc khi mất từ mức này mỗi ngày. */
const NGUONG_MAT_MOI_NGAY = 200_000

let timer: NodeJS.Timeout | null = null
let lastRunWeek = ''
let running = false

const tien = (n: number) => Math.round(Number(n) || 0).toLocaleString('vi-VN') + 'đ'

export interface BanTin { tieuDe: string; noiDung: string }

/**
 * Ghép bản tin từ hai kết quả đã tính. Tách khỏi phần chạm DB để test được từng
 * ngưỡng mà không phải dựng cả cron.
 */
export function ghepBanTin(tien_: any, kho: any, sucKhoe?: any): BanTin | null {
    const muc: string[] = []
    let gap = false

    // ── Tiền ─────────────────────────────────────────────────────────────
    /* coSoDuDau = false nghĩa là cửa hàng chưa nhập số dư tài khoản. Đường số dư
     * lúc đó chỉ là chênh lệch vào-ra, KHÔNG được dùng để doạ ai. */
    if (tien_?.soDuDau?.coSoDuDau && tien_?.ngayCanTien) {
        gap = true
        muc.push(`💸 Theo lịch tiền, đến ${tien_.ngayCanTien} là không đủ tiền trả. ` +
            `Phải trả chắc chắn trong kỳ: ${tien(tien_.tomTat?.tongChiChacChan)}` +
            (tien_.tomTat?.noKhachChuaCoHan > 0
                ? `. Khách đang nợ ${tien(tien_.tomTat.noKhachChuaCoHan)} — đi đòi sớm là cách rẻ nhất.`
                : '.'))
    } else if (tien_?.soDuDau?.coSoDuDau && tien_?.diemChamDay
        && tien_.tomTat?.tongChiChacChan > 0
        && tien_.diemChamDay.soDu < tien_.tomTat.tongChiChacChan) {
        /* Chưa âm nhưng đáy còn mỏng hơn cả số chắc chắn phải trả — một khoản
         * phát sinh nữa là hụt. Đáng nhắc, nhưng không phải mức báo động. */
        muc.push(`⚠️ Tiền không âm nhưng chạm đáy ${tien(tien_.diemChamDay.soDu)} vào ${tien_.diemChamDay.ngay}, ` +
            `mỏng hơn tổng khoản chắc chắn phải trả. Đừng nhập lô lớn quanh ngày đó.`)
    }

    // ── Kho ──────────────────────────────────────────────────────────────
    /* Hết hàng: chỉ nhắc mã thật sự đang mất tiền, không nhắc mã hết mà cũng
     * chẳng ai mua. */
    const hetDangKe = (kho?.hetHang || []).filter((m: any) => m.matMoiNgay >= NGUONG_MAT_MOI_NGAY)
    if (hetDangKe.length > 0) {
        gap = true
        const top = hetDangKe.slice(0, 3).map((m: any) => `${m.ten} (~${tien(m.matMoiNgay)}/ngày)`).join(', ')
        muc.push(`📦 ${hetDangKe.length} mã đang hết hàng mà vẫn có người hỏi mua: ${top}` +
            (hetDangKe.length > 3 ? ` và ${hetDangKe.length - 3} mã nữa.` : '.'))
    }

    /* Sắp hết: chỉ những mã sẽ đứt TRƯỚC KHI hàng mới kịp về. Mã còn 20 ngày mà
     * chờ hàng 7 ngày thì không việc gì phải làm phiền sáng thứ Hai. */
    const sapDut = (kho?.canDat || []).filter((m: any) =>
        m.conBanDuoc !== null && m.conBanDuoc < m.soNgayCho)
    if (sapDut.length > 0) {
        gap = true
        const tienBo = sapDut.reduce((s: number, m: any) => s + m.tienCanBo, 0)
        const top = sapDut.slice(0, 3).map((m: any) => `${m.ten} (còn ${m.conBanDuoc} ngày, chờ hàng ${m.soNgayCho} ngày)`).join('; ')
        muc.push(`🛒 ${sapDut.length} mã sẽ đứt trước khi hàng mới kịp về — đặt tuần này: ${top}` +
            (sapDut.length > 3 ? ` và ${sapDut.length - 3} mã nữa` : '') +
            `. Tổng vốn cần khoảng ${tien(tienBo)}.`)
    }

    /* MỐI NỐI GIỮA HAI CỖ MÁY — chỗ có giá trị nhất của bản tin này.
     *
     * "Cần 338 triệu nhập hàng" và "đáy tiền còn 40 triệu" đọc riêng thì đều
     * đúng và đều vô hại; đặt cạnh nhau mới thấy vấn đề. Chủ shop hay nhập theo
     * danh sách thiếu hàng rồi mới phát hiện không đủ tiền trả nhà cung cấp
     * tháng đó — lúc ấy vừa kẹt hàng vừa kẹt tiền.
     *
     * Chỉ nói khi ĐO ĐƯỢC cả hai vế: chưa nhập số dư thì không có vế nào để so. */
    if (sapDut.length > 0 && tien_?.soDuDau?.coSoDuDau && tien_?.diemChamDay) {
        const canVon = sapDut.reduce((s: number, m: any) => s + m.tienCanBo, 0)
        const dayTien = tien_.diemChamDay.soDu
        if (canVon > dayTien) {
            muc.push(`🔗 Lưu ý ghép hai con số: nhập đủ số hàng trên cần ${tien(canVon)}, ` +
                `trong khi tiền chạm đáy chỉ còn ${tien(dayTien)} vào ${tien_.diemChamDay.ngay}. ` +
                `Nhập hết một lượt là hụt tiền trả nhà cung cấp — nên xếp thứ tự theo mã mất tiền nhiều nhất, ` +
                `hoặc xin giãn hạn trước khi đặt.`)
        }
    }

    /* Vốn đọng: không gấp, chỉ vào tin khi ĐÃ có mục khác — tự nó không đáng để
     * đánh thức ai vào sáng thứ Hai. */
    if (gap && kho?.tomTat?.vonKetODongHang > 0 && kho.tomTat.soMaTonDong >= 5) {
        muc.push(`🧊 Nhân tiện: ${tien(kho.tomTat.vonKetODongHang)} đang nằm chết ở ${kho.tomTat.soMaTonDong} mã không bán được suốt kỳ.`)
    }

    if (muc.length === 0) return null

    /* CẢNH BÁO DỮ LIỆU ĐI TRƯỚC MỌI LỜI KHUYÊN, không phải xuống cuối.
     *
     * Bản tin này nói những câu rất cụ thể: "đến ngày 20 là không đủ tiền trả",
     * "cần nhập ngần này hàng". Nếu chi phí chưa được ghi sổ hoặc tồn kho đang
     * âm thì CHÍNH những câu đó sai — và người đọc sẽ hành động theo chúng.
     *
     * Đo trên dữ liệu thật 14/08/2026: một cửa hàng 14,1 tỷ doanh thu mà sổ chi
     * phí trống trơn; một cửa hàng khác có 262 mã tồn âm và 115 hoá đơn hỏng.
     * Bản tin gửi cho hai cửa hàng đó mà không nói gì là bản tin sai. */
    const nang = Array.isArray(sucKhoe?.muc) ? sucKhoe.muc.filter((m: any) => m.muc === 'nang') : []
    if (nang.length > 0) {
        muc.unshift(`⚠️ ĐỌC CÁI NÀY TRƯỚC: dữ liệu nền đang có ${nang.length} chỗ làm lệch chính các con số bên dưới — `
            + nang.map((m: any) => `${String(m.ten).toLowerCase()} (${m.so})`).join('; ')
            + `. Dọn xong rồi hãy quyết theo bản tin này. Xem ở Thuế → Thanh tra thuế, mục Sức khoẻ dữ liệu.`)
    }

    return {
        tieuDe: gap ? '🔔 Tuần này có việc cần xử lý' : '📋 Bản tin đầu tuần',
        noiDung: muc.join('\n\n') + '\n\nXem chi tiết ở Chiến Lược → Lịch tiền, và Kho → Đặt hàng thông minh.',
    }
}

/**
 * `chayThu` = tính đủ nhưng KHÔNG tạo thông báo, chỉ in ra log những gì sẽ gửi.
 * Dùng để kiểm hai phép tính nặng này trên dữ liệu thật mà không làm phiền cửa
 * hàng nào — chạy thử trên dữ liệu giả không bắt được lỗi truy vấn.
 */
export async function banTinChoStore(
    prisma: any, tenStore: string, tuanMa: string, chayThu = false,
): Promise<boolean> {
    /* Đã gửi tuần này rồi thì thôi — dùng chính Notification làm dấu thay vì
     * thêm bảng trạng thái cho việc chạy mỗi tuần một lần. */
    const daGui = chayThu ? null : await prisma.notification.findFirst({
        where: { type: LOAI_TB, message: { contains: tuanMa } },
        select: { id: true },
    }).catch(() => null)
    if (daGui) return false

    // Tuần tự: hai phép tính đều nặng, chạy song song là hút cạn pool của cửa hàng.
    const tien_ = await duBaoDongTien(prisma, { soNgay: TAM_NHIN_NGAY }).catch(() => null)
    const kho = await keHoachDatHang(prisma, { soMaToiDa: 100 }).catch(() => null)

    /* Đọc hỏng dữ liệu thì im hẳn. Gửi bản tin dựng trên số rỗng là vừa sai vừa
     * làm mất lòng tin vào mọi bản tin sau. */
    if (tien_?.thieuChinh?.length || kho?.thieuChinh?.length) {
        /* In ra ĐÚNG truy vấn nào hỏng. Log kiểu "chưa đọc được dữ liệu" chung
         * chung từng làm mất một buổi: cả 9 cửa hàng đều im mà không biết vì sao,
         * hoá ra một câu SQL thô sai tên cột khoá ngoại. */
        const lyDo = [...(tien_?.thieuChinh || []), ...(kho?.thieuChinh || [])].join(' | ')
        console.log(`📋 [${tenStore}] bỏ qua bản tin tuần — chưa đọc được: ${lyDo}`)
        return false
    }

    /* Sức khoẻ dữ liệu chạy SAU hai phép kia, và lỗi ở đây KHÔNG được làm hỏng
     * bản tin: thiếu nó thì bản tin vẫn đúng, chỉ là thiếu lời cảnh báo. */
    const sucKhoe = await (async () => {
        try {
            const { sucKhoeDuLieu } = await import('../lib/dataHealth')
            const nay = new Date(Date.now() + 7 * 3600_000)
            const to = nay.toISOString().slice(0, 10)
            const from = new Date(nay.getTime() - 90 * 86400_000).toISOString().slice(0, 10)
            return await sucKhoeDuLieu(prisma, {
                from, to,
                start: new Date(`${from}T00:00:00+07:00`),
                end: new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400_000),
            })
        } catch { return null }
    })()

    const tin = ghepBanTin(tien_, kho, sucKhoe)
    if (!tin) {
        if (chayThu) console.log(`📋 [${tenStore}] CHẠY THỬ: không có gì đáng gửi`)
        return false
    }

    if (chayThu) {
        console.log(`📋 [${tenStore}] CHẠY THỬ — sẽ gửi:
${tin.tieuDe}
${tin.noiDung}`)
        return true
    }

    await prisma.notification.create({
        data: {
            type: LOAI_TB,
            title: tin.tieuDe,
            /* Nhúng mã tuần vào cuối để lần sau biết đã gửi — không cần cột mới. */
            message: `${tin.noiDung}\n\n(${tuanMa})`.slice(0, 1800),
        },
    }).catch(() => { /* store cũ chưa có bảng Notification */ })

    console.log(`📋 [${tenStore}] đã gửi bản tin tuần ${tuanMa}`)
    return true
}

/** Mã tuần dạng "tuần 2026-W33" — dùng làm dấu chống gửi trùng. */
export function maTuan(homNay: Date): string {
    const d = new Date(Date.UTC(homNay.getUTCFullYear(), homNay.getUTCMonth(), homNay.getUTCDate()))
    /* Chuẩn ISO: tuần chứa thứ Năm quyết định năm của tuần đó. Không theo chuẩn
     * này thì tuần giao thừa sẽ đổi mã giữa chừng và bản tin gửi trùng. */
    const thu = (d.getUTCDay() + 6) % 7
    d.setUTCDate(d.getUTCDate() - thu + 3)
    const namCuaTuan = d.getUTCFullYear()
    const thuNamDau = new Date(Date.UTC(namCuaTuan, 0, 4))
    const lechThu = (thuNamDau.getUTCDay() + 6) % 7
    thuNamDau.setUTCDate(thuNamDau.getUTCDate() - lechThu + 3)
    const tuan = 1 + Math.round((d.getTime() - thuNamDau.getTime()) / (7 * 86400_000))
    return `tuần ${namCuaTuan}-W${String(tuan).padStart(2, '0')}`
}

async function runBanTin(chayThu = false): Promise<void> {
    if (running) return
    running = true
    try {
        const vn = new Date(Date.now() + 7 * 3600 * 1000)
        const tuanMa = maTuan(vn)
        const stores = await registryPrisma.store.findMany({ where: { status: 'active' } as any }) as any[]
        for (const store of stores) {
            try {
                await banTinChoStore(getStorePrisma(store.schema), store.name, tuanMa, chayThu)
            } catch (e: any) {
                console.error(`Bản tin tuần lỗi ở store ${store.name}:`, e?.message || e)
            }
        }
    } catch (e: any) {
        console.error('Bản tin tuần lỗi:', e?.message || e)
    } finally {
        running = false
    }
}

export function startWeeklyBriefCron(): void {
    if (timer) return
    console.log(`📋 Weekly brief cron started (thứ Hai ${RUN_HOUR_UTC}:00 UTC = 08:00 VN)`)
    timer = setInterval(() => {
        const vn = new Date(Date.now() + 7 * 3600 * 1000)
        const tuanMa = maTuan(vn)
        if (lastRunWeek === tuanMa) return
        if (vn.getUTCDay() !== THU_HAI) return
        if (new Date().getUTCHours() < RUN_HOUR_UTC) return
        lastRunWeek = tuanMa
        runBanTin()
    }, 60 * 60 * 1000)
}

export function stopWeeklyBriefCron(): void {
    if (timer) { clearInterval(timer); timer = null }
}

/** Cho phép gọi tay (endpoint admin) khi cần chạy ngay. */
export const chayBanTinNgay = runBanTin
