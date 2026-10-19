/* ═══════════════════════════════════════════════════════════════════════════════
 *  AI VIẾT CÂU CHUYỆN LỒNG GHÉP SẢN PHẨM (17/10/2026)
 *
 *  Chủ shop: "trong phần tạo video thêm các kiểu tạo video như tạo câu chuyện lồng ghép sản phẩm". Máy dựng v9 (frame-ai
 *  lib/kengi-kichban.ts, kiểu 'cau-chuyen') kể một truyện đời thường: mở truyện → rắc rối → sản phẩm xuất hiện (bước ngoặt)
 *  → lợi ích → kết. Ở đây AI viết các truyện đó TỪ tên + mô tả + kho nội dung đã soát (lib/aiSoatNoiDung.ts).
 *
 *  Truyện là hư cấu (nhân vật, hoàn cảnh) nhưng điều nói về SẢN PHẨM phải đúng mô tả — KHÔNG TIN MÙ AI, lọc lại:
 *    · nhịp mở / rắc rối / kết KHÔNG được có chữ số (truyện không cần số; số ở đó dễ thành số liệu bịa);
 *      nhịp bước ngoặt / lợi ích có số thì số phải có trong tên + mô tả
 *    · cấm khuyến mãi, giá, quà, bảo hành, đánh giá / lời khen "của khách", "tốt nhất / số 1 / rẻ nhất", chữa bệnh,
 *      dẫn ra ngoài sàn, câu hỏi
 *    · biểu tượng chỉ lấy trong danh sách trắng (emoji một ký tự — máy dựng vẽ bằng phông emoji hệ thống)
 *  Nhịp hỏng ở phần bắt buộc ⇒ bỏ cả truyện (không vá nửa vời). LƯU theo mã (bảng thô SanMediaCauChuyen, khoá = băm tên +
 *  mô tả + phiên bản lời dặn) ⇒ vân tay video ổn định; "viết thêm" nối truyện mới vào kho (tối đa 12) khi đã dùng hết.
 *
 *  ĐỘ DÀI (v3 19/10/2026, chủ shop: "ít gì cũng phải 1p chứ có vài giây sao mà xem"): bản v2 viết cho video 20–30 giây (5–6
 *  nhịp, lời ≤ 120 ký tự) mà form mặc định TẮT giọng ⇒ video chỉ là vài tấm chữ ~25 giây. Nay 6–7 nhịp, lời 2–3 câu, cả
 *  truyện ≥ LOI_TONG_TOI_THIEU ký tự; máy dựng (v10) hiện lời kể thành đoạn chữ trên hình và giữ mỗi cảnh đủ thời gian đọc.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import crypto from 'crypto'
import { layKeyAi } from './keyAi'
import { goiGemini, goiDeepSeekSoat, docJsonAi, soTrong, NGOAI_SAN, LoiAiSoat, type NoiDungSoat } from './aiSoatNoiDung'

/** Đổi lời dặn / bộ lọc thì tăng — kho truyện cũ viết theo lời dặn cũ sẽ được viết lại */
const PHIEN_BAN_TRUYEN = 'v3'   // v2 17/10: chặn "tuyệt đối/hoàn toàn an toàn", hết bỏ oan "57 độ C" (mẫu giá khớp nhầm "đ…")
                                // v3 19/10: truyện cho video ≥ 1 PHÚT (chủ shop: "ít gì cũng phải 1p chứ có vài giây sao mà xem")
/** Số truyện mỗi lần AI viết */
export const SO_TRUYEN = 4
/** Trần kho truyện của một mã (viết thêm nối dần) */
export const TRAN_KHO = 12
/** Lời kể một nhịp tối đa (máy dựng: một cảnh ≤ 20 giây giọng đọc, lời ≤ 250 ký tự) */
export const LOI_TOI_DA = 210
/** Tổng lời kể tối thiểu của một truyện — ít hơn thì video không đủ 1 phút (máy dựng định giờ cảnh theo thời gian đọc lời) */
export const LOI_TONG_TOI_THIEU = 600
/** Máy dựng Frame tối đa 8 cảnh, cảnh cuối là giá ⇒ truyện tối đa 7 nhịp */
export const NHIP_TOI_DA = 7

export type LoaiNhip = 'mo' | 'roi' | 'ngoat' | 'loi-ich' | 'ket'
export type NhipTruyen = { loai: LoaiNhip; chu: string; loi: string; bieuTuong: string }
export type Truyen = { tieuDe: string; nhip: NhipTruyen[] }
export type KetQuaTruyen = { dungDuoc: boolean; lyDo: string; truyen: Truyen[]; boLoc: number; tuBoNho: boolean; nhaCungCap: string; luc: string }

