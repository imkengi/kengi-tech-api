@echo off
cd /d "C:\Users\ADMIN\.gemini\antigravity-socua\scratch\open-retail-api"
echo === Working in: %CD% ===
echo.
echo === Deploying to Cloud Run via Cloud Build ===
call gcloud builds submit --config cloudbuild.yaml .
echo.
echo === Deploy complete! ===
pause
