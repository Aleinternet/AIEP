import os
import json
from pathlib import Path

try:
    import truststore

    truststore.inject_into_ssl()
except Exception:
    pass

from google_auth_oauthlib.flow import InstalledAppFlow


ROOT = Path(__file__).resolve().parents[2]
CLIENT_FILE = Path(os.getenv("GOOGLE_OAUTH_CLIENT_FILE", str(ROOT / "oauth-client.json"))).resolve()
TOKEN_FILE = Path(os.getenv("GOOGLE_OAUTH_TOKEN_FILE", str(Path(__file__).resolve().parent / "oauth-token.json"))).resolve()
SCOPES = ["https://www.googleapis.com/auth/drive"]


def main():
    if not CLIENT_FILE.exists():
        raise FileNotFoundError(
            f"No existe {CLIENT_FILE}. Descarga el OAuth Client JSON y guardalo con ese nombre, "
            "o define GOOGLE_OAUTH_CLIENT_FILE."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_FILE), scopes=SCOPES)
    credentials = flow.run_local_server(port=0, prompt="consent", access_type="offline")

    if not credentials.refresh_token:
        raise RuntimeError("Google no devolvio refresh_token. Revoca acceso anterior y vuelve a intentar.")

    print("GOOGLE_OAUTH_CLIENT_ID=" + flow.client_config["client_id"])
    print("GOOGLE_OAUTH_CLIENT_SECRET=" + flow.client_config["client_secret"])
    print("GOOGLE_OAUTH_REFRESH_TOKEN=" + credentials.refresh_token)

    TOKEN_FILE.write_text(
        json.dumps(
            {
                "client_id": flow.client_config["client_id"],
                "client_secret": flow.client_config["client_secret"],
                "refresh_token": credentials.refresh_token,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Token guardado localmente en: {TOKEN_FILE}")


if __name__ == "__main__":
    main()
