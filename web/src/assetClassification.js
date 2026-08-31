const INR_LISTED_US_INVESTMENTS = new Set([
  "MAFANG.NS",
  "MONQ50.NS",
]);

const COMMODITY_SYMBOL_RE = /GOLD|SILVER|CRUDE|COPPER|BULLION|PLATINUM|OILBEES/;

function isCommoditySector(sector) {
  return /commodit|precious metal/i.test(String(sector || ""));
}

export function assetClassFor(assetType, currency, symbol = "", sector = "") {
  const normalizedSymbol = String(symbol).trim().toUpperCase();
  if (INR_LISTED_US_INVESTMENTS.has(normalizedSymbol)) return "US Investments";
  if (isCommoditySector(sector) || COMMODITY_SYMBOL_RE.test(normalizedSymbol)) return "Commodities";

  const normalizedType = String(assetType || "").toUpperCase();
  if (normalizedType.includes("ETF")) return currency === "USD" ? "US ETFs" : "Commodities";
  return currency === "USD" ? "US Stocks" : "Indian Stocks";
}
