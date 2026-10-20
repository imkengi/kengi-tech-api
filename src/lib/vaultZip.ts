/* ═══════════════════════════════════════════════════════════════════════════════
 *  GHI TỆP ZIP THEO LUỒNG — tải nhiều tài liệu Kengi Vault một lần (20/10/2026)
 *
 *  Kiểu STORED (không nén): PDF/ảnh/video/docx đều đã nén sẵn, nén lại chỉ tốn CPU Cloud Run mà gần như
 *  không nhỏ đi. Ghi THẲNG ra response, không dồn cả tệp vào RAM (máy chủ chỉ 512 MiB).
 *
 *  CRC chưa biết khi bắt đầu một mục ⇒ cờ bit 3 (data descriptor): đầu mục ghi crc/cỡ = 0, sau dữ liệu
 *  ghi khối mô tả, thư mục trung tâm cuối tệp mang số thật (Windows Explorer, 7-Zip, macOS, unzip đều
 *  đọc thư mục trung tâm). Tên UTF-8 (bit 11) ⇒ tên tiếng Việt có dấu giữ nguyên.
 *  Không làm ZIP64 ⇒ người gọi phải giữ tổng < 4 GiB và < 65.535 mục (routes/storage.ts chặn 150 tệp/1 GB).
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { Readable, Writable } from 'stream'

const BANG_CRC = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        t[n] = c >>> 0
    }
    return t
})()

export function crc32(buf: Uint8Array, truoc = 0): number {
    let c = (truoc ^ 0xffffffff) >>> 0
    for (let i = 0; i < buf.length; i++) c = BANG_CRC[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

function gioDos(d: Date): { gio: number; ngay: number } {
    const y = Math.max(1980, d.getFullYear())
    return {
        gio: ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f),
        ngay: (((y - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f),
    }
}

/** Tên mục an toàn: bỏ ký tự cấm trên Windows, bỏ "..", không đường tuyệt đối */
export function tenMucZip(ten: string): string {
    return String(ten || 'tep')
        .split('/').map(p => p.replace(/[\\:*?"<>|\x00-\x1f]/g, '_').trim()).filter(p => p && p !== '.' && p !== '..')
        .join('/').slice(0, 240) || 'tep'
}

interface MucDaGhi { ten: Buffer; crc: number; co: number; viTri: number; gio: number; ngay: number }

export class BoGhiZip {
    private viTri = 0
    private muc: MucDaGhi[] = []
    private daDung = new Set<string>()

    constructor(private ra: Writable) {}

    private async ghi(buf: Buffer): Promise<void> {
        this.viTri += buf.length
        if (!this.ra.write(buf)) await new Promise<void>((ok, loi) => {
            const xong = () => { this.ra.off('error', hong); ok() }
            const hong = (e: Error) => { this.ra.off('drain', xong); loi(e) }
            this.ra.once('drain', xong)
            this.ra.once('error', hong)
        })
    }

    /** Tên trùng trong cùng ZIP ⇒ "a (2).pdf" */
    tenKhongTrung(ten: string): string {
        let t = tenMucZip(ten)
        if (!this.daDung.has(t.toLowerCase())) { this.daDung.add(t.toLowerCase()); return t }
        const cham = t.lastIndexOf('.')
        const goc = cham > t.lastIndexOf('/') && cham > 0 ? t.slice(0, cham) : t
        const duoi = cham > t.lastIndexOf('/') && cham > 0 ? t.slice(cham) : ''
        for (let i = 2; ; i++) {
            t = `${goc} (${i})${duoi}`
            if (!this.daDung.has(t.toLowerCase())) { this.daDung.add(t.toLowerCase()); return t }
        }
    }

    async themMuc(ten: string, ngay: Date, nguon: Readable): Promise<void> {
        const tenBuf = Buffer.from(this.tenKhongTrung(ten), 'utf8')
        const { gio, ngay: ng } = gioDos(ngay)
        const viTri = this.viTri
        const dau = Buffer.alloc(30)
        dau.writeUInt32LE(0x04034b50, 0)
        dau.writeUInt16LE(20, 4)          // phiên bản cần để giải
        dau.writeUInt16LE(0x0808, 6)      // bit 3 data descriptor + bit 11 UTF-8
        dau.writeUInt16LE(0, 8)           // STORED
        dau.writeUInt16LE(gio, 10)
        dau.writeUInt16LE(ng, 12)
        // crc32 / cỡ nén / cỡ gốc = 0 (nằm ở khối mô tả phía sau)
        dau.writeUInt16LE(tenBuf.length, 26)
        dau.writeUInt16LE(0, 28)
        await this.ghi(dau)
        await this.ghi(tenBuf)
        let crc = 0, co = 0
        for await (const khuc of nguon) {
            const b = Buffer.isBuffer(khuc) ? khuc : Buffer.from(khuc)
            crc = crc32(b, crc)
            co += b.length
            await this.ghi(b)
        }
        if (co >= 0xffffffff || this.viTri >= 0xffffffff) throw new Error('ZIP vượt 4 GiB (chưa hỗ trợ ZIP64)')
        const moTa = Buffer.alloc(16)
        moTa.writeUInt32LE(0x08074b50, 0)
        moTa.writeUInt32LE(crc >>> 0, 4)
        moTa.writeUInt32LE(co, 8)
        moTa.writeUInt32LE(co, 12)
        await this.ghi(moTa)
        this.muc.push({ ten: tenBuf, crc: crc >>> 0, co, viTri, gio, ngay: ng })
    }

    async ketThuc(): Promise<void> {
        if (this.muc.length >= 0xffff) throw new Error('ZIP quá 65.534 mục')
        const batDau = this.viTri
        for (const m of this.muc) {
            const t = Buffer.alloc(46)
            t.writeUInt32LE(0x02014b50, 0)
            t.writeUInt16LE(0x031e, 4)    // tạo bởi: Unix, 3.0
            t.writeUInt16LE(20, 6)
            t.writeUInt16LE(0x0808, 8)
            t.writeUInt16LE(0, 10)
            t.writeUInt16LE(m.gio, 12)
            t.writeUInt16LE(m.ngay, 14)
            t.writeUInt32LE(m.crc, 16)
            t.writeUInt32LE(m.co, 20)
            t.writeUInt32LE(m.co, 24)
            t.writeUInt16LE(m.ten.length, 28)
            t.writeUInt16LE(0, 30)        // extra
            t.writeUInt16LE(0, 32)        // comment
            t.writeUInt16LE(0, 34)        // đĩa
            t.writeUInt16LE(0, 36)        // thuộc tính trong
            t.writeUInt32LE((0o100644 << 16) >>> 0, 38) // thuộc tính ngoài: tệp thường rw-r--r--
            t.writeUInt32LE(m.viTri, 42)
            await this.ghi(t)
            await this.ghi(m.ten)
        }
        const coThuMuc = this.viTri - batDau
        const cuoi = Buffer.alloc(22)
        cuoi.writeUInt32LE(0x06054b50, 0)
        cuoi.writeUInt16LE(0, 4)
        cuoi.writeUInt16LE(0, 6)
        cuoi.writeUInt16LE(this.muc.length, 8)
        cuoi.writeUInt16LE(this.muc.length, 10)
        cuoi.writeUInt32LE(coThuMuc, 12)
        cuoi.writeUInt32LE(batDau, 16)
        cuoi.writeUInt16LE(0, 20)
        await this.ghi(cuoi)
    }
}
