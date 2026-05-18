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
};
const fmtMoney = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat("es-CL");
const today = () => new Date().toISOString().slice(0, 10);

const store = {
  entries: readJson("abg_entries", []),
  contacts: readJson("abg_contacts", {}),
  files: readJson("abg_files", []),
  offers: readJson("abg_offers", {}),
  agreements: readJson("abg_agreements", readJson("abg_offers", {})),
  comments: readJson("abg_comments", {}),
};

let session = null;
let selectedDebtor = null;
let executiveRows = [];
let sessionStartedAt = null;

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

function agreementTypeLabel(agreement) {
  if (!agreement) return "";
  return agreement.type === "cuotas" ? "Pago en cuotas" : "Liquidación total";
}

function escapeAttr(value) {
  return String(value || "").replace(/"/g, "&quot;");
}

function debtorRutMatch(debtor, rut) {
  const clean = normalizeRut(rut);
  return [debtor.rutTitular, debtor.rutAlumno, debtor.rutDeudor].some((item) => normalizeRut(item) === clean);
}

function contactKey(debtor, type, value) {
  return `${debtor.id}|${type}|${value}`;
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
  if (id === "localFiles") renderFileRepository();
  if (id === "managementHome") renderManagement();
  if (id === "managementAgreements") renderAgreementRegistry();
  if (id === "managementBank") renderBankRows();
}

function defaultViewForRole(role) {
  if (role === "deudor") return "debtorHome";
  if (role === "ejecutivo") return "executiveHome";
  if (role === "jefatura") return "managementHome";
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

function renderNav() {
  $("mainNav").innerHTML = views[session.role].map((view, index) => `
    <button class="nav-item ${index === 0 ? "active" : ""}" data-view="${view.id}">${view.label}</button>
  `).join("");
  document.querySelectorAll(".nav-item").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));
}

function login(role, debtor = null) {
  const username = role === "deudor" ? (debtor?.rutTitular || debtor?.rutAlumno || debtor?.rutDeudor) : $("internalUser").value.trim();
  session = { role, debtorId: debtor?.id || null, username };
  sessionStartedAt = new Date();
  selectedDebtor = debtor || data.debtors[0];
  document.body.classList.remove("logged-out");
  renderEntryMeta();
  loadIndicators();
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
  openRequestedOrDefault();
}

function handleLogin(event) {
  event.preventDefault();
  const user = $("loginUser").value.trim();
  $("loginError").textContent = "";

  const debtor = data.debtors.find((item) => debtorRutMatch(item, user));
  if (debtor) return login("deudor", debtor);

  $("loginError").textContent = "RUT no encontrado. Ingrese RUT de titular o alumno.";
}

function handleInternalLogin(event) {
  event.preventDefault();
  const user = normalizeText($("internalUser").value.trim());
  const pass = $("internalPass").value;
  $("internalLoginError").textContent = "";
  if (user === "callcenter" && pass === "123456") return login("ejecutivo");
  if (user === "remesa" && pass === "654321") return login("jefatura");
  $("internalLoginError").textContent = "Credenciales internas inválidas.";
}

function logout() {
  session = null;
  selectedDebtor = null;
  $("loginForm").reset();
  $("internalLoginForm").reset();
  document.body.classList.add("logged-out");
  history.replaceState(null, "", location.pathname);
}

function fillFilters() {
  const states = [...new Set(data.debtors.map((d) => d.estado).filter(Boolean))].sort();
  for (const id of ["execStateFilter", "reportStateFilter", "agreementStateFilter"]) {
    const node = $(id);
    if (node && node.options.length === 1) node.insertAdjacentHTML("beforeend", ["Convenio en curso", ...states].map((state) => `<option>${state}</option>`).join(""));
  }
}

