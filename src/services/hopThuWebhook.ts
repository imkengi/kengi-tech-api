/* ═══════════════════════════════════════════════════════════════════════════════
 *  HỘP THƯ WEBHOOK SÀN — GHI PUSH XUỐNG DB RỒI MỚI TRẢ 200 (13/09/2026)
 *
 *  Chủ shop: "sửa webhook trả 200 sau khi ghi xong luôn đi".
 *
 *  TRƯỚC: webhook Shopee/TikTok trả 200 NGAY rồi mới xử lý, lỗi chỉ console.error.
 *  Sàn đã nhận 200 nên KHÔNG BAO GIỜ đẩy lại. Đo 24 h (12→13/09): Shopee rơi
 *  416/5.027 push (8,3%) — 248 lỗi bị nuốt (178 lỗi Prisma rỗng ruột + ~70 lỗi
 *  proxy Tino "thất bại sau 3 lần"/"quá 30s") + 168 lần không lấy được chi tiết
 *  đơn là bỏ luôn; TikTok rơi 37/346. Toàn lỗi TẠM THỜI — thử lại sau vài phút là qua.
 *
 *  VÌ SAO KHÔNG DỜI res.status(200) XUỐNG CUỐI: đo cùng 24 h, xử lý một push
 *  Shopee mất trung vị 1,47 s nhưng p90 18 s, p95 36 s; 41% quá 3 s, 16% quá 10 s
 *  (vì phải gọi ngược API sàn qua proxy Tino). Giữ request tới lúc xong thì ~40%
 *  push bị sàn coi là hỏng và đẩy lại — đúng lỗi ghi chú 03/09 trong webhooks.ts
 *  đã chữa. Đuôi dài đó nhiều phần còn do xử lý chạy SAU khi đã trả lời, lúc Cloud
 *  Run (cpu-throttling: true) đã bóp CPU.
 *
 *  NÊN: (1) ghi NGUYÊN push (thân thô + chữ ký) vào bảng public."WebhookInbox" —
 *  một câu INSERT, vài chục ms; ghi hỏng → trả 503 để sàn đẩy lại. (2) Xử lý NGAY
 *  trong lúc request còn mở (còn CPU), tối đa NGAN_SACH_MS. (3) Trả 200. (4) Chưa
 *  xong thì chạy tiếp; hỏng thì dòng nằm lại với lịch thử lại giãn nhịp; máy bị giết
 *  giữa chừng thì dòng kẹt "dang" được quét lại sau 15'. Không push nào mất nữa trừ
 *  khi hỏng đủ SO_LAN_TOI_DA lần (khi đó trạng thái 'hong', vẫn còn cron sync vớt).
 *
 *  Trạng thái: dang → xong | bo (cố ý bỏ: mã không nhận, chữ ký bản của app khác…)
 *              dang → loi (hẹn giờ) → dang … → hong (hết lượt)
 *              dang → cho (hoãn có chủ đích, vd đợi lượt quét phiếu trả) → dang
 *
 *  Nghiệm thu: GET /api/admin/do-hop-thu-webhook.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import crypto from 'crypto'
import registryPrisma, { laLoiMatKetNoi } from '../lib/prisma'
import { moTaLoi } from '../lib/gomLoi'

export type NenTangPush = 'shopee' | 'tiktok'

export interface TinPush {
    id: string
    platform: NenTangPush
    body: any
    /** undefined khi lúc nhận không đọc được thân thô → bộ xử lý bỏ qua kiểm chữ ký như trước */
    rawBody?: Buffer
    signature: string
    pushUrl: string
    nhanLuc: Date
    /** lần thử HIỆN TẠI, bắt đầu từ 1 */
    soLanThu: number
}

export type KetQuaPush =
    | { loai: 'xong'; ghiChu?: string }
    | { loai: 'bo'; lyDo: string }
    | { loai: 'hoan'; lyDo: string; sauGiay: number }

export const xongPush = (ghiChu?: string): KetQuaPush => ({ loai: 'xong', ghiChu })
export const boPush = (lyDo: string): KetQuaPush => ({ loai: 'bo', lyDo })
export const hoanPush = (lyDo: string, sauGiay: number): KetQuaPush => ({ loai: 'hoan', lyDo, sauGiay })

