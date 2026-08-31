import test from "node:test";
import assert from "node:assert/strict";

import { assetClassFor } from "../src/assetClassification.js";

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