const LOAI: LoaiNhip[] = ['mo', 'roi', 'ngoat', 'loi-ich', 'ket']
/** Emoji MỘT ký tự (không ghép ZWJ — phông máy dựng vẽ tách rời), hợp đời sống gia đình / công việc. Không có 🎁 (gợi quà
 *  tặng) hay ⭐ (gợi số sao đánh giá). */
export const BIEU_TUONG = ['⏰', '😩', '😅', '😓', '🥵', '🥶', '😴', '😮', '🤔', '😊', '😍', '🥰', '🤩', '😌', '😋', '🙂', '🤗', '🙌', '👍', '💪',
    '✨', '🎉', '🔥', '💧', '❄️', '⚡', '💡', '🔧', '🔨', '🧹', '🧺', '🧼', '🍳', '🍚', '🍜', '🍲', '☕', '🥤', '🏠', '🛋️', '🚗', '🛵', '💼', '📦',
    '📚', '🎂', '🌙', '☀️', '🌧️', '👵', '👶', '🧒', '🐶', '🌿', '🏃', '🛒', '❤️']
const BIEU_TUONG_MAC: Record<LoaiNhip, string> = { mo: '🏠', roi: '😩', ngoat: '✨', 'loi-ich': '👍', ket: '😊' }

/** Lời quảng cáo / hứa hẹn / đánh giá mà truyện KHÔNG được có (shop chưa đưa, hoặc sàn cấm). Giá tiền "57đ" phải là chữ đ
 *  ĐỨNG RIÊNG — đo 17/10 trên mã thật: "Nhiệt độ ổn định 57 độ C" bị bỏ oan vì "57 đ" khớp mẫu giá. Lời khẳng định tuyệt đối
 *  ("an toàn tuyệt đối") là hứa hẹn quá mô tả — AI đã viết đúng câu đó trên máy sấy tóc thật. */
const CAM = /giảm giá|khuyến m[ãạ]i|ưu đãi|\bsale\b|freeship|miễn phí|quà tặng|tặng kèm|bảo hành|số lượng có hạn|chỉ hôm nay|đánh giá|\breview\b|khách hàng (?:khen|nói|chấm|tin)|năm sao|\d\s*sao\b|cam kết|tốt nhất|số 1\b|số một|rẻ nhất|hàng đầu|tuyệt đối|hoàn toàn an toàn|chữa (?:bệnh|khỏi)|điều trị|bác sĩ|giá chỉ|giá rẻ|\d[\d.,]*\s*(?:k\b|đ(?![a-zà-ỹ])|đồng|vnđ)/i

