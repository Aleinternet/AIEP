const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireSupabaseEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel.");
  }
}

function normalizeRut(value = "") {
  return String(value).replace(/[^0-9Kk]/g, "").toUpperCase();
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
    ejecutivos: [],
    regiones: countPairs(debtors, (row) => row.region).slice(0, 10),
    contactabilidad: {
      conCorreo: debtors.filter((row) => row.correos.length).length,
      conTelefono: debtors.filter((row) => row.telefonos.length).length,
      sinDatos: debtors.filter((row) => !row.correos.length && !row.telefonos.length).length,
    },
    cartola: { movimientos: 0, montoIngresos: 0, porFuente: [] },
  };
}

async function loadPortfolio() {
  const debtRows = await supabaseFetchAll("debtors?select=*&order=deuda_total.desc,id.asc");
  const contacts = await supabaseFetchAll("contacts?select=debtor_id,type,value&order=debtor_id.asc,type.asc,value.asc");
  const contactsByDebtor = new Map();
  for (const contact of contacts) {
    if (!contactsByDebtor.has(contact.debtor_id)) contactsByDebtor.set(contact.debtor_id, []);
    contactsByDebtor.get(contact.debtor_id).push(contact);
  }
  const debtors = debtRows.map((row) => mapDebtor(row, contactsByDebtor.get(row.id) || []));
  return {
    generatedAt: new Date().toISOString(),
    businessRules: {
      discountRate: 0.5,
      offerFormula: "saldo_capital * 50%",
      commissionRate: 0.25,
      bankAccount: "Banco BCI - Comercial Remesa SpA - RUT 76.976.117-9 - Cuenta Corriente 27826341",
    },
    summary: buildSummary(debtors),
    debtors,
    bankMovements: [],
  };
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

module.exports = {
  loadPortfolio,
  loadDebtorByRut,
};
