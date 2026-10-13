/**
 * NHÓM ZALO ↔ KHÁCH HÀNG — 13/10/2026
 *
 * HUTI bán sỉ cho đại lý; mỗi đại lý một nhóm Zalo (Zalo CÁ NHÂN của công ty) chung
 * với tài khoản Hưng Tín. n8n đọc tin các nhóm đó; trước đây ghi vào Google Sheet và
 * bị Sheets chặn vì quá 60 lần ghi/phút. Nay n8n gọi thẳng /api/zalo (routes/zalo.ts).
 *
 * File nguồn kh.xlsx (chủ shop gửi 13/10): CODE | TÊN NHÓM | GROUP ID — CODE là mã khách
 * bên KiotViet cũ, nay là Customer.code của HUTI. Đo file: 150 dòng, 142 mã, 8 mã có
 * HAI nhóm, groupId đều là CHUỖI 18–19 chữ số (vượt Number.MAX_SAFE_INTEGER — đọc thành
 * số là mất chữ số cuối, nên mọi chỗ đều giữ dạng chuỗi), có mã viết thường ("hn17").
 *
 * Luật nhập (skill data-sync-gate):
 *   - Mặc định CHẠY THỬ; `apply` mới ghi.
 *   - Mã không có trên Kengi: vẫn lưu nhóm với customerId = null và BÁO LẠI — không tự
 *     tạo khách (khách thật phải do người tạo, kèm thông tin xuất hoá đơn).
 *   - Nhóm đã nối khách KHÁC: không đổi, trừ khi bật `ghiDe` — nối nhầm nhóm là gửi
 *     hoá đơn của khách này vào nhóm khách kia.
 */

export interface DongNhomZalo {
    maKhach: string
    tenNhom?: string | null
    groupId: string
}

export interface KetQuaNhapNhom {
    apply: boolean
    tongDong: number
    soNhom: number
    khopKhach: number
    taoMoi: number
    capNhat: number
    giuNguyen: number
    chuaCoKhach: Array<{ maKhach: string; tenNhom: string | null; groupId: string }>
    xungDot: Array<{ groupId: string; tenNhom: string | null; lyDo: string }>
    loi: Array<{ dong: number; lyDo: string }>
}

const chuanMa = (s: any) => String(s ?? '').trim()
/** groupId Zalo: chỉ chữ số. Nhận cả số Excel đã lỡ thành dạng 1.23E+18 thì TỪ CHỐI, không đoán. */
const laGroupId = (s: string) => /^\d{6,25}$/.test(s)

/** Tìm khách theo mã, không phân biệt hoa thường. Trả Map MÃ-IN-HOA → danh sách khách. */
export async function timKhachTheoMa(sp: any, ma: string[]): Promise<Map<string, Array<{ id: string; code: string; name: string }>>> {
    const kq = new Map<string, Array<{ id: string; code: string; name: string }>>()
    const hoa = [...new Set(ma.map(m => m.toUpperCase()).filter(Boolean))]
    for (let i = 0; i < hoa.length; i += 500) {
        const rows: any[] = await sp.$queryRawUnsafe(
            `SELECT "id", "code", "name" FROM "Customer" WHERE UPPER("code") = ANY($1::text[])`,
            hoa.slice(i, i + 500),
        )
        for (const r of rows) {
            const k = String(r.code).toUpperCase()
            kq.set(k, [...(kq.get(k) || []), { id: r.id, code: r.code, name: r.name }])
        }
    }
    return kq
}

