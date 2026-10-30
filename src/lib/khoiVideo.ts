// ═══════════════════════════════════════════════════════════════════════════════
//  KHỐI VIDEO ĐI QUA MÁY CHỦ MÀ KHÔNG NHÂN BẢN BYTE (27/10/2026)
//
//  Cloud Run giết máy chủ vì vượt 512 MiB 9 lần trong 26–27/10, đúng lúc máy dựng
//  video tự động chạy (chiều 27/10: 29 video / 36 phút). Mỗi byte video đi qua RAM
//  HAI lần — trình duyệt → máy chủ → Drive, rồi Drive → máy chủ → Tino → Shopee — và
//  đường cũ nhân một khối thành nhiều bản:
//    · tải khối Drive bằng responseType 'arraybuffer': node-fetch giữ các mẩu, nối
//      thành một Buffer rồi CẮT ra ArrayBuffer mới ⇒ 3 bản
//    · gửi Tino: Buffer.from (chép) → chuỗi base64 (1,33×) → chuỗi JSON (1,33×,
//      nằm trong heap V8 mà trần heap prod chỉ 259MB) → fetch mã hoá lại (1,33×)
//    · chuyển khối trình duyệt → Drive: new Uint8Array (chép) → Buffer.from (chép)
//      → fetch chép thân Buffer thêm một lần (đúng đặc tả fetch)
//  Máy chủ thường trực đã ở 330–400MB (heap ~140MB + 12 client Prisma ~100MB), một
//  khối 10MB phình ~80MB, khối tải lên 6,4MB phình ~32MB, chồng nhau là quá 512.
//
//  Ở đây: đọc Drive thẳng vào MỘT Buffer đúng cỡ (dùng lại giữa các khối), gửi đi
//  bằng node:http(s) ghi THEO LÁT và chờ 'drain' — không bao giờ có bản sao cả khối.
//  Đo cục bộ cùng khối lượng việc (12 khối 10MB lên Tino + 12 khối 6,4MB lên Drive):
//  đỉnh RSS tăng ~240MB ⇒ ~105MB; heap V8 không còn nhích.
// ═══════════════════════════════════════════════════════════════════════════════

import http from 'http'
import https from 'https'

/**
 * Đọc byte [tu, den] của file Drive (alt=media + Range) vào MỘT Buffer đúng cỡ.
 * Truyền `boDem` đủ lớn thì ghi thẳng vào đó — bên gọi dùng lại một bộ đệm cho mọi
 * khối của một lượt. Trả về ĐÚNG phần đã nhận (ngắn hơn khi Drive trả thiếu — bên
 * gọi vẫn so độ dài như cũ); Drive trả THỪA (bỏ qua Range, đổ cả file) thì dừng đọc
 * ngay, đừng kéo cả GB về.
 */
export async function docKhoiDrive(drive: any, fileId: string, tu: number, den: number, boDem?: Buffer): Promise<Buffer> {
    const can = den - tu + 1
    const dich = boDem && boDem.length >= can ? boDem : Buffer.allocUnsafe(can)
    const r = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream', headers: { Range: `bytes=${tu}-${den}` } },
    )
    let n = 0
    // Ném lỗi giữa vòng for-await thì luồng tự bị huỷ (iterator.return)
    for await (const manh of r.data as AsyncIterable<Buffer>) {
        if (n + manh.length > can) throw new Error(`Drive trả hơn ${can} byte cho khối ${tu}-${den} — Drive không tôn trọng Range?`)
        manh.copy(dich, n)
        n += manh.length
    }
    return dich.subarray(0, n)
}

export interface KetQuaHttp {
    status: number
    headers: http.IncomingHttpHeaders
    text: string
}

/**
 * Gửi một yêu cầu mà thân là các LÁT (chuỗi hoặc byte), ghi lần lượt và chờ 'drain'
 * ⇒ mỗi lúc chỉ một hai lát nằm trong RAM. Dùng node:http(s) chứ KHÔNG fetch: fetch
 * của Node chép thân Buffer thêm một bản (đặc tả fetch) và mã hoá lại thân chuỗi.
 * `headers` PHẢI có Content-Length — Google/Tino cần, và để không rơi vào chunked.
 */
