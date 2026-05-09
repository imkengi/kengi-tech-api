import { PrismaClient } from '@prisma/client'

type CostPriceMethod = 'fixed' | 'average' | 'lastImport'

interface CostPriceInput {
    productId: string
    currentStock: number      // stock BEFORE this transaction
    currentCostPrice: number  // product.costPrice BEFORE this transaction
    transactionQty: number    // positive for import, negative for sale
    transactionUnitPrice: number // price per unit on this transaction
}

/**
 * Calculate the new cost price after a transaction based on the chosen method.
 * 
 * - fixed:      Keep product.costPrice unchanged
 * - average:    Weighted average: (oldStock * oldCost + newQty * newPrice) / newStock
 * - lastImport: Use the unit price from the latest import transaction
 */
export function calculateCostPrice(
    method: CostPriceMethod,
    input: CostPriceInput
): number {
    const { currentStock, currentCostPrice, transactionQty, transactionUnitPrice } = input

    switch (method) {
        case 'fixed':
            // Cost price never changes — use product's original costPrice
            return currentCostPrice

        case 'average': {
            // Only recalculate on imports (positive qty)
            if (transactionQty <= 0) return currentCostPrice
            const newStock = currentStock + transactionQty
            if (newStock <= 0) return currentCostPrice
            const weightedCost = (currentStock * currentCostPrice + transactionQty * transactionUnitPrice) / newStock
            return Math.round(weightedCost)
        }

        case 'lastImport':
            // Only update on imports — use the import price
            if (transactionQty <= 0) return currentCostPrice
            return transactionUnitPrice

        default:
            return currentCostPrice
    }
}

/**
 * Get the store's cost price method setting.
 * Returns 'fixed' as default if no store is found.
 */
export async function getCostPriceMethod(prisma: PrismaClient): Promise<CostPriceMethod> {
    try {
        const store = await prisma.store.findFirst()
        return ((store as any)?.costPriceMethod as CostPriceMethod) || 'fixed'
    } catch {
        return 'fixed'
    }
}
