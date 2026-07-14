export type InstrumentMetadata = {
  pip_size: number | null;
  tick_size: number | null;
  quote_currency: string | null;
  source: "configured_registry" | "unavailable";
};

const REGISTRY: Record<string, InstrumentMetadata> = {
  "OANDA:EURUSD": { pip_size: 0.0001, tick_size: 0.00001, quote_currency: "USD", source: "configured_registry" },
  "OANDA:GBPUSD": { pip_size: 0.0001, tick_size: 0.00001, quote_currency: "USD", source: "configured_registry" },
  "OANDA:USDJPY": { pip_size: 0.01, tick_size: 0.001, quote_currency: "JPY", source: "configured_registry" },
  "OANDA:GBPJPY": { pip_size: 0.01, tick_size: 0.001, quote_currency: "JPY", source: "configured_registry" },
  "OANDA:GBPAUD": { pip_size: 0.0001, tick_size: 0.00001, quote_currency: "AUD", source: "configured_registry" },
};

export function getInstrumentMetadata(symbol: string): InstrumentMetadata {
  return REGISTRY[symbol] ?? { pip_size: null, tick_size: null, quote_currency: null, source: "unavailable" };
}
