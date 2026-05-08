// Viettel S-Invoice Provider (Skeleton)
import { IEInvoiceProvider, EInvoiceProviderConfig, EInvoiceData, IssueResult, CancelResult, ConnectionTestResult } from './types'

export class ViettelProvider implements IEInvoiceProvider {
    name = 'viettel'

    async testConnection(config: EInvoiceProviderConfig): Promise<ConnectionTestResult> {
        try {
            const res = await fetch(`${config.apiUrl}/services/einvoiceapplication/api/InvoiceAPI/InvoiceWS/searchInvoiceByTransactionUuid`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
                body: JSON.stringify({ supplierTaxCode: config.taxCode }),
            })
            return { success: res.ok, message: res.ok ? 'Kết nối Viettel thành công!' : `Lỗi: ${res.status}` }
        } catch (err: any) {
            return { success: false, message: `Lỗi kết nối Viettel: ${err.message}` }
        }
    }

    async issueInvoice(config: EInvoiceProviderConfig, data: EInvoiceData): Promise<IssueResult> {
        // TODO: Implement Viettel S-Invoice API
        // Docs: https://sinvoice.viettel.vn
        return { success: false, errorMessage: 'Viettel S-Invoice: Vui lòng liên hệ để cấu hình API chi tiết' }
    }

    async cancelInvoice(config: EInvoiceProviderConfig, invoiceNumber: string, reason: string): Promise<CancelResult> {
        return { success: false, errorMessage: 'Viettel: Chưa implement' }
    }
}
