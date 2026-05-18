import { Readable } from "node:stream";
import { createClient } from "@supabase/supabase-js";
import { google, drive_v3 } from "googleapis";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

function privateKey(): string {
  return requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
}

function driveClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const auth = clientId && clientSecret && refreshToken
    ? new google.auth.OAuth2(clientId, clientSecret)
    : new google.auth.JWT({
        email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
        key: privateKey(),
        scopes: ["https://www.googleapis.com/auth/drive"],
      });

  if (clientId && clientSecret && refreshToken && "setCredentials" in auth) {
    auth.setCredentials({ refresh_token: refreshToken });
  }

  return google.drive({ version: "v3", auth });
}

async function ensureFolder(drive: drive_v3.Drive, parentId: string, name: string) {
  const escaped = name.replace(/'/g, "\\'");
  const existing = await drive.files.list({
    q: `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (existing.data.files?.[0]?.id) return existing.data.files[0].id;

  const created = await drive.files.create({
    requestBody: {
      name,
      parents: [parentId],
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error(`No se pudo crear carpeta ${name}`);
  return created.data.id;
}

async function ensurePath(drive: drive_v3.Drive, rootId: string, folderPath: string) {
  let parentId = rootId;
  for (const part of folderPath.split("/").filter(Boolean)) {
    parentId = await ensureFolder(drive, parentId, part);
  }
  return parentId;
}

function folderPathForUpload(role: string, kind: string, debtorRut: string) {
  const month = new Date().toISOString().slice(0, 7);
  const cleanRut = debtorRut.replace(/[^0-9Kk]/g, "").toUpperCase() || "SIN_RUT";

  if (kind === "cartola_bancaria") return `05_Cartolas_Jefatura/${month}`;
  if (role === "callcenter") return `04_Comprobantes_CallCenter/${month}/${cleanRut}`;
  if (role === "deudor") return `03_Comprobantes_Deudores/${month}/${cleanRut}`;
  return `09_Auditoria/${month}`;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Falta archivo" }, { status: 400 });
    }

    const role = String(form.get("role") || "");
    const kind = String(form.get("kind") || "otro");
    const debtorId = String(form.get("debtorId") || "");
    const debtorRut = String(form.get("debtorRut") || "");
    const uploadedBy = String(form.get("uploadedBy") || "");
    const folderPath = folderPathForUpload(role, kind, debtorRut);

    const drive = driveClient();
    const folderId = await ensurePath(drive, requiredEnv("GOOGLE_DRIVE_AIEP_FOLDER_ID"), folderPath);
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = `${new Date().toISOString().replace(/[:.]/g, "-")}__${file.name}`;

    const uploaded = await drive.files.create({
      requestBody: {
        name: safeName,
        parents: [folderId],
      },
      media: {
        mimeType: file.type || "application/octet-stream",
        body: Readable.from(buffer),
      },
      fields: "id,name,webViewLink,size",
      supportsAllDrives: true,
    });

    const supabase = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );

    const { data, error } = await supabase.from("files").insert({
      debtor_id: debtorId || null,
      kind,
      original_name: file.name,
      storage_path: folderPath,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: uploadedBy || null,
      uploaded_role: role || null,
      drive_file_id: uploaded.data.id,
      drive_web_url: uploaded.data.webViewLink,
      drive_folder_path: folderPath,
    }).select("id,drive_file_id,drive_web_url").single();

    if (error) throw error;
    return NextResponse.json({ ok: true, file: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
