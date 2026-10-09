// ─────────────────────────────────────────────────────────────────────────────
//  TRA MÃ SỐ THUẾ → tên + địa chỉ doanh nghiệp (09/10/2026, ô nhập MST ở hồ sơ khách)
//
//  Nguồn: VietQR `GET https://api.vietqr.io/v2/business/{mst}` — không cần khoá. Đo
//  09/10/2026: ~1s; trả {code:"00", data:{id,name,internationalName,shortName,address,
//  status}}, metadata.disclaimer "Dữ liệu tổng hợp từ Trang thông tin điện tử của Cục
//  Thuế 7 ngày trước"; MST không có → {code:"51"}. Địa chỉ đã theo đơn vị hành chính
//  MỚI ("Phường Cầu Giấy, TP Hà Nội"). Không cào trang Cục Thuế (có captcha).
//
//  Lỗi nguồn ≠ "không có MST": chỉ code "51" mới là không tồn tại; còn lại báo lỗi
//  nguyên văn để người dùng biết là tra hỏng chứ không phải MST sai.
// ─────────────────────────────────────────────────────────────────────────────

import { mstHopLe } from './hoaDonKhach'

export interface KetQuaTraMst {
    mst: string
    ten: string
    tenQuocTe: string | null
    tenVietTat: string | null
    diaChi: string
    /** "NNT đang hoạt động" / "NNT ngừng hoạt động…" — null nếu nguồn không nói */
    tinhTrang: string | null
    nguon: string
    /** dữ liệu nguồn cập nhật lúc nào */
    capNhat: string | null
}

export class LoiTraMst extends Error {
    constructor(message: string, public ma: 'khong_hop_le' | 'khong_co' | 'loi_nguon') { super(message) }
}

const NGUON = 'VietQR — tổng hợp từ trang Cục Thuế'
const BO_NHO = new Map<string, { at: number; kq: KetQuaTraMst }>()
const SONG_MS = 24 * 3600_000

export async function traMst(vao: string): Promise<KetQuaTraMst> {
    const mst = String(vao || '').trim().replace(/\s+/g, '')
    if (!mstHopLe(mst)) throw new LoiTraMst('MST phải là 10 số, 10 số-3 số (chi nhánh), 12 hoặc 13 số', 'khong_hop_le')

    const c = BO_NHO.get(mst)
    if (c && Date.now() - c.at < SONG_MS) return c.kq

    let r: Response
    try {
        r = await fetch(`https://api.vietqr.io/v2/business/${encodeURIComponent(mst)}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
        })
    } catch (e: any) {
        throw new LoiTraMst(`Không gọi được nguồn tra MST (${e?.name === 'TimeoutError' ? 'quá 8 giây' : e?.message || e})`, 'loi_nguon')
    }
    let j: any = null
    try { j = await r.json() } catch { /* để nhánh dưới báo */ }
    if (!r.ok || !j) throw new LoiTraMst(`Nguồn tra MST trả HTTP ${r.status}`, 'loi_nguon')
    if (j.code === '51') throw new LoiTraMst(`Không tìm thấy MST ${mst} trong dữ liệu Cục Thuế`, 'khong_co')
    if (j.code !== '00' || !j.data?.name) throw new LoiTraMst(`Nguồn tra MST báo: ${j.desc || j.code || 'không rõ'}`, 'loi_nguon')

    const d = j.data
    const kq: KetQuaTraMst = {
        mst,
        ten: String(d.name || '').trim(),
        tenQuocTe: d.internationalName ? String(d.internationalName).trim() : null,
        tenVietTat: d.shortName ? String(d.shortName).trim() : null,
        diaChi: String(d.address || '').trim(),
        tinhTrang: d.status ? String(d.status).trim() : null,
        nguon: NGUON,
        capNhat: j.metadata?.updatedAt || null,
    }
    BO_NHO.set(mst, { at: Date.now(), kq })
    if (BO_NHO.size > 2000) BO_NHO.delete(BO_NHO.keys().next().value as string)
    return kq
}
