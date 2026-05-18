import csv
import getpass
import json
import os
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT / "cloud" / "supabase" / "seed"


def env_or_prompt(name, secret=False):
    value = os.getenv(name)
    if value:
        return value
    return getpass.getpass(f"{name}: ") if secret else input(f"{name}: ").strip()


def read_csv(name):
    path = SEED_DIR / name
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def postgrest_upsert(url, key, table, rows, conflict):
    if not rows:
        return
    endpoint = f"{url.rstrip('/')}/rest/v1/{table}?on_conflict={conflict}"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(rows).encode("utf-8"),
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Error importando {table}: {exc.code} {detail}") from exc


def chunks(rows, size=500):
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


def main():
    url = env_or_prompt("SUPABASE_URL")
    key = env_or_prompt("SUPABASE_SERVICE_ROLE_KEY", secret=True)

    debtors = read_csv("debtors.csv")
    contacts = read_csv("contacts.csv")

    for batch in chunks(debtors):
        postgrest_upsert(url, key, "debtors", batch, "id")
    print(f"OK deudores importados/actualizados: {len(debtors)}")

    for batch in chunks(contacts):
        postgrest_upsert(url, key, "contacts", batch, "debtor_id,type,value")
    print(f"OK contactos importados/actualizados: {len(contacts)}")


if __name__ == "__main__":
    main()
