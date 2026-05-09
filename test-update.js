const https = require('https');

function makeReq(opts, data) {
    return new Promise((resolve, reject) => {
        const req = https.request(opts, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function main() {
    const loginData = JSON.stringify({ email: 'admin@kengi.vn', password: 'admin123', storeCode: 'KENGI-HCM' });
    const login = await makeReq({
        hostname: 'open-retail-api-production.up.railway.app',
        path: '/api/auth/login', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData) }
    }, loginData);

    const token = JSON.parse(login.body).data.token;
    console.log('Login OK');

    // Send data that mimics the form (with extra fields that should be ignored)
    const updateData = JSON.stringify({
        name: 'Áo thun Nike Dri-FIT',
        sku: 'NIKE-DRIFIT-L',
        costPrice: 550000,
        sellingPrice: 890000,
        stock: 60,
        // Extra fields from form that should be filtered out
        tags: ['nike', 'thể thao'],
        origin: 'Vietnam',
        weight: 200,
        weightUnit: 'g',
        color: 'Đen',
        material: 'Polyester',
        customAttributes: [{ name: 'Size', value: 'L' }],
        warrantyMonths: 3,
        internalNotes: 'Test update',
        images: [],
    });

    const update = await makeReq({
        hostname: 'open-retail-api-production.up.railway.app',
        path: '/api/products/prod-10', method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Content-Length': Buffer.byteLength(updateData) }
    }, updateData);

    console.log('Update status:', update.status);
    console.log('Update body:', update.body.substring(0, 300));
}

main().catch(e => console.error('Error:', e.message));
