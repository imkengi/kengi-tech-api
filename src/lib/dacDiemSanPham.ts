/* ═══════════════════════════════════════════════════════════════════════════════
 *  ĐẶC ĐIỂM SẢN PHẨM — AI RÚT TỪ MÔ TẢ (14/11/2026)
 *
 *  Chủ shop: "trong phần thông tin sản phẩm, AI sẽ từ mô tả sản phẩm mà tự rút ra những đặc điểm của sản phẩm nha,
 *  ví dụ như nồi cơm thì sẽ có bao nhiêu w, lòng nồi bao nhiêu kiểu vậy đó". Trang /dashboard-product-info: lưu mô tả
 *  xong (hoặc mở một mã đã có mô tả mà chưa có đặc điểm) ⇒ AI đọc TÊN + MÔ TẢ, trả bảng đặc điểm {ten, giaTri}
 *  (Công suất | 860 W, Lòng nồi | Hợp kim nhôm phủ chống dính…); nhân viên sửa / duyệt ngay dưới ô mô tả.
 *
 *  KHÔNG TIN MÙ AI (cùng tinh thần lib/aiSoatNoiDung.ts) — lọc lại sau khi nhận:
 *   - mọi CON SỐ trong tên + giá trị phải có trong tên / mô tả (số không có nguồn là số bịa ⇒ bỏ dòng);
 *   - chữ của giá trị (trừ đơn vị, từ nối) phần lớn phải có trong mô tả, so KHÔNG DẤU (mô tả gõ thiếu dấu vẫn khớp)
 *     — "Ceramic Hàn Quốc" khi mô tả chẳng nhắc tới ⇒ bỏ;
 *   - bỏ dòng dẫn ra ngoài sàn (điện thoại, link, Zalo), dòng giá tiền / khuyến mãi / phí ship (không phải đặc điểm);
 *   - ĐOẠN NGUỒN do MÁY CHỦ tự tìm trong mô tả (không lấy lời AI) để người duyệt soát nhanh.
 *  Số dòng bị bỏ / vượt trần được trả về (boLoc, quaTran) — không cắt lặng lẽ.
 *
 *  LƯU bảng RIÊNG DacDiemSanPham (một dòng mỗi mã), KHÔNG thêm cột vào Product: thêm cột vào Product là mọi câu đọc
 *  Product không select ở cửa hàng chưa migrate gãy P2022. Bảng chưa migrate ⇒ đọc ra "chưa sẵn sàng", ghi báo lỗi rõ.
 *  nguon 'ai' = AI rút, chưa ai duyệt; 'nguoi' = người đã lưu (sửa / bấm duyệt). Bản người duyệt KHÔNG bị AI ghi đè nếu
 *  người không xác nhận (ghiDe) — kể cả khi người lưu đúng lúc AI đang chạy (ghi AI là so-và-ghi theo updatedAt).
 *  bamMoTa = băm mô tả lúc rút / duyệt ⇒ khác băm mô tả hiện tại nghĩa là mô tả đã đổi sau đó (khopMoTa = false).
 * ═══════════════════════════════════════════════════════════════════════════════ */
import crypto from 'crypto'
import { layKeyAi } from './keyAi'
import { goiGemini, goiDeepSeekSoat, docJsonAi, NGOAI_SAN, LoiAiSoat } from './aiSoatNoiDung'

export type DongDacDiem = { ten: string; giaTri: string; trich: string }
export type DacDiemSp = {
    ds: DongDacDiem[]
    /** 'ai' = AI rút, chưa ai duyệt; 'nguoi' = người đã lưu */
    nguon: 'ai' | 'nguoi'
    /** đặc điểm được rút / duyệt theo ĐÚNG mô tả đang lưu */
    khopMoTa: boolean
    canhBao: string[]
    /** dòng AI đưa ra bị bỏ (không thấy trong mô tả, dẫn ra ngoài sàn, giá tiền, trùng) */
    boLoc: number
    /** dòng hợp lệ nhưng vượt trần TOI_DA_DONG */
    quaTran: number
    /** bản lưu đọc không ra (JSON hỏng) — KHÔNG coi như "không có đặc điểm" */
    docHong: boolean
    model: string | null
    luc: string
}
/** Kết quả đọc cho trang: bảng chưa migrate ⇒ sanSang false (khác hẳn "chưa có đặc điểm") */
export type DacDiemTrang = { sanSang: boolean; dacDiem: DacDiemSp | null }

