param(
  [Parameter(Mandatory = $true)]
  [string]$Url
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class Win32Input {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const int SW_RESTORE = 9;
}
"@

$logPath = Join-Path $env:TEMP "abg-whatsapp-helper.log"

function Write-HelperLog {
  param([string]$Message)
  try {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $logPath -Value "[$stamp] $Message"
  } catch {
    # El log es solo diagnostico; no debe detener el envio.
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

function Get-WhatsAppWindowProcess {
  $processes = @(Get-Process |
    Where-Object {
      $_.MainWindowHandle -ne 0 -and (
        $_.ProcessName -like "*WhatsApp*" -or
        $_.MainWindowTitle -like "*WhatsApp*"
      )
    } |
    Sort-Object @{ Expression = { if ($_.ProcessName -like "*WhatsApp*") { 0 } else { 1 } } }, StartTime -Descending)

  if ($processes.Count -gt 0) {
    return $processes[0]
  }

  return $null
}

function Activate-WhatsApp {
  param([int]$Seconds = 8)

  $shell = New-Object -ComObject WScript.Shell
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $proc = Get-WhatsAppWindowProcess
    if ($null -ne $proc) {
      [Win32Input]::ShowWindowAsync($proc.MainWindowHandle, [Win32Input]::SW_RESTORE) | Out-Null
      [Win32Input]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
      Start-Sleep -Milliseconds 300
      Write-HelperLog "Ventana WhatsApp activada: process=$($proc.ProcessName), pid=$($proc.Id), title=$($proc.MainWindowTitle)"
      return @{
        Shell = $shell
        Process = $proc
      }
    }
    if ($shell.AppActivate("WhatsApp")) {
      Write-HelperLog "Ventana WhatsApp activada por titulo."
      return @{
        Shell = $shell
        Process = $null
      }
    }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

function Close-CurrentChat {
  param([object]$WhatsApp)

  if ($null -eq $WhatsApp) { return }
  $shell = $WhatsApp.Shell
  $shell.SendKeys("{ESC}")
  Start-Sleep -Milliseconds 500
  $shell.SendKeys("{ESC}")
  Start-Sleep -Milliseconds 500
}

function Get-WhatsAppAutomationWindow {
  $proc = Get-WhatsAppWindowProcess
  if ($null -eq $proc) { return $null }

  try {
    return [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
  } catch {
    Write-HelperLog "No se pudo leer UI Automation: $($_.Exception.Message)"
    return $null
  }
}

function Invoke-SendButtonByAutomation {
  $window = Get-WhatsAppAutomationWindow
  if ($null -eq $window) { return $false }

  $buttonCondition = New-Object -TypeName System.Windows.Automation.PropertyCondition -ArgumentList @(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)

  foreach ($button in $buttons) {
    $name = [string]$button.Current.Name
    if (Test-SendButtonName -Name $name) {
      try {
        Write-HelperLog "Boton enviar encontrado por UIA: '$name'"
        $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $invoke.Invoke()
        Start-Sleep -Milliseconds 1200
        return $true
      } catch {
        try {
          $rect = $button.Current.BoundingRectangle
          if ($rect.Width -gt 0 -and $rect.Height -gt 0) {
            $x = [int]($rect.Left + ($rect.Width / 2))
            $y = [int]($rect.Top + ($rect.Height / 2))
            Write-HelperLog "Click en boton enviar por bounding box: '$name' x=$x y=$y"
            Click-At -X $x -Y $y
            Start-Sleep -Milliseconds 1200
            return $true
          }
        } catch {
          Write-HelperLog "Fallo click UIA: $($_.Exception.Message)"
        }
      }
    }
  }

  Write-HelperLog "No se encontro boton Enviar por UI Automation."
  return $false
}

function Test-SendButtonName {
  param([string]$Name)

  $value = ($Name -replace "\s+", " ").Trim().ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($value)) { return $false }
  if ($value -match "comentario|comentarios|comment|comments|feedback|opinion|sugerencia") {
    Write-HelperLog "Boton descartado por no ser envio de chat: '$Name'"
    return $false
  }

  return @(
    "enviar",
    "send",
    "enviar mensaje",
    "send message"
  ) -contains $value
}

function Click-At {
  param(
    [int]$X,
    [int]$Y
  )

  [Win32Input]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 120
  [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Send-VirtualKey {
  param([byte]$Key)

  [Win32Input]::keybd_event($Key, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [Win32Input]::keybd_event($Key, 0, [Win32Input]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
}

function Send-ControlKey {
  param([byte]$Key)

  [Win32Input]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [Win32Input]::keybd_event($Key, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [Win32Input]::keybd_event($Key, 0, [Win32Input]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [Win32Input]::keybd_event(0x11, 0, [Win32Input]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
}

function Click-MessageInputFallback {
  $proc = Get-WhatsAppWindowProcess
  if ($null -eq $proc) { return $false }

  $rect = New-Object Win32Input+RECT
  if (-not [Win32Input]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)) {
    return $false
  }

  $width = $rect.Right - $rect.Left
  $x = [int]($rect.Left + ($width * 0.70))
  $y = [int]($rect.Bottom - 52)
  Write-HelperLog "Click candidato caja de mensaje: x=$x y=$y"
  Click-At -X $x -Y $y
  Start-Sleep -Milliseconds 500
  return $true
}

function Prepare-MessageInput {
  param([string]$Text)

  if (-not (Click-MessageInputFallback)) {
    Write-HelperLog "No se pudo enfocar caja de mensaje."
    return $false
  }

  $oldClipboard = $null
  try {
    $oldClipboard = Get-Clipboard -Raw -ErrorAction SilentlyContinue
  } catch {
    $oldClipboard = $null
  }

  try {
    Set-Clipboard -Value $Text
    Start-Sleep -Milliseconds 250
    Send-ControlKey -Key 0x41
    Start-Sleep -Milliseconds 200
    Send-ControlKey -Key 0x56
    Start-Sleep -Milliseconds 700
    Write-HelperLog "Mensaje pegado en caja de chat."
    return $true
  } catch {
    Write-HelperLog "No se pudo pegar mensaje: $($_.Exception.Message)"
    return $false
  } finally {
    if ($null -ne $oldClipboard) {
      try { Set-Clipboard -Value $oldClipboard } catch { }
    }
  }
}

function Invoke-SendButtonByCoordinates {
  $proc = Get-WhatsAppWindowProcess
  if ($null -eq $proc) { return $false }

  $rect = New-Object Win32Input+RECT
  if (-not [Win32Input]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)) {
    return $false
  }

  $points = @(
    @($rect.Right - 54, $rect.Bottom - 52),
    @($rect.Right - 72, $rect.Bottom - 52)
  )

  foreach ($point in $points) {
    $x = [int]$point[0]
    $y = [int]$point[1]
    Write-HelperLog "Click coordenado candidato enviar: x=$x y=$y"
    Click-At -X $x -Y $y
    Start-Sleep -Milliseconds 800
  }

  return $true
}

function Press-Send {
  param(
    [object]$WhatsApp,
    [string]$Text
  )

  if ($null -eq $WhatsApp) { return $false }
  $shell = $WhatsApp.Shell

  Prepare-MessageInput -Text $Text | Out-Null

  if (Invoke-SendButtonByAutomation) { return $true }

  Write-HelperLog "Fallback teclado Enter con foco en caja de chat."
  Send-VirtualKey -Key 0x0D
  Start-Sleep -Milliseconds 1000
  $shell.SendKeys("~")
  Start-Sleep -Milliseconds 700

  if (Invoke-SendButtonByCoordinates) { return $true }

  return $false
}

$json = Get-PayloadJson -ProtocolUrl $Url
$payload = $json | ConvertFrom-Json

if (-not $payload.phone) { throw "Falta telefono." }
if (-not $payload.message) { throw "Falta mensaje." }

$phone = [string]$payload.phone
$rawMessage = [string]$payload.message
$message = [Uri]::EscapeDataString($rawMessage)
$whatsAppUrl = "whatsapp://send?phone=$phone&text=$message"

$currentWhatsApp = Activate-WhatsApp -Seconds 2
Close-CurrentChat -WhatsApp $currentWhatsApp

Write-HelperLog "Abriendo WhatsApp para phone=$phone"
(New-Object -ComObject Shell.Application).ShellExecute($whatsAppUrl, $null, $null, "open", 1) | Out-Null
Start-Sleep -Seconds 14

$whatsApp = Activate-WhatsApp -Seconds 10
if ($null -eq $whatsApp) {
  throw "No se pudo activar WhatsApp Desktop."
}

if (-not (Press-Send -WhatsApp $whatsApp -Text $rawMessage)) {
  throw "No se pudo presionar Enviar en WhatsApp Desktop."
}
Start-Sleep -Seconds 3
Close-CurrentChat -WhatsApp $whatsApp
Write-HelperLog "Flujo WhatsApp finalizado para phone=$phone"
