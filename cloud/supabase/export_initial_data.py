import csv
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
APP_DATA = ROOT / "web" / "data" / "app-data.js"
OUT_DIR = Path(__file__).resolve().parent / "seed"


def normalize_rut(value):
    return re.sub(r"[^0-9Kk]", "", str(value or "")).upper()


def clean_text(value):
    if value is None:
        return ""
    text = str(value)
    for encoding in ("cp1252", "latin1"):
        try:
            return text.encode(encoding).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
    return text


def load_data():
    raw = APP_DATA.read_text(encoding="utf-8")
    prefix = "window.ABG_DATA = "
    if not raw.startswith(prefix):
        raise RuntimeError(f"Formato no reconocido: {APP_DATA}")
    return json.loads(raw[len(prefix):].rstrip().rstrip(";"))


def write_csv(path, fieldnames, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    data = load_data()
    debtors = []
    contacts = []

    for item in data.get("debtors", []):
        debtor_id = item.get("id", "")
        debtors.append({
            "id": debtor_id,
            "rut_deudor": clean_text(item.get("rutDeudor", "")),
            "rut_deudor_normalizado": normalize_rut(item.get("rutDeudor")),
            "rut_titular": clean_text(item.get("rutTitular", "")),
            "rut_titular_normalizado": normalize_rut(item.get("rutTitular")),
            "nombre_titular": clean_text(item.get("nombreTitular", "")),
            "rut_alumno": clean_text(item.get("rutAlumno", "")),
            "rut_alumno_normalizado": normalize_rut(item.get("rutAlumno")),
            "nombre_alumno": clean_text(item.get("nombreAlumno", "")),
            "estado": clean_text(item.get("estado", "")),
            "cartera": clean_text(item.get("cartera", "")),
            "tramo": clean_text(item.get("tramo", "")),
            "region": clean_text(item.get("region", "")),
            "comuna": clean_text(item.get("comuna", "")),
            "direccion": clean_text(item.get("direccion", "")),
            "rol": clean_text(item.get("rol", "")),
            "tribunal": clean_text(item.get("tribunal", "")),
            "procedimiento": clean_text(item.get("procedimiento", "")),
            "usuario": clean_text(item.get("usuario", "")),
            "equipo": clean_text(item.get("equipo", "")),
            "asignacion": clean_text(item.get("asignacion", "")),
            "fecha_emision": item.get("fechaEmision") or "",
            "atraso_gestion": clean_text(item.get("atrasoGestion", "")),
            "tipo_contacto": clean_text(item.get("tipoContacto", "")),
            "resultado": clean_text(item.get("resultado", "")),
            "observacion": clean_text(item.get("observacion", "")),
            "ubicabilidad": clean_text(item.get("ubicabilidad", "")),
            "tel_validado": clean_text(item.get("telValidado", "")),
            "saldo_capital": int(item.get("saldoCapital") or 0),
            "intereses_mora": int(item.get("interes") or 0),
            "gastos_cobranza": int(item.get("gastoCobranza") or 0),
            "deuda_total": int(item.get("deudaTotal") or 0),
            "monto_oferta": int(item.get("montoOferta") or 0),
            "ultima_gestion": item.get("ultimaGestion") or "",
            "proxima_gestion": item.get("proximaGestion") or "",
        })

        for email in item.get("correos", []):
            contacts.append({
                "debtor_id": debtor_id,
                "type": "correo",
                "value": clean_text(email),
                "status": "sin_validar",
                "note": "",
            })
        for phone in item.get("telefonos", []):
            contacts.append({
                "debtor_id": debtor_id,
                "type": "telefono",
                "value": clean_text(phone),
                "status": "sin_validar",
                "note": "",
            })

    write_csv(OUT_DIR / "debtors.csv", [
        "id",
        "rut_deudor",
        "rut_deudor_normalizado",
        "rut_titular",
        "rut_titular_normalizado",
        "nombre_titular",
        "rut_alumno",
        "rut_alumno_normalizado",
        "nombre_alumno",
        "estado",
        "cartera",
        "tramo",
        "region",
        "comuna",
        "direccion",
        "rol",
        "tribunal",
        "procedimiento",
        "usuario",
        "equipo",
        "asignacion",
        "fecha_emision",
        "atraso_gestion",
        "tipo_contacto",
        "resultado",
        "observacion",
        "ubicabilidad",
        "tel_validado",
        "saldo_capital",
        "intereses_mora",
        "gastos_cobranza",
        "deuda_total",
        "monto_oferta",
        "ultima_gestion",
        "proxima_gestion",
    ], debtors)

    write_csv(OUT_DIR / "contacts.csv", [
        "debtor_id",
        "type",
        "value",
        "status",
        "note",
    ], contacts)

    print(f"Deudores exportados: {len(debtors)}")
    print(f"Contactos exportados: {len(contacts)}")
    print(f"Salida: {OUT_DIR}")


if __name__ == "__main__":
    main()
