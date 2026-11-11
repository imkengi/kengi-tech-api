/**
 * PHIẾU SỬA CHỮA GẮN HOÁ ĐƠN ĐÃ HUỶ ⇒ CHUYỂN SANG HOÁ ĐƠN RA LẠI (11/11/2026).
 *
 * Chủ shop: "các đơn đã huỷ ra lại đơn mới thì phiếu sửa chữa không gắn đơn mới mà gắn đơn cũ".
 * KiotViet sửa một hoá đơn bằng cách HUỶ nó rồi ra bản mới cùng số, thêm đuôi: HD031880 → HD031880.01 →
 * HD031880.02. Ở Kengi mỗi bản là một Transaction riêng; bản cũ thành 'voided'. Phiếu sửa chữa được tự gắn
 * (services/kiotvietSync.ganPhieuSuaChuaKhiSync) vào bản ĐẦU TIÊN và luật "ghi MỘT lần" giữ nó ở đó mãi —
 * mở phiếu ra thấy hoá đơn đã huỷ, không thấy hoá đơn thật đã thu tiền.
 *
 * Luật chuyển — chỉ theo DẤU VẾT CHẮC, không đoán:
 *   - chỉ chuyển phiếu đang gắn hoá đơn 'voided';
 *   - hoá đơn đích phải CÙNG SỐ GỐC (bỏ đuôi .NN), KHÔNG 'voided', và cùng khách (khi cả hai bên có mã khách);
 *   - nhiều bản còn hiệu lực cùng số gốc (không nên có) ⇒ lấy bản đuôi lớn nhất;
 *   - không có bản nào còn hiệu lực ⇒ để nguyên (đơn huỷ hẳn — phiếu vẫn chỉ về đơn đã huỷ, đúng sự thật).
 * Hoá đơn huỷ rồi lập lại bằng SỐ KHÁC (bán tại POS Kengi) không có dấu vết nối ⇒ không tự chuyển.
 */

/** HD031880.02 → HD031880. Số không có đuôi trả nguyên. */
export function soGocHoaDon(ma: unknown): string {
    return String(ma ?? '').trim().replace(/\.\d+$/, '')
}

/** Đuôi bản ra lại: HD031880 → 0, HD031880.02 → 2. */
export function duoiHoaDon(ma: unknown): number {
    const m = String(ma ?? '').trim().match(/\.(\d+)$/)
    return m ? Number(m[1]) : 0
}

export interface DongChuyenPhieu {
    phieu: string
    maPhieu: string | null
    tuHoaDon: string | null
    sangHoaDon: string
}

export interface KetQuaChuyenPhieu {
    /** phiếu đang gắn hoá đơn đã huỷ (trong phạm vi xét) */
    ganDonHuy: number
    /** đã (hoặc sẽ, khi chạy thử) chuyển sang hoá đơn ra lại */
    chuyen: DongChuyenPhieu[]
    /** gắn đơn huỷ mà không có bản ra lại còn hiệu lực — để nguyên */
    khongCoDonMoi: number
}

const cungKhach = (a: any, b: any) => !a || !b || String(a) === String(b)

/**
 * `txId` có ⇒ chỉ xét các phiếu đang gắn bản ĐÃ HUỶ cùng số gốc với hoá đơn này (gọi mỗi khi một hoá đơn đồng bộ về).
 * `donHuyId` có ⇒ chỉ xét các phiếu đang gắn ĐÚNG hoá đơn vừa bị huỷ này (gọi lúc đồng bộ đánh dấu huỷ — bản ra lại có thể đã về
 * TRƯỚC khi bản cũ bị huỷ, lúc đó đường `txId` chưa thấy gì để chuyển).
 * Bỏ trống cả hai ⇒ quét mọi phiếu đang gắn hoá đơn đã huỷ (lệnh dọn một lần). `apply:false` ⇒ chỉ đếm.
 */
