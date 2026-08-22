/**
 * deploy:gcloud — deploy lên Cloud Run, có ĐÓNG DẤU cây mã đang deploy.
 *
 * Vì sao (20/08/2026): `gcloud builds submit .` gói **thư mục làm việc**, không phải commit — nên
 * hai phiên làm việc trên hai cây khác nhau có thể đè lên nhau, và prod chạy bản cũ mà không ai
 * biết. Tối 20/08 mất bản vá "thiếu ≠ 0" đúng theo đường này, hậu quả: webhook KiotViet ghi 0 đè
 * nợ thật của 24 khách (1.264.231.175đ).
 *
 * Mỗi lần deploy đóng vào biến môi trường của Cloud Run:
 *   BUILD_GIT_SHA         — commit của cây ĐANG deploy
 *   BUILD_GIT_TRANG_THAI  — 'sach' | 'ban' (có sửa chưa commit) | 'ci' (do GitHub Actions deploy)
 *   BUILD_ID              — id lượt build của Cloud Build
 * `GET /api/health` trả lại ba thứ đó ⇒ một lần gọi là biết prod đang chạy cây nào.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ CÓ HAI ĐƯỜNG DEPLOY, VÀ CHÚNG ĐUA NHAU (đo được 22/08/2026)
 *
 * `.github/workflows/deploy.yml` chạy mỗi khi push `master` và cũng `gcloud builds submit`.
 * Nên `git push && npm run deploy:gcloud` khởi động ĐÚNG HAI lượt build cách nhau ~3 giây —
 * đo trong nhật ký kiểm toán, ba lượt deploy ngày 22/08 đều sinh cặp (04:17:47/50 · 06:51:12/15
 * · 07:18:52/55). Lượt của CI luôn xong SAU vài giây nên nó LUÔN giành traffic.
 *
 * Hệ quả phải nhớ:
 *   1. CI gói **commit đã push**, lệnh này gói **thư mục làm việc**. Cây bẩn ⇒ phần chưa commit
 *      lên prod trong ~2 giây rồi bị CI xoá đi. Không có thông báo nào cả.
 *   2. Vì thế lệnh này KHÔNG in ra "sha phải là X" nữa — trước 22/08 nó in vậy, mà điều đó
 *      không bao giờ đúng được (CI ghi đè bằng "khong-ro"), khiến người đọc tưởng traffic
 *      chưa chuyển và deploy lại vòng vòng.
 *   3. Nay lệnh tự CHỜ và ĐỌC lại `/api/health`, rồi nói thẳng bản nào đã thắng.
 *
 * Chạy: npm run deploy:gcloud
 */
import { execSync, spawnSync } from 'child_process'

const chay = (lenh: string) => execSync(lenh, { encoding: 'utf8' }).trim()

let sha = 'khong-ro'
let trangThai = 'khong-ro'
try {
    sha = chay('git rev-parse --short HEAD')
    trangThai = chay('git status --porcelain').length ? 'ban' : 'sach'
} catch {
    console.warn('⚠ Không đọc được git — vẫn deploy nhưng dấu ấn sẽ là "khong-ro".')
}

/** HEAD đã có trên origin/master chưa. Nếu rồi thì CI đã/đang chạy một lượt deploy song song. */
function daPush(): boolean | null {
    try {
        return chay(`git branch -r --contains HEAD --list origin/master`).length > 0
    } catch {
        return null
    }
}

/** Dừng thật sự vài giây, không chỉ in chữ "Ctrl+C" rồi chạy tiếp ngay — lời cảnh báo mà không
 *  cho kịp bấm thì chỉ là trang trí. */
const cho = (giay: number) => new Promise(r => setTimeout(r, giay * 1000))

async function canhBaoNeuBan() {
    if (trangThai !== 'ban') return
    const push = daPush()
    console.warn('')
    console.warn('⚠ CÂY MÃ ĐANG BẨN (có sửa chưa commit).')
    console.warn('  Bản deploy sẽ KHÁC commit ' + sha + ' — đó chính là kiểu sai đã gây sự cố 20/08.')
    if (push !== false) {
        console.warn('')
        console.warn('  ⛔ NẶNG HƠN: commit này đã có trên origin/master ⇒ GitHub Actions cũng đang')
        console.warn('     deploy, và lượt của nó về SAU nên sẽ ĐÈ LÊN bản này. Phần bạn chưa commit')
        console.warn('     sẽ lên prod vài giây rồi biến mất, KHÔNG có thông báo.')
        console.warn('     Muốn nó ở lại prod thì COMMIT rồi push, đừng deploy tay đè.')
    }
    console.warn('')
    console.warn('  Nếu đây là chủ ý thì cứ chờ; nếu không, bấm Ctrl+C NGAY BÂY GIỜ.')
    for (let i = 8; i > 0; i--) { process.stdout.write(`\r  bắt đầu deploy sau ${i}s… `); await cho(1) }
    console.warn('\r  (đã chờ 8s — tiếp tục)          ')
    console.warn('')
}

