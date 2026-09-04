// ─────────────────────────────────────────────────────────────────────────────
//  KHO HƯ HỎNG — /api/damaged-warehouse   (04/09/2026)
//
//  Chủ shop: "thêm tính năng nhập hàng vào kho hư hỏng trong phần Bảo hành và bảo
//  trì. Sẽ nhập, có nút chọn nhập từ kho và không qua kho (nhập từ kho thì sẽ trừ
//  tồn kho chính, còn không qua kho là không trừ tồn kho chính). Và trong tồn kho hư
//  hỏng thì có thể cập nhật bán tiếp (cộng vào kho chính), sửa chữa xong (cộng thêm
//  phí sửa chữa) và cộng vào kho chính (có chỗ chọn nhập vào mã cũ hoặc mã mới) giá
//  vốn nó sẽ có thêm phí sửa chữa nữa nha".
//
//    GET  /api/damaged-warehouse/ton      tồn kho hư hỏng
//    GET  /api/damaged-warehouse/nhat-ky  lịch sử nhập/xuất
//    POST /api/damaged-warehouse/nhap     đưa hàng VÀO kho hư hỏng
//    POST /api/damaged-warehouse/xuat     đưa hàng RA (bán tiếp / sửa xong / huỷ)
//
//  ─── BA ĐIỀU CỐ Ý, MỖI ĐIỀU CHẶN MỘT KIỂU HỎNG THẬT ───────────────────────────
//
//  1. GIÁ VỐN NHẬP LẠI MÃ CŨ PHẢI BÌNH QUÂN GIA QUYỀN, không được gán đè.
//     Mã đang có 100 cái giá vốn 200k; sửa xong 2 cái hết 50k/cái rồi gán
//     costPrice = 250k là 100 cái kia BỖNG DƯNG đắt thêm 50k mỗi cái — lãi gộp
//     của mọi đơn bán sau đó sai, âm thầm. Phải:
//         (tồn cũ × giá cũ + số nhập × giá nhập) / (tồn cũ + số nhập)
//
//  2. "KHÔNG QUA KHO" TUYỆT ĐỐI KHÔNG ĐỤNG TỒN KHO CHÍNH. Hàng khách mang tới,
//     hàng nhà cung cấp đền — nó chưa từng nằm trong tồn của mình. Trừ đi là tồn
//     kho chính âm dần mà không ai hiểu vì sao.
//
//  3. TRỪ TỒN KHO CHÍNH PHẢI ĐI QUA `adjustSellableStock`. Bất biến của dự án là
//     `WarehouseStock[kho main] == Product.stock`; sửa thẳng một vế là gãy bất
//     biến trong im lặng, phải chạy /inventory/reindex mới lòi ra.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Response } from 'express'
import { authMiddleware, AuthRequest, getBranchId } from '../middleware/auth'
import { requirePermission } from '../middleware/permissionMiddleware'
import { guiLoi } from '../lib/errorResponse'
import { khoHuHong, updateWarehouseStock, adjustSellableStock } from '../lib/warehouseHelper'

const router = Router()

const QUYEN_XEM = ['damaged_warehouse.view', 'inventory.view'] as const
const QUYEN_SUA = ['damaged_warehouse.edit', 'damaged_warehouse.view', 'inventory.adjust'] as const

/** Kho hư hỏng của chi nhánh đang xem; chưa có thì báo rõ chứ đừng tạo bừa. */
async function layKho(req: AuthRequest): Promise<string | null> {
    return khoHuHong(req.storePrisma as any, getBranchId(req) || null)
}

