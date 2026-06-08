const { authErrorResponse, requireUser } = require("./_auth");
const { loadPortfolio, loadPortfolioPage } = require("./_data");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
    return;
  }

  try {
    const user = await requireUser(req, ["callcenter", "jefatura", "informatico"]);
    const context = { role: user.role, username: user.username, assignment: user.assignmentName };
    const data = user.role === "informatico"
      ? await loadPortfolioPage(context, { limit: 120, offset: 0 })
      : await loadPortfolio(context);
    res.status(200).json({ ok: true, role: user.role, user, data });
  } catch (error) {
    authErrorResponse(res, error);
  }
};
