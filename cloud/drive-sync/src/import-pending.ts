import { createClient } from "@supabase/supabase-js";
import { read, utils } from "xlsx";
import { driveClient, ensurePath, moveFile } from "./drive.js";
import { env } from "./config.js";

type RawRow = Record<string, unknown>;

function normalizeRut(value: unknown) {
  return String(value ?? "").replace(/[^0-9Kk]/g, "").toUpperCase();
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function money(value: unknown) {
  const cleaned = String(value ?? "0").replace(/[^0-9-]/g, "");
  return Number.parseInt(cleaned || "0", 10);
}

function findValue(row: RawRow, aliases: string[]) {
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.toLowerCase().trim();
    if (normalizedAliases.includes(normalizedKey)) return value;
  }
  return "";
}

function mapDebtor(row: RawRow) {
  const rutTitular = text(findValue(row, ["rut titular", "rut_titular", "rut deudor"]));
  const rutAlumno = text(findValue(row, ["rut alumno", "rut_alumno"]));
  const id = text(findValue(row, ["id", "codigo", "operacion"])) || `AIEP ${normalizeRut(rutTitular)} ${normalizeRut(rutAlumno)}`;

  return {
    id,
    rut_titular: rutTitular,
    rut_titular_normalizado: normalizeRut(rutTitular),
    nombre_titular: text(findValue(row, ["nombre titular", "titular", "nombre_titular"])),
    rut_alumno: rutAlumno,
    rut_alumno_normalizado: normalizeRut(rutAlumno),
    nombre_alumno: text(findValue(row, ["nombre alumno", "alumno", "nombre_alumno"])),
    estado: text(findValue(row, ["estado"])) || "ACUERDO ROTO",
    cartera: text(findValue(row, ["cartera"])),
    tramo: text(findValue(row, ["tramo"])),
    region: text(findValue(row, ["region", "región"])),
    comuna: text(findValue(row, ["comuna"])),
    direccion: text(findValue(row, ["direccion", "dirección"])),
    rol: text(findValue(row, ["rol"])),
    tribunal: text(findValue(row, ["tribunal"])),
    saldo_capital: money(findValue(row, ["saldo capital", "capital", "saldo_capital"])),
    intereses_mora: money(findValue(row, ["intereses mora", "interes", "interés", "intereses_mora"])),
    gastos_cobranza: money(findValue(row, ["gastos cobranza", "gasto cobranza", "gastos_cobranza"])),
    deuda_total: money(findValue(row, ["deuda total", "total", "deuda_total"])),
    monto_oferta: money(findValue(row, ["monto oferta", "oferta", "monto_oferta"])),
  };
}

function splitValues(value: unknown) {
  return String(value ?? "")
    .split(/[;,|/\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapContacts(row: RawRow, debtorId: string) {
  const emails = splitValues(findValue(row, ["correo", "correos", "mail", "email", "e-mail"]));
  const phones = splitValues(findValue(row, ["telefono", "teléfono", "telefonos", "teléfonos", "celular", "celulares", "fono"]));

  return [
    ...emails.map((value) => ({
      debtor_id: debtorId,
      type: "correo",
      value,
      status: "sin_validar",
      note: "",
    })),
    ...phones.map((value) => ({
      debtor_id: debtorId,
      type: "telefono",
      value,
      status: "sin_validar",
      note: "",
    })),
  ];
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
    fields: "files(id,name,mimeType)",
    pageSize: 50,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  for (const file of pending.data.files ?? []) {
    if (!file.id || !file.name) continue;

    await supabase.from("drive_imports").upsert({
      drive_file_id: file.id,
      drive_file_name: file.name,
      drive_folder_path: "01_Fuentes_Cartera/Pendientes",
      status: "procesando",
    }, { onConflict: "drive_file_id" });

    try {
      const response = await drive.files.get(
        { fileId: file.id, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" },
      );
      const workbook = read(response.data, { type: "buffer" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = utils.sheet_to_json<RawRow>(firstSheet, { defval: "" });
      const debtors = rows.map(mapDebtor).filter((row) => row.rut_titular_normalizado || row.rut_alumno_normalizado);
      const contacts = rows.flatMap((row) => {
        const debtor = mapDebtor(row);
        return debtor.id ? mapContacts(row, debtor.id) : [];
      });

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
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
