$ErrorActionPreference = "Stop"

$protocolRoot = "HKCU:\Software\Classes\abg-whatsapp"
if (Test-Path -LiteralPath $protocolRoot) {
  Remove-Item -LiteralPath $protocolRoot -Recurse -Force
  Write-Host "OK protocolo abg-whatsapp eliminado."
} else {
  Write-Host "El protocolo abg-whatsapp no estaba instalado."
}
