// ═══════════════════════════════════════════════════════════════════════════════
//  DÒNG HÀNG TRỎ VÀO MÃ ĐÃ GỘP → ĐỔI SANG MÃ ĐÍCH.
//
//  Gộp mã (lib/mergeProduct.ts) dời hàng của mã nguồn (vd vỉ EDH-CBZ010-E2) sang
//  mã đích (cái SP000197) rồi để lại CON TRỎ Product.mergedIntoId + mergedRate.
//  Đơn sàn và đẩy tồn đã đi theo con trỏ đó, PHIẾU NHẬP thì chưa: nhập 1 vỉ vào
//  mã gộp là cộng +1 vào chính mã gộp — mã đích vẫn âm, hàng kẹt ở một mã không
//  ai bán. Đo 30/10/2026: KENGISTORE 7 dòng / 4 mã kẹt như vậy từ 10/08.
//
//  Quy tắc y như lúc gộp: SL × hệ số, đơn giá ÷ hệ số → THÀNH TIỀN GIỮ NGUYÊN;
//  mã/tên snapshot theo mã đích (tồn kho thuế đối chiếu theo chuỗi đó).
// ═══════════════════════════════════════════════════════════════════════════════

export interface MaDich {
    id: string; sku: string; name: string; baseUnit: string | null
    /** Số đơn vị mã đích trong 1 đơn vị mã gộp (gộp nhiều nấc thì nhân dồn) */
    heSo: number
    /** Mã gộp ban đầu — để báo cho người dùng */
    tuSku: string
}

export interface DongHang {
    productId: string
    productName?: string | null
    productSku?: string | null
    quantity: number
    costPrice?: number | null
    total?: number | null
}

export interface DaQuyDoi { tuSku: string; sangSku: string; heSo: number; soLuong: number; soLuongSau: number }

/** Lỗi người dùng sửa được (trả 400): SL sau quy đổi lẻ, con trỏ gộp vòng/đứt */
export class LoiQuyDoiMaGop extends Error { }

/** A gộp vào B, B lại gộp vào C… quá chừng này nấc thì coi là hỏng */
const SO_NAC_TOI_DA = 5

/**
 * Mã đã gộp → mã đích CUỐI CÙNG + hệ số nhân dồn qua từng nấc. Chỉ trả về những
 * id ĐÃ GỘP — mã thường không có mặt trong Map.
 */
export async function giaiConTroGop(prisma: any, ids: string[]): Promise<Map<string, MaDich>> {
    const sp = new Map<string, any>()
    const doc = async (ds: string[]) => {
        const thieu = [...new Set(ds)].filter(id => id && !sp.has(id))
        if (thieu.length === 0) return
        const rows = await prisma.product.findMany({
            where: { id: { in: thieu } },
            select: { id: true, sku: true, name: true, baseUnit: true, mergedIntoId: true, mergedRate: true },
        })
        for (const r of rows) sp.set(r.id, r)
    }
    await doc(ids)
    // Mỗi vòng đọc một lượt mọi mã đích chưa có — gộp nhiều nấc vẫn chỉ vài câu hỏi
    for (let nac = 0; nac < SO_NAC_TOI_DA; nac++) {
        const truoc = sp.size
        await doc([...sp.values()].map(r => r.mergedIntoId).filter(Boolean))
        if (sp.size === truoc) break
    }

    const ra = new Map<string, MaDich>()
    for (const id of new Set(ids)) {
        const goc = sp.get(id)
        if (!goc?.mergedIntoId) continue
        let cur = goc, heSo = 1
        const daQua = new Set<string>([goc.id])
        while (cur.mergedIntoId) {
            const r = Number(cur.mergedRate)
            if (!(r > 0) || !Number.isFinite(r)) throw new LoiQuyDoiMaGop(
                `Mã ${cur.sku} đã gộp nhưng hệ số quy đổi không hợp lệ (${cur.mergedRate}) — mở Sản phẩm, gộp lại với hệ số đúng.`)
            heSo *= r
            const tiep = sp.get(cur.mergedIntoId)
            if (!tiep) throw new LoiQuyDoiMaGop(
                `Mã ${goc.sku} đã gộp vào một mã không còn trong kho — mở Sản phẩm kiểm tra lại cặp gộp.`)
            if (daQua.has(tiep.id) || daQua.size > SO_NAC_TOI_DA) throw new LoiQuyDoiMaGop(
                `Mã ${goc.sku} gộp vòng tròn (${[...daQua].map(x => sp.get(x)?.sku).join(' → ')} → ${tiep.sku}) — gỡ bớt một cặp gộp rồi nhập lại.`)
            daQua.add(tiep.id)
            cur = tiep
        }
        ra.set(id, { id: cur.id, sku: cur.sku, name: cur.name, baseUnit: cur.baseUnit ?? null, heSo, tuSku: goc.sku })
    }
    return ra
}

/**
 * Đổi mọi dòng trỏ vào mã đã gộp sang mã đích. Trả MẢNG MỚI (không sửa tại chỗ);
 * không dòng nào gộp thì trả lại chính mảng đầu vào.
 *
 * `total` được CHỐT bằng thành tiền trước khi đổi, để SL × đơn giá mới có lẻ
 * (124.820 ÷ 3) cũng không làm lệch tổng phiếu một đồng nào.
 */
export async function quyDoiDongMaGop<T extends DongHang>(
    prisma: any, items: T[],
): Promise<{ items: T[]; daDoi: DaQuyDoi[] }> {
    const ds = Array.isArray(items) ? items : []
    const dich = await giaiConTroGop(prisma, ds.map(i => String(i?.productId || '')).filter(Boolean))
    if (dich.size === 0) return { items: ds, daDoi: [] }

    const daDoi: DaQuyDoi[] = []
    const ra = ds.map(it => {
        const d = dich.get(String(it?.productId || ''))
        if (!d) return it
        const sl = Number(it.quantity) || 0
        const slSau = sl * d.heSo
        // Số lượng phiếu nhập là SỐ NGUYÊN — làm tròn âm thầm là sai kho
        if (Math.abs(slSau - Math.round(slSau)) > 1e-6) throw new LoiQuyDoiMaGop(
            `Mã ${d.tuSku} đã gộp vào ${d.sku} (1 = ${d.heSo} ${d.baseUnit || ''}) — ${sl} × ${d.heSo} = ${slSau} không phải số nguyên. ` +
            `Nhập thẳng theo mã ${d.sku} với số lượng nguyên.`)
        const gia = Number(it.costPrice) || 0
        const thanhTien = Number(it.total) > 0 ? Number(it.total) : sl * gia
        daDoi.push({ tuSku: d.tuSku, sangSku: d.sku, heSo: d.heSo, soLuong: sl, soLuongSau: Math.round(slSau) })
        return {
            ...it,
            productId: d.id, productSku: d.sku, productName: d.name,
            quantity: Math.round(slSau),
            costPrice: gia / d.heSo,
            total: thanhTien,
        }
    })
    return { items: ra, daDoi }
}

/** Ghi chú cho thẻ kho của MỘT dòng đã đổi — chỉ khi mã đích đó nhận đúng một dòng đổi (không đoán) */
export function ghiChuQuyDoi(daDoi: DaQuyDoi[], sangSku: string | null | undefined): string {
    const cua = daDoi.filter(d => d.sangSku === sangSku)
    if (cua.length !== 1) return ''
    const d = cua[0]
    return ` — quy đổi ${d.soLuong} ${d.tuSku} × ${d.heSo}`
}
