/**
 * Deliberately narrow BIFF8 reader for RBA's fixed F1 historical workbook.
 * It accepts only the compound-document shape and numeric cells needed for
 * the public Data sheet; this avoids adding a broad legacy-XLS dependency.
 */
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;

export type RbaHistoricalF1Series = {
  changes: Array<{ observation_date: string; value: number }>;
  source_observation_count: number;
  source_first_observation_date: string;
  source_last_observation_date: string;
};

export function parseRbaHistoricalF1Xls(raw: Buffer): RbaHistoricalF1Series {
  const workbook = readWorkbookStream(raw);
  const dataSheetOffset = findDataSheetOffset(workbook);
  const sharedStrings = readSharedStrings(workbook);
  const rows = new Map<number, Map<number, number>>();
  const labels: Array<{ row: number; column: number; value: string }> = [];
  for (let offset = dataSheetOffset; offset < workbook.length;) {
    const { id, payload, nextOffset } = readBiffRecord(workbook, offset);
    offset = nextOffset;
    if (id === 0x000a) break;
    if (id === 0x0203) addNumberCell(rows, payload);
    else if (id === 0x027e) addRkCell(rows, payload);
    else if (id === 0x00bd) addMulRkCells(rows, payload);
    else if (id === 0x00fd) labels.push(readLabelSstCell(payload, sharedStrings));
  }
  const targetColumns = labels.filter((label) => label.value === "FIRMMCRTD").map((label) => label.column);
  if (targetColumns.length !== 1) throw new Error("RBA historical F1 workbook does not identify exactly one FIRMMCRTD column");
  const targetColumn = targetColumns[0];
  if (targetColumn === undefined) throw new Error("RBA historical F1 workbook is missing the FIRMMCRTD column");
  const observations: Array<{ observation_date: string; value: number }> = [];
  for (const cells of rows.values()) {
    const serialDate = cells.get(0);
    const value = cells.get(targetColumn);
    if (serialDate === undefined || value === undefined || !Number.isInteger(serialDate) || serialDate < 20_000 || serialDate > 50_000) continue;
    const observation_date = excelDateToIso(serialDate);
    if (value < -10 || value > 100 || !Number.isFinite(value)) throw new Error("RBA historical F1 workbook has an invalid cash-rate target");
    observations.push({ observation_date, value });
  }
  observations.sort((left, right) => left.observation_date.localeCompare(right.observation_date));
  if (observations.length < 5_000) throw new Error(`RBA historical F1 workbook has too few daily observations (${observations.length})`);
  if (observations[0]?.observation_date !== "1990-08-02" || observations.at(-1)?.observation_date !== "2010-12-31") throw new Error("RBA historical F1 workbook coverage no longer matches the reviewed source");
  let priorDate: string | null = null;
  let priorValue: number | null = null;
  const changes: Array<{ observation_date: string; value: number }> = [];
  for (const observation of observations) {
    if (priorDate !== null && observation.observation_date <= priorDate) throw new Error("RBA historical F1 workbook observations are not strictly ordered");
    priorDate = observation.observation_date;
    if (priorValue === observation.value) continue;
    changes.push(observation);
    priorValue = observation.value;
  }
  const first = observations[0];
  const last = observations.at(-1);
  if (first === undefined || last === undefined) throw new Error("RBA historical F1 workbook has no observations");
  return { changes, source_observation_count: observations.length, source_first_observation_date: first.observation_date, source_last_observation_date: last.observation_date };
}

function readSharedStrings(workbook: Buffer): string[] {
  for (let offset = 0; offset < workbook.length;) {
    const record = readBiffRecord(workbook, offset);
    offset = record.nextOffset;
    if (record.id !== 0x00fc) {
      if (record.id === 0x000a) break;
      continue;
    }
    let payload = record.payload;
    while (offset < workbook.length) {
      const continuation = readBiffRecord(workbook, offset);
      if (continuation.id !== 0x003c) break;
      payload = Buffer.concat([payload, continuation.payload]);
      offset = continuation.nextOffset;
    }
    if (payload.length < 8) throw new Error("RBA historical F1 workbook has an invalid shared-string table");
    const count = payload.readUInt32LE(4);
    const output: string[] = [];
    let cursor = 8;
    for (let index = 0; index < count; index += 1) {
      if (cursor + 3 > payload.length) throw new Error("RBA historical F1 workbook has a truncated shared string");
      const length = payload.readUInt16LE(cursor);
      const flags = payload[cursor + 2];
      cursor += 3;
      if (flags === undefined || (flags & ~0x01) !== 0) throw new Error("RBA historical F1 workbook uses unsupported shared-string formatting");
      const bytes = length * ((flags & 0x01) === 0 ? 1 : 2);
      if (cursor + bytes > payload.length) throw new Error("RBA historical F1 workbook has a shared string spanning an unsupported continuation");
      output.push(payload.subarray(cursor, cursor + bytes).toString((flags & 0x01) === 0 ? "latin1" : "utf16le"));
      cursor += bytes;
    }
    return output;
  }
  throw new Error("RBA historical F1 workbook is missing its shared-string table");
}

