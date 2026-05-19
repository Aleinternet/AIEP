param(
  [Parameter(Mandatory = $true)]
  [string]$Url
)

$ErrorActionPreference = "Stop"

function Get-PayloadJson {
  param([string]$ProtocolUrl)

  if ($ProtocolUrl -notmatch "payload=([^&]+)") {
    throw "URL sin payload."
  }

  $payload = [Uri]::UnescapeDataString($Matches[1])
  $payload = $payload.Replace("-", "+").Replace("_", "/")
  switch ($payload.Length % 4) {
    2 { $payload += "==" }
    3 { $payload += "=" }
    0 { }
    default { throw "Payload base64 invalido." }
  }

  $bytes = [Convert]::FromBase64String($payload)
  [Text.Encoding]::UTF8.GetString($bytes)
}

function Activate-WhatsApp {
  param([int]$Seconds = 8)

  $shell = New-Object -ComObject WScript.Shell
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if ($shell.AppActivate("WhatsApp")) {
      return $shell
    }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

$json = Get-PayloadJson -ProtocolUrl $Url
$payload = $json | ConvertFrom-Json

if (-not $payload.phone) { throw "Falta telefono." }
if (-not $payload.message) { throw "Falta mensaje." }

$phone = [string]$payload.phone
$message = [Uri]::EscapeDataString([string]$payload.message)
$whatsAppUrl = "whatsapp://send?phone=$phone&text=$message"

(New-Object -ComObject Shell.Application).ShellExecute($whatsAppUrl, $null, $null, "open", 1) | Out-Null
Start-Sleep -Seconds 8

$shell = Activate-WhatsApp -Seconds 5
if ($null -eq $shell) {
  throw "No se pudo activar WhatsApp Desktop."
}

$shell.SendKeys("~")
Start-Sleep -Seconds 2
$shell.SendKeys("{ESC}")
Start-Sleep -Milliseconds 400
$shell.SendKeys("{ESC}")
