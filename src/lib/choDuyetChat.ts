/**
 * DUYỆT TIN CHATBOT TRƯỚC KHI GỬI — chat Shopee (30/10/2026).
 *
 * Chủ shop: tin chatbot gửi qua send_autoreply_message mang nhãn tự động nên Shopee KHÔNG tính vào Tỷ lệ phản hồi Chat; xin
 * "chỉnh bên file apk để t duyệt". Luật Chat API Shopee cấm chatbot tự trả lời và cấm giả tin tự động thành tin tay ⇒ đường
 * hợp lệ duy nhất: AI SOẠN NHÁP, NGƯỜI đọc rồi bấm Gửi (send_message, y như nhân viên gõ ở trang chat web).
 *
 *  - Gian Shopee bật tự trả lời ở chế độ 'cho_duyet' (MẶC ĐỊNH cho Shopee — cột TuTraLoiCaiDat."cheDo" để NULL): lib/tuTraLoiShopee.ts
 *    soạn xong KHÔNG gửi, lưu một bản nháp vào bảng lười "TuTraLoiChoDuyet" + bắn push (type chat_cho_duyet, route chat-duyet).
 *  - App Android màn "Duyệt tin chat" (routes/chatChoDuyet.ts): đọc danh sách — tin khách đọc SỐNG từ Shopee, KHÔNG lưu nội
 *    dung tin khách (cam kết chat.ts) —, sửa câu nếu cần, bấm Gửi ⇒ guiNhapDaDuyet: GIỮ CHỖ bản nháp (mỗi bản gửi tối đa một
 *    lần, hai máy bấm cùng lúc chỉ một máy gửi), đọc lại hội thoại — người của gian đã trả lời sau tin khách thì bỏ, không thì
 *    gửi bằng send_message dưới tên người bấm.
 *  - Bảng chỉ giữ câu AI soạn (của mình), mã hội thoại / tin, tên tài khoản khách; xử lý xong thì xoá câu, dọn sau 7 ngày.
 *  - Mỗi hội thoại chỉ một bản đang chờ: khách nhắn thêm ⇒ AI soạn lại theo đủ các tin, bản cũ chuyển 'thay'.
 */
import { laTinCuaGian, laTinTuDong, TinShopeeGoiY } from '../services/platforms/shopee'
import { moTaLoi } from './gomLoi'

/** cho = đang chờ duyệt · dang_gui = một máy đã bấm Gửi (giữ chỗ) · da_gui · bo = bỏ / đã có người trả lời · thay = có bản mới hơn */
export type TrangThaiNhap = 'cho' | 'dang_gui' | 'da_gui' | 'bo' | 'thay'

/** Shopee tính "đã phản hồi" khi người của gian trả lời trong vòng 12 giờ kể từ tin khách */
export const HAN_PHAN_HOI_PHUT = 12 * 60
/** Gửi dở quá chừng này (máy chủ chết giữa chừng) thì coi như chưa ai bấm — bản nháp hiện lại để bấm lại */
const GIU_CHO_GUI_PHUT = 3
const DAI_TOI_DA = 1000

export interface BanNhap {
    id: string
    kenhId: string
    hoiThoaiId: string
    tinKhachId: string
    nguoiMuaId: string
    tenKhach: string | null
    traLoi: string
    canNhanVien: boolean
    ghiChu: string | null
    trangThai: TrangThaiNhap
    taoLuc: string
    xuLyBoi: string | null
    maTinGui: string | null
    loi: string | null
}

export interface NhapMoi {
    kenhId: string
    hoiThoaiId: string
    tinKhachId: string
    nguoiMuaId: string
    tenKhach: string | null
    traLoi: string
    canNhanVien: boolean
    ghiChu: string | null
}

