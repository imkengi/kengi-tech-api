/**
 * Bộ soát VÒNG WEBHOOK CHATBOT (20/10/2026): agent gọi công cụ RIÊNG → tra sản phẩm → trả lời. Gemini GIẢ (chặn fetch),
 * CSDL GIẢ — không mạng, không DB.
 *   npx tsx scripts/check-chatbot-webhook.ts
 * Canh: Gemini nhận ĐÚNG 2 công cụ của chatbot (không lọt bộ MCP có giá vốn / khách hàng); kết quả công cụ quay lại
 * đúng định dạng functionResponse; sản phẩm đã tra được gom cho n8n; lỗi công cụ không làm sập lượt trả lời.
 */
import { chayAgent } from '../src/services/aiAgentRunner'
import { congCuChatbot } from '../src/routes/chatbot'
import { tachCoNhanVien, soanPromptChatbot, DAU_NHAN_VIEN } from '../src/lib/chatbotKienThuc'

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
    console.log(loi ? `\n✗ ${loi} ca SAI` : '\n✓ Tất cả ca đều đúng')
    process.exit(loi ? 1 : 0)
}
main().catch(e => { console.error('LOI', e); process.exit(1) })
