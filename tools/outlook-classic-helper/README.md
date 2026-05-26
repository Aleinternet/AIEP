# Outlook Classic local

Este helper permite que la web abra correos en Outlook Classic con cuerpo HTML real o los envie automaticamente, usando el mismo principio que una macro VBA: `Outlook.Application`, `.HTMLBody`, `.SendUsingAccount` y `.Send()`.

## Instalar en cada PC del call center

Ejecutar en PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Baul\ABG_RECOV\empresa_AIEP\tools\outlook-classic-helper\instalar-protocolo.ps1"
```

Luego, en la web:

- Activar **Outlook Classic local** para abrir correos como borrador.
- Activar **Autoenviar correo Outlook** para enviar correos masivos automaticamente.
- Usar **Elegir cuenta Outlook** para seleccionar la cuenta local desde la que se enviaran los correos.

## Quitar

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Baul\ABG_RECOV\empresa_AIEP\tools\outlook-classic-helper\desinstalar-protocolo.ps1"
```