export interface KhoChoDuyet {
    /** Lưu bản nháp mới, bản 'cho' cũ hơn của CÙNG hội thoại chuyển 'thay'. Trả id; đã có (push lặp) thì null. */
    luu(n: NhapMoi): Promise<string | null>
    danhSach(gioiHan: number): Promise<BanNhap[]>
    doc(id: string): Promise<BanNhap | null>
    /** 'cho' (hoặc 'dang_gui' kẹt quá GIU_CHO_GUI_PHUT) → 'dang_gui'. false = máy khác đã giữ / đã xử lý. */
    giuChoGui(id: string, nguoi: string | null): Promise<boolean>
    /** Kết thúc lượt gửi / bỏ. 'cho' = trả bản nháp về hàng chờ (gửi lỗi). */
    ketThuc(id: string, trangThai: 'da_gui' | 'bo' | 'cho', tt: { xuLyBoi?: string | null; maTinGui?: string | null; loi?: string | null }): Promise<void>
    /** 'cho' → 'bo'. false = không còn ở hàng chờ. */
    bo(id: string, nguoi: string | null, lyDo: string): Promise<boolean>
}

const BAY_GIO = `(NOW() AT TIME ZONE 'UTC')`
export const DDL_CHO_DUYET = [
    `CREATE TABLE IF NOT EXISTS "TuTraLoiChoDuyet" ("id" TEXT NOT NULL PRIMARY KEY, "kenhId" TEXT NOT NULL, "hoiThoaiId" TEXT NOT NULL,
        "tinKhachId" TEXT NOT NULL, "nguoiMuaId" TEXT NOT NULL, "tenKhach" TEXT, "traLoi" TEXT, "canNhanVien" BOOLEAN NOT NULL DEFAULT false,
        "ghiChu" TEXT, "trangThai" TEXT NOT NULL, "taoLuc" TIMESTAMP(3) NOT NULL, "xuLyLuc" TIMESTAMP(3), "xuLyBoi" TEXT, "maTinGui" TEXT, "loi" TEXT)`,
    `CREATE INDEX IF NOT EXISTS "TuTraLoiChoDuyet_trangThai_taoLuc_idx" ON "TuTraLoiChoDuyet" ("trangThai", "taoLuc")`,
    `CREATE INDEX IF NOT EXISTS "TuTraLoiChoDuyet_kenh_hoiThoai_idx" ON "TuTraLoiChoDuyet" ("kenhId", "hoiThoaiId")`,
]
const daTao = new WeakSet<object>()
async function damBao(db: any): Promise<void> {
    if (daTao.has(db)) return
    for (const c of DDL_CHO_DUYET) await db.$executeRawUnsafe(c)
    daTao.add(db)
}

const docDong = (r: any): BanNhap => ({
    id: String(r.id),
    kenhId: String(r.kenhId),
    hoiThoaiId: String(r.hoiThoaiId),
    tinKhachId: String(r.tinKhachId),
    nguoiMuaId: String(r.nguoiMuaId),
    tenKhach: r.tenKhach ? String(r.tenKhach) : null,
    traLoi: String(r.traLoi || ''),
    canNhanVien: !!r.canNhanVien,
    ghiChu: r.ghiChu ? String(r.ghiChu) : null,
    trangThai: String(r.trangThai) as TrangThaiNhap,
    taoLuc: new Date(r.taoLuc).toISOString(),
    xuLyBoi: r.xuLyBoi ? String(r.xuLyBoi) : null,
    maTinGui: r.maTinGui ? String(r.maTinGui) : null,
    loi: r.loi ? String(r.loi) : null,
})