function executiveFilter(debtor) {
  const q = normalizeText($("globalSearch").value);
  const state = $("execStateFilter").value;
  const contact = $("execContactFilter").value;
  const matchesQuery = !q || normalizeText([debtor.nombreTitular, debtor.rutTitular, debtor.rutAlumno, debtor.nombreAlumno, debtor.estado].join(" ")).includes(q);
  const matchesContact = !contact || (contact === "phone" && debtor.telefonos.length) || (contact === "email" && debtor.correos.length) || (contact === "none" && !debtor.telefonos.length && !debtor.correos.length);
  return matchesQuery && (!state || displayState(debtor) === state) && matchesContact;
}

function renderExecutiveRows() {
  executiveRows = data.debtors.filter(executiveFilter).sort((a, b) => {
    const paidA = effectiveState(a).includes("pagado") ? 1 : 0;
    const paidB = effectiveState(b).includes("pagado") ? 1 : 0;
    if (paidA !== paidB) return paidA - paidB;
    return b.saldoCapital - a.saldoCapital;
  });
  $("executiveRows").innerHTML = executiveRows.slice(0, 350).map((d, index) => `
    <tr data-index="${index}" class="${rowClass(d)} ${selectedDebtor?.id === d.id ? "selected-row" : ""}">
      <td><span class="agreement-dot ${agreementDotClass(d)}"></span>${commentCount(d) ? `<span class="comment-badge row-comment-badge" title="Tiene comentarios internos"></span>` : ""}<strong>${d.nombreTitular || "Sin nombre"}</strong><br><span class="muted">${d.nombreAlumno || "Alumno no informado"}</span></td>
      <td>${d.rutTitular || d.rutDeudor}</td>
      <td><span class="status-pill">${d.estado}</span></td>
      <td>${fmtMoney.format(d.saldoCapital)}</td>
      <td><strong>${getOfferAmount(d) ? fmtMoney.format(getOfferAmount(d)) : "Sin convenio"}</strong></td>
      <td>${contactLabel(d)}</td>
    </tr>
  `).join("");
  document.querySelectorAll("#executiveRows tr").forEach((row) => {
    row.addEventListener("click", () => {
      selectedDebtor = executiveRows[Number(row.dataset.index)];
      renderExecutiveRows();
      renderExecutiveDetail();
    });
  });
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

function nextPaymentDate(agreement) {
  const dates = agreement.paymentDates || [agreement.startDate].filter(Boolean);
  return dates.find((date) => date >= today()) || dates[dates.length - 1] || "";
}

function contactLabel(debtor) {
  const parts = [];
  if (debtor.telefonos.length) parts.push(`${debtor.telefonos.length} tel.`);
  if (debtor.correos.length) parts.push(`${debtor.correos.length} correo`);
  return parts.join(" / ") || "Sin datos";
}

function renderExecutiveDetail() {
  const d = selectedDebtor;
  if (!d) return;
  const offer = getOffer(d);
  setText("execSelectedStatus", d.estado);
  $("selectedCommentIcon").hidden = commentCount(d) === 0;
  $("selectedCommentIcon").title = `${commentCount(d)} comentario(s) interno(s)`;
  $("executiveDetail").className = "";
  $("executiveDetail").innerHTML = `
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
  document.querySelectorAll("[data-reply-comment]").forEach((btn) => btn.addEventListener("click", saveReply));
  document.querySelectorAll("[data-delete-comment]").forEach((btn) => btn.addEventListener("click", deleteComment));
  document.querySelectorAll("[data-delete-reply]").forEach((btn) => btn.addEventListener("click", deleteReply));
  $("openAgreementModal").addEventListener("click", openAgreementModal);
  const editButton = $("editAgreement");
  if (editButton) editButton.addEventListener("click", openAgreementModal);
  const deleteButton = $("deleteAgreement");
  if (deleteButton) deleteButton.addEventListener("click", deleteAgreement);
  $("execManagementForm").addEventListener("submit", saveManagementEntry);
  document.querySelectorAll("[data-contact-action]").forEach((btn) => btn.addEventListener("click", updateContactStatus));
  document.querySelectorAll("[data-copy-message]").forEach((node) => node.addEventListener("click", copyContactMessage));
}

function detailItem(label, value) {
  return `<div class="detail-item"><span class="detail-label">${label}</span><strong>${value || "Sin dato"}</strong></div>`;
}

function renderAgreementSummary(debtor) {
  const agreement = getOffer(debtor);
  if (!agreement) return `<div class="detail-empty">Sin convenio registrado.</div>`;
  return `
    <div class="agreement-summary ${agreement.type === "cuotas" ? "installment-row" : "settlement-row"}">
      <strong>${agreementTypeLabel(agreement)} · ${fmtMoney.format(agreement.amount)}</strong>
      <span>Inicio: ${agreement.startDate || "Sin fecha"} · Próximo pago: ${nextPaymentDate(agreement) || "Sin fecha"}</span>
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
  const dates = agreement.paymentDates || [agreement.startDate].filter(Boolean);
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
        <button type="button" class="comment-delete" data-delete-comment="${comment.id}" title="Eliminar comentario">✕</button>
      </div>
      <p>${comment.text}</p>
      <div class="reply-list">
        ${(comment.replies || []).map((reply, index) => `<div class="reply-item"><strong>${reply.user}</strong><span>${reply.text}</span><button type="button" class="comment-delete" data-delete-comment="${comment.id}" data-delete-reply="${index}" title="Eliminar respuesta">✕</button></div>`).join("")}
      </div>
      <form class="reply-form" data-reply-comment="${comment.id}">
        <input placeholder="Responder comentario">
        <button type="submit">Responder</button>
      </form>
    </article>
  `).join("");
}

function deleteComment(event) {
  const id = event.currentTarget.dataset.deleteComment;
  store.comments[selectedDebtor.id] = (store.comments[selectedDebtor.id] || []).filter((comment) => comment.id !== id);
  writeJson("abg_comments", store.comments);
  renderExecutiveRows();
  renderExecutiveDetail();
  $("commentPanel").hidden = false;
  $("toggleComments").classList.add("open");
}

function deleteReply(event) {
  const id = event.currentTarget.dataset.deleteComment;
  const index = Number(event.currentTarget.dataset.deleteReply);
  const list = store.comments[selectedDebtor.id] || [];
  const comment = list.find((item) => item.id === id);
  if (!comment) return;
  comment.replies = (comment.replies || []).filter((_, i) => i !== index);
  writeJson("abg_comments", store.comments);
  renderExecutiveRows();
  renderExecutiveDetail();
  $("commentPanel").hidden = false;
  $("toggleComments").classList.add("open");
}

function saveComment(event) {
  event.preventDefault();
  const text = $("commentText").value.trim();
  if (!text) return;
  const list = store.comments[selectedDebtor.id] || [];
  list.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, text, user: session.username, createdAt: new Date().toISOString(), replies: [] });
  store.comments[selectedDebtor.id] = list;
  writeJson("abg_comments", store.comments);
  renderExecutiveRows();
  renderExecutiveDetail();
  $("commentPanel").hidden = false;
}

function saveReply(event) {
  event.preventDefault();
  const input = event.currentTarget.querySelector("input");
  const text = input.value.trim();
  if (!text) return;
  const id = event.currentTarget.dataset.replyComment;
  const list = store.comments[selectedDebtor.id] || [];
  const comment = list.find((item) => item.id === id);
  if (!comment) return;
  comment.replies = comment.replies || [];
  comment.replies.push({ text, user: session.username, createdAt: new Date().toISOString() });
  writeJson("abg_comments", store.comments);
  renderExecutiveRows();
  renderExecutiveDetail();
  $("commentPanel").hidden = false;
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
  return values.map((value) => {
    const saved = store.contacts[contactKey(debtor, type, value)] || {};
    const cls = saved.status === "ok" ? "ok" : saved.status === "ignore" ? "ignore" : "";
    const label = saved.status === "ok" ? "Funciona" : saved.status === "ignore" ? "No considerar" : "Sin marcar";
    const message = buildContactMessage(debtor, type, value);
    return `
      <article class="contact-item ${cls}">
        <button type="button" class="contact-copy" data-copy-message="${escapeAttr(message)}" data-type="${type}" data-value="${escapeAttr(value)}" title="Abrir mensaje">${value}</button>
        <span>${label}${saved.comment ? `: ${saved.comment}` : ""}</span>
        <div>
          <button type="button" data-contact-action="ok" data-type="${type}" data-value="${value}">Funciona</button>
          <button type="button" data-contact-action="ignore" data-type="${type}" data-value="${value}">No considerar</button>
        </div>
      </article>
    `;
  }).join("");
}

function buildContactMessage(debtor, type, value) {
  const offerAmount = getOfferAmount(debtor);
  const offerText = offerAmount ? `Existe un convenio vigente por ${fmtMoney.format(offerAmount)}.` : "Aún no registra un convenio aprobado.";
  const base = `Estimado/a ${debtor.nombreTitular || ""}, le contactamos por deuda AIEP asociada al alumno ${debtor.nombreAlumno || ""}, RUT ${debtor.rutAlumno || ""}. Saldo total pendiente: ${fmtMoney.format(debtor.deudaTotal)}. ${offerText} Datos de transferencia: Banco BCI, Comercial Remesa SpA, RUT 76.976.117-9, Cuenta Corriente 27826341. Si ya pagó, envíe el comprobante para validación.`;
  return type === "correo"
    ? `Asunto: Regularización deuda AIEP\n\n${base}\n\nContacto utilizado: ${value}`
    : base;
}

function phoneForWhatsApp(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("56")) return digits;
  if (digits.length === 9) return `56${digits}`;
  return digits;
}

function copyContactMessage(event) {
  const message = event.currentTarget.dataset.copyMessage;
  const type = event.currentTarget.dataset.type;
  const value = event.currentTarget.dataset.value;
  if (type === "telefono") {
    window.open(`https://wa.me/${phoneForWhatsApp(value)}?text=${encodeURIComponent(message)}`, "_blank");
    $("copyStatus").textContent = "WhatsApp abierto con mensaje preparado.";
    return;
  }
  window.location.href = `mailto:${encodeURIComponent(value)}?subject=${encodeURIComponent("Regularización deuda AIEP")}&body=${encodeURIComponent(message)}`;
  $("copyStatus").textContent = "Correo abierto con mensaje preparado.";
}