export const TOI_DA_DONG = 30
export const TOI_DA_TEN = 60
export const TOI_DA_GIA_TRI = 300
/** AI chỉ đọc chừng này ký tự mô tả (mô tả lưu qua trang ≤ 10.000; đường khác có thể dài hơn ⇒ nói rõ khi cắt) */
export const TOI_DA_KY_TU_AI_DOC = 12000
const PHIEN_BAN = 1

export class LoiDacDiem extends Error {
    constructor(public status: number, msg: string, public khongCoKey = false) { super(msg) }
}

// ─── Chuẩn hoá chữ / số ─────────────────────────────────────────────────────────
export const chuanMoTa = (s: unknown) => String(s ?? '').replace(/\r\n?/g, '\n').trim()
export const bamMoTa = (s: unknown) => crypto.createHash('sha256').update(chuanMoTa(s)).digest('hex').slice(0, 32)
const sach = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
/** chữ thường, bỏ HẾT dấu (đ→d) — chỉ dùng khi một bên gõ không dấu, hoặc để chọn đoạn nguồn */
export const khongDau = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
/** chữ thường, bỏ DẤU THANH, GIỮ dấu mũ / móc / đ: "đỏ" ≠ "độ" (bỏ hết dấu thì trùng), "hoà" ≡ "hòa" (hai kiểu đặt dấu) */
export const khongThanh = (s: string) => String(s || '').normalize('NFD').replace(/[̣̀́̃̉]/g, '').normalize('NFC').toLowerCase()
const tuGoc = (s: string): string[] => String(s || '').normalize('NFC').toLowerCase().match(/\p{L}+/gu) || []
const tuCua = (s: string): string[] => khongDau(s).match(/\p{L}+/gu) || []
/** khoá so trùng tên đặc điểm: "Công suất:" ≡ "công SUẤT" ≡ "Công suất" — nhưng "Màu" ≠ "Mẫu" */
export const khoaTen = (s: string) => (khongThanh(s).match(/[\p{L}\p{N}]+/gu) || []).join(' ')

/** Số trong chuỗi ở dạng chuẩn: dấu nghìn bỏ ("2.000mAh" ≡ "2000 mAh"), phẩy thập phân ⇒ chấm, bỏ số 0 đuôi ("3.0" ≡ "3").
 *  KHÁC lib/aiSoatNoiDung.soTrong ở chỗ dấu nghìn đứng sát chữ ("2.000mAh") — bên đó dùng \b nên không bỏ. */
export function soCua(s: string): string[] {
    return (String(s).match(/\d+(?:[.,]\d+)*/g) || []).map(x => {
        let n = x.replace(/[.,](?=\d{3}(?!\d))/g, '').replace(',', '.')
        if (n.includes('.')) n = n.replace(/0+$/, '').replace(/\.$/, '')
        return n.replace(/^0+(?=\d)/, '')
    })
}

/** Đơn vị + từ nối: không tính khi đo "chữ của giá trị có trong mô tả không" ("1,8 lít" khi mô tả ghi "1.8L" vẫn khớp).
 *  Viết CÓ DẤU, so theo khongThanh — bỏ hết dấu thì "độ" (bỏ qua) nuốt luôn "đỏ" (màu), "tủ" thành "từ"… */
