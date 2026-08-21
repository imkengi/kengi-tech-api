/**
 * Kiểm TRẦN KẾT NỐI CLOUD SQL — npx tsx scripts/check-tran-ket-noi.ts
 *
 * Cloud SQL db-f1-micro đặt `max_connections = 50` (flag đặt tay). Mỗi instance
 * Cloud Run giữ MỘT PrismaClient cho MỖI schema cửa hàng, mỗi client ôm
 * `connection_limit = PRISMA_POOL_SIZE`, cộng thêm client registry. Nên số kết
 * nối tối đa mà một lần deploy CÓ THỂ đòi là:
 *
 *     nền + maxInstances × (registry + số_cửa_hàng × pool)
 *
 * Vượt trần thì Postgres không từ chối lịch sự: nó ném `P1001 Can't reach
 * database server`, và ở open-retail chỗ chết đầu tiên là
 * `convertOnlineOrderToTransaction` ⇒ ĐƠN SÀN KHÔNG VÀO SỔ. Đây là đường làm
 * MẤT TIỀN chứ không phải chỉ mất ổn định.
 *
 * DÍNH THẬT 16/08/2026: pool 2 + maxScale 3. Cloud Run tự nhân lên 2 instance
 * lúc 17:04, kết nối đi 21 → 33 → 49 (DB chặn ở đó) trong 3 phút, và 17:13 đẻ
 * 4 lỗi P1001. Cả ngày hôm đó 17:00 là giờ DUY NHẤT có 2 instance, và nó ăn 51
 * lỗi chuyển đơn — gấp 3–5 lần mọi giờ khác.
 *
 * ⚠ BỘ NÀY DÙNG SỐ ĐO, KHÔNG DÙNG PHÉP TÍNH SUÔNG. Đo thật ngày 16/08 lúc cao
 * điểm (tách riêng database `kengi_tech`): pool 1 → 12 kết nối/instance (khớp
 * khít 3 + 9×1), nhưng pool 2 → 33 chứ không phải 21 như phép tính. Chưa lý
 * giải được 12 kết nối chênh đó. Một bộ kiểm dựng trên phép tính hụt sẽ CẤP
 * PHÉP cho "pool 2 + maxScale 2" (44/50, nhìn như an toàn) trong khi số đo nói
 * nó đòi 68. Nên: pool nào đã đo thì lấy số đo; pool chưa đo thì cộng thêm
 * khoản chênh chưa rõ cho an toàn.
 */

import * as fs from 'fs'
import * as path from 'path'

let dat = 0, hong = 0
function ok(ten: string, dk: boolean, thucTe?: any) {
    if (dk) { dat++; console.log(`  ✓ ${ten}`) }
    else { hong++; console.log(`  ✗ ${ten}${thucTe !== undefined ? ` — ${JSON.stringify(thucTe)}` : ''}`) }
}

// ─── Hằng số, kèm chỗ lấy ra ────────────────────────────────────────────────

/** `max_connections` của db-f1-micro — đặt hẳn thành flag trên Cloud SQL. */
export const TRAN = 50

/** Nền không phải của app (database `cloudsqladmin`) — đo 16/08: đúng 2. */
export const NEN = 2

/** Lề an toàn: chạm sát trần là P1001, không có báo trước. */
export const LE = 5

/**
 * Số cửa hàng. Xác nhận 16/08/2026 qua `GET /api/admin/stores` → `data.total = 9`,
 * cả 9 đều `status: 'active'` và đều có `schema`.
 * ⚠ Thêm cửa hàng là phải sửa số này rồi chạy lại bộ kiểm.
 */
export const SO_CUA_HANG = 9

/** Pool của registry: không đặt `connection_limit` nên ăn mặc định cpu×2+1, cpu=1 → 3. */
export const REGISTRY_POOL = 3

/** Số kết nối/instance ĐO ĐƯỢC lúc cao điểm 16/08, theo từng mức pool. */
export const DO_DUOC: Record<number, number> = { 1: 12, 2: 33 }

/**
 * Khoản pool 2 vượt phép tính (33 đo được − 21 tính ra). Chưa lý giải được;
 * cộng vào cho mức pool chưa có số đo, để bộ kiểm không lạc quan hơn thực tế.
 */
export const CHENH_CHUA_RO = 12

// ─── Đọc cấu hình từ cloudbuild.yaml ────────────────────────────────────────

