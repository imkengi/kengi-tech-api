// ═══════════════════════════════════════════════════════════════════════════════
//  ĐĂNG VIDEO LÊN TIKTOK — chạy THEO BƯỚC, mỗi lần gọi một ngân sách thời gian
//
//  Vì sao theo bước (giống hệt lib/dangVideoShopee.ts): Cloud Run cắt yêu cầu ở
//  300 giây và bóp CPU khi không có yêu cầu, nên không thể "tải hết rồi đăng"
//  trong một lời gọi. Mỗi lượt làm được tới đâu ghi lại tới đó vào
//  SanMedia.tienTrinhDang; đứt giữa chừng thì lượt sau đọc ra chạy tiếp, KHÔNG
//  tải lại từ khối 0.
//
//  Byte đọc THẲNG từ Drive theo Range rồi PUT sang TikTok — không bao giờ giữ cả
//  file trong bộ nhớ (Cloud Run chỉ có 512Mi).
//
//  LUẬT CHIA KHỐI của TikTok (tài liệu đọc 09/09/2026) — sai là 400 ngay ở init:
//    · khối nhỏ nhất 5MB, lớn nhất 64MB
//    · total_chunk_count = FLOOR(video_size / chunk_size), phần dư dồn vào KHỐI
//      CUỐI (nên khối cuối to hơn chunk_size, tối đa 128MB)
//    · file nhỏ hơn một khối thì chunk_size = video_size và tổng = 1
//  Ở đây lấy khối 10MB: file 12MB ra 1 khối 12MB (hợp lệ), file 105MB ra 10 khối
//  mà khối cuối 15MB. Khối cuối lớn nhất < 20MB nên bộ nhớ luôn an toàn.
// ═══════════════════════════════════════════════════════════════════════════════

import { getStoreDriveWriter } from './driveOAuth'
import { layTokenTikTok, moPhienDang, trangThaiDang, layHoSoNguoiDang } from './tiktokDangVideo'

export type GiaiDoanTT = 'init' | 'parts' | 'check' | 'xong'

export interface TienTrinhTT {
    giaiDoan: GiaiDoanTT
    publishId?: string
    uploadUrl?: string
    fileSize?: number
    chunkSize?: number
    tongPhan?: number
    phanXong?: number
    dangThang?: boolean
    batDauLuc?: string
    capNhatLuc?: string
    ghiChu?: string
}

export interface KetQuaBuocTT {
    xong: boolean
    conTiep: boolean
    giaiDoan: GiaiDoanTT
    tienTrinh: TienTrinhTT
    thongDiep: string
}

const NGAN_SACH_MAC_DINH_MS = 75_000
const KHOI = 10 * 1024 * 1024
const TRAN_TIKTOK = 4 * 1024 * 1024 * 1024   // TikTok nhận tối đa 4GB

function docTienTrinh(s?: string | null): TienTrinhTT {
    try {
        const t = s ? JSON.parse(s) : null
        return t && typeof t === 'object' && t.giaiDoan ? t : { giaiDoan: 'init' }
    } catch { return { giaiDoan: 'init' } }
}

async function luu(prisma: any, id: string, tt: TienTrinhTT, them?: Record<string, any>) {
    tt.capNhatLuc = new Date().toISOString()
    await prisma.sanMedia.update({ where: { id }, data: { tienTrinhDang: JSON.stringify(tt), ...(them || {}) } })
}

/** Một khối từ Drive theo Range — Drive hỗ trợ Range cho alt=media. */
async function docKhoiDrive(drive: any, fileId: string, tu: number, den: number): Promise<Uint8Array> {
    const r = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer', headers: { Range: `bytes=${tu}-${den}` } },
    )
    return new Uint8Array(r.data as ArrayBuffer)
}

/** Link tải TikTok cấp có hạn dùng. Hết hạn thì làm lại phiên, đừng kẹt vĩnh viễn. */
function laPhienHetHan(msg: string): boolean {
    return /expired|invalid.*upload.*url|403|url_expired|signature/i.test(msg)
}

/**
 * MỘT lượt đăng. Web gọi lặp tới khi `xong`.
 * `dangThang=true` = đăng thẳng lên hồ sơ (cần quyền video.publish);
 * `false` = thả vào hộp thư TikTok để chủ tài khoản mở app hoàn tất (video.upload).
 */
