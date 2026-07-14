export function createWalkForwardSplits(input: { length: number; train_size: number; test_size: number; embargo: number }) {
  const { length, train_size, test_size, embargo } = input;
  if (![length, train_size, test_size, embargo].every(Number.isInteger) || length < 1 || train_size < 1 || test_size < 1 || embargo < 0) throw new Error("length, train_size, test_size, and embargo must be valid integers");
  const splits = [];
  for (let trainStart = 0; trainStart + train_size + embargo + test_size <= length; trainStart += test_size) {
    splits.push({ train: [trainStart, trainStart + train_size - 1], embargo: [trainStart + train_size, trainStart + train_size + embargo - 1], test: [trainStart + train_size + embargo, trainStart + train_size + embargo + test_size - 1] });
  }
  return splits;
}
