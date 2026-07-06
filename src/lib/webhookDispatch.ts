// ═══════════════════════════════════════════════════════════════════════════════
// Outbound Webhook Dispatch — đẩy sự kiện hàng hóa/tồn kho ra hệ thống bên thứ 3.
//
// Kiến trúc OUTBOX (đảm bảo giao chắc chắn, có retry):
//   1. enqueue*  → ghi WebhookDelivery(status=pending) trong CÙNG client/transaction
//      với nghiệp vụ gốc. Tx rollback thì delivery cũng rollback → không báo sai.
//   2. cron drain (processWebhookQueue) → POST có ký HMAC, backoff khi lỗi.
//
// TỐI ƯU HOT-PATH: `anyWebhooksExist` là cờ in-memory. Khi CHƯA store nào bật
// webhook (mặc định của cả nền tảng), enqueue tồn kho chỉ tốn 1 phép check boolean
// — không chạm DB. Cron refresh cờ này + Set schema mỗi 30s; route create bật ngay.
// ═══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto'
import { registryPrisma, getStorePrisma, mapWithConcurrency } from './prisma'

type AnyPrisma = any

// ─── Danh mục sự kiện phát ra ────────────────────────────────────────────────
export const WEBHOOK_EVENTS = [
    { type: 'stock.changed', label: 'Thay đổi tồn kho' },
    { type: 'product.created', label: 'Tạo sản phẩm' },
    { type: 'product.updated', label: 'Cập nhật sản phẩm' },
    { type: 'product.deleted', label: 'Xóa sản phẩm' },
    { type: 'customer.created', label: 'Tạo khách hàng' },
    { type: 'customer.updated', label: 'Cập nhật khách hàng' },
    { type: 'customer.deleted', label: 'Xóa khách hàng' },
    { type: 'supplier.created', label: 'Tạo nhà cung cấp' },
    { type: 'supplier.updated', label: 'Cập nhật nhà cung cấp' },
    { type: 'supplier.deleted', label: 'Xóa nhà cung cấp' },
    { type: 'cash_receipt.created', label: 'Tạo phiếu thu' },
    { type: 'cash_receipt.cancelled', label: 'Hủy phiếu thu' },
    { type: 'expense.created', label: 'Tạo phiếu chi' },
    { type: 'expense.cancelled', label: 'Hủy phiếu chi' },
] as const

export const WEBHOOK_EVENT_TYPES = WEBHOOK_EVENTS.map((e) => e.type)

// ─── Fast-path flags (in-memory) ─────────────────────────────────────────────
// Cả nền tảng chưa ai bật webhook → false → hot-path thoát ngay.
let anyWebhooksExist = false
// Chỉ những schema đã biết có endpoint active (skip chính xác khi biết schema).
const schemasWithWebhooks = new Set<string>()

export function markSchemaHasWebhooks(schema: string): void {
    anyWebhooksExist = true
    schemasWithWebhooks.add(schema)
}

// Cờ chốt chặn nhanh: cả nền tảng có store nào bật webhook không. Dùng để tránh
// query thừa ở hot-path (vd decrement tồn kho POS) khi chưa ai dùng webhook.
export function webhooksActive(): boolean {
    return anyWebhooksExist
}

// Lấy tên schema đã stash trên store-client (getStorePrisma set __schema).
// Trong $transaction, tx proxy có thể KHÔNG có __schema → trả undefined, khi đó
// enqueue vẫn chạy đúng (chèn qua chính client) nhưng bỏ qua bước skip-theo-schema.
function schemaOf(client: AnyPrisma): string | undefined {
    return (client as any)?.__schema
}

const RETENTION_MS = 14 * 24 * 60 * 60 * 1000 // dọn log giao cũ > 14 ngày
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000, 86_400_000] // 30s→24h

function sign(secret: string, body: string): string {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
}