const BO_QUA_KHI_SO_CHU = new Set([
    'lít', 'ml', 'kg', 'gram', 'gam', 'gr', 'mg', 'cm', 'mm', 'mét', 'km', 'inch', 'kw', 'hz', 'mah', 'wh', 'ah', 'kwh', 'btu',
    'hp', 'rpm', 'db', 'lm', 'gb', 'tb', 'mb', 'mp', 'fps', 'bar', 'psi', 'pcs', 'size',
    'giờ', 'phút', 'giây', 'ngày', 'tuần', 'tháng', 'năm', 'lớp', 'người', 'cái', 'chiếc', 'bộ', 'vòng', 'độ', 'mức', 'chế', 'cấp',
    'tối', 'tới', 'đa', 'lên', 'đến', 'khoảng', 'từ', 'và', 'hoặc', 'có', 'thể', 'được', 'cho', 'với', 'là', 'của', 'gồm', 'loại',
    'các', 'một', 'hai', 'ba', 'bốn', 'sáu', 'như', 'trên', 'dưới', 'trong', 'mỗi', 'từng', 'theo', 'kèm', 'hơn', 'nhất',
].map(khongThanh))
const tuNoiDung = (s: string) => tuGoc(s).filter(t => t.length >= 2 && !BO_QUA_KHI_SO_CHU.has(khongThanh(t)))

/** Chữ của mô tả, ba dạng — để so một chữ của giá trị có "nằm trong mô tả" không */
type NguonChu = { khongThanh: Set<string>; khongDau: Set<string>; goKhongDau: Set<string> }
function nguonChu(s: string): NguonChu {
    const tu = tuGoc(s)
    return { khongThanh: new Set(tu.map(khongThanh)), khongDau: new Set(tu.map(khongDau)), goKhongDau: new Set(tu.filter(t => khongDau(t) === t)) }
}
/** Chữ gõ KHÔNG dấu ⇒ so không dấu. Chữ có dấu ⇒ so bỏ dấu thanh (giữ mũ / móc / đ), hoặc trùng một chữ mô tả gõ không dấu. */
function coTrongNguon(t: string, n: NguonChu): boolean {
    const p = khongDau(t)
    if (p === t) return n.khongDau.has(t)
    return n.khongThanh.has(khongThanh(t)) || n.goKhongDau.has(p)
}

/** Tên KHÔNG phải đặc điểm sản phẩm (so không dấu, nguyên tên) */
const TEN_KHONG_PHAI_DAC_DIEM = /^(gia( ban| goc| niem yet| khuyen mai| si| le| uu dai)?|khuyen mai|uu dai|qua tang|tang kem|phi( ship| van chuyen| giao hang)?|van chuyen|giao hang|freeship|mien phi van chuyen|doi tra|chinh sach.*|lien he|hotline|cam ket|thanh toan|ma giam gia|voucher)$/
/** Giá trị là GIÁ TIỀN ("1.290.000đ", "990 đồng") — "3 đầu" / "lõi đồng" không dính vì sau đ là chữ hoặc trước không có số */
const GIA_TIEN = /\d[\d.,]*\s*(?:đ|₫|vnđ|vnd|đồng)(?!\p{L})/iu

/** Đoạn mô tả làm NGUỒN cho một dòng (máy chủ tự tìm, không tin AI): đoạn chứa số của giá trị (bắt buộc nếu giá trị có số),
 *  nhiều chữ trùng nhất. Đoạn = một dòng, hoặc một câu nếu dòng dài. Không thấy ⇒ '' (giá trị do người gõ thêm). */
export function timTrich(d: { ten: string; giaTri: string }, moTa: string): string {
    const doan = chuanMoTa(moTa).split(/\n+|(?<=[.!?;])\s+(?=\S)/)
        .map(s => s.replace(/^[\s\-–—•*+·>]+/, '').trim()).filter(Boolean)
    const so = soCua(d.giaTri)
    // chọn đoạn chỉ cần "gần đúng" ⇒ so không dấu cho rộng (lọc thật nằm ở locDacDiem)
    const tu = new Set([...tuNoiDung(d.giaTri), ...tuNoiDung(d.ten)].map(khongDau))
    let tot = '', diemTot = 0
    for (const s of doan) {
        const soS = new Set(soCua(s))
        const trungSo = so.filter(n => soS.has(n)).length
        if (so.length && !trungSo) continue
        const tuS = new Set(tuCua(s))
        const diem = trungSo * 10 + [...tu].filter(t => tuS.has(t)).length
        if (diem > diemTot) { diemTot = diem; tot = s }
    }
    // đoạn nguồn chỉ để người duyệt nhận ra chỗ — dài thì rút gọn CÓ dấu "…" (không cắt lặng lẽ)
    return tot.length > 160 ? `${tot.slice(0, 159).trimEnd()}…` : tot
}

