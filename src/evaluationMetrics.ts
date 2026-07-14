export function classificationMetrics(rows: Array<{ predicted: string; actual: string }>) {
  if (rows.length === 0) throw new Error("at least one labelled row is required");
  const labels = [...new Set(rows.flatMap((row) => [row.predicted, row.actual]))].sort();
  const confusion = Object.fromEntries(labels.map((actual) => [actual, Object.fromEntries(labels.map((predicted) => [predicted, 0]))]));
  for (const row of rows) confusion[row.actual][row.predicted] += 1;
  const accuracy = rows.filter((row) => row.predicted === row.actual).length / rows.length;
  return { count: rows.length, accuracy, labels, confusion };
}
