/* Kiểm chứng ĐẶC ĐIỂM SẢN PHẨM AI RÚT TỪ MÔ TẢ (14/11/2026) — npx tsx scripts/check-dac-diem.ts
 *
 * Chủ shop: "trong phần thông tin sản phẩm, AI sẽ từ mô tả sản phẩm mà tự rút ra những đặc điểm của sản phẩm nha, ví dụ
 * như nồi cơm thì sẽ có bao nhiêu w, lòng nồi bao nhiêu kiểu vậy đó". Canh (AI giả, prisma giả — không gọi AI thật):
 *  A. Lọc AI: giữ thông số có trong mô tả (công suất, dung tích, lòng nồi…), BỎ số bịa / chữ bịa / "Có" không nguồn /
 *     điện thoại / giá tiền / trùng; đếm số dòng bỏ (không cắt lặng lẽ); đoạn nguồn do máy chủ tự tìm đúng dòng.
 *  B. Chuẩn hoá số: dấu nghìn sát đơn vị, phẩy thập phân, số 0 đuôi — số nguyên KHÔNG bị cắt 0.
 *  C. Người nhập: sai thì nói rõ dòng nào, trùng tên (khác dấu / hoa thường) bị chặn, dòng trống bỏ, quá trần báo.
 *  D. Luồng lưu: không mô tả ⇒ không gọi AI; mở lại không tốn lượt; bản người duyệt không bị AI đè (kể cả lúc AI đang
 *     chạy); ghiDe mới thay; mô tả đổi ⇒ khopMoTa false; không key ⇒ báo key; bảng chưa migrate ⇒ "chưa sẵn sàng" (lỗi
 *     khác KHÔNG bị nuốt); JSON hỏng không coi là "không có đặc điểm"; mô tả quá dài ⇒ nói rõ AI chỉ đọc phần đầu.
 *  E. Soát nguồn: route đòi quyền SỬA, migrate tạo đúng bảng, cột migrate khớp model, Product KHÔNG thêm cột.
 */
import fs from 'fs'
import path from 'path'
import {
    locDacDiem, timTrich, soCua, chuanHoaDsNguoi, rutDacDiemBangAi, luuDacDiemNguoi, docDacDiem, docDacDiemNhieuMa,
    LoiDacDiem, TOI_DA_DONG, TOI_DA_KY_TU_AI_DOC, bamMoTa, type GoiAi,
} from '../src/lib/dacDiemSanPham'
import { LoiAiSoat } from '../src/lib/aiSoatNoiDung'

