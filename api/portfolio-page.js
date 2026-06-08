const { authErrorResponse, requireUser } = require("./_auth");
const { loadPortfolioPage } = require("./_data");
const { demoPortfolio } = require("./_demo");

function numberParam(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
    return;
  }

  try {
    const user = await requireUser(req, ["callcenter", "jefatura", "informatico"]);
    const filters = {
      q: req.query.q || "",
      state: req.query.state || "",
      assignment: req.query.assignment || "",
      minDebt: numberParam(req.query.minDebt, 0),
      maxDebt: numberParam(req.query.maxDebt, 0),
      limit: numberParam(req.query.limit, 120),
      offset: numberParam(req.query.offset, 0),
    };
    const data = user.demo
      ? demoPortfolio(user, filters)
      : await loadPortfolioPage(
        { role: user.role, username: user.username, assignment: user.assignmentName },
        filters,
      );
    res.status(200).json({ ok: true, data });
  } catch (error) {
    authErrorResponse(res, error);
  }
};