function readWorkbookStream(raw: Buffer): Buffer {
  if (raw.length < 512 || !raw.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) throw new Error("RBA historical F1 response is not an OLE workbook");
  if (raw.readUInt16LE(28) !== 0xfffe || raw.readUInt16LE(30) !== 9 || raw.readUInt16LE(26) !== 3) throw new Error("RBA historical F1 workbook has an unsupported compound-document format");
  const sectorCount = Math.floor((raw.length - 512) / 512);
  const fatSectorCount = raw.readUInt32LE(44);
  const firstDirectorySector = raw.readUInt32LE(48);
  const firstDifatSector = raw.readUInt32LE(68);
  if (sectorCount < 1 || fatSectorCount < 1 || fatSectorCount > 109 || firstDifatSector !== END_OF_CHAIN) throw new Error("RBA historical F1 workbook has an unsupported allocation table");
  const fatSectors: number[] = [];
  for (let index = 0; index < 109 && fatSectors.length < fatSectorCount; index += 1) {
    const sector = raw.readUInt32LE(76 + index * 4);
    if (sector === FREE_SECTOR || sector >= sectorCount) throw new Error("RBA historical F1 workbook has an invalid FAT sector");
    fatSectors.push(sector);
  }
  if (fatSectors.length !== fatSectorCount) throw new Error("RBA historical F1 workbook has an incomplete FAT");
  const fat: number[] = [];
  for (const sector of fatSectors) for (let index = 0; index < 128; index += 1) fat.push(raw.readUInt32LE(512 + sector * 512 + index * 4));
  const readChain = (start: number, byteLimit?: number): Buffer => {
    const sectors: Buffer[] = [];
    const seen = new Set<number>();
    for (let current = start; current !== END_OF_CHAIN;) {
      if (current >= sectorCount || seen.has(current) || sectors.length > sectorCount) throw new Error("RBA historical F1 workbook has an invalid sector chain");
      seen.add(current);
      sectors.push(raw.subarray(512 + current * 512, 512 + (current + 1) * 512));
      current = fat[current] ?? FREE_SECTOR;
      if (current === FREE_SECTOR) throw new Error("RBA historical F1 workbook has a truncated sector chain");
    }
    const value = Buffer.concat(sectors);
    return byteLimit === undefined ? value : value.subarray(0, byteLimit);
  };
  const directory = readChain(firstDirectorySector);
  let workbookStart: number | null = null;
  let workbookSize: number | null = null;
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const nameLength = directory.readUInt16LE(offset + 64);
    const name = nameLength >= 2 && nameLength <= 64 ? directory.subarray(offset, offset + nameLength - 2).toString("utf16le") : "";
    if (directory[offset + 66] !== 2 || (name !== "Workbook" && name !== "Book")) continue;
    workbookStart = directory.readUInt32LE(offset + 116);
    const size = Number(directory.readBigUInt64LE(offset + 120));
    if (!Number.isSafeInteger(size) || size < 4_096 || size > 32 * 1024 * 1024) throw new Error("RBA historical F1 workbook stream has an unsafe size");
    workbookSize = size;
    break;
  }
  if (workbookStart === null || workbookSize === null) throw new Error("RBA historical F1 workbook stream is missing");
  return readChain(workbookStart, workbookSize);
}

