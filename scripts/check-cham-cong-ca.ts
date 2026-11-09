/**
 * Bộ soát GIỜ VÀO / RA của chấm công — POST/PUT/DELETE /api/attendance (10/11/2026).
 *   npx tsx scripts/check-cham-cong-ca.ts
 *
 * Sự cố: POST chỉ đọc { userId, userName, role, date, note }, đặt checkIn = LÚC GỬI, không có checkOut. "Chốt ca" của
 * POS web gửi checkIn = đầu ca + checkOut = lúc chốt ⇒ mọi bản ghi ca mang giờ vào = giờ chốt, không giờ ra (ca 0 phút).
 * Thêm: PUT/DELETE không xoá cache danh sách (300 giây) ⇒ trang Chấm công hiện bản cũ tới 5 phút sau khi check-out;
 * PUT checkOut hỏng (new Date('rác')) lọt xuống Prisma ⇒ 500.
 *
 * Không DB: chạy handler THẬT (bỏ authMiddleware, gắn sẵn req.user) với storePrisma giả; cache bộ nhớ (không REDIS_URL).
 */
import attendanceRouter from '../src/routes/attendance'
import { docGioCa, docGioRa, laLoiGio, LECH_DONG_HO_MS } from '../src/lib/chamCong'

let loi = 0, tong = 0
const dung = (ten: string, ok: boolean, chiTiet?: unknown) => {
    tong++
    if (!ok) loi++
    console.log(`${ok ? '✓' : '✗'} ${ten}${!ok && chiTiet !== undefined ? ' — ' + JSON.stringify(chiTiet) : ''}`)
}

const cacBuoc = (router: any, method: string, duong: string): Function[] =>
    router.stack.find((l: any) => l.route?.path === duong && l.route.methods[method])?.route.stack.map((l: any) => l.handle) || []

type BanGhi = Record<string, any>

function taoPrismaGia(ban: BanGhi[]) {
    const goi: string[] = []
    const prisma: any = {
        attendance: {
            create: async (a: any) => {
                goi.push('create')
                const r = { id: `a${ban.length + 1}`, ...a.data }
                ban.push(r)
                return r
            },
            update: async (a: any) => {
                goi.push('update')
                const r = ban.find((x) => x.id === a.where.id)
                if (!r) throw new Error('Record to update not found')
                Object.assign(r, a.data)
                return r
            },
            delete: async (a: any) => {
                goi.push('delete')
                const i = ban.findIndex((x) => x.id === a.where.id)
                if (i < 0) throw new Error('Record to delete does not exist')
                return ban.splice(i, 1)[0]
            },
            findMany: async () => {
                goi.push('findMany')
                return ban.map((x) => ({ ...x }))
            },
        },
    }
    return { prisma, goi }
}

async function goiRoute(method: string, duong: string, prisma: any, opts: { body?: any; params?: any; query?: any } = {}) {
    const buoc = cacBuoc(attendanceRouter, method, duong)
    const req: any = {
        params: opts.params || {}, query: opts.query || {}, headers: {}, method: method.toUpperCase(), body: opts.body,
        storePrisma: prisma, user: { userId: 'u1', email: 'a@b.c', role: 'owner', storeSchema: 'store_thu_cham_cong', branchId: 'cn1' },
    }
    const res: any = { ma: 200, than: null as any, status(c: number) { this.ma = c; return this }, json(b: any) { this.than = b; return this } }
    for (const b of buoc.slice(1)) { let tiep = false; await b(req, res, () => { tiep = true }); if (!tiep) break }
    return { ma: res.ma as number, than: res.than }
}

const iso = (d: Date | null | undefined) => (d instanceof Date ? d.toISOString() : d)

