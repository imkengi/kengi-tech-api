/**
 * Migrates all route files from single-DB (storeId filtering) to multi-schema.
 * 
 * Pattern changes:
 * 1. Remove `import prisma from '../lib/prisma'`  
 * 2. Remove `const storeId = getStoreId(req)` lines
 * 3. Replace `{ storeId, ...` → `{ ...` in where clauses
 * 4. Replace `{ storeId }` → `{}` in simple where clauses (or remove altogether)
 * 5. Add `const prisma = (req as AuthRequest).storePrisma!` where needed
 * 6. Remove storeId from data objects on create
 * 7. Update import to remove getStoreId
 */

import * as fs from 'fs'
import * as path from 'path'

const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes')

// Skip auth.ts (already updated) and dashboard.ts (already updated)
const SKIP_FILES = ['auth.ts', 'dashboard.ts']

function migrateFile(filePath: string): void {
    let content = fs.readFileSync(filePath, 'utf-8')
    const fileName = path.basename(filePath)
    let changed = false

    // 1. Replace `import prisma from '../lib/prisma'` with nothing (we'll use req.storePrisma)
    if (content.includes("import prisma from '../lib/prisma'")) {
        content = content.replace("import prisma from '../lib/prisma'\r\n", '')
        content = content.replace("import prisma from '../lib/prisma'\n", '')
        changed = true
    }

    // 2. Remove getStoreId from auth import if present, but keep others
    content = content.replace(
        /import\s*\{([^}]*)\}\s*from\s*'\.\.\/middleware\/auth'/g,
        (match, imports) => {
            const importList = imports.split(',').map((s: string) => s.trim()).filter((s: string) => s && s !== 'getStoreId')
            if (importList.length === 0) return ''
            changed = true
            return `import { ${importList.join(', ')} } from '../middleware/auth'`
        }
    )

    // 3. Remove lines like `const storeId = getStoreId(req)` or `const storeId = req.user!.storeId`
    const storeIdLineRegex = /^[ \t]*const storeId = .*\r?\n/gm
    if (storeIdLineRegex.test(content)) {
        content = content.replace(storeIdLineRegex, '')
        changed = true
    }

    // 4. Add `const prisma = req.storePrisma!` after lines that have `async (req: AuthRequest`
    // We detect route handlers and inject the prisma line
    content = content.replace(
        /async\s*\(\s*req:\s*AuthRequest\s*,\s*res:\s*Response\s*\)\s*=>\s*\{\s*\r?\n\s*try\s*\{/g,
        (match) => {
            changed = true
            return match + '\n        const prisma = req.storePrisma!'
        }
    )

    // 5. Remove storeId from where clauses: `{ storeId, ` → `{ ` and `{ storeId }` → `{}`
    content = content.replace(/\{\s*storeId\s*,\s*/g, () => { changed = true; return '{ ' })
    content = content.replace(/,\s*storeId\s*\}/g, () => { changed = true; return ' }' })
    content = content.replace(/,\s*storeId\s*,/g, () => { changed = true; return ',' })
    content = content.replace(/\{\s*storeId\s*\}/g, () => { changed = true; return '{}' })

    // 6. Remove `storeId,` or `storeId: storeId,` from data objects (creates)
    content = content.replace(/\s*storeId,\r?\n/g, () => { changed = true; return '\n' })
    content = content.replace(/\s*storeId:\s*storeId\s*,?\r?\n/g, () => { changed = true; return '\n' })
    content = content.replace(/storeId\s*,\s*/g, (match, offset) => {
        // Be careful not to remove storeId from export/import statements
        const context = content.substring(Math.max(0, offset - 30), offset)
        if (context.includes('import') || context.includes('export')) return match
        changed = true
        return ''
    })

    // 7. Remove standalone `storeId` in where objects like `where: { storeId }` 
    // Handle patterns like `where: { storeId, ...getBranchFilter(req) }`
    content = content.replace(/where:\s*\{\s*storeId\s*,\s*\.\.\.getBranchFilter/g, () => {
        changed = true; return 'where: { ...getBranchFilter'
    })

    // 8. Clean up `...getBranchFilter(req as any),  ...getBranchFilter(req as any)` duplicates
    content = content.replace(/\.\.\.getBranchFilter\(req\s*(?:as\s*any)?\s*\)\s*,\s*\.\.\.getBranchFilter\(req\s*(?:as\s*any)?\s*\)/g, () => {
        changed = true
        return '...getBranchFilter(req as any)'
    })

    // 9. Remove `storeId: null` patterns in where clauses
    content = content.replace(/where:\s*\{\s*storeId:\s*null\s*\}/g, () => { changed = true; return 'where: {}' })

    // 10. Clean up any remaining `{ , ` patterns
    content = content.replace(/\{\s*,\s*/g, '{ ')

    // 11. Remove references to `...getBranchFilter(req),  ...getBranchFilter(req)` but keep single instance
    // Already handled above

    if (changed) {
        fs.writeFileSync(filePath, content, 'utf-8')
        console.log(`✅ Migrated: ${fileName}`)
    } else {
        console.log(`⏭️  No changes: ${fileName}`)
    }
}

// ─── Main ───────────────────────────────────────────────────────────────────

const files = fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.ts') && !SKIP_FILES.includes(f))

console.log(`\n🔄 Migrating ${files.length} route files...\n`)

for (const file of files) {
    try {
        migrateFile(path.join(ROUTES_DIR, file))
    } catch (err: any) {
        console.error(`❌ Failed: ${file} — ${err.message}`)
    }
}

console.log(`\n✅ Migration complete!`)
