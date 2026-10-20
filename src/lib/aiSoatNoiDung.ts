/* ═══════════════════════════════════════════════════════════════════════════════
 *  AI SOÁT NỘI DUNG VIDEO TỪ SẢN PHẨM (14/10/2026)
 *
 *  Chủ shop: "lúc tạo video có thể cho AI double check nội dung được không, lên nhiều cái xàm quá". Bộ đọc mô tả của
 *  máy dựng (frame-ai lib/kengi-kichban.ts) chỉ cắt theo luật nên lấy nhầm câu HỎI làm khẩu hiệu ("Bạn đang tìm một
 *  chiếc cân bền bỉ…?"), cắt cụt câu ("…cho không gian mở lên…"), nhặt dòng chung chung. Ở đây AI đọc lại MÔ TẢ GỐC và
 *  trả KHO NỘI DUNG sạch — tên ngắn, khẩu hiệu, điểm mạnh, thông số — CHỈ từ tên + mô tả, không bịa. Máy dựng (v8) dùng
 *  kho này thay kho tự cắt; biến thể vẫn chọn + xếp trong kho đó.
 *
 *  KHÔNG TIN MÙ AI: lọc lại sau khi nhận (độ dài, dòng dẫn ra ngoài sàn, và MỌI con số phải có trong tên/mô tả — số
 *  không có nguồn là số bịa, bỏ cả dòng).
 *  LƯU theo mã (bảng SanMediaNoiDung, khoá = băm tên + mô tả + phiên bản hướng dẫn): mỗi mô tả soát MỘT lần ⇒ các video
 *  sau của mã có cùng kho nội dung ⇒ vân tay ổn định (AI trả mỗi lần một kiểu là chống trùng nội dung mất tác dụng).
 * ═══════════════════════════════════════════════════════════════════════════════ */
import crypto from 'crypto'
import { layKeyAi } from './keyAi'

export type NoiDungSoat = {
    dungDuoc: boolean
    lyDo: string
    tenNgan: string
    khauHieu: string[]
    diemManh: string[]
    thongSo: { nhan: string; giaTri: string }[]
    canhBao: string[]
    /** số dòng AI trả mà bị lọc bỏ (dài quá, số không có trong mô tả, dẫn ra ngoài sàn) */
    boLoc: number
}
export type KetQuaSoat = { noiDung: NoiDungSoat; tuBoNho: boolean; nhaCungCap: string; luc: string }

/** Đổi hướng dẫn thì tăng — kho cũ soát theo hướng dẫn cũ sẽ được soát lại */
const PHIEN_BAN_SOAT = 'v1'
export const MODEL_GEMINI = Array.from(new Set([
    process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash',
].filter(Boolean) as string[]))

export class LoiAiSoat extends Error {
    constructor(msg: string, public tamThoi: boolean, public khongCoKey = false) { super(msg) }
}

const HUONG_DAN = `Bạn là biên tập viên nội dung VIDEO BÁN HÀNG NGẮN (15–30 giây) trên Shopee cho một cửa hàng điện máy, gia dụng, dụng cụ ở Việt Nam.
Nhiệm vụ: đọc TÊN và MÔ TẢ GỐC do shop viết, rút ra nội dung ngắn, đúng, dễ hiểu để đưa lên hình và đọc thành lời.

LUẬT BẮT BUỘC:
1. CHỈ dùng thông tin CÓ TRONG tên + mô tả. KHÔNG bịa số liệu, công dụng, chứng nhận, khuyến mãi, giá, quà tặng, bảo hành, "số lượng có hạn", số sao đánh giá. Mọi con số phải lấy y nguyên từ mô tả.
2. KHÔNG đưa số điện thoại, Zalo, website, "inbox", "liên hệ", lời mời mua ở ngoài sàn.
3. tenNgan: tên gọi ngắn ≤ 45 ký tự (loại hàng + hãng + mã/điểm phân biệt chính). Bỏ "[Hàng Chính Hãng]", "Mới 100%", "Bảo hành…", "Freeship".
4. khauHieu: 1–3 câu KHẲNG ĐỊNH ngắn (≤ 70 ký tự) nêu lợi ích chính. KHÔNG câu hỏi, KHÔNG mở đầu bằng tên sản phẩm, không cảm thán sáo rỗng.
5. diemManh: 3–8 điểm, mỗi điểm MỘT Ý TRỌN VẸN ≤ 40 ký tự (tính cả dấu cách), cụ thể (tính năng, chất liệu, lợi ích). Không lặp ý, không cắt cụt giữa câu, không chung chung ("chất lượng cao", "thiết kế đẹp") nếu mô tả không nói rõ.
6. thongSo: tối đa 6 thông số cụ thể đo được (dung tích, công suất, kích thước, trọng lượng, chất liệu, số chế độ, thời gian…). nhan ≤ 22 ký tự, giaTri ≤ 20 ký tự, GIỮ NGUYÊN số và đơn vị như mô tả. Bỏ thương hiệu, xuất xứ, model, mã vạch, màu sắc.
7. Mô tả là của sản phẩm KHÁC (khác mã, khác dung tích/công suất so với tên) hoặc không phải mô tả sản phẩm (toàn chính sách giao hàng, rác) ⇒ dungDuoc=false và lyDo nói ngắn vì sao. Còn lại dungDuoc=true, lyDo rỗng.
8. canhBao: điều đáng ngờ trong mô tả (số liệu mâu thuẫn, nhắc mã khác…), có thể rỗng.
9. Tiếng Việt có dấu, đúng chính tả, viết hoa chữ cái đầu câu.
Chỉ trả về MỘT đối tượng JSON đúng khuôn, không giải thích:
{"dungDuoc":true,"lyDo":"","tenNgan":"","khauHieu":[""],"diemManh":[""],"thongSo":[{"nhan":"","giaTri":""}],"canhBao":[]}`

