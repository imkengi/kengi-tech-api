// VNPT Hoá đơn điện tử khởi tạo từ MÁY TÍNH TIỀN (HĐĐT-MTT) — bộ "API SAAS RELEASE"
//
// Nguồn sự thật: Postman "API SAAS RELEASE.postman_collection.json" (bộ đúng,
// thay cho bộ biên lai ereceipt cũ — bộ cũ trả "Dải ký hiệu biên lai không tồn
// tại" vì dải C26MNH nằm bên hệ hoá đơn MTT, không phải hệ biên lai).
//
// Kiến trúc SAAS: một gốc API + nhiều service con theo path:
//   {root}/admin-api   — quản trị + đăng nhập
//   {root}/invoice-api — hoá đơn điện tử thường
//   {root}/pos-api     — hoá đơn khởi tạo từ máy tính tiền (MTT) ← dùng cái này
//
// Luồng phát hành MTT (không ký số hoặc Eseal/HSM):
//   1. POST {root}/admin-api/api/v1/saas/auth  {username,password}
//      → { err_code:"0", data:{ access_token, clientId } }
//   2. POST {root}/pos-api/api/v1/saas/posinvoice/create-and-publish
//      headers: Authorization: <access_token> (KHÔNG "Bearer"), Client-Id: <clientId>
//      body: { [type_cert, serial_number,] KHMSHDon, KHHDon, HDons:[…] }
//
// Cấu hình (EInvoiceProviderConfig): apiUrl = gốc API; apiKey = username;
// apiSecret = password; templateId = KHMSHDon ("2" hoặc "2/001" → lấy phần
// trước "/"); serialNo = KHHDon (ví dụ "C26MNH", GIỮ NGUYÊN chữ C).
// extra JSON tuỳ chọn: { saasBase, typeCert ("HSM"/"ESEAL"/"SMARTCA"),
//                        serialNumber (số serial chứng thư), sellerEmail }.
//
// Gốc API: collection dùng https://api-hst-dev.vnpt-invoice.com.vn (dev).
// Config cũ đang lưu https://gateway-hst.vnpt-invoice.com.vn (host bộ cũ) —
// provider tự thử lần lượt các ứng viên gốc và nhớ gốc nào đăng nhập được.

import { IEInvoiceProvider, EInvoiceProviderConfig, EInvoiceData, IssueResult, CancelResult, ConnectionTestResult } from './types'

// dd/MM/yyyy theo giờ VN (NLap của MTT nhận chuỗi ngày kiểu này, vd "25/3/2025")
function ddMMyyyy(d = new Date()): string {
    const vn = new Date(d.getTime() + 7 * 3600_000) // UTC+7
    const dd = String(vn.getUTCDate()).padStart(2, '0')
    const mm = String(vn.getUTCMonth() + 1).padStart(2, '0')
    return `${dd}/${mm}/${vn.getUTCFullYear()}`
}

function parseExtra(extra?: string): Record<string, any> {
    try { return extra ? JSON.parse(extra) : {} } catch { return {} }
}

interface SaasSession { root: string; token: string; clientId: string }

/** Fkey gửi VNPT: chỉ chữ+số, tối đa 36 ký tự — PHẢI cùng công thức ở mọi chỗ
 * (phát hành đặt Fkey theo transactionId; thay thế/tải file phải tính ra đúng
 * Fkey đó để trỏ về hoá đơn gốc). */
export function vnptFkey(src: string): string {
    return String(src || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 36)
}

// Nhớ gốc API đăng nhập được theo apiUrl cấu hình (đỡ dò lại mỗi lần phát hành)
const rootCache = new Map<string, string>()
// Nhớ chứng thư số của đơn vị theo gốc API (ca-config đổi rất hiếm)
const certCache = new Map<string, { type: string; serial: string }>()

export class VnptProvider implements IEInvoiceProvider {
    name = 'vnpt'

    /** Danh sách ứng viên gốc API SAAS, ưu tiên extra.saasBase. */
    private candidateRoots(config: EInvoiceProviderConfig): string[] {
        const ex = parseExtra(config.extra)
        const cfgUrl = String(config.apiUrl || '').replace(/\/+$/, '')
            .replace(/\/(admin-api|invoice-api|pos-api)$/, '')
        const list: string[] = []
        if (ex.saasBase) list.push(String(ex.saasBase).replace(/\/+$/, ''))
        const cached = rootCache.get(config.apiUrl || '')
        if (cached) list.push(cached)
        // host bộ cũ gateway-hst → host bộ SAAS api-hst (cùng môi trường HST)
        if (/gateway-hst\./.test(cfgUrl)) list.push(cfgUrl.replace('gateway-hst.', 'api-hst.'))
        if (cfgUrl) list.push(cfgUrl)
        list.push('https://api-hst.vnpt-invoice.com.vn')
        return [...new Set(list)]
    }