/** Lọc kết quả AI. Trả cả số dòng bị bỏ để trang nói rõ (không cắt lặng lẽ). */
export function locDacDiem(raw: any, tenSp: string, moTa: string): { ds: DongDacDiem[]; canhBao: string[]; boLoc: number; quaTran: number } {
    const nguon = `${tenSp}\n${moTa}`
    const soNguon = new Set(soCua(nguon))
    const tuNguon = nguonChu(nguon)
    const daCo = new Set<string>()
    const ds: DongDacDiem[] = []
    let boLoc = 0, quaTran = 0
    for (const x of Array.isArray(raw?.dacDiem) ? raw.dacDiem : []) {
        const ten = sach(x?.ten).replace(/[:：]+$/, '').trim()
        const giaTri = sach(x?.giaTri).replace(/[.;,]+$/, '').trim()
        const khoa = khoaTen(ten)
        // giá trị không số, không chữ nội dung ("Có", "2 lớp" thì có số) ⇒ soát TÊN: "Hẹn giờ: Có" chỉ giữ khi mô tả có nhắc "hẹn"
        const tuGiaTri = tuNoiDung(giaTri)
        const tuKiem = tuGiaTri.length ? tuGiaTri : soCua(giaTri).length ? [] : tuNoiDung(ten)
        const coNguon = tuKiem.length === 0 || tuKiem.filter(t => coTrongNguon(t, tuNguon)).length / tuKiem.length >= 0.6
        const hop = !!ten && !!giaTri && !!khoa
            && ten.length <= TOI_DA_TEN && giaTri.length <= TOI_DA_GIA_TRI
            && !NGOAI_SAN.test(ten) && !NGOAI_SAN.test(giaTri)
            && !TEN_KHONG_PHAI_DAC_DIEM.test(khongDau(ten).replace(/[^a-z0-9]+/g, ' ').trim()) && !GIA_TIEN.test(giaTri)
            && [...soCua(ten), ...soCua(giaTri)].every(n => soNguon.has(n))
            && coNguon
            && !daCo.has(khoa)
        if (!hop) { boLoc++; continue }
        daCo.add(khoa)
        if (ds.length >= TOI_DA_DONG) { quaTran++; continue }
        ds.push({ ten, giaTri, trich: timTrich({ ten, giaTri }, moTa) })
    }
    const canhBao = (Array.isArray(raw?.canhBao) ? raw.canhBao : []).map(sach).filter(Boolean) as string[]
    return { ds, canhBao, boLoc, quaTran }
}

/** Chuẩn hoá danh sách NGƯỜI gửi lên — sai thì nói rõ dòng nào (không âm thầm bỏ / kẹp). Dòng trống hẳn thì bỏ. */
export function chuanHoaDsNguoi(v: unknown): { ten: string; giaTri: string }[] {
    if (!Array.isArray(v)) throw new LoiDacDiem(400, 'Danh sách đặc điểm không hợp lệ')
    const ra: { ten: string; giaTri: string }[] = []
    const daCo = new Map<string, string>()
    v.forEach((x: any, i: number) => {
        if (x === null || typeof x !== 'object') throw new LoiDacDiem(400, `Dòng ${i + 1}: không hợp lệ`)
        if ((x.ten != null && typeof x.ten !== 'string') || (x.giaTri != null && typeof x.giaTri !== 'string')) {
            throw new LoiDacDiem(400, `Dòng ${i + 1}: tên và giá trị phải là chữ`)
        }
        const ten = sach(x.ten).replace(/[:：]+$/, '').trim()
        const giaTri = sach(x.giaTri)
        if (!ten && !giaTri) return
        if (!ten) throw new LoiDacDiem(400, `Dòng ${i + 1}: thiếu tên đặc điểm (giá trị "${giaTri.slice(0, 40)}")`)
        if (!giaTri) throw new LoiDacDiem(400, `Dòng ${i + 1} (${ten}): thiếu giá trị`)
        if (ten.length > TOI_DA_TEN) throw new LoiDacDiem(400, `Dòng ${i + 1}: tên dài ${ten.length} ký tự — tối đa ${TOI_DA_TEN}`)
        if (giaTri.length > TOI_DA_GIA_TRI) throw new LoiDacDiem(400, `Dòng ${i + 1} (${ten}): giá trị dài ${giaTri.length} ký tự — tối đa ${TOI_DA_GIA_TRI}`)
        const khoa = khoaTen(ten)
        if (!khoa) throw new LoiDacDiem(400, `Dòng ${i + 1}: tên đặc điểm phải có chữ hoặc số`)
        if (daCo.has(khoa)) throw new LoiDacDiem(400, `Trùng tên đặc điểm: "${daCo.get(khoa)}" và "${ten}" — gộp lại một dòng`)
        daCo.set(khoa, ten)
        ra.push({ ten, giaTri })
    })
    if (ra.length > TOI_DA_DONG) throw new LoiDacDiem(400, `Tối đa ${TOI_DA_DONG} đặc điểm — đang có ${ra.length}`)
    return ra
}

