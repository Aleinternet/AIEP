const { authErrorResponse, requireUser } = require("./_auth");
const { writeAudit } = require("./_audit");
const { loadDebtorFromInput } = require("./_debtors");
const { assertDebtorAccess } = require("./_permissions");
const { supabaseFetch } = require("./_data");
const { optionalDate, safeString } = require("./_validators");

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

function publicEntry(row) {
  return {
    id: row.id,
    debtorId: row.debtor_id,
    date: row.management_date,
    channel: row.channel || "",
    result: row.result || "",
    comment: row.comment || "",
    user: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function handleGet(req, res) {
  const user = await requireUser(req, ["callcenter", "jefatura", "informatico"]);
  const debtor = await loadDebtorFromInput(req.query || {});
  await assertDebtorAccess(user, debtor);
  const rows = await supabaseFetch(
    `management_entries?select=*&debtor_id=eq.${encodeURIComponent(debtor.id)}&deleted_at=is.null&order=management_date.desc,created_at.desc`,
  );
  res.status(200).json({ ok: true, debtor_id: debtor.id, entries: rows.map(publicEntry) });
}

async function handlePost(req, res) {
  const user = await requireUser(req, ["callcenter", "informatico"]);
  const body = parseBody(req);
  const debtor = await loadDebtorFromInput(body);
  await assertDebtorAccess(user, debtor, { write: true });

  const managementDate = optionalDate(body.management_date || body.date, "fecha gestion");
  const payload = {
    debtor_id: debtor.id,
    channel: safeString(body.channel, { max: 80, field: "canal" }),
    result: safeString(body.result, { max: 200, field: "resultado" }),
    comment: safeString(body.comment, { max: 4000, field: "comentario" }),
    created_by: user.username,
  };
  if (managementDate) payload.management_date = managementDate;

  const rows = await supabaseFetch("management_entries", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const created = rows[0];
  await writeAudit(user, "create_management_entry", "management_entry", created.id, {
    after: {
      id: created.id,
      debtor_id: created.debtor_id,
      management_date: created.management_date,
      channel: created.channel,
      result: created.result,
    },
  }, req);

  res.status(201).json({ ok: true, entry: publicEntry(created) });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "POST") return await handlePost(req, res);
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
  } catch (error) {
    authErrorResponse(res, error);
  }
};
