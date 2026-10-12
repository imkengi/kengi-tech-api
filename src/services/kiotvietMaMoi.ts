// ═══════════════════════════════════════════════════════════════════════════════
//  KÉO MÃ HÀNG MỚI TỪ KIOTVIET LÚC 0H (12/10/2026)
//
//  Chủ shop: "trong admin thêm cron cập nhật mã hàng mới từ kiot viet qua lúc 0h". Lượt đêm đầy đủ đã có
//  (cron/kiotvietNightly.ts: danh mục → hàng → NCC → hoá đơn → trả → nhập) nhưng chạy bằng setInterval,
//  mà Cloud Run cpu-throttling ⇒ ĐO 09–11/10 (HUTI): mỗi đêm 4–7 TIẾNG, giao dịch tồn quá hạn 5 giây
//  ("Transaction already closed") làm hỏng 4–11 mã/đêm, phiếu nhập báo "mã hàng chưa có bên Kengi".
//  Lượt này:
//    · chạy TRONG request nhịp ngoài POST /api/cron/tick (Cloud Scheduler mỗi phút, hạn 900 giây) ⇒ có
//      CPU suốt lượt (nhip-ngoai-cron-tick)
//    · kéo TRỌN danh sách hàng KiotViet — không lọc ngày (data-sync-gate: danh mục luôn lấy trọn bộ) — rồi
//      so MỘT LẦN với bảng nối + SKU + mã vạch đang có ⇒ chỉ mã THẬT SỰ mới đi qua đường tạo của
//      syncProducts (cùng luật nhóm hàng / thương hiệu / tồn ban đầu / thẻ kho như mọi lượt khác)
//    · CHỈ TẠO MỚI (chiTaoMoi): hàng đã có tuyệt đối không đụng — ghi đè giá / tên / tồn là việc của lượt
//      đồng bộ đầy đủ, theo công tắc riêng của nó
//    · giành lượt bằng dòng nhật ký mã cố định `mamoi-<yyyymmdd>` (khoá chính) — prod không có Redis,
//      nhiều máy cùng nhận tick thì chỉ một máy tạo được dòng đó (prod-khong-co-redis)
//    · có mã mới ⇒ một tin CHUÔNG (không đẩy push lúc nửa đêm)
// ═══════════════════════════════════════════════════════════════════════════════
import { registryPrisma, getStorePrisma, giuClient } from '../lib/prisma'
import { errMsg } from '../lib/errorResponse'
import { KV } from './kiotviet'
import { buildOptions, credsOf } from './kiotvietRunner'
import { syncProducts, newCounters } from './kiotvietSync'

export const ENTITY_MA_MOI = 'ma-hang-moi'
/** Cửa sổ giờ VN: 00:00 – 05:59. Tick 0h hỏng / máy khởi động lại vẫn chạy bù trong đêm. */
const GIO_BAT_DAU = 0
const GIO_HET = 6
const MAT_NHIP_MS = 5 * 60_000
const CACH_LUOT_MS = 10 * 60_000
export const LUOT_TOI_DA = 3

/** Ngày (yyyymmdd) và giờ theo giờ Việt Nam — máy chủ chạy UTC. */
export function gioVN(d = new Date()): { ngay: string; gio: number } {
    const vn = new Date(d.getTime() + 7 * 3600_000)
    return { ngay: vn.toISOString().slice(0, 10).replace(/-/g, ''), gio: vn.getUTCHours() }
}

export interface MaHangMoi {
    kvId: string; sku: string; ten: string; ton: number; gia: number
    nhom: string | null; thuongHieu: string | null; ngungKinhDoanh: boolean
}

/** Tóm tắt một mã KiotViet để hiện / ghi nhật ký. Tồn cộng theo chi nhánh đã chọn (giống syncProducts). */
export function moTaMa(kv: any, branchIds?: number[]): MaHangMoi {
    const invs: any[] = Array.isArray(kv?.inventories) ? kv.inventories : []
    const chon = branchIds?.length ? invs.filter(i => branchIds.includes(Number(i?.branchId))) : invs
    return {
        kvId: String(kv?.id), sku: String(kv?.code || '').trim(), ten: String(kv?.name || '').trim(),
        ton: Math.round(chon.reduce((s, i) => s + (Number(i?.onHand) || 0), 0)),
        gia: Number(kv?.basePrice) || 0,
        nhom: kv?.categoryName ? String(kv.categoryName) : null,
        thuongHieu: kv?.tradeMarkName ? String(kv.tradeMarkName) : null,
        ngungKinhDoanh: kv?.isActive === false,
    }
}

