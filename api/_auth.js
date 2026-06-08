const { loadInternalUser, normalizeUsername } = require("./_data");
const { demoUser } = require("./_demo");

function authError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function getHeader(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function extractCredentials(req) {
  const body = parseBody(req);
  const query = req.query || {};
  return {
    username: normalizeUsername(firstValue(
      body.user,
      body.username,
      body.adminUser,
      getHeader(req, "x-abg-user"),
      query.user,
      query.username,
      query.adminUser,
    )),
    password: String(firstValue(
      body.pass,
      body.password,
      body.adminPass,
      getHeader(req, "x-abg-pass"),
      query.pass,
      query.password,
      query.adminPass,
    )),
  };
}

function legacyBaseUser(username, password) {
  const isJefatura = username === "remesa" && password === "654321";
  const isInformatico = (username === "informatico" || username === "informatica") && password === "789012";
  if (!isJefatura && !isInformatico) return null;
  const role = isJefatura ? "jefatura" : "informatico";
  return {
    id: null,
    username,
    displayName: username,
    role,
    assignmentName: "",
    assignment_name: "",
    authSource: "legacy_base_user",
  };
}

function publicActor(user) {
  const assignmentName = user.assignmentName || user.assignment_name || "";
  return {
    id: user.id || null,
    username: user.username,
    displayName: user.displayName || user.display_name || user.username,
    role: user.role,
    assignmentName,
    assignment_name: assignmentName,
    demo: Boolean(user.demo),
    authSource: user.authSource || "app_users",
  };
}

async function requireUser(req, allowedRoles = []) {
  const { username, password } = extractCredentials(req);
  if (!username || !password) throw authError(401, "Credenciales requeridas", "missing_credentials");

  const demo = demoUser(username, password);
  const dbUser = demo ? null : await loadInternalUser(username, password);
  const actor = demo ? publicActor(demo) : dbUser ? publicActor(dbUser) : legacyBaseUser(username, password);
  if (!actor) throw authError(401, "Credenciales invalidas", "invalid_credentials");

  if (allowedRoles.length && !allowedRoles.includes(actor.role)) {
    throw authError(403, "Rol no autorizado", "role_forbidden");
  }

  return actor;
}

function authErrorResponse(res, error) {
  const status = error.statusCode || 500;
  const message = status >= 500 ? "Error interno" : (error.message || "No autorizado");
  res.status(status).json({ ok: false, error: message, code: error.code || "error" });
}

module.exports = {
  authError,
  authErrorResponse,
  extractCredentials,
  publicActor,
  requireUser,
};
