param(
  [Parameter(Position = 0)]
  [string]$Task = "doctor"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$mobileRoot = Join-Path $repoRoot "mobile_app"
$flutterSdk = "C:\Users\User\flutter-sdk"
$androidSdk = "C:\Users\User\Android\sdk"
$javaHome = "C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot"
$flutterBin = Join-Path $flutterSdk "bin\flutter.bat"

foreach ($requiredPath in @($mobileRoot, $flutterSdk, $androidSdk, $javaHome, $flutterBin)) {
  if (-not (Test-Path $requiredPath)) {
    throw "Required path not found: $requiredPath"
  }
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidSdk
$env:Path = "$flutterSdk\bin;$javaHome\bin;$androidSdk\platform-tools;$androidSdk\cmdline-tools\latest\bin;$env:Path"

# Build-time keys (e.g. KAKAO_NATIVE_APP_KEY) live in an untracked file.
$defines = @()
if (Test-Path (Join-Path $mobileRoot "dart_defines.json")) { $defines = @("--dart-define-from-file=dart_defines.json") }

Push-Location $mobileRoot
try {
  switch ($Task) {
    "doctor" {
      & $flutterBin doctor -v
      break
    }
    "pub-get" {
      & $flutterBin pub get
      break
    }
    "build-aab" {
      & $flutterBin build appbundle --release @defines
      break
    }
    "analyze" {
      & $flutterBin analyze
      break
    }
    "test" {
      & $flutterBin test
      break
    }
    "build-web" {
      & $flutterBin build web @defines
      break
    }
    "build-apk-debug" {
      & $flutterBin build apk --debug @defines
      break
    }
    default {
      throw "Unknown task '$Task'. Use one of: doctor, pub-get, analyze, test, build-web, build-apk-debug."
    }
  }
}
finally {
  Pop-Location
}
