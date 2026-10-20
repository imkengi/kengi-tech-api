/* ═══════════════════════════════════════════════════════════════════════════════
 *  AI ĐỌC TÀI LIỆU — Kengi Vault (20/10/2026)
 *
 *  Đọc hợp đồng / hoá đơn / biên bản / giấy tờ (PDF, ảnh chụp, docx, xlsx, txt) bằng Gemini của CHÍNH
 *  cửa hàng (lib/keyAi.ts) ⇒ ra loại giấy tờ, tóm tắt, số hiệu, các bên, ngày ký / hết hạn, tổng tiền,
 *  nhãn gợi ý + phần chữ đọc được để TÌM KIẾM theo nội dung.
 *
 *  KHÔNG BỊA (cùng tinh thần lib/aiSoatNoiDung.ts): ngày, số tiền, số hiệu, MST, số điện thoại chỉ được
 *  giữ khi CÓ MẶT trong chữ đọc được của chính tài liệu — không thấy thì bỏ và ghi vào canhBao. Ngày hết
 *  hạn sai còn tệ hơn không có: nó đặt lịch nhắc sai cho chủ shop.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import zlib from 'zlib'
import { MODEL_GEMINI, docJsonAi } from './aiSoatNoiDung'

export const AI_TOI_DA_BYTE = 18 * 1024 * 1024   // gửi kèm trực tiếp (inline) — Gemini nhận ≤ 20MB mỗi lượt
export const AI_MOI_NGAY = 150                    // trần lượt đọc / cửa hàng / 24 giờ
const CHU_TOI_DA = 20_000                         // chữ lưu để tìm kiếm

export const LOAI_TAI_LIEU: Record<string, string> = {
    hop_dong: 'Hợp đồng', hoa_don: 'Hoá đơn', bao_gia: 'Báo giá', bien_ban: 'Biên bản', phieu_giao_hang: 'Phiếu giao/nhận hàng',
    chung_tu_ngan_hang: 'Chứng từ ngân hàng', giay_to_tuy_than: 'Giấy tờ tuỳ thân', giay_phep: 'Giấy phép / chứng nhận',
    giay_to_xe: 'Giấy tờ xe', bao_hanh: 'Phiếu bảo hành', don_dat_hang: 'Đơn đặt hàng', cong_van: 'Công văn / thông báo', khac: 'Khác',
}
const VAI_TRO = new Set(['ben_ban', 'ben_mua', 'ben_a', 'ben_b', 'nguoi_ky', 'co_quan_cap', 'khac'])
const NHOM = new Set(['contracts_customer', 'docs_supplier', 'internal', 'other'])

export interface BenAi { vaiTro: string; ten: string; maSoThue: string | null; dienThoai: string | null }
export interface KetQuaAi {
    loai: string; tieuDe: string; tomTat: string; soHieu: string | null
    ngayLap: string | null; ngayHieuLuc: string | null; ngayHetHan: string | null
    cacBen: BenAi[]; tongTien: number | null; donViTien: string | null
    nhan: string[]; nhomGoiY: string | null; doTinCay: 'cao' | 'trung_binh' | 'thap'
    canhBao: string[]; boLoc: number; model: string; luc: string
}

export class LoiAiTaiLieu extends Error {
    constructor(msg: string, public tamThoi = false, public khongCoKey = false) { super(msg) }
}

const HUONG_DAN = `Bạn là nhân viên lưu trữ chứng từ cẩn thận của một cửa hàng bán lẻ/bán buôn ở Việt Nam.
Đọc tài liệu được gửi kèm (hợp đồng, hoá đơn, báo giá, biên bản, phiếu giao hàng, giấy tờ, ảnh chụp chứng từ...) rồi trả về MỘT đối tượng JSON.

LUẬT BẮT BUỘC:
1. CHỈ ghi điều NHÌN THẤY trong tài liệu. Không suy đoán, không tự tính, không điền mẫu. Trường không có thì null (hoặc mảng rỗng).
2. Ngày viết dạng "YYYY-MM-DD". Chỉ ghi ngayHetHan khi tài liệu ghi RÕ ngày hết hạn / thời hạn đến ngày / hiệu lực đến ngày. Không tự cộng "12 tháng" ra ngày.
3. tongTien là SỐ (không dấu chấm phẩy), lấy đúng tổng giá trị/tổng thanh toán ghi trong tài liệu; donViTien như tài liệu ghi ("VND"...).
4. tieuDe ≤ 80 ký tự (vd "Hợp đồng mua bán nồi cơm điện với Công ty A"); tomTat 1–3 câu ≤ 300 ký tự, nêu: ai với ai, về việc gì, giá trị, thời hạn.
5. loai thuộc: hop_dong, hoa_don, bao_gia, bien_ban, phieu_giao_hang, chung_tu_ngan_hang, giay_to_tuy_than, giay_phep, giay_to_xe, bao_hanh, don_dat_hang, cong_van, khac.
6. cacBen: tối đa 4 bên; vaiTro thuộc ben_ban, ben_mua, ben_a, ben_b, nguoi_ky, co_quan_cap, khac; maSoThue/dienThoai chép y nguyên nếu có.
7. nhan: 2–6 nhãn ngắn (≤ 24 ký tự, chữ thường, tiếng Việt có dấu) giúp tìm lại, vd "hợp đồng", "sunhouse", "bảo hành".
8. nhomGoiY: contracts_customer (giấy tờ với khách hàng), docs_supplier (chứng từ với nhà cung cấp), internal (nội bộ cửa hàng), other.
9. chu: chép lại phần chữ chính đọc được (giữ số, ngày, tên như trong tài liệu), tối đa 6000 ký tự.
10. doTinCay: cao (chữ rõ) / trung_binh / thap (mờ, nghiêng, thiếu trang). canhBao: điều bất thường (thiếu chữ ký, hết hạn, chữ mờ...), có thể rỗng.
Chỉ trả JSON đúng khuôn, không giải thích:
{"loai":"","tieuDe":"","tomTat":"","soHieu":null,"ngayLap":null,"ngayHieuLuc":null,"ngayHetHan":null,"cacBen":[{"vaiTro":"","ten":"","maSoThue":null,"dienThoai":null}],"tongTien":null,"donViTien":null,"nhan":[],"nhomGoiY":"other","doTinCay":"cao","canhBao":[],"chu":""}`

// ─── Chữ từ docx / xlsx (không gửi được thẳng cho Gemini) ────────────────────
/** Đọc một mục trong tệp ZIP (docx/xlsx là ZIP) — chỉ đủ cho deflate/stored */
export function docMucZip(buf: Buffer, ten: string): Buffer | null {
    let eocd = -1
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    if (eocd < 0) return null
    const soMuc = buf.readUInt16LE(eocd + 10)
    let p = buf.readUInt32LE(eocd + 16)
    for (let n = 0; n < soMuc && p + 46 <= buf.length; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) return null
        const kieu = buf.readUInt16LE(p + 10), coNen = buf.readUInt32LE(p + 20)
        const dTen = buf.readUInt16LE(p + 28), dPhu = buf.readUInt16LE(p + 30), dGhiChu = buf.readUInt16LE(p + 32)
        const viTri = buf.readUInt32LE(p + 42)
        const tenMuc = buf.toString('utf8', p + 46, p + 46 + dTen)
        if (tenMuc === ten) {
            const batDau = viTri + 30 + buf.readUInt16LE(viTri + 26) + buf.readUInt16LE(viTri + 28)
            const du = buf.subarray(batDau, batDau + coNen)
            if (kieu === 0) return Buffer.from(du)
            if (kieu === 8) return zlib.inflateRawSync(du, { maxOutputLength: 50 * 1024 * 1024 } as any)
            return null
        }
        p += 46 + dTen + dPhu + dGhiChu
    }
    return null
}
const boThe = (xml: string) => xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

