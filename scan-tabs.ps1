$base = "C:\Users\ADMIN\.gemini\antigravity\scratch\open-retail\src\app\(dashboard)"
$pages = Get-ChildItem $base -Filter "page.tsx" -Recurse

foreach ($p in $pages) {
    $c = Get-Content $p.FullName -Raw
    $name = $p.DirectoryName.Split('\')[-1]
    if ($c -notmatch 'TabsTrigger|activeTab|setActiveTab|setTab') { continue }

    $tabTriggers = [regex]::Matches($c, 'TabsTrigger[^>]+value="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
    $stateTabs = [regex]::Matches($c, "setTab\('([^']+)'\)|setActiveTab\('([^']+)'\)") | ForEach-Object {
        ($_.Groups[1].Value + $_.Groups[2].Value).Trim()
    }
    $allTabs = ($tabTriggers + $stateTabs) | Where-Object { $_ -ne "" } | Select-Object -Unique

    if ($allTabs.Count -eq 0) { continue }

    $hooks = [regex]::Matches($c, 'use[A-Z][a-zA-Z0-9]+') | ForEach-Object { $_.Value } |
    Where-Object { $_ -notmatch 'useState|useEffect|useMemo|useCallback|useRef|useRouter|useContext|useSearchParams|useQueryClient|useMutation|useQuery|useForm|useDebounce|useId|useImperative' } |
    Select-Object -Unique

    Write-Output ""
    Write-Output "[$name]"
    Write-Output "  API Hooks: $($hooks -join ', ')"
    Write-Output "  Tabs found: $($allTabs -join ' | ')"

    # For each tab, look at what's rendered inside that tab
    foreach ($tab in $allTabs) {
        # Find content after conditional check like activeTab === 'tab' or value="tab"
        $patterns = @(
            "(?s)activeTab\s*===?\s*['""]$tab['""](.{0,800})",
            "(?s)value=""$tab""[^>]*>(.{0,800})"
        )
        $found = $false
        foreach ($pat in $patterns) {
            $m = [regex]::Match($c, $pat)
            if ($m.Success) {
                $section = $m.Groups[1].Value
                $hasApi = $section -match "\.(data|isLoading|isPending|mutate|isSuccess)|useQuery|apiClient\."
                $hasMock = $section -match "Math\.random|TODO|console\.log|// fake|// mock"
                $hasLocalOnly = $section -match "setItems|setRecords|setList" -and $section -notmatch "mutate\("
                $status = if ($hasApi) { "OK-API" } elseif ($hasMock) { "MOCK" } elseif ($hasLocalOnly) { "LOCAL-ONLY" } else { "UI-ONLY" }
                Write-Output "    [$status] $tab"
                $found = $true
                break
            }
        }
        if (-not $found) { Write-Output "    [?] $tab" }
    }
}
Write-Output ""
Write-Output "=== DONE ==="
