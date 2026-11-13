import { createHash } from "node:crypto";
import type { IndicatorTable, IndicatorTables } from "./tradingview.js";

const digest = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

export const PINE_SOURCE_HASH_SCHEMA = "pine_source_lf_v1";

/** Canonicalize CRLF only; preserve lone CR, BOM, whitespace and Unicode exactly. */
export function hashPineSource(source: string) {
  return digest(source.replace(/\r\n/g, "\n"));
}

export function withPineSourceHash<T extends { source: string }>(source: T) {
  return { ...source, sourceHashSchema: PINE_SOURCE_HASH_SCHEMA, sourceSha256: hashPineSource(source.source) };
}

/** The backend's verified flag means its readback matched the submitted, CRLF-normalized source. */
export function withPineSaveHashes<T extends {
  dryRun: boolean; saved?: boolean; verified?: boolean; pineId?: string | null; version?: string | null;
}>(result: T, submittedSource: string) {
  const submittedSourceSha256 = hashPineSource(submittedSource);
  const verifiedReadback = result.dryRun === false && result.saved === true && result.verified === true &&
    typeof result.pineId === "string" && /^USER;[\w]{8,64}$/.test(result.pineId) &&
    typeof result.version === "string" && /^[0-9]{1,6}(\.[0-9]{1,3})?$/.test(result.version);
  return { ...result, sourceHashSchema: PINE_SOURCE_HASH_SCHEMA, submittedSourceSha256,
    sourceSha256: verifiedReadback ? submittedSourceSha256 : null };
}

/** v1 hashes the returned text snapshot, including table identity, without whitespace/Unicode normalization. */
export function hashIndicatorTable(table: IndicatorTable) {
  const cells = table.rows * table.columns;
  const tooltips = [...(table.tooltips ?? [])].map(({ row, column, tooltip }) => ({ row, column, tooltip }))
    .sort((a, b) => a.row - b.row || a.column - b.column || (a.tooltip < b.tooltip ? -1 : a.tooltip > b.tooltip ? 1 : 0));
  const complete = !table.error && (typeof table.id === "string" || (typeof table.id === "number" && Number.isFinite(table.id))) &&
    Number.isInteger(table.rows) && table.rows > 0 && Number.isInteger(table.columns) && table.columns > 0 && cells <= 2000 &&
    Number.isInteger(table.cellCount) && table.cellCount > 0 && table.cellCount <= cells &&
    table.grid?.length === table.rows && table.grid.every((row) => row.length === table.columns &&
      row.every((text) => typeof text === "string" && text.length <= 200)) &&
    tooltips.length <= cells && tooltips.every((cell) => Number.isInteger(cell.row) && cell.row >= 0 && cell.row < table.rows &&
      Number.isInteger(cell.column) && cell.column >= 0 && cell.column < table.columns && typeof cell.tooltip === "string" && cell.tooltip.length <= 200);
  return { ...table, hashSchema: "indicator_table_v1", sha256: complete ? digest(JSON.stringify({
    id: table.id, position: table.position, rows: table.rows, columns: table.columns,
    cellCount: table.cellCount, grid: table.grid, tooltips,
  })) : null };
}

/** Decorate the single returned snapshot without rereading the chart. */
export function withIndicatorTableHashes(studies: IndicatorTables[]) {
  return studies.map((study) => ({ ...study, tables: study.tables.map((table) => {
    const hashed = hashIndicatorTable(table);
    return study.error ? { ...hashed, sha256: null } : hashed;
  }) }));
}
