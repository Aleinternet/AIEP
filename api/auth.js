const { authErrorResponse, requireUser } = require("./_auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Metodo no permitido" });
    return;
  }

  try {
    const authUser = await requireUser(req);
    res.status(200).json({ ok: true, role: authUser.role, user: authUser });
  } catch (error) {
    authErrorResponse(res, error);
  }
};