// ─── Enqueue lõi ─────────────────────────────────────────────────────────────
// Chèn 1 WebhookDelivery cho MỖI endpoint active có đăng ký eventType. TUYỆT ĐỐI
// không throw — nghiệp vụ gốc (bán/nhập/sửa hàng) không được fail vì webhook.
async function enqueue(client: AnyPrisma, eventType: string, data: any, schema?: string): Promise<void> {
    try {
        if (!anyWebhooksExist) return
        const sc = schema || schemaOf(client)
        if (sc && !schemasWithWebhooks.has(sc)) return

        const endpoints = await client.webhookEndpoint.findMany({
            where: { isActive: true },
            select: { id: true, events: true },
        })
        if (!endpoints.length) return

        const matched = endpoints.filter((e: any) => {
            try {
                const evs: string[] = JSON.parse(e.events || '[]')
                return evs.includes(eventType)
            } catch {
                return false
            }
        })
        if (!matched.length) return

        const timestamp = new Date().toISOString()
        const rows = matched.map((e: any) => ({
            endpointId: e.id,
            eventType,
            payload: JSON.stringify({ event: eventType, data, timestamp }),
            status: 'pending',
            nextRetryAt: new Date(),
        }))
        await client.webhookDelivery.createMany({ data: rows })
    } catch {
        // Bảng chưa migrate ở schema cũ, hoặc lỗi bất kỳ — nuốt, không chặn nghiệp vụ.
    }
}

// ─── Wrappers công khai ──────────────────────────────────────────────────────
export async function emitStockChanged(
    client: AnyPrisma,
    payload: { productId: string; sku?: string | null; name?: string | null; branchId?: string | null; delta: number; stock: number; reason?: string },
    schema?: string,
): Promise<void> {
    if (!anyWebhooksExist) return // chốt chặn nhanh nhất cho POS
    await enqueue(client, 'stock.changed', payload, schema)
}

export async function emitProductEvent(
    client: AnyPrisma,
    eventType: 'product.created' | 'product.updated' | 'product.deleted',
    product: any,
    schema?: string,
): Promise<void> {
    if (!anyWebhooksExist) return
    const data = {
        id: product?.id,
        sku: product?.sku ?? null,
        name: product?.name ?? null,
        price: product?.price ?? null,
        stock: product?.stock ?? null,
        categoryId: product?.categoryId ?? null,
        brandId: product?.brandId ?? null,
        barcode: product?.barcode ?? null,
        isActive: product?.isActive ?? null,
    }
    await enqueue(client, eventType, data, schema)
}

// Generic: phát 1 sự kiện với payload tự xây ở call site (khách hàng, NCC, phiếu
// thu/chi...). Guard nhanh + không throw. Fire-and-forget được (ngoài tx) hoặc
// await (trong tx).
export async function emitEntityEvent(
    client: AnyPrisma,
    eventType: string,
    data: any,
    schema?: string,
): Promise<void> {
    if (!anyWebhooksExist) return
    await enqueue(client, eventType, data, schema)
}

