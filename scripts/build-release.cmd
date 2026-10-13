@echo off
rem Builds the Google Play upload file (AAB). Output log: .release-build.log
cd /d "%~dp0.."
echo START %DATE% %TIME% > .release-build.log
call npm run mobile:pub:get >> .release-build.log 2>&1
powershell -ExecutionPolicy Bypass -File scripts\mobile-flutter.ps1 build-aab >> .release-build.log 2>&1
echo BUILD_EXIT %ERRORLEVEL% >> .release-build.log
echo DONE >> .release-build.log
