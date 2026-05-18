import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const envSchema = z.object({
  GOOGLE_DRIVE_AIEP_FOLDER_ID: z.string().min(1),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_PRIVATE_KEY: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export function privateKey() {
  if (!env.GOOGLE_PRIVATE_KEY) throw new Error("Falta GOOGLE_PRIVATE_KEY");
  return env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
}

export const driveTree = [
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
] as const;

export const initialUploads = [
  {
    localPath: "Documento_Plataforma_Cobranzas_REMESA_AIEP.pdf",
    driveFolder: "00_Config/Documentacion",
    mimeType: "application/pdf",
  },
  {
    localPath: "base_jtudela_2026-05-11_1510.xlsx",
    driveFolder: "01_Fuentes_Cartera/Procesados/2026-05",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    localPath: "cartola_abril.xlsx",
    driveFolder: "05_Cartolas_Jefatura/2026-04",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    localPath: "cloud/supabase/seed/debtors.csv",
    driveFolder: "02_Importaciones_Procesadas/Seed_Inicial",
    mimeType: "text/csv",
  },
  {
    localPath: "cloud/supabase/seed/contacts.csv",
    driveFolder: "02_Importaciones_Procesadas/Seed_Inicial",
    mimeType: "text/csv",
  },
] as const;
