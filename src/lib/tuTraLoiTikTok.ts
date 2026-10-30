/**
 * TỰ TRẢ LỜI CHAT TIKTOK SHOP BẰNG CHATBOT (30/10/2026) — chủ shop ngay khi chat TikTok về: "chưa có tự trả lời nha".
 *
 * Cùng khuôn lib/tuTraLoiShopee.ts: gom tin 15 giây, giữ chỗ từng tin khách (mỗi tin trả lời tối đa MỘT lần, kể cả push lặp /
 * hai bản máy), trần 30 tin/hội thoại/24 giờ và 60 tin/giờ ⇒ tự tắt, tin chờ 30 phút khi AI không soạn được, kho nhật ký
 * TuTraLoiNhatKy + công tắc TuTraLoiCaiDat DÙNG CHUNG (khoá theo kenhId). Khác Shopee:
 *  - Kích hoạt từ webhook TikTok loại 14 (data.sender.role, conversation_id); tin của gian = role ≠ BUYER.
 *  - Đọc tin qua TikTokService.getMessages (DESC ⇒ đảo). Vai trò người gửi (tài liệu TikTok): BUYER = khách; CUSTOMER_SERVICE =
 *    nhân viên; SHOP = tài khoản chính của gian — vừa là người thật, vừa là trả lời tự động / FAQ TikTok gửi thay gian;
 *    ROBOT / SYSTEM = tin tự động của TikTok, không tính là đã trả lời. SHOP đến trong vòng NGUONG_TU_DONG_GIAY sau tin khách
 *    được coi là tự động của TikTok (lời chào / FAQ bắn ngay) — người thật không trả lời nhanh thế; tin chatbot của mình thì
 *    tra nhật ký (daGui) nên luôn tính.
 *  - Gửi theo conversationId (Send Message TEXT) — không có hàm "auto reply" riêng; TikTok không cấm chatbot như Shopee nhưng
 *    vẫn giữ trần và tự tắt khi bị từ chối: hết hạn mức ngày 45101004, mất quyền 105005/106011/106001.
 *  - Câu trả lời không được kéo khách ra ngoài TikTok (kiemCauTuDong(…, 'tiktok')).
 */
import { TikTokService } from '../services/platforms/tiktok'
import {
    GOM_MS, TRAN_HOI_THOAI, TRAN_GIO, CAU_CHO, PHUT_TIN_CHO, TIEN_TO_TIN_CHO, TIEN_TO_CAN_NHAN_VIEN,
    kiemCauTuDong, khoTuTraLoiSql, tenSanPhamCuaGian,
    type KhoTuTraLoi, type TrangThaiNhatKy, type KetQuaTuTraLoi,
} from './tuTraLoiShopee'
import { moTaLoi } from './gomLoi'

/** SHOP nhắn trong chừng này giây sau tin khách = trả lời tự động của TikTok (lời chào / FAQ), không phải người */
export const NGUONG_TU_DONG_GIAY = 20

export interface TinTikTokGoiY {
    messageId: string
    messageType: string
    content: string
    fromRole: string
    fromId?: number | string
    createdTimestamp?: number
    plaintext?: string
    isVisible?: boolean
    sourceContent?: any
}
type LuotHoiThoai = { role: 'user' | 'model'; parts: { text: string }[] }

export interface TikTokTuTraLoi {
    getMessages(conversationId: string, p: { pageSize?: number }): Promise<{ messages: any[] }>
    sendMessage(conversationId: string, text: string): Promise<{ messageId: string }>
}

export interface PhuThuocTuTraLoiTikTok {
    kho: KhoTuTraLoi
    docKenh(kenhId: string): Promise<any | null>
    taoTikTok(kenh: any): Promise<TikTokTuTraLoi>
    tenSanPham(kenhId: string, maSp: string[]): Promise<Map<string, string>>
    soanGoiY(cauHoi: string, lichSu: any[], tenKenh: string): Promise<{ traLoi: string; canNhanVien: boolean; loi?: string | null }>
    cho(ms: number): Promise<void>
}

const noiDungTho = (m: TinTikTokGoiY): any => {
    try { return typeof m.sourceContent === 'string' ? JSON.parse(m.sourceContent) : (m.sourceContent || {}) } catch { return {} }
}

