const http = require('https');
const data = JSON.stringify({ email: 'admin@kengi.vn', password: 'admin123', storeCode: 'KENGI-HCM' });
const opts = { hostname: 'open-retail-api-production.up.railway.app', path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } };
const req = http.request(opts, res => { let body = ''; res.on('data', c => body += c); res.on('end', () => console.log('Status:', res.statusCode, '\nBody:', body)) });
req.on('error', e => console.error('Error:', e.message));
req.write(data); req.end();
