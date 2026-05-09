/**
 * Fix broken expressions left by the migration script.
 * Handles patterns like:
 *   storeId: tx.     → (remove line)
 *   storeId=${}      → (remove or fix)
 *   products:${}:*   → products:*
 *   storeId: request. → (remove line) 
 *   storeId: c.      → (remove line)
 *   storeId: e.      → (remove line)
 */

import * as fs from 'fs'
import * as path from 'path'

const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes')
const files = fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.ts'))

let totalFixed = 0

for (const file of files) {
    const filePath = path.join(ROUTES_DIR, file)
    let content = fs.readFileSync(filePath, 'utf-8')
    let changed = false

    // 1. Fix `storeId: tx.` or `storeId: e.` or `storeId: c.` or `storeId: p.` or `storeId: d.` (broken incomplete lines)
    const brokenStoreIdLine = /^\s*storeId: \w+\.\s*$/gm
    if (brokenStoreIdLine.test(content)) {
        content = content.replace(brokenStoreIdLine, '')
        changed = true
    }

    // 1b. Fix `storeId: request.` pattern
    content = content.replace(/,?\s*storeId: request\.\s*\n/g, () => { changed = true; return '\n' })

    // 2. Fix broken template literals: `storeId=${}` → remove
    content = content.replace(/,?\s*storeId=\$\{\}/g, () => { changed = true; return '' })

    // 3. Fix `products:${}:*` → `products:${req.user?.storeSchema || 'default'}:*`
    content = content.replace(/`products:\$\{\}:/g, () => { changed = true; return '`products:${req.user?.storeSchema || \'default\'}:' })

    // 4. Fix any remaining bare `storeId` in where clauses that look broken
    // Pattern: `{ storeId: request.branchCode }` → `{ code: request.branchCode }` (admin branch check)
    content = content.replace(/storeId: request\.code: request\.branchCode/g, () => { changed = true; return 'code: request.branchCode' })

    // 5. Fix template `storeId=${storeId}` references in console.log that no longer have storeId
    content = content.replace(/storeId=\$\{storeId\}/g, () => { changed = true; return '' })

    // 6. Fix standalone `storeId` references inside `select` clauses (like `storeId: true`)
    // These should be removed from select since the field no longer exists in store schema
    content = content.replace(/\s*storeId: true,?\s*$/gm, (match, offset) => {
        // Check if this is inside a select clause by looking at context
        const context = content.substring(Math.max(0, offset - 200), offset)
        if (context.includes('select:') || context.includes('Select')) {
            changed = true
            return '\n'
        }
        return match
    })

    // 7. Fix `{ storeId: store.id }` patterns (admin route branch finding)
    content = content.replace(/where: \{ storeId: store\.id, code \}/g, () => { changed = true; return 'where: { code }' })
    content = content.replace(/storeId: store\.id, /g, () => { changed = true; return '' })
    content = content.replace(/, storeId: store\.id/g, () => { changed = true; return '' })

    // 8. Clean up double commas and empty objects from removals
    content = content.replace(/,\s*,/g, ',')
    content = content.replace(/\{\s*,/g, '{')
    content = content.replace(/,\s*\}/g, ' }')

    // 9. Fix `findOrCreateCategory(storeId,` → `findOrCreateCategory(`  (importData.ts)
    content = content.replace(/findOrCreateCategory\(storeId,\s*/g, () => { changed = true; return 'findOrCreateCategory(' })
    content = content.replace(/findOrCreateBrand\(storeId,\s*/g, () => { changed = true; return 'findOrCreateBrand(' })

    // 10. Fix `findOrCreateCategory(storeId: string,` → remove storeId param
    content = content.replace(/findOrCreateCategory\(storeId: string, /g, () => { changed = true; return 'findOrCreateCategory(' })
    content = content.replace(/findOrCreateBrand\(storeId: string, /g, () => { changed = true; return 'findOrCreateBrand(' })

    // 11. Fix `resolveBranchId(req, storeId)` → `resolveBranchId(req)` 
    content = content.replace(/resolveBranchId\(req, storeId\)/g, () => { changed = true; return 'resolveBranchId(req)' })

    // 12. Fix `resolveBranchId(req: AuthRequest, storeId: string)` → remove storeId param
    content = content.replace(/resolveBranchId\(req: AuthRequest, storeId: string\)/g, () => { changed = true; return 'resolveBranchId(req: AuthRequest)' })

    if (changed) {
        fs.writeFileSync(filePath, content, 'utf-8')
        console.log(`✅ Fixed: ${file}`)
        totalFixed++
    }
}

console.log(`\n✅ Fixed ${totalFixed} files`)
