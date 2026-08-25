/**
 * ĐỔ SỔ CHI TIẾT MUA HÀNG MISA vào bảng riêng (25/08/2026) — song sinh với
 * misaImportBanHang: KHÔNG tạo ImportReceipt ở bước này. Muốn thành phiếu nhập
 * thật của cửa hàng gương thì qua /api/misa/do-thanh-phieu-nhap (có rào).
 */
import { docSoMuaHang, gomChungTuMua } from './misaExcel'

export interface KetQuaDoMuaHang {
    kyBaoCao: string
    tongDong: number
    docDuoc: number
    boQua: number
    boQuaChiTiet: Array<{ dong: number; lyDo: string }>
    tieuDeThieu: string[]
    soChungTu: number
    chungTuMoi: number
    chungTuCapNhat: number
    tongGiaTri: number
    tongThue: number
    hangKhop: number
    hangChuaCo: string[]
    canhBao: string[]
    tuNgay: string | null
    denNgay: string | null
}

export function tomTatMuaDeGhiLog(kq: KetQuaDoMuaHang, gioiHan = 50) {
    return {
        boQua: kq.boQuaChiTiet.slice(0, gioiHan),
        boQuaConLai: Math.max(0, kq.boQuaChiTiet.length - gioiHan),
        canhBao: kq.canhBao,
    }
}

export async function doMuaHangMisa(
    sp: any, rows: any[][],
    opts: { tenFile: string; apply: boolean; userId?: string | null; userName?: string | null },
): Promise<KetQuaDoMuaHang> {
    const doc = docSoMuaHang(rows)
    const kq: KetQuaDoMuaHang = {
        kyBaoCao: doc.kyBaoCao, tongDong: doc.tongDong, docDuoc: doc.docDuoc,
        boQua: doc.boQua.length, boQuaChiTiet: doc.boQua, tieuDeThieu: doc.tieuDeThieu,
        soChungTu: 0, chungTuMoi: 0, chungTuCapNhat: 0, tongGiaTri: 0, tongThue: 0,
        hangKhop: 0, hangChuaCo: [], canhBao: [], tuNgay: null, denNgay: null,
    }
    if (doc.tieuDeThieu.length) return kq

    const chungTu = gomChungTuMua(doc.dong)
    kq.soChungTu = chungTu.length
    for (const ct of chungTu) {
        kq.tongGiaTri += ct.tongGiaTri
        kq.tongThue += ct.tongThue
        if (ct.ngay) {
            const iso = ct.ngay.toISOString().slice(0, 10)
            if (!kq.tuNgay || iso < kq.tuNgay) kq.tuNgay = iso
            if (!kq.denNgay || iso > kq.denNgay) kq.denNgay = iso
        }
    }

    // Khớp SKU một lượt — sổ mua thường lặp lại ít mã
    const boSku = [...new Set(doc.dong.map(d => d.maHang))]
    const spDaCo = new Map<string, string>()
    for (const sku of boSku) {
        const p = await sp.product.findUnique({ where: { sku }, select: { id: true } }).catch(() => null)
        if (p?.id) spDaCo.set(sku, p.id)
    }
    kq.hangKhop = spDaCo.size
    kq.hangChuaCo = boSku.filter(s => !spDaCo.has(s)).slice(0, 80)

    if (!opts.apply) return kq

    const batch = await sp.misaImportBatch.create({
        data: {
            loai: 'purchases', tenFile: opts.tenFile, kyBaoCao: doc.kyBaoCao || null,
            tongDong: doc.tongDong, docDuoc: doc.docDuoc, boQua: doc.boQua.length,
            soChungTu: chungTu.length, tongTien: kq.tongGiaTri, tongThue: kq.tongThue,
            chiTiet: JSON.stringify(tomTatMuaDeGhiLog(kq)),
            apply: true, userId: opts.userId || null, userName: opts.userName || null,
        },
    })

    // Tuần tự — PROD PRISMA_POOL_SIZE=1
    for (const ct of chungTu) {
        const duLieu = {
            soHoaDon: ct.soHoaDon || null,
            ngayChungTu: ct.ngay, ngayHachToan: ct.lines[0]?.ngayHachToan || ct.ngay,
            ngayHoaDon: ct.ngayHoaDon,
            tongGiaTri: ct.tongGiaTri, tongThue: ct.tongThue,
            tongChietKhau: ct.tongChietKhau, tongTra: ct.tongTra, tongGiamGia: ct.tongGiamGia,
            batchId: batch.id,
            lines: {
                create: ct.lines.map(l => ({
                    maHang: l.maHang, tenHang: l.tenHang || null, dvt: l.dvt || null,
                    soLuong: l.soLuong, donGia: l.donGia, giaTri: l.giaTri,
                    thueGtgt: l.thueGtgt, chietKhau: l.chietKhau,
                    soLuongTra: l.soLuongTra, giaTriTra: l.giaTriTra, giamGia: l.giamGia,
                    productId: spDaCo.get(l.maHang) || null, dongSo: l.dongSo,
                })),
            },
        }
        const cu = await sp.misaPurchaseDoc.findUnique({ where: { soChungTu: ct.soChungTu }, select: { id: true } })
        if (cu) {
            // Dựng lại bản ghi con theo nguồn — nửa cũ nửa mới là sổ hết tin được
            await sp.misaPurchaseLine.deleteMany({ where: { docId: cu.id } })
            await sp.misaPurchaseDoc.update({ where: { id: cu.id }, data: duLieu })
            kq.chungTuCapNhat++
        } else {
            await sp.misaPurchaseDoc.create({ data: { ...duLieu, soChungTu: ct.soChungTu } })
            kq.chungTuMoi++
        }
    }
    return kq
}
