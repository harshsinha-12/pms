import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowDownRight,
  ArrowUpRight,
  ArrowsLeftRight,
  AppleLogo,
  Bank,
  Buildings,
  CalendarBlank,
  CaretDown,
  ChartBar,
  ChartPieSlice,
  Check,
  ChartLineUp,
  Clock,
  CirclesThreePlus,
  CurrencyInr,
  DotsThreeVertical,
  GearSix,
  House,
  Info,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Receipt,
  SlidersHorizontal,
  SpinnerGap,
  TrendUp,
  Wallet,
  WindowsLogo,
  X,
} from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { portfolioApi } from "./api.js";
import { assetClassFor } from "./assetClassification.js";
import {
  buildDemoHistory,
  demoAllocation,
  demoHoldings,
  demoSummary,
  demoSymbols,
  demoTransactions,
} from "./demoData.js";
import { screenAveragingCandidates } from "./averaging.js";
import {
  buildHoldingChartData,
  buildPortfolioChartData,
  getPortfolioChartDomain,
  getReturnChartDomain,
} from "./chart.js";
import { screenUnderperformingHoldings } from "./underperformance.js";
import {
  buildRiskReductionPlan,
  buildTargetPlan,
  calculateConcentration,
  calculatePerformanceAnalytics,
  calculateReturnAttribution,
} from "./portfolioAnalytics.js";

const RANGE_DAYS = { "1M": 31, "6M": 183, "1Y": 366, All: Infinity };

function cx(...names) {
  return names.filter(Boolean).join(" ");
}

function InfoTooltip({ label, children }) {
  return (
    <span className="info-tooltip">
      <button type="button" className="info-button" aria-label={label}>
        <Info size={15} aria-hidden="true" />
      </button>
      <span className="info-tooltip-text" role="tooltip">{children}</span>
    </span>
  );
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function formatMoney(value, currency = "INR", maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits,
  }).format(Number(value || 0));
}

function formatSignedMoney(value, currency = "INR", maximumFractionDigits = 0) {
  const amount = Number(value || 0);
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${formatMoney(Math.abs(amount), currency, maximumFractionDigits)}`;
}

function formatSignedPercent(value, suffix = "%") {
  const amount = Number(value || 0);
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${Math.abs(amount).toFixed(2)}${suffix}`;
}

function formatIndianCompact(value, currency = "INR", usdInrRate = null) {
  const converted = currency === "USD" && usdInrRate ? value / usdInrRate : value;
  const symbol = currency === "USD" ? "$" : "₹";

  if (currency === "USD") {
    if (converted >= 1000000) return `${symbol}${(converted / 1000000).toFixed(1)}M`;
    if (converted >= 1000) return `${symbol}${Math.round(converted / 1000)}K`;
    return `${symbol}${Math.round(converted)}`;
  }

  if (converted >= 10000000) return `${symbol}${(converted / 10000000).toFixed(1)}Cr`;
  if (converted >= 100000) return `${symbol}${Math.round(converted / 100000)}L`;
  if (converted >= 1000) return `${symbol}${Math.round(converted / 1000)}K`;
  return `${symbol}${Math.round(converted)}`;
}

function valueInInr(holding, unitPrice = holding.currentPrice, usdInrRate = null) {
  if (unitPrice === holding.currentPrice && Number.isFinite(holding.marketValueInr)) {
    return holding.marketValueInr;
  }
  if (unitPrice === holding.averagePrice && Number.isFinite(holding.costBasisInr)) {
    return holding.costBasisInr;
  }
  const nativeValue = Number(holding.quantity || 0) * Number(unitPrice || 0);
  return holding.currency === "USD" ? nativeValue * Number(usdInrRate || 0) : nativeValue;
}

