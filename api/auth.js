const { loadInternalUser, normalizeUsername } = require("./_data");

function baseCloudUser(username, pass) {
  const isJefatura = username === "remesa" && pass === "654321";
  const isInformatico = (username === "informatico" || username === "informatica") && pass === "789012";
  if (!isJefatura && !isInformatico) return null;
  const role = isJefatura ? "jefatura" : "informatico";
  return {
    username,
    displayName: username,
    role,
    assignmentName: "",
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
    return;
  }

  try {
    const { user, pass } = req.body || {};
    const normalizedUser = normalizeUsername(user || "");
    const dbUser = await loadInternalUser(normalizedUser, pass);
    const authUser = dbUser || baseCloudUser(normalizedUser, pass);

    if (!authUser) {
      res.status(401).json({ ok: false, error: "Credenciales invalidas" });
      return;
    }

    res.status(200).json({ ok: true, role: authUser.role, user: authUser });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Error interno" });
  }
};
