# GitHub privado + Vercel

## Flujo recomendado

1. Crear un repositorio privado en GitHub, por ejemplo `aiep-cobranzas`.
2. Subir este proyecto al repositorio sin archivos sensibles.
3. Conectar ese repositorio a Vercel.
4. Configurar variables en Vercel para la app.
5. Configurar secrets en GitHub para importaciones desde Drive.

## Secrets de GitHub

Ir a:

```text
GitHub > Settings > Secrets and variables > Actions > New repository secret
```

Agregar:

```text
GOOGLE_DRIVE_AIEP_FOLDER_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

## Para llenar Drive por primera vez

Cuando la cuenta de servicio este lista y la carpeta `AIEP` este compartida con esa cuenta:

Opcion recomendada desde GitHub:

```text
GitHub > Actions > Preparar Google Drive AIEP > Run workflow
```

Desde GitHub se crearan las carpetas. Los archivos sensibles locales no se suben al repo, por lo que el workflow los omitira si no existen en GitHub.

Opcion local:

```powershell
cd D:\Baul\ABG_RECOV\empresa_AIEP\cloud\drive-sync
npm install
npm run setup:drive
```

Eso crea las subcarpetas y sube los archivos iniciales.

Si todavia no existe la cuenta de servicio, este paso queda bloqueado. No hay que poner la llave privada en el codigo ni pegarla en chats; debe ir en `.env` local, GitHub Secrets y Vercel Environment Variables.

## Para importar nuevos clientes

Subir un archivo Excel/CSV a:

```text
AIEP/01_Fuentes_Cartera/Pendientes
```

Luego ejecutar manualmente en GitHub Actions:

```text
Importar cartera desde Google Drive
```

Tambien queda programado todos los dias a las 09:00 UTC.

Los archivos procesados se mueven a `Procesados/YYYY-MM`. Si fallan, se mueven a `Rechazados` y se registra el error en Supabase.

## Deploy Vercel

Vercel debe conectarse al repo GitHub y usar las mismas variables operativas, pero las llaves privadas quedan solo en Environment Variables de Vercel, no en el codigo.
