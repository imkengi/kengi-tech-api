/**
 * TỰ TRẢ LỜI CHAT SHOPEE BẰNG CHATBOT (24/10/2026).
 * Đã gộp luồng: Người thật hoặc AI gửi đều được xem là tin nhắn từ phía cửa hàng.
 */
import { ShopeeService, tachCauHoiShopee, TinShopeeGoiY } from '../services/platforms/shopee'
import { TRA_LOI_DU_PHONG } from './chatbotKienThuc'
import { laLoiThieuBang } from './tinHieuChat'
import { moTaLoi } from './gomLoi'

export const GOM_MS = 15_000
export const TRAN_HOI_THOAI = 30
export const TRAN_GIO = 60
export const CAU_CHO = 'Dạ shop đã nhận được tin nhắn của bạn ạ. Bạn đợi shop một chút nhé, nhân viên sẽ trả lời bạn ngay!'
export const PHUT_TIN_CHO = 30
export const TIEN_TO_TIN_CHO = 'tin chờ — '
export const TIEN_TO_CAN_NHAN_VIEN = 'cần nhân viên — '
const DAI_TOI_DA = 600

export type TrangThaiNhatKy = 'dang' | 'da_gui' | 'bo_qua' | 'loi'
export type KetQuaTuTraLoi =
    | 'tat' | 'tin_cua_gian' | 'thieu_hoi_thoai' | 'dang_cho' | 'khong_can' | 'da_xu_ly'
    | 'bo_qua' | 'loi' | 'da_gui' | 'tin_cho' | 'gian_tu_tat'

export interface KhoTuTraLoi {
    docCaiDat(kenhId: string): Promise<{ bat: boolean } | null>
    giuCho(kenhId: string, hoiThoaiId: string, tinKhachId: string): Promise<boolean>
    ghiKetQua(kenhId: string, hoiThoaiId: string, tinKhachId: string, trangThai: TrangThaiNhatKy, lyDo: string | null, maTinGui?: string | null): Promise<void>
    demDaGui(kenhId: string, soGio: number, hoiThoaiId?: string): Promise<number>
    maTinDaGui(kenhId: string, hoiThoaiId: string): Promise<Map<string, string>>
    demTinCho(kenhId: string, hoiThoaiId: string, soPhut: number): Promise<number>
    tat(kenhId: string, lyDo: string): Promise<void>
}

export interface ShopeeTuTraLoi {
    getMessages(conversationId: string, p: { pageSize?: number }): Promise<{ messages: any[] }>
    sendAutoReplyMessage(toId: number, text: string): Promise<{ messageId: string }>
}

export interface PhuThuocTuTraLoi {
    kho: KhoTuTraLoi
    docKenh(kenhId: string): Promise<any | null>
    taoShopee(kenh: any): ShopeeTuTraLoi
    tenSanPham(kenhId: string, maSp: string[]): Promise<Map<string, string>>
    soanGoiY(cauHoi: string, lichSu: any[], tenKenh: string): Promise<{ traLoi: string; canNhanVien: boolean; loi?: string | null }>
    cho(ms: number): Promise<void>
}

export function kiemCauTuDong(cau: string): { ok: true; cau: string } | { ok: false; lyDo: string } {
    const s = String(cau || '').trim()
    if (!s || s === TRA_LOI_DU_PHONG) return { ok: false, lyDo: 'AI không soạn được câu trả lời' }
    if (/(?:\+84|\b0)[1-9](?:[\s.-]?\d){7,9}\b/.test(s)) return { ok: false, lyDo: 'câu có số điện thoại' }
    if (/zalo|facebook|\bfb\b|messenger|instagram|tiktok|lazada|\btiki\b|sendo/i.test(s)) return { ok: false, lyDo: 'câu nhắc kênh / sàn khác' }
    if (/https?:\/\/(?![\w.-]*shopee\.vn)|\bwww\.(?!shopee)/i.test(s)) return { ok: false, lyDo: 'câu có link ngoài Shopee' }
    return { ok: true, cau: s.length > DAI_TOI_DA ? `${s.slice(0, DAI_TOI_DA - 1).trimEnd()}…` : s }
}