type BoXuLy = (tin: TinPush) => Promise<KetQuaPush>
const boXuLy = new Map<NenTangPush, BoXuLy>()

/** webhooks.ts đăng ký hàm xử lý lúc nạp module — tránh vòng import hai chiều. */
export function dangKyBoXuLyPush(platform: NenTangPush, f: BoXuLy): void {
    boXuLy.set(platform, f)
}

/* Ngân sách xử lý tại chỗ trước khi PHẢI trả lời sàn. Không có con số hạn chờ
 * chính thức của Shopee để dựa vào, nên chọn thấp: 2 s vẫn cho phần lớn push xong
 * tại chỗ (trung vị đo được 1,1–1,5 s, mà đó là số đo lúc CPU đã bị bóp). */
const NGAN_SACH_MS = Math.max(200, parseInt(process.env.WEBHOOK_NGAN_SACH_MS || '2000', 10))
/* Giãn nhịp thử lại. Lượt 2 sau 30 s; proxy Tino tự ngắt mạch ~110 s nên trượt
 * thì lượt 3 sau 2' là qua. Tổng ~2,7 giờ trước khi bỏ cuộc. */
const GIAN_NHIP_GIAY = [30, 120, 600, 1800, 7200]
const SO_LAN_TOI_DA = GIAN_NHIP_GIAY.length + 1
const KET_QUA_PHUT = 15
const BANG = '"public"."WebhookInbox"'

let bangSan: Promise<void> | null = null
function damBaoBang(): Promise<void> {
    if (!bangSan) {
        bangSan = (async () => {
            const cau = [
                `CREATE TABLE IF NOT EXISTS ${BANG} (
                    "id"        BIGSERIAL PRIMARY KEY,
                    "platform"  TEXT NOT NULL,
                    "loaiPush"  INTEGER,
                    "shopId"    TEXT,
                    "khoaTrung" TEXT NOT NULL,
                    "than"      TEXT NOT NULL,
                    "coThanTho" BOOLEAN NOT NULL DEFAULT true,
                    "chuKy"     TEXT NOT NULL DEFAULT '',
                    "pushUrl"   TEXT NOT NULL DEFAULT '',
                    "trangThai" TEXT NOT NULL DEFAULT 'dang',
                    "soLanThu"  INTEGER NOT NULL DEFAULT 0,
                    "nhanLuc"   TIMESTAMPTZ NOT NULL DEFAULT now(),
                    "henLuc"    TIMESTAMPTZ NOT NULL DEFAULT now(),
                    "batDauLuc" TIMESTAMPTZ,
                    "xongLuc"   TIMESTAMPTZ,
                    "ghiChu"    TEXT
                )`,
                `CREATE UNIQUE INDEX IF NOT EXISTS "WebhookInbox_khoaTrung_key" ON ${BANG} ("khoaTrung")`,
                `CREATE INDEX IF NOT EXISTS "WebhookInbox_cho_idx" ON ${BANG} ("trangThai", "henLuc")`,
                `CREATE INDEX IF NOT EXISTS "WebhookInbox_nhanLuc_idx" ON ${BANG} ("nhanLuc")`,
            ]
            for (const c of cau) {
                try {
                    await registryPrisma.$executeRawUnsafe(c)
                } catch (e: any) {
                    // Hai bản máy cùng tạo một lúc: Postgres có thể ném trùng pg_type dù có IF NOT EXISTS.
                    if (!/already exists|duplicate key value/i.test(String(e?.message || ''))) throw e
                }
            }
        })().catch(e => { bangSan = null; throw e })
    }
    return bangSan
}

