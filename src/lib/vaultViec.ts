/* ═══════════════════════════════════════════════════════════════════════════════
 *  KENGI VAULT — việc dùng chung giữa route (/api/storage) và nhịp nền (cron/vaultCron.ts)
 *  (20/10/2026): cài đặt kho, AI đọc một tệp, xoá vĩnh viễn, nhắc giấy tờ sắp hết hạn, dọn thùng rác,
 *  dọn phiên tải lên bỏ dở.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import * as kho from './khoTaiLieu'
import { docTaiLieuAi, LoiAiTaiLieu, AI_MOI_NGAY, AI_TOI_DA_BYTE } from './vaultAi'
import { layKeyAi } from './keyAi'
import { moTaLoi } from './gomLoi'

export const THUNG_RAC_NGAY = 30
const NGAY_MS = 86400_000
const VN_MS = 7 * 3600_000

export interface CaiDatVault { aiTuDong: boolean; nhacTruocNgay: number[] }
export const CAI_DAT_MAC_DINH: CaiDatVault = { aiTuDong: true, nhacTruocNgay: [30, 7, 1] }

export async function layCaiDat(prisma: any): Promise<CaiDatVault> {
    try {
        const r = await prisma.storageConfig.findUnique({ where: { key: 'cai-dat' } })
        if (!r) return { ...CAI_DAT_MAC_DINH }
        const v = JSON.parse(r.value)
        return {
            aiTuDong: v.aiTuDong !== false,
            nhacTruocNgay: Array.isArray(v.nhacTruocNgay)
                ? v.nhacTruocNgay.map(Number).filter((x: number) => Number.isInteger(x) && x >= 0 && x <= 365).slice(0, 5)
                : [...CAI_DAT_MAC_DINH.nhacTruocNgay],
        }
    } catch { return { ...CAI_DAT_MAC_DINH } }
}

/** Kết quả AI → cột + tự điền chỗ CÒN TRỐNG (hạn, nhãn, mô tả). Không ghi đè thứ người dùng đã nhập. */
export async function luuKetQuaAi(prisma: any, f: any, kq: any): Promise<any> {
    const { chu, ...aiData } = kq
    const data: any = { aiStatus: 'done', aiError: null, aiAt: new Date(), aiText: chu || null }
    const daApDung: string[] = []
    if (!f.expiresAt && kq.ngayHetHan) { data.expiresAt = new Date(`${kq.ngayHetHan}T00:00:00+07:00`); data.reminded = null; daApDung.push('expiresAt') }
    if ((!f.tags || !f.tags.length) && kq.nhan?.length) { data.tags = kq.nhan; daApDung.push('tags') }
    if (!f.description && kq.tomTat) { data.description = kq.tomTat; daApDung.push('description') }
    data.aiData = { ...aiData, daApDung }
    return prisma.storageFile.update({ where: { id: f.id }, data })
}

/** Lượt AI trong 24 giờ qua của cửa hàng (trần AI_MOI_NGAY) */
export const luotAiHomNay = (prisma: any): Promise<number> =>
    prisma.storageFile.count({ where: { aiAt: { gte: new Date(Date.now() - NGAY_MS) } } })

export async function aiDocMotTep(prisma: any, schema: string, f: any): Promise<any> {
    if (!f.objectKey || !kho.khoaCuaCuaHang(f.objectKey, schema)) throw new LoiAiTaiLieu('Tệp gốc đã mất')
    if (f.size > AI_TOI_DA_BYTE) throw new LoiAiTaiLieu(`Tệp ${Math.round(f.size / 1048576)}MB — AI chỉ đọc tệp ≤ ${AI_TOI_DA_BYTE / 1048576}MB`)
    if ((await luotAiHomNay(prisma)) >= AI_MOI_NGAY) throw new LoiAiTaiLieu(`Đã dùng hết ${AI_MOI_NGAY} lượt AI đọc tài liệu trong 24 giờ — thử lại sau`, true)
    const { gemini } = await layKeyAi(prisma)
    const buf = await kho.docHet(f.objectKey, AI_TOI_DA_BYTE)
    const kq = await docTaiLieuAi(gemini, buf, f.type, f.name, f.description || '')
    return luuKetQuaAi(prisma, f, kq)
}