export function trichChuVanPhong(buf: Buffer, mime: string, ten: string): string | null {
    const duoi = ten.toLowerCase().split('.').pop() || ''
    try {
        if (duoi === 'docx' || /wordprocessingml/.test(mime)) {
            const x = docMucZip(buf, 'word/document.xml')
            return x ? boThe(x.toString('utf8')).replace(/\n{3,}/g, '\n\n').trim() : null
        }
        if (['xlsx', 'xls', 'csv'].includes(duoi) || /spreadsheetml|ms-excel/.test(mime)) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const XLSX = require('xlsx')
            const wb = XLSX.read(buf, { type: 'buffer' })
            return wb.SheetNames.slice(0, 5).map((s: string) => `# ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s])}`).join('\n\n').slice(0, 60_000)
        }
    } catch { return null }
    return null
}

/** Loại nào AI đọc được, và gửi bằng cách nào */
export function cachGuiAi(mime: string, ten: string, size: number): { kieu: 'inline' | 'chu' | null; lyDo?: string } {
    if (size > AI_TOI_DA_BYTE) return { kieu: null, lyDo: `Tệp ${Math.round(size / 1048576)}MB — AI chỉ đọc tệp ≤ ${AI_TOI_DA_BYTE / 1048576}MB` }
    if (/^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/.test(mime)) return { kieu: 'inline' }
    const duoi = ten.toLowerCase().split('.').pop() || ''
    if (/^text\/(plain|csv)/.test(mime) || ['docx', 'xlsx', 'xls', 'csv', 'txt'].includes(duoi) || /wordprocessingml|spreadsheetml|ms-excel/.test(mime)) return { kieu: 'chu' }
    return { kieu: null, lyDo: 'AI chưa đọc được loại tệp này (chỉ PDF, ảnh, Word .docx, Excel, văn bản)' }
}