function updateContactStatus(event) {
  const btn = event.currentTarget;
  const comment = prompt("Comentario para esta marca:", "") || "";
  store.contacts[contactKey(selectedDebtor, btn.dataset.type, btn.dataset.value)] = {
    status: btn.dataset.contactAction,
    comment,
    date: new Date().toISOString(),
  };
  writeJson("abg_contacts", store.contacts);
  renderExecutiveDetail();
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
  $("agreementInstallments").value = agreement?.installments || 1;
  $("agreementStartDate").value = agreement?.startDate || today();
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
  $("installmentsLabel").style.display = type === "cuotas" ? "grid" : "none";
  const dates = buildPaymentDates(type, start, installments);
  $("agreementCalendar").innerHTML = dates.length
    ? `<div class="agreement-calendar">${dates.map((date) => `<span><i></i>${date}</span>`).join("")}</div>`
    : "";
}

function buildPaymentDates(type, start, installments) {
  if (!start) return [];
  if (type !== "cuotas") return [start];
  const dates = [];
  const base = new Date(start + "T00:00:00");
  for (let i = 0; i < installments; i += 1) {
    const next = new Date(base);
    next.setMonth(base.getMonth() + i);
    dates.push(next.toISOString().slice(0, 10));
  }
  return dates;
}