function findDataSheetOffset(workbook: Buffer): number {
  for (let offset = 0; offset < workbook.length;) {
    const { id, payload, nextOffset } = readBiffRecord(workbook, offset);
    offset = nextOffset;
    if (id === 0x0085) {
      if (payload.length < 8) throw new Error("RBA historical F1 workbook has an invalid sheet entry");
      const length = payload[6];
      const flags = payload[7];
      if (flags !== 0 || payload.length !== 8 + length) throw new Error("RBA historical F1 workbook uses an unsupported sheet name encoding");
      if (payload.subarray(8).toString("latin1") === "Data") {
        const sheetOffset = payload.readUInt32LE(0);
        if (sheetOffset >= workbook.length) throw new Error("RBA historical F1 workbook has an invalid Data sheet offset");
        return sheetOffset;
      }
    }
    if (id === 0x000a) break;
  }
  throw new Error("RBA historical F1 workbook is missing its Data sheet");
}

function readBiffRecord(workbook: Buffer, offset: number): { id: number; payload: Buffer; nextOffset: number } {
  if (offset + 4 > workbook.length) throw new Error("RBA historical F1 workbook has a truncated BIFF record");
  const id = workbook.readUInt16LE(offset);
  const length = workbook.readUInt16LE(offset + 2);
  const nextOffset = offset + 4 + length;
  if (nextOffset > workbook.length) throw new Error("RBA historical F1 workbook has an invalid BIFF record length");
  return { id, payload: workbook.subarray(offset + 4, nextOffset), nextOffset };
}

function addNumberCell(rows: Map<number, Map<number, number>>, payload: Buffer): void {
  if (payload.length !== 14) throw new Error("RBA historical F1 workbook has an invalid NUMBER cell");
  putCell(rows, payload.readUInt16LE(0), payload.readUInt16LE(2), payload.readDoubleLE(6));
}

function addRkCell(rows: Map<number, Map<number, number>>, payload: Buffer): void {
  if (payload.length !== 10) throw new Error("RBA historical F1 workbook has an invalid RK cell");
  putCell(rows, payload.readUInt16LE(0), payload.readUInt16LE(2), decodeRk(payload.readUInt32LE(6)));
}

function addMulRkCells(rows: Map<number, Map<number, number>>, payload: Buffer): void {
  if (payload.length < 10 || (payload.length - 6) % 6 !== 0) throw new Error("RBA historical F1 workbook has an invalid MULRK cell");
  const row = payload.readUInt16LE(0);
  const firstColumn = payload.readUInt16LE(2);
  const lastColumn = payload.readUInt16LE(payload.length - 2);
  const count = (payload.length - 6) / 6;
  if (lastColumn !== firstColumn + count - 1) throw new Error("RBA historical F1 workbook has an invalid MULRK range");
  for (let index = 0; index < count; index += 1) putCell(rows, row, firstColumn + index, decodeRk(payload.readUInt32LE(6 + index * 6)));
}

function readLabelSstCell(payload: Buffer, sharedStrings: string[]): { row: number; column: number; value: string } {
  if (payload.length !== 10) throw new Error("RBA historical F1 workbook has an invalid LABELSST cell");
  const index = payload.readUInt32LE(6);
  const value = sharedStrings[index];
  if (value === undefined) throw new Error("RBA historical F1 workbook references a missing shared string");
  return { row: payload.readUInt16LE(0), column: payload.readUInt16LE(2), value };
}

function putCell(rows: Map<number, Map<number, number>>, row: number, column: number, value: number): void {
  if (!Number.isFinite(value)) throw new Error("RBA historical F1 workbook has a non-finite numeric cell");
  const cells = rows.get(row) ?? new Map<number, number>();
  if (cells.has(column)) throw new Error("RBA historical F1 workbook has a duplicate numeric cell");
  cells.set(column, value);
  rows.set(row, cells);
}

function decodeRk(raw: number): number {
  let value: number;
  if ((raw & 0x02) !== 0) value = (raw | 0) >> 2;
  else {
    const valueBuffer = Buffer.alloc(8);
    valueBuffer.writeUInt32LE((raw & 0xfffffffc) >>> 0, 4);
    value = valueBuffer.readDoubleLE(0);
  }
  return (raw & 0x01) !== 0 ? value / 100 : value;
}

function excelDateToIso(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 100_000) throw new Error("RBA historical F1 workbook has an invalid Excel date");
  const date = new Date(Date.UTC(1899, 11, 30 + value));
  if (!Number.isFinite(date.getTime())) throw new Error("RBA historical F1 workbook has an invalid Excel date");
  return date.toISOString().slice(0, 10);
}
