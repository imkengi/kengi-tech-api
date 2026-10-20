/**
 * NHỊP NỀN KENGI VAULT (20/10/2026) — gọi từ POST /api/cron/tick (Cloud Scheduler mỗi phút).
 *
 *  1. NHẮC GIẤY TỜ SẮP HẾT HẠN (hợp đồng, giấy phép, đăng kiểm…): mỗi cửa hàng MỘT tin gộp mỗi ngày, trong
 *     khung 8h–21h giờ VN; mốc 30/7/1 ngày (cài được) + đúng ngày hết hạn + "đã hết hạn" một lần
 *     (lib/vaultViec.ts mocCanNhac). Giành lượt bằng dòng StorageConfig 'nhac-ngay' — prod không có Redis.
 *  2. DỌN: thùng rác quá 30 ngày ⇒ xoá hẳn object + dòng; phiên tải lên bỏ dở quá 24 giờ ⇒ xoá.
 *  3. HÀNG ĐỢI AI: tệp aiStatus='pending' mà tab trình duyệt đóng trước khi AI đọc xong — đọc nốt, tối đa
 *     2 tệp mỗi nhịp, trong ngân sách thời gian (Gemini có khi 30–60 giây một tệp).
 *
 * ĐỌC HỎNG ≠ KHÔNG CÓ VIỆC: cửa hàng lỗi thì ghi log, đi tiếp. ⛔ PRISMA_POOL_SIZE=1 — duyệt TUẦN TỰ.
 */
import { registryPrisma, getStorePrisma, giuClient } from '../lib/prisma'
import { moTaLoi } from '../lib/gomLoi'
import { damBaoBangVault } from '../lib/khoTaiLieu'
import { nhacHetHanCuaHang, donDepCuaHang, aiDocMotTep, ghiLoiAi } from '../lib/vaultViec'
import { LoiAiTaiLieu } from '../lib/vaultAi'

const guiPush = async (sp: any, tieuDe: string, noiDung: string, meta: { id?: string; type: string; route: string | null }) => {
    const { sendPushToStore } = await import('../routes/notifications')
    return (sendPushToStore as any)(sp, tieuDe, noiDung, meta)
}

let lanNhacCuoi = 0
let lanAiCuoi = 0

export async function nhipKhoTaiLieu(nganSachMs = 35_000): Promise<string> {
    const batDau = Date.now()
    const now = new Date()
    const ra: string[] = []
    // Nhắc + dọn: 15 phút một lượt là đủ (giành lượt ngày trong CSDL nên lượt thừa chỉ tốn một câu hỏi)
    const lamNhac = Date.now() - lanNhacCuoi > 15 * 60_000
    const lamAi = Date.now() - lanAiCuoi > 3 * 60_000
    if (!lamNhac && !lamAi) return 'bo-qua'
    if (lamNhac) lanNhacCuoi = Date.now()
    if (lamAi) lanAiCuoi = Date.now()
    let stores: any[] = []
    try {
        stores = await registryPrisma.store.findMany({ where: { status: 'active' }, select: { code: true, schema: true } }) as any[]
    } catch (e: any) { return 'loi: không đọc được danh sách cửa hàng — ' + moTaLoi(e) }
    let aiDaDoc = 0
    for (const store of stores) {
        if (Date.now() - batDau > nganSachMs) { ra.push('het-ngan-sach'); break }
        const nha = giuClient(store.schema)
        try {
            const sp: any = getStorePrisma(store.schema)
            await damBaoBangVault(sp, store.schema)
            if (lamNhac) {
                const nhac = await nhacHetHanCuaHang(sp, store.schema, now, guiPush)
                if (nhac.daNhac) ra.push(`${store.code}: nhắc ${nhac.soTep} giấy tờ`)
                const don = await donDepCuaHang(sp, store.schema, now)
                if (don.rac || don.treo) ra.push(`${store.code}: dọn ${don.rac} rác, ${don.treo} phiên treo`)
            }
            if (lamAi && aiDaDoc < 2) {
                const cho: any[] = await sp.storageFile.findMany({
                    where: { status: 'ready', aiStatus: 'pending', OR: [{ aiAt: null }, { aiAt: { lt: new Date(Date.now() - 15 * 60_000) } }], createdAt: { gt: new Date(Date.now() - 7 * 86400_000) } },
                    orderBy: { createdAt: 'asc' }, take: 2 - aiDaDoc, omit: { aiText: true } as any,
                })
                for (const f of cho) {
                    if (Date.now() - batDau > nganSachMs - 5_000) break
                    try {
                        await aiDocMotTep(sp, store.schema, f)
                        await sp.storageActivity.create({ data: { fileId: f.id, action: 'ai_doc', actor: 'Hệ thống', detail: 'AI đọc nền (tab đã đóng trước khi đọc xong)' } })
                        aiDaDoc++
                    } catch (e: any) {
                        if (e instanceof LoiAiTaiLieu) await ghiLoiAi(sp, f.id, e)
                        else throw e
                    }
                }
            }
        } catch (e: any) {
            console.error(`[Vault] ${store.code}: ${moTaLoi(e)}`)
            ra.push(`${store.code}: lỗi`)
        } finally {
            nha()
        }
    }
    if (aiDaDoc) ra.push(`AI đọc ${aiDaDoc} tệp`)
    return ra.join('; ') || 'xong'
}
