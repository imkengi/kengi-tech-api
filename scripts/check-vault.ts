/**
 * SOÁT KENGI VAULT (20/10/2026) — phần THUẦN của kho tài liệu: không CSDL, không mạng (kho cục bộ ghi vào
 * thư mục tạm). Chạy: npm run check:vault
 *
 *  1. Bộ ghi ZIP: CRC chuẩn, tên tiếng Việt, tên trùng, đọc lại từng mục khớp byte (bộ đọc ZIP tự viết ở dưới,
 *     kèm python zipfile nếu máy có python).
 *  2. Chữ ký HMAC: link xem / ZIP / chia sẻ — đúng thì qua, sửa một ký tự hay quá hạn thì chặn.
 *  3. MIME phát tệp: HTML/SVG giả dạng không bao giờ được xem tại chỗ; PDF/ảnh thật thì được.
 *  4. AI KHÔNG BỊA: ngày/tiền/số hiệu/MST không có trong chữ ⇒ bỏ; có ⇒ giữ.
 *  5. Lịch nhắc hết hạn: mốc 30/7/1/0, hạn vừa nhập còn 3 ngày chỉ nhắc MỘT lần, đổi hạn là nhắc lại, hết hạn
 *     lâu rồi thì im.
 *  6. Kho cục bộ: tải lên từng khối kiểu GCS resumable (khối sai vị trí ⇒ 308 + Range), md5 đúng, đọc Range.
 *  7. DDL: mọi cột Vault có dòng ALTER viết THẲNG trong /admin/migrate (check:migrate soi admin.ts).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import zlib from 'zlib'
import { spawnSync } from 'child_process'
import { Readable, Writable } from 'stream'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'bi-mat-thu-check-vault'
process.env.VAULT_DRIVER = 'local'
process.env.VAULT_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vault-'))

import * as kho from '../src/lib/khoTaiLieu'
import { BoGhiZip, crc32, tenMucZip } from '../src/lib/vaultZip'
import { locKetQuaAi, ngayTrongChu, soTrongChu, docMucZip, trichChuVanPhong, cachGuiAi } from '../src/lib/vaultAi'
import { mocCanNhac, soNgayCon, ngayVN } from '../src/lib/vaultViec'

let dat = 0, hong = 0
function ky(ten: string, dung: boolean, chiTiet = '') {
    if (dung) dat++
    else { hong++; console.log(`  ✗ ${ten}${chiTiet ? ` — ${chiTiet}` : ''}`) }
}

/** Đọc ZIP tối giản: thư mục trung tâm → từng mục (chỉ STORED) */
function docZip(buf: Buffer): { ten: string; du: Buffer; crc: number }[] {
    let eocd = -1
    for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    if (eocd < 0) throw new Error('không thấy EOCD')
    const so = buf.readUInt16LE(eocd + 10)
    let p = buf.readUInt32LE(eocd + 16)
    const ra: { ten: string; du: Buffer; crc: number }[] = []
    for (let i = 0; i < so; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('sai chữ ký thư mục trung tâm')
        const co = buf.readUInt32LE(p + 24), dT = buf.readUInt16LE(p + 28), dP = buf.readUInt16LE(p + 30), dG = buf.readUInt16LE(p + 32)
        const crc = buf.readUInt32LE(p + 16), viTri = buf.readUInt32LE(p + 42)
        const ten = buf.toString('utf8', p + 46, p + 46 + dT)
        if (buf.readUInt32LE(viTri) !== 0x04034b50) throw new Error('sai chữ ký mục')
        const bd = viTri + 30 + buf.readUInt16LE(viTri + 26) + buf.readUInt16LE(viTri + 28)
        ra.push({ ten, du: buf.subarray(bd, bd + co), crc })
        p += 46 + dT + dP + dG
    }
    return ra
}

async function zipRaBuffer(muc: { ten: string; du: Buffer }[]): Promise<Buffer> {
    const phan: Buffer[] = []
    const ra = new Writable({ write(c, _e, cb) { phan.push(Buffer.from(c)); cb() } })
    const z = new BoGhiZip(ra)
    for (const m of muc) await z.themMuc(m.ten, new Date('2026-10-20T10:30:00+07:00'), Readable.from([m.du.subarray(0, 7), m.du.subarray(7)]))
    await z.ketThuc()
    return Buffer.concat(phan)
}

