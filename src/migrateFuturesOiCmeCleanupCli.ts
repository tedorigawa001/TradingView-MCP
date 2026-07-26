import { FuturesOpenInterestFirstSeenStore, resolveFuturesOpenInterestHistoryPath, resolveFuturesOpenInterestV2HistoryPath } from "./futuresOpenInterestHistory.js";
import { migrateFuturesOpenInterestCmeCleanup } from "./futuresOpenInterestCmeCleanupMigration.js";

async function main(): Promise<void> {
  const source = new FuturesOpenInterestFirstSeenStore(resolveFuturesOpenInterestV2HistoryPath());
  const destination = new FuturesOpenInterestFirstSeenStore(resolveFuturesOpenInterestHistoryPath());
  const result = await migrateFuturesOpenInterestCmeCleanup({ source, destination });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`futures OI CME cleanup migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
