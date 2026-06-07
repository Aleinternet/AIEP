import os
import json
from pathlib import Path

try:
    import truststore

    truststore.inject_into_ssl()
except Exception:
    pass

try:
    import certifi
    import httplib2

    httplib2.CA_CERTS = certifi.where()
except Exception:
    pass

from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from google_auth_httplib2 import AuthorizedHttp
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_KEY_FILE = ROOT / "aiep-496715-c806474bf4f6.json"
ROOT_FOLDER_ID = os.getenv("GOOGLE_DRIVE_AIEP_FOLDER_ID") or "1VzcG1kLr9noQR9UPvzRVZAU2peWwLe1i"
KEY_FILE = Path(os.getenv("GOOGLE_SERVICE_ACCOUNT_KEY_FILE", str(DEFAULT_KEY_FILE))).resolve()
TOKEN_FILE = Path(os.getenv("GOOGLE_OAUTH_TOKEN_FILE", str(Path(__file__).resolve().parent / "oauth-token.json"))).resolve()
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]
SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
SCOPES = DRIVE_SCOPES

DRIVE_TREE = [
    "00_Config",
    "00_Config/Documentacion",
    "01_Fuentes_Cartera",
    "01_Fuentes_Cartera/Pendientes",
    "01_Fuentes_Cartera/Procesados",
    "01_Fuentes_Cartera/Procesados/2026-05",
    "01_Fuentes_Cartera/Rechazados",
    "02_Importaciones_Procesadas",
    "02_Importaciones_Procesadas/Seed_Inicial",
    "03_Comprobantes_Deudores",
    "04_Comprobantes_CallCenter",
    "05_Cartolas_Jefatura",
    "05_Cartolas_Jefatura/2026-04",
    "06_Conciliacion",
    "07_Reportes_Jefatura",
    "08_Backups_DB",
    "09_Auditoria",
]

INITIAL_UPLOADS = [
    (
        "Documento_Plataforma_Cobranzas_REMESA_AIEP.pdf",
        "00_Config/Documentacion",
        "application/pdf",
    ),
    (
        "base_jtudela_2026-05-11_1510.xlsx",
        "01_Fuentes_Cartera/Procesados/2026-05",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    (
        "cartola_abril.xlsx",
        "05_Cartolas_Jefatura/2026-04",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    (
        "cloud/supabase/seed/debtors.csv",
        "02_Importaciones_Procesadas/Seed_Inicial",
        "text/csv",
    ),
    (
        "cloud/supabase/seed/contacts.csv",
        "02_Importaciones_Procesadas/Seed_Inicial",
        "text/csv",
    ),
]


def google_credentials(scopes=None):
    scopes = scopes or DRIVE_SCOPES
    auth_mode = os.getenv("GOOGLE_AUTH_MODE", "").strip().lower()
    oauth_client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
    oauth_client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
    oauth_refresh_token = os.getenv("GOOGLE_OAUTH_REFRESH_TOKEN")
    service_account_email = (os.getenv("GOOGLE_SERVICE_ACCOUNT_EMAIL") or "aiep-drive@aiep-496715.iam.gserviceaccount.com").strip()
    service_account_private_key = os.getenv("GOOGLE_PRIVATE_KEY")

    if auth_mode == "service_account":
        oauth_client_id = ""
        oauth_client_secret = ""
        oauth_refresh_token = ""

    if TOKEN_FILE.exists() and auth_mode != "service_account" and not (oauth_client_id and oauth_client_secret and oauth_refresh_token):
        token_data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
        oauth_client_id = token_data.get("client_id")
        oauth_client_secret = token_data.get("client_secret")
        oauth_refresh_token = token_data.get("refresh_token")

    if auth_mode != "service_account" and oauth_client_id and oauth_client_secret and oauth_refresh_token:
        credentials = Credentials(
            token=None,
            refresh_token=oauth_refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=oauth_client_id,
            client_secret=oauth_client_secret,
            scopes=scopes,
        )
    elif service_account_email and service_account_private_key:
        credentials = service_account.Credentials.from_service_account_info(
            {
                "type": "service_account",
                "client_email": service_account_email,
                "private_key": service_account_private_key.strip().replace("\\n", "\n"),
                "token_uri": "https://oauth2.googleapis.com/token",
            },
            scopes=scopes,
        )
    else:
        if not KEY_FILE.exists():
            raise FileNotFoundError(f"No existe llave de servicio: {KEY_FILE}")
        credentials = service_account.Credentials.from_service_account_file(
            str(KEY_FILE),
            scopes=scopes,
        )
    return credentials


def google_service(api, version, scopes=None):
    credentials = google_credentials(scopes)
    try:
        import certifi
        import httplib2

        http = AuthorizedHttp(credentials, http=httplib2.Http(ca_certs=certifi.where()))
        return build(api, version, http=http)
    except Exception:
        return build(api, version, credentials=credentials)


def drive_service():
    return google_service("drive", "v3", DRIVE_SCOPES)


def sheets_service():
    return google_service("sheets", "v4", SHEETS_SCOPES)


def find_child_folder(service, parent_id, name):
    escaped = name.replace("'", "\\'")
    response = service.files().list(
        q=f"'{parent_id}' in parents and name='{escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields="files(id,name)",
        pageSize=10,
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    ).execute()
    files = response.get("files", [])
    return files[0]["id"] if files else None


def ensure_folder(service, parent_id, name):
    existing = find_child_folder(service, parent_id, name)
    if existing:
        return existing

    created = service.files().create(
        body={
            "name": name,
            "parents": [parent_id],
            "mimeType": "application/vnd.google-apps.folder",
        },
        fields="id,name",
        supportsAllDrives=True,
    ).execute()
    return created["id"]


def ensure_path(service, root_id, folder_path):
    parent_id = root_id
    for part in [item for item in folder_path.split("/") if item]:
        parent_id = ensure_folder(service, parent_id, part)
    return parent_id


def find_child_file(service, parent_id, name):
    escaped = name.replace("'", "\\'")
    response = service.files().list(
        q=f"'{parent_id}' in parents and name='{escaped}' and trashed=false",
        fields="files(id,name)",
        pageSize=1,
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    ).execute()
    files = response.get("files", [])
    return files[0]["id"] if files else None


def upload_or_update(service, folder_id, local_path, mime_type):
    name = local_path.name
    media = MediaFileUpload(str(local_path), mimetype=mime_type, resumable=True)
    existing = find_child_file(service, folder_id, name)

    if existing:
        return service.files().update(
            fileId=existing,
            media_body=media,
            fields="id,name,webViewLink",
            supportsAllDrives=True,
        ).execute()

    return service.files().create(
        body={"name": name, "parents": [folder_id]},
        media_body=media,
        fields="id,name,webViewLink",
        supportsAllDrives=True,
    ).execute()


def main():
    service = drive_service()
    folder_ids = {}

    for folder_path in DRIVE_TREE:
        folder_ids[folder_path] = ensure_path(service, ROOT_FOLDER_ID, folder_path)
        print(f"OK carpeta: {folder_path}")

    for relative_path, drive_folder, mime_type in INITIAL_UPLOADS:
        local_path = ROOT / relative_path
        if not local_path.exists():
            print(f"SKIP no existe: {relative_path}")
            continue
        uploaded = upload_or_update(service, folder_ids[drive_folder], local_path, mime_type)
        print(f"OK archivo: {relative_path} -> {uploaded.get('webViewLink', uploaded['id'])}")


if __name__ == "__main__":
    main()
