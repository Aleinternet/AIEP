const { supabaseFetch } = require("./_data");

const SENSITIVE_KEY = /(pass|password|token|secret|private|key|authorization|cookie)/i;

function safeValue(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeValue(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : safeValue(nestedValue, depth + 1);
    }
    return output;
  }
  if (typeof value === "string" && value.length > 4000) return `${value.slice(0, 4000)}...[truncated]`;
  return value;
}

function requestMetadata(req) {
  const headers = req?.headers || {};
  const forwardedFor = headers["x-forwarded-for"] || headers["X-Forwarded-For"] || "";
  const ip = String(forwardedFor).split(",")[0].trim() || req?.socket?.remoteAddress || "";
  const userAgent = headers["user-agent"] || headers["User-Agent"] || "";
  return {
    ip,
    userAgent,
  };
}

async function writeAudit(user, action, entityType, entityId, payload = {}, req = null) {
  try {
    const metadata = {
      ...(payload.metadata || {}),
      ...(req ? requestMetadata(req) : {}),
      actor: {
        id: user?.id || null,
        username: user?.username || "",
        role: user?.role || "",
        assignmentName: user?.assignmentName || user?.assignment_name || "",
      },
    };
    await supabaseFetch("audit_log", {
      method: "POST",
      body: JSON.stringify({
        actor_id: null,
        action,
        entity_type: entityType,
        entity_id: entityId ? String(entityId) : null,
        payload: safeValue({
          before: payload.before || null,
          after: payload.after || null,
          metadata,
        }),
      }),
    });
  } catch (error) {
    console.error(`audit_log insert failed: ${error.message || "unknown error"}`);
  }
}

module.exports = {
  writeAudit,
};