/** Ghi trạng thái khi AI hỏng: tạm thời ⇒ chờ lượt sau; thiếu key ⇒ bỏ qua; còn lại ⇒ lỗi */
export async function ghiLoiAi(prisma: any, id: string, e: LoiAiTaiLieu): Promise<void> {
    await prisma.storageFile.update({
        where: { id },
        data: { aiStatus: e.tamThoi ? 'pending' : (e.khongCoKey ? 'skipped' : 'error'), aiError: e.message.slice(0, 500), aiAt: new Date() },
    })
}

/** Xoá hẳn: object (bản hiện hành + phiên bản cũ + ảnh nhỏ) rồi tới dòng */
export async function xoaVinhVien(prisma: any, schema: string, f: any): Promise<void> {
    const cu: any[] = await prisma.storageFile.findMany({ where: { versionOf: f.id }, select: { id: true, objectKey: true, thumbKey: true } })
    for (const x of [f, ...cu]) {
        if (kho.khoaCuaCuaHang(x.objectKey, schema)) await kho.xoa(x.objectKey)
        if (kho.khoaCuaCuaHang(x.thumbKey, schema)) await kho.xoa(x.thumbKey)
    }
    await prisma.storageShare.deleteMany({ where: { fileId: f.id } })
    await prisma.storageFile.deleteMany({ where: { OR: [{ id: f.id }, { versionOf: f.id }] } })
}

// ─── Nhắc giấy tờ sắp hết hạn ────────────────────────────────────────────────
/** Ngày theo giờ VN dạng YYYY-MM-DD */
export const ngayVN = (d: Date | number) => new Date((typeof d === 'number' ? d : d.getTime()) + VN_MS).toISOString().slice(0, 10)
/** Còn bao nhiêu NGÀY LỊCH (giờ VN) tới ngày hết hạn: hôm nay hết hạn = 0, hôm qua = -1 */
export function soNgayCon(het: Date, now: Date): number {
    const a = Date.parse(`${ngayVN(het)}T00:00:00Z`), b = Date.parse(`${ngayVN(now)}T00:00:00Z`)
    return Math.round((a - b) / NGAY_MS)
}

/**
 * Mốc phải nhắc của MỘT tệp hôm nay. `reminded` = "<yyyy-mm-dd hạn>:30,7" — mốc đã nhắc ứng với ĐÚNG ngày hạn
 * đó (đổi hạn là nhắc lại từ đầu). Nhiều mốc cùng tới hạn (vd hạn vừa nhập còn 3 ngày ⇒ mốc 30 và 7) chỉ
 * nhắc MỘT lần, ghi nhận cả hai. Hết hạn rồi ⇒ báo "đã hết hạn" một lần, nếu hết hạn chưa quá 30 ngày.
 */
export function mocCanNhac(f: { expiresAt: Date; remindDays: number | null; reminded: string | null }, mocCuaHang: number[], now: Date):
    { nhac: boolean; con: number; ghi: string } {
    const han = ngayVN(f.expiresAt)
    const con = soNgayCon(f.expiresAt, now)
    const [hanDaNhac, ds] = String(f.reminded || '').split(':')
    const daNhac = new Set(hanDaNhac === han ? String(ds || '').split(',').filter(Boolean) : [])
    let moc = mocCuaHang.filter(m => f.remindDays == null || m <= f.remindDays)
    if (f.remindDays != null) moc.push(f.remindDays)
    moc = Array.from(new Set([...moc, 0]))
    const toi = moc.filter(m => con <= m && !daNhac.has(String(m))).map(String)
    let nhac = false
    if (con < 0) {
        if (!daNhac.has('het')) { toi.push('het'); nhac = con >= -30 }
    } else if (toi.length) nhac = true
    for (const m of toi) daNhac.add(m)
    return { nhac, con, ghi: `${han}:${Array.from(daNhac).join(',')}` }
}

type GuiPush = (sp: any, tieuDe: string, noiDung: string, meta: { id?: string; type: string; route: string | null }) => Promise<number>

