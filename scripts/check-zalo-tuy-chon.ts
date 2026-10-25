/**
 * Kiểm TUỲ CHỌN GỬI TIN ZALO — npx tsx scripts/check-zalo-tuy-chon.ts
 *
 * Chủ shop 25/10/2026: "giờ thêm các custom gửi zalo đi". Lõi ở lib/zaloTuyChon.ts (thẻ định dạng,
 * mức độ, nhắc cả nhóm, tự xoá, hẹn giờ), gửi ở lib/zaloKengi.ts (cacLanGui), hàng đợi ở lib/zaloGui.ts.
 * Sai ở đây là khách thấy rác ("[đậm]" lòi ra, chữ in đậm lệch chỗ vì tên khách dài ngắn khác nhau),
 * tin hẹn 8 giờ sáng đi ngay bây giờ, hay chữ gửi hai lần — nên mỗi thứ một ca.
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'ab'.repeat(32)

import fs from 'fs'
import path from 'path'
import { phanTichDinhDang, boDinhDang, soanTin, docTuyChon, laMacDinh, NHAN_CA_NHOM } from '../src/lib/zaloTuyChon'
import { cacLanGui } from '../src/lib/zaloKengi'
import { guiTiepCuaHang, guiMotNhom, dienMau } from '../src/lib/zaloGui'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const J = (x: any) => JSON.stringify(x)

async function main() {
    console.log('\n▶ Tuỳ chọn gửi tin Zalo — định dạng, mức độ, nhắc cả nhóm, tự xoá, hẹn giờ\n')

    /* 1 — Thẻ định dạng */
    {
        let r = phanTichDinhDang('[đậm]Giảm 50%[/đậm] hôm nay')
        ok('1a. [đậm]…[/đậm] ⇒ chữ sạch + in đậm đúng 8 ký tự đầu', r.msg === 'Giảm 50% hôm nay' && J(r.styles) === J([{ start: 0, len: 8, st: 'b' }]), r)
        r = phanTichDinhDang('[b]x[/b][DAM]y[/dam]')
        ok('1b. Tên thẻ không dấu / tiếng Anh / chữ HOA đều nhận', r.msg === 'xy' && r.styles.length === 2 && r.styles.every(s => s.st === 'b'), r)
        r = phanTichDinhDang('[đỏ][đậm]A[/đậm]B[/đỏ]')
        ok('1c. Lồng nhau: đỏ phủ AB, đậm chỉ A', r.msg === 'AB' && J(r.styles) === J([{ start: 0, len: 2, st: 'c_db342e' }, { start: 0, len: 1, st: 'b' }]), r)
        r = phanTichDinhDang('[đậm]A[đỏ]B[/đậm]C[/đỏ]')
        ok('1d. Đan chéo vẫn đúng: đậm AB, đỏ BC', r.msg === 'ABC' && J(r.styles) === J([{ start: 0, len: 2, st: 'b' }, { start: 1, len: 2, st: 'c_db342e' }]), r)
        ok('1e. Thẻ mở không đóng ⇒ giữ nguyên là chữ (không nuốt chữ của khách)', phanTichDinhDang('[đậm]chưa đóng').msg === '[đậm]chưa đóng' && !phanTichDinhDang('[đậm]chưa đóng').styles.length)
        ok('1f. Thẻ đóng lẻ ⇒ giữ nguyên', phanTichDinhDang('a[/đậm]b').msg === 'a[/đậm]b')
        ok('1g. Thẻ lạ ([giá]) ⇒ giữ nguyên', phanTichDinhDang('[giá]100k[/giá]').msg === '[giá]100k[/giá]')
        r = phanTichDinhDang('[đậm][/đậm]x')
        ok('1h. Cặp rỗng ⇒ bỏ thẻ, không sinh định dạng dài 0', r.msg === 'x' && r.styles.length === 0, r)
        r = phanTichDinhDang('[đỏ]dòng 1\ndòng 2[/đỏ]')
        ok('1i. Định dạng vắt qua xuống dòng', r.msg === 'dòng 1\ndòng 2' && J(r.styles) === J([{ start: 0, len: 13, st: 'c_db342e' }]), r)
        r = phanTichDinhDang('🔥[đậm]Sale[/đậm]')
        ok('1j. Emoji đứng trước đếm 2 đơn vị (UTF-16 như Zalo)', r.msg === '🔥Sale' && J(r.styles) === J([{ start: 2, len: 4, st: 'b' }]), r)
        r = phanTichDinhDang('[Gạch Chân]x[/gạch chân][gach ngang]y[/gạch ngang][to]z[/to][nhỏ]w[/nhỏ]')
        ok('1k. Gạch chân / gạch ngang / to / nhỏ (hoa thường, có/không dấu lẫn lộn)', r.msg === 'xyzw' && J(r.styles.map(s => s.st)) === J(['u', 's', 'f_18', 'f_13']), r)
        r = phanTichDinhDang('[cam]a[/cam][vàng]b[/vàng][xanh]c[/xanh]')
        ok('1l. Màu cam / vàng / xanh đúng mã Zalo', J(r.styles.map(s => s.st)) === J(['c_f27806', 'c_f7b503', 'c_15a85f']), r)
        ok('1m. boDinhDang trả chữ thường', boDinhDang('Chào [đậm]anh[/đậm] [đỏ]Ba[/đỏ]') === 'Chào anh Ba')
    }

    /* 2 — Soạn tin: điền mẫu TRƯỚC, @All, NFC, mức độ, tự xoá */
    {
        const tc = { mucDo: 2 as const, nhacCaNhom: true, tuXoa: 7 as const, henGio: null }
        let s = soanTin('[đậm]Chào[/đậm]', tc)
        ok('2a. Nhắc cả nhóm: "@All " đầu tin, định dạng dời theo', s.msg === `${NHAN_CA_NHOM} Chào` && J(s.styles) === J([{ start: 5, len: 4, st: 'b' }]), s)
        ok('2b. …nhắc uid "-1", dài đúng "@All"', J(s.mentions) === J([{ pos: 0, uid: '-1', len: 4 }]), s.mentions)
        ok('2c. Khẩn cấp ⇒ urgency 2; tự xoá 7 ngày ⇒ ttl 604800000', s.urgency === 2 && s.ttl === 604_800_000, { u: s.urgency, ttl: s.ttl })
        s = soanTin('', tc)
        ok('2d. Chỉ ảnh mà bật nhắc cả nhóm ⇒ chữ là "@All"', s.msg === NHAN_CA_NHOM && s.mentions[0].len === 4, s)
        const nfd = 'Chào [đậm]bạn[/đậm]'
        s = soanTin(nfd, null)
        ok('2e. Chữ tổ hợp (NFD, gõ Unikey tổ hợp) chuẩn hoá NFC rồi mới tính vị trí', s.msg === 'Chào bạn' && J(s.styles) === J([{ start: 5, len: 3, st: 'b' }]), s)
        const mau = 'Chào {tenKhach}, [đỏ]giảm giá[/đỏ]'
        const a = soanTin(dienMau(mau, { tenKhach: 'Cửa hàng Trãi Thu' }), null)
        const b = soanTin(dienMau(mau, { tenKhach: 'A' }), null)
        ok('2f. Vị trí định dạng theo ĐÚNG tên khách của từng nhóm', a.styles[0].start === 'Chào Cửa hàng Trãi Thu, '.length && b.styles[0].start === 'Chào A, '.length, { a: a.styles, b: b.styles })
        s = soanTin('Thường', null)
        ok('2g. Không tuỳ chọn ⇒ không nhắc, urgency 0, ttl 0', !s.mentions.length && s.urgency === 0 && s.ttl === 0 && !s.styles.length, s)
    }

    /* 3 — Đọc tuỳ chọn từ màn hình */
    {
        const bayGio = Date.parse('2026-10-25T13:00:00Z')
        const d = docTuyChon(undefined)
        ok('3a. Không gửi gì ⇒ mặc định', typeof d === 'object' && laMacDinh(d))
        ok('3b. Mức độ lạ / tự xoá lạ ⇒ báo lỗi bằng chữ', typeof docTuyChon({ mucDo: 3 }) === 'string' && typeof docTuyChon({ tuXoa: 5 }) === 'string')
        const hen = docTuyChon({ henGio: '2026-10-26T01:00:00.000Z' }, true, bayGio)
        ok('3c. Hẹn sáng mai ⇒ giữ giờ hẹn', typeof hen === 'object' && hen.henGio === '2026-10-26T01:00:00.000Z', hen)
        const qua = docTuyChon({ henGio: '2026-10-25T12:00:00.000Z' }, true, bayGio)
        ok('3d. Giờ đã qua / sát giờ ⇒ gửi ngay (henGio null)', typeof qua === 'object' && qua.henGio === null, qua)
        ok('3e. Hẹn quá 31 ngày / giờ rác ⇒ lỗi', typeof docTuyChon({ henGio: '2026-12-30T00:00:00Z' }, true, bayGio) === 'string' && typeof docTuyChon({ henGio: 'mai nhé' }, true, bayGio) === 'string')
        const thu = docTuyChon({ henGio: '2026-10-26T01:00:00.000Z', mucDo: 1 }, false, bayGio)
        ok('3f. Gửi thử bỏ qua hẹn giờ (thử là gửi NGAY)', typeof thu === 'object' && thu.henGio === null && thu.mucDo === 1, thu)
        const chu = docTuyChon({ nhacCaNhom: 'true' })
        ok('3g. nhacCaNhom phải là true thật (chuỗi "true" không tính)', typeof chu === 'object' && chu.nhacCaNhom === false)
    }

    /* 4 — Các lần gửi (tách chữ / ảnh) */
    {
        const anh1 = [{ data: Buffer.alloc(10), ten: 'anh-1.jpg', rong: 10, cao: 10 }]
        const anh2 = [...anh1, { data: Buffer.alloc(20), ten: 'anh-2.png' }]
        let l = cacLanGui('Chào', anh1, {})
        ok('4a. 1 ảnh + chữ thường ⇒ MỘT lần, chữ làm chú thích', l.length === 1 && l[0].msg === 'Chào' && l[0].attachments.length === 1, l.length)
        l = cacLanGui('Chào', anh1, { styles: [{ start: 0, len: 4, st: 'b' }], ttl: 86_400_000 })
        ok('4b. 1 ảnh + chữ CÓ định dạng ⇒ chữ (kèm styles) trước, ảnh sau', l.length === 2 && l[0].styles?.length === 1 && !l[0].attachments && l[1].msg === '' && l[1].attachments.length === 1, l.map(x => Object.keys(x)))
        ok('4c. …tự xoá áp cho CẢ chữ lẫn ảnh', l[0].ttl === 86_400_000 && l[1].ttl === 86_400_000)
        l = cacLanGui('Chào', anh2, {})
        ok('4d. Nhiều ảnh + chữ ⇒ tự tách (biết chữ đã đi khi ảnh hỏng)', l.length === 2 && l[0].msg === 'Chào' && !l[0].attachments && l[1].attachments.length === 2, l.length)
        l = cacLanGui('', anh2, { urgency: 1 })
        ok('4e. Chỉ ảnh ⇒ một lần, msg là chuỗi rỗng (zca-js đọc msg.length)', l.length === 1 && l[0].msg === '' && l[0].attachments.length === 2, l)
        l = cacLanGui('Chỉ chữ', [], { mentions: [{ pos: 0, uid: '-1', len: 4 }], urgency: 2 })
        ok('4f. Chỉ chữ ⇒ một lần mang nhắc tên + mức độ, không có attachments', l.length === 1 && l[0].mentions?.length === 1 && l[0].urgency === 2 && !('attachments' in l[0]), l)
    }

    /* 5 — Hàng đợi: hẹn giờ + tuỳ chọn từng đợt + gửi một phần */
    {
        const PHIEN = { id: 'default', duLieu: 'x.y.z', phienSo: 'p1', trangThai: 'song', uid: '1', ten: 'T', anh: null, loiCuoi: null, nguoiDangNhap: null, dangNhapLuc: new Date(), dungLuc: null, giuLuc: null }
        const dong = (id: string, dotId: string, lanThu = 0) => ({ id, dotId, groupId: `1234567${id}`, customerId: null, tenNhom: id, trangThai: 'cho', loi: null, lanThu, guiLuc: null, bien: null })
        const st = { dong: [dong('a1', 'dotHen'), dong('a2', 'dotHen'), dong('b1', 'dot1'), dong('b2', 'dot1', 0)], dot: { dot1: { id: 'dot1', noiDung: 'x', anh: '[]', trangThai: 'dang_gui' }, dotHen: { id: 'dotHen', noiDung: 'y', anh: '[]', trangThai: 'dang_gui' } } as any }
        const khop = (r: any, w: any) => Object.entries(w || {}).every(([k, v]: [string, any]) => {
            if (v && typeof v === 'object' && 'notIn' in v) return !v.notIn.includes(r[k])
            if (v && typeof v === 'object' && 'in' in v) return v.in.includes(r[k])
            if (v && typeof v === 'object' && 'lt' in v) return r[k] != null && r[k] < v.lt
            return r[k] === v
        })
        const sp: any = {
            __schema: 'kiem_tuy_chon',
            $executeRawUnsafe: async () => 0,
            $queryRawUnsafe: async (sql: string) => {
                if (/FROM "ZaloPhien"/.test(sql)) return [{ ...PHIEN }]
                if (/to_regclass/.test(sql)) return [{ co: true }]
                if (/"henGio" > /.test(sql)) return [{ dotId: 'dotHen' }]
                if (/FROM "ZaloDotTuyChon" WHERE "dotId" IN/.test(sql)) return [{ dotId: 'dot1', tuyChon: J({ mucDo: 1, nhacCaNhom: true, tuXoa: 1 }), henGio: null }]
                return []
            },
            zaloCauHinh: { findUnique: async () => ({ guiMoiPhut: 10 }) },
            zaloDotGuiNhom: {
                updateMany: async ({ where, data }: any) => {
                    let count = 0
                    for (const r of st.dong) if (khop(r, where)) { count++; for (const [k, v] of Object.entries(data)) r[k] = (v as any)?.increment ? (r[k] || 0) + (v as any).increment : v }
                    return { count }
                },
                findMany: async ({ where, take }: any) => st.dong.filter(r => khop(r, where)).slice(0, take).map(r => ({ ...r })),
                update: async ({ where, data }: any) => Object.assign(st.dong.find(x => x.id === where.id)!, data),
                count: async ({ where }: any) => st.dong.filter(r => khop(r, where)).length,
            },
            zaloDotGui: {
                findUnique: async ({ where }: any) => ({ ...st.dot[where.id] }),
                updateMany: async ({ where, data }: any) => { const d = st.dot[where.id]; if (d && khop(d, where)) { Object.assign(d, data); return { count: 1 } } return { count: 0 } },
            },
            customer: { findUnique: async () => null },
        }
        const nhan: any[] = []
        let lan = 0
        const gui = async (_sp: any, _k: any, tin: any) => {
            nhan.push(tin)
            return ++lan === 2 ? { ok: false, loi: 'Đã gửi phần chữ, ẢNH lỗi', matPhien: false, khongThuLai: true } : { ok: true, loi: null, matPhien: false }
        }
        await guiTiepCuaHang(sp, { nghiMs: () => 0, gui: gui as any })
        ok('5a. Đợt hẹn giờ chưa tới ⇒ KHÔNG đụng dòng nào (vẫn "cho", lượt 0)', st.dong.filter(d => d.dotId === 'dotHen').every(d => d.trangThai === 'cho' && d.lanThu === 0) && nhan.every(t => t.dotId === 'dot1'), st.dong)
        ok('5b. …đợt hẹn giờ không bị đánh "xong"', st.dot.dotHen.trangThai === 'dang_gui')
        ok('5c. Tuỳ chọn của đợt đi kèm từng tin (khẩn/quan trọng, @All, tự xoá)', nhan.length === 2 && nhan[0].tuyChon?.mucDo === 1 && nhan[0].tuyChon?.nhacCaNhom === true && nhan[0].tuyChon?.tuXoa === 1, nhan.map(t => t.tuyChon))
        const b2 = st.dong.find(d => d.id === 'b2')!
        ok('5d. Gửi được một phần (chữ đi, ảnh hỏng) ⇒ "loi" NGAY, không tự gửi lại', b2.trangThai === 'loi' && b2.lanThu === 1, b2)
    }

    /* 6 — n8n nhận chữ thường + định dạng tách riêng */
    {
        const goc = (globalThis as any).fetch
        let than: any = null
        ;(globalThis as any).fetch = async (_u: string, o: any) => { than = JSON.parse(o.body); return { ok: true, status: 200, text: async () => '{"success":true}' } }
        try {
            await guiMotNhom('https://n8n.vd.vn/webhook/gui', {
                dotId: null, groupId: '1234567', noiDung: 'Chào {tenKhach} [đậm]giảm 50%[/đậm]', anh: [], tenKhach: 'Anh Ba',
                tuyChon: { mucDo: 1, nhacCaNhom: true, tuXoa: 0, henGio: null },
            })
        } finally { (globalThis as any).fetch = goc }
        ok('6a. n8n nhận chữ THƯỜNG (không lòi thẻ), đã điền tên', than?.noiDung === 'Chào Anh Ba giảm 50%', than?.noiDung)
        ok('6b. …định dạng tách riêng đúng vị trí trên chữ đó', J(than?.dinhDang) === J([{ start: 12, len: 8, st: 'b' }]), than?.dinhDang)
        ok('6c. …không tự chèn "@All" (n8n tự quyết), cờ nhắc vẫn kèm trong tuyChon', !String(than?.noiDung).includes('@All') && than?.tuyChon?.nhacCaNhom === true, than?.tuyChon)
    }

    /* 7 — Soát nối dây */
    {
        const goc = path.join(__dirname, '..', 'src')
        const route = fs.readFileSync(path.join(goc, 'routes', 'zalo.ts'), 'utf8')
        const khuc = (dau: string) => { const i = route.indexOf(dau); const j = route.indexOf('\nrouter.', i + 10); return i < 0 ? '' : route.slice(i, j < 0 ? undefined : j) }
        const dotGui = khuc("router.post('/dot-gui'")
        ok('7a. /dot-gui ghi tuỳ chọn + giờ hẹn TRƯỚC khi tạo hàng chờ (khỏi lọt nhịp gửi)', dotGui.indexOf('luuTuyChonDot(') > 0 && dotGui.indexOf('luuTuyChonDot(') < dotGui.indexOf('zaloDotGuiNhom.createMany('))
        ok('7b. /gui-thu đọc tuỳ chọn với choHenGio=false', /docTuyChon\(b\.tuyChon, false\)/.test(khuc("router.post('/gui-thu'")))
        ok('7c. Có POST /dot-gui/:id/gui-ngay', route.includes("router.post('/dot-gui/:id/gui-ngay'"))
        const gui = fs.readFileSync(path.join(goc, 'lib', 'zaloGui.ts'), 'utf8')
        ok('7d. Nhịp gửi loại đợt chưa tới giờ NGAY trong câu hỏi (notIn)', /dotChuaToiGio\(sp\)/.test(gui) && /notIn: chuaToiGio/.test(gui))
    }

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
