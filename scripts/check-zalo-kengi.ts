/**
 * Kiểm ĐĂNG NHẬP ZALO TRONG KENGI — npx tsx scripts/check-zalo-kengi.ts
 *
 * Chủ shop 25/10/2026: "hay m viết mẹ cái đăng nhập zalo trong đó luôn đi" (n8n gửi tin nhóm hỏng vì
 * phiên Zalo trong n8n hết hạn). Lõi ở lib/zaloKengi.ts, nối vào hàng đợi ở lib/zaloGui.ts. Những thứ
 * sai là hỏng thật, nên mỗi thứ một ca:
 *   - chọn kênh: phiên Kengi sống ⇒ gửi thẳng (ưu tiên hơn n8n); phiên CHẾT ⇒ TẠM DỪNG, không rơi sang n8n;
 *   - mất phiên giữa đợt ⇒ dòng về hàng đợi, KHÔNG tính lượt (không thì quét lại QR xong cả đợt đã thành lỗi);
 *   - lỗi thường vẫn thử tối đa 3 lần; ảnh của đợt chỉ tải MỘT lần mỗi nhịp;
 *   - phiên chết chỉ đánh dấu khi đúng phienSo + đang sống, báo chuông MỘT lần;
 *   - màn hình không bao giờ nhận cookie; nhịp nền không tạo bảng ở cửa hàng chưa dùng;
 *   - kích thước ảnh PNG / JPEG / WEBP đọc đúng (Zalo cần rộng × cao); link ảnh nội bộ bị chặn.
 * Không gọi Zalo thật — Prisma giả, bộ gửi giả.
 */
process.env.MARKETING_VAULT_KEY = process.env.MARKETING_VAULT_KEY || 'ab'.repeat(32)

import fs from 'fs'
import path from 'path'
import { ZaloApiError } from 'zca-js'
import {
    kichThuocAnh, bamCookie, laLoiZalo, laLoiTamThoi, layApi, docTrangThai, kiemTraPhien, guiTinNhom, giuPhien, LoiPhienZalo,
} from '../src/lib/zaloKengi'
import { chonKenhGui, guiTiepCuaHang, guiQuaKenh, taiAnhGui } from '../src/lib/zaloGui'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

// ─── Prisma giả: bảng ZaloPhien (SQL thô) + hàng đợi gửi ────────────────────
let soSchema = 0
function giaSp(o: { phien?: any; ch?: any; dong?: any[]; dot?: any } = {}) {
    const st = {
        phien: o.phien ? { ...o.phien } : null as any,
        sql: [] as string[],
        thongBao: [] as any[],
        dong: (o.dong || []).map(d => ({ ...d })),
        dot: o.dot ? { ...o.dot } : null as any,
        giam: 0,   // số lần giành dòng cho → dang
    }
    const khop = (r: any, w: any) => Object.entries(w || {}).every(([k, v]: [string, any]) => {
        if (v && typeof v === 'object' && 'in' in v) return v.in.includes(r[k])
        if (v && typeof v === 'object' && 'lt' in v) return r[k] != null && r[k] < v.lt
        return r[k] === v
    })
    const sp: any = {
        __schema: `kiem_${++soSchema}`,
        $executeRawUnsafe: async (sql: string, ...p: any[]) => {
            st.sql.push(sql)
            if (/CREATE TABLE/.test(sql)) return 0
            if (/SET "trangThai" = 'het_han', "loiCuoi"/.test(sql)) {
                if (st.phien && st.phien.phienSo === p[1] && st.phien.trangThai === 'song') { st.phien.trangThai = 'het_han'; st.phien.loiCuoi = p[0]; return 1 }
                return 0
            }
            if (/SET "trangThai" = 'song' WHERE/.test(sql)) { if (st.phien && st.phien.phienSo === p[0]) { st.phien.trangThai = 'song'; return 1 } return 0 }
            if (/SET "trangThai" = 'het_han' WHERE/.test(sql)) { if (st.phien && st.phien.phienSo === p[0]) { st.phien.trangThai = 'het_han'; return 1 } return 0 }
            if (/SET "giuLuc" = now\(\)/.test(sql)) { if (st.phien && st.phien.phienSo === p[0]) { st.phien.giuLuc = new Date(); return 1 } return 0 }
            return 0
        },
        $queryRawUnsafe: async (sql: string) => {
            if (/FROM "ZaloPhien"/.test(sql)) return st.phien ? [{ ...st.phien }] : []
            if (/to_regclass/.test(sql)) return [{ co: !!st.phien }]
            return []
        },
        notification: {
            findFirst: async ({ where }: any) => st.thongBao.find(t => String(t.message).includes(where?.message?.contains)) || null,
            create: async ({ data }: any) => { st.thongBao.push(data); return { id: `tb${st.thongBao.length}` } },
        },
        zaloCauHinh: { findUnique: async () => o.ch ?? null },
        zaloDotGuiNhom: {
            updateMany: async ({ where, data }: any) => {
                let count = 0
                for (const r of st.dong) if (khop(r, where)) {
                    count++
                    for (const [k, v] of Object.entries(data)) r[k] = (v as any)?.increment ? (r[k] || 0) + (v as any).increment : v
                }
                if (where?.id && data?.trangThai === 'dang') st.giam += count
                return { count }
            },
            findMany: async ({ where, take }: any) => st.dong.filter(r => khop(r, where)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take).map(r => ({ ...r })),
            update: async ({ where, data }: any) => { const r = st.dong.find(x => x.id === where.id); Object.assign(r, data); return r },
            count: async ({ where }: any) => st.dong.filter(r => khop(r, where)).length,
        },
        zaloDotGui: {
            findUnique: async () => (st.dot ? { ...st.dot } : null),
            updateMany: async ({ where, data }: any) => { if (st.dot && khop(st.dot, where)) { Object.assign(st.dot, data); return { count: 1 } } return { count: 0 } },
        },
        customer: { findUnique: async () => null },
    }
    return { sp, st }
}

