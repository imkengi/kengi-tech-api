// VNPT Hoá đơn điện tử khởi tạo từ MÁY TÍNH TIỀN (HĐĐT-MTT, SaaS REST) Provider
//
// Ghi chú: API SaaS này dùng tên trường kiểu "ereceipt" (TCTPhi/TCNBLai/TPhi…) —
// đây là luồng phát hành HĐĐT máy tính tiền cho bán lẻ, KHÔNG phải biên lai thu phí.
//
// Luồng (theo Postman "API tích hợp biên lai SAAS"):
//   1. POST {apiUrl}/admin/api/authenticate  {username, password} → token (UUID)
//   2. POST {apiUrl}/ereceipt/api/ereceipt/save  <payload biên lai> → { id }
//   3. POST {apiUrl}/ereceipt/api/adapter/publish/publishInv  { idList:[id] } → phát hành
//   (xoá nháp: POST /ereceipt/api/ereceipt/delete  [id])
//
// Token đặt THẲNG vào header Authorization (KHÔNG có tiền tố "Bearer").
// Cấu hình (EInvoiceConfig): apiUrl = base URL VNPT; apiKey = username;
// apiSecret = password; templateId = Mẫu số (KHSCTu); serialNo = Ký hiệu (KHCTu).
// extra (JSON tuỳ chọn): { sellerEmail, sellerPhone, MDVQHNSach, chargeContent,
//                          bhxhCode, monthsContributed }.
//
// LƯU Ý: đây là chứng từ BIÊN LAI (thu phí/lệ phí/BHXH), không phải hoá đơn GTGT.
// Map từ EInvoiceData: seller→TCTPhi (tổ chức thu), buyer→TCNBLai (người nộp),
// items→TPhi (các khoản phí), total→thanhtoan.STien.

import { IEInvoiceProvider, EInvoiceProviderConfig, EInvoiceData, IssueResult, CancelResult, ConnectionTestResult } from './types'

// dd/MM/yyyy theo giờ VN (biên lai VNPT nhận chuỗi ngày này)
function ddMMyyyy(d = new Date()): string {
    const vn = new Date(d.getTime() + 7 * 3600_000) // UTC+7
    const dd = String(vn.getUTCDate()).padStart(2, '0')
    const mm = String(vn.getUTCMonth() + 1).padStart(2, '0')
    return `${dd}/${mm}/${vn.getUTCFullYear()}`
}

function parseExtra(extra?: string): Record<string, any> {
    try { return extra ? JSON.parse(extra) : {} } catch { return {} }
}

export class VnptProvider implements IEInvoiceProvider {
    name = 'vnpt'

    private base(config: EInvoiceProviderConfig): string {
        return (config.apiUrl || '').replace(/\/+$/, '')
    }

