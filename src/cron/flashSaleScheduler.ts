import { registryPrisma, getStorePrisma } from '../lib/prisma'
import { chayNeuLanhDao } from '../lib/leaderLock'
import { ensureFlashSaleTable, shopeeServiceFromChannel, shopeeServiceTokenMoi } from '../routes/flashSales'
import { tonSanPham, docDieuKienTheoNganh, phanTramGiam, docGiaKhuyenMai, giaHienThi, type DieuKienFlashSale, type GiaKhuyenMai } from '../lib/flashSaleKiemGia'

/**
 * FLASH SALE SCHEDULER — chạy ngầm mỗi 3 phút, đảm bảo TUẦN TỰ:
 * "hết flash sale này mới tới flash sale sau".
 *
 * Vì sao: Shopee giữ tồn campaign ngay khi add item → tạo trước cả loạt là kho
 * bị giam nhiều lần. Nên plan nằm ở hàng đợi local; mỗi tick:
 *   1. active hết giờ (endTime < now) → 'ended' (Shopee tự nhả tồn còn lại).
 *   2. Kênh KHÔNG còn active → lấy plan queued kế tiếp (position):
 *      - Lỡ khung giờ (startTime <= now+2') → 'skipped'.
 *      - Còn kịp → create_shop_flash_sale + get_model_list từng item (build
 *        models với giá KM = giá gốc * (1-%)) + add items + enable → 'active'.
 *      - Lỗi → attempts+1, quá 3 lần → 'failed' (thử plan sau ở tick kế).
 */

const TICK_MS = 3 * 60_000
const MAX_ATTEMPTS = 3
let timer: NodeJS.Timeout | null = null
let running = false

function roundPrice(v: number): number {
    // Giá VND — làm tròn xuống trăm đồng cho sạch số
    return Math.max(100, Math.floor(v / 100) * 100)
}

