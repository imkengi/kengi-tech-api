// ─────────────────────────────────────────────────────────────────────────────
//  CHI TIẾT KHO HƯ HỎNG — mỗi đống hàng kèm LÝ DO HƯ + NGƯỜI THỰC HIỆN (09/10/2026)
//
//  Chủ shop: "trong phần kho hư hỏng trên web chưa hiện lý do hư và người thực hiện".
//  Trang web đọc tồn GỘP theo mã (WarehouseStock) nên chỉ có tên + số lượng. Hàng vào
//  kho hư hỏng qua NĂM đường, mỗi đường để dấu vết ở một chỗ riêng:
//    1. Nhập tay (/damaged-warehouse/nhap)          → lô DamagedEntry: lý do + người, đủ cả.
//    2. Phiếu sửa nội bộ / đổi mới nhận máy hỏng   → Repair (lý do = issue); NGƯỜI nằm ở thẻ
//       kho referenceType 'repair' — chỉ tin được userId: userName từng ghi cứng "Hệ thống"
//       vì token đăng nhập không mang tên (sửa từ 09/10, bản ghi cũ vẫn vậy).
//    3. Duyệt trả hàng sàn chọn "hư hỏng"           → thẻ kho referenceType 'return'
//       (lý do = ReturnOrder.reason; trạm quay ghi thêm dòng "[Nhận hàng hoàn]").
//    4. Phiếu chuyển kho vào / ra kho hư hỏng       → StockTransfer.
//    5. Kiểm kê riêng kho hư hỏng                   → InventoryCount (đặt lại tồn).
//
//  Lô (1) và phiếu sửa ĐANG GIỮ hàng (2) là số CHÍNH XÁC. Phần tồn còn lại chia cho các
//  lượt vào (3)(4)(5) MỚI NHẤT trước — đúng nếp xuất kho cũ trước: thứ còn nằm trong kho
//  là thứ vào sau cùng. Phần không lần ra nguồn thì NÓI THẲNG là chưa rõ, không bịa lý do.
//  Mã âm (ghi ra nhiều hơn ghi vào) kèm các lượt RA gần nhất để biết ai, vì sao.
//
//  CHỈ ĐỌC. Prod pool 1 kết nối → truy vấn tuần tự, không Promise.all.
// ─────────────────────────────────────────────────────────────────────────────

import { khoHuHong } from './warehouseHelper'
import { dichLyDoTraHang } from './lyDoTraHang'

export type NguonKhoHu = 'lo' | 'sua' | 'tra' | 'chuyen' | 'kiem-ke' | 'chua-ro'

export interface DongKhoHu {
    loai: NguonKhoHu
    soLuong: number
    lyDo: string | null
    nguoi: string | null
    luc: string | null
    maPhieu: string | null
    ghiChu?: string | null
    /** Lô nhập tay: 'tu-kho' (đã trừ tồn chính) | 'ngoai' (không qua kho) */
    nguonNhap?: string | null
    /** Lô nhập tay: id mọi lô trong đống, CŨ trước — để xử lý theo lô */
    entryIds?: string[]
    /** Lượt RA: bán tiếp / sửa xong / huỷ / NCC trả / rút phiếu / chuyển đi / kiểm kê thiếu */
    cachXuLy?: string | null
}

export interface HangKhoHu {
    productId: string
    productName: string
    sku: string | null
    /** Tồn THẬT của mã trong kho này (WarehouseStock) — có thể âm */
    ton: number
    /** Các đống đang nằm trong kho, kèm lý do + người; tổng = tồn khi sổ khớp */
    dong: DongKhoHu[]
    /** tồn − Σ đống: âm nghĩa là sổ ghi ra nhiều hơn ghi vào */
    lech: number
    /** Lượt RA gần nhất — chỉ kèm khi mã lệch / âm, để biết ai lấy ra và vì sao */
    ra: DongKhoHu[]
    /** Giá vốn hiện tại của mã — màn hình xử lý báo trước giá vốn sau khi cộng phí sửa */
    giaVon: number
    /** Tồn BÁN ĐƯỢC (Product.stock) — "nhập từ kho" cần đủ số này */
    tonBanDuoc: number
    donVi: string | null
}

