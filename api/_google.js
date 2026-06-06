const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let cachedToken = null;

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function googleCredentials() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error("Faltan GOOGLE_SERVICE_ACCOUNT_EMAIL o GOOGLE_PRIVATE_KEY en Vercel.");
  return {
    email,
    privateKey: rawKey.replace(/\\n/g, "\n"),
  };
}

async function googleAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.accessToken;

  const crypto = require("crypto");
  const { email, privateKey } = googleCredentials();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: email,
    scope: SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(privateKey).toString("base64url");
  const assertion = `${unsigned}.${signature}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error_description || json.error || `Google token HTTP ${response.status}`);

  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

async function sheetsRequest(path, options = {}) {
  const token = await googleAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error?.message || `Google Sheets HTTP ${response.status}`);
  return json;
}

async function getValues(spreadsheetId, range) {
  const encodedRange = encodeURIComponent(range);
  const json = await sheetsRequest(`${spreadsheetId}/values/${encodedRange}?valueRenderOption=FORMATTED_VALUE`);
  return json.values || [];
}

async function updateValues(spreadsheetId, range, values) {
  return sheetsRequest(`${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
}

function columnLetter(index) {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    output = String.fromCharCode(65 + mod) + output;
    value = Math.floor((value - mod) / 26);
  }
  return output;
}

module.exports = {
  getValues,
  updateValues,
  columnLetter,
};
