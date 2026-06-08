const { authErrorResponse, requireUser } = require("./_auth");
const { writeAudit } = require("./_audit");
const { loadDebtorFromInput } = require("./_debtors");
const { assertDebtorAccess } = require("./_permissions");
const { supabaseFetch } = require("./_data");
const { contactStatus, contactType, contactValue, safeString, uuid } = require("./_validators");

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

function publicContact(row) {
  return {
    id: row.id,
    debtorId: row.debtor_id,
    type: row.type,
    value: row.value,
    status: row.status,
    category: row.category || "",
    note: row.note || "",
    deletedAt: row.deleted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadContact(id) {
  const cleanId = uuid(id, { required: true, field: "contacto" });
  const rows = await supabaseFetch(`contacts?select=*&id=eq.${encodeURIComponent(cleanId)}&limit=1`);
  if (!rows.length) {
    const error = new Error("Contacto no encontrado.");
    error.statusCode = 404;
    error.code = "contact_not_found";
    throw error;
  }
  return rows[0];
}

async function handleGet(req, res) {
  const user = await requireUser(req, ["callcenter", "jefatura", "informatico"]);
  const debtor = await loadDebtorFromInput(req.query || {});
  await assertDebtorAccess(user, debtor);
  const rows = await supabaseFetch(
    `contacts?select=*&debtor_id=eq.${encodeURIComponent(debtor.id)}&deleted_at=is.null&order=type.asc,value.asc`,
  );
  res.status(200).json({ ok: true, debtor_id: debtor.id, contacts: rows.map(publicContact) });
}

async function handlePost(req, res) {
  const user = await requireUser(req, ["callcenter", "informatico"]);
  const body = parseBody(req);
  const debtor = await loadDebtorFromInput(body);
  await assertDebtorAccess(user, debtor, { write: true });
  const type = contactType(body.type);
  const value = contactValue(type, body.value);
  const payload = {
    debtor_id: debtor.id,
    type,
    value,
    status: contactStatus(body.status),
    category: safeString(body.category, { max: 120, field: "categoria" }),
    note: safeString(body.note ?? body.comment, { max: 1200, field: "nota" }),
    created_by: user.username,
    deleted_at: null,
    deleted_by: null,
  };

  const rows = await supabaseFetch("contacts?on_conflict=debtor_id,type,value", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
  const created = rows[0];
  await writeAudit(user, "upsert_contact", "contact", created.id, {
    after: publicContact(created),
  }, req);

  res.status(201).json({ ok: true, contact: publicContact(created) });
}

async function handlePatch(req, res) {
  const user = await requireUser(req, ["callcenter", "informatico"]);
  const body = parseBody(req);
  const before = await loadContact(body.id || req.query?.id);
  const debtor = await assertDebtorAccess(user, before.debtor_id, { write: true });

  const patch = {};
  const isSoftDelete = body.deleted === true || body.delete === true || body.action === "delete";
  if (isSoftDelete) {
    patch.deleted_at = new Date().toISOString();
    patch.deleted_by = user.username;
  } else {
    if (body.type !== undefined || body.value !== undefined) {
      const type = contactType(body.type || before.type);
      patch.type = type;
      patch.value = contactValue(type, body.value || before.value);
    }
    if (body.status !== undefined) patch.status = contactStatus(body.status);
    if (body.category !== undefined) patch.category = safeString(body.category, { max: 120, field: "categoria" });
    if (body.note !== undefined || body.comment !== undefined) patch.note = safeString(body.note ?? body.comment, { max: 1200, field: "nota" });
    patch.deleted_at = null;
    patch.deleted_by = null;
  }

  const rows = await supabaseFetch(`contacts?id=eq.${encodeURIComponent(before.id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const updated = rows[0];
  await writeAudit(user, isSoftDelete ? "soft_delete_contact" : "update_contact", "contact", updated.id, {
    before: publicContact(before),
    after: publicContact(updated),
    metadata: { debtor_id: debtor.id },
  }, req);

  res.status(200).json({ ok: true, contact: publicContact(updated) });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "POST") return await handlePost(req, res);
    if (req.method === "PATCH") return await handlePatch(req, res);
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
  } catch (error) {
    authErrorResponse(res, error);
  }
};