export async function chuyenPhieuSuaSangDonMoi(sp: any, o: { txId?: string; donHuyId?: string; apply: boolean }): Promise<KetQuaChuyenPhieu> {
    const kq: KetQuaChuyenPhieu = { ganDonHuy: 0, chuyen: [], khongCoDonMoi: 0 }
    const chonTx = { id: true, receiptNumber: true, status: true, customerId: true }

    /** bản còn hiệu lực cùng số gốc — đuôi lớn nhất */
    const donMoiCua = async (goc: string, khach: any): Promise<any | null> => {
        if (!goc) return null
        const ds: any[] = await sp.transaction.findMany({
            where: { OR: [{ receiptNumber: goc }, { receiptNumber: { startsWith: `${goc}.` } }], status: { not: 'voided' } },
            select: chonTx,
        })
        const hop = ds.filter(t => soGocHoaDon(t.receiptNumber) === goc && cungKhach(t.customerId, khach))
        hop.sort((a, b) => duoiHoaDon(b.receiptNumber) - duoiHoaDon(a.receiptNumber))
        return hop[0] || null
    }

    let phieux: any[]
    const txCu = new Map<string, any>()
    if (o.donHuyId) {
        const cu = await sp.transaction.findUnique({ where: { id: String(o.donHuyId) }, select: chonTx })
        if (!cu || cu.status !== 'voided') return kq
        txCu.set(cu.id, cu)
        phieux = await sp.repair.findMany({ where: { transactionId: cu.id }, select: { id: true, code: true, transactionId: true, soldReceiptNumber: true } })
    } else if (o.txId) {
        const moi = await sp.transaction.findUnique({ where: { id: String(o.txId) }, select: chonTx })
        if (!moi || moi.status === 'voided') return kq
        const goc = soGocHoaDon(moi.receiptNumber)
        if (!goc) return kq
        const cu: any[] = await sp.transaction.findMany({
            where: { OR: [{ receiptNumber: goc }, { receiptNumber: { startsWith: `${goc}.` } }], status: 'voided' },
            select: chonTx,
        })
        for (const t of cu) if (t.id !== moi.id && soGocHoaDon(t.receiptNumber) === goc) txCu.set(t.id, t)
        if (!txCu.size) return kq
        phieux = await sp.repair.findMany({ where: { transactionId: { in: [...txCu.keys()] } }, select: { id: true, code: true, transactionId: true, soldReceiptNumber: true } })
    } else {
        phieux = await sp.repair.findMany({ where: { transactionId: { not: null } }, select: { id: true, code: true, transactionId: true, soldReceiptNumber: true } })
        const ids = [...new Set(phieux.map(p => String(p.transactionId)))]
        for (let i = 0; i < ids.length; i += 500) {
            const lo: any[] = await sp.transaction.findMany({ where: { id: { in: ids.slice(i, i + 500) }, status: 'voided' }, select: chonTx })
            for (const t of lo) txCu.set(t.id, t)
        }
        phieux = phieux.filter(p => txCu.has(String(p.transactionId)))
    }

    kq.ganDonHuy = phieux.length
    const demDich = new Map<string, any | null>()
    for (const p of phieux) {
        const cu = txCu.get(String(p.transactionId))
        const khoa = `${soGocHoaDon(cu.receiptNumber)}|${cu.customerId || ''}`
        if (!demDich.has(khoa)) demDich.set(khoa, await donMoiCua(soGocHoaDon(cu.receiptNumber), cu.customerId))
        const moi = demDich.get(khoa)
        if (!moi) { kq.khongCoDonMoi++; continue }
        if (o.apply) {
            // chỉ chuyển khi phiếu VẪN đang gắn đúng bản đã huỷ đó — lượt khác vừa chuyển / người vừa sửa thì thôi
            const r = await sp.repair.updateMany({ where: { id: p.id, transactionId: cu.id }, data: { transactionId: moi.id, soldReceiptNumber: moi.receiptNumber } })
            if (!r?.count) continue
        }
        kq.chuyen.push({ phieu: p.id, maPhieu: p.code ?? null, tuHoaDon: cu.receiptNumber ?? null, sangHoaDon: moi.receiptNumber })
    }
    return kq
}
