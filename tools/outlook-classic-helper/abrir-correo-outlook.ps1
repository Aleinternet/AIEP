param(
  [Parameter(Mandatory = $true)]
  [string]$Url
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName Microsoft.VisualBasic

$configDir = Join-Path ([Environment]::GetFolderPath("ApplicationData")) "ABG_RECOV"
$accountPath = Join-Path $configDir "outlook-classic-account.txt"
$logPath = Join-Path $env:TEMP "abg-outlook-helper.log"

function Write-HelperLog {
  param([string]$Message)
  try {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $logPath -Value "[$stamp] $Message"
  } catch {
    # El log es diagnostico; no debe detener el envio.
  }
}

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

function Get-Prop {
  param(
    [object]$Object,
    [string]$Name,
    [object]$Fallback = $null
  )

  if ($null -eq $Object) { return $Fallback }
  if ($Object.PSObject.Properties.Name -contains $Name) { return $Object.$Name }
  return $Fallback
}

function Get-OutlookAccountText {
  param([object]$Account)

  $smtp = ""
  $displayName = ""
  try { $smtp = [string]$Account.SmtpAddress } catch { }
  try { $displayName = [string]$Account.DisplayName } catch { }
  if (-not [string]::IsNullOrWhiteSpace($smtp)) { return $smtp }
  return $displayName
}

function Get-OutlookAccountsText {
  param([object]$Outlook)

  $lines = New-Object System.Collections.Generic.List[string]
  for ($i = 1; $i -le $Outlook.Session.Accounts.Count; $i++) {
    $account = $Outlook.Session.Accounts.Item($i)
    $lines.Add("$i. $(Get-OutlookAccountText -Account $account)")
  }
  $lines -join [Environment]::NewLine
}

function Find-OutlookAccount {
  param(
    [object]$Outlook,
    [string]$Selection
  )

  $selection = ([string]$Selection).Trim()
  if ([string]::IsNullOrWhiteSpace($selection)) { return $null }

  if ($selection -match "^\d+$") {
    $index = [int]$selection
    if ($index -ge 1 -and $index -le $Outlook.Session.Accounts.Count) {
      return $Outlook.Session.Accounts.Item($index)
    }
  }

  $target = $selection.ToLowerInvariant()
  for ($i = 1; $i -le $Outlook.Session.Accounts.Count; $i++) {
    $account = $Outlook.Session.Accounts.Item($i)
    $smtp = ""
    $displayName = ""
    try { $smtp = ([string]$account.SmtpAddress).Trim().ToLowerInvariant() } catch { }
    try { $displayName = ([string]$account.DisplayName).Trim().ToLowerInvariant() } catch { }
    if ($smtp -eq $target -or $displayName -eq $target) { return $account }
  }

  return $null
}

function Read-SavedAccount {
  if (Test-Path -LiteralPath $accountPath) {
    return (Get-Content -LiteralPath $accountPath -Raw).Trim()
  }
  return ""
}

function Save-Account {
  param([object]$Account)

  if (-not (Test-Path -LiteralPath $configDir)) {
    New-Item -Path $configDir -ItemType Directory -Force | Out-Null
  }
  Set-Content -LiteralPath $accountPath -Value (Get-OutlookAccountText -Account $Account) -Encoding UTF8
}

function Select-OutlookAccount {
  param(
    [object]$Outlook,
    [string]$Preferred = ""
  )

  $selection = $Preferred
  if ([string]::IsNullOrWhiteSpace($selection)) {
    $selection = Read-SavedAccount
  }

  if (-not [string]::IsNullOrWhiteSpace($selection)) {
    $account = Find-OutlookAccount -Outlook $Outlook -Selection $selection
    if ($null -ne $account) {
      Save-Account -Account $account
      return $account
    }
  }

  $accountsText = Get-OutlookAccountsText -Outlook $Outlook
  $inputValue = [Microsoft.VisualBasic.Interaction]::InputBox(
    "Seleccione la cuenta exacta de envio." + [Environment]::NewLine + [Environment]::NewLine +
    "Cuentas habilitadas en Outlook:" + [Environment]::NewLine +
    $accountsText + [Environment]::NewLine + [Environment]::NewLine +
    "Escriba el numero o el correo SMTP.",
    "Cuenta de envio Outlook Classic",
    (Read-SavedAccount)
  )

  $inputValue = ([string]$inputValue).Trim()
  if ([string]::IsNullOrWhiteSpace($inputValue)) {
    throw "No se selecciono cuenta de envio."
  }

  $account = Find-OutlookAccount -Outlook $Outlook -Selection $inputValue
  if ($null -eq $account) {
    throw "No se encontro la cuenta seleccionada: $inputValue"
  }

  Save-Account -Account $account
  return $account
}

function Convert-TextToHtml {
  param([string]$Text)

  $encoded = [System.Net.WebUtility]::HtmlEncode($Text)
  $encoded = [regex]::Replace($encoded, "\*(.+?)\*", "<strong>`$1</strong>")
  $encoded = [regex]::Replace($encoded, "(\r\n|\n|\r)", "<br>")
  return "<div style='font-family:Arial,sans-serif;font-size:11pt;line-height:1.45;'>$encoded</div>"
}

function New-MailInAccount {
  param(
    [object]$Outlook,
    [object]$Account
  )

  $mail = $null
  if ($null -ne $Account) {
    try {
      $drafts = $Account.DeliveryStore.GetDefaultFolder(16)
      $mail = $drafts.Items.Add("IPM.Note")
    } catch {
      $mail = $null
    }
  }
  if ($null -eq $mail) {
    $mail = $Outlook.CreateItem(0)
  }
  if ($null -ne $Account) {
    try { $mail.SendUsingAccount = $Account } catch { }
  }
  return $mail
}

function Apply-MailPayload {
  param(
    [object]$Mail,
    [object]$Payload,
    [object]$Account
  )

  $to = [string](Get-Prop -Object $Payload -Name "to")
  $subject = [string](Get-Prop -Object $Payload -Name "subject" -Fallback "Regularizacion deuda AIEP")
  $htmlBody = [string](Get-Prop -Object $Payload -Name "htmlBody")
  $bodyText = [string](Get-Prop -Object $Payload -Name "bodyText")
  if ([string]::IsNullOrWhiteSpace($htmlBody) -and -not [string]::IsNullOrWhiteSpace($bodyText)) {
    $htmlBody = Convert-TextToHtml -Text $bodyText
  }

  if ([string]::IsNullOrWhiteSpace($to)) { throw "Falta destinatario." }
  if ([string]::IsNullOrWhiteSpace($subject)) { throw "Falta asunto." }
  if ([string]::IsNullOrWhiteSpace($htmlBody)) { throw "Falta cuerpo HTML o texto." }

  $Mail.To = $to
  $Mail.Subject = $subject
  $Mail.HTMLBody = $htmlBody
  $Mail.Categories = "AIEP ABG RECOV"
  $Mail.BillingInformation = "ABGRECOV|AIEP|$to"
  $Mail.ReadReceiptRequested = $true
  $Mail.OriginatorDeliveryReportRequested = $true
  if ($null -ne $Account) {
    try { $Mail.SendUsingAccount = $Account } catch { }
  }
}

$json = Get-PayloadJson -ProtocolUrl $Url
$payload = $json | ConvertFrom-Json
$action = ([string](Get-Prop -Object $payload -Name "action" -Fallback "compose")).Trim().ToLowerInvariant()

$outlook = New-Object -ComObject Outlook.Application

switch ($action) {
  "select-account" {
    $account = Select-OutlookAccount -Outlook $outlook
    $text = Get-OutlookAccountText -Account $account
    Write-HelperLog "Cuenta seleccionada: $text"
    [Microsoft.VisualBasic.Interaction]::MsgBox("Cuenta Outlook seleccionada: $text", [Microsoft.VisualBasic.MsgBoxStyle]4160, "ABG RECOV")
  }
  "send" {
    $preferred = [string](Get-Prop -Object $payload -Name "sendAccount")
    $account = Select-OutlookAccount -Outlook $outlook -Preferred $preferred
    $mail = New-MailInAccount -Outlook $outlook -Account $account
    Apply-MailPayload -Mail $mail -Payload $payload -Account $account
    $mail.Send()
    Write-HelperLog "Correo enviado a $($mail.To) desde $(Get-OutlookAccountText -Account $account)"
  }
  default {
    $account = $null
    $saved = Read-SavedAccount
    if (-not [string]::IsNullOrWhiteSpace($saved)) {
      $account = Find-OutlookAccount -Outlook $outlook -Selection $saved
    }
    $mail = New-MailInAccount -Outlook $outlook -Account $account
    Apply-MailPayload -Mail $mail -Payload $payload -Account $account
    $mail.Display()
    Write-HelperLog "Correo preparado para $($mail.To)"
  }
}
