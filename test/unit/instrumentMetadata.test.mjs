import test from "node:test";
import assert from "node:assert/strict";
import { getInstrumentMetadata } from "../../build/instrumentMetadata.js";

test("instrument metadata uses an explicit registry and leaves unknown symbols unresolved", () => {
  assert.deepEqual(getInstrumentMetadata("OANDA:USDJPY"), { pip_size: 0.01, tick_size: 0.001, quote_currency: "JPY", source: "configured_registry" });
  assert.equal(getInstrumentMetadata("OANDA:XAUUSD").pip_size, null);
});
