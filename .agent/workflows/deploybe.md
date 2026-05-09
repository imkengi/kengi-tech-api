---
description: Deploy backend lên Google Cloud Run
---

# Deploy Backend (Kengi Tech API)

## Prerequisites
- Đã cài `gcloud` CLI trên máy
- Đã login: `gcloud auth login`
- Đã set project: `gcloud config set project kengi-tech`

## Steps

// turbo-all

1. Mở terminal tại folder backend:
```bash
cd C:\Users\ADMIN\.gemini\antigravity\scratch\open-retail-api
```

2. Deploy lên Cloud Run:
```bash
gcloud run deploy kengi-tech-api --source . --region asia-southeast1
```

> Đợi ~3-5 phút. Khi xong sẽ hiện Service URL.

## Thông tin

| Item | Giá trị |
|---|---|
| **Service** | kengi-tech-api |
| **Region** | asia-southeast1 (Singapore) |
| **URL** | https://kengi-tech-api-445765742612.asia-southeast1.run.app |
| **Database** | Cloud SQL `kengi-tech-db` (PostgreSQL 15) |
| **DB IP** | 35.198.200.67 |
| **DB Name** | kengi_tech |
| **DB User** | postgres |

## Nếu cần update env vars
```bash
gcloud run services update kengi-tech-api --region asia-southeast1 --update-env-vars "KEY=VALUE"
```

## Nếu cần migrate database
```bash
$env:DATABASE_URL='postgresql://postgres:Imkengi135!@35.198.200.67:5432/kengi_tech'
npx prisma db push
```