const HUONG_DAN = `Bạn là biên kịch VIDEO BÁN HÀNG dạng KỂ CHUYỆN dài 60–90 giây trên Shopee cho một cửa hàng điện máy, gia dụng, dụng cụ ở Việt Nam.
Nhiệm vụ: viết ${SO_TRUYEN} CÂU CHUYỆN đời thường KHÁC NHAU rõ rệt (khác nhân vật, khác hoàn cảnh), lồng ghép sản phẩm thật tự nhiên.
Video phải xem được cả khi TẮT TIẾNG: lời kể của mỗi nhịp hiện thành đoạn chữ trên hình, nên lời kể phải có câu chuyện thật sự, có chi tiết.

CẤU TRÚC mỗi truyện — đúng thứ tự, 6 hoặc 7 nhịp:
1. "mo": mở truyện — một khoảnh khắc đời thường quen thuộc (ai, ở đâu, đang làm gì).
2. "roi": 1 hoặc 2 nhịp rắc rối — điều bất tiện mà sản phẩm giải quyết được (phải khớp công dụng CÓ TRONG mô tả).
3. "ngoat": bước ngoặt — nhân vật có / dùng sản phẩm (gọi bằng loại hàng hoặc tên ngắn).
4. "loi-ich": 2 hoặc 3 nhịp — mỗi nhịp một lợi ích cụ thể CÓ TRONG mô tả, kể qua trải nghiệm của nhân vật.
5. "ket": kết — kết quả tích cực, nhẹ nhàng.
Mỗi nhịp: "chu" = chữ lớn lên hình, một ý, ≤ 38 ký tự, không dấu chấm cuối; "loi" = lời kể 2–3 câu tự nhiên, 110–190 ký tự (việc nhân vật làm, cảm xúc, chi tiết đời thường), KHÔNG chép lại y "chu".
CẢ TRUYỆN: tổng lời kể của các nhịp tối thiểu 750 ký tự (để đủ một phút).
"bieuTuong" = đúng MỘT emoji trong danh sách: ${BIEU_TUONG.join(' ')}
"tieuDe" = tên truyện ≤ 40 ký tự (ví dụ "Chuyện bữa sáng nhà chị Mai").

LUẬT BẮT BUỘC:
1. Mọi thông tin về SẢN PHẨM chỉ lấy từ tên + mô tả + kho nội dung đã soát. KHÔNG bịa công dụng, chứng nhận, số liệu.
2. Chỉ nhịp "ngoat" và "loi-ich" được có chữ số, và phải y nguyên như mô tả. Các nhịp khác KHÔNG dùng chữ số (viết "sáng sớm", không viết "6 giờ sáng").
3. KHÔNG khuyến mãi, giá tiền, giảm giá, quà tặng, miễn phí, bảo hành, "số lượng có hạn", số sao, đánh giá, lời khen "của khách hàng", "review", "cam kết", "tốt nhất", "số 1", "rẻ nhất", "tuyệt đối", "hoàn toàn an toàn", so sánh hay chê thương hiệu khác.
4. KHÔNG nói về sức khoẻ, chữa bệnh nếu mô tả không nói.
5. KHÔNG số điện thoại, Zalo, website, "inbox", "liên hệ", lời mời mua ngoài sàn. KHÔNG câu hỏi.
6. Nhân vật: tên người Việt phổ biến hoặc vai (mẹ, bố, anh thợ, sinh viên, chị văn phòng, ông bà…). Không người nổi tiếng, không trẻ em gặp nguy hiểm.
7. Giọng kể ấm áp, đời thường, không sến, không giật gân; tiếng Việt có dấu, đúng chính tả, viết hoa chữ cái đầu.
8. Mô tả không đủ để viết truyện đúng sự thật (rác, toàn chính sách giao hàng, của sản phẩm khác) ⇒ dungDuoc=false, lyDo nói ngắn vì sao.
Chỉ trả về MỘT đối tượng JSON đúng khuôn, không giải thích:
{"dungDuoc":true,"lyDo":"","truyen":[{"tieuDe":"","nhip":[{"loai":"mo","chu":"","loi":"","bieuTuong":"⏰"}]}]}`

