const { authErrorResponse, requireUser } = require("./_auth");
const { writeAudit } = require("./_audit");
const { loadDebtorFromInput } = require("./_debtors");
const { assertDebtorAccess } = require("./_permissions");
const { supabaseFetch } = require("./_data");
const { safeString, uuid } = require("./_validators");
const { canSeeDemoDebtor, demoCommentsForDebtor, demoDebtorFromInput } = require("./_demo");

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

function publicComment(row) {
  return {
    id: row.id,
    debtorId: row.debtor_id,
    parentId: row.parent_id || null,
    body: row.body || "",
    user: row.created_by_username || "",
    deletedAt: row.deleted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadComment(id) {
  const cleanId = uuid(id, { required: true, field: "comentario" });
  const rows = await supabaseFetch(`internal_comments?select=*&id=eq.${encodeURIComponent(cleanId)}&limit=1`);
  if (!rows.length) {
    const error = new Error("Comentario no encontrado.");
    error.statusCode = 404;
    error.code = "comment_not_found";
    throw error;
  }
  return rows[0];
}

async function handleGet(req, res) {
  const user = await requireUser(req, ["callcenter", "jefatura", "informatico"]);
  if (user.demo) {
    const debtor = demoDebtorFromInput(req.query || {});
    if (!debtor) return res.status(404).json({ ok: false, error: "Deudor demo no encontrado" });
    if (!canSeeDemoDebtor(user, debtor)) return res.status(403).json({ ok: false, error: "No autorizado para este deudor demo" });
    return res.status(200).json({ ok: true, debtor_id: debtor.id, comments: demoCommentsForDebtor(debtor).map(publicComment) });
  }
  const debtor = await loadDebtorFromInput(req.query || {});
  await assertDebtorAccess(user, debtor);
  const rows = await supabaseFetch(
    `internal_comments?select=*&debtor_id=eq.${encodeURIComponent(debtor.id)}&deleted_at=is.null&order=created_at.desc`,
  );
  res.status(200).json({ ok: true, debtor_id: debtor.id, comments: rows.map(publicComment) });
}

async function handlePost(req, res) {
  const user = await requireUser(req, ["callcenter", "informatico"]);
  const body = parseBody(req);
  if (user.demo) {
    const debtor = demoDebtorFromInput(body);
    if (!debtor) return res.status(404).json({ ok: false, error: "Deudor demo no encontrado" });
    if (!canSeeDemoDebtor(user, debtor)) return res.status(403).json({ ok: false, error: "No autorizado para este deudor demo" });
    const created = {
      id: `demo-comment-${Date.now()}`,
      debtor_id: debtor.id,
      parent_id: body.parent_id || body.parentId || null,
      body: safeString(body.body ?? body.text, { max: 4000, required: true, field: "comentario" }),
      created_by_username: user.username,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return res.status(201).json({ ok: true, demo: true, comment: publicComment(created) });
  }
  const debtor = await loadDebtorFromInput(body);
  await assertDebtorAccess(user, debtor, { write: true });

  let parentId = null;
  if (body.parent_id || body.parentId) {
    const parent = await loadComment(body.parent_id || body.parentId);
    if (parent.debtor_id !== debtor.id) {
      const error = new Error("Comentario padre no pertenece al deudor.");
      error.statusCode = 400;
      error.code = "parent_comment_invalid";
      throw error;
    }
    parentId = parent.id;
  }

  const payload = {
    debtor_id: debtor.id,
    parent_id: parentId,
    body: safeString(body.body ?? body.text, { max: 4000, required: true, field: "comentario" }),
    created_by_username: user.username,
  };
  const rows = await supabaseFetch("internal_comments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const created = rows[0];
  await writeAudit(user, "create_internal_comment", "internal_comment", created.id, {
    after: publicComment(created),
  }, req);

  res.status(201).json({ ok: true, comment: publicComment(created) });
}

async function handlePatch(req, res) {
  const user = await requireUser(req, ["callcenter", "informatico"]);
  const body = parseBody(req);
  if (user.demo) {
    const updated = {
      id: body.id || req.query?.id || `demo-comment-${Date.now()}`,
      debtor_id: body.debtor_id || body.debtorId || "",
      parent_id: body.parent_id || body.parentId || null,
      body: safeString(body.body ?? body.text ?? "Comentario demo", { max: 4000, field: "comentario" }),
      created_by_username: user.username,
      deleted_at: body.deleted === true || body.delete === true || body.action === "delete" ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return res.status(200).json({ ok: true, demo: true, comment: publicComment(updated) });
  }
  const before = await loadComment(body.id || req.query?.id);
  const debtor = await assertDebtorAccess(user, before.debtor_id, { write: true });
  const isSoftDelete = body.deleted === true || body.delete === true || body.action === "delete";
  const patch = isSoftDelete
    ? { deleted_at: new Date().toISOString(), deleted_by: user.username }
    : { body: safeString(body.body ?? body.text, { max: 4000, required: true, field: "comentario" }) };

  const rows = await supabaseFetch(`internal_comments?id=eq.${encodeURIComponent(before.id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const updated = rows[0];
  await writeAudit(user, isSoftDelete ? "soft_delete_internal_comment" : "update_internal_comment", "internal_comment", updated.id, {
    before: publicComment(before),
    after: publicComment(updated),
    metadata: { debtor_id: debtor.id },
  }, req);

  res.status(200).json({ ok: true, comment: publicComment(updated) });
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