/**
 * Mã KiotViet mà Kengi CHƯA có: không nằm trong bảng nối, không trùng SKU, không trùng mã vạch — đúng ba
 * đường syncProducts dùng để nhận ra "đã có". CHỈ ĐỌC. Đọc Kengi bằng HAI truy vấn thay vì 3 × 3.600.
 */
export function locMaMoi(items: any[], daNoi: Set<string>, daCoSku: Set<string>, daCoMaVach: Set<string>): any[] {
    return items.filter(kv => {
        const code = String(kv?.code || '').trim(), name = String(kv?.name || '').trim()
        if (!kv?.id || !code || !name) return false
        if (daNoi.has(String(kv.id)) || daCoSku.has(code)) return false
        if (kv?.barCode && daCoMaVach.has(String(kv.barCode))) return false
        return true
    })
}

export async function timMaHangMoi(sp: any, cfg: any, pageOpts?: any): Promise<{ items: any[]; moi: any[]; biCatTran: boolean }> {
    const { items, truncated } = await KV.products(credsOf(cfg), {}, pageOpts)
    const dsNoi: any[] = await sp.kiotVietMap.findMany({ where: { entity: 'product' }, select: { kvId: true } })
    const dsHang: any[] = await sp.product.findMany({ select: { sku: true, barcode: true } })
    const moi = locMaMoi(items,
        new Set(dsNoi.map(x => String(x.kvId))),
        new Set(dsHang.map(x => String(x.sku || ''))),
        new Set(dsHang.map(x => String(x.barcode || '')).filter(Boolean)))
    return { items, moi, biCatTran: !!truncated }
}

export interface KetQuaMaMoi { layVe: number; moi: number; taoMoi: number; loi: number; tao: MaHangMoi[]; loiChiTiet: string[]; trangThai: string }

/** Tạo các mã mới (CHẠY THẬT) và ghi kết quả vào dòng nhật ký `logId` (dòng đó do bên gọi tạo). */
export async function keoMaHangMoi(sp: any, cfg: any, logId: string): Promise<KetQuaMaMoi> {
    let nhipCuoi = 0
    const dap = (nhan: string) => {
        const now = Date.now()
        if (now - nhipCuoi < 3000) return
        nhipCuoi = now
        void sp.kiotVietSyncLog.update({ where: { id: logId }, data: { heartbeatAt: new Date(), entity: `${ENTITY_MA_MOI} · ${nhan}` } }).catch(() => { })
    }
    const { items, moi, biCatTran } = await timMaHangMoi(sp, cfg, { onPage: (_i: any[], f: number, t: number) => dap(`đang tải ${f}/${t}`) })

    const opts = await buildOptions(sp, cfg, true)
    // Lượt này KHÔNG BAO GIỜ ghi đè — dù cấu hình đồng bộ đầy đủ của cửa hàng có bật ghi đè
    opts.overwriteNames = false
    opts.overwritePrices = false
    opts.overwriteStock = false
    opts.chiTaoMoi = true
    opts.onProgress = () => dap(`đang tạo ${moi.length} mã mới`)
    const c = newCounters()
    if (moi.length) await syncProducts(sp, moi, opts, c)

    // Mã nào ĐÃ THẬT SỰ có sau lượt (đếm theo kho dữ liệu, không theo bộ đếm — bộ mẫu chỉ giữ 10 dòng)
    const skuMoi = moi.map(kv => String(kv.code).trim())
    const daCo = new Set<string>(skuMoi.length
        ? ((await sp.product.findMany({ where: { sku: { in: skuMoi } }, select: { sku: true } })) as any[]).map(x => String(x.sku))
        : [])
    const tao = moi.filter(kv => daCo.has(String(kv.code).trim())).map(kv => moTaMa(kv, opts.branchIds))
    const loiChiTiet = [...c.errors]
    if (biCatTran) loiChiTiet.unshift('Chạm trần 500 trang khi tải hàng hoá — danh sách có thể CHƯA ĐỦ')
    const trangThai = c.failed || biCatTran || tao.length < moi.length ? 'partial' : 'success'
    await sp.kiotVietSyncLog.update({
        where: { id: logId },
        data: {
            entity: ENTITY_MA_MOI, status: trangThai,
            fetched: items.length, created: tao.length, updated: 0,
            skipped: items.length - moi.length, failed: moi.length - tao.length,
            errors: loiChiTiet.join('\n').slice(0, 4000) || null,
            details: JSON.stringify({ layVe: items.length, moi: moi.length, tao: tao.slice(0, 300), loiChiTiet: loiChiTiet.slice(0, 20) }).slice(0, 60000),
            heartbeatAt: new Date(), finishedAt: new Date(),
        },
    }).catch(() => { })
    return { layVe: items.length, moi: moi.length, taoMoi: tao.length, loi: moi.length - tao.length, tao, loiChiTiet, trangThai }
}