// `service` mặc định là Shopee thật của kênh; bộ kiểm chứng (scripts/check-flash-sale.ts) truyền Shopee giả
async function activatePlan(prisma: any, plan: any, channel: any, service: any = shopeeServiceFromChannel(channel)): Promise<void> {
    const pct = Number(plan.discountPercent) || 0
    const stockPer = Math.max(1, Number(plan.stockPerItem) || 1)
    const limit = Math.max(0, Number(plan.purchaseLimit) || 0)
    const items: any[] = Array.isArray(plan.items) ? plan.items : JSON.parse(plan.items || '[]')

    /* ĐỢT DỞ TỪ LƯỢT TRƯỚC (15/10/2026): lượt trước đã tạo đợt trên Shopee rồi đứt (mất CSDL — log có P1001 —, máy tắt) trước
     * khi ghi 'active' ⇒ lượt này KHÔNG được tạo đợt thứ hai (hai đợt = giam tồn hai lần, phá luật tuần tự).
     * Đợt cũ đã bật + có hàng ⇒ nhận lại làm đợt đang chạy. Chưa bật / rỗng ⇒ xoá rồi làm lại. Không đọc được mà cũng không
     * xoá được ⇒ ném lỗi, giữ id cho lượt sau — thà chậm còn hơn hai đợt. */
    if (plan.shopeeFlashSaleId) {
        const idCu = Number(plan.shopeeFlashSaleId)
        let cu: any = null, loiDoc = ''
        try { cu = await service.flashSaleGet(idCu) } catch (e: any) { loiDoc = String(e?.message || e) }
        if (cu && Number(cu.status) === 1 && Number(cu.item_count) > 0) {
            await prisma.$executeRawUnsafe(
                `UPDATE "FlashSalePlan" SET status='active', error=NULL, "updatedAt"=now() WHERE id=$1 AND status='dang_kich_hoat'`, plan.id)
            console.log(`[FlashSale] Nhận lại đợt Shopee #${idCu} đã bật từ lượt bị đứt trước (plan ${plan.id})`)
            return
        }
        if (!cu || Number(cu.status) !== 0) { // status 0 = đã xoá
            try { await service.flashSaleDelete(idCu) } catch (e: any) {
                throw new Error(`Đợt dở #${idCu} từ lượt trước chưa dọn được${loiDoc ? ` (đọc: ${loiDoc.slice(0, 120)})` : ''}: ${String(e?.message || e).slice(0, 160)}`)
            }
        }
        await prisma.$executeRawUnsafe(`UPDATE "FlashSalePlan" SET "shopeeFlashSaleId"=NULL, "updatedAt"=now() WHERE id=$1`, plan.id)
        if (new Date(plan.startTime).getTime() <= Date.now() + 2 * 60_000) {
            await prisma.$executeRawUnsafe(
                `UPDATE "FlashSalePlan" SET status='skipped', error='Lỡ khung giờ — lượt trước bị đứt giữa chừng, đợt dở đã xoá trên Shopee', "updatedAt"=now() WHERE id=$1 AND status='dang_kich_hoat'`, plan.id)
            return
        }
    }

    /* CHUẨN BỊ TRƯỚC KHI TẠO ĐỢT (15/10/2026): đọc giá/tồn sống + điều kiện flash sale của gian; không mã nào đạt ⇒ báo lỗi
     * ngay, KHÔNG tạo đợt trên Shopee (bản trước tạo đợt rồi mới biết hỏng ⇒ mỗi lượt thử tạo + xoá một đợt vô ích). */
    const { shopeeItems, boQua } = await chuanBiHang(service, items, pct, stockPer, limit, plan.kieuGia === 'tru-1d')
    if (!shopeeItems.length) throw loiKhongMaNao(boQua)

    const flashSaleId = await service.flashSaleCreate(Number(plan.timeslotId))
    /* Ghi NGAY id đợt vừa tạo: đứt ở bất kỳ bước nào sau đây thì lượt thử lại biết mà dọn / nhận lại (khối trên).
     * Không còn ở 'dang_kich_hoat' (chủ shop huỷ đúng lúc máy đang đẩy) ⇒ xoá đợt vừa tạo, dừng. */
    const giu: any[] = await prisma.$queryRawUnsafe(
        `UPDATE "FlashSalePlan" SET "shopeeFlashSaleId"=$1, "updatedAt"=now() WHERE id=$2 AND status='dang_kich_hoat' RETURNING id`, flashSaleId, plan.id)
    if (!giu.length) {
        try { await service.flashSaleDelete(flashSaleId) } catch { /* rỗng, chưa bật — xoá được; hỏng thì Shopee tự hết hạn */ }
        console.warn(`[FlashSale] Plan ${plan.id} bị huỷ trong lúc đang đẩy — đã xoá đợt Shopee #${flashSaleId} vừa tạo`)
        return
    }
    /* Hỏng ở bước SAU khi đã tạo trên Shopee (lấy model, thêm item, bật) ⇒ xoá đợt vừa tạo rồi mới báo lỗi (15/10/2026):
     * để lại thì Shopee giữ một đợt rỗng, lượt thử lại tạo thêm đợt rỗng nữa. */
    let failedItems: any[] = []
    let soItem = 0
    let chamTran = false
    try {
        const r = await themVaBat(service, flashSaleId, shopeeItems)
        failedItems = [...boQua, ...r.failedItems]
        soItem = r.soItem
        chamTran = r.chamTran
    } catch (e) {
        let daXoa = false
        try { await service.flashSaleDelete(flashSaleId); daXoa = true } catch { /* đợt đã bật/đang chạy thì không xoá được */ }
        // Xoá được thì bỏ id (lượt sau tạo mới sạch); xoá hỏng thì GIỮ id để lượt sau dọn tiếp chứ không tạo đợt thứ hai
        if (daXoa) await prisma.$executeRawUnsafe(`UPDATE "FlashSalePlan" SET "shopeeFlashSaleId"=NULL WHERE id=$1`, plan.id).catch(() => {})
        throw e
    }

    const ghi: any[] = await prisma.$queryRawUnsafe(
        `UPDATE "FlashSalePlan"
         SET status='active', "shopeeFlashSaleId"=$1, "failedItems"=$2::jsonb, error=NULL, "updatedAt"=now()
         WHERE id=$3 AND status='dang_kich_hoat' RETURNING id`,
        flashSaleId, JSON.stringify(failedItems), plan.id
    )
    if (!ghi.length) {
        // Chủ shop huỷ trong lúc máy đang đẩy (màn hình còn hiện "chờ") ⇒ gỡ đợt vừa bật, đừng để nó giam tồn
        try { await service.flashSaleUpdateStatus(flashSaleId, 2) } catch { /* noop */ }
        try { await service.flashSaleDelete(flashSaleId) } catch { /* noop */ }
        console.warn(`[FlashSale] Plan ${plan.id} bị huỷ trong lúc đang đẩy — đã tắt + xoá đợt Shopee #${flashSaleId}`)
        return
    }
    console.log(`[FlashSale] Kích hoạt "${plan.title}" (${plan.id}) → Shopee #${flashSaleId}, ${soItem}/${shopeeItems.length} mã vào đợt` +
        ` (${failedItems.length} dòng không vào — bỏ qua hoặc Shopee từ chối)${chamTran ? ` — CHẠM TRẦN số mã/đợt của Shopee ở ${soItem} mã` : ''}`)
}