// ─── Đọc / ghi bảng DacDiemSanPham ──────────────────────────────────────────────
/** Bảng chưa migrate ở cửa hàng này (P2021) — CHỈ lỗi này mới coi là "chưa sẵn sàng"; lỗi khác ném tiếp */
const bangChuaCo = (e: any) => e?.code === 'P2021' || /DacDiemSanPham.*does not exist|relation "DacDiemSanPham" does not exist/i.test(String(e?.message || ''))

function docRa(r: any, moTaHienTai: unknown): DacDiemSp {
    let j: any = null
    try { j = JSON.parse(String(r.dacDiem || '')) } catch { j = null }
    const docHong = !j || !Array.isArray(j.ds)
    const ds: DongDacDiem[] = docHong ? [] : j.ds
        .filter((x: any) => x && typeof x.ten === 'string' && typeof x.giaTri === 'string')
        .map((x: any) => ({ ten: x.ten, giaTri: x.giaTri, trich: typeof x.trich === 'string' ? x.trich : '' }))
    return {
        ds,
        nguon: r.nguon === 'nguoi' ? 'nguoi' : 'ai',
        khopMoTa: r.bamMoTa === bamMoTa(moTaHienTai),
        canhBao: Array.isArray(j?.canhBao) ? j.canhBao.filter((x: any) => typeof x === 'string') : [],
        boLoc: Number(j?.boLoc) || 0,
        quaTran: Number(j?.quaTran) || 0,
        docHong,
        model: r.model || null,
        luc: new Date(r.updatedAt).toISOString(),
    }
}

const goiJson = (o: { ds: DongDacDiem[]; canhBao: string[]; boLoc: number; quaTran: number }) => JSON.stringify({ v: PHIEN_BAN, ...o })

export async function docDacDiem(prisma: any, productId: string, moTaHienTai: unknown): Promise<DacDiemTrang> {
    try {
        const r = await prisma.dacDiemSanPham.findUnique({ where: { productId } })
        return { sanSang: true, dacDiem: r ? docRa(r, moTaHienTai) : null }
    } catch (e) {
        if (bangChuaCo(e)) return { sanSang: false, dacDiem: null }
        throw e
    }
}

/** Đọc dòng thô (để so-và-ghi). Bảng chưa có ⇒ lỗi rõ cho người bấm. */
async function docDong(prisma: any, productId: string): Promise<any | null> {
    try {
        return await prisma.dacDiemSanPham.findUnique({ where: { productId } })
    } catch (e) {
        if (bangChuaCo(e)) throw new LoiDacDiem(503, 'Cửa hàng này chưa có bảng đặc điểm sản phẩm — báo quản trị chạy cập nhật cơ sở dữ liệu (migrate) rồi thử lại')
        throw e
    }
}

