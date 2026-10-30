/**
 * Kiểm DUYỆT TIN CHAT AI TRƯỚC KHI GỬI — npx tsx scripts/check-chat-cho-duyet.ts (30/10/2026)
 *
 * Chủ shop: tin chatbot gửi bằng send_autoreply_message mang nhãn tự động nên Shopee không tính vào Tỷ lệ phản hồi Chat — "chỉnh
 * bên file apk để t duyệt". Lõi: lib/tuTraLoiShopee.ts (chế độ cho_duyet) + lib/choDuyetChat.ts + routes/chatChoDuyet.ts.
 * Sai ở đây là: chế độ chờ duyệt mà vẫn TỰ gửi cho khách (kể cả tin chờ); một bản nháp bị gửi HAI lần (hai máy bấm / bấm lại);
 * gửi chồng lên câu người của gian đã trả lời; gửi lỗi mà bản nháp biến mất khỏi hàng chờ; push lặp bắn hai thông báo; khoá
 * admin (máy, không phải người) gửi được tin cho khách; thông báo mang chữ tin khách. Mỗi thứ một ca. Kho / Shopee / AI giả.
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'ab'.repeat(32)

import { readFileSync } from 'fs'
import { join } from 'path'
import { tuTraLoiShopee, KhoTuTraLoi, PhuThuocTuTraLoi, CAU_CHO, CheDoTuTraLoi } from '../src/lib/tuTraLoiShopee'
import { guiNhapDaDuyet, daCoNguoiTraLoiSau, phutConLai, KhoChoDuyet, BanNhap, NhapMoi, HAN_PHAN_HOI_PHUT } from '../src/lib/choDuyetChat'
import type { TinShopeeGoiY } from '../src/services/platforms/shopee'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

const khach = (id: string, text: string): TinShopeeGoiY => ({ messageId: id, messageType: 'text', content: text, fromId: 777, fromShopId: 0, status: 'normal', source: 'android' })
const gian = (id: string, text: string, them: Partial<TinShopeeGoiY> = {}): TinShopeeGoiY => ({ messageId: id, messageType: 'text', content: text, fromId: 1, fromShopId: 42, status: 'normal', source: 'mini_webchat', ...them })

/* ── A. Tự trả lời ở chế độ chờ duyệt ─────────────────────────────────────────────────────────────────────────────────── */
function dung(o: { cheDo?: CheDoTuTraLoi; tin?: TinShopeeGoiY[]; soan?: PhuThuocTuTraLoi['soanGoiY']; luuTraNull?: boolean; khongCoLuu?: boolean } = {}) {
    const nk = new Map<string, { trangThai: string; lyDo: string | null; maTinGui: string | null }>()
    const kho: KhoTuTraLoi = {
        async docCaiDat() { return { bat: true, ...(o.cheDo ? { cheDo: o.cheDo } : {}) } },
        async giuCho(k, h, t) { const key = `${k}|${h}|${t}`; if (nk.has(key)) return false; nk.set(key, { trangThai: 'dang', lyDo: null, maTinGui: null }); return true },
        async ghiKetQua(k, h, t, tt, ly, ma) { Object.assign(nk.get(`${k}|${h}|${t}`)!, { trangThai: tt, lyDo: ly, maTinGui: ma || null }) },
        async demDaGui() { return 0 },
        async maTinDaGui() { return new Map() },
        async demTinCho() { return 0 },
        async tat() { },
    }
    const tuDong: string[] = [], thuong: string[] = [], luu: NhapMoi[] = [], bao: any[] = []
    const shopee = {
        async getMessages() { return { messages: (o.tin || [khach('c1', 'bao hanh bao lau')]).slice().reverse() } },
        async sendAutoReplyMessage(_: number, text: string) { tuDong.push(text); return { messageId: `bot${tuDong.length}` } },
        async sendMessage(_: number, text: string) { thuong.push(text); return { messageId: 'x' } },
    }
    const pt: PhuThuocTuTraLoi = {
        kho, docKenh: async () => ({ id: 'k1', shopId: '42', name: 'Gian A', accessToken: 't' }), taoShopee: () => shopee as any,
        tenSanPham: async () => new Map(), cho: async () => { },
        soanGoiY: async (...a) => o.soan ? o.soan(...a) : { traLoi: 'Dạ sản phẩm bảo hành 12 tháng ạ', canNhanVien: false },
        ...(o.khongCoLuu ? {} : {
            luuChoDuyet: async (n: NhapMoi) => { luu.push(n); return o.luuTraNull ? null : `id${luu.length}` },
            baoChoDuyet: async (n: any) => { bao.push(n) },
        }),
    }
    return { pt, nk, tuDong, thuong, luu, bao }
}
const kenh = { id: 'k1', shopId: '42', name: 'Gian A' }
const push = { conversation_id: '555', from_shop_id: 0, from_user_name: 'khach_abc' }

