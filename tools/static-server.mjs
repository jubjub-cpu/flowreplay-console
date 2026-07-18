import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const portFlag = process.argv.indexOf("--port");
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : process.env.PORT || 4192);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".png": "image/png" };

const server = createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relative = normalize(requested).replace(/^([/\\])+/, "");
  let path = join(root, relative || "index.html");
  if (!path.startsWith(root)) { response.writeHead(403); response.end("Forbidden"); return; }
  try { if (statSync(path).isDirectory()) path = join(path, "index.html"); } catch { response.writeHead(404); response.end("Not found"); return; }
  response.writeHead(200, { "Content-Type": types[extname(path).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(path).pipe(response);
});

server.listen(port, "127.0.0.1", () => console.log(`FlowReplay server ready at http://127.0.0.1:${port}/`));
