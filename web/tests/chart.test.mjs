import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortfolioChartData,
  getReturnChartDomain,
} from "../src/chart.js";

test("builds cash-flow-adjusted portfolio and normalized Nifty returns", () => {
  const data = buildPortfolioChartData({
    history: [
      { date: "2026-08-01", value: 100, invested: 100, netInvested: 100, benchmark: 24000 },
      { date: "2026-08-02", value: 110, invested: 100, netInvested: 100, benchmark: 24240 },
      { date: "2026-08-03", value: 210, invested: 205, netInvested: 200, benchmark: 24480 },
    ],
    range: "All",
    currency: "INR",
  });

  assert.equal(data[0].displayPortfolioReturn, 0);
  assert.equal(data[0].displayBenchmarkReturn, 0);
  assert.ok(Math.abs(data[1].displayPortfolioReturn - 10) < 1e-9);
  assert.ok(Math.abs(data[1].displayBenchmarkReturn - 1) < 1e-9);
  assert.ok(Math.abs(data[2].displayPortfolioReturn - 10) < 1e-9);
  assert.ok(Math.abs(data[2].displayBenchmarkReturn - 2) < 1e-9);
  assert.ok(Math.abs(data[2].relativeReturn - 8) < 1e-9);
});

test("carries the last valid benchmark through non-trading days", () => {
  const data = buildPortfolioChartData({
    history: [
      { date: "2026-08-01", value: 100, invested: 100, netInvested: 100, benchmark: 24000 },
      { date: "2026-08-02", value: 101, invested: 100, netInvested: 100, benchmark: null },
    ],
    range: "All",
    currency: "INR",
  });

  assert.equal(data[1].benchmark, 24000);
  assert.equal(data[1].displayBenchmarkReturn, 0);
});

test("return domain stays close to the relative-return data", () => {
  const domain = getReturnChartDomain([
    { displayPortfolioReturn: 1.88, displayBenchmarkReturn: -0.35 },
    { displayPortfolioReturn: 0, displayBenchmarkReturn: 0 },
  ]);

  assert.ok(domain[0] <= -0.35);
  assert.ok(domain[1] >= 1.88);
  assert.ok(domain[1] - domain[0] <= 5);
});
