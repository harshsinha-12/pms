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

const US_ASSET_CLASSES = new Set(["US Investments", "US Stocks", "US ETFs"]);

export function isCommoditiesLabel(name) {
  return /commodit/i.test(String(name || ""));
}

export function buildAssetAllocationSlices(groupedValueByClass = {}, totalValue = 0, sectorAllocation = []) {
  const grouped = { ...groupedValueByClass };

  const usTotal = Object.entries(grouped)
    .filter(([name]) => US_ASSET_CLASSES.has(name))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0);
  for (const name of US_ASSET_CLASSES) delete grouped[name];
  if (usTotal > 0) grouped["US Investments"] = usTotal;

  const sectorCommoditiesPercent = (sectorAllocation || [])
    .filter((item) => isCommoditiesLabel(item.name))
    .reduce((sum, item) => sum + Number(item.value || 0), 0);

  if (totalValue > 0 && sectorCommoditiesPercent > 0) {
    const target = totalValue * (sectorCommoditiesPercent / 100);
    const current = Number(grouped.Commodities || 0);
    const extra = target - current;
    grouped.Commodities = target;
    grouped["Indian Stocks"] = Math.max(0, Number(grouped["Indian Stocks"] || 0) - extra);
  }

  return grouped;
}
