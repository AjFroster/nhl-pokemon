// Serves dist/ at http://localhost:4173 so the game can save to browser storage.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const dir = new URL("../dist/", import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(dir, url.endsWith("/") ? `${url}index.html` : url);
    if (!file.startsWith(dir) || !fs.existsSync(file)) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`Pokémon NHL is running at http://localhost:${port}`));