const BANG_LOI: [RegExp, 'tat' | 'bo_qua', string][] = [
    [/unexpected_bot_msg/, 'tat', 'Shopee chặn: nhận ra tin chatbot (unexpected_bot_msg)'],
    [/block_by_internal_safety_strategies/, 'tat', 'Shopee chặn: hành vi gửi tin đáng ngờ'],
    [/exceed_send_limita?tion/, 'tat', 'Shopee báo gửi quá nhiều / quá dày'],
    [/shop_bound_subaccount/, 'tat', 'Gian đang bật phân phối chat cho tài khoản phụ — tắt phân phối ở Kênh Người Bán thì API mới gửi được'],
    [/need_verify_phone/, 'tat', 'Shopee đòi xác minh số điện thoại của gian'],
    [/reach_5_message_limit/, 'bo_qua', 'đã gửi 5 tin mà khách chưa nhắn lại'],
    [/user_is_forbidden/, 'bo_qua', 'khách không còn trong diện được nhắn'],
    [/message_is_censored/, 'bo_qua', 'Shopee kiểm duyệt chặn câu này'],
    [/assigned_to_subaccount/, 'bo_qua', 'hội thoại đã giao cho tài khoản phụ'],
    [/message_too_long|invalid_content|invalid_to_id/, 'bo_qua', 'Shopee từ chối nội dung / người nhận'],
]

export function phanLoaiLoiGui(e: unknown): { loai: 'tat' | 'bo_qua' | 'loi'; lyDo: string } {
    const s = String((e as any)?.message || e)
    for (const [re, loai, lyDo] of BANG_LOI) if (re.test(s)) return { loai, lyDo }
    return { loai: 'loi', lyDo: `gửi lỗi: ${s.slice(0, 160)}` }
}

const dangChay = new Map<string, { lai: boolean }>()

export async function tuTraLoiShopee(kenh: { id: string; shopId: string; name?: string }, noiDungPush: any, pt: PhuThuocTuTraLoi): Promise<KetQuaTuTraLoi> {
    const kenhId = String(kenh?.id || '')
    try {
        const caiDat = await pt.kho.docCaiDat(kenhId)
        if (!caiDat?.bat) return 'tat'
        const nd = noiDungPush || {}
        
        // GỘP LUỒNG: Bất kể tin nhắn đến từ shopId chính hay tài khoản phụ/nhân viên, 
        // nếu thuộc phía shop thì đều được quy về một mối là tin nhắn của cửa hàng.
        const isShopSender = (
            (nd.from_shop_id !== undefined && nd.from_shop_id !== null && String(nd.from_shop_id) === String(kenh.shopId)) ||
            (nd.owner_id !== undefined && String(nd.owner_id) === String(kenh.shopId))
        );
        if (isShopSender) return 'tin_cua_gian'

        const hoiThoaiId = String(nd.conversation_id || '')
        if (!/^\d{1,30}$/.test(hoiThoaiId)) return 'thieu_hoi_thoai'

        const khoa = `${kenhId}:${hoiThoaiId}`
        const dang = dangChay.get(khoa)
        if (dang) { dang.lai = true; return 'dang_cho' }
        const moc = { lai: false }
        dangChay.set(khoa, moc)
        try {
            let kq: KetQuaTuTraLoi = 'khong_can'
            for (let vong = 0; vong < 3; vong++) {
                moc.lai = false
                await pt.cho(GOM_MS)
                kq = await mot(kenhId, hoiThoaiId, pt)
                if (!moc.lai || kq === 'gian_tu_tat' || kq === 'tat') break
            }
            return kq
        } finally {
            dangChay.delete(khoa)
        }
    } catch (e) {
        console.error(`[Tự trả lời Shopee] kênh ${kenhId}: ${moTaLoi(e)}`)
        return 'loi'
    }
}

