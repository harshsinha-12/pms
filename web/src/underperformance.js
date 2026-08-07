export const MINIMUM_LOSS_PERCENT = 5;
export const MINIMUM_LOSS_CONTRIBUTION_PERCENT = 10;
export const MINIMUM_EQUAL_WEIGHT_MULTIPLE = 0.5;

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function investedValueInInr(holding, usdInrRate) {
  const stored = positiveNumber(holding.costBasisInr);
  if (stored) return stored;
  const quantity = positiveNumber(holding.quantity);
  const averagePrice = positiveNumber(holding.averagePrice);
  if (!quantity || !averagePrice) return 0;
  const nativeValue = quantity * averagePrice;
  return holding.currency === "USD" ? nativeValue * Number(usdInrRate || 0) : nativeValue;
}

function currentValueInInr(holding, usdInrRate) {
  const stored = positiveNumber(holding.marketValueInr);
  if (stored) return stored;
  const quantity = positiveNumber(holding.quantity);
  const currentPrice = positiveNumber(holding.currentPrice);
  if (!quantity || !currentPrice) return 0;
  const nativeValue = quantity * currentPrice;
  return holding.currency === "USD" ? nativeValue * Number(usdInrRate || 0) : nativeValue;
}

export function screenUnderperformingHoldings(holdings = [], usdInrRate = null) {
  const positions = holdings
    .map((holding) => ({
      holding,
      investedValueInr: investedValueInInr(holding, usdInrRate),
      currentValueInr: currentValueInInr(holding, usdInrRate),
    }))
    .filter((position) => position.investedValueInr > 0 && position.currentValueInr > 0);

  const portfolioInvestedInr = positions.reduce((sum, item) => sum + item.investedValueInr, 0);
  const totalCurrentValueInr = positions.reduce((sum, item) => sum + item.currentValueInr, 0);
  const equalWeightPercent = positions.length ? 100 / positions.length : 0;
  const totalUnrealizedLossInr = positions.reduce(
    (sum, item) => sum + Math.max(item.investedValueInr - item.currentValueInr, 0),
    0,
  );

  const candidates = positions
    .map((position) => {
      const lossInr = Math.max(position.investedValueInr - position.currentValueInr, 0);
      const lossPercent = (lossInr / position.investedValueInr) * 100;
      const investedWeightPercent = portfolioInvestedInr
        ? (position.investedValueInr / portfolioInvestedInr) * 100
        : 0;
      const allocationPercent = totalCurrentValueInr
        ? (position.currentValueInr / totalCurrentValueInr) * 100
        : 0;
      const lossContributionPercent = totalUnrealizedLossInr
        ? (lossInr / totalUnrealizedLossInr) * 100
        : 0;
      const recoveryPercent = position.currentValueInr
        ? (lossInr / position.currentValueInr) * 100
        : 0;
      const isMaterialPosition = investedWeightPercent >= equalWeightPercent * MINIMUM_EQUAL_WEIGHT_MULTIPLE;
      const isMaterialLoss = lossContributionPercent >= MINIMUM_LOSS_CONTRIBUTION_PERCENT;

      let reviewPath = "Hold / monitor review";
      if (lossPercent >= 15 && lossContributionPercent >= 15) {
        reviewPath = "Thesis / exit review";
      } else if (allocationPercent > equalWeightPercent) {
        reviewPath = "Sizing review";
      } else if (allocationPercent <= equalWeightPercent) {
        reviewPath = "Average / hold review";
      }

      return {
        ...position.holding,
        investedValueInr: position.investedValueInr,
        currentValueInr: position.currentValueInr,
        lossInr,
        lossPercent,
        recoveryPercent,
        investedWeightPercent,
        allocationPercent,
        lossContributionPercent,
        reviewPath,
        isMaterialPosition,
        isMaterialLoss,
      };
    })
    .filter((holding) => (
      holding.lossPercent >= MINIMUM_LOSS_PERCENT
      && (holding.isMaterialPosition || holding.isMaterialLoss)
    ))
    .sort((left, right) => (
      right.lossContributionPercent - left.lossContributionPercent
      || right.lossPercent - left.lossPercent
    ));

  return {
    candidates,
    equalWeightPercent,
    minimumLossPercent: MINIMUM_LOSS_PERCENT,
    minimumLossContributionPercent: MINIMUM_LOSS_CONTRIBUTION_PERCENT,
    minimumEqualWeightMultiple: MINIMUM_EQUAL_WEIGHT_MULTIPLE,
    portfolioInvestedInr,
    totalUnrealizedLossInr,
  };
}