export async function nhacHetHanCuaHang(prisma: any, schema: string, now: Date, guiPush: GuiPush): Promise<{ soTep: number; daNhac: boolean }> {
    // Mỗi cửa hàng MỘT lượt mỗi ngày — giành bằng dòng CSDL (prod không có Redis), không gửi đúp khi hai bản máy cùng chạy
    const gio = Number(new Date(now.getTime() + VN_MS).toISOString().slice(11, 13))
    if (gio < 8 || gio >= 21) return { soTep: 0, daNhac: false } // không réo chủ shop ban đêm
    const hom = ngayVN(now)
    const gianh: any[] = await prisma.$queryRawUnsafe(
        `INSERT INTO "${schema}"."StorageConfig" ("key","value","updatedAt") VALUES ('nhac-ngay', $1, now())
         ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now() WHERE "StorageConfig"."value" <> EXCLUDED."value"
         RETURNING "key"`, hom)
    if (!gianh.length) return { soTep: 0, daNhac: false }
    const caiDat = await layCaiDat(prisma)
    const xaNhat = Math.max(0, ...caiDat.nhacTruocNgay, 365)
    const tep: any[] = await prisma.storageFile.findMany({
        where: { status: 'ready', expiresAt: { not: null, lte: new Date(now.getTime() + (xaNhat + 1) * NGAY_MS) } },
        select: { id: true, name: true, expiresAt: true, remindDays: true, reminded: true, referenceName: true, aiData: true },
        orderBy: { expiresAt: 'asc' }, take: 500,
    })
    const canBao: { ten: string; con: number; han: string }[] = []
    for (const f of tep) {
        const kq = mocCanNhac(f, caiDat.nhacTruocNgay, now)
        if (kq.ghi === (f.reminded || '') ) continue
        // Ghi mốc có điều kiện: hai lượt chồng nhau chỉ một lượt ghi được
        const n = await prisma.storageFile.updateMany({ where: { id: f.id, reminded: f.reminded }, data: { reminded: kq.ghi } })
        if (n.count && kq.nhac) canBao.push({ ten: (f.aiData as any)?.tieuDe || f.name, con: kq.con, han: ngayVN(f.expiresAt).split('-').reverse().join('/') })
    }
    if (!canBao.length) return { soTep: 0, daNhac: false }
    canBao.sort((a, b) => a.con - b.con)
    const het = canBao.filter(x => x.con < 0).length
    const tieuDe = het === canBao.length ? `📄 ${het} giấy tờ đã HẾT HẠN` : `📄 ${canBao.length} giấy tờ sắp hết hạn${het ? ` (${het} đã hết hạn)` : ''}`
    const dong = canBao.slice(0, 6).map(x => `• ${x.ten.slice(0, 70)} — ${x.con < 0 ? `đã hết hạn ${x.han}` : x.con === 0 ? `HẾT HẠN HÔM NAY (${x.han})` : `còn ${x.con} ngày (${x.han})`}`)
    if (canBao.length > 6) dong.push(`… và ${canBao.length - 6} giấy tờ khác — xem ở Kengi Vault › Sắp hết hạn`)
    const tin = await prisma.notification.create({ data: { type: 'tai_lieu_het_han', title: tieuDe.slice(0, 200), message: dong.join('\n').slice(0, 1000) } })
    try { await guiPush(prisma, tieuDe, dong.slice(0, 3).join('\n').slice(0, 300), { id: tin?.id, type: 'tai_lieu_het_han', route: null }) }
    catch (e: any) { console.warn(`[Vault] ${schema}: push nhắc hết hạn hỏng — ${moTaLoi(e)} (tin trong app vẫn có)`) }
    return { soTep: canBao.length, daNhac: true }
}

/** Thùng rác quá 30 ngày ⇒ xoá hẳn; phiên tải lên bỏ dở quá 24 giờ ⇒ xoá object + dòng */
export async function donDepCuaHang(prisma: any, schema: string, now: Date): Promise<{ rac: number; treo: number }> {
    const rac: any[] = await prisma.storageFile.findMany({
        where: { status: 'trash', deletedAt: { lt: new Date(now.getTime() - THUNG_RAC_NGAY * NGAY_MS) } },
        select: { id: true, name: true, objectKey: true, thumbKey: true }, take: 50,
    })
    for (const f of rac) {
        await xoaVinhVien(prisma, schema, f)
        await prisma.storageActivity.create({ data: { fileId: null, action: 'xoa_vinh_vien', actor: 'Hệ thống', detail: `Tự xoá "${f.name}" sau ${THUNG_RAC_NGAY} ngày trong thùng rác` } })
    }
    const treo: any[] = await prisma.storageFile.findMany({
        where: { status: 'uploading', createdAt: { lt: new Date(now.getTime() - NGAY_MS) } },
        select: { id: true, objectKey: true }, take: 100,
    })
    for (const f of treo) {
        if (kho.khoaCuaCuaHang(f.objectKey, schema)) await kho.xoa(f.objectKey)
        await prisma.storageFile.delete({ where: { id: f.id } }).catch(() => {})
    }
    return { rac: rac.length, treo: treo.length }
}
