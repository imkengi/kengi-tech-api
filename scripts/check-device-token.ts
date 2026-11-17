/* Kiểm chứng VÒNG GỠ TOKEN FCM (17/11/2026) — npm run check:device-token
 *
 * Log prod 17/11/2026: "Raw query failed. Code: `42P01`. Message: `relation "DeviceToken" does not exist`" theo đợt — đúng 9 dòng
 * 15–100 ms sau MỖI lần POST /notifications/device-token thành công (33 lần / 14 giờ = 297 dòng, không đợt nào thiếu request).
 * Nguồn: vòng gỡ token khỏi cửa hàng khác chạy DELETE vào MỌI cửa hàng rồi nuốt lỗi — 9/12 cửa hàng chưa có bảng (bảng tạo lười),
 * mà client Prisma (log 'error') tự in mọi câu hỏng TRƯỚC khi ném. Push không hỏng: không có dòng mã nào khác (CREATE chưa từng lỗi).
 *
 * Prisma giả ghi lại mọi câu và in "dòng 42P01" y như prod khi câu đụng bảng thiếu. Không đụng CSDL, không gọi mạng. Canh:
 *  1. Hình prod (12 cửa hàng, 3 có bảng): chỉ DELETE ở 2 cửa hàng khác có bảng, KHÔNG câu / client nào ở 9 cửa hàng thiếu bảng,
 *     MỘT câu dò danh mục; token vẫn bị gỡ đúng chỗ, token máy khác và token ở cửa hàng hiện tại để yên.
 *  2. Có bảng ở mọi nơi ⇒ y như cũ (DELETE mọi cửa hàng khác).
 *  3. Dò hỏng / dòng lạ / danh mục không thấy cửa hàng hiện tại ⇒ quét như cũ (gỡ sót token tệ hơn vài dòng log).
 *  4. Không rõ cửa hàng hiện tại ⇒ không quét (không gỡ token vừa ghi); lỗi lẻ một cửa hàng không chặn cửa hàng khác.
 *  5. Câu dò to_regclass cho /admin/do-thiet-bi; nối dây route (soát mã nguồn).
 */
import * as fs from 'fs'
import * as path from 'path'
import { goTokenKhoiCuaHangKhac, schemaCoBangDeviceToken, coBangDeviceToken } from '../src/routes/notifications'

let loi = 0, dat = 0
const dung = (ten: string, ok: boolean, chiTiet = '') => { ok ? dat++ : loi++; console.log(`${ok ? '✓' : '✗'} ${ten}${chiTiet && !ok ? ' — ' + chiTiet : ''}`) }
const json = (x: any) => JSON.stringify(x, (_k, v) => (v instanceof Set ? [...v] : v))

const DONG_42P01 = 'Raw query failed. Code: `42P01`. Message: `relation "DeviceToken" does not exist`'
// 12 cửa hàng prod (đo SQL chỉ đọc 17/11/2026) — chỉ KENGIONLINE, KENGISTORE, HUTI có bảng
const CUA_HANG = ['kengi_hcm', 'kengi_hn', 'kengionline', 'thu_123', 'hungtest', 'hungtin', 'kengistore', 'huti', 'hutitax', 'gia_si_123', 'gia_si_bao_loc', 'nghung']
const CO_BANG_PROD = ['kengionline', 'kengistore', 'huti']
const TOK = 'fcm-token-may-a-0123456789abcdef'
const TOK_KHAC = 'fcm-token-may-b-fedcba9876543210'

type MoiTruong = {
    coBang: Set<string>; token: Map<string, Set<string>>
    dongLog: string[]; sqlRegistry: string[]; sqlCuaHang: { schema: string; sql: string }[]; taoClient: string[]
}

/** registry + client cửa hàng giả. Câu đụng "DeviceToken" ở schema chưa có bảng ⇒ ghi một "dòng log" (Prisma prod in y như vậy)
 *  rồi ném lỗi hình P2010/42P01. `danhMuc` thay câu trả lời của câu dò danh mục (ném / dòng lạ). */
