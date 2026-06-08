const crypto = require("crypto");
const { batchGetValues, getValues, updateValues, columnLetter } = require("./_google");
const { authErrorResponse, requireUser } = require("./_auth");
const { hashPassword, normalizeUsername, supabaseFetch } = require("./_data");

const SPREADSHEET_ID = (process.env.GOOGLE_SHEETS_AIEP_BASE_ID || "1JLprSdfbtg2MdPZbjQklsuvWcb4Vz696uTll0laGnFw").trim();
const BASE_SHEET = "Base";
const ASSIGNED_SHEET = "Asignados";
const REQUIRED_HEADERS = ["Usuario", "Contrasena", "Rol", "Activo"];

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  return Number(String(value || "").replace(/[^0-9-]/g, "")) || 0;
}

function parseMoney(value) {
  if (typeof value === "number") return Math.round(value);
  let raw = String(value || "").trim().replace(/\s+/g, "");
  if (!raw) return 0;
  if (/,\d{1,2}$/.test(raw)) raw = raw.replace(/,\d{1,2}$/, "");
  else if (/\.\d{1,2}$/.test(raw) && !/\.\d{3}(\D|$)/.test(raw)) raw = raw.replace(/\.\d{1,2}$/, "");
  return Number(raw.replace(/[^0-9-]/g, "")) || 0;
}

function firstHeaderIndex(headers, aliases) {
  const wanted = new Set(aliases.map(normalizeHeader));
  return headers.findIndex((header) => wanted.has(normalizeHeader(header)));
}

function assignmentKey(value) {
  return normalizeUsername(value);
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
    debtTotal: row.debtTotal || 0,
    capitalTotal: row.capitalTotal || 0,
    remesas: row.remesas,
    sheetRow: row.sheetRow,
    source: "google_sheets",
  };
}

async function readBaseMetrics() {
  const headerRows = await getValues(SPREADSHEET_ID, `${BASE_SHEET}!1:1`);
  const headers = headerRows[0] || [];
  if (!headers.length) return new Map();

  const indexes = {
    id: firstHeaderIndex(headers, ["id", "id rem", "id_rem", "codigo", "operacion", "remesa"]),
    assignment: firstHeaderIndex(headers, ["asignacion", "asignación", "asignaciÃ³n"]),
    total: firstHeaderIndex(headers, ["deuda total", "deuda_total", "saldo total pendiente", "total a pagar", "total"]),
    capital: firstHeaderIndex(headers, ["saldo capital", "saldo_capital", "capital", "monto deuda", "monto_deuda"]),
    interest: firstHeaderIndex(headers, ["intereses mora", "interes", "interes mora", "intereses_mora"]),
    expense: firstHeaderIndex(headers, ["gastos cobranza", "gasto cobranza", "gasto_cobranza", "gastos_cobranza"]),
  };
  if (indexes.assignment < 0) return new Map();

  const requested = [];
  const addColumn = (name, index) => {
    if (index < 0) return;
    const range = `${BASE_SHEET}!${columnLetter(index)}:${columnLetter(index)}`;
    if (!requested.some((item) => item.range === range)) requested.push({ name, range });
  };
  addColumn("id", indexes.id);
  addColumn("assignment", indexes.assignment);
  addColumn("total", indexes.total);
  addColumn("capital", indexes.capital);
  addColumn("interest", indexes.interest);
  addColumn("expense", indexes.expense);

  const values = await batchGetValues(SPREADSHEET_ID, requested.map((item) => item.range));
  const columns = {};
  requested.forEach((item, index) => {
    columns[item.name] = (values[index] || []).map((row) => row[0] || "");
  });

  const maxRows = Math.max(...Object.values(columns).map((col) => col.length), 0);
  const metrics = new Map();
  const seenDebtors = new Set();
  for (let rowIndex = 1; rowIndex < maxRows; rowIndex += 1) {
    const assignment = String(columns.assignment?.[rowIndex] || "").trim();
    if (!assignment) continue;
    const id = String(columns.id?.[rowIndex] || "").trim();
    const seenKey = id || `${assignment}|${rowIndex}`;
    if (id && seenDebtors.has(seenKey)) continue;
    if (id) seenDebtors.add(seenKey);

    const capital = parseMoney(columns.capital?.[rowIndex]);
    const interest = parseMoney(columns.interest?.[rowIndex]);
    const expense = parseMoney(columns.expense?.[rowIndex]);
    const total = parseMoney(columns.total?.[rowIndex]) || capital + interest + expense;
    const key = assignmentKey(assignment);
    const current = metrics.get(key) || { count: 0, debtTotal: 0, capitalTotal: 0 };
    current.count += 1;
    current.debtTotal += total;
    current.capitalTotal += capital;
    metrics.set(key, current);
  }
  return metrics;
}

function applyBaseMetrics(users, metrics) {
  return users.map((user) => {
    const metric = metrics.get(assignmentKey(user.assignmentName || user.displayName)) || {};
    return {
      ...user,
      cases: Number(metric.count || user.cases || 0),
      debtTotal: Number(metric.debtTotal || user.debtTotal || 0),
      capitalTotal: Number(metric.capitalTotal || user.capitalTotal || 0),
    };
  });
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
  const users = applyBaseMetrics(parsed.users, await readBaseMetrics());
  for (const user of users) await upsertAppUser(user);
  return users;
}

async function saveUser(input) {
  const parsed = await readAssignedSheet();
  const name = String(input.assignmentName || input.displayName || "").trim();
  if (!name) throw new Error("Asignacion requerida.");
  let target = parsed.users.find((user) => assignmentKey(user.assignmentName) === assignmentKey(name)
    || normalizeUsername(user.username) === normalizeUsername(input.username));

  if (!target) {
    const nameIndex = parsed.headerMap.get("nombre");
    const userIndex = parsed.headerMap.get("usuario");
    const passIndex = parsed.headerMap.get("contrasena");
    const roleIndex = parsed.headerMap.get("rol");
    const activeIndex = parsed.headerMap.get("activo");
    const newRow = Array(parsed.headers.length).fill("");
    newRow[nameIndex] = name;
    newRow[userIndex] = normalizeUsername(input.username || name);
    newRow[passIndex] = input.password || "123456";
    newRow[roleIndex] = normalizeRole(input.role || "callcenter");
    newRow[activeIndex] = input.active === false ? "NO" : "SI";
    const sheetRow = parsed.rows.length + 1;
    const lastColumn = columnLetter(parsed.headers.length - 1);
    await updateValues(SPREADSHEET_ID, `${ASSIGNED_SHEET}!A${sheetRow}:${lastColumn}${sheetRow}`, [newRow]);
    target = publicUser({
      username: newRow[userIndex],
      displayName: name,
      assignmentName: name,
      role: normalizeRole(newRow[roleIndex]),
      active: activeFromValue(newRow[activeIndex]),
      password: newRow[passIndex],
      cases: 0,
      remesas: {},
      sheetRow,
    });
    await upsertAppUser(target);
    return target;
  }

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
    await requireUser(req, ["informatico", "jefatura"]);
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
    authErrorResponse(res, error);
  }
};
