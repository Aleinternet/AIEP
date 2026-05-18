const { loadPortfolio } = require("./_data");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
    return;
  }

  try {
    const { user, pass } = req.body || {};
    const normalizedUser = String(user || "").toLowerCase();
    const isCallCenter = normalizedUser === "callcenter" && pass === "123456";
    const isJefatura = normalizedUser === "remesa" && pass === "654321";
    if (!isCallCenter && !isJefatura) {
      res.status(401).json({ ok: false, error: "Credenciales invalidas" });
      return;
    }

    const data = await loadPortfolio();
    res.status(200).json({ ok: true, data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Error interno" });
  }
};
