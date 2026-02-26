// Quick API test
async function test() {
    // Login
    const loginRes = await fetch('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@kengi.vn', password: 'admin123' }),
    })
    const loginData = await loginRes.json()
    if (!loginData.success) {
        console.error('Login failed:', loginData.error)
        return
    }
    const token = loginData.data.token
    console.log('✅ Login OK')

    // Test GET customers
    const getRes = await fetch('http://localhost:3001/api/customers', {
        headers: { 'Authorization': `Bearer ${token}` },
    })
    const getData = await getRes.json()
    console.log('✅ GET customers:', getData.success, '- count:', getData.data?.items?.length)

    // Test POST customer (without code)
    const createRes = await fetch('http://localhost:3001/api/customers', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ name: 'Test Customer', phone: '0901111111' }),
    })
    const createData = await createRes.json()
    console.log('✅ POST customer:', createData.success, '- code:', createData.data?.code, '- id:', createData.data?.id)

    // Cleanup: delete the test customer
    if (createData.data?.id) {
        const delRes = await fetch(`http://localhost:3001/api/customers/${createData.data.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
        })
        const delData = await delRes.json()
        console.log('✅ DELETE customer:', delData.success)
    }
}

test().catch(e => console.error('Error:', e.message))
