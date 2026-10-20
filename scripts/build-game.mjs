// Builds the game into one self-contained page: dist/index.html.
// Also writes dist/embed.html, the same page without the <html>/<head>/<body>
// wrapper, for hosts that add their own.
import fs from "node:fs";
import * as esbuild from "esbuild";

const root = new URL("../", import.meta.url);
const out = await esbuild.build({
  entryPoints: [new URL("src/ui/app.js", root).pathname],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2020",
  write: false,
  legalComments: "none",
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = fs.readFileSync(new URL("game/template.html", root), "utf8").replace("/*__APP__*/", () => js);

fs.mkdirSync(new URL("dist/", root), { recursive: true });
fs.writeFileSync(new URL("dist/index.html", root), html);

const head = html.slice(html.indexOf("<title>"), html.indexOf("</head>"));
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
fs.writeFileSync(new URL("dist/embed.html", root), `${head}\n${body}`);
console.log(`Wrote dist/index.html (${Math.round(html.length / 1024)} KB)`);
