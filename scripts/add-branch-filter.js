/**
 * Script to add getBranchFilter import and usage to all route files
 * that import getStoreId from auth middleware.
 */
const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '..', 'src', 'routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.ts'));

// Files to skip (they don't need branch filtering or handle it separately)
const SKIP = ['admin.ts', 'auth.ts', 'apiKeys.ts', 'uploads.ts', 'sync.ts', 'storeSettings.ts'];

let updated = 0;

for (const file of files) {
    if (SKIP.includes(file)) continue;

    const filePath = path.join(routesDir, file);
    let content = fs.readFileSync(filePath, 'utf-8');

    // Skip if already has getBranchFilter
    if (content.includes('getBranchFilter')) continue;

    // Check if it imports from auth middleware
    if (!content.includes('getStoreId')) continue;

    // Add getBranchFilter to import
    const oldImport = content.match(/import\s*\{([^}]*getStoreId[^}]*)\}\s*from\s*['"]\.\.\/middleware\/auth['"]/);
    if (!oldImport) continue;

    const newImportList = oldImport[1].trim().replace(/getStoreId/, 'getStoreId, getBranchFilter');
    content = content.replace(oldImport[0], `import { ${newImportList} } from '../middleware/auth'`);

    // Add branch filter to findMany where clauses that use storeId
    // Pattern: where: { storeId, ... } -> where: { storeId, ...getBranchFilter(req as any), ... }
    // Only add to lines that already reference storeId in a where clause and don't have branchId

    // For simple cases: where: { storeId }
    content = content.replace(
        /where:\s*\{\s*storeId\s*\}/g,
        'where: { storeId, ...getBranchFilter(req as any) }'
    );

    // For cases: where: { storeId, (other stuff) } - add getBranchFilter
    content = content.replace(
        /where:\s*\{\s*storeId,\s*(?!\.\.\.getBranchFilter)/g,
        'where: { storeId, ...getBranchFilter(req as any), '
    );

    fs.writeFileSync(filePath, content);
    updated++;
    console.log(`Updated: ${file}`);
}

console.log(`\nDone. Updated ${updated} files.`);