/** Ghi push vào hộp thư, trạng thái 'dang' (sắp xử lý tại chỗ). null = bản TRÙNG đã có. */
async function ghiVaoHopThu(p: {
    platform: NenTangPush; body: any; rawBody?: Buffer; signature: string; pushUrl: string
}): Promise<TinPush | null> {
    await damBaoBang()
    const coThanTho = !!p.rawBody
    const than = coThanTho ? p.rawBody!.toString('utf8') : JSON.stringify(p.body ?? {})
    /* Khoá trùng GỒM CẢ CHỮ KÝ: sàn đẩy lại cùng một lần giao thì thân + chữ ký y
     * hệt → gộp. Còn "một sự kiện, hai app" (shopee-push-hai-app) thì chữ ký khác
     * nhau → giữ CẢ HAI; gộp theo thân thôi thì lỡ bản của app kia tới trước là giữ
     * nhầm bản không kiểm được chữ ký và vứt bản thật. */
    const khoaTrung = crypto.createHash('sha256').update(`${p.platform}|${p.signature}|${than}`).digest('hex')
    const loai = Number(p.platform === 'shopee' ? p.body?.code : p.body?.type)
    const shopId = p.body?.shop_id == null ? null : String(p.body.shop_id)
    const rows: any[] = await registryPrisma.$queryRawUnsafe(
        `INSERT INTO ${BANG} ("platform","loaiPush","shopId","khoaTrung","than","coThanTho","chuKy","pushUrl","trangThai","soLanThu","batDauLuc")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'dang',1,now())
         ON CONFLICT ("khoaTrung") DO NOTHING
         RETURNING "id"::text AS id, "nhanLuc"`,
        p.platform, Number.isFinite(loai) ? loai : null, shopId,
        khoaTrung, than, coThanTho, p.signature || '', p.pushUrl || '',
    )
    if (!rows.length) return null
    return {
        id: rows[0].id, platform: p.platform, body: p.body, rawBody: p.rawBody,
        signature: p.signature || '', pushUrl: p.pushUrl || '', nhanLuc: new Date(rows[0].nhanLuc), soLanThu: 1,
    }
}

async function capNhat(sql: string, ...thamSo: any[]): Promise<void> {
    try {
        await registryPrisma.$executeRawUnsafe(sql, ...thamSo)
    } catch (e) {
        // Ghi trạng thái hỏng thì dòng kẹt 'dang' → lượt quét sau 15' nhặt lại. Không mất.
        console.error(`[Hộp thư webhook] không ghi được trạng thái: ${moTaLoi(e)}`)
    }
}

