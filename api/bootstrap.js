const { loadPortfolio, loadInternalUser, normalizeUsername } = require("./_data");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
    return;
  }

  try {
    const { user, pass } = req.body || {};
    const normalizedUser = normalizeUsername(user || "");
    const dbUser = await loadInternalUser(normalizedUser, pass);
    if (dbUser) {
      const apiRole = dbUser.role === "callcenter" ? "callcenter" : dbUser.role;
      const data = await loadPortfolio({ role: apiRole, username: dbUser.username, assignment: dbUser.assignmentName });
      res.status(200).json({ ok: true, role: dbUser.role, user: dbUser, data });
      return;
    }

    const isJefatura = normalizedUser === "remesa" && pass === "654321";
    const isInformatico = (normalizedUser === "informatico" || normalizedUser === "informatica") && pass === "789012";
    if (!isJefatura && !isInformatico) {
      res.status(401).json({ ok: false, error: "Credenciales invalidas" });
      return;
    }

    const role = isJefatura ? "jefatura" : "informatico";
    const data = await loadPortfolio({ role, username: normalizedUser });
    res.status(200).json({ ok: true, role, data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Error interno" });
  }
};
