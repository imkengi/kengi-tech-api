/**
 * check-thoat-ssml — chữ gửi Edge TTS phải THOÁT ký tự XML (21/11/2026).
 *
 * Bệnh (đo 21/11/2026): msedge-tts 2.1.0 nhét chữ THẲNG vào SSML ⇒ "&" thô trong tên hàng ("Đầu Tròn & Uốn Cong")
 * làm Edge đóng luồng không trả âm thanh ("Stream closed before the synthesis completed") ⇒ /livestream/tts thử 3 lần
 * rồi rơi về giọng Google (log prod 20/11: 6 lượt = 2 câu × 3). Máy phát studio cùng bệnh: kẹt "Còn 2/117 câu chưa
 * sinh được giọng đọc", không lên sóng được.
 *
 * Soát: thoatSsml đúng; SSML dựng bằng CHÍNH khuôn của msedge-tts không còn "&" thô (và không thoát HAI lần — nâng
 * msedge-tts mà bản mới tự thoát thì mục S4 đỏ, bỏ thoatSsml đi); mọi lời gọi `.toStream(` trong src/ đều qua thoatSsml.
 *
 * Chạy: npx tsx scripts/check-thoat-ssml.ts   (thuần: không mạng, không DB)
 */
import fs from 'fs'
import path from 'path'
import { MsEdgeTTS } from 'msedge-tts'
import { thoatSsml } from '../src/lib/thoatSsml'

let hong = 0
function dung(ten: string, ok: boolean, chiTiet = ''): void {
    console.log(`${ok ? '✓' : '✗'} ${ten}${ok ? '' : ` — ${chiTiet}`}`)
    if (!ok) hong++
}

const BUA = 'Mình nói kỹ hơn về Búa Đóng, Nhổ Đinh Deli - Đầu Tròn & Uốn Cong cho cả nhà nghe nha.'
const CO_LE = '[Hàng Chính Hãng] Bộ 2 Cờ Lê Đa Năng Deli - Chiều Dài 215mm & 280mm'

dung('S1 "&" trong tên hàng ⇒ "&amp;"', thoatSsml(BUA) === BUA.replace('&', '&amp;') && thoatSsml(CO_LE) === CO_LE.replace('&', '&amp;'), thoatSsml(BUA))
dung('S2 "<" ">" ⇒ "&lt;" "&gt;"', thoatSsml('Ống <20mm> & co') === 'Ống &lt;20mm&gt; &amp; co', thoatSsml('Ống <20mm> & co'))
const thuong = '  Chào cả nhà!\nHôm nay giảm 31% (còn 108 nghìn) — bấm giỏ hàng nha. '
dung('S3 chữ không có & < > giữ NGUYÊN', thoatSsml(thuong) === thuong)

// S4: khuôn SSML THẬT của msedge-tts (đang cài) + thoatSsml ⇒ không còn "&" thô, và "&" chỉ thoát MỘT lần.
const tts = new MsEdgeTTS() as unknown as { _SSMLTemplate: (input: string, options?: object) => string }
const ssml = tts._SSMLTemplate(thoatSsml(CO_LE), { rate: '+5%', pitch: '+0%' })
const thoTho = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/.test(ssml)
dung('S4 SSML gửi Edge không còn "&" thô', !thoTho, ssml.replace(/\s+/g, ' ').slice(0, 220))
dung('S4b "&" chỉ thoát MỘT lần (msedge-tts chưa tự thoát)', ssml.includes('215mm &amp; 280mm') && !ssml.includes('&amp;amp;'),
    'msedge-tts bản mới đã tự thoát ⇒ bỏ thoatSsml ở src/routes/livestream.ts (và xmlSsml ở engine/tts.mjs của studio)')
const thoKhongThoat = tts._SSMLTemplate(CO_LE, { rate: '+5%', pitch: '+0%' })
dung('S4c đối chứng: KHÔNG thoát thì khuôn msedge-tts còn "&" thô (bệnh gốc vẫn còn ⇒ thoatSsml còn cần)',
    /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/.test(thoKhongThoat))

// S5: mọi lời gọi .toStream( trong src/ phải bọc thoatSsml(
const GOC = path.resolve(__dirname, '..', 'src')
const tep: string[] = []
const di = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== 'generated') di(p) } else if (/\.ts$/.test(e.name)) tep.push(p)
    }
}
di(GOC)
const goi: string[] = []
const sai: string[] = []
for (const p of tep) {
    const s = fs.readFileSync(p, 'utf8')
    for (const m of s.matchAll(/\.toStream\(([^,)]*)/g)) {
        const cho = `${path.relative(GOC, p)}: .toStream(${m[1]}`
        goi.push(cho)
        if (!m[1].trim().startsWith('thoatSsml(')) sai.push(cho)
    }
}
dung(`S5 ${goi.length} lời gọi .toStream( trong src/ đều qua thoatSsml`, goi.length > 0 && sai.length === 0, sai.join(' | ') || 'không thấy lời gọi nào')

if (hong) {
    console.error(`\n✗ ${hong} mục hỏng`)
    process.exitCode = 1
} else {
    console.log('\n✓ Chữ gửi Edge TTS đã thoát XML')
}
