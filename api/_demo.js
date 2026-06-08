const DEMO_PASSWORD = "demo1234";
const DEMO_ASSIGNMENT = "DEMO CALLCENTER";
const DEMO_DEBTOR_RUTS = ["12.345.678-5", "23.456.789-6"];

function normalizeRut(value = "") {
  return String(value).replace(/[^0-9Kk]/g, "").toUpperCase();
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function rutDv(body) {
  let sum = 0;
  let factor = 2;
  for (let index = String(body).length - 1; index >= 0; index -= 1) {
    sum += Number(String(body)[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  if (rest === 11) return "0";
  if (rest === 10) return "K";
  return String(rest);
}

function demoUser(username, password) {
  const clean = normalizeText(username).replace(/[^a-z0-9]+/g, ".");
  if (password !== DEMO_PASSWORD) return null;
  if (clean === "callcenter") {
    return {
      id: "demo-callcenter",
      username: "callcenter",
      displayName: "Call Center Demo",
      role: "callcenter",
      assignmentName: DEMO_ASSIGNMENT,
      authSource: "demo_static",
      demo: true,
    };
  }
  if (clean === "jefatura") {
    return {
      id: "demo-jefatura",
      username: "jefatura",
      displayName: "Jefatura Demo",
      role: "jefatura",
      assignmentName: "",
      authSource: "demo_static",
      demo: true,
    };
  }
  return null;
}

function demoRut(prefix, index) {
  const number = `${prefix}${String(index).padStart(4, "0")}`;
  return `${number.slice(0, 2)}.${number.slice(2, 5)}.${number.slice(5)}-${rutDv(number)}`;
}

function demoMoney(index) {
  const capital = 320000 + (index * 185000);
  const interest = Math.round(capital * (0.08 + ((index % 4) * 0.025)));
  const collection = Math.round(capital * (0.035 + ((index % 3) * 0.01)));
  return { capital, interest, collection, total: capital + interest + collection };
}

const STATES = ["ACUERDO ROTO", "PENDIENTE", "EN GESTION", "PAGADO", "CONVENIO EN CURSO"];
const COMMUNES = ["SANTIAGO", "MAIPU", "LA FLORIDA", "PUENTE ALTO", "INDEPENDENCIA", "NUNOA"];
const REGIONS = ["REGION METROPOLITANA", "VALPARAISO", "BIOBIO"];
const TRAMOS = [
  "$0 - $500.000",
  "$500.001 - $1.000.000",
  "$1.000.001 - $2.500.000",
  "> $2.500.000",
];

const DEMO_DEBTORS = Array.from({ length: 28 }, (_, offset) => {
  const index = offset + 1;
  const money = demoMoney(index);
  const fixedRut = index === 1 ? DEMO_DEBTOR_RUTS[0] : index === 2 ? DEMO_DEBTOR_RUTS[1] : "";
  const titularRut = fixedRut || demoRut("12340", index);
  const alumnoRut = demoRut("22450", index + 30);
  const assignment = index <= 18 ? DEMO_ASSIGNMENT : `DEMO EJECUTIVO ${String(((index - 19) % 3) + 2).padStart(2, "0")}`;
  return {
    id: `DEMO-AIEP-${String(index).padStart(3, "0")}`,
    demo: true,
    rutDeudor: titularRut,
    rutTitular: titularRut,
    nombreTitular: `Nombre Demo ${String(index).padStart(2, "0")}`,
    rutAlumno: alumnoRut,
    nombreAlumno: `Alumno Demo ${String(index).padStart(2, "0")}`,
    estado: STATES[index % STATES.length],
    cartera: `REMESA DEMO ${((index - 1) % 4) + 1}`,
    tramo: TRAMOS[index % TRAMOS.length],
    region: REGIONS[index % REGIONS.length],
    comuna: COMMUNES[index % COMMUNES.length],
    direccion: `Direccion Demo ${String(index).padStart(2, "0")}`,
    rol: `C-DEMO-${String(2400 + index)}-2026`,
    tribunal: `${((index - 1) % 5) + 1} Juzgado Civil Demo`,
    procedimiento: "Procedimiento (CIVIL)",
    usuario: assignment,
    asignacion: assignment,
    equipo: "Equipo Demo",
    fechaEmision: "2026-06-01",
    atrasoGestion: index % 6,
    tipoContacto: index % 2 ? "Telefono" : "Correo",
    resultado: index % 4 === 0 ? "Contactado" : "Pendiente",
    observacion: "Registro demo anonimizado",
    ubicabilidad: index % 5 === 0 ? "Sin ubicabilidad" : "Ubicable",
    telValidado: index % 3 === 0 ? "Pendiente" : "Validado",
    saldoCapital: money.capital,
    interes: money.interest,
    gastoCobranza: money.collection,
    deudaTotal: money.total,
    montoOferta: index % 5 === 0 ? Math.round(money.total * 0.62) : 0,
    ultimaGestion: index % 3 === 0 ? "2026-06-06" : "",
    proximaGestion: index % 4 === 0 ? "2026-06-12" : "",
    correos: index % 6 === 0 ? [] : [`cliente${String(index).padStart(2, "0")}@example.test`],
    telefonos: index % 7 === 0 ? [] : [`90000${String(index).padStart(4, "0")}`],
    scoreContactabilidad: index % 6 === 0 || index % 7 === 0 ? 35 : 85,
  };
});

const DEMO_BANK_MOVEMENTS = [
  { id: "DEMO-BANK-001", date: "2026-06-03", description: "Transferencia demo 01", amount: 250000, rut: DEMO_DEBTOR_RUTS[0], status: "conciliado" },
  { id: "DEMO-BANK-002", date: "2026-06-04", description: "Transferencia demo 02", amount: 180000, rut: DEMO_DEBTOR_RUTS[1], status: "pendiente" },
  { id: "DEMO-BANK-003", date: "2026-06-05", description: "Transferencia demo 03", amount: 420000, rut: "15.555.555-5", status: "pendiente" },
];

function countPairs(rows, getter) {
  const counts = new Map();
  for (const row of rows) {
    const key = getter(row) || "Sin dato";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function buildDemoSummary(rows) {
  const saldoCapital = rows.reduce((sum, row) => sum + Number(row.saldoCapital || 0), 0);
  const deudaTotal = rows.reduce((sum, row) => sum + Number(row.deudaTotal || 0), 0);
  const montoOferta = rows.reduce((sum, row) => sum + Number(row.montoOferta || 0), 0);
  return {
    totalRegistros: rows.length,
    saldoCapital,
    deudaTotal,
    montoOferta,
    comision25SobreOferta: Math.round(montoOferta * 0.25),
    estados: countPairs(rows, (row) => row.estado),
    ejecutivos: countPairs(rows, (row) => row.asignacion),
    regiones: countPairs(rows, (row) => row.region),
    contactabilidad: {
      conCorreo: rows.filter((row) => row.correos.length).length,
      conTelefono: rows.filter((row) => row.telefonos.length).length,
      sinDatos: rows.filter((row) => !row.correos.length && !row.telefonos.length).length,
    },
    cartola: {
      movimientos: DEMO_BANK_MOVEMENTS.length,
      montoIngresos: DEMO_BANK_MOVEMENTS.reduce((sum, row) => sum + row.amount, 0),
      porFuente: [["Demo conciliado", 1], ["Demo pendiente", 2]],
    },
  };
}

function canSeeDemoDebtor(user, debtor) {
  if (!user?.demo || !debtor) return false;
  if (user.role === "jefatura" || user.role === "informatico") return true;
  if (user.role === "callcenter") return normalizeText(debtor.asignacion) === normalizeText(user.assignmentName);
  return false;
}

function demoRowsForUser(user) {
  return DEMO_DEBTORS.filter((debtor) => canSeeDemoDebtor(user, debtor));
}

function applyDemoFilters(rows, filters = {}) {
  const state = String(filters.state || "").trim();
  const assignment = String(filters.assignment || "").trim();
  const minDebt = Number(filters.minDebt || 0);
  const maxDebt = Number(filters.maxDebt || 0);
  const q = normalizeText(filters.q || "");
  return rows.filter((row) => {
    const text = normalizeText([
      row.id,
      row.rutTitular,
      row.rutAlumno,
      row.nombreTitular,
      row.nombreAlumno,
      row.estado,
      row.asignacion,
      row.comuna,
      row.rol,
      row.tribunal,
    ].join(" "));
    return (!state || row.estado === state)
      && (!assignment || row.asignacion === assignment)
      && (!minDebt || row.deudaTotal >= minDebt)
      && (!maxDebt || row.deudaTotal <= maxDebt)
      && (!q || text.includes(q));
  });
}

function demoPortfolio(user, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit || 300), 1), 300);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const filtered = applyDemoFilters(demoRowsForUser(user), filters)
    .sort((a, b) => Number(b.deudaTotal || 0) - Number(a.deudaTotal || 0));
  const rows = filtered.slice(offset, offset + limit);
  return {
    generatedAt: "2026-06-08T00:00:00.000Z",
    demo: true,
    businessRules: {
      discountRate: 0.5,
      offerFormula: "Demo: datos anonimizados",
      commissionRate: 0.25,
      bankAccount: "Banco Demo - Comercial Remesa SpA - RUT 76.976.117-9 - Cuenta Corriente 00000000",
    },
    summary: buildDemoSummary(filtered),
    debtors: rows,
    bankMovements: DEMO_BANK_MOVEMENTS,
    page: {
      limit,
      offset,
      count: filtered.length,
      returned: rows.length,
      hasMore: offset + rows.length < filtered.length,
    },
  };
}

function demoDebtorByRut(rut) {
  const normalized = normalizeRut(rut);
  if (!normalized) return null;
  return DEMO_DEBTORS.find((debtor) => [
    debtor.rutDeudor,
    debtor.rutTitular,
    debtor.rutAlumno,
  ].map(normalizeRut).includes(normalized)) || null;
}

function demoDebtorFromInput(input = {}) {
  if (input.debtor_id || input.debtorId) {
    const id = String(input.debtor_id || input.debtorId);
    return DEMO_DEBTORS.find((debtor) => debtor.id === id) || null;
  }
  return demoDebtorByRut(input.rut || input.rut_normalizado || input.rutNormalizado || "");
}

function demoContactsForDebtor(debtor) {
  if (!debtor) return [];
  return [
    ...(debtor.telefonos || []).map((value, index) => ({
      id: `${debtor.id}-phone-${index + 1}`,
      debtor_id: debtor.id,
      debtorId: debtor.id,
      type: "telefono",
      value,
      status: "sin_validar",
      category: "Demo",
      note: "Contacto ficticio",
      created_at: "2026-06-08T00:00:00.000Z",
      updated_at: "2026-06-08T00:00:00.000Z",
    })),
    ...(debtor.correos || []).map((value, index) => ({
      id: `${debtor.id}-mail-${index + 1}`,
      debtor_id: debtor.id,
      debtorId: debtor.id,
      type: "correo",
      value,
      status: "sin_validar",
      category: "Demo",
      note: "Correo ficticio",
      created_at: "2026-06-08T00:00:00.000Z",
      updated_at: "2026-06-08T00:00:00.000Z",
    })),
  ];
}

function demoEntriesForDebtor(debtor) {
  if (!debtor) return [];
  return debtor.ultimaGestion ? [{
    id: `${debtor.id}-entry-1`,
    debtor_id: debtor.id,
    debtorId: debtor.id,
    management_date: debtor.ultimaGestion,
    date: debtor.ultimaGestion,
    channel: debtor.tipoContacto || "Telefono",
    result: debtor.resultado || "Gestion demo",
    comment: "Gestion demo anonimizada",
    created_by: "callcenter",
    user: "callcenter",
    created_at: "2026-06-08T00:00:00.000Z",
    updated_at: "2026-06-08T00:00:00.000Z",
  }] : [];
}

function demoCommentsForDebtor(debtor) {
  if (!debtor || Number(debtor.id.slice(-3)) % 4 !== 0) return [];
  return [{
    id: `${debtor.id}-comment-1`,
    debtor_id: debtor.id,
    debtorId: debtor.id,
    parent_id: null,
    parentId: null,
    body: "Comentario interno demo anonimizado.",
    created_by_username: "callcenter",
    user: "callcenter",
    created_at: "2026-06-08T00:00:00.000Z",
    updated_at: "2026-06-08T00:00:00.000Z",
  }];
}

module.exports = {
  DEMO_ASSIGNMENT,
  DEMO_DEBTOR_RUTS,
  demoContactsForDebtor,
  demoCommentsForDebtor,
  demoDebtorByRut,
  demoDebtorFromInput,
  demoEntriesForDebtor,
  demoPortfolio,
  demoUser,
  canSeeDemoDebtor,
};
