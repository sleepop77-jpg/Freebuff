import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 8787);

let latestState = null;
const clients = new Set();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > limit) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function safePublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const absolute = path.resolve(PUBLIC_DIR, relative);

  if (!absolute.startsWith(PUBLIC_DIR + path.sep)) {
    return null;
  }

  return absolute;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        name: "PixelForge",
        version: "0.1.0",
        clients: clients.size
      });
    }

    if (req.method === "GET" && url.pathname === "/api/capabilities") {
      return sendJson(res, 200, {
        name: "PixelForge Agent API",
        protocol: "pixelforge-command-v1",
        commands: [
          "new_project",
          "set_pixel",
          "set_pixels",
          "fill",
          "fill_rect",
          "clear",
          "add_frame",
          "duplicate_frame",
          "delete_frame",
          "select_frame",
          "set_frame_duration",
          "add_layer",
          "delete_layer",
          "select_layer",
          "set_layer_visibility",
          "set_onion_skin",
          "set_grid",
          "play",
          "stop",
          "export_sprite_sheet",
          "export_project"
        ]
      });
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      return sendJson(res, 200, {
        ok: true,
        state: latestState
      });
    }

    if (req.method === "POST" && url.pathname === "/api/command") {
      const body = await readBody(req);
      let command;

      try {
        command = JSON.parse(body);
      } catch {
        return sendJson(res, 400, {
          ok: false,
          error: "Invalid JSON."
        });
      }

      if (!command || typeof command !== "object" || typeof command.command !== "string") {
        return sendJson(res, 400, {
          ok: false,
          error: 'Command must be an object containing a "command" string.'
        });
      }

      const id = command.id || crypto.randomUUID();

      broadcast({
        type: "agent_command",
        id,
        command
      });

      return sendJson(res, 200, {
        ok: true,
        id,
        accepted: true,
        connectedEditors: clients.size
      });
    }

    if (req.method === "POST" && url.pathname === "/api/state") {
      const body = await readBody(req);

      try {
        latestState = JSON.parse(body);
      } catch {
        return sendJson(res, 400, {
          ok: false,
          error: "Invalid JSON state."
        });
      }

      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
      });
      return res.end();
    }

    if (req.method === "GET") {
      const filePath = safePublicPath(url.pathname);

      if (!filePath) {
        return sendJson(res, 403, { error: "Forbidden." });
      }

      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          return sendJson(res, 404, { error: "Not found." });
        }

        const ext = path.extname(filePath);
        res.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Cache-Control": "no-cache"
        });

        fs.createReadStream(filePath).pipe(res);
      });

      return;
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message
    });
  }
});

const wss = new WebSocketServer({ server });

wss.on("connection", socket => {
  clients.add(socket);

  socket.send(JSON.stringify({
    type: "connection",
    ok: true,
    protocol: "pixelforge-command-v1"
  }));

  if (latestState) {
    socket.send(JSON.stringify({
      type: "state_snapshot",
      state: latestState
    }));
  }

  socket.on("message", raw => {
    try {
      const message = JSON.parse(raw.toString());

      if (message.type === "state") {
        latestState = message.state;
      }

      broadcast(message);
    } catch {
      socket.send(JSON.stringify({
        type: "error",
        error: "Invalid WebSocket message."
      }));
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
  });

  socket.on("error", () => {
    clients.delete(socket);
  });
});

server.listen(PORT, () => {
  console.log(`PixelForge running at http://localhost:${PORT}`);
  console.log(`Agent API: POST http://localhost:${PORT}/api/command`);
});
===== END FILE =====
