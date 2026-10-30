/**
 * Kiểm CHAT TIKTOK: tách bên theo vai trò + TỰ TRẢ LỜI bằng chatbot — npx tsx scripts/check-tiktok-chat.ts (30/10/2026)
 *
 * Chủ shop ngay khi chat TikTok về: "chưa có phân biệt bên nào với bên nào nè, với lại chưa có tự trả lời nha". Lõi
 * lib/tuTraLoiTikTok.ts (cùng khuôn lib/tuTraLoiShopee.ts). Sai ở đây là: coi lời chào / FAQ tự động của TikTok (role SHOP bắn
 * ngay) là gian đã trả lời rồi bỏ mặc khách; trả lời một tin khách hai lần; gửi câu kéo khách sang Shopee / link ngoài; không tự
 * tắt khi TikTok hết hạn mức — mỗi thứ một ca. Prisma giả / dịch vụ giả.
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'ab'.repeat(32)

import {
    chuTinTikTok, tachCauHoiTikTok, phanLoaiLoiGuiTikTok, tuTraLoiTikTok, NGUONG_TU_DONG_GIAY,
    type TinTikTokGoiY, type PhuThuocTuTraLoiTikTok,
} from '../src/lib/tuTraLoiTikTok'
import { kiemCauTuDong, CAU_CHO, TRAN_GIO, type KhoTuTraLoi, type TrangThaiNhatKy } from '../src/lib/tuTraLoiShopee'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
let soTin = 0
const tin = (fromRole: string, content: string, x: Partial<TinTikTokGoiY> = {}): TinTikTokGoiY => {
    soTin++
    return { messageId: `m${soTin}`, messageType: 'text', content, fromRole, createdTimestamp: 1_700_000_000 + soTin * 100, isVisible: true, ...x }
}
const SP = new Map([['p1', 'Nồi cơm điện 1.8L (SKU NC18)']])

async function main() {
    console.log('\n▶ Chat TikTok — tách bên + tự trả lời\n')

    /* 1 — Chữ của tin cho AI */
    {
        ok('1a. Tin chữ giữ nguyên; thẻ sản phẩm ⇒ tên hàng của gian', chuTinTikTok(tin('BUYER', 'còn hàng không'), SP) === 'còn hàng không'
            && chuTinTikTok(tin('BUYER', '', { messageType: 'product_card', sourceContent: '{"product_id":"p1"}' }), SP) === '[Gửi thẻ sản phẩm: Nồi cơm điện 1.8L (SKU NC18)]')
        ok('1b. Thẻ sản phẩm chưa có trong gian ⇒ ghi mã; thẻ đơn ⇒ số đơn; ảnh / sticker', chuTinTikTok(tin('BUYER', '', { messageType: 'buyer_enter_from_product', sourceContent: '{"product_id":"p9"}' }), SP) === '[Gửi thẻ sản phẩm: mã p9 trên TikTok]'
            && chuTinTikTok(tin('BUYER', '', { messageType: 'order_card', sourceContent: { order_id: '5868' } }), SP) === '[Gửi thẻ đơn hàng #5868]'
            && chuTinTikTok(tin('BUYER', '', { messageType: 'image' }), SP) === '[Gửi ảnh]' && chuTinTikTok(tin('BUYER', '', { messageType: 'emoticons' }), SP) === '[Gửi sticker]')
        ok('1c. Loại khác ⇒ ưu tiên bản chữ TikTok trả (plaintext), không thì content', chuTinTikTok(tin('SYSTEM', '[Other] Please check…', { messageType: 'notification', plaintext: 'Đơn hàng đã được giao' }), SP) === 'Đơn hàng đã được giao'
            && chuTinTikTok(tin('SYSTEM', 'xx', { messageType: 'notification' }), SP) === 'xx')
    }

    /* 2 — Tách câu hỏi theo vai trò */
    {
        const a = tachCauHoiTikTok([tin('BUYER', 'Nồi này bảo hành bao lâu?')], SP)
        ok('2a. Khách hỏi, chưa ai trả lời ⇒ câu hỏi + tinCuoiId, lịch sử rỗng', a?.cauHoi === 'Nồi này bảo hành bao lâu?' && a.tinCuoiId === 'm' + soTin && a.lichSu.length === 0, a)
        const q = tin('BUYER', 'Giá bao nhiêu?')
        ok('2b. Nhân viên (CUSTOMER_SERVICE) đã trả lời sau ⇒ không cần', tachCauHoiTikTok([q, tin('CUSTOMER_SERVICE', 'Dạ 850k ạ')], SP) === null)
        const q2 = tin('BUYER', 'Có ship Hà Nội không?')
        const faq = tin('SHOP', 'Cảm ơn bạn đã nhắn, shop sẽ trả lời ngay', { createdTimestamp: q2.createdTimestamp! + 3 })
        ok('2c. SHOP bắn 3 giây sau tin khách = FAQ / lời chào tự động của TikTok ⇒ KHÔNG tính là trả lời, vẫn hỏi', tachCauHoiTikTok([q2, faq], SP)?.cauHoi === 'Có ship Hà Nội không?')
        const nguoi = tin('SHOP', 'Dạ có ship Hà Nội ạ', { createdTimestamp: q2.createdTimestamp! + NGUONG_TU_DONG_GIAY + 40 })
        ok('2d. SHOP trả lời sau 60 giây = người thật ⇒ đã trả lời', tachCauHoiTikTok([q2, nguoi], SP) === null)
        const q3 = tin('BUYER', 'Còn màu đỏ không?')
        ok('2e. ROBOT / SYSTEM sau tin khách không tính là trả lời và không vào lịch sử', (() => { const r = tachCauHoiTikTok([tin('SYSTEM', 'Đơn đã giao', { messageType: 'notification' }), q3, tin('ROBOT', 'Shop đang bận')], SP); return r?.cauHoi === 'Còn màu đỏ không?' && r.lichSu.length === 0 })())
        // chatbot của mình đã trả lời TỚI tin khách m-x; khách nhắn thêm sau đó ⇒ chỉ phần mới
        const k1 = tin('BUYER', 'Hỏi 1'), k2 = tin('BUYER', 'Hỏi 2'), bot = tin('SHOP', 'Trả lời cho hỏi 1', { createdTimestamp: k2.createdTimestamp! + 1 })
        const r = tachCauHoiTikTok([k1, k2, bot], SP, new Map([[bot.messageId, k1.messageId]]))
        ok('2f. Tin chatbot (nhật ký daGui) chỉ trả lời tới tin khách nó đã đọc ⇒ "Hỏi 2" vẫn là câu hỏi, lịch sử có hỏi 1 / trả lời', r?.cauHoi === 'Hỏi 2' && r.tinCuoiId === k2.messageId && r.lichSu.length === 2 && r.lichSu[0]!.role === 'user' && r.lichSu[1]!.role === 'model', r)
        const r2 = tachCauHoiTikTok([k1, k2, bot], SP, new Set([bot.messageId]))
        ok('2g. daGui dạng Set (không biết trả lời tới đâu) ⇒ tin bot tính như trả lời hết ⇒ null', r2 === null)
        const dai = Array.from({ length: 30 }, (_, i) => i % 2 ? tin('CUSTOMER_SERVICE', `tl ${i}`) : tin('BUYER', `hỏi ${i}`))
        const r3 = tachCauHoiTikTok([...dai, tin('BUYER', 'mới nhất')], SP)
        ok('2h. Lịch sử ≤ 12 lượt, bắt đầu bằng khách; câu hỏi chỉ phần sau trả lời cuối', r3?.cauHoi === 'mới nhất' && r3.lichSu.length <= 12 && r3.lichSu[0]!.role === 'user')
        ok('2i. Hai tin khách liền nhau gộp thành một câu hỏi, cách dòng', tachCauHoiTikTok([tin('BUYER', 'a'), tin('BUYER', 'b')], SP)?.cauHoi === 'a\nb')
    }

    /* 3 — Câu tự động theo sàn + phân loại lỗi gửi */
    {
        ok('3a. TikTok: cấm nhắc Shopee / link ngoài; link tiktok.com thì được', !kiemCauTuDong('Bạn qua Shopee mua nhé', 'tiktok').ok && !kiemCauTuDong('Xem tại https://kengi.vn/x', 'tiktok').ok
            && kiemCauTuDong('Dạ còn hàng, bạn đặt tại https://shop.tiktok.com/view/product/1 ạ', 'tiktok').ok)
        ok('3b. Shopee (mặc định) vẫn như cũ: cấm nhắc TikTok, cho link shopee.vn', !kiemCauTuDong('Bạn qua TikTok mua nhé').ok && kiemCauTuDong('Xem https://shopee.vn/a').ok)
        ok('3c. Hai sàn đều cấm số điện thoại / Zalo', !kiemCauTuDong('Gọi 0901234567 nhé', 'tiktok').ok && !kiemCauTuDong('Kết bạn Zalo shop', 'tiktok').ok)
        ok('3d. Hết hạn mức 45101004 / mất quyền 105005 ⇒ TỰ TẮT; hội thoại không còn ⇒ bỏ qua; khác ⇒ lỗi',
            phanLoaiLoiGuiTikTok(new Error('TikTok sendMessage: [45101004] The query quota has been reached')).loai === 'tat'
            && phanLoaiLoiGuiTikTok(new Error('TikTok sendMessage: [105005] Access denied')).loai === 'tat'
            && phanLoaiLoiGuiTikTok(new Error('[45101003] Record not found')).loai === 'bo_qua'
            && phanLoaiLoiGuiTikTok(new Error('ECONNRESET')).loai === 'loi')
    }

    /* 4 — Luồng tự trả lời với kho + dịch vụ giả */
    {
        type Dong = { tt: TrangThaiNhatKy; lyDo: string | null; ma?: string | null }
        function gia(o: { bat?: boolean; tin?: TinTikTokGoiY[]; daGui?: number; daGuiHoiThoai?: number; tinCho?: number; ai?: { traLoi: string; canNhanVien?: boolean; loi?: string | null }; loiGui?: string; daGiu?: Set<string> } = {}) {
            const st = { nhatKy: new Map<string, Dong>(), gui: [] as { hoiThoai: string; text: string }[], tat: null as string | null, docKenh: 0, cho: 0 }
            const giu = o.daGiu || new Set<string>()
            // Hội thoại giả cố định cho cả lượt (mỗi lần đọc TikTok vẫn trả cùng mã tin — tạo mới mỗi lần đọc là mã khác, giữ chỗ lại qua)
            const tinMacDinh: TinTikTokGoiY[] = o.tin || [tin('BUYER', 'Nồi này bảo hành bao lâu?')]
            const kho: KhoTuTraLoi = {
                async docCaiDat() { return { bat: o.bat !== false && !st.tat } },
                async giuCho(_k, _h, tinKhachId) { if (giu.has(tinKhachId)) return false; giu.add(tinKhachId); st.nhatKy.set(tinKhachId, { tt: 'dang', lyDo: null }); return true },
                async ghiKetQua(_k, _h, tinKhachId, tt, lyDo, ma) { st.nhatKy.set(tinKhachId, { tt, lyDo, ma }) },
                async demDaGui(_k, _gio, hoiThoai) { return hoiThoai ? (o.daGuiHoiThoai || 0) : (o.daGui || 0) },
                async maTinDaGui() { return new Map() },
                async demTinCho() { return o.tinCho || 0 },
                async tat(_k, lyDo) { st.tat = lyDo },
            }
            const pt: PhuThuocTuTraLoiTikTok = {
                kho,
                async docKenh(id) { st.docKenh++; return { id, name: 'Kengi Store', accessToken: 'tok', platform: 'tiktok' } },
                async taoTikTok() {
                    return {
                        async getMessages() { return { messages: [...tinMacDinh].reverse() } },   // TikTok trả mới trước
                        async sendMessage(hoiThoai: string, text: string) { if (o.loiGui) throw new Error(o.loiGui); st.gui.push({ hoiThoai, text }); return { messageId: `g${st.gui.length}` } },
                    }
                },
                async tenSanPham() { return SP },
                async soanGoiY() { return { traLoi: o.ai?.traLoi ?? 'Dạ nồi bảo hành 12 tháng tại hãng ạ', canNhanVien: !!o.ai?.canNhanVien, loi: o.ai?.loi ?? null } },
                async cho() { st.cho++ },
            }
            return { st, pt, kho }
        }
        const KENH = { id: 'k-tt', name: 'Kengi Store' }
        const PUSH = { conversation_id: '7702263563221516562', message_id: 'm-push', type: 'TEXT', sender: { im_user_id: '1', role: 'BUYER' } }

        const a = gia()
        const kqA = await tuTraLoiTikTok(KENH, PUSH, a.pt)
        ok('4a. Khách hỏi ⇒ gom (cho) 1 lần, gửi câu AI theo conversationId, nhật ký da_gui kèm mã tin gửi', kqA === 'da_gui' && a.st.cho === 1 && a.st.gui.length === 1 && a.st.gui[0]!.hoiThoai === PUSH.conversation_id && /12 tháng/.test(a.st.gui[0]!.text) && [...a.st.nhatKy.values()][0]!.tt === 'da_gui' && [...a.st.nhatKy.values()][0]!.ma === 'g1', { kqA, st: a.st })
        ok('4b. Gian tắt ⇒ tat, không đọc kênh', (await tuTraLoiTikTok(KENH, PUSH, gia({ bat: false }).pt)) === 'tat')
        ok('4c. Push từ SHOP / CUSTOMER_SERVICE / ROBOT ⇒ tin_cua_gian; thiếu conversation_id ⇒ thieu_hoi_thoai',
            (await tuTraLoiTikTok(KENH, { ...PUSH, sender: { role: 'SHOP' } }, gia().pt)) === 'tin_cua_gian'
            && (await tuTraLoiTikTok(KENH, { ...PUSH, sender: { role: 'ROBOT' } }, gia().pt)) === 'tin_cua_gian'
            && (await tuTraLoiTikTok(KENH, { ...PUSH, conversation_id: 'abc' }, gia().pt)) === 'thieu_hoi_thoai')
        const b = gia({ tin: [tin('BUYER', 'hỏi'), tin('CUSTOMER_SERVICE', 'đã trả lời')] })
        ok('4d. Nhân viên đã trả lời ⇒ khong_can, không gửi', (await tuTraLoiTikTok(KENH, PUSH, b.pt)) === 'khong_can' && b.st.gui.length === 0)
        const c = gia()
        const tinC = tin('BUYER', 'x'); c.st; const ptC = { ...c.pt, async taoTikTok() { return { async getMessages() { return { messages: [tinC] } }, async sendMessage() { return { messageId: 'g' } } } } }
        const daGiu = new Set([tinC.messageId])
        const c2 = gia({ daGiu, tin: [tinC] })
        ok('4e. Tin khách đã giữ chỗ (push lặp / bản máy khác) ⇒ da_xu_ly, không gửi lần hai', (await tuTraLoiTikTok(KENH, PUSH, c2.pt)) === 'da_xu_ly' && c2.st.gui.length === 0)
        void ptC
        const d = gia({ ai: { traLoi: '', loi: 'Key Gemini hết tiền' } })
        const kqD = await tuTraLoiTikTok(KENH, PUSH, d.pt)
        ok('4f. AI lỗi ⇒ gửi TIN CHỜ, nhật ký "tin chờ — …"', kqD === 'tin_cho' && d.st.gui[0]!.text === CAU_CHO && /^tin chờ — Key Gemini/.test([...d.st.nhatKy.values()][0]!.lyDo || ''), d.st)
        const e = gia({ ai: { traLoi: 'Bạn qua Shopee mua giúp shop' } })
        ok('4g. Câu AI kéo khách sang sàn khác ⇒ không gửi câu đó, gửi tin chờ', (await tuTraLoiTikTok(KENH, PUSH, e.pt)) === 'tin_cho' && e.st.gui[0]!.text === CAU_CHO)
        const f = gia({ ai: { traLoi: '', loi: 'AI hỏng' }, tinCho: 1 })
        ok('4h. Đã gửi tin chờ trong 30 phút ⇒ không gửi nữa, nhật ký loi', (await tuTraLoiTikTok(KENH, PUSH, f.pt)) === 'loi' && f.st.gui.length === 0)
        const g = gia({ daGui: TRAN_GIO })
        ok('4i. Quá 60 tin/giờ ⇒ TỰ TẮT gian, không gửi', (await tuTraLoiTikTok(KENH, PUSH, g.pt)) === 'gian_tu_tat' && !!g.st.tat && g.st.gui.length === 0)
        const h = gia({ daGuiHoiThoai: 30 })
        ok('4j. Quá 30 tin/hội thoại/ngày ⇒ bỏ qua, để nhân viên', (await tuTraLoiTikTok(KENH, PUSH, h.pt)) === 'bo_qua' && h.st.gui.length === 0)
        const i = gia({ loiGui: 'TikTok sendMessage: [45101004] The query quota has been reached (10000 request per day)' })
        ok('4k. TikTok báo hết hạn mức ngày khi gửi ⇒ tự tắt gian, nhật ký loi', (await tuTraLoiTikTok(KENH, PUSH, i.pt)) === 'gian_tu_tat' && /hạn mức/.test(i.st.tat || ''))
        const j = gia({ ai: { traLoi: 'Dạ shop kiểm tra giúp bạn', canNhanVien: true } })
        await tuTraLoiTikTok(KENH, PUSH, j.pt)
        ok('4l. AI chưa đủ căn cứ vẫn gửi câu lịch sự, nhật ký "cần nhân viên — …"', j.st.gui.length === 1 && /^cần nhân viên — /.test([...j.st.nhatKy.values()][0]!.lyDo || ''))
        // gom: hai push cùng hội thoại tới dồn ⇒ lượt sau trả dang_cho, lượt đầu chạy thêm vòng
        const k = gia()
        let thaGom: (() => void) | null = null
        const ptK: PhuThuocTuTraLoiTikTok = { ...k.pt, cho: () => new Promise<void>(r => { thaGom = r }) }
        const p1 = tuTraLoiTikTok(KENH, PUSH, ptK)
        await new Promise(r => setTimeout(r, 5))
        const kq2 = await tuTraLoiTikTok(KENH, PUSH, ptK)
        const tha = thaGom as unknown as (() => void) | null
        tha?.()
        await new Promise(r => setTimeout(r, 5))
        const tha2 = thaGom as unknown as (() => void) | null
        if (tha2 && tha2 !== tha) tha2()
        const kq1 = await p1
        // vòng gom thứ hai thấy tin khách đã giữ chỗ ⇒ da_xu_ly (kết quả vòng cuối) — điều cần giữ là chỉ gửi MỘT tin
        ok('4m. Push dồn trong lúc đang gom ⇒ lượt sau "dang_cho", lượt đầu gom lại rồi gửi đúng MỘT tin', kq2 === 'dang_cho' && (kq1 === 'da_gui' || kq1 === 'da_xu_ly') && k.st.gui.length === 1, { kq1, kq2, gui: k.st.gui.length })
    }

    console.log(`\n${hong ? '✗' : '✓'} ${dat} đạt, ${hong} hỏng\n`)
    process.exit(hong ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
