import { createClient } from "@supabase/supabase-js";
import type { drive_v3 } from "googleapis";
import { read, utils } from "xlsx";
import { driveClient, ensurePath, moveFile } from "./drive.js";
import { env } from "./config.js";

type RawRow = Record<string, unknown>;
type ContactRow = {
  debtor_id: string;
  type: "correo" | "telefono";
  value: string;
  status: "sin_validar";
  note: string;
};

const SUPPORTED_MIME_TYPES = new Set([
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
]);

function normalizeRut(value: unknown) {
  return String(value ?? "").replace(/[^0-9Kk]/g, "").toUpperCase();
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function money(value: unknown) {
  if (typeof value === "number") return Math.round(value);

  let raw = String(value ?? "").trim();
  if (!raw) return 0;

  raw = raw.replace(/\s/g, "");
  if (/,\d{1,2}$/.test(raw)) raw = raw.replace(/,\d{1,2}$/, "");
  else if (/\.\d{1,2}$/.test(raw) && !/\.\d{3}(\D|$)/.test(raw)) raw = raw.replace(/\.\d{1,2}$/, "");

  const cleaned = raw.replace(/[^0-9-]/g, "");
  return Number.parseInt(cleaned || "0", 10);
}

function dateText(value: unknown) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value);
  const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!match) return raw || null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function normalizeHeader(value: string) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
}

function findValue(row: RawRow, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeHeader(key);
    if (normalizedAliases.includes(normalizedKey)) return value;
  }
  return "";
}

function mapDebtor(row: RawRow) {
  const rutDeudor = text(findValue(row, ["rut deudor", "rut_deudor", "rut cliente", "rut_cliente"]));
  const rutTitular = text(findValue(row, ["rut titular", "rut_titular"])) || rutDeudor;
  const rutAlumno = text(findValue(row, ["rut alumno", "rut_alumno", "rut estudiante", "rut_estudiante"]));
  const id = text(findValue(row, ["id", "id rem", "id_rem", "codigo", "operacion", "remesa"]))
    || `AIEP ${normalizeRut(rutTitular)} ${normalizeRut(rutAlumno)}`;
  const saldoCapital = money(findValue(row, ["saldo capital", "capital", "saldo_capital", "monto deuda", "monto_deuda"]));
  const interesesMora = money(findValue(row, ["intereses mora", "interes", "interes mora", "intereses_mora"]));
  const gastosCobranza = money(findValue(row, ["gastos cobranza", "gasto cobranza", "gasto_cobranza", "gastos_cobranza"]));
  const deudaTotal = money(findValue(row, ["deuda total", "total", "deuda_total"])) || saldoCapital + interesesMora + gastosCobranza;

  return {
    id,
    rut_deudor: rutDeudor || rutTitular,
    rut_deudor_normalizado: normalizeRut(rutDeudor || rutTitular),
    rut_titular: rutTitular,
    rut_titular_normalizado: normalizeRut(rutTitular),
    nombre_titular: text(findValue(row, [
      "nombre titular",
      "titular",
      "nombre_titular",
      "nombre deudor",
      "nombre_deudor",
      "deudor",
    ])),
    rut_alumno: rutAlumno,
    rut_alumno_normalizado: normalizeRut(rutAlumno),
    nombre_alumno: text(findValue(row, [
      "nombre alumno",
      "alumno",
      "nombre_alumno",
      "nombre estudiante",
      "nombre_estudiante",
      "estudiante",
    ])),
    estado: text(findValue(row, ["estado"])) || "ACUERDO ROTO",
    cartera: text(findValue(row, ["cartera"])),
    tramo: text(findValue(row, ["tramo", "tramo_deuda"])),
    region: text(findValue(row, ["region"])),
    comuna: text(findValue(row, ["comuna"])),
    direccion: text(findValue(row, ["direccion"])),
    rol: text(findValue(row, ["rol"])),
    tribunal: text(findValue(row, ["tribunal"])),
    procedimiento: text(findValue(row, ["procedimiento", "escrito de la demanda", "escrito_de_la_demanda"])) || (text(findValue(row, ["rol"])) || text(findValue(row, ["tribunal"])) ? "Procedimiento (CIVIL)" : ""),
    usuario: text(findValue(row, ["usuario", "ejecutivo"])),
    equipo: text(findValue(row, ["equipo"])),
    asignacion: text(findValue(row, ["asignacion", "asignación"])),
    fecha_emision: dateText(findValue(row, ["fecha emision", "fecha_emision"])),
    atraso_gestion: text(findValue(row, ["atraso gestion", "atraso_gestion"])),
    tipo_contacto: text(findValue(row, ["tipo contacto", "tipo_contacto"])),
    resultado: text(findValue(row, ["resultado"])),
    observacion: text(findValue(row, ["observacion", "observación"])),
    ubicabilidad: text(findValue(row, ["ubicabilidad"])),
    tel_validado: text(findValue(row, ["tel validado", "tel_validado"])),
    saldo_capital: saldoCapital,
    intereses_mora: interesesMora,
    gastos_cobranza: gastosCobranza,
    deuda_total: deudaTotal,
    monto_oferta: money(findValue(row, ["monto oferta", "oferta", "monto_oferta"])),
  };
}

