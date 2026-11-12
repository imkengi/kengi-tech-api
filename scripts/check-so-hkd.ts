/**
 * check-so-hkd — sổ kế toán hộ kinh doanh S2c / S2d đọc phiếu bán THEO LÔ với cột HẸP (lib/soHoKinhDoanh.ts).
 *
 * 12/11/2026: chọn "Cả năm" ở sổ S2c ⇒ máy chủ sập vì tràn heap ("JavaScript heap out of memory"),
 * do `include: { items: { include: { product: true } } }` kéo nguyên hàng Product cho ~25 nghìn phiếu.
 * Bộ soát này canh:
 *   1. docTheoLo đọc ĐỦ và ĐÚNG MỘT LẦN mọi bản ghi, giữ nguyên `where`, chỉ xin cột hẹp + id, không lặp vô tận.
 *   2. xepTheoNgayChungTu xếp y như ORDER BY transactionDate ASC (NULL cuối), createdAt ASC của Postgres.
 *   3. tinhSoS2c cho ra ĐÚNG TỪNG BYTE như thuật toán cũ trong route (bản vá chỉ đổi cách ĐỌC, không đổi con số).
 *   4. Mọi cột trong CHON_* có thật trong prisma/schema-store.prisma (sai một tên là Prisma ném lỗi ⇒ sổ 500),
 *      và không quan hệ nào bị xin nguyên hàng (`product: true`).
 *   5. Ba route /hkd/s2, /hkd/s2-summary, /hkd/s3 không còn `product: true` hay `p.transaction.findMany(`.
 *
 * Chạy: npm run check:so-hkd
 */
import fs from 'fs'
import path from 'path'
import {
    docTheoLo, xepTheoNgayChungTu, tinhSoS2c, nhomChiPhiS2c,
    CHON_PHIEU_S2C, CHON_PHIEU_S2D, CHON_PHIEU_TON, CHON_HANG_DONG_NHAP, LO_PHIEU_SO,
} from '../src/lib/soHoKinhDoanh'

const GOC = path.resolve(__dirname, '..')
let dat = 0, hong = 0
function ca(ten: string, dung: boolean, them = '') { if (dung) dat++; else { hong++; console.log(`  ✗ ${ten}${them ? ` — ${them}` : ''}`) } }

/* ── PRNG có hạt giống để lần nào chạy cũng y hệt ── */
function taoNgauNhien(hat: number) {
    let s = hat >>> 0
    const so = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
    return { so, nguyen: (a: number, b: number) => a + Math.floor(so() * (b - a + 1)), chon: <T>(ds: T[]): T => ds[Math.floor(so() * ds.length)] }
}

/* ── 1. docTheoLo ─────────────────────────────────────────────────────────────────────── */
type Ban = { id: string; nhom?: string; [k: string]: any }
function moHinhGia(ds: Ban[], loiGia?: 'bo-qua-khoa') {
    const goi: any[] = []
    return {
        goi,
        findMany: async (a: any) => {
            goi.push(a)
            let w = a.where, gt: string | null = null
            if (w && Array.isArray(w.AND)) { gt = w.AND[1]?.id?.gt ?? null; w = w.AND[0] }
            if (loiGia === 'bo-qua-khoa') gt = null
            const loc = ds.filter(x => (w?.nhom === undefined || x.nhom === w.nhom) && (gt === null || x.id > gt))
                .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
            return loc.slice(0, a.take).map(x => {
                const r: any = {}
                for (const k of Object.keys(a.select || {})) if (a.select[k]) r[k] = x[k]
                return r
            })
        },
    }
}

