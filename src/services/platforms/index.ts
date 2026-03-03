import { PlatformService, PlatformCredentials } from './base'
import { ShopeeService } from './shopee'
import { LazadaService } from './lazada'
import { TikTokService } from './tiktok'

export { PlatformService, PlatformCredentials, ShopeeService, LazadaService, TikTokService }
export type { PlatformOrder, PlatformOrderItem, TokenResponse, SyncResult } from './base'

const SUPPORTED_PLATFORMS = ['shopee', 'lazada', 'tiktok'] as const
export type SupportedPlatform = typeof SUPPORTED_PLATFORMS[number]

export function isSupportedPlatform(platform: string): platform is SupportedPlatform {
    return SUPPORTED_PLATFORMS.includes(platform as SupportedPlatform)
}

/**
 * Factory – creates the correct PlatformService for a given platform.
 * Returns null for platforms without API integration (website, facebook, zalo, other).
 */
export function getPlatformService(platform: string, credentials: PlatformCredentials): PlatformService | null {
    switch (platform) {
        case 'shopee': return new ShopeeService(credentials)
        case 'lazada': return new LazadaService(credentials)
        case 'tiktok': return new TikTokService(credentials)
        default: return null
    }
}
