const RANGE_DAYS = { "1M": 31, "6M": 183, "1Y": 366, All: Infinity };

function dateKeyInTimeZone(value = new Date(), timeZone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function buildPortfolioChartData({
  history,
  range,
  currency,
  usdInrRate,
  currentValue,
  currentInvested,
  currentNetInvested,
  now = new Date(),
}) {
  const points = Array.isArray(history) ? history.map((point) => ({ ...point })) : [];
  const numericCurrentValue = Number(currentValue);
  const numericCurrentInvested = Number(currentInvested);
  const numericCurrentNetInvested = Number(currentNetInvested);

  if (
    Number.isFinite(numericCurrentValue)
    && numericCurrentValue >= 0
    && (points.length > 0 || numericCurrentValue > 0)
  ) {
    const today = dateKeyInTimeZone(now);
    const latest = points.at(-1);
    const latestBenchmark = [...points]
      .reverse()
      .map((point) => Number(point.benchmark))
      .find((value) => Number.isFinite(value) && value > 0);
    if (latest?.date === today) {
      latest.value = numericCurrentValue;
      if (Number.isFinite(numericCurrentInvested)) latest.invested = numericCurrentInvested;
      if (Number.isFinite(numericCurrentNetInvested)) latest.netInvested = numericCurrentNetInvested;
    } else {
      points.push({
        date: today,
        value: numericCurrentValue,
        invested: Number.isFinite(numericCurrentInvested) ? numericCurrentInvested : 0,
        netInvested: Number.isFinite(numericCurrentNetInvested)
          ? numericCurrentNetInvested
          : numericCurrentInvested,
        benchmark: latestBenchmark ?? null,
      });
    }
  }

  const days = RANGE_DAYS[range];
  let lastBenchmark = null;
  const normalized = points.map((point) => {
    const benchmark = Number(point.benchmark);
    const netInvested = Number(point.netInvested);
    if (Number.isFinite(benchmark) && benchmark > 0) lastBenchmark = benchmark;
    return {
      ...point,
      benchmark: lastBenchmark,
      netInvested: Number.isFinite(netInvested) ? netInvested : Number(point.invested),
    };
  });
  const visible = Number.isFinite(days) ? normalized.slice(-days) : normalized;
  const baseBenchmark = visible
    .map((point) => Number(point.benchmark))
    .find((value) => Number.isFinite(value) && value > 0);
  let cumulativePortfolioFactor = 1;

  return visible.map((point, index) => {
    if (index > 0) {
      const previous = visible[index - 1];
      const previousValue = Number(previous.value);
      const currentValueAtPoint = Number(point.value);
      const cashFlow = Number(point.netInvested) - Number(previous.netInvested);
      const capitalBase = previousValue + cashFlow;
      if (capitalBase > 0 && Number.isFinite(currentValueAtPoint) && Number.isFinite(cashFlow)) {
        // Unitize the portfolio so deposits and withdrawals change the number
        // of units, not the investment return of each unit.
        const dailyFactor = currentValueAtPoint / capitalBase;
        if (Number.isFinite(dailyFactor) && dailyFactor > 0) {
          cumulativePortfolioFactor *= dailyFactor;
        }
      }
    }

    const benchmarkValue = Number(point.benchmark);
    const benchmarkReturn = Number.isFinite(baseBenchmark)
      && Number.isFinite(benchmarkValue)
      && benchmarkValue > 0
      ? ((benchmarkValue / baseBenchmark) - 1) * 100
      : null;
    const portfolioReturn = (cumulativePortfolioFactor - 1) * 100;

    return {
      ...point,
      displayValue: currency === "USD" && usdInrRate ? point.value / usdInrRate : point.value,
      displayInvested: currency === "USD" && usdInrRate
        ? point.invested / usdInrRate
        : point.invested,
      displayPortfolioReturn: portfolioReturn,
      displayBenchmarkReturn: benchmarkReturn,
      relativeReturn: Number.isFinite(benchmarkReturn) ? portfolioReturn - benchmarkReturn : null,
    };
  });
}

export function buildHoldingChartData({
  history,
  holding,
  range,
  now = new Date(),
}) {
  if (!holding?.symbol) return [];

  const points = (Array.isArray(history) ? history : [])
    .map((point) => {
      const position = point.holdings?.find((item) => item.symbol === holding.symbol);
      return position ? {
        date: point.date,
        value: Number(position.value),
        invested: Number(position.invested),
      } : null;
    })
    .filter(Boolean);

  const currentValue = Number(holding.marketValueInr);
  const currentInvested = Number(holding.costBasisInr);
  if (Number.isFinite(currentValue) && Number.isFinite(currentInvested)) {
    const today = dateKeyInTimeZone(now);
    const latest = points.at(-1);
    if (latest?.date === today) {
      latest.value = currentValue;
      latest.invested = currentInvested;
    } else {
      points.push({ date: today, value: currentValue, invested: currentInvested });
    }
  }

  const days = RANGE_DAYS[range];
  return Number.isFinite(days) ? points.slice(-days) : points;
}

export function getPortfolioChartDomain(chartData, range) {
  if (range !== "All") return ["auto", "auto"];

  const maxValue = Math.max(
    ...chartData.flatMap((point) => [
      Number(point.displayValue ?? point.value),
      Number(point.displayInvested ?? point.invested),
    ]).filter(Number.isFinite),
    1,
  );
  const roughStep = maxValue / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceMultiplier = [1, 2, 2.5, 5, 10].find((candidate) => candidate >= normalized) || 10;
  const step = niceMultiplier * magnitude;

  return [0, Math.ceil(maxValue / step) * step];
}

export function getReturnChartDomain(chartData) {
  const values = chartData.flatMap((point) => [
    Number(point.displayPortfolioReturn),
    Number(point.displayBenchmarkReturn),
  ]).filter(Number.isFinite);
  if (!values.length) return [-1, 1];

  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const span = Math.max(maximum - minimum, 1);
  const paddedMinimum = minimum - span * 0.12;
  const paddedMaximum = maximum + span * 0.12;
  const roughStep = (paddedMaximum - paddedMinimum) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceMultiplier = [1, 2, 2.5, 5, 10].find((candidate) => candidate >= normalized) || 10;
  const step = niceMultiplier * magnitude;

  return [Math.floor(paddedMinimum / step) * step, Math.ceil(paddedMaximum / step) * step];
}
