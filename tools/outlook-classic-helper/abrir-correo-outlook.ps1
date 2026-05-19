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

$json = Get-PayloadJson -ProtocolUrl $Url
$payload = $json | ConvertFrom-Json

if (-not $payload.to) { throw "Falta destinatario." }
if (-not $payload.subject) { throw "Falta asunto." }
if (-not $payload.htmlBody) { throw "Falta cuerpo HTML." }

$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.To = [string]$payload.to
$mail.Subject = [string]$payload.subject
$mail.HTMLBody = [string]$payload.htmlBody
$mail.Categories = "AIEP ABG RECOV"
$mail.Display()
