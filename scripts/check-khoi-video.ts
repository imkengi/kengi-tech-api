/**
 * Bộ soát KHỐI VIDEO ĐI QUA MÁY CHỦ (lib/khoiVideo.ts) — 27/10/2026.
 *   npx tsx scripts/check-khoi-video.ts
 * Sự cố: Cloud Run giết máy chủ vì vượt 512 MiB 9 lần trong 26–27/10, lúc máy dựng video tự động chạy — đường cũ
 * nhân mỗi khối video thành nhiều bản (base64 + JSON + fetch chép thân). Bản mới ghi thân THEO LÁT. Bộ này canh:
 *   · byte gửi Tino Y HỆT JSON.stringify cũ ở mọi cỡ khối (chia 3 dư 0/1/2, nhỏ hơn một lát, đúng một lát, nhiều
 *     lát + dư, khối 10MB thật, tên tệp có dấu) và Content-Length = số byte thật nhận được
 *   · PUT khối thô: máy chủ nhận đúng byte, đúng Content-Length / Content-Range
 *   · máy chủ trả lời SỚM (403 trước khi đọc hết thân, như tường lửa Tino) ⇒ không treo
 *   · quá giờ ⇒ ném lỗi, không treo
 *   · đọc Drive: đúng cỡ, ghi vào bộ đệm dùng lại, Drive trả thiếu ⇒ ngắn hơn, Drive trả thừa ⇒ ném + dừng đọc
 * Chỉ dùng máy chủ HTTP trên 127.0.0.1 — không gọi mạng ngoài.
 */
import http from 'http'
import crypto from 'crypto'
import { Readable } from 'stream'
import { AddressInfo } from 'net'
import { guiJsonKemBase64, guiThan, CHO_BASE64, docKhoiDrive } from '../src/lib/khoiVideo'

let loi = 0, dat = 0
const dung = (ten: string, ok: boolean, chiTiet?: unknown) => {
    if (ok) dat++
    else loi++
    console.log(`${ok ? '✓' : '✗'} ${ten}${!ok && chiTiet !== undefined ? ' — ' + JSON.stringify(chiTiet).slice(0, 300) : ''}`)
}

type DaNhan = { method: string; url: string; headers: http.IncomingHttpHeaders; than: Buffer }
const nhan: DaNhan[] = []

const mayChu = http.createServer((req, res) => {
    if (req.url === '/som') {
        // Như tường lửa hosting: trả 403 NGAY, không đọc thân
        res.writeHead(403, { 'Content-Type': 'text/html' })
        res.end('<html>403 Forbidden</html>')
        return
    }
    const phan: Buffer[] = []
    req.on('data', d => phan.push(d))
    req.on('end', () => {
        nhan.push({ method: req.method || '', url: req.url || '', headers: req.headers, than: Buffer.concat(phan) })
        if (req.url === '/cham') return            // không bao giờ trả lời
        if (req.url === '/google') {
            res.writeHead(308, { Range: `bytes=0-${Buffer.concat(phan).length - 1}` })
            res.end()
            return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"error":"","message":"","response":{}}')
    })
})

const ngauNhien = (n: number) => crypto.randomBytes(n)
const voiHan = <T>(p: Promise<T>, ms: number) => Promise.race([
    p.then(v => ({ xong: true as const, v }), e => ({ xong: true as const, e })),
    new Promise<{ xong: false }>(r => setTimeout(() => r({ xong: false }), ms)),
])

/** Drive giả: files.get trả luồng mẩu 16KB của `nguon`, ghi lại tham số để soát Range/responseType. */
function driveGia(nguon: Buffer) {
    const goi: any[] = []
    let luong: Readable | null = null
    return {
        goi,
        luong: () => luong,
        files: {
            get: async (thamSo: any, tuyChon: any) => {
                goi.push({ thamSo, tuyChon })
                const manh: Buffer[] = []
                for (let i = 0; i < nguon.length; i += 16384) manh.push(nguon.subarray(i, i + 16384))
                luong = Readable.from(manh)
                return { data: luong }
            },
        },
    }
}

