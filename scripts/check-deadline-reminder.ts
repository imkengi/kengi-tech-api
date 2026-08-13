/**
 * Kiểm chứng CRON NHẮC HẠN NỘP THUẾ — npx tsx scripts/check-deadline-reminder.ts
 *
 * Nhắc là con dao hai lưỡi: nhắc thiếu thì người dùng trễ hạn và bị phạt, nhắc
 * thừa thì họ tắt thông báo của cả ứng dụng và mất luôn cảnh báo quan trọng
 * khác. Nên mỗi quy tắc đều có ca "phải nhắc" VÀ ca "phải im".
 */

import { locMocCanNhac } from '../src/lib/taxCalendarStore'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — thực tế: ${JSON.stringify(thucTe)}` : ''}`) }
}

const HOM_NAY = '2026-08-14'

const moc = (over: Partial<any> = {}) => ({
    id: 'x', taxType: '01_GTGT_Q', period: 'Q3/2026', dueDate: '2026-10-31',
    status: 'pending', reminderSent: false, description: 'Tờ khai GTGT quý 3/2026',
    ...over,
})

async function main() {
    console.log('\n═══ NHẮC HẠN NỘP THUẾ ═══\n')

    console.log('▸ Cửa sổ nhắc 7 ngày')
    const r1 = locMocCanNhac([moc({ id: 'a', dueDate: '2026-08-20' })], HOM_NAY)
    ok('còn 6 ngày → nhắc', r1.sapToiHan.length === 1 && r1.sapToiHan[0].conNgay === 6, r1.sapToiHan)
    const r2 = locMocCanNhac([moc({ id: 'b', dueDate: '2026-08-21' })], HOM_NAY)
    ok('đúng 7 ngày → vẫn nhắc', r2.sapToiHan.length === 1)
    const r3 = locMocCanNhac([moc({ id: 'c', dueDate: '2026-08-22' })], HOM_NAY)
    ok('8 ngày → chưa nhắc (còn sớm)', r3.sapToiHan.length === 0)
    const r4 = locMocCanNhac([moc({ id: 'd', dueDate: HOM_NAY })], HOM_NAY)
    ok('hạn đúng hôm nay → nhắc, còn 0 ngày',
        r4.sapToiHan.length === 1 && r4.sapToiHan[0].conNgay === 0, r4.sapToiHan)

    console.log('\n▸ Chỉ nhắc một lần')
    const r5 = locMocCanNhac([moc({ id: 'e', dueDate: '2026-08-18', reminderSent: true })], HOM_NAY)
    ok('đã nhắc rồi thì thôi', r5.sapToiHan.length === 0)
    ok('mốc đã nhắc vẫn không bị coi là quá hạn khi chưa tới hạn', r5.vuaQuaHan.length === 0)

    console.log('\n▸ Không nhắc mốc đã xong')
    for (const tt of ['submitted', 'overdue', 'paid']) {
        const r = locMocCanNhac([moc({ id: tt, dueDate: '2026-08-18', status: tt })], HOM_NAY)
        ok(`trạng thái "${tt}" thì không nhắc`, r.sapToiHan.length === 0 && r.vuaQuaHan.length === 0)
    }

    console.log('\n▸ Mốc vừa quá hạn')
    const r6 = locMocCanNhac([moc({ id: 'f', dueDate: '2026-08-13' })], HOM_NAY)
    ok('quá hạn 1 ngày → báo quá hạn', r6.vuaQuaHan.length === 1, r6.vuaQuaHan)
    ok('không đồng thời nằm trong nhóm sắp tới hạn', r6.sapToiHan.length === 0)
    const r7 = locMocCanNhac([moc({ id: 'g', dueDate: '2026-01-20', status: 'overdue' })], HOM_NAY)
    ok('mốc ĐÃ đánh dấu quá hạn thì không báo lại',
        r7.vuaQuaHan.length === 0, r7.vuaQuaHan)

    console.log('\n▸ Sắp xếp và gộp')
    const nhieu = locMocCanNhac([
        moc({ id: 'x1', taxType: 'MON_BAI', period: 'MB-2026', dueDate: '2026-08-19' }),
        moc({ id: 'x2', taxType: '01_GTGT_Q', period: 'Q2/2026', dueDate: '2026-08-15' }),
        moc({ id: 'x3', taxType: 'TNDN_TAM_NOP', period: 'TN-Q2/2026', dueDate: '2026-08-17' }),
        moc({ id: 'x4', taxType: 'BCTC', period: 'BCTC-2025', dueDate: '2026-08-01' }),
    ], HOM_NAY)
    ok('gộp đủ 3 mốc sắp tới hạn', nhieu.sapToiHan.length === 3, nhieu.sapToiHan.map(m => m.id))
    ok('mốc gần hạn nhất lên đầu', nhieu.sapToiHan[0].id === 'x2', nhieu.sapToiHan.map(m => m.id))
    ok('bắt riêng mốc đã quá hạn', nhieu.vuaQuaHan.length === 1 && nhieu.vuaQuaHan[0].id === 'x4')

    console.log('\n▸ Bảng rỗng / dữ liệu lạ')
    ok('không có mốc nào thì không nhắc',
        locMocCanNhac([], HOM_NAY).sapToiHan.length === 0)
    const r8 = locMocCanNhac([moc({ id: 'h', dueDate: '2026-08-18', reminderSent: null as any })], HOM_NAY)
    ok('reminderSent null (bản ghi cũ) vẫn được nhắc', r8.sapToiHan.length === 1)
    const r9 = locMocCanNhac([moc({ id: 'i', dueDate: '2026-08-18T00:00:00.000Z' })], HOM_NAY)
    ok('ngày dạng ISO đầy đủ vẫn tính đúng', r9.sapToiHan.length === 1, r9.sapToiHan)

    console.log('\n▸ Đổi số ngày báo trước')
    const r10 = locMocCanNhac([moc({ id: 'j', dueDate: '2026-08-25' })], HOM_NAY, 14)
    ok('đặt 14 ngày thì mốc còn 11 ngày cũng được nhắc', r10.sapToiHan.length === 1)
    const r11 = locMocCanNhac([moc({ id: 'k', dueDate: '2026-08-25' })], HOM_NAY, 3)
    ok('đặt 3 ngày thì mốc còn 11 ngày chưa nhắc', r11.sapToiHan.length === 0)

    /* ── Chạy thật cả hàm nhắc ────────────────────────────────────────────────
     * Phần trên kiểm luật lọc; phần này kiểm hành vi: có gieo lịch trước không,
     * thông báo viết gì, và có đánh dấu để lần sau khỏi nhắc lại không.
     */
    console.log('\n▸ Chạy cả hàm nhắc với client giả')
    const { nhacChoStore } = await import('../src/cron/taxDeadlineCron')

    const dungPrisma = (hanNop: any[]) => {
        const thongBao: any[] = []
        const daCapNhat: any[] = []
        const prisma: any = {
            storeSettings: { findFirst: async () => ({ businessType: 'company' }) },
            taxDeclaration: { findMany: async () => [{ periodType: 'quarter' }] },
            journalEntry: { findMany: async () => [] },
            payrollEntry: { count: async () => 0 },
            taxDeadline: {
                findMany: async () => hanNop,
                upsert: async () => ({}),
                deleteMany: async () => ({ count: 0 }),
                updateMany: async (a: any) => { daCapNhat.push(a); return { count: 1 } },
            },
            notification: { create: async (a: any) => { thongBao.push(a.data); return {} } },
        }
        return { prisma, thongBao, daCapNhat }
    }

    const g1 = dungPrisma([
        { id: 'm1', taxType: '01_GTGT_Q', period: 'Q2/2026', dueDate: '2026-08-17', status: 'pending', reminderSent: false, description: 'Tờ khai GTGT quý 2/2026' },
        { id: 'm2', taxType: 'BCTC', period: 'BCTC-2025', dueDate: '2026-03-31', status: 'pending', reminderSent: false, description: 'Báo cáo tài chính 2025' },
    ])
    const so = await nhacChoStore(g1.prisma, 'Cửa hàng test', HOM_NAY)
    ok('trả về đúng số mốc đã xử lý', so === 2, so)
    ok('gửi đúng MỘT thông báo gộp, không bắn từng mốc', g1.thongBao.length === 1, g1.thongBao.length)
    const tb = g1.thongBao[0] || {}
    ok('thông báo đúng loại tax-deadline', tb.type === 'tax-deadline', tb.type)
    ok('tiêu đề nêu có mốc quá hạn', /QUÁ HẠN/.test(String(tb.title)), tb.title)
    ok('nội dung dịch mã sang tên đọc được',
        String(tb.message).includes('Tờ khai GTGT') && String(tb.message).includes('Báo cáo tài chính'),
        tb.message)
    ok('nội dung nêu số ngày còn lại', /Còn 3 ngày/.test(String(tb.message)), tb.message)
    ok('nhắc hậu quả nộp muộn kèm căn cứ',
        /0,03%\/ngày/.test(String(tb.message)) && /Điều 59/.test(String(tb.message)), tb.message)
    ok('đánh dấu đã nhắc cho mốc sắp tới hạn',
        g1.daCapNhat.some(u => u.data?.reminderSent === true && u.where?.id?.in?.includes('m1')),
        g1.daCapNhat)
    ok('chuyển mốc quá hạn sang trạng thái overdue',
        g1.daCapNhat.some(u => u.data?.status === 'overdue' && u.where?.id?.in?.includes('m2')),
        g1.daCapNhat)

    const g2 = dungPrisma([
        { id: 'n1', taxType: '01_GTGT_Q', period: 'Q4/2026', dueDate: '2027-01-31', status: 'pending', reminderSent: false, description: 'Tờ khai GTGT quý 4' },
    ])
    const so2 = await nhacChoStore(g2.prisma, 'Cửa hàng yên', HOM_NAY)
    ok('không có gì tới hạn thì KHÔNG gửi thông báo',
        so2 === 0 && g2.thongBao.length === 0, { so2, tb: g2.thongBao.length })
    ok('cũng không đánh dấu gì cả', g2.daCapNhat.length === 0)

    const g3 = dungPrisma([
        { id: 'p1', taxType: 'MON_BAI', period: 'MB-2026', dueDate: '2026-08-15', status: 'pending', reminderSent: false, description: 'Lệ phí môn bài 2026' },
    ])
    g3.prisma.notification = { create: async () => { throw new Error('The table `Notification` does not exist') } }
    let neLoi = true
    try { await nhacChoStore(g3.prisma, 'Store cũ', HOM_NAY) } catch { neLoi = false }
    ok('thiếu bảng Notification thì bỏ qua, không kéo sập vòng chạy', neLoi)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
