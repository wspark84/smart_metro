@echo off
rem Builds a test APK for your own phone (debug key, Kakao map key from mobile_app\dart_defines.json).
rem Output log: .test-apk.log  /  APK: mobile_app\build\app\outputs\flutter-apk\app-debug.apk
cd /d "%~dp0.."
echo START %DATE% %TIME% > .test-apk.log
call npm run mobile:pub:get >> .test-apk.log 2>&1
call npm run mobile:build:apk:debug >> .test-apk.log 2>&1
echo BUILD_EXIT %ERRORLEVEL% >> .test-apk.log
echo DONE >> .test-apk.log
if exist "mobile_app\build\app\outputs\flutter-apk\app-debug.apk" explorer /select,"mobile_app\build\app\outputs\flutter-apk\app-debug.apk"