/** Lưu bản NGƯỜI sửa / duyệt — người là thẩm quyền: ghi đè mọi bản trước (kể cả bản AI vừa rút). */
export async function luuDacDiemNguoi(prisma: any, sp: { id: string; moTa: unknown }, dsVao: unknown, nguoiSua?: string | null): Promise<DacDiemSp> {
    const ds = chuanHoaDsNguoi(dsVao).map(d => ({ ...d, trich: timTrich(d, chuanMoTa(sp.moTa)) }))
    await docDong(prisma, sp.id)   // bảng chưa có ⇒ báo rõ trước khi ghi
    const du = { dacDiem: goiJson({ ds, canhBao: [], boLoc: 0, quaTran: 0 }), bamMoTa: bamMoTa(sp.moTa), nguon: 'nguoi', model: null, nguoiSua: nguoiSua || null }
    const r = await prisma.dacDiemSanPham.upsert({ where: { productId: sp.id }, create: { productId: sp.id, ...du }, update: du })
    return docRa(r, sp.moTa)
}

export type SanPhamRut = { id: string; ten: string; moTa: unknown; thuongHieu?: string | null; nhom?: string | null }
export type GoiAi = (deBai: string, huongDan: string) => Promise<{ text: string; model: string }>

const HUONG_DAN = `Bạn là nhân viên nhập liệu sản phẩm của một cửa hàng điện máy, gia dụng, dụng cụ, đồ dùng ở Việt Nam.
Nhiệm vụ: đọc TÊN và MÔ TẢ do shop viết, lập BẢNG ĐẶC ĐIỂM của sản phẩm (thông số kỹ thuật + đặc tính cụ thể) như mục "Thông số" trên trang bán hàng.
Ví dụ một nồi cơm điện: Công suất | 860 W ; Dung tích | 1,8 lít ; Lòng nồi | Hợp kim nhôm phủ chống dính 5 lớp ; Chế độ nấu | Nấu cơm, nấu cháo, hấp ; Điện áp | 220 V.

LUẬT BẮT BUỘC:
1. CHỈ lấy điều CÓ TRONG tên + mô tả. KHÔNG thêm từ hiểu biết riêng về hãng / model, KHÔNG suy đoán. Mô tả không nói thì KHÔNG có dòng đó.
2. Mỗi dòng MỘT đặc điểm: "ten" = tên đặc điểm ngắn (≤ 40 ký tự, viết hoa chữ đầu — ví dụ Công suất, Dung tích, Điện áp, Kích thước, Trọng lượng, Chất liệu, Lòng nồi, Chế độ nấu, Pin, Thời gian sạc, Phụ kiện kèm theo, Xuất xứ, Bảo hành); "giaTri" = giá trị cụ thể (≤ 120 ký tự).
3. GIỮ NGUYÊN con số và đơn vị như mô tả: không đổi đơn vị (1,8 lít không thành 1800 ml), không làm tròn, không tự cộng trừ nhân chia.
4. Sản phẩm có nhiều phân loại (dung tích, màu, size) ⇒ gộp MỘT dòng, ví dụ "Dung tích": "1,2 lít / 1,8 lít".
5. KHÔNG lấy: giá, khuyến mãi, quà tặng, phí ship, chính sách đổi trả, số điện thoại, link, Zalo, lời mời mua, câu quảng cáo chung chung ("chất lượng cao", "thiết kế sang trọng") không nêu đặc điểm cụ thể.
6. Thứ tự: thông số chính của loại hàng trước (công suất, dung tích, kích thước…), rồi chất liệu, chức năng / tính năng, phụ kiện kèm theo, xuất xứ, bảo hành. Tối đa 20 dòng, không lặp ý.
7. Mô tả có số liệu mâu thuẫn (hai mức công suất khác nhau…) hoặc nhắc sản phẩm / mã KHÁC với tên ⇒ ghi ngắn vào "canhBao" (≤ 150 ký tự mỗi câu); đặc điểm mâu thuẫn thì bỏ, không tự chọn.
8. Mô tả không phải mô tả sản phẩm (toàn chính sách giao hàng…) ⇒ "dacDiem" rỗng và nói lý do trong "canhBao".
9. Tiếng Việt có dấu, đúng chính tả.
Chỉ trả về MỘT đối tượng JSON đúng khuôn, không giải thích:
{"dacDiem":[{"ten":"","giaTri":""}],"canhBao":[]}`