/** Lỗi chắc chắn (giá/tồn không đạt điều kiện Shopee) — thử lại cũng vậy ⇒ plan 'failed' ngay, khỏi đọc Shopee thêm 2 lượt. */
class LoiKhongThuLai extends Error {}

/* Gom lý do theo NHÓM, nhóm quan trọng trước (15/10: liệt kê 5 mã đầu thì toàn "hết tồn", che mất lý do chính "giá chưa giảm
 * đủ 5%" của 24 mã còn hàng). Hết hàng chỉ đếm; nhóm khác kèm một ví dụ nguyên văn. */
const NHOM_LY_DO: [string, RegExp, string][] = [
    ['gia', /Shopee đòi|Shopee cho tối đa/, 'giá chưa đạt mức giảm của Shopee'],
    ['ton', /tồn campaign/, 'tồn campaign dưới mức tối thiểu của Shopee'],
    ['doc', /^Không đọc được|không trả/i, 'không đọc được trên Shopee'],
    ['het', /hết tồn/i, 'hết hàng'],
]
const loiKhongMaNao = (boQua: any[]) => {
    const ds = boQua.filter(b => !b.motPhan)
    const theoNhom = new Map<string, any[]>()
    for (const b of ds) {
        const m = String(b.err_msg || '')
        const k = NHOM_LY_DO.find(([, re]) => re.test(m))?.[0] || 'khac'
        theoNhom.set(k, [...(theoNhom.get(k) || []), b])
    }
    const ten = (k: string) => NHOM_LY_DO.find(([id]) => id === k)?.[2] || 'lý do khác'
    const phan = ['gia', 'ton', 'doc', 'khac', 'het'].filter(k => theoNhom.has(k)).map(k => {
        const v = theoNhom.get(k)!
        return k === 'het' ? `${v.length} mã hết hàng` : `${v.length} mã ${ten(k)} (vd ${v[0].name || v[0].item_id}: ${v[0].err_msg})`
    })
    const thongBao = `Không có mã nào gửi được — ${phan.join(' · ')}`.slice(0, 600)
    // Có mã hỏng vì ĐỌC không được (mạng, Shopee lỗi) ⇒ còn hy vọng ở lượt sau; toàn lý do giá/tồn ⇒ dừng luôn
    return theoNhom.has('doc') ? new Error(thongBao) : new LoiKhongThuLai(thongBao)
}

