// MISA meInvoice Provider Adapter
// Docs: https://api.meinvoice.vn (production), https://testapi.meinvoice.vn (test)

import { IEInvoiceProvider, EInvoiceProviderConfig, EInvoiceData, IssueResult, CancelResult, ConnectionTestResult } from './types'

export class MisaProvider implements IEInvoiceProvider {
    name = 'misa'

    async testConnection(config: EInvoiceProviderConfig): Promise<ConnectionTestResult> {
        try {
            // Step 1: Get auth token
            const tokenRes = await fetch(`${config.apiUrl}/auth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: config.apiKey, password: config.apiSecret }),
            })
            if (!tokenRes.ok) {
                return { success: false, message: `Auth failed: ${tokenRes.status} ${tokenRes.statusText}` }
            }
            const tokenData = await tokenRes.json() as any
            if (!tokenData?.token && !tokenData?.access_token) {
                return { success: false, message: 'Không nhận được token từ MISA' }
            }
            return { success: true, message: 'Kết nối MISA thành công!', providerInfo: `Token: ${(tokenData.token || tokenData.access_token).substring(0, 20)}...` }
        } catch (err: any) {
            return { success: false, message: `Lỗi kết nối: ${err.message}` }
        }
    }

    private async getToken(config: EInvoiceProviderConfig): Promise<string> {
        const res = await fetch(`${config.apiUrl}/auth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: config.apiKey, password: config.apiSecret }),
        })
        const data = await res.json() as any
        return data.token || data.access_token || ''
    }

    async issueInvoice(config: EInvoiceProviderConfig, data: EInvoiceData): Promise<IssueResult> {
        try {
            const token = await this.getToken(config)
            if (!token) return { success: false, errorMessage: 'Không lấy được token MISA' }

            // Build MISA invoice payload
            const payload = {
                InvoiceTypeID: 1, // Hóa đơn GTGT
                InvoiceDate: new Date().toISOString(),
                CurrencyCode: data.currencyCode || 'VND',
                ExchangeRate: 1,
                PaymentMethodName: data.paymentMethod || 'TM/CK',
                BuyerLegalName: data.buyerName,
                BuyerTaxCode: data.buyerTaxCode || '',
                BuyerAddress: data.buyerAddress || '',
                BuyerPhoneNumber: data.buyerPhone || '',
                BuyerEmail: data.buyerEmail || '',
                InvoiceTemplateName: config.templateId || '',
                InvoiceSerialName: config.serialNo || '',
                TotalAmount: data.subtotal,
                TotalVATAmount: data.vatAmount,
                TotalAmountWithVAT: data.total,
                TotalAmountInWords: data.totalInWords || '',
                ListInvoiceDetailsWS: data.items.map((item, idx) => ({
                    LineNumber: idx + 1,
                    ItemName: item.name,
                    UnitName: item.unit,
                    Quantity: item.quantity,
                    UnitPrice: item.unitPrice,
                    Amount: item.amount,
                    VATRateName: item.vatRate !== undefined ? `${item.vatRate}%` : `${data.vatRate}%`,
                    VATAmount: item.vatAmount || 0,
                    DiscountAmount: item.discount || 0,
                })),
                OriginalInvoiceIdentify: data.receiptNumber,
            }

            const res = await fetch(`${config.apiUrl}/invoice`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            })

            const result = await res.json() as any

            if (res.ok && (result.ok || result.Success || result.InvoiceNo)) {
                return {
                    success: true,
                    invoiceNumber: result.InvoiceNo || result.invoiceNumber || result.RefID || '',
                    lookupCode: result.LookupCode || result.TransactionID || '',
                    pdfUrl: result.PDFUrl || result.FileUrl || '',
                }
            }

            return {
                success: false,
                errorMessage: result.message || result.ErrorMessage || result.Errors?.[0]?.Message || `HTTP ${res.status}`,
            }
        } catch (err: any) {
            return { success: false, errorMessage: `MISA error: ${err.message}` }
        }
    }

    async cancelInvoice(config: EInvoiceProviderConfig, invoiceNumber: string, reason: string): Promise<CancelResult> {
        try {
            const token = await this.getToken(config)
            if (!token) return { success: false, errorMessage: 'Không lấy được token MISA' }

            const res = await fetch(`${config.apiUrl}/invoice/cancel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ InvoiceNo: invoiceNumber, CancelReason: reason }),
            })
            const result = await res.json() as any

            if (res.ok && (result.ok || result.Success)) {
                return { success: true }
            }
            return { success: false, errorMessage: result.message || result.ErrorMessage || `HTTP ${res.status}` }
        } catch (err: any) {
            return { success: false, errorMessage: `MISA cancel error: ${err.message}` }
        }
    }
}
