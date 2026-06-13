// Sửa chuỗi tiếng Việt bị double-encode UTF-8→Win-1252 ("Bán" → "BÃƒÂ¡n").
// Port từ FE open-retail/src/lib/utils/fixMojibake.ts — dùng cho job sửa dữ
// liệu cũ trong DB (POST /admin/fix-online-journal).

const WIN1252_REVERSE: Record<number, number> = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
    0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
    0x017E: 0x9E, 0x0178: 0x9F,
}
const WIN1252_REVERSE_SET = new Set<number>(Object.keys(WIN1252_REVERSE).map(Number))

function isMojibake(s: string): boolean {
    for (let i = 0; i < s.length - 1; i++) {
        const cp = s.charCodeAt(i)
        const cp2 = s.charCodeAt(i + 1)
        const isCont = (cp2 >= 0x80 && cp2 <= 0xBF) || WIN1252_REVERSE_SET.has(cp2)
        if (cp >= 0xC0 && cp <= 0xDF && isCont) return true
        if (cp >= 0xE0 && cp <= 0xEF && isCont) return true
    }
    return false
}

function charToByte(cp: number): number {
    if (cp <= 255) return cp
    const mapped = WIN1252_REVERSE[cp]
    return mapped !== undefined ? mapped : -1
}

function tryDecode(s: string): string {
    if (s.length < 2) return s
    try {
        const bytes = new Uint8Array(s.length)
        for (let i = 0; i < s.length; i++) {
            const b = charToByte(s.charCodeAt(i))
            if (b < 0) return s
            bytes[i] = b
        }
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        if (decoded.length <= s.length) return decoded
    } catch { /* not valid UTF-8 */ }
    return s
}

export function fixMojibake(s: string | null | undefined): string {
    if (!s) return s ?? ''
    if (!isMojibake(s)) return s

    let allMappable = true
    for (let i = 0; i < s.length; i++) {
        if (charToByte(s.charCodeAt(i)) < 0) { allMappable = false; break }
    }

    if (allMappable) {
        const decoded = tryDecode(s)
        if (decoded !== s) {
            if (isMojibake(decoded)) {
                const decoded2 = fixMojibake(decoded)
                if (decoded2 !== decoded) return decoded2
            }
            return decoded
        }
        return s
    }

    // Mixed: decode only mappable segments
    const segments: string[] = []
    let buf = ''
    for (let i = 0; i < s.length; i++) {
        const b = charToByte(s.charCodeAt(i))
        if (b >= 0) {
            buf += s[i]
        } else {
            if (buf) { segments.push(isMojibake(buf) ? tryDecode(buf) : buf); buf = '' }
            segments.push(s[i] as string)
        }
    }
    if (buf) segments.push(isMojibake(buf) ? tryDecode(buf) : buf)
    const result = segments.join('')
    if (result !== s) {
        if (isMojibake(result)) return fixMojibake(result)
        return result
    }
    return s
}
