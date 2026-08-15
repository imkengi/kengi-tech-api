/**
 * KIỂM CỔNG DUYỆT CONTENT AI  —  npm run check:marketing
 *
 * Chạy bộ tool marketing bằng prisma GIẢ, không đụng database thật.
 * Chất lượng content phụ thuộc vào các luật chặn ở đây (từ cấm, trùng bài,
 * trùng giờ, cam kết sai luật quảng cáo, hook quá dài) — mà đó là logic thuần,
 * kiểm được không cần DB. Sửa kiemDuyet/suggest_slots xong hãy chạy lại script
 * này trước khi deploy: build sạch KHÔNG chứng minh các luật còn hiệu lực.
 */
import { MARKETING_TOOLS } from '../src/routes/mcpMarketingTools'

const VN = 7 * 3600e3
const gioVN = (d: any) => d ? new Date(new Date(d).getTime() + VN).toISOString().slice(0, 16) + ' VN' : null

// ─── Prisma giả ──────────────────────────────────────────────────────────────
const drafts: any[] = []
const plans: any[] = []
let hoSo: any = {
    id: 'b1', brandName: 'Kengi Store', industry: 'giày dép',
    audience: 'nữ 25-40', toneOfVoice: 'than-thien', usp: 'chính hãng',
    cta: 'Inbox tư vấn', hashtags: '["kengistore"]',
    bannedWords: '["hàng fake","xả kho"]', emojiLevel: 'vua',
    postsPerWeek: 5, bestHours: '[7,12,20]', pillarMix: '{}', notes: '',
}

const prisma: any = {
    fbBrandProfile: {
        findFirst: async () => hoSo,
        update: async ({ data }: any) => { hoSo = { ...hoSo, ...data }; return hoSo },
        create: async ({ data }: any) => { hoSo = { id: 'b1', ...data }; return hoSo },
    },
    fbPage: {
        findFirst: async () => ({ pageId: '111', name: 'Kengi Store', status: 'active', accessToken: 'x' }),
        findMany: async () => [{ pageId: '111', name: 'Kengi Store', status: 'active', accessToken: 'x' }],
        findUnique: async () => ({ pageId: '111', name: 'Kengi Store', status: 'active', accessToken: 'x' }),
        update: async () => ({}),
    },
    fbScheduledPost: { findMany: async () => [] },
    fbContentPlan: {
        create: async ({ data }: any) => { const p = { id: 'p1', ...data }; plans.push(p); return p },
        findUnique: async ({ where }: any) => plans.find(p => p.id === where.id) || null,
        findMany: async () => plans,
    },
    fbContentDraft: {
        create: async ({ data }: any) => { const d = { id: 'd' + (drafts.length + 1), ...data }; drafts.push(d); return d },
        findMany: async ({ where }: any) => drafts.filter(d => {
            if (where?.suggestedAt?.gte && (!d.suggestedAt || d.suggestedAt < where.suggestedAt.gte)) return false
            if (where?.suggestedAt?.lte && (!d.suggestedAt || d.suggestedAt > where.suggestedAt.lte)) return false
            return true
        }),
        findFirst: async ({ where }: any) => {
            const g = where?.suggestedAt?.gte, l = where?.suggestedAt?.lte
            return drafts.find(d => d.suggestedAt && (!g || d.suggestedAt >= g) && (!l || d.suggestedAt <= l)) || null
        },
        findUnique: async ({ where }: any) => drafts.find(d => d.id === where.id) || null,
        update: async ({ where, data }: any) => { const d = drafts.find(x => x.id === where.id); Object.assign(d, data); return d },
    },
}
const ctx: any = { prisma, scopes: 'read,write', storeCode: 'TEST', userId: 'u1' }
const tool = (n: string) => MARKETING_TOOLS.find(t => t.name === n)!

let dat = 0, truot = 0
function kiem(ten: string, ok: boolean, chiTiet = '') {
    if (ok) { dat++; console.log(`  ✅ ${ten}`) }
    else { truot++; console.log(`  ❌ ${ten} ${chiTiet}`) }
}
async function nemLoi(fn: () => Promise<any>): Promise<string | null> {
    try { await fn(); return null } catch (e: any) { return e.message }
}