/** Gọi AI theo key cửa hàng: Gemini trước, hết hạn mức / lỗi thì DeepSeek (nếu có key) — như soát nội dung video */
async function goiAiCuaHang(prisma: any): Promise<GoiAi> {
    const key = await layKeyAi(prisma)
    if (!key.gemini && !key.deepseek) {
        throw new LoiDacDiem(400, 'Cửa hàng chưa có key AI — admin vào Hệ Thống → Cài Đặt, tab Trợ lý AI nhập key Gemini (lấy miễn phí ở aistudio.google.com/apikey)', true)
    }
    return async (deBai, huongDan) => {
        let loiGemini: any = null
        if (key.gemini) { try { return await goiGemini(key.gemini, deBai, huongDan) } catch (e) { loiGemini = e } }
        if (key.deepseek) return goiDeepSeekSoat(key.deepseek, deBai, huongDan)
        throw loiGemini || new LoiAiSoat('AI không trả lời', true)
    }
}

/**
 * AI rút đặc điểm từ mô tả ĐANG LƯU của một mã rồi lưu (nguon 'ai').
 *  - mô tả rỗng ⇒ 400; bản người đã duyệt mà không ghiDe ⇒ 409 (không đè việc của người);
 *  - bản AI đã rút đúng mô tả này và không lamMoi ⇒ trả lại bản đó, KHÔNG gọi AI (mở lại trang / hai tab cùng mở không tốn lượt);
 *  - ghi là so-và-ghi theo updatedAt: trong lúc AI chạy mà người vừa lưu ⇒ giữ bản người, không ghi đè;
 *  - ghiDe lên bản người mà AI không còn dòng nào ⇒ GIỮ bản người (`aiRong`) — đổi việc người đã duyệt lấy bản rỗng là mất trắng.
 * `goiAi` chỉ để bộ kiểm thay AI thật.
 */
