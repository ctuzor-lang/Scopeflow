import ExcelJS from "exceljs";
import { Unzip, UnzipInflate, strFromU8 } from "fflate";

/**
 * Reads an agreed scope from a spreadsheet (Excel .xlsx or .csv).
 * Column names are matched loosely so most existing scope sheets work as they are.
 */

export const KINDS = ["deliverable", "requirement", "assumption", "exclusion"] as const;
export type Kind = (typeof KINDS)[number];

export type ScopeRow = {
  key: string | null;
  title: string;
  description: string | null;
  section: string | null;
  kind: Kind;
  acceptanceCriteria: string | null;
};

export type ParseResult = { ok: true; rows: ScopeRow[] } | { ok: false; errors: string[] };

const HEADER_ALIASES: Record<keyof ScopeRow, string[]> = {
  key: ["ref", "reference", "id", "key", "item id", "req id", "requirement id", "no", "number", "#"],
  title: ["title", "item", "requirement", "name", "summary", "feature", "deliverable"],
  description: ["description", "detail", "details", "notes", "scope"],
  section: ["section", "area", "category", "module", "workstream", "epic", "group"],
  kind: ["type", "kind", "item type"],
  acceptanceCriteria: ["acceptance criteria", "acceptance", "criteria", "done when", "definition of done"],
};

const KIND_ALIASES: Record<string, Kind> = {
  deliverable: "deliverable",
  deliverables: "deliverable",
  requirement: "requirement",
  requirements: "requirement",
  feature: "requirement",
  functional: "requirement",
  "non-functional": "requirement",
  assumption: "assumption",
  assumptions: "assumption",
  exclusion: "exclusion",
  exclusions: "exclusion",
  "out of scope": "exclusion",
  excluded: "exclusion",
};

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const clean = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase().replace(/[:*]$/, "");

export function normaliseKey(raw: string): string | null {
  const key = raw.trim().toUpperCase().replace(/\s+/g, "-");
  return /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(key) ? key : null;
}

/** Splits CSV text into rows, handling quoted fields, doubled quotes and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return String(value.text);
    if ("result" in value) return value.result === undefined ? "" : String(value.result);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value);
}

const MAX_UNZIPPED_BYTES = 25 * 1024 * 1024;
const MAX_IMPORT_COLUMNS = 50;

class ImportTooLarge extends Error {}

/**
 * ExcelJS builds the whole workbook in memory, so a tiny file can expand into gigabytes
 * (security review F2). Before handing it over, inflate everything with a hard byte limit
 * and check the worksheets don't reach beyond the rows and columns we accept.
 */