/* ── B. Kho nháp giả trong bộ nhớ — đúng ngữ nghĩa khoChoDuyetSql ───────────────────────────────────────────────────────── */
function khoGia(trangThaiDau: BanNhap['trangThai'] = 'cho') {
    const n: BanNhap = {
        id: 'k1:555:c1', kenhId: 'k1', hoiThoaiId: '555', tinKhachId: 'c1', nguoiMuaId: '777', tenKhach: 'khach_abc',
        traLoi: 'Dạ còn hàng ạ', canNhanVien: false, ghiChu: null, trangThai: trangThaiDau, taoLuc: new Date().toISOString(),
        xuLyBoi: null, maTinGui: null, loi: null,
    }
    const kho: KhoChoDuyet = {
        async luu() { return null },
        async danhSach() { return n.trangThai === 'cho' ? [n] : [] },
        async doc(id) { return id === n.id ? { ...n } : null },
        async giuChoGui(id, nguoi) { if (id !== n.id || n.trangThai !== 'cho') return false; n.trangThai = 'dang_gui'; n.xuLyBoi = nguoi; return true },
        async ketThuc(_id, tt, x) { n.trangThai = tt; if (x.xuLyBoi !== undefined && x.xuLyBoi !== null) n.xuLyBoi = x.xuLyBoi; if (x.maTinGui) n.maTinGui = x.maTinGui; n.loi = x.loi ?? null; if (tt !== 'cho') n.traLoi = '' },
        async bo(id, nguoi, ly) { if (id !== n.id || n.trangThai !== 'cho') return false; n.trangThai = 'bo'; n.xuLyBoi = nguoi; n.loi = ly; n.traLoi = ''; return true },
    }
    return { kho, n }
}
function ptGui(kho: KhoChoDuyet, o: { tin?: TinShopeeGoiY[]; loiDoc?: boolean; loiGui?: number; choGui?: () => Promise<void> } = {}) {
    const gui: { toId: string; cau: string }[] = []; const nhatKy: string[] = []
    let loiGuiCon = o.loiGui || 0
    return {
        gui, nhatKy,
        pt: {
            kho,
            async docTin() { if (o.loiDoc) throw new Error('Shopee 500'); return { ds: o.tin || [khach('c1', 'con hang khong')], shopId: '42' } },
            async gui(n: BanNhap, cau: string) { if (o.choGui) await o.choGui(); if (loiGuiCon-- > 0) throw new Error('Shopee sendMessage: exceed_send_limitation - x'); gui.push({ toId: n.nguoiMuaId, cau }); return { messageId: `m${gui.length}` } },
            async ghiNhatKy(_: BanNhap, t: string, ly: string) { nhatKy.push(`${t}|${ly}`) },
        },
    }
}

