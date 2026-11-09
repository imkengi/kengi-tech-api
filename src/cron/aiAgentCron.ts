// ═══════════════════════════════════════════════════════════════════════════════
//  AI AGENT CRON — đánh thức trợ lý theo lịch để nó TỰ làm việc
//
//  Mỗi 5 phút: tìm job tới hạn (nextRunAt <= bây giờ) ở các store CÓ job
//  (cờ registry hasAiJobs — không quét toàn bộ store, tránh cạn kết nối Prisma
//  như bài học của fanpageCron), chạy vòng agent, ghi AiAgentRun.
//
//  AN TOÀN: job mặc định CHỈ ĐỌC. Muốn ghi phải bật allowWrite; riêng tool đẩy
//  ra ngoài (đăng bài, trả lời khách, lên đơn, thu nợ) còn phải gọi đích danh
//  trong allowedTools — xem TOOL_NHAY_CAM ở services/aiAgentRunner.
// ═══════════════════════════════════════════════════════════════════════════════

import { registryPrisma, getStorePrisma, giuClient } from '../lib/prisma'
import { chayNeuLanhDao } from '../lib/leaderLock'
import { chayAgent, LoiGeminiHetTien } from '../services/aiAgentRunner'
import { TOOLS } from '../routes/mcp'
import { tinhLanChayKe, SYSTEM_PROMPT_TU_DONG } from '../services/aiAgentSchedule'
import { ToolCtx } from '../lib/mcpTypes'
import { layKeyAi } from '../lib/keyAi'
import { chayTheoLich as chayShopeePilotTheoLich } from '../lib/shopeePilot'
import { chayTheoLichFb, soatBaiHenSapLen, sqlDemBaiHenSapLen, laThieuBang } from '../lib/facebookPilot'
import { chayTheoLichAds } from '../lib/facebookAdsPilot'
import { chayTheoLichTikTok } from '../lib/tiktokPilot'
import { docTienIch, TIEN_ICH_SHOPEE_PILOT, TIEN_ICH_FACEBOOK_PILOT, TIEN_ICH_TIKTOK_PILOT } from '../lib/tienIchCuaHang'

const CHU_KY = 5 * 60 * 1000            // quét mỗi 5 phút
const TRAN_JOB_MOI_LUOT = 5             // tối đa 5 job/store mỗi lượt, tránh nghẽn

/* Gemini QUÁ TẢI TẠM THỜI (30/09/2026 đã gặp 503 "high demand") mà cứ hẹn lượt kế theo
 * lịch thì job "mỗi sáng 7:00" mất trắng cả ngày. Hẹn lại sau 15 phút, tối đa 6 lần LIÊN
 * TIẾP (~1,5 giờ) — đếm bằng lịch sử AiAgentRun, không cần thêm cột. */
const THU_LAI_SAU_MS = 15 * 60_000
const TOI_DA_THU_LAI = 6
const DAU_THU_LAI = 'Tạm thời — tự thử lại lúc'
const gioVNNgan = (d: Date) => d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })

let timer: NodeJS.Timeout | null = null
let dangChay = false

