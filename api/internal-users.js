const crypto = require("crypto");
const { authErrorResponse, requireUser } = require("./_auth");
const { hashPassword, normalizeUsername, supabaseFetch } = require("./_data");

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    assignmentName: row.assignment_name || "",
    active: row.active !== false,
  };
}

async function listUsers() {
  const rows = await supabaseFetch("app_users?select=id,username,display_name,role,assignment_name,active&order=role.asc,username.asc");
  return rows.map(publicUser);
}

async function findUser(username) {
  const query = new URLSearchParams({
    select: "id",
    username: `eq.${normalizeUsername(username)}`,
    limit: "1",
  });
  const rows = await supabaseFetch(`app_users?${query.toString()}`);
  return rows[0] || null;
}

async function saveUser(input) {
  const username = normalizeUsername(input.username || "");
  if (!username) throw new Error("Usuario requerido.");
  if (!["callcenter", "jefatura", "informatico"].includes(input.role)) throw new Error("Rol invalido.");

  const payload = {
    username,
    display_name: input.displayName || username,
    role: input.role,
    assignment_name: input.role === "callcenter" ? (input.assignmentName || "") : "",
    active: input.active !== false,
    updated_at: new Date().toISOString(),
  };

  if (input.password) {
    const salt = crypto.randomBytes(16).toString("hex");
    payload.password_salt = salt;
    payload.password_hash = hashPassword(input.password, salt);
    payload.password_changed_at = new Date().toISOString();
  }

  const existing = await findUser(username);
  if (existing) {
    const rows = await supabaseFetch(`app_users?id=eq.${encodeURIComponent(existing.id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return publicUser(rows[0]);
  }

  const rows = await supabaseFetch("app_users", {
    method: "POST",
    body: JSON.stringify({ ...payload, created_at: new Date().toISOString() }),
  });
  return publicUser(rows[0]);
}

async function toggleUser(id, active) {
  const rows = await supabaseFetch(`app_users?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ active, updated_at: new Date().toISOString() }),
  });
  return publicUser(rows[0]);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
    return;
  }

  try {
    const body = req.body || {};
    await requireUser(req, ["informatico", "jefatura"]);

    if (body.action === "list") {
      res.status(200).json({ ok: true, users: await listUsers() });
      return;
    }

    if (body.action === "save") {
      res.status(200).json({ ok: true, user: await saveUser(body.user || {}) });
      return;
    }

    if (body.action === "toggle") {
      res.status(200).json({ ok: true, user: await toggleUser(body.id, Boolean(body.active)) });
      return;
    }

    res.status(400).json({ ok: false, error: "Accion no soportada" });
  } catch (error) {
    authErrorResponse(res, error);
  }
};
