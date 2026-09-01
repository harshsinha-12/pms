import test from "node:test";
import assert from "node:assert/strict";

import { assetClassFor, buildAssetAllocationSlices } from "../src/assetClassification.js";

test("classifies INR-listed US index ETFs as US Investments", () => {
  assert.equal(assetClassFor("ETF", "INR", "MAFANG.NS"), "US Investments");
  assert.equal(assetClassFor("ETF", "INR", "monq50.ns"), "US Investments");
});

test("classifies other INR ETFs as Commodities for the current portfolio view", () => {
  assert.equal(assetClassFor("ETF", "INR", "GOLDBEES.NS"), "Commodities");
  assert.equal(assetClassFor("ETF", "INR", "SILVERBEES.NS"), "Commodities");
});

test("classifies commodity holdings even when stored as stocks", () => {
  assert.equal(assetClassFor("STOCK", "INR", "GOLDBEES.NS"), "Commodities");
  assert.equal(assetClassFor("STOCK", "INR", "HINDALCO.NS", "Commodities"), "Commodities");
  assert.equal(assetClassFor("STOCK", "INR", "SBISILVER.NS", "Basic Materials"), "Commodities");
});

test("preserves the existing stock and USD ETF classifications", () => {
  assert.equal(assetClassFor("STOCK", "INR", "TCS.NS"), "Indian Stocks");
  assert.equal(assetClassFor("STOCK", "INR", "TCS.NS", "Technology"), "Indian Stocks");
  assert.equal(assetClassFor("STOCK", "USD", "NVDA"), "US Stocks");
  assert.equal(assetClassFor("ETF", "USD", "VOO"), "US ETFs");
});

test("copies the sector Commodities slice onto asset allocation", () => {
  const slices = buildAssetAllocationSlices(
    {
      "Indian Stocks": 930,
      "US Investments": 70,
    },
    1000,
    [
      { name: "Technology", value: 25.2 },
      { name: "Commodities", value: 8.5 },
      { name: "US", value: 7.0 },
    ],
  );

  assert.equal(Number(slices.Commodities.toFixed(1)), 85);
  assert.equal(Number(slices["Indian Stocks"].toFixed(1)), 845);
  assert.equal(slices["US Investments"], 70);
});

test("does not double-count Commodities already classified on holdings", () => {
  const slices = buildAssetAllocationSlices(
    {
      "Indian Stocks": 845,
      Commodities: 85,
      "US Investments": 70,
    },
    1000,
    [{ name: "Commodities", value: 8.5 }],
  );

  assert.equal(Number(slices.Commodities.toFixed(1)), 85);
  assert.equal(Number(slices["Indian Stocks"].toFixed(1)), 845);
});

test("merges US stocks and ETFs into US Investments", () => {
  const slices = buildAssetAllocationSlices(
    {
      "Indian Stocks": 80,
      "US Stocks": 10,
      "US ETFs": 10,
    },
    100,
    [],
  );

  assert.equal(slices["US Investments"], 20);
  assert.equal(slices["US Stocks"], undefined);
  assert.equal(slices["US ETFs"], undefined);
});