function dung_moi_truong(o: { stores?: (string | null)[]; coBang?: string[]; token?: Record<string, string[]>; danhMuc?: () => any; loiKhac?: string[] } = {}) {
    const mt: MoiTruong = {
        coBang: new Set(o.coBang ?? CO_BANG_PROD),
        token: new Map(Object.entries(o.token ?? {}).map(([s, t]) => [s, new Set(t)])),
        dongLog: [], sqlRegistry: [], sqlCuaHang: [], taoClient: [],
    }
    const stores = o.stores ?? CUA_HANG
    const registry = {
        store: { findMany: async (_arg: any) => stores.map(schema => ({ schema })) },
        $queryRawUnsafe: async (sql: string) => {
            mt.sqlRegistry.push(sql)
            if (o.danhMuc) return o.danhMuc()
            if (/pg_catalog\.pg_class/.test(sql) && /relname = 'DeviceToken'/.test(sql)) return [...mt.coBang].map(schema => ({ schema }))
            throw new Error('câu lạ: ' + sql)
        },
    }
    const layClient = (schema: string) => {
        mt.taoClient.push(schema)
        const chay = async (sql: string, args: any[]) => {
            mt.sqlCuaHang.push({ schema, sql })
            if ((o.loiKhac ?? []).includes(schema)) throw Object.assign(new Error("Can't reach database server"), { code: 'P1001' })
            if (/"DeviceToken"/.test(sql) && !/to_regclass/.test(sql) && !mt.coBang.has(schema)) {
                mt.dongLog.push(DONG_42P01)
                throw Object.assign(new Error('Invalid `prisma.$executeRawUnsafe()` invocation:\n\n' + DONG_42P01), { code: 'P2010', meta: { code: '42P01' } })
            }
            if (/DELETE FROM "DeviceToken" WHERE token = \$1/.test(sql)) return mt.token.get(schema)?.delete(args[0]) ? 1 : 0
            return 0
        }
        return {
            __schema: schema,
            $executeRawUnsafe: (sql: string, ...args: any[]) => chay(sql, args),
            $queryRawUnsafe: (sql: string, ...args: any[]) => chay(sql, args),
        }
    }
    return { mt, dep: { registry, layClient } }
}

const sapXep = (a: string[]) => [...a].sort()
const cungTap = (a: string[], b: string[]) => json(sapXep(a)) === json(sapXep(b))
/** câu nào ở cửa hàng chưa có bảng mà đụng "DeviceToken" */
const dungBangThieu = (mt: MoiTruong) => mt.sqlCuaHang.filter(x => !mt.coBang.has(x.schema) && /"DeviceToken"/.test(x.sql))
const ngoaiHienTai = (hienTai: string) => CUA_HANG.filter(s => s !== hienTai)
// trạng thái token TRƯỚC vòng quét: máy A vừa đăng ký ở KENGISTORE, còn rơi rớt ở KENGIONLINE + HUTI; máy B ở HUTI
const TOKEN_PROD = { kengistore: [TOK], kengionline: [TOK], huti: [TOK, TOK_KHAC] }