/** Chạy một tin tới trạng thái kế tiếp. KHÔNG BAO GIỜ ném. */
async function chayTin(tin: TinPush): Promise<void> {
    const f = boXuLy.get(tin.platform)
    if (!f) {
        await capNhat(`UPDATE ${BANG} SET "trangThai"='hong', "xongLuc"=now(), "ghiChu"=$2 WHERE "id"=$1::bigint`,
            tin.id, `chưa đăng ký bộ xử lý cho ${tin.platform}`)
        return
    }
    try {
        const kq = await f(tin)
        if (kq.loai === 'xong') {
            await capNhat(`UPDATE ${BANG} SET "trangThai"='xong', "xongLuc"=now(), "ghiChu"=$2 WHERE "id"=$1::bigint`,
                tin.id, kq.ghiChu ?? (tin.soLanThu > 1 ? `xong ở lần ${tin.soLanThu}` : null))
            if (tin.soLanThu > 1) console.log(`[Hộp thư webhook] ✅ ${tin.platform} tin ${tin.id} CỨU ĐƯỢC ở lần thử ${tin.soLanThu}`)
        } else if (kq.loai === 'bo') {
            await capNhat(`UPDATE ${BANG} SET "trangThai"='bo', "xongLuc"=now(), "ghiChu"=$2 WHERE "id"=$1::bigint`,
                tin.id, kq.lyDo)
        } else if (Date.now() - tin.nhanLuc.getTime() > 3 * 3600_000) {
            // Hoãn mãi quá 3 giờ là có chuyện (lượt quét nền chết liên tục?) → bỏ cuộc cho người soi.
            await capNhat(`UPDATE ${BANG} SET "trangThai"='hong', "xongLuc"=now(), "ghiChu"=$2 WHERE "id"=$1::bigint`,
                tin.id, `hoãn quá 3 giờ — ${kq.lyDo}`.slice(0, 2000))
            console.error(`[Hộp thư webhook] ❌ ${tin.platform} tin ${tin.id} hoãn quá 3 giờ — bỏ cuộc: ${kq.lyDo}`)
        } else {
            /* Hoãn có chủ đích KHÔNG ăn vào số lần thử: lượt nhặt đã +1 thì trả lại. Không
             * có dòng này thì một lượt quét phiếu trả 6,5 phút đủ đốt hết 6 lượt thử. */
            await capNhat(`UPDATE ${BANG} SET "trangThai"='cho', "soLanThu"=GREATEST("soLanThu" - 1, 0), "henLuc"=now() + ($2::int * interval '1 second'), "ghiChu"=$3 WHERE "id"=$1::bigint`,
                tin.id, Math.max(1, Math.round(kq.sauGiay)), kq.lyDo)
        }
    } catch (e) {
        const moTa = moTaLoi(e)
        if (tin.soLanThu >= SO_LAN_TOI_DA) {
            await capNhat(`UPDATE ${BANG} SET "trangThai"='hong', "xongLuc"=now(), "ghiChu"=$2 WHERE "id"=$1::bigint`,
                tin.id, `hỏng đủ ${tin.soLanThu} lần — ${moTa}`.slice(0, 2000))
            console.error(`[Hộp thư webhook] ❌ ${tin.platform} tin ${tin.id} BỎ CUỘC sau ${tin.soLanThu} lần (cron sync còn vớt): ${moTa}`)
        } else {
            const cho = GIAN_NHIP_GIAY[Math.min(tin.soLanThu - 1, GIAN_NHIP_GIAY.length - 1)]
            await capNhat(`UPDATE ${BANG} SET "trangThai"='loi', "henLuc"=now() + ($2::int * interval '1 second'), "ghiChu"=$3 WHERE "id"=$1::bigint`,
                tin.id, cho, `lần ${tin.soLanThu}: ${moTa}`.slice(0, 2000))
            console.warn(`[Hộp thư webhook] ${tin.platform} tin ${tin.id} lần ${tin.soLanThu} hỏng — thử lại sau ${cho}s: ${moTa}`)
        }
    }
}

/**
 * Nhận một push: ghi hộp thư → xử lý tại chỗ tối đa NGAN_SACH_MS → trả lời.
 * `traLoi200` phải là lời đáp sàn đòi (Shopee: 200 thân rỗng; TikTok: JSON).
 */
