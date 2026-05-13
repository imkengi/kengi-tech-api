// ═══════════════════════════════════════════════════════════════════════════════
// Code Generator — Atomic, race-free codes via Postgres sequences
//
// Replaces the old `count(*) + 1` + retry pattern, which generates duplicates
// under concurrent inserts (two parallel transactions both read the same count
// and produce the same code, even with the unique-index retry loop).
//
// Postgres sequences are non-transactional and atomic — nextval always returns
// a fresh value even if the surrounding transaction rolls back (gaps are fine,
// duplicates are not). Sequences live in the connected search_path schema, so
// each store schema gets its own counters automatically.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the next atomic code for a given sequence.
 *
 * @param prisma  Schema-scoped Prisma client (or transaction tx)
 * @param sequenceName  Sequence identifier (alphanumeric + underscore only)
 * @param prefix  String prefix prepended to the padded number (e.g. "TRIP")
 * @param padLength  Width of the numeric portion (zero-padded)
 * @param separator  Separator between prefix and number; defaults to "-".
 *                   Use "" for codes like "PN001" or "KH001".
 * @param tableName  Optional table to seed the sequence from (e.g. "SalesTrip").
 *                   When provided with codeColumn, the first nextval is preceded
 *                   by a setval past the max existing numeric suffix, so freshly
 *                   created sequences don't collide with pre-existing rows.
 * @param codeColumn  Column on tableName holding the existing codes (e.g. "code").
 */
export async function nextCode(
    prisma: any,
    sequenceName: string,
    prefix: string,
    padLength: number,
    separator: string = '-',
    tableName?: string,
    codeColumn?: string,
): Promise<string> {
    if (!/^[A-Za-z0-9_]+$/.test(sequenceName)) {
        throw new Error(`Invalid sequence name: ${sequenceName}`)
    }
    // CREATE SEQUENCE IF NOT EXISTS is idempotent and cheap. We don't cache
    // because DDL inside a transaction rolls back with the transaction —
    // skipping ensure based on a memoized flag would leave a torn cache after
    // a rollback. Sequence advances themselves are NOT rolled back, which is
    // exactly what we want for unique-code generation.
    await prisma.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS "${sequenceName}"`)

    // Seed the sequence past any pre-existing rows the first time it is used.
    // CREATE SEQUENCE starts at 1, which collides with historical codes like
    // TRIP-00001 inserted before this generator existed. is_called=false means
    // nextval has never been called on this sequence (true right after CREATE,
    // also true again after a rollback recreates it), so this is the right
    // moment to advance past the table's current MAX. setval is not rolled
    // back, so once a non-rolled-back transaction seeds it, it stays seeded.
    if (tableName && codeColumn) {
        if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
            throw new Error(`Invalid table name: ${tableName}`)
        }
        if (!/^[A-Za-z0-9_]+$/.test(codeColumn)) {
            throw new Error(`Invalid column name: ${codeColumn}`)
        }
        const state = (await prisma.$queryRawUnsafe(
            `SELECT is_called FROM "${sequenceName}"`,
        )) as Array<{ is_called: boolean }>
        if (state[0] && !state[0].is_called) {
            const fullPrefix = `${prefix}${separator}`
            const suffixStart = fullPrefix.length + 1 // Postgres substring is 1-indexed
            const pattern = `^${fullPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[0-9]+$`
            const rows = (await prisma.$queryRawUnsafe(
                `SELECT COALESCE(MAX(substring("${codeColumn}" FROM ${suffixStart})::bigint), 0) AS m FROM "${tableName}" WHERE "${codeColumn}" ~ $1`,
                pattern,
            )) as Array<{ m: bigint | number }>
            const maxN = Number(rows[0]?.m ?? 0)
            if (maxN > 0) {
                await prisma.$executeRawUnsafe(`SELECT setval('"${sequenceName}"', ${maxN})`)
            }
        }
    }

    const rows = (await prisma.$queryRawUnsafe(
        `SELECT nextval('"${sequenceName}"') AS n`,
    )) as Array<{ n: bigint | number }>
    const n = Number(rows[0]?.n ?? 0)
    return `${prefix}${separator}${String(n).padStart(padLength, '0')}`
}

// True when Prisma raises a unique-constraint violation that mentions the
// `code` column. Used to drive retry loops around code-minting inserts.
export function isCodeUniqueViolation(err: any): boolean {
    if (!err || err.code !== 'P2002') return false
    const target = err.meta?.target
    if (Array.isArray(target)) return target.some((t: any) => typeof t === 'string' && t.includes('code'))
    if (typeof target === 'string') return target.includes('code')
    // P2002 without target detail — assume code (safer to retry than to 500).
    return true
}

/**
 * Run `fn` and retry it whenever it fails with a unique-constraint violation
 * on a `code` column. Pairs with `nextCode`: each retry calls nextval again,
 * advancing past any pre-existing rows that were inserted before the sequence
 * was introduced. After `maxRetries`, the last error is re-thrown.
 */
export async function withCodeCollisionRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 50,
): Promise<T> {
    let lastErr: any
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn()
        } catch (err: any) {
            if (!isCodeUniqueViolation(err)) throw err
            lastErr = err
        }
    }
    throw lastErr
}
