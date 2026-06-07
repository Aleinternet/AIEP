const { supabaseFetch } = require("./_data");
const { DRIVE_SCOPE, googleAccessToken, getValues } = require("./_google");

const SPREADSHEET_ID = (process.env.GOOGLE_SHEETS_AIEP_BASE_ID || "1JLprSdfbtg2MdPZbjQklsuvWcb4Vz696uTll0laGnFw").trim();
const DRIVE_FOLDER_ID = (process.env.GOOGLE_DRIVE_AIEP_FOLDER_ID || "1VzcG1kLr9noQR9UPvzRVZAU2peWwLe1i").trim();
const GITHUB_REPO = process.env.GITHUB_REPOSITORY || "Aleinternet/AIEP";

function ok(name, detail) {
  return { name, status: "ok", detail };
}

function warn(name, detail) {
  return { name, status: "warn", detail };
}

function bad(name, error) {
  return { name, status: "bad", detail: error?.message || String(error || "Falla no especificada") };
}

async function withTimeout(promise, ms = 8000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function checkSupabase() {
  try {
    await withTimeout(supabaseFetch("debtors?select=id&limit=1"));
    return ok("Supabase", "REST API y tabla debtors responden.");
  } catch (error) {
    return bad("Supabase", error);
  }
}

async function checkGoogleSheets() {
  try {
    const rows = await withTimeout(getValues(SPREADSHEET_ID, "Asignados!A1:A2"));
    return rows.length ? ok("Google Sheets", "AIEP_BASE_TOTAL responde.") : warn("Google Sheets", "AIEP_BASE_TOTAL responde, pero no devolvio filas.");
  } catch (error) {
    return bad("Google Sheets", error);
  }
}

async function checkGoogleDrive() {
  try {
    const token = await withTimeout(googleAccessToken(DRIVE_SCOPE));
    const response = await withTimeout(fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(DRIVE_FOLDER_ID)}?fields=id,name&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error?.message || `Drive HTTP ${response.status}`);
    return ok("Google Drive", `Carpeta ${json.name || "AIEP"} accesible.`);
  } catch (error) {
    return bad("Google Drive", error);
  }
}

async function checkGitHub() {
  try {
    const response = await withTimeout(fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
      headers: { "User-Agent": "abg-recov-aiep-health" },
    }));
    if (response.status === 403) return warn("GitHub", "GitHub responde, pero hay limite temporal de API.");
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    return ok("GitHub", `Repositorio ${GITHUB_REPO} accesible.`);
  } catch (error) {
    return bad("GitHub", error);
  }
}

async function checkVercel() {
  if (process.env.VERCEL) return ok("Vercel", `Funcion activa en ${process.env.VERCEL_REGION || "Vercel"}.`);
  return warn("Vercel", "Ejecutando fuera de Vercel o sin variable VERCEL.");
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
    return;
  }

  const checks = await Promise.all([
    checkGoogleDrive(),
    checkGoogleSheets(),
    checkSupabase(),
    checkVercel(),
    checkGitHub(),
  ]);
  const hasBad = checks.some((item) => item.status === "bad");
  const hasWarn = checks.some((item) => item.status === "warn");
  res.status(200).json({
    ok: true,
    status: hasBad ? "bad" : hasWarn ? "warn" : "ok",
    checkedAt: new Date().toISOString(),
    checks,
  });
};
