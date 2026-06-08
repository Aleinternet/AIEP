const { supabaseFetch } = require("./_data");
const { debtorId, httpError, normalizeRut, validateRut } = require("./_validators");

async function loadDebtorById(id) {
  const cleanId = debtorId(id, { required: true });
  const rows = await supabaseFetch(`debtors?select=*&id=eq.${encodeURIComponent(cleanId)}&limit=1`);
  if (!rows.length) throw httpError(404, "Deudor no encontrado.", "debtor_not_found");
  return rows[0];
}

async function loadDebtorByRut(rut) {
  const normalized = validateRut(rut, { required: true });
  const query = new URLSearchParams({
    select: "*",
    or: `(rut_deudor_normalizado.eq.${normalized},rut_titular_normalizado.eq.${normalized},rut_alumno_normalizado.eq.${normalized})`,
    limit: "1",
  });
  const rows = await supabaseFetch(`debtors?${query.toString()}`);
  if (!rows.length) throw httpError(404, "RUT no encontrado.", "debtor_not_found");
  return rows[0];
}

async function loadDebtorFromInput(input = {}) {
  if (input.debtor_id || input.debtorId) return loadDebtorById(input.debtor_id || input.debtorId);
  if (input.rut) return loadDebtorByRut(input.rut);
  const normalizedRut = normalizeRut(input.rut_normalizado || input.rutNormalizado || "");
  if (normalizedRut) return loadDebtorByRut(normalizedRut);
  throw httpError(400, "Debe informar debtor_id o RUT.", "debtor_required");
}

module.exports = {
  loadDebtorById,
  loadDebtorByRut,
  loadDebtorFromInput,
};