async function main() {
    console.log('\n━━ 1. Bộ phát khung giờ ━━')
    const slots: any = await tool('marketing_suggest_slots').run({ days: 7, count: 6 }, ctx)
    console.log('  giờ vàng:', slots.gioVangDangDung, '| số khung:', slots.soKhungTraVe)
    console.log('  ba khung đầu:', slots.khungGio.slice(0, 3).map((s: any) => s.moTa))
    kiem('trả về đủ khung yêu cầu', slots.soKhungTraVe === 6)
    kiem('khung nào cũng rơi vào giờ vàng 7/12/20', slots.khungGio.every((s: any) => [7, 12, 20].includes(Number(s.suggested_at.slice(11, 13)))))
    kiem('mọi khung đều ở tương lai', slots.khungGio.every((s: any) => new Date(s.suggested_at + '+07:00').getTime() > Date.now()))

    console.log('\n━━ 2. Cổng kiểm duyệt ━━')
    const plan: any = await tool('marketing_create_plan').run({ title: 'Tuần thử' }, ctx)
    const luu = (a: any) => tool('marketing_save_draft').run(a, ctx)

    const loiCam = await nemLoi(() => luu({
        pillar: 'san-pham', suggested_at: slots.khungGio[0].suggested_at,
        message: 'Đợt này shop xả kho toàn bộ mẫu sandal, inbox ngay để chốt đơn nhé cả nhà ơi.',
    }))
    kiem('CHẶN bài dính từ cấm của shop', !!loiCam && /xả kho/i.test(loiCam), '→ ' + loiCam)

    const ok1: any = await luu({
        pillar: 'giao-duc', plan_id: plan.plan_id, suggested_at: slots.khungGio[0].suggested_at,
        title: 'Mẹo chọn size', hook: 'Mua giày online 3 lần thì 2 lần chật — vì bạn đang đo sai chỗ.',
        message: 'Đo bàn chân lúc chiều tối, khi chân đã nở nhất trong ngày.\n\nĐặt gót sát tường rồi đo tới đầu ngón dài nhất.\n\nCộng thêm 0.5cm rồi tra bảng size của shop.\n\nInbox số đo, shop tra size giúp bạn.',
        hashtags: ['kengistore', 'chonsizegiay'], media_idea: 'Thước dây cạnh bàn chân trên nền gỗ sáng',
    })
    kiem('NHẬN bài đạt chuẩn', !!ok1.draft_id)
    kiem('bài đạt chuẩn không sinh cảnh báo', ok1.canhBao === null, '→ ' + JSON.stringify(ok1.canhBao))

    const loiTrung = await nemLoi(() => luu({
        pillar: 'giao-duc', suggested_at: slots.khungGio[2].suggested_at,
        message: 'Đo bàn chân lúc chiều tối, khi chân đã nở nhất trong ngày. Đặt gót sát tường rồi đo tới đầu ngón dài nhất. Cộng thêm 0.5cm rồi tra bảng size của shop. Inbox số đo nhé.',
    }))
    kiem('CHẶN bài viết lại gần y nguyên', !!loiTrung && /trùng/i.test(loiTrung), '→ ' + loiTrung)

    const loiGio = await nemLoi(() => luu({
        pillar: 'tuong-tac', suggested_at: slots.khungGio[0].suggested_at,
        message: 'Bạn thường đi size mấy? Bình luận số size để shop gợi ý mẫu vừa chân nhất nhé, shop trả lời từng người một.',
    }))
    kiem('CHẶN hai bài dồn cùng khung giờ', !!loiGio && /90 phút/.test(loiGio), '→ ' + loiGio)

    const loiQuaKhu = await nemLoi(() => luu({
        pillar: 'tuong-tac', suggested_at: '2020-01-01T08:00:00',
        message: 'Bạn thường đi size mấy? Bình luận số size để shop gợi ý mẫu vừa chân nhất nhé.',
    }))
    kiem('CHẶN giờ đã trôi qua', !!loiQuaKhu && /đã qua|quá sát/.test(loiQuaKhu), '→ ' + loiQuaKhu)

    console.log('\n━━ 3. Cảnh báo chất lượng (vẫn lưu, nhưng phải báo) ━━')
    const yeu: any = await luu({
        pillar: 'san-pham', suggested_at: slots.khungGio[3].suggested_at,
        hook: 'Kính chào quý khách, shop xin trân trọng giới thiệu tới quý khách hàng bộ sưu tập sandal mùa hè mới nhất năm nay với rất nhiều mẫu mã đa dạng',
        message: 'Sandal mẫu mới về, chất liệu da thật, đế cao su, cam kết 100% chính hãng, tốt nhất thị trường hiện nay. Nhiều màu để lựa chọn thoải mái.',
    })
    const cb = (yeu.canhBao || []).join(' | ')
    console.log('  cảnh báo:', cb)
    kiem('bắt cam kết tuyệt đối sai luật QC', /cam kết tuyệt đối/.test(cb))
    kiem('bắt hook dài quá 125 ký tự', /Câu mở dài/.test(cb))
    kiem('bắt thiếu lời kêu gọi hành động', /kêu gọi hành động/.test(cb))
    kiem('bắt thiếu hashtag', /hashtag/.test(cb))

    console.log('\n━━ 4. Múi giờ (lỗi lệch 7 tiếng) ━━')
    const s0 = slots.khungGio[0].suggested_at
    const d0 = drafts.find(d => d.title === 'Mẹo chọn size')
    console.log(`  tool phát: "${s0}" → lưu DB (UTC): ${d0.suggestedAt.toISOString()} → đọc lại: ${gioVN(d0.suggestedAt)}`)
    kiem('giờ VN đi một vòng vẫn nguyên vẹn', gioVN(d0.suggestedAt)!.slice(0, 16) === s0.slice(0, 16).replace('T', 'T'))

    console.log(`\n━━ KẾT QUẢ: ${dat} đạt / ${truot} trượt ━━\n`)
    process.exit(truot ? 1 : 0)
}
main().catch(e => { console.error('LỖI:', e); process.exit(1) })
