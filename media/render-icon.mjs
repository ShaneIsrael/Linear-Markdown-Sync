// Rasterizes media/icon.svg -> media/icon.png at 256x256.
// Requires @resvg/resvg-js (install transiently: npm i --no-save @resvg/resvg-js).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, "icon.svg"), "utf8");
const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 256 } });
const png = resvg.render().asPng();
writeFileSync(join(here, "icon.png"), png);
console.log(`Wrote media/icon.png (${png.length} bytes)`);
