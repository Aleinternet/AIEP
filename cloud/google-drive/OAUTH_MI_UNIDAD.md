# OAuth para subir archivos a Mi unidad

La cuenta de servicio ya pudo crear carpetas en `Mi unidad`, pero Google Drive no le permite subir archivos porque las cuentas de servicio no tienen cuota de almacenamiento propia en carpetas de `Mi unidad`.

Para que los comprobantes, cartolas y respaldos se guarden en tu Google Drive personal, hay dos alternativas:

## Opcion recomendada si usas cuenta personal

Usar OAuth del usuario dueño del Drive.

Necesitamos crear un OAuth Client en Google Cloud:

1. Google Cloud Console > APIs & Services > OAuth consent screen.
2. Configurar app externa o interna segun corresponda.
3. Agregar scope:
   `https://www.googleapis.com/auth/drive`
4. Crear credenciales OAuth Client.
5. Tipo recomendado para obtener refresh token local: `Desktop app`.
6. Descargar el JSON del OAuth Client.
7. Generar `GOOGLE_OAUTH_REFRESH_TOKEN`.
8. Guardar en GitHub Secrets y Vercel:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REFRESH_TOKEN`

Con esos datos, los workflows y rutas Vercel usan OAuth y los archivos ocupan la cuota del Drive del usuario.

## Opcion alternativa

Usar una unidad compartida de Google Workspace.

En ese caso la cuenta de servicio puede subir archivos porque la cuota pertenece a la unidad compartida. Esto no suele estar disponible en cuentas personales de Google One.

## Estado actual

La estructura de carpetas ya fue creada en:

```text
https://drive.google.com/drive/folders/1VzcG1kLr9noQR9UPvzRVZAU2peWwLe1i
```

La subida de archivos queda pendiente hasta configurar OAuth o usar unidad compartida.
