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
 */
export async function nextCode(
    prisma: any,
    sequenceName: string,
    prefix: string,
    padLength: number,
    separator: string = '-',
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
    const rows = (await prisma.$queryRawUnsafe(
        `SELECT nextval('"${sequenceName}"') AS n`,
    )) as Array<{ n: bigint | number }>
    const n = Number(rows[0]?.n ?? 0)
    return `${prefix}${separator}${String(n).padStart(padLength, '0')}`
}
