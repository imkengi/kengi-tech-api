/**
 * deploy:gcloud — deploy lên Cloud Run, có ĐÓNG DẤU cây mã đang deploy.
 *
 * Vì sao (20/08/2026): `gcloud builds submit .` gói **thư mục làm việc**, không phải commit — nên
 * hai phiên làm việc trên hai cây khác nhau có thể đè lên nhau, và prod chạy bản cũ mà không ai
 * biết. Tối 20/08 mất bản vá "thiếu ≠ 0" đúng theo đường này, hậu quả: webhook KiotViet ghi 0 đè
 * nợ thật của 24 khách (1.264.231.175đ).
 *
 * Nay mỗi lần deploy đóng vào biến môi trường của Cloud Run:
 *   BUILD_GIT_SHA         — commit của cây ĐANG deploy
 *   BUILD_GIT_TRANG_THAI  — 'sach' | 'ban' (có sửa chưa commit)
 *   BUILD_ID              — id lượt build của Cloud Build
 * `GET /api/health` trả lại ba thứ đó ⇒ một lần gọi là biết prod đang chạy cây nào.
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

/** Dừng thật sự vài giây, không chỉ in chữ "Ctrl+C" rồi chạy tiếp ngay — lời cảnh báo mà không
 *  cho kịp bấm thì chỉ là trang trí. */
const cho = (giay: number) => new Promise(r => setTimeout(r, giay * 1000))

async function canhBaoNeuBan() {
    if (trangThai !== 'ban') return
    console.warn('')
    console.warn('⚠ CÂY MÃ ĐANG BẨN (có sửa chưa commit).')
    console.warn('  Bản deploy sẽ KHÁC commit ' + sha + ' — đó chính là kiểu sai đã gây sự cố 20/08.')
    console.warn('  Nếu đây là chủ ý thì cứ chờ; nếu không, bấm Ctrl+C NGAY BÂY GIỜ.')
    for (let i = 5; i > 0; i--) { process.stdout.write(`\r  bắt đầu deploy sau ${i}s… `); await cho(1) }
    console.warn('\r  (đã chờ 5s — tiếp tục)          ')
    console.warn('')
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
    console.log('')
    console.log('✔ Deploy xong. Kiểm ngay bản đang chạy:')
    console.log('   curl -s https://api.kengi.vn/api/health')
    console.log(`   → "build" phải là { sha: "${sha}", trangThai: "${trangThai}" }`)
    console.log('   (khác nghĩa là traffic chưa chuyển hoặc ai đó deploy chồng — xem skill deploy-backend)')
}

main()
