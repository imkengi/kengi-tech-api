/**
 * Soát TRƯỜNG BỊ ZOD CẮT IM LẶNG ở POST /api/transactions — npx tsx scripts/check-txdata-zod.ts
 *
 * Vì sao (09/11/2026): `validate(Schema)` gán `req.body = result.data`, mà zod mặc định BỎ mọi key không khai
 * trong schema — không lỗi, không log. Route bán hàng đọc `txData.salespersonId` (nhân viên được tính doanh số,
 * thêm 15/08/2026) nhưng `CreateTransactionSchema` không khai ⇒ luôn undefined ⇒ gần 3 tháng mọi phiếu web chọn
 * "nhân viên bán" khác đều ghi công cho người bấm máy, báo cáo doanh số theo nhân viên sai mà không ai biết.
 * App PC (scratch/kengi-pc, scripts/kiem-hop-dong.ts) bắt được khi soát payload bằng chính zod này.
 *
 * Canh:
 *   1. Mọi `txData.X` route đọc PHẢI có trong schema — trừ trường đang để zod cắt có ghi lý do (DANG_CAT).
 *   2. Trường trong DANG_CAT mà schema đã khai, hoặc route không còn đọc ⇒ đỏ (danh sách cũ).
 *   3. Không thấy dòng `…txData } = req.body` hoặc đọc quá ít trường ⇒ đỏ (route đổi cách đọc body, bộ soát mù).
 * Tự kiểm trước khi soát mã thật: đoạn mã "phải kêu / phải im" — bộ soát hỏng mà xanh còn tệ hơn không có.
 */
import fs from 'fs'
import path from 'path'
import { CreateTransactionSchema } from '../src/schemas'

const ROUTE = path.resolve(__dirname, '..', 'src', 'routes', 'transactions.ts')

/** Route có đọc nhưng zod đang cắt ⇒ nhánh đó CHẾT (luôn rơi về mặc định). Mở ra là đổi hành vi — quyết riêng. */
const DANG_CAT: Record<string, string> = {
    receiptNumber: 'số phiếu luôn do máy chủ cấp; mở cho client đặt thì phải chống trùng / giả số',
    transactionDate: 'ngày bán = lúc máy chủ nhận; mở cho client gửi thì phải qua khoá sổ kỳ (periodLock)',
    channel: "kênh do máy chủ suy ('van' khi bán trên xe, còn lại 'direct')",
}

const DONG_TACH = /const\s*\{([^}]*)\.\.\.txData\s*\}\s*=\s*req\.body/

function soat(nguon: string, khai: Set<string>, dangCat: Record<string, string>): string[] {
    const loi: string[] = []
    const m = nguon.match(DONG_TACH)
    if (!m) return ['không thấy dòng `const { … ...txData } = req.body` — route đổi cách đọc body, sửa bộ soát']
    const tach = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    const doc = [...new Set([...nguon.matchAll(/\btxData\.([A-Za-z_]\w*)/g)].map((x) => x[1]))]
    if (doc.length < 5) loi.push(`chỉ thấy ${doc.length} trường txData.* — regex hụt hay route đổi tên biến?`)
    for (const k of [...tach, ...doc]) {
        if (khai.has(k) || dangCat[k]) continue
        loi.push(`route đọc ${tach.includes(k) ? k : `txData.${k}`} nhưng CreateTransactionSchema KHÔNG khai ⇒ validate() cắt, luôn undefined`)
    }
    for (const k of Object.keys(dangCat)) {
        if (khai.has(k)) loi.push(`${k} đã khai trong schema — gỡ khỏi DANG_CAT`)
        else if (!doc.includes(k)) loi.push(`route không còn đọc txData.${k} — gỡ khỏi DANG_CAT`)
    }
    return loi
}

// ── tự kiểm ──
const MAU_DOC = `
router.post('/', validate(S), async (req, res) => {
    const { items, payments, ...txData } = req.body
    const a = txData.total; const b = txData.notes; const c = txData.status
    const d = txData.customerId; const e = txData.salespersonId; const f = txData.channel
})`
const tuKiem: [string, string, Set<string>, boolean][] = [
    ['thiếu salespersonId ⇒ kêu', MAU_DOC, new Set(['items', 'payments', 'total', 'notes', 'status', 'customerId']), true],
    ['khai đủ ⇒ im', MAU_DOC, new Set(['items', 'payments', 'total', 'notes', 'status', 'customerId', 'salespersonId']), false],
    ['không tách req.body ⇒ kêu', 'const txData = req.body', new Set(), true],
    ['trường tách ra (items) thiếu ⇒ kêu', MAU_DOC, new Set(['payments', 'total', 'notes', 'status', 'customerId', 'salespersonId']), true],
]
let hong = 0
for (const [ten, ma, khai, phaiKeu] of tuKiem) {
    const kq = soat(ma, khai, { channel: 'mẫu' })
    if (kq.length > 0 !== phaiKeu) {
        hong++
        console.log(`✗ TỰ KIỂM hỏng: ${ten} — ${JSON.stringify(kq)}`)
    }
}
if (hong) {
    console.log(`\nBộ soát hỏng (${hong} ca tự kiểm) — sửa bộ soát trước.`)
    process.exit(2)
}

// ── soát mã thật ──
const khai = new Set(Object.keys((CreateTransactionSchema as any).shape as object))
const loi = soat(fs.readFileSync(ROUTE, 'utf8'), khai, DANG_CAT)
for (const [k, v] of Object.entries(DANG_CAT)) console.log(`  · ${k}: zod đang cắt — ${v}`)
if (loi.length) {
    for (const l of loi) console.log(`✗ ${l}`)
    console.log(`\n${loi.length} lỗi — trường client gửi lên bị zod cắt im lặng ở POST /api/transactions.`)
    process.exit(1)
}
console.log(`✓ POST /api/transactions: mọi trường route đọc đều có trong CreateTransactionSchema (${khai.size} trường khai).`)