/* ─── BƯỚC 1 · CHUẨN BỊ — chỉ ĐỌC Shopee, chưa đụng đợt nào ──────────────────────────────────────────────────────── */
/** Dựng payload từng mã từ giá + tồn SỐNG và điều kiện flash sale của gian. Mã/phân loại không gửi được ⇒ `boQua` kèm lý do. */
async function chuanBiHang(service: any, items: any[], pct: number, stockPer: number, limit: number, tru1d = false): Promise<{ shopeeItems: any[]; boQua: any[] }> {
    const shopeeItems: any[] = []
    /* Mã KHÔNG gửi lên Shopee + lý do (15/10/2026). Trước đây bỏ im lặng ⇒ chủ shop chọn 30 mã, đợt chỉ có 22 mà không ai biết
     * vì sao. Nay gộp vào failedItems (cùng dạng err_msg với mã Shopee từ chối) để tab Hàng đợi hiện ra.
     * `motPhan: true` = mã vẫn vào đợt, chỉ bỏ bớt vài phân loại. */
    const boQua: any[] = []
    /* Giá + tồn SỐNG trên Shopee lúc đẩy (15/10/2026): plan nằm hàng đợi hàng giờ, giá đang bán có thể đã đổi — số FE gửi lúc
     * xếp chỉ là dự phòng khi Shopee không trả. `has_model` cho biết CHẮC mã có phân loại không (khỏi đoán khi get_model_list lỗi).
     * (Đo 15/10: tồn đồng bộ OnlineProduct.stock = 0 cho cả 50 mã Kengi Electric trong khi 24 mã còn hàng — đừng tin số FE gửi.) */
    const coSo = new Map<number, any>()
    const ids = [...new Set(items.map(it => Number(it.itemId)).filter(n => n > 0))]
    for (let i = 0; i < ids.length; i += 50) {
        try { for (const x of await service.getItemBaseInfo(ids.slice(i, i + 50))) coSo.set(Number(x.item_id), x) } catch { /* thiếu thì dùng số FE gửi */ }
    }
    /* ĐIỀU KIỆN FLASH SALE của gian (get_item_criteria): giảm tối thiểu/tối đa so với GIÁ GỐC + tồn campaign, theo ngành. Đo
     * 15/10 cả 3 gian: giảm 5–90%. Soát ở đây ⇒ mã chắc chắn bị từ chối thì bỏ kèm lý do, không tạo đợt hỏng trên Shopee (lần
     * đẩy thật đầu tiên — Kengi Electric — 24/24 mã còn hàng bán đúng giá gốc ⇒ −1đ = giảm 0%). Không đọc được điều kiện ⇒
     * không soát, để Shopee quyết. */
    let theoNganh: Map<number, DieuKienFlashSale> | null = null
    try { theoNganh = await docDieuKienTheoNganh(service) } catch { theoNganh = null }
    /* "Giá là giá đang hiển thị" (chủ shop 15/10/2026): −1đ tính từ giá người mua đang thấy = min(current_price, giá chương
     * trình ĐANG CHẠY trên mã/phân loại). Không đọc được chương trình ⇒ dùng current_price. */
    let km: Map<string, GiaKhuyenMai> | null = null
    if (tru1d) { try { km = await docGiaKhuyenMai(service, ids) } catch { km = null } }

    for (const it of items) {
        const itemId = Number(it.itemId)
        if (!itemId) { boQua.push({ item_id: it.itemId ?? null, name: it.name, err_msg: 'Thiếu mã sản phẩm trên sàn' }); continue }
        // Giá KM: user điền giá cụ thể (promoPrice) thì ưu tiên; không thì tính
        // theo %. Giá phải < giá gốc model → kẹp trần ở 95% giá model.
        const override = Number(it.promoPrice) || 0
        const promoFor = (basePrice: number) => {
            const byPct = basePrice * (1 - pct / 100)
            const raw = override > 0 ? Math.min(override, basePrice * 0.95) : byPct
            return roundPrice(raw)
        }
        /* "Giá đang bán − 1đ" (chủ shop 15/10/2026): giá ĐANG BÁN của từng phân loại trừ đúng 1đ — không làm tròn trăm, không
         * ép ≤95% giá gốc. Giá điền tay thì dùng y nguyên nếu thấp hơn giá đang bán. */
        const giaTru1d = (dangBan: number) => Math.max(1, override > 0 && override < dangBan ? Math.round(override) : Math.round(dangBan) - 1)
        let models: { model_id: number; price: number; giaHienTai?: number; stock: number }[] = []
        // Đọc phân loại hỏng ≠ không có phân loại: giữ lời Shopee để nếu bước sau phải bỏ mã thì nói đúng lý do
        let loiPhanLoai = ''
        const cs = coSo.get(itemId)
        const coPhanLoai: boolean | null = cs ? !!cs.has_model : null   // null = Shopee không trả thông tin gốc ⇒ thử đọc phân loại
        if (coPhanLoai !== false) {
            try { models = await service.getModelList(itemId) } catch (e: any) { loiPhanLoai = String(e?.message || e).slice(0, 160) }
        }
        const dk = theoNganh ? (theoNganh.get(Number(cs?.category_id)) ?? theoNganh.get(0) ?? null) : null
        /** Lý do một mức giá/tồn không đạt điều kiện của gian (null = đạt) */
        const khongDat = (goc: number, gia: number, ton: number): string | null => {
            if (!dk) return null
            const g = phanTramGiam(goc, gia)
            const pt = String(g).replace('.', ',')
            if (g < dk.giamToiThieu) return `giá flash sale ${Math.round(gia).toLocaleString('vi-VN')}đ chỉ thấp hơn giá gốc ${Math.round(goc).toLocaleString('vi-VN')}đ ${pt}% — Shopee đòi ≥ ${dk.giamToiThieu}%`
            if (g > dk.giamToiDa) return `giảm ${pt}% so với giá gốc — Shopee cho tối đa ${dk.giamToiDa}%`
            if (ton < dk.tonToiThieu) return `tồn campaign ${ton} < tối thiểu ${dk.tonToiThieu} của Shopee`
            return null
        }
        const kepTon = (ton: number) => dk && dk.tonToiDa > 0 ? Math.min(ton, dk.tonToiDa) : ton
        // purchase_limit là trường BẮT BUỘC theo tài liệu (0 = không giới hạn) — bản đầu bỏ trống khi 0
        const entry: any = { item_id: itemId, purchase_limit: limit }
        if (models.length > 0) {
            const coTon = models.filter(m => m.stock > 0 && m.price > 0)
            if (!coTon.length) { boQua.push({ item_id: itemId, name: it.name, err_msg: 'Hết tồn ở mọi phân loại (hoặc phân loại chưa có giá)' }); continue }
            const dat: any[] = [], lyDo: string[] = []
            for (const m of coTon) {
                const gia = tru1d ? giaTru1d(giaHienThi(km, itemId, Number(m.model_id), Number(m.giaHienTai) || m.price).gia) : promoFor(m.price)
                const ton = kepTon(Math.min(m.stock, stockPer))
                const ld = khongDat(m.price, gia, ton)
                if (ld) { lyDo.push(ld); continue }
                dat.push({ model_id: m.model_id, input_promo_price: gia, stock: ton })
            }
            if (!dat.length) { boQua.push({ item_id: itemId, name: it.name, err_msg: coTon.length > 1 ? `${coTon.length} phân loại: ${lyDo[0]}` : lyDo[0] }); continue }
            if (dat.length < coTon.length) {
                boQua.push({ item_id: itemId, name: it.name, motPhan: true, err_msg: `bỏ ${coTon.length - dat.length}/${coTon.length} phân loại: ${lyDo[0]}` })
            }
            entry.models = dat
        } else if (coPhanLoai === true) {
            // Chắc chắn có phân loại mà không đọc được ⇒ đừng gửi như hàng không phân loại (Shopee từ chối, lại sai giá)
            boQua.push({ item_id: itemId, name: it.name, err_msg: loiPhanLoai ? `Không đọc được phân loại: ${loiPhanLoai}` : 'Mã có phân loại nhưng Shopee không trả phân loại nào' })
            continue
        } else {
            const pi = cs?.price_info?.[0]
            // giá ĐANG HIỂN THỊ sống (min current_price, chương trình đang chạy); dự phòng số FE gửi lúc xếp
            const base = giaHienThi(km, itemId, 0, Number(pi?.current_price) || Number(it.price) || 0).gia
            const goc = Number(pi?.original_price) || Number(it.giaGoc) || base
            if (base <= 0) {
                boQua.push({ item_id: itemId, name: it.name, err_msg: loiPhanLoai ? `Không đọc được phân loại: ${loiPhanLoai}` : 'Chưa có giá đang bán (đồng bộ lại sản phẩm)' })
                continue
            }
            /* HÀNG KHÔNG PHÂN LOẠI (đọc tài liệu add_shop_flash_sale_items 15/10/2026, mục "Support single item" 2025-01-10):
             * giá + tồn đặt ở CẤP SẢN PHẨM — `item_input_promo_price` + `item_stock` — và KHÔNG gửi `models`. Bản đầu gửi
             * `models: [{ model_id: 0 }]` ⇒ Shopee trả "item-model invalid" cho mọi mã không phân loại (đợt thử 14/07 ra 0 item).
             * tru1d: chuẩn là giá đang bán; %: giá gốc. */
            const ton = cs ? tonSanPham(cs) : (Number(it.ton) || 0)
            if (cs && ton <= 0) { boQua.push({ item_id: itemId, name: it.name, err_msg: 'Hết tồn trên sàn' }); continue }
            const gia = tru1d ? giaTru1d(base) : promoFor(goc)
            const tonGui = kepTon(Math.max(1, ton > 0 ? Math.min(ton, stockPer) : stockPer))
            const ld = khongDat(goc, gia, tonGui)
            if (ld) { boQua.push({ item_id: itemId, name: it.name, err_msg: ld }); continue }
            entry.item_input_promo_price = gia
            entry.item_stock = tonGui
        }
        shopeeItems.push(entry)
    }
    return { shopeeItems, boQua }
}

