/**
 * TRUY VẾT TỒN KHO — tồn của một mã đi âm từ lúc nào, vì chứng từ nào.
 *
 * Bảng đặt hàng nói "234 mã đang tồn âm, đi soát kho". Nhưng "soát kho" là một
 * câu vô nghĩa nếu người ta không biết bắt đầu từ đâu: mở phiếu nào, ngày nào,
 * ai ghi. Với 234 mã thì lời khuyên đó tương đương với không nói gì.
 *
 * Ở đây dựng lại dòng thời gian của một mã: mọi lần nhập, bán, trả, chuyển kho,
 * điều chỉnh — cộng dồn theo thứ tự để chỉ ra ĐÚNG chứng từ đầu tiên kéo tồn
 * xuống dưới 0.
 *
 * MỘT CHỖ PHẢI NÓI THẲNG: sổ chuyển động kho (InventoryTransaction) chỉ ghi từ
 * khi cửa hàng bắt đầu dùng phần mềm, và tồn đầu kỳ không phải lúc nào cũng có
 * bản ghi. Nên số cộng dồn ở đây có thể lệch so với tồn hiện tại. Khi lệch thì
 * PHẢI nói ra, chứ không im lặng đưa một dòng thời gian trông có vẻ đầy đủ —
 * người dùng sẽ đi tìm một chứng từ sai.
 */

export interface BuocKho {
    ngay: string
    loai: string
    /** Dấu và số lượng của bước này. */
    thayDoi: number
    /** Tồn sau bước này theo sổ chuyển động. */
    conLai: number
    lyDo: string
    chungTu: string | null
    nguoiGhi: string
    /** Đây có phải bước đầu tiên kéo tồn xuống âm không. */
    batDauAm: boolean
}

export interface KetQuaTruyVet {
    sanPham: { id: string; ten: string; sku: string; tonHienTai: number } | null
    /** Tổng hợp từ sổ chuyển động — có thể khác tồn hiện tại. */
    tonTheoSo: number
    /** Chênh giữa sổ chuyển động và tồn thực tế. */
    lech: number
    khopSo: boolean
    lyDoKhongKhop?: string
    soBuoc: number
    buocDauTienAm: BuocKho | null
    buoc: BuocKho[]
    ghiChu: string[]
    thieu: string[]
}

const lam = (n: any) => Math.round(Number(n) || 0)
const VN = 7 * 3600 * 1000
const ngayVN = (d: any) => {
    const t = new Date(d)
    return isNaN(t.getTime()) ? '' : new Date(t.getTime() + VN).toISOString().slice(0, 16).replace('T', ' ')
}

/** Nhãn tiếng Việt cho từng loại chuyển động. */
const TEN_LOAI: Record<string, string> = {
    import: 'Nhập kho',
    export: 'Xuất kho',
    adjustment: 'Điều chỉnh',
    sale: 'Bán hàng',
    return: 'Trả hàng',
    transfer: 'Chuyển kho',
}

/** Loại nào làm TĂNG tồn. Số lượng trong sổ luôn dương nên phải suy dấu từ loại. */
const LAM_TANG = new Set(['import', 'return'])

export async function truyVetTonKho(
    prisma: any,
    productId: string,
    tuyChon?: { soBuocToiDa?: number },
): Promise<KetQuaTruyVet> {
    const thieu: string[] = []
    const ghiChu: string[] = []
    const tran = Math.max(20, Math.min(1000, tuyChon?.soBuocToiDa ?? 300))

    let sp: any = null
    try {
        sp = await prisma.product.findUnique({
            where: { id: productId },
            select: { id: true, name: true, sku: true, stock: true },
        })
    } catch (e: any) {
        thieu.push(`Không đọc được hàng hoá: ${String(e?.message || e).slice(0, 120)}`)
    }

    let ds: any[] = []
    try {
        ds = await prisma.inventoryTransaction.findMany({
            where: { productId },
            select: {
                type: true, quantity: true, reason: true, note: true,
                referenceId: true, referenceType: true, userName: true,
                transactionDate: true, createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
            take: tran,
        })
    } catch (e: any) {
        thieu.push(`Không đọc được sổ chuyển động kho: ${String(e?.message || e).slice(0, 120)}`)
    }

    let con = 0
    let dauAm: BuocKho | null = null
    const buoc: BuocKho[] = ds.map((r: any) => {
        const loai = String(r.type || '')
        const sl = Math.abs(Number(r.quantity) || 0)
        const dau = LAM_TANG.has(loai) ? 1 : loai === 'adjustment' ? Math.sign(Number(r.quantity) || 0) || 1 : -1
        const thayDoi = dau * sl
        con += thayDoi
        const b: BuocKho = {
            ngay: ngayVN(r.transactionDate || r.createdAt),
            loai: TEN_LOAI[loai] || loai,
            thayDoi,
            conLai: con,
            lyDo: String(r.reason || r.note || ''),
            chungTu: r.referenceId ? `${r.referenceType || ''} ${r.referenceId}`.trim() : null,
            nguoiGhi: String(r.userName || '—'),
            batDauAm: false,
        }
        if (!dauAm && con < 0) { b.batDauAm = true; dauAm = b }
        return b
    })

    const tonHienTai = sp ? lam(sp.stock) : 0
    const lech = lam(tonHienTai - con)

    /* KHÔNG im lặng khi sổ chuyển động không dựng lại được tồn hiện tại.
     *
     * Sổ chỉ ghi từ khi cửa hàng dùng phần mềm, và tồn đầu kỳ nhiều khi được đặt
     * thẳng vào Product.stock lúc khởi tạo mà không sinh bản ghi. Nếu cứ đưa
     * dòng thời gian ra như thể nó đầy đủ, người dùng sẽ đi tìm một chứng từ sai
     * — trong khi chênh lệch đến từ phần không có trong sổ. */
    const khopSo = Math.abs(lech) < 1
    if (!khopSo && sp) {
        ghiChu.push(`Cộng dồn sổ chuyển động ra ${con}, nhưng tồn hiện tại là ${tonHienTai} — chênh ${lech}. Phần chênh này KHÔNG có trong sổ chuyển động: thường là tồn đầu kỳ đặt thẳng lúc khởi tạo, hoặc một lần sửa tồn không sinh bản ghi. Dòng thời gian dưới đây vẫn đọc được, nhưng mốc "bắt đầu âm" có thể lệch đúng bằng phần chênh đó.`)
    }
    if (ds.length >= tran) {
        ghiChu.push(`Mã này có rất nhiều chuyển động — chỉ lấy ${tran} bước đầu tiên.`)
    }
    if (ds.length === 0 && thieu.length === 0) {
        ghiChu.push('Mã này chưa có bản ghi chuyển động kho nào. Tồn hiện tại được đặt trực tiếp, không qua nhập/bán — nên không truy vết được bằng sổ.')
    }

    return {
        sanPham: sp ? { id: sp.id, ten: String(sp.name || ''), sku: String(sp.sku || ''), tonHienTai } : null,
        tonTheoSo: con,
        lech,
        khopSo,
        lyDoKhongKhop: khopSo ? undefined : 'Sổ chuyển động không dựng lại được tồn hiện tại',
        soBuoc: buoc.length,
        buocDauTienAm: dauAm,
        /* Trả về các bước GẦN NHẤT khi quá dài: chỗ hỏng thường nằm gần đây, và
         * bước đầu tiên âm đã được tách riêng nên không mất. */
        buoc: buoc.length > 100 ? buoc.slice(-100) : buoc,
        ghiChu, thieu,
    }
}
