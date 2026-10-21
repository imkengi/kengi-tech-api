/**
 * Kiểm GIỮ PHÍ SÀN KHI DỌN ĐƠN + LẤY LẠI PHÍ ĐƠN ĐÃ XOÁ — npx tsx scripts/check-phi-san-giu-lai.ts
 *
 * Hai chiều sai, nặng nhẹ khác hẳn:
 *   - Chép hỏng mà VẪN xoá  → số phí của đơn đó mất vĩnh viễn (đúng cái lỗi file này vá).
 *   - Ghi nhầm số của đơn A cho đơn B, hoặc ghi "chưa có" thành số 0 → thẻ Lãi/Lỗ in một
 *     con số sai mà trông như thật. Chủ shop chốt: lấy được thì hiện, không thì để trống.
 * Nên bộ này canh: thứ tự chép → xoá, chạy thử KHÔNG ghi, lỗi mạng KHÔNG bị đánh dấu là
 * "sàn không có số", và câu SQL của thẻ khi chưa có bảng giữ y hệt câu cũ.
 */

import {
    daQuyetToanSql, sqlPhiSanKy, sqlDonMatGoc, soTuEscrow, soTuStatement, xepGianTheoSoDon,
    maBenSan, laLoiThieuBangGiu, giuPhiRoiXoa, LoiChepPhi, SQL_CHEP_TRUOC_XOA,
    SQL_GHI_LAY_DUOC, SQL_GHI_CHUA_CO, SO_LAN_HOI_TOI_DA,
} from '../src/lib/phiSanGiuLai'
import { layLaiPhiDonDaXoa, type Gian } from '../src/services/layLaiPhiSan'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}
const gon = (s: string) => s.replace(/\s+/g, ' ').trim()

/** prisma giả cho giuPhiRoiXoa — ghi lại THỨ TỰ mọi lời gọi. */
function dbXoaGia(chepHong = false) {
    const goi: string[] = []
    const thamSoChep: any[][] = []
    return {
        goi, thamSoChep,
        async $executeRawUnsafe(sql: string, ...p: any[]) {
            if (sql !== SQL_CHEP_TRUOC_XOA) throw new Error('câu lạ: ' + sql.slice(0, 40))
            goi.push('chep'); thamSoChep.push(p)
            if (chepHong) throw new Error('relation "PhiSanDon" does not exist')
            return (p[0] as string[]).length
        },
        async $queryRawUnsafe(): Promise<any> { throw new Error('không được đọc ở đây') },
        onlineOrderItem: { async deleteMany(a: any) { goi.push('xoa-dong-hang'); return { count: a.where.onlineOrderId.in.length } } },
        onlineOrder: { async deleteMany(a: any) { goi.push('xoa-don'); return { count: a.where.id.in.length } } },
    }
}

/** prisma giả cho layLaiPhiDonDaXoa — rẽ nhánh theo câu SQL (luật check:prismagia). */
function dbLayLaiGia(phieuTheoSan: Record<string, any[]>, gian: Gian[], dem: Record<string, number>) {
    const ghi: Array<{ sql: string; p: any[] }> = []
    const doc: Array<{ san: string; p: any[] }> = []
    return {
        ghi, doc,
        async $queryRawUnsafe(sql: string, ...p: any[]): Promise<any> {
            const san = sql.includes("'ONLINE-SPE-%'") ? 'shopee' : sql.includes("'ONLINE-TIK-%'") ? 'tiktok' : ''
            if (!san) throw new Error('câu đọc lạ: ' + gon(sql).slice(0, 60))
            doc.push({ san, p })
            const rows = phieuTheoSan[san] || []
            return rows.slice(0, p[0]).map(r => ({ ...r, tong: rows.length }))
        },
        async $executeRawUnsafe(sql: string, ...p: any[]) {
            if (sql !== SQL_GHI_LAY_DUOC && sql !== SQL_GHI_CHUA_CO) throw new Error('câu ghi lạ')
            ghi.push({ sql, p }); return (p[0] as any[]).length
        },
        onlineChannel: { async findMany() { return gian } },
        onlineOrder: { async groupBy() { return Object.entries(dem).map(([channelId, n]) => ({ channelId, _count: { _all: n } })) } },
    }
}

const gian = (id: string, platform: string): Gian => ({ id, name: id, platform, accessToken: 'x' })