/** Chữ của một tin để AI đọc. Thẻ sản phẩm ⇒ kèm TÊN hàng của gian (tenSanPham: product_id TikTok → tên). */
export function chuTinTikTok(m: TinTikTokGoiY, tenSanPham: Map<string, string>): string {
    const t = String(m.messageType || '').toLowerCase()
    const tho = noiDungTho(m)
    const spId = String(tho.product_id || '')
    const sp = spId ? (tenSanPham.get(spId) || `mã ${spId} trên TikTok`) : ''
    switch (t) {
        case 'text': return String(m.content || '')
        case 'image': return '[Gửi ảnh]'
        case 'video': return '[Gửi video]'
        case 'emoticons': return '[Gửi sticker]'
        case 'product_card': case 'buyer_enter_from_product': return `[Gửi thẻ sản phẩm: ${sp || 'không rõ'}]`
        case 'order_card': case 'buyer_enter_from_order': return `[Gửi thẻ đơn hàng${tho.order_id ? ` #${tho.order_id}` : ''}]`
        case 'logistics_card': return `[Thẻ vận chuyển${tho.order_id ? ` đơn #${tho.order_id}` : ''}]`
        case 'coupon_card': return '[Gửi voucher]'
        default: return String(m.plaintext || m.content || '')
    }
}

export const laKhachTikTok = (m: TinTikTokGoiY) => String(m.fromRole || '').toUpperCase() === 'BUYER'
export const laTuDongTikTok = (m: TinTikTokGoiY) => ['ROBOT', 'SYSTEM'].includes(String(m.fromRole || '').toUpperCase())

/**
 * Câu KHÁCH cần trả lời + lịch sử (ds: cũ → mới, đã bỏ tin is_visible=false). Cùng luật tachCauHoiShopee: câu hỏi = các tin
 * khách sau lần cuối gian ĐÃ TRẢ LỜI; tin chatbot của mình (daGui) chỉ trả lời TỚI tin khách nó đã đọc. Không có ⇒ null.
 */
export function tachCauHoiTikTok(ds: TinTikTokGoiY[], tenSanPham: Map<string, string>, daGui: Set<string> | Map<string, string | null> = new Set()):
    { cauHoi: string; lichSu: LuotHoiThoai[]; tinCuoiId: string } | null {
    const traLoiToi: Map<string, string | null> = daGui instanceof Map ? daGui : new Map([...daGui].map(id => [id, null]))
    const vai = (m: TinTikTokGoiY) => String(m.fromRole || '').toUpperCase()
    const nguoiTraLoi = (m: TinTikTokGoiY, viTri: number) => {
        if (traLoiToi.has(m.messageId)) return true
        const r = vai(m)
        if (r === 'CUSTOMER_SERVICE') return true
        if (r !== 'SHOP') return false
        // SHOP: người thật hay FAQ / lời chào tự động của TikTok? Tự động thì bắn ngay sau tin khách
        let truoc: TinTikTokGoiY | undefined
        for (let k = viTri - 1; k >= 0; k--) if (laKhachTikTok(ds[k]!)) { truoc = ds[k]; break }
        if (!truoc || !truoc.createdTimestamp || !m.createdTimestamp) return true
        return m.createdTimestamp - truoc.createdTimestamp > NGUONG_TU_DONG_GIAY
    }
    let daTraToi = -1, i = -1
    ds.forEach((m, viTri) => {
        if (!nguoiTraLoi(m, viTri)) return
        i = viTri
        const tinKhach = traLoiToi.get(m.messageId)
        const j = tinKhach ? ds.findIndex(x => x.messageId === tinKhach) : -1
        daTraToi = Math.max(daTraToi, j >= 0 && j < viTri ? j : viTri)
    })
    const hoi = ds.filter((m, viTri) => viTri > daTraToi && laKhachTikTok(m))
    const cauHoi = hoi.map(m => chuTinTikTok(m, tenSanPham).trim()).filter(Boolean).join('\n').slice(0, 2000)
    if (!cauHoi) return null
    const trongHoi = new Set(hoi)
    const lichSu: LuotHoiThoai[] = []
    for (const m of ds.slice(0, i + 1).filter(x => !trongHoi.has(x) && !laTuDongTikTok(x))) {
        const text = chuTinTikTok(m, tenSanPham).trim().slice(0, 2000)
        if (!text) continue
        const role = laKhachTikTok(m) ? 'user' : 'model'
        const cuoi = lichSu[lichSu.length - 1]
        if (cuoi && cuoi.role === role) cuoi.parts[0]!.text = `${cuoi.parts[0]!.text}\n${text}`.slice(-2000)
        else lichSu.push({ role, parts: [{ text }] })
    }
    let gon = lichSu.slice(-12)
    while (gon.length && gon[0]!.role !== 'user') gon = gon.slice(1)
    return { cauHoi, lichSu: gon, tinCuoiId: hoi[hoi.length - 1]!.messageId }
}

