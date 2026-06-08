const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const crypto = require("crypto");

function requireSupabaseEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel.");
  }
}

function normalizeRut(value = "") {
  return String(value).replace(/[^0-9Kk]/g, "").toUpperCase();
}

function normalizeUsername(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function httpError(statusCode, message, code = "error") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeAssignment(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function validCallcenterAssignment(value = "") {
  const assignment = normalizeAssignment(value);
  if (!assignment) return "";
  if (["callcenter", "call center", "sin asignacion", "sin asignación"].includes(assignment)) return "";
  return assignment;
}

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

async function supabaseFetch(path, options = {}) {
  requireSupabaseEnv();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase ${response.status}: ${detail}`);
  }
  return response.json();
}

async function supabaseFetchWithCount(path, options = {}) {
  requireSupabaseEnv();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "count=exact",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase ${response.status}: ${detail}`);
  }
  const contentRange = response.headers.get("content-range") || "";
  const total = Number(contentRange.split("/")[1]);
  return {
    rows: await response.json(),
    count: Number.isFinite(total) ? total : null,
  };
}

async function supabaseFetchAll(path, pageSize = 1000) {
  const rows = [];
  let from = 0;

  while (true) {
    const page = await supabaseFetch(path, {
      headers: { Range: `${from}-${from + pageSize - 1}` },
    });
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

function businessRules() {
  return {
    discountRate: 0.5,
    offerFormula: "saldo_capital * 50%",
    commissionRate: 0.25,
    bankAccount: "Banco BCI - Comercial Remesa SpA - RUT 76.976.117-9 - Cuenta Corriente 27826341",
  };
}

function contactPathForDebtors(ids) {
  if (!ids.length) return "";
  const quoted = ids.map((id) => `"${String(id).replace(/"/g, '\\"')}"`).join(",");
  const query = new URLSearchParams({
    select: "debtor_id,type,value",
    debtor_id: `in.(${quoted})`,
    order: "debtor_id.asc,type.asc,value.asc",
  });
  return `contacts?${query.toString()}`;
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function contactsForDebtorRows(debtRows, chunkSize = 100, concurrency = 4) {
  const ids = [...new Set(debtRows.map((row) => row.id).filter(Boolean))];
  if (!ids.length) return new Map();
  const contactsByDebtor = new Map();
  const chunks = chunkArray(ids, chunkSize);
  for (let index = 0; index < chunks.length; index += concurrency) {
    const group = chunks.slice(index, index + concurrency);
    const batches = await Promise.all(group.map((idsChunk) => supabaseFetchAll(contactPathForDebtors(idsChunk))));
    for (const contacts of batches) {
      for (const contact of contacts) {
        if (!contactsByDebtor.has(contact.debtor_id)) contactsByDebtor.set(contact.debtor_id, []);
        contactsByDebtor.get(contact.debtor_id).push(contact);
      }
    }
  }
  return contactsByDebtor;
}

function mapDebtor(row, contacts = []) {
  const correos = contacts.filter((item) => item.type === "correo").map((item) => item.value);
  const telefonos = contacts.filter((item) => item.type === "telefono").map((item) => item.value);
  return {
    id: row.id,
    rutDeudor: row.rut_deudor || row.rut_titular,
    rutTitular: row.rut_titular,
    nombreTitular: row.nombre_titular,
    rutAlumno: row.rut_alumno,
    nombreAlumno: row.nombre_alumno,
    estado: row.estado,
    cartera: row.cartera,
    tramo: row.tramo,
    region: row.region,
    comuna: row.comuna,
    direccion: row.direccion,
    rol: row.rol,
    tribunal: row.tribunal,
    procedimiento: row.procedimiento,
    usuario: row.usuario,
    asignacion: row.asignacion,
    equipo: row.equipo,
    fechaEmision: row.fecha_emision,
    atrasoGestion: row.atraso_gestion,
    tipoContacto: row.tipo_contacto,
    resultado: row.resultado,
    observacion: row.observacion,
    ubicabilidad: row.ubicabilidad,
    telValidado: row.tel_validado,
    saldoCapital: Number(row.saldo_capital || 0),
    interes: Number(row.intereses_mora || 0),
    gastoCobranza: Number(row.gastos_cobranza || 0),
    deudaTotal: Number(row.deuda_total || 0),
    montoOferta: Number(row.monto_oferta || 0),
    ultimaGestion: row.ultima_gestion,
    proximaGestion: row.proxima_gestion,
    correos,
    telefonos,
    scoreContactabilidad: Math.min(100, (telefonos.length * 10) + (correos.length * 5)),
  };
}

function countPairs(rows, getter) {
  const counts = new Map();
  for (const row of rows) {
    const key = getter(row) || "Sin dato";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function buildSummary(debtors) {
  const saldoCapital = debtors.reduce((sum, row) => sum + row.saldoCapital, 0);
  const deudaTotal = debtors.reduce((sum, row) => sum + row.deudaTotal, 0);
  const montoOferta = debtors.reduce((sum, row) => sum + row.montoOferta, 0);
  return {
    totalRegistros: debtors.length,
    saldoCapital,
    deudaTotal,
    montoOferta,
    comision25SobreOferta: Math.round(montoOferta * 0.25),
    estados: countPairs(debtors, (row) => row.estado),
    ejecutivos: countPairs(debtors, (row) => row.asignacion || row.usuario || row.equipo).slice(0, 30),
    regiones: countPairs(debtors, (row) => row.region).slice(0, 10),
    contactabilidad: {
      conCorreo: debtors.filter((row) => row.correos.length).length,
      conTelefono: debtors.filter((row) => row.telefonos.length).length,
      sinDatos: debtors.filter((row) => !row.correos.length && !row.telefonos.length).length,
    },
    cartola: { movimientos: 0, montoIngresos: 0, porFuente: [] },
  };
}

function portfolioPathForRole({ role, username, assignment } = {}) {
  const base = "debtors?select=*&order=deuda_total.desc,id.asc";
  if (role !== "callcenter") return base;
  const visibleAssignment = assignment || "";
  if (!validCallcenterAssignment(visibleAssignment)) {
    throw httpError(403, "Call center sin asignacion valida.", "missing_assignment");
  }
  return `${base}&or=(asignacion.eq.${encodeURIComponent(visibleAssignment)},usuario.eq.${encodeURIComponent(visibleAssignment)},equipo.eq.${encodeURIComponent(visibleAssignment)})`;
}

function appendPortfolioFilters(params, context = {}, filters = {}) {
  if (context.role === "callcenter") {
    const visibleAssignment = context.assignment || "";
    if (!validCallcenterAssignment(visibleAssignment)) {
      throw httpError(403, "Call center sin asignacion valida.", "missing_assignment");
    }
    params.set("or", `(asignacion.eq.${visibleAssignment},usuario.eq.${visibleAssignment},equipo.eq.${visibleAssignment})`);
  }

  if (filters.state) params.set("estado", `eq.${filters.state}`);
  if (filters.assignment && context.role !== "callcenter") params.set("asignacion", `eq.${filters.assignment}`);
  if (filters.minDebt) params.append("deuda_total", `gte.${Number(filters.minDebt)}`);
  if (filters.maxDebt) params.append("deuda_total", `lte.${Number(filters.maxDebt)}`);

  const q = String(filters.q || "").trim();
  if (q && context.role !== "callcenter") {
    const rut = normalizeRut(q);
    const text = q
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9.\-\s]/g, " ")
      .trim();
    const safe = text.replace(/\*/g, " ");
    const looksLikeRut = rut.length >= 7 && /^[0-9K]+$/.test(rut);
    const filtersOr = looksLikeRut
      ? [
        `rut_deudor_normalizado.eq.${rut}`,
        `rut_titular_normalizado.eq.${rut}`,
        `rut_alumno_normalizado.eq.${rut}`,
        `id.ilike.*${rut}*`,
      ]
      : [
        `id.ilike.*${safe}*`,
        `nombre_titular.ilike.*${safe}*`,
        `nombre_alumno.ilike.*${safe}*`,
        `comuna.ilike.*${safe}*`,
        `rol.ilike.*${safe}*`,
        `tribunal.ilike.*${safe}*`,
        `asignacion.ilike.*${safe}*`,
      ];
    params.set("or", `(${filtersOr.join(",")})`);
  }
}

async function loadPortfolioPage(context = {}, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit || 120), 1), 300);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const params = new URLSearchParams({
    select: "*",
    order: "deuda_total.desc,id.asc",
    limit: String(limit),
    offset: String(offset),
  });
  appendPortfolioFilters(params, context, filters);
  const pagePath = `debtors?${params.toString()}`;
  const counted = filters.count === true
    ? await supabaseFetchWithCount(pagePath)
    : { rows: await supabaseFetch(pagePath), count: null };
  const { rows: debtRows, count } = counted;
  const contactsByDebtor = await contactsForDebtorRows(debtRows);
  const debtors = debtRows.map((row) => mapDebtor(row, contactsByDebtor.get(row.id) || []));
  const summary = buildSummary(debtors);
  if (count !== null) summary.totalRegistros = count;
  return {
    generatedAt: new Date().toISOString(),
    businessRules: businessRules(),
    summary,
    debtors,
    bankMovements: [],
    page: {
      limit,
      offset,
      count,
      returned: debtors.length,
      hasMore: count === null ? debtors.length === limit : offset + debtors.length < count,
    },
  };
}

