import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDrawdownData,
  buildRiskReductionPlan,
  buildTargetPlan,
  calculateConcentration,
  calculatePerformanceAnalytics,
  calculateReturnAttribution,
} from "../src/portfolioAnalytics.js";

function tradingDate(index) {
  const date = new Date("2026-01-05T00:00:00Z");
  let remaining = index;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() > 0 && date.getUTCDay() < 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

test("performance analytics reports benchmark, active return and aligned risk metrics", () => {
  const chartData = Array.from({ length: 70 }, (_, index) => ({
    date: tradingDate(index),
    benchmark: 24000 * (1.0005 ** index),
    displayPortfolioReturn: ((1.001 ** index) - 1) * 100,
    displayBenchmarkReturn: ((1.0005 ** index) - 1) * 100,
  }));

  const result = calculatePerformanceAnalytics(chartData, { riskFreeRatePercent: 5 });

  assert.ok(result.portfolioReturn > result.niftyReturn);
  assert.ok(result.activeReturn > 0);
  assert.equal(result.observations, 69);
  assert.notEqual(result.annualizedVolatility, null);
  assert.notEqual(result.beta, null);
  assert.notEqual(result.trackingError, null);
  assert.equal(result.riskFreeRateSource, "Portfolio assumption");
});

test("risk metrics stay unavailable below the minimum useful history", () => {
  const chartData = Array.from({ length: 20 }, (_, index) => ({
    date: tradingDate(index),
    benchmark: 24000 + index,
    displayPortfolioReturn: index * 0.1,
    displayBenchmarkReturn: index * 0.05,
  }));

  const result = calculatePerformanceAnalytics(chartData);

  assert.equal(result.annualizedVolatility, null);
  assert.equal(result.beta, null);
  assert.equal(result.maximumDrawdown, null);
});

test("drawdown tracks the decline from the running high and days since peak", () => {
  const rows = buildDrawdownData([
    { date: "2026-01-01", displayPortfolioReturn: 0, displayBenchmarkReturn: 0 },
    { date: "2026-01-02", displayPortfolioReturn: 10, displayBenchmarkReturn: 5 },
    { date: "2026-01-05", displayPortfolioReturn: -1, displayBenchmarkReturn: 1 },
  ]);

  assert.ok(Math.abs(rows[2].portfolioDrawdown - -10) < 1e-9);
  assert.equal(rows[2].daysSincePeak, 3);
});

test("daily attribution neutralizes a contribution and ranks holding and sector effects", () => {
  const result = calculateReturnAttribution({
    range: "All",
    holdings: [
      { symbol: "AAA", name: "Alpha", sector: "Technology" },
      { symbol: "BBB", name: "Beta", sector: "Industrials" },
    ],
    transactions: [
      { symbol: "BBB", side: "BUY", quantity: 10, price: 10, tradedAt: "2026-01-02", fxRateToInr: 1 },
    ],
    history: [
      {
        date: "2026-01-01",
        value: 100,
        holdings: [{ symbol: "AAA", value: 100, invested: 100 }],
      },
      {
        date: "2026-01-02",
        value: 210,
        holdings: [
          { symbol: "AAA", value: 110, invested: 100 },
          { symbol: "BBB", value: 100, invested: 100 },
        ],
      },
      {
        date: "2026-01-03",
        value: 220,
        holdings: [
          { symbol: "AAA", value: 110, invested: 100 },
          { symbol: "BBB", value: 110, invested: 100 },
        ],
      },
    ],
  });

  assert.equal(result.method, "daily-flow-adjusted");
  assert.equal(result.holdings[0].symbol, "AAA");
  assert.ok(result.holdings[0].contributionPp > 9.9);
  assert.equal(result.sectors.length, 2);
});

test("concentration reports effective holdings and configurable breaches", () => {
  const result = calculateConcentration([
    { symbol: "AAA", marketValueInr: 60, sector: "Tech", currency: "INR", market: "NSE" },
    { symbol: "BBB", marketValueInr: 20, sector: "Tech", currency: "INR", market: "NSE" },
    { symbol: "CCC", marketValueInr: 20, sector: "Health", currency: "USD", market: "US" },
  ], { holdingLimitPercent: 50, sectorLimitPercent: 70 });

  assert.ok(Math.abs(result.effectiveHoldings - (1 / 0.44)) < 1e-9);
  assert.equal(result.holdingBreaches[0].key, "AAA");
  assert.equal(result.sectorBreaches[0].key, "Tech");
  assert.equal(result.countries.length, 2);
});

test("target planner respects the no-trade band and scales new-cash buys", () => {
  const items = [
    { key: "AAA", value: 70, weight: 70 },
    { key: "BBB", value: 30, weight: 30 },
  ];
  const plan = buildTargetPlan(items, { AAA: 50, BBB: 50 }, {
    mode: "new-cash",
    totalValue: 100,
    newCash: 20,
    noTradeBandPercent: 1,
  });

  assert.equal(plan.targetTotal, 100);
  assert.ok(plan.cashNeeded <= 20.000001);
  assert.equal(plan.rows.find((item) => item.key === "AAA").trade, 0);
  assert.ok(plan.rows.find((item) => item.key === "BBB").trade > 0);
});

test("risk reduction plan sells positions above holding and sector limits", () => {
  const plan = buildRiskReductionPlan([
    { symbol: "AAA", name: "Alpha", marketValueInr: 60, sector: "Tech" },
    { symbol: "BBB", name: "Beta", marketValueInr: 20, sector: "Tech" },
    { symbol: "CCC", name: "Gamma", marketValueInr: 20, sector: "Health" },
  ], { totalValue: 100, holdingLimitPercent: 50, sectorLimitPercent: 70 });

  assert.ok(plan.rows.some((item) => item.key === "AAA"));
  assert.ok(plan.cashReleased >= 10);
});