// ─── GET /ton — TỪNG LÔ, không gom theo mã ───────────────────────────────────
router.get('/ton', authMiddleware, requirePermission(...QUYEN_XEM), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const khoId = await layKho(req)
        if (!khoId) { res.json({ success: true, data: { khoId: null, items: [], thieuKho: true } }); return }

        /* MỖI LƯỢT NHẬP LÀ MỘT LÔ (04/09/2026 — chủ shop: "mỗi hàng hư sẽ mỗi kiểu,
         * không giống nhau được"). 5 cái Samsung hư không phải một cục: cái vỡ màn,
         * cái vào nước — lý do và phí sửa khác nhau. Trả về từng lô kèm lý do của
         * chính nó, thay vì một dòng tổng vô danh. */
        const lo = await prisma.damagedEntry.findMany({
            where: { warehouseId: khoId, loai: 'nhap', conLai: { gt: 0 } },
            orderBy: { createdAt: 'desc' },
            take: 500,
        })

        /* TỒN CŨ CHƯA CÓ LÔ. Hàng vào kho hư hỏng từ trước khi có bảng lô (qua phiếu
         * sửa chữa, trả hàng…) không có dòng NHẬP nào. Bỏ qua là chúng biến mất khỏi
         * màn hình dù vẫn nằm trong kho — nên gom phần chênh thành một lô "cũ" cho
         * mỗi mã, vẫn xử lý được, chỉ là không có lý do đi kèm. */
        const tonKho = await prisma.warehouseStock.findMany({
            where: { warehouseId: khoId, quantity: { gt: 0 } }, take: 1000,
        })
        const daCoLo = new Map<string, number>()
        for (const l of lo) daCoLo.set(l.productId, (daCoLo.get(l.productId) || 0) + (l.conLai || 0))

        const dsMa = Array.from(new Set([
            ...lo.map((x: any) => x.productId),
            ...tonKho.map((x: any) => x.productId),
        ]))
        const hang = dsMa.length
            ? await prisma.product.findMany({
                where: { id: { in: dsMa } },
                select: { id: true, costPrice: true, stock: true, sku: true, name: true, baseUnit: true },
            })
            : []
        const theoMa = new Map(hang.map((h: any) => [h.id, h]))
        const chiTiet = (pid: string) => theoMa.get(pid) as any

        const items = lo.map((l: any) => {
            const h = chiTiet(l.productId)
            return {
                id: l.id, laLoCu: false,
                productId: l.productId,
                productName: l.productName || h?.name || '',
                productSku: l.productSku || h?.sku || null,
                quantity: l.conLai || 0,
                soLuongNhap: l.quantity,
                nguon: l.nguon || null,
                lyDo: l.lyDo || null,
                ghiChu: l.ghiChu || null,
                ngayNhap: l.createdAt,
                nguoiNhap: l.userName || null,
                donVi: h?.baseUnit || null,
                giaVonHienTai: h?.costPrice ?? 0,
                tonKhoChinh: h?.stock ?? 0,
            }
        })

        for (const t of tonKho) {
            const con = (t.quantity || 0) - (daCoLo.get(t.productId) || 0)
            if (con <= 0) continue
            const h = chiTiet(t.productId)
            items.push({
                id: `cu:${t.productId}`, laLoCu: true,
                productId: t.productId,
                productName: t.productName || h?.name || '',
                productSku: t.productSku || h?.sku || null,
                quantity: con,
                soLuongNhap: con,
                nguon: null,
                lyDo: null,
                ghiChu: null,
                ngayNhap: t.updatedAt,
                nguoiNhap: null,
                donVi: h?.baseUnit || null,
                giaVonHienTai: h?.costPrice ?? 0,
                tonKhoChinh: h?.stock ?? 0,
            })
        }

        res.json({
            success: true,
            data: { khoId, items, chamTran: lo.length >= 500 || tonKho.length >= 1000 },
        })
    } catch (err: any) { guiLoi(res, err, 'GET /damaged-warehouse/ton lỗi:') }
})

