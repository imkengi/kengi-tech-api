const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const stores = [
    { code: 'KENGI-HCM', name: 'Kengi Tech - HCM (Demo)', schema: 'store_kengi', status: 'active' },
    { code: 'KENGI-HN', name: 'Kengi Tech - HN (Demo)', schema: 'store_kengi2311', status: 'active' },
];
async function main() {
    for (const s of stores) {
        const r = await p.store.upsert({ where: { code: s.code }, update: s, create: s });
        console.log('OK:', r.code, '->', r.schema);
    }
    await p.$disconnect();
}
main().catch(e => { console.error(e.message); p.$disconnect(); });