/** Đợt đồng bộ KiotViet KHÁC đang sống (bấm tay / lượt đêm đầy đủ / lượt mã mới khác)? Chạy chồng là hai đợt đua tạo cùng mã. */
export async function dotKhacDangChay(sp: any, boQuaId?: string): Promise<{ id: string; entity: string } | null> {
    return sp.kiotVietSyncLog.findFirst({
        where: {
            status: 'running',
            heartbeatAt: { gte: new Date(Date.now() - 2 * 60_000) },
            ...(boQuaId ? { id: { not: boQuaId } } : {}),
        },
        select: { id: true, entity: true },
    }).catch(() => null)
}

/**
 * Giành lượt đêm nay. Khoá chính `mamoi-<ngày>`: máy nào TẠO được dòng là máy chạy. Dòng đã có thì chỉ giành
 * lại khi lượt trước hỏng / dở (cách ≥ 10 phút) hoặc đang "chạy" mà mất nhịp > 5 phút (máy chết giữa chừng);
 * tối đa 3 lượt mỗi đêm — mã nào hỏng mãi thì để người xem, đừng gọi KiotViet cả đêm.
 */
export async function gianhLuot(sp: any, id: string): Promise<boolean> {
    try {
        await sp.kiotVietSyncLog.create({
            data: { id, entity: ENTITY_MA_MOI, mode: 'cron', dryRun: false, status: 'running', startedAt: new Date(), heartbeatAt: new Date(), attempts: 1 },
        })
        return true
    } catch (e: any) {
        if (e?.code !== 'P2002') throw e
    }
    const r = await sp.kiotVietSyncLog.updateMany({
        where: {
            id, attempts: { lt: LUOT_TOI_DA },
            OR: [
                { status: { in: ['failed', 'partial'] }, finishedAt: { lt: new Date(Date.now() - CACH_LUOT_MS) } },
                { status: 'running', heartbeatAt: { lt: new Date(Date.now() - MAT_NHIP_MS) } },
            ],
        },
        data: { status: 'running', heartbeatAt: new Date(), startedAt: new Date(), finishedAt: null, attempts: { increment: 1 } },
    })
    return r.count === 1
}

async function baoChuong(sp: any, tao: MaHangMoi[]): Promise<void> {
    try {
        await sp.notification.create({
            data: {
                type: 'system',
                title: `🆕 Đã kéo ${tao.length} mã hàng mới từ KiotViet`.slice(0, 200),
                message: (tao.slice(0, 8).map(m => `${m.sku} — ${m.ten}`).join('; ') + (tao.length > 8 ? ` … và ${tao.length - 8} mã nữa` : '')).slice(0, 1000),
            },
        })
    } catch (e: any) { console.error('[KVMaMoi] ghi chuông hỏng:', e?.message || e) }
}

/** `${schema}|${ngay}` đêm nay đã xong / không có việc — khỏi hỏi lại mỗi phút (đệm theo máy, chỉ để đỡ truy vấn). */
const daXong = new Set<string>()
let dangChay = false