async function mot(kenhId: string, hoiThoaiId: string, pt: PhuThuocTuTraLoi): Promise<KetQuaTuTraLoi> {
    const caiDat = await pt.kho.docCaiDat(kenhId)
    if (!caiDat?.bat) return 'tat'
    const kenh = await pt.docKenh(kenhId)
    if (!kenh?.accessToken) return 'tat'

    const shopee = pt.taoShopee(kenh)
    const r = await shopee.getMessages(hoiThoaiId, { pageSize: 25 })
    const ds: TinShopeeGoiY[] = (r.messages as TinShopeeGoiY[]).slice().reverse()
    const daGui = await pt.kho.maTinDaGui(kenhId, hoiThoaiId)
    const maSp = [...new Set(ds.map(m => String(m.itemId || '')).filter(Boolean))].slice(0, 10)
    const tenSp = maSp.length ? await pt.tenSanPham(kenhId, maSp) : new Map<string, string>()
    const tach = tachCauHoiShopee(ds, kenh.shopId, tenSp, daGui)
    if (!tach) return 'khong_can'

    if (!(await pt.kho.giuCho(kenhId, hoiThoaiId, tach.tinCuoiId))) return 'da_xu_ly'
    const ket = (t: TrangThaiNhatKy, lyDo: string | null, ma?: string) => pt.kho.ghiKetQua(kenhId, hoiThoaiId, tach.tinCuoiId, t, lyDo, ma)
    try {
        return await sauGiuCho(kenhId, hoiThoaiId, kenh, shopee, tach, ket, pt)
    } catch (e) {
        await ket('loi', `lỗi: ${moTaLoi(e).slice(0, 160)}`).catch(() => { })
        throw e
    }
}

async function sauGiuCho(
    kenhId: string, hoiThoaiId: string, kenh: any, shopee: ShopeeTuTraLoi,
    tach: NonNullable<ReturnType<typeof tachCauHoiShopee>>,
    ket: (t: TrangThaiNhatKy, lyDo: string | null, ma?: string) => Promise<void>,
    pt: PhuThuocTuTraLoi,
): Promise<KetQuaTuTraLoi> {
    if ((await pt.kho.demDaGui(kenhId, 1)) >= TRAN_GIO) {
        const lyDo = `quá ${TRAN_GIO} tin tự động trong 1 giờ — tự tắt cho Shopee khỏi coi là spam`
        await pt.kho.tat(kenhId, lyDo)
        await ket('bo_qua', lyDo)
        return 'gian_tu_tat'
    }
    if ((await pt.kho.demDaGui(kenhId, 24, hoiThoaiId)) >= TRAN_HOI_THOAI) {
        await ket('bo_qua', `đã tự trả lời ${TRAN_HOI_THOAI} lần trong 24 giờ — để nhân viên`)
        return 'bo_qua'
    }
    const nguoiMua = Number(tach.nguoiMuaId)
    if (!Number.isFinite(nguoiMua) || nguoiMua <= 0) { await ket('bo_qua', 'không rõ người mua'); return 'bo_qua' }

    const soan = await pt.soanGoiY(tach.cauHoi, tach.lichSu, String(kenh.name || ''))
    let khongTraLoi: string | null = null
    let cau = ''
    if (soan.loi) khongTraLoi = soan.loi
    else {
        const kiem = kiemCauTuDong(soan.traLoi)
        if (kiem.ok) cau = kiem.cau
        else khongTraLoi = kiem.lyDo
    }
    if (khongTraLoi) {
        if ((await pt.kho.demTinCho(kenhId, hoiThoaiId, PHUT_TIN_CHO)) > 0) {
            const t: TrangThaiNhatKy = soan.loi ? 'loi' : 'bo_qua'
            await ket(t, `${khongTraLoi} — đã gửi tin chờ trong ${PHUT_TIN_CHO} phút qua, để nhân viên`)
            return t
        }
        cau = CAU_CHO
    }

    try {
        const gui = await shopee.sendAutoReplyMessage(nguoiMua, cau)
        const lyDo = khongTraLoi ? `${TIEN_TO_TIN_CHO}${khongTraLoi}` : soan.canNhanVien ? `${TIEN_TO_CAN_NHAN_VIEN}AI chưa đủ căn cứ` : null
        await ket('da_gui', lyDo, gui.messageId || undefined)
        return khongTraLoi ? 'tin_cho' : 'da_gui'
    } catch (e) {
        const pl = phanLoaiLoiGui(e)
        if (pl.loai === 'tat') {
            await pt.kho.tat(kenhId, pl.lyDo)
            await ket('loi', pl.lyDo)
            console.warn(`[Tự trả lời Shopee] kênh ${kenhId} TỰ TẮT: ${pl.lyDo}`)
            return 'gian_tu_tat'
        }
        await ket(pl.loai, pl.lyDo)
        return pl.loai
    }
}

