$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Join-Path (Split-Path -Parent $PSScriptRoot) 'mobile_app'
$source = [System.Drawing.Image]::FromFile((Join-Path $root 'smart_metro_icon.png'))
function Save-Icon([string]$relativePath, [int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $scale = [Math]::Min($size / $source.Width, $size / $source.Height)
    $width = [int][Math]::Round($source.Width * $scale)
    $height = [int][Math]::Round($source.Height * $scale)
    $graphics.DrawImage($source, [int](($size - $width) / 2), [int](($size - $height) / 2), $width, $height)
    $bitmap.Save((Join-Path $root $relativePath), [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "$relativePath : ${size}x${size}"
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}
try {
  foreach ($entry in @{mdpi=48;hdpi=72;xhdpi=96;xxhdpi=144;xxxhdpi=192}.GetEnumerator()) {
    Save-Icon "android/app/src/main/res/mipmap-$($entry.Key)/ic_launcher.png" $entry.Value
  }
  $catalog = Get-Content (Join-Path $root 'ios/Runner/Assets.xcassets/AppIcon.appiconset/Contents.json') -Raw | ConvertFrom-Json
  foreach ($entry in $catalog.images) {
    if ($entry.filename) {
      $size = [double]::Parse(($entry.size -split 'x')[0], [Globalization.CultureInfo]::InvariantCulture)
      $scale = [int]($entry.scale -replace 'x','')
      Save-Icon "ios/Runner/Assets.xcassets/AppIcon.appiconset/$($entry.filename)" ([int]($size * $scale))
    }
  }
  foreach ($size in @(192,512)) {
    Save-Icon "web/icons/Icon-$size.png" $size
    Save-Icon "web/icons/Icon-maskable-$size.png" $size
  }
  Save-Icon 'web/favicon.png' 32
} finally {
  $source.Dispose()
}