const TRAN = 2000
/** Cùng quy tắc /damaged-warehouse/ton: hạ hoa/thường + gộp khoảng trắng, KHÔNG bỏ dấu
 *  (bỏ dấu thì "vỡ" và "vô" thành một chữ — gộp nhầm hai kiểu hỏng). */
const chuanLyDo = (s: any) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase()
const iso = (d: any): string | null => (d ? new Date(d).toISOString() : null)
const LY_DO_CHUYEN: Record<string, string> = {
    damage: 'Hư hỏng', warranty_received: 'Nhận bảo hành', warranty_returned: 'Trả bảo hành',
    restock: 'Nhập lại kho', other: 'Khác',
}
const CACH_XU_LY: Record<string, string> = { 'ban-tiep': 'Bán tiếp', 'sua-xong': 'Sửa xong', huy: 'Huỷ' }

/** Dòng "[Nhận hàng hoàn] …" cuối cùng trong ghi chú phiếu trả — tình trạng trạm quay ghi. */
function dongNhanHangHoan(notes?: string | null): string | null {
    const dong = String(notes || '').split(/\r?\n/).filter(d => d.trim().startsWith('[Nhận hàng hoàn]')).pop()
    return dong ? dong.trim().replace(/^\[Nhận hàng hoàn\]\s*/, '').slice(0, 240) : null
}