// ─── Kiểm "có trong chữ đọc được" ────────────────────────────────────────────
const boDau = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
const pad = (n: number) => String(n).padStart(2, '0')
function ngayHopLe(y: number, m: number, d: number): string | null {
    if (y < 1950 || y > 2150 || m < 1 || m > 12 || d < 1 || d > 31) return null
    const t = new Date(Date.UTC(y, m - 1, d))
    if (t.getUTCMonth() !== m - 1) return null
    return `${y}-${pad(m)}-${pad(d)}`
}
/** Mọi ngày xuất hiện trong chữ (d/m/yyyy, yyyy-mm-dd, "ngày d tháng m năm yyyy") ở dạng YYYY-MM-DD */
export function ngayTrongChu(chu: string): Set<string> {
    const t = boDau(chu).toLowerCase()
    const ra = new Set<string>()
    for (const m of t.matchAll(/(?<!\d)(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4})(?!\d)/g)) { const n = ngayHopLe(+m[3]!, +m[2]!, +m[1]!); if (n) ra.add(n) }
    for (const m of t.matchAll(/(?<!\d)(\d{4})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?!\d)/g)) { const n = ngayHopLe(+m[1]!, +m[2]!, +m[3]!); if (n) ra.add(n) }
    for (const m of t.matchAll(/ngay\s*(\d{1,2})\s*thang\s*(\d{1,2})\s*nam\s*(\d{4})/g)) { const n = ngayHopLe(+m[3]!, +m[2]!, +m[1]!); if (n) ra.add(n) }
    return ra
}
/** Mọi số nguyên viết trong chữ (bỏ dấu ngăn nghìn . , khoảng trắng) */
export function soTrongChu(chu: string): Set<number> {
    const ra = new Set<number>()
    for (const m of chu.matchAll(/\d{1,3}(?:[.,\s]\d{3})+(?![\d])|\d+/g)) {
        const n = Number(m[0].replace(/[.,\s]/g, ''))
        if (Number.isFinite(n)) ra.add(n)
    }
    return ra
}
const chiSo = (s: string) => s.replace(/\D/g, '')
const gon = (s: string) => boDau(s).toUpperCase().replace(/[\s.\-_/]/g, '')