export async function nhanPush(
    p: { platform: NenTangPush; body: any; rawBody?: Buffer; signature: string; pushUrl: string },
    traLoi200: () => void,
    traLoi503: () => void,
): Promise<void> {
    const batDau = Date.now()
    /* MỘT hạn chung cho cả ghi lẫn xử lý: INSERT phải chờ pool (PRISMA_POOL_TIMEOUT=30
     * trên prod) thì có thể giữ request hàng chục giây → sàn hết hạn chờ. Ghi không kịp
     * trong NGAN_SACH_MS → 503 ngay cho sàn đẩy lại, NHƯNG vẫn đợi câu ghi: ghi được thì
     * xử lý luôn, và lần sàn đẩy lại sẽ trùng khoá → nhận 200 mà không làm lại. */
    const ghi = ghiVaoHopThu(p)
    let henGhi: NodeJS.Timeout | undefined
    const kipGhi = await Promise.race([
        ghi.then(() => true, () => true),
        new Promise<false>(r => { henGhi = setTimeout(() => r(false), NGAN_SACH_MS) }),
    ])
    if (henGhi) clearTimeout(henGhi)
    if (!kipGhi) {
        console.error(`[Hộp thư webhook] ghi push ${p.platform} quá ${NGAN_SACH_MS}ms — trả 503 cho sàn đẩy lại, vẫn chờ ghi xong để xử lý`)
        traLoi503()
        ghi.then(t => (t ? chayTin(t) : undefined), e => {
            console.error(`[Hộp thư webhook] ghi chậm rồi hỏng luôn, chờ sàn đẩy lại: ${moTaLoi(e)}`)
        })
        return
    }
    let tin: TinPush | null
    try {
        tin = await ghi
    } catch (e) {
        if (laLoiMatKetNoi(e)) {
            // DB không tới được thì xử lý cũng không ghi được gì → để sàn đẩy lại là đúng.
            console.error(`[Hộp thư webhook] ❌ KHÔNG ghi được push ${p.platform} (mất kết nối DB) — trả 503 để sàn đẩy lại: ${moTaLoi(e)}`)
            traLoi503()
            return
        }
        /* Lỗi KHÁC (bảng/SQL của chính hộp thư hỏng): KHÔNG được trả 503 hàng loạt — sàn
         * sẽ đẩy lại dồn dập và có thể tự tắt push (KiotViet từng làm vậy). Lùi về đúng
         * đường cũ: trả 200 rồi xử lý trong bộ nhớ. Tệ nhất cũng chỉ bằng trước 13/09. */
        console.error(`[Hộp thư webhook] ❌ HỘP THƯ HỎNG — lùi về đường cũ (200 rồi xử lý, không thử lại) cho push ${p.platform}: ${moTaLoi(e)}`)
        traLoi200()
        const f = boXuLy.get(p.platform)
        if (f) {
            await f({
                id: 'khong-hop-thu', platform: p.platform, body: p.body, rawBody: p.rawBody,
                signature: p.signature || '', pushUrl: p.pushUrl || '', nhanLuc: new Date(), soLanThu: 1,
            }).catch(err => console.error(`[Hộp thư webhook] đường cũ hỏng, push ${p.platform} RƠI: ${moTaLoi(err)}`))
        }
        return
    }
    if (!tin) {
        // Sàn đẩy lại đúng bản đã có trong hộp thư → nhận, không làm lại.
        traLoi200()
        return
    }
    const viec = chayTin(tin)
    const conLai = NGAN_SACH_MS - (Date.now() - batDau)
    if (conLai > 0) {
        let hen: NodeJS.Timeout | undefined
        await Promise.race([
            viec,
            new Promise<void>(r => { hen = setTimeout(r, conLai) }),
        ])
        if (hen) clearTimeout(hen)
    }
    traLoi200()
    // Chưa xong trong ngân sách thì `viec` vẫn chạy tiếp; dòng đã nằm trong hộp thư nên không mất.
}

/* ─── QUÉT HỘP THƯ (cron, mỗi phút, chỉ bản lãnh đạo) ────────────────────── */
let lanDonGanNhat = 0

