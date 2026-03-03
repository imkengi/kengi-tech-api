---
description: Deploy frontend to kengi.vn and backend to Cloud Run
---
// turbo-all

## Frontend (kengi.vn)

1. Build the frontend static export:
```
cd C:\Users\ADMIN\.gemini\antigravity\scratch\open-retail
npm run build
```

2. Upload the built `out/` directory to kengi.vn via SSH:
```
cd C:\Users\ADMIN\.gemini\antigravity\scratch\open-retail
node upload.cjs
```

Host: h217102.tino.org
User: kengivnu
Remote dir: /home/kengivnu/public_html
Local dir: C:\Users\ADMIN\.gemini\antigravity\scratch\open-retail\out

## Backend (Cloud Run)

3. Deploy the backend API to Google Cloud Run:
```
cd C:\Users\ADMIN\.gemini\antigravity\scratch\open-retail-api
gcloud run deploy kengi-tech-api --source . --region asia-southeast1
```
