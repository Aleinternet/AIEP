$ErrorActionPreference = "Stop"

$helperPath = Join-Path $PSScriptRoot "abrir-correo-outlook.ps1"
if (-not (Test-Path -LiteralPath $helperPath)) {
  throw "No se encontro el helper en $helperPath"
}

$protocolRoot = "HKCU:\Software\Classes\abg-outlook"
$commandRoot = Join-Path $protocolRoot "shell\open\command"
$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$helperPath`" `"%1`""

New-Item -Path $commandRoot -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:ABG Outlook Classic"
Set-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value ""
Set-Item -Path $commandRoot -Value $command

Write-Host "OK protocolo abg-outlook instalado para este usuario."
Write-Host "En la web, active 'Outlook Classic local' para borradores o 'Autoenviar correo Outlook' para envio masivo automatico."
