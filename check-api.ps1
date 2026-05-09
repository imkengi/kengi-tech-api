$BASE = "https://kengi-tech-api-445765742612.asia-southeast1.run.app/api"

# Login
$loginBody = '{"email":"admin@kengi.vn","password":"123456","storeCode":"KENGI"}'
$loginResp = Invoke-RestMethod -Uri "$BASE/auth/login" -Method Post -ContentType "application/json" -Body $loginBody
$TOKEN = $loginResp.data.token
if (-not $TOKEN) { Write-Host "LOGIN FAILED"; exit 1 }
Write-Host "LOGIN OK`n"

$routes = @(
    "/products", "/categories", "/brands", "/customers", "/customer-groups",
    "/inventory", "/transactions", "/promotions", "/dashboard/stats",
    "/suppliers", "/purchase-orders", "/expenses", "/employees",
    "/warranties", "/repairs", "/quotations", "/audit-logs", "/price-history",
    "/shipping", "/drivers", "/tax", "/segments", "/currencies", "/feedback",
    "/schedules", "/returns", "/debts", "/bundles", "/reports/financial",
    "/store-settings", "/branches", "/price-lists", "/announcements",
    "/attendance", "/loyalty", "/reviews", "/notifications",
    "/sales-orders", "/sales-tracking"
)

$ok = 0; $fail = 0
foreach ($r in $routes) {
    $out = curl.exe -s -o NUL -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE$r" -m 8
    if ($out -eq "200") {
        Write-Host "  OK  $r"
        $ok++
    } else {
        Write-Host "  ERR $r --> $out"
        $fail++
    }
}
Write-Host "`nResult: $ok OK / $fail ERRORS"