/** Đọc giá trị đứng NGAY SAU một cờ trong danh sách args kiểu `- '--cpu'` / `- '1'`. */
export function docCo(yaml: string, co: string): string | null {
    const dong = yaml.split('\n')
    for (let i = 0; i < dong.length; i++) {
        const t = dong[i].trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '')
        if (t !== co) continue
        for (let j = i + 1; j < dong.length; j++) {
            const s = dong[j].trim()
            if (!s || s.startsWith('#')) continue          // bỏ dòng trống và chú thích
            return s.replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '')
        }
    }
    return null
}

/** Đọc một biến trong chuỗi `--set-env-vars` (chuỗi dài ngăn bằng dấu phẩy). */
export function docEnv(yaml: string, ten: string): string | null {
    const m = yaml.match(new RegExp(`[,\\s>-]${ten}=([^,\\n]*)`))
    return m ? m[1].trim() : null
}

// ─── Phép tính ──────────────────────────────────────────────────────────────

export interface KetQua {
    moiInstance: number
    toiDa: number
    tran: number
    dat: boolean
    /** true nếu con số mỗi instance là ước lượng chứ không phải đo được. */
    laUocTinh: boolean
}

/**
 * Số kết nối một instance đòi, theo pool và số cửa hàng.
 *
 * ⚠ ĐỪNG rơi thẳng về "ước lượng bi quan" khi số cửa hàng đổi. Bản đầu tôi viết
 * `soCuaHang === SO_CUA_HANG ? doDuoc : model + CHENH_CHUA_RO`, nghĩa là THÊM
 * MỘT cửa hàng thôi là mất luôn số đo và cộng thêm 12 kết nối vô căn cứ: với 10
 * cửa hàng nó tính ra 77 trong khi thực tế khoảng 41, tức BÁO ĐỘNG GIẢ ngay lần
 * mở rộng đầu tiên. Bộ kiểm hay báo oan thì sẽ bị tắt, và lúc đó nó vô dụng
 * đúng vào lúc cần nhất.
 *
 * Cách đúng: dùng MÔ HÌNH (`registry + số_cửa_hàng × pool`) làm gốc — mô hình
 * này ĐÃ ĐƯỢC ĐO KHỚP ở pool 1 (12 = 3 + 9×1, và 2 instance đo được đúng 24).
 * Chỉ cộng khoản chênh chưa lý giải cho pool ≥ 2, nơi thực sự quan sát thấy nó
 * (đo 33 trong khi mô hình nói 21).
 */
export function moiInstanceCan(pool: number, soCuaHang: number): number {
    const moHinh = REGISTRY_POOL + soCuaHang * pool
    return pool >= 2 ? moHinh + CHENH_CHUA_RO : moHinh
}

export function tinh(pool: number, maxInstances: number, soCuaHang = SO_CUA_HANG): KetQua {
    const moiInstance = moiInstanceCan(pool, soCuaHang)
    const toiDa = NEN + maxInstances * moiInstance
    const khopDo = DO_DUOC[pool] !== undefined && soCuaHang === SO_CUA_HANG
    return { moiInstance, toiDa, tran: TRAN - LE, dat: toiDa <= TRAN - LE, laUocTinh: !khopDo }
}

// ─── Chạy ───────────────────────────────────────────────────────────────────

