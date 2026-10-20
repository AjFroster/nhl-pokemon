// Builds dist/scouting-board.html: one self-contained page with the ratings code and data inlined.
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

const ratings = read("src/ratings.js").replace(/^export /gm, "");
const data = read("data/pokedex.json");
const html = read("board/template.html")
  .replace("/*__RATINGS__*/", () => ratings)
  .replace("/*__DATA__*/", () => data);

fs.mkdirSync(new URL("dist/", root), { recursive: true });
fs.writeFileSync(new URL("dist/scouting-board.html", root), html);
console.log("Wrote dist/scouting-board.html");
