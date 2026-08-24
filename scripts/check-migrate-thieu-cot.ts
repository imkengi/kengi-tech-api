/**
 * SOÁT TRƯỚC KHI DEPLOY: cột VỪA THÊM vào schema-store.prisma mà chưa có dòng ALTER
 * trong `/admin/migrate`.
 *
 * VÌ SAO CÓ — bẫy này đã cắn BA lần:
 *   Supplier.payable, ImportReceipt.dueDate…  → suppliers / import-receipts 500
 *   01/08/2026  StoreSettings.driveFolderId   → GET /api/store-settings 500 cho MỌI store
 *   24/08/2026  Repair.imei                   → GET /api/repairs 500, trang Sửa Chữa trắng
 *
 * Cơ chế: `/admin/migrate` KHÔNG đọc schema Prisma — nó là DANH SÁCH CÂU LỆNH
 * `ALTER TABLE … ADD COLUMN IF NOT EXISTS` viết tay trong `src/routes/admin.ts`.
 * Thêm trường vào schema rồi gọi migrate thì nó chạy xong danh sách CŨ và trả "OK"
 * cho mọi cửa hàng. Nhưng cột chưa hề được tạo, còn client Prisma (sinh lại lúc build)
 * ĐÃ biết trường mới ⇒ mọi truy vấn chạm bảng đó ném P2022, cả trang chết.
 *
 * Cái độc: BÁO CÁO THÀNH CÔNG MÀ KHÔNG LÀM VIỆC MÌNH TƯỞNG. Không có gì đỏ để nghi,
 * chỉ có một trang trắng vài phút sau.
 *
 * CÁCH SOÁT: so schema hiện tại với schema ở một mốc git (mặc định HEAD~1) và CHỈ soi
 * các dòng cột MỚI THÊM. Không soát toàn bộ cột — phần lớn cột do `createBranchSchema`
 * tạo lúc dựng cửa hàng, không đi qua migrate, soát hết thì ra 700+ dòng nhiễu và không
 * ai đọc nữa.
 *
 * Chạy:  npm run check:migrate            (so với HEAD~1)
 *        npm run check:migrate -- <ref>   (so với mốc khác, vd origin/master)
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const GOC = path.resolve(__dirname, '..')
const DUONG_SCHEMA = 'prisma/schema-store.prisma'
const ADMIN = path.join(GOC, 'src', 'routes', 'admin.ts')
const MOC = process.argv[2] || 'HEAD~1'

const VO_HUONG = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'BigInt', 'Bytes']

/** (bảng, cột) của mọi trường VÔ HƯỚNG trong một nội dung schema. */
function cotVoHuong(noiDung: string): Set<string> {
    const ra = new Set<string>()
    const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(noiDung))) {
        const bang = m[1]!
        for (const dong of m[2]!.split('\n')) {
            const d = dong.trim()
            if (!d || d.startsWith('//') || d.startsWith('@@')) continue
            const mm = /^(\w+)\s+(\w+)/.exec(d)
            if (!mm || !VO_HUONG.includes(mm[2]!)) continue
            ra.add(`${bang}.${mm[1]!}`)
        }
    }
    return ra
}

function schemaTaiMoc(ref: string): string | null {
    try {
        return execSync(`git show ${ref}:${DUONG_SCHEMA}`, { cwd: GOC, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
        return null
    }
}

const nayNoiDung = fs.readFileSync(path.join(GOC, DUONG_SCHEMA), 'utf8')
const cuNoiDung = schemaTaiMoc(MOC)

console.log('=== SOÁT: cột MỚI THÊM có dòng ALTER trong /admin/migrate chưa ===\n')

if (cuNoiDung === null) {
    console.log(`   ⚠ Không đọc được schema ở mốc "${MOC}" — bỏ qua, KHÔNG kết luận.`)
    console.log('     (đọc hỏng ≠ không có gì để báo)')
    process.exit(0)
}

const nay = cotVoHuong(nayNoiDung)
const cu = cotVoHuong(cuNoiDung)
const moi = [...nay].filter(c => !cu.has(c))

const adminSrc = fs.readFileSync(ADMIN, 'utf8')
const coAlter = new Set<string>()
{
    const re = /ALTER TABLE\s+"(\w+)"\s+ADD COLUMN IF NOT EXISTS\s+"(\w+)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(adminSrc))) coAlter.add(`${m[1]!}.${m[2]!}`)
}
const bangMoiTao = new Set<string>()
{
    const re = /CREATE TABLE IF NOT EXISTS\s+"(\w+)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(adminSrc))) bangMoiTao.add(m[1]!)
}

console.log(`   mốc so sánh: ${MOC}`)
console.log(`   cột vô hướng: ${cu.size} → ${nay.size}  (mới: ${moi.length})\n`)

if (moi.length === 0) {
    console.log('   ✓ Không có cột nào mới thêm — không cần ALTER.')
    process.exit(0)
}

const thieu = moi.filter(c => !coAlter.has(c) && !bangMoiTao.has(c.split('.')[0]!))
for (const c of moi) {
    const ok = coAlter.has(c) || bangMoiTao.has(c.split('.')[0]!)
    console.log(`   ${ok ? '✓' : '⛔'} ${c}${bangMoiTao.has(c.split('.')[0]!) && !coAlter.has(c) ? '  (bảng có CREATE TABLE — ok)' : ''}`)
}
console.log('')

if (thieu.length === 0) {
    console.log('   ✓ Mọi cột mới đều đã có dòng ALTER.')
    process.exit(0)
}

console.log(`   ⛔ ${thieu.length} cột mới CHƯA có dòng ALTER. Deploy như vậy là P2022 + trang trắng.`)
console.log('   `/admin/migrate` vẫn sẽ báo "OK" vì nó chỉ chạy danh sách nó có.\n')
console.log('   Thêm vào src/routes/admin.ts, trong vòng lặp store của /migrate:')
for (const t of thieu) {
    const [b, c] = t.split('.')
    console.log(`      await (sp as any).$executeRawUnsafe(\`ALTER TABLE "${b}" ADD COLUMN IF NOT EXISTS "${c}" TEXT\`)`)
}
console.log('   (đổi TEXT thành kiểu đúng: INTEGER / DOUBLE PRECISION / BOOLEAN / TIMESTAMP(3))')
process.exit(1)
