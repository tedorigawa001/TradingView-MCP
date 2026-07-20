#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CdpClient } from "./cdp.js";
import { TradingView } from "./tradingview.js";
import { Scanner } from "./scanner.js";
import { EconomicCalendar } from "./calendar.js";
import { CotClient } from "./cot.js";
import { TreasuryRealYieldClient } from "./realYield.js";
import { RealYieldFirstSeenStore, resolveRealYieldHistoryPath } from "./realYieldHistory.js";
import { AnalysisJournalStore, resolveAnalysisJournalPath } from "./analysisJournal.js";
import { StrategyResearchJournalStore, resolveStrategyResearchJournalPath } from "./strategyResearchJournal.js";
import { createServer } from "./server.js";

const cdp = new CdpClient();
const realYieldHistoryPath = resolveRealYieldHistoryPath();
const realYieldHistory = new RealYieldFirstSeenStore(realYieldHistoryPath);
const analysisJournal = new AnalysisJournalStore(resolveAnalysisJournalPath());
const strategyResearchJournal = new StrategyResearchJournalStore(resolveStrategyResearchJournalPath());
const server = createServer({
  cdp,
  tv: new TradingView(cdp),
  scanner: new Scanner(),
  calendar: new EconomicCalendar(),
  cot: new CotClient(),
  realYield: new TreasuryRealYieldClient(undefined, undefined, realYieldHistory),
  journal: analysisJournal,
  researchJournal: strategyResearchJournal,
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("tradingview-mcp: ready (stdio)");
