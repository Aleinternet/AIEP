# Paso a paso despues de crear el proyecto en Vercel

## 1. No subir todavia la carpeta `web` como producto final

La version actual es local y contiene la cartera completa en `web/data/app-data.js`.
Si se publica asi, cualquier persona podria descargar RUT, telefonos, correos y deudas.

Vercel debe recibir una version con backend, donde el navegador solo vea el deudor autenticado o la vista autorizada del ejecutivo/jefatura.

## 2. Crear base de datos en Supabase

1. Crear proyecto en Supabase.
2. Abrir SQL Editor.
3. Ejecutar `cloud/supabase/schema.sql`.
4. Ejecutar la migracion incremental:
   `cloud/supabase/migrations/20260518_drive_imports_and_files.sql`.
5. Importar:
   - `cloud/supabase/seed/debtors.csv`
   - `cloud/supabase/seed/contacts.csv`

Estos CSV no deben subirse a GitHub.

## 3. Crear carpeta Google Drive

1. Crear carpeta `abgrecov - AIEP`.
2. Crear cuenta de servicio en Google Cloud.
3. Habilitar Google Drive API.
4. Compartir la carpeta con el correo de la cuenta de servicio como editor.
5. Guardar el ID de la carpeta.

## 4. Configurar variables en Vercel

En Vercel, ir a:

Project Settings > Environment Variables

Configurar las variables de `cloud/vercel/.env.example`:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_DRIVE_AIEP_FOLDER_ID`
- `GOOGLE_DRIVE_FOLDER_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REFRESH_TOKEN`
- `CRON_SECRET`
- `CLAVEUNICA_CLIENT_ID`
- `CLAVEUNICA_CLIENT_SECRET`
- `CLAVEUNICA_REDIRECT_URI`

Las contrasenas internas deben guardarse como hash, no como texto plano.

## 5. Migrar la app a Next.js

Rutas recomendadas:

- `/` ingreso deudor con ClaveUnica.
- `/ingreso-ejecutivo` login interno.
- `/deudor` vista individual del deudor autenticado.
- `/callcenter` gestion de cartera.
- `/jefatura` dashboard.
- `/jefatura/convenios` registro de convenios.
- `/api/*` endpoints protegidos.

## 6. Activar respaldo

Cuando la app ya sea Next.js:

1. Mover `cloud/vercel/route-examples/backup-google-drive.ts` a:
   `app/api/cron/backup-google-drive/route.ts`
2. Mover `cloud/vercel/route-examples/upload-file-to-drive.ts` a:
   `app/api/files/upload/route.ts`
3. Usar `cloud/vercel/vercel.json` para programar el respaldo diario.
4. Probar manualmente:
   `/api/cron/backup-google-drive?secret=VALOR_CRON_SECRET`

## 7. Deploy final

1. Subir el proyecto seguro a GitHub.
2. Conectar GitHub con Vercel.
3. Verificar que Vercel haga build sin errores.
4. Probar:
   - ingreso deudor
   - ingreso call center
   - ingreso jefatura
   - carga de comprobantes
   - carga de cartola
   - creacion/edicion/eliminacion de convenios
   - respaldo Google Drive

## Decision tecnica

Lo correcto es publicar solo despues de tener backend. Publicar la version estatica local sirve para una demo privada, pero no para uso real con deudores y jefatura.