const gap = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Lọc truyện AI trả: nhịp hỏng thì bỏ, thiếu nhịp bắt buộc thì bỏ cả truyện; xếp lại đúng cấu trúc; bỏ truyện trùng mở đầu. */
export function locTruyen(raw: any, ten: string, moTa: string, nhatKy?: string[]): { dungDuoc: boolean; lyDo: string; truyen: Truyen[]; boLoc: number } {
    const nguon = new Set(soTrong(`${ten}\n${moTa}`))
    let bo = 0
    const sach = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
    const ra: Truyen[] = []
    for (const t of (Array.isArray(raw?.truyen) ? raw.truyen : [])) {
        const nhip: NhipTruyen[] = []
        let hong = false
        for (const n of (Array.isArray(t?.nhip) ? t.nhip : [])) {
            const loai = (LOAI as string[]).includes(n?.loai) ? (n.loai as LoaiNhip) : null
            const chu = sach(n?.chu).replace(/[.。]+$/, ''), loi = sach(n?.loi)
            if (!loai || !chu || !loi) { bo++; nhatKy?.push(`thiếu loại/chữ/lời: ${JSON.stringify(n).slice(0, 80)}`); continue }
            const caHai = `${chu} ${loi}`
            const so = soTrong(caHai)
            const coSo = loai === 'ngoat' || loai === 'loi-ich'
            const soHong = coSo ? so.some(x => !nguon.has(x)) : so.length > 0
            if (chu.length > 44 || loi.length > LOI_TOI_DA || NGOAI_SAN.test(caHai) || CAM.test(caHai) || /\?/.test(caHai) || soHong) {
                bo++
                nhatKy?.push(`${loai}: ${chu.length > 44 ? 'chữ dài ' + chu.length : loi.length > LOI_TOI_DA ? 'lời dài ' + loi.length : NGOAI_SAN.test(caHai) ? 'ngoài sàn'
                    : CAM.test(caHai) ? 'từ cấm «' + (caHai.match(CAM)?.[0] || '') + '»' : /\?/.test(caHai) ? 'câu hỏi' : 'số ' + so.join(',')} — ${chu}`)
                if (loai !== 'loi-ich') hong = true   // nhịp bắt buộc hỏng ⇒ cả truyện hỏng; lợi ích hỏng thì bỏ riêng nhịp đó
                continue
            }
            const bt = sach(n?.bieuTuong)
            nhip.push({ loai, chu, loi, bieuTuong: BIEU_TUONG.includes(bt) ? bt : BIEU_TUONG_MAC[loai] })
        }
        // đúng cấu trúc: mở / ngoặt / kết lấy nhịp đầu, rắc rối ≤ 2, lợi ích ≤ 3; xếp mở → rắc rối → ngoặt → lợi ích → kết;
        // quá NHIP_TOI_DA (máy dựng ≤ 8 cảnh kể cả cảnh giá) thì bớt lợi ích sau cùng (giữ ≥ 2), rồi rắc rối thứ hai
        const dau = (l: LoaiNhip) => nhip.find(x => x.loai === l)
        let roi = nhip.filter(x => x.loai === 'roi').slice(0, 2)
        let loiIch = nhip.filter(x => x.loai === 'loi-ich').slice(0, 3)
        while (3 + roi.length + loiIch.length > NHIP_TOI_DA && loiIch.length > 2) loiIch = loiIch.slice(0, -1)
        while (3 + roi.length + loiIch.length > NHIP_TOI_DA && roi.length > 1) roi = roi.slice(0, -1)
        const xep = [dau('mo'), ...roi, dau('ngoat'), ...loiIch, dau('ket')]
        if (hong || xep.some(x => !x) || !roi.length || !loiIch.length) { bo++; nhatKy?.push(`BỎ TRUYỆN «${sach(t?.tieuDe)}»: ${hong ? 'nhịp bắt buộc hỏng' : 'thiếu nhịp'}`); continue }
        // lời kể là thứ định độ dài video (máy dựng giữ mỗi cảnh đủ thời gian đọc / giọng đọc) — ngắn quá ⇒ video < 1 phút
        const tongLoi = (xep as NhipTruyen[]).reduce((s, x) => s + x.loi.length, 0)
        if (tongLoi < LOI_TONG_TOI_THIEU) { bo++; nhatKy?.push(`BỎ TRUYỆN «${sach(t?.tieuDe)}»: lời kể ngắn ${tongLoi}/${LOI_TONG_TOI_THIEU} ký tự — video không đủ 1 phút`); continue }
        const tieuDe = sach(t?.tieuDe).replace(/[.。]+$/, '').slice(0, 48)
        ra.push({ tieuDe: CAM.test(tieuDe) || NGOAI_SAN.test(tieuDe) || soTrong(tieuDe).length ? '' : tieuDe, nhip: xep as NhipTruyen[] })
    }
    // truyện trùng câu mở thì giữ một
    const truyen = ra.filter((t, i) => ra.findIndex(x => gap(x.nhip[0]!.chu) === gap(t.nhip[0]!.chu)) === i)
    let dungDuoc = raw?.dungDuoc !== false
    let lyDo = dungDuoc ? '' : sach(raw?.lyDo).slice(0, 200) || 'AI đánh giá mô tả không đủ để viết truyện đúng sự thật'
    if (dungDuoc && !truyen.length) { dungDuoc = false; lyDo = `Không truyện nào đạt luật sau khi lọc (bỏ ${bo} nhịp/truyện) — bấm viết lại` }
    return { dungDuoc, lyDo, truyen, boLoc: bo }
}