    /** Đăng nhập SAAS: thử từng gốc, trả về gốc + token + clientId. */
    async login(config: EInvoiceProviderConfig): Promise<SaasSession> {
        const errors: string[] = []
        // Hệ SAAS chê username dạng "…_admin" (tài khoản cổng quản trị) — tài khoản
        // tích hợp là MST trần. Thử cả hai dạng cho cấu hình cũ khỏi phải sửa tay.
        const usernames = [...new Set([
            String(config.apiKey || ''),
            String(config.apiKey || '').replace(/_admin$/i, ''),
        ])].filter(Boolean)
        for (const root of this.candidateRoots(config)) {
            for (const username of usernames) {
            try {
                const res = await fetch(`${root}/admin-api/api/v1/saas/auth`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password: config.apiSecret }),
                })
                const text = await res.text()
                let data: any = {}
                try { data = JSON.parse(text) } catch { }
                const token = data?.data?.access_token || data?.access_token || ''
                const clientId = data?.data?.clientId || data?.clientId || ''
                if (res.ok && String(data?.err_code ?? '0') === '0' && token) {
                    rootCache.set(config.apiUrl || '', root)
                    return { root, token, clientId }
                }
                errors.push(`${root} (${username}): HTTP ${res.status} ${String(data?.message || text).slice(0, 120)}`)
            } catch (e: any) {
                errors.push(`${root} (${username}): ${e?.message}`)
            }
            }
        }
        throw new Error(`Đăng nhập VNPT SAAS thất bại. ${errors.join(' | ')}`.slice(0, 600))
    }

    private authHeaders(s: SaasSession) {
        return { 'Content-Type': 'application/json', Authorization: s.token, 'Client-Id': s.clientId }
    }

    /** Gọi POST tới pos-api, trả {status, json, raw}. */
    private async posApi(s: SaasSession, path: string, body: any): Promise<{ status: number; json: any; raw: string }> {
        const res = await fetch(`${s.root}/pos-api/api/v1/saas/${path}`, {
            method: 'POST',
            headers: this.authHeaders(s),
            body: JSON.stringify(body),
        })
        const raw = await res.text()
        let json: any = null
        try { json = JSON.parse(raw) } catch { }
        return { status: res.status, json, raw }
    }

    async testConnection(config: EInvoiceProviderConfig): Promise<ConnectionTestResult> {
        try {
            const s = await this.login(config)
            // Tra dải ký hiệu MTT để xác nhận tài khoản thấy dải cấu hình
            const sym = await this.posApi(s, 'symbol/gets?page=0&size=20', {})
            const rows: any[] = sym.json?.data?.content || sym.json?.data || []
            const names = Array.isArray(rows)
                ? rows.map((r: any) => `${r.pattern || r.khmshdon || r.typeInv || ''}/${r.symbol || r.khhdon || ''}`).join(', ')
                : String(sym.raw).slice(0, 200)
            return {
                success: true,
                message: 'Kết nối VNPT SAAS (hoá đơn MTT) thành công!',
                providerInfo: `Gốc: ${s.root} — Dải: ${names || '(không liệt kê được)'}`,
            }
        } catch (err: any) {
            return { success: false, message: `Lỗi kết nối VNPT: ${err.message}` }
        }
    }

    /** EInvoiceData → 1 phần tử HDons của posinvoice/create-and-publish. */
    private buildHDon(config: EInvoiceProviderConfig, data: EInvoiceData): any {
        const ex = parseExtra(config.extra)
        const taxed = Number(data.vatRate) > 0
        const items = (data.items || []).map((it, idx) => {
            const line: any = {
                STT: idx + 1,
                TChat: '1',
                MHHDVu: '',
                THHDVu: it.name,
                DVTinh: it.unit || 'Cái',
                SLuong: it.quantity,
                DGia: it.unitPrice,
                TLCKhau: 0,
                STCKhau: Math.round(it.discount || 0),
                ThTien: Math.round(it.amount),
                ExtTGTKCThue: 0,
                GThue: false,
                ExtTGThue: 0,
            }
            // Hoá đơn bán hàng HKD (KHMSHDon=2): không kê thuế trên dòng — file XML
            // mẫu chính thức của chính dải C26MNH không có TSuat/TThue.
            if (taxed) {
                const rate = Number(it.vatRate ?? data.vatRate)
                line.TSuat = String(rate)
                line.TThue = Math.round(it.vatAmount || (it.amount * rate) / 100)
                line.ExtThTienSThue = Math.round(it.amount) + line.TThue
            } else {
                line.ExtThTienSThue = Math.round(it.amount)
            }
            return line
        })

        const tToan: any = {
            TTCKTMai: 0,
            TgTCThue: Math.round(data.subtotal || data.total),
            ExtTgTienPhi: 0,
            TgTThue: Math.round(data.vatAmount || 0),
            TgTTTBSo: Math.round(data.total),
            TgTTTBChu: data.totalInWords || '',
            TGTKCThue: 0,
            TGTKhac: 0,
            TgTGThue: 0,
            TLGThue: 0,
            NQSo: null,
            QDoiTgTTTBSo: 0,
        }
        if (taxed) tToan.TSuat = String(data.vatRate)

        const hdon: any = {
            NLap: ddMMyyyy(),
            // Fkey do mình đặt = khoá idempotent theo giao dịch: bấm "Xuất lại" sau
            // lỗi mạng sẽ không tạo trùng hoá đơn bên VNPT.
            Fkey: vnptFkey(data.transactionId),
            NMua: {
                HVTNMHang: data.buyerName || '',
                // Có MST = mua theo DANH NGHĨA CÔNG TY → VNPT bắt buộc "Tên đơn vị"
                // (Ten); để trống là ValidationException "Tên đơn vị mua hàng không
                // được bỏ trống" dù HVTNMHang đã có tên. Không MST thì giữ rỗng như
                // cũ — khách lẻ chỉ cần họ tên người mua.
                Ten: String(data.buyerTaxCode || '').trim() ? (data.buyerName || '') : '',
                // MST người mua: chỉ gửi khi có; TUYỆT ĐỐI không cắt gọt cho vừa khuôn
                MST: String(data.buyerTaxCode || '').trim(),
                MDVQHNSach: null,
                HHNKBTThu: false,
                DDVCHDen: null,
                TGVCHDTu: null,
                TGVCHDDen: null,
                DChi: data.buyerAddress || '',
                MKHang: '',
                SDThoai: data.buyerPhone || '',
                DCTDTu: data.buyerEmail || ex.sellerEmail || '',
                STKNHang: '',
                HTTToan: data.paymentMethod || 'TM',
                TNHang: '',
                DVTTe: data.currencyCode || 'VND',
                TGia: 1,
                HDDCKPTQuan: false,
                HVTNNHang: null,
                CMND: null,
            },
            HHDVu: items,
            TToan: tToan,
        }
        if (taxed) {
            // Tổng hợp theo từng thuế suất (chỉ hoá đơn có kê thuế mới cần)
            const byRate = new Map<string, { ThTien: number; TThue: number }>()
            for (const it of items) {
                const key = String(it.TSuat ?? data.vatRate)
                const cur = byRate.get(key) || { ThTien: 0, TThue: 0 }
                cur.ThTien += it.ThTien
                cur.TThue += it.TThue || 0
                byRate.set(key, cur)
            }
            hdon.THTTLTSuat = [...byRate.entries()].map(([TSuat, v]) => ({ TSuat, ...v }))
        }
        return hdon
    }

    /** Chứng thư số của đơn vị (VNPT cấp kèm gói HKD) — create-and-publish BẮT
     * BUỘC type_cert (HSM/ESEAL/SMARTCA) + serial_number; không có giá trị
     * "không ký số" (đã dò hết: mọi giá trị khác đều "type_cert không hợp lệ"). */
    private async fetchCert(s: SaasSession): Promise<{ type: string; serial: string } | null> {
        const cached = certCache.get(s.root)
        if (cached) return cached
        const res = await fetch(`${s.root}/admin-api/api/v1/saas/ca-config/findAll?page=0&size=10`, {
            method: 'POST', headers: this.authHeaders(s), body: JSON.stringify({}),
        })
        const raw = await res.text()
        let json: any = null
        try { json = JSON.parse(raw) } catch { }
        const rows: any[] = json?.data?.datas || []
        const now = Date.now()
        const pick = rows.find((r) => r.actived === 1 && r.flag_valid === 1
            && (!r.expiration_date || Date.parse(r.expiration_date) > now)) || rows[0]
        if (!pick?.serial) return null
        const cert = { type: String(pick.type || 'HSM'), serial: String(pick.serial) }
        certCache.set(s.root, cert)
        return cert
    }

    async issueInvoice(config: EInvoiceProviderConfig, data: EInvoiceData): Promise<IssueResult> {
        try {
            const s = await this.login(config)
            const ex = parseExtra(config.extra)
            const body: any = {
                // Mẫu số: "2" hoặc "2/001" → số 2. Ký hiệu: GIỮ NGUYÊN (C26MNH).
                KHMSHDon: Number(String(config.templateId || data.templateId || '').split('/')[0]) || 2,
                KHHDon: String(config.serialNo || data.serialNo || '').trim(),
                HDons: [this.buildHDon(config, data)],
            }
            // Chứng thư: extra khai tay thì ưu tiên, không thì tự lấy từ ca-config
            let typeCert = ex.typeCert || ''
            let serialNumber = ex.serialNumber || ''
            if (!typeCert || !serialNumber) {
                const cert = await this.fetchCert(s)
                if (cert) { typeCert = cert.type; serialNumber = cert.serial }
            }
            if (!typeCert || !serialNumber) {
                return { success: false, errorMessage: 'Đơn vị chưa có chứng thư số nào bên VNPT (ca-config trống) — cần VNPT cấp HSM/Eseal trước khi phát hành.' }
            }
            body.type_cert = typeCert
            body.serial_number = serialNumber
            const r = await this.posApi(s, 'posinvoice/create-and-publish', body)
            const ok = r.status < 300 && String(r.json?.err_code ?? '1') === '0'
            if (!ok) {
                const msg = r.json?.message || r.json?.data?.message || r.raw.slice(0, 250)
                return { success: false, errorMessage: `Phát hành HĐ MTT lỗi (HTTP ${r.status}): ${String(msg).slice(0, 300)}` }
            }
            // data có thể là mảng kết quả từng hoá đơn hoặc object — đọc phòng thủ
            const d = r.json?.data
            const first = Array.isArray(d) ? d[0] : (Array.isArray(d?.content) ? d.content[0] : d) || {}
            const invoiceNumber = String(first?.SHDon ?? first?.shdon ?? first?.no ?? first?.invoiceNo ?? '')
            const lookupCode = String(first?.MCCQT ?? first?.mccqt ?? first?.Fkey ?? first?.fkey ?? first?.MTCuu ?? '')
            return { success: true, invoiceNumber, lookupCode, pdfUrl: first?.pdfUrl || '' }
        } catch (err: any) {
            return { success: false, errorMessage: `VNPT SAAS lỗi: ${err.message}` }
        }
    }

    /** Tải hoá đơn đã phát hành từ cổng VNPT theo Fkey. typeDownload chưa có tài
     * liệu — dò 2→1→3 và nhận diện nội dung theo chữ ký base64 (JVBER=PDF,
     * PD94=XML, UEsDB=ZIP). */
    async downloadInvoice(config: EInvoiceProviderConfig, fkey: string): Promise<{ kind: string; base64?: string; raw?: string }> {
        const s = await this.login(config)
        let last = ''
        for (const t of [2, 1, 3]) {
            const r = await this.posApi(s, 'portal/download-by-fkeys', { typeDownload: t, lstFkey: [fkey] })
            last = r.raw.slice(0, 400)
            const d = r.json?.data
            const item = Array.isArray(d) ? d[0] : (Array.isArray(d?.datas) ? d.datas[0] : d)
            const b64 = typeof item === 'string' ? item
                : String(item?.data || item?.base64 || item?.file || item?.pdf || item?.content || '')
            if (b64 && b64.length > 100) {
                if (b64.startsWith('JVBER')) return { kind: 'pdf', base64: b64 }
                if (b64.startsWith('PD9')) return { kind: 'xml', base64: b64 }
                if (b64.startsWith('UEsDB')) return { kind: 'zip', base64: b64 }
                if (b64.startsWith('<')) return { kind: 'html', raw: b64 }
            }
            // CHỈ nhận url khi là object có field chuỗi — item là string thì
            // item.link trúng String.prototype.link (hàm native) → url rởm.
            const url = (item && typeof item === 'object')
                ? [item.url, item.link, item.pdfUrl].find((u: any) => typeof u === 'string' && u.startsWith('http'))
                : undefined
            if (url) return { kind: 'url', raw: url }
        }
        return { kind: 'unknown', raw: last }
    }

    /** Thay thế hoá đơn ĐÃ PHÁT HÀNH theo Fkey gốc (invoice-adjustment
     * save-and-publish, TCHDon=1) — ký HSM y như phát hành. data.transactionId
     * phải là khoá MỚI (khác giao dịch gốc) để Fkey hoá đơn thay thế không trùng. */
    async replaceInvoice(config: EInvoiceProviderConfig, originalFkey: string, data: EInvoiceData): Promise<IssueResult> {
        return this.adjustmentPublish(config, originalFkey, data, 1)
    }

    /** Hoá đơn ĐIỀU CHỈNH (TCHDon=2): hoá đơn gốc VẪN CÓ HIỆU LỰC, bản điều chỉnh
     * ghi phần chênh (điều chỉnh giảm cho trả hàng một phần). Khác thay thế
     * (TCHDon=1) — thay thế vô hiệu hoá đơn gốc. */
    async adjustInvoice(config: EInvoiceProviderConfig, originalFkey: string, data: EInvoiceData): Promise<IssueResult> {
        return this.adjustmentPublish(config, originalFkey, data, 2)
    }

    private async adjustmentPublish(config: EInvoiceProviderConfig, originalFkey: string, data: EInvoiceData, tchd: 1 | 2): Promise<IssueResult> {
        const nhan = tchd === 1 ? 'Thay thế' : 'Điều chỉnh'
        try {
            const s = await this.login(config)
            const ex = parseExtra(config.extra)
            let typeCert = ex.typeCert || ''
            let serialNumber = ex.serialNumber || ''
            if (!typeCert || !serialNumber) {
                const cert = await this.fetchCert(s)
                if (cert) { typeCert = cert.type; serialNumber = cert.serial }
            }
            if (!typeCert || !serialNumber) {
                return { success: false, errorMessage: `Đơn vị chưa có chứng thư số bên VNPT — không ${nhan.toLowerCase()} được.` }
            }
            const body: any = {
                type_cert: typeCert,
                serial_number: serialNumber,
                TCHDon: tchd, // 1 = thay thế, 2 = điều chỉnh
                Fkey: originalFkey,
                KHMSHDon: Number(String(config.templateId || '').split('/')[0]) || 2,
                KHHDon: String(config.serialNo || '').trim(),
                HDon: this.buildHDon(config, data),
            }
            const r = await this.posApi(s, 'invoice-adjustment/save-and-publish', body)
            const ok = r.status < 300 && String(r.json?.err_code ?? '1') === '0'
            if (!ok) {
                const msg = r.json?.message || r.json?.data?.message || r.raw.slice(0, 250)
                return { success: false, errorMessage: `${nhan} HĐ lỗi (HTTP ${r.status}): ${String(msg).slice(0, 300)}` }
            }
            const d = r.json?.data
            const first = Array.isArray(d) ? d[0] : (Array.isArray(d?.content) ? d.content[0] : d) || {}
            return {
                success: true,
                invoiceNumber: String(first?.SHDon ?? first?.shdon ?? first?.no ?? first?.invoiceNo ?? ''),
                lookupCode: String(first?.MCCQT ?? first?.mccqt ?? first?.Fkey ?? first?.fkey ?? ''),
            }
        } catch (err: any) {
            return { success: false, errorMessage: `VNPT ${nhan.toLowerCase()} lỗi: ${err.message}` }
        }
    }

    /** Gửi email hoá đơn cho khách qua VNPT: tra id hoá đơn theo Fkey rồi gọi
     * posinvoice/send-email. Lỗi email KHÔNG được làm hỏng luồng phát hành —
     * caller tự catch/log. */
    async sendInvoiceEmail(config: EInvoiceProviderConfig, fkey: string, sendTo: string): Promise<{ success: boolean; errorMessage?: string }> {
        try {
            const s = await this.login(config)
            const det = await this.posApi(s, 'portal/get-pos-by-fkey', { fkey })
            const vid = det.json?.data?.id
            if (!vid) return { success: false, errorMessage: `Không tìm thấy hoá đơn theo Fkey (${det.raw.slice(0, 120)})` }
            const r = await this.posApi(s, 'posinvoice/send-email', { id: vid, sendTo })
            const ok = r.status < 300 && String(r.json?.err_code ?? '1') === '0'
            return ok ? { success: true } : { success: false, errorMessage: String(r.json?.message || r.raw).slice(0, 200) }
        } catch (err: any) {
            return { success: false, errorMessage: err?.message }
        }
    }

    /** Hoá đơn MTT đã phát hành không huỷ trực tiếp — phải đi nghiệp vụ sai sót:
     * thông báo sai sót (posinvoice-notice) hoặc thay thế/điều chỉnh
     * (invoice-adjustment). Trả hướng dẫn thay vì giả vờ huỷ được. */
    async cancelInvoice(_config: EInvoiceProviderConfig, invoiceNumber: string, _reason: string): Promise<CancelResult> {
        return {
            success: false,
            errorMessage: `Hoá đơn MTT ${invoiceNumber} đã phát hành không huỷ trực tiếp được — cần lập Thông báo sai sót hoặc hoá đơn Thay thế/Điều chỉnh trên hệ VNPT.`,
        }
    }
}