function splitValues(value: unknown) {
  return String(value ?? "")
    .split(/[;,|/\n\r]+/)
    .map((item) => item.trim())
    .filter((item) => item && item.toLowerCase() !== "none");
}

function numberedValues(row: RawRow, prefix: string, max: number) {
  const values: string[] = [];
  for (let index = 1; index <= max; index += 1) {
    const value = text(findValue(row, [`${prefix}_${index}`]));
    if (value && value.toLowerCase() !== "none") values.push(value);
  }
  return values;
}

function mapContacts(row: RawRow, debtorId: string): ContactRow[] {
  const emails = [
    ...splitValues(findValue(row, ["correo", "correos", "mail", "email", "e-mail"])),
    ...numberedValues(row, "correo", 10),
    ...numberedValues(row, "email", 10),
    ...numberedValues(row, "mail", 10),
  ];
  const phones = [
    ...splitValues(findValue(row, ["telefono", "telefonos", "celular", "celulares", "fono"])),
    ...numberedValues(row, "telefono", 20),
    ...numberedValues(row, "celular", 20),
    ...numberedValues(row, "fono", 20),
  ];

  return [
    ...emails.map((value) => ({
      debtor_id: debtorId,
      type: "correo" as const,
      value,
      status: "sin_validar" as const,
      note: "",
    })),
    ...phones.map((value) => ({
      debtor_id: debtorId,
      type: "telefono" as const,
      value,
      status: "sin_validar" as const,
      note: "",
    })),
  ];
}

function dedupeContacts(contacts: ContactRow[]) {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const value = contact.type === "correo"
      ? contact.value.trim().toLowerCase()
      : contact.value.replace(/\D/g, "");
    if (!value) return false;

    const key = `${contact.debtor_id}|${contact.type}|${value}`;
    if (seen.has(key)) return false;

    seen.add(key);
    contact.value = contact.type === "telefono" ? value : contact.value.trim();
    return true;
  });
}

function dedupeDebtors<T extends { id: string }>(debtors: T[]) {
  const seen = new Set<string>();
  return debtors.filter((debtor) => {
    const key = debtor.id.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    debtor.id = key;
    return true;
  });
}

function canImport(file: drive_v3.Schema$File) {
  const name = file.name?.toLowerCase() ?? "";
  return SUPPORTED_MIME_TYPES.has(file.mimeType ?? "")
    || name.endsWith(".xlsx")
    || name.endsWith(".xls")
    || name.endsWith(".csv");
}

function toBuffer(data: unknown) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(String(data));
}

