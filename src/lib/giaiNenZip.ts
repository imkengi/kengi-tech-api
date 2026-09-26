// ─────────────────────────────────────────────────────────────────────────────
//  GIẢI NÉN ZIP TỐI THIỂU — chỉ lấy các tệp .xml (26/09/2026)
//
//  Nhiều nhà cung cấp HĐĐT gửi hoá đơn dạng MỘT tệp .zip (XML + PDF) đính kèm
//  thư. Dự án chưa có thư viện zip nào; zip thường gặp chỉ dùng "stored" (0) hoặc
//  "deflate" (8), đọc được bằng zlib có sẵn của Node. Đọc theo THƯ MỤC TRUNG TÂM
//  (central directory) ở cuối tệp — tin cậy hơn quét header cục bộ.
//
//  Chặn cứng để một tệp lạ không kéo sập máy (512 MiB): tối đa 20 tệp XML,
//  mỗi tệp ≤ 5 MB sau giải nén; bỏ tệp mã hoá, ZIP64, phương thức nén khác.
//  Hỏng ở đâu thì trả những gì đã lấy được, không ném.
// ─────────────────────────────────────────────────────────────────────────────
import zlib from 'zlib'

const SIG_EOCD = 0x06054b50
const SIG_CD = 0x02014b50
const SIG_LOCAL = 0x04034b50

export function layXmlTrongZip(buf: Buffer, opts: { toiDaTep?: number; toiDaByte?: number } = {}): Array<{ ten: string; noiDung: Buffer }> {
    const toiDaTep = opts.toiDaTep ?? 20
    const toiDaByte = opts.toiDaByte ?? 5 * 1024 * 1024
    const out: Array<{ ten: string; noiDung: Buffer }> = []
    try {
        if (buf.length < 22) return out
        let eocd = -1
        const dung = Math.max(0, buf.length - 22 - 65535)
        for (let i = buf.length - 22; i >= dung; i--) {
            if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break }
        }
        if (eocd < 0) return out
        const soMuc = buf.readUInt16LE(eocd + 10)
        let p = buf.readUInt32LE(eocd + 16)
        for (let n = 0; n < soMuc && n < 500; n++) {
            if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CD) break
            const co = buf.readUInt16LE(p + 8)
            const phuongThuc = buf.readUInt16LE(p + 10)
            const coNen = buf.readUInt32LE(p + 20)
            const coGoc = buf.readUInt32LE(p + 24)
            const dTen = buf.readUInt16LE(p + 28)
            const dPhu = buf.readUInt16LE(p + 30)
            const dChu = buf.readUInt16LE(p + 32)
            const viTri = buf.readUInt32LE(p + 42)
            const ten = buf.slice(p + 46, p + 46 + dTen).toString(co & 0x800 ? 'utf8' : 'latin1')
            p += 46 + dTen + dPhu + dChu

            if (!/\.xml$/i.test(ten)) continue
            if (co & 0x1) continue                                   // mã hoá
            if (coNen === 0xffffffff || coGoc === 0xffffffff) continue // ZIP64
            if (coGoc > toiDaByte) continue
            if (viTri + 30 > buf.length || buf.readUInt32LE(viTri) !== SIG_LOCAL) continue
            const batDau = viTri + 30 + buf.readUInt16LE(viTri + 26) + buf.readUInt16LE(viTri + 28)
            const duLieu = buf.slice(batDau, batDau + coNen)
            let noiDung: Buffer
            if (phuongThuc === 0) noiDung = duLieu
            else if (phuongThuc === 8) {
                // Một tệp hỏng/quá cỡ chỉ bỏ tệp đó, không bỏ cả gói
                try { noiDung = zlib.inflateRawSync(duLieu, { maxOutputLength: toiDaByte }) }
                catch { continue }
            } else continue
            out.push({ ten: ten.split('/').pop() || ten, noiDung })
            if (out.length >= toiDaTep) break
        }
    } catch { /* trả phần đã lấy được */ }
    return out
}