async function main() {
    // ─── 1. Hình prod ────────────────────────────────────────────────────────────
    {
        const { mt, dep } = dung_moi_truong({ token: TOKEN_PROD })
        const daCham = await goTokenKhoiCuaHangKhac(TOK, 'kengistore', dep)
        dung('1a. hình prod (12 cửa hàng, 3 có bảng), máy đăng ký ở KENGISTORE ⇒ chỉ DELETE ở 2 cửa hàng khác CÓ bảng (KENGIONLINE, HUTI)',
            cungTap(daCham, ['kengionline', 'huti']) && mt.sqlCuaHang.length === 2 && mt.sqlCuaHang.every(x => /^DELETE FROM "DeviceToken" WHERE token = \$1$/.test(x.sql)),
            json({ daCham, sql: mt.sqlCuaHang }))
        dung('1b. KHÔNG câu nào đụng bảng thiếu ⇒ Prisma không có gì để in 42P01 (mã cũ: đúng 9 dòng mỗi lần đăng ký)',
            mt.dongLog.length === 0 && dungBangThieu(mt).length === 0, json({ dong: mt.dongLog.length, cau: dungBangThieu(mt) }))
        dung('1c. không dựng client / mở kết nối cho 9 cửa hàng chưa có bảng (mã cũ dựng client cho cả 11 cửa hàng khác)',
            cungTap(mt.taoClient, ['kengionline', 'huti']), json(mt.taoClient))
        dung('1d. đúng MỘT câu dò danh mục qua registry, đọc pg_catalog đúng tên chữ hoa, không câu nào đụng "DeviceToken" trên registry',
            mt.sqlRegistry.length === 1 && /pg_catalog\.pg_class/.test(mt.sqlRegistry[0]) && /c\.relname = 'DeviceToken'/.test(mt.sqlRegistry[0])
            && !/FROM "DeviceToken"/.test(mt.sqlRegistry[0]), json(mt.sqlRegistry))
        dung('1e. token máy A bị gỡ khỏi KENGIONLINE + HUTI, VẪN ở KENGISTORE; token máy B ở HUTI để yên',
            !mt.token.get('kengionline')!.has(TOK) && !mt.token.get('huti')!.has(TOK) && mt.token.get('huti')!.has(TOK_KHAC) && mt.token.get('kengistore')!.has(TOK),
            json([...mt.token.entries()]))
    }

    // ─── 2. Bảng có ở mọi nơi ⇒ như cũ ───────────────────────────────────────────
    {
        const { mt, dep } = dung_moi_truong({ coBang: CUA_HANG, token: { kengistore: [TOK], hutitax: [TOK], kengi_hn: [TOK] } })
        const daCham = await goTokenKhoiCuaHangKhac(TOK, 'kengistore', dep)
        dung('2a. mọi cửa hàng đều có bảng ⇒ DELETE ở cả 11 cửa hàng khác như mã cũ, cửa hàng hiện tại không bị chạm, không dòng log',
            cungTap(daCham, ngoaiHienTai('kengistore')) && !mt.taoClient.includes('kengistore') && mt.dongLog.length === 0
            && !mt.token.get('hutitax')!.has(TOK) && !mt.token.get('kengi_hn')!.has(TOK) && mt.token.get('kengistore')!.has(TOK),
            json({ daCham, tao: mt.taoClient }))
        const { mt: mt2, dep: dep2 } = dung_moi_truong({ coBang: ['huti', 'nghung'], token: { huti: [TOK], nghung: [TOK] } })
        const daCham2 = await goTokenKhoiCuaHangKhac(TOK, 'huti', dep2)
        dung('2b. cửa hàng vừa tạo bảng (NGHUNG đăng ký máy lần đầu) ⇒ lượt quét kế tiếp gỡ được token ở đó — "có bảng" đọc mới mỗi lượt',
            cungTap(daCham2, ['nghung']) && !mt2.token.get('nghung')!.has(TOK) && mt2.token.get('huti')!.has(TOK) && mt2.dongLog.length === 0, json(daCham2))
    }

    // ─── 3. Dò danh mục không tin được ⇒ quét như cũ ─────────────────────────────
    {
        const caLa: [string, () => any][] = [
            ['câu dò ném (mất kết nối)', () => { throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'P1017' }) }],
            ['trả đối tượng thay vì mảng', () => ({})],
            ['dòng thiếu cột schema', () => [{ nspname: 'kengistore' }, { nspname: 'huti' }]],
            ['có dòng schema rỗng', () => [{ schema: 'kengistore' }, { schema: '' }]],
            ['danh mục KHÔNG thấy cửa hàng vừa ghi token (khác CSDL?)', () => [{ schema: 'kengionline' }, { schema: 'huti' }]],
        ]
        for (const [i, [ten, danhMuc]] of caLa.entries()) {
            const { mt, dep } = dung_moi_truong({ token: TOKEN_PROD, danhMuc })
            let nem: any = null
            const daCham = await goTokenKhoiCuaHangKhac(TOK, 'kengistore', dep).catch(e => { nem = e; return [] as string[] })
            dung(`3${'abcde'[i]}. ${ten} ⇒ quét như cũ: DELETE ở cả 11 cửa hàng khác, token vẫn bị gỡ khỏi KENGIONLINE + HUTI, không ném`,
                !nem && cungTap(daCham, ngoaiHienTai('kengistore')) && !mt.token.get('kengionline')!.has(TOK) && !mt.token.get('huti')!.has(TOK)
                && mt.token.get('kengistore')!.has(TOK), json({ nem: nem?.message, daCham }))
        }
    }

    // ─── 4. Biên ─────────────────────────────────────────────────────────────────
    {
        for (const [i, hienTai] of ([undefined, ''] as (string | undefined)[]).entries()) {
            const { mt, dep } = dung_moi_truong({ coBang: CUA_HANG, token: { kengistore: [TOK], huti: [TOK] } })
            const daCham = await goTokenKhoiCuaHangKhac(TOK, hienTai, dep)
            dung(`4${'ab'[i]}. không rõ cửa hàng hiện tại (${JSON.stringify(hienTai)}) ⇒ KHÔNG quét — không gỡ nhầm token vừa ghi; không câu nào chạy`,
                daCham.length === 0 && mt.sqlCuaHang.length === 0 && mt.sqlRegistry.length === 0 && mt.token.get('kengistore')!.has(TOK), json(daCham))
        }
        const { mt, dep } = dung_moi_truong({ token: { huti: [TOK] } })
        dung('4c. token rỗng ⇒ không quét', (await goTokenKhoiCuaHangKhac('', 'kengistore', dep)).length === 0 && mt.sqlCuaHang.length === 0 && mt.sqlRegistry.length === 0)

        const { mt: mt2, dep: dep2 } = dung_moi_truong({ coBang: CUA_HANG, loiKhac: ['kengi_hcm', 'kengionline'], token: { huti: [TOK], nghung: [TOK] } })
        let nem: any = null
        const daCham2 = await goTokenKhoiCuaHangKhac(TOK, 'kengistore', dep2).catch(e => { nem = e; return [] as string[] })
        dung('4d. DELETE hỏng ở một cửa hàng (mất kết nối) không chặn cửa hàng sau; vòng quét không ném',
            !nem && daCham2.length === 11 && !mt2.token.get('huti')!.has(TOK) && !mt2.token.get('nghung')!.has(TOK), json({ nem: nem?.message, daCham2 }))

        const { mt: mt3, dep: dep3 } = dung_moi_truong({ stores: [null, '', 'kengistore', 'huti'], token: { huti: [TOK] } })
        const daCham3 = await goTokenKhoiCuaHangKhac(TOK, 'kengistore', dep3)
        dung('4e. cửa hàng chưa có schema (null / rỗng) bị bỏ qua — không dựng client rỗng', cungTap(daCham3, ['huti']) && cungTap(mt3.taoClient, ['huti']), json(mt3.taoClient))
    }

    // ─── 5. Câu dò cho một cửa hàng + danh mục; nối dây ──────────────────────────
    {
        const pz = (traLoi: () => any) => { const sql: string[] = []; return { sql, $queryRawUnsafe: async (s: string) => { sql.push(s); return traLoi() } } }
        const p1 = pz(() => [{ co: false }]), p2 = pz(() => [{ co: true }]), p3 = pz(() => []), p4 = pz(() => [{ co: 't' }])
        const kq = [await coBangDeviceToken(p1), await coBangDeviceToken(p2), await coBangDeviceToken(p3), await coBangDeviceToken(p4)]
        dung("5a. coBangDeviceToken: false / true đúng nghĩa; kết quả lạ ⇒ null (người gọi cứ đọc như cũ); chỉ MỘT câu to_regclass, không đụng bảng",
            json(kq) === '[false,true,null,null]' && p1.sql.length === 1 && p1.sql[0] === `SELECT to_regclass('"DeviceToken"') IS NOT NULL AS co`, json({ kq, sql: p1.sql }))

        const rg = (traLoi: () => any) => ({ $queryRawUnsafe: async () => traLoi() })
        const s1 = await schemaCoBangDeviceToken(rg(() => [{ schema: 'a' }, { schema: 'b' }]))
        const s2 = await schemaCoBangDeviceToken(rg(() => []))
        const s3 = await schemaCoBangDeviceToken(rg(() => { throw new Error('x') }))
        const s4 = await schemaCoBangDeviceToken(rg(() => [{ schema: 'a' }, { nspname: 'b' }]))
        dung('5b. schemaCoBangDeviceToken: tập schema có bảng; mảng rỗng là "không cửa hàng nào"; ném / dòng lạ ⇒ null (không giả làm "không có")',
            json(s1) === '["a","b"]' && s2 instanceof Set && s2.size === 0 && s3 === null && s4 === null, json({ s1, s2, s3, s4 }))

        const goc = path.join(__dirname, '..', 'src', 'routes')
        // cây làm việc Windows (autocrlf) là CRLF, CI là LF — chuẩn hoá kẻo so '\n' đạt rỗng
        const doc = (f: string) => fs.readFileSync(path.join(goc, f), 'utf8').replace(/\r\n/g, '\n')
        const tb = doc('notifications.ts')
        const route = tb.slice(tb.indexOf("router.post('/device-token'"), tb.indexOf("router.put('/read-all'"))
        const iTra = route.indexOf('res.json({ success: true })\n'), iQuet = route.indexOf('goTokenKhoiCuaHangKhac(token, currentSchema)')
        dung('5c. route POST /device-token: trả 200 TRƯỚC, rồi gọi goTokenKhoiCuaHangKhac trong setImmediate (nuốt lỗi); vòng DELETE mọi cửa hàng cũ đã gỡ',
            route.length > 200 && iTra > 0 && iQuet > iTra
            && /setImmediate\(\(\) => \{\s*goTokenKhoiCuaHangKhac\(token, currentSchema\)\.catch\(/.test(route)
            && !/registryPrisma\.store\.findMany/.test(route) && !/getStorePrisma\(/.test(route), route.slice(0, 120))
        dung('5d. cửa hàng hiện tại = schema của CHÍNH client vừa ghi token (__schema), rồi mới tới branchSchema / storeSchema của JWT',
            /const currentSchema = String\(prisma\.__schema \|\| req\.user\?\.branchSchema \|\| req\.user\?\.storeSchema \|\| ''\) \|\| undefined/.test(route))

        const ad = doc('admin.ts')
        const doTb = ad.slice(ad.indexOf("router.get('/do-thiet-bi'"), ad.indexOf("router.post('/lay-phi-tiktok'"))
        const iDo = doTb.indexOf('await coBangDeviceToken(sp)'), iDoc = doTb.indexOf('FROM "DeviceToken"')
        dung('5e. /admin/do-thiet-bi dò to_regclass TRƯỚC, chỉ đọc bảng khi không chắc là thiếu (cửa hàng chưa có bảng ⇒ không dòng 42P01)',
            doTb.length > 200 && iDo > 0 && iDoc > iDo && /=== false\) loiThietBi = /.test(doTb) && /else rows = await sp\.\$queryRawUnsafe\(`SELECT "updatedAt" FROM "DeviceToken"/.test(doTb))
    }

    console.log(`\n${dat}/${dat + loi} ca đạt`)
    if (loi) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