async function soatDocTheoLo() {
    const ds = (n: number, nhom = 'A'): Ban[] => Array.from({ length: n }, (_, i) => ({ id: `c${String(1000 + i * 7).padStart(6, '0')}`, nhom, tien: i * 10, rac: 'x'.repeat(50) }))

    // Rỗng
    {
        const m = moHinhGia([])
        const ra = await docTheoLo(m as any, { nhom: 'A' }, { tien: true }, 3)
        ca('rỗng: trả mảng rỗng', ra.length === 0)
        ca('rỗng: chỉ một câu', m.goi.length === 1)
    }
    // Chia lô lệch, chia lô tròn, lô 1, lô lớn hơn cả tập
    for (const [n, lo, soCau] of [[5, 2, 3], [4, 2, 3], [3, 1, 4], [7, 50, 1], [6, 3, 3]] as const) {
        const nguon = [...ds(n), ...ds(4, 'B').map(x => ({ ...x, id: 'z' + x.id }))]
        const m = moHinhGia(nguon)
        const where = { nhom: 'A' }
        const ra = await docTheoLo(m as any, where, { tien: true }, lo)
        const ids = ra.map(r => r.id)
        ca(`n=${n} lô=${lo}: đọc đủ ${n}`, ra.length === n, `được ${ra.length}`)
        ca(`n=${n} lô=${lo}: không trùng`, new Set(ids).size === ids.length)
        ca(`n=${n} lô=${lo}: không lẫn nhóm khác`, ra.every(r => !String(r.id).startsWith('z')))
        ca(`n=${n} lô=${lo}: theo id tăng dần`, ids.every((x, i) => i === 0 || ids[i - 1] < x))
        ca(`n=${n} lô=${lo}: ${soCau} câu`, m.goi.length === soCau, `được ${m.goi.length}`)
        ca(`n=${n} lô=${lo}: câu đầu giữ nguyên where`, m.goi[0].where === where)
        ca(`n=${n} lô=${lo}: câu sau AND [where, id > khoá cuối]`, m.goi.slice(1).every((g: any, i: number) => g.where?.AND?.[0] === where && g.where.AND[1]?.id?.gt === (m.goi[i] && ra[Math.min((i + 1) * lo, ra.length) - 1]?.id)))
        ca(`n=${n} lô=${lo}: xin id + cột hẹp, KHÔNG include`, m.goi.every((g: any) => g.select?.id === true && g.select?.tien === true && g.select?.rac === undefined && g.include === undefined))
        ca(`n=${n} lô=${lo}: orderBy id asc + take = lô`, m.goi.every((g: any) => g.orderBy?.id === 'asc' && g.take === lo))
        ca(`n=${n} lô=${lo}: không kéo cột ngoài select`, ra.every(r => (r as any).rac === undefined))
    }
    // Bên kia bỏ qua khoá (trả lại trang cũ mãi) ⇒ phải DỪNG bằng lỗi, không lặp vô tận
    {
        const m = moHinhGia(ds(5), 'bo-qua-khoa')
        let loi = ''
        try { await docTheoLo(m as any, { nhom: 'A' }, { tien: true }, 2) } catch (e: any) { loi = e.message }
        ca('khoá không tiến ⇒ ném lỗi', /lặp vô tận/.test(loi), loi || 'không ném')
        ca('khoá không tiến ⇒ dừng sau 2 câu', m.goi.length === 2, `được ${m.goi.length}`)
    }
    // Lô không hợp lệ
    for (const lo of [0, -1, 1.5, NaN]) {
        let loi = ''
        try { await docTheoLo(moHinhGia(ds(2)) as any, {}, {}, lo) } catch (e: any) { loi = e.message }
        ca(`lô=${lo} ⇒ ném lỗi`, /lô phải là số nguyên/.test(loi))
    }
    ca('lô mặc định hợp lý (500–5000)', LO_PHIEU_SO >= 500 && LO_PHIEU_SO <= 5000)
}