export async function tenSanPhamCuaGian(db: any, kenhId: string, maSp: string[]): Promise<Map<string, string>> {
    if (!maSp.length) return new Map()
    const sp: any[] = await db.onlineProduct.findMany({
        where: { channelId: kenhId, platformProductId: { in: maSp } },
        select: { platformProductId: true, name: true, sku: true },
    })
    return new Map(sp.map(x => [String(x.platformProductId), `${x.name}${x.sku ? ` (SKU ${x.sku})` : ''}`]))
}

export function phuThuocTuTraLoiThat(db: any, soanGoiY: PhuThuocTuTraLoi['soanGoiY']): PhuThuocTuTraLoi {
    return {
        kho: khoTuTraLoiSql(db),
        async docKenh(kenhId) {
            const r: any[] = await db.$queryRawUnsafe(`SELECT * FROM "OnlineChannel" WHERE "id" = $1 AND "platform" = 'shopee' LIMIT 1`, kenhId)
            return r[0] || null
        },
        taoShopee: (k) => new ShopeeService({
            apiKey: k.apiKey || '', apiSecret: k.apiSecret || '', accessToken: k.accessToken || '',
            refreshToken: k.refreshToken || '', shopId: k.shopId || '',
        }),
        tenSanPham: (kenhId, maSp) => tenSanPhamCuaGian(db, kenhId, maSp),
        soanGoiY,
        cho: (ms) => new Promise(r => setTimeout(r, ms)),
    }
}

export const DDL_TU_TRA_LOI = [
    `CREATE TABLE IF NOT EXISTS "TuTraLoiCaiDat" ("kenhId" TEXT NOT NULL PRIMARY KEY, "bat" BOOLEAN NOT NULL DEFAULT false, "tatLyDo" TEXT, "tatLuc" TIMESTAMP(3), "capNhatBoi" TEXT, "capNhatLuc" TIMESTAMP(3))`,
    `CREATE TABLE IF NOT EXISTS "TuTraLoiNhatKy" ("kenhId" TEXT NOT NULL, "hoiThoaiId" TEXT NOT NULL, "tinKhachId" TEXT NOT NULL, "trangThai" TEXT NOT NULL, "lyDo" TEXT, "maTinGui" TEXT, "luc" TIMESTAMP(3) NOT NULL, PRIMARY KEY ("kenhId", "hoiThoaiId", "tinKhachId"))`,
    `CREATE INDEX IF NOT EXISTS "TuTraLoiNhatKy_kenh_luc_idx" ON "TuTraLoiNhatKy" ("kenhId", "luc")`,
]
const daTao = new WeakSet<object>()
const BAY_GIO = `(NOW() AT TIME ZONE 'UTC')`

async function damBao(db: any): Promise<void> {
    if (daTao.has(db)) return
    for (const c of DDL_TU_TRA_LOI) await db.$executeRawUnsafe(c)
    daTao.add(db)
}
const thieu = (e: any) => laLoiThieuBang(e, 'TuTraLoiCaiDat') || laLoiThieuBang(e, 'TuTraLoiNhatKy')

