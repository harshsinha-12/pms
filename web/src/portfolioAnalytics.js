const RANGE_DAYS = { "1M": 31, "6M": 183, "1Y": 366, All: Infinity };
const TRADING_DAYS = 252;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0)
    / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function covariance(left, right) {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  return left.reduce(
    (sum, value, index) => sum + ((value - leftMean) * (right[index] - rightMean)),
    0,
  ) / (left.length - 1);
}

function daysBetween(start, end) {
  const startDate = new Date(`${String(start).slice(0, 10)}T00:00:00Z`);
  const endDate = new Date(`${String(end).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  return Math.max(0, Math.round((endDate - startDate) / 86400000));
}

function isWeekday(value) {
  const day = new Date(`${String(value).slice(0, 10)}T00:00:00Z`).getUTCDay();
  return day > 0 && day < 6;
}

function periodSlice(values, range) {
  const days = RANGE_DAYS[range] ?? Infinity;
  return Number.isFinite(days) ? values.slice(-days) : values;
}

function returnBetween(startIndex, endIndex) {
  if (!(startIndex > 0) || !(endIndex > 0)) return null;
  return (endIndex / startIndex) - 1;
}

export function buildDrawdownData(chartData) {
  let portfolioPeak = -Infinity;
  let benchmarkPeak = -Infinity;
  let portfolioPeakDate = null;
  let benchmarkPeakDate = null;

  return (Array.isArray(chartData) ? chartData : []).map((point) => {
    const portfolioIndex = 1 + (Number(point.displayPortfolioReturn || 0) / 100);
    const benchmarkReturn = finite(point.displayBenchmarkReturn);
    const benchmarkIndex = benchmarkReturn === null ? null : 1 + (benchmarkReturn / 100);

    if (portfolioIndex >= portfolioPeak) {
      portfolioPeak = portfolioIndex;
      portfolioPeakDate = point.date;
    }
    if (benchmarkIndex !== null && benchmarkIndex >= benchmarkPeak) {
      benchmarkPeak = benchmarkIndex;
      benchmarkPeakDate = point.date;
    }

    return {
      date: point.date,
      portfolioDrawdown: portfolioPeak > 0 ? ((portfolioIndex / portfolioPeak) - 1) * 100 : 0,
      niftyDrawdown: benchmarkIndex !== null && benchmarkPeak > 0
        ? ((benchmarkIndex / benchmarkPeak) - 1) * 100
        : null,
      daysSincePeak: portfolioPeakDate ? daysBetween(portfolioPeakDate, point.date) : 0,
      niftyDaysSincePeak: benchmarkPeakDate ? daysBetween(benchmarkPeakDate, point.date) : null,
    };
  });
}

function dailyObservations(chartData) {
  const rows = [];
  for (let index = 1; index < chartData.length; index += 1) {
    const previous = chartData[index - 1];
    const current = chartData[index];
    if (!isWeekday(current.date)) continue;

    const previousPortfolioIndex = 1 + (Number(previous.displayPortfolioReturn || 0) / 100);
    const currentPortfolioIndex = 1 + (Number(current.displayPortfolioReturn || 0) / 100);
    const previousBenchmarkReturn = finite(previous.displayBenchmarkReturn);
    const currentBenchmarkReturn = finite(current.displayBenchmarkReturn);
    const previousBenchmark = finite(previous.benchmark);
    const currentBenchmark = finite(current.benchmark);
    const portfolioReturn = returnBetween(previousPortfolioIndex, currentPortfolioIndex);
    const benchmarkReturn = previousBenchmarkReturn === null || currentBenchmarkReturn === null
      ? null
      : returnBetween(1 + (previousBenchmarkReturn / 100), 1 + (currentBenchmarkReturn / 100));

    if (portfolioReturn === null) continue;
    // Snapshots carry Friday's close through weekends and market holidays. Risk
    // observations should be aligned to days where the benchmark actually moved.
    const benchmarkMoved = previousBenchmark !== null
      && currentBenchmark !== null
      && Math.abs(currentBenchmark - previousBenchmark) > 1e-12;
    if (benchmarkReturn !== null && !benchmarkMoved) continue;

    rows.push({
      date: current.date,
      portfolioReturn,
      benchmarkReturn,
      activeReturn: benchmarkReturn === null ? null : portfolioReturn - benchmarkReturn,
      portfolioIndex: currentPortfolioIndex,
    });
  }
  return rows;
}

function rollingWindows(observations, length) {
  const values = [];
  for (let index = length - 1; index < observations.length; index += 1) {
    const window = observations.slice(index - length + 1, index + 1);
    const factor = window.reduce((product, item) => product * (1 + item.portfolioReturn), 1);
    values.push({
      startDate: window[0].date,
      endDate: window.at(-1).date,
      returnPercent: (factor - 1) * 100,
    });
  }
  return values;
}

export function calculatePerformanceAnalytics(chartData, {
  riskFreeRatePercent = 6.5,
  minimumRiskObservations = 60,
} = {}) {
  const points = Array.isArray(chartData) ? chartData : [];
  const latest = points.at(-1);
  const portfolioReturn = finite(latest?.displayPortfolioReturn);
  const niftyReturn = finite(latest?.displayBenchmarkReturn);
  const activeReturn = portfolioReturn !== null && niftyReturn !== null
    ? portfolioReturn - niftyReturn
    : null;
  const observations = dailyObservations(points);
  const aligned = observations.filter((item) => item.benchmarkReturn !== null);
  const portfolioReturns = aligned.map((item) => item.portfolioReturn);
  const benchmarkReturns = aligned.map((item) => item.benchmarkReturn);
  const activeReturns = aligned.map((item) => item.activeReturn);
  const enoughRiskHistory = aligned.length >= minimumRiskObservations;
  const annualizedVolatility = enoughRiskHistory
    ? sampleStandardDeviation(portfolioReturns) * Math.sqrt(TRADING_DAYS) * 100
    : null;
  const negativeReturns = portfolioReturns.filter((value) => value < 0);
  const downsideDeviation = enoughRiskHistory && negativeReturns.length
    ? Math.sqrt(negativeReturns.reduce((sum, value) => sum + (value ** 2), 0) / portfolioReturns.length)
      * Math.sqrt(TRADING_DAYS) * 100
    : null;
  const benchmarkVariance = enoughRiskHistory
    ? sampleStandardDeviation(benchmarkReturns) ** 2
    : null;
  const beta = enoughRiskHistory && benchmarkVariance > 0
    ? covariance(portfolioReturns, benchmarkReturns) / benchmarkVariance
    : null;
  const trackingErrorDecimal = enoughRiskHistory
    ? sampleStandardDeviation(activeReturns) * Math.sqrt(TRADING_DAYS)
    : null;
  const annualizedActiveReturn = enoughRiskHistory ? mean(activeReturns) * TRADING_DAYS : null;
  const informationRatio = trackingErrorDecimal > 0
    ? annualizedActiveReturn / trackingErrorDecimal
    : null;
  const annualizedPortfolioReturn = enoughRiskHistory ? mean(portfolioReturns) * TRADING_DAYS : null;
  const riskFreeRate = Number(riskFreeRatePercent) / 100;
  const sharpeRatio = annualizedVolatility > 0
    ? (annualizedPortfolioReturn - riskFreeRate) / (annualizedVolatility / 100)
    : null;
  const sortinoRatio = downsideDeviation > 0
    ? (annualizedPortfolioReturn - riskFreeRate) / (downsideDeviation / 100)
    : null;
  const drawdownData = buildDrawdownData(points);
  const maximumDrawdownPoint = drawdownData.reduce(
    (worst, item) => item.portfolioDrawdown < worst.portfolioDrawdown ? item : worst,
    drawdownData[0] || { portfolioDrawdown: 0, date: null, daysSincePeak: 0 },
  );
  const currentDrawdownPoint = drawdownData.at(-1);
  const enoughDrawdownHistory = observations.length >= 20;
  const monthlyWindows = rollingWindows(observations, 21);
  const quarterlyWindows = rollingWindows(observations, 63);
  const bestMonth = monthlyWindows.length
    ? monthlyWindows.reduce((best, item) => item.returnPercent > best.returnPercent ? item : best)
    : null;
  const worstMonth = monthlyWindows.length
    ? monthlyWindows.reduce((worst, item) => item.returnPercent < worst.returnPercent ? item : worst)
    : null;

  return {
    portfolioReturn,
    niftyReturn,
    activeReturn,
    observations: aligned.length,
    periodStart: points[0]?.date ?? null,
    periodEnd: latest?.date ?? null,
    rollingOneMonth: monthlyWindows.at(-1)?.returnPercent ?? null,
    rollingThreeMonth: quarterlyWindows.at(-1)?.returnPercent ?? null,
    bestMonth,
    worstMonth,
    annualizedVolatility,
    downsideDeviation,
    maximumDrawdown: enoughRiskHistory ? maximumDrawdownPoint.portfolioDrawdown : null,
    maximumDrawdownDate: enoughRiskHistory ? maximumDrawdownPoint.date : null,
    currentDrawdown: enoughDrawdownHistory ? currentDrawdownPoint?.portfolioDrawdown ?? null : null,
    currentDrawdownDays: enoughDrawdownHistory ? currentDrawdownPoint?.daysSincePeak ?? null : null,
    beta,
    trackingError: trackingErrorDecimal === null ? null : trackingErrorDecimal * 100,
    informationRatio,
    sharpeRatio,
    sortinoRatio,
    riskFreeRatePercent: Number(riskFreeRatePercent),
    riskFreeRateSource: "Portfolio assumption",
    drawdownData,
  };
}

function normalizedTransactionDate(transaction) {
  return String(transaction.tradedAt || transaction.traded_at || transaction.date || "").slice(0, 10);
}

function transactionFlowInr(transaction) {
  const quantity = finite(transaction.quantity) ?? 0;
  const price = finite(transaction.price) ?? finite(transaction.averagePrice) ?? 0;
  const fees = finite(transaction.fees) ?? 0;
  const fxRate = finite(transaction.fxRateToInr) ?? finite(transaction.fx_rate_to_inr) ?? 1;
  const gross = quantity * price;
  return String(transaction.side || transaction.type || "BUY").toUpperCase() === "SELL"
    ? -Math.max(0, gross - fees) * fxRate
    : (gross + fees) * fxRate;
}

function holdingMap(point) {
  return new Map((point?.holdings || []).map((holding) => [holding.symbol, holding]));
}

export function calculateReturnAttribution({
  history,
  holdings,
  transactions = [],
  range = "All",
}) {
  const points = periodSlice(Array.isArray(history) ? history : [], range);
  if (points.length < 2) return { holdings: [], sectors: [], observations: 0, method: "unavailable" };

  const transactionFlows = new Map();
  const transactionSectors = new Map();
  for (const transaction of transactions) {
    const date = normalizedTransactionDate(transaction);
    const symbol = transaction.symbol;
    if (!date || !symbol) continue;
    const key = `${date}:${symbol}`;
    transactionFlows.set(key, (transactionFlows.get(key) || 0) + transactionFlowInr(transaction));
    if (transaction.sector) transactionSectors.set(symbol, transaction.sector);
  }

  const holdingDetails = new Map((holdings || []).map((holding) => [holding.symbol, holding]));
  const contributions = new Map();
  let observations = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const previousPortfolioValue = finite(previous.value) ?? 0;
    if (!(previousPortfolioValue > 0)) continue;
    const previousHoldings = holdingMap(previous);
    const currentHoldings = holdingMap(current);
    const symbols = new Set([...previousHoldings.keys(), ...currentHoldings.keys()]);
    observations += 1;

    for (const symbol of symbols) {
      const previousHolding = previousHoldings.get(symbol);
      const currentHolding = currentHoldings.get(symbol);
      const previousValue = finite(previousHolding?.value) ?? 0;
      const currentValue = finite(currentHolding?.value) ?? 0;
      const explicitFlow = transactionFlows.get(`${String(current.date).slice(0, 10)}:${symbol}`);
      const costChange = (finite(currentHolding?.invested) ?? 0) - (finite(previousHolding?.invested) ?? 0);
      const capitalFlow = explicitFlow ?? costChange;
      const capitalBase = previousValue + capitalFlow;
      if (!(previousValue > 0) || !(capitalBase > 0)) continue;
      const holdingReturn = (currentValue / capitalBase) - 1;
      if (!Number.isFinite(holdingReturn)) continue;
      const weight = previousValue / previousPortfolioValue;
      const contributionPp = weight * holdingReturn * 100;
      const contributionInr = previousValue * holdingReturn;
      const existing = contributions.get(symbol) || { contributionPp: 0, contributionInr: 0, days: 0 };
      existing.contributionPp += contributionPp;
      existing.contributionInr += contributionInr;
      existing.days += 1;
      contributions.set(symbol, existing);
    }
  }

  const holdingRows = [...contributions.entries()].map(([symbol, values]) => {
    const detail = holdingDetails.get(symbol);
    return {
      symbol,
      name: detail?.name || symbol,
      sector: detail?.sector || transactionSectors.get(symbol) || "Unclassified",
      ...values,
    };
  }).sort((left, right) => Math.abs(right.contributionPp) - Math.abs(left.contributionPp));

  const sectorRows = [...holdingRows.reduce((groups, holding) => {
    const current = groups.get(holding.sector) || { contributionPp: 0, contributionInr: 0, holdings: 0 };
    current.contributionPp += holding.contributionPp;
    current.contributionInr += holding.contributionInr;
    current.holdings += 1;
    groups.set(holding.sector, current);
    return groups;
  }, new Map()).entries()].map(([sector, values]) => ({ sector, ...values }))
    .sort((left, right) => Math.abs(right.contributionPp) - Math.abs(left.contributionPp));

  return {
    holdings: holdingRows,
    sectors: sectorRows,
    observations,
    method: transactionFlows.size ? "daily-flow-adjusted" : "daily-cost-basis-fallback",
  };
}

function groupWeights(holdings, keyForHolding) {
  const values = new Map();
  const total = holdings.reduce((sum, holding) => sum + (finite(holding.marketValueInr) ?? 0), 0);
  for (const holding of holdings) {
    const key = keyForHolding(holding) || "Unclassified";
    values.set(key, (values.get(key) || 0) + (finite(holding.marketValueInr) ?? 0));
  }
  return [...values.entries()].map(([key, value]) => ({
    key,
    value,
    weight: total > 0 ? (value / total) * 100 : 0,
  })).sort((left, right) => right.weight - left.weight);
}

export function calculateConcentration(holdings, {
  holdingLimitPercent = 10,
  sectorLimitPercent = 25,
} = {}) {
  const rows = groupWeights(holdings || [], (holding) => holding.symbol);
  const sectors = groupWeights(holdings || [], (holding) => holding.sector || "Unclassified");
  const currencies = groupWeights(holdings || [], (holding) => holding.currency || "Unclassified");
  const countries = groupWeights(holdings || [], (holding) => {
    if (["NSE", "BSE"].includes(String(holding.market).toUpperCase())) return "India";
    if (holding.currency === "INR") return "India";
    if (holding.currency === "USD") return "United States";
    return "Other";
  });
  const assets = groupWeights(holdings || [], (holding) => holding.assetClass || holding.assetType || "Other");
  const decimalWeights = rows.map((item) => item.weight / 100);
  const herfindahl = decimalWeights.reduce((sum, weight) => sum + (weight ** 2), 0);

  return {
    holdings: rows,
    sectors,
    currencies,
    countries,
    assets,
    largestHolding: rows[0] ?? null,
    top5Weight: rows.slice(0, 5).reduce((sum, item) => sum + item.weight, 0),
    top10Weight: rows.slice(0, 10).reduce((sum, item) => sum + item.weight, 0),
    largestSector: sectors[0] ?? null,
    top3SectorWeight: sectors.slice(0, 3).reduce((sum, item) => sum + item.weight, 0),
    effectiveHoldings: herfindahl > 0 ? 1 / herfindahl : 0,
    holdingBreaches: rows.filter((item) => item.weight > Number(holdingLimitPercent)),
    sectorBreaches: sectors.filter((item) => item.weight > Number(sectorLimitPercent)),
  };
}

export function buildTargetPlan(items, targets, {
  mode = "buys-sells",
  totalValue = 0,
  newCash = 0,
  noTradeBandPercent = 1,
} = {}) {
  const targetTotal = items.reduce((sum, item) => sum + (finite(targets[item.key]) ?? 0), 0);
  const hasCompleteTargets = Math.abs(targetTotal - 100) <= 0.1;
  if (!hasCompleteTargets) {
    return { rows: [], targetTotal, cashNeeded: 0, cashReleased: 0, unallocatedCash: Number(newCash) || 0 };
  }

  const postCashTotal = Number(totalValue) + (mode === "new-cash" ? Number(newCash || 0) : 0);
  let rows = items.map((item) => {
    const targetWeight = finite(targets[item.key]) ?? 0;
    const drift = item.weight - targetWeight;
    const rawTrade = mode === "new-cash"
      ? Math.max(0, (postCashTotal * targetWeight / 100) - item.value)
      : (Number(totalValue) * targetWeight / 100) - item.value;
    const trade = Math.abs(drift) <= Number(noTradeBandPercent) ? 0 : rawTrade;
    return { ...item, targetWeight, drift, trade };
  });

  if (mode === "new-cash") {
    const required = rows.reduce((sum, item) => sum + item.trade, 0);
    const scale = required > Number(newCash) && required > 0 ? Number(newCash) / required : 1;
    rows = rows.map((item) => ({ ...item, trade: item.trade * scale }));
  }

  rows = rows.map((item) => ({
    ...item,
    postTradeValue: item.value + item.trade,
    postTradeWeight: postCashTotal > 0 ? ((item.value + item.trade) / postCashTotal) * 100 : 0,
  }));
  const cashNeeded = rows.reduce((sum, item) => sum + Math.max(0, item.trade), 0);
  const cashReleased = rows.reduce((sum, item) => sum + Math.max(0, -item.trade), 0);

  return {
    rows: rows.sort((left, right) => Math.abs(right.trade) - Math.abs(left.trade)),
    targetTotal,
    cashNeeded,
    cashReleased,
    unallocatedCash: mode === "new-cash" ? Math.max(0, Number(newCash) - cashNeeded) : 0,
  };
}

export function buildRiskReductionPlan(holdings, {
  totalValue = 0,
  holdingLimitPercent = 10,
  sectorLimitPercent = 25,
} = {}) {
  const values = new Map((holdings || []).map((holding) => [
    holding.symbol,
    finite(holding.marketValueInr) ?? 0,
  ]));
  const trades = new Map();
  const holdingCap = Number(totalValue) * Number(holdingLimitPercent) / 100;
  for (const [symbol, value] of values) {
    if (value > holdingCap) trades.set(symbol, holdingCap - value);
  }

  const sectors = new Map();
  for (const holding of holdings || []) {
    const sector = holding.sector || "Unclassified";
    if (!sectors.has(sector)) sectors.set(sector, []);
    sectors.get(sector).push(holding);
  }
  const sectorCap = Number(totalValue) * Number(sectorLimitPercent) / 100;
  for (const sectorHoldings of sectors.values()) {
    const afterHoldingCaps = sectorHoldings.reduce(
      (sum, holding) => sum + values.get(holding.symbol) + (trades.get(holding.symbol) || 0),
      0,
    );
    const additionalReduction = Math.max(0, afterHoldingCaps - sectorCap);
    if (!additionalReduction || !afterHoldingCaps) continue;
    for (const holding of sectorHoldings) {
      const valueAfterCap = values.get(holding.symbol) + (trades.get(holding.symbol) || 0);
      const share = valueAfterCap / afterHoldingCaps;
      trades.set(holding.symbol, (trades.get(holding.symbol) || 0) - (additionalReduction * share));
    }
  }

  const rows = (holdings || []).map((holding) => {
    const value = values.get(holding.symbol);
    const trade = trades.get(holding.symbol) || 0;
    return {
      key: holding.symbol,
      label: holding.name || holding.symbol,
      value,
      weight: totalValue > 0 ? value / totalValue * 100 : 0,
      trade,
      postTradeValue: value + trade,
      postTradeWeight: totalValue > 0 ? (value + trade) / totalValue * 100 : 0,
    };
  }).filter((item) => item.trade < -0.01)
    .sort((left, right) => left.trade - right.trade);
  return {
    rows,
    cashNeeded: 0,
    cashReleased: rows.reduce((sum, item) => sum + Math.abs(item.trade), 0),
    unallocatedCash: rows.reduce((sum, item) => sum + Math.abs(item.trade), 0),
    targetTotal: null,
  };
}