/* ── 2. xepTheoNgayChungTu ─────────────────────────────────────────────────────────────── */
function soatXep() {
    const d = (s: string) => new Date(s)
    const ds = [
        { id: 'g', transactionDate: null, createdAt: d('2026-03-01T01:00:00Z') },
        { id: 'f', transactionDate: d('2026-02-01T00:00:00Z'), createdAt: d('2026-05-01T00:00:00Z') },
        { id: 'e', transactionDate: d('2026-01-15T00:00:00Z'), createdAt: d('2026-02-01T00:00:00Z') },
        { id: 'd', transactionDate: d('2026-01-15T00:00:00Z'), createdAt: d('2026-01-20T00:00:00Z') },
        { id: 'c', transactionDate: null, createdAt: d('2026-01-01T00:00:00Z') },
        { id: 'b', transactionDate: d('2026-01-15T00:00:00Z'), createdAt: d('2026-01-20T00:00:00Z') },
        { id: 'a', transactionDate: d('2026-01-01T00:00:00Z'), createdAt: d('2026-12-01T00:00:00Z') },
    ]
    const ra = xepTheoNgayChungTu([...ds]).map(x => x.id).join('')
    // a(01/01) · b,d (15/01, cùng createdAt ⇒ theo id) · e (15/01, tạo sau) · f · rồi NULL cuối: c (tạo 01/01), g
    ca('xếp: NULL cuối, hoà theo createdAt rồi id', ra === 'abdefcg', ra)

    // Ngẫu nhiên: so với khoá bộ (cờ null, ngày, cờ null, tạo, id)
    const R = taoNgauNhien(7)
    for (let lan = 0; lan < 200; lan++) {
        const n = R.nguyen(0, 30)
        const mau = Array.from({ length: n }, (_, i) => ({
            id: 'x' + R.nguyen(0, 9999).toString().padStart(4, '0') + '_' + i,
            transactionDate: R.so() < 0.3 ? null : new Date(Date.UTC(2026, R.nguyen(0, 2), R.nguyen(1, 3))),
            createdAt: new Date(Date.UTC(2026, R.nguyen(0, 2), R.nguyen(1, 3))),
        }))
        const so = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0)
        const mong = [...mau].sort((a, b) =>
            so(a.transactionDate ? 0 : 1, b.transactionDate ? 0 : 1)
            || so(a.transactionDate ? a.transactionDate.getTime() : 0, b.transactionDate ? b.transactionDate.getTime() : 0)
            || so(a.createdAt.getTime(), b.createdAt.getTime())
            || so(a.id, b.id)).map(x => x.id).join(',')
        const that = xepTheoNgayChungTu([...mau]).map(x => x.id).join(',')
        if (mong !== that) { ca(`xếp ngẫu nhiên lần ${lan}`, false, `${that} ≠ ${mong}`); break }
        if (lan === 199) ca('xếp ngẫu nhiên 200 lần khớp khoá Postgres', true)
    }
    // Ngày dạng chuỗi (raw query) cũng xếp được
    const chuoi = xepTheoNgayChungTu([
        { id: 'b', transactionDate: '2026-01-02T00:00:00Z', createdAt: '2026-01-02T00:00:00Z' },
        { id: 'a', transactionDate: '2026-01-01T00:00:00Z', createdAt: '2026-01-05T00:00:00Z' },
    ]).map(x => x.id).join('')
    ca('xếp: ngày dạng chuỗi', chuoi === 'ab', chuoi)
}

/* ── 3. tinhSoS2c ≡ thuật toán CŨ (chép nguyên văn từ route trước 12/11/2026) ───────────── */
const fmtDate = (d: any) => { try { return new Date(d).toLocaleDateString('en-CA') } catch { return '' } }