export function khoChoDuyetSql(db: any): KhoChoDuyet {
    return {
        async luu(n) {
            await damBao(db)
            const id = `${n.kenhId}:${n.hoiThoaiId}:${n.tinKhachId}`
            const them = await db.$executeRawUnsafe(
                `INSERT INTO "TuTraLoiChoDuyet" ("id", "kenhId", "hoiThoaiId", "tinKhachId", "nguoiMuaId", "tenKhach", "traLoi", "canNhanVien", "ghiChu", "trangThai", "taoLuc")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'cho', ${BAY_GIO}) ON CONFLICT ("id") DO NOTHING`,
                id, n.kenhId, n.hoiThoaiId, n.tinKhachId, n.nguoiMuaId, n.tenKhach ? n.tenKhach.slice(0, 120) : null,
                n.traLoi.slice(0, DAI_TOI_DA), n.canNhanVien, n.ghiChu ? n.ghiChu.slice(0, 300) : null)
            if (Number(them) <= 0) return null
            await db.$executeRawUnsafe(
                `UPDATE "TuTraLoiChoDuyet" SET "trangThai" = 'thay', "traLoi" = NULL, "xuLyLuc" = ${BAY_GIO}
                  WHERE "kenhId" = $1 AND "hoiThoaiId" = $2 AND "id" <> $3 AND "trangThai" = 'cho'`, n.kenhId, n.hoiThoaiId, id)
            return id
        },
        async danhSach(gioiHan) {
            await damBao(db)
            // Dọn: bản đã xử lý / quá 7 ngày — bảng chỉ để duyệt, không phải kho lưu chat
            await db.$executeRawUnsafe(`DELETE FROM "TuTraLoiChoDuyet" WHERE "taoLuc" < ${BAY_GIO} - interval '7 days'`)
            const r: any[] = await db.$queryRawUnsafe(
                `SELECT * FROM "TuTraLoiChoDuyet"
                  WHERE "trangThai" = 'cho' OR ("trangThai" = 'dang_gui' AND "xuLyLuc" < ${BAY_GIO} - make_interval(mins => ${GIU_CHO_GUI_PHUT}))
                  ORDER BY "taoLuc" ASC LIMIT $1`, Math.max(1, Math.min(100, gioiHan)))
            return r.map(docDong)
        },
        async doc(id) {
            await damBao(db)
            const r: any[] = await db.$queryRawUnsafe(`SELECT * FROM "TuTraLoiChoDuyet" WHERE "id" = $1`, id)
            return r[0] ? docDong(r[0]) : null
        },
        async giuChoGui(id, nguoi) {
            const n = await db.$executeRawUnsafe(
                `UPDATE "TuTraLoiChoDuyet" SET "trangThai" = 'dang_gui', "xuLyLuc" = ${BAY_GIO}, "xuLyBoi" = $2
                  WHERE "id" = $1 AND ("trangThai" = 'cho' OR ("trangThai" = 'dang_gui' AND "xuLyLuc" < ${BAY_GIO} - make_interval(mins => ${GIU_CHO_GUI_PHUT})))`,
                id, nguoi)
            return Number(n) > 0
        },
        async ketThuc(id, trangThai, tt) {
            // Xử lý xong ⇒ xoá câu (chỉ giữ mã + ai bấm); trả về hàng chờ ⇒ giữ câu để bấm lại
            await db.$executeRawUnsafe(
                `UPDATE "TuTraLoiChoDuyet" SET "trangThai" = $2, "xuLyLuc" = ${BAY_GIO}, "xuLyBoi" = COALESCE($3, "xuLyBoi"),
                        "maTinGui" = COALESCE($4, "maTinGui"), "loi" = $5, "traLoi" = CASE WHEN $2 = 'cho' THEN "traLoi" ELSE NULL END
                  WHERE "id" = $1`,
                id, trangThai, tt.xuLyBoi ?? null, tt.maTinGui ?? null, tt.loi ? tt.loi.slice(0, 300) : null)
        },
        async bo(id, nguoi, lyDo) {
            const n = await db.$executeRawUnsafe(
                `UPDATE "TuTraLoiChoDuyet" SET "trangThai" = 'bo', "xuLyLuc" = ${BAY_GIO}, "xuLyBoi" = $2, "loi" = $3, "traLoi" = NULL
                  WHERE "id" = $1 AND "trangThai" = 'cho'`, id, nguoi, lyDo.slice(0, 300))
            return Number(n) > 0
        },
    }
}

/** Sau tin khách của bản nháp, người của gian đã tự trả lời chưa (tin của gian, không phải Shopee tự sinh / tin tự động)?
 *  ds: cũ → mới. Không thấy tin khách trong trang vừa đọc (quá cũ) ⇒ xét cả trang. */
export function daCoNguoiTraLoiSau(ds: TinShopeeGoiY[], tinKhachId: string, shopId: string | number): boolean {
    const viTri = ds.findIndex(m => m.messageId === tinKhachId)
    const sau = viTri >= 0 ? ds.slice(viTri + 1) : ds
    return sau.some(m => laTinCuaGian(m, shopId) && m.source !== 'server' && !laTinTuDong(m as any))
}

