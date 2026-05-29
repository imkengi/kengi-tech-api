@echo off
echo === Deleting ALL lock files ===
del /f /s ".git\*.lock" 2>nul

echo.
echo === Staging auth changes ===
git add src/middleware/auth.ts src/routes/auth.ts src/routes/apiKeys.ts

echo.
echo === Committing ===
git commit -m "feat: client credentials auth token endpoint + standalone API key auth"

echo.
echo === Pushing ===
git push origin master

echo.
echo === Final log ===
git log --oneline -3

echo.
echo === Done! ===
pause