function holdingDayChange(holding, usdInrRate = null) {
  const previousClose = Number(holding.previousClose);
  const hasClose = Number.isFinite(previousClose) && previousClose > 0;
  const percent = hasClose
    ? ((Number(holding.currentPrice) - previousClose) / previousClose) * 100
    : null;
  const storedPnl = Number(holding.dayPnlInr);
  let valueInr = Number.isFinite(storedPnl) ? storedPnl : null;
  if (valueInr == null && hasClose) {
    const nativeMove = Number(holding.quantity || 0) * (Number(holding.currentPrice) - previousClose);
    valueInr = holding.currency === "USD"
      ? nativeMove * Number(usdInrRate || 0)
      : nativeMove;
  }
  return {
    percent: Number.isFinite(percent) ? percent : null,
    valueInr: Number.isFinite(valueInr) ? valueInr : null,
  };
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function optionalNumber(value) {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : null;
}

function explicitUsdInrRate(payload, summary) {
  const candidates = [
    payload.usdInrRate,
    payload.usd_inr_rate,
    payload.usd_inr,
    payload.fx_rate,
    payload.fx_rate_to_inr,
    payload.fx?.usd_inr,
    payload.fx?.usdInr,
    payload.fx?.rate,
    payload.exchange_rates?.USDINR,
    payload.exchange_rates?.USD_INR,
    payload.market_data?.usd_inr_rate,
    summary.usdInrRate,
    summary.usd_inr_rate,
    summary.usd_inr,
    summary.fx_rate,
    summary.fx?.rate,
  ];

  for (const candidate of candidates) {
    const nestedValue = candidate && typeof candidate === "object"
      ? firstDefined(candidate.rate, candidate.value)
      : candidate;
    const rate = positiveNumber(nestedValue);
    if (rate) {
      return {
        rate,
        isStale: Boolean(candidate && typeof candidate === "object" && firstDefined(candidate.is_stale, candidate.isStale, false)),
      };
    }
  }
  return null;
}

function normalizeHolding(raw, index = 0) {
  const symbol = firstDefined(raw.symbol, raw.ticker, "—");
  const currency = firstDefined(
    raw.currency,
    symbol.endsWith(".NS") || symbol.endsWith(".BO") ? "INR" : "USD",
  );
  const market = firstDefined(
    raw.market,
    raw.exchange,
    symbol.endsWith(".BO") ? "BSE" : currency === "USD" ? "US" : "NSE",
  );
  const assetType = firstDefined(raw.assetType, raw.asset_type, raw.assetClass, raw.asset_class, raw.type);

  return {
    id: String(firstDefined(raw.latest_transaction_id, raw.id, raw.holding_id, raw.transaction_id, symbol, index)),
    latestTransactionId: raw.latest_transaction_id ? String(raw.latest_transaction_id) : null,
    symbol,
    name: firstDefined(raw.name, raw.long_name, raw.company_name, symbol, "Unknown asset"),
    market,
    sector: firstDefined(raw.sector, raw.industry_sector, null),
    assetClass: assetClassFor(assetType, currency, symbol, firstDefined(raw.sector, raw.industry_sector, null)),
    assetType: String(assetType || "STOCK").toUpperCase().includes("ETF") ? "ETF" : "STOCK",
    trailingPe: optionalNumber(firstDefined(raw.trailingPe, raw.trailing_pe)),
    forwardPe: optionalNumber(firstDefined(raw.forwardPe, raw.forward_pe)),
    currency,
    quantity: Number(firstDefined(raw.quantity, raw.units, 0)),
    averagePrice: Number(
      firstDefined(raw.averagePrice, raw.average_price, raw.avg_price, raw.purchase_price, 0),
    ),
    currentPrice: Number(firstDefined(raw.currentPrice, raw.current_price, raw.price, 0)),
    previousClose: optionalNumber(firstDefined(raw.previousClose, raw.previous_close)),
    costBasisInr: Number(firstDefined(raw.costBasisInr, raw.cost_basis_inr, NaN)),
    marketValueNative: Number(firstDefined(raw.marketValueNative, raw.market_value_native, NaN)),
    marketValueInr: Number(firstDefined(raw.marketValueInr, raw.market_value_inr, NaN)),
    unrealizedPnlInr: Number(firstDefined(raw.unrealizedPnlInr, raw.unrealized_pnl_inr, NaN)),
    realizedPnlInr: Number(firstDefined(raw.realizedPnlInr, raw.realized_pnl_inr, 0)),
    dayPnlInr: optionalNumber(firstDefined(raw.dayPnlInr, raw.day_pnl_inr)),
    quoteIsStale: Boolean(firstDefined(raw.quoteIsStale, raw.quote_is_stale, false)),
    tradedAt: firstDefined(raw.tradedAt, raw.latest_traded_at, raw.traded_at, null),
    color: firstDefined(raw.color, ["#b89252", "#b91f2e", "#5b63de", "#11130f"][index % 4]),
  };
}

function normalizeTransactionForEdit(raw) {
  return {
    id: String(firstDefined(raw.id, raw.transaction_id, "")),
    symbol: String(firstDefined(raw.symbol, raw.ticker, "")).toUpperCase(),
    side: String(firstDefined(raw.side, raw.type, raw.transaction_type, "BUY")).toUpperCase(),
    quantity: Number(firstDefined(raw.quantity, raw.units, 0)),
    price: Number(firstDefined(raw.price, raw.average_price, raw.averagePrice, 0)),
    fees: Number(firstDefined(raw.fees, 0)),
    fxRateToInr: Number(firstDefined(raw.fxRateToInr, raw.fx_rate_to_inr, 1)),
    tradedAt: firstDefined(raw.traded_at, raw.transaction_date, raw.date, raw.created_at),
    createdAt: firstDefined(raw.created_at, raw.traded_at, raw.transaction_date, raw.date),
    currency: firstDefined(raw.currency, "INR"),
    name: firstDefined(raw.name, raw.company_name, ""),
    assetType: firstDefined(raw.asset_type, raw.assetType, "STOCK"),
    sector: firstDefined(raw.sector, ""),
  };
}

function latestTransactionForHolding(rows, holding) {
  const candidates = rows
    .map(normalizeTransactionForEdit)
    .filter((transaction) => transaction.id && transaction.symbol === holding.symbol)
    .sort((left, right) => {
      const tradedDifference = new Date(right.tradedAt || 0) - new Date(left.tradedAt || 0);
      if (tradedDifference) return tradedDifference;
      return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
    });

  if (!holding.latestTransactionId) return null;
  return candidates.find((transaction) => transaction.id === holding.latestTransactionId) ?? null;
}

function transactionInputDate(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || new Date().toISOString().slice(0, 10);
}

function normalizeSummary(raw = {}) {
  const totalValue = Number(
    firstDefined(
      raw.totalValue,
      raw.total_value,
      raw.current_value,
      raw.current_value_inr,
      raw.portfolio_value,
      demoSummary.totalValue,
    ),
  );
  const todayChange = Number(
    firstDefined(raw.todayChange, raw.today_change, raw.day_change, raw.day_pnl_inr, 0),
  );
  const inferredDayPercent = totalValue - todayChange
    ? (todayChange / (totalValue - todayChange)) * 100
    : 0;

  return {
    totalValue,
    allTimeGain: Number(
      firstDefined(
        raw.allTimeGain,
        raw.all_time_gain,
        raw.absolute_return,
        raw.total_pnl,
        raw.total_pnl_inr,
        demoSummary.allTimeGain,
      ),
    ),
    allTimeGainPercent: Number(
      firstDefined(
        raw.allTimeGainPercent,
        raw.all_time_gain_percent,
        raw.absolute_return_percent,
        raw.total_pnl_percent,
        demoSummary.allTimeGainPercent,
      ),
    ),
    todayChange,
    todayChangePercent: Number(
      firstDefined(
        raw.todayChangePercent,
        raw.today_change_percent,
        raw.day_change_percent,
        inferredDayPercent,
      ),
    ),
    xirr: Number(firstDefined(raw.xirr, raw.xirr_percent, 0)),
    cagr: Number(firstDefined(raw.cagr, raw.cagr_percent, 0)),
    trailingPe: optionalNumber(firstDefined(raw.trailingPe, raw.trailing_pe)),
    forwardPe: optionalNumber(firstDefined(raw.forwardPe, raw.forward_pe)),
    trailingPeCoverage: Number(firstDefined(
      raw.trailingPeCoverage,
      raw.trailing_pe_coverage_percent,
      0,
    )),
    forwardPeCoverage: Number(firstDefined(
      raw.forwardPeCoverage,
      raw.forward_pe_coverage_percent,
      0,
    )),
    invested: Number(
      firstDefined(
        raw.invested,
        raw.total_invested,
        raw.invested_value,
        raw.cost_basis_inr,
        raw.net_invested_inr,
        demoSummary.invested,
      ),
    ),
    netInvested: Number(firstDefined(
      raw.netInvested,
      raw.net_invested_inr,
      raw.invested,
      raw.cost_basis_inr,
      demoSummary.invested,
    )),
    withdrawn: Number(firstDefined(raw.withdrawn, raw.total_withdrawn, demoSummary.withdrawn)),
    cash: Number(firstDefined(raw.cash, raw.cash_balance, demoSummary.cash)),
    unrealizedGain: Number(
      firstDefined(raw.unrealizedGain, raw.unrealized_gain, raw.unrealized_pnl_inr, 0),
    ),
    realizedGain: Number(
      firstDefined(raw.realizedGain, raw.realized_gain, raw.realized_pnl_inr, 0),
    ),
  };
}

function unpackPortfolio(response) {
  const payload = response?.data ?? response?.portfolio ?? response ?? {};
  const rawHoldings = firstDefined(payload.holdings, payload.positions, []);
  const rawSummary = firstDefined(payload.summary, payload.metrics, payload);
  const rawHistory = firstDefined(payload.history, payload.portfolio_history, payload.daily_values, []);
  const rawSectorAllocation = firstDefined(
    payload.allocationBySector,
    payload.allocation_by_sector,
    [],
  );
  const normalizedHoldings = Array.isArray(rawHoldings)
    ? rawHoldings.map((holding, index) => normalizeHolding(holding, index))
    : [];
  const explicitRate = explicitUsdInrRate(payload, rawSummary);
  const inferredRate = normalizedHoldings
    .filter((holding) => holding.currency === "USD")
    .map((holding) => {
      const nativeValue = positiveNumber(holding.marketValueNative)
        || positiveNumber(holding.quantity * holding.currentPrice);
      return nativeValue && positiveNumber(holding.marketValueInr / nativeValue);
    })
    .find(Boolean);
  const usdInrRate = explicitRate?.rate || inferredRate || null;
  const usdInrStatus = explicitRate
    ? explicitRate.isStale ? "cached" : "live"
    : inferredRate ? "portfolio" : "unavailable";
  const groupedAllocation = normalizedHoldings.reduce((groups, holding) => {
    groups[holding.assetClass] = (groups[holding.assetClass] || 0) + valueInInr(holding, holding.currentPrice, usdInrRate);
    return groups;
  }, {});
  const allocationTotal = Object.values(groupedAllocation).reduce((sum, value) => sum + value, 0);
  const allocationColors = {
    "Indian Stocks": "#11662f",
    "Commodities": "#4fa45e",
    "US Investments": "#5b63de",
    "US Stocks": "#b5d4b7",
    "US ETFs": "#8ebc98",
  };
  const sectorColors = ["#11662f", "#4f8c5d", "#8ebc98", "#b89252", "#5b63de", "#8f6b53", "#9fa69e"];
  const derivedSectorGroups = normalizedHoldings.reduce((groups, holding) => {
    const sector = holding.sector || "Unclassified";
    groups[sector] = (groups[sector] || 0) + valueInInr(holding, holding.currentPrice, usdInrRate);
    return groups;
  }, {});
  const sectorAllocation = Array.isArray(rawSectorAllocation) && rawSectorAllocation.length
    ? rawSectorAllocation.map((item, index) => ({
        name: firstDefined(item.name, item.key, "Unclassified"),
        value: Number(firstDefined(item.percentage, item.value, 0)),
        color: sectorColors[index % sectorColors.length],
      }))
    : Object.entries(derivedSectorGroups).map(([name, value], index) => ({
        name,
        value: allocationTotal ? (value / allocationTotal) * 100 : 0,
        color: sectorColors[index % sectorColors.length],
      }));

  return {
    holdings: normalizedHoldings,
    summary: normalizeSummary(rawSummary),
    history: Array.isArray(rawHistory)
      ? rawHistory
          .map((point) => ({
            date: firstDefined(point.date, point.snapshot_date, point.timestamp),
            value: Number(
              firstDefined(point.value, point.portfolio_value, point.total_value, point.total_value_inr, 0),
            ),
            invested: Number(firstDefined(
              point.invested,
              point.cost_basis,
              point.cost_basis_inr,
              point.net_invested_inr,
              0,
            )),
            netInvested: Number(firstDefined(
              point.netInvested,
              point.net_invested_inr,
              point.invested,
              point.cost_basis_inr,
              0,
            )),
            benchmark: (() => {
              const rawBenchmark = firstDefined(point.benchmark, point.benchmark_value);
              return rawBenchmark == null ? null : Number(rawBenchmark);
            })(),
            holdings: Array.isArray(point.holdings)
              ? point.holdings.map((holding) => ({
                  symbol: firstDefined(holding.symbol, holding.ticker),
                  quantity: Number(firstDefined(holding.quantity, 0)),
                  value: Number(firstDefined(
                    holding.value,
                    holding.market_value,
                    holding.market_value_inr,
                    0,
                  )),
                  invested: Number(firstDefined(
                    holding.invested,
                    holding.cost_basis,
                    holding.cost_basis_inr,
                    0,
                  )),
                }))
              : [],
          }))
          .filter((point) => point.date && (point.value || point.invested))
      : [],
    allocation: Object.entries(groupedAllocation)
      .map(([name, value], index) => ({
        name,
        value: allocationTotal ? (value / allocationTotal) * 100 : 0,
        color: allocationColors[name] || demoAllocation[index % demoAllocation.length]?.color || "#d7dbd2",
      }))
      .sort((left, right) => right.value - left.value),
    sectorAllocation,
    lastUpdated: firstDefined(payload.lastUpdated, payload.last_updated, payload.as_of),
    usdInrRate,
    usdInrStatus,
  };
}

function formatTimestamp(date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function shortDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" }).format(date);
}

function fullDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function InstrumentMark({ symbol, className = "asset-mark", color = "#5a7560" }) {
  const upper = String(symbol || "").toUpperCase();
  let Icon = Buildings;
  if (upper.includes("HDFC")) Icon = Bank;
  else if (upper.includes("NIFTY") || upper.includes("BEES")) Icon = ChartLineUp;
  else if (upper === "AAPL") Icon = AppleLogo;
  else if (upper === "MSFT") Icon = WindowsLogo;

  return (
    <span className={className} style={{ "--mark-color": color }} aria-hidden="true">
      <Icon size={18} weight={upper === "AAPL" || upper === "MSFT" ? "fill" : "bold"} />
    </span>
  );
}

function Sidebar({ activeItem, onNavigate }) {
  const items = [
    { id: "overview", label: "Overview", Icon: House },
    { id: "holdings", label: "Holdings", Icon: ChartPieSlice },
    { id: "transactions", label: "Transactions", Icon: ArrowsLeftRight },
    { id: "analytics", label: "Analytics", Icon: ChartBar },
  ];

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <button className="brand" type="button" onClick={() => onNavigate("overview")} aria-label="Quiet Capital home">
        <CirclesThreePlus size={43} weight="thin" />
      </button>
      <nav className="sidebar-nav">
        {items.map(({ id, label, Icon }) => (
          <button
            className={cx("nav-item", id === activeItem && "is-active")}
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            aria-current={id === activeItem ? "page" : undefined}
          >
            <Icon size={21} weight={id === activeItem ? "duotone" : "regular"} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="nav-item" type="button" onClick={() => onNavigate("settings")}>
          <GearSix size={21} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

function Topbar({ activeView, lastUpdated, refreshing, onRefresh, onAdd }) {
  const title = activeView === "holdings"
    ? "Holdings"
    : activeView === "analytics" ? "Performance & risk" : "Good morning, Harsh";
  const context = activeView === "holdings"
    ? "Open positions"
    : activeView === "analytics" ? "Portfolio analytics" : "Prices";
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        <p>
          <Clock size={17} />
          {context} as of {formatTimestamp(lastUpdated)} IST
        </p>
      </div>
      <div className="topbar-actions">
        <button className="primary-button" type="button" onClick={onAdd}>
          <Plus size={20} weight="bold" />
          Add transaction
        </button>
        <button className="text-button" type="button" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? (
            <SpinnerGap className="spin" size={20} />
          ) : (
            <ArrowClockwise size={20} />
          )}
          {refreshing ? "Refreshing…" : "Refresh prices"}
        </button>
      </div>
    </header>
  );
}

function PortfolioSummary({ summary, currency, usdInrRate, onCurrencyChange }) {
  const displayCurrency = currency === "USD" && usdInrRate ? "USD" : "INR";
  const total = displayCurrency === "USD" ? summary.totalValue / usdInrRate : summary.totalValue;
  const gain = displayCurrency === "USD" ? summary.allTimeGain / usdInrRate : summary.allTimeGain;
  const today = displayCurrency === "USD" ? summary.todayChange / usdInrRate : summary.todayChange;

  return (
    <section className="portfolio-summary" aria-labelledby="portfolio-value-label">
      <div>
        <p className="eyebrow" id="portfolio-value-label">Portfolio value</p>
        <div className="portfolio-value">
          {formatMoney(total, displayCurrency, 0)}
        </div>
        <div className="return-line">
          <span>All-time gain</span>
          <strong className={gain < 0 ? "negative" : gain > 0 ? "positive" : "neutral"}>
            {formatSignedMoney(gain, displayCurrency)} ({summary.allTimeGainPercent.toFixed(2)}%)
          </strong>
          <span className="separator" aria-hidden="true" />
          <span>Today&apos;s change</span>
          <strong className={today < 0 ? "negative" : today > 0 ? "positive" : "neutral"}>
            {formatSignedMoney(today, displayCurrency)} ({summary.todayChangePercent.toFixed(2)}%)
          </strong>
        </div>
      </div>
      <div className="currency-toggle" role="group" aria-label="Portfolio currency">
        {["INR", "USD"].map((item) => (
          <button
            key={item}
            type="button"
            className={currency === item ? "is-selected" : ""}
            onClick={() => onCurrencyChange(item)}
            aria-pressed={currency === item}
            disabled={item === "USD" && !usdInrRate}
            title={item === "USD" && !usdInrRate ? "USD display is available when the portfolio API returns USD/INR" : undefined}
          >
            {item}
          </button>
        ))}
      </div>
    </section>
  );
}

function ChartTooltip({ active, payload, label, currency, comparison }) {
  if (!active || !payload?.length) return null;
  const portfolioValue = payload.find((item) => item.dataKey === "displayValue")?.value;
  const investedValue = payload.find((item) => item.dataKey === "displayInvested")?.value;
  const portfolioReturn = payload.find((item) => item.dataKey === "displayPortfolioReturn")?.value;
  const benchmarkReturn = payload.find((item) => item.dataKey === "displayBenchmarkReturn")?.value;
  const relativeReturn = payload[0]?.payload?.relativeReturn;

  if (comparison) {
    return (
      <div className="chart-tooltip comparison-tooltip">
        <span>{fullDate(label)}</span>
        <div className="tooltip-metric">
          <small>Portfolio</small>
          <strong>{formatSignedPercent(portfolioReturn)}</strong>
        </div>
        <div className="tooltip-metric">
          <small>Nifty 50</small>
          <strong>{Number.isFinite(benchmarkReturn) ? formatSignedPercent(benchmarkReturn) : "Unavailable"}</strong>
        </div>
        {Number.isFinite(relativeReturn) ? (
          <small className={relativeReturn >= 0 ? "positive" : "negative"}>
            {formatSignedPercent(relativeReturn, " pp")} {relativeReturn >= 0 ? "ahead" : "behind"}
          </small>
        ) : null}
      </div>
    );
  }

  return (
    <div className="chart-tooltip">
      <span>{fullDate(label)}</span>
      <strong>{formatMoney(portfolioValue, currency)}</strong>
      {Number.isFinite(investedValue) ? <small>Invested · {formatMoney(investedValue, currency)}</small> : null}
    </div>
  );
}

function PortfolioChart({ history, currentValue, currentInvested, currentNetInvested, range, currency, usdInrRate, benchmark, onRangeChange, onBenchmarkChange, lockBenchmark = false }) {
  const chartData = useMemo(() => {
    return buildPortfolioChartData({
      history,
      range,
      currency,
      usdInrRate,
      currentValue,
      currentInvested,
      currentNetInvested,
    });
  }, [currency, currentInvested, currentNetInvested, currentValue, history, range, usdInrRate]);

  const domain = benchmark ? getReturnChartDomain(chartData) : getPortfolioChartDomain(chartData, range);
  const hasBenchmarkData = chartData.some((point) => Number.isFinite(point.displayBenchmarkReturn));

  return (
    <section className="chart-section" aria-label="Portfolio history">
      <div className="chart-toolbar">
        <div className="range-tabs" role="group" aria-label="Chart date range">
          {Object.keys(RANGE_DAYS).map((item) => (
            <button
              type="button"
              key={item}
              className={range === item ? "is-selected" : ""}
              onClick={() => onRangeChange(item)}
              aria-pressed={range === item}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="chart-toolbar-actions">
          <div className="chart-legend" aria-label="Chart series">
            {benchmark ? (
              <>
                <span><i className="current-series" />Portfolio return</span>
                <span><i className="benchmark-series" />Nifty 50</span>
              </>
            ) : (
              <>
                <span><i className="current-series" />Current value</span>
                <span><i className="invested-series" />Invested</span>
              </>
            )}
          </div>
          {!lockBenchmark ? <label className="benchmark-control">
            <span>vs Nifty 50</span>
            <button
              className={cx("switch", benchmark && "is-on")}
              type="button"
              role="switch"
              aria-checked={benchmark}
              onClick={() => onBenchmarkChange(!benchmark)}
            >
              <span />
            </button>
            <InfoTooltip label="About the Nifty 50 comparison">
              Compares unitized portfolio return with Nifty 50 return. Added or withdrawn capital does not count as investment performance, and both series reset to 0% at the start of the selected period.
            </InfoTooltip>
          </label> : null}
        </div>
      </div>
      <div className="chart-canvas">
        {chartData.length === 0 ? (
          <div className="chart-empty">
            <ChartLineUp size={28} weight="duotone" />
            <strong>Your daily portfolio history will appear here</strong>
            <span>Add your first holding, then refresh prices to create today&apos;s snapshot.</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 16, right: 4, bottom: 2, left: 0 }}>
            <defs>
              <linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#83b985" stopOpacity={0.28} />
                <stop offset="94%" stopColor="#83b985" stopOpacity={0.015} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#d9ddd4" strokeDasharray="2 3" />
            <XAxis
              dataKey="date"
              axisLine={{ stroke: "#cbd0c7" }}
              tickLine={false}
              tick={{ fill: "#656a64", fontSize: 11 }}
              minTickGap={55}
              tickFormatter={shortDate}
            />
            <YAxis
              domain={domain}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#656a64", fontSize: 11 }}
              width={44}
              tickFormatter={(value) => benchmark
                ? `${Number(value).toFixed(Number.isInteger(value) ? 0 : 1)}%`
                : formatIndianCompact(value, currency).replace(currency === "INR" ? "₹" : "$", "")}
            />
            {benchmark ? <ReferenceLine y={0} stroke="#aeb4ad" strokeDasharray="3 3" /> : null}
            <Tooltip
              cursor={{ stroke: "#8d978e", strokeDasharray: "3 3" }}
              content={<ChartTooltip currency={currency} comparison={benchmark} />}
            />
            {benchmark ? (
              <>
                <Line
                  type="monotone"
                  dataKey="displayPortfolioReturn"
                  stroke="#176a35"
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#176a35", stroke: "#fff", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="displayBenchmarkReturn"
                  stroke="#a77931"
                  strokeWidth={1.8}
                  strokeDasharray="5 4"
                  dot={false}
                  activeDot={{ r: 3, fill: "#a77931", stroke: "#fff", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </>
            ) : null}
            {!benchmark ? (
              <>
                <Area
                  type="monotone"
                  dataKey="displayValue"
                  stroke="#176a35"
                  strokeWidth={2}
                  fill="url(#portfolioFill)"
                  activeDot={{ r: 4, fill: "#176a35", stroke: "#fff", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="displayInvested"
                  stroke="#a77931"
                  strokeWidth={1.7}
                  strokeDasharray="5 4"
                  dot={false}
                  activeDot={{ r: 3, fill: "#a77931", stroke: "#fff", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </>
            ) : null}
          </AreaChart>
          </ResponsiveContainer>
        )}
        {benchmark && !hasBenchmarkData && chartData.length > 0 ? (
          <div className="benchmark-unavailable">Refresh prices to load Nifty 50 history.</div>
        ) : null}
      </div>
    </section>
  );
}

function AssetMark({ holding }) {
  return <InstrumentMark symbol={holding.symbol} color={holding.color} />;
}

const HOLDING_SORT_DEFAULTS = {
  asset: "ascending",
  market: "ascending",
  quantity: "descending",
  averagePrice: "descending",
  currentPrice: "descending",
  pe: "descending",
  invested: "descending",
  value: "descending",
  todayPercent: "descending",
  todayValue: "descending",
  pnl: "descending",
  allocation: "descending",
};

function SortableHoldingHeader({ column, label, sort, onSort }) {
  const isActive = sort.column === column;
  const nextDirection = isActive && sort.direction === "ascending"
    ? "descending"
    : isActive ? "ascending" : HOLDING_SORT_DEFAULTS[column];

  return (
    <th aria-sort={isActive ? sort.direction : "none"}>
      <button
        type="button"
        className={cx("sort-button", isActive && "is-active")}
        onClick={() => onSort(column)}
        aria-label={`Sort by ${label}, ${nextDirection}`}
      >
        <span>{label}</span>
        <span className="sort-indicator" aria-hidden="true">
          {isActive ? sort.direction === "ascending" ? "↑" : "↓" : "↕"}
        </span>
      </button>
    </th>
  );
}

function HoldingsTable({
  holdings,
  query,
  usdInrRate,
  usdInrStatus,
  compact = false,
  onQueryChange,
  onBuy,
  onEdit,
  onSell,
  onAnalyze,
  onShowAll,
}) {
  const [menuOpen, setMenuOpen] = useState(null);
  const [sort, setSort] = useState({ column: null, direction: null });
  const [performanceFilter, setPerformanceFilter] = useState("all");
  const underperformance = useMemo(
    () => screenUnderperformingHoldings(holdings, usdInrRate),
    [holdings, usdInrRate],
  );
  const underperformingSymbols = useMemo(
    () => new Set(underperformance.candidates.map((holding) => holding.symbol)),
    [underperformance],
  );
  const portfolioValue = holdings.reduce(
    (sum, item) => sum + valueInInr(item, item.currentPrice, usdInrRate),
    0,
  );
  const filtered = useMemo(
    () => holdings.filter((holding) => (
      (performanceFilter === "all" || underperformingSymbols.has(holding.symbol))
      && `${holding.name} ${holding.symbol}`.toLowerCase().includes(query.toLowerCase())
    )),
    [holdings, performanceFilter, query, underperformingSymbols],
  );
  const sortedHoldings = useMemo(() => {
    if (!sort.column) return filtered;

    function sortValue(holding) {
      const invested = valueInInr(holding, holding.averagePrice, usdInrRate);
      const current = valueInInr(holding, holding.currentPrice, usdInrRate);
      switch (sort.column) {
        case "asset": return `${holding.name} ${holding.symbol}`.toLowerCase();
        case "market": return `${holding.market} ${holding.sector || ""}`.toLowerCase();
        case "quantity": return holding.quantity;
        case "averagePrice": return holding.averagePrice;
        case "currentPrice": return holding.currentPrice;
        case "pe": return holding.trailingPe;
        case "invested": return invested;
        case "value":
        case "allocation": return current;
        case "todayPercent": return holdingDayChange(holding, usdInrRate).percent;
        case "todayValue": return holdingDayChange(holding, usdInrRate).valueInr;
        case "pnl": return Number.isFinite(holding.unrealizedPnlInr)
          ? holding.unrealizedPnlInr
          : current - invested;
        default: return null;
      }
    }

    return filtered
      .map((holding, index) => ({ holding, index }))
      .sort((left, right) => {
        const leftValue = sortValue(left.holding);
        const rightValue = sortValue(right.holding);
        const leftMissing = leftValue === null || leftValue === undefined || Number.isNaN(leftValue);
        const rightMissing = rightValue === null || rightValue === undefined || Number.isNaN(rightValue);
        if (leftMissing || rightMissing) {
          if (leftMissing && rightMissing) return left.index - right.index;
          return leftMissing ? 1 : -1;
        }

        const comparison = typeof leftValue === "string"
          ? leftValue.localeCompare(rightValue)
          : Number(leftValue) - Number(rightValue);
        return comparison === 0
          ? left.index - right.index
          : comparison * (sort.direction === "ascending" ? 1 : -1);
      })
      .map(({ holding }) => holding);
  }, [filtered, sort, usdInrRate]);
  const visibleHoldings = compact && !query ? sortedHoldings.slice(0, 5) : sortedHoldings;

  function handleSort(column) {
    setSort((current) => ({
      column,
      direction: current.column === column
        ? current.direction === "ascending" ? "descending" : "ascending"
        : HOLDING_SORT_DEFAULTS[column],
    }));
  }

  return (
    <section className="holdings-section" id="holdings-section" aria-labelledby="holdings-title">
      <div className="holdings-heading">
        <div className="table-search">
          <MagnifyingGlass size={19} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search by name or symbol"
            aria-label="Search holdings"
          />
          {query ? (
            <button type="button" onClick={() => onQueryChange("")} aria-label="Clear search">
              <X size={15} />
            </button>
          ) : null}
        </div>
        <div className="holdings-heading-meta">
          <div className="holding-filter" role="group" aria-label="Holding performance filter">
            <button
              type="button"
              className={performanceFilter === "all" ? "is-selected" : ""}
              onClick={() => setPerformanceFilter("all")}
              aria-pressed={performanceFilter === "all"}
            >
              All
            </button>
            <button
              type="button"
              className={performanceFilter === "underperforming" ? "is-selected" : ""}
              onClick={() => setPerformanceFilter("underperforming")}
              aria-pressed={performanceFilter === "underperforming"}
            >
              Underperforming {underperformance.candidates.length}
            </button>
          </div>
          <span id="holdings-title">{filtered.length} holdings</span>
        </div>
      </div>
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <SortableHoldingHeader column="asset" label="Asset" sort={sort} onSort={handleSort} />
              <SortableHoldingHeader column="market" label="Market" sort={sort} onSort={handleSort} />
              <SortableHoldingHeader column="quantity" label="Qty" sort={sort} onSort={handleSort} />
              <SortableHoldingHeader column="averagePrice" label="Avg price" sort={sort} onSort={handleSort} />
              <SortableHoldingHeader column="currentPrice" label="Current price" sort={sort} onSort={handleSort} />
              <SortableHoldingHeader column="todayPercent" label="Today %" sort={sort} onSort={handleSort} />
              <SortableHoldingHeader column="todayValue" label="Today" sort={sort} onSort={handleSort} />
              <SortableHoldingHeader column="pe" label="P/E T / F" sort={sort} onSort={handleSort} />
              <SortableHoldingHeader column="invested" label="Invested" sort={sort} onSort={handleSort} />
              <SortableHoldingHeader column="value" label="Value" sort={sort} onSort={handleSort} />
              <SortableHoldingHeader column="pnl" label="U / R P&L" sort={sort} onSort={handleSort} />
              <SortableHoldingHeader column="allocation" label="Allocation" sort={sort} onSort={handleSort} />
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visibleHoldings.map((holding) => {
              const invested = valueInInr(holding, holding.averagePrice, usdInrRate);
              const current = valueInInr(holding, holding.currentPrice, usdInrRate);
              const gain = Number.isFinite(holding.unrealizedPnlInr)
                ? holding.unrealizedPnlInr
                : current - invested;
              const realized = Number(holding.realizedPnlInr || 0);
              const gainPercent = invested ? (gain / invested) * 100 : 0;
              const allocation = portfolioValue ? (current / portfolioValue) * 100 : 0;
              const nativeInvested = holding.quantity * holding.averagePrice;
              const nativeValue = holding.quantity * holding.currentPrice;
              const today = holdingDayChange(holding, usdInrRate);

              return (
                <tr key={holding.id}>
                  <td>
                    <div className="asset-cell">
                      <AssetMark holding={holding} />
                      <div>
                        <button
                          type="button"
                          className="holding-history-link"
                          onClick={() => onAnalyze(holding)}
                          aria-label={`View value history for ${holding.name}`}
                        >
                          {holding.name}
                        </button>
                        <span>{holding.symbol}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="value-stack">
                      <span>{holding.market}</span>
                      <small>{holding.sector || "Sector unclassified"}</small>
                    </div>
                  </td>
                  <td>{holding.quantity.toLocaleString("en-IN")}</td>
                  <td>{formatMoney(holding.averagePrice, holding.currency, 2)}</td>
                  <td>{formatMoney(holding.currentPrice, holding.currency, 2)}</td>
                  <td>
                    <span className={today.percent == null ? "neutral" : today.percent < 0 ? "negative" : today.percent > 0 ? "positive" : "neutral"}>
                      {today.percent == null ? "—" : formatSignedPercent(today.percent)}
                    </span>
                  </td>
                  <td>
                    <span className={today.valueInr == null ? "neutral" : today.valueInr < 0 ? "negative" : today.valueInr > 0 ? "positive" : "neutral"}>
                      {today.valueInr == null ? "—" : formatSignedMoney(today.valueInr, "INR")}
                    </span>
                  </td>
                  <td>
                    <div className="value-stack">
                      <span>{holding.trailingPe ? `${holding.trailingPe.toFixed(1)}x` : "—"}</span>
                      <small>{holding.forwardPe ? `${holding.forwardPe.toFixed(1)}x fwd` : "— fwd"}</small>
                    </div>
                  </td>
                  <td>
                    <div className="value-stack">
                      <span>{formatMoney(nativeInvested, holding.currency, holding.currency === "USD" ? 2 : 0)}</span>
                      {holding.currency === "USD" ? <small>{formatMoney(invested, "INR")}</small> : null}
                    </div>
                  </td>
                  <td>
                    <div className="value-stack">
                      <span>{formatMoney(nativeValue, holding.currency, holding.currency === "USD" ? 2 : 0)}</span>
                      {holding.currency === "USD" ? <small>{formatMoney(current, "INR")}</small> : null}
                    </div>
                  </td>
                  <td>
                    <div className="value-stack pnl-stack">
                      <span className={gain < 0 ? "negative" : gain > 0 ? "positive" : "neutral"}>
                        U: {formatSignedMoney(gain, "INR")} ({gainPercent.toFixed(2)}%)
                      </span>
                      <small className={realized < 0 ? "negative" : realized > 0 ? "positive" : "neutral"}>
                        R: {formatSignedMoney(realized, "INR")}
                      </small>
                    </div>
                  </td>
                  <td>{allocation.toFixed(1)}%</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        aria-label={`Actions for ${holding.name}`}
                        aria-expanded={menuOpen === holding.id}
                        onClick={() => setMenuOpen(menuOpen === holding.id ? null : holding.id)}
                      >
                        <DotsThreeVertical size={21} weight="bold" />
                      </button>
                      {menuOpen === holding.id ? (
                        <div className="action-menu">
                          <button type="button" onClick={() => { setMenuOpen(null); onAnalyze(holding); }}>
                            <ChartLineUp size={16} /> View value history
                          </button>
                          <button type="button" onClick={() => { setMenuOpen(null); onEdit(holding); }}>
                            <PencilSimple size={16} /> Edit latest transaction
                          </button>
                          <button type="button" onClick={() => { setMenuOpen(null); onBuy(holding); }}>
                            <ArrowDownRight size={16} /> Buy more
                          </button>
                          <button type="button" onClick={() => { setMenuOpen(null); onSell(holding); }}>
                            <ArrowUpRight size={16} /> Sell
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <div className="empty-table">
            {holdings.length === 0 ? <Wallet size={25} /> : <MagnifyingGlass size={24} />}
            <strong>{holdings.length === 0 ? "No holdings yet" : "No holdings found"}</strong>
            <span>
              {holdings.length === 0
                ? "Use Add transaction to record your first purchase."
                : "Try a company name or ticker symbol."}
            </span>
          </div>
        ) : null}
      </div>
      <footer className="table-footer">
        <span>US stocks show values in USD with INR equivalent below.</span>
        <strong className="fx-rate">
          {usdInrRate ? `USD/INR: ${usdInrRate.toFixed(2)}` : "USD/INR unavailable"}
          <em className={`is-${usdInrStatus}`}>
            {usdInrStatus === "live"
              ? "Live"
              : usdInrStatus === "cached"
                ? "Cached"
                : usdInrStatus === "portfolio" ? "Portfolio rate" : "Unavailable"}
          </em>
        </strong>
        {onShowAll ? (
          <button type="button" onClick={onShowAll}>View all holdings <CaretDown size={13} /></button>
        ) : <span aria-hidden="true" />}
      </footer>
    </section>
  );
}

function AveragingCandidates({
  holdings,
  usdInrRate,
  compact = false,
  onBuy,
  onShowAll,
}) {
  const analysis = useMemo(
    () => screenAveragingCandidates(holdings, usdInrRate),
    [holdings, usdInrRate],
  );
  const visibleCandidates = compact
    ? analysis.candidates.slice(0, 3)
    : analysis.candidates;
  const hiddenCount = analysis.candidates.length - visibleCandidates.length;

  return (
    <section className="averaging-section" aria-labelledby="averaging-title">
      <div className="averaging-heading">
        <div>
          <p className="eyebrow">Calculated review list</p>
          <h2 id="averaging-title">
            Might wish to average
            <InfoTooltip label="How averaging candidates are filtered">
              A holding appears when it is at least {analysis.minimumDiscountPercent}% below
              its weighted average cost and no heavier than an equal-weight position.
            </InfoTooltip>
          </h2>
          <p>
            At least {analysis.minimumDiscountPercent.toFixed(0)}% below average cost and no
            more than {analysis.equalWeightPercent.toFixed(1)}% of this portfolio.
          </p>
        </div>
        <span>{analysis.candidates.length} to review</span>
      </div>

      {visibleCandidates.length ? (
        <div className="averaging-grid">
          {visibleCandidates.map((holding) => {
            const peTrend = holding.trailingPe > 0 && holding.forwardPe > 0
              ? ((holding.forwardPe / holding.trailingPe) - 1) * 100
              : null;

            return (
              <article className="averaging-card" key={holding.id || holding.symbol}>
                <header>
                  <div className="asset-cell">
                    <AssetMark holding={holding} />
                    <div>
                      <strong>{holding.name}</strong>
                      <span>{holding.symbol} · {holding.sector || "Unclassified"}</span>
                    </div>
                  </div>
                  <span className="cost-gap">{holding.discountPercent.toFixed(1)}% below cost</span>
                </header>

                <dl>
                  <div>
                    <dt>Recovery to avg</dt>
                    <dd>+{holding.recoveryPercent.toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt>Portfolio weight</dt>
                    <dd>{holding.allocationPercent.toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt>Forward P/E</dt>
                    <dd>{holding.forwardPe > 0 ? `${holding.forwardPe.toFixed(1)}x` : "—"}</dd>
                    <small>
                      {peTrend === null
                        ? "Not used in filter"
                        : `${peTrend > 0 ? "+" : ""}${peTrend.toFixed(1)}% vs trailing`}
                    </small>
                  </div>
                </dl>

                <footer>
                  <span>
                    Now {formatMoney(holding.currentPrice, holding.currency, 2)}
                    {" · "}
                    Avg {formatMoney(holding.averagePrice, holding.currency, 2)}
                    {holding.quoteIsStale ? " · cached price" : ""}
                  </span>
                  <button type="button" onClick={() => onBuy(holding)}>
                    <Plus size={14} /> Add units
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="averaging-empty">
          <ChartLineUp size={25} weight="duotone" />
          <div>
            <strong>
              {holdings.length ? "No holdings meet both rules today" : "No positions to screen yet"}
            </strong>
            <span>
              {holdings.length
                ? "A lower price alone is not enough; the position must also be at or below equal weight."
                : "Add a holding and its average-cost comparison will appear here."}
            </span>
          </div>
        </div>
      )}

      <footer className="averaging-note">
        <span>Screening aid only—not investment advice. Recheck the business thesis before adding.</span>
        {hiddenCount > 0 && onShowAll ? (
          <button type="button" onClick={onShowAll}>
            Review all {analysis.candidates.length} <ArrowUpRight size={13} />
          </button>
        ) : null}
      </footer>
    </section>
  );
}

function UnderperformanceReview({
  holdings,
  usdInrRate,
  compact = false,
  onAnalyze,
  onShowAll,
}) {
  const analysis = useMemo(
    () => screenUnderperformingHoldings(holdings, usdInrRate),
    [holdings, usdInrRate],
  );
  const visibleCandidates = compact ? analysis.candidates.slice(0, 3) : analysis.candidates;
  const hiddenCount = analysis.candidates.length - visibleCandidates.length;

  return (
    <section className="underperformance-section" aria-labelledby="underperformance-title">
      <div className="underperformance-heading">
        <div>
          <p className="eyebrow">Capital-at-risk screen</p>
          <h2 id="underperformance-title">
            Underperforming positions
            <InfoTooltip label="How underperforming positions are filtered">
              A position must be at least {analysis.minimumLossPercent}% below invested value and
              represent either half an equal-weight position or {analysis.minimumLossContributionPercent}%
              of the portfolio&apos;s unrealized losses.
            </InfoTooltip>
          </h2>
          <p>
            Filters out small, immaterial losses so review time goes to positions affecting capital.
          </p>
        </div>
        <span>{analysis.candidates.length} flagged</span>
      </div>

      {visibleCandidates.length ? (
        <div className="underperformance-grid">
          {visibleCandidates.map((holding) => (
            <article className="underperformance-card" key={holding.id || holding.symbol}>
              <header>
                <div className="asset-cell">
                  <AssetMark holding={holding} />
                  <div>
                    <strong>{holding.name}</strong>
                    <span>{holding.symbol} · {holding.sector || "Unclassified"}</span>
                  </div>
                </div>
                <span className="review-path">{holding.reviewPath}</span>
              </header>
              <div className="loss-summary">
                <strong>{formatSignedMoney(-holding.lossInr, "INR")}</strong>
                <span>{holding.lossPercent.toFixed(1)}% below invested</span>
              </div>
              <dl>
                <div>
                  <dt>Invested</dt>
                  <dd>{formatMoney(holding.investedValueInr, "INR")}</dd>
                </div>
                <div>
                  <dt>Current</dt>
                  <dd>{formatMoney(holding.currentValueInr, "INR")}</dd>
                </div>
                <div>
                  <dt>Loss contribution</dt>
                  <dd>{holding.lossContributionPercent.toFixed(1)}%</dd>
                </div>
                <div>
                  <dt>Recovery to cost</dt>
                  <dd>+{holding.recoveryPercent.toFixed(1)}%</dd>
                </div>
              </dl>
              <footer>
                <span>{holding.investedWeightPercent.toFixed(1)}% of invested capital</span>
                <button type="button" onClick={() => onAnalyze(holding)}>
                  Review chart <ArrowUpRight size={13} />
                </button>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="underperformance-empty">
          <TrendUp size={25} weight="duotone" />
          <div>
            <strong>{holdings.length ? "No material underperformers today" : "No positions to screen yet"}</strong>
            <span>
              {holdings.length
                ? "Losses below the materiality thresholds remain visible in the holdings table."
                : "Add holdings to evaluate cost gap and capital impact."}
            </span>
          </div>
        </div>
      )}

      <footer className="underperformance-note">
        <span>Decision aid only. Price loss does not prove a broken thesis or justify averaging.</span>
        {hiddenCount > 0 && onShowAll ? (
          <button type="button" onClick={onShowAll}>
            Review all {analysis.candidates.length} <ArrowUpRight size={13} />
          </button>
        ) : null}
      </footer>
    </section>
  );
}

function HoldingsView({
  holdings,
  summary,
  query,
  usdInrRate,
  usdInrStatus,
  onQueryChange,
  onBuy,
  onEdit,
  onSell,
  onAnalyze,
}) {
  const unrealizedClass = summary.unrealizedGain < 0
    ? "negative"
    : summary.unrealizedGain > 0 ? "positive" : "neutral";

  return (
    <div className="holdings-view">
      <section className="holdings-view-intro" aria-labelledby="positions-heading">
        <div>
          <p className="eyebrow">Position book</p>
          <h2 id="positions-heading">All open positions</h2>
          <p>Review exposure, buy more, or sell units from one clean position book.</p>
        </div>
        <dl className="holdings-stats">
          <div>
            <dt>Portfolio value</dt>
            <dd>{formatMoney(summary.totalValue, "INR")}</dd>
          </div>
          <div>
            <dt>Net invested</dt>
            <dd>{formatMoney(summary.invested - summary.withdrawn, "INR")}</dd>
          </div>
          <div>
            <dt>Unrealized P&amp;L</dt>
            <dd className={unrealizedClass}>{formatSignedMoney(summary.unrealizedGain, "INR")}</dd>
          </div>
          <div>
            <dt>Positions</dt>
            <dd>{holdings.length}</dd>
          </div>
        </dl>
      </section>
      <HoldingsTable
        holdings={holdings}
        query={query}
        usdInrRate={usdInrRate}
        usdInrStatus={usdInrStatus}
        onQueryChange={onQueryChange}
        onBuy={onBuy}
        onEdit={onEdit}
        onSell={onSell}
        onAnalyze={onAnalyze}
      />
      <UnderperformanceReview
        holdings={holdings}
        usdInrRate={usdInrRate}
        onAnalyze={onAnalyze}
      />
      <AveragingCandidates
        holdings={holdings}
        usdInrRate={usdInrRate}
        onBuy={onBuy}
      />
    </div>
  );
}

function analyticsValue(value, suffix = "%", decimals = 2) {
  return Number.isFinite(value) ? `${Number(value).toFixed(decimals)}${suffix}` : "Not enough history";
}

function AnalyticsMetric({ label, value, detail, tone = "neutral", info }) {
  return (
    <article className="analytics-metric-card">
      <p>
        {label}
        {info ? <InfoTooltip label={`About ${label}`}>{info}</InfoTooltip> : null}
      </p>
      <strong className={tone}>{value}</strong>
      {detail ? <span>{detail}</span> : null}
    </article>
  );
}

function DrawdownTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="chart-tooltip comparison-tooltip">
      <span>{fullDate(label)}</span>
      <div className="tooltip-metric">
        <small>Portfolio drawdown</small>
        <strong>{formatSignedPercent(row?.portfolioDrawdown)}</strong>
      </div>
      <div className="tooltip-metric">
        <small>Nifty 50 drawdown</small>
        <strong>{Number.isFinite(row?.niftyDrawdown) ? formatSignedPercent(row.niftyDrawdown) : "Unavailable"}</strong>
      </div>
      <small>{row?.daysSincePeak || 0} days since portfolio peak</small>
    </div>
  );
}

function ExposureList({ title, rows }) {
  return (
    <section className="exposure-card">
      <h3>{title}</h3>
      <div>
        {rows.map((item) => (
          <span key={item.key}>
            <small>{item.key}</small>
            <i><b style={{ width: `${Math.min(100, item.weight)}%` }} /></i>
            <strong>{item.weight.toFixed(1)}%</strong>
          </span>
        ))}
      </div>
    </section>
  );
}

const ANALYTICS_PREFERENCES_KEY = "quiet-capital-analytics-v1";

function AnalyticsView({
  history,
  holdings,
  transactions,
  summary,
  usdInrRate,
}) {
  const [range, setRange] = useState("All");
  const [attributionMode, setAttributionMode] = useState("security");
  const [dimension, setDimension] = useState("holding");
  const [planMode, setPlanMode] = useState("new-cash");
  const [newCash, setNewCash] = useState(0);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [preferences, setPreferences] = useState({
    riskFreeRate: 6.5,
    holdingLimit: 10,
    sectorLimit: 25,
    noTradeBand: 1,
    targets: { holding: {}, sector: {}, asset: {}, currency: {} },
  });

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(ANALYTICS_PREFERENCES_KEY) || "null");
      if (saved && typeof saved === "object") {
        setPreferences((current) => ({
          ...current,
          ...saved,
          targets: { ...current.targets, ...(saved.targets || {}) },
        }));
      }
    } catch {
      // Keep safe defaults when stored preferences are malformed or unavailable.
    }
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      window.localStorage.setItem(ANALYTICS_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      // Analytics remains usable even when browser storage is unavailable.
    }
  }, [preferences, preferencesLoaded]);

  const chartData = useMemo(() => buildPortfolioChartData({
    history,
    range,
    currency: "INR",
    usdInrRate,
    currentValue: summary.totalValue,
    currentInvested: summary.invested,
    currentNetInvested: summary.netInvested,
  }), [history, range, summary.invested, summary.netInvested, summary.totalValue, usdInrRate]);
  const performance = useMemo(
    () => calculatePerformanceAnalytics(chartData, { riskFreeRatePercent: preferences.riskFreeRate }),
    [chartData, preferences.riskFreeRate],
  );
  const attribution = useMemo(
    () => calculateReturnAttribution({ history, holdings, transactions, range }),
    [history, holdings, range, transactions],
  );
  const concentration = useMemo(
    () => calculateConcentration(holdings, {
      holdingLimitPercent: preferences.holdingLimit,
      sectorLimitPercent: preferences.sectorLimit,
    }),
    [holdings, preferences.holdingLimit, preferences.sectorLimit],
  );
  const totalValue = Number(summary.totalValue || 0);
  const holdingNames = useMemo(
    () => new Map(holdings.map((holding) => [holding.symbol, holding.name || holding.symbol])),
    [holdings],
  );
  const dimensionItems = useMemo(() => {
    const source = dimension === "holding"
      ? concentration.holdings
      : dimension === "sector" ? concentration.sectors
        : dimension === "asset" ? concentration.assets : concentration.currencies;
    return source.map((item) => ({
      ...item,
      label: dimension === "holding" ? holdingNames.get(item.key) || item.key : item.key,
    }));
  }, [concentration, dimension, holdingNames]);
  const activeTargets = preferences.targets[dimension] || {};
  const targetPlan = useMemo(() => {
    if (planMode === "reduce-risk") {
      return buildRiskReductionPlan(holdings, {
        totalValue,
        holdingLimitPercent: preferences.holdingLimit,
        sectorLimitPercent: preferences.sectorLimit,
      });
    }
    return buildTargetPlan(dimensionItems, activeTargets, {
      mode: planMode,
      totalValue,
      newCash: Number(newCash || 0),
      noTradeBandPercent: preferences.noTradeBand,
    });
  }, [activeTargets, dimensionItems, holdings, newCash, planMode, preferences.holdingLimit, preferences.noTradeBand, preferences.sectorLimit, totalValue]);
  const attributionRows = attributionMode === "security" ? attribution.holdings : attribution.sectors;
  const riskDetail = `${performance.observations} aligned observations`;

  function updatePreference(key, value) {
    setPreferences((current) => ({ ...current, [key]: Number(value) }));
  }

  function updateTarget(key, value) {
    setPreferences((current) => ({
      ...current,
      targets: {
        ...current.targets,
        [dimension]: { ...current.targets[dimension], [key]: Number(value) },
      },
    }));
  }

  function useCurrentWeights() {
    const targets = Object.fromEntries(dimensionItems.map((item) => [item.key, Number(item.weight.toFixed(2))]));
    const difference = 100 - Object.values(targets).reduce((sum, value) => sum + value, 0);
    if (dimensionItems[0]) targets[dimensionItems[0].key] += difference;
    setPreferences((current) => ({
      ...current,
      targets: { ...current.targets, [dimension]: targets },
    }));
  }

  return (
    <div className="analytics-view">
      <section className="analytics-intro">
        <div>
          <p className="eyebrow">Portfolio intelligence</p>
          <h2>Performance &amp; Risk Center</h2>
          <p>Measure contribution-neutral returns, identify risk concentration, and model allocation changes before recording a transaction.</p>
        </div>
        <div className="analytics-period">
          <small>Selected period</small>
          <strong>{performance.periodStart && performance.periodEnd ? `${fullDate(performance.periodStart)} — ${fullDate(performance.periodEnd)}` : "Unavailable"}</strong>
        </div>
      </section>

      <section className="performance-panel" aria-labelledby="performance-summary-title">
        <div className="analytics-section-heading">
          <div>
            <p className="eyebrow">Priority 1</p>
            <h2 id="performance-summary-title">Performance summary</h2>
          </div>
          <span>Returns reset at the selected period start</span>
        </div>
        <div className="performance-hero-grid">
          <AnalyticsMetric label="Portfolio TWR" value={analyticsValue(performance.portfolioReturn)} tone={performance.portfolioReturn >= 0 ? "positive" : "negative"} detail="Contribution-neutral" />
          <AnalyticsMetric label="Nifty 50 return" value={analyticsValue(performance.niftyReturn)} tone={performance.niftyReturn >= 0 ? "positive" : "negative"} detail="^NSEI benchmark" />
          <AnalyticsMetric label="Active return" value={analyticsValue(performance.activeReturn, " pp")} tone={performance.activeReturn >= 0 ? "positive" : "negative"} detail={performance.activeReturn >= 0 ? "Ahead of Nifty 50" : "Behind Nifty 50"} />
          <AnalyticsMetric label="Rolling 1 month" value={analyticsValue(performance.rollingOneMonth)} detail="21 observed market days" />
          <AnalyticsMetric label="Rolling 3 months" value={analyticsValue(performance.rollingThreeMonth)} detail="63 observed market days" />
        </div>
        <PortfolioChart
          history={history}
          currentValue={summary.totalValue}
          currentInvested={summary.invested}
          currentNetInvested={summary.netInvested}
          range={range}
          currency="INR"
          usdInrRate={usdInrRate}
          benchmark
          lockBenchmark
          onRangeChange={setRange}
          onBenchmarkChange={() => {}}
        />
        <div className="period-extremes">
          <span>
            <small>Best rolling month</small>
            <strong className="positive">{performance.bestMonth ? formatSignedPercent(performance.bestMonth.returnPercent) : "Not enough history"}</strong>
            {performance.bestMonth ? <em>{fullDate(performance.bestMonth.startDate)} — {fullDate(performance.bestMonth.endDate)}</em> : null}
          </span>
          <span>
            <small>Worst rolling month</small>
            <strong className="negative">{performance.worstMonth ? formatSignedPercent(performance.worstMonth.returnPercent) : "Not enough history"}</strong>
            {performance.worstMonth ? <em>{fullDate(performance.worstMonth.startDate)} — {fullDate(performance.worstMonth.endDate)}</em> : null}
          </span>
        </div>
      </section>

      <section className="risk-panel" aria-labelledby="risk-metrics-title">
        <div className="analytics-section-heading">
          <div>
            <p className="eyebrow">Daily unitized returns</p>
            <h2 id="risk-metrics-title">Risk metrics</h2>
          </div>
          <label className="risk-free-setting">
            <span>Risk-free assumption</span>
            <span><input type="number" step="0.1" min="0" max="30" value={preferences.riskFreeRate} onChange={(event) => updatePreference("riskFreeRate", event.target.value)} />%</span>
            <small>Source: portfolio assumption</small>
          </label>
        </div>
        <div className="risk-grid">
          <AnalyticsMetric label="Annualized volatility" value={analyticsValue(performance.annualizedVolatility)} detail={riskDetail} info="Sample standard deviation of daily unitized returns, annualized using 252 market days. Requires 60 aligned observations." />
          <AnalyticsMetric label="Downside deviation" value={analyticsValue(performance.downsideDeviation)} detail={riskDetail} info="Annualized deviation of daily returns below 0%. Requires 60 aligned observations." />
          <AnalyticsMetric label="Maximum drawdown" value={analyticsValue(performance.maximumDrawdown)} tone="negative" detail={performance.maximumDrawdownDate ? `Trough on ${fullDate(performance.maximumDrawdownDate)}` : riskDetail} info="Largest peak-to-trough decline. Requires 60 observations." />
          <AnalyticsMetric label="Current drawdown" value={analyticsValue(performance.currentDrawdown)} tone="negative" detail={Number.isFinite(performance.currentDrawdownDays) ? `${performance.currentDrawdownDays} days since peak` : riskDetail} info="Decline from the latest portfolio high-water mark. Requires 20 observations." />
          <AnalyticsMetric label="Beta to Nifty 50" value={analyticsValue(performance.beta, "", 2)} detail={riskDetail} info="Covariance of portfolio and Nifty returns divided by Nifty return variance. Requires 60 aligned observations." />
          <AnalyticsMetric label="Tracking error" value={analyticsValue(performance.trackingError)} detail={riskDetail} info="Annualized volatility of daily portfolio return minus Nifty 50 return. Requires 60 aligned observations." />
          <AnalyticsMetric label="Information ratio" value={analyticsValue(performance.informationRatio, "", 2)} detail="Active return per unit of tracking error" />
          <AnalyticsMetric label="Sharpe ratio" value={analyticsValue(performance.sharpeRatio, "", 2)} detail={`Risk-free: ${preferences.riskFreeRate.toFixed(1)}% user assumption`} />
          <AnalyticsMetric label="Sortino ratio" value={analyticsValue(performance.sortinoRatio, "", 2)} detail={`Risk-free: ${preferences.riskFreeRate.toFixed(1)}% user assumption`} />
        </div>
      </section>

      <section className="drawdown-panel" aria-labelledby="drawdown-title">
        <div className="analytics-section-heading">
          <div>
            <p className="eyebrow">Peak-to-trough</p>
            <h2 id="drawdown-title">Drawdown</h2>
          </div>
          <div className="chart-legend">
            <span><i className="current-series" />Portfolio</span>
            <span><i className="benchmark-series" />Nifty 50</span>
          </div>
        </div>
        <div className="drawdown-chart">
          {performance.drawdownData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={performance.drawdownData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="drawdownFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a7473d" stopOpacity={0.04} />
                    <stop offset="100%" stopColor="#a7473d" stopOpacity={0.22} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#d9ddd4" strokeDasharray="2 3" />
                <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={55} axisLine={{ stroke: "#cbd0c7" }} tickLine={false} tick={{ fill: "#656a64", fontSize: 11 }} />
                <YAxis domain={["auto", 0]} tickFormatter={(value) => `${Number(value).toFixed(0)}%`} width={44} axisLine={false} tickLine={false} tick={{ fill: "#656a64", fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#aeb4ad" />
                <Tooltip cursor={{ stroke: "#8d978e", strokeDasharray: "3 3" }} content={<DrawdownTooltip />} />
                <Area type="monotone" dataKey="portfolioDrawdown" stroke="#a7473d" strokeWidth={2} fill="url(#drawdownFill)" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="niftyDrawdown" stroke="#a77931" strokeWidth={1.7} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="chart-empty"><ChartLineUp size={25} /><strong>Drawdown history is unavailable</strong></div>}
        </div>
      </section>

      <section className="attribution-panel" aria-labelledby="attribution-title">
        <div className="analytics-section-heading">
          <div>
            <p className="eyebrow">Return attribution</p>
            <h2 id="attribution-title">What drove the result</h2>
          </div>
          <div className="allocation-toggle" role="group" aria-label="Attribution breakdown">
            <button type="button" className={attributionMode === "security" ? "is-selected" : ""} onClick={() => setAttributionMode("security")}>Security</button>
            <button type="button" className={attributionMode === "sector" ? "is-selected" : ""} onClick={() => setAttributionMode("sector")}>Sector</button>
          </div>
        </div>
        {attributionRows.length ? (
          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead><tr><th>{attributionMode === "security" ? "Holding" : "Sector"}</th><th>Contribution</th><th>INR impact</th><th>Signal</th></tr></thead>
              <tbody>
                {attributionRows.slice(0, 15).map((row) => {
                  const key = attributionMode === "security" ? row.symbol : row.sector;
                  return (
                    <tr key={key}>
                      <td><strong>{attributionMode === "security" ? row.name : row.sector}</strong><small>{attributionMode === "security" ? `${row.symbol} · ${row.sector}` : `${row.holdings} holdings`}</small></td>
                      <td className={row.contributionPp >= 0 ? "positive" : "negative"}>{formatSignedPercent(row.contributionPp, " pp")}</td>
                      <td className={row.contributionInr >= 0 ? "positive" : "negative"}>{formatSignedMoney(row.contributionInr, "INR")}</td>
                      <td>{row.contributionPp >= 0 ? "Added" : "Detracted"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="analytics-empty">Not enough holding history for attribution in this period.</div>}
        <p className="analytics-method-note">
          {attribution.method === "daily-flow-adjusted"
            ? "Daily previous-weight attribution adjusted for dated buys and sells."
            : "Approximate daily previous-weight attribution using holding cost-basis changes where transaction cash flows are unavailable."}
          {" "}This is not Brinson attribution.
        </p>
      </section>

      <section className="concentration-panel" aria-labelledby="concentration-title">
        <div className="analytics-section-heading">
          <div>
            <p className="eyebrow">Priority 2</p>
            <h2 id="concentration-title">Concentration analysis</h2>
          </div>
          <div className="limit-settings">
            <label>Holding limit <span><input type="number" min="1" max="100" step="0.5" value={preferences.holdingLimit} onChange={(event) => updatePreference("holdingLimit", event.target.value)} />%</span></label>
            <label>Sector limit <span><input type="number" min="1" max="100" step="0.5" value={preferences.sectorLimit} onChange={(event) => updatePreference("sectorLimit", event.target.value)} />%</span></label>
          </div>
        </div>
        <div className="concentration-grid">
          <AnalyticsMetric label="Largest holding" value={concentration.largestHolding ? `${concentration.largestHolding.weight.toFixed(1)}%` : "—"} detail={concentration.largestHolding?.key} />
          <AnalyticsMetric label="Top 5 holdings" value={`${concentration.top5Weight.toFixed(1)}%`} detail="Combined portfolio weight" />
          <AnalyticsMetric label="Top 10 holdings" value={`${concentration.top10Weight.toFixed(1)}%`} detail="Combined portfolio weight" />
          <AnalyticsMetric label="Largest sector" value={concentration.largestSector ? `${concentration.largestSector.weight.toFixed(1)}%` : "—"} detail={concentration.largestSector?.key} />
          <AnalyticsMetric label="Top 3 sectors" value={`${concentration.top3SectorWeight.toFixed(1)}%`} detail="Combined portfolio weight" />
          <AnalyticsMetric label="Effective holdings" value={concentration.effectiveHoldings.toFixed(1)} detail={`${holdings.length} actual holdings`} info="One divided by the sum of squared holding weights. Lower than the actual count when capital is concentrated." />
        </div>
        <div className="breach-summary">
          <span className={concentration.holdingBreaches.length ? "has-breach" : ""}><strong>{concentration.holdingBreaches.length}</strong> holdings above {preferences.holdingLimit}%</span>
          <span className={concentration.sectorBreaches.length ? "has-breach" : ""}><strong>{concentration.sectorBreaches.length}</strong> sectors above {preferences.sectorLimit}%</span>
        </div>
        {concentration.holdingBreaches.length || concentration.sectorBreaches.length ? (
          <div className="breach-list" aria-label="Allocation limit breaches">
            {concentration.holdingBreaches.map((item) => <span key={`holding-${item.key}`}><small>Holding</small>{item.key}<strong>{item.weight.toFixed(1)}%</strong></span>)}
            {concentration.sectorBreaches.map((item) => <span key={`sector-${item.key}`}><small>Sector</small>{item.key}<strong>{item.weight.toFixed(1)}%</strong></span>)}
          </div>
        ) : null}
        <div className="exposure-grid">
          <ExposureList title="Country exposure" rows={concentration.countries} />
          <ExposureList title="Currency exposure" rows={concentration.currencies} />
          <ExposureList title="Asset exposure" rows={concentration.assets} />
        </div>
      </section>

      <section className="rebalancing-panel" aria-labelledby="rebalancing-title">
        <div className="analytics-section-heading">
          <div>
            <p className="eyebrow">Priority 3</p>
            <h2 id="rebalancing-title">Target-weight rebalancing</h2>
          </div>
          <span>Planning only · no transaction is recorded</span>
        </div>
        <div className="planner-controls">
          <div className="planner-control-group">
            <small>Plan by</small>
            <div className="planner-segmented" role="group" aria-label="Rebalancing dimension">
              {[['holding', 'Holding'], ['sector', 'Sector'], ['asset', 'Asset'], ['currency', 'Currency']].map(([key, label]) => <button type="button" key={key} className={dimension === key ? "is-selected" : ""} onClick={() => setDimension(key)}>{label}</button>)}
            </div>
          </div>
          <div className="planner-control-group">
            <small>Mode</small>
            <div className="planner-segmented" role="group" aria-label="Rebalancing mode">
              <button type="button" className={planMode === "new-cash" ? "is-selected" : ""} onClick={() => setPlanMode("new-cash")}>New cash only</button>
              <button type="button" className={planMode === "buys-sells" ? "is-selected" : ""} onClick={() => setPlanMode("buys-sells")}>Buys &amp; sells</button>
              <button type="button" className={planMode === "reduce-risk" ? "is-selected" : ""} onClick={() => setPlanMode("reduce-risk")}>Reduce risk</button>
            </div>
          </div>
          {planMode === "new-cash" ? <label className="planner-number">New cash <span>₹<input type="number" min="0" step="1000" value={newCash} onChange={(event) => setNewCash(event.target.value)} /></span></label> : null}
          {planMode !== "reduce-risk" ? <label className="planner-number">No-trade band <span><input type="number" min="0" max="20" step="0.1" value={preferences.noTradeBand} onChange={(event) => updatePreference("noTradeBand", event.target.value)} /> pp</span></label> : null}
        </div>

        {planMode !== "reduce-risk" ? (
          <div className="targets-editor">
            <div className="targets-editor-heading">
              <p>Targets must total 100%. Values are stored in this browser.</p>
              <button type="button" onClick={useCurrentWeights}>Use current weights</button>
            </div>
            <div className="targets-list">
              {dimensionItems.map((item) => (
                <label key={item.key}>
                  <span><strong>{item.label}</strong><small>{item.key !== item.label ? item.key : "Current allocation"}</small></span>
                  <em>{item.weight.toFixed(1)}%</em>
                  <span className="target-input"><input type="number" min="0" max="100" step="0.1" value={activeTargets[item.key] ?? ""} onChange={(event) => updateTarget(item.key, event.target.value)} placeholder="0" />%</span>
                </label>
              ))}
            </div>
            <div className={cx("target-total", Math.abs(targetPlan.targetTotal - 100) > 0.1 && "is-invalid")}>
              <span>Target total</span><strong>{targetPlan.targetTotal.toFixed(1)}%</strong>
            </div>
          </div>
        ) : (
          <div className="risk-reduction-note">Uses the {preferences.holdingLimit}% holding and {preferences.sectorLimit}% sector limits above. Proposed reductions remain uninvested cash.</div>
        )}

        <div className="plan-summary-grid">
          <AnalyticsMetric label="Cash needed" value={formatMoney(targetPlan.cashNeeded, "INR")} detail={planMode === "new-cash" ? "Limited by new cash" : "Proposed purchases"} />
          <AnalyticsMetric label="Cash released" value={formatMoney(targetPlan.cashReleased, "INR")} detail="Proposed reductions" />
          <AnalyticsMetric label="Unallocated cash" value={formatMoney(targetPlan.unallocatedCash, "INR")} detail={planMode === "reduce-risk" ? "Held after reducing risk" : "Remaining after plan"} />
          <AnalyticsMetric label="Post-trade concentration" value={targetPlan.rows.length ? `${Math.max(...targetPlan.rows.map((item) => item.postTradeWeight)).toFixed(1)}%` : "—"} detail="Largest planned line item" />
        </div>

        {targetPlan.rows.length ? (
          <div className="analytics-table-wrap">
            <table className="analytics-table plan-table">
              <thead><tr><th>{planMode === "reduce-risk" ? "Holding" : "Allocation"}</th><th>Current</th><th>{planMode === "reduce-risk" ? "Limit plan" : "Target"}</th><th>Drift</th><th>Suggested action</th><th>Post-trade</th></tr></thead>
              <tbody>
                {targetPlan.rows.map((row) => (
                  <tr key={row.key}>
                    <td><strong>{row.label || row.key}</strong><small>{row.key}</small></td>
                    <td>{row.weight.toFixed(1)}%</td>
                    <td>{Number.isFinite(row.targetWeight) ? `${row.targetWeight.toFixed(1)}%` : `≤ ${preferences.holdingLimit}%`}</td>
                    <td className={Math.abs(row.drift || 0) > preferences.noTradeBand ? "negative" : "neutral"}>{Number.isFinite(row.drift) ? formatSignedPercent(row.drift, " pp") : "—"}</td>
                    <td className={row.trade > 0 ? "positive" : row.trade < 0 ? "negative" : "neutral"}>{Math.abs(row.trade) < 0.01 ? "No trade" : `${row.trade > 0 ? "Buy" : "Sell"} ${formatMoney(Math.abs(row.trade), "INR")}`}</td>
                    <td>{row.postTradeWeight.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="analytics-empty">{planMode === "reduce-risk" ? "No holdings require reduction under the configured limits." : "Set targets totaling 100% to calculate a plan."}</div>}
        <p className="analytics-method-note">Review taxes, liquidity, and execution prices before acting. Use Add transaction to record any decision explicitly.</p>
      </section>
    </div>
  );
}

function MetricsRail({ summary, allocation, sectorAllocation }) {
  const [allocationMode, setAllocationMode] = useState("sector");
  const visibleAllocation = allocationMode === "sector" ? sectorAllocation : allocation;
  const invested = Number(summary.invested || 0);
  const unrealizedPercent = invested ? (summary.unrealizedGain / invested) * 100 : 0;
  const realizedPercent = invested ? (summary.realizedGain / invested) * 100 : 0;
  const totalPercent = Number.isFinite(summary.allTimeGainPercent)
    ? summary.allTimeGainPercent
    : (invested ? (summary.allTimeGain / invested) * 100 : 0);
  return (
    <aside className="metrics-rail" id="analytics-section" aria-label="Portfolio analytics">
      <section className="allocation-block">
        <div className="allocation-heading">
          <h2>Portfolio allocation</h2>
          <div className="allocation-toggle" role="group" aria-label="Allocation breakdown">
            <button
              type="button"
              className={allocationMode === "sector" ? "is-selected" : ""}
              onClick={() => setAllocationMode("sector")}
            >
              Sector
            </button>
            <button
              type="button"
              className={allocationMode === "asset" ? "is-selected" : ""}
              onClick={() => setAllocationMode("asset")}
            >
              Asset
            </button>
          </div>
        </div>
        <div className="allocation-layout">
          <div className="donut-wrap">
            {visibleAllocation.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={visibleAllocation}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="67%"
                    outerRadius="93%"
                    paddingAngle={1}
                    stroke="#f8f6f0"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {visibleAllocation.map((item) => <Cell key={item.name} fill={item.color} />)}
                  </Pie>
                  <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="donut-empty" aria-hidden="true">
                <ChartPieSlice size={34} weight="duotone" />
              </div>
            )}
            <span>{formatMoney(summary.totalValue, "INR")}</span>
          </div>
          <div className="allocation-legend">
            {visibleAllocation.map((item) => (
              <div key={item.name}>
                <i style={{ backgroundColor: item.color }} />
                <span>{item.name}</span>
                <strong>{item.value.toFixed(1)}%</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="valuation-metrics">
        <h2>Portfolio valuation</h2>
        <div>
          <span>
            <small>Trailing P/E</small>
            <strong>{summary.trailingPe ? `${summary.trailingPe.toFixed(1)}x` : "—"}</strong>
            <em>{Number(summary.trailingPeCoverage || 0).toFixed(0)}% coverage</em>
          </span>
          <span>
            <small>Forward P/E</small>
            <strong>{summary.forwardPe ? `${summary.forwardPe.toFixed(1)}x` : "—"}</strong>
            <em>{Number(summary.forwardPeCoverage || 0).toFixed(0)}% coverage</em>
          </span>
        </div>
        <p>Calculated from aggregate implied earnings for holdings with a positive P/E.</p>
      </section>

      <section className="headline-metric">
        <p>
          XIRR
          <InfoTooltip label="About XIRR">
            Your annualized return, accounting for the timing and size of every cash flow.
          </InfoTooltip>
        </p>
        <strong>{summary.xirr.toFixed(1)}%</strong>
      </section>
      <section className="headline-metric">
        <p>
          CAGR
          <InfoTooltip label="About CAGR">
            The smoothed annual growth rate from your portfolio&apos;s starting value to today.
          </InfoTooltip>
        </p>
        <strong>{summary.cagr.toFixed(1)}%</strong>
      </section>

      <section className="pnl-breakdown">
        <h2>Gains &amp; losses</h2>
        <dl>
          <div>
            <dt>Unrealized P&amp;L</dt>
            <dd className={summary.unrealizedGain < 0 ? "negative" : summary.unrealizedGain > 0 ? "positive" : "neutral"}>
              {formatSignedMoney(summary.unrealizedGain, "INR")}
              <small>({formatSignedPercent(unrealizedPercent)})</small>
            </dd>
          </div>
          <div>
            <dt>Realized P&amp;L</dt>
            <dd className={summary.realizedGain < 0 ? "negative" : summary.realizedGain > 0 ? "positive" : "neutral"}>
              {formatSignedMoney(summary.realizedGain, "INR")}
              <small>({formatSignedPercent(realizedPercent)})</small>
            </dd>
          </div>
          <div className="net-pnl">
            <dt>Total P&amp;L</dt>
            <dd className={summary.allTimeGain < 0 ? "negative" : summary.allTimeGain > 0 ? "positive" : "neutral"}>
              {formatSignedMoney(summary.allTimeGain, "INR")}
              <small>({formatSignedPercent(totalPercent)})</small>
            </dd>
          </div>
        </dl>
      </section>

      <section className="cash-flow-block">
        <h2>Cash flows <span>(All time)</span></h2>
        <dl>
          <div>
            <dt><i className="invested-dot" />Invested</dt>
            <dd>{formatMoney(summary.invested, "INR")}</dd>
          </div>
          <div>
            <dt><i className="withdrawn-dot" />Withdrawn</dt>
            <dd>{formatMoney(summary.withdrawn, "INR")}</dd>
          </div>
          <div className="net-flow">
            <dt>Net cash flow</dt>
            <dd>{formatMoney(summary.invested - summary.withdrawn, "INR")}</dd>
          </div>
        </dl>
      </section>
      <p className="rail-note">All values in INR unless shown in USD.</p>
    </aside>
  );
}

function DrawerShell({ title, subtitle, onClose, children, width = "standard" }) {
  return (
    <div className="drawer-layer">
      <button className="drawer-backdrop" type="button" onClick={onClose} aria-label="Close drawer" />
      <aside className={cx("drawer", width === "wide" && "drawer-wide")} role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-header">
          <div>
            <h2 id="drawer-title">{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={21} />
          </button>
        </header>
        {children}
      </aside>
    </div>
  );
}

function HoldingChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const current = payload.find((item) => item.dataKey === "value")?.value;
  const invested = payload.find((item) => item.dataKey === "invested")?.value;
  return (
    <div className="chart-tooltip">
      <span>{fullDate(label)}</span>
      <strong>{formatMoney(current, "INR")}</strong>
      <small>Invested · {formatMoney(invested, "INR")}</small>
    </div>
  );
}

function HoldingAnalysisDrawer({ holding, history, usdInrRate, onClose, onBuy, onSell }) {
  const [range, setRange] = useState("1Y");
  const chartData = useMemo(
    () => buildHoldingChartData({ history, holding, range }),
    [history, holding, range],
  );
  const invested = valueInInr(holding, holding.averagePrice, usdInrRate);
  const current = valueInInr(holding, holding.currentPrice, usdInrRate);
  const pnl = current - invested;
  const returnPercent = invested ? (pnl / invested) * 100 : 0;
  const recoveryPercent = pnl < 0 && current ? ((invested - current) / current) * 100 : 0;
  const domain = getPortfolioChartDomain(chartData, range);

  return (
    <DrawerShell
      title={holding.name}
      subtitle={`${holding.symbol} · invested value versus market value in INR`}
      onClose={onClose}
      width="wide"
    >
      <div className="holding-analysis">
        <div className="holding-analysis-summary">
          <div>
            <span>Current value</span>
            <strong>{formatMoney(current, "INR")}</strong>
          </div>
          <div>
            <span>Invested value</span>
            <strong>{formatMoney(invested, "INR")}</strong>
          </div>
          <div>
            <span>Unrealized P&amp;L</span>
            <strong className={pnl < 0 ? "negative" : pnl > 0 ? "positive" : "neutral"}>
              {formatSignedMoney(pnl, "INR")} ({returnPercent.toFixed(1)}%)
            </strong>
          </div>
        </div>

        <section className="holding-history-card" aria-label={`${holding.name} value history`}>
          <div className="holding-history-toolbar">
            <div className="chart-legend" aria-label="Chart series">
              <span><i className="current-series" />Current value</span>
              <span><i className="invested-series" />Invested</span>
            </div>
            <div className="range-tabs compact-range" role="group" aria-label="Holding chart date range">
              {Object.keys(RANGE_DAYS).map((item) => (
                <button
                  type="button"
                  key={item}
                  className={range === item ? "is-selected" : ""}
                  onClick={() => setRange(item)}
                  aria-pressed={range === item}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="holding-chart-canvas">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="holdingValueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#83b985" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#83b985" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#d9ddd4" strokeDasharray="2 3" />
                  <XAxis
                    dataKey="date"
                    axisLine={{ stroke: "#cbd0c7" }}
                    tickLine={false}
                    tick={{ fill: "#656a64", fontSize: 10 }}
                    minTickGap={35}
                    tickFormatter={shortDate}
                  />
                  <YAxis
                    domain={domain}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#656a64", fontSize: 10 }}
                    width={43}
                    tickFormatter={(value) => formatIndianCompact(value).replace("₹", "")}
                  />
                  <Tooltip content={<HoldingChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#176a35"
                    strokeWidth={2}
                    fill="url(#holdingValueFill)"
                    activeDot={{ r: 4, fill: "#176a35", stroke: "#fff", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="stepAfter"
                    dataKey="invested"
                    stroke="#a77931"
                    strokeWidth={1.7}
                    strokeDasharray="5 4"
                    dot={false}
                    activeDot={{ r: 3, fill: "#a77931", stroke: "#fff", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty">
                <ChartLineUp size={25} weight="duotone" />
                <strong>Historical values are not available yet</strong>
                <span>Refresh prices once to backfill this holding&apos;s daily history.</span>
              </div>
            )}
          </div>
        </section>

        <section className="decision-checklist">
          <div>
            <p className="eyebrow">Before deciding</p>
            <h3>{pnl < 0 ? `${recoveryPercent.toFixed(1)}% recovery needed to reach cost` : "Position is above invested value"}</h3>
          </div>
          <ul>
            <li><Check size={15} /> Recheck whether the original business thesis still holds.</li>
            <li><Check size={15} /> Compare position weight with the risk you are willing to carry.</li>
            <li><Check size={15} /> Review earnings, cash flow, valuation, and the reason for the drawdown.</li>
            <li><Check size={15} /> Consider taxes, liquidity, and opportunity cost before exiting or adding.</li>
          </ul>
        </section>

        <div className="holding-analysis-actions">
          <button className="secondary-button" type="button" onClick={() => onSell(holding)}>
            <ArrowUpRight size={15} /> Record sell
          </button>
          <button className="primary-button" type="button" onClick={() => onBuy(holding)}>
            <Plus size={15} /> Add units
          </button>
        </div>
        <p className="analysis-disclaimer">These calculations describe price and position impact; they are not investment advice.</p>
      </div>
    </DrawerShell>
  );
}

function TransactionDrawerState({ holding, loading, error, onRetry, onClose }) {
  return (
    <DrawerShell
      title="Edit latest transaction"
      subtitle={loading
        ? `Loading the transaction that currently drives ${holding.symbol}.`
        : `The saved transaction linked to ${holding.symbol} could not be loaded.`}
      onClose={onClose}
    >
      <div className="drawer-state">
        {loading ? (
          <>
            <SpinnerGap className="spin" size={27} />
            <strong>Loading latest transaction…</strong>
            <p>Fetching the exact saved record before making it editable.</p>
          </>
        ) : (
          <>
            <Info size={27} />
            <strong>Couldn’t open this transaction</strong>
            <p role="alert">{error}</p>
            <div className="drawer-state-actions">
              <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
              <button className="primary-button" type="button" onClick={onRetry}>Try again</button>
            </div>
          </>
        )}
      </div>
    </DrawerShell>
  );
}

function normalizeSearchResult(item) {
  const symbol = firstDefined(item.symbol, item.ticker, "");
  const currency = firstDefined(
    item.currency,
    symbol.endsWith(".NS") || symbol.endsWith(".BO") ? "INR" : "USD",
  );
  const assetType = firstDefined(item.assetType, item.asset_type, item.assetClass, item.asset_class, item.type);
  const rawMarket = firstDefined(
    item.market,
    item.exchange,
    symbol.endsWith(".BO") ? "BSE" : currency === "USD" ? "US" : "NSE",
  );
  const marketAliases = { NSI: "NSE", NMS: "NASDAQ", NGM: "NASDAQ", NYQ: "NYSE" };
  return {
    symbol,
    name: firstDefined(item.name, item.long_name, item.short_name, item.symbol, ""),
    market: marketAliases[rawMarket] || rawMarket,
    assetClass: assetClassFor(assetType, currency, symbol, firstDefined(item.sector, "")),
    assetType: String(assetType || "STOCK").toUpperCase().includes("ETF") ? "ETF" : "STOCK",
    currency,
    price: Number(firstDefined(item.price, item.current_price, item.regular_market_price, 0)),
    availableQuantity: positiveNumber(firstDefined(item.availableQuantity, item.available_quantity, item.quantity)),
    sector: firstDefined(item.sector, ""),
  };
}

function TransactionDrawer({
  holding,
  holdings,
  initialSide,
  editTransaction = null,
  usdInrRate,
  usdInrStatus,
  onClose,
  onSave,
}) {
  const isEdit = Boolean(editTransaction);
  const [side, setSide] = useState(editTransaction?.side || initialSide);
  const [selectedSymbol, setSelectedSymbol] = useState(holding ? normalizeSearchResult({ ...holding, price: holding.currentPrice }) : null);
  const [searchOpen, setSearchOpen] = useState(!isEdit && !holding);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    symbol: editTransaction?.symbol ?? holding?.symbol ?? "",
    name: editTransaction?.name || holding?.name || "",
    market: holding?.market ?? "NSE",
    assetClass: holding?.assetClass ?? "Indian Stocks",
    assetType: editTransaction?.assetType || holding?.assetType || "STOCK",
    sector: editTransaction?.sector || holding?.sector || "",
    currency: editTransaction?.currency ?? holding?.currency ?? "INR",
    quantity: editTransaction?.quantity ?? "",
    averagePrice: editTransaction?.price ?? holding?.currentPrice ?? "",
    currentPrice: holding?.currentPrice ?? "",
    date: editTransaction ? transactionInputDate(editTransaction.tradedAt) : new Date().toISOString().slice(0, 10),
  });
  const searchRef = useRef(null);
  const heldPosition = holdings.find((item) => item.symbol === form.symbol);
  const availableQuantity = side === "SELL"
    ? Number(heldPosition?.quantity || 0) + (isEdit ? Number(editTransaction?.quantity || 0) : 0)
    : null;
  const exceedsAvailable = side === "SELL"
    && Number(form.quantity || 0) > availableQuantity;

  useEffect(() => {
    if (isEdit) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    const query = form.symbol.trim();
    if (!searchOpen) {
      setResults([]);
      setSearching(false);
      return undefined;
    }

    if (side === "SELL") {
      const heldResults = holdings
        .filter((item) => `${item.symbol} ${item.name}`.toLowerCase().includes(query.toLowerCase()))
        .map((item) => normalizeSearchResult({
          ...item,
          price: item.currentPrice,
          availableQuantity: item.quantity,
        }));
      setResults(heldResults);
      setSearching(false);
      return undefined;
    }

    if (query.length < 1) {
      setResults([]);
      setSearching(false);
      return undefined;
    }

    const controller = new AbortController();
    const fallback = demoSymbols.filter((item) =>
      `${item.symbol} ${item.name}`.toLowerCase().includes(query.toLowerCase()),
    );
    setResults(fallback);
    setSearching(true);

    const timer = window.setTimeout(() => {
      portfolioApi.searchSymbols(query, controller.signal)
        .then((response) => {
          const items = response?.results ?? response?.data ?? response;
          if (Array.isArray(items) && items.length) setResults(items.map(normalizeSearchResult));
        })
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 260);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.symbol, holdings, isEdit, searchOpen, side]);

  function changeSide(nextSide) {
    if (isEdit || nextSide === side) return;
    setSide(nextSide);
    setSearchOpen(true);
    if (nextSide === "SELL" && !holdings.some((item) => item.symbol === form.symbol)) {
      setSelectedSymbol(null);
      setForm((current) => ({
        ...current,
        symbol: "",
        name: "",
        quantity: "",
        averagePrice: "",
        currentPrice: "",
        sector: "",
      }));
    }
  }

  function chooseSymbol(item) {
    const normalized = normalizeSearchResult(item);
    const roundedPrice = Math.round(normalized.price * 100) / 100;
    setSelectedSymbol(normalized);
    setSearchOpen(false);
    setForm((current) => ({
      ...current,
      symbol: normalized.symbol,
      name: normalized.name,
      market: normalized.market,
      assetClass: normalized.assetClass,
      sector: normalized.sector,
      currency: normalized.currency,
      currentPrice: roundedPrice,
      averagePrice: normalized.symbol === current.symbol && current.averagePrice
        ? current.averagePrice
        : roundedPrice,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.symbol || !form.quantity || !form.averagePrice || exceedsAvailable) return;
    setSaving(true);
    try {
      await onSave({
        ...form,
        side,
        quantity: Number(form.quantity),
        averagePrice: Number(form.averagePrice),
        currentPrice: Number(form.currentPrice || form.averagePrice),
      });
    } finally {
      setSaving(false);
    }
  }

  const transactionValue = Number(form.quantity || 0) * Number(form.averagePrice || 0);
  const sideLabel = side === "BUY" ? "Buy" : "Sell";
  const drawerTitle = isEdit ? "Edit latest transaction" : `${sideLabel} an investment`;
  const drawerSubtitle = isEdit
    ? `Update the latest ${sideLabel.toLowerCase()} for ${form.symbol}. The position will be recalculated after saving.`
    : side === "BUY"
      ? "Search Yahoo Finance and record a dated purchase."
      : "Choose an open position and record the units sold.";
  const canSubmit = Boolean(form.symbol && form.quantity && form.averagePrice) && !exceedsAvailable;

  return (
    <DrawerShell
      title={drawerTitle}
      subtitle={drawerSubtitle}
      onClose={onClose}
    >
      <form className="holding-form" onSubmit={handleSubmit}>
        {isEdit ? (
          <div className={cx("transaction-edit-context", side === "SELL" && "is-sell")}>
            {side === "BUY" ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
            <span>
              <small>Transaction type</small>
              <strong>{sideLabel} · symbol and type are locked</strong>
            </span>
          </div>
        ) : (
          <div className="transaction-side-control" role="group" aria-label="Transaction side">
            <button
              className={side === "BUY" ? "is-selected" : ""}
              type="button"
              onClick={() => changeSide("BUY")}
              aria-pressed={side === "BUY"}
            >
              <ArrowDownRight size={17} /> Buy
            </button>
            <button
              className={side === "SELL" ? "is-selected sell-side" : ""}
              type="button"
              onClick={() => changeSide("SELL")}
              aria-pressed={side === "SELL"}
            >
              <ArrowUpRight size={17} /> Sell
            </button>
          </div>
        )}
        <div className="field-group symbol-field" ref={searchRef}>
          <label htmlFor="symbol-search">{isEdit ? "Holding" : side === "BUY" ? "Symbol or company" : "Holding to sell"}</label>
          <div className="field-with-icon">
            <MagnifyingGlass size={19} />
            <input
              id="symbol-search"
              value={form.symbol}
              onFocus={() => { if (!isEdit) setSearchOpen(true); }}
              onChange={(event) => {
                if (isEdit) return;
                setSelectedSymbol(null);
                setSearchOpen(true);
                setForm((current) => ({
                  ...current,
                  symbol: event.target.value.toUpperCase(),
                  name: "",
                  sector: "",
                }));
              }}
              placeholder={side === "BUY" ? "Try RELIANCE.NS or AAPL" : "Search your open positions"}
              autoComplete="off"
              readOnly={isEdit}
              required
            />
            {searching ? <SpinnerGap className="spin field-spinner" size={18} /> : null}
          </div>
          {!isEdit && searchOpen && results.length ? (
            <div className="symbol-results">
              {results.slice(0, 5).map((item) => (
                <button type="button" key={item.symbol} onClick={() => chooseSymbol(item)}>
                  <InstrumentMark symbol={item.symbol} className="result-mark" />
                  <span>
                    <strong>{item.symbol}</strong>
                    <small>{item.name}</small>
                  </span>
                  <span>
                    <strong>{formatMoney(item.price, item.currency, 2)}</strong>
                    <small>
                      {side === "SELL" && item.availableQuantity
                        ? `${item.availableQuantity.toLocaleString("en-IN")} available`
                        : item.market}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {!isEdit && searchOpen && side === "SELL" && results.length === 0 ? (
            <div className="sell-search-empty">
              {holdings.length === 0 ? "There are no open positions to sell." : "No held symbol matches this search."}
            </div>
          ) : null}
        </div>

        {selectedSymbol || form.name ? (
          <div className="selected-quote">
            <div>
              <InstrumentMark symbol={form.symbol} className="result-mark" />
              <span>
                <strong>{form.name || form.symbol}</strong>
                <small>{form.market} · {form.assetClass}</small>
              </span>
            </div>
            <div>
              <small>Latest close</small>
              <strong>{formatMoney(form.currentPrice, form.currency, 2)}</strong>
              {side === "SELL" ? <small>{availableQuantity.toLocaleString("en-IN")} units available for this sale</small> : null}
            </div>
          </div>
        ) : null}

        <div className="form-row">
          <div className="field-group">
            <label htmlFor="quantity">Quantity to {side === "BUY" ? "buy" : "sell"}</label>
            <input
              id="quantity"
              type="number"
              min="0.0001"
              max={side === "SELL" && availableQuantity ? availableQuantity : undefined}
              step="any"
              value={form.quantity}
              onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
              placeholder="0"
              aria-describedby={side === "SELL" ? "available-quantity" : undefined}
              required
            />
            {side === "SELL" ? (
              <small id="available-quantity" className={cx("field-hint", exceedsAvailable && "field-error")}>
                {exceedsAvailable
                  ? `Only ${availableQuantity.toLocaleString("en-IN")} units are available for this transaction.`
                  : isEdit
                    ? `${availableQuantity.toLocaleString("en-IN")} units available after rolling back this sale.`
                    : `${availableQuantity.toLocaleString("en-IN")} units available to sell.`}
              </small>
            ) : null}
          </div>
          <div className="field-group">
            <label htmlFor="average-price">{side === "BUY" ? "Purchase" : "Sale"} price per unit</label>
            <div className="input-prefix">
              <span>{form.currency === "USD" ? "$" : "₹"}</span>
              <input
                id="average-price"
                type="number"
                min="0"
                step="any"
                value={form.averagePrice}
                onChange={(event) => setForm((current) => ({ ...current, averagePrice: event.target.value }))}
                placeholder="0.00"
                required
              />
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="field-group">
            <label htmlFor="transaction-date">{side === "BUY" ? "Purchase" : "Sale"} date</label>
            <div className="field-with-icon date-field">
              <CalendarBlank size={18} />
              <input
                id="transaction-date"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={form.date}
                onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                required
              />
            </div>
          </div>
          <div className="field-group">
            <label htmlFor="market">Market</label>
            <div className="field-with-icon">
              <Buildings size={18} />
              <input id="market" value={form.market} readOnly />
            </div>
          </div>
        </div>

        <div className="field-group metadata-field">
          <label htmlFor="sector">Sector</label>
          <div className="field-with-icon">
            <ChartPieSlice size={18} />
            <input
              id="sector"
              value={form.sector}
              onChange={(event) => setForm((current) => ({ ...current, sector: event.target.value }))}
              placeholder="Fetched from Yahoo Finance, or enter manually"
              maxLength={120}
            />
          </div>
          <small className="field-hint">
            Leave blank to use Yahoo Finance classification. A manual value takes priority.
          </small>
        </div>

        <div className="cost-preview">
          <span>{side === "BUY" ? "Purchase value" : "Estimated proceeds"}</span>
          <strong>{formatMoney(transactionValue, form.currency, form.currency === "USD" ? 2 : 0)}</strong>
          {form.currency === "USD" ? (
            <small>
              {usdInrRate
                ? `≈ ${formatMoney(transactionValue * usdInrRate, "INR")} · ${usdInrStatus === "live" ? "Live" : usdInrStatus === "cached" ? "Cached" : "Portfolio"} USD/INR ${usdInrRate.toFixed(2)}`
                : "INR conversion unavailable until a portfolio FX rate is received"}
            </small>
          ) : null}
        </div>

        <div className="drawer-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className={cx("primary-button", side === "SELL" && "sell-button")} type="submit" disabled={saving || !canSubmit}>
            {saving ? <SpinnerGap className="spin" size={18} /> : <Check size={18} weight="bold" />}
            {saving ? "Saving…" : isEdit ? "Save changes" : `${sideLabel} ${form.symbol || "investment"}`}
          </button>
        </div>
      </form>
    </DrawerShell>
  );
}

function TransactionsDrawer({ transactions, onClose }) {
  return (
    <DrawerShell title="Transactions" subtitle="Your recent buys, sells and income." onClose={onClose} width="wide">
      <div className="transactions-summary">
        <div><Wallet size={19} /><span><small>Total invested</small><strong>{formatMoney(demoSummary.invested, "INR")}</strong></span></div>
        <div><Receipt size={19} /><span><small>Records</small><strong>{transactions.length}</strong></span></div>
      </div>
      <div className="transaction-list">
        {transactions.map((transaction) => {
          const isOutflow = transaction.type === "Buy";
          const Icon = isOutflow ? ArrowDownRight : ArrowUpRight;
          return (
            <article key={transaction.id}>
              <span className={cx("transaction-icon", isOutflow ? "outflow" : "inflow")}><Icon size={19} /></span>
              <div>
                <strong>{transaction.symbol}</strong>
                <span>{transaction.type}{transaction.quantity ? ` · ${transaction.quantity} units` : ""}</span>
              </div>
              <div>
                <strong>{isOutflow ? "−" : "+"}{formatMoney(transaction.amount, transaction.currency, transaction.currency === "USD" ? 2 : 0)}</strong>
                <span>{transaction.date}</span>
              </div>
            </article>
          );
        })}
      </div>
      <div className="drawer-callout">
        <Info size={19} />
        <p>Transactions drive XIRR and historical portfolio value. Record buys and sells from the main “Add transaction” action or a holding&apos;s row menu.</p>
      </div>
    </DrawerShell>
  );
}

function SettingsDrawer({ currency, usdInrRate, benchmark, onCurrencyChange, onBenchmarkChange, onClose }) {
  return (
    <DrawerShell title="Portfolio settings" subtitle="Personalise how this dashboard is presented." onClose={onClose}>
      <div className="settings-list">
        <section>
          <span className="setting-icon"><CurrencyInr size={20} /></span>
          <div><strong>Display currency</strong><p>Change summary values and chart labels.</p></div>
          <div className="mini-segmented">
            {["INR", "USD"].map((item) => <button className={currency === item ? "is-selected" : ""} type="button" key={item} onClick={() => onCurrencyChange(item)} disabled={item === "USD" && !usdInrRate}>{item}</button>)}
          </div>
        </section>
        <section>
          <span className="setting-icon"><TrendUp size={20} /></span>
          <div><strong>Nifty 50 benchmark</strong><p>Compare relative returns over the selected period.</p></div>
          <button className={cx("switch", benchmark && "is-on")} type="button" role="switch" aria-checked={benchmark} onClick={() => onBenchmarkChange(!benchmark)}><span /></button>
        </section>
        <section>
          <span className="setting-icon"><SlidersHorizontal size={20} /></span>
          <div><strong>Daily snapshots</strong><p>One closing value is kept for each market day.</p></div>
          <span className="status-badge"><Check size={13} /> On</span>
        </section>
      </div>
    </DrawerShell>
  );
}

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(onDismiss, 3600);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast]);

  if (!toast) return null;
  return (
    <div className={cx("toast", toast.kind === "warning" && "toast-warning")} role="status">
      <span>{toast.kind === "warning" ? <Info size={18} /> : <Check size={18} weight="bold" />}</span>
      <p>{toast.message}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification"><X size={16} /></button>
    </div>
  );
}

export function App() {
  const [holdings, setHoldings] = useState(demoHoldings);
  const [summary, setSummary] = useState(demoSummary);
  const [history, setHistory] = useState(() => buildDemoHistory());
  const [allocation, setAllocation] = useState(demoAllocation);
  const [sectorAllocation, setSectorAllocation] = useState([]);
  const [transactions, setTransactions] = useState(demoTransactions);
  const [ledgerTransactions, setLedgerTransactions] = useState([]);
  const [activeView, setActiveView] = useState("overview");
  const [currency, setCurrency] = useState("INR");
  const [range, setRange] = useState("All");
  const [benchmark, setBenchmark] = useState(false);
  const [query, setQuery] = useState("");
  const [lastUpdated, setLastUpdated] = useState(new Date("2026-07-22T10:12:00+05:30"));
  const [usdInrRate, setUsdInrRate] = useState(null);
  const [usdInrStatus, setUsdInrStatus] = useState("unavailable");
  const [refreshing, setRefreshing] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [transactionContext, setTransactionContext] = useState(null);
  const [analysisHolding, setAnalysisHolding] = useState(null);
  const [toast, setToast] = useState(null);
  const editLoadRequest = useRef(0);

  const showToast = useCallback((message, kind = "success") => {
    setToast({ id: Date.now(), message, kind });
  }, []);

  const applyPortfolio = useCallback((response) => {
    const next = unpackPortfolio(response);
    setHoldings(next.holdings);
    setHistory(next.history);
    setAllocation(next.allocation);
    setSectorAllocation(next.sectorAllocation);
    setSummary(next.summary);
    setUsdInrRate(next.usdInrRate);
    setUsdInrStatus(next.usdInrStatus);
    if (next.lastUpdated) {
      const parsed = new Date(next.lastUpdated);
      if (!Number.isNaN(parsed.getTime())) setLastUpdated(parsed);
    }
  }, []);

  const reloadPortfolio = useCallback(async () => {
    const response = await portfolioApi.getPortfolio();
    applyPortfolio(response);
    return response;
  }, [applyPortfolio]);

  const reloadTransactions = useCallback(async (signal) => {
    const response = await portfolioApi.getTransactions(signal);
    const rows = response?.transactions ?? response?.data ?? response;
    if (!Array.isArray(rows)) return [];
    const normalized = rows.map(normalizeTransactionForEdit);
    setLedgerTransactions(normalized);
    setTransactions(normalized.map((row, index) => ({
      id: row.id || index,
      type: row.side.toLowerCase().replace(/^./, (letter) => letter.toUpperCase()),
      symbol: row.symbol || "—",
      date: fullDate(row.tradedAt || row.createdAt),
      quantity: row.quantity,
      amount: Number(row.quantity || 0) * Number(row.price || 0),
      currency: row.currency || "INR",
    })));
    return normalized;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    portfolioApi.getPortfolio(controller.signal)
      .then(applyPortfolio)
      .catch(() => {});
    reloadTransactions(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [applyPortfolio, reloadTransactions]);

  useEffect(() => {
    if (!usdInrRate && currency === "USD") setCurrency("INR");
  }, [currency, usdInrRate]);

  useEffect(() => {
    if (!drawer) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setDrawer(null);
        if (drawer === "transaction") {
          editLoadRequest.current += 1;
          setTransactionContext(null);
        }
        if (drawer === "holding-analysis") setAnalysisHolding(null);
      }
    }
    document.body.classList.add("drawer-open");
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("drawer-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [drawer]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await portfolioApi.refresh();
      await reloadPortfolio();
      setLastUpdated(new Date());
      showToast("Portfolio prices and today’s snapshot are up to date.");
    } catch (error) {
      setLastUpdated(new Date());
      showToast(
        error?.message || "Portfolio prices could not be refreshed. The latest saved prices are still shown.",
        "warning",
      );
    } finally {
      setRefreshing(false);
    }
  }

  function handleNavigate(destination) {
    if (destination === "transactions") {
      setDrawer("transactions");
      const controller = new AbortController();
      reloadTransactions(controller.signal).catch(() => {});
      return;
    }
    if (destination === "settings") {
      setDrawer("settings");
      return;
    }
    if (destination === "holdings") {
      setActiveView("holdings");
      setDrawer(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (destination === "analytics") {
      setActiveView("analytics");
      setDrawer(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setActiveView("overview");
    setDrawer(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openTransactionDrawer(side = "BUY", holding = null) {
    editLoadRequest.current += 1;
    setAnalysisHolding(null);
    setTransactionContext({ mode: "create", side, holding });
    setDrawer("transaction");
  }

  function openHoldingAnalysis(holding) {
    setAnalysisHolding(holding);
    setDrawer("holding-analysis");
  }

  function closeHoldingAnalysis() {
    setDrawer(null);
    setAnalysisHolding(null);
  }

  function closeTransactionDrawer() {
    editLoadRequest.current += 1;
    setDrawer(null);
    setTransactionContext(null);
  }

  async function openEditHolding(holding) {
    const requestId = editLoadRequest.current + 1;
    editLoadRequest.current = requestId;
    setTransactionContext({ mode: "edit", holding, loading: true, error: null, transaction: null });
    setDrawer("transaction");

    try {
      if (!holding.latestTransactionId) {
        throw new Error("This holding does not include a latest transaction ID, so it cannot be edited safely.");
      }
      const response = await portfolioApi.getTransactions(undefined, holding.symbol);
      const rows = response?.transactions ?? response?.data ?? response;
      const transaction = Array.isArray(rows)
        ? latestTransactionForHolding(rows, holding)
        : null;
      if (!transaction) {
        throw new Error("The latest saved transaction for this holding could not be found. Refresh the portfolio and try again.");
      }
      if (editLoadRequest.current !== requestId) return;
      setTransactionContext({
        mode: "edit",
        holding,
        loading: false,
        error: null,
        side: transaction.side,
        transaction,
      });
    } catch (error) {
      if (editLoadRequest.current !== requestId) return;
      setTransactionContext({
        mode: "edit",
        holding,
        loading: false,
        error: error?.message || "The latest transaction could not be loaded.",
        transaction: null,
      });
    }
  }

  async function saveTransaction(form) {
    const payload = {
      symbol: form.symbol,
      side: form.side,
      quantity: form.quantity,
      price: form.averagePrice,
      traded_at: `${form.date}T12:00:00+05:30`,
      name: form.name,
      asset_type: form.assetType || (form.assetClass.includes("ETF") ? "ETF" : "STOCK"),
      currency: form.currency,
      sector: form.sector || null,
    };

    try {
      await portfolioApi.createTransaction(payload);
      await reloadPortfolio();
      await reloadTransactions();
      showToast(
        `${form.side === "BUY" ? "Bought" : "Sold"} ${form.quantity.toLocaleString("en-IN")} ${form.symbol}.`,
      );
      closeTransactionDrawer();
    } catch (error) {
      showToast(error?.message || "The transaction could not be saved. Your portfolio is unchanged.", "warning");
    }
  }

  async function saveEditedTransaction(transactionId, form) {
    const payload = {
      quantity: form.quantity,
      price: form.averagePrice,
      traded_at: `${form.date}T12:00:00+05:30`,
      sector: form.sector || null,
    };

    try {
      await portfolioApi.updateTransaction(transactionId, payload);
      await reloadPortfolio();
      await reloadTransactions();
      showToast(`Updated the latest ${form.side.toLowerCase()} for ${form.symbol}.`);
      closeTransactionDrawer();
    } catch (error) {
      showToast(error?.message || "The transaction could not be updated. Your portfolio is unchanged.", "warning");
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeItem={drawer === "transactions" ? "transactions" : activeView}
        onNavigate={handleNavigate}
      />
      <main className="workspace" id="portfolio-top">
        <Topbar
          activeView={activeView}
          lastUpdated={lastUpdated}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onAdd={() => openTransactionDrawer("BUY")}
        />
        {activeView === "overview" ? (
          <div className="content-grid">
            <div className="portfolio-column">
              <PortfolioSummary
                summary={summary}
                currency={currency}
                usdInrRate={usdInrRate}
                onCurrencyChange={setCurrency}
              />
              <PortfolioChart
                history={history}
                currentValue={summary.totalValue}
                currentInvested={summary.invested}
                currentNetInvested={summary.netInvested}
                range={range}
                currency={currency}
                usdInrRate={usdInrRate}
                benchmark={benchmark}
                onRangeChange={setRange}
                onBenchmarkChange={setBenchmark}
              />
              <HoldingsTable
                holdings={holdings}
                query={query}
                usdInrRate={usdInrRate}
                usdInrStatus={usdInrStatus}
                compact
                onQueryChange={setQuery}
                onBuy={(holding) => openTransactionDrawer("BUY", holding)}
                onEdit={openEditHolding}
                onSell={(holding) => openTransactionDrawer("SELL", holding)}
                onAnalyze={openHoldingAnalysis}
                onShowAll={() => setActiveView("holdings")}
              />
              <UnderperformanceReview
                holdings={holdings}
                usdInrRate={usdInrRate}
                compact
                onAnalyze={openHoldingAnalysis}
                onShowAll={() => setActiveView("holdings")}
              />
              <AveragingCandidates
                holdings={holdings}
                usdInrRate={usdInrRate}
                compact
                onBuy={(holding) => openTransactionDrawer("BUY", holding)}
                onShowAll={() => setActiveView("holdings")}
              />
            </div>
            <MetricsRail
              summary={summary}
              allocation={allocation}
              sectorAllocation={sectorAllocation}
            />
          </div>
        ) : activeView === "analytics" ? (
          <AnalyticsView
            history={history}
            holdings={holdings}
            transactions={ledgerTransactions}
            summary={summary}
            usdInrRate={usdInrRate}
          />
        ) : (
          <HoldingsView
            holdings={holdings}
            summary={summary}
            query={query}
            usdInrRate={usdInrRate}
            usdInrStatus={usdInrStatus}
            onQueryChange={setQuery}
            onBuy={(holding) => openTransactionDrawer("BUY", holding)}
            onEdit={openEditHolding}
            onSell={(holding) => openTransactionDrawer("SELL", holding)}
            onAnalyze={openHoldingAnalysis}
          />
        )}
      </main>

      {drawer === "transaction" && transactionContext ? (
        transactionContext.mode === "edit" && !transactionContext.transaction ? (
          <TransactionDrawerState
            holding={transactionContext.holding}
            loading={transactionContext.loading}
            error={transactionContext.error}
            onRetry={() => openEditHolding(transactionContext.holding)}
            onClose={closeTransactionDrawer}
          />
        ) : (
          <TransactionDrawer
            key={`${transactionContext.mode}-${transactionContext.transaction?.id || transactionContext.side}-${transactionContext.holding?.symbol || "new"}`}
            holding={transactionContext.holding}
            holdings={holdings}
            initialSide={transactionContext.side}
            editTransaction={transactionContext.transaction}
            usdInrRate={usdInrRate}
            usdInrStatus={usdInrStatus}
            onClose={closeTransactionDrawer}
            onSave={transactionContext.mode === "edit"
              ? (form) => saveEditedTransaction(transactionContext.transaction.id, form)
              : saveTransaction}
          />
        )
      ) : null}
      {drawer === "transactions" ? (
        <TransactionsDrawer transactions={transactions} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer === "holding-analysis" && analysisHolding ? (
        <HoldingAnalysisDrawer
          holding={holdings.find((item) => item.symbol === analysisHolding.symbol) || analysisHolding}
          history={history}
          usdInrRate={usdInrRate}
          onClose={closeHoldingAnalysis}
          onBuy={(holding) => openTransactionDrawer("BUY", holding)}
          onSell={(holding) => openTransactionDrawer("SELL", holding)}
        />
      ) : null}
      {drawer === "settings" ? (
        <SettingsDrawer
          currency={currency}
          usdInrRate={usdInrRate}
          benchmark={benchmark}
          onCurrencyChange={setCurrency}
          onBenchmarkChange={setBenchmark}
          onClose={() => setDrawer(null)}
        />
      ) : null}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
