const http = require("http");

const PORT = process.env.PORT || 4599;
const JSON_HEADER = { "Content-Type": "application/json" };
const IMPORT_PATH = "/api/v1/admin/accounts/import/codex-session";

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== IMPORT_PATH) {
    res.writeHead(404, JSON_HEADER);
    return res.end(JSON.stringify({ code: 404, message: "not found" }));
  }

  if (req.headers["x-api-key"] !== "synthetic-admin-key") {
    res.writeHead(401, JSON_HEADER);
    return res.end(JSON.stringify({ code: 401, message: "Invalid admin API key" }));
  }

  const body = await readJson(req);
  if (!Array.isArray(body.contents) || body.update_existing !== true) {
    res.writeHead(400, JSON_HEADER);
    return res.end(JSON.stringify({ code: 400, message: "invalid import payload" }));
  }

  const items = body.contents.map((content, offset) => {
    try {
      const session = JSON.parse(content);
      if (session.auth_mode !== "chatgpt" || !session.tokens?.access_token) {
        throw new Error("invalid Codex session");
      }
      return { index: offset + 1, action: "created", account_id: offset + 100 };
    } catch {
      return { index: offset + 1, action: "failed", message: "invalid Codex session" };
    }
  });
  const failed = items.filter((item) => item.action === "failed").length;
  res.writeHead(200, JSON_HEADER);
  res.end(JSON.stringify({
    code: 0,
    message: "success",
    data: {
      total: items.length,
      created: items.length - failed,
      updated: 0,
      skipped: 0,
      failed,
      items,
      warnings: [],
      errors: [],
    },
  }));
});

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

server.listen(PORT, "127.0.0.1");