// ─── Refresh cờ fast-path + dọn log cũ (chạy định kỳ bởi cron) ────────────────
export async function refreshWebhookRegistry(): Promise<void> {
    try {
        const stores = await registryPrisma.store.findMany({ where: { status: 'active' }, select: { schema: true } })
        let any = false
        const live = new Set<string>()
        await mapWithConcurrency(stores, async (s: any) => {
            try {
                const sp = getStorePrisma(s.schema)
                const count = await sp.webhookEndpoint.count({ where: { isActive: true } })
                if (count > 0) {
                    any = true
                    live.add(s.schema)
                    // Dọn log giao đã kết thúc, cũ hơn RETENTION (best-effort)
                    await sp.webhookDelivery.deleteMany({
                        where: { status: { in: ['success', 'dead'] }, createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
                    }).catch(() => { })
                }
            } catch {
                // schema chưa có bảng webhook — bỏ qua
            }
        })
        anyWebhooksExist = any
        schemasWithWebhooks.clear()
        for (const s of live) schemasWithWebhooks.add(s)
    } catch {
        // registry lỗi tạm — giữ nguyên cờ cũ
    }
}

// ─── Xử lý hàng đợi giao (drain) ─────────────────────────────────────────────
let processing = false

export async function processWebhookQueue(): Promise<void> {
    if (processing) return
    processing = true
    try {
        const schemas = Array.from(schemasWithWebhooks)
        await mapWithConcurrency(schemas, async (schema) => {
            try {
                const sp = getStorePrisma(schema)
                await drainStore(sp)
            } catch {
                // bỏ qua store lỗi
            }
        }, 4)
    } finally {
        processing = false
    }
}

// Gửi thẳng hàng đợi của 1 store (dùng cho nút Test / gửi ngay sau khi tạo).
export async function drainStoreBySchema(schema: string): Promise<void> {
    try {
        await drainStore(getStorePrisma(schema))
    } catch { /* ignore */ }
}

async function drainStore(sp: AnyPrisma): Promise<void> {
    const now = new Date()
    // Lấy các delivery đến hạn (pending/failed và nextRetryAt <= now)
    const due = await sp.webhookDelivery.findMany({
        where: {
            status: { in: ['pending', 'failed'] },
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
    }).catch(() => [])
    if (!due.length) return

    // Claim: đánh dấu 'sending' để lần drain chồng lấn không gửi trùng.
    const ids = due.map((d: any) => d.id)
    await sp.webhookDelivery.updateMany({ where: { id: { in: ids } }, data: { status: 'sending' } }).catch(() => { })

    // Cache endpoint theo id để lấy url/secret
    const endpointIds = Array.from(new Set(due.map((d: any) => d.endpointId)))
    const endpoints = await sp.webhookEndpoint.findMany({ where: { id: { in: endpointIds } } }).catch(() => [])
    const epById = new Map<string, any>(endpoints.map((e: any) => [e.id, e]))

    await mapWithConcurrency(due, async (d: any) => {
        const ep = epById.get(d.endpointId)
        if (!ep) {
            // endpoint đã xóa → bỏ delivery
            await sp.webhookDelivery.update({ where: { id: d.id }, data: { status: 'dead', lastError: 'endpoint removed' } }).catch(() => { })
            return
        }
        const attempt = (d.attempts || 0) + 1
        const result = await deliver(ep, d)
        if (result.ok) {
            await sp.webhookDelivery.update({
                where: { id: d.id },
                data: { status: 'success', attempts: attempt, responseCode: result.code, deliveredAt: new Date(), lastError: null },
            }).catch(() => { })
            await sp.webhookEndpoint.update({
                where: { id: ep.id },
                data: { failureCount: 0, lastStatus: `✅ ${result.code}`, lastFiredAt: new Date() },
            }).catch(() => { })
        } else {
            const dead = attempt >= (d.maxAttempts || 6)
            const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]
            await sp.webhookDelivery.update({
                where: { id: d.id },
                data: {
                    status: dead ? 'dead' : 'failed',
                    attempts: attempt,
                    responseCode: result.code || null,
                    lastError: (result.error || '').slice(0, 500),
                    nextRetryAt: dead ? null : new Date(Date.now() + delay),
                },
            }).catch(() => { })
            await sp.webhookEndpoint.update({
                where: { id: ep.id },
                data: { failureCount: { increment: 1 }, lastStatus: `❌ ${result.code || result.error || 'lỗi'}`.slice(0, 120), lastFiredAt: new Date() },
            }).catch(() => { })
        }
    }, 6)
}

async function deliver(ep: any, d: any): Promise<{ ok: boolean; code?: number; error?: string }> {
    const body = d.payload as string
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
        const res = await fetch(ep.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Kengi-Webhook/1.0',
                'X-Webhook-Event': d.eventType,
                'X-Webhook-Id': d.id,
                'X-Webhook-Timestamp': new Date().toISOString(),
                'X-Webhook-Signature': sign(ep.secret, body),
            },
            body,
            signal: controller.signal,
        })
        if (res.status >= 200 && res.status < 300) return { ok: true, code: res.status }
        return { ok: false, code: res.status, error: `HTTP ${res.status}` }
    } catch (err: any) {
        return { ok: false, error: err?.name === 'AbortError' ? 'timeout 10s' : String(err?.message || err) }
    } finally {
        clearTimeout(timer)
    }
}
