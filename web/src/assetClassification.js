const INR_LISTED_US_INVESTMENTS = new Set([
  "MAFANG.NS",
  "MONQ50.NS",
]);

export function assetClassFor(assetType, currency, symbol = "") {
  const normalizedSymbol = String(symbol).trim().toUpperCase();
  if (INR_LISTED_US_INVESTMENTS.has(normalizedSymbol)) return "US Investments";

  const normalizedType = String(assetType || "").toUpperCase();
  if (normalizedType.includes("ETF")) return currency === "USD" ? "US ETFs" : "Commodities";
  return currency === "USD" ? "US Stocks" : "Indian Stocks";
}
