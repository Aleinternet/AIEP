# WhatsApp local autoenviar

Este helper permite que la web use WhatsApp Desktop para enviar el mensaje automaticamente mediante `whatsapp://send` y `SendKeys`.

## Instalar en cada PC del call center

Ejecutar en PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Baul\ABG_RECOV\empresa_AIEP\tools\whatsapp-local-helper\instalar-protocolo.ps1"
```

Luego, en la web, activar la casilla **WhatsApp local autoenviar**.

Debe existir WhatsApp Desktop instalado y con sesion iniciada.

## Quitar

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Baul\ABG_RECOV\empresa_AIEP\tools\whatsapp-local-helper\desinstalar-protocolo.ps1"
```
