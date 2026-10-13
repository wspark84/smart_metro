# Creates the Google Play upload key for 이노치 and writes android/key.properties.
# The keystore is stored OUTSIDE the project folder and is never committed.
# Back up the keystore file and its password: losing them blocks app updates
# until Google Play support resets the upload key.
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$javaHome = "C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot"
$keytool = Join-Path $javaHome "bin\keytool.exe"
$keyDir = Join-Path $env:USERPROFILE "inochi-keys"
$keystore = Join-Path $keyDir "inochi-upload.jks"
$properties = Join-Path $repoRoot "mobile_app\android\key.properties"

if (-not (Test-Path $keytool)) { throw "Java keytool not found: $keytool" }
if (Test-Path $keystore) { Write-Host "이미 업로드 키가 있습니다: $keystore (덮어쓰지 않습니다)"; exit 0 }
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null

Write-Host "Google Play 업로드 키를 만듭니다. 비밀번호(8자 이상)를 두 번 입력하세요. 화면에 표시되지 않습니다."
$first = Read-Host -AsSecureString "비밀번호"
$second = Read-Host -AsSecureString "비밀번호 확인"
$plain1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($first))
$plain2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($second))
if ($plain1 -ne $plain2) { throw "비밀번호가 서로 다릅니다. 다시 실행해 주세요." }
if ($plain1.Length -lt 8) { throw "비밀번호는 8자 이상이어야 합니다." }

& $keytool -genkeypair -v -keystore $keystore -storetype JKS -keyalg RSA -keysize 4096 -validity 10000 `
  -alias upload -storepass $plain1 -keypass $plain1 `
  -dname "CN=Lifelogics, O=Lifelogics, L=Hwaseong, ST=Gyeonggi-do, C=KR"
if ($LASTEXITCODE -ne 0) { throw "업로드 키를 만들지 못했습니다." }

$escaped = $keystore.Replace("\", "\\")
@"
storeFile=$escaped
storePassword=$plain1
keyAlias=upload
keyPassword=$plain1
"@ | Set-Content -Encoding ASCII $properties

Write-Host ""
Write-Host "완료: $keystore"
Write-Host "이 파일과 비밀번호를 USB나 비밀번호 관리자에 따로 백업해 두세요."