function s2cBanCu(txs: any[], expenses: any[]) {
    const catToNhom = (cat: string): { nhom: string; label: string } => {
        const c = (cat || '').toLowerCase()
        if (c === 'a' || c.includes('purchase') || c.includes('hang') || c.includes('nvl') || c.includes('material') || c.includes('hàng hóa') || c.includes('nguyên liệu')) return { nhom: 'a', label: '(a) Nguyên liệu, vật liệu, hàng hóa' }
        if (c === 'b' || c.includes('salary') || c.includes('luong') || c.includes('lương') || c.includes('bh') || c.includes('payroll') || c.includes('labor') || c.includes('nhân công')) return { nhom: 'b', label: '(b) Tiền lương, BHXH, phụ cấp' }
        if (c === 'c' || c.includes('depreciation') || c.includes('khau_hao') || c.includes('khấu hao') || c.includes('tsđ') || c.includes('asset')) return { nhom: 'c', label: '(c) Khấu hao tài sản cố định' }
        if (c === 'd' || c.includes('util') || c.includes('electric') || c.includes('dien') || c.includes('điện') || c.includes('nước') || c.includes('phone') || c.includes('internet') || c.includes('rent') || c.includes('thuê') || c.includes('ship') || c.includes('transport') || c.includes('vận chuyển') || c.includes('service') || c.includes('dịch vụ')) return { nhom: 'd', label: '(d) Dịch vụ mua ngoài' }
        if (c === 'đ' || c.includes('interest') || c.includes('loan') || c.includes('lai') || c.includes('lãi') || c.includes('vay')) return { nhom: 'đ', label: '(đ) Lãi tiền vay' }
        return { nhom: 'e', label: '(e) Chi phí khác' }
    }
    const rows: any[] = []
    for (const t of txs) {
        const ngay = fmtDate(t.transactionDate || t.createdAt)
        const soChungTu = t.receiptNumber || ''
        const tenKH = t.customerName ? ' - ' + t.customerName : ''
        const dtBan = (t.subtotal || 0) - (t.discount || 0)
        rows.push({ ngay, soChungTu, dienGiai: `Bán hàng${tenKH}`, doanhThu: dtBan, chiPhi: 0, loiNhuan: dtBan, nhom: '', loaiChiPhi: 'Doanh thu' })
        const cogs = (t.items || []).reduce((sum: number, item: any) => {
            const gv = item.costPrice || item.product?.costPrice || 0
            return sum + (item.quantity || 0) * gv
        }, 0)
        if (cogs > 0) {
            rows.push({ ngay, soChungTu, dienGiai: `Giá vốn hàng bán${tenKH}`, doanhThu: 0, chiPhi: cogs, loiNhuan: -cogs, nhom: 'a', loaiChiPhi: '(a) Nguyên liệu, vật liệu, hàng hóa (COGS)' })
        }
    }
    for (const e of expenses) {
        const { nhom, label } = catToNhom(e.category || '')
        const hdMatch = (e.description || '').match(/^\[([^\]]+)\]\s*(.+)$/)
        const soChungTu = hdMatch ? hdMatch[1] : `CP-${e.id.slice(-6)}`
        const dienGiai = hdMatch ? hdMatch[2] : (e.description || e.category || 'Chi phí')
        rows.push({ ngay: fmtDate(e.date), soChungTu, dienGiai, doanhThu: 0, chiPhi: e.amount || 0, loiNhuan: -(e.amount || 0), nhom, loaiChiPhi: label, expenseId: e.id })
    }
    rows.sort((a, b) => a.ngay.localeCompare(b.ngay))
    rows.forEach((r, i) => r.stt = i + 1)
    const tongDoanhThu = rows.reduce((s, r) => s + r.doanhThu, 0)
    const tongChiPhi = rows.reduce((s, r) => s + r.chiPhi, 0)
    const nhomLabels: Record<string, string> = { a: '(a) Nguyên liệu, vật liệu, hàng hóa', b: '(b) Tiền lương, BHXH, phụ cấp', c: '(c) Khấu hao tài sản cố định', d: '(d) Dịch vụ mua ngoài', 'đ': '(đ) Lãi tiền vay', e: '(e) Chi phí khác' }
    const chiPhiTheoNhom: Record<string, { label: string; soTien: number }> = {}
    for (const [k, v] of Object.entries(nhomLabels)) chiPhiTheoNhom[k] = { label: v, soTien: 0 }
    for (const r of rows) { if (r.nhom && chiPhiTheoNhom[r.nhom]) chiPhiTheoNhom[r.nhom].soTien += r.chiPhi }
    const chenhLech = tongDoanhThu - tongChiPhi
    return { rows, summary: { tongDoanhThu, tongChiPhi, tongLoiNhuan: chenhLech, chenhLech, chiPhiTheoNhom } }
}

