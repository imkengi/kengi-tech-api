// E-Invoice Provider Factory
import { IEInvoiceProvider } from './types'
import { MisaProvider } from './misa'
import { ViettelProvider } from './viettel'
import { VnptProvider } from './vnpt'
import { FptProvider } from './fpt'
import { EasyInvoiceProvider } from './easyinvoice'
import { BkavProvider } from './bkav'

const providers: Record<string, IEInvoiceProvider> = {
    misa: new MisaProvider(),
    viettel: new ViettelProvider(),
    vnpt: new VnptProvider(),
    fpt: new FptProvider(),
    easyinvoice: new EasyInvoiceProvider(),
    bkav: new BkavProvider(),
}

export function getProvider(name: string): IEInvoiceProvider | null {
    return providers[name] || null
}

export const PROVIDERS = [
    { id: 'misa', name: 'MISA meInvoice', status: 'ready', defaultUrl: 'https://api.meinvoice.vn/api/integration' },
    { id: 'viettel', name: 'Viettel S-Invoice', status: 'skeleton', defaultUrl: 'https://sinvoice.viettel.vn' },
    { id: 'vnpt', name: 'VNPT Invoice', status: 'skeleton', defaultUrl: 'https://demo.vnpt-invoice.com.vn' },
    { id: 'fpt', name: 'FPT eInvoice', status: 'skeleton', defaultUrl: 'https://fpt-einvoice.com' },
    { id: 'easyinvoice', name: 'EasyInvoice', status: 'skeleton', defaultUrl: 'http://localhost:8080' },
    { id: 'bkav', name: 'Bkav eHoacdon', status: 'skeleton', defaultUrl: 'https://ehoadon.bkav.com' },
]

export type { IEInvoiceProvider, EInvoiceProviderConfig, EInvoiceData, IssueResult, CancelResult, ConnectionTestResult } from './types'