/* ─── BƯỚC 2 · THÊM HÀNG + BẬT ĐỢT ─────────────────────────────────────────────────────────────────────────────────── */
/* TRẦN SỐ MÃ MỖI ĐỢT (15/10/2026): lần đẩy thật đầu tiên (Kengi Electric, ≤ 24 mã còn hàng gửi một lượt) Shopee trả
 * `shop_flash_sale_exceed_max_item_criteria — exceed the max number of item limit per promotion`; tài liệu chỉ ghi "bật tối đa
 * 50 mã", get_item_criteria / get_time_slot_id không khai trần nào ⇒ thêm THEO LÔ, lô nào vượt trần thì chia đôi thử tiếp; mã
 * không thêm được vì trần ⇒ failedItems "vượt số mã tối đa — xếp sang đợt khác". Log ghi số mã vào được = trần thật. */
const LO_THEM = 10
async function themVaBat(service: any, flashSaleId: number, shopeeItems: any[]): Promise<{ failedItems: any[]; soItem: number; chamTran: boolean }> {
    const failedItems: any[] = []
    const daThem: any[] = []
    let chamTran = false, tranLienTiep = 0
    const vuotTran = (x: any) => ({ item_id: x.item_id, err_msg: 'Vượt số mã tối đa Shopee cho một đợt — xếp mã này sang đợt khác' })
    const them = async (lo: any[]): Promise<void> => {
        if (!lo.length) return
        if (chamTran) { failedItems.push(...lo.map(vuotTran)); return }
        try {
            const r = await service.flashSaleAddItems(flashSaleId, lo)
            failedItems.push(...(r?.failedItems || []))
            daThem.push(...lo)
            tranLienTiep = 0
        } catch (e: any) {
            if (!/exceed_max_item/i.test(String(e?.message || e))) throw e
            if (lo.length === 1) {
                failedItems.push(vuotTran(lo[0]))
                if (++tranLienTiep >= 2) chamTran = true   // hai mã lẻ liền nhau cũng vượt ⇒ đã chạm trần, khỏi thử từng mã
                return
            }
            const giua = Math.ceil(lo.length / 2)
            await them(lo.slice(0, giua))
            await them(lo.slice(giua))
        }
    }
    for (let i = 0; i < shopeeItems.length; i += LO_THEM) await them(shopeeItems.slice(i, i + LO_THEM))
    // Mã được nhận = đã thêm và còn ít nhất một phân loại (hoặc chính nó, nếu không phân loại) không nằm trong failed_items
    const hongPhanLoai = new Set(failedItems.filter(f => f?.model_id).map(f => `${f.item_id}:${f.model_id}`))
    const hongMa = new Set(failedItems.filter(f => !f?.model_id).map(f => String(f.item_id)))
    const nhan = daThem.filter(x => !hongMa.has(String(x.item_id)) &&
        (!Array.isArray(x.models) || x.models.some((m: any) => !hongPhanLoai.has(`${x.item_id}:${m.model_id}`)))).length
    if (nhan === 0) {
        // Toàn bộ bị từ chối → activatePlan xoá đợt rỗng cho sạch, báo lỗi
        throw new Error(`Shopee từ chối toàn bộ ${shopeeItems.length} item: ${JSON.stringify(failedItems).slice(0, 400)}`)
    }
    await service.flashSaleUpdateStatus(flashSaleId, 1) // bật
    return { failedItems, soItem: nhan, chamTran }
}

