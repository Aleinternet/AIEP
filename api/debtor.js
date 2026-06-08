const { loadDebtorByRut } = require("./_data");
const { demoDebtorByRut } = require("./_demo");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
    return;
  }

  try {
    const debtor = demoDebtorByRut(req.query.rut || "") || await loadDebtorByRut(req.query.rut || "");
    if (!debtor) {
      res.status(404).json({ ok: false, error: "RUT no encontrado" });
      return;
    }
    res.status(200).json({ ok: true, debtor });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Error interno" });
  }
};
