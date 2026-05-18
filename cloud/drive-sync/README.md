# Google Drive como fuente de archivos AIEP

Carpeta raiz detectada:

```text
https://drive.google.com/drive/folders/1VzcG1kLr9noQR9UPvzRVZAU2peWwLe1i
```

ID:

```text
1VzcG1kLr9noQR9UPvzRVZAU2peWwLe1i
```

## Estructura que debe crearse en Drive

```text
AIEP/
  00_Config/
    Documentacion/
  01_Fuentes_Cartera/
    Pendientes/
    Procesados/
    Rechazados/
  02_Importaciones_Procesadas/
    Seed_Inicial/
  03_Comprobantes_Deudores/
  04_Comprobantes_CallCenter/
  05_Cartolas_Jefatura/
  06_Conciliacion/
  07_Reportes_Jefatura/
  08_Backups_DB/
  09_Auditoria/
```

## Regla operativa

Google Drive sera la fuente documental:

- Nuevas carteras o actualizaciones se suben a `01_Fuentes_Cartera/Pendientes`.
- GitHub Actions revisa esa carpeta cada 30 minutos y tambien se puede ejecutar manualmente.
- Cada Excel, CSV o Google Sheet encontrado se procesa y actualiza Supabase.
- Luego mueve el archivo a `Procesados/YYYY-MM` o `Rechazados`.
- El resultado queda registrado en la tabla `drive_imports`.
- Todo comprobante/cartola subido desde la pagina se guarda en Drive y deja metadatos en Supabase.
  - Deudor: `03_Comprobantes_Deudores/YYYY-MM/RUT`
  - Call center: `04_Comprobantes_CallCenter/YYYY-MM/RUT`
  - Jefatura/cartolas: `05_Cartolas_Jefatura/YYYY-MM`

Supabase sigue siendo la base operacional porque permite filtros, roles, reportes y concurrencia. Drive guarda los archivos originales, respaldos y evidencia.

## Flujo para agregar nuevos clientes

1. Subir el archivo a:

```text
AIEP/01_Fuentes_Cartera/Pendientes
```

2. Esperar hasta 30 minutos o ejecutar manualmente:

```text
GitHub > AIEP > Actions > Importar cartera desde Google Drive > Run workflow
```

3. Revisar el resultado:

```text
Procesados/YYYY-MM  -> archivo importado correctamente
Rechazados          -> archivo con error
Supabase drive_imports -> detalle de filas, contactos y errores
```

4. Recargar la pagina de Vercel. La cartera visible se actualiza desde Supabase, no desde archivos locales.

El importador acepta `.xlsx`, `.xls`, `.csv` y Google Sheets nativos. Reconoce nombres de columnas comunes como `rut_titular`, `rut_deudor`, `rut_alumno`, `rut_estudiante`, `saldo_capital`, `intereses_mora`, `gastos_cobranza`, `correo_1`, `telefono_1`, etc.

## Variables necesarias

Configurar en GitHub Actions:

```text
GOOGLE_DRIVE_AIEP_FOLDER_ID=1VzcG1kLr9noQR9UPvzRVZAU2peWwLe1i
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REFRESH_TOKEN=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

La carpeta `AIEP` debe estar compartida como editor con el correo de la cuenta de servicio.

Configurar en Vercel para que la pagina lea datos:

```text
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Archivos locales que se subiran al preparar Drive

- `base_jtudela_2026-05-11_1510.xlsx` -> `01_Fuentes_Cartera/Procesados/2026-05`
- `cartola_abril.xlsx` -> `05_Cartolas_Jefatura/2026-04`
- `Documento_Plataforma_Cobranzas_REMESA_AIEP.pdf` -> `00_Config/Documentacion`
- `cloud/supabase/seed/debtors.csv` -> `02_Importaciones_Procesadas/Seed_Inicial`
- `cloud/supabase/seed/contacts.csv` -> `02_Importaciones_Procesadas/Seed_Inicial`

## GitHub + Vercel

La forma recomendada es:

1. Repositorio privado en GitHub.
2. Vercel conectado a ese repositorio.
3. Variables secretas en Vercel, no en el repo.
4. GitHub Actions opcional para ejecutar imports manuales o programados.
