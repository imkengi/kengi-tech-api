/**
 * check-hang-cho-proxy — hàng chờ gọi proxy Tino + nghỉ lịch nền khi vừa mất CSDL (17/11/2026).
 *
 * Bệnh (đo log 16/11/2026): ~140 push Shopee dồn 5 giây vào MỘT bản Cloud Run, mỗi push gọi ngược Shopee qua proxy
 * Tino NGAY ⇒ Tino chặn IP bản đó ~6 giờ (770 "fetch failed" liền), 804 push bỏ cuộc vì lỗi NGẮT MẠCH (lệnh chưa
 * hề gửi) vẫn bị tính là một lần thử. Cùng gốc: bản phụ bị cắt CPU vẫn chạy lịch nền ⇒ hàng nghìn P1001/ngày.
 *
 *  A. goiQuaProxy: ≤ PROXY_DONG_THOI_TOI_DA cùng lúc, theo thứ tự tới, lỗi vẫn trả chỗ, ngắt mạch mở trong lúc chờ
 *     ⇒ hỏng NGAY (cờ ngatMachProxy + chuaGui), việc KHÔNG chạy; không rò chỗ.
 *  B. laLoiNgatMachProxy: nhận cả khi bị bọc thành chuỗi khác; "fetch failed" thì KHÔNG (ca phải im).
 *  C. docHetPhanHoi giữ nguyên byte / status / header; 204 không vỡ.
 *  D. ShopeeService (fetch giả qua proxy): trần đồng thời giữ đúng; ngắt mạch ⇒ không gọi, không thử lại, không đếm thêm.
 *  E. Lazada dùng CHUNG hàng với Shopee (cùng một hosting Tino).
 *  F. trangThaiCsdl: cửa sổ nghỉ, tốt lại ngay khi truy vấn được, đang có request ⇒ không nghỉ.
 *  G. chayNeuLanhDao: lịch ngắn bỏ lượt, lịch dài / hằng ngày VẪN chạy (ca phải im), có request ⇒ chạy.
 *  H. bocThuLai (client giả): P1001 hết lượt ⇒ ghi mất; P2024 ⇒ ghi mất, KHÔNG thử lại; lỗi dữ liệu ⇒ không ghi.
 *  I. Hộp thư: tin hỏng vì ngắt mạch ⇒ hoãn 120s (không tính lượt), quá 24 giờ mới bỏ cuộc.
 *
 * Không gọi mạng, không đụng CSDL. Chạy: npm run check:hang-cho-proxy
 */
let dat = 0, hong = 0
function ca(ten: string, dung: boolean, them = '') { if (dung) dat++; else { hong++; console.log(`  ✗ ${ten}${them ? ` — ${them}` : ''}`) } }

const ngu = (ms: number) => new Promise(r => setTimeout(r, ms))
function hoaDon<T = void>() {
    let giai!: (v: T) => void, tuChoi!: (e: any) => void
    const p = new Promise<T>((a, b) => { giai = a; tuChoi = b })
    return { p, giai, tuChoi }
}
/** Đợi hết các bước microtask/timer đang chờ (đủ cho chuỗi await ngắn). */
const choYen = () => ngu(5)

