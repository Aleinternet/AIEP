const data = window.ABG_DATA || {
  generatedAt: new Date().toISOString(),
  businessRules: {
    discountRate: 0.5,
    offerFormula: "saldo_capital * 50%",
    commissionRate: 0.25,
    bankAccount: "Banco BCI - Comercial Remesa SpA - RUT 76.976.117-9 - Cuenta Corriente 27826341",
  },
  summary: {
    totalRegistros: 0,
    saldoCapital: 0,
    deudaTotal: 0,
    montoOferta: 0,
    comision25SobreOferta: 0,
    estados: [],
    ejecutivos: [],
    regiones: [],
    contactabilidad: { conCorreo: 0, conTelefono: 0, sinDatos: 0 },
    cartola: { movimientos: 0, montoIngresos: 0, porFuente: [] },
  },
  debtors: [],
  bankMovements: [],
};
const fmtMoney = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat("es-CL");
const today = () => new Date().toISOString().slice(0, 10);
const TRANSFER_DETAILS = [
  "Banco BCI",
  "Comercial Remesa SpA",
  "RUT 76.976.117-9",
  "Cuenta Corriente 27826341",
];

const store = {
  entries: readJson("abg_entries", []),
  contacts: readJson("abg_contacts", {}),
  files: readJson("abg_files", []),
  offers: readJson("abg_offers", {}),
  agreements: readJson("abg_agreements", readJson("abg_offers", {})),
  comments: readJson("abg_comments", {}),
  campaignExcluded: readJson("abg_campaign_excluded", {}),
  bankRows: readJson("abg_bank_rows", []),
  audit: readJson("abg_audit", []),
  internalUsers: [],
  health: null,
  healthLoading: false,
  remoteWarnings: {},
};

let session = null;
let selectedDebtor = null;
let executiveRows = [];
let sessionStartedAt = null;
let campaignTimer = null;
let campaignQueue = [];
let campaignChannel = "";
let campaignTotal = 0;
let campaignSkippedToday = 0;
let campaignSkippedByRules = 0;
let campaignSkippedDuplicateContacts = 0;
let lastExcludeIndex = null;
let whatsappWindow = null;
let visibleUserPasswords = new Set();
let editingInternalUsers = new Set();
let informaticoPortfolioTimer = null;
let informaticoSearchCache = new Map();
let informaticoSortedDebtors = null;
const remoteLoadedDebtors = new Set();
const remoteLoadingDebtors = new Set();

function applyRemoteData(remote) {
  if (!remote) return;
  data.generatedAt = remote.generatedAt || new Date().toISOString();
  data.businessRules = remote.businessRules || data.businessRules;
  data.summary = remote.summary || data.summary;
  data.debtors = remote.debtors || [];
  data.bankMovements = remote.bankMovements || [];
  invalidateInformaticoCaches();
}

function mergeDebtor(debtor) {
  if (!debtor) return null;
  const index = data.debtors.findIndex((item) => item.id === debtor.id);
  if (index >= 0) data.debtors[index] = debtor;
  else data.debtors.unshift(debtor);
  invalidateInformaticoCaches();
  return debtor;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) throw new Error(responseErrorMessage(json, response.status));
  return json;
}

