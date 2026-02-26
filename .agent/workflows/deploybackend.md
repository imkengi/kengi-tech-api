---
description: Deploy Open-Retail backend to Railway
---

# Deploy Backend to Railway

// turbo-all

1. Deploy to Railway:
```
railway up --detach
```

2. Wait for deployment and verify health:
```
Start-Sleep -Seconds 60; try { $r = Invoke-RestMethod -Uri "https://open-retail-api-production.up.railway.app/api/health" -TimeoutSec 20; $r | ConvertTo-Json; Write-Host "`n✅ Backend UP!" } catch { Write-Host "❌ Backend not ready: $($_.Exception.Message)" }
```

3. If step 2 fails, retry health check:
```
Start-Sleep -Seconds 60; try { $r = Invoke-RestMethod -Uri "https://open-retail-api-production.up.railway.app/api/health" -TimeoutSec 20; $r | ConvertTo-Json; Write-Host "`n✅ Backend UP!" } catch { Write-Host "❌ Still not ready" }
```
