/**
 * LUẬT NỘI DUNG DÙNG CHUNG — route /api/mkt VÀ tool MCP mkt_* gọi CÙNG các hàm này.
 * Tách ra để hai cửa không bao giờ lệch nhau: một luật an toàn chỉ có ở giao diện mà
 * thiếu ở MCP (hay ngược lại) là AI đi vòng qua được.
 */
import { LoiMkt } from './mktThuongHieu'
import { kiemDinhDang } from '../services/mktNenTangKhac'

export function jsonMang(raw: any): any[] {
    if (Array.isArray(raw)) return raw
    try { const v = JSON.parse(String(raw || '[]')); return Array.isArray(v) ? v : [] } catch { return [] }
}

/** Nội dung trả ra ngoài: các cột JSON thành mảng thật. */
export const noiDungRa = (c: any) => c && ({
    ...c,
    hashtags: jsonMang(c.hashtags),
    assetIds: jsonMang(c.assetIds),
    productIds: jsonMang(c.productIds),
    variants: jsonMang(c.variants),
})

/**
 * Kiểm phiên bản theo kênh. Mỗi kênh phải thuộc ĐÚNG thương hiệu này — không thì một
 * bài của thương hiệu A được xếp lên trang của thương hiệu B.
 */
export async function kiemPhienBan(prisma: any, brandId: string, raw: any): Promise<any[]> {
    if (raw === undefined) return []
    if (!Array.isArray(raw) || raw.length > 20) throw new LoiMkt('variants phải là mảng, tối đa 20 kênh.')
    const ra: any[] = [], daCo = new Set<string>()
    for (const v of raw) {
        const accountId = String(v?.accountId || '')
        if (!accountId) throw new LoiMkt('Mỗi phiên bản phải có accountId.')
        if (daCo.has(accountId)) throw new LoiMkt('Một kênh chỉ có một phiên bản trong mỗi bài.')
        daCo.add(accountId)
        const acc = await prisma.mktAccount.findFirst({ where: { id: accountId, brandId } })
        if (!acc) throw new LoiMkt('Kênh trong phiên bản không thuộc thương hiệu này.', 400, 'SAI_THUONG_HIEU')
        const text = typeof v?.text === 'string' ? v.text : ''
        const title = typeof v?.title === 'string' ? v.title : ''
        if (text.length > 63206 || title.length > 200) throw new LoiMkt(`Phiên bản cho ${acc.name} quá dài.`)
        const assetIds = Array.isArray(v?.assetIds) ? v.assetIds.map(String).slice(0, 10) : []
        const options = v?.options && typeof v.options === 'object' && !Array.isArray(v.options) ? v.options : {}
        ra.push({ accountId, text, title, assetIds, options })
    }
    return ra
}

/** Media dùng trong bài phải thuộc thương hiệu này. */
export async function kiemMedia(prisma: any, brandId: string, ids: string[]) {
    for (const id of ids) {
        const a = await prisma.mktAsset.findFirst({ where: { id, brandId }, select: { id: true } })
        if (!a) throw new LoiMkt('Có media không thuộc thương hiệu này.', 400, 'SAI_THUONG_HIEU')
    }
}

/** Từ cấm của thương hiệu có trong chữ không. */
export function tuCamGapPhai(brand: any, ...chu: string[]): string[] {
    let cam: string[] = []
    try { cam = JSON.parse(brand?.bannedWords || '[]') } catch { }
    const gop = chu.join(' ').toLocaleLowerCase('vi')
    return cam.filter(w => w && gop.includes(String(w).toLocaleLowerCase('vi')))
}

/**
 * Lỗi định dạng của bài KHI ĐĂNG LÊN một kênh: đúng phiên bản của kênh đó (không có thì
 * thân chung), đúng media của nó, cộng từ cấm của thương hiệu.
 */
export async function loiKhiDangLen(prisma: any, brand: any, c: any, acc: any): Promise<string[]> {
    const pb = jsonMang(c.variants).find((v: any) => v.accountId === acc.id)
    const text = (pb?.text || '').trim() ? pb.text : (c.body || '')
    const title = (pb?.title || '').trim() ? pb.title : (c.title || '')
    const ids: string[] = pb?.assetIds?.length ? pb.assetIds : jsonMang(c.assetIds)
    const media = ids.length ? await prisma.mktAsset.findMany({ where: { id: { in: ids }, brandId: brand.id } }) : []
    const loi = kiemDinhDang(acc.platform, { text, title, options: pb?.options || {} }, media)
    if (media.length !== ids.length) loi.push('Có media đã bị xoá khỏi thư viện.')
    for (const w of tuCamGapPhai(brand, title, text)) loi.push(`Có từ cấm của thương hiệu: "${w}".`)
    return loi
}

/**
 * Lên lịch MỘT bài ĐÃ DUYỆT ra các kênh. Mỗi kênh một MktPublication riêng (kênh này hỏng
 * không kéo kênh kia); `idempotencyKey` = bài|kênh|revision nên gọi hai lần vẫn một bài.
 * Kênh sai định dạng bị BỎ QUA kèm lý do — chặn ở đây, đừng để tới giờ đăng mới hỏng.
 */
export async function lenLich(prisma: any, brand: any, c: any, accountIds: string[], khi: Date) {
    if (c.approvedRevision !== c.revision)
        throw new LoiMkt('Bài chưa được duyệt, hoặc đã sửa sau khi duyệt. Duyệt lại bản hiện tại rồi mới lên lịch.', 409, 'CHUA_DUYET')
    if (!accountIds.length) accountIds = jsonMang(c.variants).map((v: any) => String(v.accountId))
    if (!accountIds.length) throw new LoiMkt('Chưa chọn kênh nào.')
    if (isNaN(khi.getTime())) throw new LoiMkt('Giờ hẹn không hợp lệ.')

    const taoRa: any[] = [], boQua: string[] = []
    for (const accId of accountIds) {
        const acc = await prisma.mktAccount.findFirst({ where: { id: accId, brandId: brand.id } })
        if (!acc) { boQua.push(`${accId}: không có kênh này trong thương hiệu`); continue }
        if (acc.status !== 'active') { boQua.push(`${acc.name}: kênh đang "${acc.status}"`); continue }
        const loi = await loiKhiDangLen(prisma, brand, c, acc)
        if (loi.length) { boQua.push(`${acc.name}: ${loi.join(' ')}`); continue }
        const key = `${c.id}|${accId}|${c.revision}`
        if (await prisma.mktPublication.findUnique({ where: { idempotencyKey: key } })) { boQua.push(`${acc.name}: đã có trong hàng đợi`); continue }
        taoRa.push(await prisma.mktPublication.create({
            data: { contentId: c.id, accountId: accId, idempotencyKey: key, scheduledAt: khi, status: 'queued' },
        }))
    }
    if (taoRa.length) await prisma.mktContent.update({ where: { id: c.id }, data: { status: 'scheduled' } })
    return { taoRa, boQua }
}