export async function buocDangTikTok(
    prisma: any,
    mediaId: string,
    opts: { dangThang?: boolean; nganSachMs?: number } = {},
): Promise<KetQuaBuocTT> {
    const nganSach = opts.nganSachMs ?? NGAN_SACH_MAC_DINH_MS
    const hetGio = Date.now() + nganSach

    const m = await prisma.sanMedia.findUnique({ where: { id: mediaId } })
    if (!m) throw new Error('Không tìm thấy video trong kho')
    if (m.nguon !== 'drive' || !m.nguonId) {
        throw new Error('Chỉ đăng được video nằm trong Drive của cửa hàng (video dạng liên kết ngoài chưa hỗ trợ)')
    }

    const tt = docTienTrinh(m.tienTrinhDang)
    if (!tt.batDauLuc) tt.batDauLuc = new Date().toISOString()

    const { accessToken, scopes } = await layTokenTikTok(prisma)
    const quyen = String(scopes || '').split(',').map((s: string) => s.trim())
    const dangThang = opts.dangThang ?? !!tt.dangThang
    if (dangThang && !quyen.includes('video.publish')) {
        throw new Error('Tài khoản TikTok chưa cấp quyền video.publish — bấm "Kết nối lại TikTok" và bật "đăng thẳng" trước.')
    }
    if (!dangThang && !quyen.includes('video.upload')) {
        throw new Error('Tài khoản TikTok chưa cấp quyền video.upload — bấm "Kết nối lại TikTok".')
    }

    try {
        // ─── init: hỏi Drive dung lượng rồi mở phiên đăng ──────────────────────
        if (tt.giaiDoan === 'init') {
            const { drive } = await getStoreDriveWriter(prisma)
            const meta = await drive.files.get({ fileId: m.nguonId, supportsAllDrives: true, fields: 'size,mimeType,name' })
            const fileSize = Number((meta.data as any)?.size || 0)
            if (!fileSize) throw new Error('Drive không trả dung lượng file')
            if (fileSize > TRAN_TIKTOK) throw new Error(`Video ${(fileSize / 1024 / 1024).toFixed(0)}MB vượt trần 4GB của TikTok`)

            const chunkSize = Math.min(fileSize, KHOI)
            const tongPhan = Math.max(1, Math.floor(fileSize / chunkSize))

            /* Đăng thẳng BẮT BUỘC có privacy_level, và chỉ được dùng giá trị TikTok
             * cho phép với đúng tài khoản này — gửi bừa là 400. Hộp thư không cần. */
            let privacy: string | undefined
            if (dangThang) {
                const hs = await layHoSoNguoiDang(accessToken)
                const cho: string[] = Array.isArray(hs?.privacy_level_options) ? hs.privacy_level_options : []
                privacy = cho.includes('SELF_ONLY') ? 'SELF_ONLY' : (cho[0] || 'SELF_ONLY')
            }

            const phien = await moPhienDang(accessToken, {
                dangThang,
                fileSize,
                chunkSize,
                totalChunkCount: tongPhan,   // MỘT phép tính dùng chung với vòng tải dưới
                title: String(m.caption || m.ten || '').slice(0, 2200),
                privacyLevel: privacy,
            })
            if (!phien.publishId || !phien.uploadUrl) throw new Error('TikTok không trả publish_id / upload_url')

            Object.assign(tt, {
                giaiDoan: 'parts' as GiaiDoanTT,
                publishId: phien.publishId,
                uploadUrl: phien.uploadUrl,
                fileSize, chunkSize, tongPhan, phanXong: 0, dangThang,
                ghiChu: `Mở phiên ${dangThang ? 'đăng thẳng' : 'hộp thư'} — ${tongPhan} khối`,
            })
            await luu(prisma, mediaId, tt, { trangThai: 'cho_dang', loiCuoi: null })
        }

        // ─── parts: đẩy từng khối Drive → TikTok, hết giờ thì dừng đúng chỗ ────
        if (tt.giaiDoan === 'parts') {
            const { drive } = await getStoreDriveWriter(prisma)
            const total = tt.fileSize!
            const chunkSize = tt.chunkSize!
            const tongPhan = tt.tongPhan!
            const mime = m.mime || 'video/mp4'

            while ((tt.phanXong || 0) < tongPhan) {
                if (Date.now() > hetGio) {
                    return {
                        xong: false, conTiep: true, giaiDoan: 'parts', tienTrinh: tt,
                        thongDiep: `Đang tải lên TikTok: ${tt.phanXong}/${tongPhan} khối`,
                    }
                }
                const i = tt.phanXong || 0
                const tu = i * chunkSize
                const den = i === tongPhan - 1 ? total - 1 : tu + chunkSize - 1

                const khoi = await docKhoiDrive(drive, m.nguonId, tu, den)
                if (khoi.length !== den - tu + 1) {
                    throw new Error(`Khối ${i}: Drive trả ${khoi.length} byte, cần ${den - tu + 1} — Drive không tôn trọng Range?`)
                }

                /* Content-Length PHẢI khai tay: undici của Node 20 KHÔNG tự đặt cho
                 * thân nhị phân (Node 24 thì có) nên chạy prod mới hỏng — đúng cái
                 * bẫy đã dính với Google 411 hôm 08/09. */
                const buf = Buffer.from(khoi)
                const r = await fetch(tt.uploadUrl!, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': mime,
                        'Content-Length': String(buf.length),
                        'Content-Range': `bytes ${tu}-${den}/${total}`,
                    },
                    body: buf,
                })
                if (r.status !== 200 && r.status !== 201 && r.status !== 206 && r.status !== 308) {
                    const t = await r.text().catch(() => '')
                    throw new Error(`Tải khối ${i} lên TikTok hỏng (HTTP ${r.status}): ${t.slice(0, 300)}`)
                }

                tt.phanXong = i + 1
                tt.ghiChu = `Đã tải ${tt.phanXong}/${tongPhan} khối`
                await luu(prisma, mediaId, tt)
            }

            tt.giaiDoan = 'check'
            tt.ghiChu = 'Đã tải xong, chờ TikTok xử lý'
            await luu(prisma, mediaId, tt)
        }

        // ─── check: TikTok xử lý bất đồng bộ, phải hỏi lại ─────────────────────
        if (tt.giaiDoan === 'check') {
            while (Date.now() < hetGio) {
                const st = await trangThaiDang(accessToken, tt.publishId!)
                const s = String(st?.status || '')

                if (s === 'PUBLISH_COMPLETE' || s === 'SEND_TO_USER_INBOX') {
                    const ma = Array.isArray(st?.publicaly_available_post_id) && st.publicaly_available_post_id[0]
                        ? String(st.publicaly_available_post_id[0])
                        : String(tt.publishId)
                    tt.giaiDoan = 'xong'
                    tt.ghiChu = s === 'SEND_TO_USER_INBOX'
                        ? 'Video đã vào hộp thư TikTok — mở app TikTok, bấm thông báo để hoàn tất đăng'
                        : 'TikTok đã đăng xong'
                    await luu(prisma, mediaId, tt, {
                        trangThai: 'da_dang', maTrenSan: ma, dangLuc: new Date(), loiCuoi: null,
                    })
                    return { xong: true, conTiep: false, giaiDoan: 'xong', tienTrinh: tt, thongDiep: tt.ghiChu }
                }
                if (s === 'FAILED') {
                    throw new Error(`TikTok từ chối video: ${st?.fail_reason || 'không nói lý do'}`)
                }

                tt.ghiChu = `TikTok đang xử lý (${s || 'chưa rõ'})`
                await luu(prisma, mediaId, tt)
                await new Promise(r => setTimeout(r, 3000))
            }
            return {
                xong: false, conTiep: true, giaiDoan: 'check', tienTrinh: tt,
                thongDiep: tt.ghiChu || 'TikTok đang xử lý',
            }
        }

        return { xong: true, conTiep: false, giaiDoan: tt.giaiDoan, tienTrinh: tt, thongDiep: tt.ghiChu || 'Đã xong' }
    } catch (err: any) {
        const msg = String(err?.message || err)
        /* Phiên tải hết hạn thì ĐẶT LẠI về init cho lượt sau mở phiên mới, thay vì
         * kẹt vĩnh viễn ở 'parts' với một link đã chết (bẫy đã gặp bên Shopee). */
        if (tt.giaiDoan === 'parts' && laPhienHetHan(msg)) {
            Object.assign(tt, { giaiDoan: 'init' as GiaiDoanTT, publishId: undefined, uploadUrl: undefined, phanXong: 0, ghiChu: 'Phiên tải hết hạn, sẽ mở lại từ đầu' })
            await luu(prisma, mediaId, tt, { loiCuoi: msg.slice(0, 400) })
            return { xong: false, conTiep: true, giaiDoan: 'init', tienTrinh: tt, thongDiep: 'Phiên tải hết hạn — đang mở lại phiên mới' }
        }
        await luu(prisma, mediaId, tt, { trangThai: 'loi', loiCuoi: msg.slice(0, 400) })
        throw err
    }
}

/** Câu tả tiến trình cho giao diện — web hiện thẳng, khỏi tự dịch giai đoạn. */
export function moTaTienTrinhTT(s?: string | null): string | null {
    const tt = docTienTrinh(s)
    if (!tt.giaiDoan) return null
    if (tt.giaiDoan === 'parts' && tt.tongPhan) return `Đang tải lên TikTok ${tt.phanXong || 0}/${tt.tongPhan} khối`
    if (tt.giaiDoan === 'check') return 'TikTok đang xử lý video'
    if (tt.giaiDoan === 'xong') return tt.ghiChu || 'Đã đăng'
    return tt.ghiChu || null
}
