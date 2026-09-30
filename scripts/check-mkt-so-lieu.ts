/**
 * KIỂM SỐ LIỆU BÀI ĐĂNG (tự làm mới + kéo Threads)  —  một phần của npm run check:mkt
 *
 * HUTI 30/09: bấm Đồng bộ lúc bài Threads mới lên vài phút ⇒ lưu 0/0/0/0 và bảng đứng yên ở
 * 0 vì số liệu chỉ đổi khi người bấm. Soát vòng tự làm mới chọn ĐÚNG bài, và Threads đọc đủ
 * 6 chỉ số. prisma GIẢ + fetch GIẢ; DATABASE_URL trỏ cổng chết (máy dev .env = PROD).
 */
process.env.DATABASE_URL = 'postgresql://khong:khong@127.0.0.1:1/khong-bao-gio'
process.env.DIRECT_URL = process.env.DATABASE_URL
process.env.MARKETING_VAULT_KEY = 'd'.repeat(64)

let dat = 0, truot = 0
function kiem(ten: string, dung: boolean, chiTiet?: any) {
    if (dung) { dat++; console.log('  ✅', ten) }
    else { truot++; console.log('  ❌', ten, chiTiet !== undefined ? JSON.stringify(chiTiet).slice(0, 300) : '') }
}

