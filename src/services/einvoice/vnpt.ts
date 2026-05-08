// VNPT Invoice Provider (Skeleton — SOAP-based)
import { IEInvoiceProvider, EInvoiceProviderConfig, EInvoiceData, IssueResult, CancelResult, ConnectionTestResult } from './types'

export class VnptProvider implements IEInvoiceProvider {
    name = 'vnpt'

    async testConnection(config: EInvoiceProviderConfig): Promise<ConnectionTestResult> {
        try {
            const res = await fetch(`${config.apiUrl}/publishservice.asmx`, { method: 'GET' })
            return { success: res.ok, message: res.ok ? 'Kết nối VNPT thành công!' : `Lỗi: ${res.status}` }
        } catch (err: any) {
            return { success: false, message: `Lỗi kết nối VNPT: ${err.message}` }
        }
    }

    async issueInvoice(config: EInvoiceProviderConfig, data: EInvoiceData): Promise<IssueResult> {
        return { success: false, errorMessage: 'VNPT Invoice: Vui lòng liên hệ để cấu hình SOAP API' }
    }

    async cancelInvoice(config: EInvoiceProviderConfig, invoiceNumber: string, reason: string): Promise<CancelResult> {
        return { success: false, errorMessage: 'VNPT: Chưa implement' }
    }
}