type Dau = { sha: string; trangThai: string; buildId: string }

async function docDauAn(): Promise<Dau | null> {
    try {
        const r = await fetch('https://api.kengi.vn/api/health', { signal: AbortSignal.timeout(15000) })
        const j: any = await r.json()
        const b = j?.build
        return b ? { sha: b.sha, trangThai: b.trangThai, buildId: b.buildId } : null
    } catch {
        return null
    }
}

/**
 * Đọc lại dấu ấn nhiều lần rồi mới kết luận. Một lần đọc KHÔNG đủ: lượt build của CI xong sau
 * lượt này vài giây, nên đọc sớm sẽ thấy bản của mình rồi lát sau bị thay — chính cái đó làm
 * người ta tưởng "deploy xong rồi" trong khi prod lát nữa chạy mã khác.
 */
async function xacMinh() {
    console.log('')
    console.log('▸ Đọc lại /api/health trong 3 phút để xem lượt nào thắng…')
    const thay: string[] = []
    let cuoi: Dau | null = null
    for (let i = 0; i < 30; i++) {
        await cho(6)
        const d = await docDauAn()
        if (!d) continue
        cuoi = d
        const nhan = `${d.sha}/${d.trangThai}`
        if (thay[thay.length - 1] !== nhan) {
            thay.push(nhan)
            console.log(`   ${new Date().toLocaleTimeString('vi-VN')} → ${nhan}`)
        }
    }

    console.log('')
    if (!cuoi) {
        console.log('⚠ Không đọc được /api/health — KHÔNG kết luận được bản nào đang chạy.')
        console.log('  Cách chắc chắn: tải gói nguồn của revision đang phục vụ rồi grep (xem deploy.md).')
        return
    }
    if (thay.length > 1) console.log(`ℹ Dấu ấn ĐÃ ĐỔI ${thay.length} lần: ${thay.join('  →  ')}`)

    if (cuoi.sha === sha && cuoi.trangThai === trangThai) {
        console.log(`✔ Prod đang chạy ĐÚNG bản vừa deploy — ${sha} (${trangThai}).`)
        return
    }
    if (cuoi.trangThai === 'ci') {
        console.log(`✔ GitHub Actions đã đè lên — prod đang chạy commit ${cuoi.sha} (bản đã push).`)
        if (trangThai === 'ban') {
            console.log('')
            console.log('  ⛔ CÂY LÚC DEPLOY LÀ BẨN ⇒ phần CHƯA COMMIT của bạn KHÔNG có trên prod.')
            console.log('     Commit rồi push nếu muốn nó lên.')
        } else if (cuoi.sha !== sha) {
            console.log(`  ⚠ Nhưng đó KHÔNG phải commit của bạn (${sha}) — có người push commit khác.`)
        }
        return
    }
    if (cuoi.trangThai === 'khong-ro') {
        console.log(`⚠ Prod báo "khong-ro" — bản đang chạy KHÔNG mang dấu ấn git.`)
        console.log('  Nghĩa là nó do một lượt `gcloud builds submit` không truyền _GIT_SHA tạo ra')
        console.log('  (GitHub Actions cũ trước 22/08/2026 là như vậy). Không kết luận được từ dấu ấn;')
        console.log('  phải tải gói nguồn của revision đang phục vụ rồi grep — xem deploy.md.')
        return
    }
    console.log(`⚠ Prod đang chạy ${cuoi.sha} (${cuoi.trangThai}), KHÁC bản vừa deploy ${sha} (${trangThai}).`)
    console.log('  Traffic chưa chuyển, hoặc có lượt deploy khác đè lên — xem skill deploy-backend.')
}

async function main() {
    await canhBaoNeuBan()
    console.log(`▶ Deploy — commit ${sha} (${trangThai})`)
    const kq = spawnSync('gcloud', [
        'builds', 'submit',
        '--config', 'cloudbuild.yaml',
        `--substitutions=_GIT_SHA=${sha},_GIT_TRANG_THAI=${trangThai}`,
        '.',
    ], { stdio: 'inherit', shell: true })

    if (kq.status !== 0) { process.exitCode = kq.status ?? 1; return }
    await xacMinh()
}

main()