const BANG_LOI: [RegExp, 'tat' | 'bo_qua', string][] = [
    [/45101004|quota has been reached/i, 'tat', 'TikTok báo hết hạn mức 10.000 lượt/ngày — tự tắt, mai bật lại'],
    [/105005|106011|106001|access denied|scope|invalid.*(token|sign)/i, 'tat', 'token TikTok mất quyền chat — Cấp lại quyền ở kênh TikTok'],
    [/45101003|record not found/i, 'bo_qua', 'hội thoại không còn trên TikTok'],
    [/can_send_message|cannot send|closed|not allowed to send/i, 'bo_qua', 'hội thoại đã đóng / TikTok không cho gửi'],
]
export function phanLoaiLoiGuiTikTok(e: unknown): { loai: 'tat' | 'bo_qua' | 'loi'; lyDo: string } {
    const msg = String((e as any)?.message || e || '')
    for (const [re, loai, lyDo] of BANG_LOI) if (re.test(msg)) return { loai, lyDo }
    return { loai: 'loi', lyDo: `gửi lỗi: ${msg.slice(0, 160)}` }
}

const dangChay = new Map<string, { lai: boolean }>()

/** Vào từ webhook loại 14. `duLieuPush` = body.data của push (conversation_id, sender.role…). Không bao giờ ném. */
export async function tuTraLoiTikTok(kenh: { id: string; name?: string }, duLieuPush: any, pt: PhuThuocTuTraLoiTikTok): Promise<KetQuaTuTraLoi> {
    const kenhId = String(kenh?.id || '')
    try {
        const caiDat = await pt.kho.docCaiDat(kenhId)
        if (!caiDat?.bat) return 'tat'
        const nd = duLieuPush || {}
        const vaiTro = String(nd.sender?.role || '').toUpperCase()
        if (vaiTro && vaiTro !== 'BUYER') return 'tin_cua_gian'
        const hoiThoaiId = String(nd.conversation_id || '')
        if (!/^\d{1,30}$/.test(hoiThoaiId)) return 'thieu_hoi_thoai'

        const khoa = `${kenhId}:${hoiThoaiId}`
        const dang = dangChay.get(khoa)
        if (dang) { dang.lai = true; return 'dang_cho' }
        const moc = { lai: false }
        dangChay.set(khoa, moc)
        try {
            let kq: KetQuaTuTraLoi = 'khong_can'
            for (let vong = 0; vong < 3; vong++) {
                moc.lai = false
                await pt.cho(GOM_MS)
                kq = await mot(kenhId, hoiThoaiId, pt)
                if (!moc.lai || kq === 'gian_tu_tat' || kq === 'tat') break
            }
            return kq
        } finally {
            dangChay.delete(khoa)
        }
    } catch (e) {
        console.error(`[Tự trả lời TikTok] kênh ${kenhId}: ${moTaLoi(e)}`)
        return 'loi'
    }
}

async function mot(kenhId: string, hoiThoaiId: string, pt: PhuThuocTuTraLoiTikTok): Promise<KetQuaTuTraLoi> {
    const caiDat = await pt.kho.docCaiDat(kenhId)
    if (!caiDat?.bat) return 'tat'
    const kenh = await pt.docKenh(kenhId)
    if (!kenh?.accessToken) return 'tat'

    const tiktok = await pt.taoTikTok(kenh)
    const r = await tiktok.getMessages(hoiThoaiId, { pageSize: 20 })
    const ds: TinTikTokGoiY[] = (r.messages as TinTikTokGoiY[]).filter(m => m.isVisible !== false).slice().reverse()
    const daGui = await pt.kho.maTinDaGui(kenhId, hoiThoaiId)
    const maSp = [...new Set(ds.map(m => String(noiDungTho(m).product_id || '')).filter(Boolean))].slice(0, 10)
    const tenSp = maSp.length ? await pt.tenSanPham(kenhId, maSp) : new Map<string, string>()
    const tach = tachCauHoiTikTok(ds, tenSp, daGui)
    if (!tach) return 'khong_can'

    if (!(await pt.kho.giuCho(kenhId, hoiThoaiId, tach.tinCuoiId))) return 'da_xu_ly'
    const ket = (t: TrangThaiNhatKy, lyDo: string | null, ma?: string) => pt.kho.ghiKetQua(kenhId, hoiThoaiId, tach.tinCuoiId, t, lyDo, ma)
    try {
        return await sauGiuCho(kenhId, hoiThoaiId, kenh, tiktok, tach, ket, pt)
    } catch (e) {
        await ket('loi', `lỗi: ${moTaLoi(e).slice(0, 160)}`).catch(() => { })
        throw e
    }
}