    /** Lấy token đăng nhập. Parse phòng thủ vì shape response chưa cố định. */
    private async getToken(config: EInvoiceProviderConfig): Promise<string> {
        const res = await fetch(`${this.base(config)}/admin/api/authenticate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: config.apiKey, password: config.apiSecret }),
        })
        const text = await res.text()
        if (!res.ok) throw new Error(`Đăng nhập VNPT lỗi HTTP ${res.status}: ${text.slice(0, 200)}`)
        let data: any
        try { data = JSON.parse(text) } catch { data = text }
        // token có thể nằm ở nhiều chỗ / hoặc body chính là token
        const token =
            (typeof data === 'string' ? data.replace(/"/g, '').trim() : '') ||
            data?.token || data?.access_token || data?.id_token ||
            data?.data?.token || data?.data?.access_token ||
            (typeof data?.data === 'string' ? data.data : '') ||
            data?.Authorization || ''
        if (!token || typeof token !== 'string') {
            throw new Error(`Không lấy được token VNPT (response: ${text.slice(0, 200)})`)
        }
        return token
    }

    private authHeaders(token: string) {
        return { 'Content-Type': 'application/json', Authorization: token }
    }

    async testConnection(config: EInvoiceProviderConfig): Promise<ConnectionTestResult> {
        try {
            const token = await this.getToken(config)
            return { success: true, message: 'Kết nối VNPT (biên lai) thành công!', providerInfo: `Token: ${token.slice(0, 12)}…` }
        } catch (err: any) {
            return { success: false, message: `Lỗi kết nối VNPT: ${err.message}` }
        }
    }

    /** EInvoiceData → payload "save" biên lai VNPT. */
    private buildReceiptPayload(config: EInvoiceProviderConfig, data: EInvoiceData): any {
        const ex = parseExtra(config.extra)
        const cfg = config as any // EInvoiceConfig row có thêm cột seller (companyName…)
        const chargeContent = ex.chargeContent || data.items?.[0]?.name || 'Thu tiền'
        return {
            MainTitle: { VDLieu: '', TrangThaiTToan: false, DKBKe: false },
            invoiceinfor: { NLap: ddMMyyyy() },
            seriesno: {
                SCTu: '',
                KHSCTu: config.templateId || '', // Mẫu số
                KHCTu: config.serialNo || '',     // Ký hiệu
            },
            // Tổ chức THU phí = bên bán/cửa hàng. Đọc phòng thủ từ EInvoiceData LẪN
            // các cột config (companyName/sellerName…) + extra, để không thiếu thông tin.
            TCTPhi: {
                TTTThu: data.sellerName || cfg.companyName || cfg.sellerName || '',
                MST: data.sellerTaxCode || config.taxCode || '',
                DChi: data.sellerAddress || cfg.companyAddress || cfg.sellerAddress || '',
                DCTDTu: ex.sellerEmail || cfg.sellerEmail || '',
                SDThoai: ex.sellerPhone || cfg.sellerPhone || '',
                MDVQHNSach: ex.MDVQHNSach || '',
            },
            // Tổ chức/cá nhân NỘP = bên mua/người nộp
            TCNBLai: {
                TNNop: data.buyerName,
                BHXHCode: ex.bhxhCode || '',
                DChi: data.buyerAddress || '',
            },
            bangke: null,
            hdlienquan: null,
            thanhtoan: {
                ChargeContent: chargeContent,
                MonthsContributed: ex.monthsContributed || '',
                STien: String(Math.round(data.total)),
                VBChu: data.totalInWords || '',
                MThu: '0',
                HTTToan: data.paymentMethod || 'TM',
                DVTTe: data.currencyCode || 'VND',
                TGia: 1,
            },
            chuky: null,
            copyright: null,
            authorized_unit: null,
            // Các khoản phí = từng dòng hàng
            TPhi: (data.items || []).map((it, idx) => ({
                id: idx,
                type: '',
                rate: '',
                TLPhi: it.name,
                TPhi: String(Math.round(it.amount)),
                MThu: '',
                SLuong: it.quantity || 1,
            })),
            delegate: false,
            DDanhNlap: '',
            taxes: false,
        }
    }

    async issueInvoice(config: EInvoiceProviderConfig, data: EInvoiceData): Promise<IssueResult> {
        try {
            const token = await this.getToken(config)

            // Bước 1: lưu biên lai nháp → lấy id
            const saveRes = await fetch(`${this.base(config)}/ereceipt/api/ereceipt/save`, {
                method: 'POST',
                headers: this.authHeaders(token),
                body: JSON.stringify(this.buildReceiptPayload(config, data)),
            })
            const saveText = await saveRes.text()
            let saved: any
            try { saved = JSON.parse(saveText) } catch { saved = saveText }
            const id: string =
                saved?.id || saved?._id || saved?.data?.id || saved?.data?._id ||
                (typeof saved === 'string' ? saved.replace(/"/g, '').trim() : '')
            if (!saveRes.ok || !id) {
                return { success: false, errorMessage: `Lưu biên lai lỗi (HTTP ${saveRes.status}): ${saveText.slice(0, 250)}` }
            }

            // Bước 2: phát hành biên lai vừa lưu
            const pubRes = await fetch(`${this.base(config)}/ereceipt/api/adapter/publish/publishInv`, {
                method: 'POST',
                headers: this.authHeaders(token),
                body: JSON.stringify({ idList: [id] }),
            })
            const pubText = await pubRes.text()
            let pub: any
            try { pub = JSON.parse(pubText) } catch { pub = pubText }
            // publish có thể trả mảng kết quả / object; bắt lỗi phòng thủ
            const okFlag = pubRes.ok && (pub === true || (pub?.success !== false && pub?.error == null))
            if (!okFlag) {
                return { success: false, errorMessage: `Phát hành biên lai lỗi (HTTP ${pubRes.status}): ${pubText.slice(0, 250)}` }
            }
            const first = Array.isArray(pub) ? pub[0] : (pub?.data ? (Array.isArray(pub.data) ? pub.data[0] : pub.data) : pub)
            return {
                success: true,
                invoiceNumber: String(first?.SCTu || first?.no || first?.invoiceNo || first?.soBienLai || ''),
                lookupCode: String(first?.MTCuu || first?.lookupCode || first?.maTraCuu || id),
                pdfUrl: first?.pdfUrl || '',
            }
        } catch (err: any) {
            return { success: false, errorMessage: `VNPT biên lai lỗi: ${err.message}` }
        }
    }

    /** Biên lai NHÁP: xoá qua /ereceipt/delete. Biên lai ĐÃ PHÁT HÀNH: VNPT dùng
     * luồng thay thế/điều chỉnh (save kèm hdlienquan) — chưa hỗ trợ huỷ trực tiếp. */
    async cancelInvoice(config: EInvoiceProviderConfig, invoiceNumber: string, _reason: string): Promise<CancelResult> {
        try {
            const token = await this.getToken(config)
            const res = await fetch(`${this.base(config)}/ereceipt/api/ereceipt/delete`, {
                method: 'POST',
                headers: this.authHeaders(token),
                body: JSON.stringify([invoiceNumber]),
            })
            if (!res.ok) {
                const t = await res.text()
                return { success: false, errorMessage: `Xoá biên lai lỗi (HTTP ${res.status}): ${t.slice(0, 200)}. Biên lai đã phát hành cần dùng nghiệp vụ Thay thế/Điều chỉnh.` }
            }
            return { success: true }
        } catch (err: any) {
            return { success: false, errorMessage: `VNPT xoá biên lai lỗi: ${err.message}` }
        }
    }
}