export function khoTuTraLoiSql(db: any): KhoTuTraLoi {
    return {
        async docCaiDat(kenhId) {
            try {
                const r: any[] = await db.$queryRawUnsafe(`SELECT "bat" FROM "TuTraLoiCaiDat" WHERE "kenhId" = $1`, kenhId)
                return r[0] ? { bat: !!r[0].bat } : null
            } catch (e) { if (thieu(e)) return null; throw e }
        },
        async giuCho(kenhId, hoiThoaiId, tinKhachId) {
            await damBao(db)
            const n = await db.$executeRawUnsafe(
                `INSERT INTO "TuTraLoiNhatKy" ("kenhId", "hoiThoaiId", "tinKhachId", "trangThai", "luc")
                 VALUES ($1, $2, $3, 'dang', ${BAY_GIO}) ON CONFLICT DO NOTHING`, kenhId, hoiThoaiId, tinKhachId)
            return Number(n) > 0
        },
        async ghiKetQua(kenhId, hoiThoaiId, tinKhachId, trangThai, lyDo, maTinGui) {
            await db.$executeRawUnsafe(
                `UPDATE "TuTraLoiNhatKy" SET "trangThai" = $4, "lyDo" = $5, "maTinGui" = $6, "luc" = ${BAY_GIO}
                  WHERE "kenhId" = $1 AND "hoiThoaiId" = $2 AND "tinKhachId" = $3`,
                kenhId, hoiThoaiId, tinKhachId, trangThai, lyDo ? lyDo.slice(0, 300) : null, maTinGui || null)
        },
        async demDaGui(kenhId, soGio, hoiThoaiId) {
            try {
                const r: any[] = await db.$queryRawUnsafe(
                    `SELECT COUNT(*)::int AS n FROM "TuTraLoiNhatKy"
                      WHERE "kenhId" = $1 AND "trangThai" = 'da_gui' AND "luc" >= ${BAY_GIO} - make_interval(hours => $2::int)
                        AND ($3::text IS NULL OR "hoiThoaiId" = $3::text)`, kenhId, soGio, hoiThoaiId ?? null)
                return Number(r[0]?.n) || 0
            } catch (e) { if (thieu(e)) return 0; throw e }
        },
        async maTinDaGui(kenhId, hoiThoaiId) {
            try {
                const r: any[] = await db.$queryRawUnsafe(
                    `SELECT "maTinGui", "tinKhachId" FROM "TuTraLoiNhatKy" WHERE "kenhId" = $1 AND "hoiThoaiId" = $2 AND "maTinGui" IS NOT NULL`, kenhId, hoiThoaiId)
                return new Map(r.map(x => [String(x.maTinGui), String(x.tinKhachId)]))
            } catch (e) { if (thieu(e)) return new Map(); throw e }
        },
        async demTinCho(kenhId, hoiThoaiId, soPhut) {
            try {
                const r: any[] = await db.$queryRawUnsafe(
                    `SELECT COUNT(*)::int AS n FROM "TuTraLoiNhatKy"
                      WHERE "kenhId" = $1 AND "hoiThoaiId" = $2 AND "trangThai" = 'da_gui' AND "lyDo" LIKE $4
                        AND "luc" >= ${BAY_GIO} - make_interval(mins => $3::int)`, kenhId, hoiThoaiId, soPhut, `${TIEN_TO_TIN_CHO}%`)
                return Number(r[0]?.n) || 0
            } catch (e) { if (thieu(e)) return 0; throw e }
        },
        async tat(kenhId, lyDo) {
            await damBao(db)
            await db.$executeRawUnsafe(
                `INSERT INTO "TuTraLoiCaiDat" ("kenhId", "bat", "tatLyDo", "tatLuc", "capNhatLuc") VALUES ($1, false, $2, ${BAY_GIO}, ${BAY_GIO})
                 ON CONFLICT ("kenhId") DO UPDATE SET "bat" = false, "tatLyDo" = EXCLUDED."tatLyDo", "tatLuc" = EXCLUDED."tatLuc", "capNhatLuc" = EXCLUDED."capNhatLuc"`,
                kenhId, lyDo.slice(0, 300))
        },
    }
}