function soatS2c() {
    const R = taoNgauNhien(20261112)
    const loaiCP = ['', 'a', 'b', 'c', 'd', 'đ', 'e', 'luong', 'Tiền điện', 'vay ngân hàng', 'ship', 'xyz', 'purchase', 'BHXH', 'thuê mặt bằng']
    let khop = 0
    for (let lan = 0; lan < 300; lan++) {
        const txs = Array.from({ length: R.nguyen(0, 40) }, (_, i) => ({
            id: 't' + i,
            receiptNumber: R.so() < 0.05 ? null : `HD${R.nguyen(1, 99999)}`,
            customerName: R.so() < 0.4 ? null : R.chon(['Khách lẻ', 'Nguyễn Văn A', '']),
            transactionDate: R.so() < 0.2 ? null : new Date(Date.UTC(2026, R.nguyen(0, 11), R.nguyen(1, 28), R.nguyen(0, 23))),
            createdAt: new Date(Date.UTC(2026, R.nguyen(0, 11), R.nguyen(1, 28), R.nguyen(0, 23))),
            subtotal: R.so() < 0.05 ? null : R.nguyen(0, 5_000_000) + R.chon([0, 0.5, 0.25]),
            discount: R.so() < 0.5 ? 0 : R.nguyen(0, 200_000),
            items: Array.from({ length: R.nguyen(0, 4) }, () => ({
                quantity: R.so() < 0.05 ? null : R.nguyen(0, 12),
                product: R.so() < 0.1 ? null : { costPrice: R.so() < 0.1 ? 0 : R.nguyen(1, 900_000) + R.chon([0, 0.1, 0.33]) },
            })),
        }))
        const exps = Array.from({ length: R.nguyen(0, 12) }, (_, i) => ({
            id: 'exp_' + R.nguyen(100000, 999999) + i,
            category: R.chon(loaiCP),
            description: R.chon(['', '[HD-001] Tiền điện tháng 1', 'Mua văn phòng phẩm', '[UNC 22] ', '[X]  nội dung', null as any]),
            amount: R.so() < 0.05 ? null : R.nguyen(1, 3_000_000),
            date: new Date(Date.UTC(2026, R.nguyen(0, 11), R.nguyen(1, 28), R.nguyen(0, 23))),
        }))
        xepTheoNgayChungTu(txs as any)
        const cu = JSON.stringify(s2cBanCu(txs.map(t => ({ ...t })), exps))
        const moi = JSON.stringify(tinhSoS2c(txs.map(t => ({ ...t })), exps, fmtDate))
        if (cu !== moi) { ca(`S2c ngẫu nhiên lần ${lan} khớp bản cũ`, false, `${moi.slice(0, 160)} ≠ ${cu.slice(0, 160)}`); return }
        khop++
    }
    ca('S2c: 300 bộ dữ liệu ngẫu nhiên khớp bản cũ từng byte', khop === 300)

    // Ca tay: giá vốn chỉ lấy theo product.costPrice (TransactionItem không có cột giá vốn)
    const mot = tinhSoS2c([{ id: 't', receiptNumber: 'HD1', customerName: 'A', transactionDate: new Date('2026-05-02T03:00:00Z'), createdAt: null, subtotal: 1000, discount: 100, items: [{ quantity: 2, product: { costPrice: 300 } }, { quantity: 1, product: null }] }], [{ id: 'abcdef123456', category: 'luong', description: '', amount: 50, date: new Date('2026-05-03T03:00:00Z') }], fmtDate)
    ca('S2c ca tay: doanh thu 900', mot.summary.tongDoanhThu === 900)
    ca('S2c ca tay: chi phí 600 + 50', mot.summary.tongChiPhi === 650)
    ca('S2c ca tay: 3 dòng, stt 1..3', mot.rows.length === 3 && mot.rows.map((r: any) => r.stt).join() === '1,2,3')
    ca('S2c ca tay: phiếu chi không số HĐ ⇒ CP-<6 ký tự cuối id>', mot.rows[2].soChungTu === 'CP-123456')
    ca('S2c ca tay: lương vào nhóm (b)', mot.summary.chiPhiTheoNhom.b.soTien === 50 && nhomChiPhiS2c('luong').nhom === 'b')
}

/* ── 4. Cột trong CHON_* có thật trong schema-store.prisma, không quan hệ nào xin nguyên hàng ── */
function docSchema(): Record<string, Record<string, string>> {
    const src = fs.readFileSync(path.join(GOC, 'prisma/schema-store.prisma'), 'utf8')
    const mo: Record<string, Record<string, string>> = {}
    const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
        const truong: Record<string, string> = {}
        for (const dong of m[2].split('\n')) {
            const t = dong.replace(/\/\/.*$/, '').trim()
            const k = /^(\w+)\s+([\w\[\]?]+)/.exec(t)
            if (k && !t.startsWith('@@')) truong[k[1]] = k[2].replace(/[\[\]?]/g, '')
        }
        mo[m[1]] = truong
    }
    return mo
}