async function downloadWorkbookBuffer(drive: drive_v3.Drive, file: drive_v3.Schema$File) {
  if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    const response = await drive.files.export(
      {
        fileId: file.id ?? "",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      { responseType: "arraybuffer" },
    );
    return toBuffer(response.data);
  }

  const response = await drive.files.get(
    { fileId: file.id ?? "", alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return toBuffer(response.data);
}

async function main() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }

  const drive = driveClient();
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const pendingFolderId = await ensurePath(
    drive,
    env.GOOGLE_DRIVE_AIEP_FOLDER_ID,
    "01_Fuentes_Cartera/Pendientes",
  );
  const processedFolderId = await ensurePath(
    drive,
    env.GOOGLE_DRIVE_AIEP_FOLDER_ID,
    `01_Fuentes_Cartera/Procesados/${new Date().toISOString().slice(0, 7)}`,
  );
  const rejectedFolderId = await ensurePath(
    drive,
    env.GOOGLE_DRIVE_AIEP_FOLDER_ID,
    "01_Fuentes_Cartera/Rechazados",
  );

  const pending = await drive.files.list({
    q: `'${pendingFolderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,webViewLink)",
    pageSize: 50,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  let failedImports = 0;

  for (const file of pending.data.files ?? []) {
    if (!file.id || !file.name) continue;
    if (file.mimeType === "application/vnd.google-apps.folder") continue;

    await supabase.from("drive_imports").upsert({
      drive_file_id: file.id,
      drive_file_name: file.name,
      drive_folder_path: "01_Fuentes_Cartera/Pendientes",
      status: "procesando",
    }, { onConflict: "drive_file_id" });

    try {
      if (!canImport(file)) throw new Error(`Tipo de archivo no soportado: ${file.mimeType ?? "sin mimeType"}`);

      const workbookBuffer = await downloadWorkbookBuffer(drive, file);
      const workbook = read(workbookBuffer, { type: "buffer" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = utils.sheet_to_json<RawRow>(firstSheet, { defval: "" });
      const mappedRows = rows.map((raw) => ({ raw, debtor: mapDebtor(raw) }));
      const debtors = dedupeDebtors(mappedRows
        .map(({ debtor }) => debtor)
        .filter((row) => row.rut_titular_normalizado || row.rut_alumno_normalizado));
      const contacts = dedupeContacts(mappedRows.flatMap(({ raw, debtor }) => (
        debtor.id ? mapContacts(raw, debtor.id) : []
      )));

      if (debtors.length) {
        const { error } = await supabase.from("debtors").upsert(debtors, { onConflict: "id" });
        if (error) throw error;
      }

      if (contacts.length) {
        const { error } = await supabase.from("contacts").upsert(contacts, { onConflict: "debtor_id,type,value" });
        if (error) throw error;
      }

      await supabase.from("drive_imports").upsert({
        drive_file_id: file.id,
        drive_file_name: file.name,
        drive_folder_path: `01_Fuentes_Cartera/Procesados/${new Date().toISOString().slice(0, 7)}`,
        status: "procesado",
        rows_read: rows.length,
        debtors_upserted: debtors.length,
        contacts_upserted: contacts.length,
        error_message: null,
        processed_at: new Date().toISOString(),
      }, { onConflict: "drive_file_id" });

      await moveFile(drive, file.id, processedFolderId);
      console.log(`Importado ${file.name}: ${debtors.length} deudores, ${contacts.length} contactos`);
    } catch (error) {
      failedImports += 1;
      const message = error instanceof Error ? error.message : "Error desconocido";
      await supabase.from("drive_imports").upsert({
        drive_file_id: file.id,
        drive_file_name: file.name,
        drive_folder_path: "01_Fuentes_Cartera/Rechazados",
        status: "rechazado",
        error_message: message,
        processed_at: new Date().toISOString(),
      }, { onConflict: "drive_file_id" });
      await moveFile(drive, file.id, rejectedFolderId);
      console.error(`Rechazado ${file.name}: ${message}`);
    }
  }

  if (failedImports > 0) {
    throw new Error(`${failedImports} archivo(s) rechazado(s)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