async function main() {
    console.log('\n▶ Giữ phí sàn khi dọn đơn + lấy lại phí đơn đã xoá\n')

    /* 1 — câu thẻ Lãi/Lỗ khi CHƯA có bảng giữ phải đúng y câu cũ (trước 21/10/2026). */
    const DA_QUYET_TOAN_CU = `o.id IS NOT NULL AND o."netRevenue" <> 0
    AND NOT (o."platformFeeRate" > 0 AND ABS(o."platformFee" - ROUND(o.total * o."platformFeeRate" / 100)) <= 1)`
    ok('1a. luật "đã quyết toán" giữ nguyên chữ của bản cũ', gon(daQuyetToanSql('o')) === gon(DA_QUYET_TOAN_CU))
    const cu = sqlPhiSanKy(false), moi = sqlPhiSanKy(true)
    ok('1b. câu lùi (chưa có bảng) KHÔNG nhắc tới PhiSanDon', !cu.includes('PhiSanDon'))
    ok('1c. câu lùi trừ thẳng netRevenue của đơn gốc', cu.includes('SUM(t.total - o."netRevenue")'))
    ok('1d. câu mới JOIN bảng giữ theo orderNumber', moi.includes(`LEFT JOIN "PhiSanDon" f ON f."orderNumber" = substring(t."receiptNumber" from 8)`))
    ok('1e. câu mới: đơn gốc còn + đã quyết toán thì dùng số của ĐƠN, không thì số của bảng giữ',
        gon(moi).includes(gon(`CASE WHEN ${daQuyetToanSql('o')} THEN o."netRevenue" ELSE f."netRevenue" END`)))
    ok('1f. bảng giữ chỉ tính là "có số" khi netRevenue <> 0 (dòng "chưa lấy được" = 0 không phải phí 0)',
        moi.includes(`COALESCE(f."netRevenue", 0) <> 0`))

    /* 2 — nhận diện lỗi "chưa có bảng" để lùi về câu cũ, không nuốt lỗi khác. */
    ok('2a. relation "PhiSanDon" does not exist → lùi', laLoiThieuBangGiu(new Error('Raw query failed. Code: `42P01`. Message: `relation "PhiSanDon" does not exist`')))
    ok('2b. bảng KHÁC thiếu → KHÔNG lùi', !laLoiThieuBangGiu(new Error('relation "OnlineOrder" does not exist')))
    ok('2c. lỗi kết nối → KHÔNG lùi', !laLoiThieuBangGiu(new Error("Can't reach database server")))

    /* 3 — luật nhận số từ sàn: CÙNG luật với các đường đối soát đang chạy. */
    ok('3a. escrow rỗng → không có số', soTuEscrow(null) === null && soTuEscrow({ escrowAmount: 0, totalFees: 0 }) === null)
    const e = soTuEscrow({ escrowAmount: 63830, totalFees: 36170 })
    ok('3b. escrow thật → phí + thực nhận', e?.platformFee === 36170 && e?.netRevenue === 63830, e)
    const hoan = soTuStatement({ settlementAmount: -68589.4, feeAmount: 1200.6 })
    ok('3c. TikTok thực nhận ÂM có phí → GIỮ (đơn hoàn đã quyết toán — bỏ là giấu lỗ), làm tròn',
        hoan?.netRevenue === -68589 && hoan?.platformFee === 1201, hoan)
    ok('3d. TikTok chưa quyết toán → không có số', soTuStatement({ settlementAmount: 0, feeAmount: 0 }) === null && soTuStatement(null) === null)

    /* 4 — thứ tự dò gian + mã bên sàn. */
    const xep = xepGianTheoSoDon([gian('it', 'shopee'), gian('nhieu', 'shopee'), gian('khong-ro', 'shopee')], new Map([['it', 5], ['nhieu', 900]]))
    ok('4a. gian nhiều đơn hỏi trước, gian không rõ số đơn hỏi sau cùng', xep.map(g => g.id).join() === 'nhieu,it,khong-ro', xep.map(g => g.id))
    ok('4b. mã bên sàn bỏ tiền tố', maBenSan('SPE-2609250JWF234A') === '2609250JWF234A' && maBenSan('TIK-585506220583585279') === '585506220583585279')

    /* 5 — CHÉP RỒI MỚI XOÁ. Đây là ca quan trọng nhất của file. */
    {
        const db = dbXoaGia(true)
        let nem: any = null
        try { await giuPhiRoiXoa(db as any, ['a', 'b']) } catch (x) { nem = x }
        ok('5a. chép hỏng (chưa có bảng) → ném LoiChepPhi', nem instanceof LoiChepPhi, String(nem))
        ok('5b. chép hỏng → KHÔNG xoá dòng hàng, KHÔNG xoá đơn', !db.goi.includes('xoa-dong-hang') && !db.goi.includes('xoa-don'), db.goi)
    }
    {
        const db = dbXoaGia(false)
        const kq = await giuPhiRoiXoa(db as any, ['a', 'b', 'c'])
        ok('5c. chép trước, rồi xoá dòng hàng, rồi xoá đơn', db.goi.join() === 'chep,xoa-dong-hang,xoa-don', db.goi)
        ok('5d. chép đúng danh sách id sắp xoá', JSON.stringify(db.thamSoChep[0]) === JSON.stringify([['a', 'b', 'c']]), db.thamSoChep)
        ok('5e. trả số đã chép / đã xoá', kq.daChep === 3 && kq.daXoa === 3, kq)
    }
    {
        const db = dbXoaGia(false)
        const ids = Array.from({ length: 1234 }, (_, i) => `id${i}`)
        await giuPhiRoiXoa(db as any, ids)
        const chep = db.goi.filter(g => g === 'chep').length
        ok('5f. 1.234 đơn → chép 3 lô (500/500/234) và chép XONG hết rồi mới xoá',
            chep === 3 && db.goi.indexOf('xoa-dong-hang') === 3 && db.thamSoChep[2]![0].length === 234, db.goi)
    }
    ok('5g. câu chép chỉ lấy đơn có số phí THẬT (cùng luật đã quyết toán)', SQL_CHEP_TRUOC_XOA.includes(daQuyetToanSql('o')))

    /* 6 — LẤY LẠI: dò từng gian, chạy thử không ghi, lỗi mạng không bị đánh dấu. */
    const phieu = {
        shopee: [
            { orderNumber: 'SPE-A', total: 100000, ngay: new Date('2026-09-25T03:00:00Z') },   // của gian thứ hai
            { orderNumber: 'SPE-B', total: 50000, ngay: new Date('2026-09-20T03:00:00Z') },    // không gian nào có số
            { orderNumber: 'SPE-C', total: 70000, ngay: new Date('2026-08-31T20:00:00Z') },    // gian đầu lỗi mạng
        ],
        tiktok: [{ orderNumber: 'TIK-1', total: 97180, ngay: new Date('2026-08-12T04:09:00Z') }],
    }
    const dsGian = [gian('kengi-tools', 'shopee'), gian('kengi-store', 'shopee'), gian('tt', 'tiktok')]
    const dem = { 'kengi-store': 2468, 'kengi-tools': 248, tt: 1131 }
    const hoiDaGoi: string[] = []
    const taoHoi = (g: Gian) => async (ma: string) => {
        hoiDaGoi.push(`${g.id}:${ma}`)
        if (g.id === 'kengi-store' && ma === 'A') return { platformFee: 36170, netRevenue: 63830 }
        if (g.id === 'kengi-store' && ma === 'C') throw new Error('ECONNRESET')
        if (g.id === 'tt' && ma === '1') return { platformFee: 31663, netRevenue: 65517 }
        return null
    }

    {
        const db = dbLayLaiGia(phieu, dsGian, dem)
        hoiDaGoi.length = 0
        const kq = await layLaiPhiDonDaXoa(db as any, { apply: false, gioiHan: 50, hanMs: 60_000, nghiTikTokMs: 0 }, taoHoi)
        const s = kq.find(k => k.san === 'shopee')!, t = kq.find(k => k.san === 'tiktok')!
        ok('6a. chạy thử: KHÔNG ghi gì', db.ghi.length === 0 && !s.daGhi && !t.daGhi, db.ghi.length)
        ok('6b. gian nhiều đơn (kengi-store) được hỏi TRƯỚC', hoiDaGoi.indexOf('kengi-store:A') >= 0 && hoiDaGoi.indexOf('kengi-tools:A') < 0, hoiDaGoi)
        ok('6c. Shopee: 1 lấy được, 1 chưa có, 1 lỗi', s.layDuoc === 1 && s.chuaCo === 1 && s.loi === 1, { layDuoc: s.layDuoc, chuaCo: s.chuaCo, loi: s.loi })
        ok('6d. đơn không gian nào có số → đã hỏi ĐỦ mọi gian', hoiDaGoi.includes('kengi-store:B') && hoiDaGoi.includes('kengi-tools:B'), hoiDaGoi)
        ok('6e. mẫu ghi đúng gian trả số', s.mau[0]?.ma === 'SPE-A' && s.mau[0]?.kenhId === 'kengi-store' && s.mau[0]?.thucNhan === 63830, s.mau)
        ok('6f. tháng tính theo giờ VN (31/08 20:00 UTC = 01/09 VN)', s.theoThang['2026-09']?.chuaCo === 1 && !s.theoThang['2026-08'], s.theoThang)
        ok('6g. khớp điều kiện lấy từ cột tong (trước LIMIT)', s.khopDieuKien === 3 && t.khopDieuKien === 1, [s.khopDieuKien, t.khopDieuKien])
        ok('6h. câu đọc nhận đúng thứ tự tham số (giới hạn, từ, đến, số lần tối đa)',
            JSON.stringify(db.doc[0]!.p) === JSON.stringify([50, null, null, SO_LAN_HOI_TOI_DA]), db.doc[0]!.p)
        ok('6i. khấu trừ lấy được = tiền phiếu − thực nhận', s.tienPhieuLayDuoc === 100000 && s.khauTruLayDuoc === 36170, s)
    }
    {
        const db = dbLayLaiGia(phieu, dsGian, dem)
        await layLaiPhiDonDaXoa(db as any, { apply: true, gioiHan: 50, hanMs: 60_000, nghiTikTokMs: 0 }, taoHoi)
        const layDuoc = db.ghi.filter(g => g.sql === SQL_GHI_LAY_DUOC)
        const chuaCo = db.ghi.filter(g => g.sql === SQL_GHI_CHUA_CO)
        const spe = layDuoc.find(g => g.p[1][0] === 'shopee')
        ok('6j. ghi thật: mảng cột thẳng hàng (mã, sàn, phí, thực nhận, gian)',
            JSON.stringify(spe?.p) === JSON.stringify([['SPE-A'], ['shopee'], [36170], [63830], ['kengi-store']]), spe?.p)
        const speChua = chuaCo.find(g => g.p[1][0] === 'shopee')
        ok('6k. chỉ đơn sàn THẬT SỰ không có số mới bị đánh dấu — đơn lỗi mạng (SPE-C) KHÔNG',
            JSON.stringify(speChua?.p[0]) === JSON.stringify(['SPE-B']), speChua?.p)
        ok('6l. TikTok ghi riêng, số âm/dương giữ nguyên', layDuoc.some(g => g.p[0][0] === 'TIK-1' && g.p[3][0] === 65517))
    }
    {
        const db = dbLayLaiGia(phieu, dsGian, dem)
        hoiDaGoi.length = 0
        const kq = await layLaiPhiDonDaXoa(db as any, { apply: true, gioiHan: 50, hanMs: -1, nghiTikTokMs: 0 }, taoHoi)
        ok('6m. hết giờ → không hỏi sàn, không ghi, đếm vào hetGio', hoiDaGoi.length === 0 && db.ghi.length === 0
            && kq.find(k => k.san === 'shopee')!.hetGio === 3, { hoi: hoiDaGoi.length, ghi: db.ghi.length })
    }
    {
        const db = dbLayLaiGia(phieu, [gian('kengi-store', 'shopee')], dem)
        const kq = await layLaiPhiDonDaXoa(db as any, { apply: true, gioiHan: 50, san: 'tiktok', hanMs: 60_000, nghiTikTokMs: 0 }, taoHoi)
        ok('6n. sàn không có gian nào → bỏ qua, không đọc phiếu', kq.length === 1 && kq[0]!.gian.length === 0 && db.doc.length === 0, kq)
    }

    /* 7 — câu chọn đơn mất gốc: đúng tiền tố phiếu, không lấy phiếu huỷ/trả, giãn lần hỏi. */
    const q = gon(sqlDonMatGoc('shopee'))
    ok('7a. chỉ phiếu ONLINE-SPE-, bỏ phiếu voided/returned, chỉ đơn đã MẤT gốc',
        q.includes(`LIKE 'ONLINE-SPE-%'`) && q.includes(`t.status NOT IN ('voided', 'returned')`) && q.includes('o.id IS NULL'))
    ok('7b. dòng đã có số không bao giờ bị hỏi lại; dòng "chưa có" giãn 2 ngày, tối đa $4 lần',
        q.includes(`f."netRevenue" = 0 AND f."lanThu" < $4`) && q.includes(`interval '2 days'`))
    ok('7c. hai câu ghi không bao giờ đè dòng ĐÃ có số', SQL_GHI_LAY_DUOC.includes(`WHERE "PhiSanDon"."netRevenue" = 0`)
        && SQL_GHI_CHUA_CO.includes(`WHERE "PhiSanDon"."netRevenue" = 0`))

    console.log(`\n${hong === 0 ? '✅' : '❌'} ${dat} đạt, ${hong} hỏng\n`)
    if (hong > 0) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