async function loadPortfolio(context = {}) {
  const debtRows = await supabaseFetchAll(portfolioPathForRole(context));
  const contactsByDebtor = context.role === "callcenter"
    ? await contactsForDebtorRows(debtRows)
    : await contactsForAllDebtors();
  const debtors = debtRows.map((row) => mapDebtor(row, contactsByDebtor.get(row.id) || []));
  return {
    generatedAt: new Date().toISOString(),
    businessRules: businessRules(),
    summary: buildSummary(debtors),
    debtors,
    bankMovements: [],
  };
}

async function contactsForAllDebtors() {
  const contacts = await supabaseFetchAll("contacts?select=debtor_id,type,value&order=debtor_id.asc,type.asc,value.asc");
  const contactsByDebtor = new Map();
  for (const contact of contacts) {
    if (!contactsByDebtor.has(contact.debtor_id)) contactsByDebtor.set(contact.debtor_id, []);
    contactsByDebtor.get(contact.debtor_id).push(contact);
  }
  return contactsByDebtor;
}

async function loadDebtorByRut(rut) {
  const normalized = normalizeRut(rut);
  const query = new URLSearchParams({
    select: "*",
    or: `(rut_titular_normalizado.eq.${normalized},rut_alumno_normalizado.eq.${normalized})`,
    limit: "1",
  });
  const rows = await supabaseFetch(`debtors?${query.toString()}`);
  if (!rows.length) return null;
  const debtor = rows[0];
  const contacts = await supabaseFetch(`contacts?select=debtor_id,type,value&debtor_id=eq.${encodeURIComponent(debtor.id)}`);
  return mapDebtor(debtor, contacts);
}

async function loadInternalUser(username, password) {
  const normalized = normalizeUsername(username);
  if (!normalized || !password) return null;
  const query = new URLSearchParams({
    select: "id,username,display_name,role,assignment_name,active,password_hash,password_salt",
    username: `eq.${normalized}`,
    limit: "1",
  });
  const rows = await supabaseFetch(`app_users?${query.toString()}`).catch(() => []);
  const user = rows[0];
  if (!user || user.active === false || !user.password_hash || !user.password_salt) return null;
  const incomingHash = hashPassword(password, user.password_salt);
  if (incomingHash !== user.password_hash) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    assignmentName: user.assignment_name || "",
  };
}

module.exports = {
  loadPortfolio,
  loadPortfolioPage,
  loadDebtorByRut,
  loadInternalUser,
  hashPassword,
  normalizeRut,
  normalizeUsername,
  supabaseFetch,
  supabaseFetchAll,
};
