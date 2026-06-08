const { authErrorResponse, requireUser } = require("./_auth");
const { supabaseFetch, normalizeRut } = require("./_data");
const { batchGetValues, batchUpdateValues, columnLetter, getValues } = require("./_google");
const { writeAudit } = require("./_audit");

const SPREADSHEET_ID = (process.env.GOOGLE_SHEETS_AIEP_BASE_ID || "1JLprSdfbtg2MdPZbjQklsuvWcb4Vz696uTll0laGnFw").trim();
const BASE_SHEET = "Base";
const MAX_KEYS = 1200;

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function firstHeaderIndex(headers, aliases) {
  const wanted = new Set(aliases.map(normalizeHeader));
  return headers.findIndex((header) => wanted.has(normalizeHeader(header)));
}

function parseKeys(input) {
  const values = Array.isArray(input.keys) ? input.keys : String(input.keysText || input.keys || "")
    .split(/[\s,;|]+/);
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, MAX_KEYS);
}

function quotedIn(values) {
  return `in.(${values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(",")})`;
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function findDebtors(keys) {
  const raw = [...new Set(keys.map((key) => String(key).trim()).filter(Boolean))];
  const normalizedRuts = [...new Set(raw.map(normalizeRut).filter((rut) => rut.length >= 7))];
  const found = new Map();

  for (const rawChunk of chunk(raw, 80)) {
    const query = new URLSearchParams({
      select: "id,rut_deudor_normalizado,rut_titular_normalizado,rut_alumno_normalizado,asignacion,usuario,equipo,nombre_titular,nombre_alumno",
      id: quotedIn(rawChunk),
    });
    const rows = await supabaseFetch(`debtors?${query.toString()}`).catch(() => []);
    rows.forEach((row) => found.set(row.id, row));
  }

  for (const rutChunk of chunk(normalizedRuts, 80)) {
    const or = [
      `rut_deudor_normalizado.${quotedIn(rutChunk)}`,
      `rut_titular_normalizado.${quotedIn(rutChunk)}`,
      `rut_alumno_normalizado.${quotedIn(rutChunk)}`,
    ].join(",");
    const query = new URLSearchParams({
      select: "id,rut_deudor_normalizado,rut_titular_normalizado,rut_alumno_normalizado,asignacion,usuario,equipo,nombre_titular,nombre_alumno",
      or: `(${or})`,
    });
    const rows = await supabaseFetch(`debtors?${query.toString()}`).catch(() => []);
    rows.forEach((row) => found.set(row.id, row));
  }

  return [...found.values()];
}

function debtorMatchesKey(row, key) {
  const clean = normalizeRut(key);
  return row.id === key
    || (clean && [
      row.rut_deudor_normalizado,
      row.rut_titular_normalizado,
      row.rut_alumno_normalizado,
    ].map(normalizeRut).includes(clean));
}

function unmatchedKeys(keys, debtors) {
  return keys.filter((key) => !debtors.some((row) => debtorMatchesKey(row, key)));
}

async function updateSupabaseDebtors(ids, targetAssignment) {
  const updated = [];
  for (const idChunk of chunk(ids, 150)) {
    const params = new URLSearchParams({ id: quotedIn(idChunk) });
    const rows = await supabaseFetch(`debtors?${params.toString()}`, {
      method: "PATCH",
      body: JSON.stringify({
        asignacion: targetAssignment,
        updated_at: new Date().toISOString(),
      }),
    });
    updated.push(...rows);
  }
  return updated;
}

async function updateBaseSheet(keys, targetAssignment) {
  const headerRows = await getValues(SPREADSHEET_ID, `${BASE_SHEET}!1:1`);
  const headers = headerRows[0] || [];
  if (!headers.length) return { updated: 0, warning: "Hoja Base sin encabezados." };

  const indexes = {
    id: firstHeaderIndex(headers, ["id", "id rem", "id_rem", "codigo", "operacion"]),
    rutDeudor: firstHeaderIndex(headers, ["rut_deudor", "rut deudor"]),
    rutTitular: firstHeaderIndex(headers, ["rut_titular", "rut titular"]),
    rutAlumno: firstHeaderIndex(headers, ["rut_alumno", "rut alumno"]),
    assignment: firstHeaderIndex(headers, ["asignacion", "asignación", "asignaciÃ³n", "asignaciÃƒÂ³n"]),
  };
  if (indexes.assignment < 0) return { updated: 0, warning: "No existe columna asignacion en Base." };

  const requested = [];
  for (const [name, index] of Object.entries(indexes)) {
    if (index >= 0) requested.push({ name, index, range: `${BASE_SHEET}!${columnLetter(index)}:${columnLetter(index)}` });
  }
  const values = await batchGetValues(SPREADSHEET_ID, requested.map((item) => item.range));
  const columns = {};
  requested.forEach((item, index) => {
    columns[item.name] = (values[index] || []).map((row) => row[0] || "");
  });

  const rawKeys = new Set(keys);
  const rutKeys = new Set(keys.map(normalizeRut).filter(Boolean));
  const maxRows = Math.max(...Object.values(columns).map((col) => col.length), 0);
  const assignmentColumn = columnLetter(indexes.assignment);
  const updates = [];

  for (let rowIndex = 1; rowIndex < maxRows; rowIndex += 1) {
    const candidates = [
      columns.id?.[rowIndex],
      columns.rutDeudor?.[rowIndex],
      columns.rutTitular?.[rowIndex],
      columns.rutAlumno?.[rowIndex],
    ].filter(Boolean);
    const matches = candidates.some((value) => rawKeys.has(String(value).trim()) || rutKeys.has(normalizeRut(value)));
    if (matches) {
      updates.push({
        range: `${BASE_SHEET}!${assignmentColumn}${rowIndex + 1}`,
        values: [[targetAssignment]],
      });
    }
  }

  if (!updates.length) return { updated: 0, warning: "" };
  await batchUpdateValues(SPREADSHEET_ID, updates);
  return { updated: updates.length, warning: "" };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
    return;
  }

  try {
    const user = await requireUser(req, ["informatico"]);
    const body = req.body || {};
    const targetAssignment = String(body.targetAssignment || body.assignment || "").trim();
    const reason = String(body.reason || "").trim();
    const keys = parseKeys(body);

    if (!targetAssignment) {
      res.status(400).json({ ok: false, error: "Asignado destino requerido." });
      return;
    }
    if (!keys.length) {
      res.status(400).json({ ok: false, error: "Debe informar RUTs o id_rem." });
      return;
    }

    const debtors = await findDebtors(keys);
    const ids = debtors.map((row) => row.id);
    const unmatched = unmatchedKeys(keys, debtors);
    const sheetResult = await updateBaseSheet(keys, targetAssignment);
    const updatedRows = ids.length ? await updateSupabaseDebtors(ids, targetAssignment) : [];

    await writeAudit(user, "reassign_bulk", "debtor", "bulk", {
      before: debtors.slice(0, 100).map((row) => ({ id: row.id, asignacion: row.asignacion })),
      after: { targetAssignment, updated: updatedRows.length, sheetUpdated: sheetResult.updated, unmatched: unmatched.length },
      metadata: { reason, inputCount: keys.length },
    }, req);

    res.status(200).json({
      ok: true,
      updated: updatedRows.map((row) => ({ id: row.id, asignacion: row.asignacion })),
      unmatched,
      sheetUpdated: sheetResult.updated,
      warning: sheetResult.warning || "",
    });
  } catch (error) {
    authErrorResponse(res, error);
  }
};