async function main() {
    const { maHoa } = await import('../src/lib/maHoaKhoa')
    const { chonLuotCanLamMoi, keoSoLieu, danhDauHong } = await import('../src/services/mktSoLieu')
    const phut = (n: number) => new Date(Date.now() - n * 60_000)
    const gio = (n: number) => phut(n * 60)
    const tk = maHoa('TOKEN_THU')
    const acc: Record<string, any> = {
        aOk: { id: 'aOk', platform: 'threads', status: 'active', accessToken: tk, name: 'Threads' },
        aHet: { id: 'aHet', platform: 'threads', status: 'token_expired', accessToken: tk, name: 'Threads hết hạn' },
    }
    const pubs: any[] = [
        { id: 'moiLen', accountId: 'aOk', status: 'sent', remotePostId: 'r1', sentAt: phut(5) },          // mới 5 phút — đợi
        { id: 'chuaCo', accountId: 'aOk', status: 'sent', remotePostId: 'r2', sentAt: gio(1) },           // chưa có số — lấy
        { id: 'vuaDo', accountId: 'aOk', status: 'sent', remotePostId: 'r3', sentAt: gio(48) },           // đo 1 giờ trước — bỏ
        { id: 'cuRoi', accountId: 'aOk', status: 'sent', remotePostId: 'r4', sentAt: gio(72) },           // đo 4 giờ trước — lấy
        { id: 'quaCu', accountId: 'aOk', status: 'sent', remotePostId: 'r5', sentAt: gio(24 * 20) },      // 20 ngày — bỏ
        { id: 'kenhHong', accountId: 'aHet', status: 'sent', remotePostId: 'r6', sentAt: gio(24) },       // kênh hết hạn — bỏ
        { id: 'chuaDang', accountId: 'aOk', status: 'failed', remotePostId: null, sentAt: null },         // chưa đăng — bỏ
    ]
    const metrics: any[] = [
        { id: 'm1', publicationId: 'vuaDo', snapshotAt: gio(1) },
        { id: 'm2', publicationId: 'cuRoi', snapshotAt: gio(4) },
        { id: 'm3', publicationId: 'cuRoi', snapshotAt: gio(30) },
    ]
    const khop = (p: any, w: any = {}) => Object.entries(w).every(([k, v]: any) => {
        if (k === 'account') return Object.entries(v).every(([kk, vv]) => acc[p.accountId][kk] === vv)
        if (v && typeof v === 'object' && !(v instanceof Date)) {
            if ('in' in v && !v.in.includes(p[k])) return false
            if ('not' in v && p[k] === v.not) return false
            if ('gte' in v && !(p[k] && p[k] >= v.gte)) return false
            if ('lte' in v && !(p[k] && p[k] <= v.lte)) return false
            return true
        }
        return p[k] === v
    })
    const taoRa: any[] = []
    const prisma: any = {
        mktPublication: {
            findMany: async ({ where, include, orderBy, take }: any) => {
                let r = pubs.filter(p => khop(p, where))
                if (orderBy?.sentAt === 'desc') r = r.sort((a, b) => +b.sentAt - +a.sentAt)
                r = r.slice(0, take ?? r.length)
                return include?.account ? r.map(p => ({ ...p, account: acc[p.accountId] })) : r.map(p => ({ id: p.id }))
            },
        },
        mktMetric: {
            findMany: async ({ where }: any) => metrics.filter(m => where.publicationId.in.includes(m.publicationId)).sort((a, b) => +b.snapshotAt - +a.snapshotAt),
            create: async ({ data }: any) => { taoRa.push(data); return data },
        },
    }

    console.log('━━ Chọn bài cần làm mới')
    let ds = await chonLuotCanLamMoi(prisma, 5)
    kiem('chỉ lấy bài chưa có số + bài có số cũ hơn 3 giờ, MỚI ĐĂNG TRƯỚC', ds.map(p => p.id).join() === 'chuaCo,cuRoi', ds.map(p => p.id))
    kiem('bỏ bài mới lên 5 phút (chưa ai kịp xem — khỏi lưu một loạt số 0)', !ds.some(p => p.id === 'moiLen'))
    kiem('bỏ bài quá 14 ngày, kênh hết hạn, bài chưa đăng', !ds.some(p => ['quaCu', 'kenhHong', 'chuaDang'].includes(p.id)))
    kiem('trả kèm account để kéo số', ds.every(p => p.account?.platform === 'threads'))
    kiem('tôn trọng giới hạn số bài mỗi lần', (await chonLuotCanLamMoi(prisma, 1)).map(p => p.id).join() === 'chuaCo')

    console.log('━━ Kéo số Threads (6 chỉ số)')
    let urlGoi = ''
    ;(globalThis as any).fetch = async (url: string) => {
        urlGoi = String(url)
        return new Response(JSON.stringify({ data: [
            { name: 'views', period: 'lifetime', values: [{ value: 57 }] },
            { name: 'likes', period: 'lifetime', values: [{ value: 4 }] },
            { name: 'replies', period: 'lifetime', values: [{ value: 2 }] },
            { name: 'reposts', period: 'lifetime', values: [{ value: 1 }] },
            { name: 'quotes', period: 'lifetime', values: [{ value: 0 }] },
            { name: 'shares', period: 'lifetime', values: [{ value: 3 }] },
        ] }), { status: 200 })
    }
    const cs = await keoSoLieu(prisma, ds[0])
    kiem('hỏi đủ 6 chỉ số (có shares)', /metric=views,likes,replies,reposts,quotes,shares/.test(urlGoi), urlGoi)
    kiem('chia sẻ = repost + quote + share', cs.shares === 4 && cs.views === 57 && cs.likes === 4 && cs.comments === 2, cs)
    kiem('lưu snapshot đúng bài, đúng kênh', taoRa.at(-1)?.publicationId === 'chuaCo' && taoRa.at(-1)?.accountId === 'aOk' && taoRa.at(-1)?.views === 57, taoRa.at(-1))
    ;(globalThis as any).fetch = async () => new Response(JSON.stringify({ data: [{ name: 'likes', values: [{ value: 0 }] }] }), { status: 200 })
    const thieu = await keoSoLieu(prisma, ds[0])
    kiem('nền tảng không trả chỉ số nào thì NULL, không ghi 0', thieu.views === null && thieu.shares === null && thieu.likes === 0, thieu)

    console.log('━━ Bài vừa lỗi: tạm bỏ qua')
    danhDauHong('chuaCo')
    ds = await chonLuotCanLamMoi(prisma, 5)
    kiem('bài vừa lỗi không bị gọi lại ngay (vòng tự động không gọi mãi)', ds.map(p => p.id).join() === 'cuRoi', ds.map(p => p.id))

    console.log(`\n━━ KẾT QUẢ: ${dat} đạt / ${truot} trượt ━━`)
    process.exit(truot ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
