# Seguridad de secretos

Los secretos de Google y Supabase no deben pegarse en chats, commits, issues ni archivos del repo.

## Accion necesaria

Como las llaves fueron expuestas fuera de los paneles de Google/Supabase, hay que rotarlas antes de dejar el sistema en produccion.

Tambien aplica para OAuth:

1. Revocar el acceso OAuth desde la cuenta Google cuando terminen las pruebas.
2. Regenerar `GOOGLE_OAUTH_CLIENT_SECRET` si se mantiene el mismo OAuth client.
3. Generar un nuevo `GOOGLE_OAUTH_REFRESH_TOKEN`.
4. Reemplazar los secrets en GitHub y Vercel.

## Google Cloud

1. Ir a Google Cloud Console.
2. IAM & Admin > Service Accounts.
3. Abrir la cuenta `aiep-drive@aiep-496715.iam.gserviceaccount.com`.
4. Keys.
5. Eliminar la llave JSON actual.
6. Crear una llave nueva solo si se seguira usando cuenta de servicio.
7. Actualizar GitHub Secrets y Vercel Environment Variables.

## Supabase

1. Ir a Supabase Dashboard.
2. Project Settings > API Keys.
3. Regenerar la `secret key` usada por backend.
4. Si se usa legacy `service_role`, rotar segun el panel de Supabase.
5. Actualizar GitHub Secrets y Vercel Environment Variables.

## GitHub

En GitHub, cada valor se guarda con:

```text
Settings > Secrets and variables > Actions > New repository secret > Add secret
```

No guardar secretos en archivos `.env` dentro del repo. Los `.env` locales estan ignorados por Git.
