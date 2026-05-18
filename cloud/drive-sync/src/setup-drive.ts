import fs from "node:fs";
import path from "node:path";
import { driveTree, env, initialUploads, ROOT } from "./config.js";
import { driveClient, ensurePath, uploadFile } from "./drive.js";

async function main() {
  const drive = driveClient();
  const folders = new Map<string, string>();

  for (const folderPath of driveTree) {
    const folderId = await ensurePath(drive, env.GOOGLE_DRIVE_AIEP_FOLDER_ID, folderPath);
    folders.set(folderPath, folderId);
    console.log(`OK carpeta: ${folderPath}`);
  }

  for (const item of initialUploads) {
    const folderId = folders.get(item.driveFolder);
    if (!folderId) throw new Error(`No existe folderId para ${item.driveFolder}`);

    const localPath = path.join(ROOT, item.localPath);
    if (!fs.existsSync(localPath)) {
      console.warn(`SKIP archivo no encontrado localmente: ${item.localPath}`);
      continue;
    }

    const uploaded = await uploadFile(drive, folderId, localPath, item.mimeType);
    console.log(`OK archivo: ${item.localPath} -> ${uploaded.webViewLink ?? uploaded.id}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
