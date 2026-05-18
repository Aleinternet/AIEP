# Migracion cloud REMESA / AIEP

Objetivo: publicar la plataforma en Vercel, con datos centralizados en una base cloud y respaldo automatico en Google Drive dentro de la carpeta `abgrecov - AIEP`.

## Arquitectura recomendada

1. Vercel
   - Hospeda la aplicacion web.
   - Expone rutas API seguras para login, deudores, gestiones, convenios, archivos y respaldos.
   - Ejecuta un cron diario para respaldar la base y los metadatos.

2. Base de datos principal
   - Recomendado: Supabase Postgres.
   - Motivo: la pagina maneja muchos registros, comentarios, convenios, pagos, bitacoras y filtros. Google Drive no debe ser la base principal porque no controla bien concurrencia ni consultas.

3. Almacenamiento de archivos
   - Recomendado: Supabase Storage o Vercel Blob para comprobantes y cartolas.
   - Los archivos deben quedar relacionados por `debtor_id`, tipo de archivo y fecha de carga.

4. Google Drive
   - Usarlo como respaldo, no como base principal.
   - Carpeta destino: `abgrecov - AIEP`.
   - Cada respaldo debe subir JSON/CSV/XLSX de tablas importantes y, opcionalmente, copia de comprobantes/cartolas.

5. ClaveUnica
   - Debe implementarse con OAuth/OpenID Connect real en backend.
   - El `client_secret` nunca debe quedar en el navegador ni en el codigo fuente.

## Relacion con los scripts GASCO

El script GASCO revisado usa `gspread` y una cuenta de servicio para Google Sheets. Eso sirve como referencia de autenticacion Google, pero para esta web necesitamos Google Drive API para subir archivos de respaldo.

Importante: el bot Telegram de GASCO tiene un token escrito en el codigo. Si se va a mover a nube, ese token debe regenerarse y pasar a variables de entorno.

## Pasos de implementacion

1. Crear proyecto Supabase y ejecutar `supabase/schema.sql`.
2. Crear bucket privado para comprobantes/cartolas.
3. Crear carpeta Google Drive `abgrecov - AIEP`.
4. Crear una cuenta de servicio en Google Cloud y compartirle esa carpeta como editor.
5. Crear proyecto Vercel y configurar las variables de `vercel/.env.example`.
6. Migrar la app actual desde `web/` a Next.js:
   - `/` ingreso cliente.
   - `/deudor` vista de deuda.
   - `/callcenter` gestion ejecutiva.
   - `/jefatura` dashboard.
   - `/jefatura/convenios` registro de convenios.
   - `/api/*` operaciones protegidas.
7. Reemplazar `localStorage` e `IndexedDB` por llamadas API.
8. Activar cron de respaldo a Google Drive.

## Regla critica

La version actual local no debe subirse como producto final para uso real, porque guarda gestiones, comentarios, convenios y archivos en el navegador. En Vercel debe quedar una base central para que jefatura, ejecutivo y deudores vean la misma informacion.
