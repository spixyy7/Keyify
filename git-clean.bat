@echo off
echo ========================================
echo  Keyify - GitHub cleanup
echo ========================================
echo.

echo [1/4] Skidanje .claude sa GitHub trackinga...
git rm --cached -r .claude --ignore-unmatch
echo       OK

echo [2/4] Lokalno brisanje .claude...
if exist ".claude" (
    rmdir /s /q .claude
    echo       OK
) else (
    echo       Preskoceno - ne postoji
)

echo [3/4] Commit...
git add .gitignore
git commit -m "Remove .claude folder, update gitignore"

echo [4/4] Push...
git push

echo.
echo  Gotovo!
echo.
pause
