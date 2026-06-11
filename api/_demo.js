const DEMO_PASSWORD = "demo1234";
const DEMO_ASSIGNMENT = "DEMO CALLCENTER";
const DEMO_DEBTOR_RUTS = ["12.345.678-5", "23.456.789-6"];
const DEMO_TOTAL_RECORDS = 1000;

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
  const number = `${prefix}${String(index).padStart(5, "0")}`.slice(0, 9);
  const head = number.slice(0, -6);
  const middle = number.slice(-6, -3);
  const tail = number.slice(-3);
  return `${head}.${middle}.${tail}-${rutDv(number)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function gaussianLike(index) {
  const x = (index - 500) / 170;
  const base = 1850000 * Math.exp(-(x * x) / 2);
  const wave = 420000 * (1 + Math.sin(index * 0.47));
  const tail = index > 900 ? (index - 900) * 42000 : 0;
  return Math.round(clamp(180000 + base + wave + tail, 120000, 8200000));
}

function demoMoney(index, status) {
  const capital = gaussianLike(index);
  const interest = status === "PAGADO" ? Math.round(capital * 0.035) : Math.round(capital * (0.07 + ((index % 5) * 0.018)));
  const collection = status === "PAGADO" ? Math.round(capital * 0.018) : Math.round(capital * (0.032 + ((index % 4) * 0.008)));
  return { capital, interest, collection, total: capital + interest + collection };
}

function debtorStatus(index) {
  if (index <= 145) return "PAGADO";
  if (index <= 325) return "CONVENIO EN CURSO";
  if (index <= 455) return "OFERTA REGISTRADA";
  if (index <= 595) return "ACUERDO ROTO";
  if (index <= 790) return "EN GESTION";
  return "CAPITAL ACTIVO";
}

const COMMUNES = ["SANTIAGO", "MAIPU", "LA FLORIDA", "PUENTE ALTO", "INDEPENDENCIA", "NUNOA", "QUILICURA", "SAN MIGUEL"];
const REGIONS = ["REGION METROPOLITANA", "VALPARAISO", "BIOBIO", "OHIGGINS", "MAULE"];
const TRAMOS = [
  "$0 - $500.000",
  "$500.001 - $1.000.000",
  "$1.000.001 - $2.500.000",
  "$2.500.001 - $5.000.000",
  "> $5.000.000",
];
const ASSIGNMENTS = [
  DEMO_ASSIGNMENT,
  "DEMO EJECUTIVO 02",
  "DEMO EJECUTIVO 03",
  "DEMO EJECUTIVO 04",
  "DEMO EJECUTIVO 05",
  "DEMO EJECUTIVO 06",
];

function tramoFor(total) {
  if (total <= 500000) return TRAMOS[0];
  if (total <= 1000000) return TRAMOS[1];
  if (total <= 2500000) return TRAMOS[2];
  if (total <= 5000000) return TRAMOS[3];
  return TRAMOS[4];
}

const DEMO_DEBTORS = Array.from({ length: DEMO_TOTAL_RECORDS }, (_, offset) => {
  const index = offset + 1;
  const status = index === 1 ? "Pagado" : index === 2 ? "Cobranza Judicial" : debtorStatus(index);
  const money = demoMoney(index, status);
  const fixedRut = index === 1 ? DEMO_DEBTOR_RUTS[0] : index === 2 ? DEMO_DEBTOR_RUTS[1] : "";
  const titularRut = fixedRut || demoRut("120", index + 1000);
  const alumnoRut = demoRut("220", index + 5000);
  const assignment = ASSIGNMENTS[index % ASSIGNMENTS.length];
  const hasPhone = index % 11 !== 0;
  const hasEmail = index % 13 !== 0;
  return {
    id: `DEMO-AIEP-${String(index).padStart(4, "0")}`,
    demo: true,
    rutDeudor: titularRut,
    rutTitular: titularRut,
    nombreTitular: `Nombre Demo ${String(index).padStart(4, "0")}`,
    rutAlumno: alumnoRut,
    nombreAlumno: `Alumno Demo ${String(index).padStart(4, "0")}`,
    estado: status,
    cartera: `REMESA DEMO ${((index - 1) % 10) + 1}`,
    tramo: tramoFor(money.total),
    region: REGIONS[index % REGIONS.length],
    comuna: COMMUNES[index % COMMUNES.length],
    direccion: `Direccion Demo ${String(index).padStart(4, "0")}`,
    rol: `C-DEMO-${String(24000 + index)}-2026`,
    tribunal: `${((index - 1) % 18) + 1} Juzgado Civil Demo`,
    procedimiento: "Procedimiento (CIVIL)",
    usuario: assignment,
    asignacion: assignment,
    equipo: "Equipo Demo",
    fechaEmision: "2026-06-01",
    atrasoGestion: index % 14,
    tipoContacto: index % 3 === 0 ? "WhatsApp" : index % 3 === 1 ? "Llamado" : "Correo",
    resultado: status === "PAGADO" ? "Pago confirmado" : status === "ACUERDO ROTO" ? "Sin respuesta" : "Seguimiento",
    observacion: "Registro demo anonimizado",
    ubicabilidad: hasPhone || hasEmail ? "Ubicable" : "Sin ubicabilidad",
    telValidado: hasPhone ? "Validado" : "Pendiente",
    saldoCapital: money.capital,
    interes: money.interest,
    gastoCobranza: money.collection,
    deudaTotal: money.total,
    montoOferta: status === "CONVENIO EN CURSO" || status === "OFERTA REGISTRADA" ? Math.round(money.total * (0.58 + ((index % 9) * 0.025))) : 0,
    ultimaGestion: index <= 760 ? `2026-06-${String(1 + (index % 7)).padStart(2, "0")}` : "",
    proximaGestion: status === "CONVENIO EN CURSO" ? `2026-06-${String(10 + (index % 14)).padStart(2, "0")}` : "",
    correos: hasEmail ? [`cliente.demo${String(index).padStart(4, "0")}@example.test`] : [],
    telefonos: hasPhone ? [`9${String(10000000 + index).slice(-8)}`] : [],
    scoreContactabilidad: hasPhone && hasEmail ? 95 : hasPhone || hasEmail ? 65 : 20,
  };
});

function dateOffset(day) {
  return `2026-06-${String(day).padStart(2, "0")}`;
}

function buildAgreement(debtor, index) {
  if (!["CONVENIO EN CURSO", "OFERTA REGISTRADA"].includes(debtor.estado)) return null;
  const type = index % 3 === 0 ? "liquidacion" : "cuotas";
  const amount = debtor.montoOferta || Math.round(debtor.deudaTotal * 0.66);
  const downPayment = type === "cuotas" ? Math.round(amount * 0.24) : 0;
  const installments = type === "cuotas" ? 3 + (index % 8) : 1;
  const startDate = dateOffset(1 + (index % 8));
  const payments = [];
  if (type === "cuotas") {
    payments.push({ date: startDate, label: "Pie", amount: downPayment });
    const balance = Math.max(0, amount - downPayment);
    const installmentAmount = Math.round(balance / installments);
    for (let item = 0; item < installments; item += 1) {
      const date = new Date(`${startDate}T00:00:00`);
      date.setMonth(date.getMonth() + item + 1);
      payments.push({ date: date.toISOString().slice(0, 10), label: `Cuota ${item + 1}`, amount: installmentAmount });
    }
  } else {
    payments.push({ date: startDate, label: "Pago total", amount });
  }
  return {
    id: `DEMO-AGR-${debtor.id}`,
    amount,
    type,
    downPayment,
    installments,
    startDate,
    paymentDates: payments.map((payment) => payment.date),
    payments,
    payerRut: index % 4 === 0 ? demoRut("155", index + 7000) : "",
    notes: type === "cuotas" ? "Convenio demo con pie y cuotas." : "Liquidacion demo en pago unico.",
    debtorId: debtor.id,
    debtorName: debtor.nombreTitular,
    user: debtor.asignacion,
    date: dateOffset(1 + (index % 7)),
    createdAt: `${dateOffset(1 + (index % 7))}T10:00:00.000Z`,
  };
}

function buildEntries(debtor, index) {
  const entries = [];
  if (index > 820) return entries;
  const channels = ["WhatsApp", "Llamado", "Correo"];
  const resultsByStatus = {
    "PAGADO": ["Pago confirmado", "Comprobante validado"],
    "CONVENIO EN CURSO": ["Convenio firmado", "Compromiso de pago"],
    "OFERTA REGISTRADA": ["Oferta enviada", "Pendiente respuesta"],
    "ACUERDO ROTO": ["No contesta", "Acuerdo roto"],
    "EN GESTION": ["Contactado", "Seguimiento"],
    "CAPITAL ACTIVO": ["Primer aviso", "Pendiente gestion"],
  };
  const count = 1 + (index % 3);
  for (let item = 0; item < count; item += 1) {
    const day = 1 + ((index + item) % 7);
    const resultList = resultsByStatus[debtor.estado] || ["Gestion demo"];
    entries.push({
      id: `DEMO-ENTRY-${debtor.id}-${item + 1}`,
      debtor_id: debtor.id,
      debtorId: debtor.id,
      management_date: dateOffset(day),
      date: dateOffset(day),
      channel: channels[(index + item) % channels.length],
      result: resultList[item % resultList.length],
      comment: `Gestion demo anonimizada ${item + 1}.`,
      created_by: debtor.asignacion,
      user: debtor.asignacion,
      created_at: `${dateOffset(day)}T${String(9 + (index % 8)).padStart(2, "0")}:15:00.000Z`,
      updated_at: `${dateOffset(day)}T${String(9 + (index % 8)).padStart(2, "0")}:15:00.000Z`,
    });
  }
  return entries;
}

function buildFilesAndBankRows(debtor, index, agreement) {
  const files = [];
  const bankRows = [];
  const shouldPay = debtor.estado === "PAGADO" || (agreement && index % 3 !== 0);
  if (!shouldPay) return { files, bankRows };
  const paidAmount = debtor.estado === "PAGADO"
    ? debtor.deudaTotal
    : Math.min(agreement.amount, Math.round(agreement.amount * (0.25 + ((index % 5) * 0.11))));
  const day = 2 + (index % 6);
  files.push({
    id: `DEMO-FILE-${debtor.id}`,
    debtorId: debtor.id,
    debtorName: debtor.nombreTitular,
    name: `comprobante_demo_${String(index).padStart(4, "0")}.pdf`,
    size: 96000 + (index * 9),
    type: "application/pdf",
    source: index % 2 ? "deudor" : "ejecutivo",
    category: "comprobante",
    amount: paidAmount,
    payerRut: agreement?.payerRut || debtor.rutTitular,
    status: debtor.estado === "PAGADO" || index % 4 !== 0 ? "validado" : "pendiente",
    validationNote: "Comprobante demo validado para presentacion.",
    createdAt: `${dateOffset(day)}T11:30:00.000Z`,
  });
  bankRows.push({
    id: `DEMO-BANK-${debtor.id}`,
    source: "Cartola demo junio",
    fecha: dateOffset(day),
    nombre: `Pagador Demo ${String(index).padStart(4, "0")}`,
    rut: agreement?.payerRut || debtor.rutTitular,
    monto: paidAmount,
    glosa: `Transferencia demo ${debtor.id}`,
    associatedRut: debtor.rutTitular,
    payerRut: agreement?.payerRut || debtor.rutTitular,
    status: debtor.estado === "PAGADO" || index % 4 !== 0 ? "conciliado" : "pendiente",
    notes: "Movimiento demo anonimizado.",
  });
  return { files, bankRows };
}

function buildDemoOperations() {
  const agreements = {};
  const entries = [];
  const files = [];
  const bankRows = [];
  DEMO_DEBTORS.forEach((debtor, offset) => {
    const index = offset + 1;
    const agreement = buildAgreement(debtor, index);
    if (agreement) agreements[debtor.id] = agreement;
    entries.push(...buildEntries(debtor, index));
    const generated = buildFilesAndBankRows(debtor, index, agreement);
    files.push(...generated.files);
    bankRows.push(...generated.bankRows);
  });
  return { agreements, offers: agreements, entries, files, bankRows };
}

const DEMO_OPERATIONS = buildDemoOperations();

function visibleOperationsFor(rows) {
  const ids = new Set(rows.map((row) => row.id));
  const agreements = {};
  Object.entries(DEMO_OPERATIONS.agreements)
    .filter(([debtorId]) => ids.has(debtorId))
    .forEach(([debtorId, agreement]) => { agreements[debtorId] = agreement; });
  return {
    agreements,
    offers: agreements,
    entries: DEMO_OPERATIONS.entries.filter((entry) => ids.has(entry.debtorId)),
    files: DEMO_OPERATIONS.files.filter((file) => ids.has(file.debtorId)),
    bankRows: DEMO_OPERATIONS.bankRows.filter((row) => ids.has(row.id.replace("DEMO-BANK-", ""))),
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

function buildDemoSummary(rows) {
  const saldoCapital = rows.reduce((sum, row) => sum + Number(row.saldoCapital || 0), 0);
  const deudaTotal = rows.reduce((sum, row) => sum + Number(row.deudaTotal || 0), 0);
  const montoOferta = rows.reduce((sum, row) => sum + Number(row.montoOferta || 0), 0);
  const visibleOps = visibleOperationsFor(rows);
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
      movimientos: visibleOps.bankRows.length,
      montoIngresos: visibleOps.bankRows.reduce((sum, row) => sum + row.monto, 0),
      porFuente: [["Cartola demo junio", visibleOps.bankRows.reduce((sum, row) => sum + row.monto, 0)]],
    },
    demoBreakdown: {
      capitalActivo: rows.filter((row) => row.estado === "CAPITAL ACTIVO").length,
      convenio: rows.filter((row) => row.estado === "CONVENIO EN CURSO").length,
      ofertaRegistrada: rows.filter((row) => row.estado === "OFERTA REGISTRADA").length,
      liquidado: rows.filter((row) => row.estado === "PAGADO").length,
      acuerdoRoto: rows.filter((row) => row.estado === "ACUERDO ROTO").length,
      enGestion: rows.filter((row) => row.estado === "EN GESTION").length,
    },
  };
}

function canSeeDemoDebtor(user, debtor) {
  if (!user?.demo || !debtor) return false;
  if (user.role === "jefatura" || user.role === "informatico" || user.role === "callcenter") return true;
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
  const limit = Math.min(Math.max(Number(filters.limit || DEMO_TOTAL_RECORDS), 1), DEMO_TOTAL_RECORDS);
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
    bankMovements: [],
    demoOperations: visibleOperationsFor(filtered),
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
      status: index % 4 === 0 ? "valido" : "sin_validar",
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
      status: index % 4 === 0 ? "valido" : "sin_validar",
      category: "Demo",
      note: "Correo ficticio",
      created_at: "2026-06-08T00:00:00.000Z",
      updated_at: "2026-06-08T00:00:00.000Z",
    })),
  ];
}

function demoEntriesForDebtor(debtor) {
  if (!debtor) return [];
  return DEMO_OPERATIONS.entries.filter((entry) => entry.debtorId === debtor.id);
}

function demoCommentsForDebtor(debtor) {
  if (!debtor || Number(debtor.id.slice(-4)) % 4 !== 0) return [];
  return [{
    id: `${debtor.id}-comment-1`,
    debtor_id: debtor.id,
    debtorId: debtor.id,
    parent_id: null,
    parentId: null,
    body: "Comentario interno demo anonimizado.",
    created_by_username: debtor.asignacion,
    user: debtor.asignacion,
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
