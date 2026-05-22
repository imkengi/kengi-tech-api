// ═══════════════════════════════════════════════════════════════════════════════
// Error response helpers
//
// Keep internal error details out of API responses. In development we surface the
// real message to aid debugging; in every other environment we fall back to a
// generic message so SQL errors, constraint names, file paths, and other internal
// details are never leaked to clients.
// ═══════════════════════════════════════════════════════════════════════════════

const isDev = (): boolean => process.env.NODE_ENV === 'development'

/**
 * For the `error:` field of a response.
 * Returns the real error message in development, otherwise the generic fallback.
 */
export function errMsg(err: unknown, fallback = 'Internal server error'): string {
    if (isDev()) {
        if (err instanceof Error && err.message) return err.message
        if (typeof err === 'string' && err) return err
    }
    return fallback
}

/**
 * For an optional `detail:` field of a response.
 * Returns the real error message in development, otherwise `undefined` so the
 * key is omitted entirely from the serialized JSON in production.
 */
export function errorDetail(err: unknown): string | undefined {
    if (!isDev()) return undefined
    if (err instanceof Error) return err.message
    if (typeof err === 'string') return err
    return undefined
}
