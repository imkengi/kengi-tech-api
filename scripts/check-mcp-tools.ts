/**
 * KIỂM TRA BỘ TOOL MCP  —  chạy: npm run check:mcp
 *
 * Vì sao cần: `TOOLS` được DÙNG CHUNG bởi 2 nơi
 *   1. MCP server (/api/mcp) cho agent ngoài
 *   2. Trợ lý AI trong dashboard (/api/mcp-agent, Gemini)
 * Gemini nhận CẢ MẢNG function declarations trong một lần — chỉ cần MỘT tool
 * sinh schema sai là Gemini từ chối hết, trợ lý chết toàn bộ chứ không riêng
 * tool đó. Lỗi này không lộ ra lúc build hay lúc gọi /api/mcp, chỉ hiện khi
 * người dùng mở trợ lý. Script này bắt trước khi deploy.
 *
 * Thoát mã 1 nếu có lỗi → cắm được vào CI hoặc chạy tay trước khi deploy.
 */

import { TOOLS } from '../src/routes/mcp'
import { toGeminiSchema } from '../src/lib/geminiSchema'

const KIEU_HOP_LE = new Set(['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT'])
// Gemini không nhận các khoá JSON-Schema này; sót lại là bị từ chối
const KHOA_CAM = ['additionalProperties', '$schema', 'oneOf', 'anyOf', 'allOf', 'const', 'patternProperties']

type Loi = { tool: string; duong: string; vanDe: string }
const loi: Loi[] = []

function soiSchema(tool: string, duong: string, n: any): void {
    if (n === null || typeof n !== 'object') {
        loi.push({ tool, duong: duong || '(gốc)', vanDe: 'node không phải object' })
        return
    }
    for (const k of KHOA_CAM) {
        if (k in n) loi.push({ tool, duong: duong || '(gốc)', vanDe: `còn sót khoá Gemini không nhận: ${k}` })
    }
    if (!KIEU_HOP_LE.has(n.type)) {
        loi.push({ tool, duong: duong || '(gốc)', vanDe: `type không hợp lệ: ${JSON.stringify(n.type)}` })
    }
    if (n.type === 'ARRAY') {
        if (!n.items) loi.push({ tool, duong: duong || '(gốc)', vanDe: 'ARRAY thiếu items' })
        else soiSchema(tool, `${duong}[]`, n.items)
    }
    if (n.type === 'OBJECT') {
        const props = n.properties || {}
        for (const r of n.required || []) {
            if (!(r in props)) loi.push({ tool, duong: duong || '(gốc)', vanDe: `required "${r}" không có trong properties` })
        }
        for (const [k, v] of Object.entries(props)) soiSchema(tool, duong ? `${duong}.${k}` : k, v)
    }
    if (n.enum !== undefined && (!Array.isArray(n.enum) || n.type !== 'STRING')) {
        loi.push({ tool, duong: duong || '(gốc)', vanDe: `enum chỉ hợp lệ với STRING, đang là ${n.type}` })
    }
}

// ─── 1. Bản thân định nghĩa tool ─────────────────────────────────────────────
const ten = TOOLS.map(t => t.name)
for (const t of TOOLS) {
    if (!t.name || !/^[a-z][a-z0-9_]*$/.test(t.name)) loi.push({ tool: t.name || '(không tên)', duong: '-', vanDe: 'tên tool phải là snake_case' })
    if (!t.description || t.description.length < 10) loi.push({ tool: t.name, duong: '-', vanDe: 'thiếu description tử tế (agent chọn tool dựa vào đây)' })
    if (typeof t.run !== 'function') loi.push({ tool: t.name, duong: '-', vanDe: 'thiếu hàm run()' })
    if (!t.inputSchema) loi.push({ tool: t.name, duong: '-', vanDe: 'thiếu inputSchema' })
}
const trung = ten.filter((n, i) => ten.indexOf(n) !== i)
for (const n of new Set(trung)) loi.push({ tool: n, duong: '-', vanDe: 'tên tool bị TRÙNG' })

// ─── 2. Chuyển sang schema Gemini ────────────────────────────────────────────
for (const t of TOOLS) {
    if (!t.inputSchema) continue
    try {
        soiSchema(t.name, '', toGeminiSchema(t.inputSchema))
    } catch (e: any) {
        loi.push({ tool: t.name, duong: '-', vanDe: `toGeminiSchema ném lỗi: ${e?.message}` })
    }
}

// ─── Kết quả ─────────────────────────────────────────────────────────────────
const soFanpage = ten.filter(n => n.startsWith('fanpage_')).length
if (loi.length) {
    console.error(`\n❌ ${loi.length} vấn đề trong ${TOOLS.length} tool MCP:\n`)
    for (const l of loi) console.error(`   • [${l.tool}] ${l.duong} — ${l.vanDe}`)
    console.error('\nSửa xong hãy deploy: một schema hỏng làm Gemini từ chối CẢ mảng → chết trợ lý AI dashboard.\n')
    process.exit(1)
}
console.log(`✅ ${TOOLS.length} tool MCP hợp lệ (${TOOLS.length - soFanpage} bán lẻ + ${soFanpage} fanpage), schema Gemini chuyển đổi sạch.`)
