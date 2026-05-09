// E-Invoice Provider Interface & Types

export interface EInvoiceData {
    // Seller info
    sellerTaxCode: string
    sellerName: string
    sellerAddress?: string

    // Buyer info
    buyerName: string
    buyerTaxCode?: string
    buyerAddress?: string
    buyerPhone?: string
    buyerEmail?: string

    // Invoice details
    templateId?: string
    serialNo?: string
    paymentMethod?: string  // TM, CK, TM/CK
    currencyCode?: string   // VND

    // Items
    items: EInvoiceItem[]

    // Totals
    subtotal: number
    vatRate: number         // 0, 5, 8, 10
    vatAmount: number
    total: number
    totalInWords?: string   // Bằng chữ

    // References
    transactionId: string
    receiptNumber: string
}

export interface EInvoiceItem {
    name: string
    unit: string
    quantity: number
    unitPrice: number
    amount: number          // quantity * unitPrice
    vatRate?: number
    vatAmount?: number
    discount?: number
}

export interface IssueResult {
    success: boolean
    invoiceNumber?: string
    lookupCode?: string
    pdfUrl?: string
    xmlData?: string
    errorMessage?: string
}

export interface CancelResult {
    success: boolean
    errorMessage?: string
}

export interface ConnectionTestResult {
    success: boolean
    message: string
    providerInfo?: string
}

export interface EInvoiceProviderConfig {
    apiUrl: string
    apiKey: string
    apiSecret: string
    taxCode: string
    templateId?: string
    serialNo?: string
    extra?: string // JSON
}

export interface IEInvoiceProvider {
    name: string
    testConnection(config: EInvoiceProviderConfig): Promise<ConnectionTestResult>
    issueInvoice(config: EInvoiceProviderConfig, data: EInvoiceData): Promise<IssueResult>
    cancelInvoice(config: EInvoiceProviderConfig, invoiceNumber: string, reason: string): Promise<CancelResult>
}
