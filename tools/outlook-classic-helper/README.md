# Outlook Classic local

Este helper permite que la web abra correos en Outlook Classic con cuerpo HTML real, usando el mismo principio que una macro VBA: `Outlook.Application` y `.HTMLBody`.

## Instalar en cada PC del call center

Ejecutar en PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Baul\ABG_RECOV\empresa_AIEP\tools\outlook-classic-helper\instalar-protocolo.ps1"
```

Luego, en la web, activar la casilla **Outlook Classic local**.

## Quitar

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Baul\ABG_RECOV\empresa_AIEP\tools\outlook-classic-helper\desinstalar-protocolo.ps1"
```
