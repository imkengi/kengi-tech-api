/**
 * Bộ soát VÒNG WEBHOOK CHATBOT (20/10/2026): agent gọi công cụ RIÊNG → tra sản phẩm → trả lời. Gemini GIẢ (chặn fetch),
 * CSDL GIẢ — không mạng, không DB.
 *   npx tsx scripts/check-chatbot-webhook.ts
 * Canh: Gemini nhận ĐÚNG 2 công cụ của chatbot (không lọt bộ MCP có giá vốn / khách hàng); kết quả công cụ quay lại
 * đúng định dạng functionResponse; sản phẩm đã tra được gom cho n8n; lỗi công cụ không làm sập lượt trả lời.
 * 21/10 — webhook ĐẦU VÀO / ĐẦU RA (lib/chatbotWebhook.ts): URL đầu ra do người dùng nhập mà MÁY CHỦ gọi ⇒ chặn SSRF
 * (metadata Cloud Run 169.254.169.254, IP nội bộ, dạng viết lách luật); gửi ra có header bí mật, không theo chuyển hướng.
 */
import { chayAgent } from '../src/services/aiAgentRunner'
import { congCuChatbot } from '../src/routes/chatbot'
import { tachCoNhanVien, soanPromptChatbot, DAU_NHAN_VIEN, docTinNhan } from '../src/lib/chatbotKienThuc'
import { laIpNoiBo, kiemUrlDauRa, guiDauRa, kemTheo, taoGoiDauRa, duongVao, laKhoaWebhook, taoKhoaWebhook } from '../src/lib/chatbotWebhook'
import fs from 'fs'
import path from 'path'

let loi = 0
const dung = (ten: string, ok: boolean, chiTiet?: unknown) => {
    if (!ok) loi++
    console.log(`${ok ? '✓' : '✗'} ${ten}${!ok && chiTiet !== undefined ? ' — ' + JSON.stringify(chiTiet).slice(0, 600) : ''}`)
}

const prismaGia = {
    onlineChannel: { findMany: async () => [{ id: 'k1', name: 'Kengi Store', platform: 'tiktok' }] },
    $queryRawUnsafe: async () => [{
        id: 'l1', platform: 'tiktok', tenSan: 'Quạt đứng Sunhouse SHD7346', maSan: 'SHD7346', giaSan: 1350000, tonSan: 4,
        maSpSan: '1729384756102938475', shopSan: 'cipher', hangId: 'p1', tenHang: 'Quạt đứng', maHang: 'SHD7346', giaLe: 1400000,
        tonKho: -2, tonToiThieu: 0, moTa: 'Quạt 8 cánh', thuongHieu: null, nhomHang: 'Quạt', anhHang: null, dongBoLuc: new Date(),
    }],
}

