@echo off
rem Checks the Flutter app (analyze + tests). Output: .mobile-check.log
cd /d "%~dp0.."
echo START %DATE% %TIME% > .mobile-check.log
call npm run mobile:pub:get >> .mobile-check.log 2>&1
call npm run mobile:analyze >> .mobile-check.log 2>&1
echo ANALYZE_EXIT %ERRORLEVEL% >> .mobile-check.log
call npm run mobile:test >> .mobile-check.log 2>&1
echo TEST_EXIT %ERRORLEVEL% >> .mobile-check.log
echo DONE >> .mobile-check.log