function main() {
    console.log('\n▶ Trần kết nối Cloud SQL — cấu hình deploy có vượt không\n')

    const duong = path.join(process.cwd(), 'cloudbuild.yaml')
    const yaml = fs.readFileSync(duong, 'utf8')

    const poleStr = docEnv(yaml, 'PRISMA_POOL_SIZE')
    const maxStr = docCo(yaml, '--max-instances')

    /* PRISMA_POOL_SIZE PHẢI có mặt trong --set-env-vars.
     * Cờ này đặt bằng `gcloud run services update` thì lần deploy sau bị
     * `--set-env-vars` (thay TOÀN BỘ danh sách) xoá sạch, và mã lùi về mặc
     * định 3 — đúng chuyện đã xảy ra 29/07/2026 và không ai biết suốt hai
     * tuần, vì PRISMA_POOL_TIMEOUT vẫn còn nên nhìn qua tưởng còn nguyên. */
    ok('cloudbuild.yaml có khai PRISMA_POOL_SIZE (đặt bằng gcloud sẽ bị xoá)', poleStr !== null, poleStr)
    ok('cloudbuild.yaml có khai --max-instances', maxStr !== null, maxStr)

    const pool = parseInt(poleStr || '3', 10)
    const maxInst = parseInt(maxStr || '1', 10)

    const kq = tinh(pool, maxInst)
    console.log(`\n  pool=${pool}  maxInstances=${maxInst}  cửa hàng=${SO_CUA_HANG}`)
    console.log(`  ${kq.moiInstance} kết nối/instance ${kq.laUocTinh ? '(ước tính)' : '(đo được 16/08)'}`)
    console.log(`  tối đa = ${NEN} + ${maxInst}×${kq.moiInstance} = ${kq.toiDa}  |  ngưỡng ${kq.tran}/${TRAN}\n`)

    ok(`cấu hình hiện tại không vượt trần (${kq.toiDa} ≤ ${kq.tran})`, kq.dat, kq)

    // ── Chiều PHẢI BÁO: những cấu hình đã biết là hỏng ───────────────────────
    ok('bắt được pool 2 + maxScale 3 (đúng cấu hình gây sự cố 16/08)', !tinh(2, 3).dat, tinh(2, 3))

    /* Đường "hạ maxScale 3→2" từng được coi là cách cứu. Số đo nói không:
     * 2 × 33 = 66. Bộ kiểm phải bác nó, nếu không nó sẽ cấp phép cho đúng
     * cái bẫy mà mình vừa thoát ra. */
    ok('bắt được pool 2 + maxScale 2 (đường "hạ maxScale" tưởng cứu được)', !tinh(2, 2).dat, tinh(2, 2))

    ok('bắt được khi thêm cửa hàng mà không hạ pool (20 cửa hàng, pool 1)', !tinh(1, 3, 20).dat, tinh(1, 3, 20))

    /* CHIỀU IM QUAN TRỌNG NHẤT: mở rộng vừa phải KHÔNG được báo động giả.
     * Bản đầu của hàm này tính 10 cửa hàng ra 77/45 (vì rơi về ước lượng bi quan
     * ngay khi số cửa hàng khác 9) trong khi thực tế khoảng 41 — báo oan ngay
     * lần thêm cửa hàng đầu tiên, và bộ kiểm hay báo oan thì sẽ bị tắt. */
    ok('KHÔNG báo động giả khi thêm 1 cửa hàng (10 cửa hàng, pool 1)', tinh(1, 3, 10).dat, tinh(1, 3, 10))
    ok('mô hình khớp số ĐO ĐƯỢC ở pool 1 (12/instance)', moiInstanceCan(1, 9) === DO_DUOC[1], moiInstanceCan(1, 9))
    ok('mô hình khớp số ĐO ĐƯỢC ở pool 2 (33/instance)', moiInstanceCan(2, 9) === DO_DUOC[2], moiInstanceCan(2, 9))

    // ── Chiều PHẢI IM: cấu hình thật sự an toàn thì đừng kêu ─────────────────
    ok('KHÔNG kêu với pool 1 + maxScale 3 (cấu hình đang chạy)', tinh(1, 3).dat, tinh(1, 3))

    /* pool 2 + MỘT instance đã chạy thật cả ngày 16/08 không lỗi (33+2=35).
     * Bộ kiểm mà kêu cả ca này là kêu quá tay, sẽ bị bỏ qua như tiếng ồn. */
    ok('KHÔNG kêu với pool 2 + maxScale 1 (thực tế chạy được)', tinh(2, 1).dat, tinh(2, 1))

    // ── Bộ dò còn sống không ─────────────────────────────────────────────────
    ok('docCo đọc đúng --cpu từ file thật', docCo(yaml, '--cpu') === '1', docCo(yaml, '--cpu'))
    ok('docCo bỏ qua chú thích xen giữa cờ và giá trị',
        docCo("      - '--max-instances'\n      # chú thích\n      - '7'\n", '--max-instances') === '7')
    ok('docEnv không nhầm biến có tên trùng phần đuôi',
        docEnv('X,PRISMA_POOL_TIMEOUT=30,PRISMA_POOL_SIZE=1,Y=2', 'PRISMA_POOL_SIZE') === '1',
        docEnv('X,PRISMA_POOL_TIMEOUT=30,PRISMA_POOL_SIZE=1,Y=2', 'PRISMA_POOL_SIZE'))
    ok('docEnv trả null khi biến vắng mặt', docEnv('A=1,B=2', 'PRISMA_POOL_SIZE') === null)

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exit(1)
}

main()