const bangSan = new Set<string>()
async function damBaoBang(prisma: any) {
    const sc = String(prisma?.__schema || 'mac-dinh')
    if (bangSan.has(sc)) return
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SanMediaCauChuyen" (
        "productId" TEXT PRIMARY KEY, bam TEXT NOT NULL, "ketQua" TEXT NOT NULL, "nhaCungCap" TEXT, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now())`)
    bangSan.add(sc)
}

export type SanPhamTruyen = { id: string; ten: string; sku: string; moTa: string; thuongHieu?: string | null; nhom?: string | null }

/**
 * Kho truyện của MỘT mã: có sẵn (cùng tên + mô tả) thì trả; không thì AI viết. `vietThem` = viết thêm SO_TRUYEN truyện nối vào
 * kho (khi các truyện cũ đã dùng hết cho video), tối đa TRAN_KHO.
 */
export async function vietCauChuyen(prisma: any, sp: SanPhamTruyen, nd: NoiDungSoat | null, vietThem = false): Promise<KetQuaTruyen> {
    const moTa = String(sp.moTa || '').slice(0, 8000)
    const bam = crypto.createHash('sha256').update(`${PHIEN_BAN_TRUYEN}\n${sp.ten}\n${moTa}`).digest('hex').slice(0, 32)
    let daLuu: any = null
    try {
        await damBaoBang(prisma)
        const r: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM "SanMediaCauChuyen" WHERE "productId" = $1`, sp.id)
        daLuu = r[0] || null
    } catch { daLuu = null }
    let cu: Truyen[] = []
    if (daLuu?.bam === bam) { try { cu = JSON.parse(daLuu.ketQua)?.truyen || [] } catch { cu = [] } }
    if (cu.length && !vietThem) {
        return { dungDuoc: true, lyDo: '', truyen: cu, boLoc: 0, tuBoNho: true, nhaCungCap: daLuu.nhaCungCap || '', luc: new Date(daLuu.updatedAt).toISOString() }
    }
    const { loc, model } = await vietTruyenAi(prisma, sp, nd, cu)
    if (!loc.dungDuoc && !cu.length) return { ...loc, tuBoNho: false, nhaCungCap: model, luc: new Date().toISOString() }
    // nối truyện mới sau truyện cũ (giữ thứ tự cũ ⇒ biến thể cũ vẫn trỏ đúng truyện), bỏ trùng câu mở, tối đa TRAN_KHO
    const gop = [...cu]
    for (const t of loc.truyen) if (!gop.some(x => gap(x.nhip[0]!.chu) === gap(t.nhip[0]!.chu))) gop.push(t)
    const truyen = gop.slice(0, TRAN_KHO)
    try {
        await prisma.$executeRawUnsafe(
            `INSERT INTO "SanMediaCauChuyen" ("productId", bam, "ketQua", "nhaCungCap", "updatedAt") VALUES ($1,$2,$3,$4,now())
             ON CONFLICT ("productId") DO UPDATE SET bam=$2, "ketQua"=$3, "nhaCungCap"=$4, "updatedAt"=now()`,
            sp.id, bam, JSON.stringify({ truyen }), model)
    } catch { /* không lưu được — vẫn trả kết quả */ }
    return { dungDuoc: truyen.length > 0, lyDo: truyen.length ? '' : loc.lyDo, truyen, boLoc: loc.boLoc, tuBoNho: false, nhaCungCap: model, luc: new Date().toISOString() }
}

/** MỘT lượt AI viết truyện + lọc — KHÔNG đọc/ghi kho (đầu dò quản trị dùng thẳng). `cu` = truyện đã có, để AI viết truyện khác. */
export async function vietTruyenAi(prisma: any, sp: SanPhamTruyen, nd: NoiDungSoat | null, cu: Truyen[] = [], nhatKy?: string[]) {
    const moTa = String(sp.moTa || '').slice(0, 8000)
    const key = await layKeyAi(prisma)
    if (!key.gemini && !key.deepseek) throw new LoiAiSoat('Chưa có key AI — vào Hệ Thống → Cài Đặt, tab Trợ lý AI nhập key Gemini (miễn phí ở aistudio.google.com/apikey).', false, true)
    const deBai = [
        `Tên sản phẩm: ${sp.ten}`, `Mã (SKU): ${sp.sku || '—'}`,
        sp.thuongHieu ? `Hãng: ${sp.thuongHieu}` : '', sp.nhom ? `Nhóm hàng: ${sp.nhom}` : '',
        nd ? `KHO NỘI DUNG ĐÃ SOÁT (đúng sự thật, ưu tiên dùng):\n- Tên ngắn: ${nd.tenNgan || '—'}\n- Lợi ích: ${nd.khauHieu.join(' | ') || '—'}\n- Điểm mạnh: ${nd.diemManh.join(' | ') || '—'}\n- Thông số: ${nd.thongSo.map(x => `${x.nhan} ${x.giaTri}`).join(' | ') || '—'}` : '',
        cu.length ? `ĐÃ CÓ các truyện sau — viết truyện MỚI khác hẳn (khác nhân vật, hoàn cảnh):\n${cu.map(t => `- ${t.tieuDe}: ${t.nhip[0]?.chu}`).join('\n')}` : '',
        'MÔ TẢ GỐC (shop viết):', '"""', moTa, '"""',
    ].filter(Boolean).join('\n')
    let kq: { text: string; model: string } | null = null
    let loiGemini: any = null
    if (key.gemini) { try { kq = await goiGemini(key.gemini, deBai, HUONG_DAN) } catch (e) { loiGemini = e } }
    if (!kq && key.deepseek) kq = await goiDeepSeekSoat(key.deepseek, deBai, HUONG_DAN)
    if (!kq) throw loiGemini || new LoiAiSoat('AI không viết được câu chuyện', true)
    const raw = docJsonAi(kq.text)
    return { raw, loc: locTruyen(raw, sp.ten, moTa, nhatKy), model: kq.model }
}