async function main() {
    console.log('\n▶ Duyệt tin chat AI trước khi gửi\n')

    // A
    {
        const e = dung({ cheDo: 'cho_duyet' })
        const k = await tuTraLoiShopee(kenh, push, e.pt)
        ok('A1. chế độ chờ duyệt ⇒ KHÔNG gửi gì cho khách (cả tin tự động lẫn tin thường), lưu MỘT nháp đúng câu AI + người mua + tin khách + tên khách',
            k === 'cho_duyet' && e.tuDong.length === 0 && e.thuong.length === 0 && e.luu.length === 1 && e.luu[0]!.traLoi === 'Dạ sản phẩm bảo hành 12 tháng ạ'
            && e.luu[0]!.nguoiMuaId === '777' && e.luu[0]!.tinKhachId === 'c1' && e.luu[0]!.tenKhach === 'khach_abc', { k, tuDong: e.tuDong, luu: e.luu })
        ok('A2. nhật ký ghi cho_duyet (không phải da_gui ⇒ không tính vào trần tin tự động) và báo điện thoại MỘT lần kèm tên gian',
            e.nk.get('k1|555|c1')?.trangThai === 'cho_duyet' && e.bao.length === 1 && e.bao[0].tenGian === 'Gian A' && e.bao[0].id === 'id1', { nk: [...e.nk.values()], bao: e.bao })
        const lai = await tuTraLoiShopee(kenh, push, e.pt)
        ok('A3. cùng tin khách được push lại ⇒ không soạn / lưu / báo lần hai', lai === 'da_xu_ly' && e.luu.length === 1 && e.bao.length === 1, { lai })
    }
    {
        const e = dung({ cheDo: 'cho_duyet', soan: async () => ({ traLoi: '', canNhanVien: true, loi: 'chưa có key Gemini' }) })
        const k = await tuTraLoiShopee(kenh, push, e.pt)
        ok('A4. AI hỏng ⇒ vẫn lưu nháp TRỐNG kèm lý do cho người tự gõ; KHÔNG gửi tin chờ (tin tự động không được tính)',
            k === 'cho_duyet' && e.tuDong.length === 0 && !e.tuDong.includes(CAU_CHO) && e.luu[0]?.traLoi === '' && /AI không soạn được/.test(e.luu[0]?.ghiChu || ''), { k, luu: e.luu })
    }
    {
        const e = dung({ cheDo: 'cho_duyet', soan: async () => ({ traLoi: 'Bạn gọi 0912 345 678 nhé', canNhanVien: false }) })
        await tuTraLoiShopee(kenh, push, e.pt)
        ok('A5. AI đưa SĐT / kênh ngoài ⇒ KHÔNG điền câu đó vào nháp, ghi lý do', e.luu[0]?.traLoi === '' && /số điện thoại/.test(e.luu[0]?.ghiChu || '') && e.tuDong.length === 0, e.luu)
    }
    {
        const e = dung({ cheDo: 'cho_duyet', soan: async () => ({ traLoi: 'Dạ shop kiểm tra đơn giúp bạn nhé', canNhanVien: true }) })
        await tuTraLoiShopee(kenh, push, e.pt)
        ok('A6. AI chưa đủ căn cứ ⇒ giữ câu, nhắc đọc kỹ', e.luu[0]?.traLoi === 'Dạ shop kiểm tra đơn giúp bạn nhé' && e.luu[0]?.canNhanVien === true && /đọc kỹ/.test(e.luu[0]?.ghiChu || ''), e.luu)
    }
    {
        const e = dung({ cheDo: 'cho_duyet', luuTraNull: true })
        await tuTraLoiShopee(kenh, push, e.pt)
        ok('A7. nháp đã có sẵn (máy khác lưu trước) ⇒ không bắn thông báo thứ hai', e.luu.length === 1 && e.bao.length === 0)
    }
    {
        const e = dung({ cheDo: 'tu_gui' })
        const k = await tuTraLoiShopee(kenh, push, e.pt)
        ok('A8. chế độ tự gửi ⇒ như cũ: một tin tự động, không lưu nháp', k === 'da_gui' && e.tuDong.length === 1 && e.luu.length === 0 && e.thuong.length === 0, { k })
    }
    {
        const e = dung({ cheDo: 'cho_duyet', tin: [khach('c1', 'Q'), gian('nv', 'Dạ có ạ')] })
        const k = await tuTraLoiShopee(kenh, push, e.pt)
        ok('A9. người của gian đã trả lời trước lúc soạn ⇒ không có nháp', k === 'khong_can' && e.luu.length === 0, { k })
    }

    // B
    {
        const { kho, n } = khoGia()
        const g = ptGui(kho)
        const rong = await guiNhapDaDuyet(g.pt, n.id, '   ', 'a@x')
        const dai = await guiNhapDaDuyet(g.pt, n.id, 'a'.repeat(1001), 'a@x')
        ok('B1. câu trống / quá 1000 ký tự ⇒ từ chối, KHÔNG giữ chỗ', !rong.ok && rong.ma === 'noi_dung' && !dai.ok && dai.ma === 'noi_dung' && n.trangThai === 'cho' && g.gui.length === 0)
        const kq = await guiNhapDaDuyet(g.pt, n.id, '  Dạ còn hàng ạ, bạn đặt luôn nhé  ', 'a@x')
        ok('B2. người bấm Gửi ⇒ gửi TIN THƯỜNG đúng người mua, câu đã cắt khoảng trắng; nháp da_gui + mã tin + người bấm, xoá câu',
            kq.ok && g.gui.length === 1 && g.gui[0]!.toId === '777' && g.gui[0]!.cau === 'Dạ còn hàng ạ, bạn đặt luôn nhé'
            && n.trangThai === 'da_gui' && n.maTinGui === 'm1' && n.xuLyBoi === 'a@x' && n.traLoi === '', { kq, n })
        ok('B3. nhật ký ghi da_duyet kèm người duyệt (không ghi mã tin ⇒ web không gắn nhãn Chatbot cho tin người gửi)', g.nhatKy.length === 1 && g.nhatKy[0]!.startsWith('da_duyet|') && g.nhatKy[0]!.includes('a@x'), g.nhatKy)
        const lai = await guiNhapDaDuyet(g.pt, n.id, 'Dạ còn hàng ạ', 'b@x')
        ok('B4. bấm lại / máy khác bấm sau ⇒ khong_con, không gửi lần hai', !lai.ok && lai.ma === 'khong_con' && g.gui.length === 1, lai)
    }
    {
        const { kho, n } = khoGia()
        let mo: () => void = () => { }
        const chan = new Promise<void>(r => { mo = r })
        const g = ptGui(kho, { choGui: () => chan })
        const p1 = guiNhapDaDuyet(g.pt, n.id, 'Dạ có ạ', 'a@x')
        const p2 = guiNhapDaDuyet(g.pt, n.id, 'Dạ có ạ', 'b@x')
        await new Promise(r => setTimeout(r, 10)); mo()
        const [k1, k2] = await Promise.all([p1, p2])
        ok('B5. hai máy bấm Gửi CÙNG LÚC ⇒ đúng MỘT tin tới khách', g.gui.length === 1 && [k1, k2].filter(k => k.ok).length === 1, { k1, k2, gui: g.gui.length })
    }
    {
        const { kho, n } = khoGia()
        const g = ptGui(kho, { tin: [khach('c1', 'con hang khong'), gian('nv', 'Dạ còn ạ')] })
        const kq = await guiNhapDaDuyet(g.pt, n.id, 'Dạ còn hàng ạ', 'a@x')
        ok('B6. người của gian đã trả lời sau tin khách ⇒ KHÔNG gửi chồng, cất nháp (bo)', !kq.ok && kq.ma === 'da_co_nguoi_tra_loi' && g.gui.length === 0 && n.trangThai === 'bo', { kq, n: n.trangThai })
    }
    {
        const { kho, n } = khoGia()
        const g = ptGui(kho, { tin: [khach('c1', 'Q'), gian('s1', 'Voucher', { source: 'server' }), gian('a1', 'Chào bạn', { status: 'auto_reply', source: 'openapi' })] })
        const kq = await guiNhapDaDuyet(g.pt, n.id, 'Dạ có ạ', 'a@x')
        ok('B7. tin Shopee tự sinh (voucher) / tin tự động có nhãn KHÔNG tính là người đã trả lời ⇒ vẫn gửi', kq.ok && g.gui.length === 1, kq)
    }
    {
        const { kho, n } = khoGia()
        const g = ptGui(kho, { loiDoc: true })
        const kq = await guiNhapDaDuyet(g.pt, n.id, 'Dạ có ạ', 'a@x')
        ok('B8. không đọc được hội thoại ⇒ không gửi, nháp TRỞ LẠI hàng chờ để bấm lại', !kq.ok && kq.ma === 'loi_doc' && g.gui.length === 0 && n.trangThai === 'cho' && n.traLoi === 'Dạ còn hàng ạ', { kq, n })
    }
    {
        const { kho, n } = khoGia()
        const g = ptGui(kho, { loiGui: 1 })
        const kq1 = await guiNhapDaDuyet(g.pt, n.id, 'Dạ có ạ', 'a@x')
        const giuSauLoi = n.trangThai, loiGhi = n.loi
        const kq2 = await guiNhapDaDuyet(g.pt, n.id, 'Dạ có ạ', 'a@x')
        ok('B9. Shopee từ chối lúc gửi ⇒ báo lỗi, nháp VẪN ở hàng chờ kèm lỗi; bấm lại thì gửi được',
            !kq1.ok && kq1.ma === 'loi_gui' && giuSauLoi === 'cho' && /exceed_send_limitation/.test(loiGhi || '') && kq2.ok && g.gui.length === 1, { kq1, kq2, giuSauLoi })
    }

    // C + D
    ok('C1. tin khách không còn trong trang vừa đọc ⇒ xét cả trang: có tin người của gian ⇒ đã trả lời',
        daCoNguoiTraLoiSau([gian('nv', 'Dạ')], 'c-cu', 42) === true && daCoNguoiTraLoiSau([khach('c2', 'Q')], 'c-cu', 42) === false)
    ok('C2. tin người của gian đứng TRƯỚC tin khách không tính', daCoNguoiTraLoiSau([gian('nv', 'Dạ'), khach('c1', 'Q')], 'c1', 42) === false)
    const t0 = Date.parse('2026-10-30T00:00:00Z')
    ok(`D1. hạn Shopee ${HAN_PHAN_HOI_PHUT / 60} giờ tính từ tin khách CŨ NHẤT chưa trả lời; quá hạn ra số âm; thiếu giờ tin ⇒ tính từ lúc tạo nháp`,
        phutConLai(t0, t0 + 3600_000, t0 + 3 * 3600_000) === 540 && phutConLai(t0, t0, t0 + 13 * 3600_000) === -60 && phutConLai(null, t0, t0 + 60_000) === 719)

    // E — soát tĩnh các chỗ nối
    const doc = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n')
    const route = doc('src/routes/chatChoDuyet.ts')
    ok('E1. khoá admin (máy) chỉ được ĐỌC — gửi / bỏ / đổi chế độ phải là người đăng nhập', /req\.method !== 'GET'/.test(route) && /x-admin-key chỉ được đọc/.test(route))
    ok('E2. route gửi dùng sendMessage (tin thường của người bấm), KHÔNG dùng sendAutoReplyMessage', /\.sendMessage\(Number\(n\.nguoiMuaId\), cau\)/.test(route) && !/sendAutoReplyMessage/.test(route))
    const idx = doc('src/index.ts')
    const viTri = (s: string) => idx.indexOf(s)
    ok('E3. router chờ duyệt mount TRƯỚC router đơn online và router chat (kẻo `/:id` nuốt mất)',
        viTri("app.use('/api/online-orders/chat/cho-duyet'") > 0 && viTri("app.use('/api/online-orders/chat/cho-duyet'") < viTri("app.use('/api/online-orders', onlineOrderRoutes)")
        && viTri("app.use('/api/online-orders/chat/cho-duyet'") < viTri("app.use('/api/online-orders/chat', chatRoutes)"))
    ok('E4. loại thông báo chat_cho_duyet ⇒ nhóm don_hang (có chuông) + mở màn chat-duyet', /case 'chat_cho_duyet': return \{ nhom: 'don_hang', route: 'chat-duyet' \}/.test(doc('src/routes/notifications.ts')))
    const lib = doc('src/lib/tuTraLoiShopee.ts')
    const m = lib.match(/const noiDung = `([^`]*)`/)
    ok('E5. thông báo chỉ mang tên gian + tên khách, KHÔNG mang chữ tin khách / câu AI', !!m && !/traLoi|cauHoi|noiDungPush|content/.test(m[1]!) && /tenGian/.test(m[1]!), m?.[1])
    ok('E6. NULL trong bảng cài đặt = cho_duyet (mặc định Shopee); đọc bằng SELECT * để bảng cũ chưa có cột vẫn chạy',
        /docCheDo = \(x: unknown\): CheDoTuTraLoi => \(x === 'tu_gui' \? 'tu_gui' : 'cho_duyet'\)/.test(lib) && /SELECT \* FROM "TuTraLoiCaiDat" WHERE "kenhId" = \$1/.test(lib))
    ok('E7. app Android ghi null TƯỜNG MINH cho trường bỏ trống ⇒ máy chủ coi null là không đổi (kẻo bật gian bị 400)',
        /const bat = req\.body\?\.bat \?\? undefined/.test(route) && /const cheDo = req\.body\?\.cheDo \?\? undefined/.test(route))

    console.log(`\n${dat} đạt, ${hong} hỏng`)
    process.exit(hong ? 1 : 0)
}
main().catch((e) => { console.error('LỖI:', e?.stack || e); process.exit(1) })
