# Respaldo Google Drive

Carpeta destino: `abgrecov - AIEP`.

## Flujo recomendado

1. Crear una cuenta de servicio en Google Cloud.
2. Habilitar Google Drive API.
3. Crear la carpeta `abgrecov - AIEP` en Google Drive.
4. Compartir esa carpeta con el correo de la cuenta de servicio como editor.
5. Guardar en Vercel:
   - `GOOGLE_DRIVE_FOLDER_ID`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
6. Crear endpoint server-side `/api/cron/backup-google-drive`.
7. El endpoint debe:
   - Validar `CRON_SECRET`.
   - Exportar tablas criticas desde Supabase.
   - Generar archivos JSON/CSV/XLSX.
   - Subirlos a Drive con nombre fechado, por ejemplo:
     - `AIEP_debtors_2026-05-15.json`
     - `AIEP_agreements_2026-05-15.csv`
     - `AIEP_management_entries_2026-05-15.csv`
     - `AIEP_files_index_2026-05-15.json`
   - Registrar el resultado en `drive_backups`.

## Criterio

Google Drive queda como respaldo externo y auditable. La operacion diaria debe leer/escribir en Supabase, no directo en Drive.