function preflightXlsx(data: Buffer) {
  let total = 0;
  const sheetChunks: Uint8Array[] = [];
  const unzip = new Unzip((file) => {
    const isSheet = /^xl\/worksheets\/[^/]+\.xml$/.test(file.name);
    file.ondata = (err, chunk) => {
      if (err) throw err;
      total += chunk.length;
      if (total > MAX_UNZIPPED_BYTES) throw new ImportTooLarge();
      if (isSheet) sheetChunks.push(chunk);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), true);

  const xml = strFromU8(concatChunks(sheetChunks));
  const cells = xml.match(/<c[\s>]/g)?.length ?? 0;
  if (cells > (MAX_IMPORT_ROWS + 1) * MAX_IMPORT_COLUMNS) throw new ImportTooLarge();
  for (const m of xml.matchAll(/<c[^>]*\sr="([A-Z]{1,3})(\d+)"/g)) {
    if (columnNumber(m[1]) > MAX_IMPORT_COLUMNS || Number(m[2]) > MAX_IMPORT_ROWS + 50) throw new ImportTooLarge();
  }
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function columnNumber(letters: string): number {
  return [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
}

async function readXlsx(data: Buffer): Promise<string[][]> {
  preflightXlsx(data);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (r) => {
    const cells: string[] = [];
    for (let c = 1; c <= Math.min(r.cellCount, MAX_IMPORT_COLUMNS); c++) cells.push(cellText(r.getCell(c).value));
    if (cells.some((x) => x.trim() !== "")) rows.push(cells);
  });
  return rows;
}

/** Turns raw table rows (first row = headers) into validated scope rows. */
export function rowsToScope(table: string[][]): ParseResult {
  if (table.length < 2) return { ok: false, errors: ["The file needs a header row and at least one item."] };
  const headers = table[0].map(clean);
  const col: Partial<Record<keyof ScopeRow, number>> = {};
  (Object.keys(HEADER_ALIASES) as (keyof ScopeRow)[]).forEach((field) => {
    const idx = headers.findIndex((h) => HEADER_ALIASES[field].includes(h));
    if (idx >= 0) col[field] = idx;
  });
  if (col.title === undefined) {
    return {
      ok: false,
      errors: [`No title column found. Name one of the columns "Title" (found: ${table[0].filter(Boolean).join(", ")}).`],
    };
  }
  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) return { ok: false, errors: [`Import up to ${MAX_IMPORT_ROWS} items at a time.`] };

  const errors: string[] = [];
  const seen = new Map<string, number>();
  const rows: ScopeRow[] = [];
  const get = (r: string[], f: keyof ScopeRow) => (col[f] === undefined ? "" : (r[col[f]!] ?? "").trim());

  body.forEach((r, i) => {
    const line = i + 2; // spreadsheet row number, counting the header
    const title = get(r, "title");
    const rawKey = get(r, "key");
    const rawKind = clean(get(r, "kind"));
    if (!title) {
      errors.push(`Row ${line}: the title is empty.`);
      return;
    }
    if (title.length > 300) errors.push(`Row ${line}: the title is longer than 300 characters.`);
    let key: string | null = null;
    if (rawKey) {
      key = normaliseKey(rawKey);
      if (!key) errors.push(`Row ${line}: "${rawKey}" can't be used as a reference (letters, numbers, - . _ only, up to 32).`);
      else if (seen.has(key)) errors.push(`Row ${line}: reference ${key} is also used on row ${seen.get(key)}.`);
      else seen.set(key, line);
    }
    let kind: Kind = "requirement";
    if (rawKind) {
      const k = KIND_ALIASES[rawKind];
      if (!k) errors.push(`Row ${line}: type "${get(r, "kind")}" isn't one of deliverable, requirement, assumption or exclusion.`);
      else kind = k;
    }
    const description = get(r, "description") || null;
    const acceptanceCriteria = get(r, "acceptanceCriteria") || null;
    if ((description?.length ?? 0) > 5000 || (acceptanceCriteria?.length ?? 0) > 5000) {
      errors.push(`Row ${line}: description or acceptance criteria is longer than 5,000 characters.`);
    }
    rows.push({ key, title, description, section: get(r, "section") || null, kind, acceptanceCriteria });
  });

  if (errors.length) return { ok: false, errors: errors.slice(0, 20).concat(errors.length > 20 ? [`…and ${errors.length - 20} more.`] : []) };
  return { ok: true, rows };
}

export async function parseScopeFile(fileName: string, data: Buffer): Promise<ParseResult> {
  if (data.length === 0) return { ok: false, errors: ["The file is empty."] };
  if (data.length > MAX_IMPORT_BYTES) return { ok: false, errors: ["Files must be 5 MB or smaller."] };
  const isZip = data[0] === 0x50 && data[1] === 0x4b; // .xlsx files are zip archives
  try {
    if (isZip) return rowsToScope(await readXlsx(data));
    if (/\.csv$/i.test(fileName) || !isZip) return rowsToScope(parseCsv(data.toString("utf8")));
  } catch (err) {
    if (err instanceof ImportTooLarge) {
      return { ok: false, errors: [`That spreadsheet is too large. Import up to ${MAX_IMPORT_ROWS} rows and ${MAX_IMPORT_COLUMNS} columns from the first sheet.`] };
    }
    return { ok: false, errors: ["That file couldn't be read. Save it as .xlsx or .csv and try again."] };
  }
  return { ok: false, errors: ["Upload an Excel (.xlsx) or CSV file."] };
}

export const TEMPLATE_CSV = [
  "Ref,Section,Type,Title,Description,Acceptance criteria",
  'CP-01,Checkout & payments,Requirement,Card payments through one provider,"Single tender per order","Payment succeeds for Visa, Mastercard and Amex in test mode"',
  "CP-02,Checkout & payments,Deliverable,Order confirmation email,Sent on successful payment,Email received within 1 minute",
  "AS-01,Assumptions,Assumption,Client provides payment provider sandbox access,,",
  "EX-01,Exclusions,Exclusion,In-store tills,Out of scope for this phase,",
].join("\r\n");
