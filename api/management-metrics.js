const { authErrorResponse, requireUser } = require("./_auth");
const { demoPortfolio } = require("./_demo");
const { supabaseFetch } = require("./_data");

function numberParam(value, fallback = 0) {
  const parsed = Number(String(value || "").replace(/[^\d-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textParam(value) {
  return String(value || "").trim();
}

function isActiveAgreement(row) {
  const status = String(row.status || "").toLowerCase();
  return !["pagado", "eliminado", "anulado"].includes(status);
}

function agreementUiType(type = "") {
  const value = String(type || "").toLowerCase();
  if (value.includes("cuota")) return "cuotas";
  return "liquidacion";
}

function displayState(row, activeAgreementIds) {
  return activeAgreementIds.has(row.id) ? "Convenio en curso" : (row.estado || "Pendiente");
}

function countPairs(rows, getter) {
  const counts = new Map();
  for (const row of rows) {
    const key = getter(row) || "Sin dato";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function sum(rows, getter) {
  return rows.reduce((total, row) => total + Number(getter(row) || 0), 0);
}

function safeIdSet(rows) {
  return new Set(rows.map((row) => row.id).filter(Boolean));
}

function buildDebtorPath(filters) {
  const params = new URLSearchParams({
    select: "id,estado,saldo_capital,deuda_total,monto_oferta,asignacion,usuario,equipo,nombre_titular,rut_titular,tramo",
    order: "deuda_total.desc,id.asc",
  });
  if (filters.assignment) params.set("asignacion", `eq.${filters.assignment}`);
  if (filters.minDebt) params.append("deuda_total", `gte.${filters.minDebt}`);
  if (filters.maxDebt) params.append("deuda_total", `lte.${filters.maxDebt}`);
  return `debtors?${params.toString()}`;
}

function buildEntriesPath(filters) {
  const params = new URLSearchParams({
    select: "debtor_id,result,channel,management_date",
    deleted_at: "is.null",
    order: "management_date.desc",
  });
  if (filters.from) params.append("management_date", `gte.${filters.from}`);
  if (filters.to) params.append("management_date", `lte.${filters.to}`);
  return `management_entries?${params.toString()}`;
}

async function optionalRows(path) {
  try {
    return await fetchAllFast(path);
  } catch {
    return [];
  }
}

async function fetchAllFast(path, pageSize = 1000, concurrency = 8) {
  const rows = await supabaseFetch(path, {
    headers: { Range: `0-${pageSize - 1}` },
  });
  if (rows.length < pageSize) return rows;

  let from = pageSize;
  while (rows.length >= from) {
    const ranges = Array.from({ length: concurrency }, (_, index) => {
      const start = from + (index * pageSize);
      return [start, start + pageSize - 1];
    });
    const before = rows.length;
    await fetchRanges(path, ranges, rows, concurrency);
    if (rows.length === before || rows.length - before < pageSize * concurrency) break;
    from += pageSize * concurrency;
  }
  return rows;
}

async function fetchRanges(path, ranges, targetRows, concurrency = 5) {
  for (let index = 0; index < ranges.length; index += concurrency) {
    const group = ranges.slice(index, index + concurrency);
    const pages = await Promise.all(group.map(([from, to]) => supabaseFetch(path, {
      headers: { Range: `${from}-${to}` },
    })));
    pages.forEach((page) => targetRows.push(...page));
  }
}

function filterByAgreement(rows, agreementsByDebtor, filters) {
  if (!filters.agreement && !filters.state) return rows;
  return rows.filter((row) => {
    const agreements = agreementsByDebtor.get(row.id) || [];
    const hasAgreement = agreements.length > 0;
    const matchesAgreement = !filters.agreement
      || (filters.agreement === "with" && hasAgreement)
      || (filters.agreement === "without" && !hasAgreement)
      || agreements.some((agreement) => agreementUiType(agreement.type) === filters.agreement);
    const state = hasAgreement ? "Convenio en curso" : (row.estado || "Pendiente");
    return matchesAgreement && (!filters.state || state === filters.state);
  });
}

function buildMetrics({ debtors, contacts, entries, agreements, payments, files, allocations, generatedAt }) {
  const debtorIds = safeIdSet(debtors);
  const activeAgreements = agreements.filter((row) => debtorIds.has(row.debtor_id) && isActiveAgreement(row));
  const activeAgreementIds = new Set(activeAgreements.map((row) => row.debtor_id));
  const agreementIds = new Set(activeAgreements.map((row) => row.id));
  const entriesForDebtors = entries.filter((row) => debtorIds.has(row.debtor_id));
  const managedDebtorIds = new Set(entriesForDebtors.map((row) => row.debtor_id));
  const contactsForDebtors = contacts.filter((row) => debtorIds.has(row.debtor_id));
  const phoneIds = new Set(contactsForDebtors.filter((row) => row.type === "telefono").map((row) => row.debtor_id));
  const emailIds = new Set(contactsForDebtors.filter((row) => row.type === "correo").map((row) => row.debtor_id));
  const receiptRows = files.filter((row) => debtorIds.has(row.debtor_id) && row.kind === "comprobante_pago");
  const paidByAgreement = new Map();
  for (const payment of payments) {
    if (!agreementIds.has(payment.agreement_id)) continue;
    paidByAgreement.set(payment.agreement_id, (paidByAgreement.get(payment.agreement_id) || 0) + Number(payment.paid_amount || 0));
  }
  const paymentAllocated = allocations.filter((row) => debtorIds.has(row.debtor_id));
  const collected = sum(paymentAllocated, (row) => row.amount);
  const offerTotal = sum(activeAgreements, (row) => row.agreed_amount);
  const offerCapital = sum(activeAgreements, (agreement) => debtors.find((row) => row.id === agreement.debtor_id)?.saldo_capital || 0);
  const agreementBalance = activeAgreements.reduce((total, agreement) => {
    const paid = paidByAgreement.get(agreement.id) || 0;
    return total + Math.max(0, Number(agreement.agreed_amount || 0) - paid);
  }, 0);
  const managedRate = debtors.length ? Math.round((managedDebtorIds.size / debtors.length) * 100) : 0;
  const withoutContact = debtors.filter((row) => !phoneIds.has(row.id) && !emailIds.has(row.id)).length;
  const emailOnly = debtors.filter((row) => !phoneIds.has(row.id) && emailIds.has(row.id)).length;
  const topDebt = debtors
    .slice()
    .sort((a, b) => Number(b.deuda_total || 0) - Number(a.deuda_total || 0))
    .slice(0, 8)
    .map((row) => [row.nombre_titular || row.rut_titular || row.id, Number(row.deuda_total || 0)]);

  return {
    generatedAt,
    totals: {
      totalRegistros: debtors.length,
      saldoCapital: sum(debtors, (row) => row.saldo_capital),
      deudaTotal: sum(debtors, (row) => row.deuda_total),
      montoOferta: offerTotal,
      collected,
      lostCapital: Math.max(0, offerCapital - offerTotal),
      entries: entriesForDebtors.length,
      managedDebtorCount: managedDebtorIds.size,
      managedRate,
      receipts: receiptRows.length,
      activeAgreements: activeAgreements.length,
      agreementBalance,
      withPhone: phoneIds.size,
      withEmail: emailIds.size,
      emailOnly,
      withoutContact,
      paidEvidence: entriesForDebtors.filter((row) => row.result === "Pago / comprobante" || row.result === "Pago validado").length + receiptRows.filter((row) => row.verified).length,
      promiseCount: entriesForDebtors.filter((row) => row.result === "Compromiso de pago").length,
    },
    bars: {
      states: countPairs(debtors, (row) => displayState(row, activeAgreementIds)).slice(0, 10),
      results: countPairs(entriesForDebtors, (row) => row.result),
      channels: countPairs(entriesForDebtors, (row) => row.channel),
      assignments: countPairs(debtors, (row) => row.asignacion || row.usuario || row.equipo).slice(0, 40),
      funnel: [
        ["Cartera total", debtors.length],
        ["Con gestion", managedDebtorIds.size],
        ["Convenios activos", activeAgreements.length],
        ["Comprobantes", receiptRows.length],
      ],
      topDebt,
      bankSource: collected ? [["Pagos asignados", collected]] : [],
    },
    distribution: debtors.map((row) => Number(row.deuda_total || 0)).filter((value) => value > 0),
  };
}

async function loadRealMetrics(filters) {
  const rpcMetrics = await loadRpcMetrics(filters);
  if (rpcMetrics) return rpcMetrics;

  const [rawDebtors, rawAgreements, contacts, entries, payments, files, allocations] = await Promise.all([
    fetchAllFast(buildDebtorPath(filters)),
    optionalRows("agreements?select=id,debtor_id,type,status,agreed_amount,down_payment,deleted_at&deleted_at=is.null"),
    optionalRows("contacts?select=debtor_id,type&deleted_at=is.null"),
    optionalRows(buildEntriesPath(filters)),
    optionalRows("agreement_payments?select=agreement_id,paid_amount,status,deleted_at&deleted_at=is.null"),
    optionalRows("files?select=debtor_id,kind,verified"),
    optionalRows("payment_allocations?select=debtor_id,agreement_id,amount"),
  ]);
  const activeAgreements = rawAgreements.filter(isActiveAgreement);
  const agreementsByDebtor = new Map();
  for (const agreement of activeAgreements) {
    if (!agreementsByDebtor.has(agreement.debtor_id)) agreementsByDebtor.set(agreement.debtor_id, []);
    agreementsByDebtor.get(agreement.debtor_id).push(agreement);
  }
  const debtors = filterByAgreement(rawDebtors, agreementsByDebtor, filters);
  return buildMetrics({
    debtors,
    contacts,
    entries,
    agreements: activeAgreements,
    payments,
    files,
    allocations,
    generatedAt: new Date().toISOString(),
  });
}

async function loadRpcMetrics(filters) {
  try {
    const payload = {
      p_from: filters.from || null,
      p_to: filters.to || null,
      p_state: filters.state || null,
      p_agreement: filters.agreement || null,
      p_assignment: filters.assignment || null,
      p_min_debt: filters.minDebt || null,
      p_max_debt: filters.maxDebt || null,
    };
    const result = await supabaseFetch("rpc/aiep_management_metrics", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return Array.isArray(result) ? result[0] : result;
  } catch {
    return null;
  }
}

function demoMetrics(user, filters) {
  const portfolio = demoPortfolio(user, { ...filters, agreement: "", limit: 1000, offset: 0 });
  const ops = portfolio.demoOperations || {};
  const agreementIds = new Set(Object.keys(ops.agreements || {}));
  const visibleDebtors = filters.agreement
    ? portfolio.debtors.filter((debtor) => {
      const agreement = ops.agreements?.[debtor.id];
      const hasAgreement = agreementIds.has(debtor.id);
      return (filters.agreement === "with" && hasAgreement)
        || (filters.agreement === "without" && !hasAgreement)
        || (agreement && agreementUiType(agreement.type) === filters.agreement);
    })
    : portfolio.debtors;
  const agreements = Object.values(ops.agreements || {}).map((agreement) => ({
    id: agreement.id || agreement.debtorId,
    debtor_id: agreement.debtorId,
    type: agreement.type,
    status: "vigente",
    agreed_amount: agreement.amount,
    down_payment: agreement.downPayment || 0,
  }));
  const entries = (ops.entries || []).map((entry) => ({
    debtor_id: entry.debtorId,
    result: entry.result,
    channel: entry.channel,
    management_date: entry.date,
  }));
  const files = (ops.files || []).map((file) => ({
    debtor_id: file.debtorId,
    kind: "comprobante_pago",
    verified: file.status === "validado",
  }));
  const contacts = visibleDebtors.flatMap((debtor) => [
    ...(debtor.telefonos || []).map(() => ({ debtor_id: debtor.id, type: "telefono" })),
    ...(debtor.correos || []).map(() => ({ debtor_id: debtor.id, type: "correo" })),
  ]);
  const allocations = (ops.bankRows || []).map((row) => ({
    debtor_id: String(row.id || "").replace("DEMO-BANK-", ""),
    amount: Number(row.monto || 0),
  }));
  return buildMetrics({
    debtors: visibleDebtors.map((row) => ({
      id: row.id,
      estado: row.estado,
      saldo_capital: row.saldoCapital,
      deuda_total: row.deudaTotal,
      monto_oferta: row.montoOferta,
      asignacion: row.asignacion,
      usuario: row.usuario,
      equipo: row.equipo,
      nombre_titular: row.nombreTitular,
      rut_titular: row.rutTitular,
      tramo: row.tramo,
    })),
    contacts,
    entries,
    agreements,
    payments: [],
    files,
    allocations,
    generatedAt: portfolio.generatedAt,
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
    return;
  }

  try {
    const user = await requireUser(req, ["jefatura", "informatico"]);
    const filters = {
      from: textParam(req.query.from),
      to: textParam(req.query.to),
      state: textParam(req.query.state),
      agreement: textParam(req.query.agreement),
      assignment: textParam(req.query.assignment),
      minDebt: numberParam(req.query.minDebt, 0),
      maxDebt: numberParam(req.query.maxDebt, 0),
    };
    const metrics = user.demo ? demoMetrics(user, filters) : await loadRealMetrics(filters);
    res.status(200).json({ ok: true, metrics });
  } catch (error) {
    authErrorResponse(res, error);
  }
};