export type KetQuaRutAi = DacDiemSp & {
    /** không ghi gì mới: bản AI cũ còn đúng mô tả, hoặc bản hiện có vừa bị người khác đổi */
    tuBoNho: boolean
    /** bản đang trả là bản NGƯỜI duyệt (vừa có người lưu trong lúc AI chạy, hoặc `aiRong`) */
    giuBanNguoi: boolean
    /** "AI rút lại" lên bản người duyệt mà AI không ra dòng nào ⇒ giữ bản người */
    aiRong: boolean
}
export async function rutDacDiemBangAi(
    prisma: any, sp: SanPhamRut,
    o: { ghiDe?: boolean; lamMoi?: boolean; nguoiSua?: string | null; goiAi?: GoiAi } = {},
): Promise<KetQuaRutAi> {
    const moTa = chuanMoTa(sp.moTa)
    if (!moTa) throw new LoiDacDiem(400, 'Chưa có mô tả — viết mô tả và lưu trước, AI mới có chỗ để rút đặc điểm')
    const bam = bamMoTa(moTa)
    const cu = await docDong(prisma, sp.id)
    if (cu?.nguon === 'nguoi' && !o.ghiDe) {
        throw new LoiDacDiem(409, 'Đặc điểm của mã này đã có người duyệt — xác nhận "AI rút lại" thì AI mới thay bản đó')
    }
    if (cu && cu.nguon !== 'nguoi' && cu.bamMoTa === bam && !o.lamMoi) {
        const daCo = docRa(cu, moTa)
        if (!daCo.docHong) return { ...daCo, tuBoNho: true, giuBanNguoi: false, aiRong: false }
    }

    const goi = o.goiAi || await goiAiCuaHang(prisma)
    const catMoTa = moTa.length > TOI_DA_KY_TU_AI_DOC
    const deBai = [
        `Tên sản phẩm: ${sp.ten}`,
        sp.thuongHieu ? `Hãng: ${sp.thuongHieu}` : '',
        sp.nhom ? `Nhóm hàng: ${sp.nhom}` : '',
        'MÔ TẢ (shop viết):', '"""', catMoTa ? moTa.slice(0, TOI_DA_KY_TU_AI_DOC) : moTa, '"""',
    ].filter(Boolean).join('\n')
    const kq = await goi(deBai, HUONG_DAN)
    const loc = locDacDiem(docJsonAi(kq.text), sp.ten, moTa)
    if (catMoTa) loc.canhBao.unshift(`Mô tả dài ${moTa.length.toLocaleString('vi-VN')} ký tự — AI chỉ đọc ${TOI_DA_KY_TU_AI_DOC.toLocaleString('vi-VN')} ký tự đầu, đặc điểm ở phần sau có thể thiếu`)
    // thử máy chủ giả 14/11: "AI rút lại" lên 3 dòng người đã duyệt, AI không ra dòng nào ⇒ trước đây thay bằng bản RỖNG
    if (cu?.nguon === 'nguoi' && loc.ds.length === 0) {
        const banNguoi = docRa(cu, moTa)
        if (!banNguoi.docHong && banNguoi.ds.length > 0) return { ...banNguoi, tuBoNho: true, giuBanNguoi: true, aiRong: true }
    }

    const du = { dacDiem: goiJson(loc), bamMoTa: bam, nguon: 'ai', model: kq.model || null, nguoiSua: o.nguoiSua || null }
    if (cu) {
        // so-và-ghi: chỉ ghi nếu dòng vẫn là dòng đã đọc lúc đầu
        const n = await prisma.dacDiemSanPham.updateMany({ where: { productId: sp.id, updatedAt: cu.updatedAt }, data: { ...du, updatedAt: new Date() } })
        if (!n?.count) return giuBanHienTai(prisma, sp.id, moTa)
    } else {
        try {
            await prisma.dacDiemSanPham.create({ data: { productId: sp.id, ...du } })
        } catch (e: any) {
            if (e?.code !== 'P2002') throw e
            return giuBanHienTai(prisma, sp.id, moTa)   // tab khác / người vừa tạo trước — không đè
        }
    }
    const r = await prisma.dacDiemSanPham.findUnique({ where: { productId: sp.id } })
    return { ...docRa(r, moTa), tuBoNho: false, giuBanNguoi: false, aiRong: false }
}

async function giuBanHienTai(prisma: any, productId: string, moTa: string): Promise<KetQuaRutAi> {
    const r = await prisma.dacDiemSanPham.findUnique({ where: { productId } })
    if (!r) throw new LoiDacDiem(409, 'Đặc điểm vừa bị thay đổi ở nơi khác — tải lại trang rồi thử lại')
    return { ...docRa(r, moTa), tuBoNho: true, giuBanNguoi: r.nguon === 'nguoi', aiRong: false }
}

export type TomTatDacDiem = { so: number; nguon: 'ai' | 'nguoi'; khopMoTa: boolean; docHong: boolean }

/** Bản gọn cho DANH SÁCH (một trang ≤ 100 mã): số dòng + nguồn + còn khớp mô tả không — trang gắn nhãn, nút rút hàng loạt */
export async function docDacDiemNhieuMa(prisma: any, sps: { id: string; moTa: unknown }[]): Promise<{ sanSang: boolean; theoMa: Map<string, TomTatDacDiem> }> {
    const theoMa = new Map<string, TomTatDacDiem>()
    if (!sps.length) return { sanSang: true, theoMa }
    let rows: any[]
    try {
        rows = await prisma.dacDiemSanPham.findMany({ where: { productId: { in: sps.map(s => s.id) } } })
    } catch (e) {
        if (bangChuaCo(e)) return { sanSang: false, theoMa }
        throw e
    }
    const moTa = new Map(sps.map(s => [s.id, s.moTa]))
    for (const r of rows) {
        const d = docRa(r, moTa.get(r.productId))
        theoMa.set(r.productId, { so: d.ds.length, nguon: d.nguon, khopMoTa: d.khopMoTa, docHong: d.docHong })
    }
    return { sanSang: true, theoMa }
}