async function main() {
    // leaderLock đọc REDIS_URL lúc nạp module ⇒ xoá TRƯỚC khi import (prod cũng không có Redis).
    delete process.env.REDIS_URL
    delete process.env.CSDL_NGHI_MS
    const pb = await import('../src/lib/proxyBreaker')
    const { ShopeeService } = await import('../src/services/platforms/shopee')
    const { LazadaService } = await import('../src/services/platforms/lazada')
    const csdl = await import('../src/lib/trangThaiCsdl')
    const { chayNeuLanhDao } = await import('../src/lib/leaderLock')
    const { bocThuLai } = await import('../src/lib/prisma')
    const { xuLyTinNgatMach } = await import('../src/services/hopThuWebhook')

    const moNgatMach = () => { for (let i = 0; i < 5; i++) pb.noteProxyFailure() }
    const dongNgatMach = () => pb.noteProxySuccess()
    const soLanHongTrongLoi = () => Number(/\((\d+) lần hỏng liên tiếp\)/.exec(pb.proxyCircuitError().message)?.[1])
    // Im log của chính các hàm đang kiểm (mở/đóng ngắt mạch, hàng chờ dài) cho dễ đọc kết quả.
    const logGoc = { log: console.log, warn: console.warn, error: console.error }
    const imLog = () => { console.warn = () => { }; console.error = () => { } }
    const moLog = () => { console.warn = logGoc.warn; console.error = logGoc.error }

    // ─── A. goiQuaProxy ──────────────────────────────────────────────────────────
    {
        process.env.PROXY_DONG_THOI_TOI_DA = '2'
        let dang = 0, dinh = 0
        const thuTuChay: number[] = []
        const khoa = Array.from({ length: 7 }, () => hoaDon())
        const viec = khoa.map((k, i) => pb.goiQuaProxy(async () => {
            thuTuChay.push(i); dang++; dinh = Math.max(dinh, dang)
            try { await k.p; return i } finally { dang-- }
        }))
        await choYen()
        ca('A1 lúc đầu chỉ 2 việc chạy, 5 việc xếp hàng', thuTuChay.length === 2 && pb.thongKeHangChoProxy().dangCho === 5,
            JSON.stringify({ thuTuChay, tk: pb.thongKeHangChoProxy() }))
        for (const k of khoa) { k.giai(); await choYen() }
        const kq = await Promise.all(viec)
        ca('A2 không lúc nào quá 2 việc cùng lúc', dinh === 2, `đỉnh ${dinh}`)
        ca('A3 chạy đúng thứ tự tới', JSON.stringify(thuTuChay) === JSON.stringify([0, 1, 2, 3, 4, 5, 6]), JSON.stringify(thuTuChay))
        ca('A4 mỗi việc nhận đúng kết quả của mình', JSON.stringify(kq) === JSON.stringify([0, 1, 2, 3, 4, 5, 6]))

        // Lỗi vẫn trả chỗ
        process.env.PROXY_DONG_THOI_TOI_DA = '1'
        const p1 = pb.goiQuaProxy(async () => { await ngu(5); throw new Error('hỏng thật') })
        let chayP2 = false
        const p2 = pb.goiQuaProxy(async () => { chayP2 = true; return 'p2' })
        const r1 = await p1.then(() => 'khong-loi', e => String(e?.message))
        const r2 = await p2
        ca('A5 việc hỏng ném nguyên lỗi + trả chỗ cho việc sau', r1 === 'hỏng thật' && chayP2 && r2 === 'p2', `${r1} / ${r2}`)

        // Ngắt mạch mở trong lúc đang chờ
        const giu = hoaDon()
        const pGiu = pb.goiQuaProxy(() => giu.p)
        let chayCho = false
        const pCho = pb.goiQuaProxy(async () => { chayCho = true })
        await choYen()
        imLog(); moNgatMach(); moLog()
        giu.giai()
        await pGiu
        const loiCho: any = await pCho.then(() => null, e => e)
        ca('A6 ngắt mạch mở lúc đang chờ ⇒ hỏng NGAY, việc KHÔNG chạy',
            !!loiCho && loiCho.ngatMachProxy === true && loiCho.chuaGui === true && !chayCho, String(loiCho?.message))
        dongNgatMach()

        const tk = pb.thongKeHangChoProxy()
        ca('A7 hết việc thì không rò chỗ (đang gọi 0, đang chờ 0)', tk.dangGoi === 0 && tk.dangCho === 0, JSON.stringify(tk))
    }

    // ─── B. laLoiNgatMachProxy ───────────────────────────────────────────────────
    {
        ca('B1 lỗi ngắt mạch gốc', pb.laLoiNgatMachProxy(pb.proxyCircuitError()))
        const boc = new Error(`Không lấy được chi tiết đơn X — ${pb.proxyCircuitError().message}`)
        ca('B2 bị bọc thành chuỗi khác (mất cờ) vẫn nhận ra', pb.laLoiNgatMachProxy(boc))
        ca('B3 "fetch failed" (gửi rồi hỏng / không rõ) KHÔNG phải ngắt mạch', !pb.laLoiNgatMachProxy(new TypeError('fetch failed')))
        ca('B4 null/undefined ⇒ không', !pb.laLoiNgatMachProxy(null) && !pb.laLoiNgatMachProxy(undefined))
    }

    // ─── C. docHetPhanHoi ────────────────────────────────────────────────────────
    {
        const byte = new Uint8Array([0, 255, 1, 2, 128, 10])
        const goc = new Response(byte, { status: 201, statusText: 'Created', headers: { 'x-thu': 'co', 'content-type': 'application/octet-stream' } })
        const moi = await pb.docHetPhanHoi(goc)
        const lai = new Uint8Array(await moi.arrayBuffer())
        ca('C1 giữ nguyên byte, status, header', moi.status === 201 && moi.statusText === 'Created' && moi.headers.get('x-thu') === 'co'
            && lai.length === byte.length && lai.every((b, i) => b === byte[i]), `${moi.status} ${Array.from(lai)}`)
        const ok = await pb.docHetPhanHoi(new Response(JSON.stringify({ response: { a: 1 } }), { status: 200 }))
        ca('C2 thân JSON đọc lại được', (await ok.json())?.response?.a === 1)
        let vo = ''
        try { const r = await pb.docHetPhanHoi(new Response(null, { status: 204 })); vo = String(r.status) } catch (e: any) { vo = 'vỡ: ' + e?.message }
        ca('C3 204 không thân không vỡ', vo === '204', vo)
    }

    // ─── D + E. ShopeeService / LazadaService qua proxy giả ──────────────────────
    const fetchGoc = globalThis.fetch
    const proxyGoc = { s: process.env.SHOPEE_FORWARD_PROXY, l: process.env.PLATFORM_FORWARD_PROXY, sec: process.env.SHOPEE_FORWARD_SECRET }
    try {
        process.env.SHOPEE_FORWARD_PROXY = 'https://proxy.gia/ai-livestream/shopee-forward.php'
        process.env.SHOPEE_FORWARD_SECRET = 'bi-mat-gia'
        delete process.env.PLATFORM_FORWARD_PROXY
        let dang = 0, dinh = 0, soLanGoi = 0
        const dichDen: string[] = []
        globalThis.fetch = (async (dich: any, init: any) => {
            soLanGoi++; dang++; dinh = Math.max(dinh, dang)
            dichDen.push(String(dich))
            try {
                await ngu(15)
                const than = JSON.parse(String(init?.body || '{}'))
                return new Response(JSON.stringify({ response: { url: than.url } }), { status: 200, headers: { 'content-type': 'application/json' } })
            } finally { dang-- }
        }) as any
        const shopee = new ShopeeService({ apiKey: '2001234', apiSecret: 'bimat', accessToken: 'tok', shopId: '999' })
        const lazada = new LazadaService({ apiKey: '1001', apiSecret: 'bimat', accessToken: 'tok', shopId: '1' })

        process.env.PROXY_DONG_THOI_TOI_DA = '3'
        const ds = await Promise.all(Array.from({ length: 10 }, (_, i) => (shopee as any).httpGet(`https://partner.shopeemobile.com/api/v2/x?i=${i}`)))
        ca('D1 10 lời gọi Shopee cùng lúc: tối đa 3 tới proxy một lúc, đủ 10 kết quả đúng',
            dinh === 3 && soLanGoi === 10 && ds.every((d: any, i: number) => d?.response?.url?.endsWith(`i=${i}`)), `đỉnh ${dinh}, gọi ${soLanGoi}`)
        ca('D2 đi qua proxy chứ không gọi thẳng Shopee', dichDen.every(d => d.startsWith('https://proxy.gia/')))

        // E. Lazada chung hàng với Shopee
        dang = 0; dinh = 0; soLanGoi = 0
        await Promise.all([
            ...Array.from({ length: 4 }, (_, i) => (shopee as any).httpGet(`https://partner.shopeemobile.com/api/v2/s?i=${i}`)),
            ...Array.from({ length: 4 }, (_, i) => (lazada as any).lazadaFetch(`https://api.lazada.vn/rest/l?i=${i}`, 'GET').then((r: Response) => r.text())),
        ])
        ca('E1 Shopee + Lazada cùng lúc vẫn chung trần 3 (một hosting Tino)', dinh === 3 && soLanGoi === 8, `đỉnh ${dinh}, gọi ${soLanGoi}`)

        // D3. Ngắt mạch đang mở ⇒ hỏng ngay, không gọi
        soLanGoi = 0
        imLog(); moNgatMach(); moLog()
        const loi1: any = await (shopee as any).httpGet('https://partner.shopeemobile.com/api/v2/y').then(() => null, (e: any) => e)
        ca('D3 ngắt mạch mở ⇒ hỏng ngay, cờ ngatMachProxy, KHÔNG gọi proxy', !!loi1 && loi1.ngatMachProxy === true && soLanGoi === 0, String(loi1?.message))
        dongNgatMach()

        // D4. Ngắt mạch mở trong lúc lời gọi Shopee đang XẾP HÀNG ⇒ không gọi, không thử lại, không đếm thêm
        process.env.PROXY_DONG_THOI_TOI_DA = '1'
        soLanGoi = 0
        const giu = hoaDon()
        const pGiu = pb.goiQuaProxy(() => giu.p)          // chiếm chỗ duy nhất
        const pCho = (shopee as any).httpGet('https://partner.shopeemobile.com/api/v2/z').then(() => null, (e: any) => e)
        await choYen()
        imLog(); moNgatMach(); moLog()
        const truoc = soLanHongTrongLoi()
        const batDau = Date.now()
        giu.giai(); await pGiu
        const loi2: any = await pCho
        const sau = soLanHongTrongLoi()
        ca('D4 mở ngắt mạch lúc đang xếp hàng ⇒ hỏng ngay (không chờ thử lại 1s+2s), không gọi proxy',
            !!loi2 && loi2.ngatMachProxy === true && loi2.chuaGui === true && soLanGoi === 0 && Date.now() - batDau < 500,
            `${String(loi2?.message)} — gọi ${soLanGoi}, ${Date.now() - batDau}ms`)
        ca('D5 lỗi ngắt mạch KHÔNG bị đếm thành một lần proxy hỏng nữa', truoc === 5 && sau === 5, `${truoc} → ${sau}`)
        dongNgatMach()

        // D6. Proxy hỏng THẬT vẫn thử lại + đếm như cũ (ca phải giữ hành vi cũ)
        process.env.PROXY_DONG_THOI_TOI_DA = '6'
        soLanGoi = 0
        globalThis.fetch = (async () => { soLanGoi++; throw new TypeError('fetch failed') }) as any
        imLog()
        const loi3: any = await (shopee as any).shopeeFetch('https://partner.shopeemobile.com/api/v2/w', 'GET', undefined, 2).then(() => null, (e: any) => e)
        moLog()
        ca('D6 proxy hỏng thật: vẫn thử đủ lượt, lỗi KHÔNG mang cờ ngắt mạch', !!loi3 && soLanGoi === 2 && !pb.laLoiNgatMachProxy(loi3), `${soLanGoi} lần — ${loi3?.message}`)
        ca('D7 …và được đếm là một lần proxy hỏng', soLanHongTrongLoi() === 1, String(soLanHongTrongLoi()))
        dongNgatMach()
    } finally {
        globalThis.fetch = fetchGoc
        if (proxyGoc.s === undefined) delete process.env.SHOPEE_FORWARD_PROXY; else process.env.SHOPEE_FORWARD_PROXY = proxyGoc.s
        if (proxyGoc.l === undefined) delete process.env.PLATFORM_FORWARD_PROXY; else process.env.PLATFORM_FORWARD_PROXY = proxyGoc.l
        if (proxyGoc.sec === undefined) delete process.env.SHOPEE_FORWARD_SECRET; else process.env.SHOPEE_FORWARD_SECRET = proxyGoc.sec
        delete process.env.PROXY_DONG_THOI_TOI_DA
        moLog()
    }

    // ─── F. trangThaiCsdl ────────────────────────────────────────────────────────
    {
        csdl._datLaiTrangThaiCsdl()
        const t0 = Date.now()
        ca('F1 chưa mất lần nào ⇒ không nghỉ (ca phải im)', !csdl.csdlVuaMatKetNoi(t0) && !csdl.nenNghiLichNen(t0))
        csdl.ghiMatKetNoiCsdl(t0)
        ca('F2 vừa mất ⇒ nghỉ (1s sau, 179s sau)', csdl.nenNghiLichNen(t0 + 1000) && csdl.nenNghiLichNen(t0 + 179_000))
        ca('F3 quá 3 phút ⇒ hết nghỉ, lịch tự thử lại', !csdl.nenNghiLichNen(t0 + 181_000))
        csdl.batDauRequest()
        ca('F4 đang có request (có CPU, vd /api/cron/tick) ⇒ KHÔNG nghỉ', !csdl.nenNghiLichNen(t0 + 1000) && csdl.csdlVuaMatKetNoi(t0 + 1000))
        csdl.xongRequest()
        ca('F5 request xong ⇒ nghỉ lại', csdl.nenNghiLichNen(t0 + 1000))
        csdl.xongRequest(); csdl.xongRequest()   // trả thừa không được âm
        csdl.batDauRequest()
        ca('F6 đếm request không xuống âm', !csdl.nenNghiLichNen(t0 + 1000))
        csdl.xongRequest()
        csdl.ghiCsdlTotLai()
        ca('F7 truy vấn chạy được ⇒ tốt lại NGAY', !csdl.nenNghiLichNen(t0 + 1000))
        process.env.CSDL_NGHI_MS = '30000'
        csdl.ghiMatKetNoiCsdl(t0)
        ca('F8 CSDL_NGHI_MS=30000 ⇒ cửa sổ 30s', csdl.nenNghiLichNen(t0 + 29_000) && !csdl.nenNghiLichNen(t0 + 31_000))
        process.env.CSDL_NGHI_MS = '5'
        ca('F9 CSDL_NGHI_MS quá nhỏ ⇒ sàn 10s', csdl.nenNghiLichNen(t0 + 9_000) && !csdl.nenNghiLichNen(t0 + 11_000))
        delete process.env.CSDL_NGHI_MS
        csdl._datLaiTrangThaiCsdl()
    }

    // ─── G. chayNeuLanhDao ───────────────────────────────────────────────────────
    {
        csdl._datLaiTrangThaiCsdl()
        const chay = async (ten: string) => { let co = false; const kq = await chayNeuLanhDao(ten, 60_000, () => { co = true }); return { kq, co } }
        const binhThuong = await chay('hop-thu-webhook')
        ca('G1 CSDL bình thường ⇒ lịch ngắn chạy (ca phải im)', binhThuong.kq && binhThuong.co)
        csdl.ghiMatKetNoiCsdl()
        imLog()
        const ngan = await Promise.all(['hop-thu-webhook', 'flash-sale', 'kiotviet-watchdog', 'ai-agent', 'nhac-bang-chung-tiktok',
            'han-thanh-toan', 'kiotviet-webhook-canh', 'fanpage-reconcile'].map(chay))
        moLog()
        ca('G2 vừa mất CSDL, không request ⇒ 8 lịch ngắn bỏ lượt, việc KHÔNG chạy', ngan.every(x => !x.kq && !x.co), JSON.stringify(ngan))
        const dai = await Promise.all(['auto-sync', 'email-reply', 'auto-cleanup', 'fee-sync', 'hoa-don-xml-email'].map(chay))
        ca('G3 lịch dài / hằng ngày VẪN chạy (bỏ lượt là mất cả nhịp/ngày)', dai.every(x => x.kq && x.co), JSON.stringify(dai))
        csdl.batDauRequest()
        const coRequest = await chay('hop-thu-webhook')
        csdl.xongRequest()
        ca('G4 đang có request ⇒ lịch ngắn chạy', coRequest.kq && coRequest.co)
        csdl.ghiCsdlTotLai()
        const totLai = await chay('flash-sale')
        ca('G5 CSDL tốt lại ⇒ chạy tiếp ngay', totLai.kq && totLai.co)
        csdl._datLaiTrangThaiCsdl()
    }

    // ─── H. bocThuLai (client giả) ───────────────────────────────────────────────
    {
        const dinhNghia: any = bocThuLai({ $extends: (x: any) => x } as any)
        const tatCa = dinhNghia.query.$allOperations as (o: any) => Promise<any>
        const loi = (code: string, message = code) => Object.assign(new Error(message), { code })

        csdl._datLaiTrangThaiCsdl()
        let n = 0
        const r1 = await tatCa({ args: {}, query: async () => { n++; throw loi('P1001', "Can't reach database server at `x`") } }).then(() => null, e => e)
        ca('H1 P1001 thử 3 lần vẫn hỏng ⇒ ném lỗi gốc + ghi mất kết nối', r1?.code === 'P1001' && n === 3 && csdl.csdlVuaMatKetNoi(), `${n} lần`)
        await tatCa({ args: {}, query: async () => 'ok' })
        ca('H2 truy vấn kế tiếp chạy được ⇒ tốt lại', !csdl.csdlVuaMatKetNoi())

        n = 0
        const r3 = await tatCa({ args: {}, query: async () => { n++; throw loi('P2024', 'Timed out fetching a new connection from the connection pool.') } }).then(() => null, e => e)
        ca('H3 P2024 ⇒ ném ngay (KHÔNG thử lại), ghi mất kết nối', r3?.code === 'P2024' && n === 1 && csdl.csdlVuaMatKetNoi(), `${n} lần`)
        csdl.ghiCsdlTotLai()

        n = 0
        const r4 = await tatCa({ args: {}, query: async () => { n++; throw loi('P2002', 'Unique constraint failed') } }).then(() => null, e => e)
        ca('H4 lỗi dữ liệu (P2002) ⇒ ném ngay, KHÔNG ghi mất kết nối (ca phải im)', r4?.code === 'P2002' && n === 1 && !csdl.csdlVuaMatKetNoi(), `${n} lần`)

        n = 0
        const r5 = await tatCa({ args: {}, query: async () => { n++; if (n === 1) throw loi('P1017', 'Server has closed the connection'); return 'lan-2' } })
        ca('H5 mất kết nối một nhịp rồi được ⇒ trả kết quả, không ghi mất', r5 === 'lan-2' && n === 2 && !csdl.csdlVuaMatKetNoi(), `${n} lần`)
        csdl._datLaiTrangThaiCsdl()
    }

    // ─── I. Hộp thư: tin hỏng vì ngắt mạch ───────────────────────────────────────
    {
        const bayGio = Date.now()
        const moi = xuLyTinNgatMach(bayGio - 3600_000, bayGio)
        ca('I1 nhận 1 giờ trước ⇒ hoãn 120s (không tính lượt)', moi.loai === 'cho' && (moi as any).sauGiay === 120, JSON.stringify(moi))
        const sauGio = xuLyTinNgatMach(bayGio - 7 * 3600_000, bayGio)
        ca('I2 nhận 7 giờ trước (vụ 16/11 chặn ~6 giờ) ⇒ VẪN hoãn, không bỏ cuộc', sauGio.loai === 'cho', JSON.stringify(sauGio))
        const qua = xuLyTinNgatMach(bayGio - 25 * 3600_000, bayGio)
        ca('I3 quá 24 giờ ⇒ bỏ cuộc cho người soi', qua.loai === 'hong', JSON.stringify(qua))
    }

    console.log(`\n${dat}/${dat + hong} ca đạt`)
    if (hong) process.exitCode = 1
}
main().then(() => process.exit(process.exitCode ?? 0)).catch(e => { console.error(e); process.exit(1) })
