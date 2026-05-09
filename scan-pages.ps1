$base = "C:\Users\ADMIN\.gemini\antigravity\scratch\open-retail\src\app\(dashboard)"
$featureBase = "C:\Users\ADMIN\.gemini\antigravity\scratch\open-retail\src\features"

$targetPages = @(
    "dashboard-purchase-orders",
    "dashboard-quotations",
    "dashboard-loyalty",
    "dashboard-feedback",
    "dashboard-attendance",
    "dashboard-announcements",
    "dashboard-repairs",
    "dashboard-drivers",
    "dashboard-segments",
    "dashboard-schedule",
    "dashboard-price-history",
    "dashboard-bundles",
    "dashboard-promotions"
)

foreach ($pname in $targetPages) {
    $f = "$base\$pname\page.tsx"
    if (-not (Test-Path $f)) { 
        Write-Output "[$pname] FILE NOT FOUND"
        continue 
    }
    $c = Get-Content $f -Raw
    $lines = Get-Content $f

    # Count meaningful mutations
    $mutateCount = ([regex]::Matches($c, '\.mutate\(|\.mutateAsync\(') | Measure-Object).Count
    # Fake loading (setTimeout)
    $fakeLoading = ([regex]::Matches($c, 'setTimeout') | Measure-Object).Count
    # Local state setters doing CRUD without mutate
    $localCrud = ([regex]::Matches($c, 'setItems\b|\.filter\(|\.map\(|\.push\(|setList\b|setData\b') | Measure-Object).Count
    # API hooks used
    $hooks = ([regex]::Matches($c, 'use(?!State|Effect|Memo|Callback|Ref|Router|Context|Form|Id|Imperative|Search)[A-Z][a-zA-Z]+\(') | ForEach-Object { $_.Value.TrimEnd('(') } | Select-Object -Unique) -join ", "
    # Hardcoded data
    $hardcoded = if ($c -match 'Math\.random|RANDOM_DEMO|FAKE_|// mock|// demo') { "YES" } else { "no" }

    $status = if ($mutateCount -ge 3) { "FULL" } elseif ($mutateCount -ge 1) { "PARTIAL" } else { "READ-ONLY" }

    Write-Output "[$pname]"
    Write-Output "  Status=$status mutate=$mutateCount fakeLoad=$fakeLoading hardcoded=$hardcoded"
    Write-Output "  Hooks: $hooks"
    Write-Output ""
}

Write-Output "=== DONE ==="
