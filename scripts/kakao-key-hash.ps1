param(
  # Play Console > 앱 무결성 > 앱 서명 키 인증서의 SHA-1 (예: AB:CD:...)
  [string]$Sha1Hex = ""
)
# Prints the Android key hashes to register in Kakao Developers
# (내 애플리케이션 > 플랫폼 > Android > 키 해시).
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$javaHome = "C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot"
$keytool = Join-Path $javaHome "bin\keytool.exe"

function HashOf([string]$keystore, [string]$alias, [string]$storePass) {
  $cert = [System.IO.Path]::GetTempFileName()
  try {
    # keytool reports success on stderr; with "Stop" Windows PowerShell treats
    # that as an error and quits (2026-11-10). Ignore its messages here and
    # check the exit code instead.
    $ErrorActionPreference = "Continue"
    & $keytool -exportcert -alias $alias -keystore $keystore -storepass $storePass -file $cert *> $null
    if ($LASTEXITCODE -ne 0) { return "읽기 실패 (키 파일 또는 비밀번호 확인 필요)" }
    $sha1 = [System.Security.Cryptography.SHA1]::Create().ComputeHash([System.IO.File]::ReadAllBytes($cert))
    return [Convert]::ToBase64String($sha1)
  } finally { Remove-Item $cert -ErrorAction SilentlyContinue }
}

if ($Sha1Hex) {
  $bytes = ($Sha1Hex -replace "[^0-9A-Fa-f]", "") -split "(..)" | Where-Object { $_ } | ForEach-Object { [Convert]::ToByte($_, 16) }
  Write-Output ("Google Play 앱 서명 키: " + [Convert]::ToBase64String([byte[]]$bytes))
  exit 0
}

$debug = Join-Path $env:USERPROFILE ".android\debug.keystore"
if (Test-Path $debug) { Write-Output ("디버그(개발용) 키: " + (HashOf $debug "androiddebugkey" "android")) }
else { Write-Output "디버그 키가 아직 없습니다. 앱을 한 번 실행(flutter run)하면 만들어집니다." }

$props = Join-Path $PSScriptRoot "..\mobile_app\android\key.properties"
if (Test-Path $props) {
  $map = @{}
  Get-Content $props | ForEach-Object { if ($_ -match "^\s*([^=]+?)\s*=\s*(.*)$") { $map[$matches[1]] = $matches[2] } }
  $store = $map["storeFile"]
  if (-not [System.IO.Path]::IsPathRooted($store)) { $store = Join-Path (Split-Path $props) "app\$store" }
  Write-Output ("업로드 키: " + (HashOf $store $map["keyAlias"] $map["storePassword"]))
} else {
  Write-Output "업로드 키(key.properties)가 아직 없습니다. scripts\create-upload-key.cmd 를 먼저 실행하세요."
}