export function guiThan(
    url: string,
    opt: { method: string; headers: Record<string, string>; timeoutMs: number },
    cacLat: Iterable<string | Uint8Array>,
): Promise<KetQuaHttp> {
    return new Promise((xong, hong) => {
        const u = new URL(url)
        const mod = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null
        if (!mod) { hong(new Error(`Không gửi được tới giao thức ${u.protocol}`)); return }

        let daXong = false
        const ket = (loi: Error | null, kq?: KetQuaHttp) => {
            if (daXong) return
            daXong = true
            clearTimeout(hen)
            if (loi) hong(loi)
            else xong(kq as KetQuaHttp)
        }
        const req = mod.request(u, { method: opt.method, headers: opt.headers }, res => {
            const phan: Buffer[] = []
            res.on('data', (d: Buffer) => phan.push(d))
            res.on('end', () => ket(null, { status: res.statusCode || 0, headers: res.headers, text: Buffer.concat(phan).toString('utf8') }))
            res.on('error', e => ket(e))
        })
        const hen = setTimeout(() => req.destroy(new Error(`Quá ${Math.round(opt.timeoutMs / 1000)} giây chưa gửi xong tới ${u.host}`)), opt.timeoutMs)
        req.on('error', e => ket(e))

        // Chờ 'drain' — hoặc 'close' khi yêu cầu đã gãy, để vòng ghi không treo mãi
        const choCan = () => new Promise<void>(r => {
            const di = () => { req.off('drain', di); req.off('close', di); r() }
            req.on('drain', di)
            req.on('close', di)
        })
        ;(async () => {
            for (const lat of cacLat) {
                if (daXong || req.destroyed) return
                if (!req.write(lat)) await choCan()
            }
            if (!daXong && !req.destroyed) req.end()
        })().catch(e => req.destroy(e))
    })
}

/** Chỗ đặt base64 trong khuôn JSON của guiJsonKemBase64 — giá trị của ĐÚNG MỘT trường. */
export const CHO_BASE64 = '__KENGI_CHO_BASE64__'

/** 48KB = 3 × 16384: lát chia hết cho 3 byte ⇒ base64 từng lát ghép lại đúng y base64 cả khối;
 *  mỗi lát ra chuỗi 64KB — vật nhỏ ở thế hệ trẻ của V8, dọn ngay ở lượt dọn rẻ. */
const LAT_BASE64 = 48 * 1024

/**
 * POST một JSON có một trường là base64 của `dulieu`. Byte gửi đi Y HỆT
 * `JSON.stringify(khuon)` với chuỗi base64 đầy đủ đặt vào chỗ CHO_BASE64 (base64 không
 * có ký tự nào JSON phải thoát), nhưng không bao giờ dựng chuỗi base64 hay chuỗi JSON
 * của cả khối. Content-Length tính trước: đầu + 2 dấu nháy + 4·⌈n/3⌉ + đuôi.
 */
export async function guiJsonKemBase64(url: string, khuon: Record<string, unknown>, dulieu: Uint8Array, timeoutMs: number): Promise<KetQuaHttp> {
    const manh = JSON.stringify(khuon).split(JSON.stringify(CHO_BASE64))
    if (manh.length !== 2) throw new Error('Khuôn JSON phải có đúng một trường mang CHO_BASE64')
    const [dau, duoi] = manh
    const v = Buffer.from(dulieu.buffer, dulieu.byteOffset, dulieu.byteLength)   // nhìn vào, không chép
    const doDai = Buffer.byteLength(dau) + 2 + 4 * Math.ceil(v.length / 3) + Buffer.byteLength(duoi)
    function* cacLat() {
        yield dau + '"'
        for (let i = 0; i < v.length; i += LAT_BASE64) yield v.subarray(i, i + LAT_BASE64).toString('base64')
        yield '"' + duoi
    }
    return guiThan(url, {
        method: 'POST',
        timeoutMs,
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(doDai), Accept: '*/*', 'User-Agent': 'node' },
    }, cacLat())
}