async function sauGiuCho(
    kenhId: string, hoiThoaiId: string, kenh: any, tiktok: TikTokTuTraLoi,
    tach: NonNullable<ReturnType<typeof tachCauHoiTikTok>>,
    ket: (t: TrangThaiNhatKy, lyDo: string | null, ma?: string) => Promise<void>,
    pt: PhuThuocTuTraLoiTikTok,
): Promise<KetQuaTuTraLoi> {
    if ((await pt.kho.demDaGui(kenhId, 1)) >= TRAN_GIO) {
        const lyDo = `quá ${TRAN_GIO} tin tự động trong 1 giờ — tự tắt cho TikTok khỏi coi là spam`
        await pt.kho.tat(kenhId, lyDo)
        await ket('bo_qua', lyDo)
        return 'gian_tu_tat'
    }
    if ((await pt.kho.demDaGui(kenhId, 24, hoiThoaiId)) >= TRAN_HOI_THOAI) {
        await ket('bo_qua', `đã tự trả lời ${TRAN_HOI_THOAI} lần trong 24 giờ — để nhân viên`)
        return 'bo_qua'
    }

    const soan = await pt.soanGoiY(tach.cauHoi, tach.lichSu, String(kenh.name || ''))
    let khongTraLoi: string | null = null
    let cau = ''
    if (soan.loi) khongTraLoi = soan.loi
    else {
        const kiem = kiemCauTuDong(soan.traLoi, 'tiktok')
        if (kiem.ok) cau = kiem.cau
        else khongTraLoi = kiem.lyDo
    }
    if (khongTraLoi) {
        if ((await pt.kho.demTinCho(kenhId, hoiThoaiId, PHUT_TIN_CHO)) > 0) {
            const t: TrangThaiNhatKy = soan.loi ? 'loi' : 'bo_qua'
            await ket(t, `${khongTraLoi} — đã gửi tin chờ trong ${PHUT_TIN_CHO} phút qua, để nhân viên`)
            return t
        }
        cau = CAU_CHO
    }

    try {
        const gui = await tiktok.sendMessage(hoiThoaiId, cau)
        const lyDo = khongTraLoi ? `${TIEN_TO_TIN_CHO}${khongTraLoi}` : soan.canNhanVien ? `${TIEN_TO_CAN_NHAN_VIEN}AI chưa đủ căn cứ` : null
        await ket('da_gui', lyDo, gui.messageId || undefined)
        return khongTraLoi ? 'tin_cho' : 'da_gui'
    } catch (e) {
        const pl = phanLoaiLoiGuiTikTok(e)
        if (pl.loai === 'tat') {
            await pt.kho.tat(kenhId, pl.lyDo)
            await ket('loi', pl.lyDo)
            console.warn(`[Tự trả lời TikTok] kênh ${kenhId} TỰ TẮT: ${pl.lyDo}`)
            return 'gian_tu_tat'
        }
        await ket(pl.loai, pl.lyDo)
        return pl.loai
    }
}

/** Phụ thuộc thật — làm mới token TikTok sắp hết hạn (cùng luật getTikTokServiceForChannel ở routes/chat.ts) */
export function phuThuocTuTraLoiTikTokThat(db: any, soanGoiY: PhuThuocTuTraLoiTikTok['soanGoiY']): PhuThuocTuTraLoiTikTok {
    return {
        kho: khoTuTraLoiSql(db),
        async docKenh(kenhId) {
            const r: any[] = await db.$queryRawUnsafe(`SELECT * FROM "OnlineChannel" WHERE "id" = $1 AND "platform" = 'tiktok' LIMIT 1`, kenhId)
            return r[0] || null
        },
        async taoTikTok(k) {
            const svc = new TikTokService({
                apiKey: k.apiKey || '', apiSecret: k.apiSecret || '', accessToken: k.accessToken || '',
                refreshToken: k.refreshToken || '', shopId: k.shopId || '',
            })
            if (k.tokenExpiresAt && new Date(k.tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
                try {
                    const tokens = await svc.refreshAccessToken();
                    (svc as any).credentials.accessToken = tokens.accessToken;
                    (svc as any).credentials.refreshToken = tokens.refreshToken
                    await db.$executeRawUnsafe(
                        `UPDATE "OnlineChannel" SET "accessToken" = $1, "refreshToken" = $2, "tokenExpiresAt" = $3, "updatedAt" = NOW() WHERE "id" = $4`,
                        tokens.accessToken, tokens.refreshToken, new Date(Date.now() + tokens.expiresIn * 1000), k.id)
                } catch (e: any) { console.error('[Tự trả lời TikTok] làm mới token:', e?.message || e) }
            }
            return svc
        },
        tenSanPham: (kenhId, maSp) => tenSanPhamCuaGian(db, kenhId, maSp),
        soanGoiY,
        cho: (ms) => new Promise(r => setTimeout(r, ms)),
    }
}