export async function quetHopThu(tuyChon: { epDon?: boolean } = {}): Promise<void> {
    if (tuyChon.epDon) lanDonGanNhat = 0
    await damBaoBang()
    // 1) Dòng kẹt 'dang' quá 15' = máy bị giết / treo giữa chừng → trả về hàng đợi.
    await registryPrisma.$executeRawUnsafe(
        `UPDATE ${BANG}
            SET "trangThai" = CASE WHEN "soLanThu" >= $1 THEN 'hong' ELSE 'loi' END,
                "henLuc" = now(),
                "xongLuc" = CASE WHEN "soLanThu" >= $1 THEN now() ELSE NULL END,
                "ghiChu" = left(COALESCE("ghiChu" || ' | ', '') || 'kẹt ở "dang" quá ${KET_QUA_PHUT} phút (máy bị giết giữa chừng?)', 2000)
          WHERE "trangThai" = 'dang' AND "batDauLuc" < now() - interval '${KET_QUA_PHUT} minutes'`,
        SO_LAN_TOI_DA,
    )
    // 2) Nhặt từng dòng tới hạn, chạy TUẦN TỰ (PRISMA_POOL_SIZE=1 — không Promise.all).
    const hetGio = Date.now() + 45_000
    let soDong = 0
    while (Date.now() < hetGio) {
        const rows: any[] = await registryPrisma.$queryRawUnsafe(
            `UPDATE ${BANG} w
                SET "trangThai" = 'dang', "batDauLuc" = now(), "soLanThu" = w."soLanThu" + 1
              WHERE w."id" = (
                    SELECT "id" FROM ${BANG}
                     WHERE "trangThai" IN ('cho','loi') AND "henLuc" <= now()
                     ORDER BY "henLuc" ASC
                     LIMIT 1
                     FOR UPDATE SKIP LOCKED)
          RETURNING w."id"::text AS id, w."platform", w."than", w."coThanTho", w."chuKy", w."pushUrl", w."nhanLuc", w."soLanThu"`,
        )
        if (!rows.length) break
        const r = rows[0]
        let body: any = {}
        try { body = JSON.parse(r.than) } catch { /* thân hỏng → bộ xử lý tự báo */ }
        await chayTin({
            id: r.id, platform: r.platform, body,
            rawBody: r.coThanTho ? Buffer.from(r.than, 'utf8') : undefined,
            signature: r.chuKy || '', pushUrl: r.pushUrl || '',
            nhanLuc: new Date(r.nhanLuc), soLanThu: Number(r.soLanThu),
        })
        soDong++
    }
    if (soDong) console.log(`[Hộp thư webhook] lượt quét chạy lại ${soDong} push`)

    // 3) Dọn mỗi giờ một lần. Giữ 'xong' 2 ngày (đủ đo nghiệm thu 24 h), 'bo' 1 ngày
    //    (phần lớn là bản của app kia), 'hong' 14 ngày để còn soi.
    if (Date.now() - lanDonGanNhat > 3600_000) {
        lanDonGanNhat = Date.now()
        const xoa = await registryPrisma.$executeRawUnsafe(
            `DELETE FROM ${BANG}
              WHERE ("trangThai" = 'xong' AND "nhanLuc" < now() - interval '2 days')
                 OR ("trangThai" = 'bo'   AND "nhanLuc" < now() - interval '1 day')
                 OR ("trangThai" = 'hong' AND "nhanLuc" < now() - interval '14 days')`,
        )
        if (xoa) console.log(`[Hộp thư webhook] dọn ${xoa} dòng cũ`)
    }
}

/** Đưa các push đã bỏ cuộc về hàng đợi để chạy lại từ đầu (sau khi đã chữa nguyên nhân). */
export async function chayLaiPushHong(platform?: NenTangPush): Promise<number> {
    await damBaoBang()
    return registryPrisma.$executeRawUnsafe(
        `UPDATE ${BANG} SET "trangThai"='loi', "soLanThu"=0, "henLuc"=now(), "xongLuc"=NULL,
                "ghiChu"=left('chạy lại tay | ' || COALESCE("ghiChu",''), 2000)
          WHERE "trangThai"='hong' AND ($1::text IS NULL OR "platform"=$1::text)`,
        platform ?? null,
    )
}

export async function thongKeHopThu(): Promise<any> {
    await damBaoBang()
    const theoTrangThai: any[] = await registryPrisma.$queryRawUnsafe(
        `SELECT "platform", "trangThai", count(*)::int AS so
           FROM ${BANG} WHERE "nhanLuc" > now() - interval '24 hours'
          GROUP BY 1, 2 ORDER BY 1, 2`,
    )
    const thoiGian: any[] = await registryPrisma.$queryRawUnsafe(
        `SELECT "platform",
                count(*)::int AS "soXong",
                count(*) FILTER (WHERE "soLanThu" = 1 AND "xongLuc" - "nhanLuc" <= ($1::int * interval '1 millisecond'))::int AS "xongTaiCho",
                count(*) FILTER (WHERE "soLanThu" > 1)::int AS "cuuNhoThuLai",
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM "xongLuc" - "nhanLuc"))::numeric, 2)::float8 AS "p50Giay",
                round(percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM "xongLuc" - "nhanLuc"))::numeric, 2)::float8 AS "p90Giay",
                round(percentile_cont(0.99) WITHIN GROUP (ORDER BY extract(epoch FROM "xongLuc" - "nhanLuc"))::numeric, 2)::float8 AS "p99Giay"
           FROM ${BANG}
          WHERE "trangThai" = 'xong' AND "nhanLuc" > now() - interval '24 hours'
          GROUP BY 1`,
        NGAN_SACH_MS,
    )
    const dangCho: any[] = await registryPrisma.$queryRawUnsafe(
        `SELECT "platform", count(*)::int AS so,
                round(extract(epoch FROM now() - min("nhanLuc"))::numeric, 0)::float8 AS "cuNhatGiay"
           FROM ${BANG} WHERE "trangThai" IN ('dang','cho','loi')
          GROUP BY 1`,
    )
    const loiGanDay: any[] = await registryPrisma.$queryRawUnsafe(
        `SELECT "id"::text AS id, "platform", "loaiPush", "trangThai", "soLanThu", "nhanLuc", "henLuc", left("ghiChu", 300) AS "ghiChu"
           FROM ${BANG} WHERE "trangThai" IN ('loi','hong')
          ORDER BY "nhanLuc" DESC LIMIT 15`,
    )
    const lyDoBo: any[] = await registryPrisma.$queryRawUnsafe(
        `SELECT "platform", left("ghiChu", 80) AS "lyDo", count(*)::int AS so
           FROM ${BANG} WHERE "trangThai" = 'bo' AND "nhanLuc" > now() - interval '24 hours'
          GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`,
    )
    return { nganSachMs: NGAN_SACH_MS, soLanToiDa: SO_LAN_TOI_DA, gianNhipGiay: GIAN_NHIP_GIAY, theoTrangThai, thoiGian, dangCho, loiGanDay, lyDoBo }
}

