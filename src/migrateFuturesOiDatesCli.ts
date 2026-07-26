import {
  FuturesOpenInterestFirstSeenStore,
  resolveFuturesOpenInterestV2HistoryPath,
  resolveLegacyFuturesOpenInterestHistoryPath,
} from "./futuresOpenInterestHistory.js";
import { migrateFuturesOpenInterestDates } from "./futuresOpenInterestMigration.js";

async function main(): Promise<void> {
  const source = new FuturesOpenInterestFirstSeenStore(resolveLegacyFuturesOpenInterestHistoryPath());
  const destination = new FuturesOpenInterestFirstSeenStore(resolveFuturesOpenInterestV2HistoryPath());
  const result = await migrateFuturesOpenInterestDates({ source, destination });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`futures OI date migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
