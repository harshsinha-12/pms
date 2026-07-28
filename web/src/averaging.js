export const MINIMUM_AVERAGING_DISCOUNT_PERCENT = 5;

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function currentValueInInr(holding, usdInrRate) {
  const storedValue = Number(holding.marketValueInr);
  if (Number.isFinite(storedValue) && storedValue >= 0) return storedValue;

  const quantity = positiveNumber(holding.quantity);
  const currentPrice = positiveNumber(holding.currentPrice);
  if (!quantity || !currentPrice) return 0;

  const nativeValue = quantity * currentPrice;
  if (holding.currency !== "USD") return nativeValue;

  const fxRate = positiveNumber(usdInrRate);
  return fxRate ? nativeValue * fxRate : 0;
}

export function screenAveragingCandidates(holdings = [], usdInrRate = null) {
  const openPositions = holdings
    .map((holding) => ({
      holding,
      averagePrice: positiveNumber(holding.averagePrice),
      currentPrice: positiveNumber(holding.currentPrice),
      quantity: positiveNumber(holding.quantity),
      currentValueInr: currentValueInInr(holding, usdInrRate),
    }))
    .filter((position) => (
      position.averagePrice
      && position.currentPrice
      && position.quantity
      && position.currentValueInr > 0
    ));

  const portfolioValueInr = openPositions.reduce(
    (total, position) => total + position.currentValueInr,
    0,
  );
  const equalWeightPercent = openPositions.length ? 100 / openPositions.length : 0;

  const candidates = openPositions
    .map((position) => {
      const discountPercent = (
        (position.averagePrice - position.currentPrice) / position.averagePrice
      ) * 100;
      const recoveryPercent = (
        (position.averagePrice - position.currentPrice) / position.currentPrice
      ) * 100;
      const allocationPercent = portfolioValueInr
        ? (position.currentValueInr / portfolioValueInr) * 100
        : 0;

      return {
        ...position.holding,
        discountPercent,
        recoveryPercent,
        allocationPercent,
        currentValueInr: position.currentValueInr,
      };
    })
    .filter((holding) => (
      holding.discountPercent >= MINIMUM_AVERAGING_DISCOUNT_PERCENT
      && holding.allocationPercent <= equalWeightPercent
    ))
    .sort((left, right) => (
      right.discountPercent - left.discountPercent
      || left.allocationPercent - right.allocationPercent
    ));

  return {
    candidates,
    equalWeightPercent,
    minimumDiscountPercent: MINIMUM_AVERAGING_DISCOUNT_PERCENT,
    portfolioValueInr,
  };
}