/** Lọc kết quả AI: chuẩn hoá, cắt độ dài, bỏ trường không có trong chữ (ghi lý do vào canhBao). */
export function locKetQuaAi(raw: any, nguon: string, model: string): KetQuaAi & { chu: string } {
    const sach = (v: unknown, tran = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, tran)
    const chuAi = String(raw?.chu ?? '').slice(0, CHU_TOI_DA)
    const chu = (nguon.trim() ? nguon : chuAi).slice(0, CHU_TOI_DA * 2)
    const ngayCo = ngayTrongChu(chu)
    const soCo = soTrongChu(chu)
    const chuGon = gon(chu)
    const chuSo = chiSo(chu)
    const canhBao: string[] = (Array.isArray(raw?.canhBao) ? raw.canhBao : []).map((x: unknown) => sach(x, 200)).filter(Boolean).slice(0, 5)
    let boLoc = 0
    const ngay = (v: unknown, nhan: string): string | null => {
        const s = sach(v, 20)
        if (!s || s === 'null') return null
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
        const n = m ? ngayHopLe(+m[1]!, +m[2]!, +m[3]!) : null
        if (!n) { boLoc++; return null }
        if (!ngayCo.has(n)) { boLoc++; canhBao.push(`AI nêu ${nhan} ${n.split('-').reverse().join('/')} nhưng không thấy ngày đó trong chữ đọc được — đã bỏ`); return null }
        return n
    }
    const ngayLap = ngay(raw?.ngayLap, 'ngày lập')
    const ngayHieuLuc = ngay(raw?.ngayHieuLuc, 'ngày hiệu lực')
    const ngayHetHan = ngay(raw?.ngayHetHan, 'ngày hết hạn')
    let tongTien: number | null = null
    if (raw?.tongTien !== null && raw?.tongTien !== undefined && raw?.tongTien !== '') {
        const n = Number(String(raw.tongTien).replace(/[^\d.-]/g, ''))
        if (Number.isFinite(n) && n > 0 && soCo.has(Math.round(n))) tongTien = Math.round(n)
        else { boLoc++; canhBao.push('AI nêu tổng tiền không khớp số nào trong tài liệu — đã bỏ') }
    }
    let soHieu: string | null = sach(raw?.soHieu, 60) || null
    if (soHieu && (soHieu === 'null' || !chuGon.includes(gon(soHieu)))) { soHieu = null; boLoc++ }
    const cacBen: BenAi[] = (Array.isArray(raw?.cacBen) ? raw.cacBen : []).slice(0, 4).map((b: any) => {
        let mst: string | null = sach(b?.maSoThue, 20) || null
        if (mst && (mst === 'null' || chiSo(mst).length < 10 || !chuSo.includes(chiSo(mst)))) { mst = null; boLoc++ }
        let dt: string | null = sach(b?.dienThoai, 20) || null
        if (dt && (dt === 'null' || chiSo(dt).length < 9 || !chuSo.includes(chiSo(dt)))) { dt = null; boLoc++ }
        return { vaiTro: VAI_TRO.has(String(b?.vaiTro)) ? String(b.vaiTro) : 'khac', ten: sach(b?.ten, 120), maSoThue: mst, dienThoai: dt }
    }).filter((b: BenAi) => b.ten)
    const nhan = Array.from(new Set((Array.isArray(raw?.nhan) ? raw.nhan : [])
        .map((x: unknown) => sach(x, 24).toLowerCase().replace(/^#/, '')).filter((x: string) => x.length >= 2))).slice(0, 6) as string[]
    const loai = LOAI_TAI_LIEU[String(raw?.loai)] ? String(raw.loai) : 'khac'
    const doTinCay = ['cao', 'trung_binh', 'thap'].includes(raw?.doTinCay) ? raw.doTinCay : 'trung_binh'
    return {
        loai, tieuDe: sach(raw?.tieuDe, 100), tomTat: sach(raw?.tomTat, 400), soHieu,
        ngayLap, ngayHieuLuc, ngayHetHan, cacBen, tongTien, donViTien: tongTien ? (sach(raw?.donViTien, 10) || 'VND') : null,
        nhan, nhomGoiY: NHOM.has(String(raw?.nhomGoiY)) ? String(raw.nhomGoiY) : null, doTinCay,
        canhBao: canhBao.slice(0, 8), boLoc, model, luc: new Date().toISOString(),
        chu: (chuAi || nguon).slice(0, CHU_TOI_DA),
    }
}

/** Gọi Gemini với tài liệu đính kèm, thử lần lượt model như aiSoatNoiDung (JSON mode). */
export async function goiGeminiTaiLieu(key: string, parts: any[]): Promise<{ text: string; model: string }> {
    const goc = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, '')
    const vet: string[] = []
    let tamThoi = false
    for (const model of MODEL_GEMINI) {
        const body = JSON.stringify({
            systemInstruction: { parts: [{ text: HUONG_DAN }] },
            contents: [{ role: 'user', parts }],
            generationConfig: { responseMimeType: 'application/json', ...(/^gemini-2\./.test(model) ? { temperature: 0.1 } : {}) },
        })
        let res: Response
        try {
            res = await fetch(`${goc}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(120_000),
            })
        } catch { tamThoi = true; vet.push(`${model}: không phản hồi`); continue }
        const data: any = await res.json().catch(() => null)
        if (res.ok) {
            const text = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || '').join('')
            if (text.trim()) return { text, model }
            vet.push(`${model}: trả rỗng${data?.candidates?.[0]?.finishReason ? ` (${data.candidates[0].finishReason})` : ''}`); continue
        }
        if (res.status === 429 || res.status >= 500) tamThoi = true
        // Key sai thì đổi model cũng vô ích
        if (res.status === 400 && /api key/i.test(String(data?.error?.message || ''))) throw new LoiAiTaiLieu('Key Gemini của cửa hàng không hợp lệ — vào Hệ Thống → Cài Đặt, tab Trợ lý AI để sửa', false, true)
        vet.push(`${model}: ${res.status} ${String(data?.error?.message || '').slice(0, 100)}`)
    }
    throw new LoiAiTaiLieu(`Gemini không đọc được tài liệu: ${vet.join('; ')}`, tamThoi)
}

/**
 * Đọc MỘT tài liệu. `buf` = nội dung tệp; `mime` = MIME đã nhận dạng theo byte (routes/storage.ts).
 * Ném LoiAiTaiLieu khi không đọc được (thiếu key, loại không hỗ trợ, Gemini hỏng).
 */
export async function docTaiLieuAi(key: string, buf: Buffer, mime: string, ten: string, ghiChu: string): Promise<KetQuaAi & { chu: string }> {
    if (!key) throw new LoiAiTaiLieu('Cửa hàng chưa có key Gemini — vào Hệ Thống → Cài Đặt, tab Trợ lý AI để nhập (miễn phí ở aistudio.google.com/apikey)', false, true)
    const cach = cachGuiAi(mime, ten, buf.length)
    if (!cach.kieu) throw new LoiAiTaiLieu(cach.lyDo || 'Không đọc được loại tệp này')
    let nguon = ''
    const parts: any[] = []
    if (cach.kieu === 'inline') {
        parts.push({ inlineData: { mimeType: mime === 'image/heif' ? 'image/heic' : mime, data: buf.toString('base64') } })
    } else {
        nguon = trichChuVanPhong(buf, mime, ten) ?? buf.toString('utf8').replace(/\u0000/g, '')
        if (!nguon.trim()) throw new LoiAiTaiLieu('Tệp không có chữ để đọc')
        parts.push({ text: `NỘI DUNG TÀI LIỆU (chữ trích từ tệp):\n${nguon.slice(0, 60_000)}` })
    }
    parts.push({ text: `Tên tệp: ${ten}${ghiChu ? `\nGhi chú của cửa hàng: ${ghiChu.slice(0, 300)}` : ''}\nĐọc tài liệu trên và trả JSON đúng khuôn.` })
    const { text, model } = await goiGeminiTaiLieu(key, parts)
    let raw: any
    try { raw = docJsonAi(text) } catch (e: any) { throw new LoiAiTaiLieu(e?.message || 'AI trả JSON hỏng', true) }
    return locKetQuaAi(raw, nguon, model)
}