// ─── GET /nhat-ky ────────────────────────────────────────────────────────────
router.get('/nhat-ky', authMiddleware, requirePermission(...QUYEN_XEM), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const soNgay = Math.min(180, Math.max(1, Number(req.query.ngay) || 30))
        const tu = new Date(Date.now() - soNgay * 86400_000)
        const ds = await prisma.damagedEntry.findMany({
            where: { createdAt: { gte: tu } },
            orderBy: { createdAt: 'desc' },
            take: 500,
        })
        res.json({ success: true, data: { soNgay, items: ds, chamTran: ds.length >= 500 } })
    } catch (err: any) { guiLoi(res, err, 'GET /damaged-warehouse/nhat-ky lỗi:') }
})

// ─── POST /nhap — đưa hàng VÀO kho hư hỏng ───────────────────────────────────
router.post('/nhap', authMiddleware, requirePermission(...QUYEN_SUA), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const b = req.body || {}
        const productId = String(b.productId || '').trim()
        const quantity = Math.floor(Number(b.quantity) || 0)
        const nguon = String(b.nguon || 'tu-kho')

        if (!productId) { res.status(400).json({ success: false, error: 'Chưa chọn mặt hàng' }); return }
        if (quantity <= 0) { res.status(400).json({ success: false, error: 'Số lượng phải lớn hơn 0' }); return }
        if (nguon !== 'tu-kho' && nguon !== 'ngoai') {
            res.status(400).json({ success: false, error: "nguon phải là 'tu-kho' hoặc 'ngoai'" }); return
        }

        const hang = await prisma.product.findUnique({
            where: { id: productId }, select: { id: true, name: true, sku: true, stock: true },
        })
        if (!hang) { res.status(404).json({ success: false, error: 'Không tìm thấy mặt hàng' }); return }

        const khoId = await layKho(req)
        if (!khoId) {
            res.status(400).json({ success: false, error: 'Cửa hàng chưa có kho hư hỏng — tạo kho loại "damaged" trước' })
            return
        }
        const branchId = getBranchId(req) || null

        /* NHẬP TỪ KHO thì tồn kho chính phải ĐỦ. Cho âm ở đây là tồn kho chính tụt
         * xuống dưới 0 mà không ai chủ ý — khác hẳn bán âm (có công tắc riêng và
         * người bán biết mình đang làm gì). */
        if (nguon === 'tu-kho' && (hang.stock ?? 0) < quantity) {
            res.status(400).json({
                success: false,
                error: `Tồn kho chính chỉ còn ${hang.stock ?? 0} — không đủ ${quantity}. Chọn "Không qua kho" nếu hàng này không lấy từ tồn.`,
            })
            return
        }

        const ketQua = await prisma.$transaction(async (tx: any) => {
            // Vào kho hư hỏng
            await updateWarehouseStock(tx, khoId, productId, quantity)
            // Ra khỏi tồn bán được — CHỈ khi lấy từ kho
            if (nguon === 'tu-kho') {
                await adjustSellableStock(tx, productId, branchId, -quantity, 'nhap-kho-hu-hong')
            }
            return tx.damagedEntry.create({
                data: {
                    warehouseId: khoId, loai: 'nhap', productId,
                    productName: hang.name, productSku: hang.sku,
                    quantity, nguon,
                    // Lô mới vào thì còn nguyên; xử tới đâu trừ tới đó
                    conLai: quantity,
                    lyDo: b.lyDo ? String(b.lyDo).slice(0, 500) : null,
                    ghiChu: b.ghiChu ? String(b.ghiChu).slice(0, 1000) : null,
                    branchId,
                    userId: req.user?.userId || null,
                    userName: (req.user as any)?.name || req.user?.email || null,
                },
            })
        })

        res.status(201).json({
            success: true,
            data: {
                entry: ketQua,
                daTruTonKhoChinh: nguon === 'tu-kho',
                ghiChu: nguon === 'tu-kho'
                    ? `Đã trừ ${quantity} khỏi tồn kho chính`
                    : 'KHÔNG đụng tồn kho chính (hàng không lấy từ tồn)',
            },
        })
    } catch (err: any) { guiLoi(res, err, 'POST /damaged-warehouse/nhap lỗi:') }
})

