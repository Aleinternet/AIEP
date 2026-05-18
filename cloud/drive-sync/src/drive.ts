import fs from "node:fs";
import path from "node:path";
import { google, drive_v3 } from "googleapis";
import { env, privateKey } from "./config.js";

export function driveClient() {
  const useOAuth = env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const auth = useOAuth
    ? new google.auth.OAuth2(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET)
    : new google.auth.JWT({
        email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: privateKey(),
        scopes: ["https://www.googleapis.com/auth/drive"],
      });

  if (useOAuth && "setCredentials" in auth) {
    auth.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });
  }

  return google.drive({ version: "v3", auth });
}

export async function findChildFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
) {
  const escaped = name.replace(/'/g, "\\'");
  const response = await drive.files.list({
    q: `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files?.[0] ?? null;
}

export async function ensureFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
) {
  const existing = await findChildFolder(drive, parentId, name);
  if (existing?.id) return existing.id;

  const created = await drive.files.create({
    requestBody: {
      name,
      parents: [parentId],
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id,name",
    supportsAllDrives: true,
  });

  if (!created.data.id) throw new Error(`No se pudo crear carpeta ${name}`);
  return created.data.id;
}

export async function ensurePath(
  drive: drive_v3.Drive,
  rootId: string,
  folderPath: string,
) {
  const parts = folderPath.split("/").filter(Boolean);
  let parentId = rootId;
  for (const part of parts) {
    parentId = await ensureFolder(drive, parentId, part);
  }
  return parentId;
}

export async function uploadFile(
  drive: drive_v3.Drive,
  parentId: string,
  localPath: string,
  mimeType: string,
) {
  const name = path.basename(localPath);
  const existing = await drive.files.list({
    q: `'${parentId}' in parents and name='${name.replace(/'/g, "\\'")}' and trashed=false`,
    fields: "files(id,name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const media = {
    mimeType,
    body: fs.createReadStream(localPath),
  };

  if (existing.data.files?.[0]?.id) {
    const updated = await drive.files.update({
      fileId: existing.data.files[0].id,
      media,
      fields: "id,name,webViewLink",
      supportsAllDrives: true,
    });
    return updated.data;
  }

  const created = await drive.files.create({
    requestBody: { name, parents: [parentId] },
    media,
    fields: "id,name,webViewLink",
    supportsAllDrives: true,
  });

  return created.data;
}

export async function moveFile(
  drive: drive_v3.Drive,
  fileId: string,
  targetFolderId: string,
) {
  const file = await drive.files.get({
    fileId,
    fields: "parents",
    supportsAllDrives: true,
  });
  const previousParents = file.data.parents?.join(",") ?? "";

  return drive.files.update({
    fileId,
    addParents: targetFolderId,
    removeParents: previousParents,
    fields: "id,parents",
    supportsAllDrives: true,
  });
}