async function chayDemNay(sp: any, code: string, ngay: string, khoa: string): Promise<string> {
    const id = `mamoi-${ngay}`
    const cfg = await sp.kiotVietConfig.findUnique({ where: { id: 'default' } }).catch(() => null)
    if (!cfg?.enabled || !cfg.clientId || !cfg.clientSecret || !cfg.retailer || cfg.tuKeoMaMoi === false) { daXong.add(khoa); return 'tat' }
    if (await dotKhacDangChay(sp, id)) return 'cho-dot-khac'   // tick sau thử lại
    if (!(await gianhLuot(sp, id))) {
        const dong = await sp.kiotVietSyncLog.findUnique({ where: { id }, select: { status: true, attempts: true } }).catch(() => null)
        if (dong && (dong.status === 'success' || (dong.attempts || 0) >= LUOT_TOI_DA)) daXong.add(khoa)
        return dong ? `da-co ${dong.status}` : 'khong-gianh-duoc'
    }
    try {
        const kq = await keoMaHangMoi(sp, cfg, id)
        if (kq.trangThai === 'success') daXong.add(khoa)
        if (kq.taoMoi > 0) await baoChuong(sp, kq.tao)
        console.log(`[KVMaMoi] ${code}: tải ${kq.layVe} · mới ${kq.moi} · tạo ${kq.taoMoi} · hỏng ${kq.loi}`)
        return `tao ${kq.taoMoi}/${kq.moi}`
    } catch (e: any) {
        await sp.kiotVietSyncLog.update({
            where: { id }, data: { status: 'failed', finishedAt: new Date(), heartbeatAt: new Date(), errors: errMsg(e).slice(0, 2000) },
        }).catch(() => { })
        console.error(`[KVMaMoi] ${code} hỏng:`, e?.message || e)
        return 'loi: ' + errMsg(e).slice(0, 120)
    }
}

/**
 * Gọi từ nhịp ngoài mỗi phút. Ngoài cửa sổ 00:00–05:59 (giờ VN) thì về ngay, không đụng DB. Trong cửa sổ:
 * lọc cửa hàng có nối KiotViet + bật công tắc bằng SQL thô trên kết nối sổ đăng ký (không mở client cho
 * cửa hàng không nối), rồi chạy TUẦN TỰ (pool 1 kết nối).
 */
export async function nhipKeoMaMoi(now = new Date()): Promise<string> {
    const { ngay, gio } = gioVN(now)
    if (gio < GIO_BAT_DAU || gio >= GIO_HET) return 'ngoai-gio'
    if (dangChay) return 'dang-chay'
    dangChay = true
    const ra: string[] = []
    try {
        const stores = await registryPrisma.store.findMany({ where: { status: 'active' }, select: { code: true, schema: true } }) as any[]
        for (const st of stores) {
            const khoa = `${st.schema}|${ngay}`
            if (daXong.has(khoa)) continue
            const schema = String(st.schema || '').replace(/[^A-Za-z0-9_]/g, '')
            if (!schema) continue
            let bat = false
            try {
                const r: any[] = await registryPrisma.$queryRawUnsafe(
                    `SELECT 1 FROM "${schema}"."KiotVietConfig" WHERE id = 'default' AND enabled = true AND "tuKeoMaMoi" = true LIMIT 1`)
                bat = r.length > 0
            } catch { bat = false }   // không có bảng / cột ⇒ cửa hàng không nối KiotViet
            if (!bat) { daXong.add(khoa); continue }
            const nha = giuClient(st.schema)
            try {
                ra.push(`${st.code}: ${await chayDemNay(getStorePrisma(st.schema), st.code, ngay, khoa)}`)
            } catch (e: any) {
                ra.push(`${st.code}: loi ${errMsg(e).slice(0, 120)}`)
            } finally {
                nha()
            }
        }
    } finally {
        dangChay = false
    }
    // Đệm chỉ cần đêm nay — dọn khoá của các đêm trước
    for (const k of Array.from(daXong)) if (!k.endsWith(`|${ngay}`)) daXong.delete(k)
    return ra.join('; ') || 'khong-co-viec'
}
