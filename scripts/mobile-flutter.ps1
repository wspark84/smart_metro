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
    "analyze" {
      & $flutterBin analyze
      break
    }
    "test" {
      & $flutterBin test
      break
    }
    "build-web" {
      & $flutterBin build web
      break
    }
    "build-apk-debug" {
      & $flutterBin build apk --debug
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