async function main() {
    console.log('== 1. ZIP')
    ky('crc32 "123456789"', crc32(Buffer.from('123456789')) === 0xcbf43926)
    ky('crc32 nối khúc = crc32 cả khối', crc32(Buffer.from('6789'), crc32(Buffer.from('12345'))) === crc32(Buffer.from('123456789')))
    const lon = crypto.randomBytes(300_000)
    const muc = [
        { ten: 'Hợp đồng/Hợp đồng mua bán Sunhouse.pdf', du: Buffer.from('%PDF-1.4 thử') },
        { ten: 'Hợp đồng/Hợp đồng mua bán Sunhouse.pdf', du: Buffer.from('%PDF-1.4 bản hai') },
        { ten: '../../etc/passwd', du: Buffer.from('khong thoat ra ngoai') },
        { ten: 'anh.jpg', du: lon },
    ]
    const zbuf = await zipRaBuffer(muc)
    const doc = docZip(zbuf)
    ky('đủ 4 mục', doc.length === 4, String(doc.length))
    ky('tên tiếng Việt giữ nguyên', doc[0]?.ten === 'Hợp đồng/Hợp đồng mua bán Sunhouse.pdf', doc[0]?.ten)
    ky('tên trùng ⇒ (2)', doc[1]?.ten === 'Hợp đồng/Hợp đồng mua bán Sunhouse (2).pdf', doc[1]?.ten)
    ky('chặn ../', doc[2]?.ten === 'etc/passwd', doc[2]?.ten)
    ky('nội dung + CRC từng mục khớp', doc.every((d, i) => d.du.equals(muc[i]!.du) && crc32(d.du) === d.crc))
    ky('tenMucZip bỏ ký tự cấm Windows', tenMucZip('a:b*c?.pdf') === 'a_b_c_.pdf')
    const py = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c',
        'import sys,zipfile,io;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));bad=z.testzip();print("OK" if bad is None else "HONG "+bad);print(len(z.namelist()))'],
    { input: zbuf, encoding: 'utf8' })
    if (py.status === 0) ky('python zipfile.testzip() sạch', /^OK\s+4/.test(py.stdout.trim()), py.stdout.trim())
    else console.log('  (bỏ qua python: không có trên máy)')

    console.log('== 2. Chữ ký')
    const d = kho.duongXem('branch_abc', 'v123', 'xem')
    const q = new URLSearchParams(d.split('?')[1])
    ky('link xem đúng ⇒ ok', kho.kiemXem('branch_abc', 'v123', Number(q.get('h')), 'xem', q.get('k')) === 'ok')
    ky('đổi chế độ xem→tai ⇒ sai', kho.kiemXem('branch_abc', 'v123', Number(q.get('h')), 'tai', q.get('k')) === 'sai')
    ky('đổi id ⇒ sai', kho.kiemXem('branch_abc', 'v124', Number(q.get('h')), 'xem', q.get('k')) === 'sai')
    ky('đổi cửa hàng ⇒ sai', kho.kiemXem('branch_xyz', 'v123', Number(q.get('h')), 'xem', q.get('k')) === 'sai')
    const het = Date.now() - 1000
    ky('quá hạn ⇒ het-han', kho.kiemXem('branch_abc', 'v1', het, 'xem', kho.ky('xem', 'branch_abc', 'v1', het, 'xem')) === 'het-han')
    ky('schema lạ ⇒ sai', kho.kiemXem('a"; drop', 'v1', Date.now() + 9e5, 'xem', 'x') === 'sai')
    const k1 = kho.hanKhung(Date.parse('2026-10-20T10:01:00Z')), k2 = kho.hanKhung(Date.parse('2026-10-20T10:29:00Z'))
    ky('cùng khung 30 phút ⇒ cùng hạn (trình duyệt dùng lại ảnh nhỏ)', k1 === k2)
    ky('hạn khung còn 30–60 phút', k1 - Date.parse('2026-10-20T10:29:00Z') >= 30 * 60_000 && k1 - Date.parse('2026-10-20T10:01:00Z') <= 60 * 60_000)
    const z = new URLSearchParams(kho.duongZip('branch_abc', ['a1', 'b2']).split('?')[1])
    ky('link ZIP đúng', kho.kiemZip('branch_abc', z.get('ids')!, Number(z.get('h')), z.get('k')) === 'ok')
    ky('link ZIP thêm id ⇒ sai', kho.kiemZip('branch_abc', z.get('ids') + ',c3', Number(z.get('h')), z.get('k')) === 'sai')
    const sid = crypto.randomBytes(16).toString('hex')
    const ma = kho.maChiaSe('branch_abc', sid)
    ky('mã chia sẻ đọc lại đúng', JSON.stringify(kho.docMaChiaSe(ma)) === JSON.stringify({ schema: 'branch_abc', shareId: sid }))
    ky('mã chia sẻ sửa 1 ký tự ⇒ null', kho.docMaChiaSe(ma.slice(0, -1) + (ma.endsWith('A') ? 'B' : 'A')) === null)
    ky('mã chia sẻ đổi cửa hàng ⇒ null', kho.docMaChiaSe(`${sid}.${Buffer.from('branch_xyz').toString('base64url')}.${ma.split('.')[2]}`) === null)

    console.log('== 3. MIME phát tệp')
    const pdf = Buffer.from('%PDF-1.7\n...'), jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), html = Buffer.from('<!doctype html><script>alert(1)</script>')
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
    const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0])
    ky('PDF thật ⇒ xem tại chỗ', JSON.stringify(kho.mimePhat('application/pdf', pdf)) === JSON.stringify({ mime: 'application/pdf', xemTaiCho: true }))
    ky('JPEG khai là PNG ⇒ theo byte', kho.mimePhat('image/png', jpg).mime === 'image/jpeg')
    ky('HTML ⇒ octet-stream, không xem', JSON.stringify(kho.mimePhat('text/html', html)) === JSON.stringify({ mime: 'application/octet-stream', xemTaiCho: false }))
    ky('HTML giả PDF ⇒ không xem', kho.mimePhat('application/pdf', html).xemTaiCho === false)
    ky('SVG ⇒ không xem', kho.mimePhat('image/svg+xml', svg).xemTaiCho === false)
    ky('text/plain có <script> ⇒ không xem', kho.mimePhat('text/plain', html).xemTaiCho === false)
    ky('text/plain sạch ⇒ xem, utf-8', kho.mimePhat('text/plain', Buffer.from('Biên bản giao hàng\nSố lượng: 3')).mime === 'text/plain; charset=utf-8')
    ky('docx ⇒ giữ MIME Office, tải về', JSON.stringify(kho.mimePhat('application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx)) ===
        JSON.stringify({ mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xemTaiCho: false }))
    ky('laXemTaiCho kèm charset', kho.laXemTaiCho('text/plain; charset=utf-8') && !kho.laXemTaiCho('text/html'))
    const cd = kho.contentDisposition('attachment', 'Hợp đồng "A".pdf')
    ky('Content-Disposition có filename* UTF-8', cd.includes(`filename*=UTF-8''${encodeURIComponent('Hợp đồng _A_.pdf')}`) && cd.includes('filename="Hop dong _A_.pdf"'), cd)

    console.log('== 4. AI không bịa')
    const chu = 'HỢP ĐỒNG MUA BÁN số 12/2026/HĐMB. Ngày 05/03/2026. Bên A: Công ty TNHH Sunhouse MST 0101234567. Tổng giá trị: 12.500.000 đồng. Hợp đồng có hiệu lực đến hết ngày 31 tháng 12 năm 2026. ĐT 0987 654 321.'
    ky('ngày trong chữ: d/m/yyyy + "ngày d tháng m năm yyyy"', ngayTrongChu(chu).has('2026-03-05') && ngayTrongChu(chu).has('2026-12-31'))
    ky('ngày trong chữ: yyyy-mm-dd', ngayTrongChu('hạn 2027-01-15').has('2027-01-15'))
    ky('số tiền có dấu chấm ngăn nghìn', soTrongChu(chu).has(12500000))
    const kq = locKetQuaAi({
        loai: 'hop_dong', tieuDe: 'Hợp đồng mua bán với Sunhouse', tomTat: 'Mua nồi cơm', soHieu: '12/2026/HĐMB',
        ngayLap: '2026-03-05', ngayHieuLuc: '2026-03-06', ngayHetHan: '2026-12-31',
        cacBen: [{ vaiTro: 'ben_a', ten: 'Công ty TNHH Sunhouse', maSoThue: '0101234567', dienThoai: '0987654321' }, { vaiTro: 'ben_b', ten: 'Kengi', maSoThue: '0309999999', dienThoai: null }],
        tongTien: 12500000, donViTien: 'VND', nhan: ['Hợp đồng', 'hợp đồng', '#sunhouse'], nhomGoiY: 'docs_supplier', doTinCay: 'cao', canhBao: [], chu,
    }, '', 'gemini-thu')
    ky('giữ ngày có trong chữ', kq.ngayLap === '2026-03-05' && kq.ngayHetHan === '2026-12-31', JSON.stringify([kq.ngayLap, kq.ngayHetHan]))
    ky('bỏ ngày KHÔNG có trong chữ (06/03)', kq.ngayHieuLuc === null && kq.canhBao.some(c => c.includes('06/03/2026')), JSON.stringify(kq.canhBao))
    ky('giữ tổng tiền có trong chữ', kq.tongTien === 12500000)
    ky('giữ số hiệu có trong chữ', kq.soHieu === '12/2026/HĐMB')
    ky('giữ MST + ĐT có trong chữ', kq.cacBen[0]?.maSoThue === '0101234567' && kq.cacBen[0]?.dienThoai === '0987654321')
    ky('bỏ MST bịa', kq.cacBen[1]?.maSoThue === null)
    ky('nhãn bỏ trùng + bỏ #', JSON.stringify(kq.nhan) === JSON.stringify(['hợp đồng', 'sunhouse']), JSON.stringify(kq.nhan))
    const bia = locKetQuaAi({ loai: 'la_lung', tongTien: 99000000, soHieu: 'HD-999', ngayHetHan: '2027-02-30', nhomGoiY: 'xyz', chu }, '', 'm')
    ky('loại lạ ⇒ khac, nhóm lạ ⇒ null', bia.loai === 'khac' && bia.nhomGoiY === null)
    ky('tiền bịa ⇒ bỏ + cảnh báo', bia.tongTien === null && bia.canhBao.some(c => c.includes('tổng tiền')))
    ky('số hiệu bịa ⇒ bỏ', bia.soHieu === null)
    ky('ngày không tồn tại (30/02) ⇒ bỏ', bia.ngayHetHan === null)
    const nguonThat = locKetQuaAi({ ngayHetHan: '2026-12-31', chu: 'chữ AI tự chép (không có ngày)' }, 'Bản gốc: hiệu lực đến 31/12/2026', 'm')
    ky('tệp chữ (docx/xlsx): soát theo CHỮ GỐC, không theo chữ AI chép', nguonThat.ngayHetHan === '2026-12-31')
    ky('cachGuiAi: PDF inline, docx chữ, zip không', cachGuiAi('application/pdf', 'a.pdf', 1000).kieu === 'inline'
        && cachGuiAi('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx', 1000).kieu === 'chu'
        && cachGuiAi('application/zip', 'a.zip', 1000).kieu === null && cachGuiAi('application/pdf', 'a.pdf', 30 * 1048576).kieu === null)

    console.log('== 4b. Chữ từ docx')
    const xml = '<w:document><w:body><w:p><w:r><w:t>Hợp đồng số 7</w:t></w:r></w:p><w:p><w:r><w:t>Hết hạn 31/12/2027 &amp; gia hạn</w:t></w:r></w:p></w:body></w:document>'
    const docxStored = await zipRaBuffer([{ ten: '[Content_Types].xml', du: Buffer.from('<x/>') }, { ten: 'word/document.xml', du: Buffer.from(xml) }])
    ky('docMucZip đọc mục STORED', docMucZip(docxStored, 'word/document.xml')?.toString('utf8') === xml)
    ky('trichChuVanPhong docx ⇒ chữ + xuống dòng + giải &amp;', trichChuVanPhong(docxStored, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx') === 'Hợp đồng số 7\nHết hạn 31/12/2027 & gia hạn')
    // ZIP nén deflate (kiểu Word thật lưu) — dựng tay một mục
    const ten = Buffer.from('word/document.xml'), du = Buffer.from(xml), nen = zlib.deflateRawSync(du)
    const dau = Buffer.alloc(30); dau.writeUInt32LE(0x04034b50, 0); dau.writeUInt16LE(20, 4); dau.writeUInt16LE(8, 8); dau.writeUInt32LE(crc32(du), 14); dau.writeUInt32LE(nen.length, 18); dau.writeUInt32LE(du.length, 22); dau.writeUInt16LE(ten.length, 26)
    const tt = Buffer.alloc(46); tt.writeUInt32LE(0x02014b50, 0); tt.writeUInt16LE(20, 6); tt.writeUInt16LE(8, 10); tt.writeUInt32LE(crc32(du), 16); tt.writeUInt32LE(nen.length, 20); tt.writeUInt32LE(du.length, 24); tt.writeUInt16LE(ten.length, 28)
    const cuoi = Buffer.alloc(22); cuoi.writeUInt32LE(0x06054b50, 0); cuoi.writeUInt16LE(1, 8); cuoi.writeUInt16LE(1, 10); cuoi.writeUInt32LE(46 + ten.length, 12); cuoi.writeUInt32LE(30 + ten.length + nen.length, 16)
    ky('docMucZip đọc mục DEFLATE', docMucZip(Buffer.concat([dau, ten, nen, tt, ten, cuoi]), 'word/document.xml')?.toString('utf8') === xml)

    console.log('== 5. Nhắc hết hạn')
    const now = new Date('2026-10-20T03:00:00Z') // 10:00 giờ VN
    const han = (ngay: string) => new Date(`${ngay}T00:00:00+07:00`)
    ky('soNgayCon: hôm nay = 0, mai = 1, hôm qua = -1', soNgayCon(han('2026-10-20'), now) === 0 && soNgayCon(han('2026-10-21'), now) === 1 && soNgayCon(han('2026-10-19'), now) === -1)
    ky('soNgayCon theo giờ VN lúc 23:30 VN', soNgayCon(han('2026-10-21'), new Date('2026-10-20T16:30:00Z')) === 1)
    ky('ngayVN 23:30 UTC = sáng hôm sau VN', ngayVN(new Date('2026-10-20T23:30:00Z')) === '2026-10-21')
    const M = [30, 7, 1]
    let f: any = { expiresAt: han('2026-11-09'), remindDays: null, reminded: null } // còn 20 ngày
    let r = mocCanNhac(f, M, now)
    ky('còn 20 ngày ⇒ nhắc mốc 30', r.nhac && r.con === 20 && r.ghi === '2026-11-09:30', r.ghi)
    f = { ...f, reminded: r.ghi }
    r = mocCanNhac(f, M, new Date('2026-10-21T03:00:00Z'))
    ky('hôm sau (19 ngày) ⇒ im', !r.nhac && r.ghi === '2026-11-09:30', r.ghi)
    r = mocCanNhac(f, M, new Date('2026-11-02T03:00:00Z'))
    ky('còn 7 ngày ⇒ nhắc mốc 7', r.nhac && r.ghi === '2026-11-09:30,7', r.ghi)
    f = { expiresAt: han('2026-10-23'), remindDays: null, reminded: null }
    r = mocCanNhac(f, M, now)
    ky('hạn vừa nhập còn 3 ngày ⇒ nhắc 1 lần, ghi cả 30+7', r.nhac && r.ghi === '2026-10-23:30,7', r.ghi)
    r = mocCanNhac({ ...f, reminded: r.ghi }, M, now)
    ky('cùng ngày chạy lại ⇒ im', !r.nhac)
    r = mocCanNhac({ ...f, reminded: '2026-10-23:30,7' }, M, new Date('2026-10-23T03:00:00Z'))
    ky('ngày hết hạn ⇒ nhắc mốc 0 (ghi gộp cả mốc 1 chưa nhắc)', r.nhac && r.con === 0 && r.ghi === '2026-10-23:30,7,1,0', r.ghi)
    r = mocCanNhac({ ...f, reminded: '2026-10-23:30,7,1,0' }, M, new Date('2026-10-25T03:00:00Z'))
    ky('hết hạn 2 ngày ⇒ báo "het" một lần', r.nhac && r.ghi.endsWith(',het'), r.ghi)
    r = mocCanNhac({ ...f, reminded: '2026-10-23:30,7,1,0,het' }, M, new Date('2026-10-26T03:00:00Z'))
    ky('đã báo het ⇒ im', !r.nhac)
    r = mocCanNhac({ expiresAt: han('2026-08-01'), remindDays: null, reminded: null }, M, now)
    ky('hết hạn 80 ngày từ trước khi có tính năng ⇒ đánh dấu im lặng', !r.nhac && r.ghi.includes('het'))
    r = mocCanNhac({ ...f, expiresAt: han('2026-12-31'), reminded: '2026-10-23:30,7' }, M, now)
    ky('đổi hạn ⇒ mốc cũ không còn tính', !r.nhac && r.ghi === '2026-12-31:', r.ghi)
    r = mocCanNhac({ expiresAt: han('2026-10-30'), remindDays: 3, reminded: null }, M, now)
    ky('nhắc trước 3 ngày: còn 10 ngày ⇒ im', !r.nhac)
    r = mocCanNhac({ expiresAt: han('2026-10-23'), remindDays: 3, reminded: null }, M, now)
    ky('nhắc trước 3 ngày: còn 3 ngày ⇒ nhắc', r.nhac && r.ghi === '2026-10-23:3', r.ghi)

    console.log('== 6. Kho cục bộ (giả lập GCS resumable)')
    const key = kho.khoaMoi('branch_thu', 'vabc123')
    const noiDung = crypto.randomBytes(kho.KHOI_TAI_LEN + 12345)
    const url = await kho.taoPhienTaiLen(key, 'application/pdf', noiDung.length)
    const token = decodeURIComponent(url.split('/cuc-bo/')[1]!)
    let k = await kho.nhanKhoiCucBo(token, `bytes 5-9/${noiDung.length}`, noiDung.subarray(5, 10))
    ky('khối sai vị trí ⇒ 308, chưa có Range', k.status === 308 && !k.range, JSON.stringify(k))
    k = await kho.nhanKhoiCucBo(token, `bytes 0-${kho.KHOI_TAI_LEN - 1}/${noiDung.length}`, noiDung.subarray(0, kho.KHOI_TAI_LEN))
    ky('khối đầu ⇒ 308 + Range', k.status === 308 && k.range === `bytes=0-${kho.KHOI_TAI_LEN - 1}`, JSON.stringify(k))
    k = await kho.nhanKhoiCucBo(token, `bytes */${noiDung.length}`, Buffer.alloc(0))
    ky('hỏi vị trí ⇒ 308 + Range', k.status === 308 && k.range === `bytes=0-${kho.KHOI_TAI_LEN - 1}`)
    k = await kho.nhanKhoiCucBo(token, `bytes ${kho.KHOI_TAI_LEN}-${noiDung.length - 1}/${noiDung.length}`, noiDung.subarray(kho.KHOI_TAI_LEN))
    ky('khối cuối ⇒ 200', k.status === 200, JSON.stringify(k))
    const ttin = await kho.thongTin(key)
    ky('thongTin: cỡ + md5 đúng', ttin?.size === noiDung.length && ttin?.md5 === crypto.createHash('md5').update(noiDung).digest('hex'))
    ky('đọc đoạn [100,199]', (await kho.docDoan(key, 100, 199)).equals(noiDung.subarray(100, 200)))
    ky('token giả ⇒ 403', (await kho.nhanKhoiCucBo(token.replace(/.$/, c => (c === 'A' ? 'B' : 'A')), `bytes */${noiDung.length}`, Buffer.alloc(0))).status === 403)
    ky('khoá cửa hàng khác ⇒ không thuộc', !kho.khoaCuaCuaHang(key, 'branch_khac') && kho.khoaCuaCuaHang(key, 'branch_thu'))
    let nem = false
    try { await kho.ghi('v/branch_thu/../../x', Buffer.from('x'), 'text/plain') } catch { nem = true }
    ky('khoá có ../ ⇒ từ chối', nem)
    await kho.xoa(key)
    ky('xoá xong ⇒ thongTin null', (await kho.thongTin(key)) === null)

    console.log('== 7. DDL ↔ /admin/migrate')
    const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.ts'), 'utf8')
    const thieu: string[] = []
    for (const cau of kho.DDL_VAULT) {
        const m = /ADD COLUMN IF NOT EXISTS "(\w+)"/.exec(cau) || /CREATE TABLE IF NOT EXISTS "\{s\}"\."(\w+)"/.exec(cau)
        if (!m) continue
        const can = cau.includes('ADD COLUMN') ? `ALTER TABLE "StorageFile" ADD COLUMN IF NOT EXISTS "${m[1]}"` : `CREATE TABLE IF NOT EXISTS "${m[1]}"`
        if (!admin.includes(can)) thieu.push(can)
    }
    ky('mọi cột/bảng Vault có trong /admin/migrate', !thieu.length, thieu.join(' | '))

    fs.rmSync(process.env.VAULT_LOCAL_DIR!, { recursive: true, force: true })
    console.log(`\nKengi Vault: ${dat} đạt, ${hong} hỏng`)
    process.exit(hong ? 1 : 0)
}

main().catch((e) => { console.error('LỖI soát:', e); process.exit(2) })
