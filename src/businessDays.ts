export const addBusinessDays = (from: string, days: number) => {
  const date = new Date(`${from}T00:00:00.000Z`);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
};

export const businessDaysSince = (from: string, to: string) => {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  let count = 0;
  while (start < end) {
    start.setUTCDate(start.getUTCDate() + 1);
    if (start.getUTCDay() !== 0 && start.getUTCDay() !== 6) count += 1;
  }
  return count;
};

export const firstBusinessDayGridDateOnOrAfter = (start: string, noEarlierThan: string, intervalBusinessDays: number) => {
  let candidate = start;
  while (candidate < noEarlierThan) candidate = addBusinessDays(candidate, intervalBusinessDays);
  return candidate;
};
