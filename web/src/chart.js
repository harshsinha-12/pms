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
  now = new Date(),
}) {
  const points = Array.isArray(history) ? history.map((point) => ({ ...point })) : [];
  const numericCurrentValue = Number(currentValue);
  const numericCurrentInvested = Number(currentInvested);

  if (
    Number.isFinite(numericCurrentValue)
    && numericCurrentValue >= 0
    && (points.length > 0 || numericCurrentValue > 0)
  ) {
    const today = dateKeyInTimeZone(now);
    const latest = points.at(-1);
    if (latest?.date === today) {
      latest.value = numericCurrentValue;
      if (Number.isFinite(numericCurrentInvested)) latest.invested = numericCurrentInvested;
    } else {
      points.push({
        date: today,
        value: numericCurrentValue,
        invested: Number.isFinite(numericCurrentInvested) ? numericCurrentInvested : 0,
        benchmark: latest?.benchmark || 0,
      });
    }
  }

  const days = RANGE_DAYS[range];
  const visible = Number.isFinite(days) ? points.slice(-days) : points;
  return visible.map((point) => ({
    ...point,
    displayValue: currency === "USD" && usdInrRate ? point.value / usdInrRate : point.value,
    displayInvested: currency === "USD" && usdInrRate
      ? point.invested / usdInrRate
      : point.invested,
    displayBenchmark: currency === "USD" && usdInrRate ? point.benchmark / usdInrRate : point.benchmark,
  }));
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