// ─── POST /xuat — bán tiếp / sửa xong / huỷ ──────────────────────────────────
router.post('/xuat', authMiddleware, requirePermission(...QUYEN_SUA), async (req: AuthRequest, res: Response) => {
    try {
        const prisma: any = req.storePrisma!
        const b = req.body || {}
        const productId = String(b.productId || '').trim()
        /* XỬ THEO LÔ (04/09/2026). `entryId` chỉ đích danh lô nào — vì mỗi lô có lý
         * do và phí sửa riêng, xử "5 cái Samsung" chung một lượt là mất hết phần đó.
         * Thiếu entryId thì vẫn chạy như cũ (trừ theo mã) để lô cũ chưa có bản ghi
         * nhập vẫn xử được. */
        const entryId = b.entryId ? String(b.entryId).trim() : null
        const quantity = Math.floor(Number(b.quantity) || 0)
        const cachXuLy = String(b.cachXuLy || '')
        const phiSuaChua = Math.max(0, Math.round(Number(b.phiSuaChua) || 0))
        const productDichId = b.productDichId ? String(b.productDichId).trim() : null

        if (!productId) { res.status(400).json({ success: false, error: 'Chưa chọn mặt hàng' }); return }
        if (quantity <= 0) { res.status(400).json({ success: false, error: 'Số lượng phải lớn hơn 0' }); return }
        if (!['ban-tiep', 'sua-xong', 'huy'].includes(cachXuLy)) {
            res.status(400).json({ success: false, error: "cachXuLy phải là 'ban-tiep', 'sua-xong' hoặc 'huy'" }); return
        }
        /* Phí sửa chữa chỉ có nghĩa với "sửa xong". Nhận phí cho "bán tiếp" rồi âm
         * thầm cộng vào giá vốn là đội giá vốn mà người bấm không hề chọn sửa. */
        if (cachXuLy !== 'sua-xong' && phiSuaChua > 0) {
            res.status(400).json({ success: false, error: 'Phí sửa chữa chỉ dùng cho "Sửa chữa xong"' }); return
        }

        const khoId = await layKho(req)
        if (!khoId) { res.status(400).json({ success: false, error: 'Cửa hàng chưa có kho hư hỏng' }); return }

        /* Lô chỉ định thì phải còn đủ TRONG LÔ ĐÓ, không mượn của lô khác — mượn
         * là phí sửa và lý do bị gán nhầm sang lô không liên quan. */
        let lo: any = null
        if (entryId && !entryId.startsWith('cu:')) {
            lo = await prisma.damagedEntry.findUnique({ where: { id: entryId } }).catch(() => null)
            if (!lo || lo.loai !== 'nhap') {
                res.status(404).json({ success: false, error: 'Không tìm thấy lô hàng này — tải lại danh sách' }); return
            }
            if ((lo.conLai ?? 0) < quantity) {
                res.status(400).json({
                    success: false,
                    error: `Lô này chỉ còn ${lo.conLai ?? 0} — không đủ ${quantity}`,
                })
                return
            }
        }

        const ton = await prisma.warehouseStock.findUnique({
            where: { warehouseId_productId: { warehouseId: khoId, productId } },
        }).catch(() => null)
        if (!ton || ton.quantity < quantity) {
            res.status(400).json({
                success: false,
                error: `Kho hư hỏng chỉ còn ${ton?.quantity ?? 0} — không đủ ${quantity}`,
            })
            return
        }

        const nguon = await prisma.product.findUnique({
            where: { id: productId }, select: { id: true, name: true, sku: true, costPrice: true },
        })
        if (!nguon) { res.status(404).json({ success: false, error: 'Không tìm thấy mặt hàng' }); return }

        // Mã ĐÍCH khi nhập lại kho chính: mặc định về đúng mã cũ
        const maDich = productDichId || productId
        const dich = maDich === productId ? nguon : await prisma.product.findUnique({
            where: { id: maDich }, select: { id: true, name: true, sku: true, costPrice: true, stock: true },
        })
        if (!dich) { res.status(404).json({ success: false, error: 'Không tìm thấy mã đích để nhập lại' }); return }

        const branchId = getBranchId(req) || null
        const veKhoChinh = cachXuLy !== 'huy'
        const phiMoiCai = quantity > 0 ? phiSuaChua / quantity : 0
        /* Giá vốn MỘT CÁI hàng nhập lại = giá vốn gốc của mã hư hỏng + phí sửa mỗi cái.
         * Dùng giá vốn của mã NGUỒN chứ không của mã đích: hàng vốn là mã nguồn, sửa
         * xong đổi tên gọi thì giá trị vẫn đi theo cái đã bỏ ra cho nó. */
        const giaVonNhap = Math.round((nguon.costPrice ?? 0) + phiMoiCai)

        const ketQua = await prisma.$transaction(async (tx: any) => {
            // Ra khỏi kho hư hỏng
            await updateWarehouseStock(tx, khoId, productId, -quantity)

            let giaVonSau: number | null = null
            if (veKhoChinh) {
                /* ── BÌNH QUÂN GIA QUYỀN, KHÔNG GÁN ĐÈ ──
                 * Mã đích đang có `tonCu` cái ở giá `giaCu`. Nhập thêm `quantity` cái ở
                 * giá `giaVonNhap`. Gán đè `costPrice = giaVonNhap` là toàn bộ tồn cũ
                 * bỗng đổi giá vốn — lãi gộp của mọi đơn bán sau đó sai, âm thầm. */
                const tonCu = Math.max(0, Number((dich as any).stock ?? 0))
                const giaCu = Number(dich.costPrice ?? 0)
                giaVonSau = (tonCu + quantity) > 0
                    ? Math.round((tonCu * giaCu + quantity * giaVonNhap) / (tonCu + quantity))
                    : giaVonNhap

                await adjustSellableStock(tx, maDich, branchId, quantity, 'xuat-kho-hu-hong')
                await tx.product.update({ where: { id: maDich }, data: { costPrice: giaVonSau } })
            }

            // Trừ dần lô nguồn; hết thì lô tự biến khỏi danh sách (điều kiện conLai > 0)
            if (lo) {
                await tx.damagedEntry.update({
                    where: { id: lo.id },
                    data: { conLai: { decrement: quantity } },
                })
            }

            const entry = await tx.damagedEntry.create({
                data: {
                    warehouseId: khoId, loai: 'xuat', productId,
                    nguonEntryId: lo?.id ?? null,
                    productName: nguon.name, productSku: nguon.sku,
                    quantity, cachXuLy, phiSuaChua,
                    productDichId: maDich === productId ? null : maDich,
                    giaVonMoi: veKhoChinh ? giaVonNhap : null,
                    lyDo: b.lyDo ? String(b.lyDo).slice(0, 500) : null,
                    ghiChu: b.ghiChu ? String(b.ghiChu).slice(0, 1000) : null,
                    branchId,
                    userId: req.user?.userId || null,
                    userName: (req.user as any)?.name || req.user?.email || null,
                },
            })
            return { entry, giaVonSau }
        })

        res.status(201).json({
            success: true,
            data: {
                entry: ketQua.entry,
                veKhoChinh,
                maDich: maDich === productId ? null : { id: dich.id, sku: dich.sku, name: dich.name },
                giaVonMoiMoiCai: veKhoChinh ? giaVonNhap : null,
                giaVonSauBinhQuan: ketQua.giaVonSau,
                ghiChu: veKhoChinh
                    ? `Đã cộng ${quantity} vào tồn kho chính của ${dich.sku || dich.name}`
                    : 'Huỷ hàng — KHÔNG cộng vào tồn kho chính',
            },
        })
    } catch (err: any) { guiLoi(res, err, 'POST /damaged-warehouse/xuat lỗi:') }
})

export default router