function soatCot() {
    const mo = docSchema()
    ca('đọc được schema Transaction/TransactionItem/Product/ImportReceiptItem', !!(mo.Transaction && mo.TransactionItem && mo.Product && mo.ImportReceiptItem))
    const di = (ten: string, model: string, chon: Record<string, any>) => {
        for (const [k, v] of Object.entries(chon)) {
            const kieu = mo[model]?.[k]
            if (!kieu) { ca(`${ten}: cột ${model}.${k} có thật`, false, 'không có trong schema-store.prisma'); continue }
            ca(`${ten}: cột ${model}.${k} có thật`, true)
            const laQuanHe = !!mo[kieu]
            if (laQuanHe) {
                const dungHep = v && typeof v === 'object' && v.select && typeof v.select === 'object'
                ca(`${ten}: quan hệ ${model}.${k} chỉ xin cột hẹp (select)`, !!dungHep, `đang là ${JSON.stringify(v)}`)
                if (dungHep) di(ten, kieu, v.select)
            } else {
                ca(`${ten}: ${model}.${k} = true`, v === true, JSON.stringify(v))
            }
        }
    }
    di('CHON_PHIEU_S2C', 'Transaction', CHON_PHIEU_S2C)
    di('CHON_PHIEU_S2D', 'Transaction', CHON_PHIEU_S2D)
    di('CHON_PHIEU_TON', 'Transaction', CHON_PHIEU_TON)
    di('CHON_HANG_DONG_NHAP', 'ImportReceiptItem', { product: CHON_HANG_DONG_NHAP })
    // S2c cần đúng các cột route dùng
    for (const k of ['receiptNumber', 'customerName', 'transactionDate', 'createdAt', 'subtotal', 'discount', 'items']) ca(`CHON_PHIEU_S2C có ${k}`, k in CHON_PHIEU_S2C)
    for (const k of ['receiptNumber', 'customerName', 'transactionDate', 'createdAt', 'vatInvoiceNumber', 'items']) ca(`CHON_PHIEU_S2D có ${k}`, k in CHON_PHIEU_S2D)
}

/* ── 5. Ba route sổ không còn kéo nguyên hàng / đọc phiếu bán một lượt ─────────────────── */
function soatRoute() {
    const src = fs.readFileSync(path.join(GOC, 'src/routes/tax.ts'), 'utf8')
    /** Thân route, BỎ chú thích (chú thích được phép nhắc `product: true` để giải thích vì sao bỏ). */
    const than = (duong: string) => {
        const i = src.indexOf(`router.get('${duong}'`)
        if (i < 0) return ''
        const j = src.indexOf('\nrouter.', i + 10)
        return src.slice(i, j < 0 ? undefined : j).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    }
    for (const duong of ['/hkd/s2', '/hkd/s2-summary', '/hkd/s3']) {
        const t = than(duong)
        ca(`${duong}: tìm thấy route`, t.length > 100)
        ca(`${duong}: không còn \`product: true\``, !/product\s*:\s*true/.test(t))
        ca(`${duong}: phiếu bán đọc qua docTheoLo`, /docTheoLo\(\s*p\.transaction/.test(t))
        ca(`${duong}: không còn p.transaction.findMany( một lượt`, !/p\.transaction\.findMany\(/.test(t))
        ca(`${duong}: không Promise.all (pool 1 kết nối)`, !/Promise\.all\(/.test(t))
    }
    ca('/hkd/s3: dùng tinhSoS2c', /tinhSoS2c\(/.test(than('/hkd/s3')))
}

async function main() {
    await soatDocTheoLo()
    soatXep()
    soatS2c()
    soatCot()
    soatRoute()
    console.log(`check-so-hkd: ${dat} đạt, ${hong} hỏng`)
    if (hong) process.exit(1)
}
main().catch(e => { console.error('check-so-hkd LỖI:', e); process.exit(1) })