/** Chuẩn bị + thêm + bật trong một lượt (bộ kiểm chứng dùng; đường thật đi qua activatePlan để chuẩn bị TRƯỚC khi tạo đợt). */
async function napVaBat(service: any, flashSaleId: number, items: any[], pct: number, stockPer: number, limit: number, tru1d = false): Promise<{ failedItems: any[]; soItem: number }> {
    const { shopeeItems, boQua } = await chuanBiHang(service, items, pct, stockPer, limit, tru1d)
    if (!shopeeItems.length) throw loiKhongMaNao(boQua)
    const r = await themVaBat(service, flashSaleId, shopeeItems)
    return { failedItems: [...boQua, ...r.failedItems], soItem: r.soItem }
}

async function tickStore(schema: string): Promise<void> {
    const prisma = getStorePrisma(schema)
    await ensureFlashSaleTable(prisma)

    // 1. Đóng các plan active đã hết giờ
    await prisma.$executeRawUnsafe(
        `UPDATE "FlashSalePlan" SET status='ended', "updatedAt"=now()
         WHERE status='active' AND "endTime" < now()`)
    // 1b. Lượt kích hoạt bị đứt giữa chừng (máy tắt, mất kết nối) ⇒ trả về hàng đợi để thử lại
    await prisma.$executeRawUnsafe(
        `UPDATE "FlashSalePlan" SET status='queued', attempts=attempts+1, error='Lượt kích hoạt trước bị đứt giữa chừng — thử lại', "updatedAt"=now()
         WHERE status='dang_kich_hoat' AND "updatedAt" < now() - interval '10 minutes'`)

    // 1c. Đợt RỖNG còn sót trên Shopee của plan đã hỏng/bỏ (lượt dọn trước gặp lỗi token — 15/10 Kengi Electric #514765382824014)
    //     ⇒ dọn lại. Chỉ xoá đợt 0 sản phẩm; đợt CÓ hàng thì để nguyên (không tự xoá thứ đang bán).
    const sot: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, "channelId", "shopeeFlashSaleId" FROM "FlashSalePlan"
         WHERE status IN ('failed','skipped') AND "shopeeFlashSaleId" IS NOT NULL AND "endTime" > now() LIMIT 5`)
    for (const r of sot) {
        try {
            const ch = await prisma.onlineChannel.findUnique({ where: { id: r.channelId } })
            if (!ch?.accessToken) continue
            const sv = await shopeeServiceTokenMoi(prisma, ch)
            const id = Number(r.shopeeFlashSaleId)
            const cu = await sv.flashSaleGet(id)
            if (Number(cu?.status) !== 0) {
                if (Number(cu?.item_count) > 0) continue
                await sv.flashSaleDelete(id)
            }
            await prisma.$executeRawUnsafe(`UPDATE "FlashSalePlan" SET "shopeeFlashSaleId"=NULL, "updatedAt"=now() WHERE id=$1`, r.id)
            console.log(`[FlashSale] Dọn đợt rỗng còn sót #${id} (plan ${r.id})`)
        } catch (e: any) { console.warn(`[FlashSale] Chưa dọn được đợt sót của plan ${r.id}:`, e?.message || e) }
    }

    // 2. Từng kênh: chưa có active → promote plan kế tiếp
    const channels: any[] = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT "channelId" FROM "FlashSalePlan" WHERE status IN ('queued','active','dang_kich_hoat')`)
    for (const { channelId } of channels) {
        const activeCnt: any[] = await prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS n FROM "FlashSalePlan" WHERE "channelId"=$1 AND status IN ('active','dang_kich_hoat')`, channelId)
        if ((activeCnt[0]?.n ?? 0) > 0) continue // tuần tự: đợi sale hiện tại kết thúc

        // Dọn plan lỡ khung giờ (không kịp đăng ký — cần đệm 2 phút)
        const skipped: any[] = await prisma.$queryRawUnsafe(
            `UPDATE "FlashSalePlan" SET status='skipped', error='Lỡ khung giờ — khung đã bắt đầu/quá sát giờ khi tới lượt', "updatedAt"=now()
             WHERE "channelId"=$1 AND status='queued' AND "startTime" <= now() + interval '2 minutes' AND "shopeeFlashSaleId" IS NULL
             RETURNING id, title, "startTime"`, channelId)
        if (skipped.length > 0) {
            console.warn(`[FlashSale] Bỏ ${skipped.length} plan lỡ khung giờ (kênh ${channelId}):`,
                skipped.map((s: any) => `${s.title} @${new Date(s.startTime).toISOString()}`).join('; '))
        }

        const nextRows: any[] = await prisma.$queryRawUnsafe(
            `SELECT * FROM "FlashSalePlan"
             WHERE "channelId"=$1 AND status='queued'
             ORDER BY position ASC, "startTime" ASC LIMIT 1`, channelId)
        const plan = nextRows[0]
        if (!plan) continue

        const channel = await prisma.onlineChannel.findUnique({ where: { id: channelId } })
        if (!channel?.accessToken) continue
        /* GIÀNH plan trên dòng CSDL (15/10/2026): khoá "một máy chạy" (chayNeuLanhDao) dựa Redis mà prod KHÔNG có Redis
         * ⇒ hai bản Cloud Run cùng tick có thể cùng đẩy một plan ⇒ hai flash sale trên Shopee, giam tồn hai lần. Ai đổi
         * được queued → dang_kich_hoat thì người đó làm. */
        const gianh: any[] = await prisma.$queryRawUnsafe(
            `UPDATE "FlashSalePlan" SET status='dang_kich_hoat', "updatedAt"=now() WHERE id=$1 AND status='queued' RETURNING id`, plan.id)
        if (!gianh.length) continue
        try {
            await activatePlan(prisma, plan, channel, await shopeeServiceTokenMoi(prisma, channel))
        } catch (e: any) {
            const attempts = (Number(plan.attempts) || 0) + 1
            // Lỗi chắc chắn (không mã nào đạt điều kiện giá/tồn của Shopee) ⇒ dừng ngay; lỗi mạng/Shopee ⇒ thử tối đa MAX_ATTEMPTS
            const failed = e instanceof LoiKhongThuLai || attempts >= MAX_ATTEMPTS
            // Chỉ ghi khi plan còn ở 'dang_kich_hoat' — chủ shop huỷ giữa chừng thì 'cancelled' không bị lật lại thành 'queued'
            await prisma.$executeRawUnsafe(
                `UPDATE "FlashSalePlan" SET attempts=$1, error=$2, status=$3, "updatedAt"=now() WHERE id=$4 AND status='dang_kich_hoat'`,
                attempts, String(e?.message || e).slice(0, 500), failed ? 'failed' : 'queued', plan.id)
            console.error(`[FlashSale] Lỗi kích hoạt plan ${plan.id} (lần ${attempts}${failed ? ' — BỎ' : ''}):`, e?.message || e)
        }
    }
}