export interface PhuThuocGuiNhap {
    kho: KhoChoDuyet
    /** Đọc lại tin mới nhất của hội thoại (cũ → mới) + mã gian — để biết người của gian đã trả lời chưa */
    docTin(n: BanNhap): Promise<{ ds: TinShopeeGoiY[]; shopId: string }>
    /** Gửi tin THƯỜNG (send_message) — người đã đọc và bấm Gửi */
    gui(n: BanNhap, cau: string): Promise<{ messageId: string }>
    /** Ghi kết quả vào nhật ký tự trả lời (TuTraLoiNhatKy) — KHÔNG ghi maTinGui: tin này là tin người gửi */
    ghiNhatKy?(n: BanNhap, trangThai: string, lyDo: string): Promise<void>
}

export type KetQuaGuiNhap =
    | { ok: true; maTinGui: string }
    | { ok: false; ma: 'noi_dung' | 'khong_con' | 'da_co_nguoi_tra_loi' | 'loi_doc' | 'loi_gui'; loi: string }

/** Người bấm Gửi trên app. Mỗi bản nháp gửi tối đa MỘT lần; người của gian đã trả lời rồi thì không gửi chồng. */
export async function guiNhapDaDuyet(pt: PhuThuocGuiNhap, id: string, noiDung: unknown, nguoi: string | null): Promise<KetQuaGuiNhap> {
    const cau = String(noiDung ?? '').trim()
    if (!cau) return { ok: false, ma: 'noi_dung', loi: 'Câu trả lời đang trống' }
    if (cau.length > DAI_TOI_DA) return { ok: false, ma: 'noi_dung', loi: `Câu trả lời dài quá ${DAI_TOI_DA} ký tự` }

    const n = await pt.kho.doc(id)
    if (!n || (n.trangThai !== 'cho' && n.trangThai !== 'dang_gui')) return { ok: false, ma: 'khong_con', loi: 'Tin này đã được xử lý rồi' }
    if (!(await pt.kho.giuChoGui(id, nguoi))) return { ok: false, ma: 'khong_con', loi: 'Tin này đang được gửi hoặc đã được xử lý trên máy khác' }

    let doc: { ds: TinShopeeGoiY[]; shopId: string }
    try {
        doc = await pt.docTin(n)
    } catch (e) {
        await pt.kho.ketThuc(id, 'cho', { loi: `không đọc được hội thoại: ${moTaLoi(e).slice(0, 160)}` })
        return { ok: false, ma: 'loi_doc', loi: 'Không đọc được hội thoại từ Shopee — thử lại sau ít phút' }
    }
    if (daCoNguoiTraLoiSau(doc.ds, n.tinKhachId, doc.shopId)) {
        await pt.kho.ketThuc(id, 'bo', { xuLyBoi: nguoi, loi: 'đã có người của gian trả lời' })
        await pt.ghiNhatKy?.(n, 'bo_qua', 'người của gian đã trả lời trước khi duyệt').catch(() => { })
        return { ok: false, ma: 'da_co_nguoi_tra_loi', loi: 'Đã có người của gian trả lời khách này rồi' }
    }
    try {
        const r = await pt.gui(n, cau)
        await pt.kho.ketThuc(id, 'da_gui', { xuLyBoi: nguoi, maTinGui: r.messageId || null })
        await pt.ghiNhatKy?.(n, 'da_duyet', `người duyệt gửi: ${nguoi || '?'}`).catch(() => { })
        return { ok: true, maTinGui: r.messageId || '' }
    } catch (e) {
        const loi = moTaLoi(e).slice(0, 200)
        await pt.kho.ketThuc(id, 'cho', { loi: `gửi lỗi: ${loi}` })
        return { ok: false, ma: 'loi_gui', loi: `Shopee chưa nhận tin: ${loi}` }
    }
}

/** Phút còn lại tới hạn 12 giờ của Shopee, tính từ tin khách CŨ NHẤT chưa được trả lời (âm = quá hạn) */
export function phutConLai(tinKhachLucMs: number | null, taoLucMs: number, bayGioMs: number): number {
    const moc = tinKhachLucMs && Number.isFinite(tinKhachLucMs) ? tinKhachLucMs : taoLucMs
    return Math.floor(HAN_PHAN_HOI_PHUT - (bayGioMs - moc) / 60000)
}