async function main() {
    await new Promise<void>(r => mayChu.listen(0, '127.0.0.1', () => r()))
    const goc = `http://127.0.0.1:${(mayChu.address() as AddressInfo).port}`

    // ── 1. JSON + base64 gửi Tino: byte y hệt JSON.stringify cũ ──────────────────────
    const LAT = 48 * 1024
    const CO = [1, 2, 3, 4, 1000, LAT - 1, LAT, LAT + 1, LAT * 3 + 2, 262144, 10 * 1048576 - 1, 10 * 1048576]
    for (const n of CO) {
        const dl = ngauNhien(n)
        // Ca 1000 byte: chữ có dấu ở CẢ phần đầu (trước base64) lẫn phần đuôi — Content-Length phải đếm BYTE, không đếm ký tự
        const fields = { video_upload_id: n === 1000 ? 'phiên-thử "số 3"' : 'sg-11110000-abc', part_seq: 3, part_md5: crypto.createHash('md5').update(dl).digest('hex') }
        const tenTep = n === 1000 ? 'ảnh-khiếu-nại "đơn" 01.jpg' : `part-${n}.bin`
        const khuonCu = (b64: string) => ({ secret: 's3cr3t', url: 'https://partner.shopeemobile.com/api/v2/media/upload_video_part?partner_id=1&sign=x', fields, part_b64: b64, file_field: 'part_content', file_name: tenTep, file_mime: 'application/octet-stream' })
        const mong = Buffer.from(JSON.stringify(khuonCu(Buffer.from(dl).toString('base64'))), 'utf8')
        nhan.length = 0
        const r = await guiJsonKemBase64(goc + '/tino', khuonCu(CHO_BASE64), dl, 30_000)
        const t = nhan[0]
        dung(`Tino ${n} byte: thân y hệt JSON.stringify cũ`, !!t && t.than.equals(mong), t && { nhan: t.than.length, mong: mong.length })
        dung(`Tino ${n} byte: Content-Length = byte thật, kiểu application/json`, !!t && Number(t.headers['content-length']) === t.than.length && t.headers['content-type'] === 'application/json' && !t.headers['transfer-encoding'],
            t && { cl: t.headers['content-length'], that: t.than.length, te: t.headers['transfer-encoding'] })
        dung(`Tino ${n} byte: đọc được phản hồi`, r.status === 200 && JSON.parse(r.text).error === '', r)
    }
    // Phần nhìn vào (subarray giữa một Buffer lớn) — đúng byte của khúc đó, không lẫn byte hàng xóm
    {
        const lon = ngauNhien(300_000), khuc = lon.subarray(1234, 1234 + 150_001)
        nhan.length = 0
        await guiJsonKemBase64(goc + '/tino', { a: 1, b: CHO_BASE64 }, khuc, 30_000)
        dung('Tino: khối là subarray ⇒ chỉ đúng byte của khúc', nhan[0]?.than.equals(Buffer.from(JSON.stringify({ a: 1, b: Buffer.from(khuc).toString('base64') }))))
    }
    // Khuôn sai ⇒ ném lỗi rõ ràng, không gửi bậy
    for (const [ten, khuon] of [['không có chỗ base64', { a: 1 }], ['hai chỗ base64', { a: CHO_BASE64, b: CHO_BASE64 }]] as const) {
        let nem = ''
        try { await guiJsonKemBase64(goc + '/tino', khuon as any, ngauNhien(10), 5_000) } catch (e: any) { nem = String(e?.message || e) }
        dung(`khuôn ${ten} ⇒ ném lỗi`, /đúng một trường/.test(nem), nem)
    }

    // ── 2. PUT khối thô (đường trình duyệt → Drive) ───────────────────────────────
    {
        const khoi = ngauNhien(6_710_886)
        nhan.length = 0
        const r = await guiThan(goc + '/google', { method: 'PUT', timeoutMs: 30_000, headers: { 'Content-Range': `bytes 8388608-${8388608 + khoi.length - 1}/20000000`, 'Content-Length': String(khoi.length) } }, [khoi])
        const t = nhan[0]
        dung('PUT khối 6,4MB: nhận đúng byte', !!t && t.method === 'PUT' && t.than.equals(khoi))
        dung('PUT khối: giữ Content-Length + Content-Range', !!t && Number(t.headers['content-length']) === khoi.length && t.headers['content-range'] === `bytes 8388608-${8388608 + khoi.length - 1}/20000000`)
        dung('PUT khối: đọc được 308 + Range', r.status === 308 && r.headers.range === `bytes=0-${khoi.length - 1}`, { st: r.status, range: r.headers.range })
    }

    // ── 3. Trả lời sớm / quá giờ: không treo ──────────────────────────────────────
    {
        const kq = await voiHan(guiJsonKemBase64(goc + '/som', { x: CHO_BASE64 }, ngauNhien(10 * 1048576), 30_000), 8_000)
        const ok = kq.xong && (('v' in kq && kq.v.status === 403) || ('e' in kq && /ECONNRESET|EPIPE|socket/i.test(String((kq as any).e?.message || (kq as any).e?.code))))
        dung('máy chủ trả 403 trước khi đọc hết thân ⇒ trả kết quả, không treo', !!ok, kq.xong ? ('v' in kq ? { status: kq.v.status } : { loi: String((kq as any).e) }) : 'TREO')
    }
    {
        const kq = await voiHan(guiThan(goc + '/cham', { method: 'POST', timeoutMs: 400, headers: { 'Content-Length': '3' } }, ['abc']), 5_000)
        dung('máy chủ im lặng ⇒ ném lỗi quá giờ', kq.xong && 'e' in kq && /Quá/.test(String((kq as any).e?.message)), kq.xong ? String((kq as any).e?.message || 'không ném') : 'TREO')
    }

    // ── 4. Đọc khối Drive ─────────────────────────────────────────────────────────
    {
        const nguon = ngauNhien(10 * 1048576)
        const d = driveGia(nguon)
        const boDem = Buffer.allocUnsafe(10 * 1048576)
        const khoi = await docKhoiDrive(d, 'file-1', 20 * 1048576, 30 * 1048576 - 1, boDem)
        dung('Drive: đúng byte, đúng cỡ', khoi.length === nguon.length && khoi.equals(nguon))
        dung('Drive: ghi THẲNG vào bộ đệm truyền vào (không cấp mới)', khoi.buffer === boDem.buffer && khoi.byteOffset === boDem.byteOffset)
        const g = d.goi[0]
        dung('Drive: alt=media + Range đúng + responseType stream', g.thamSo.alt === 'media' && g.thamSo.fileId === 'file-1' && g.thamSo.supportsAllDrives === true
            && g.tuyChon.responseType === 'stream' && g.tuyChon.headers.Range === `bytes=${20 * 1048576}-${30 * 1048576 - 1}`, g)
    }
    {
        const nguon = ngauNhien(3_000_000)
        const khoi = await docKhoiDrive(driveGia(nguon), 'f', 0, 4_194_303)
        dung('Drive trả THIẾU ⇒ khối ngắn hơn (bên gọi so độ dài như cũ)', khoi.length === 3_000_000 && khoi.equals(nguon))
    }
    {
        const nguon = ngauNhien(5_000_000)
        const boDemNho = Buffer.allocUnsafe(100)
        const khoi = await docKhoiDrive(driveGia(nguon), 'f', 0, 4_999_999, boDemNho)
        dung('bộ đệm nhỏ hơn khối ⇒ tự cấp đủ cỡ, đúng byte', khoi.length === 5_000_000 && khoi.equals(nguon) && khoi.buffer !== boDemNho.buffer)
    }
    {
        const d = driveGia(ngauNhien(20 * 1048576))   // Drive bỏ qua Range, đổ cả file
        let nem = ''
        try { await docKhoiDrive(d, 'f', 0, 1048575) } catch (e: any) { nem = String(e?.message || e) }
        dung('Drive trả THỪA ⇒ ném lỗi', /không tôn trọng Range/.test(nem), nem)
        dung('Drive trả THỪA ⇒ dừng đọc (luồng bị huỷ, không kéo cả file)', d.luong()?.destroyed === true)
    }

    mayChu.close()
    console.log(`\n${dat}/${dat + loi} ca đạt`)
    process.exit(loi ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
