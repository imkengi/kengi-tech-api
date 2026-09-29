/* ═══════════════════════════════════════════════════════════════════════════════
 *  XÁC MINH 2 BƯỚC CHO TRANG kengi.vn/admin — GOOGLE AUTHENTICATOR (29/09/2026)
 *
 *  Chủ shop: "chỗ kengi.vn/admin hãy chỉnh lại đăng nhập vào luôn có 2 bước xác
 *  minh" → chọn app Google Authenticator (TOTP). Mật khẩu đúng KHÔNG còn cấp token:
 *    - chưa thiết lập → trả mã QR (vẽ NGAY TẠI MÁY CHỦ — khoá bí mật không đi qua
 *      dịch vụ vẽ QR bên ngoài nào), nhập mã đầu tiên đúng thì mới lưu khoá;
 *    - đã thiết lập   → đòi mã 6 số đang hiện trong app.
 *
 *  Phiên chờ mã nằm trong DB registry (không phải bộ nhớ) vì Cloud Run chạy tới
 *  3 bản: bước 1 vào bản này, bước 2 vào bản kia vẫn phải thấy nhau.
 *  Chống dò mã: mỗi phiên sai 5 lần là huỷ; cả hệ thống sai ≥5 lần trong 30 phút
 *  thì khoá đăng nhập admin 30 phút. Chống dùng lại mã: lưu bước thời gian cuối
 *  (timeStep) đã dùng, mã cũ hơn hoặc bằng bị từ chối.
 *  Mất điện thoại: chỉ x-admin-key đặt lại được (POST /admin/xac-minh-2-buoc/dat-lai).
 *
 *  MỌI câu SQL nằm trong các hàm nhỏ bên dưới, dùng CHUNG cho luồng thật và
 *  `tuKiem()` (POST /admin/xac-minh-2-buoc/tu-kiem) — lỗi SQL mà để chủ shop gặp
 *  lúc đăng nhập là khoá luôn chủ shop ngoài trang admin.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import crypto from 'crypto'
import registryPrisma from './prisma'

const BANG_KHOA = `"public"."AdminPanelTotp"`
const BANG_PHIEN = `"public"."AdminPanelPhien"`
const KHOA_THAT = 'default'
export const HAN_PHIEN_XAC_MINH_GIAY = 5 * 60
export const HAN_PHIEN_THIET_LAP_GIAY = 15 * 60     // đủ thời gian cài app + quét QR
const SAI_TOI_DA_MOI_PHIEN = 5
const SAI_TOI_DA_TOAN_HE = 5
const CUA_SO_KHOA_PHUT = 30
const TEN_TRONG_APP = 'Kengi Admin'

type LoaiPhien = 'xac-minh' | 'thiet-lap' | 'tu-kiem'

let daDamBao = false
async function damBaoBang(): Promise<void> {
    if (daDamBao) return
    await registryPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${BANG_KHOA} (
        "id" TEXT PRIMARY KEY DEFAULT 'default',
        "secret" TEXT NOT NULL,
        "batLuc" TIMESTAMP(3) NOT NULL DEFAULT now(),
        "buocCuoi" BIGINT NOT NULL DEFAULT 0
    )`)
    await registryPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${BANG_PHIEN} (
        "id" TEXT PRIMARY KEY,
        "loai" TEXT NOT NULL,
        "secretMoi" TEXT,
        "soLanSai" INTEGER NOT NULL DEFAULT 0,
        "hetHan" TIMESTAMP(3) NOT NULL,
        "daDung" TIMESTAMP(3),
        "ip" TEXT,
        "taoLuc" TIMESTAMP(3) NOT NULL DEFAULT now()
    )`)
    daDamBao = true
}

// ─── Các câu SQL (dùng chung luồng thật + tự kiểm) ───────────────────────────
async function layKhoa(idKhoa: string): Promise<{ secret: string; buocCuoi: number; batLuc: Date } | null> {
    const r: any[] = await registryPrisma.$queryRawUnsafe(
        `SELECT "secret", "buocCuoi", "batLuc" FROM ${BANG_KHOA} WHERE "id" = $1`, idKhoa)
    return r[0] ? { secret: r[0].secret, buocCuoi: Number(r[0].buocCuoi) || 0, batLuc: r[0].batLuc } : null
}
/** Lưu khoá lần đầu; đã có (phiên khác vừa thiết lập) thì trả false, KHÔNG ghi đè. */
async function luuKhoa(idKhoa: string, secret: string, buoc: number): Promise<boolean> {
    const r: any[] = await registryPrisma.$queryRawUnsafe(
        `INSERT INTO ${BANG_KHOA} ("id", "secret", "batLuc", "buocCuoi") VALUES ($1, $2, now(), $3::bigint)
         ON CONFLICT ("id") DO NOTHING RETURNING "id"`, idKhoa, secret, buoc)
    return r.length > 0
}
async function capNhatBuoc(idKhoa: string, buoc: number): Promise<void> {
    await registryPrisma.$executeRawUnsafe(
        `UPDATE ${BANG_KHOA} SET "buocCuoi" = GREATEST("buocCuoi", $2::bigint) WHERE "id" = $1`, idKhoa, buoc)
}
async function xoaKhoa(idKhoa: string): Promise<boolean> {
    return Number(await registryPrisma.$executeRawUnsafe(`DELETE FROM ${BANG_KHOA} WHERE "id" = $1`, idKhoa)) > 0
}
async function themPhien(id: string, loai: LoaiPhien, hanGiay: number, ip: string, secretMoi: string | null): Promise<void> {
    await registryPrisma.$executeRawUnsafe(
        `INSERT INTO ${BANG_PHIEN} ("id", "loai", "secretMoi", "hetHan", "ip") VALUES ($1, $2, $3, $4, $5)`,
        id, loai, secretMoi, new Date(Date.now() + hanGiay * 1000), ip)
}
/** Phiên còn dùng được: chưa dùng, chưa hết hạn. */
async function layPhien(id: string): Promise<{ loai: LoaiPhien; secretMoi: string | null } | null> {
    const r: any[] = await registryPrisma.$queryRawUnsafe(
        `SELECT "loai", "secretMoi" FROM ${BANG_PHIEN} WHERE "id" = $1 AND "daDung" IS NULL AND "hetHan" > now()`, id)
    return r[0] ? { loai: r[0].loai, secretMoi: r[0].secretMoi } : null
}
/** Ghi một lần sai; đủ 5 lần thì huỷ phiên luôn. Trả số lần sai sau khi ghi. */
async function ghiSai(id: string): Promise<number> {
    const r: any[] = await registryPrisma.$queryRawUnsafe(
        `UPDATE ${BANG_PHIEN} SET "soLanSai" = "soLanSai" + 1,
                "daDung" = CASE WHEN "soLanSai" + 1 >= ${SAI_TOI_DA_MOI_PHIEN} THEN now() ELSE "daDung" END
          WHERE "id" = $1 RETURNING "soLanSai"`, id)
    return Number(r[0]?.soLanSai) || SAI_TOI_DA_MOI_PHIEN
}
/** Đánh dấu đã dùng — chỉ MỘT yêu cầu thắng dù hai yêu cầu tới cùng lúc. */
async function danhDauDung(id: string): Promise<boolean> {
    const r: any[] = await registryPrisma.$queryRawUnsafe(
        `UPDATE ${BANG_PHIEN} SET "daDung" = now() WHERE "id" = $1 AND "daDung" IS NULL RETURNING "id"`, id)
    return r.length > 0
}
async function xoaPhien(id: string): Promise<void> {
    await registryPrisma.$executeRawUnsafe(`DELETE FROM ${BANG_PHIEN} WHERE "id" = $1`, id)
}

