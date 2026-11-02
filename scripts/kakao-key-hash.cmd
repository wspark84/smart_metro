@echo off
rem Prints Android key hashes for Kakao Developers. Output: .kakao-key-hash.txt
chcp 65001 >nul
cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -File scripts\kakao-key-hash.ps1 %* > .kakao-key-hash.txt 2>&1
type .kakao-key-hash.txt
echo.
pause