export async function nhapNhomZalo(
    sp: any, dong: DongNhomZalo[], opts: { apply: boolean; ghiDe?: boolean },
): Promise<KetQuaNhapNhom> {
    const kq: KetQuaNhapNhom = {
        apply: opts.apply, tongDong: dong.length, soNhom: 0, khopKhach: 0,
        taoMoi: 0, capNhat: 0, giuNguyen: 0, chuaCoKhach: [], xungDot: [], loi: [],
    }

    // 1. Làm sạch + gộp theo groupId (một nhóm chỉ thuộc MỘT khách)
    const theoNhom = new Map<string, { maKhach: string; tenNhom: string | null }>()
    dong.forEach((d, i) => {
        const ma = chuanMa(d.maKhach)
        const gid = chuanMa(d.groupId)
        const ten = chuanMa(d.tenNhom) || null
        if (!ma && !gid) return
        if (!gid || !laGroupId(gid)) { kq.loi.push({ dong: i + 2, lyDo: `GROUP ID "${gid}" không phải dãy số (Excel làm tròn thành 1.2E+18?)` }); return }
        if (!ma) { kq.loi.push({ dong: i + 2, lyDo: `nhóm ${gid} thiếu mã khách` }); return }
        const cu = theoNhom.get(gid)
        if (cu && cu.maKhach.toUpperCase() !== ma.toUpperCase()) {
            kq.xungDot.push({ groupId: gid, tenNhom: ten, lyDo: `cùng nhóm mà file ghi hai mã: ${cu.maKhach} và ${ma}` })
            return
        }
        theoNhom.set(gid, { maKhach: ma, tenNhom: ten || cu?.tenNhom || null })
    })
    kq.soNhom = theoNhom.size

    // 2. Khớp mã khách
    const khach = await timKhachTheoMa(sp, [...theoNhom.values()].map(x => x.maKhach))

    // 3. So với bảng đang có
    const ids = [...theoNhom.keys()]
    const coSan = new Map<string, any>()
    for (let i = 0; i < ids.length; i += 500) {
        const rows = await sp.zaloNhom.findMany({ where: { groupId: { in: ids.slice(i, i + 500) } } })
        for (const r of rows) coSan.set(r.groupId, r)
    }

    for (const [gid, x] of theoNhom) {
        const ds = khach.get(x.maKhach.toUpperCase()) || []
        if (ds.length > 1) {
            kq.xungDot.push({ groupId: gid, tenNhom: x.tenNhom, lyDo: `mã ${x.maKhach} khớp ${ds.length} khách (${ds.map(k => k.code).join(', ')}) — sửa mã trùng trước` })
            continue
        }
        const k = ds[0] || null
        if (k) kq.khopKhach++
        else kq.chuaCoKhach.push({ maKhach: x.maKhach, tenNhom: x.tenNhom, groupId: gid })

        const data = { maKhach: k?.code || x.maKhach, tenNhom: x.tenNhom, customerId: k?.id || null }
        const cu = coSan.get(gid)
        if (!cu) {
            if (opts.apply) await sp.zaloNhom.create({ data: { groupId: gid, ...data } })
            kq.taoMoi++
            continue
        }
        const doiKhach = (cu.customerId || null) !== data.customerId
        if (doiKhach && cu.customerId && !opts.ghiDe) {
            kq.xungDot.push({ groupId: gid, tenNhom: x.tenNhom, lyDo: `nhóm đang nối khách ${cu.maKhach}, file ghi ${x.maKhach} — bật "ghi đè" nếu đúng là đổi khách` })
            continue
        }
        if (!doiKhach && cu.tenNhom === data.tenNhom && cu.maKhach === data.maKhach) { kq.giuNguyen++; continue }
        if (opts.apply) await sp.zaloNhom.update({ where: { id: cu.id }, data })
        kq.capNhat++
    }
    return kq
}

/** Đọc file Excel 3 cột CODE | TÊN NHÓM | GROUP ID — dò cột THEO TÊN, không theo vị trí. */
export function docFileNhomZalo(rows: any[][]): { dong: DongNhomZalo[]; loi: string | null } {
    if (!rows.length) return { dong: [], loi: 'File trống' }
    const dau = rows[0].map(c => String(c ?? '').trim().toUpperCase())
    const cot = (...ten: string[]) => dau.findIndex(c => ten.some(t => c === t || c.replace(/\s+/g, '') === t.replace(/\s+/g, '')))
    const cMa = cot('CODE', 'MÃ', 'MÃ KHÁCH', 'MÃ KH')
    const cTen = cot('TÊN NHÓM', 'TEN NHOM', 'NHÓM')
    const cGid = cot('GROUP ID', 'GROUPID', 'ID NHÓM')
    if (cMa < 0 || cGid < 0) return { dong: [], loi: `Không thấy cột CODE và GROUP ID ở dòng đầu (đọc được: ${dau.join(' | ')})` }
    return {
        dong: rows.slice(1).map(r => ({
            maKhach: String(r[cMa] ?? ''),
            tenNhom: cTen >= 0 ? String(r[cTen] ?? '') : null,
            // Ô SỐ quá 2^53 thì String(n) vẫn ra toàn chữ số nhưng ĐÃ SAI chữ số cuối
            // (286557705360395658 → "286557705360395650") — regex không bắt được, phải chặn ở đây
            groupId: typeof r[cGid] === 'number'
                ? (Number.isSafeInteger(r[cGid]) ? String(r[cGid]) : `ô số đã mất chữ số (${r[cGid]}) — định dạng cột GROUP ID là Text rồi dán lại`)
                : String(r[cGid] ?? ''),
        })),
        loi: null,
    }
}