async function otp() { return import('otplib') }
const maPhienMoi = () => crypto.randomBytes(24).toString('hex')

// ─── API cho routes/admin.ts ─────────────────────────────────────────────────
export async function trangThai(): Promise<{ daBat: boolean; batLuc: Date | null }> {
    await damBaoBang()
    const k = await layKhoa(KHOA_THAT)
    return { daBat: !!k, batLuc: k?.batLuc ?? null }
}

/** Đang bị khoá vì sai mã quá nhiều? Trả số phút còn lại (0 = không khoá). */
export async function phutConKhoa(): Promise<number> {
    await damBaoBang()
    const r: any[] = await registryPrisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM("soLanSai"), 0)::int AS sai, MAX("taoLuc") AS "moiNhat" FROM ${BANG_PHIEN}
          WHERE "taoLuc" > now() - interval '${CUA_SO_KHOA_PHUT} minutes' AND "soLanSai" > 0 AND "loai" <> 'tu-kiem'`)
    if (Number(r[0]?.sai) < SAI_TOI_DA_TOAN_HE) return 0
    const moiNhat = new Date(r[0].moiNhat).getTime()
    return Math.max(1, Math.ceil((moiNhat + CUA_SO_KHOA_PHUT * 60_000 - Date.now()) / 60_000))
}

/** Bước 1 xong (mật khẩu đúng) → mở phiên chờ mã. Chưa thiết lập thì kèm QR. */
export async function moPhien(ip: string, nhanTaiKhoan: string): Promise<
    | { buoc: 'xac-minh'; maPhien: string; hetHanGiay: number }
    | { buoc: 'thiet-lap'; maPhien: string; hetHanGiay: number; qr: string; khoaNhapTay: string; tenTrongApp: string }
> {
    await damBaoBang()
    // Dọn phiên cũ quá 1 ngày — vẫn giữ đủ lâu cho cửa sổ khoá 30 phút
    await registryPrisma.$executeRawUnsafe(`DELETE FROM ${BANG_PHIEN} WHERE "taoLuc" < now() - interval '1 day'`)
    const maPhien = maPhienMoi()
    if (await layKhoa(KHOA_THAT)) {
        await themPhien(maPhien, 'xac-minh', HAN_PHIEN_XAC_MINH_GIAY, ip, null)
        return { buoc: 'xac-minh', maPhien, hetHanGiay: HAN_PHIEN_XAC_MINH_GIAY }
    }
    const { generateSecret, generateURI } = await otp()
    const secret = generateSecret()
    const uri = generateURI({ issuer: TEN_TRONG_APP, label: nhanTaiKhoan, secret })
    const QRCode = (await import('qrcode')).default
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 260, errorCorrectionLevel: 'M' })
    await themPhien(maPhien, 'thiet-lap', HAN_PHIEN_THIET_LAP_GIAY, ip, secret)
    return {
        buoc: 'thiet-lap', maPhien, hetHanGiay: HAN_PHIEN_THIET_LAP_GIAY, qr, tenTrongApp: TEN_TRONG_APP,
        khoaNhapTay: secret.replace(/(.{4})/g, '$1 ').trim(),
    }
}

export type KetQuaXacMinh =
    | { ok: true; vuaThietLap: boolean }
    | { ok: false; ma: 400 | 401 | 409 | 429; loi: string }

/** Bước 2: kiểm mã 6 số. Đúng thì đánh dấu phiên đã dùng (mỗi phiên dùng MỘT lần). */
export async function xacMinh(maPhien: string, ma: string, idKhoa: string = KHOA_THAT): Promise<KetQuaXacMinh> {
    await damBaoBang()
    if (!/^[0-9a-f]{48}$/.test(maPhien)) return { ok: false, ma: 401, loi: 'Phiên đăng nhập không hợp lệ — nhập lại mật khẩu' }
    const maSach = String(ma || '').replace(/\s/g, '')
    if (!/^\d{6}$/.test(maSach)) return { ok: false, ma: 400, loi: 'Mã xác minh gồm 6 chữ số' }

    const phut = await phutConKhoa()
    if (phut > 0) return { ok: false, ma: 429, loi: `Nhập sai mã quá nhiều lần — tạm khoá đăng nhập admin ${phut} phút` }

    const phien = await layPhien(maPhien)
    if (!phien) return { ok: false, ma: 401, loi: 'Phiên đăng nhập đã hết hạn — nhập lại mật khẩu' }

    const khoa = await layKhoa(idKhoa)
    const thietLap = phien.loai !== 'xac-minh'          // 'thiet-lap' (hoặc 'tu-kiem' giả lập thiết lập)
    if (thietLap && khoa) {
        await danhDauDung(maPhien)
        return { ok: false, ma: 409, loi: 'Xác minh 2 bước vừa được thiết lập ở phiên khác — nhập lại mật khẩu' }
    }
    if (!thietLap && !khoa) return { ok: false, ma: 401, loi: 'Chưa thiết lập xác minh 2 bước — nhập lại mật khẩu' }
    const secret = thietLap ? String(phien.secretMoi || '') : khoa!.secret

    const { verify } = await otp()
    // Chấp nhận lệch đồng hồ điện thoại ±30 giây; mã đã dùng (timeStep ≤ bước cuối) bị từ chối
    const kq: any = await verify({
        secret, token: maSach, epochTolerance: 30,
        ...(thietLap ? {} : { afterTimeStep: khoa!.buocCuoi }),
    }).catch(() => ({ valid: false }))

    if (!kq?.valid) {
        const soSai = await ghiSai(maPhien)
        await new Promise(res => setTimeout(res, 800))   // chậm lại để dò mã tốn thời gian
        const conLai = SAI_TOI_DA_MOI_PHIEN - soSai
        return {
            ok: false, ma: 401,
            loi: conLai > 0 ? `Mã không đúng hoặc đã dùng — còn ${conLai} lần thử` : 'Sai quá 5 lần — nhập lại mật khẩu',
        }
    }

    if (!(await danhDauDung(maPhien))) return { ok: false, ma: 401, loi: 'Phiên đăng nhập đã dùng — nhập lại mật khẩu' }
    const buoc = Number(kq.timeStep) || 0
    if (thietLap) {
        if (!(await luuKhoa(idKhoa, secret, buoc))) {
            return { ok: false, ma: 409, loi: 'Xác minh 2 bước vừa được thiết lập ở phiên khác — nhập lại mật khẩu' }
        }
        return { ok: true, vuaThietLap: true }
    }
    await capNhatBuoc(idKhoa, buoc)
    return { ok: true, vuaThietLap: false }
}

/** Mất điện thoại: xoá khoá — lần đăng nhập sau sẽ hiện QR thiết lập lại. CHỈ gọi từ lối x-admin-key. */
export async function datLai(): Promise<{ daXoa: boolean }> {
    await damBaoBang()
    const daXoa = await xoaKhoa(KHOA_THAT)
    await registryPrisma.$executeRawUnsafe(`UPDATE ${BANG_PHIEN} SET "daDung" = now() WHERE "daDung" IS NULL`)
    return { daXoa }
}

/** TỰ KIỂM trên prod (POST /admin/xac-minh-2-buoc/tu-kiem, x-admin-key): chạy ĐÚNG các câu SQL
 *  + xacMinh() của luồng thật trên khoá 'tu-kiem' và phiên loại 'tu-kiem' (không tính vào khoá
 *  sai toàn hệ, không đụng khoá thật), rồi dọn sạch. Không trả khoá bí mật nào. */
export async function tuKiem(): Promise<Record<string, string>> {
    await damBaoBang()
    const { generateSecret, generate } = await otp()
    const ID_KHOA = 'tu-kiem'
    const kq: Record<string, string> = {}
    const phien: string[] = []
    const moi = async (secretMoi: string | null) => {
        const id = maPhienMoi(); phien.push(id)
        await themPhien(id, 'tu-kiem', 120, 'tu-kiem', secretMoi)
        return id
    }
    try {
        await xoaKhoa(ID_KHOA)
        const secret = generateSecret()
        const p1 = await moi(secret)
        const sai = await xacMinh(p1, '000000', ID_KHOA)
        const dung1 = await xacMinh(p1, await generate({ secret }), ID_KHOA)
        kq.thietLap_maSai = sai.ok ? 'SAI: nhận mã sai' : `đúng (từ chối: ${sai.loi})`
        kq.thietLap_maDung = dung1.ok && dung1.vuaThietLap ? 'đúng (đã lưu khoá)' : `SAI: ${JSON.stringify(dung1)}`
        kq.phienDungLai = (await xacMinh(p1, await generate({ secret }), ID_KHOA)).ok ? 'SAI: phiên dùng 2 lần' : 'đúng (từ chối)'
        // Phiên "xác minh" dùng khoá đã lưu: mã vừa dùng phải bị chặn (chống phát lại)
        const p2 = maPhienMoi(); phien.push(p2)
        await themPhien(p2, 'xac-minh', 120, 'tu-kiem', null)
        const lai = await xacMinh(p2, await generate({ secret }), ID_KHOA)
        kq.chongPhatLai = lai.ok ? 'SAI: nhận lại mã cũ' : `đúng (từ chối: ${lai.loi})`
        const k = await layKhoa(ID_KHOA)
        kq.luuBuoc = k && k.buocCuoi > 0 ? 'đúng' : 'SAI: không lưu bước cuối'
        kq.khongGhiDe = (await luuKhoa(ID_KHOA, 'X', 1)) ? 'SAI: ghi đè khoá cũ' : 'đúng'
        kq.khoaSaiToanHe = `${await phutConKhoa()} phút (phiên tự kiểm không tính)`
    } catch (e: any) {
        kq.LOI = String(e?.message || e).slice(0, 300)
    } finally {
        for (const id of phien) await xoaPhien(id).catch(() => { })
        await xoaKhoa(ID_KHOA).catch(() => { })
    }
    return kq
}
