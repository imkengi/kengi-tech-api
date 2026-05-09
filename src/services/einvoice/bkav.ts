// Bkav eHoadon Provider (Skeleton)
import { IEInvoiceProvider, EInvoiceProviderConfig, EInvoiceData, IssueResult, CancelResult, ConnectionTestResult } from './types'

export class BkavProvider implements IEInvoiceProvider {
    name = 'bkav'

    async testConnection(config: EInvoiceProviderConfig): Promise<ConnectionTestResult> {
        try {
            const res = await fetch(`${config.apiUrl}/api/test`, {
                headers: { 'Authorization': `Bearer ${config.apiKey}` },
            })
            return { success: res.ok, message: res.ok ? 'Kết nối Bkav eHoadon thành công!' : `Lỗi: ${res.status}` }
        } catch (err: any) {
            return { success: false, message: `Lỗi kết nối Bkav: ${err.message}` }
        }
    }

    async issueInvoice(config: EInvoiceProviderConfig, data: EInvoiceData): Promise<IssueResult> {
        return { success: false, errorMessage: 'Bkav eHoadon: Vui lòng liên hệ để cấu hình API' }
    }

    async cancelInvoice(config: EInvoiceProviderConfig, invoiceNumber: string, reason: string): Promise<CancelResult> {
        return { success: false, errorMessage: 'Bkav: Chưa implement' }
    }
}
