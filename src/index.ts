#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CdpClient } from "./cdp.js";
import { TradingView } from "./tradingview.js";
import { Scanner } from "./scanner.js";
import { EconomicCalendar } from "./calendar.js";
import { createServer } from "./server.js";

const cdp = new CdpClient();
const server = createServer({
  cdp,
  tv: new TradingView(cdp),
  scanner: new Scanner(),
  calendar: new EconomicCalendar(),
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("tradingview-mcp: ready (stdio)");