const PHIEN_SONG = { id: 'default', duLieu: 'khong.giai.duoc', phienSo: 'phien-1', uid: '123', ten: 'Hưng Tín', anh: null, trangThai: 'song', loiCuoi: null, nguoiDangNhap: 'a@b.vn', dangNhapLuc: new Date(), dungLuc: null, giuLuc: null }
const PHIEN_CHET = { ...PHIEN_SONG, trangThai: 'het_han', loiCuoi: 'Zalo không nhận phiên đã lưu' }
const dongCho = (id: string, lanThu = 0) => ({ id, dotId: 'dot1', groupId: `9000000000000${id}`, customerId: null, tenNhom: `Nhóm ${id}`, trangThai: 'cho', loi: null, lanThu, guiLuc: null, bien: null })
const DOT = { id: 'dot1', noiDung: 'Chào {tenKhach}', anh: '[]', tieuDe: null, trangThai: 'dang_gui' }
const nhanh = { nghiMs: () => 0 }

async function main() {
    console.log('\n▶ Đăng nhập Zalo trong Kengi — phiên, kênh gửi, hàng đợi\n')

    /* 1 — Kích thước ảnh */
    {
        const png = Buffer.alloc(33)
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0)
        png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'ascii'); png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20)
        ok('1a. PNG 800×600', JSON.stringify(kichThuocAnh(png)) === JSON.stringify({ rong: 800, cao: 600 }), kichThuocAnh(png))

        const jpeg = (sof: number, rong: number, cao: number, dem = false) => {
            const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)])
            const dht = Buffer.from([0xff, 0xc4, 0x00, 0x04, 0x00, 0x00])
            const s = Buffer.alloc(19); s[0] = 0xff; s[1] = sof; s.writeUInt16BE(17, 2); s[4] = 8; s.writeUInt16BE(cao, 5); s.writeUInt16BE(rong, 7)
            return Buffer.concat([Buffer.from([0xff, 0xd8]), dem ? Buffer.from([0xff, 0xff]) : Buffer.alloc(0), app0, dht, s, Buffer.from([0xff, 0xd9])])
        }
        ok('1b. JPEG baseline (SOF0) 1024×768, bỏ qua APP0 + DHT', JSON.stringify(kichThuocAnh(jpeg(0xc0, 1024, 768))) === JSON.stringify({ rong: 1024, cao: 768 }), kichThuocAnh(jpeg(0xc0, 1024, 768)))
        ok('1c. JPEG progressive (SOF2) + byte đệm 0xFF', JSON.stringify(kichThuocAnh(jpeg(0xc2, 300, 200, true))) === JSON.stringify({ rong: 300, cao: 200 }), kichThuocAnh(jpeg(0xc2, 300, 200, true)))
        const khongSof = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6])
        ok('1d. JPEG vào dữ liệu nén mà chưa thấy SOF ⇒ null (không đoán)', kichThuocAnh(khongSof) === null)

        const webp = (loai: string, ghi: (b: Buffer) => void) => {
            const b = Buffer.alloc(32); b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(24, 4); b.write('WEBP', 8, 'ascii'); b.write(loai, 12, 'ascii'); ghi(b); return b
        }
        const vp8 = webp('VP8 ', b => { b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a; b.writeUInt16LE(640, 26); b.writeUInt16LE(480, 28) })
        ok('1e. WEBP lossy (VP8) 640×480', JSON.stringify(kichThuocAnh(vp8)) === JSON.stringify({ rong: 640, cao: 480 }), kichThuocAnh(vp8))
        const vp8l = webp('VP8L', b => { b[20] = 0x2f; b.writeUInt32LE(((100 - 1) | ((50 - 1) << 14)) >>> 0, 21) })
        ok('1f. WEBP lossless (VP8L) 100×50', JSON.stringify(kichThuocAnh(vp8l)) === JSON.stringify({ rong: 100, cao: 50 }), kichThuocAnh(vp8l))
        const vp8x = webp('VP8X', b => { b.writeUIntLE(1920 - 1, 24, 3); b.writeUIntLE(1080 - 1, 27, 3) })
        ok('1g. WEBP mở rộng (VP8X) 1920×1080', JSON.stringify(kichThuocAnh(vp8x)) === JSON.stringify({ rong: 1920, cao: 1080 }), kichThuocAnh(vp8x))
        ok('1h. Tệp rác / PNG cụt ⇒ null, không ném', kichThuocAnh(Buffer.from('xin chao')) === null && kichThuocAnh(png.subarray(0, 20)) === null)
    }

    /* 2 — Dấu cookie + phân loại lỗi */
    {
        const a = [{ key: 'zpw_sek', value: 'x1', domain: 'chat.zalo.me', path: '/', expires: '2027-01-01T00:00:00.000Z', lastAccessed: '2026-10-25T01:00:00Z' }, { key: 'zpsid', value: 'y', domain: 'zalo.me', path: '/' }]
        const b = [{ ...a[1] }, { ...a[0], lastAccessed: '2026-10-25T09:00:00Z', creation: 'khac' }]
        ok('2a. Dấu cookie không đổi khi chỉ lastAccessed/creation đổi, không phụ thuộc thứ tự', bamCookie(a) === bamCookie(b))
        ok('2b. Dấu cookie ĐỔI khi Zalo cấp giá trị mới (phải ghi lại)', bamCookie(a) !== bamCookie([{ ...a[0], value: 'x2' }, a[1]]))
        ok('2c. "Đăng nhập thất bại" là lỗi Zalo, không tạm thời', laLoiZalo(new ZaloApiError('Đăng nhập thất bại')) && !laLoiTamThoi(new ZaloApiError('Đăng nhập thất bại')))
        ok('2d. HTTP 502 / "Failed to fetch login info" là tạm thời — không được kết luận phiên chết',
            laLoiTamThoi(new ZaloApiError('Request failed with status code 502')) && laLoiTamThoi(new ZaloApiError('Failed to fetch login info: Service Unavailable')))
        ok('2e. Lỗi mạng (TypeError fetch failed) KHÔNG phải lỗi Zalo', !laLoiZalo(new TypeError('fetch failed')))
    }

    /* 3 — Chọn kênh gửi */
    {
        const n8n = { n8nGuiUrl: 'https://n8n.vd.vn/webhook/gui' }
        let k = await chonKenhGui(giaSp().sp, null)
        ok('3a. Chưa đăng nhập, chưa có n8n ⇒ không có kênh, không tạm dừng', k.kenh === null && k.tamDung === null, k)
        k = await chonKenhGui(giaSp().sp, n8n)
        ok('3b. Chưa đăng nhập Kengi, có webhook ⇒ n8n như cũ', k.kenh?.loai === 'n8n' && (k.kenh as any).url === n8n.n8nGuiUrl, k)
        k = await chonKenhGui(giaSp({ phien: PHIEN_SONG }).sp, n8n)
        ok('3c. Phiên Kengi sống ⇒ gửi THẲNG (ưu tiên hơn n8n)', k.kenh?.loai === 'kengi', k)
        k = await chonKenhGui(giaSp({ phien: PHIEN_CHET }).sp, n8n)
        ok('3d. Phiên Kengi hết hạn ⇒ TẠM DỪNG, KHÔNG rơi sang n8n', k.kenh === null && /quét lại mã QR/.test(k.tamDung || ''), k)
    }

    /* 4 — Trạng thái cho màn hình + layApi */
    {
        const tt = await docTrangThai(giaSp({ phien: PHIEN_SONG }).sp)
        ok('4a. Trạng thái trả tên/uid nhưng KHÔNG có duLieu (cookie)', tt.coPhien && tt.ten === 'Hưng Tín' && !('duLieu' in tt) && !('phienSo' in tt), tt)
        ok('4b. Chưa đăng nhập ⇒ coPhien false', !(await docTrangThai(giaSp().sp)).coPhien)

        let loi: any = null
        try { await layApi(giaSp().sp) } catch (e) { loi = e }
        ok('4c. layApi khi chưa đăng nhập ⇒ LoiPhienZalo', loi instanceof LoiPhienZalo && /Chưa đăng nhập/.test(loi.message), String(loi))
        loi = null
        try { await layApi(giaSp({ phien: PHIEN_CHET }).sp) } catch (e) { loi = e }
        ok('4d. layApi khi phiên hết hạn ⇒ LoiPhienZalo, không thử đăng nhập', loi instanceof LoiPhienZalo && /hết hạn/.test(loi.message), String(loi))

        const g = giaSp({ phien: PHIEN_SONG })
        loi = null
        try { await layApi(g.sp) } catch (e) { loi = e }
        ok('4e. Bản lưu không giải mã được ⇒ đánh dấu hết hạn + LoiPhienZalo', loi instanceof LoiPhienZalo && g.st.phien.trangThai === 'het_han', { loi: String(loi), tt: g.st.phien.trangThai })
        ok('4f. …và báo chuông đúng MỘT lần, có dấu phiên', g.st.thongBao.length === 1 && /\[zalo-het-han:phien-1\]/.test(g.st.thongBao[0].message), g.st.thongBao)
        const kt = await kiemTraPhien(g.sp, true)
        ok('4g. "Kiểm tra lại" vẫn hỏng ⇒ song:false, phiên về hết hạn, KHÔNG báo chuông lần hai',
            kt.song === false && g.st.phien.trangThai === 'het_han' && g.st.thongBao.length === 1, { kt, tt: g.st.phien.trangThai, so: g.st.thongBao.length })

        const g2 = giaSp({ phien: { ...PHIEN_SONG, phienSo: 'phien-moi' } })
        await g2.sp.$executeRawUnsafe(`UPDATE "ZaloPhien" SET "trangThai" = 'het_han', "loiCuoi" = $1, "updatedAt" = now() WHERE "id" = 'default' AND "phienSo" = $2 AND "trangThai" = 'song'`, 'x', 'phien-cu')
        ok('4h. Máy cũ (phienSo cũ) không đánh chết được phiên vừa quét lại', g2.st.phien.trangThai === 'song')

        const kq = await guiTinNhom(giaSp().sp, '123456789', 'chào')
        ok('4i. Gửi khi chưa đăng nhập ⇒ ok:false + matPhien (hàng đợi tạm dừng, không tính lượt)', !kq.ok && kq.matPhien, kq)
    }

    /* 5 — Hàng đợi: tạm dừng / mất phiên giữa đợt / thử lại */
    {
        const goi: string[] = []
        const guiOk = async (_sp: any, _k: any, tin: any) => { goi.push(tin.groupId); return { ok: true, loi: null, matPhien: false } }

        let g = giaSp({ phien: PHIEN_CHET, dong: [dongCho('a'), dongCho('b')], dot: DOT })
        let kq = await guiTiepCuaHang(g.sp, { ...nhanh, gui: guiOk })
        ok('5a. Phiên hết hạn ⇒ không giành dòng nào, báo tamDung', g.st.giam === 0 && goi.length === 0 && !!kq.tamDung && g.st.dong.every(d => d.trangThai === 'cho' && d.lanThu === 0), { kq, giam: g.st.giam })

        g = giaSp({ phien: PHIEN_SONG, dong: [dongCho('a'), dongCho('b'), dongCho('c')], dot: DOT })
        kq = await guiTiepCuaHang(g.sp, { ...nhanh, gui: guiOk })
        ok('5b. Phiên sống ⇒ gửi hết 3 nhóm, đợt "xong"', kq.daGui === 3 && g.st.dong.every(d => d.trangThai === 'da_gui') && g.st.dot.trangThai === 'xong', { kq, dot: g.st.dot.trangThai })

        let lan = 0
        const guiMatPhien = async () => (++lan === 2 ? { ok: false, loi: 'Zalo: phiên hết hạn', matPhien: true } : { ok: true, loi: null, matPhien: false })
        g = giaSp({ phien: PHIEN_SONG, dong: [dongCho('a'), dongCho('b', 1), dongCho('c')], dot: DOT })
        kq = await guiTiepCuaHang(g.sp, { ...nhanh, gui: guiMatPhien as any })
        const [da, db, dc] = g.st.dong
        ok('5c. Mất phiên ở nhóm 2 ⇒ nhóm 1 đã gửi, DỪNG ngay (nhóm 3 chưa đụng)', da.trangThai === 'da_gui' && dc.trangThai === 'cho' && dc.lanThu === 0 && lan === 2, g.st.dong)
        ok('5d. …nhóm 2 về "cho", lượt thử TRẢ LẠI như cũ (1), có lý do', db.trangThai === 'cho' && db.lanThu === 1 && /phiên/.test(db.loi || ''), db)
        ok('5e. …đợt chưa "xong", kết quả báo tamDung', g.st.dot.trangThai === 'dang_gui' && !!kq.tamDung, { kq, dot: g.st.dot.trangThai })

        const guiHong = async () => ({ ok: false, loi: 'Zalo: không còn trong nhóm', matPhien: false })
        g = giaSp({ phien: PHIEN_SONG, dong: [dongCho('a', 0), dongCho('b', 2)], dot: DOT })
        kq = await guiTiepCuaHang(g.sp, { ...nhanh, gui: guiHong })
        ok('5f. Lỗi thường: lượt 1 còn thử ("cho", lanThu 1); lượt 3 ⇒ "loi"',
            g.st.dong[0].trangThai === 'cho' && g.st.dong[0].lanThu === 1 && g.st.dong[1].trangThai === 'loi' && g.st.dong[1].lanThu === 3 && kq.loi === 2, g.st.dong)

        const anhGap: any[] = []
        const guiGhiAnh = async (_sp: any, _k: any, _t: any, anhSan: any) => { anhGap.push(anhSan); return { ok: true, loi: null, matPhien: false } }
        g = giaSp({ phien: PHIEN_SONG, dong: [dongCho('a'), dongCho('b')], dot: { ...DOT, anh: JSON.stringify(['http://khong-https.vd/a.jpg']) } })
        await guiTiepCuaHang(g.sp, { ...nhanh, gui: guiGhiAnh })
        ok('5g. Ảnh của đợt tải MỘT lần, các nhóm dùng chung', anhGap.length === 2 && anhGap[0] && anhGap[0] === anhGap[1], anhGap.length)
        ok('5h. …link ảnh không phải https bị chặn kèm lý do', /https/.test(anhGap[0]?.loi || ''), anhGap[0])

        const r = await guiQuaKenh(giaSp({ phien: PHIEN_SONG }).sp, { loai: 'kengi' }, { dotId: null, groupId: '1234567', noiDung: 'x', anh: ['https://a.vd/1.jpg'] }, { anh: [], loi: 'Ảnh 1 hỏng' })
        ok('5i. Ảnh hỏng ⇒ tin hỏng (không gửi thiếu ảnh mà báo đã gửi), không tính là mất phiên', !r.ok && r.loi === 'Ảnh 1 hỏng' && !r.matPhien, r)
        const n = await guiQuaKenh(giaSp().sp, { loai: 'n8n', url: 'https://127.0.0.1/hook' }, { dotId: null, groupId: '1234567', noiDung: 'x', anh: [] })
        ok('5j. Kênh n8n vẫn qua bộ chặn mạng nội bộ, matPhien luôn false', !n.ok && /nội bộ/.test(n.loi || '') && n.matPhien === false, n)
    }

    /* 6 — Tải ảnh: chặn link nội bộ */
    {
        const a = await taiAnhGui(['https://127.0.0.1/a.jpg'])
        ok('6a. Ảnh ở 127.0.0.1 bị chặn', !!a.loi && /nội bộ/.test(a.loi), a.loi)
        const b = await taiAnhGui(['https://metadata.google.internal/x.png'])
        ok('6b. Ảnh ở metadata.google.internal bị chặn', !!b.loi && /nội bộ/.test(b.loi), b.loi)
        const c = await taiAnhGui([])
        ok('6c. Không ảnh ⇒ rỗng, không lỗi', c.loi === null && c.anh.length === 0)
    }

    /* 7 — Nhịp giữ phiên */
    {
        const g = giaSp()
        const r = await giuPhien(g.sp)
        ok('7a. Cửa hàng chưa từng đăng nhập ⇒ không làm gì, KHÔNG tạo bảng', r === '' && !g.st.sql.some(s => /CREATE TABLE/.test(s)), g.st.sql)
        const g2 = giaSp({ phien: PHIEN_CHET })
        ok('7b. Phiên đã hết hạn ⇒ không gọi Zalo', (await giuPhien(g2.sp)) === '')
        const g3 = giaSp({ phien: { ...PHIEN_SONG, giuLuc: new Date() } })
        g3.sp.$executeRawUnsafe = (async (sql: string) => (/SET "giuLuc"/.test(sql) ? 0 : 0)) as any
        ok('7c. Bản máy khác vừa giữ (không giành được giuLuc) ⇒ bỏ qua', (await giuPhien(g3.sp)) === '')
    }

    /* 8 — Soát nối dây trong mã nguồn */
    {
        const goc = path.join(__dirname, '..', 'src')
        const kengi = fs.readFileSync(path.join(goc, 'lib', 'zaloKengi.ts'), 'utf8')
        const route = fs.readFileSync(path.join(goc, 'routes', 'zalo.ts'), 'utf8')
        const khuc = (dau: string) => { const i = route.indexOf(dau); const j = route.indexOf('\nrouter.', i + 10); return i < 0 ? '' : route.slice(i, j < 0 ? undefined : j) }
        ok('8a. zca-js tắt checkUpdate + logging (mặc định bật: gọi npm + in uid ra log)', /checkUpdate:\s*false/.test(kengi) && /logging:\s*false/.test(kengi))
        ok('8b. lib zaloKengi không console.log (không in cookie/phiên ra log)', !/console\.log\(/.test(kengi))
        ok('8c. Từ chối QR ⇒ gọi abort (zca-js không tự kết thúc)', /QRCodeDeclined[\s\S]{0,200}dung\(\)/.test(kengi))
        const qr = khuc("router.post('/dang-nhap/qr'")
        ok('8d. /dang-nhap/qr: chỉ quản lý, luồng SSE, huỷ khi trình duyệt đóng', qr.includes('chiQuanLy') && qr.includes('text/event-stream') && /res\.on\('close'/.test(qr) && qr.includes('huy.abort()'))
        ok('8e. /dang-xuat chỉ quản lý', khuc("router.post('/dang-xuat'").includes('chiQuanLy'))
        ok('8f. chiQuanLy chặn khoá API', /function chiQuanLy[\s\S]{0,300}viaApiKey/.test(route))
        const guiThu = khuc("router.post('/gui-thu'"), dotGui = khuc("router.post('/dot-gui'")
        ok('8g. /gui-thu + /dot-gui chọn kênh bằng chonKenhGui, không còn bắt buộc webhook n8n',
            guiThu.includes('chonKenhGui(') && dotGui.includes('chonKenhGui(') && !/if \(!ch\?\.n8nGuiUrl\)/.test(guiThu + dotGui))
        ok('8h. /nhom/quet-ngay quét thẳng qua Kengi khi đã đăng nhập', khuc("router.post('/nhom/quet-ngay'").includes('dsNhomZalo('))
        ok('8i. GET /dang-nhap chỉ trả docTrangThai (không đọc bảng trực tiếp)', khuc("router.get('/dang-nhap'").includes('docTrangThai(') && !khuc("router.get('/dang-nhap'").includes('duLieu'))
    }

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error('LỖI BỘ KIỂM:', e); process.exitCode = 1 })