export async function datTuTraLoi(db: any, kenhId: string, bat: boolean, nguoi: string | null): Promise<void> {
    await damBao(db)
    await db.$executeRawUnsafe(
        `INSERT INTO "TuTraLoiCaiDat" ("kenhId", "bat", "capNhatBoi", "capNhatLuc") VALUES ($1, $2, $3, ${BAY_GIO})
         ON CONFLICT ("kenhId") DO UPDATE SET "bat" = EXCLUDED."bat", "capNhatBoi" = EXCLUDED."capNhatBoi", "capNhatLuc" = EXCLUDED."capNhatLuc",
             "tatLyDo" = CASE WHEN EXCLUDED."bat" THEN NULL ELSE "TuTraLoiCaiDat"."tatLyDo" END,
             "tatLuc" = CASE WHEN EXCLUDED."bat" THEN NULL ELSE "TuTraLoiCaiDat"."tatLuc" END`,
        kenhId, bat, nguoi)
}

export interface TinhTrangTuTraLoi {
    kenhId: string
    bat: boolean
    tatLyDo: string | null
    tatLuc: string | null
    daGui: number
    tinCho: number
    boQua: number
    loi: number
    lyDoGanNhat: string | null
}

export async function tinhTrangTuTraLoi(db: any, kenhIds: string[]): Promise<TinhTrangTuTraLoi[]> {
    const rong = (kenhId: string): TinhTrangTuTraLoi => ({ kenhId, bat: false, tatLyDo: null, tatLuc: null, daGui: 0, tinCho: 0, boQua: 0, loi: 0, lyDoGanNhat: null })
    const kq = new Map(kenhIds.map(k => [k, rong(k)]))
    try {
        const cd: any[] = await db.$queryRawUnsafe(`SELECT "kenhId", "bat", "tatLyDo", "tatLuc" FROM "TuTraLoiCaiDat"`)
        for (const c of cd) {
            const x = kq.get(String(c.kenhId)); if (!x) continue
            x.bat = !!c.bat; x.tatLyDo = c.tatLyDo || null; x.tatLuc = c.tatLuc ? new Date(c.tatLuc).toISOString() : null
        }
        const dem: any[] = await db.$queryRawUnsafe(
            `SELECT "kenhId", "trangThai", COALESCE("lyDo" LIKE $1, false) AS "laTinCho", COUNT(*)::int AS n FROM "TuTraLoiNhatKy"
              WHERE "luc" >= ${BAY_GIO} - interval '24 hours' GROUP BY 1, 2, 3`, `${TIEN_TO_TIN_CHO}%`)
        for (const d of dem) {
            const x = kq.get(String(d.kenhId)); if (!x) continue
            const n = Number(d.n) || 0
            if (d.trangThai === 'da_gui') { x.daGui += n; if (d.laTinCho) x.tinCho += n }
            else if (d.trangThai === 'bo_qua') x.boQua += n
            else if (d.trangThai === 'loi') x.loi += n
        }
        const lyDo: any[] = await db.$queryRawUnsafe(
            `SELECT DISTINCT ON ("kenhId") "kenhId", "lyDo" FROM "TuTraLoiNhatKy"
              WHERE "lyDo" IS NOT NULL AND "luc" >= ${BAY_GIO} - interval '24 hours'
              ORDER BY "kenhId", "luc" DESC`)
        for (const l of lyDo) { const x = kq.get(String(l.kenhId)); if (x) x.lyDoGanNhat = l.lyDo }
    } catch (e) {
        if (!thieu(e)) throw e
    }
    return [...kq.values()]
}