import hashlib
import os
import re
import secrets
from datetime import datetime, timezone

from import_pending import dedupe_by, map_contacts, map_debtor, normalize_header, supabase_upsert
from setup_drive import sheets_service


BASE_SHEET_ID = (os.getenv("GOOGLE_SHEETS_AIEP_BASE_ID") or "1JLprSdfbtg2MdPZbjQklsuvWcb4Vz696uTll0laGnFw").strip()
BASE_SHEET_NAME = "Base"
ASSIGNED_SHEET_NAME = "Asignados"
READ_CHUNK_SIZE = int(os.getenv("GOOGLE_SHEETS_READ_CHUNK_SIZE", "5000"))


def normalize_username(value):
    import unicodedata

    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = re.sub(r"[^a-zA-Z0-9]+", ".", text.lower()).strip(".")
    return text[:42] or "ejecutivo"


def hash_password(password, salt):
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def column_letter(index):
    value = index + 1
    output = ""
    while value > 0:
        value, mod = divmod(value - 1, 26)
        output = chr(65 + mod) + output
    return output


def sheet_range(sheet_name, a1_range):
    escaped = sheet_name.replace("'", "''")
    return f"'{escaped}'!{a1_range}"


def get_values(service, sheet_name, a1_range):
    response = service.spreadsheets().values().get(
        spreadsheetId=BASE_SHEET_ID,
        range=sheet_range(sheet_name, a1_range),
        valueRenderOption="FORMATTED_VALUE",
    ).execute()
    return response.get("values", [])


def sheet_rows(sheet_name, chunk_size=READ_CHUNK_SIZE):
    service = sheets_service()
    header_values = get_values(service, sheet_name, "1:1")
    if not header_values:
        raise RuntimeError(f"AIEP_BASE_TOTAL no tiene encabezados en hoja {sheet_name}")
    headers = [str(header or "").strip() for header in header_values[0]]
    last_column = column_letter(len(headers) - 1)
    rows = []
    start_row = 2

    while True:
        end_row = start_row + chunk_size - 1
        values = get_values(service, sheet_name, f"A{start_row}:{last_column}{end_row}")
        if not values:
            break
        for raw_row in values:
            if not any(str(cell or "").strip() for cell in raw_row):
                continue
            row = {
                headers[index]: raw_row[index]
                for index in range(min(len(headers), len(raw_row)))
                if headers[index]
            }
            rows.append(row)
        if len(values) < chunk_size:
            break
        start_row = end_row + 1

    return rows


def value(row, name):
    target = normalize_header(name)
    for key, cell in row.items():
        if normalize_header(key) == target:
            return cell
    return ""


def active_value(raw):
    return not re.match(r"^(no|false|inactivo|0)$", str(raw or "").strip(), re.I)


def sync_base(rows):
    mapped = [(row, map_debtor(row)) for row in rows]
    debtors = dedupe_by(
        [debtor for _, debtor in mapped if debtor["rut_titular_normalizado"] or debtor["rut_alumno_normalizado"]],
        lambda item: item["id"],
    )
    contacts = dedupe_by(
        [contact for row, debtor in mapped for contact in map_contacts(row, debtor["id"])],
        lambda item: f'{item["debtor_id"]}|{item["type"]}|{item["value"].lower()}',
    )
    supabase_upsert("debtors", debtors, "id")
    supabase_upsert("contacts", contacts, "debtor_id,type,value")
    return len(debtors), len(contacts)


def sync_assigned(rows):
    users = []
    now = datetime.now(timezone.utc).isoformat()
    for row in rows:
        name = str(value(row, "Nombre") or "").strip()
        if not name or name.lower().startswith("total"):
            continue
        username = normalize_username(value(row, "Usuario") or name)
        password = str(value(row, "Contrasena") or value(row, "Contraseña") or "123456")
        role = str(value(row, "Rol") or "callcenter").strip().lower()
        if role not in {"callcenter", "jefatura", "informatico"}:
            role = "callcenter"
        salt = secrets.token_hex(16)
        users.append({
            "username": username,
            "display_name": name,
            "role": role,
            "assignment_name": name if role == "callcenter" else "",
            "active": active_value(value(row, "Activo") or "SI"),
            "password_hash": hash_password(password, salt),
            "password_salt": salt,
            "password_changed_at": now,
            "updated_at": now,
            "created_at": now,
        })
    supabase_upsert("app_users", users, "username")
    return len(users)


def main():
    for name in ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]:
        if not os.getenv(name):
            raise RuntimeError(f"Falta {name}")

    debtors, contacts = sync_base(sheet_rows(BASE_SHEET_NAME))
    users = sync_assigned(sheet_rows(ASSIGNED_SHEET_NAME))
    print(f"OK AIEP_BASE_TOTAL importado: {debtors} deudores, {contacts} contactos, {users} perfiles")


if __name__ == "__main__":
    main()
