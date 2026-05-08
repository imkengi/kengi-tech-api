import crypto from 'crypto'

// In-memory OTP store. Matches the existing refresh-token approach in auth.ts.
// Key: `${purpose}:${storeCode}:${email}` — scoped per store + purpose.
type OtpPurpose = 'login_2fa' | 'password_reset'

interface OtpRecord {
    codeHash: string
    expiresAt: Date
    attempts: number
    createdAt: Date
}

const OTP_TTL_MIN = 10
const MAX_ATTEMPTS = 5
const RESEND_COOLDOWN_SEC = 60

const store = new Map<string, OtpRecord>()
const lastSentAt = new Map<string, number>()

setInterval(() => {
    const now = Date.now()
    for (const [k, rec] of store) if (rec.expiresAt.getTime() < now) store.delete(k)
    for (const [k, t] of lastSentAt) if (now - t > RESEND_COOLDOWN_SEC * 1000) lastSentAt.delete(k)
}, 5 * 60 * 1000)

function key(purpose: OtpPurpose, storeCode: string, email: string) {
    return `${purpose}:${storeCode.toLowerCase()}:${email.trim().toLowerCase()}`
}

function hash(code: string) {
    return crypto.createHash('sha256').update(code).digest('hex')
}

export function generateOtpCode(): string {
    // 6-digit numeric, zero-padded
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

export function canSendOtp(purpose: OtpPurpose, storeCode: string, email: string): { ok: boolean; retryAfter?: number } {
    const k = key(purpose, storeCode, email)
    const last = lastSentAt.get(k)
    if (last) {
        const elapsed = (Date.now() - last) / 1000
        if (elapsed < RESEND_COOLDOWN_SEC) return { ok: false, retryAfter: Math.ceil(RESEND_COOLDOWN_SEC - elapsed) }
    }
    return { ok: true }
}

export function saveOtp(purpose: OtpPurpose, storeCode: string, email: string, code: string) {
    const k = key(purpose, storeCode, email)
    store.set(k, {
        codeHash: hash(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60 * 1000),
        attempts: 0,
        createdAt: new Date(),
    })
    lastSentAt.set(k, Date.now())
}

export type VerifyResult =
    | { ok: true }
    | { ok: false; reason: 'not_found' | 'expired' | 'too_many_attempts' | 'invalid' }

export function verifyOtp(purpose: OtpPurpose, storeCode: string, email: string, code: string): VerifyResult {
    const k = key(purpose, storeCode, email)
    const rec = store.get(k)
    if (!rec) return { ok: false, reason: 'not_found' }
    if (rec.expiresAt.getTime() < Date.now()) {
        store.delete(k)
        return { ok: false, reason: 'expired' }
    }
    if (rec.attempts >= MAX_ATTEMPTS) {
        store.delete(k)
        return { ok: false, reason: 'too_many_attempts' }
    }
    rec.attempts += 1
    const expected = rec.codeHash
    const got = hash(code)
    const a = Buffer.from(expected, 'hex')
    const b = Buffer.from(got, 'hex')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'invalid' }
    return { ok: true }
}

export function consumeOtp(purpose: OtpPurpose, storeCode: string, email: string) {
    store.delete(key(purpose, storeCode, email))
}

export const OTP_CONFIG = { OTP_TTL_MIN, MAX_ATTEMPTS, RESEND_COOLDOWN_SEC }