/* ─── TỰ KIỂM TRÊN DB THẬT ────────────────────────────────────────────────────
 * Máy dev không có Postgres, mà SQL hộp thư sai là mọi push đổ về 503. Hàm này
 * chạy DÒNG GIẢ qua mọi câu SQL rồi xoá chúng: POST /api/admin/thu-hop-thu-webhook.
 * Dòng Shopee giả mang mã push 999999 → bộ xử lý THẬT trả 'bo' trước khi đụng cửa
 * hàng nào. Các bước còn lại dùng nền tảng giả 'tu-kiem' có bộ xử lý giả. */
export async function tuKiemHopThu(): Promise<{ ok: boolean; buoc: Array<{ buoc: string; ok: boolean; chiTiet?: any }> }> {
    const buoc: Array<{ buoc: string; ok: boolean; chiTiet?: any }> = []
    const ghi = (ten: string, ok: boolean, chiTiet?: any) => { buoc.push({ buoc: ten, ok, chiTiet }) }
    const ma = `tu-kiem-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const GIA = 'tu-kiem' as unknown as NenTangPush
    const idGia: string[] = []
    const docDong = async (id: string): Promise<any> => (await registryPrisma.$queryRawUnsafe<any[]>(
        `SELECT "trangThai", "soLanThu", "ghiChu", round(extract(epoch FROM "henLuc" - now()))::int AS "henSauGiay"
           FROM ${BANG} WHERE "id" = $1::bigint`, id))[0]
    const themGia = async (kieu: string): Promise<TinPush | null> => {
        const than = Buffer.from(JSON.stringify({ tuKiem: ma, kieu }), 'utf8')
        const t = await ghiVaoHopThu({ platform: GIA, body: { tuKiem: ma, kieu }, rawBody: than, signature: `${ma}-${kieu}`, pushUrl: '' })
        if (t) idGia.push(t.id)
        return t
    }
    const daHoan = new Set<string>()
    boXuLy.set(GIA, async (tin) => {
        const kieu = tin.body?.kieu
        if (kieu === 'loi-lan-1' && tin.soLanThu === 1) throw new Error('lỗi giả lần 1 (tự kiểm)')
        if (kieu === 'hoan' && !daHoan.has(tin.id)) { daHoan.add(tin.id); return hoanPush('tự kiểm: hoãn', 5) }
        return xongPush(`tự kiểm: xong ở lần ${tin.soLanThu}`)
    })
    try {
        await damBaoBang()
        ghi('tạo bảng + chỉ mục', true)

        const thanShopee = Buffer.from(JSON.stringify({ code: 999999, shop_id: 0, data: {}, tuKiem: ma }), 'utf8')
        const vao = { platform: 'shopee' as NenTangPush, body: JSON.parse(thanShopee.toString('utf8')), rawBody: thanShopee, signature: ma, pushUrl: 'tu-kiem' }
        const t1 = await ghiVaoHopThu(vao)
        if (t1) idGia.push(t1.id)
        ghi('INSERT push', !!t1, t1 && { id: t1.id })
        ghi('bản trùng bị chặn (ON CONFLICT)', (await ghiVaoHopThu(vao)) === null)
        if (t1) {
            await chayTin(t1)
            const r = await docDong(t1.id)
            ghi("bộ xử lý Shopee THẬT, mã push lạ → 'bo'", r?.trangThai === 'bo', r)
        }

        const t2 = await themGia('loi-lan-1')
        if (t2) {
            await chayTin(t2)
            const r = await docDong(t2.id)
            ghi("lần 1 ném → 'loi', hẹn ~30s", r?.trangThai === 'loi' && r?.henSauGiay > 0 && r?.henSauGiay <= 31, r)
        }

        const t3 = await themGia('hoan')
        if (t3) {
            await chayTin(t3)
            const r = await docDong(t3.id)
            ghi("hoãn có chủ đích → 'cho', hẹn ~5s, KHÔNG ăn lượt thử", r?.trangThai === 'cho' && r?.henSauGiay > 0 && r?.henSauGiay <= 6 && Number(r?.soLanThu) === 0, r)
        }

        const t4 = await themGia('ket')
        if (t4) {
            // Giả máy bị giết giữa chừng: 'dang' từ 1 giờ trước.
            await registryPrisma.$executeRawUnsafe(`UPDATE ${BANG} SET "batDauLuc" = now() - interval '1 hour' WHERE "id" = $1::bigint`, t4.id)
        }
        if (t2) await registryPrisma.$executeRawUnsafe(`UPDATE ${BANG} SET "henLuc" = now() - interval '1 second' WHERE "id" = $1::bigint`, t2.id)
        if (t3) await registryPrisma.$executeRawUnsafe(`UPDATE ${BANG} SET "henLuc" = now() - interval '1 second' WHERE "id" = $1::bigint`, t3.id)
        await quetHopThu({ epDon: true })
        if (t2) { const r = await docDong(t2.id); ghi("lượt quét nhặt dòng 'loi' → 'xong' ở lần 2", r?.trangThai === 'xong' && Number(r?.soLanThu) === 2, r) }
        if (t3) { const r = await docDong(t3.id); ghi("lượt quét nhặt dòng 'cho' → 'xong' (lần thử vẫn là 1)", r?.trangThai === 'xong' && Number(r?.soLanThu) === 1, r) }
        if (t4) { const r = await docDong(t4.id); ghi("gỡ kẹt 'dang' quá 15' → nhặt lại → 'xong' ở lần 2", r?.trangThai === 'xong' && Number(r?.soLanThu) === 2, r) }

        if (t4) {
            await registryPrisma.$executeRawUnsafe(`UPDATE ${BANG} SET "trangThai" = 'hong' WHERE "id" = $1::bigint`, t4.id)
            const n = await chayLaiPushHong(GIA)
            const r = await docDong(t4.id)
            ghi("chạy lại dòng 'hong' (chỉ nền tảng giả)", n === 1 && r?.trangThai === 'loi' && Number(r?.soLanThu) === 0, { soDong: n, ...r })
        }

        const tk = await thongKeHopThu()
        ghi('câu thống kê', Array.isArray(tk.theoTrangThai) && Array.isArray(tk.thoiGian))
    } catch (e) {
        ghi('LỖI giữa chừng', false, moTaLoi(e))
    } finally {
        boXuLy.delete(GIA)
        try {
            const n = await registryPrisma.$executeRawUnsafe(
                `DELETE FROM ${BANG} WHERE "platform" = 'tu-kiem' OR "id" = ANY($1::bigint[])`, idGia)
            ghi('xoá dòng giả', true, { soDong: n })
        } catch (e) {
            ghi('xoá dòng giả', false, moTaLoi(e))
        }
    }
    return { ok: buoc.every(b => b.ok), buoc }
}