async function main() {
    // ── hàm thuần ───────────────────────────────────────────────────────────────────────────────────────
    const now = new Date('2026-11-10T09:31:00.000Z')
    const dau = '2026-11-10T01:00:00.000Z', cuoi = '2026-11-10T09:30:00.000Z'

    const a = docGioCa({}, now)
    dung('không gửi giờ ⇒ như cũ: vào = bây giờ, chưa ra, ngày = bây giờ (nút Check-in không đổi)',
        !laLoiGio(a) && iso(a.checkIn) === iso(now) && a.checkOut === null && iso(a.date) === iso(now), a)

    const b = docGioCa({ checkIn: dau, checkOut: cuoi, status: 'present' }, now)
    dung('Chốt ca POS web (checkIn đầu ca, checkOut lúc chốt) ⇒ GIỮ đúng hai giờ, ngày công = giờ vào',
        !laLoiGio(b) && iso(b.checkIn) === dau && iso(b.checkOut) === cuoi && iso(b.date) === dau, b)

    const c = docGioCa({ checkin: dau, checkout: cuoi }, now)
    dung('nhận cả checkin/checkout chữ thường (đúng trang Tài liệu API)', !laLoiGio(c) && iso(c.checkIn) === dau && iso(c.checkOut) === cuoi, c)

    const d = docGioCa({ checkIn: cuoi, checkOut: dau }, now)
    dung('giờ ra TRƯỚC giờ vào ⇒ lỗi (không lặng lẽ lưu)', laLoiGio(d) && /trước/.test(d.loi), d)

    const e = docGioCa({ checkIn: new Date(now.getTime() + LECH_DONG_HO_MS + 60_000).toISOString() }, now)
    dung('giờ vào ở tương lai (quá 5 phút lệch đồng hồ) ⇒ lỗi', laLoiGio(e) && /tương lai/.test(e.loi), e)

    const f = docGioCa({ checkIn: new Date(now.getTime() + 4 * 60_000).toISOString() }, now)
    dung('lệch đồng hồ ≤ 5 phút ⇒ vẫn nhận', !laLoiGio(f), f)

    const g = docGioCa({ checkIn: 'rác' }, now)
    dung('giờ vào không đọc được ⇒ lỗi nêu nguyên giá trị (KHÔNG thay bằng bây giờ)', laLoiGio(g) && /checkIn/.test(g.loi) && /rác/.test(g.loi), g)

    const h = docGioCa({ checkOut: { a: 1 } }, now)
    dung('giờ ra sai kiểu (object) ⇒ lỗi', laLoiGio(h), h)

    const i = docGioCa({ checkIn: Date.parse(dau) }, now)
    dung('giờ vào dạng số mili-giây ⇒ nhận', !laLoiGio(i) && iso(i.checkIn) === dau, i)

    const j = docGioCa({ checkIn: dau, date: '2026-11-09' }, now)
    dung('có gửi date ⇒ dùng date đó làm ngày công', !laLoiGio(j) && iso(j.date) === new Date('2026-11-09').toISOString(), j)

    const k = docGioCa({ date: 'không phải ngày' }, now)
    dung('date hỏng ⇒ lỗi (trước đây Invalid Date lọt xuống Prisma ⇒ 500)', laLoiGio(k), k)

    const l = docGioCa({ checkOut: dau }, now)
    dung('chỉ gửi giờ ra (đã qua) mà không giờ vào ⇒ vào = bây giờ ⇒ ra trước vào ⇒ lỗi', laLoiGio(l), l)

    dung('docGioRa: không gửi ⇒ null', docGioRa({}, now) === null)
    dung('docGioRa: hỏng ⇒ lỗi', laLoiGio(docGioRa({ checkOut: 'rác' }, now)))
    const m = docGioRa({ checkout: cuoi }, now)
    dung('docGioRa: chữ thường ⇒ nhận', m instanceof Date && iso(m) === cuoi, m)
    dung('docGioRa: tương lai ⇒ lỗi', laLoiGio(docGioRa({ checkOut: '2099-01-01T00:00:00Z' }, now)))

    // ── handler THẬT ────────────────────────────────────────────────────────────────────────────────────
    const truoc = Date.now()
    {
        const ban: BanGhi[] = []
        const { prisma, goi } = taoPrismaGia(ban)
        const gioDau = new Date(Date.now() - 8 * 3600_000).toISOString()
        const gioCuoi = new Date(Date.now() - 60_000).toISOString()
        const r = await goiRoute('post', '/', prisma, {
            body: { userId: 'u1', userName: 'Thu Ngân', role: 'cashier', checkIn: gioDau, checkOut: gioCuoi, status: 'present', note: 'Ca POS: 12 đơn' },
        })
        dung('POST chốt ca POS ⇒ 201, lưu ĐÚNG giờ vào / ra gửi lên',
            r.ma === 201 && iso(ban[0]?.checkIn) === gioDau && iso(ban[0]?.checkOut) === gioCuoi && iso(ban[0]?.date) === gioDau,
            { ma: r.ma, than: r.than, ban })
        dung('POST: giữ branchId của phiên + ghi chú', ban[0]?.branchId === 'cn1' && ban[0]?.note === 'Ca POS: 12 đơn', ban[0])

        const r2 = await goiRoute('post', '/', prisma, { body: { userId: 'u2', userName: 'Bán Hàng', role: 'staff' } })
        const vao = ban[1]?.checkIn instanceof Date ? ban[1].checkIn.getTime() : 0
        dung('POST trang Chấm công (không gửi giờ) ⇒ 201, vào = lúc gửi, chưa ra — như cũ',
            r2.ma === 201 && vao >= truoc - 1000 && vao <= Date.now() + 1000 && ban[1]?.checkOut === null, { ma: r2.ma, ban: ban[1] })

        const r3 = await goiRoute('post', '/', prisma, { body: { userId: 'u3', userName: 'X', checkIn: 'rác' } })
        dung('POST giờ vào hỏng ⇒ 400 nêu lỗi, KHÔNG tạo bản ghi', r3.ma === 400 && /checkIn/.test(r3.than?.error || '') && goi.filter((x) => x === 'create').length === 2, { ma: r3.ma, than: r3.than, goi })

        const r4 = await goiRoute('post', '/', prisma, { body: { userId: 'u3', userName: 'X', checkIn: gioCuoi, checkOut: gioDau } })
        dung('POST giờ ra trước giờ vào ⇒ 400', r4.ma === 400, r4)

        const r5 = await goiRoute('post', '/', prisma, { body: { userId: 'u3' } })
        dung('POST thiếu userName ⇒ 400 như cũ', r5.ma === 400, r5)
    }
    {
        // cache: GET (đọc + cache) → PUT check-out → GET phải thấy giờ ra mới, không bản cache cũ
        const ban: BanGhi[] = [{ id: 'a1', userId: 'u1', userName: 'Thu Ngân', checkIn: new Date(Date.now() - 3600_000), checkOut: null, date: new Date(), status: 'present' }]
        const { prisma, goi } = taoPrismaGia(ban)
        const q = { date: new Date().toISOString().slice(0, 10), kiem: 'cham-cong-ca' }
        const g1 = await goiRoute('get', '/', prisma, { query: q })
        dung('GET danh sách ⇒ 200, 1 bản ghi chưa ra', g1.ma === 200 && g1.than?.data?.length === 1 && g1.than.data[0].checkOut === null, g1)

        const ra = new Date(Date.now() - 60_000).toISOString()
        const p1 = await goiRoute('put', '/:id', prisma, { params: { id: 'a1' }, body: { checkOut: ra } })
        dung('PUT check-out ⇒ 200, lưu giờ ra', p1.ma === 200 && iso(ban[0].checkOut) === ra, { p1, ban })

        const g2 = await goiRoute('get', '/', prisma, { query: q })
        dung('GET sau PUT ⇒ thấy giờ ra MỚI (PUT xoá cache — trước đây hiện bản cũ tới 5 phút)',
            iso(g2.than?.data?.[0]?.checkOut) === ra && goi.filter((x) => x === 'findMany').length === 2, { g2: g2.than, goi })

        const p2 = await goiRoute('put', '/:id', prisma, { params: { id: 'a1' }, body: { checkOut: 'rác' } })
        dung('PUT giờ ra hỏng ⇒ 400 (trước đây 500), KHÔNG ghi', p2.ma === 400 && goi.filter((x) => x === 'update').length === 1, { p2, goi })

        const d1 = await goiRoute('delete', '/:id', prisma, { params: { id: 'a1' } })
        const g3 = await goiRoute('get', '/', prisma, { query: q })
        dung('DELETE rồi GET ⇒ danh sách rỗng (DELETE xoá cache)', d1.ma === 200 && g3.than?.data?.length === 0, { d1, g3: g3.than })
    }

    console.log(`\n${tong - loi}/${tong} ca đạt`)
    process.exit(loi ? 1 : 0)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