function saveAgreement(event) {
  event.preventDefault();
  const amount = parseMoney($("agreementAmount").value);
  if (!amount) return;
  const type = $("agreementType").value;
  const installments = type === "cuotas" ? Math.max(1, Number($("agreementInstallments").value || 1)) : 1;
  const startDate = $("agreementStartDate").value || today();
  store.agreements[selectedDebtor.id] = {
    amount,
    type,
    installments,
    startDate,
    paymentDates: buildPaymentDates(type, startDate, installments),
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
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    debtorId: selectedDebtor.id,
    debtorName: selectedDebtor.nombreTitular,
    date: fd.get("date"),
    channel: fd.get("channel"),
    result: fd.get("result"),
    comment: fd.get("comment") || "Sin comentario",
    user: "callcenter",
    createdAt: new Date().toISOString(),
  };
  store.entries.unshift(entry);
  writeJson("abg_entries", store.entries);

  const file = fd.get("receipt");
  if (file && file.size) {
    await saveFileRecord(file, { debtorId: selectedDebtor.id, debtorName: selectedDebtor.nombreTitular, source: "ejecutivo", category: "comprobante", entryId: entry.id });
  }
  renderExecutiveDetail();
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
    ${offer ? `<div class="offer-block wide"><span>Detalle convenio</span><small>Inicio: ${offer.startDate || offer.date}. Adjunte comprobante luego de transferir.</small>${offer.type === "cuotas" ? `<div class="calendar-dots">${(offer.paymentDates || []).map((date) => `<span class="calendar-dot" title="${date}">${new Date(date + "T00:00:00").getDate()}</span>`).join("")}</div>` : ""}</div>` : ""}
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

function filteredReportEntries() {
  const from = $("reportFrom").value;
  const to = $("reportTo").value;
  return store.entries.filter((entry) => (!from || entry.date >= from) && (!to || entry.date <= to));
}

function renderManagement() {
  const state = $("reportStateFilter").value;
  const debtors = data.debtors.filter((d) => !state || displayState(d) === state);
  const entries = filteredReportEntries();
  const resultCounts = countBy(entries, "result");
  const channelCounts = countBy(entries, "channel");
  const managedDebtorIds = new Set(entries.map((entry) => entry.debtorId));
  const receipts = store.files.filter((file) => file.category === "comprobante");
  const offerRows = Object.values(store.agreements);
  const offerTotal = offerRows.reduce((sum, offer) => sum + offer.amount, 0);
  const offerCapital = offerRows.reduce((sum, offer) => {
    const debtor = data.debtors.find((item) => item.id === offer.debtorId);
    return sum + (debtor?.saldoCapital || 0);
  }, 0);
  const lostCapital = Math.max(0, offerCapital - offerTotal);
  const managedRate = debtors.length ? Math.round((managedDebtorIds.size / debtors.length) * 100) : 0;
  const collected = store.files.filter((file) => file.category === "comprobante" && file.status === "validado").reduce((sum, file) => sum + (file.amount || 0), 0);

  setText("kpiTotal", fmtNum.format(debtors.length));
  setText("kpiCapital", fmtMoney.format(debtors.reduce((sum, d) => sum + d.saldoCapital, 0)));
  setText("kpiOferta", fmtMoney.format(offerTotal));
  setText("kpiCollected", fmtMoney.format(collected));
  setText("kpiLostCapital", fmtMoney.format(lostCapital));
  setText("kpiEntries", fmtNum.format(entries.length));
  setText("kpiManagedRate", `${managedRate}%`);
  setText("kpiReceipts", fmtNum.format(receipts.length));
  setText("generatedAt", `base ${new Date(data.generatedAt).toLocaleString("es-CL")}`);
  setText("withPhone", fmtNum.format(debtors.filter((d) => d.telefonos.length).length));
  setText("withEmail", fmtNum.format(debtors.filter((d) => d.correos.length).length));
  setText("withoutContact", fmtNum.format(debtors.filter((d) => !d.telefonos.length && !d.correos.length).length));

  renderBars("stateBars", Object.entries(countBy(debtors.map((d) => ({ estado: displayState(d) })), "estado")).sort((a, b) => b[1] - a[1]).slice(0, 10));
  renderBars("managementBars", Object.entries(resultCounts).sort((a, b) => b[1] - a[1]));
  renderBars("channelBars", Object.entries(channelCounts).sort((a, b) => b[1] - a[1]));
  renderBars("funnelBars", [
    ["Cartera total", debtors.length],
    ["Con gestión", managedDebtorIds.size],
    ["Ofertas registradas", offerRows.length],
    ["Comprobantes", receipts.length],
  ]);
  renderBars("topDebtBars", debtors.slice().sort((a, b) => b.deudaTotal - a.deudaTotal).slice(0, 8).map((d) => [d.nombreTitular || d.rutTitular, d.deudaTotal]), fmtMoney.format);
  renderBars("bankSourceBars", data.summary.cartola.porFuente, fmtMoney.format);
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
      <td>${nextPaymentDate(agreement) || "Sin fecha"}</td>
      <td><span class="status-pill">${displayState(debtor)}</span></td>
    </tr>
  `).join("") : `<tr><td colspan="7">Sin convenios para los filtros seleccionados.</td></tr>`;
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

async function saveBankStatement(event) {
  event.preventDefault();
  const file = $("bankStatementFile").files[0];
  if (!file) return;
  const record = await saveFileRecord(file, { source: "jefatura", category: "cartola", debtorId: null, debtorName: "Cartola bancaria" });
  $("bankUploadForm").reset();
  $("bankUploadStatus").innerHTML = `<div class="history-item file"><strong>${record.name}</strong><br>Cartola guardada para conciliación manual/local.</div>`;
  renderFileRepository();
}

function renderBankRows() {
  $("bankRows").innerHTML = data.bankMovements.map((m) => {
    const state = m.rut ? "Match probable" : "Revisión manual";
    return `
      <tr>
        <td>${m.fecha}</td>
        <td>${m.fuente}</td>
        <td><strong>${m.nombre || "Sin nombre"}</strong><br><span class="muted">${m.rut || "RUT no informado"}</span></td>
        <td>${fmtMoney.format(m.monto)}</td>
        <td>${m.glosa}</td>
        <td><span class="status-pill">${state}</span></td>
      </tr>
    `;
  }).join("");
}

function renderFileRepository() {
  let files = store.files;
  if (session?.role === "deudor") files = files.filter((file) => file.debtorId === session.debtorId);
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
  $("clearExecFilters").addEventListener("click", () => {
    $("execStateFilter").value = "";
    $("execContactFilter").value = "";
    $("globalSearch").value = "";
    renderExecutiveRows();
  });
  $("debtorUploadForm").addEventListener("submit", saveDebtorReceipt);
  $("bankUploadForm").addEventListener("submit", saveBankStatement);
  $("closeAgreementModal").addEventListener("click", closeAgreementModal);
  $("agreementForm").addEventListener("submit", saveAgreement);
  ["agreementType", "agreementInstallments", "agreementStartDate"].forEach((id) => $(id).addEventListener("input", renderAgreementCalendar));
  $("agreementAmount").addEventListener("blur", (event) => {
    const amount = parseMoney(event.currentTarget.value);
    event.currentTarget.value = amount ? fmtMoney.format(amount) : "";
  });
  ["reportFrom", "reportTo", "reportStateFilter"].forEach((id) => $(id).addEventListener("input", renderManagement));
  ["agreementFrom", "agreementTo", "agreementStateFilter"].forEach((id) => $(id).addEventListener("input", renderAgreementRegistry));
  $("clearReportFilters").addEventListener("click", () => {
    $("reportFrom").value = "";
    $("reportTo").value = "";
    $("reportStateFilter").value = "";
    renderManagement();
  });
  $("clearAgreementFilters").addEventListener("click", () => {
    $("agreementFrom").value = "";
    $("agreementTo").value = "";
    $("agreementStateFilter").value = "";
    renderAgreementRegistry();
  });
}

bindEvents();