let loi = 0, dat = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { if (ok) dat++; else loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet && !ok ? ' — ' + chiTiet : ''}`) }
const nem = async (f: () => any) => { try { await f(); return null } catch (e: any) { return e } }

const TEN_NOI = 'Nồi cơm điện tử Sunhouse Mama 1.8L SHD8955'
const MO_TA_NOI = `Nồi cơm điện tử Sunhouse Mama 1.8L SHD8955
- Công suất: 860W
- Dung tích: 1.8 lít, nấu được cho 4-6 người
- Lòng nồi hợp kim nhôm phủ chống dính Whitford 5 lớp, dày 2mm
- 12 chế độ nấu: nấu cơm, nấu cháo, hấp, làm bánh
- Hẹn giờ nấu tới 24 giờ
- Điện áp 220V - 50Hz
Bảo hành 12 tháng. Liên hệ 0901234567 để được tư vấn. Giá chỉ 1.290.000đ`

/** AI giả: trả đúng lẫn bịa — bộ lọc phải tách được */
const AI_NOI = {
    dacDiem: [
        { ten: 'Công suất', giaTri: '860 W' },
        { ten: 'Dung tích', giaTri: '1,8 lít' },
        { ten: 'Lòng nồi', giaTri: 'Hợp kim nhôm phủ chống dính Whitford 5 lớp' },
        { ten: 'Độ dày lòng nồi', giaTri: '2 mm' },
        { ten: 'Chế độ nấu', giaTri: '12 chế độ: nấu cơm, nấu cháo, hấp, làm bánh' },
        { ten: 'Hẹn giờ', giaTri: 'Tối đa 24 giờ' },
        { ten: 'Điện áp', giaTri: '220 V / 50 Hz' },
        { ten: 'Số người ăn', giaTri: '4–6 người' },
        { ten: 'Bảo hành', giaTri: '12 tháng' },
        { ten: 'Công suất giữ ấm', giaTri: '60 W' },              // số bịa
        { ten: 'Trọng lượng', giaTri: '3,2 kg' },                 // số bịa
        { ten: 'Lớp phủ', giaTri: 'Ceramic Hàn Quốc' },           // chữ bịa
        { ten: 'Giữ ấm', giaTri: 'Có' },                          // "Có" mà mô tả không nhắc giữ ấm
        { ten: 'Liên hệ', giaTri: '0901234567' },                 // ngoài sàn
        { ten: 'Giá', giaTri: '1.290.000đ' },                     // giá — không phải đặc điểm
        { ten: 'Công suất:', giaTri: '860W' },                    // trùng
        { ten: '', giaTri: 'abc' },                               // thiếu tên
        { ten: 'Tiết kiệm điện', giaTri: 'Tiết kiệm 30% điện năng' }, // số bịa
    ],
    canhBao: ['Tên ghi 1.8L — khớp mô tả'],
}
const SO_GIU_NOI = 9, SO_BO_NOI = 9

// ─── prisma giả: bảng DacDiemSanPham + StoreSettings ────────────────────────────
let dongHo = Date.UTC(2026, 10, 14, 3, 0, 0)
const bayGio = () => new Date(++dongHo)   // tăng chặt — so-và-ghi theo updatedAt không vướng trùng mili-giây
function prismaGia(o: { bangChuaCo?: boolean; loiKhac?: boolean; keyGemini?: string | null } = {}) {
    const bang = new Map<string, any>()
    let dem = 0
    const chan = () => {
        if (o.bangChuaCo) throw Object.assign(new Error('The table `branch_x.DacDiemSanPham` does not exist in the current database.'), { code: 'P2021' })
        if (o.loiKhac) throw Object.assign(new Error("Can't reach database server"), { code: 'P1001' })
    }
    const sao = (r: any) => (r ? { ...r } : null)
    return {
        bang,
        storeSettings: { findFirst: async () => ({ geminiApiKey: o.keyGemini ?? null, deepseekApiKey: null }) },
        dacDiemSanPham: {
            findUnique: async ({ where }: any) => { chan(); return sao(bang.get(where.productId)) },
            findMany: async ({ where }: any) => { chan(); return (where.productId.in as string[]).map(id => bang.get(id)).filter(Boolean).map(sao) },
            create: async ({ data }: any) => {
                chan()
                if (bang.has(data.productId)) throw Object.assign(new Error('Unique constraint failed on the fields: (`productId`)'), { code: 'P2002' })
                const t = bayGio()
                const r = { id: `dd${++dem}`, createdAt: t, ...data, updatedAt: t }
                bang.set(data.productId, r)
                return sao(r)
            },
            updateMany: async ({ where, data }: any) => {
                chan()
                const r = bang.get(where.productId)
                if (!r || (where.updatedAt && r.updatedAt.getTime() !== new Date(where.updatedAt).getTime())) return { count: 0 }
                Object.assign(r, data, { updatedAt: bayGio() })
                return { count: 1 }
            },
            upsert: async ({ where, create, update }: any) => {
                chan()
                const r = bang.get(where.productId)
                if (r) { Object.assign(r, update, { updatedAt: bayGio() }); return sao(r) }
                const t = bayGio()
                const moi = { id: `dd${++dem}`, createdAt: t, ...create, updatedAt: t }
                bang.set(where.productId, moi)
                return sao(moi)
            },
        },
    }
}
/** AI giả đếm số lần gọi; `truocKhiTra` chạy GIỮA lúc "AI đang nghĩ" (mô phỏng người lưu cùng lúc) */
function aiGia(tra: any = AI_NOI, truocKhiTra?: () => Promise<void>) {
    const g = { lan: 0, deBai: '' as string, goi: null as unknown as GoiAi }
    g.goi = async (deBai: string) => {
        g.lan++
        g.deBai = deBai
        if (truocKhiTra) await truocKhiTra()
        return { text: typeof tra === 'string' ? tra : JSON.stringify(tra), model: 'gemini-gia' }
    }
    return g
}

async function main() {
    // ─── A. Lọc kết quả AI ──────────────────────────────────────────────────────
    {
        const r = locDacDiem(AI_NOI, TEN_NOI, MO_TA_NOI)
        const theo = (ten: string) => r.ds.find(d => d.ten === ten)
        dung('A1 nồi cơm: giữ Công suất 860 W', theo('Công suất')?.giaTri === '860 W')
        dung('A2 dung tích "1,8 lít" khớp mô tả "1.8 lít" (phẩy ≡ chấm, lít là đơn vị)', theo('Dung tích')?.giaTri === '1,8 lít')
        dung('A3 lòng nồi: chất liệu chữ — mọi chữ có trong mô tả ⇒ giữ', !!theo('Lòng nồi'))
        dung('A4 hẹn giờ "Tối đa 24 giờ" (từ nối + đơn vị không tính) ⇒ giữ', !!theo('Hẹn giờ'))
        dung(`A5 giữ đúng ${SO_GIU_NOI} dòng có nguồn`, r.ds.length === SO_GIU_NOI, r.ds.map(d => d.ten).join(', '))
        dung('A6 BỎ số bịa: "60 W" giữ ấm, "3,2 kg", "30%"', !theo('Công suất giữ ấm') && !theo('Trọng lượng') && !theo('Tiết kiệm điện'))
        dung('A7 BỎ chữ bịa "Ceramic Hàn Quốc"', !theo('Lớp phủ'))
        dung('A8 BỎ "Giữ ấm: Có" — giá trị trống nghĩa thì soát TÊN, mô tả không nhắc giữ ấm', !theo('Giữ ấm'))
        dung('A9 BỎ điện thoại + giá tiền (không phải đặc điểm, dẫn ra ngoài sàn)', !theo('Liên hệ') && !theo('Giá'))
        dung('A10 BỎ trùng ("Công suất:" ≡ "Công suất") — giữ dòng đầu', r.ds.filter(d => /công suất/i.test(d.ten) && !/giữ/.test(d.ten)).length === 1)
        dung(`A11 đếm đúng ${SO_BO_NOI} dòng bị bỏ (không cắt lặng lẽ)`, r.boLoc === SO_BO_NOI && r.quaTran === 0, `boLoc=${r.boLoc} quaTran=${r.quaTran}`)
        dung('A12 cảnh báo của AI được giữ', r.canhBao.length === 1)
        dung('A13 đoạn nguồn "Công suất" đúng dòng mô tả', theo('Công suất')?.trich === 'Công suất: 860W', theo('Công suất')?.trich)
        dung('A14 đoạn nguồn "Dung tích" là dòng dung tích, không phải dòng tên (cũng có 1.8)', /^Dung tích: 1\.8 lít/.test(theo('Dung tích')?.trich || ''), theo('Dung tích')?.trich)
        dung('A15 đoạn nguồn "Bảo hành" tách theo CÂU (dòng cuối nhiều câu)', theo('Bảo hành')?.trich === 'Bảo hành 12 tháng.', theo('Bảo hành')?.trich)
        dung('A16 đặc điểm không có trong mô tả ⇒ đoạn nguồn rỗng', timTrich({ ten: 'Trọng lượng', giaTri: '3,2 kg' }, MO_TA_NOI) === '')

        // mô tả gõ KHÔNG DẤU — AI trả có dấu vẫn khớp (so không dấu)
        const r2 = locDacDiem({ dacDiem: [{ ten: 'Chất liệu', giaTri: 'Thép không gỉ' }, { ten: 'Màu', giaTri: 'Đỏ đô' }] }, 'Bình giữ nhiệt', 'binh giu nhiet thep khong gi, mau xanh')
        dung('A17 mô tả không dấu: "Thép không gỉ" giữ, "Đỏ đô" (không có) bỏ', r2.ds.length === 1 && r2.ds[0].ten === 'Chất liệu' && r2.boLoc === 1, JSON.stringify(r2.ds))
        // mô tả CÓ dấu nhắc "độ bền" — "Màu: Đỏ" không được lọt nhờ trùng "do" khi bỏ hết dấu
        const r2b = locDacDiem({ dacDiem: [{ ten: 'Màu', giaTri: 'Đỏ' }, { ten: 'Độ bền', giaTri: 'Cao, chịu va đập' }] }, 'Hộp nhựa', 'Hộp nhựa màu xanh, độ bền cao, chịu va đập tốt')
        dung('A17b "Đỏ" ≠ "độ" (so bỏ dấu thanh, giữ dấu mũ) ⇒ màu bịa bị bỏ, "độ bền" giữ', r2b.ds.length === 1 && r2b.ds[0].ten === 'Độ bền', JSON.stringify(r2b.ds))
        const r2c = locDacDiem({ dacDiem: [{ ten: 'Chế độ', giaTri: 'Hoà tan nhanh' }] }, 'Bột', 'Bột hòa tan nhanh trong nước')
        dung('A17c "hoà" ≡ "hòa" (hai kiểu đặt dấu) ⇒ giữ', r2c.ds.length === 1)

        // trần: 35 dòng hợp lệ ⇒ giữ 30, báo 5 vượt trần
        const moTa35 = Array.from({ length: 35 }, (_, i) => `Thông số ${i + 1}: ${i + 101} cm`).join('\n')
        const r3 = locDacDiem({ dacDiem: Array.from({ length: 35 }, (_, i) => ({ ten: `Thông số ${i + 1}`, giaTri: `${i + 101} cm` })) }, 'Kệ', moTa35)
        dung(`A18 quá ${TOI_DA_DONG} dòng ⇒ giữ ${TOI_DA_DONG}, quaTran = 5 (nói rõ, không cắt lặng lẽ)`, r3.ds.length === TOI_DA_DONG && r3.quaTran === 5 && r3.boLoc === 0)
        const r4 = locDacDiem({ khac: 1 }, 'X', 'y')
        dung('A19 AI trả khuôn lạ ⇒ rỗng, không ném', r4.ds.length === 0 && r4.boLoc === 0)
        const r5 = locDacDiem({ dacDiem: [{ ten: 'Số đầu', giaTri: '3 đầu' }, { ten: 'Lõi', giaTri: 'Lõi đồng 100%' }] }, 'Máy cắt', 'máy có 3 đầu cắt, lõi đồng 100%')
        dung('A20 "3 đầu", "lõi đồng" KHÔNG bị coi là giá tiền', r5.ds.length === 2, `boLoc=${r5.boLoc}`)
    }

    // ─── B. Chuẩn hoá số ────────────────────────────────────────────────────────
    {
        dung('B1 "2.000mAh" ≡ "2000 mAh" (dấu nghìn sát đơn vị)', soCua('2.000mAh')[0] === '2000' && soCua('2000 mAh')[0] === '2000')
        dung('B2 "1,8" ≡ "1.8"; "3.0" ≡ "3"; "2,50" ≡ "2.5"', soCua('1,8')[0] === '1.8' && soCua('1.8')[0] === '1.8' && soCua('3.0')[0] === '3' && soCua('2,50')[0] === '2.5')
        dung('B3 số nguyên KHÔNG bị cắt 0 ("220", "1.800" ⇒ 1800)', soCua('220V')[0] === '220' && soCua('1.800')[0] === '1800' && soCua('100')[0] === '100')
        dung('B4 "0.5" giữ nguyên', soCua('0.5 lít')[0] === '0.5')
    }

    // ─── C. Người nhập ──────────────────────────────────────────────────────────
    {
        const e1 = await nem(() => chuanHoaDsNguoi('abc'))
        dung('C1 không phải mảng ⇒ 400', e1 instanceof LoiDacDiem && e1.status === 400)
        const e2 = await nem(() => chuanHoaDsNguoi([{ ten: 'A', giaTri: '1' }, { ten: '', giaTri: '5 kg' }]))
        dung('C2 thiếu tên ⇒ nói rõ "Dòng 2"', e2 instanceof LoiDacDiem && /Dòng 2/.test(e2.message), e2?.message)
        const e3 = await nem(() => chuanHoaDsNguoi([{ ten: 'Công suất', giaTri: '860 W' }, { ten: 'công SUẤT:', giaTri: '900 W' }]))
        dung('C3 trùng tên khác hoa thường / dấu ":" ⇒ chặn', e3 instanceof LoiDacDiem && /Trùng/.test(e3.message), e3?.message)
        const e3b = await nem(() => chuanHoaDsNguoi([{ ten: 'Hoà mạng', giaTri: 'Có' }, { ten: 'Hòa mạng', giaTri: 'Không' }]))
        dung('C3b hai kiểu đặt dấu ("hoà" / "hòa") là CÙNG tên ⇒ chặn', e3b instanceof LoiDacDiem && /Trùng/.test(e3b.message), e3b?.message)
        const khac = chuanHoaDsNguoi([{ ten: 'Màu', giaTri: 'Trắng' }, { ten: 'Mẫu', giaTri: '2026' }])
        dung('C3c "Màu" và "Mẫu" KHÔNG phải trùng (bỏ hết dấu mới trùng)', khac.length === 2)
        const ok = chuanHoaDsNguoi([{ ten: '  Công  suất: ', giaTri: ' 860  W ' }, { ten: '', giaTri: '' }, { ten: 'Màu', giaTri: 'Trắng' }])
        dung('C4 dòng trống bỏ, khoảng trắng gọn, bỏ ":" cuối tên', ok.length === 2 && ok[0].ten === 'Công suất' && ok[0].giaTri === '860 W')
        const e4 = await nem(() => chuanHoaDsNguoi(Array.from({ length: TOI_DA_DONG + 1 }, (_, i) => ({ ten: `T${i}`, giaTri: 'x' }))))
        dung(`C5 quá ${TOI_DA_DONG} dòng ⇒ báo (không cắt)`, e4 instanceof LoiDacDiem && /Tối đa/.test(e4.message))
        const e5 = await nem(() => chuanHoaDsNguoi([{ ten: 'A', giaTri: 5 }]))
        dung('C6 giá trị không phải chữ ⇒ 400', e5 instanceof LoiDacDiem && e5.status === 400)
        const e6 = await nem(() => chuanHoaDsNguoi([{ ten: 'A', giaTri: 'x'.repeat(301) }]))
        dung('C7 giá trị quá dài ⇒ báo số ký tự', e6 instanceof LoiDacDiem && /301/.test(e6.message))
        dung('C8 danh sách rỗng hợp lệ (mã không có đặc điểm nào)', chuanHoaDsNguoi([]).length === 0)
    }

    // ─── D. Luồng lưu ───────────────────────────────────────────────────────────
    const sp = { id: 'p1', ten: TEN_NOI, moTa: MO_TA_NOI, thuongHieu: 'Sunhouse', nhom: 'Nồi cơm điện' }
    {
        const db = prismaGia()
        const ai = aiGia()
        const e0 = await nem(() => rutDacDiemBangAi(db, { ...sp, moTa: '   ' }, { goiAi: ai.goi }))
        dung('D1 mô tả trống ⇒ 400 và KHÔNG gọi AI', e0 instanceof LoiDacDiem && e0.status === 400 && ai.lan === 0)

        const kq = await rutDacDiemBangAi(db, sp, { goiAi: ai.goi, nguoiSua: 'nv@x.vn' })
        dung('D2 rút lần đầu: lưu nguồn AI, khớp mô tả, đúng số dòng, ghi model', kq.nguon === 'ai' && kq.khopMoTa && kq.ds.length === SO_GIU_NOI && kq.model === 'gemini-gia' && !kq.tuBoNho && db.bang.get('p1')?.nguoiSua === 'nv@x.vn')
        dung('D3 đề bài gửi AI có tên, hãng, nhóm, mô tả', /Sunhouse/.test(ai.deBai) && /Nồi cơm điện/.test(ai.deBai) && ai.deBai.includes('Lòng nồi hợp kim'))
        const lai = await rutDacDiemBangAi(db, sp, { goiAi: ai.goi })
        dung('D4 mở lại cùng mô tả ⇒ trả bản đã lưu, KHÔNG gọi AI lần 2', lai.tuBoNho && ai.lan === 1)
        await rutDacDiemBangAi(db, sp, { goiAi: ai.goi, lamMoi: true })
        dung('D5 lamMoi ⇒ gọi AI lại', ai.lan === 2)

        const nguoi = await luuDacDiemNguoi(db, { id: 'p1', moTa: MO_TA_NOI }, [{ ten: 'Công suất', giaTri: '860 W' }, { ten: 'Lòng nồi', giaTri: 'Chống dính 5 lớp' }], 'ql@x.vn')
        dung('D6 người lưu ⇒ nguồn người, đoạn nguồn tự tìm', nguoi.nguon === 'nguoi' && nguoi.ds.length === 2 && nguoi.ds[0].trich === 'Công suất: 860W' && nguoi.khopMoTa)
        const e1 = await nem(() => rutDacDiemBangAi(db, sp, { goiAi: ai.goi }))
        dung('D7 đã có người duyệt ⇒ 409, KHÔNG gọi AI, bản người còn nguyên', e1 instanceof LoiDacDiem && e1.status === 409 && ai.lan === 2 && db.bang.get('p1')?.nguon === 'nguoi')
        const de = await rutDacDiemBangAi(db, sp, { goiAi: ai.goi, ghiDe: true })
        dung('D8 ghiDe (người xác nhận) ⇒ AI thay bản người', de.nguon === 'ai' && de.ds.length === SO_GIU_NOI && ai.lan === 3 && !de.aiRong)

        // thử máy chủ giả 14/11: "AI rút lại" lên bản người duyệt, AI chỉ ra dòng bịa (lọc hết) ⇒ trước đây thay bằng bản RỖNG
        await luuDacDiemNguoi(db, { id: 'p1', moTa: MO_TA_NOI }, [{ ten: 'Công suất', giaTri: '860 W' }], 'ql@x.vn')
        const aiBia = aiGia({ dacDiem: [{ ten: 'Xuất xứ', giaTri: 'Thái Lan' }], canhBao: [] })
        const rong = await rutDacDiemBangAi(db, sp, { goiAi: aiBia.goi, ghiDe: true })
        dung('D8b ghiDe mà AI không còn dòng nào ⇒ GIỮ bản người (aiRong), không ghi', rong.aiRong && rong.giuBanNguoi && rong.nguon === 'nguoi' && rong.ds.length === 1 && aiBia.lan === 1 && db.bang.get('p1')?.nguon === 'nguoi')
        const deLai = await rutDacDiemBangAi(db, sp, { goiAi: ai.goi, ghiDe: true })
        dung('D8c ghiDe mà AI ra dòng thật ⇒ vẫn thay như cũ', deLai.nguon === 'ai' && deLai.ds.length === SO_GIU_NOI && !deLai.aiRong)

        const doi = await docDacDiem(db, 'p1', MO_TA_NOI + '\n- Màu trắng')
        dung('D9 mô tả đổi sau khi rút ⇒ khopMoTa false', doi.sanSang && doi.dacDiem?.khopMoTa === false)
        const crlf = await docDacDiem(db, 'p1', MO_TA_NOI.replace(/\n/g, '\r\n') + '   ')
        dung('D10 chỉ khác \\r\\n / khoảng trắng hai đầu ⇒ vẫn khớp', crlf.dacDiem?.khopMoTa === true && bamMoTa(MO_TA_NOI) === bamMoTa(` ${MO_TA_NOI.replace(/\n/g, '\r\n')}\n`))
    }
    {
        // so-và-ghi: người lưu ĐÚNG LÚC AI đang chạy ⇒ giữ bản người
        const db = prismaGia()
        await rutDacDiemBangAi(db, sp, { goiAi: aiGia().goi })   // đã có bản AI (mô tả cũ)
        const moTaMoi = MO_TA_NOI + '\n- Màu trắng'
        const ai = aiGia(AI_NOI, async () => { await luuDacDiemNguoi(db, { id: 'p1', moTa: moTaMoi }, [{ ten: 'Màu', giaTri: 'Trắng' }], 'nv@x.vn') })
        const kq = await rutDacDiemBangAi(db, { ...sp, moTa: moTaMoi }, { goiAi: ai.goi })
        dung('D11 người lưu lúc AI đang chạy ⇒ KHÔNG ghi đè, trả bản người', kq.giuBanNguoi && kq.nguon === 'nguoi' && kq.ds.length === 1 && db.bang.get('p1')?.nguon === 'nguoi')

        const db2 = prismaGia()
        const ai2 = aiGia(AI_NOI, async () => { await luuDacDiemNguoi(db2, { id: 'p2', moTa: MO_TA_NOI }, [{ ten: 'Màu', giaTri: 'Trắng' }], 'nv@x.vn') })
        const kq2 = await rutDacDiemBangAi(db2, { ...sp, id: 'p2' }, { goiAi: ai2.goi })
        dung('D12 chưa có dòng, người tạo trước lúc AI xong ⇒ giữ bản người (không P2002 ra ngoài)', kq2.giuBanNguoi && db2.bang.get('p2')?.nguon === 'nguoi')
    }
    {
        const cuGem = process.env.GEMINI_API_KEY, cuDs = process.env.DEEPSEEK_API_KEY
        delete process.env.GEMINI_API_KEY; delete process.env.DEEPSEEK_API_KEY
        const e = await nem(() => rutDacDiemBangAi(prismaGia(), sp))
        dung('D13 cửa hàng chưa có key AI ⇒ 400 + cờ khongCoKey, chỉ đường Cài đặt', e instanceof LoiDacDiem && e.status === 400 && e.khongCoKey && /Trợ lý AI/.test(e.message), e?.message)
        if (cuGem !== undefined) process.env.GEMINI_API_KEY = cuGem
        if (cuDs !== undefined) process.env.DEEPSEEK_API_KEY = cuDs

        const thieu = prismaGia({ bangChuaCo: true })
        const d = await docDacDiem(thieu, 'p1', MO_TA_NOI)
        dung('D14 bảng chưa migrate ⇒ đọc ra "chưa sẵn sàng", không ném', d.sanSang === false && d.dacDiem === null)
        const e2 = await nem(() => luuDacDiemNguoi(thieu, { id: 'p1', moTa: MO_TA_NOI }, [{ ten: 'A', giaTri: 'b' }]))
        const e3 = await nem(() => rutDacDiemBangAi(thieu, sp, { goiAi: aiGia().goi }))
        dung('D15 bảng chưa migrate ⇒ lưu / rút báo 503 rõ ràng', e2 instanceof LoiDacDiem && e2.status === 503 && e3 instanceof LoiDacDiem && e3.status === 503 && /migrate/.test(e2.message))
        const n = await docDacDiemNhieuMa(thieu, [{ id: 'p1', moTa: 'x' }])
        dung('D16 danh sách khi bảng chưa có ⇒ sanSang false', n.sanSang === false && n.theoMa.size === 0)
        const e4 = await nem(() => docDacDiem(prismaGia({ loiKhac: true }), 'p1', MO_TA_NOI))
        dung('D17 lỗi CSDL KHÁC (mất kết nối) KHÔNG bị nuốt thành "chưa có đặc điểm"', !!e4 && /reach database/.test(e4.message))
    }
    {
        const db = prismaGia()
        const e = await nem(() => rutDacDiemBangAi(db, sp, { goiAi: aiGia('Xin lỗi, tôi không đọc được') .goi }))
        dung('D18 AI trả không phải JSON ⇒ LoiAiSoat (tạm thời), KHÔNG lưu gì', e instanceof LoiAiSoat && e.tamThoi && db.bang.size === 0)

        // JSON hỏng trong bảng ⇒ docHong, rút lại thay vì trả bản hỏng
        db.bang.set('p1', { id: 'x', productId: 'p1', dacDiem: '{hỏng', bamMoTa: bamMoTa(MO_TA_NOI), nguon: 'ai', model: null, updatedAt: bayGio(), createdAt: bayGio() })
        const doc = await docDacDiem(db, 'p1', MO_TA_NOI)
        dung('D19 JSON hỏng ⇒ docHong true (không coi là "không có đặc điểm")', doc.dacDiem?.docHong === true && doc.dacDiem.ds.length === 0)
        const ai = aiGia()
        const kq = await rutDacDiemBangAi(db, sp, { goiAi: ai.goi })
        dung('D20 bản lưu hỏng cùng mô tả ⇒ vẫn rút lại (không trả bản hỏng từ bộ nhớ)', ai.lan === 1 && !kq.docHong && kq.ds.length === SO_GIU_NOI)

        const dai = MO_TA_NOI + '\n' + 'Hướng dẫn sử dụng chi tiết. '.repeat(500)
        const aiDai = aiGia()
        const kqDai = await rutDacDiemBangAi(prismaGia(), { ...sp, moTa: dai }, { goiAi: aiDai.goi })
        const phanMoTa = aiDai.deBai.split('"""')[1] || ''
        dung(`D21 mô tả > ${TOI_DA_KY_TU_AI_DOC} ký tự ⇒ AI đọc ${TOI_DA_KY_TU_AI_DOC} đầu VÀ có cảnh báo nói rõ`, phanMoTa.trim().length <= TOI_DA_KY_TU_AI_DOC && /chỉ đọc/.test(kqDai.canhBao[0] || ''), kqDai.canhBao[0])

        const db3 = prismaGia()
        await rutDacDiemBangAi(db3, sp, { goiAi: aiGia().goi })
        await luuDacDiemNguoi(db3, { id: 'p9', moTa: 'Màu đỏ' }, [{ ten: 'Màu', giaTri: 'Đỏ' }])
        const ds = await docDacDiemNhieuMa(db3, [{ id: 'p1', moTa: MO_TA_NOI }, { id: 'p9', moTa: 'Màu xanh' }, { id: 'p5', moTa: 'x' }])
        const a = ds.theoMa.get('p1'), b = ds.theoMa.get('p9')
        dung('D22 danh sách: số dòng + nguồn + khớp mô tả từng mã; mã chưa rút không có', a?.so === SO_GIU_NOI && a.nguon === 'ai' && a.khopMoTa && b?.nguon === 'nguoi' && b.khopMoTa === false && !ds.theoMa.has('p5'))
    }

    // ─── E. Soát nguồn ──────────────────────────────────────────────────────────
    {
        const goc = path.resolve(__dirname, '..')
        const route = fs.readFileSync(path.join(goc, 'src/routes/thongTinSanPham.ts'), 'utf8')
        dung('E1 POST rút AI + PUT lưu đều đòi quyền SỬA', /router\.post\('\/:id\/dac-diem\/ai', authMiddleware, SUA,/.test(route) && /router\.put\('\/:id\/dac-diem', authMiddleware, SUA,/.test(route))
        const admin = fs.readFileSync(path.join(goc, 'src/routes/admin.ts'), 'utf8')
        const m = admin.match(/CREATE TABLE IF NOT EXISTS "DacDiemSanPham" \(([\s\S]*?)CONSTRAINT/)
        dung('E2 /admin/migrate tạo bảng + khoá duy nhất productId', !!m && admin.includes('CREATE UNIQUE INDEX IF NOT EXISTS "DacDiemSanPham_productId_key" ON "DacDiemSanPham"("productId")'))
        const schema = fs.readFileSync(path.join(goc, 'prisma/schema-store.prisma'), 'utf8')
        const model = schema.match(/model DacDiemSanPham \{([\s\S]*?)\n\}/)?.[1] || ''
        const cotModel = model.split('\n').map(l => l.trim()).filter(l => /^[a-zA-Z]/.test(l)).map(l => l.split(/\s+/)[0]).sort()
        const cotMigrate = [...(m?.[1] || '').matchAll(/"(\w+)"\s+(?:TEXT|TIMESTAMP)/g)].map(x => x[1]).sort()
        dung('E3 cột migrate KHỚP model Prisma (lệch là P2022 ở cửa hàng cũ)', cotModel.length > 0 && cotModel.join(',') === cotMigrate.join(','), `model=${cotModel} migrate=${cotMigrate}`)
        const product = schema.match(/model Product \{([\s\S]*?)\n\}/)?.[1] || ''
        dung('E4 Product KHÔNG thêm cột (đặc điểm ở bảng riêng)', !!product && !/dacDiem|DacDiem/.test(product))
    }

    console.log(`\n${dat} đạt, ${loi} lỗi`)
    process.exit(loi ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