/** Gọi từ /api/cron/tick (mỗi 3 phút, 15/10/2026): Cloud Run bóp CPU khi không có request ⇒ setInterval đứng im ban đêm,
 *  plan khung 0h–2h tới lượt mà không ai đẩy ⇒ bị bỏ "lỡ khung giờ". Nhịp ngoài có CPU cả đêm. */
export async function nhipFlashSale(): Promise<string> {
    if (running) return 'dang-chay'
    await runScheduler()
    return 'xong'
}

async function runScheduler(): Promise<void> {
    if (running) return
    running = true
    try {
        const stores = await registryPrisma.store.findMany({
            where: { status: 'active', hasOnlineChannels: true } as any,
        }) as any[]
        for (const store of stores) {
            try {
                await tickStore(store.schema)
            } catch (e: any) {
                // Store chưa có bảng onlineChannel... — bỏ qua im lặng như AutoSync
                if (!String(e?.message || '').includes('does not exist')) {
                    console.error(`[FlashSale] Lỗi store ${store.name}:`, e?.message || e)
                }
            }
        }
    } catch (e: any) {
        console.error('[FlashSale] Fatal:', e?.message || e)
    } finally {
        running = false
    }
}

export function startFlashSaleScheduler(): void {
    if (timer) return
    console.log(`⚡ Flash sale scheduler started (every ${TICK_MS / 60000} minutes)`)
    // Lệch pha 90s so với AutoSync khởi động để tránh dồn pool connection lúc boot
    // Chỉ MỘT bản Cloud Run chạy mỗi nhịp (khoá Redis) — trước đây 2–3 bản cùng
    // quét flash sale của mọi cửa hàng online, đốt kết nối DB vô ích (19/08/2026)
    const chay = () => chayNeuLanhDao('flash-sale', TICK_MS - 15_000, runScheduler)
    setTimeout(() => {
        chay()
        timer = setInterval(chay, TICK_MS)
    }, 90_000)
}

export function stopFlashSaleScheduler(): void {
    if (timer) { clearInterval(timer); timer = null }
}

/** Chỉ cho bộ kiểm chứng scripts/check-flash-sale.ts — đường chạy thật không dùng. */
export const _kiemThu = { activatePlan, napVaBat, chuanBiHang, themVaBat, LoiKhongThuLai }