async function main() {
    const goiDi: any[] = []
    const kichBan = [
        { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'tra_cuu_san_pham', args: { query: 'quạt đứng sunhouse' } } }] } }] },
        { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'tra_cuu_kien_thuc', args: { query: 'đổi trả' } } }, { functionCall: { name: 'get_customers', args: {} } }] } }] },
        { candidates: [{ content: { role: 'model', parts: [{ text: `Dạ quạt đứng Sunhouse SHD7346 trên TikTok giá 1.350.000đ, còn hàng ạ.\n${DAU_NHAN_VIEN}` }] } }] },
    ]
    const fetchGoc = globalThis.fetch
    ;(globalThis as any).fetch = async (url: string, init: any) => {
        goiDi.push({ url: String(url), body: JSON.parse(init.body) })
        const tra = kichBan.shift()
        return new Response(JSON.stringify(tra), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    try {
        const sanPham: any[] = []
        const kq = await chayAgent({
            apiKey: 'AIza-gia', systemPrompt: soanPromptChatbot('Kengi Store'), ctx: { prisma: prismaGia, scopes: 'read', storeCode: 'TEST' },
            message: 'quạt đứng sunhouse giá bao nhiêu shop', history: [], maxSteps: 5,
            tools: congCuChatbot('Kengi Store', 'tiktok', [], ds => sanPham.push(...ds)),
        })
        const khaiBao = goiDi[0]?.body?.tools?.[0]?.functionDeclarations?.map((f: any) => f.name)
        dung('Gemini chỉ thấy ĐÚNG 2 công cụ chatbot', JSON.stringify(khaiBao) === JSON.stringify(['tra_cuu_kien_thuc', 'tra_cuu_san_pham']), khaiBao)
        dung('prompt hệ thống là prompt chatbot của shop', String(goiDi[0]?.body?.systemInstruction?.parts?.[0]?.text || '').includes('"Kengi Store"'))
        const traVe = goiDi[1]?.body?.contents?.at(-1)?.parts?.[0]?.functionResponse
        dung('kết quả tra sản phẩm quay lại đúng functionResponse, giá + tình trạng theo sàn',
            traVe?.name === 'tra_cuu_san_pham' && traVe?.response?.result?.status === 'tim_thay'
            && traVe.response.result.san_pham[0].giaTheoSan[0].gia === 1350000 && traVe.response.result.san_pham[0].giaTheoSan[0].tinhTrang === 'sap_het', traVe)
        dung('KHÔNG lộ số tồn / giá vốn cho model', !/tonKho|tonSan|costPrice|"stock"/.test(JSON.stringify(goiDi[1]?.body?.contents)))
        const luot3 = goiDi[2]?.body?.contents?.at(-1)?.parts || []
        dung('công cụ ngoài danh sách (get_customers) bị từ chối, lượt vẫn chạy tiếp',
            luot3.length === 2 && luot3[1]?.functionResponse?.name === 'get_customers' && /không nằm trong danh sách/.test(String(luot3[1]?.functionResponse?.response?.result?.error)), luot3)
        dung('kho kiến thức rỗng ⇒ công cụ trả cần người, không bịa', luot3[0]?.functionResponse?.response?.result?.status === 'knowledge_unavailable')
        const { traLoi, canNhanVien } = tachCoNhanVien(kq.reply)
        dung('câu trả lời sạch dấu + cờ cần nhân viên', canNhanVien && !traLoi.includes(DAU_NHAN_VIEN) && traLoi.includes('1.350.000đ'), traLoi)
        dung('sản phẩm đã tra được gom cho n8n', sanPham.length === 1 && sanPham[0].ma === 'SHD7346' && !('tonKho' in sanPham[0]))
        dung('đủ 3 lượt gọi Gemini, ghi đủ dấu công cụ', goiDi.length === 3 && kq.toolCalls.length === 3 && kq.toolCalls[2].ok === false, kq.toolCalls)
    } finally {
        ;(globalThis as any).fetch = fetchGoc
    }
    await kiemVaoRa()
    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
}
async function kiemVaoRa() {
    // ── chặn SSRF ──
    const dnsGia: any = async (h: string) => (({
        'n8n.kengi.vn': [{ address: '103.130.218.240', family: 4 }], 'noibo.vidu.com': [{ address: '10.0.0.5', family: 4 }],
        'hon.vidu.com': [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], 'v6.vidu.com': [{ address: 'fe80::1', family: 6 }],
    } as any)[h] ?? Promise.reject(new Error('NXDOMAIN')))
    const chan = ['http://localhost:5678/webhook/x', 'http://127.0.0.1/x', 'http://[::1]/x', 'http://[::ffff:127.0.0.1]/x', 'http://[::ffff:a9fe:a9fe]/x',
        'http://169.254.169.254/computeMetadata/v1/', 'http://metadata.google.internal/x', 'http://2130706433/x', 'http://0x7f.1/x', 'http://10.1.2.3/x',
        'http://192.168.1.10:5678/x', 'http://172.20.0.1/x', 'http://100.64.1.1/x', 'http://[fd00::1]/x', 'http://[64:ff9b::7f00:1]/x',
        'http://noibo.vidu.com/x', 'http://hon.vidu.com/x', 'http://v6.vidu.com/x', 'http://n8n/x', 'ftp://n8n.kengi.vn/x', 'http://u:p@n8n.kengi.vn/x',
        'https://khongco.vidu.com/x', '', 'not a url']
    const lot: string[] = []
    for (const u of chan) if (!('loi' in await kiemUrlDauRa(u, dnsGia))) lot.push(u)
    dung('đầu ra: chặn mọi URL nội bộ / metadata / viết lách (hex IPv6, số nguyên, 0x7f.1, NAT64, DNS trỏ nội bộ)', lot.length === 0, lot)
    const qua: string[] = []
    for (const u of ['https://n8n.kengi.vn/webhook/abc', 'http://103.130.218.240:5678/webhook/abc', 'https://[2606:4700::1111]/x'])
        if ('loi' in await kiemUrlDauRa(u, dnsGia)) qua.push(u)
    dung('đầu ra: URL n8n thật (tên miền / IP công khai / IPv6 công khai) đi qua', qua.length === 0, qua)
    dung('IP: công khai không bị chặn, dạng hex của 127.0.0.1 bị chặn', !laIpNoiBo('8.8.8.8') && laIpNoiBo('::ffff:7f00:1') && !laIpNoiBo('2606:4700::1111') && laIpNoiBo('garbage'))

    // ── gửi đầu ra ──
    const goi: any[] = []
    const fetchGia = (kichBan: (number | 'loi')[]) => async (url: string, init: any) => {
        goi.push({ url, init })
        const r = kichBan.shift()
        if (r === 'loi' || r === undefined) throw new Error('mat mang')
        return { ok: r >= 200 && r < 300, status: r }
    }
    const goiDi = taoGoiDauRa({ shop: { id: 'mac-dinh', ten: 'Kengi Store' }, sessionId: 's1', cauHoi: 'quạt giá sao', traLoi: 'Dạ 1.350.000đ ạ', canNhanVien: false, sanPham: [], kemTheo: { senderId: 'u9' } })
    const k1 = await guiDauRa('https://n8n.kengi.vn/webhook/abc', 'khoa-bi-mat', goiDi, { fetchFn: fetchGia([200]), traDns: dnsGia })
    const g0 = goi[0]
    dung('gửi ra: POST JSON + header X-Kengi-Chatbot + KHÔNG theo chuyển hướng + có hạn giờ',
        k1.daGui && g0.init.method === 'POST' && g0.init.headers['X-Kengi-Chatbot'] === 'khoa-bi-mat' && g0.init.redirect === 'manual'
        && !!g0.init.signal && JSON.parse(g0.init.body).kemTheo.senderId === 'u9' && JSON.parse(g0.init.body).traLoi === 'Dạ 1.350.000đ ạ', k1)
    goi.length = 0
    const k2 = await guiDauRa('https://n8n.kengi.vn/webhook/abc', 'k', goiDi, { fetchFn: fetchGia([502, 200]), traDns: dnsGia })
    dung('gửi ra: n8n lỗi 5xx ⇒ thử lại 1 lần rồi được', k2.daGui && goi.length === 2, { k2, lan: goi.length })
    goi.length = 0
    const k3 = await guiDauRa('https://n8n.kengi.vn/webhook/abc', 'k', goiDi, { fetchFn: fetchGia([302]), traDns: dnsGia })
    dung('gửi ra: chuyển hướng ⇒ KHÔNG đi theo, báo rõ', !k3.daGui && goi.length === 1 && /chuyển hướng/.test(k3.loi || ''), k3)
    goi.length = 0
    const k4 = await guiDauRa('https://n8n.kengi.vn/webhook/abc', 'k', goiDi, { fetchFn: fetchGia([404]), traDns: dnsGia })
    dung('gửi ra: 404 ⇒ nhắc bật workflow / dùng Production URL, không thử lại', !k4.daGui && goi.length === 1 && /Production URL/.test(k4.loi || ''), k4)
    goi.length = 0
    const k5 = await guiDauRa('https://n8n.kengi.vn/webhook/abc', 'k', goiDi, { fetchFn: fetchGia(['loi', 'loi']), traDns: dnsGia })
    dung('gửi ra: mất mạng 2 lần ⇒ báo không gửi được, không ném lỗi', !k5.daGui && goi.length === 2 && !!k5.loi, k5)
    goi.length = 0
    const k6 = await guiDauRa('http://169.254.169.254/computeMetadata/v1/', 'k', goiDi, { fetchFn: fetchGia([200]), traDns: dnsGia })
    dung('gửi ra: URL nội bộ ⇒ KHÔNG hề gọi (kiểm lại lúc gửi, DNS có thể đổi)', !k6.daGui && goi.length === 0, k6)

    // ── tin vào / gói ra ──
    const kt = kemTheo({ message: 'x', chatInput: 'y', lichSu: [1], shop: 'a', senderId: 'u1', pageId: 'p1', __proto__: { x: 1 }, to: 'x'.repeat(9000) })
    dung('kèm theo: bỏ tin nhắn / lịch sử / shop, giữ senderId + pageId, cắt phần quá 8 KB', JSON.stringify(Object.keys(kt)) === JSON.stringify(['senderId', 'pageId']), kt)
    dung('kèm theo: thân không phải object ⇒ rỗng', JSON.stringify(kemTheo(null)) === '{}' && JSON.stringify(kemTheo([1, 2])) === '{}' && JSON.stringify(kemTheo('x')) === '{}')
    dung('gói ra: đủ trường, sự kiện chatbot.tra_loi, có giờ', goiDi.suKien === 'chatbot.tra_loi' && goiDi.sessionId === 's1' && !Number.isNaN(Date.parse(goiDi.luc)) && Array.isArray(goiDi.sanPham))
    const vao = docTinNhan({ message: 'còn hàng không', sessionId: 'fb-9', senderId: 'u1' }, false)
    dung('đầu vào: thân KHÔNG cần trường shop (đường dẫn đã chỉ shop)', !('loi' in vao) && vao.cauHoi === 'còn hàng không' && vao.phien === 'fb-9' && 'loi' in docTinNhan({ message: 'x' }))
    const khoa = taoKhoaWebhook()
    dung('đường dẫn đầu vào: mã cửa hàng viết thường + khoá 32 hex; khoá lạ ⇒ null',
        laKhoaWebhook(khoa) && duongVao('KENGISTORE', khoa) === `https://api.kengi.vn/api/chatbot/vao/kengistore/${khoa}`
        && duongVao('KENGISTORE', 'abc') === null && duongVao('../x', khoa) === null && taoKhoaWebhook() !== khoa)

    // ── chốt nguồn ──
    const route = fs.readFileSync(path.join(__dirname, '../src/routes/chatbot.ts'), 'utf8')
    const doanVao = route.slice(route.indexOf("router.post('/vao/:ma/:khoa'"), route.indexOf("router.get('/vao/:ma/:khoa'"))
    dung('đầu vào: không cần đăng nhập, tra theo đường dẫn, gửi ra đầu ra', doanVao.includes('timTheoDuongVao(') && !doanVao.includes('authMiddleware') && doanVao.includes('guiKetQuaRa('))
    const doanTim = route.slice(route.indexOf('async function timTheoDuongVao('), route.indexOf("router.post('/vao/:ma/:khoa'"))
    dung('đầu vào: KHÔNG chạy DDL (tạo / vá bảng) ở đường không đăng nhập', doanTim.length > 100 && !doanTim.includes('damBaoBangChatbot(') && doanTim.includes('try { shop = await timShopTheoKhoa('))
    dung('đầu vào: sai mã cửa hàng hay sai khoá đều MỘT thông báo 404 (chống dò)', (route.match(/SAI_DUONG_VAO/g) || []).length === 3 && !/Không có cửa hàng/.test(doanVao))
    const doanRa = route.slice(route.indexOf("router.put('/shops/:id/webhook'"), route.indexOf("router.post('/shops/:id/webhook/lam-moi'"))
    dung('lưu đầu ra: chỉ quản lý (JWT) + kiểm SSRF TRƯỚC khi lưu', doanRa.includes('shopCuaQuanLy(') && doanRa.indexOf('kiemUrlDauRa(') > -1 && doanRa.indexOf('kiemUrlDauRa(') < doanRa.indexOf('datDauRa('))
    dung('cấu hình webhook (đổi khoá, gửi thử) chỉ qua shopCuaQuanLy', (route.match(/await shopCuaQuanLy\(req, res\)/g) || []).length === 3 && route.includes('if (!chiQuanLy(req, res)) return null'))
    const luu = fs.readFileSync(path.join(__dirname, '../src/lib/chatbotLuuTru.ts'), 'utf8')
    dung('lưu kho kiến thức KHÔNG nhận khoá / URL webhook từ trang (máy chủ tự sinh, COALESCE)',
        luu.includes('"webhookToken" = COALESCE("ChatbotShop"."webhookToken", EXCLUDED."webhookToken")') && !/kiemShopChatbot[\s\S]*webhookRa/.test(fs.readFileSync(path.join(__dirname, '../src/lib/chatbotKienThuc.ts'), 'utf8')))
}

main().catch(e => { console.error('LOI', e); process.exit(1) })
