import { Readable } from "node:stream";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const TABLES = [
  "debtors",
  "contacts",
  "management_entries",
  "internal_comments",
  "agreements",
  "agreement_payments",
  "files",
];

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

function privateKey(): string {
  return requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
}

function assertCronAccess(request: Request): void {
  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const urlSecret = new URL(request.url).searchParams.get("secret") || "";
  const expected = requiredEnv("CRON_SECRET");
  if (bearer !== expected && urlSecret !== expected) {
    throw new Error("No autorizado");
  }
}

export async function GET(request: Request) {
  try {
    assertCronAccess(request);

    const supabase = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    const auth = clientId && clientSecret && refreshToken
      ? new google.auth.OAuth2(clientId, clientSecret)
      : new google.auth.JWT({
          email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
          key: privateKey(),
          scopes: ["https://www.googleapis.com/auth/drive.file"],
        });
    if (clientId && clientSecret && refreshToken && "setCredentials" in auth) {
      auth.setCredentials({ refresh_token: refreshToken });
    }
    const drive = google.drive({ version: "v3", auth });
    const folderId = requiredEnv("GOOGLE_DRIVE_FOLDER_ID");
    const date = new Date().toISOString().slice(0, 10);
    const uploaded: Array<{ table: string; fileId: string; name: string }> = [];

    for (const table of TABLES) {
      const { data, error } = await supabase.from(table).select("*");
      if (error) throw error;

      const name = `AIEP_${table}_${date}.json`;
      const body = JSON.stringify({ exportedAt: new Date().toISOString(), table, rows: data }, null, 2);
      const created = await drive.files.create({
        requestBody: {
          name,
          parents: [folderId],
          mimeType: "application/json",
        },
        media: {
          mimeType: "application/json",
          body: Readable.from([body]),
        },
        fields: "id,name",
      });

      await supabase.from("drive_backups").insert({
        backup_type: table,
        drive_folder_id: folderId,
        drive_file_id: created.data.id,
        file_name: name,
        status: "creado",
      });

      uploaded.push({ table, fileId: created.data.id || "", name });
    }

    return NextResponse.json({ ok: true, uploaded });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    const status = message === "No autorizado" ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