/** Chọn 1 user làm "người thực hiện" cho tool ghi (Transaction.createdBy là FK bắt buộc). */
async function layActor(storePrisma: any): Promise<{ id?: string; name?: string; branchId?: string | null }> {
    const u = await storePrisma.user.findFirst({
        where: { role: { in: ['admin', 'owner', 'superadmin'] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, branchId: true },
    }).catch(() => null)
    return u ? { id: u.id, name: u.name || 'Trợ lý AI', branchId: u.branchId ?? null } : {}
}

/** Chạy 1 job, ghi lại toàn bộ dấu vết. Không ném lỗi ra ngoài. */
export async function chayMotJob(
    storePrisma: any,
    job: any,
    storeCode: string,
    trigger: 'cron' | 'manual' = 'cron',
): Promise<{ runId: string; status: string }> {
    const run = await storePrisma.aiAgentRun.create({
        data: { jobId: job.id, status: 'running', trigger },
    })

    let status = 'ok'
    let summary: string | null = null
    let errorMessage: string | null = null
    let toolCalls: any[] = []
    let steps = 0
    let chamTran = false
    let henThuLai: Date | null = null

    try {
        const key = await layKeyAi(storePrisma)
        if (!key.gemini && !key.deepseek) throw new Error('Chưa cấu hình key AI — nhập key Gemini (và key DeepSeek dự phòng) ở mục AI & MCP')

        const actor = await layActor(storePrisma)
        const ctx: ToolCtx = {
            prisma: storePrisma,
            scopes: job.allowWrite ? 'read,write' : 'read',
            storeCode,
            userId: actor.id,
            userName: actor.name || 'Trợ lý AI (tự động)',
            branchId: actor.branchId ?? null,
            // actor là admin đầu tiên (cho FK createdBy) — sổ ghi Shopee Pilot cần biết TÁC VỤ nào làm, không phải admin đó
            nguon: `tác vụ "${String(job.name || job.id).slice(0, 80)}"${trigger === 'manual' ? ' (chạy tay)' : ''}`,
        }

        let allowed: string[] = []
        try { allowed = JSON.parse(job.allowedTools || '[]') } catch { allowed = [] }

        const kq = await chayAgent({
            apiKey: key.gemini,
            deepseekKey: key.deepseek,
            systemPrompt: SYSTEM_PROMPT_TU_DONG,
            ctx,
            /* Agent không có đồng hồ: không nói "bây giờ" thì nó đoán ngày (thường sai năm),
             * và việc cần giờ cụ thể — như hẹn giờ đăng bài — sẽ lệch. Giờ VN vì chỉ thị
             * của chủ shop ("8 giờ sáng mai") là giờ VN. */
            message: `[Thời điểm chạy: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} (giờ VN, ISO ${new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16)}+07:00)]\n${job.prompt}`,
            maxSteps: job.maxSteps || 8,
            allowWrite: !!job.allowWrite,
            allowedTools: allowed,
        })
        /* Lượt chạy bằng DeepSeek thì NÓI RA — chủ shop cần biết Gemini đang hết hạn mức. */
        summary = kq.doiSangDeepSeek ? `${kq.reply}\n\n(Chạy bằng DeepSeek dự phòng — ${kq.doiSangDeepSeek.slice(0, 200)})` : kq.reply
        toolCalls = kq.toolCalls
        steps = kq.steps
        chamTran = kq.chamTran
    } catch (e: any) {
        status = 'error'
        errorMessage = e?.message || String(e)
        // Hỏng giữa chừng: giữ dấu vết những tool ĐÃ chạy (runner gắn vào lỗi)
        if (Array.isArray(e?.toolCalls)) toolCalls = e.toolCalls
        if (typeof e?.steps === 'number') steps = e.steps
        /* Lượt đã GHI dữ liệu (soạn/duyệt/lên lịch bài…) thì tuyệt đối không tự chạy lại:
         * chạy lại cả chỉ thị là soạn trùng bài. Để người đọc kết quả rồi quyết. */
        const daGhi = toolCalls.some(tc => tc.ok && TOOLS.find(t => t.name === tc.name)?.write)
        /* Key Gemini HẾT TIỀN (lớp con của lỗi tạm thời, để có DeepSeek thì chuyển): 15 phút sau vẫn hết — không hẹn lại,
         * không ghi "Tạm thời"; câu lỗi đã bảo nạp tiền / đổi key, lượt kế theo lịch thường. */
        if (e?.tamThoi && !(e instanceof LoiGeminiHetTien) && trigger === 'cron' && !daGhi) {
            const truoc: any[] = await storePrisma.aiAgentRun.findMany({
                where: { jobId: job.id, id: { not: run.id } },
                orderBy: { startedAt: 'desc' }, take: TOI_DA_THU_LAI,
                select: { status: true, errorMessage: true },
            }).catch(() => [])
            let lienTiep = 0
            for (const r of truoc) {
                if (r.status === 'error' && String(r.errorMessage || '').startsWith(DAU_THU_LAI)) lienTiep++
                else break
            }
            if (lienTiep < TOI_DA_THU_LAI) {
                henThuLai = new Date(Date.now() + THU_LAI_SAU_MS)
                errorMessage = `${DAU_THU_LAI} ${gioVNNgan(henThuLai)} (lần ${lienTiep + 1}/${TOI_DA_THU_LAI}). ${errorMessage}`
            }
        }
        if (daGhi) errorMessage += ' — Lượt này ĐÃ làm một phần (xem các công cụ đã gọi) nên KHÔNG tự chạy lại, tránh làm trùng.'
        console.error(`[AiAgentCron] job "${job.name}" (${storeCode}) lỗi:`, errorMessage)
    }

    await storePrisma.aiAgentRun.update({
        where: { id: run.id },
        data: {
            finishedAt: new Date(), status, summary, errorMessage,
            toolCalls: JSON.stringify(toolCalls).slice(0, 60_000), steps, chamTran,
        },
    }).catch(() => { })

    // Hẹn lượt kế TỪ BÂY GIỜ (không cộng dồn từ nextRunAt cũ) — server ngủ vài
    // tiếng rồi tỉnh dậy sẽ không bắn bù một loạt lượt đã lỡ.
    const theoLich = tinhLanChayKe(job, new Date())
    await storePrisma.aiAgentJob.update({
        where: { id: job.id },
        // Hẹn thử lại chỉ khi SỚM hơn lượt theo lịch (job lặp mỗi 10 phút thì cứ theo lịch)
        data: { lastRunAt: new Date(), nextRunAt: henThuLai && henThuLai < theoLich ? henThuLai : theoLich },
    }).catch(() => { })

    return { runId: run.id, status }
}

/**
 * GIÀNH một job NGUYÊN TỬ trước khi chạy: dời nextRunAt ra 30 phút, chỉ bản nào dời được
 * (đúng giá trị nextRunAt vừa đọc) mới chạy; chạy xong chayMotJob đặt lại lịch thật.
 * Khoá lãnh đạo (chayNeuLanhDao) cần Redis — prod KHÔNG có REDIS_URL nên khoá đó cho qua
 * hết; thêm nhịp Cloud Scheduler mỗi phút rơi vào bản máy khác là chạy ĐÚP job = soạn trùng
 * bài. Chết giữa chừng thì 30 phút sau job tự tới hạn lại.
 */
export async function gianhJob(sp: any, job: { id: string; nextRunAt: Date | null }): Promise<boolean> {
    const r = await sp.aiAgentJob.updateMany({
        where: { id: job.id, nextRunAt: job.nextRunAt },
        data: { nextRunAt: new Date(Date.now() + 30 * 60_000) },
    })
    return r.count === 1
}

/* ── SOÁT BÀI HẸN FACEBOOK PILOT SẮP LÊN (09/11/2026) ──
 * Pilot giao bài HẸN GIỜ cho Facebook trước tới 3 ngày; lib/facebookPilot.soatBaiHenSapLen soát lại tồn / giá trong 1 giờ trước
 * giờ lên và RÚT bài sai. PHẢI chạy cả đêm ⇒ đi nhịp ngoài (quetTuNgoai, mỗi phút) và chạy TRƯỚC chốt `dangChay`: một lượt quet()
 * dài (tác vụ AI, chu kỳ Pilot) không được chặn bước rút bài sắp lên. KHÔNG theo cờ hasAiJobs (cờ đó chỉ bật khi BẬT LỊCH Pilot —
 * cửa hàng chạy Tự động bằng tay vẫn có bài hẹn): duyệt mọi cửa hàng đang hoạt động có tiện ích facebook_pilot, dò bằng kết nối
 * REGISTRY (sqlDemBaiHenSapLen, một câu COUNT) — không có bài hẹn nào của Pilot trong cửa sổ thì KHÔNG mở client riêng của cửa hàng
 * (client bị chạm mỗi phút thì không bao giờ được thải; cả cụm chỉ ~45 kết nối). Có thì giữ client (giuClient) và soát tuần tự.
 * Nhiều bản máy cùng soát được — mỗi bài giành bằng CAS trên dòng kế hoạch; chốt `dangSoatFb` + giãn 50 giây chỉ để một bản máy
 * không tự chạy chồng / chạy hai lần trong một phút. quet() (setInterval 5 phút) chỉ gọi làm lưới phụ khi nhịp ngoài IM ≥ 3 phút:
 * setInterval chạy cả đêm nhưng ngoài request bị hãm CPU — lượt soát nó mở có thể treo giữa chừng, giữ chốt dangSoatFb khiến
 * nhịp ngoài kế tiếp 'bo-qua'.
 */
let dangSoatFb = false
let soatFbLuc = 0
let nhipNgoaiLuc = 0 // lần cuối nhịp ngoài (quetTuNgoai) gọi tới bản máy này
export async function nhipSoatBaiHenFb(): Promise<string> {
    if (dangSoatFb || Date.now() - soatFbLuc < 50_000) return 'bo-qua'
    dangSoatFb = true
    soatFbLuc = Date.now()
    const ra: string[] = []
    try {
        const stores = await registryPrisma.store.findMany({ where: { status: 'active' }, select: { code: true, schema: true, addOns: true } })
        for (const store of stores) {
            if (!docTienIch(store.addOns).includes(TIEN_ICH_FACEBOOK_PILOT)) continue
            let n = 0
            try {
                const dem: any[] = await registryPrisma.$queryRawUnsafe(sqlDemBaiHenSapLen(String(store.schema || '')))
                n = Number(dem[0]?.n) || 0
            } catch (e: any) {
                // chưa từng dùng Facebook Pilot (bảng kế hoạch chưa có) ⇒ không có gì để soát; lỗi khác PHẢI kêu — im là nhịp chết hẳn
                if (!laThieuBang(e)) console.error(`[FacebookPilot] soát bài hẹn ${store.code} — câu dò hỏng:`, e?.message || e)
                continue
            }
            if (!n) continue
            const nha = giuClient(store.schema)
            try {
                const kq = await soatBaiHenSapLen(getStorePrisma(store.schema))
                const lam = kq.viec.filter(v => v.ketCuc !== 'giu_nguyen')
                if (lam.length) console.log(`[FacebookPilot] soát bài hẹn ${store.code}: ${lam.map(v => `${v.sku || v.planId} → ${v.ketCuc}`).join(', ')}`)
                ra.push(`${store.code}:${kq.daXet}/${lam.length}`)
            } catch (e: any) {
                console.error(`[FacebookPilot] soát bài hẹn ${store.code}:`, e?.message || e)
                ra.push(`${store.code}:loi`)
            } finally {
                nha()
            }
        }
    } catch (e: any) {
        console.error('[FacebookPilot] soát bài hẹn — đọc danh sách cửa hàng hỏng:', e?.message || e)
        return 'loi'
    } finally {
        dangSoatFb = false
    }
    return ra.join(' ') || 'khong-co'
}

/** Nhịp do Cloud Scheduler gọi qua POST /api/cron/tick (routes/cronTick.ts) — chạy TRONG
 *  request nên có CPU. Lượt đang chạy dở trên bản máy này thì bỏ qua. */
export async function quetTuNgoai(): Promise<boolean> {
    // soát bài hẹn Facebook Pilot TRƯỚC chốt dangChay — lượt quet() dài không được chặn bước rút bài sắp lên (09/11/2026)
    nhipNgoaiLuc = Date.now()
    await nhipSoatBaiHenFb().catch((e: any) => console.error('[FacebookPilot] soát bài hẹn:', e?.message || e))
    if (dangChay) return false
    return chayNeuLanhDao('ai-agent', CHU_KY - 30_000, quet)
}

async function quet(): Promise<void> {
    if (dangChay) return          // lượt trước chưa xong (job có thể chạy lâu) → bỏ lượt này
    dangChay = true
    try {
        // lưới phụ khi nhịp ngoài im ≥ 3 phút (Cloud Scheduler hụt) — nhịp ngoài còn sống thì để nó lo (xem khối chú thích nhipSoatBaiHenFb)
        if (Date.now() - nhipNgoaiLuc > 3 * 60_000) await nhipSoatBaiHenFb().catch((e: any) => console.error('[FacebookPilot] soát bài hẹn:', e?.message || e))
        const stores = await registryPrisma.store.findMany({
            where: { status: 'active', hasAiJobs: true } as any,
        }) as any[]
        for (const store of stores) {
            try {
                const sp = getStorePrisma(store.schema)
                const jobs = await sp.aiAgentJob.findMany({
                    where: { enabled: true, nextRunAt: { lte: new Date() } },
                    orderBy: { nextRunAt: 'asc' },
                    take: TRAN_JOB_MOI_LUOT,
                })
                for (const job of jobs) {
                    if (!await gianhJob(sp, job)) continue   // bản máy khác vừa giành — không chạy đúp
                    console.log(`[AiAgentCron] ▶ ${store.code}/${job.name}`)
                    const r = await chayMotJob(sp, job, store.code, 'cron')
                    console.log(`[AiAgentCron] ✔ ${store.code}/${job.name} → ${r.status}`)
                }
            } catch (e: any) {
                // Store chưa migrate bảng AiAgentJob → bỏ qua êm
                if (!/does not exist|AiAgentJob/i.test(e?.message || '')) {
                    console.error(`[AiAgentCron] store ${store.code}:`, e?.message)
                }
            }
            /* SHOPEE PILOT chạy theo lịch (01/11/2026) — cùng nhịp, cùng cờ hasAiJobs (Pilot bật lịch thì bật cờ).
             * CHỈ cửa hàng được quản trị bật tiện ích shopee_pilot (lib/tienIchCuaHang): tắt ở admin là lịch thôi
             * chạy, cấu hình lịch vẫn giữ nguyên để bật lại là chạy tiếp. addOns có sẵn trên dòng registry vừa đọc.
             * Cửa hàng không dùng Pilot: một truy vấn hỏng-êm, không tạo bảng hộ. */
            if (docTienIch(store.addOns).includes(TIEN_ICH_SHOPEE_PILOT)) {
                // giữ client suốt lượt (03/11/2026: chu kỳ giờ tự đồng bộ danh mục + chạy mọi gian — có thể vài phút; lý do xem giuClient)
                const nha = giuClient(store.schema)
                try {
                    const kq = await chayShopeePilotTheoLich(getStorePrisma(store.schema))
                    if (kq === 'da-chay' || kq === 'loi') console.log(`[ShopeePilot] lịch ${store.code}: ${kq}`)
                } catch (e: any) {
                    console.error(`[ShopeePilot] lịch ${store.code}:`, e?.message || e)
                } finally {
                    nha()
                }
            }
            /* FACEBOOK PILOT theo lịch (02/11/2026) — cùng luật: chỉ cửa hàng được quản trị bật facebook_pilot. */
            if (docTienIch(store.addOns).includes(TIEN_ICH_FACEBOOK_PILOT)) {
                try {
                    const kq = await chayTheoLichFb(getStorePrisma(store.schema))
                    if (kq === 'da-chay' || kq === 'loi') console.log(`[FacebookPilot] lịch ${store.code}: ${kq}`)
                } catch (e: any) {
                    console.error(`[FacebookPilot] lịch ${store.code}:`, e?.message || e)
                }
            }
            /* ADS PILOT theo lịch (05/11/2026) — quảng cáo trong Facebook Pilot, cùng tiện ích facebook_pilot; lịch TẮT mặc định.
             * Giữ client suốt lượt: chu kỳ đọc Facebook (chiến dịch, số liệu, bài) xen truy vấn kho — có thể vài chục giây. */
            if (docTienIch(store.addOns).includes(TIEN_ICH_FACEBOOK_PILOT)) {
                const nha = giuClient(store.schema)
                try {
                    const kq = await chayTheoLichAds(getStorePrisma(store.schema))
                    if (kq === 'da-chay' || kq === 'loi') console.log(`[AdsPilot] lịch ${store.code}: ${kq}`)
                } catch (e: any) {
                    console.error(`[AdsPilot] lịch ${store.code}:`, e?.message || e)
                } finally {
                    nha()
                }
            }
            /* TIKTOK PILOT theo lịch (02/11/2026) — cùng luật: chỉ cửa hàng được quản trị bật tiktok_pilot. */
            if (docTienIch(store.addOns).includes(TIEN_ICH_TIKTOK_PILOT)) {
                const nha = giuClient(store.schema)
                try {
                    const kq = await chayTheoLichTikTok(getStorePrisma(store.schema))
                    if (kq === 'da-chay' || kq === 'loi') console.log(`[TikTokPilot] lịch ${store.code}: ${kq}`)
                } catch (e: any) {
                    console.error(`[TikTokPilot] lịch ${store.code}:`, e?.message || e)
                } finally {
                    nha()
                }
            }
        }
    } catch (e: any) {
        console.error('[AiAgentCron] Fatal:', e?.message)
    } finally {
        dangChay = false
    }
}

export function startAiAgentCron(): void {
    if (timer) return
    console.log(`⏰ AI agent cron started (every ${CHU_KY / 60000} minutes)`)
    // Trễ 90s để không đụng đợt khởi động cùng các cron khác
    // Chỉ một bản chạy mỗi nhịp — job AI có nextRunAt riêng nên chạy trùng trên
    // 2–3 bản là nguy cơ chạy job đúp, ngoài chuyện đốt kết nối (19/08/2026)
    const chay = () => chayNeuLanhDao('ai-agent', CHU_KY - 30_000, quet)
    setTimeout(() => { chay(); timer = setInterval(chay, CHU_KY) }, 90_000)
}

export function stopAiAgentCron(): void {
    if (timer) { clearInterval(timer); timer = null; console.log('⏰ AI agent cron stopped') }
}
