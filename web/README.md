# Plataforma Cobranzas REMESA / AIEP

MVP web estático para gestión de cobranzas, armado desde:

- `base_jtudela_2026-05-11_1510.xlsx`
- `cartola_abril.xlsx`
- `Documento_Plataforma_Cobranzas_REMESA_AIEP.pdf`

## Estructura

- `index.html`: aplicación principal.
- `assets/css/styles.css`: diseño responsive.
- `assets/js/app.js`: lógica de dashboard, cartera, ficha, campañas y conciliación.
- `data/app-data.js`: datos generados desde las planillas.
- `scripts/generate_data.py`: regenerador de datos.

## Uso recomendado

Ejecutar:

```powershell
D:\Baul\ABG_RECOV\empresa_AIEP\web\iniciar-servidor.bat
```

Esto abre un servidor local y carga la web en:

```text
http://localhost:8080
```

También puede abrirse directamente `web/index.html` en el navegador.

Si se usa `iniciar-servidor.ps1` y PowerShell bloquea scripts, usar el `.bat`. No es necesario cambiar políticas de seguridad de Windows.

## Credenciales

- Deudor: ingresar con RUT de titular o RUT de alumno, sin contraseña. Acepta puntos, guion o RUT limpio.
- Ejecutivo call center: `callcenter` / `123456`.
- Jefatura: `remesa` / `654321`.

## Flujo local

- Las gestiones, comentarios, marcas de teléfonos/correos y referencias de archivos se guardan en el navegador local.
- Los comprobantes de deudor y ejecutivo se guardan en el mismo repositorio local.
- Las cartolas bancarias subidas por jefatura también quedan en el repositorio local.
- Esta versión local no reemplaza un backend definitivo; deja el flujo preparado para migrarlo a base de datos y almacenamiento web.

Para regenerar datos después de cambiar los Excel:

```powershell
& 'C:\Users\Alecifu\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' web\scripts\generate_data.py
```

## Regla comercial implementada

La oferta de liquidación se calcula sobre `saldo_capital * 50%`. `deuda_total` queda como dato referencial.