function responseErrorMessage(json = {}, status = 500) {
  const error = json.error || json.message;
  if (!error) return `Error HTTP ${status}`;
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  if (error.details) return error.details;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function authInternalFromApi(user, pass) {
  return requestJson("/api/auth", {
    method: "POST",
    body: JSON.stringify({ user, pass }),
  });
}

async function loadPortfolioFromApi(user, pass) {
  const json = await requestJson("/api/bootstrap", {
    method: "POST",
    body: JSON.stringify({ user, pass }),
  });
  applyRemoteData(json.data);
  return json;
}

async function refreshPortfolioFromApi(user, pass) {
  try {
    await loadPortfolioFromApi(user, pass);
    fillFilters();
    const activeView = document.querySelector(".view.active")?.id;
    if (activeView && canAccessView(activeView)) showView(activeView);
  } catch (error) {
    const message = error.message || "No se pudo cargar cartera desde la nube.";
    console.error("No se pudo refrescar cartera desde la nube:", message);
    if (session?.role === "informatico") {
      store.health = {
        ok: false,
        status: "bad",
        checkedAt: new Date().toISOString(),
        checks: [
          { name: "Cartera remota", status: "bad", detail: message },
          ...healthFallbackChecks(),
        ],
      };
      renderHealthChecklist();
    }
  }
}

async function loadDebtorFromApi(rut) {
  const json = await requestJson(`/api/debtor?rut=${encodeURIComponent(rut)}`);
  return mergeDebtor(json.debtor);
}

async function loadHealthFromApi() {
  store.healthLoading = true;
  renderHealthChecklist();
  try {
    store.health = await requestJson("/api/health");
  } catch (error) {
    store.health = {
      ok: false,
      status: "bad",
      checkedAt: new Date().toISOString(),
      checks: [{ name: "Health API", status: "bad", detail: error.message || "No se pudo consultar el estado productivo." }],
    };
  } finally {
    store.healthLoading = false;
    renderHealthChecklist();
  }
}

const views = {
  deudor: [{ id: "debtorHome", label: "Mi deuda" }, { id: "localFiles", label: "Mis archivos" }],
  ejecutivo: [{ id: "executiveHome", label: "Gestión deudores" }, { id: "localFiles", label: "Comprobantes" }],
  jefatura: [{ id: "managementHome", label: "Dashboard" }, { id: "managementAgreements", label: "Convenios" }, { id: "managementBank", label: "Conciliación" }, { id: "localFiles", label: "Repositorio" }],
};

const titles = {
  debtorHome: "Portal deudor",
  executiveHome: "Gestión call center",
  managementHome: "Dashboard jefatura",
  managementAgreements: "Registro de convenios",
  managementBank: "Conciliación bancaria",
  localFiles: "Repositorio local",
};

const routeByView = {
  debtorHome: "deudor",
  executiveHome: "callcenter",
  managementHome: "jefatura",
  managementAgreements: "jefatura/convenios",
  managementBank: "jefatura/conciliacion",
  localFiles: "archivos",
};

const viewByRoute = {
  deudor: "debtorHome",
  callcenter: "executiveHome",
  jefatura: "managementHome",
  "jefatura/convenios": "managementAgreements",
  "jefatura/conciliacion": "managementBank",
  archivos: "localFiles",
};

views.ejecutivo.splice(1, 0, { id: "executiveValidation", label: "Validacion" });
titles.executiveValidation = "Validacion de pagos";
routeByView.executiveValidation = "callcenter/validacion";
viewByRoute["callcenter/validacion"] = "executiveValidation";

views.informatico = [
  { id: "informaticoHome", label: "Dashboard TI" },
  { id: "informaticoPortfolio", label: "Cartera total" },
  { id: "informaticoUsers", label: "Usuarios" },
];
Object.assign(titles, {
  informaticoHome: "Dashboard informatico",
  informaticoPortfolio: "Cartera total",
  informaticoImport: "Importar / actualizar",
  informaticoAssignments: "Reasignaciones",
  informaticoAudit: "Auditoria",
  informaticoUsers: "Usuarios y asignados",
  informaticoReports: "Reportes informatico",
});
Object.assign(routeByView, {
  informaticoHome: "informatico",
  informaticoPortfolio: "informatico/cartera",
  informaticoImport: "informatico/importar",
  informaticoAssignments: "informatico/reasignaciones",
  informaticoAudit: "informatico/auditoria",
  informaticoUsers: "informatico/usuarios",
  informaticoReports: "informatico/reportes",
});
Object.assign(viewByRoute, {
  informatico: "informaticoHome",
  "informatico/cartera": "informaticoPortfolio",
  "informatico/importar": "informaticoImport",
  "informatico/reasignaciones": "informaticoAssignments",
  "informatico/auditoria": "informaticoAudit",
  "informatico/usuarios": "informaticoUsers",
  "informatico/reportes": "informaticoReports",
});

function $(id) {
  return document.getElementById(id);
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeUsername(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}

function assignmentUsername(value) {
  return normalizeUsername(value || "").slice(0, 42) || "ejecutivo";
}

function roleFromInternalUser(user) {
  if (!user) return "";
  return user.role === "callcenter" ? "ejecutivo" : user.role;
}

async function internalUsersApi(action, payload = {}) {
  if (!session?.username || !session?.authPassword) throw new Error("Sesion administrativa no disponible.");
  return requestJson("/api/internal-users", {
    method: "POST",
    body: JSON.stringify({
      action,
      adminUser: session.username,
      adminPass: session.authPassword,
      ...payload,
    }),
  });
}

async function syncInternalUsersFromApi(showStatus = true) {
  try {
    const json = await sheetsUsersApi("sync");
    store.internalUsers = json.users || [];
    if (showStatus) $("itUserStatus").innerHTML = `<div class="history-item"><strong>Usuarios sincronizados desde Google Sheets</strong><br>${fmtNum.format(json.users?.length || 0)} asignados recibidos desde AIEP_BASE_TOTAL.</div>`;
    if (document.querySelector(".view.active")?.id === "informaticoUsers") renderInformaticoUsers();
    return true;
  } catch (error) {
    store.internalUsers = [];
    if (showStatus) $("itUserStatus").innerHTML = `<div class="detail-empty">No se pudo sincronizar con Google Sheets/Supabase: ${escapeHtml(error.message)}</div>`;
    return false;
  }
}

async function sheetsUsersApi(action, payload = {}) {
  if (!session?.username || !session?.authPassword) throw new Error("Sesion administrativa no disponible.");
  return requestJson("/api/sheets-users", {
    method: "POST",
    body: JSON.stringify({
      action,
      adminUser: session.username,
      adminPass: session.authPassword,
      ...payload,
    }),
  });
}

function operationalApiHeaders() {
  if (!session?.username || !session?.authPassword) throw new Error("Sesion administrativa no disponible.");
  return {
    "x-abg-user": session.username,
    "x-abg-pass": session.authPassword,
  };
}

function debtorQuery(debtor) {
  return `debtor_id=${encodeURIComponent(debtor.id)}`;
}

function setRemoteWarning(debtor, message) {
  if (!debtor) return;
  if (message) store.remoteWarnings[debtor.id] = `Modo degradado / datos no oficiales: ${message}`;
  else delete store.remoteWarnings[debtor.id];
}

function remoteWarningBanner(debtor) {
  const message = store.remoteWarnings[debtor?.id];
  return message ? `<div class="detail-empty">${escapeHtml(message)}</div>` : "";
}

function apiEntryToLocal(entry, debtor = selectedDebtor) {
  return {
    id: entry.id,
    debtorId: entry.debtorId || entry.debtor_id,
    debtorName: debtor?.nombreTitular || "",
    date: entry.date || entry.management_date,
    channel: entry.channel || "",
    result: entry.result || "",
    comment: entry.comment || "",
    user: entry.user || entry.created_by || "",
    createdAt: entry.createdAt || entry.created_at || new Date().toISOString(),
    remote: true,
  };
}

function replaceEntriesForDebtor(debtor, entries) {
  const official = entries.map((entry) => apiEntryToLocal(entry, debtor));
  store.entries = [
    ...official,
    ...store.entries.filter((entry) => entry.debtorId !== debtor.id || entry.pendingRemote),
  ];
}

function apiContactStatusToLocal(status, contact = {}) {
  if (status === "valido") return "ok";
  if (status === "no_considerar") return "ignore";
  if (contact.category || contact.note) return "manual";
  return "";
}

function localContactStatusToApi(status) {
  if (status === "ok") return "valido";
  if (status === "ignore") return "no_considerar";
  return "sin_validar";
}

function apiContactToLocal(contact) {
  const status = apiContactStatusToLocal(contact.status, contact);
  return {
    id: contact.id,
    status,
    category: contact.category || "",
    comment: contact.note || "",
    date: status ? (contact.updatedAt || contact.updated_at || contact.createdAt || contact.created_at || new Date().toISOString()) : "",
    remote: true,
  };
}

function ensureDebtorHasContactValue(debtor, contact) {
  const key = contact.type === "correo" ? "correos" : "telefonos";
  debtor[key] = debtor[key] || [];
  const normalized = normalizedContactValue(contact.type, contact.value);
  if (!debtor[key].some((value) => normalizedContactValue(contact.type, value) === normalized)) {
    debtor[key].push(contact.value);
  }
}

function applyRemoteContacts(debtor, contacts) {
  Object.keys(store.contacts)
    .filter((key) => key.startsWith(`${debtor.id}|`))
    .forEach((key) => delete store.contacts[key]);
  contacts.forEach((contact) => {
    ensureDebtorHasContactValue(debtor, contact);
    store.contacts[contactKey(debtor, contact.type, contact.value)] = apiContactToLocal(contact);
  });
}

function apiCommentToLocal(comment) {
  return {
    id: comment.id,
    text: comment.body || comment.text || "",
    user: comment.user || "",
    createdAt: comment.createdAt || comment.created_at || new Date().toISOString(),
    parentId: comment.parentId || comment.parent_id || null,
    replies: [],
    remote: true,
  };
}

function applyRemoteComments(debtor, comments) {
  const byId = new Map();
  comments.forEach((comment) => byId.set(comment.id, apiCommentToLocal(comment)));
  const roots = [];
  for (const item of byId.values()) {
    if (item.parentId && byId.has(item.parentId)) {
      const reply = { id: item.id, text: item.text, user: item.user, createdAt: item.createdAt, remote: true };
      byId.get(item.parentId).replies.push(reply);
    } else {
      roots.push(item);
    }
  }
  store.comments[debtor.id] = roots;
}

async function loadOperationalForDebtor(debtor, { force = false } = {}) {
  if (!debtor || session?.role === "deudor" || !session?.authPassword) return false;
  if (!force && remoteLoadedDebtors.has(debtor.id)) return true;
  if (remoteLoadingDebtors.has(debtor.id)) return false;
  remoteLoadingDebtors.add(debtor.id);
  try {
    const headers = operationalApiHeaders();
    const [entriesJson, contactsJson, commentsJson] = await Promise.all([
      requestJson(`/api/management-entries?${debtorQuery(debtor)}`, { headers }),
      requestJson(`/api/contacts?${debtorQuery(debtor)}`, { headers }),
      requestJson(`/api/internal-comments?${debtorQuery(debtor)}`, { headers }),
    ]);
    replaceEntriesForDebtor(debtor, entriesJson.entries || []);
    applyRemoteContacts(debtor, contactsJson.contacts || []);
    applyRemoteComments(debtor, commentsJson.comments || []);
    remoteLoadedDebtors.add(debtor.id);
    setRemoteWarning(debtor, "");
    if (selectedDebtor?.id === debtor.id) {
      renderExecutiveRows();
      renderExecutiveDetail();
    }
    return true;
  } catch (error) {
    setRemoteWarning(debtor, error.message || "No se pudo cargar la informacion oficial.");
    if (selectedDebtor?.id === debtor.id) renderExecutiveDetail();
    return false;
  } finally {
    remoteLoadingDebtors.delete(debtor.id);
  }
}

function snapshotOperationalDebtor(debtor) {
  return {
    entries: store.entries.slice(),
    contacts: { ...store.contacts },
    comments: JSON.parse(JSON.stringify(store.comments[debtor.id] || [])),
  };
}

function restoreOperationalDebtor(debtor, snapshot) {
  store.entries = snapshot.entries;
  store.contacts = snapshot.contacts;
  store.comments[debtor.id] = snapshot.comments;
}

async function createRemoteManagementEntry(debtor, entry) {
  const json = await requestJson("/api/management-entries", {
    method: "POST",
    headers: operationalApiHeaders(),
    body: JSON.stringify({
      debtor_id: debtor.id,
      date: entry.date,
      channel: entry.channel,
      result: entry.result,
      comment: entry.comment,
    }),
  });
  return apiEntryToLocal(json.entry, debtor);
}

async function saveRemoteContact(debtor, type, value, record) {
  const body = {
    debtor_id: debtor.id,
    type,
    value,
    status: localContactStatusToApi(record.status),
    category: record.category || "",
    note: record.comment || "",
  };
  const existingId = record.id;
  const json = await requestJson("/api/contacts", {
    method: existingId ? "PATCH" : "POST",
    headers: operationalApiHeaders(),
    body: JSON.stringify(existingId ? { id: existingId, ...body } : body),
  });
  return apiContactToLocal(json.contact);
}

async function createRemoteComment(debtor, text, parentId = null) {
  const json = await requestJson("/api/internal-comments", {
    method: "POST",
    headers: operationalApiHeaders(),
    body: JSON.stringify({
      debtor_id: debtor.id,
      body: text,
      parent_id: parentId,
    }),
  });
  return apiCommentToLocal(json.comment);
}

async function patchRemoteComment(id, payload) {
  return requestJson("/api/internal-comments", {
    method: "PATCH",
    headers: operationalApiHeaders(),
    body: JSON.stringify({ id, ...payload }),
  });
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

async function loadIndicators() {
  try {
    const response = await fetch("https://mindicador.cl/api", { cache: "no-store" });
    const json = await response.json();
    setText("ufValue", `UF: ${fmtMoney.format(json.uf.valor)}`);
    setText("dollarValue", `Dólar: ${fmtMoney.format(json.dolar.valor)}`);
  } catch {
    setText("ufValue", "UF: no disponible");
    setText("dollarValue", "Dólar: no disponible");
  }
}

function renderEntryMeta() {
  if (!sessionStartedAt) return;
  setText("entryDateTime", `Ingreso: ${sessionStartedAt.toLocaleString("es-CL")}`);
}

function normalizeText(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeRut(value) {
  return String(value || "").replace(/[.\-\s]/g, "").toUpperCase();
}

function invalidateInformaticoCaches() {
  informaticoSearchCache = new Map();
  informaticoSortedDebtors = null;
}

function sortedInformaticoDebtors() {
  if (!informaticoSortedDebtors) {
    informaticoSortedDebtors = data.debtors.slice().sort((a, b) => Number(b.deudaTotal || 0) - Number(a.deudaTotal || 0));
  }
  return informaticoSortedDebtors;
}

function informaticoSearchText(debtor) {
  if (informaticoSearchCache.has(debtor.id)) return informaticoSearchCache.get(debtor.id);
  const rutTerms = [debtor.rutDeudor, debtor.rutTitular, debtor.rutAlumno].map(normalizeRut).filter(Boolean);
  const text = normalizeText([
    debtor.id,
    debtor.rutDeudor, debtor.rutTitular, debtor.rutAlumno,
    ...rutTerms,
    debtor.nombreTitular, debtor.nombreAlumno, debtor.estado,
    debtor.comuna, debtor.region, debtor.rol, debtor.tribunal,
    assignmentName(debtor),
  ].join(" "));
  informaticoSearchCache.set(debtor.id, text);
  return text;
}

function scheduleInformaticoPortfolioRender() {
  window.clearTimeout(informaticoPortfolioTimer);
  informaticoPortfolioTimer = window.setTimeout(renderInformaticoPortfolio, 180);
}

function parseMoney(value) {
  const digits = String(value || "").replace(/[^\d-]/g, "");
  return digits && digits !== "-" ? Number(digits) : 0;
}

function getOffer(debtor) {
  return store.agreements[debtor.id] || store.offers[debtor.id] || null;
}

function getOfferAmount(debtor) {
  return getOffer(debtor)?.amount || 0;
}

function agreementPaidAmount(debtor) {
  const agreement = getOffer(debtor);
  const payerRut = normalizeRut(agreement?.payerRut || "");
  const debtorRuts = [debtor.rutTitular, debtor.rutAlumno, debtor.rutDeudor].map(normalizeRut).filter(Boolean);
  if (payerRut) debtorRuts.push(payerRut);
  const validFiles = store.files
    .filter((file) => file.debtorId === debtor.id && file.category === "comprobante" && file.status === "validado")
    .reduce((sum, file) => sum + Number(file.amount || 0), 0);
  const validBankRows = allBankRows()
    .filter((row) => ["validado", "conciliado"].includes(row.status))
    .filter((row) => {
      const values = [row.associatedRut, row.payerRut, row.rut].map(normalizeRut).filter(Boolean);
      return values.some((value) => debtorRuts.includes(value));
    })
    .reduce((sum, row) => sum + Number(row.monto || 0), 0);
  return validFiles + validBankRows;
}

function agreementRemainingAmount(debtor, agreement = getOffer(debtor)) {
  if (!agreement) return 0;
  return Math.max(0, Number(agreement.amount || 0) - agreementPaidAmount(debtor));
}

function agreementInstallmentAmount(agreement) {
  if (!agreement || agreement.type !== "cuotas") return Number(agreement?.amount || 0);
  const base = Math.max(0, Number(agreement.amount || 0) - Number(agreement.downPayment || 0));
  return Math.round(base / Math.max(1, Number(agreement.installments || 1)));
}

function legalProcedure(debtor) {
  return debtor.procedimiento || debtor.escritoDemanda || ((debtor.rol || debtor.tribunal) ? "Procedimiento (CIVIL)" : "");
}

function agreementTypeLabel(agreement) {
  if (!agreement) return "";
  return agreement.type === "cuotas" ? "Pago en cuotas" : "Liquidación total";
}

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function debtorRutMatch(debtor, rut) {
  const clean = normalizeRut(rut);
  return [debtor.rutTitular, debtor.rutAlumno, debtor.rutDeudor].some((item) => normalizeRut(item) === clean);
}

function contactKey(debtor, type, value) {
  return `${debtor.id}|${type}|${normalizedContactValue(type, value)}`;
}

function legacyContactKey(debtor, type, value) {
  return `${debtor.id}|${type}|${value}`;
}

function normalizedContactValue(type, value) {
  const clean = String(value || "").trim();
  if (type === "telefono") return phoneForWhatsApp(clean) || clean.replace(/\D/g, "");
  return clean.toLowerCase();
}

function contactRecord(debtor, type, value) {
  return store.contacts[contactKey(debtor, type, value)] || store.contacts[legacyContactKey(debtor, type, value)] || {};
}

function isIgnoredContact(debtor, type, value) {
  return contactRecord(debtor, type, value).status === "ignore";
}

function isCampaignExcluded(debtor) {
  return Boolean(store.campaignExcluded[debtor.id]);
}

function toggleCampaignExcluded(event) {
  event.preventDefault();
  event.stopPropagation();
  const id = event.currentTarget.dataset.debtorId;
  const index = Number(event.currentTarget.dataset.rowIndex);
  if (!id || Number.isNaN(index)) return;

  const targetState = !store.campaignExcluded[id];
  if (event.shiftKey && lastExcludeIndex !== null) {
    const start = Math.min(lastExcludeIndex, index);
    const end = Math.max(lastExcludeIndex, index);
    executiveRows.slice(start, end + 1).forEach((debtor) => {
      if (targetState) store.campaignExcluded[debtor.id] = true;
      else delete store.campaignExcluded[debtor.id];
    });
  } else {
    if (targetState) store.campaignExcluded[id] = true;
    else delete store.campaignExcluded[id];
  }
  lastExcludeIndex = index;
  writeJson("abg_campaign_excluded", store.campaignExcluded);
  renderExecutiveRows();
}

function clearCampaignExcluded() {
  store.campaignExcluded = {};
  lastExcludeIndex = null;
  writeJson("abg_campaign_excluded", store.campaignExcluded);
  renderExecutiveRows();
  setText("campaignStatus", "Exclusiones X limpiadas.");
}

function currentDebtorFiles() {
  if (!selectedDebtor) return [];
  return store.files.filter((file) => file.debtorId === selectedDebtor.id);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("abg-recov-local", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveFileRecord(file, meta) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const record = {
    id,
    name: file.name,
    size: file.size,
    type: file.type || "archivo",
    createdAt: new Date().toISOString(),
    ...meta,
  };
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ ...record, blob: file });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  store.files.unshift(record);
  writeJson("abg_files", store.files);
  return record;
}

function renderBars(id, rows, formatter = fmtNum.format) {
  const root = $(id);
  const max = Math.max(...rows.map((row) => row[1]), 1);
  root.innerHTML = rows.length
    ? rows.map(([label, value]) => `
      <div class="bar-row">
        <span title="${label}">${label || "Sin dato"}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (value / max) * 100)}%"></div></div>
        <strong>${formatter(value)}</strong>
      </div>
    `).join("")
    : `<div class="detail-empty">Sin datos para el filtro seleccionado.</div>`;
}

function showView(id) {
  if (!canAccessView(id)) id = defaultViewForRole(session?.role);
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === id));
  setText("viewTitle", titles[id] || "Plataforma");
  $("globalSearchBox").hidden = session?.role !== "ejecutivo";
  const route = routeByView[id];
  if (route && location.hash.replace(/^#\/?/, "") !== route) history.replaceState(null, "", `#/${route}`);
  if (id === "executiveHome") {
    renderExecutiveRows();
    renderExecutiveDetail();
  }
  if (id === "localFiles") renderFileRepository();
  if (id === "executiveValidation") renderValidationQueue();
  if (id === "managementHome") renderManagement();
  if (id === "managementAgreements") renderAgreementRegistry();
  if (id === "managementBank") renderBankRows();
  if (id === "informaticoHome") renderInformaticoHome();
  if (id === "informaticoPortfolio") renderInformaticoPortfolio();
  if (id === "informaticoImport") renderInformaticoImport();
  if (id === "informaticoAssignments") renderInformaticoAssignments();
  if (id === "informaticoAudit") renderInformaticoAudit();
  if (id === "informaticoUsers") renderInformaticoUsers();
  if (id === "informaticoReports") renderInformaticoReports();
}

function defaultViewForRole(role) {
  if (role === "deudor") return "debtorHome";
  if (role === "ejecutivo") return "executiveHome";
  if (role === "jefatura") return "managementHome";
  if (role === "informatico") return "informaticoHome";
  return "";
}

function canAccessView(id) {
  if (!session) return false;
  return views[session.role]?.some((view) => view.id === id);
}

function requestedView() {
  const route = location.hash.replace(/^#\/?/, "");
  return viewByRoute[route] || "";
}

function openRequestedOrDefault() {
  const requested = requestedView();
  showView(requested && canAccessView(requested) ? requested : defaultViewForRole(session.role));
}

function applyRoleTheme(role = "") {
  document.body.classList.remove("role-deudor", "role-ejecutivo", "role-jefatura", "role-informatico");
  if (role) document.body.classList.add(`role-${role}`);
}

function renderNav() {
  $("mainNav").innerHTML = views[session.role].map((view, index) => `
    <button class="nav-item ${index === 0 ? "active" : ""}" data-view="${view.id}">${view.label}</button>
  `).join("");
  document.querySelectorAll(".nav-item").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));
}

function login(role, debtor = null, profile = null, password = "") {
  const username = role === "deudor" ? (debtor?.rutTitular || debtor?.rutAlumno || debtor?.rutDeudor) : (profile?.username || $("internalUser").value.trim());
  session = {
    role,
    debtorId: debtor?.id || null,
    username,
    displayName: profile?.displayName || username,
    assignmentName: profile?.assignmentName || "",
    internalUserId: profile?.id || "",
    authPassword: password,
  };
  sessionStartedAt = new Date();
  selectedDebtor = role === "deudor" ? debtor : null;
  document.body.classList.remove("logged-out");
  applyRoleTheme(role);
  renderEntryMeta();
  loadIndicators();
  window.setTimeout(() => setText("roleLabel", roleLabel(role, username)), 0);
  setText("roleLabel", role === "deudor" ? `Deudor · ${username}` : role === "ejecutivo" ? `Call center · ${username}` : `Jefatura · ${username}`);
  renderNav();
  fillFilters();

  if (role === "deudor") {
    renderDebtorPortal();
  }
  if (role === "ejecutivo") {
    renderExecutiveRows();
    renderExecutiveDetail();
  }
  if (role === "jefatura") {
    renderManagement();
    renderBankRows();
    renderAgreementRegistry();
  }
  if (role === "informatico") {
    syncInternalUsersFromApi(false);
  }
  openRequestedOrDefault();
}

function roleLabel(role, username) {
  if (role === "deudor") return `Deudor - ${username}`;
  if (role === "ejecutivo") return `Call center - ${username}`;
  if (role === "jefatura") return `Jefatura - ${username}`;
  if (role === "informatico") return `Informatico - ${username}`;
  return username || "Sin sesion";
}

async function handleLogin(event) {
  event.preventDefault();
  const user = $("loginUser").value.trim();
  $("loginError").textContent = "";

  let debtor = data.debtors.find((item) => debtorRutMatch(item, user));
  if (!debtor) {
    try {
      $("loginError").textContent = "Consultando deuda...";
      debtor = await loadDebtorFromApi(user);
      $("loginError").textContent = "";
    } catch {
      debtor = null;
    }
  }
  if (debtor) return login("deudor", debtor);

  $("loginError").textContent = "RUT no encontrado. Ingrese RUT de titular o alumno.";
}

async function handleInternalLogin(event) {
  event.preventDefault();
  const user = normalizeUsername($("internalUser").value.trim());
  const pass = $("internalPass").value;
  const submitButton = event.submitter || $("internalLoginForm").querySelector("button[type='submit']");
  $("internalLoginError").textContent = "";
  if (submitButton) submitButton.disabled = true;
  try {
    $("internalLoginError").textContent = "Validando usuario y cargando cartera desde la nube...";
    const json = await loadPortfolioFromApi(user, pass);
    const remoteUser = json.user || {
      username: user,
      displayName: user,
      role: json.role,
      assignmentName: "",
    };
    const role = roleFromInternalUser(remoteUser);
    $("internalLoginError").textContent = "";
    return login(role, null, remoteUser, pass);
  } catch (error) {
    $("internalLoginError").textContent = error.message || "No se pudo validar en la nube.";
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function logout() {
  session = null;
  selectedDebtor = null;
  $("loginForm").reset();
  $("internalLoginForm").reset();
  document.body.classList.add("logged-out");
  applyRoleTheme("");
  history.replaceState(null, "", location.pathname);
}

function fillFilters() {
  const states = [...new Set(data.debtors.map((d) => d.estado).filter(Boolean))].sort();
  for (const id of ["execStateFilter", "reportStateFilter", "agreementStateFilter", "itStateFilter"]) {
    const node = $(id);
    if (node && node.options.length === 1) node.insertAdjacentHTML("beforeend", ["Convenio en curso", ...states].map((state) => `<option>${state}</option>`).join(""));
  }
  const assignments = [...new Set(data.debtors.map((d) => d.asignacion || d.usuario || d.equipo).filter(Boolean))].sort();
  for (const id of ["execAssignmentFilter", "reportAssignmentFilter", "itAssignmentFilter"]) {
    const node = $(id);
    if (node && node.options.length === 1) node.insertAdjacentHTML("beforeend", assignments.map((item) => `<option>${escapeAttr(item)}</option>`).join(""));
  }
}

function entriesForDebtor(debtor) {
  return store.entries.filter((entry) => entry.debtorId === debtor.id);
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function daysBetween(dateA, dateB) {
  const a = new Date(`${dateA}T00:00:00`);
  const b = new Date(`${dateB}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((b - a) / 86400000);
}

function recentEntriesForDebtor(debtor, days = 3) {
  const start = new Date(`${today()}T00:00:00`);
  start.setDate(start.getDate() - (days - 1));
  const startIso = start.toISOString().slice(0, 10);
  return entriesForDebtor(debtor).filter((entry) => dateOnly(entry.date) >= startIso);
}

function daysSinceLastManagement(debtor) {
  const dates = entriesForDebtor(debtor).map((entry) => dateOnly(entry.date)).filter(Boolean).sort();
  if (!dates.length) return null;
  return daysBetween(dates[dates.length - 1], today());
}

function managementSummary(debtor) {
  const recent = recentEntriesForDebtor(debtor);
  if (!recent.length) return `<span class="management-chip empty">Sin gestion 3d</span>`;
  const channels = [...new Set(recent.map((entry) => entry.channel).filter(Boolean))].slice(0, 2).join(" / ");
  return `<span class="management-chip">${recent.length} gest.</span><small>${channels || "Sin canal"}</small>`;
}

function executiveManagementDateRange() {
  const exact = $("execManagementExactDate")?.value || "";
  if (exact) return { from: exact, to: exact };
  return {
    from: $("execManagementFrom")?.value || "",
    to: $("execManagementTo")?.value || "",
  };
}

function visibleManagementDates() {
  const { from, to } = executiveManagementDateRange();
  return [...new Set(store.entries.map((entry) => dateOnly(entry.date)).filter(Boolean))]
    .filter((date) => (!from || date >= from) && (!to || date <= to))
    .sort()
    .reverse();
}

function managementDateLabel(date) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function managementEntriesOnDate(debtor, date) {
  return entriesForDebtor(debtor).filter((entry) => dateOnly(entry.date) === date);
}

function managementDateSummary(debtor, date) {
  const entries = managementEntriesOnDate(debtor, date);
  if (!entries.length) return `<span class="management-day-empty">-</span>`;
  const channels = [...new Set(entries.map((entry) => entry.channel).filter(Boolean))].join(" / ");
  const latest = entries[0];
  return `
    <span class="management-day-chip">${entries.length} gest.</span>
    <small>${escapeHtml(channels || "Sin canal")}</small>
    <small>${escapeHtml(latest.result || latest.comment || "Gestion registrada")}</small>
  `;
}

function renderExecutiveHead(managementDates) {
  $("executiveHead").innerHTML = `
    <tr>
      <th class="sticky-col">Sel / titular</th>
      <th>RUT titular</th>
      <th>Alumno</th>
      <th>Deuda total</th>
      <th>Estado</th>
      <th>Asignado</th>
      <th>Telefono</th>
      <th>Correo</th>
      <th>Comuna</th>
      <th>Ultima gestion</th>
      <th>Proxima gestion</th>
      <th>Convenio</th>
      <th>Accion</th>
      ${managementDates.map((date) => `<th class="management-date-head">Gestion ${managementDateLabel(date)}</th>`).join("")}
    </tr>
  `;
}

function lastManagementAgeLabel(debtor) {
  const days = daysSinceLastManagement(debtor);
  if (days === null) return "Nunca";
  if (days === 0) return "Hoy";
  return `${days} dia${days === 1 ? "" : "s"}`;
}

function executiveFilter(debtor) {
  const q = normalizeText($("globalSearch").value);
  const state = $("execStateFilter").value;
  const contact = $("execContactFilter").value;
  const recent = $("execRecentFilter")?.value || "";
  const agreementFilter = $("execAgreementFilter")?.value || "";
  const assignment = $("execAssignmentFilter")?.value || "";
  const minDebt = parseMoney($("execDebtMin")?.value || "");
  const maxDebt = parseMoney($("execDebtMax")?.value || "");
  const minDaysWithoutManagement = Number($("execNoManagementDays")?.value || 0);
  const agreement = getOffer(debtor);
  const matchesQuery = !q || normalizeText([debtor.nombreTitular, debtor.rutTitular, debtor.rutAlumno, debtor.nombreAlumno, debtor.estado, debtor.direccion, debtor.comuna, debtor.region, debtor.rol, debtor.tribunal, debtor.asignacion].join(" ")).includes(q);
  const matchesContact = !contact || (contact === "phone" && debtor.telefonos.length) || (contact === "email" && debtor.correos.length) || (contact === "none" && !debtor.telefonos.length && !debtor.correos.length);
  const recentCount = recentEntriesForDebtor(debtor).length;
  const age = daysSinceLastManagement(debtor);
  const matchesRecent = !recent
    || (recent === "last3" && recentCount > 0)
    || (recent === "none3" && recentCount === 0)
    || (recent === "never" && age === null);
  const matchesAge = !minDaysWithoutManagement || age === null || age >= minDaysWithoutManagement;
  const matchesAgreement = !agreementFilter
    || (agreementFilter === "with" && agreement)
    || (agreementFilter === "without" && !agreement)
    || (agreement && agreement.type === agreementFilter);
  const debtorAssignment = debtor.asignacion || debtor.usuario || debtor.equipo || "";
  const sessionAssignment = normalizeText(session?.assignmentName || "");
  const matchesSessionAssignment = session?.role !== "ejecutivo"
    || (sessionAssignment && normalizeText(debtorAssignment) === sessionAssignment);
  const matchesAssignment = !assignment || debtorAssignment === assignment;
  const matchesDebt = (!minDebt || debtor.deudaTotal >= minDebt) && (!maxDebt || debtor.deudaTotal <= maxDebt);
  return matchesSessionAssignment && matchesQuery && (!state || displayState(debtor) === state) && matchesContact && matchesRecent && matchesAge && matchesAgreement && matchesAssignment && matchesDebt;
}

function sortedExecutiveDebtors() {
  return data.debtors.filter(executiveFilter).sort((a, b) => {
    const paidA = effectiveState(a).includes("pagado") ? 1 : 0;
    const paidB = effectiveState(b).includes("pagado") ? 1 : 0;
    if (paidA !== paidB) return paidA - paidB;
    return b.saldoCapital - a.saldoCapital;
  });
}

function debtorMatchesAgreementFilter(debtor, filter) {
  const agreement = getOffer(debtor);
  return !filter
    || (filter === "with" && agreement)
    || (filter === "without" && !agreement)
    || (agreement && agreement.type === filter);
}

function filteredManagementDebtors() {
  const state = $("reportStateFilter").value;
  const agreementFilter = $("reportAgreementFilter")?.value || "";
  const assignment = $("reportAssignmentFilter")?.value || "";
  const minDebt = parseMoney($("reportDebtMin")?.value || "");
  const maxDebt = parseMoney($("reportDebtMax")?.value || "");
  return data.debtors.filter((debtor) => {
    const debtorAssignment = debtor.asignacion || debtor.usuario || debtor.equipo || "";
    return (!state || displayState(debtor) === state)
      && debtorMatchesAgreementFilter(debtor, agreementFilter)
      && (!assignment || debtorAssignment === assignment)
      && (!minDebt || debtor.deudaTotal >= minDebt)
      && (!maxDebt || debtor.deudaTotal <= maxDebt);
  });
}

function renderExecutiveRows() {
  const managementDates = visibleManagementDates();
  renderExecutiveHead(managementDates);
  if ($("executiveTable")) {
    $("executiveTable").style.minWidth = `${1560 + (managementDates.length * 170)}px`;
  }
  executiveRows = sortedExecutiveDebtors();
  $("executiveRows").innerHTML = executiveRows.slice(0, 350).map((d, index) => `
    <tr data-index="${index}" class="${rowClass(d)} ${isCampaignExcluded(d) ? "campaign-excluded-row" : ""} ${selectedDebtor?.id === d.id ? "selected-row" : ""}">
      <td class="sticky-col">
        <div class="name-cell">
          <button type="button" class="exclude-toggle ${isCampaignExcluded(d) ? "active" : ""}" data-debtor-id="${escapeAttr(d.id)}" data-row-index="${index}" title="${isCampaignExcluded(d) ? "Incluir en masivos" : "Excluir de masivos"} · Shift marca rango">${isCampaignExcluded(d) ? "X" : ""}</button>
          <div>
            <span class="agreement-dot ${agreementDotClass(d)}"></span>${commentCount(d) ? `<span class="comment-badge row-comment-badge" title="Tiene comentarios internos"></span>` : ""}<strong>${d.nombreTitular || "Sin nombre"}</strong><br><span class="muted">${d.nombreAlumno || "Alumno no informado"}</span>
          </div>
        </div>
      </td>
      <td>${d.rutTitular || d.rutDeudor}</td>
      <td><strong>${d.nombreAlumno || "Sin alumno"}</strong><br><span class="muted">${d.rutAlumno || ""}</span></td>
      <td>${fmtMoney.format(d.deudaTotal || d.saldoCapital)}</td>
      <td>${statusPill(d)}</td>
      <td>${escapeHtml(assignmentName(d))}</td>
      <td>${escapeHtml(primaryPhone(d) || "Sin telefono")}</td>
      <td>${escapeHtml(primaryEmail(d) || "Sin correo")}</td>
      <td>${escapeHtml(d.comuna || "Sin comuna")}</td>
      <td>${lastManagementAgeLabel(d)}</td>
      <td>${d.proximaGestion || "-"}</td>
      <td><strong>${getOfferAmount(d) ? fmtMoney.format(getOfferAmount(d)) : "Sin convenio"}</strong></td>
      <td><button type="button" class="sheet-action" data-open-debtor="${escapeAttr(d.id)}">Ver</button></td>
      ${managementDates.map((date) => `<td class="management-date-cell">${managementDateSummary(d, date)}</td>`).join("")}
    </tr>
  `).join("");
  document.querySelectorAll("#executiveRows tr").forEach((row) => {
    row.addEventListener("click", () => {
      selectedDebtor = executiveRows[Number(row.dataset.index)];
      renderExecutiveRows();
      renderExecutiveDetail();
      loadOperationalForDebtor(selectedDebtor);
    });
  });
  document.querySelectorAll("[data-debtor-id].exclude-toggle").forEach((btn) => btn.addEventListener("click", toggleCampaignExcluded));
}

function rowClass(debtor) {
  const agreement = getOffer(debtor);
  if (!agreement) return effectiveState(debtor) === "pagado" ? "paid-row" : "";
  return agreement.type === "cuotas" ? "installment-row" : "settlement-row";
}

function effectiveState(debtor) {
  if (getOffer(debtor)) return "convenio en curso";
  return normalizeText(debtor.estado);
}

function statusClassFromState(state) {
  const normalized = normalizeText(state);
  if (normalized.includes("convenio")) return "status-agreement";
  if (normalized.includes("pagado")) return "status-paid";
  if (normalized.includes("acuerdo roto")) return "status-broken";
  return "status-neutral";
}

function statusPill(debtor) {
  const label = displayState(debtor);
  return `<span class="status-pill ${statusClassFromState(label)}">${label}</span>`;
}

function statusPillFromState(state) {
  return `<span class="status-pill ${statusClassFromState(state)}">${state || "Pendiente"}</span>`;
}

function agreementDotClass(debtor) {
  const agreement = getOffer(debtor);
  if (!agreement) return "";
  const status = agreementStatus(agreement);
  return `show ${status}`;
}

function agreementStatus(agreement) {
  const next = nextPaymentDate(agreement);
  if (!next) return "yellow";
  const diff = Math.ceil((new Date(next + "T00:00:00") - new Date(today() + "T00:00:00")) / 86400000);
  if (diff < 0) return "red";
  if (diff === 0) return "blink";
  if (diff <= 5) return "orange";
  return "yellow";
}

function agreementPaymentSchedule(agreement) {
  if (!agreement) return [];
  if (Array.isArray(agreement.payments) && agreement.payments.length) return agreement.payments;
  return (agreement.paymentDates || [agreement.startDate].filter(Boolean)).map((date) => ({ date, amount: 0, label: "Pago" }));
}

function nextPaymentDate(agreement) {
  const dates = agreementPaymentSchedule(agreement).map((payment) => payment.date).filter(Boolean);
  return dates.find((date) => date >= today()) || dates[dates.length - 1] || "";
}

function contactLabel(debtor) {
  const parts = [];
  if (debtor.telefonos.length) parts.push(`${debtor.telefonos.length} tel.`);
  if (debtor.correos.length) parts.push(`${debtor.correos.length} correo`);
  return parts.join(" / ") || "Sin datos";
}

function assignmentName(debtor) {
  return debtor.asignacion || debtor.usuario || debtor.equipo || "Sin asignacion";
}

function primaryPhone(debtor) {
  return (debtor.telefonos || []).find((phone) => !isIgnoredContact(debtor, "telefono", phone)) || debtor.telefonos?.[0] || "";
}

function primaryEmail(debtor) {
  return (debtor.correos || []).find((email) => !isIgnoredContact(debtor, "correo", email)) || debtor.correos?.[0] || "";
}

function renderExecutiveDetail() {
  const d = selectedDebtor;
  document.querySelector("#executiveHome .workbench")?.classList.toggle("detail-collapsed", !d);
  if (!d) {
    setText("execSelectedStatus", "Seleccione deudor");
    if ($("selectedCommentIcon")) $("selectedCommentIcon").hidden = true;
    $("executiveDetail").className = "detail-empty";
    $("executiveDetail").innerHTML = "Seleccione cliente para ver ficha, contactos, deuda, convenios y bitacora.";
    return;
  }
  const offer = getOffer(d);
  setText("execSelectedStatus", displayState(d));
  $("selectedCommentIcon").hidden = commentCount(d) === 0;
  $("selectedCommentIcon").title = `${commentCount(d)} comentario(s) interno(s)`;
  $("executiveDetail").className = "";
  $("executiveDetail").innerHTML = `
    ${remoteWarningBanner(d)}
    <section class="comment-thread">
      <button type="button" id="toggleComments" class="comment-toggle"><span class="comment-arrow">▶</span> Comentarios internos (${commentCount(d)})</button>
      <div id="commentPanel" class="comment-panel" hidden>
        <form id="commentForm" class="comment-form">
          <textarea id="commentText" rows="3" placeholder="Agregar comentario interno"></textarea>
          <button type="submit">Agregar comentario</button>
        </form>
        <div id="commentList">${renderComments(d)}</div>
      </div>
    </section>
    <div class="name-block ${rowClass(d)}">
      <span class="agreement-dot ${agreementDotClass(d)}"></span>
      <div>
        <span>Titular</span>
        <strong>${d.nombreTitular || "Sin titular"}</strong>
        <small>${d.rutTitular || d.rutDeudor}</small>
      </div>
      <div>
        <span>Estudiante</span>
        <strong>${d.nombreAlumno || "Sin alumno"}</strong>
        <small>${d.rutAlumno || "Sin RUT alumno"}</small>
      </div>
    </div>
    <div class="legal-grid">
      ${detailItem("Direccion", d.direccion)}
      ${detailItem("Comuna / region", [d.comuna, d.region].filter(Boolean).join(" / "))}
      ${detailItem("Rol judicial", d.rol)}
      ${detailItem("Tribunal", d.tribunal)}
      ${detailItem("Procedimiento", legalProcedure(d))}
      ${detailItem("Asignacion", d.asignacion || d.usuario || d.equipo)}
    </div>
    <div class="excel-card">
      <table class="mini-table">
        <thead><tr><th>Concepto</th><th>Monto</th></tr></thead>
        <tbody>
          <tr><td>Saldo capital</td><td>${fmtMoney.format(d.saldoCapital)}</td></tr>
          <tr class="interest-row"><td>Intereses mora</td><td>${fmtMoney.format(d.interes)}</td></tr>
          <tr class="expense-row"><td>Gastos cobranza</td><td>${fmtMoney.format(d.gastoCobranza)}</td></tr>
          <tr class="total-row"><td>Saldo total pendiente</td><td>${fmtMoney.format(d.deudaTotal)}</td></tr>
          ${offer ? `<tr class="agreement-total"><td>Convenio vigente</td><td>${fmtMoney.format(offer.amount)}</td></tr>` : ""}
        </tbody>
      </table>
    </div>
    ${renderAgreementSummary(d)}
    <button id="openAgreementModal" type="button" class="primary-action">Nuevo / editar convenio</button>
    <h3>Nueva gestión</h3>
    <form id="execManagementForm" class="form-grid stacked">
      <label>Fecha gestión<input type="date" name="date" value="${today()}" required></label>
      <label>Canal<select name="channel"><option>Llamado</option><option>WhatsApp</option><option>Correo</option><option>Presencial</option></select></label>
      <label>Resultado<select name="result"><option>Contactado</option><option>No contesta</option><option>Compromiso de pago</option><option>Teléfono inválido</option><option>Correo inválido</option><option>Solicita revisión</option><option>Pagó / comprobante</option></select></label>
      <label class="wide">Comentario<textarea name="comment" rows="4" placeholder="Detalle de la gestión realizada"></textarea></label>
      <label class="wide">Adjuntar comprobante del deudor<input type="file" name="receipt" accept=".pdf,.jpg,.jpeg,.png,.webp"></label>
      <button type="submit">Registrar gestión y comprobante</button>
    </form>
    <h3>Gestiones pasadas</h3>
    <div class="history-strip">${renderHistoryCards(d)}</div>
    <div class="history">${renderHistory(d)}</div>
    <h3>Contactabilidad</h3>
    <h3>Teléfonos</h3>
    <div class="contact-list">${renderContacts(d, "telefono", d.telefonos)}</div>
    <h3>Correos</h3>
    <div class="contact-list">${renderContacts(d, "correo", d.correos)}</div>
    <div id="copyStatus" class="copy-status"></div>
  `;
  $("toggleComments").addEventListener("click", () => {
    const panel = $("commentPanel");
    panel.hidden = !panel.hidden;
    $("toggleComments").classList.toggle("open", !panel.hidden);
  });
  $("commentForm").addEventListener("submit", saveComment);
  document.querySelectorAll("[data-reply-comment]").forEach((form) => form.addEventListener("submit", saveReply));
  document.querySelectorAll("[data-delete-comment]").forEach((btn) => btn.addEventListener("click", deleteComment));
  document.querySelectorAll("[data-delete-reply]").forEach((btn) => btn.addEventListener("click", deleteReply));
  $("openAgreementModal").addEventListener("click", openAgreementModal);
  const editButton = $("editAgreement");
  if (editButton) editButton.addEventListener("click", openAgreementModal);
  const deleteButton = $("deleteAgreement");
  if (deleteButton) deleteButton.addEventListener("click", deleteAgreement);
  $("execManagementForm").addEventListener("submit", saveManagementEntry);
  document.querySelectorAll("[data-contact-action]").forEach((btn) => btn.addEventListener("click", updateContactStatus));
  document.querySelectorAll("[data-contact-save]").forEach((btn) => btn.addEventListener("click", saveContactMeta));
  document.querySelectorAll("[data-contact-delete]").forEach((btn) => btn.addEventListener("click", deleteContactMeta));
  document.querySelectorAll("[data-copy-message]").forEach((node) => node.addEventListener("click", copyContactMessage));
}

function detailItem(label, value) {
  return `<div class="detail-item"><span class="detail-label">${label}</span><strong>${value || "Sin dato"}</strong></div>`;
}

function renderAgreementSummary(debtor) {
  const agreement = getOffer(debtor);
  if (!agreement) return `<div class="detail-empty">Sin convenio registrado.</div>`;
  const paid = agreementPaidAmount(debtor);
  const remaining = agreementRemainingAmount(debtor, agreement);
  const installment = agreementInstallmentAmount(agreement);
  return `
    <div class="agreement-summary ${agreement.type === "cuotas" ? "installment-row" : "settlement-row"}">
      <strong>${agreementTypeLabel(agreement)} · ${fmtMoney.format(agreement.amount)}</strong>
      <span>Inicio: ${agreement.startDate || "Sin fecha"} · Próximo pago: ${nextPaymentDate(agreement) || "Sin fecha"}</span>
      ${agreement.type === "cuotas" ? `<span>Pie: ${fmtMoney.format(agreement.downPayment || 0)} Â· Cuota estimada: ${fmtMoney.format(installment)}</span>` : ""}
      <span>Pagado validado: ${fmtMoney.format(paid)} Â· Saldo convenio: ${fmtMoney.format(remaining)}</span>
      ${agreement.payerRut ? `<span>RUT que paga: ${escapeHtml(agreement.payerRut)}</span>` : ""}
      ${renderAgreementMiniCalendar(agreement)}
      ${agreement.notes ? `<p>${agreement.notes}</p>` : ""}
      <div class="agreement-actions">
        <button type="button" id="editAgreement" class="icon-action edit-action" title="Editar convenio" aria-label="Editar convenio">✎</button>
        <button type="button" id="deleteAgreement" class="icon-action danger-action" title="Eliminar convenio" aria-label="Eliminar convenio">✕</button>
      </div>
    </div>
  `;
}

function renderAgreementMiniCalendar(agreement) {
  const dates = agreementPaymentSchedule(agreement).map((payment) => payment.date).filter(Boolean);
  if (!dates.length) return "";
  const marked = new Set(dates.map((date) => Number(date.slice(8, 10))));
  const base = new Date((dates[0] || today()) + "T00:00:00");
  const year = base.getFullYear();
  const month = base.getMonth();
  const blanks = new Date(year, month, 1).getDay();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: blanks }, () => `<span></span>`),
    ...Array.from({ length: lastDay }, (_, i) => {
      const day = i + 1;
      return `<span class="${marked.has(day) ? "payday" : ""}">${day}</span>`;
    }),
  ];
  return `<div class="mini-calendar"><strong>${base.toLocaleDateString("es-CL", { month: "long", year: "numeric" })}</strong><div>${cells.join("")}</div></div>`;
}

function commentCount(debtor) {
  return (store.comments[debtor.id] || []).reduce((total, comment) => total + 1 + (comment.replies?.length || 0), 0);
}

function renderComments(debtor) {
  const comments = store.comments[debtor.id] || [];
  if (!comments.length) return `<div class="detail-empty">Sin comentarios internos.</div>`;
  return comments.map((comment) => `
    <article class="comment-item">
      <div class="comment-head">
        <strong>${comment.user} · ${new Date(comment.createdAt).toLocaleString("es-CL")}</strong>
        <button type="button" class="comment-delete" data-delete-comment="${escapeAttr(comment.id)}" title="Eliminar comentario">x</button>
      </div>
      <p>${escapeHtml(comment.text)}</p>
      <div class="reply-list">
        ${(comment.replies || []).map((reply, index) => `<div class="reply-item"><strong>${escapeHtml(reply.user)}</strong><span>${escapeHtml(reply.text)}</span><button type="button" class="comment-delete" data-delete-comment="${escapeAttr(comment.id)}" data-delete-reply="${escapeAttr(reply.id || index)}" title="Eliminar respuesta">x</button></div>`).join("")}
      </div>
      <form class="reply-form" data-reply-comment="${escapeAttr(comment.id)}">
        <input placeholder="Responder comentario">
        <button type="submit">Responder</button>
      </form>
    </article>
  `).join("");
}

async function deleteComment(event) {
  if (event.currentTarget.dataset.deleteReply !== undefined) return;
  const id = event.currentTarget.dataset.deleteComment;
  const snapshot = snapshotOperationalDebtor(selectedDebtor);
  store.comments[selectedDebtor.id] = (store.comments[selectedDebtor.id] || []).filter((comment) => comment.id !== id);
  renderExecutiveRows();
  renderExecutiveDetail();
  $("commentPanel").hidden = false;
  $("toggleComments").classList.add("open");
  try {
    if (/^[0-9a-f-]{36}$/i.test(id)) await patchRemoteComment(id, { action: "delete" });
    setRemoteWarning(selectedDebtor, "");
  } catch (error) {
    restoreOperationalDebtor(selectedDebtor, snapshot);
    setRemoteWarning(selectedDebtor, error.message || "No se pudo eliminar el comentario oficial.");
    renderExecutiveRows();
    renderExecutiveDetail();
    $("commentPanel").hidden = false;
    $("toggleComments").classList.add("open");
  }
}

async function deleteReply(event) {
  event.stopPropagation();
  const id = event.currentTarget.dataset.deleteComment;
  const replyIdOrIndex = event.currentTarget.dataset.deleteReply;
  const snapshot = snapshotOperationalDebtor(selectedDebtor);
  const list = store.comments[selectedDebtor.id] || [];
  const comment = list.find((item) => item.id === id);
  if (!comment) return;
  comment.replies = (comment.replies || []).filter((reply, i) => String(reply.id || i) !== String(replyIdOrIndex));
  renderExecutiveRows();
  renderExecutiveDetail();
  $("commentPanel").hidden = false;
  $("toggleComments").classList.add("open");
  try {
    if (/^[0-9a-f-]{36}$/i.test(replyIdOrIndex)) await patchRemoteComment(replyIdOrIndex, { action: "delete" });
    setRemoteWarning(selectedDebtor, "");
  } catch (error) {
    restoreOperationalDebtor(selectedDebtor, snapshot);
    setRemoteWarning(selectedDebtor, error.message || "No se pudo eliminar la respuesta oficial.");
    renderExecutiveRows();
    renderExecutiveDetail();
    $("commentPanel").hidden = false;
    $("toggleComments").classList.add("open");
  }
}

async function saveComment(event) {
  event.preventDefault();
  const text = $("commentText").value.trim();
  if (!text) return;
  const snapshot = snapshotOperationalDebtor(selectedDebtor);
  const tempId = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const list = store.comments[selectedDebtor.id] || [];
  list.unshift({ id: tempId, text, user: session.username, createdAt: new Date().toISOString(), replies: [], pendingRemote: true });
  store.comments[selectedDebtor.id] = list;
  renderExecutiveRows();
  renderExecutiveDetail();
  $("commentPanel").hidden = false;
  try {
    const created = await createRemoteComment(selectedDebtor, text);
    const current = store.comments[selectedDebtor.id] || [];
    const index = current.findIndex((comment) => comment.id === tempId);
    if (index >= 0) current[index] = { ...created, replies: [] };
    setRemoteWarning(selectedDebtor, "");
    remoteLoadedDebtors.add(selectedDebtor.id);
    renderExecutiveRows();
    renderExecutiveDetail();
    $("commentPanel").hidden = false;
  } catch (error) {
    restoreOperationalDebtor(selectedDebtor, snapshot);
    setRemoteWarning(selectedDebtor, error.message || "No se pudo guardar el comentario oficial.");
    renderExecutiveRows();
    renderExecutiveDetail();
    $("commentPanel").hidden = false;
  }
}

async function saveReply(event) {
  event.preventDefault();
  const input = event.currentTarget.querySelector("input");
  const text = input.value.trim();
  if (!text) return;
  const id = event.currentTarget.dataset.replyComment;
  const snapshot = snapshotOperationalDebtor(selectedDebtor);
  const list = store.comments[selectedDebtor.id] || [];
  const comment = list.find((item) => item.id === id);
  if (!comment) return;
  comment.replies = comment.replies || [];
  const tempId = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  comment.replies.push({ id: tempId, text, user: session.username, createdAt: new Date().toISOString(), pendingRemote: true });
  renderExecutiveRows();
  renderExecutiveDetail();
  $("commentPanel").hidden = false;
  $("toggleComments").classList.add("open");
  try {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("El comentario padre aun no existe en la nube.");
    const created = await createRemoteComment(selectedDebtor, text, id);
    const currentComment = (store.comments[selectedDebtor.id] || []).find((item) => item.id === id);
    if (currentComment) {
      const index = currentComment.replies.findIndex((reply) => reply.id === tempId);
      if (index >= 0) currentComment.replies[index] = { id: created.id, text: created.text, user: created.user, createdAt: created.createdAt, remote: true };
    }
    setRemoteWarning(selectedDebtor, "");
    renderExecutiveRows();
    renderExecutiveDetail();
    $("commentPanel").hidden = false;
    $("toggleComments").classList.add("open");
  } catch (error) {
    restoreOperationalDebtor(selectedDebtor, snapshot);
    setRemoteWarning(selectedDebtor, error.message || "No se pudo guardar la respuesta oficial.");
    renderExecutiveRows();
    renderExecutiveDetail();
    $("commentPanel").hidden = false;
    $("toggleComments").classList.add("open");
  }
}

function renderHistoryCards(debtor) {
  const entries = store.entries.filter((entry) => entry.debtorId === debtor.id);
  if (!entries.length) return `<div class="history-card empty">Sin gestiones registradas.</div>`;
  return entries.map((entry) => `
    <article class="history-card">
      <strong>${entry.date}</strong>
      <span>${entry.channel} · ${entry.result}</span>
      <p>${entry.comment}</p>
    </article>
  `).join("");
}

function renderContacts(debtor, type, values) {
  if (!values.length) return `<div class="detail-empty">Sin ${type === "telefono" ? "teléfonos" : "correos"} registrados.</div>`;
  const seen = new Set();
  const uniqueValues = values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalizedContactValue(type, value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return uniqueValues.map((value) => {
    const saved = contactRecord(debtor, type, value);
    const cls = saved.status === "ok" ? "ok" : saved.status === "ignore" ? "ignore" : saved.status === "manual" ? "manual" : "";
    const message = buildContactMessage(debtor, type, value);
    return `
      <article class="contact-item ${cls}">
        <button type="button" class="contact-copy" data-copy-message="${escapeAttr(message)}" data-type="${type}" data-value="${escapeAttr(value)}" title="Abrir mensaje">${escapeHtml(value)}</button>
        <span class="contact-status">${contactStatusLabel(saved.status)}${saved.date ? ` - ${new Date(saved.date).toLocaleDateString("es-CL")}` : ""}</span>
        <div class="contact-meta">
          <label>Categoria
            <select data-contact-category data-type="${type}" data-value="${escapeAttr(value)}">
              ${contactCategoryOptions(saved.category)}
            </select>
          </label>
          <label>Comentario
            <input data-contact-comment data-type="${type}" data-value="${escapeAttr(value)}" value="${escapeAttr(saved.comment || "")}" placeholder="Comentario">
          </label>
        </div>
        <div class="contact-actions">
          <button type="button" data-contact-action="ok" data-type="${type}" data-value="${escapeAttr(value)}">Funciona</button>
          <button type="button" data-contact-action="ignore" data-type="${type}" data-value="${escapeAttr(value)}">No considerar</button>
          <button type="button" data-contact-save data-type="${type}" data-value="${escapeAttr(value)}">Guardar</button>
          <button type="button" data-contact-delete data-type="${type}" data-value="${escapeAttr(value)}" class="danger-soft">Borrar marca</button>
        </div>
      </article>
    `;
  }).join("");
}

function contactStatusLabel(status) {
  if (status === "ok") return "Funciona";
  if (status === "ignore") return "No considerar";
  if (status === "manual") return "Comentario editado";
  return "Sin marcar";
}

function contactCategoryOptions(selected = "") {
  const categories = ["", "Titular", "Alumno", "Apoderado", "Tercero", "Equivocado", "No contesta", "Rebota", "Otro"];
  return categories.map((category) => `<option value="${escapeAttr(category)}" ${category === selected ? "selected" : ""}>${category || "Sin categoria"}</option>`).join("");
}

function debtDetailText(debtor) {
  const rows = [
    ["Saldo capital", fmtMoney.format(debtor.saldoCapital)],
    ["Intereses por mora", fmtMoney.format(debtor.interes)],
    ["Gastos de cobranza", fmtMoney.format(debtor.gastoCobranza)],
    ["Total a pagar", fmtMoney.format(debtor.deudaTotal)],
  ];
  const conceptWidth = Math.max("Concepto".length, ...rows.map(([label]) => label.length)) + 2;
  const amountWidth = Math.max("Monto".length, ...rows.map(([, amount]) => amount.length)) + 2;
  const line = `+${"-".repeat(conceptWidth)}+${"-".repeat(amountWidth)}+`;
  const formatRow = (left, right) => `| ${left.padEnd(conceptWidth - 2)} | ${right.padStart(amountWidth - 2)} |`;
  return [
    line,
    formatRow("Concepto", "Monto"),
    line,
    ...rows.map(([label, amount]) => formatRow(label, amount)),
    line,
  ].join("\n");
}

function buildEmailBody(debtor, value) {
  const offerAmount = getOfferAmount(debtor);
  const offerText = offerAmount ? `Convenio vigente: ${fmtMoney.format(offerAmount)}.` : "No registra convenio vigente.";
  return [
    `Estimado/a ${debtor.nombreTitular || ""},`,
    "",
    `Le contactamos por deuda AIEP asociada al alumno ${debtor.nombreAlumno || ""}, RUT ${debtor.rutAlumno || ""}.`,
    "",
    "Detalle de deuda:",
    debtDetailText(debtor),
    "",
    offerText,
    "",
    "Datos de transferencia:",
    TRANSFER_DETAILS.join("\n"),
    "",
    `Contacto utilizado: ${value}`,
  ].join("\n");
}

function buildEmailHtmlBody(debtor, value) {
  const offerAmount = getOfferAmount(debtor);
  const offerText = offerAmount ? `Convenio vigente: ${fmtMoney.format(offerAmount)}.` : "No registra convenio vigente.";
  const rows = [
    ["Saldo capital", fmtMoney.format(debtor.saldoCapital)],
    ["Intereses por mora", fmtMoney.format(debtor.interes)],
    ["Gastos de cobranza", fmtMoney.format(debtor.gastoCobranza)],
    ["Total a pagar", fmtMoney.format(debtor.deudaTotal)],
  ];
  return `
    <div style="font-family:Arial, sans-serif; font-size:11pt; color:#222;">
      <p>Estimado(a) ${escapeHtml(debtor.nombreTitular || "")},</p>
      <p>Le contactamos por deuda AIEP asociada al alumno ${escapeHtml(debtor.nombreAlumno || "")}, RUT ${escapeHtml(debtor.rutAlumno || "")}.</p>
      <p><b>Detalle de deuda:</b></p>
      <table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse; width:100%; font-family:Arial, sans-serif; font-size:10pt;">
        <tr style="background-color:#BFBFBF; font-weight:bold; text-align:center;">
          <th>Concepto</th>
          <th>Monto</th>
        </tr>
        ${rows.map(([label, amount], index) => `
          <tr style="${index === rows.length - 1 ? "font-weight:bold; background-color:#E7E6E6;" : ""}">
            <td>${escapeHtml(label)}</td>
            <td style="text-align:right;">${escapeHtml(amount)}</td>
          </tr>
        `).join("")}
      </table>
      <p>${escapeHtml(offerText)}</p>
      <p><b>Datos de transferencia:</b><br>${TRANSFER_DETAILS.map(escapeHtml).join("<br>")}</p>
      <p><small>Contacto utilizado: ${escapeHtml(value)}</small></p>
    </div>
  `;
}

function buildWhatsappMessage(debtor) {
  const studentName = formatStudentName(debtor.nombreAlumno);
  const studentRut = debtor.rutAlumno || "Sin RUT informado";
  return [
    `Estimado/a ${debtor.nombreTitular || ""},`,
    `Estudiante: ${studentName}, RUT ${studentRut}.`,
    `registra deuda AIEP con saldo total pendiente de *${fmtMoney.format(debtor.deudaTotal)}*.`,
    "Su deuda esta acumulando intereses y gastos de cobranza. Por favor responder para cerrar su caso.",
  ].join("\n");
}

function formatStudentName(name) {
  const clean = String(name || "Sin estudiante informado").replace(/\s+/g, " ").trim();
  const parts = clean.split(" ").filter(Boolean);
  if (parts.length < 4) return clean;
  const firstNames = new Set([
    "AARON", "ADRIANA", "ALEJANDRA", "ALEJANDRO", "ALFREDO", "ALICIA", "ANDREA", "ANDRES", "ANGEL", "ANTONIA", "ANTONIO",
    "ARIEL", "BARBARA", "BASTIAN", "BENJAMIN", "CAMILA", "CARLA", "CARLOS", "CAROL", "CAROLA", "CAROLINA", "CATALINA",
    "CECILIA", "CLAUDIA", "CRISTIAN", "CRISTINA", "DANIEL", "DANIELA", "DIEGO", "EDUARDO", "ELIZABETH", "ESTEBAN",
    "FABIOLA", "FELIPE", "FERNANDA", "FERNANDO", "FRANCISCA", "FRANCISCO", "GABRIEL", "GABRIELA", "GLORIA", "IGNACIO",
    "ISABEL", "JAVIER", "JAVIERA", "JOAQUIN", "JORGE", "JOSE", "JUAN", "KARLA", "KAROL", "LORETO", "LUIS", "MARCELO",
    "MARCELA", "MARCO", "MARIA", "MARIO", "MARTIN", "MATIAS", "MAURICIO", "MIGUEL", "NATALIA", "NICOLAS", "PABLO",
    "PATRICIO", "PAULA", "PEDRO", "RAFAEL", "RICARDO", "ROBERTO", "RODRIGO", "ROMINA", "ROSA", "SEBASTIAN", "SOFIA",
    "VALENTINA", "VICTOR", "VICTORIA",
  ]);
  const firstLooksLikeName = firstNames.has(parts[0].toUpperCase());
  const laterLooksLikeName = firstNames.has(parts[2].toUpperCase()) || firstNames.has(parts[3].toUpperCase());
  if (!firstLooksLikeName && laterLooksLikeName) {
    return [...parts.slice(2), ...parts.slice(0, 2)].join(" ");
  }
  return clean;
}

function buildContactMessage(debtor, type, value) {
  return type === "correo" ? buildEmailBody(debtor, value) : buildWhatsappMessage(debtor);
}

function phoneForWhatsApp(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("569") && digits.length === 11) return digits;
  if (digits.startsWith("56") && digits.length >= 11 && digits.length <= 12) return digits;
  if (digits.length === 9 && digits.startsWith("9")) return `56${digits}`;
  if (digits.length === 8) return `569${digits}`;
  return digits;
}

function isValidWhatsAppPhone(value) {
  const phone = phoneForWhatsApp(value);
  return /^56\d{9,10}$/.test(phone);
}

function copyContactMessage(event) {
  const message = event.currentTarget.dataset.copyMessage;
  const type = event.currentTarget.dataset.type;
  const value = event.currentTarget.dataset.value;
  if (type === "telefono") {
    openWhatsAppClient(value, message);
    $("copyStatus").textContent = whatsappLocalModeEnabled() ? "WhatsApp local activado para envio automatico." : "WhatsApp Web abierto con mensaje preparado.";
    return;
  }
  openMailClient(value, message, buildEmailHtmlBody(selectedDebtor, value));
  $("copyStatus").textContent = "Correo abierto con mensaje preparado.";
}

function outlookClassicModeEnabled() {
  return localStorage.getItem("abg_outlook_classic_mode") === "1";
}

function outlookAutoSendEnabled() {
  return localStorage.getItem("abg_outlook_auto_send_mode") === "1";
}

function whatsappLocalModeEnabled() {
  return localStorage.getItem("abg_whatsapp_local_mode") === "1";
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function openOutlookProtocol(payload) {
  window.location.href = `abg-outlook://compose?payload=${base64UrlEncode(JSON.stringify(payload))}`;
}

function selectOutlookAccount() {
  openOutlookProtocol({ action: "select-account" });
  setText("campaignStatus", "Seleccione la cuenta de envio en Outlook Classic.");
}

function whatsappTextToEmailHtml(text) {
  const withBold = escapeHtml(text).replace(/\*(.+?)\*/g, "<strong>$1</strong>");
  return `<div style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.45;">${withBold.replace(/\n/g, "<br>")}</div>`;
}

function buildWhatsappEmailHtml(debtor) {
  return whatsappTextToEmailHtml(buildWhatsappMessage(debtor));
}

function openMailClient(email, body, htmlBody = "", options = {}) {
  const autoSend = options.autoSend === true;
  if (outlookClassicModeEnabled() || autoSend) {
    const payload = {
      action: autoSend ? "send" : "compose",
      to: email,
      subject: "Regularizacion deuda AIEP",
      bodyText: body,
      htmlBody: htmlBody || `<pre>${escapeHtml(body)}</pre>`,
    };
    openOutlookProtocol(payload);
    return true;
  }
  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Regularizacion deuda AIEP")}&body=${encodeURIComponent(body)}`;
  return true;
}

function openWhatsAppClient(phone, message) {
  const normalizedPhone = phoneForWhatsApp(phone);
  if (!isValidWhatsAppPhone(phone)) {
    if ($("copyStatus")) $("copyStatus").textContent = "Telefono no valido para WhatsApp.";
    return false;
  }
  if (whatsappLocalModeEnabled()) {
    const payload = {
      phone: normalizedPhone,
      message,
    };
    window.location.href = `abg-whatsapp://send?payload=${base64UrlEncode(JSON.stringify(payload))}`;
    return true;
  }
  return openWhatsAppWeb(phone, message);
}

function openWhatsAppWeb(phone, message) {
  const normalizedPhone = phoneForWhatsApp(phone);
  if (!isValidWhatsAppPhone(phone)) return false;
  const url = `https://web.whatsapp.com/send?phone=${normalizedPhone}&text=${encodeURIComponent(message)}`;
  if (whatsappWindow && !whatsappWindow.closed) {
    try {
      whatsappWindow.close();
      if (!whatsappWindow.closed) {
        whatsappWindow.location.href = url;
        whatsappWindow.focus();
        return true;
      }
    } catch {}
  }
  whatsappWindow = window.open(url, "abg_whatsapp_activo");
  return Boolean(whatsappWindow);
}

async function updateContactStatus(event) {
  const btn = event.currentTarget;
  const wrapper = btn.closest(".contact-item");
  const comment = wrapper.querySelector("[data-contact-comment]")?.value.trim() || "";
  const category = wrapper.querySelector("[data-contact-category]")?.value || "";
  const key = contactKey(selectedDebtor, btn.dataset.type, btn.dataset.value);
  const current = contactRecord(selectedDebtor, btn.dataset.type, btn.dataset.value);
  const snapshot = snapshotOperationalDebtor(selectedDebtor);
  const nextRecord = {
    ...current,
    status: btn.dataset.contactAction,
    category,
    comment,
    date: new Date().toISOString(),
  };
  store.contacts[key] = nextRecord;
  renderExecutiveDetail();
  try {
    store.contacts[key] = await saveRemoteContact(selectedDebtor, btn.dataset.type, btn.dataset.value, nextRecord);
    setRemoteWarning(selectedDebtor, "");
    remoteLoadedDebtors.add(selectedDebtor.id);
    renderExecutiveDetail();
  } catch (error) {
    restoreOperationalDebtor(selectedDebtor, snapshot);
    setRemoteWarning(selectedDebtor, error.message || "No se pudo guardar el contacto oficial.");
    renderExecutiveDetail();
  }
}

async function saveContactMeta(event) {
  const btn = event.currentTarget;
  const wrapper = btn.closest(".contact-item");
  const comment = wrapper.querySelector("[data-contact-comment]")?.value.trim() || "";
  const category = wrapper.querySelector("[data-contact-category]")?.value || "";
  const key = contactKey(selectedDebtor, btn.dataset.type, btn.dataset.value);
  const current = contactRecord(selectedDebtor, btn.dataset.type, btn.dataset.value);
  const snapshot = snapshotOperationalDebtor(selectedDebtor);
  const nextRecord = {
    ...current,
    status: current.status || "manual",
    category,
    comment,
    date: new Date().toISOString(),
  };
  store.contacts[key] = nextRecord;
  renderExecutiveDetail();
  try {
    store.contacts[key] = await saveRemoteContact(selectedDebtor, btn.dataset.type, btn.dataset.value, nextRecord);
    setRemoteWarning(selectedDebtor, "");
    remoteLoadedDebtors.add(selectedDebtor.id);
    renderExecutiveDetail();
  } catch (error) {
    restoreOperationalDebtor(selectedDebtor, snapshot);
    setRemoteWarning(selectedDebtor, error.message || "No se pudo guardar la metadata oficial del contacto.");
    renderExecutiveDetail();
  }
}

async function deleteContactMeta(event) {
  const btn = event.currentTarget;
  const type = btn.dataset.type;
  const value = btn.dataset.value;
  const key = contactKey(selectedDebtor, type, value);
  const legacyKey = legacyContactKey(selectedDebtor, type, value);
  const current = contactRecord(selectedDebtor, type, value);
  const snapshot = snapshotOperationalDebtor(selectedDebtor);
  delete store.contacts[key];
  delete store.contacts[legacyKey];
  renderExecutiveDetail();
  try {
    if (current.id) {
      const cleanRecord = { ...current, status: "", category: "", comment: "" };
      store.contacts[key] = await saveRemoteContact(selectedDebtor, type, value, cleanRecord);
    }
    setRemoteWarning(selectedDebtor, "");
    renderExecutiveDetail();
  } catch (error) {
    restoreOperationalDebtor(selectedDebtor, snapshot);
    setRemoteWarning(selectedDebtor, error.message || "No se pudo borrar la marca oficial del contacto.");
    renderExecutiveDetail();
  }
}

function usableContacts(debtor, type) {
  const values = type === "correo" ? debtor.correos : debtor.telefonos;
  const seen = new Set();
  const contacts = [];
  values.forEach((rawValue) => {
    const value = String(rawValue || "").trim();
    if (!value) return;
    if (type === "telefono" && !isValidWhatsAppPhone(value)) return;
    if (isIgnoredContact(debtor, type, value)) return;
    const normalized = normalizedContactValue(type, value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    contacts.push(type === "telefono" ? phoneForWhatsApp(value) : value.toLowerCase());
  });
  return contacts;
}

function hasManagementToday(debtor) {
  return entriesForDebtor(debtor).some((entry) => dateOnly(entry.date) === today());
}

function dateDaysAgo(days) {
  const date = new Date(`${today()}T00:00:00`);
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function hasManagementOnDate(debtor, date) {
  return entriesForDebtor(debtor).some((entry) => dateOnly(entry.date) === date);
}

function campaignSkipDates() {
  return [
    $("campaignSkipYesterday")?.checked ? dateDaysAgo(1) : "",
    $("campaignSkipTwoDays")?.checked ? dateDaysAgo(2) : "",
    $("campaignSkipThreeDays")?.checked ? dateDaysAgo(3) : "",
  ].filter(Boolean);
}

function hasCampaignSkipDateManagement(debtor) {
  const dates = campaignSkipDates();
  return dates.length > 0 && dates.some((date) => hasManagementOnDate(debtor, date));
}

function campaignBlockReason(debtor) {
  if (getOffer(debtor)) return "convenio activo";
  if (hasManagementToday(debtor)) return "gestion hoy";
  if (hasCampaignSkipDateManagement(debtor)) return "gestion reciente";
  return "";
}

function campaignSkippedText() {
  const parts = [];
  if (campaignSkippedByRules) parts.push(`omitidos por convenio/gestiones recientes: ${campaignSkippedByRules}`);
  if (campaignSkippedDuplicateContacts) parts.push(`telefonos/correos repetidos omitidos: ${campaignSkippedDuplicateContacts}`);
  return parts.length ? ` ${parts.join(". ")}.` : "";
}

function campaignTargets(type) {
  const min = parseMoney($("campaignDebtMin").value);
  const max = parseMoney($("campaignDebtMax").value);
  const limit = Math.max(1, Number($("campaignLimit").value || 1));
  const source = sortedExecutiveDebtors();
  const validDebtors = source
    .filter((debtor) => !isCampaignExcluded(debtor))
    .filter((debtor) => debtor.deudaTotal >= min)
    .filter((debtor) => !max || debtor.deudaTotal <= max)
    .filter((debtor) => usableContacts(debtor, type).length);
  campaignSkippedToday = validDebtors.filter(hasManagementToday).length;
  campaignSkippedByRules = validDebtors.filter((debtor) => campaignBlockReason(debtor)).length;
  const targets = [];
  const campaignSeenContacts = new Set();
  validDebtors
    .filter((debtor) => !campaignBlockReason(debtor))
    .some((debtor) => {
      const contacts = usableContacts(debtor, type);
      for (const value of contacts) {
        const key = normalizedContactValue(type, value);
        if (campaignSeenContacts.has(key)) {
          campaignSkippedDuplicateContacts += 1;
          continue;
        }
        campaignSeenContacts.add(key);
        targets.push({ debtor, value });
        if (targets.length >= limit) return true;
      }
      return false;
    });
  return targets;
}

function startCampaign(type) {
  stopCampaign(false);
  campaignChannel = type;
  campaignSkippedDuplicateContacts = 0;
  campaignQueue = campaignTargets(type);
  campaignTotal = campaignQueue.length;
  if (!campaignQueue.length) {
    setText("campaignStatus", `Sin contactos para el filtro seleccionado.${campaignSkippedText()}`);
    return;
  }
  setText("campaignStatus", `${campaignQueue.length} mensajes en cola. Siguiente: ${campaignTargetLabel(campaignQueue[0])}`);
  deliverCampaignItem();
}

function campaignTargetLabel(item) {
  if (!item) return "sin siguiente contacto";
  const kind = campaignChannel === "correo" ? "correo" : "telefono";
  return `${item.debtor.nombreTitular || item.debtor.rutTitular || "Sin nombre"} - ${kind} ${item.value}`;
}

function deliverCampaignItem() {
  if (!campaignQueue.length) {
    setText("campaignStatus", `Campana finalizada.${campaignSkippedText()}`);
    campaignChannel = "";
    return;
  }
  const item = campaignQueue.shift();
  setText("campaignStatus", `Enviando/preparando: ${campaignTargetLabel(item)}`);
  let launched = false;
  if (campaignChannel === "correo") {
    const message = buildWhatsappMessage(item.debtor);
    launched = openMailClient(item.value, message, buildWhatsappEmailHtml(item.debtor), { autoSend: outlookAutoSendEnabled() });
  } else {
    launched = openWhatsAppClient(item.value, buildWhatsappMessage(item.debtor));
  }
  if (launched) {
    recordCampaignManagement(item.debtor, campaignChannel, item.value);
  }
  const sent = campaignTotal - campaignQueue.length;
  const next = campaignQueue.length ? ` Siguiente: ${campaignTargetLabel(campaignQueue[0])}.` : "";
  setText("campaignStatus", `${sent} enviados/preparados y registrados. Quedan ${campaignQueue.length}.${next}${campaignSkippedText()}`);
  const requestedSeconds = Math.max(5, Number($("campaignInterval").value || 20));
  const intervalSeconds = campaignChannel === "telefono" && whatsappLocalModeEnabled()
    ? Math.max(35, requestedSeconds)
    : requestedSeconds;
  const intervalMs = intervalSeconds * 1000;
  if (campaignQueue.length) campaignTimer = window.setTimeout(deliverCampaignItem, intervalMs);
}

async function recordCampaignManagement(debtor, type, value) {
  const channel = type === "correo" ? "Correo" : "WhatsApp";
  const target = type === "correo" ? `correo ${value}` : `telefono ${value}`;
  const entry = {
    id: `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    debtorId: debtor.id,
    debtorName: debtor.nombreTitular,
    date: today(),
    channel,
    result: "Envio automatico masivo",
    comment: `Envio automatico masivo por ${channel} al ${target}.`,
    user: session?.username || "callcenter",
    createdAt: new Date().toISOString(),
    pendingRemote: true,
  };
  store.entries.unshift(entry);
  renderExecutiveRows();
  try {
    const saved = await createRemoteManagementEntry(debtor, entry);
    const index = store.entries.findIndex((item) => item.id === entry.id);
    if (index >= 0) store.entries[index] = saved;
    setRemoteWarning(debtor, "");
    remoteLoadedDebtors.add(debtor.id);
    renderExecutiveRows();
  } catch (error) {
    store.entries = store.entries.filter((item) => item.id !== entry.id);
    setRemoteWarning(debtor, error.message || "No se pudo registrar la gestion automatica oficial.");
    if (selectedDebtor?.id === debtor.id) renderExecutiveDetail();
    renderExecutiveRows();
  }
}

function stopCampaign(updateStatus = true) {
  if (campaignTimer) window.clearTimeout(campaignTimer);
  campaignTimer = null;
  campaignQueue = [];
  campaignChannel = "";
  campaignTotal = 0;
  campaignSkippedToday = 0;
  campaignSkippedByRules = 0;
  campaignSkippedDuplicateContacts = 0;
  if (updateStatus) setText("campaignStatus", "Campana detenida");
}

function saveOffer(event) {
  event.preventDefault();
  const amount = parseMoney($("offerAmount").value);
  if (!amount) {
    delete store.offers[selectedDebtor.id];
  } else {
    store.offers[selectedDebtor.id] = {
      amount,
      debtorId: selectedDebtor.id,
      debtorName: selectedDebtor.nombreTitular,
      user: "callcenter",
      date: today(),
      createdAt: new Date().toISOString(),
    };
  }
  writeJson("abg_offers", store.offers);
  renderExecutiveRows();
  renderExecutiveDetail();
}

function openAgreementModal() {
  const agreement = getOffer(selectedDebtor);
  $("agreementModal").hidden = false;
  $("agreementType").value = agreement?.type || "liquidacion";
  $("agreementAmount").value = agreement?.amount ? fmtMoney.format(agreement.amount) : "";
  $("agreementDownPayment").value = agreement?.downPayment ? fmtMoney.format(agreement.downPayment) : "";
  $("agreementInstallments").value = agreement?.installments || 1;
  $("agreementStartDate").value = agreement?.startDate || today();
  $("agreementPayerRut").value = agreement?.payerRut || "";
  $("agreementNotes").value = agreement?.notes || "";
  renderAgreementCalendar();
}

function closeAgreementModal() {
  $("agreementModal").hidden = true;
}

function renderAgreementCalendar() {
  const type = $("agreementType").value;
  const installments = Math.max(1, Number($("agreementInstallments").value || 1));
  const start = $("agreementStartDate").value || today();
  const amount = parseMoney($("agreementAmount").value);
  const downPayment = parseMoney($("agreementDownPayment").value);
  $("installmentsLabel").style.display = type === "cuotas" ? "grid" : "none";
  $("downPaymentLabel").style.display = type === "cuotas" ? "grid" : "none";
  const payments = buildPaymentSchedule(type, start, installments, amount, downPayment);
  $("agreementCalendar").innerHTML = payments.length
    ? `<div class="agreement-calendar">${payments.map((payment) => `<span><i></i>${payment.date} - ${payment.label}${payment.amount ? ` ${fmtMoney.format(payment.amount)}` : ""}</span>`).join("")}</div>`
    : "";
}

function buildPaymentSchedule(type, start, installments, amount = 0, downPayment = 0) {
  if (!start) return [];
  if (type !== "cuotas") return [{ date: start, label: "Pago total", amount }];
  const payments = [];
  const base = new Date(start + "T00:00:00");
  const safeDownPayment = Math.min(Math.max(0, downPayment), Math.max(0, amount));
  const installmentAmount = Math.round(Math.max(0, amount - safeDownPayment) / Math.max(1, installments));
  if (safeDownPayment > 0) {
    payments.push({ date: start, label: "Pie", amount: safeDownPayment });
  }
  for (let i = 0; i < installments; i += 1) {
    const next = new Date(base);
    next.setMonth(base.getMonth() + i + (safeDownPayment > 0 ? 1 : 0));
    payments.push({ date: next.toISOString().slice(0, 10), label: `Cuota ${i + 1}`, amount: installmentAmount });
  }
  return payments;
}

function buildPaymentDates(type, start, installments, amount = 0, downPayment = 0) {
  return buildPaymentSchedule(type, start, installments, amount, downPayment).map((payment) => payment.date);
}

function saveAgreement(event) {
  event.preventDefault();
  const amount = parseMoney($("agreementAmount").value);
  if (!amount) return;
  const type = $("agreementType").value;
  const downPayment = type === "cuotas" ? Math.min(parseMoney($("agreementDownPayment").value), amount) : 0;
  const installments = type === "cuotas" ? Math.max(1, Number($("agreementInstallments").value || 1)) : 1;
  const startDate = $("agreementStartDate").value || today();
  const payments = buildPaymentSchedule(type, startDate, installments, amount, downPayment);
  store.agreements[selectedDebtor.id] = {
    amount,
    type,
    downPayment,
    installments,
    startDate,
    paymentDates: payments.map((payment) => payment.date),
    payments,
    payerRut: $("agreementPayerRut").value.trim(),
    notes: $("agreementNotes").value,
    debtorId: selectedDebtor.id,
    debtorName: selectedDebtor.nombreTitular,
    user: "callcenter",
    date: today(),
    createdAt: new Date().toISOString(),
  };
  writeJson("abg_agreements", store.agreements);
  closeAgreementModal();
  renderExecutiveRows();
  renderExecutiveDetail();
}

function deleteAgreement() {
  if (!confirm("¿Eliminar el convenio de este cliente?")) return;
  delete store.agreements[selectedDebtor.id];
  delete store.offers[selectedDebtor.id];
  writeJson("abg_agreements", store.agreements);
  writeJson("abg_offers", store.offers);
  renderExecutiveRows();
  renderExecutiveDetail();
}

async function saveManagementEntry(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fd = new FormData(form);
  const snapshot = snapshotOperationalDebtor(selectedDebtor);
  const entry = {
    id: `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    debtorId: selectedDebtor.id,
    debtorName: selectedDebtor.nombreTitular,
    date: fd.get("date"),
    channel: fd.get("channel"),
    result: fd.get("result"),
    comment: fd.get("comment") || "Sin comentario",
    user: session.username,
    createdAt: new Date().toISOString(),
    pendingRemote: true,
  };
  store.entries.unshift(entry);
  renderExecutiveRows();
  renderExecutiveDetail();

  try {
    const saved = await createRemoteManagementEntry(selectedDebtor, entry);
    const index = store.entries.findIndex((item) => item.id === entry.id);
    if (index >= 0) store.entries[index] = saved;
    setRemoteWarning(selectedDebtor, "");
    remoteLoadedDebtors.add(selectedDebtor.id);

    const file = fd.get("receipt");
    if (file && file.size) {
      await saveFileRecord(file, { debtorId: selectedDebtor.id, debtorName: selectedDebtor.nombreTitular, source: "ejecutivo", category: "comprobante", entryId: saved.id });
    }
    form.reset();
    renderExecutiveRows();
    renderExecutiveDetail();
  } catch (error) {
    restoreOperationalDebtor(selectedDebtor, snapshot);
    setRemoteWarning(selectedDebtor, error.message || "No se pudo guardar la gestion oficial.");
    renderExecutiveRows();
    renderExecutiveDetail();
  }
}

function renderHistory(debtor) {
  const entries = store.entries.filter((entry) => entry.debtorId === debtor.id);
  const files = currentDebtorFiles().filter((file) => file.category === "comprobante");
  if (!entries.length && !files.length) return `<div class="detail-empty">Sin gestiones locales registradas.</div>`;
  return [
    ...entries.map((entry) => `<div class="history-item"><strong>${entry.date} · ${entry.channel} · ${entry.result}</strong><br>${entry.comment}</div>`),
    ...files.map((file) => `<div class="history-item file"><strong>Comprobante adjunto</strong><br>${file.name} · ${new Date(file.createdAt).toLocaleString("es-CL")}</div>`),
  ].join("");
}

function renderDebtorPortal() {
  const d = selectedDebtor;
  const offer = getOffer(d);
  setText("debtorPortalName", d.nombreTitular || "Consulta de deuda");
  $("debtorPortalDebt").innerHTML = `
    <div class="debt-hero">
      <span>Deuda total pendiente</span>
      <strong>${fmtMoney.format(d.deudaTotal)}</strong>
      <small>Estado: ${d.estado || "Pendiente"}</small>
    </div>
    ${offer ? `<div class="debtor-agreement-hero">
      <span>Convenio vigente · ${agreementTypeLabel(offer)}</span>
      <strong>${fmtMoney.format(offer.amount)}</strong>
      <small>Deuda original referencial: <del>${fmtMoney.format(d.deudaTotal)}</del></small>
    </div>` : ""}
    <div class="debtor-identification">
      ${detailItem("Titular", d.nombreTitular)}
      ${detailItem("RUT titular", d.rutTitular || d.rutDeudor)}
      ${detailItem("Alumno", d.nombreAlumno)}
      ${detailItem("RUT alumno", d.rutAlumno)}
    </div>
    <div class="legal-grid">
      ${detailItem("Direccion", d.direccion)}
      ${detailItem("Comuna / region", [d.comuna, d.region].filter(Boolean).join(" / "))}
      ${detailItem("Rol judicial", d.rol)}
      ${detailItem("Tribunal", d.tribunal)}
      ${detailItem("Procedimiento", legalProcedure(d))}
    </div>
    <div class="excel-card">
      <table class="mini-table debt-table">
        <thead><tr><th>Concepto</th><th>Monto</th></tr></thead>
        <tbody>
          <tr><td>Deuda capital</td><td>${fmtMoney.format(d.saldoCapital)}</td></tr>
          <tr><td>Intereses por mora</td><td>${fmtMoney.format(d.interes)}</td></tr>
          <tr><td>Gastos de cobranza</td><td>${fmtMoney.format(d.gastoCobranza)}</td></tr>
          <tr class="total-row"><td>Total a pagar</td><td>${fmtMoney.format(d.deudaTotal)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="judicial-alert wide">
      <strong>Mensaje de cobranza judicial</strong>
      <p>${buildJudicialMessage(d)}</p>
    </div>
    ${offer ? `<div class="offer-block wide"><span>Detalle convenio</span><small>Inicio: ${offer.startDate || offer.date}. Saldo convenio: ${fmtMoney.format(agreementRemainingAmount(d, offer))}. Adjunte comprobante luego de transferir.</small>${offer.type === "cuotas" ? `<small>Pie: ${fmtMoney.format(offer.downPayment || 0)}. Cuota estimada: ${fmtMoney.format(agreementInstallmentAmount(offer))}.</small><div class="calendar-dots">${agreementPaymentSchedule(offer).map((payment) => `<span class="calendar-dot" title="${payment.label} ${payment.date}">${new Date(payment.date + "T00:00:00").getDate()}</span>`).join("")}</div>` : ""}</div>` : ""}
  `;
  $("debtorPaymentBox").hidden = false;
  $("debtorPaymentBox").innerHTML = `
    <h3>Datos de transferencia</h3>
    <p>Banco BCI<br>Comercial Remesa SpA<br>RUT 76.976.117-9<br>Cuenta Corriente 27826341</p>
    <p class="muted">${offer ? "Convenio activo. Adjunte comprobante después de transferir." : "Si realiza un pago, adjunte el comprobante para validación."}</p>
  `;
  renderDebtorUploads();
}

function buildJudicialMessage(debtor) {
  const court = debtor.tribunal ? ` ante ${debtor.tribunal}` : " ante el juzgado competente";
  const role = debtor.rol ? `, rol ${debtor.rol}` : "";
  return `Su deuda AIEP registra saldo pendiente y puede continuar en etapa de cobranza judicial${court}${role}. Para evitar mayores gestiones, regularice su situación o envíe comprobante de pago para validación.`;
}

function renderDebtorUploads() {
  const files = currentDebtorFiles().filter((file) => file.category === "comprobante");
  $("debtorUploadStatus").innerHTML = files.length
    ? files.map((file) => `<div class="history-item file"><strong>${file.name}</strong><br>Guardado ${new Date(file.createdAt).toLocaleString("es-CL")} · pendiente de validación</div>`).join("")
    : `<div class="detail-empty">Aún no hay comprobantes adjuntos.</div>`;
}

async function saveDebtorReceipt(event) {
  event.preventDefault();
  const file = $("debtorReceiptFile").files[0];
  if (!file) return;
  await saveFileRecord(file, { debtorId: selectedDebtor.id, debtorName: selectedDebtor.nombreTitular, source: "deudor", category: "comprobante" });
  $("debtorUploadForm").reset();
  renderDebtorUploads();
}

function assignmentGroups(debtors = data.debtors) {
  return Object.entries(debtors.reduce((acc, debtor) => {
    const key = assignmentName(debtor);
    if (!acc[key]) acc[key] = { count: 0, saldoCapital: 0, deudaTotal: 0, withContact: 0 };
    acc[key].count += 1;
    acc[key].saldoCapital += Number(debtor.saldoCapital || 0);
    acc[key].deudaTotal += Number(debtor.deudaTotal || 0);
    if ((debtor.telefonos || []).length || (debtor.correos || []).length) acc[key].withContact += 1;
    return acc;
  }, {})).sort((a, b) => b[1].deudaTotal - a[1].deudaTotal);
}

function assignmentRemesaMatrix(debtors = data.debtors) {
  const remesas = [...new Set(debtors.map((debtor) => debtor.cartera).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), "es", { numeric: true }));
  const rows = new Map();
  for (const debtor of debtors) {
    const assignment = assignmentName(debtor);
    if (!rows.has(assignment)) rows.set(assignment, { total: 0, remesas: {} });
    const row = rows.get(assignment);
    row.total += 1;
    if (debtor.cartera) row.remesas[debtor.cartera] = (row.remesas[debtor.cartera] || 0) + 1;
  }
  return {
    remesas,
    rows: [...rows.entries()].sort((a, b) => b[1].total - a[1].total),
  };
}

function renderInformaticoAssignmentMatrix() {
  const matrix = assignmentRemesaMatrix();
  $("itAssignmentMatrixHead").innerHTML = `<tr><th>Asignado</th>${matrix.remesas.map((name) => `<th>${escapeHtml(name)}</th>`).join("")}<th>Total</th></tr>`;
  $("itAssignmentMatrixRows").innerHTML = matrix.rows.length ? matrix.rows.map(([name, row]) => `
    <tr>
      <td><strong>${escapeHtml(name)}</strong></td>
      ${matrix.remesas.map((remesa) => `<td>${row.remesas[remesa] ? fmtNum.format(row.remesas[remesa]) : ""}</td>`).join("")}
      <td><strong>${fmtNum.format(row.total)}</strong></td>
    </tr>
  `).join("") : `<tr><td colspan="${matrix.remesas.length + 2}">Sin asignaciones cargadas desde cartera.</td></tr>`;
}

function healthFallbackChecks() {
  return [
    { name: "Google Drive", status: "loading", detail: "Verificando carpeta AIEP y permisos de cuenta de servicio." },
    { name: "Google Sheets", status: "loading", detail: "Verificando AIEP_BASE_TOTAL / Asignados." },
    { name: "Supabase", status: "loading", detail: "Verificando API REST y tabla debtors." },
    { name: "Vercel", status: "loading", detail: "Verificando funcion serverless publicada." },
    { name: "GitHub", status: "loading", detail: "Verificando repositorio Aleinternet/AIEP." },
  ];
}

function healthStatusText(status) {
  if (status === "ok") return "Funcionando";
  if (status === "warn") return "Revision";
  if (status === "bad") return "Falla";
  return "Cargando";
}

function renderHealthChecklist() {
  const root = $("itChecklist");
  if (!root) return;
  const checks = store.health?.checks?.length ? store.health.checks : healthFallbackChecks();
  root.innerHTML = checks.map((check) => {
    const status = check.status || "loading";
    return `
      <article class="check-item check-${escapeAttr(status)}">
        <span class="check-state">${healthStatusText(status)}</span>
        <strong>${escapeHtml(check.name)}</strong>
        <span>${escapeHtml(check.detail || "")}</span>
      </article>
    `;
  }).join("");
}

function renderInformaticoHome() {
  const totalDebt = data.debtors.reduce((sum, debtor) => sum + Number(debtor.deudaTotal || 0), 0);
  const noContact = data.debtors.filter((debtor) => !(debtor.telefonos || []).length && !(debtor.correos || []).length).length;
  const groups = assignmentGroups();
  setText("itKpiTotal", fmtNum.format(data.debtors.length));
  setText("itKpiDebt", fmtMoney.format(totalDebt));
  setText("itKpiExecutives", fmtNum.format(groups.length));
  setText("itKpiNoContact", fmtNum.format(noContact));
  renderBars("itOperationalBars", [
    ["Total cartera", data.debtors.length],
    ["Con telefono", data.debtors.filter((d) => d.telefonos.length).length],
    ["Con correo", data.debtors.filter((d) => d.correos.length).length],
    ["Sin contacto", noContact],
    ["Con convenio local", Object.keys(store.agreements).length],
  ]);
  renderBars("itAssignmentBars", groups.slice(0, 12).map(([name, row]) => [name, row.count]));
  renderInformaticoAssignmentMatrix();
  renderHealthChecklist();
  if (!store.health && !store.healthLoading) loadHealthFromApi();
  renderRecentAudit("itRecentAudit", 6);
}

function filteredInformaticoDebtors(limit = 800) {
  const state = $("itStateFilter")?.value || "";
  const assignment = $("itAssignmentFilter")?.value || "";
  const minDebt = parseMoney($("itDebtMin")?.value || "");
  const maxDebt = parseMoney($("itDebtMax")?.value || "");
  const rawQuery = $("itSearch")?.value || "";
  const query = normalizeText(rawQuery);
  const queryRut = normalizeRut(rawQuery);
  const rows = [];
  for (const debtor of sortedInformaticoDebtors()) {
    const debt = Number(debtor.deudaTotal || 0);
    if (state && displayState(debtor) !== state) continue;
    if (assignment && assignmentName(debtor) !== assignment) continue;
    if (minDebt && debt < minDebt) continue;
    if (maxDebt && debt > maxDebt) continue;
    if (query) {
      const text = informaticoSearchText(debtor);
      if (!text.includes(query) && (!queryRut || !text.includes(queryRut.toLowerCase()))) continue;
    }
    rows.push(debtor);
    if (rows.length >= limit) break;
  }
  return rows;
}

function renderInformaticoPortfolio() {
  if (informaticoPortfolioTimer) {
    window.clearTimeout(informaticoPortfolioTimer);
    informaticoPortfolioTimer = null;
  }
  const hasSearch = Boolean(($("itSearch")?.value || "").trim());
  const rows = filteredInformaticoDebtors(hasSearch ? 300 : 800);
  $("itPortfolioRows").innerHTML = rows.length ? rows.map((debtor) => `
    <tr>
      <td><strong>${escapeHtml(debtor.rutTitular || debtor.rutDeudor || "")}</strong><br><span class="muted">${escapeHtml(debtor.rutAlumno || "")}</span></td>
      <td>${escapeHtml(debtor.nombreTitular || "Sin titular")}</td>
      <td>${escapeHtml(debtor.nombreAlumno || "Sin alumno")}</td>
      <td>${fmtMoney.format(debtor.deudaTotal || debtor.saldoCapital || 0)}</td>
      <td>${statusPill(debtor)}</td>
      <td>${escapeHtml(assignmentName(debtor))}</td>
      <td>${escapeHtml(primaryPhone(debtor) || "Sin telefono")}</td>
      <td>${escapeHtml(primaryEmail(debtor) || "Sin correo")}</td>
      <td>${escapeHtml(debtor.comuna || "")}</td>
      <td>${escapeHtml(debtor.rol || "")}</td>
      <td>${escapeHtml(debtor.tribunal || "")}</td>
      <td>${lastManagementAgeLabel(debtor)}</td>
      <td class="it-action-col"><button type="button" class="sheet-action" data-it-open="${escapeAttr(debtor.id)}">Ver ficha</button></td>
    </tr>
  `).join("") : `<tr><td colspan="13">Sin registros para los filtros seleccionados.</td></tr>`;
  document.querySelectorAll("[data-it-open]").forEach((btn) => btn.addEventListener("click", () => {
    selectedDebtor = data.debtors.find((debtor) => debtor.id === btn.dataset.itOpen) || null;
    renderInformaticoDebtorTechDetail();
  }));
  renderInformaticoDebtorTechDetail();
}

function renderInformaticoDebtorTechDetail() {
  const target = $("itDebtorTechDetail");
  if (!target) return;
  const d = selectedDebtor;
  if (!d || !data.debtors.some((debtor) => debtor.id === d.id)) {
    target.className = "technical-detail detail-empty";
    target.innerHTML = "Seleccione un deudor para ver su ficha tecnica.";
    return;
  }
  target.className = "technical-detail";
  target.innerHTML = `
    <div class="panel-head compact-head">
      <h3>Ficha tecnica deudor</h3>
      <span>${escapeHtml(d.id || "")}</span>
      <button type="button" class="sheet-action" data-it-close-detail>Cerrar ficha</button>
    </div>
    <div class="technical-grid">
      ${detailItem("Asignacion", assignmentName(d))}
      ${detailItem("Estado", displayState(d))}
      ${detailItem("RUT titular", d.rutTitular || d.rutDeudor)}
      ${detailItem("Titular", d.nombreTitular)}
      ${detailItem("RUT alumno", d.rutAlumno)}
      ${detailItem("Alumno", d.nombreAlumno)}
      ${detailItem("Cartera", d.cartera)}
      ${detailItem("Tramo", d.tramo)}
      ${detailItem("Deuda total", fmtMoney.format(d.deudaTotal || 0))}
      ${detailItem("Saldo capital", fmtMoney.format(d.saldoCapital || 0))}
      ${detailItem("Interes mora", fmtMoney.format(d.interes || 0))}
      ${detailItem("Gasto cobranza", fmtMoney.format(d.gastoCobranza || 0))}
      ${detailItem("Direccion", d.direccion)}
      ${detailItem("Comuna / region", [d.comuna, d.region].filter(Boolean).join(" / "))}
      ${detailItem("Rol judicial", d.rol)}
      ${detailItem("Tribunal", d.tribunal)}
      ${detailItem("Correos", (d.correos || []).join(", "))}
      ${detailItem("Telefonos", (d.telefonos || []).join(", "))}
    </div>
  `;
  target.querySelector("[data-it-close-detail]")?.addEventListener("click", () => {
    selectedDebtor = null;
    renderInformaticoDebtorTechDetail();
  });
}

function renderInformaticoImport() {
  if (!$("itImportPreviewRows")?.innerHTML) {
    $("itImportPreviewRows").innerHTML = `<tr><td colspan="3">Seleccione un archivo para generar preview. Esta accion no modifica datos.</td></tr>`;
  }
}

async function previewInformaticoImport(event) {
  event.preventDefault();
  const file = $("itImportFile").files[0];
  if (!file) {
    $("itImportStatus").innerHTML = `<div class="detail-empty">Seleccione un archivo Excel o CSV.</div>`;
    return;
  }
  if (!window.XLSX) {
    $("itImportStatus").innerHTML = `<div class="detail-empty">No se pudo cargar XLSX. Revise conexion o suba CSV.</div>`;
    return;
  }
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => /base|hoja|cartera/i.test(name)) || workbook.SheetNames[0];
  const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const summary = buildImportPreviewSummary(rows, headers);
  const mode = $("itImportMode").value;
  const forcedAssignment = $("itForceAssignment").value.trim();
  const reason = $("itImportReason").value.trim() || "Preview importacion cartera";
  $("itImportStatus").innerHTML = `<div class="history-item"><strong>${escapeHtml(file.name)}</strong><br>Preview generado para hoja ${escapeHtml(sheetName)}. Modo: ${escapeHtml(mode)}. No se aplicaron cambios.</div>`;
  $("itImportPreviewRows").innerHTML = [
    ["Archivo", file.name, `${fmtNum.format(file.size)} bytes`],
    ["Hoja", sheetName, `${fmtNum.format(rows.length)} filas leidas`],
    ["Columnas", fmtNum.format(headers.length), headers.slice(0, 12).join(", ")],
    ["RUT/id_rem detectados", fmtNum.format(summary.matchableRows), `${fmtNum.format(summary.invalidRows)} filas sin llave clara`],
    ["Deudores nuevos probables", fmtNum.format(summary.newRows), "Comparado contra cartera cargada en pantalla"],
    ["Deudores existentes probables", fmtNum.format(summary.existingRows), "Match por id_rem/RUT titular/RUT alumno/RUT deudor"],
    ["Contactos detectados", `${fmtNum.format(summary.phoneCells)} telefonos / ${fmtNum.format(summary.emailCells)} correos`, "Se deben normalizar y deduplicar al aplicar"],
    ["Reasignaciones probables", fmtNum.format(summary.assignmentChanges), forcedAssignment ? `Forzar a ${forcedAssignment}` : "Segun columna asignacion"],
    ["Motivo", reason, "Debe guardarse en import_jobs.options al aplicar"],
  ].map(([a, b, c]) => `<tr><td>${escapeHtml(a)}</td><td><strong>${escapeHtml(b)}</strong></td><td>${escapeHtml(c)}</td></tr>`).join("");
  pushAudit("preview_import", "import_job", file.name, { mode, sheetName, rows: rows.length, forcedAssignment, reason });
  renderInformaticoAudit();
  renderInformaticoHome();
}

function buildImportPreviewSummary(rows, headers) {
  const existingKeys = new Set(data.debtors.flatMap((debtor) => [
    debtor.id,
    normalizeRut(debtor.rutDeudor),
    normalizeRut(debtor.rutTitular),
    normalizeRut(debtor.rutAlumno),
  ].filter(Boolean)));
  const phoneHeaders = headers.filter((header) => /^telefono_/i.test(normalizeHeader(header)) || normalizeHeader(header).includes("telefono"));
  const emailHeaders = headers.filter((header) => /^correo_/i.test(normalizeHeader(header)) || normalizeHeader(header).includes("correo"));
  let matchableRows = 0;
  let invalidRows = 0;
  let existingRows = 0;
  let newRows = 0;
  let phoneCells = 0;
  let emailCells = 0;
  let assignmentChanges = 0;
  rows.forEach((row) => {
    const key = importRowKey(row);
    if (key) matchableRows += 1;
    else invalidRows += 1;
    if (key && existingKeys.has(key)) existingRows += 1;
    else if (key) newRows += 1;
    phoneCells += phoneHeaders.filter((header) => String(row[header] || "").trim()).length;
    emailCells += emailHeaders.filter((header) => String(row[header] || "").trim()).length;
    const assignment = String(rowValue(row, ["asignacion", "usuario", "equipo"]) || "").trim();
    if (key && assignment) {
      const debtor = findDebtorByImportKey(key);
      if (debtor && assignmentName(debtor) !== assignment) assignmentChanges += 1;
    }
  });
  return { matchableRows, invalidRows, existingRows, newRows, phoneCells, emailCells, assignmentChanges };
}

function importRowKey(row) {
  const idRem = String(rowValue(row, ["id_rem", "id"]) || "").trim();
  if (idRem) return idRem;
  return normalizeRut(rowValue(row, ["rut_deudor", "rut deudor"]))
    || normalizeRut(rowValue(row, ["rut_titular", "rut titular"]))
    || normalizeRut(rowValue(row, ["rut_alumno", "rut alumno"]));
}

function findDebtorByImportKey(key) {
  const clean = normalizeRut(key);
  return data.debtors.find((debtor) => debtor.id === key
    || normalizeRut(debtor.rutDeudor) === clean
    || normalizeRut(debtor.rutTitular) === clean
    || normalizeRut(debtor.rutAlumno) === clean);
}

function renderInformaticoAssignments() {
  const groups = assignmentGroups();
  $("itAssignmentSummary").innerHTML = groups.slice(0, 14).map(([name, row]) => `
    <div class="bar-row">
      <span>${escapeHtml(name)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(5, row.count / Math.max(groups[0]?.[1].count || 1, 1) * 100)}%"></div></div>
      <strong>${fmtNum.format(row.count)}</strong>
    </div>
  `).join("") || `<div class="detail-empty">Sin asignaciones detectadas.</div>`;
}

function saveInformaticoAssignment(event) {
  event.preventDefault();
  const key = $("itAssignmentKey").value.trim();
  const target = $("itAssignmentTarget").value.trim();
  const reason = $("itAssignmentReason").value.trim();
  const debtor = findDebtorByImportKey(key);
  if (!key || !target || !debtor) {
    $("itAssignmentStatus").innerHTML = `<div class="detail-empty">Ingrese una llave valida y un asignado destino.</div>`;
    return;
  }
  const previous = assignmentName(debtor);
  debtor.asignacion = target;
  debtor.updatedAt = new Date().toISOString();
  invalidateInformaticoCaches();
  pushAudit("assignment_change", "debtor", debtor.id, { previous, next: target, reason });
  $("itAssignmentStatus").innerHTML = `<div class="history-item"><strong>${escapeHtml(debtor.nombreTitular || debtor.id)}</strong><br>Reasignado de ${escapeHtml(previous)} a ${escapeHtml(target)}. Pendiente de persistir via API oficial.</div>`;
  renderInformaticoAssignments();
  renderInformaticoPortfolio();
  renderInformaticoAudit();
  renderExecutiveRows();
}

function pushAudit(action, entityType, entityId, payload = {}) {
  store.audit.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    entityType,
    entityId,
    payload,
    user: session?.username || "sistema",
    role: session?.role || "sin_sesion",
    createdAt: new Date().toISOString(),
  });
  writeJson("abg_audit", store.audit);
}

function renderRecentAudit(targetId, limit = 20) {
  const rows = store.audit.slice(0, limit);
  $(targetId).innerHTML = rows.length ? rows.map((row) => `
    <div class="history-item"><strong>${escapeHtml(row.action)}</strong><br>${new Date(row.createdAt).toLocaleString("es-CL")} - ${escapeHtml(row.entityType)} ${escapeHtml(row.entityId || "")}</div>
  `).join("") : `<div class="detail-empty">Sin eventos de auditoria local.</div>`;
}

function renderInformaticoAudit() {
  $("itAuditRows").innerHTML = store.audit.length ? store.audit.map((row) => `
    <tr>
      <td>${new Date(row.createdAt).toLocaleString("es-CL")}</td>
      <td>${escapeHtml(row.user || "")}<br><span class="muted">${escapeHtml(row.role || "")}</span></td>
      <td>${escapeHtml(row.action)}</td>
      <td>${escapeHtml(row.entityType)}<br><span class="muted">${escapeHtml(row.entityId || "")}</span></td>
      <td><code>${escapeHtml(JSON.stringify(row.payload || {}))}</code></td>
    </tr>
  `).join("") : `<tr><td colspan="5">Sin eventos registrados.</td></tr>`;
}

function renderInformaticoUsers() {
  const users = store.internalUsers.slice().sort((a, b) => String(a.assignmentName || a.displayName).localeCompare(String(b.assignmentName || b.displayName), "es"));
  $("itUsersRows").innerHTML = users.length ? users.map((user) => {
    const key = user.username || user.id;
    const assignment = user.assignmentName || user.displayName || "";
    const metrics = assignmentMetrics(assignment);
    const cases = Number(user.cases ?? metrics.count ?? 0);
    const debtTotal = Number(user.debtTotal ?? user.deudaTotal ?? metrics.deudaTotal ?? 0);
    const isEditing = editingInternalUsers.has(key);
    const showPassword = visibleUserPasswords.has(key);
    const passwordText = showPassword ? escapeHtml(user.password || "") : "&bull;&bull;&bull;&bull;&bull;&bull;";
    const passwordTitle = showPassword ? escapeAttr(user.password || "") : "";
    if (isEditing) {
      return `
      <tr class="editing-row">
        <td><strong>${escapeHtml(assignment)}</strong><br><span class="muted">Google Sheets: Asignados</span></td>
        <td><input data-edit-user="${escapeAttr(key)}" value="${escapeAttr(user.username || "")}"></td>
        <td><input data-edit-pass="${escapeAttr(key)}" type="${showPassword ? "text" : "password"}" value="${escapeAttr(user.password || "")}"></td>
        <td>${fmtNum.format(cases)} casos<br><span class="muted">${fmtMoney.format(debtTotal)}</span></td>
        <td>
          <select data-edit-active="${escapeAttr(key)}">
            <option value="1"${user.active !== false ? " selected" : ""}>Activo</option>
            <option value="0"${user.active === false ? " selected" : ""}>Inactivo</option>
          </select>
        </td>
        <td class="user-actions">
          <button type="button" class="sheet-action" data-save-sheet-user="${escapeAttr(key)}">Guardar</button>
          <button type="button" data-cancel-user-edit="${escapeAttr(key)}">Cancelar</button>
        </td>
      </tr>`;
    }
    return `
    <tr>
      <td><strong>${escapeHtml(assignment)}</strong><br><span class="muted">${escapeHtml(user.role || "callcenter")}</span></td>
      <td>${escapeHtml(user.username || "")}</td>
      <td><span class="password-field"><span class="password-cell" title="${passwordTitle}">${passwordText}</span><button type="button" class="icon-button" title="${showPassword ? "Ocultar contrasena" : "Ver contrasena"}" aria-label="${showPassword ? "Ocultar contrasena" : "Ver contrasena"}" data-toggle-user-password="${escapeAttr(key)}">${showPassword ? "&#128274;" : "&#128065;"}</button></span></td>
      <td>${fmtNum.format(cases)} casos<br><span class="muted">${fmtMoney.format(debtTotal)}</span></td>
      <td>${user.active ? statusPillFromState("Activo") : statusPillFromState("Inactivo")}</td>
      <td class="user-actions">
        <button type="button" class="sheet-action" data-edit-user-row="${escapeAttr(key)}">Modificar</button>
      </td>
    </tr>
  `;
  }).join("") : `<tr><td colspan="6">Sin usuarios sincronizados desde Google Sheets.</td></tr>`;
  document.querySelectorAll("[data-toggle-user-password]").forEach((btn) => btn.addEventListener("click", toggleUserPasswordVisibility));
  document.querySelectorAll("[data-edit-user-row]").forEach((btn) => btn.addEventListener("click", startInternalUserEdit));
  document.querySelectorAll("[data-cancel-user-edit]").forEach((btn) => btn.addEventListener("click", cancelInternalUserEdit));
  document.querySelectorAll("[data-save-sheet-user]").forEach((btn) => btn.addEventListener("click", saveInternalUserSheetRow));
}

function assignmentMetrics(assignment) {
  if (!assignment) return { count: 0, deudaTotal: 0 };
  return data.debtors.filter((debtor) => normalizeText(assignmentName(debtor)) === normalizeText(assignment))
    .reduce((acc, debtor) => {
      acc.count += 1;
      acc.deudaTotal += Number(debtor.deudaTotal || 0);
      return acc;
    }, { count: 0, deudaTotal: 0 });
}

async function saveInternalUserProfile(event) {
  event.preventDefault();
  const username = normalizeUsername($("itUserUsername").value);
  const displayName = $("itUserDisplayName").value.trim();
  const role = $("itUserRole").value;
  const assignment = $("itUserAssignment").value.trim();
  const password = $("itUserPassword").value;
  if (!username || !password) {
    $("itUserStatus").innerHTML = `<div class="detail-empty">Usuario y contrasena son obligatorios.</div>`;
    return;
  }
  try {
    const json = await internalUsersApi("save", {
      user: {
        username,
        password,
        role,
        displayName: displayName || username,
        assignmentName: role === "callcenter" ? assignment : "",
        active: true,
      },
    });
    const saved = json.user;
    const index = store.internalUsers.findIndex((item) => item.id === saved.id || item.username === saved.username);
    if (index >= 0) store.internalUsers[index] = saved;
    else store.internalUsers.push(saved);
    pushAudit("internal_user_save", "app_user", saved.username, { role: saved.role, assignmentName: saved.assignmentName });
    $("itUserForm").reset();
    $("itUserStatus").innerHTML = `<div class="history-item"><strong>${escapeHtml(saved.username)}</strong><br>Perfil guardado en Supabase. Si es call center, vera solo la asignacion ${escapeHtml(saved.assignmentName || "-")}.</div>`;
    renderInformaticoUsers();
    renderInformaticoAudit();
  } catch (error) {
    $("itUserStatus").innerHTML = `<div class="detail-empty">No se guardo el perfil. Supabase/API respondio: ${escapeHtml(error.message)}</div>`;
  }
}

async function saveInternalUserPassword(event) {
  const id = event.currentTarget.dataset.saveUserPassword;
  const user = store.internalUsers.find((item) => item.id === id);
  const input = document.querySelector(`[data-user-password="${CSS.escape(id)}"]`);
  const password = input?.value || "";
  if (!user || !password) return;
  try {
    const json = await internalUsersApi("save", {
      user: {
        username: user.username,
        password,
        role: user.role,
        displayName: user.displayName,
        assignmentName: user.assignmentName,
        active: user.active,
      },
    });
    Object.assign(user, json.user || {});
    pushAudit("internal_user_password_change", "app_user", user.username, { role: user.role });
    $("itUserStatus").innerHTML = `<div class="history-item"><strong>${escapeHtml(user.username)}</strong><br>Contrasena actualizada en Supabase.</div>`;
    renderInformaticoUsers();
    renderInformaticoAudit();
  } catch (error) {
    $("itUserStatus").innerHTML = `<div class="detail-empty">No se actualizo la contrasena: ${escapeHtml(error.message)}</div>`;
  }
}

async function toggleInternalUserActive(event) {
  const id = event.currentTarget.dataset.toggleUser;
  const user = store.internalUsers.find((item) => item.id === id);
  if (!user || user.system) {
    $("itUserStatus").innerHTML = `<div class="detail-empty">Los usuarios administrativos base no se pueden desactivar desde la pagina.</div>`;
    return;
  }
  try {
    const json = await internalUsersApi("toggle", { id: user.id, active: !user.active });
    Object.assign(user, json.user || {});
    pushAudit("internal_user_toggle", "app_user", user.username, { active: user.active });
    $("itUserStatus").innerHTML = `<div class="history-item"><strong>${escapeHtml(user.username)}</strong><br>Estado actualizado en Supabase.</div>`;
    renderInformaticoUsers();
    renderInformaticoAudit();
  } catch (error) {
    $("itUserStatus").innerHTML = `<div class="detail-empty">No se actualizo el estado: ${escapeHtml(error.message)}</div>`;
  }
}

async function createMissingExecutiveProfiles() {
  await syncInternalUsersFromApi(true);
  pushAudit("internal_users_sheet_sync", "google_sheet", "AIEP_BASE_TOTAL", { users: store.internalUsers.length });
  renderInformaticoAudit();
}

function toggleUserPasswordVisibility(event) {
  const key = event.currentTarget.dataset.toggleUserPassword;
  if (visibleUserPasswords.has(key)) visibleUserPasswords.delete(key);
  else visibleUserPasswords.add(key);
  renderInformaticoUsers();
}

function startInternalUserEdit(event) {
  editingInternalUsers.add(event.currentTarget.dataset.editUserRow);
  renderInformaticoUsers();
}

function cancelInternalUserEdit(event) {
  editingInternalUsers.delete(event.currentTarget.dataset.cancelUserEdit);
  renderInformaticoUsers();
}

async function saveInternalUserSheetRow(event) {
  const key = event.currentTarget.dataset.saveSheetUser;
  const user = store.internalUsers.find((item) => (item.username || item.id) === key);
  if (!user) return;
  const username = document.querySelector(`[data-edit-user="${CSS.escape(key)}"]`)?.value || user.username;
  const password = document.querySelector(`[data-edit-pass="${CSS.escape(key)}"]`)?.value || user.password || "123456";
  const active = document.querySelector(`[data-edit-active="${CSS.escape(key)}"]`)?.value !== "0";
  try {
    const json = await sheetsUsersApi("save", {
      user: {
        username,
        password,
        role: user.role || "callcenter",
        displayName: user.displayName,
        assignmentName: user.assignmentName || user.displayName,
        active,
      },
    });
    const saved = json.user;
    const index = store.internalUsers.findIndex((item) => (item.username || item.id) === key);
    if (index >= 0) store.internalUsers[index] = saved;
    editingInternalUsers.delete(key);
    visibleUserPasswords.add(saved.username);
    $("itUserStatus").innerHTML = `<div class="history-item"><strong>${escapeHtml(saved.assignmentName || saved.displayName)}</strong><br>Perfil actualizado en Google Sheets y Supabase.</div>`;
    renderInformaticoUsers();
  } catch (error) {
    $("itUserStatus").innerHTML = `<div class="detail-empty">No se guardo el perfil: ${escapeHtml(error.message)}</div>`;
  }
}

function renderInformaticoReports() {
  const groups = assignmentGroups();
  renderBars("itExecutiveDebtBars", groups.slice(0, 12).map(([name, row]) => [name, row.deudaTotal]), fmtMoney.format);
  renderBars("itContactabilityBars", groups.slice(0, 12).map(([name, row]) => [name, row.count ? Math.round((row.withContact / row.count) * 100) : 0]), (value) => `${value}%`);
}

function filteredReportEntries() {
  const from = $("reportFrom").value;
  const to = $("reportTo").value;
  return store.entries.filter((entry) => (!from || entry.date >= from) && (!to || entry.date <= to));
}

function renderManagement() {
  const debtors = filteredManagementDebtors();
  const entries = filteredReportEntries();
  const resultCounts = countBy(entries, "result");
  const channelCounts = countBy(entries, "channel");
  const managedDebtorIds = new Set(entries.map((entry) => entry.debtorId));
  const receipts = store.files.filter((file) => file.category === "comprobante");
  const filteredDebtorIds = new Set(debtors.map((debtor) => debtor.id));
  const offerRows = Object.values(store.agreements).filter((offer) => filteredDebtorIds.has(offer.debtorId));
  const offerTotal = offerRows.reduce((sum, offer) => sum + offer.amount, 0);
  const offerCapital = offerRows.reduce((sum, offer) => {
    const debtor = data.debtors.find((item) => item.id === offer.debtorId);
    return sum + (debtor?.saldoCapital || 0);
  }, 0);
  const lostCapital = Math.max(0, offerCapital - offerTotal);
  const managedFilteredCount = debtors.filter((debtor) => managedDebtorIds.has(debtor.id)).length;
  const managedRate = debtors.length ? Math.round((managedFilteredCount / debtors.length) * 100) : 0;
  const collected = store.files.filter((file) => file.category === "comprobante" && file.status === "validado").reduce((sum, file) => sum + (file.amount || 0), 0)
    + allBankRows().filter((row) => ["validado", "conciliado"].includes(row.status)).reduce((sum, row) => sum + Number(row.monto || 0), 0);
  const agreementBalance = offerRows.reduce((sum, offer) => {
    const debtor = data.debtors.find((item) => item.id === offer.debtorId);
    return sum + (debtor ? agreementRemainingAmount(debtor, offer) : 0);
  }, 0);

  setText("kpiTotal", fmtNum.format(debtors.length));
  setText("kpiCapital", fmtMoney.format(debtors.reduce((sum, d) => sum + d.saldoCapital, 0)));
  setText("kpiOferta", fmtMoney.format(offerTotal));
  setText("kpiCollected", fmtMoney.format(collected));
  setText("kpiLostCapital", fmtMoney.format(lostCapital));
  setText("kpiEntries", fmtNum.format(entries.length));
  setText("kpiManagedRate", `${managedRate}%`);
  setText("kpiReceipts", fmtNum.format(receipts.length));
  setText("kpiActiveAgreements", fmtNum.format(offerRows.length));
  setText("kpiAgreementBalance", fmtMoney.format(agreementBalance));
  setText("generatedAt", `base ${new Date(data.generatedAt).toLocaleString("es-CL")}`);
  setText("withPhone", fmtNum.format(debtors.filter((d) => d.telefonos.length).length));
  setText("withEmail", fmtNum.format(debtors.filter((d) => d.correos.length).length));
  setText("withoutContact", fmtNum.format(debtors.filter((d) => !d.telefonos.length && !d.correos.length).length));

  renderBars("stateBars", Object.entries(countBy(debtors.map((d) => ({ estado: displayState(d) })), "estado")).sort((a, b) => b[1] - a[1]).slice(0, 10));
  renderBars("managementBars", Object.entries(resultCounts).sort((a, b) => b[1] - a[1]));
  renderBars("channelBars", Object.entries(channelCounts).sort((a, b) => b[1] - a[1]));
  renderBars("funnelBars", [
    ["Cartera total", debtors.length],
    ["Con gestión", managedFilteredCount],
    ["Ofertas registradas", offerRows.length],
    ["Comprobantes", receipts.length],
  ]);
  renderBars("topDebtBars", debtors.slice().sort((a, b) => b.deudaTotal - a.deudaTotal).slice(0, 8).map((d) => [d.nombreTitular || d.rutTitular, d.deudaTotal]), fmtMoney.format);
  renderBars("bankSourceBars", bankSourcePairs(), fmtMoney.format);
  renderContactDonut(debtors);
  renderCriticalIndicators(debtors, entries, offerRows, receipts, lostCapital);
}

function displayState(debtor) {
  return getOffer(debtor) ? "Convenio en curso" : (debtor.estado || "Pendiente");
}

function renderAgreementRegistry() {
  const from = $("agreementFrom").value;
  const to = $("agreementTo").value;
  const state = $("agreementStateFilter").value;
  const head = $("agreementRows")?.closest("table")?.querySelector("thead");
  if (head) head.innerHTML = `<tr><th>Fecha</th><th>Tipo</th><th>Deudor</th><th>Alumno</th><th>Monto</th><th>Pie</th><th>Saldo</th><th>Rut paga</th><th>Archivos</th><th>Cartola</th><th>Proximo pago</th><th>Estado</th></tr>`;
  const rows = Object.values(store.agreements)
    .map((agreement) => ({ agreement, debtor: data.debtors.find((item) => item.id === agreement.debtorId) }))
    .filter((row) => row.debtor)
    .filter((row) => (!from || row.agreement.date >= from) && (!to || row.agreement.date <= to))
    .filter((row) => !state || displayState(row.debtor) === state)
    .sort((a, b) => String(b.agreement.date).localeCompare(String(a.agreement.date)));
  $("agreementRows").innerHTML = rows.length ? rows.map(({ agreement, debtor }) => `
    <tr class="${agreement.type === "cuotas" ? "installment-row" : "settlement-row"}">
      <td>${agreement.date || agreement.createdAt?.slice(0, 10) || ""}</td>
      <td>${agreementTypeLabel(agreement)}</td>
      <td><strong>${debtor.nombreTitular || ""}</strong><br><span class="muted">${debtor.rutTitular || debtor.rutDeudor}</span></td>
      <td><strong>${debtor.nombreAlumno || ""}</strong><br><span class="muted">${debtor.rutAlumno || ""}</span></td>
      <td>${fmtMoney.format(agreement.amount)}</td>
      ${agreementRegistryExtraCells(agreement, debtor)}
      <td>${nextPaymentDate(agreement) || "Sin fecha"}</td>
      <td>${statusPill(debtor)}</td>
    </tr>
  `).join("") : `<tr><td colspan="12">Sin convenios para los filtros seleccionados.</td></tr>`;
}

function agreementRegistryExtraCells(agreement, debtor) {
  const files = store.files.filter((file) => file.debtorId === debtor.id && file.category === "comprobante");
  const bankMatches = allBankRows().filter((row) => bankRowMatchesDebtor(row, debtor));
  return `
    <td>${agreement.type === "cuotas" ? fmtMoney.format(agreement.downPayment || 0) : "-"}</td>
    <td>${fmtMoney.format(agreementRemainingAmount(debtor, agreement))}</td>
    <td>${agreement.payerRut || "-"}</td>
    <td>${files.length ? `${files.length} archivo(s)` : "Sin archivos"}</td>
    <td>${bankMatches.length ? `${bankMatches.length} match` : "Sin match"}</td>
  `;
}

function renderContactDonut(debtors) {
  const phone = debtors.filter((d) => d.telefonos.length).length;
  const emailOnly = debtors.filter((d) => !d.telefonos.length && d.correos.length).length;
  const none = debtors.filter((d) => !d.telefonos.length && !d.correos.length).length;
  const total = Math.max(phone + emailOnly + none, 1);
  const p1 = (phone / total) * 100;
  const p2 = p1 + (emailOnly / total) * 100;
  $("contactDonut").style.background = `conic-gradient(#15803d 0 ${p1}%, #2563eb ${p1}% ${p2}%, #b42318 ${p2}% 100%)`;
  $("contactLegend").innerHTML = `
    <span><i style="background:#15803d"></i>Con teléfono: ${fmtNum.format(phone)}</span>
    <span><i style="background:#2563eb"></i>Solo correo: ${fmtNum.format(emailOnly)}</span>
    <span><i style="background:#b42318"></i>Sin contacto: ${fmtNum.format(none)}</span>
  `;
}

function renderCriticalIndicators(debtors, entries, offers, receipts, lostCapital) {
  const totalCapital = debtors.reduce((sum, d) => sum + d.saldoCapital, 0);
  const noContact = debtors.filter((d) => !d.telefonos.length && !d.correos.length).length;
  const promise = entries.filter((entry) => entry.result === "Compromiso de pago").length;
  const paidEvidence = entries.filter((entry) => entry.result === "Pagó / comprobante").length + receipts.length;
  $("criticalIndicators").innerHTML = `
    ${indicator("Capital en riesgo", fmtMoney.format(totalCapital))}
    ${indicator("Sin contactabilidad", `${fmtNum.format(noContact)} casos`)}
    ${indicator("Promesas de pago", fmtNum.format(promise))}
    ${indicator("Evidencias de pago", fmtNum.format(paidEvidence))}
    ${indicator("Ofertas registradas", fmtNum.format(offers.length))}
    ${indicator("Capital condonado estimado", fmtMoney.format(lostCapital))}
  `;
}

function indicator(label, value) {
  return `<div class="indicator"><span>${label}</span><strong>${value}</strong></div>`;
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || "Sin dato";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function bankSourcePairs() {
  const rows = allBankRows();
  if (!rows.length) return data.summary.cartola.porFuente || [];
  const totals = rows.reduce((acc, row) => {
    const key = row.source || row.fuente || "Sin fuente";
    acc[key] = (acc[key] || 0) + Number(row.monto || 0);
    return acc;
  }, {});
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function rowValue(row, aliases) {
  const wanted = aliases.map(normalizeHeader);
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.includes(normalizeHeader(key))) return value;
  }
  return "";
}

function bankDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && window.XLSX?.SSF) {
    const parsed = window.XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const raw = String(value || "").trim();
  const match = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (!match) return raw.slice(0, 10);
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function bankRowFromRaw(row, source, fileRecord) {
  const monto = parseMoney(rowValue(row, ["Ingreso (+)", "ingreso", "monto", "abono", "haber", "valor"]));
  const rut = String(rowValue(row, ["RUT", "rut pagador", "rut cliente"]) || "").trim();
  const nombre = String(rowValue(row, ["Nombre", "nombre pagador", "cliente", "deudor"]) || "").trim();
  const glosa = String(rowValue(row, ["Glosa detalle", "Comentario transferencia", "glosa", "descripcion", "detalle"]) || "").trim();
  if (!monto && !rut && !nombre && !glosa) return null;
  return {
    id: `${fileRecord.id}-${source}-${Math.random().toString(16).slice(2)}`,
    fileId: fileRecord.id,
    fileName: fileRecord.name,
    source,
    fecha: bankDate(rowValue(row, ["Fecha de transacción", "Fecha contable", "fecha", "fecha movimiento"])),
    nombre,
    rut,
    monto,
    glosa,
    associatedRut: "",
    payerRut: rut,
    status: rut ? "pendiente" : "revision",
    notes: "",
    createdAt: new Date().toISOString(),
  };
}

async function parseBankRows(file, fileRecord) {
  const ext = file.name.toLowerCase().split(".").pop();
  if (["xlsx", "xls"].includes(ext || "")) {
    if (!window.XLSX) throw new Error("No se pudo cargar el lector XLSX. Reintente o suba CSV.");
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    return workbook.SheetNames.flatMap((sheetName) => {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
      return rows.map((row) => bankRowFromRaw(row, sheetName, fileRecord)).filter(Boolean);
    });
  }
  if (window.XLSX) {
    const workbook = window.XLSX.read(await file.text(), { type: "string" });
    return workbook.SheetNames.flatMap((sheetName) => {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
      return rows.map((row) => bankRowFromRaw(row, sheetName, fileRecord)).filter(Boolean);
    });
  }
  return [];
}

function allBankRows() {
  const remote = (data.bankMovements || []).map((row, index) => ({
    id: `remote-${index}`,
    source: row.fuente || row.source || "base",
    fecha: row.fecha || row.date || "",
    nombre: row.nombre || "",
    rut: row.rut || "",
    monto: Number(row.monto || 0),
    glosa: row.glosa || "",
    associatedRut: row.associatedRut || "",
    payerRut: row.payerRut || row.rut || "",
    status: row.status || "pendiente",
    notes: row.notes || "",
  }));
  return [...store.bankRows, ...remote];
}

function bankRowMatchesDebtor(row, debtor) {
  const agreement = getOffer(debtor);
  const validRuts = [debtor.rutTitular, debtor.rutAlumno, debtor.rutDeudor, agreement?.payerRut].map(normalizeRut).filter(Boolean);
  return [row.associatedRut, row.payerRut, row.rut].map(normalizeRut).some((rut) => rut && validRuts.includes(rut));
}

async function saveBankStatement(event) {
  event.preventDefault();
  const file = $("bankStatementFile").files[0];
  if (!file) return;
  const record = await saveFileRecord(file, { source: "jefatura", category: "cartola", debtorId: null, debtorName: "Cartola bancaria" });
  let parsedRows = [];
  try {
    parsedRows = await parseBankRows(file, record);
    store.bankRows.unshift(...parsedRows);
    writeJson("abg_bank_rows", store.bankRows);
  } catch (error) {
    $("bankUploadStatus").innerHTML = `<div class="history-item file"><strong>${record.name}</strong><br>Cartola guardada, pero no se pudo leer: ${escapeHtml(error.message)}</div>`;
    renderFileRepository();
    return;
  }
  $("bankUploadForm").reset();
  $("bankUploadStatus").innerHTML = `<div class="history-item file"><strong>${record.name}</strong><br>Cartola guardada. Movimientos leidos: ${fmtNum.format(parsedRows.length)}.</div>`;
  renderFileRepository();
  renderBankRows();
}

function renderBankRows() {
  const rows = allBankRows();
  $("bankRows").innerHTML = rows.length ? rows.map((m) => {
    const state = m.status || (m.rut ? "pendiente" : "revision");
    return `
      <tr data-bank-row="${escapeAttr(m.id)}">
        <td>${m.fecha || ""}</td>
        <td>${m.source || m.fuente || ""}<br><span class="muted">${m.fileName || ""}</span></td>
        <td><strong>${m.nombre || "Sin nombre"}</strong><br><span class="muted">${m.rut || "RUT no informado"}</span></td>
        <td>${fmtMoney.format(m.monto || 0)}</td>
        <td>${m.glosa || ""}</td>
        <td><input data-bank-associated value="${escapeAttr(m.associatedRut || "")}" placeholder="RUT deudor"></td>
        <td><select data-bank-status><option value="pendiente" ${state === "pendiente" ? "selected" : ""}>Pendiente</option><option value="validado" ${state === "validado" ? "selected" : ""}>Validado</option><option value="revision" ${state === "revision" ? "selected" : ""}>Revision</option><option value="rechazado" ${state === "rechazado" ? "selected" : ""}>Rechazado</option></select></td>
        <td><button type="button" data-save-bank-row="${escapeAttr(m.id)}">Guardar</button></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="8">Sin cartolas cargadas. Suba una cartola desde dashboard jefatura.</td></tr>`;
  document.querySelectorAll("[data-save-bank-row]").forEach((btn) => btn.addEventListener("click", saveBankRowEdit));
  return;
  $("bankRows").innerHTML = data.bankMovements.map((m) => {
    const state = m.rut ? "Match probable" : "Revisión manual";
    return `
      <tr>
        <td>${m.fecha}</td>
        <td>${m.fuente}</td>
        <td><strong>${m.nombre || "Sin nombre"}</strong><br><span class="muted">${m.rut || "RUT no informado"}</span></td>
        <td>${fmtMoney.format(m.monto)}</td>
        <td>${m.glosa}</td>
        <td>${statusPillFromState(state)}</td>
      </tr>
    `;
  }).join("");
}

function saveBankRowEdit(event) {
  const id = event.currentTarget.dataset.saveBankRow;
  const row = store.bankRows.find((item) => item.id === id);
  if (!row) return;
  const tr = event.currentTarget.closest("tr");
  row.associatedRut = tr.querySelector("[data-bank-associated]")?.value.trim() || "";
  row.status = tr.querySelector("[data-bank-status]")?.value || "pendiente";
  writeJson("abg_bank_rows", store.bankRows);
  renderBankRows();
  renderManagement();
}

function debtorById(id) {
  return data.debtors.find((debtor) => debtor.id === id) || null;
}

function renderValidationQueue() {
  const rows = store.files
    .filter((file) => file.category === "comprobante")
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  $("validationRows").innerHTML = rows.length ? rows.map((file) => {
    const debtor = debtorById(file.debtorId);
    return `
      <tr class="validation-row" data-file-id="${escapeAttr(file.id)}">
        <td>${new Date(file.createdAt).toLocaleDateString("es-CL")}</td>
        <td><strong>${escapeHtml(file.debtorName || debtor?.nombreTitular || "Sin deudor")}</strong><br><span class="muted">${escapeHtml(debtor?.rutTitular || debtor?.rutDeudor || "")}</span></td>
        <td>${escapeHtml(file.name)}<br><span class="muted">${escapeHtml(file.source || "")}</span></td>
        <td><input data-validation-amount inputmode="numeric" value="${file.amount ? fmtMoney.format(file.amount) : ""}" placeholder="$0"></td>
        <td><input data-validation-payer value="${escapeAttr(file.payerRut || "")}" placeholder="RUT pagador"></td>
        <td><select data-validation-status><option value="pendiente" ${!file.status || file.status === "pendiente" ? "selected" : ""}>Pendiente</option><option value="validado" ${file.status === "validado" ? "selected" : ""}>Validado</option><option value="rechazado" ${file.status === "rechazado" ? "selected" : ""}>Rechazado</option></select></td>
        <td><input data-validation-note value="${escapeAttr(file.validationNote || "")}" placeholder="Nota"></td>
        <td><button type="button" data-save-validation="${escapeAttr(file.id)}">Guardar</button></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="8">Sin comprobantes para validar.</td></tr>`;
  document.querySelectorAll("[data-save-validation]").forEach((btn) => btn.addEventListener("click", saveValidationEdit));
}

function saveValidationEdit(event) {
  const id = event.currentTarget.dataset.saveValidation;
  const file = store.files.find((item) => item.id === id);
  if (!file) return;
  const tr = event.currentTarget.closest("tr");
  file.amount = parseMoney(tr.querySelector("[data-validation-amount]")?.value || "");
  file.payerRut = tr.querySelector("[data-validation-payer]")?.value.trim() || "";
  file.status = tr.querySelector("[data-validation-status]")?.value || "pendiente";
  file.validationNote = tr.querySelector("[data-validation-note]")?.value.trim() || "";
  file.validatedAt = new Date().toISOString();
  writeJson("abg_files", store.files);
  renderValidationQueue();
  renderManagement();
  if (selectedDebtor) renderExecutiveDetail();
}

function renderFileRepository() {
  let files = store.files;
  if (session?.role === "deudor") files = files.filter((file) => file.debtorId === session.debtorId);
  files = files.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!files.length) {
    $("fileRepository").innerHTML = `<div class="detail-empty">Sin archivos guardados en este navegador.</div>`;
    return;
  }
  $("fileRepository").innerHTML = files.map((file) => `
    <article class="file-row">
      <div>
        <strong>${file.name}</strong>
        <span>${file.category} · ${file.source} · ${file.debtorName || "Sin deudor"} · ${new Date(file.createdAt).toLocaleString("es-CL")}</span>
      </div>
      <span>${Math.ceil(file.size / 1024)} KB</span>
    </article>
  `).join("");
}

function bindEvents() {
  $("loginForm").addEventListener("submit", handleLogin);
  $("internalLoginForm").addEventListener("submit", handleInternalLogin);
  $("openInternalLogin").addEventListener("click", () => {
    $("internalCard").hidden = false;
    $("openInternalLogin").hidden = true;
    $("internalUser").focus();
  });
  $("closeInternalLogin").addEventListener("click", () => {
    $("internalCard").hidden = true;
    $("openInternalLogin").hidden = false;
  });
  document.querySelectorAll(".profile-btn").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelectorAll(".profile-btn").forEach((item) => item.classList.remove("active"));
    btn.classList.add("active");
    $("internalUser").value = btn.dataset.user;
    $("internalPass").value = btn.dataset.pass;
  }));
  $("logoutBtn").addEventListener("click", logout);
  $("sidebarToggle").addEventListener("click", () => {
    document.body.classList.toggle("sidebar-collapsed");
    $("sidebarToggle").textContent = document.body.classList.contains("sidebar-collapsed") ? "›" : "‹";
  });
  $("globalSearch").addEventListener("input", renderExecutiveRows);
  $("execStateFilter").addEventListener("input", renderExecutiveRows);
  $("execContactFilter").addEventListener("input", renderExecutiveRows);
  $("execRecentFilter").addEventListener("input", renderExecutiveRows);
  $("execAgreementFilter").addEventListener("input", renderExecutiveRows);
  $("execAssignmentFilter").addEventListener("input", renderExecutiveRows);
  $("execDebtMin").addEventListener("input", renderExecutiveRows);
  $("execDebtMax").addEventListener("input", renderExecutiveRows);
  $("execNoManagementDays").addEventListener("input", renderExecutiveRows);
  $("execManagementExactDate").addEventListener("input", renderExecutiveRows);
  $("execManagementFrom").addEventListener("input", renderExecutiveRows);
  $("execManagementTo").addEventListener("input", renderExecutiveRows);
  $("clearCampaignExcluded").addEventListener("click", clearCampaignExcluded);
  $("toggleCampaignPanel").addEventListener("click", () => {
    const body = $("campaignBody");
    body.hidden = !body.hidden;
    $("campaignPanel").classList.toggle("collapsed", body.hidden);
    $("toggleCampaignPanel").textContent = body.hidden ? "Mostrar" : "Ocultar";
  });
  $("clearExecFilters").addEventListener("click", () => {
    $("execStateFilter").value = "";
    $("execContactFilter").value = "";
    $("execRecentFilter").value = "";
    $("execAgreementFilter").value = "";
    $("execAssignmentFilter").value = "";
    $("execDebtMin").value = "";
    $("execDebtMax").value = "";
    $("execNoManagementDays").value = "";
    $("execManagementExactDate").value = "";
    $("execManagementFrom").value = "";
    $("execManagementTo").value = "";
    $("globalSearch").value = "";
    renderExecutiveRows();
  });
  $("startEmailCampaign").addEventListener("click", () => startCampaign("correo"));
  $("startWhatsappCampaign").addEventListener("click", () => startCampaign("telefono"));
  $("stopCampaign").addEventListener("click", () => stopCampaign(true));
  $("outlookClassicMode").checked = outlookClassicModeEnabled();
  $("outlookClassicMode").addEventListener("change", (event) => {
    localStorage.setItem("abg_outlook_classic_mode", event.currentTarget.checked ? "1" : "0");
  });
  $("outlookAutoSendMode").checked = outlookAutoSendEnabled();
  $("outlookAutoSendMode").addEventListener("change", (event) => {
    localStorage.setItem("abg_outlook_auto_send_mode", event.currentTarget.checked ? "1" : "0");
  });
  $("selectOutlookAccount").addEventListener("click", selectOutlookAccount);
  $("whatsappLocalMode").checked = whatsappLocalModeEnabled();
  $("whatsappLocalMode").addEventListener("change", (event) => {
    localStorage.setItem("abg_whatsapp_local_mode", event.currentTarget.checked ? "1" : "0");
  });
  ["campaignDebtMin", "campaignDebtMax", "execDebtMin", "execDebtMax", "reportDebtMin", "reportDebtMax"].forEach((id) => $(id).addEventListener("blur", (event) => {
    const amount = parseMoney(event.currentTarget.value);
    event.currentTarget.value = amount ? fmtMoney.format(amount) : "";
    if (id.startsWith("exec")) renderExecutiveRows();
    if (id.startsWith("report")) renderManagement();
  }));
  $("debtorUploadForm").addEventListener("submit", saveDebtorReceipt);
  $("bankUploadForm").addEventListener("submit", saveBankStatement);
  $("closeAgreementModal").addEventListener("click", closeAgreementModal);
  $("agreementForm").addEventListener("submit", saveAgreement);
  ["agreementType", "agreementInstallments", "agreementStartDate", "agreementAmount", "agreementDownPayment"].forEach((id) => $(id).addEventListener("input", renderAgreementCalendar));
  ["agreementAmount", "agreementDownPayment"].forEach((id) => $(id).addEventListener("blur", (event) => {
    const amount = parseMoney(event.currentTarget.value);
    event.currentTarget.value = amount ? fmtMoney.format(amount) : "";
    renderAgreementCalendar();
  }));
  ["reportFrom", "reportTo", "reportStateFilter", "reportAgreementFilter", "reportAssignmentFilter", "reportDebtMin", "reportDebtMax"].forEach((id) => $(id).addEventListener("input", renderManagement));
  ["agreementFrom", "agreementTo", "agreementStateFilter"].forEach((id) => $(id).addEventListener("input", renderAgreementRegistry));
  $("clearReportFilters").addEventListener("click", () => {
    $("reportFrom").value = "";
    $("reportTo").value = "";
    $("reportStateFilter").value = "";
    $("reportAgreementFilter").value = "";
    $("reportAssignmentFilter").value = "";
    $("reportDebtMin").value = "";
    $("reportDebtMax").value = "";
    renderManagement();
  });
  $("clearAgreementFilters").addEventListener("click", () => {
    $("agreementFrom").value = "";
    $("agreementTo").value = "";
    $("agreementStateFilter").value = "";
    renderAgreementRegistry();
  });
  ["itStateFilter", "itAssignmentFilter", "itDebtMin", "itDebtMax", "itSearch"].forEach((id) => $(id)?.addEventListener("input", scheduleInformaticoPortfolioRender));
  ["itDebtMin", "itDebtMax"].forEach((id) => $(id)?.addEventListener("blur", (event) => {
    const amount = parseMoney(event.currentTarget.value);
    event.currentTarget.value = amount ? fmtMoney.format(amount) : "";
    renderInformaticoPortfolio();
  }));
  $("clearItFilters")?.addEventListener("click", () => {
    $("itStateFilter").value = "";
    $("itAssignmentFilter").value = "";
    $("itDebtMin").value = "";
    $("itDebtMax").value = "";
    $("itSearch").value = "";
    renderInformaticoPortfolio();
  });
  $("itImportForm")?.addEventListener("submit", previewInformaticoImport);
  $("itAssignmentForm")?.addEventListener("submit", saveInformaticoAssignment);
  $("itUserForm")?.addEventListener("submit", saveInternalUserProfile);
  $("itCreateMissingExecutives")?.addEventListener("click", createMissingExecutiveProfiles);
  $("itSyncUsers")?.addEventListener("click", () => syncInternalUsersFromApi(true));
}

bindEvents();
