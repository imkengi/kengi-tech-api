import crypto from 'crypto'

// In-memory trusted-device store for the email-OTP login_2fa flow.
// Mirrors the OTP store pattern in lib/otp.ts (Map keyed by `userId:tokenHash`).
// Tokens are stored hashed (SHA-256); the raw token is only ever sent to the
// client at issuance time.

interface TrustedDeviceRecord {
    userId: string
    tokenHash: string
    userAgent: string
    createdAt: Date
    lastUsedAt: Date
    expiresAt: Date
}

const TRUSTED_DEVICE_TTL_DAYS = 30
const MAX_DEVICES_PER_USER = 10

const store = new Map<string, TrustedDeviceRecord>()

setInterval(() => {
    const now = Date.now()
    for (const [k, rec] of store) if (rec.expiresAt.getTime() < now) store.delete(k)
}, 60 * 60 * 1000)

function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex')
}

function key(userId: string, tokenHash: string): string {
    return `${userId}:${tokenHash}`
}

export function generateDeviceToken(): string {
    return crypto.randomBytes(32).toString('hex')
}

export function saveTrustedDevice(userId: string, token: string, userAgent: string): void {
    const tokenHash = hashToken(token)
    const now = new Date()
    const record: TrustedDeviceRecord = {
        userId,
        tokenHash,
        userAgent: userAgent || 'Unknown',
        createdAt: now,
        lastUsedAt: now,
        expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000),
    }
    store.set(key(userId, tokenHash), record)

    // Enforce per-user cap: drop oldest by createdAt when over the limit.
    const userRecords: Array<[string, TrustedDeviceRecord]> = []
    for (const [k, rec] of store) {
        if (rec.userId === userId) userRecords.push([k, rec])
    }
    if (userRecords.length > MAX_DEVICES_PER_USER) {
        userRecords.sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime())
        const overflow = userRecords.length - MAX_DEVICES_PER_USER
        for (let i = 0; i < overflow; i++) store.delete(userRecords[i][0])
    }
}

export function isDeviceTrusted(userId: string, token: string): boolean {
    if (!token) return false
    const tokenHash = hashToken(token)
    const rec = store.get(key(userId, tokenHash))
    if (!rec) return false
    if (rec.expiresAt.getTime() < Date.now()) {
        store.delete(key(userId, tokenHash))
        return false
    }
    rec.lastUsedAt = new Date()
    return true
}

export const TRUSTED_DEVICE_CONFIG = { TRUSTED_DEVICE_TTL_DAYS, MAX_DEVICES_PER_USER }
