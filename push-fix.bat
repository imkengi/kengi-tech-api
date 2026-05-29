@echo off
cd /d "C:\Users\ADMIN\.gemini\antigravity-socua\scratch\open-retail-api"
echo === Working in: %CD% ===

del /f /s ".git\*.lock" 2>nul

echo === Staging fixes ===
git add src/routes/auth.ts src/middleware/auth.ts

echo === Committing ===
git commit -m "fix: token endpoint uses store.schema instead of non-existent branches relation"

echo === Pushing ===
git push origin master

echo === Done ===
git log --oneline -3
timeout /t 5