export const NGOAI_SAN = /https?:\/\/|www\.|\.(?:com|vn|net)\b|zalo|hotline|messenger|\binbox\b|nhắn tin|liên hệ|gọi ngay|gọi điện|(?:^|\D)(?:\+?84|0)(?:[\s.-]?\d){8,10}(?!\d)/i

export function docJsonAi(text: string): any {
    const t = String(text || '').replace(/```(?:json)?/gi, '').trim()
    const a = t.indexOf('{'), b = t.lastIndexOf('}')
    if (a < 0 || b <= a) throw new LoiAiSoat('AI không trả JSON', true)
    try { return JSON.parse(t.slice(a, b + 1)) } catch { throw new LoiAiSoat('AI trả JSON hỏng', true) }
}

/** Số trong chuỗi (1.800 / 1,5 / 20) ở dạng chuẩn để so có trong mô tả không */
export const soTrong = (s: string) => (String(s).match(/\d+(?:[.,]\d+)*/g) || []).map(x => x.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'))

/** Lọc lại kết quả AI: độ dài, dẫn ra ngoài sàn, SỐ KHÔNG CÓ NGUỒN (số bịa) ⇒ bỏ cả dòng */
export function locKetQua(raw: any, ten: string, moTa: string): NoiDungSoat {
    const nguon = new Set(soTrong(`${ten}\n${moTa}`))
    let bo = 0
    const sach = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
    const hop = (s: string, tran: number) => {
        if (!s) return false
        if (s.length > tran || NGOAI_SAN.test(s) || /\?\s*$/.test(s) || soTrong(s).some(n => !nguon.has(n))) { bo++; return false }
        return true
    }
    const duyNhat = (ds: string[]) => ds.filter((x, i) => ds.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i)
    const khauHieu = duyNhat((Array.isArray(raw?.khauHieu) ? raw.khauHieu : []).map(sach).filter((s: string) => hop(s, 90))).slice(0, 3)
    const diemManh = duyNhat((Array.isArray(raw?.diemManh) ? raw.diemManh : []).map(sach).map((s: string) => s.replace(/[.;]+$/, '')).filter((s: string) => hop(s, 40))).slice(0, 8)
    const thongSo = (Array.isArray(raw?.thongSo) ? raw.thongSo : [])
        .map((x: any) => ({ nhan: sach(x?.nhan), giaTri: sach(x?.giaTri) }))
        .filter((x: { nhan: string; giaTri: string }) => x.nhan && x.giaTri && hop(x.nhan, 24) && hop(x.giaTri, 22))
        .filter((x: { nhan: string }, i: number, ds: { nhan: string }[]) => ds.findIndex(y => y.nhan.toLowerCase() === x.nhan.toLowerCase()) === i)
        .slice(0, 6)
    let tenNgan = sach(raw?.tenNgan)
    if (!tenNgan || tenNgan.length > 60 || soTrong(tenNgan).some(n => !nguon.has(n))) tenNgan = ''
    let dungDuoc = raw?.dungDuoc !== false
    let lyDo = dungDuoc ? '' : sach(raw?.lyDo).slice(0, 200) || 'AI đánh giá mô tả không dùng được'
    if (dungDuoc && !khauHieu.length && !diemManh.length && thongSo.length < 2) { dungDuoc = false; lyDo = 'AI không rút ra được nội dung dùng được từ mô tả' }
    const canhBao = (Array.isArray(raw?.canhBao) ? raw.canhBao : []).map(sach).filter(Boolean).slice(0, 5).map((s: string) => s.slice(0, 200))
    return { dungDuoc, lyDo, tenNgan, khauHieu, diemManh, thongSo, canhBao, boLoc: bo }
}

/** Gọi Gemini theo thứ tự model (JSON mode). `huongDan` = lời dặn hệ thống — mặc định của việc soát; AI viết truyện
 *  (lib/aiCauChuyen.ts) truyền lời dặn riêng. */
export async function goiGemini(key: string, deBai: string, huongDan: string = HUONG_DAN): Promise<{ text: string; model: string }> {
    const vet: string[] = []
    let coTamThoi = false
    for (const model of MODEL_GEMINI) {
        const body = JSON.stringify({
            systemInstruction: { parts: [{ text: huongDan }] },
            contents: [{ role: 'user', parts: [{ text: deBai }] }],
            // Dòng 3.x: Google khuyên giữ temperature mặc định; 2.x hạ thấp cho ổn định (như aiAgentRunner)
            generationConfig: { responseMimeType: 'application/json', ...(/^gemini-2\./.test(model) ? { temperature: 0.2 } : {}) },
        })
        let res: Response
        try {
            res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(60_000),
            })
        } catch { coTamThoi = true; vet.push(`${model}: không phản hồi`); continue }
        const data: any = await res.json().catch(() => null)
        if (res.ok) {
            const text = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || '').join('')
            if (text.trim()) return { text, model }
            vet.push(`${model}: trả rỗng`); continue
        }
        if (res.status === 429 || res.status >= 500) coTamThoi = true
        vet.push(`${model}: ${res.status} ${String(data?.error?.message || '').slice(0, 80)}`)
    }
    throw new LoiAiSoat(`Gemini không soát được: ${vet.join('; ')}`, coTamThoi)
}

export async function goiDeepSeekSoat(key: string, deBai: string, huongDan: string = HUONG_DAN): Promise<{ text: string; model: string }> {
    const { goiDeepSeek } = await import('../services/aiDeepSeek')
    const data = await goiDeepSeek([{ role: 'user', parts: [{ text: deBai }] }], key, huongDan, [])
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || '').join('')
    if (!text.trim()) throw new LoiAiSoat('DeepSeek trả rỗng', true)
    return { text, model: 'deepseek' }
}

export type SanPhamSoat = { id: string; ten: string; sku: string; moTa: string; thuongHieu?: string | null; nhom?: string | null; tenTrenSan?: string | null }

/** Soát (hoặc lấy từ bộ nhớ) kho nội dung của MỘT mã. `lamMoi` = bỏ qua bản đã lưu. */
export async function soatNoiDung(prisma: any, sp: SanPhamSoat, lamMoi = false): Promise<KetQuaSoat> {
    const moTa = String(sp.moTa || '').slice(0, 8000)
    const bam = crypto.createHash('sha256').update(`${PHIEN_BAN_SOAT}\n${sp.ten}\n${moTa}`).digest('hex').slice(0, 32)
    let daLuu: any = null
    try { daLuu = await prisma.sanMediaNoiDung.findUnique({ where: { productId: sp.id } }) } catch { daLuu = null /* bảng chưa migrate — soát không lưu */ }
    if (!lamMoi && daLuu?.bam === bam) {
        try {
            return { noiDung: JSON.parse(daLuu.ketQua), tuBoNho: true, nhaCungCap: daLuu.nhaCungCap || '', luc: new Date(daLuu.updatedAt).toISOString() }
        } catch { /* bản lưu hỏng ⇒ soát lại */ }
    }
    const key = await layKeyAi(prisma)
    if (!key.gemini && !key.deepseek) throw new LoiAiSoat('Chưa có key AI — vào Hệ Thống → Cài Đặt, tab Trợ lý AI nhập key Gemini (miễn phí ở aistudio.google.com/apikey).', false, true)
    const deBai = [
        `Tên sản phẩm: ${sp.ten}`, `Mã (SKU): ${sp.sku || '—'}`,
        sp.thuongHieu ? `Hãng: ${sp.thuongHieu}` : '', sp.nhom ? `Nhóm hàng: ${sp.nhom}` : '',
        sp.tenTrenSan ? `Tên trên Shopee: ${sp.tenTrenSan}` : '',
        'MÔ TẢ GỐC (shop viết):', '"""', moTa, '"""',
    ].filter(Boolean).join('\n')
    let kq: { text: string; model: string } | null = null
    let loiGemini: any = null
    if (key.gemini) { try { kq = await goiGemini(key.gemini, deBai) } catch (e) { loiGemini = e } }
    if (!kq && key.deepseek) kq = await goiDeepSeekSoat(key.deepseek, deBai)
    if (!kq) throw loiGemini || new LoiAiSoat('AI không soát được', true)
    const noiDung = locKetQua(docJsonAi(kq.text), sp.ten, moTa)
    const luc = new Date()
    try {
        await prisma.sanMediaNoiDung.upsert({
            where: { productId: sp.id },
            create: { productId: sp.id, bam, ketQua: JSON.stringify(noiDung), nhaCungCap: kq.model },
            update: { bam, ketQua: JSON.stringify(noiDung), nhaCungCap: kq.model },
        })
    } catch { /* bảng chưa migrate — vẫn trả kết quả */ }
    return { noiDung, tuBoNho: false, nhaCungCap: kq.model, luc: luc.toISOString() }
}
