$ErrorActionPreference = 'Stop'
$port = 5500
$prefix = "http://localhost:$port/"

Write-Host "Starting static server at $prefix (Ctrl+C to stop)"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()

function Get-ContentType($path) {
  switch -Regex ($path) {
    ".*\.html$" { return "text/html; charset=utf-8" }
    ".*\.css$"  { return "text/css; charset=utf-8" }
    ".*\.js$"   { return "text/javascript; charset=utf-8" }
    ".*\.mjs$"  { return "text/javascript; charset=utf-8" }
    ".*\.json$" { return "application/json; charset=utf-8" }
    ".*\.png$"  { return "image/png" }
    ".*\.jpg$"  { return "image/jpeg" }
    ".*\.jpeg$" { return "image/jpeg" }
    ".*\.svg$"  { return "image/svg+xml; charset=utf-8" }
    ".*\.ico$"  { return "image/x-icon" }
    default { return "application/octet-stream" }
  }
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    # Decode and normalize without System.Web
    $rawPath = $request.Url.AbsolutePath.TrimStart('/')
    $relPath = [System.Uri]::UnescapeDataString($rawPath)
    if ([string]::IsNullOrWhiteSpace($relPath)) { $relPath = 'index.html' }
    $relPath = $relPath -replace "\\", "/"
    if ($relPath -match "^\.+/" -or $relPath -match "/\.+/") { $relPath = 'index.html' }
    $root = (Get-Location).Path
    $fullPath = Join-Path -Path $root -ChildPath $relPath
    $fullPath = [System.IO.Path]::GetFullPath($fullPath)
    if (-not $fullPath.StartsWith($root)) { $fullPath = Join-Path -Path $root -ChildPath 'index.html' }

    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
      try {
        $bytes = [System.IO.File]::ReadAllBytes($fullPath)
        $response.ContentType = Get-ContentType $fullPath
        $response.StatusCode = 200
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      } catch {
        $response.StatusCode = 500
        $msg = [System.Text.Encoding]::UTF8.GetBytes("Internal server error")
        $response.OutputStream.Write($msg, 0, $msg.Length)
      }
    } else {
      $response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
      $response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $response.OutputStream.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
}


