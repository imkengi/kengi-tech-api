/**
 * Batch update script: adds storeId filtering to all route files
 * 
 * For each route file:
 * 1. Replace auth import to include getStoreId, getBranchId, AuthRequest
 * 2. Add `const storeId = getStoreId(req)` in each handler
 * 3. Add `storeId` to where clauses and create data
 */
const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, 'src', 'routes');

// Files already updated or that don't need storeId
const SKIP_FILES = new Set([
    'products.ts',
    'importData.ts',
    'auth.ts',        // Auth doesn't use storeId filtering
    'admin.ts',       // Admin may be global
    'storeSettings.ts', // Store settings uses storeId differently
]);

const files = fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.ts') && !SKIP_FILES.has(f));

for (const file of files) {
    const filePath = path.join(ROUTES_DIR, file);
    let content = fs.readFileSync(filePath, 'utf8');
    const original = content;

    // 1. Update auth import to include getStoreId, getBranchId, AuthRequest
    content = content.replace(
        /import\s*\{([^}]*)\}\s*from\s*'\.\.\/middleware\/auth'/,
        (match, imports) => {
            let importList = imports.split(',').map(s => s.trim()).filter(Boolean);
            if (!importList.includes('getStoreId')) importList.push('getStoreId');
            if (!importList.includes('AuthRequest')) importList.push('AuthRequest');
            if (!importList.includes('getBranchId')) importList.push('getBranchId');
            return `import { ${importList.join(', ')} } from '../middleware/auth'`;
        }
    );

    // 2. For each route handler, add storeId extraction after the try {
    // Pattern: router.get/post/put/delete('...', authMiddleware, async (req, res) => {
    // or: router.get/post/put/delete('...', authMiddleware, async (req: Request, res: Response) => {

    // Replace (req: Request with (req: AuthRequest
    content = content.replace(/\(req:\s*Request/g, '(req: AuthRequest');
    // Also handle (req, res) without type annotation
    content = content.replace(/authMiddleware,\s*async\s*\(req,/g, 'authMiddleware, async (req: AuthRequest,');

    // Get the model name from the file name
    const modelMap = {
        'categories.ts': 'category',
        'brands.ts': 'brand',
        'customers.ts': 'customer',
        'customerGroups.ts': 'customerGroup',
        'transactions.ts': 'transaction',
        'inventory.ts': 'inventoryTransaction',
        'importReceipts.ts': 'importReceipt',
        'expenses.ts': 'expense',
        'notifications.ts': 'notification',
        'warranties.ts': 'warranty',
        'repairs.ts': 'repair',
        'quotations.ts': 'quotation',
        'auditLogs.ts': 'auditLog',
        'priceHistory.ts': 'priceHistory',
        'shipping.ts': 'shippingOrder',
        'drivers.ts': 'driver',
        'tax.ts': 'taxConfig',
        'segments.ts': 'customerSegment',
        'currencies.ts': 'currency',
        'feedback.ts': 'feedback',
        'schedule.ts': 'schedule',
        'returns.ts': 'returnOrder',
        'debts.ts': 'debtEntry',
        'bundles.ts': 'bundle',
        'salesOrders.ts': 'salesOrder',
        'priceLists.ts': 'priceList',
        'promotions.ts': 'promotion',
        'suppliers.ts': 'supplier',
        'purchaseOrders.ts': 'purchaseOrder',
        'employees.ts': 'user',
        'branches.ts': 'branch',
        'salesTracking.ts': 'salesCheckin',
        'financialReports.ts': null, // dashboard-like, read-only
        'dashboard.ts': null,
        'priceHistory.ts': 'priceHistory',
        'apiKeys.ts': 'apiKey',
    };

    const modelName = modelMap[file];

    // For all handlers with try {, add storeId after it
    // We need to add `const storeId = getStoreId(req)` right after `try {` in handlers
    // BUT only if it's not already there
    if (!content.includes('getStoreId(req)') && modelName) {
        // Add storeId extraction after each `try {` that follows authMiddleware handler
        content = content.replace(
            /(authMiddleware,\s*async\s*\([^)]*\)\s*=>\s*\{\s*\n\s*)try\s*\{/g,
            '$1try {\n        const storeId = getStoreId(req)'
        );
    }

    // For models that need branchId too
    const branchModels = ['transaction', 'inventoryTransaction', 'importReceipt', 'expense', 'schedule', 'salesOrder', 'shippingOrder', 'returnOrder', 'salesCheckin'];
    if (branchModels.includes(modelName) && !content.includes('getBranchId(req)')) {
        content = content.replace(
            /const storeId = getStoreId\(req\)/g,
            'const storeId = getStoreId(req)\n        const branchId = getBranchId(req)'
        );
    }

    // 3. Add storeId to findMany/count where clauses
    // Pattern: prisma.modelName.findMany({ where: {} or where: { ... }
    if (modelName && modelName !== 'apiKey') {
        // Add storeId to `where: {` (simple cases)
        content = content.replace(
            new RegExp(`prisma\\.${modelName}\\.findMany\\(\\{\\s*where:\\s*\\{`, 'g'),
            `prisma.${modelName}.findMany({ where: { storeId,`
        );
        content = content.replace(
            new RegExp(`prisma\\.${modelName}\\.count\\(\\{\\s*where:\\s*\\{`, 'g'),
            `prisma.${modelName}.count({ where: { storeId,`
        );
        content = content.replace(
            new RegExp(`prisma\\.${modelName}\\.findMany\\(\\)`, 'g'),
            `prisma.${modelName}.findMany({ where: { storeId } })`
        );
        // findFirst already usually has a where
        content = content.replace(
            new RegExp(`prisma\\.${modelName}\\.findFirst\\(\\{\\s*where:\\s*\\{`, 'g'),
            `prisma.${modelName}.findFirst({ where: { storeId,`
        );
    }

    // 4. Add storeId to create data
    if (modelName && modelName !== 'apiKey') {
        content = content.replace(
            new RegExp(`prisma\\.${modelName}\\.create\\(\\{\\s*data:\\s*\\{`, 'g'),
            `prisma.${modelName}.create({ data: { storeId,`
        );
    }

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ Updated: ${file}`);
    } else {
        console.log(`⏭️  Skipped (no changes): ${file}`);
    }
}

console.log('\n✅ Done! All route files updated.');
