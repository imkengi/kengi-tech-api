// EasyInvoice Provider (Skeleton — Local API)
import { IEInvoiceProvider, EInvoiceProviderConfig, EInvoiceData, IssueResult, CancelResult, ConnectionTestResult } from './types'

export class EasyInvoiceProvider implements IEInvoiceProvider {
    name = 'easyinvoice'

    async testConnection(config: EInvoiceProviderConfig): Promise<ConnectionTestResult> {
        try {
            const res = await fetch(`${config.apiUrl}/v1`, {
                headers: { 'Authorization': config.apiKey, 'Content-Type': 'application/json' },
            })
            return { success: res.ok, message: res.ok ? 'Kết nối EasyInvoice thành công!' : `Lỗi: ${res.status}` }
        } catch (err: any) {
            return { success: false, message: `Lỗi kết nối EasyInvoice: ${err.message}` }
        }
    }

    async issueInvoice(config: EInvoiceProviderConfig, data: EInvoiceData): Promise<IssueResult> {
        return { success: false, errorMessage: 'EasyInvoice: Vui lòng liên hệ để cấu hình Local API' }
    }

    async cancelInvoice(config: EInvoiceProviderConfig, invoiceNumber: string, reason: string): Promise<CancelResult> {
        return { success: false, errorMessage: 'EasyInvoice: Chưa implement' }
    }
}
