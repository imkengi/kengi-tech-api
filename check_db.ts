import prisma from './src/lib/prisma'

async function main() {
    // Test customers query directly
    const [total, customers] = await Promise.all([
        prisma.customer.count(),
        prisma.customer.findMany({
            include: { group: true },
            orderBy: { createdAt: 'desc' },
            take: 5,
        }),
    ])

    console.log('Total customers:', total)
    customers.forEach(c => {
        console.log(`- ${c.name} (${c.phone}), debt: ${c.debt}, code: ${c.code}`)
    })

    await prisma.$disconnect()
}

main().catch(e => {
    console.error('Error:', e.message)
    process.exit(1)
})
