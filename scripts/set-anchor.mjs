// Set the day's S/R anchor (the open OR yesterday's close) that the 5-year
// level engine classifies levels around. Run each morning once the user gives
// the number, then (re)start the stream so seeding picks it up.
//
//   npm run levels:anchor -- 23446.5 open
//   npm run levels:anchor -- 23431.5 prevClose
import fs from "node:fs";
import path from "node:path";

const [, , anchorArg, typeArg] = process.argv;
const anchor = Number(anchorArg);
const type = typeArg;

if (!Number.isFinite(anchor) || (type !== "open" && type !== "prevClose")) {
  console.error("usage: npm run levels:anchor -- <price> <open|prevClose>");
  process.exit(1);
}

const date = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const dir = path.join(process.cwd(), "data");
fs.mkdirSync(dir, { recursive: true });
const payload = { date, anchor, type };
fs.writeFileSync(path.join(dir, "sr-anchor.json"), JSON.stringify(payload, null, 2));
console.log("anchor set:", JSON.stringify(payload));
