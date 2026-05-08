import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('Connecting to DB to fix old totals...')
    const schemas: any[] = await prisma.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'branch_%'`
    console.log(`Found ${schemas.length} schemas.`)

    for (const s of schemas) {
        const schemaName = s.nspname
        console.log(`Updating schema ${schemaName}...`)
        
        try {
            // Update OnlineOrder: discount = 0, total = subtotal, netRevenue = subtotal - shippingFee - platformFee
            await prisma.$executeRawUnsafe(`
                UPDATE "${schemaName}"."OnlineOrder" 
                SET discount = 0, 
                    total = subtotal, 
                    "netRevenue" = subtotal - "shippingFee" - "platformFee"
            `)
            
            // Update Transaction for online orders
            await prisma.$executeRawUnsafe(`
                UPDATE "${schemaName}"."Transaction" 
                SET discount = 0, 
                    total = subtotal, 
                    "amountReceived" = subtotal 
                WHERE "receiptNumber" LIKE 'ONLINE-%' 
                   OR "receiptNumber" LIKE 'SPE-%' 
                   OR "receiptNumber" LIKE 'TIK-%' 
                   OR "receiptNumber" LIKE 'LZD-%'
            `)

            // Update Payments for those transactions
            await prisma.$executeRawUnsafe(`
                UPDATE "${schemaName}"."Payment" p
                SET amount = t.total
                FROM "${schemaName}"."Transaction" t
                WHERE p."transactionId" = t.id
                  AND (t."receiptNumber" LIKE 'ONLINE-%' 
                       OR t."receiptNumber" LIKE 'SPE-%' 
                       OR t."receiptNumber" LIKE 'TIK-%' 
                       OR t."receiptNumber" LIKE 'LZD-%')
            `)

            console.log(`Successfully fixed totals for ${schemaName}`)
        } catch (e: any) {
            console.error(`Error updating ${schemaName}:`, e.message)
        }
    }
}

main()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect()
        console.log('Done.')
    })
