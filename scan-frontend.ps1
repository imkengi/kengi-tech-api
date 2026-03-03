$srcDir = "C:\Users\ADMIN\.gemini\antigravity\scratch\open-retail\src"
$files = Get-ChildItem "$srcDir\features", "$srcDir\app\(dashboard)" -Filter "*.tsx" -Recurse

foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $name = $f.FullName.Replace($srcDir + "\", "")
    $found = @()
    
    if ($c -match "TODO|FIXME|coming soon|not implemented") { $found += "TODO" }
    if ($c -match "console\.log\(|onClick=\{\(\) => \{\}\}") { $found += "EMPTY_HANDLER" }
    if ($c -match "disabled=\{true\}") { $found += "DISABLED" }
    if ($c -match "Math\.random\(\)") { $found += "RANDOM_DATA" }
    if ($c -match "// mock|// demo|// fake|// placeholder") { $found += "MOCK_COMMENT" }

    if ($found.Count -gt 0) {
        Write-Host "$name : $($found -join ', ')"
    }
}
