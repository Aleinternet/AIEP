const crypto = require("crypto");
const { getValues, updateValues, columnLetter } = require("./_google");
const { hashPassword, loadInternalUser, normalizeUsername, supabaseFetch } = require("./_data");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_AIEP_BASE_ID || "1JLprSdfbtg2MdPZbjQklsuvWcb4Vz696uTll0laGnFw";
const ASSIGNED_SHEET = "Asignados";
const REQUIRED_HEADERS = ["Usuario", "Contrasena", "Rol", "Activo"];

async function requireAdmin(body) {
  const username = normalizeUsername(body.adminUser || "");
  const pass = body.adminPass || "";
  if ((username === "informatico" || username === "informatica") && pass === "789012") return true;
  if (username === "remesa" && pass === "654321") return true;
  const user = await loadInternalUser(username, pass);
  return Boolean(user && ["informatico", "jefatura"].includes(user.role));
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseNumber(value) {
  return Number(String(value || "").replace(/[^0-9-]/g, "")) || 0;
}

function normalizeRole(value) {
  const role = normalizeHeader(value);
  if (role.includes("jef")) return "jefatura";
  if (role.includes("inform")) return "informatico";
  return "callcenter";
}

function activeFromValue(value) {
  return !/^no|false|inactivo|0$/i.test(String(value || "").trim());
}

function isAssignmentRow(name) {
  const value = String(name || "").trim();
  return value && !/^total\b/i.test(value);
}

function publicUser(row) {
  return {
    id: row.username,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    assignmentName: row.assignmentName,
    active: row.active,
    password: row.password,
    cases: row.cases,
    remesas: row.remesas,
    sheetRow: row.sheetRow,
    source: "google_sheets",
  };
}

function parseSheet(values) {
  const rows = values.length ? values.map((row) => row.slice()) : [["Nombre"]];
  const headers = rows[0];
  const headerMap = new Map(headers.map((header, index) => [normalizeHeader(header), index]));
  for (const required of REQUIRED_HEADERS) {
    if (!headerMap.has(normalizeHeader(required))) {
      headerMap.set(normalizeHeader(required), headers.length);
      headers.push(required);
    }
  }

  const nameIndex = headerMap.get("nombre");
  const userIndex = headerMap.get("usuario");
  const passIndex = headerMap.get("contrasena");
  const roleIndex = headerMap.get("rol");
  const activeIndex = headerMap.get("activo");
  const totalIndex = headerMap.get("total general");
  const remesaIndexes = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => /^remesa\b/i.test(String(header || "")));

  const users = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const name = String(row[nameIndex] || "").trim();
    if (!isAssignmentRow(name)) continue;
    while (row.length < headers.length) row.push("");
    if (!row[userIndex]) row[userIndex] = normalizeUsername(name);
    if (!row[passIndex]) row[passIndex] = "123456";
    if (!row[roleIndex]) row[roleIndex] = "callcenter";
    if (!row[activeIndex]) row[activeIndex] = "SI";
    const remesas = {};
    for (const item of remesaIndexes) remesas[item.header] = parseNumber(row[item.index]);
    users.push(publicUser({
      username: normalizeUsername(row[userIndex]),
      displayName: name,
      assignmentName: name,
      role: normalizeRole(row[roleIndex] || "callcenter"),
      active: activeFromValue(row[activeIndex]),
      password: String(row[passIndex] || "123456"),
      cases: parseNumber(row[totalIndex]),
      remesas,
      sheetRow: index + 1,
    }));
  }

  return { rows, headers, headerMap, users };
}

async function readAssignedSheet() {
  const values = await getValues(SPREADSHEET_ID, `${ASSIGNED_SHEET}!A1:Z1000`);
  const parsed = parseSheet(values);
  const lastColumn = columnLetter(parsed.headers.length - 1);
  const lastRow = Math.max(parsed.rows.length, 1);
  await updateValues(SPREADSHEET_ID, `${ASSIGNED_SHEET}!A1:${lastColumn}${lastRow}`, parsed.rows);
  return parsed;
}

async function upsertAppUser(user) {
  const salt = crypto.randomBytes(16).toString("hex");
  const payload = {
    username: normalizeUsername(user.username),
    display_name: user.displayName || user.username,
    role: user.role || "callcenter",
    assignment_name: user.role === "callcenter" ? (user.assignmentName || user.displayName || "") : "",
    active: user.active !== false,
    password_hash: hashPassword(user.password || "123456", salt),
    password_salt: salt,
    password_changed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const existing = await supabaseFetch(`app_users?select=id&username=eq.${encodeURIComponent(payload.username)}&limit=1`).catch(() => []);
  if (existing[0]) {
    const rows = await supabaseFetch(`app_users?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return rows[0];
  }
  const rows = await supabaseFetch("app_users", {
    method: "POST",
    body: JSON.stringify({ ...payload, created_at: new Date().toISOString() }),
  });
  return rows[0];
}

async function syncUsers() {
  const parsed = await readAssignedSheet();
  for (const user of parsed.users) await upsertAppUser(user);
  return parsed.users;
}

async function saveUser(input) {
  const parsed = await readAssignedSheet();
  const name = String(input.assignmentName || input.displayName || "").trim();
  if (!name) throw new Error("Asignacion requerida.");
  const target = parsed.users.find((user) => normalizeHeader(user.assignmentName) === normalizeHeader(name)
    || normalizeUsername(user.username) === normalizeUsername(input.username));
  if (!target) throw new Error(`No existe asignado en hoja Asignados: ${name}`);

  const userIndex = parsed.headerMap.get("usuario");
  const passIndex = parsed.headerMap.get("contrasena");
  const roleIndex = parsed.headerMap.get("rol");
  const activeIndex = parsed.headerMap.get("activo");
  const row = parsed.rows[target.sheetRow - 1];
  row[userIndex] = normalizeUsername(input.username || target.username);
  row[passIndex] = input.password || target.password || "123456";
  row[roleIndex] = normalizeRole(input.role || target.role || "callcenter");
  row[activeIndex] = input.active === false ? "NO" : "SI";

  const lastColumn = columnLetter(parsed.headers.length - 1);
  await updateValues(SPREADSHEET_ID, `${ASSIGNED_SHEET}!A${target.sheetRow}:${lastColumn}${target.sheetRow}`, [row]);
  const saved = {
    ...target,
    username: row[userIndex],
    password: row[passIndex],
    role: normalizeRole(row[roleIndex]),
    active: activeFromValue(row[activeIndex]),
  };
  await upsertAppUser(saved);
  return saved;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
    return;
  }
  try {
    const body = req.body || {};
    if (!(await requireAdmin(body))) {
      res.status(403).json({ ok: false, error: "No autorizado" });
      return;
    }
    if (body.action === "sync" || body.action === "list") {
      res.status(200).json({ ok: true, spreadsheetId: SPREADSHEET_ID, users: await syncUsers() });
      return;
    }
    if (body.action === "save") {
      res.status(200).json({ ok: true, user: await saveUser(body.user || {}) });
      return;
    }
    res.status(400).json({ ok: false, error: "Accion no soportada" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Error interno" });
  }
};
