function httpError(statusCode, message, code = "bad_request") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeRut(value = "") {
  return String(value).replace(/[^0-9Kk]/g, "").toUpperCase();
}

function rutDv(body) {
  let sum = 0;
  let factor = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  if (rest === 11) return "0";
  if (rest === 10) return "K";
  return String(rest);
}

function validateRut(value, { required = false } = {}) {
  const rut = normalizeRut(value);
  if (!rut) {
    if (required) throw httpError(400, "RUT requerido.", "rut_required");
    return "";
  }
  if (!/^\d{6,9}[0-9K]$/.test(rut)) throw httpError(400, "RUT invalido.", "rut_invalid");
  const body = rut.slice(0, -1);
  const dv = rut.slice(-1);
  if (rutDv(body) !== dv) throw httpError(400, "RUT invalido.", "rut_invalid");
  return rut;
}

function safeString(value, { max = 2000, required = false, field = "texto" } = {}) {
  const text = String(value ?? "").replace(/\u0000/g, "").trim();
  if (!text && required) throw httpError(400, `${field} requerido.`, "string_required");
  if (text.length > max) throw httpError(400, `${field} supera el largo permitido.`, "string_too_long");
  return text;
}

function optionalDate(value, field = "fecha") {
  const text = safeString(value, { max: 20 });
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, `${field} debe usar formato YYYY-MM-DD.`, "date_invalid");
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw httpError(400, `${field} invalida.`, "date_invalid");
  return text;
}

function optionalMoney(value, field = "monto") {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const parsed = Number(String(value).replace(/[^0-9-]/g, ""));
  if (!Number.isFinite(parsed)) throw httpError(400, `${field} invalido.`, "money_invalid");
  return Math.round(parsed);
}

function numericId(value, { required = false, field = "id" } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw httpError(400, `${field} requerido.`, "id_required");
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw httpError(400, `${field} invalido.`, "id_invalid");
  return parsed;
}

function uuid(value, { required = false, field = "id" } = {}) {
  const text = safeString(value, { max: 80, field });
  if (!text) {
    if (required) throw httpError(400, `${field} requerido.`, "id_required");
    return "";
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw httpError(400, `${field} invalido.`, "uuid_invalid");
  }
  return text;
}

function debtorId(value, { required = false } = {}) {
  const text = safeString(value, { max: 120, field: "deudor" });
  if (!text && required) throw httpError(400, "deudor requerido.", "debtor_required");
  if (text && !/^[A-Za-z0-9_.:-]+$/.test(text)) throw httpError(400, "deudor invalido.", "debtor_invalid");
  return text;
}

function contactType(value) {
  const type = safeString(value, { max: 20, required: true, field: "tipo de contacto" }).toLowerCase();
  if (!["telefono", "correo"].includes(type)) throw httpError(400, "Tipo de contacto invalido.", "contact_type_invalid");
  return type;
}

function contactStatus(value) {
  const raw = safeString(value || "sin_validar", { max: 30 }).toLowerCase();
  const map = {
    ok: "valido",
    valid: "valido",
    valido: "valido",
    ignore: "no_considerar",
    no_considerar: "no_considerar",
    manual: "sin_validar",
    sin_validar: "sin_validar",
  };
  const status = map[raw];
  if (!status) throw httpError(400, "Status de contacto invalido.", "contact_status_invalid");
  return status;
}

function emailValue(value) {
  const email = safeString(value, { max: 320, required: true, field: "correo" }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Correo invalido.", "email_invalid");
  return email;
}

function phoneValue(value) {
  const digits = safeString(value, { max: 40, required: true, field: "telefono" }).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw httpError(400, "Telefono invalido.", "phone_invalid");
  return digits;
}

function contactValue(type, value) {
  return type === "correo" ? emailValue(value) : phoneValue(value);
}

module.exports = {
  contactStatus,
  contactType,
  contactValue,
  debtorId,
  httpError,
  normalizeRut,
  numericId,
  optionalDate,
  optionalMoney,
  safeString,
  uuid,
  validateRut,
};
