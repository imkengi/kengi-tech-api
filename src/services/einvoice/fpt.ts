// FPT eInvoice Provider (Skeleton)
import { IEInvoiceProvider, EInvoiceProviderConfig, EInvoiceData, IssueResult, CancelResult, ConnectionTestResult } from './types'

export class FptProvider implements IEInvoiceProvider {
    name = 'fpt'

    async testConnection(config: EInvoiceProviderConfig): Promise<ConnectionTestResult> {
        try {
            const res = await fetch(`${config.apiUrl}/api/health`, { headers: { 'Authorization': `Bearer ${config.apiKey}` } })
            return { success: res.ok, message: res.ok ? 'Kết nối FPT eInvoice thành công!' : `Lỗi: ${res.status}` }
        } catch (err: any) {
            return { success: false, message: `Lỗi kết nối FPT: ${err.message}` }
        }
    }

    async issueInvoice(config: EInvoiceProviderConfig, data: EInvoiceData): Promise<IssueResult> {
        return { success: false, errorMessage: 'FPT eInvoice: Vui lòng liên hệ để cấu hình API' }
    }

    async cancelInvoice(config: EInvoiceProviderConfig, invoiceNumber: string, reason: string): Promise<CancelResult> {
        return { success: false, errorMessage: 'FPT: Chưa implement' }
    }
}
