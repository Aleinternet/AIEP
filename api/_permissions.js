const { supabaseFetch } = require("./_data");
const { httpError, normalizeRut } = require("./_validators");

function normalizeAssignment(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function validCallcenterAssignment(user) {
  const assignment = normalizeAssignment(user?.assignmentName || user?.assignment_name || "");
  if (!assignment) return "";
  if (["callcenter", "call center", "sin asignacion", "sin asignación"].includes(assignment)) return "";
  return assignment;
}

function debtorAssignments(debtor = {}) {
  return [debtor.asignacion, debtor.usuario, debtor.equipo]
    .map(normalizeAssignment)
    .filter(Boolean);
}

function userOwnsDebtorRut(user, debtor = {}) {
  const rut = normalizeRut(user?.rut || user?.rutNormalizado || user?.rut_normalizado || "");
  if (!rut) return false;
  return [
    debtor.rut_deudor_normalizado,
    debtor.rut_titular_normalizado,
    debtor.rut_alumno_normalizado,
  ].map(normalizeRut).includes(rut);
}

function canReadDebtor(user, debtor) {
  if (!user || !debtor) return false;
  if (user.role === "informatico" || user.role === "jefatura") return true;
  if (user.role === "callcenter") {
    const assignment = validCallcenterAssignment(user);
    if (!assignment) return false;
    return debtorAssignments(debtor).includes(assignment);
  }
  if (user.role === "deudor") return userOwnsDebtorRut(user, debtor);
  return false;
}

function canWriteOperational(user, debtor) {
  if (!user || !debtor) return false;
  if (user.role === "informatico") return true;
  if (user.role === "jefatura") return false;
  if (user.role === "callcenter") return canReadDebtor(user, debtor);
  return false;
}

async function loadDebtorForAccess(debtorOrId) {
  if (!debtorOrId) throw httpError(400, "Deudor requerido.", "debtor_required");
  if (typeof debtorOrId === "object") return debtorOrId;
  const id = String(debtorOrId);
  const rows = await supabaseFetch(`debtors?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!rows.length) throw httpError(404, "Deudor no encontrado.", "debtor_not_found");
  return rows[0];
}

async function assertDebtorAccess(user, debtorOrId, { write = false } = {}) {
  const debtor = await loadDebtorForAccess(debtorOrId);
  const allowed = write ? canWriteOperational(user, debtor) : canReadDebtor(user, debtor);
  if (!allowed) throw httpError(403, "No autorizado para este deudor.", "debtor_forbidden");
  return debtor;
}

module.exports = {
  assertDebtorAccess,
  canReadDebtor,
  canWriteOperational,
  normalizeAssignment,
  validCallcenterAssignment,
};
