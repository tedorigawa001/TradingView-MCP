// Produces stored-set goldens with the unedited 0.1.14 build (git diff --quiet 6f87dfe -- src/ was checked).
import { writeFileSync } from 'node:fs';
import { normalizeForecastSet } from '../../../build/forecastSet.js';
const day = (i) => new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const base = (count, patch = {}) => {
  const idx = Array.from({ length: count }, (_, i) => i);
  return { schema_version: '1.0', source_id: 'golden-source', source_sha256: 'sha256:' + 'a'.repeat(64),
    evidence_tier: 'synthetic_test', horizon: 1, n: 1, underlying_series_ids: ['fxdata-m15:EURUSD'], dates: idx.map(day),
    windows: idx.map((i) => ({ from: `${day(i - 1)}T21:45:00.000Z`, to: `${day(i)}T21:45:00.000Z` })),
    a: idx.map((i) => 1 + i / 10), b: idx.map((i) => 1.2 + i / 20), primary: idx.map((i) => 0.5 + (i % 3) / 4), ...patch };
};
const matrix = (x, y, c) => [[x, c], [c, y]];
const hex = 'b'.repeat(64);
const cases = {
  plain_matrix_with_secondary_and_labels: base(4, { n: 2, underlying_series_ids: ['fxdata-m15:EURUSD', 'fxdata-m15:USDJPY'],
    a: [0, 1, 2, 3].map((i) => matrix(1 + i, 2, 0.1)), b: [0, 1, 2, 3].map((i) => matrix(1.5, 2 + i, 0.2)),
    primary: [0, 1, 2, 3].map((i) => matrix(1, 1 + i / 2, 0.05)), secondary: [0, 1, 2, 3].map((i) => matrix(0.5 + i, 1, -0.1)),
    labels: ['even', 'odd', 'even', 'odd'] }),
  window_starts_on_its_own_date: base(3, { windows: [0, 1, 2].map((i) => ({ from: `${day(i)}T01:00:00.000Z`, to: `${day(i)}T23:00:00.000Z` })) }),
  proxy_set_source: base(3, { source_id: `proxy-set:${hex}`, source_sha256: `sha256:${hex}` }),
  proxy_set_source_series: base(3, { underlying_series_ids: ['proxy-set-source:x'] }),
};
const goldens = Object.entries(cases).map(([name, input]) => {
  const { set, artifact_id } = normalizeForecastSet(input);
  return { name, artifact_id, body: JSON.stringify(set) };
});
writeFileSync(new URL('./format-0.1.14.json', import.meta.url),
  JSON.stringify({ produced_by: 'bushido-tradingview-mcp 0.1.14 build (src identical to 6f87dfe)', goldens }, null, 1) + '\n');
console.log(goldens.map((g) => `${g.name} ${g.artifact_id} ${g.body.length}B`).join('\n'));