export async function chiTietKhoHuHong(prisma: any, khoId: string): Promise<{
    hang: HangKhoHu[]
    tong: { soMa: number; soLuong: number; coLyDo: number; chuaRo: number; soMaAm: number; tongAm: number; soMaLech: number }
    chamTran: boolean
}> {
    let chamTran = false
    const tran = <T>(ds: T[], n = TRAN): T[] => { if (ds.length >= n) chamTran = true; return ds }

    // ── Tồn theo mã: lấy cả ÂM — âm là sổ lệch, phải hiện chứ không giấu ──
    const ws: any[] = tran(await prisma.warehouseStock.findMany({
        where: { warehouseId: khoId, quantity: { not: 0 } },
        select: { productId: true, productName: true, productSku: true, quantity: true },
        take: TRAN,
    }))
    // ── (1) Lô nhập tay còn hàng ──
    const lo: any[] = tran(await prisma.damagedEntry.findMany({
        where: { warehouseId: khoId, loai: 'nhap', conLai: { gt: 0 } },
        orderBy: { createdAt: 'asc' }, take: TRAN,
    }))

    // Phiếu sửa / thẻ kho trả hàng chỉ ghi CHI NHÁNH — quy về kho bằng đúng hàm lúc ghi
    const khoTheoCN = new Map<string, string | null>()
    const khoCua = async (branchId: string | null | undefined) => {
        const k = branchId || ''
        if (!khoTheoCN.has(k)) khoTheoCN.set(k, await khoHuHong(prisma, branchId || null))
        return khoTheoCN.get(k)
    }

    // ── (2) Phiếu sửa ĐANG GIỮ hàng ở kho hư hỏng (cùng điều kiện dangGiuHang ở repairs.ts) ──
    const suaGiuTatCa: any[] = tran(await prisma.repair.findMany({
        where: {
            productId: { not: null }, supplierReturnedAt: null,
            OR: [{ stockMovedAt: { not: null } }, { replacedStockAt: { not: null } }],
        },
        select: {
            code: true, productId: true, productName: true, productSku: true, quantity: true, issue: true,
            source: true, branchId: true, stockMovedAt: true, replacedStockAt: true, customerName: true,
        },
        take: TRAN,
    }))
    const suaGiu: any[] = []
    for (const r of suaGiuTatCa) if ((await khoCua(r.branchId)) === khoId) suaGiu.push(r)

    const dsMa = Array.from(new Set<string>([
        ...ws.map(x => x.productId), ...lo.map(x => x.productId), ...suaGiu.map(x => x.productId),
    ]))
    if (!dsMa.length) {
        return { hang: [], tong: { soMa: 0, soLuong: 0, coLyDo: 0, chuaRo: 0, soMaAm: 0, tongAm: 0, soMaLech: 0 }, chamTran }
    }

    // ── (3) Trả hàng sàn duyệt "hư hỏng" — thẻ kho do onlineOrders ghi ──
    const theTra: any[] = tran(await prisma.inventoryTransaction.findMany({
        where: { referenceType: 'return', reason: { contains: 'vào kho hư hỏng' }, productId: { in: dsMa } },
        select: { productId: true, quantity: true, referenceId: true, userId: true, userName: true, createdAt: true, branchId: true },
        orderBy: { createdAt: 'desc' }, take: TRAN,
    }))
    const traO: any[] = []
    for (const t of theTra) if ((await khoCua(t.branchId)) === khoId) traO.push(t)
    const maTra = Array.from(new Set(traO.map(t => t.referenceId).filter(Boolean)))
    const phieuTra: any[] = maTra.length ? await prisma.returnOrder.findMany({
        where: { code: { in: maTra } },
        select: { code: true, reason: true, notes: true },
    }) : []
    const traTheoMa = new Map(phieuTra.map(p => [p.code, p]))

    // ── Thẻ kho của phiếu sửa: người làm (đang giữ) + lượt rút khi xoá phiếu ──
    const maSuaGiu = suaGiu.map(r => r.code)
    const theSua: any[] = maSuaGiu.length ? tran(await prisma.inventoryTransaction.findMany({
        where: { referenceType: 'repair', referenceId: { in: maSuaGiu } },
        select: { referenceId: true, userId: true, userName: true, createdAt: true, reason: true },
        orderBy: { createdAt: 'asc' }, take: TRAN,
    })) : []
    const rutKhiXoa: any[] = tran(await prisma.inventoryTransaction.findMany({
        where: { referenceType: 'repair', reason: { contains: 'rút khỏi kho hư hỏng' }, productId: { in: dsMa } },
        select: { productId: true, quantity: true, referenceId: true, userId: true, userName: true, createdAt: true, branchId: true },
        orderBy: { createdAt: 'desc' }, take: TRAN,
    }))

    // ── Phiếu sửa ĐÃ trả hàng khỏi kho hư hỏng (NCC trả / đổi mới xong) — lượt RA ──
    const suaDaTra: any[] = tran(await prisma.repair.findMany({
        where: {
            productId: { in: dsMa }, supplierReturnedAt: { not: null },
            OR: [{ stockMovedAt: { not: null } }, { replacedStockAt: { not: null } }],
        },
        select: { code: true, productId: true, quantity: true, issue: true, branchId: true, supplierReturnedAt: true, supplierName: true },
        orderBy: { supplierReturnedAt: 'desc' }, take: TRAN,
    }))

    // ── (4) Phiếu chuyển kho vào / ra ──
    const chuyen: any[] = tran(await prisma.stockTransfer.findMany({
        where: { status: 'completed', OR: [{ toWarehouseId: khoId }, { fromWarehouseId: khoId }] },
        select: {
            code: true, fromWarehouseId: true, toWarehouseId: true, reason: true, notes: true,
            userId: true, userName: true, createdAt: true,
            items: { select: { productId: true, quantity: true, notes: true } },
        },
        orderBy: { createdAt: 'desc' }, take: 1000,
    }), 1000)

    // ── (5) Kiểm kê riêng kho này ──
    const kiem: any[] = tran(await prisma.inventoryCount.findMany({
        where: { warehouseId: khoId, status: 'finalized', type: 'goods' },
        select: { code: true, finalizedAt: true, finalizedBy: true, notes: true, items: { select: { refId: true, variance: true, notes: true } } },
        orderBy: { finalizedAt: 'desc' }, take: 200,
    }), 200)

    // ── Lượt RA bằng /damaged-warehouse/xuat ──
    const xuat: any[] = tran(await prisma.damagedEntry.findMany({
        where: { warehouseId: khoId, loai: 'xuat', productId: { in: dsMa } },
        orderBy: { createdAt: 'desc' }, take: TRAN,
    }))

    // ── Tên người: tra một lượt theo userId (thẻ kho cũ ghi "Hệ thống" thay vì tên) ──
    const dsUser = new Set<string>()
    const them = (id?: string | null) => { if (id) dsUser.add(String(id)) }
    lo.forEach(l => them(l.userId)); theSua.forEach(t => them(t.userId)); traO.forEach(t => them(t.userId))
    rutKhiXoa.forEach(t => them(t.userId)); chuyen.forEach(c => them(c.userId)); kiem.forEach(k => them(k.finalizedBy))
    xuat.forEach(x => them(x.userId))
    const nguoiDung: any[] = dsUser.size ? await prisma.user.findMany({
        where: { id: { in: Array.from(dsUser) } }, select: { id: true, name: true, email: true },
    }) : []
    const tenTheoId = new Map(nguoiDung.map(u => [u.id, (u.name && String(u.name).trim()) || u.email]))
    /** Ưu tiên tên tra theo userId; userName chỉ dùng khi không phải chữ "Hệ thống" ghi cứng. */
    const ten = (userId?: string | null, userName?: string | null): string | null => {
        const theoId = userId ? tenTheoId.get(String(userId)) : null
        if (theoId) return theoId
        const n = String(userName || '').trim()
        return n && !/^hệ thống/i.test(n) ? n : null
    }

    // Phiếu sửa: người làm = dòng thẻ kho ghi lúc chuyển vào kho hư hỏng (dòng đầu tiên nếu không nhận ra)
    const nguoiSua = new Map<string, string | null>()
    for (const code of maSuaGiu) {
        const cac = theSua.filter(t => t.referenceId === code)
        const vao = cac.find(t => /kho hư hỏng|chuyển kho nội bộ/i.test(String(t.reason || ''))) || cac[0]
        nguoiSua.set(code, vao ? ten(vao.userId, vao.userName) : null)
    }

    const tenHang = new Map<string, { productName: string; sku: string | null }>()
    for (const r of [...ws, ...lo, ...suaGiu]) {
        if (!tenHang.has(r.productId)) tenHang.set(r.productId, { productName: r.productName || '', sku: r.productSku || null })
    }
    // Giá vốn + tồn bán được: màn hình xử lý / nhập báo trước hậu quả (cùng nếp app Android)
    const sanPham: any[] = await prisma.product.findMany({
        where: { id: { in: dsMa } },
        select: { id: true, name: true, sku: true, costPrice: true, stock: true, baseUnit: true },
    })
    const spTheoId = new Map(sanPham.map(p => [p.id, p]))

    const hang: HangKhoHu[] = []
    for (const pid of dsMa) {
        const ton = ws.find(x => x.productId === pid)?.quantity ?? 0
        const dong: DongKhoHu[] = []

        // (1) Lô nhập tay — gộp CÙNG nguồn + CÙNG lý do như /ton (chủ shop 04/09: "chung lí do thì nhập số lượng lại")
        const nhomLo = new Map<string, DongKhoHu & { _nguoi: Set<string> }>()
        for (const l of lo.filter(x => x.productId === pid)) {
            const khoa = `${l.nguon || ''}|${chuanLyDo(l.lyDo)}`
            const n = ten(l.userId, l.userName)
            const g = nhomLo.get(khoa)
            if (!g) {
                nhomLo.set(khoa, {
                    loai: 'lo', soLuong: l.conLai || 0, lyDo: l.lyDo || null, nguoi: n, luc: iso(l.createdAt),
                    maPhieu: null, ghiChu: l.ghiChu || null, nguonNhap: l.nguon || null, entryIds: [l.id],
                    _nguoi: new Set(n ? [n] : []),
                })
                continue
            }
            g.soLuong += l.conLai || 0
            g.entryIds!.push(l.id)
            if (!g.ghiChu && l.ghiChu) g.ghiChu = l.ghiChu
            if (n) g._nguoi.add(n)
        }
        for (const g of nhomLo.values()) {
            const { _nguoi, ...d } = g
            // Nhiều người cùng bỏ hàng vào một đống thì nói thật là nhiều người
            dong.push({ ...d, nguoi: _nguoi.size > 1 ? `${Array.from(_nguoi).slice(0, 2).join(', ')}${_nguoi.size > 2 ? '…' : ''}` : d.nguoi })
        }

        // (2) Phiếu sửa đang giữ hàng
        for (const r of suaGiu.filter(x => x.productId === pid)) {
            const mayKhach = !r.stockMovedAt && !!r.replacedStockAt
            dong.push({
                loai: 'sua', soLuong: Math.max(1, Number(r.quantity) || 1),
                lyDo: r.issue || null, nguoi: nguoiSua.get(r.code) ?? null,
                luc: iso(r.stockMovedAt || r.replacedStockAt), maPhieu: r.code,
                ghiChu: mayKhach ? `Máy hỏng của khách${r.customerName ? ` ${r.customerName}` : ''} (đổi mới)` : null,
            })
        }

        // Phần tồn chưa có nguồn chính xác → chia cho các lượt vào MỚI NHẤT trước
        let conLai = ton - dong.reduce((s, d) => s + d.soLuong, 0)
        if (conLai > 0) {
            const luotVao: DongKhoHu[] = []
            for (const t of traO.filter(x => x.productId === pid)) {
                const p = traTheoMa.get(t.referenceId)
                luotVao.push({
                    loai: 'tra', soLuong: Math.abs(Number(t.quantity) || 0),
                    lyDo: p?.reason ? `Khách trả: ${dichLyDoTraHang(p.reason)}` : 'Khách trả hàng — hư hỏng',
                    nguoi: ten(t.userId, t.userName), luc: iso(t.createdAt), maPhieu: t.referenceId || null,
                    ghiChu: dongNhanHangHoan(p?.notes),
                })
            }
            for (const c of chuyen.filter(x => x.toWarehouseId === khoId)) {
                for (const it of (c.items || []).filter((i: any) => i.productId === pid)) {
                    luotVao.push({
                        loai: 'chuyen', soLuong: Math.abs(Number(it.quantity) || 0),
                        lyDo: [LY_DO_CHUYEN[c.reason] || c.reason, c.notes].filter(Boolean).join(' — ') || 'Chuyển kho',
                        nguoi: ten(c.userId, c.userName), luc: iso(c.createdAt), maPhieu: c.code, ghiChu: it.notes || null,
                    })
                }
            }
            for (const k of kiem) {
                for (const it of (k.items || []).filter((i: any) => i.refId === pid && Number(i.variance) > 0)) {
                    luotVao.push({
                        loai: 'kiem-ke', soLuong: Math.round(Number(it.variance)),
                        lyDo: 'Kiểm kê thừa', nguoi: ten(k.finalizedBy, null), luc: iso(k.finalizedAt),
                        maPhieu: k.code, ghiChu: it.notes || k.notes || null,
                    })
                }
            }
            luotVao.sort((a, b) => String(b.luc || '').localeCompare(String(a.luc || '')))
            for (const v of luotVao) {
                if (conLai <= 0) break
                const lay = Math.min(conLai, v.soLuong)
                if (lay <= 0) continue
                dong.push({ ...v, soLuong: lay })
                conLai -= lay
            }
            if (conLai > 0) {
                dong.push({
                    loai: 'chua-ro', soLuong: conLai, lyDo: null, nguoi: null, luc: null, maPhieu: null,
                    ghiChu: 'Hàng vào kho trước khi có sổ ghi lý do, hoặc qua đường chưa ghi dấu',
                })
                conLai = 0
            }
        }
        const lech = ton - dong.reduce((s, d) => s + d.soLuong, 0)

        // Lệch / âm: kèm 5 lượt RA gần nhất — ai lấy ra, vì sao
        let ra: DongKhoHu[] = []
        if (lech < 0 || ton < 0) {
            for (const x of xuat.filter(e => e.productId === pid)) {
                ra.push({
                    loai: 'lo', soLuong: -Math.abs(Number(x.quantity) || 0), lyDo: x.lyDo || null,
                    nguoi: ten(x.userId, x.userName), luc: iso(x.createdAt), maPhieu: null,
                    ghiChu: x.ghiChu || null, cachXuLy: CACH_XU_LY[x.cachXuLy] || x.cachXuLy || null,
                })
            }
            for (const r of suaDaTra.filter(e => e.productId === pid)) {
                if ((await khoCua(r.branchId)) !== khoId) continue
                ra.push({
                    loai: 'sua', soLuong: -Math.max(1, Number(r.quantity) || 1), lyDo: r.issue || null,
                    nguoi: null, luc: iso(r.supplierReturnedAt), maPhieu: r.code,
                    ghiChu: r.supplierName ? `NCC ${r.supplierName} đã trả` : null, cachXuLy: 'NCC trả / đổi mới xong',
                })
            }
            for (const t of rutKhiXoa.filter(e => e.productId === pid)) {
                if ((await khoCua(t.branchId)) !== khoId) continue
                ra.push({
                    loai: 'sua', soLuong: -Math.abs(Number(t.quantity) || 0), lyDo: null,
                    nguoi: ten(t.userId, t.userName), luc: iso(t.createdAt), maPhieu: t.referenceId || null,
                    ghiChu: null, cachXuLy: 'Xoá phiếu sửa — rút khỏi kho',
                })
            }
            for (const c of chuyen.filter(x => x.fromWarehouseId === khoId)) {
                for (const it of (c.items || []).filter((i: any) => i.productId === pid)) {
                    ra.push({
                        loai: 'chuyen', soLuong: -Math.abs(Number(it.quantity) || 0),
                        lyDo: [LY_DO_CHUYEN[c.reason] || c.reason, c.notes].filter(Boolean).join(' — ') || null,
                        nguoi: ten(c.userId, c.userName), luc: iso(c.createdAt), maPhieu: c.code,
                        ghiChu: it.notes || null, cachXuLy: 'Chuyển đi',
                    })
                }
            }
            for (const k of kiem) {
                for (const it of (k.items || []).filter((i: any) => i.refId === pid && Number(i.variance) < 0)) {
                    ra.push({
                        loai: 'kiem-ke', soLuong: Math.round(Number(it.variance)), lyDo: 'Kiểm kê thiếu',
                        nguoi: ten(k.finalizedBy, null), luc: iso(k.finalizedAt), maPhieu: k.code,
                        ghiChu: it.notes || k.notes || null, cachXuLy: 'Kiểm kê',
                    })
                }
            }
            ra = ra.sort((a, b) => String(b.luc || '').localeCompare(String(a.luc || ''))).slice(0, 5)
        }

        const t = tenHang.get(pid)
        const p = spTheoId.get(pid)
        hang.push({
            productId: pid, productName: t?.productName || p?.name || '', sku: t?.sku || p?.sku || null, ton, dong, lech, ra,
            giaVon: Number(p?.costPrice ?? 0), tonBanDuoc: Number(p?.stock ?? 0), donVi: p?.baseUnit ?? null,
        })
    }

    // Mã lệch / âm xuống cuối; còn lại theo tên
    hang.sort((a, b) => Number(a.lech < 0 || a.ton < 0) - Number(b.lech < 0 || b.ton < 0)
        || a.productName.localeCompare(b.productName, 'vi'))

    const tatCaDong = hang.flatMap(h => h.dong)
    return {
        hang,
        tong: {
            soMa: hang.filter(h => h.ton !== 0).length,
            soLuong: hang.reduce((s, h) => s + h.ton, 0),
            coLyDo: tatCaDong.filter(d => d.loai !== 'chua-ro').reduce((s, d) => s + d.soLuong, 0),
            chuaRo: tatCaDong.filter(d => d.loai === 'chua-ro').reduce((s, d) => s + d.soLuong, 0),
            soMaAm: hang.filter(h => h.ton < 0).length,
            tongAm: hang.filter(h => h.ton < 0).reduce((s, h) => s + h.ton, 0),
            soMaLech: hang.filter(h => h.lech < 0).length,
        },
        chamTran,
    }
}
