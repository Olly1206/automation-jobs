// Offline reference deliverable. Node standard library only; no model or API calls.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parseCsv(source) {
  const records = [];
  let row = [], field = "", quoted = false, closed = false;
  source = source.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === '"') {
      if (field || closed) throw new Error("Malformed CSV quoting");
      quoted = true;
    } else if (char === ",") {
      row.push(field); field = ""; closed = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field); records.push(row); row = []; field = ""; closed = false;
    } else {
      if (closed) throw new Error("Unexpected content after CSV quote");
      field += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (field || row.length || closed) { row.push(field); records.push(row); }
  return records;
}

function normalizedDate(text) {
  const iso = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(text);
  const european = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!iso && !european) return undefined;
  const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(european[3]), Number(european[2]), Number(european[1])];
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}
function serialize(rows) {
  return rows.map((row) => row.map((cell) => /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(",")).join("\n") + "\n";
}

export function cleanCsv(source) {
  const [header, ...input] = parseCsv(source);
  if (JSON.stringify(header) !== JSON.stringify(["id", "date", "customer", "amount"])) throw new Error("Expected id,date,customer,amount columns");
  const cleaned = [], rejected = [], seen = new Set();
  let duplicates = 0;
  for (const raw of input) {
    if (raw.length !== header.length) throw new Error("Malformed CSV row");
    const row = raw.map((cell) => cell.trim());
    const date = normalizedDate(row[1]);
    if (!date) { rejected.push([...row, "invalid or missing date"]); continue; }
    row[1] = date;
    const key = JSON.stringify(row);
    if (seen.has(key)) duplicates++;
    else { seen.add(key); cleaned.push(row); }
  }
  return {
    cleaned: serialize([header, ...cleaned]), rejected: serialize([[...header, "reason"], ...rejected]),
    summary: `# CSV cleanup\n\nInput rows: ${input.length}\nClean rows: ${cleaned.length}\nDuplicates removed: ${duplicates}\nRejected rows: ${rejected.length}\n\nDates use YYYY-MM-DD. Invalid or missing dates are listed in rejected.csv.\n`,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error("Usage: node cleanup.mjs input.csv output-directory");
  const result = cleanCsv(fs.readFileSync(input, "utf8"));
  fs.mkdirSync(output, { recursive: true });
  for (const [name, content] of [["cleaned.csv", result.cleaned], ["rejected.csv", result.rejected], ["summary.md", result.summary]]) {
    fs.writeFileSync(path.join(output, name), content, "utf8");
  }
}
