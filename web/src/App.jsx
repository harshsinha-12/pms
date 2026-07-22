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
  Trash,
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { portfolioApi } from "./api.js";
import {
  INR_PER_USD,
  buildDemoHistory,
  demoAllocation,
  demoHoldings,
  demoSummary,
  demoSymbols,
  demoTransactions,
} from "./demoData.js";

const RANGE_DAYS = { "1M": 31, "6M": 183, "1Y": 366, All: Infinity };

function cx(...names) {
  return names.filter(Boolean).join(" ");
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

function formatIndianCompact(value, currency = "INR") {
  const converted = currency === "USD" ? value / INR_PER_USD : value;
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

function valueInInr(holding, unitPrice = holding.currentPrice) {
  if (unitPrice === holding.currentPrice && Number.isFinite(holding.marketValueInr)) {
    return holding.marketValueInr;
  }
  const nativeValue = Number(holding.quantity || 0) * Number(unitPrice || 0);
  return holding.currency === "USD" ? nativeValue * INR_PER_USD : nativeValue;
}

function assetClassFor(assetType, currency) {
  const normalizedType = String(assetType || "").toUpperCase();
  if (normalizedType.includes("ETF")) return currency === "USD" ? "US ETFs" : "Indian ETFs";
  return currency === "USD" ? "US Stocks" : "Indian Stocks";
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
    symbol,
    name: firstDefined(raw.name, raw.long_name, raw.company_name, symbol, "Unknown asset"),
    market,
    assetClass: assetClassFor(assetType, currency),
    assetType: String(assetType || "STOCK").toUpperCase().includes("ETF") ? "ETF" : "STOCK",
    currency,
    quantity: Number(firstDefined(raw.quantity, raw.units, 0)),
    averagePrice: Number(
      firstDefined(raw.averagePrice, raw.average_price, raw.avg_price, raw.purchase_price, 0),
    ),
    currentPrice: Number(firstDefined(raw.currentPrice, raw.current_price, raw.price, 0)),
    marketValueInr: Number(firstDefined(raw.marketValueInr, raw.market_value_inr, NaN)),
    unrealizedPnlInr: Number(firstDefined(raw.unrealizedPnlInr, raw.unrealized_pnl_inr, NaN)),
    realizedPnlInr: Number(firstDefined(raw.realizedPnlInr, raw.realized_pnl_inr, 0)),
    quoteIsStale: Boolean(firstDefined(raw.quoteIsStale, raw.quote_is_stale, false)),
    tradedAt: firstDefined(raw.tradedAt, raw.latest_traded_at, raw.traded_at, null),
    color: firstDefined(raw.color, ["#b89252", "#b91f2e", "#5b63de", "#11130f"][index % 4]),
  };
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
  const normalizedHoldings = Array.isArray(rawHoldings)
    ? rawHoldings.map((holding, index) => normalizeHolding(holding, index))
    : [];
  const groupedAllocation = normalizedHoldings.reduce((groups, holding) => {
    groups[holding.assetClass] = (groups[holding.assetClass] || 0) + valueInInr(holding);
    return groups;
  }, {});
  const allocationTotal = Object.values(groupedAllocation).reduce((sum, value) => sum + value, 0);
  const allocationColors = {
    "Indian Stocks": "#11662f",
    "Indian ETFs": "#4fa45e",
    "US Stocks": "#b5d4b7",
    "US ETFs": "#8ebc98",
  };

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
            benchmark: Number(firstDefined(point.benchmark, point.benchmark_value, 0)),
          }))
          .filter((point) => point.date && point.value)
      : [],
    allocation: Object.entries(groupedAllocation).map(([name, value], index) => ({
      name,
      value: allocationTotal ? (value / allocationTotal) * 100 : 0,
      color: allocationColors[name] || demoAllocation[index % demoAllocation.length]?.color || "#d7dbd2",
    })),
    lastUpdated: firstDefined(payload.lastUpdated, payload.last_updated, payload.as_of),
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

function Sidebar({ onNavigate }) {
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
            className={cx("nav-item", id === "overview" && "is-active")}
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
          >
            <Icon size={21} weight={id === "overview" ? "duotone" : "regular"} />
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

function Topbar({ lastUpdated, refreshing, onRefresh, onAdd }) {
  return (
    <header className="topbar">
      <div>
        <h1>Good morning, Harsh</h1>
        <p>
          <Clock size={17} />
          Prices as of {formatTimestamp(lastUpdated)} IST
        </p>
      </div>
      <div className="topbar-actions">
        <button className="primary-button" type="button" onClick={onAdd}>
          <Plus size={20} weight="bold" />
          Add holding
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

function PortfolioSummary({ summary, currency, onCurrencyChange }) {
  const total = currency === "USD" ? summary.totalValue / INR_PER_USD : summary.totalValue;
  const gain = currency === "USD" ? summary.allTimeGain / INR_PER_USD : summary.allTimeGain;
  const today = currency === "USD" ? summary.todayChange / INR_PER_USD : summary.todayChange;

  return (
    <section className="portfolio-summary" aria-labelledby="portfolio-value-label">
      <div>
        <p className="eyebrow" id="portfolio-value-label">Portfolio value</p>
        <div className="portfolio-value">
          {formatMoney(total, currency, currency === "USD" ? 0 : 0)}
        </div>
        <div className="return-line">
          <span>All-time gain</span>
          <strong className={gain < 0 ? "negative" : gain > 0 ? "positive" : "neutral"}>
            {formatSignedMoney(gain, currency)} ({summary.allTimeGainPercent.toFixed(2)}%)
          </strong>
          <span className="separator" aria-hidden="true" />
          <span>Today&apos;s change</span>
          <strong className={today < 0 ? "negative" : today > 0 ? "positive" : "neutral"}>
            {formatSignedMoney(today, currency)} ({summary.todayChangePercent.toFixed(2)}%)
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
          >
            {item}
          </button>
        ))}
      </div>
    </section>
  );
}

function ChartTooltip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null;
  const portfolioValue = payload.find((item) => item.dataKey === "displayValue")?.value;
  const benchmarkValue = payload.find((item) => item.dataKey === "displayBenchmark")?.value;

  return (
    <div className="chart-tooltip">
      <span>{fullDate(label)}</span>
      <strong>{formatMoney(portfolioValue, currency)}</strong>
      {benchmarkValue ? <small>Nifty 50 · {formatMoney(benchmarkValue, currency)}</small> : null}
    </div>
  );
}

function PortfolioChart({ history, range, currency, benchmark, onRangeChange, onBenchmarkChange }) {
  const chartData = useMemo(() => {
    const days = RANGE_DAYS[range];
    const visible = Number.isFinite(days) ? history.slice(-days) : history;
    return visible.map((point) => ({
      ...point,
      displayValue: currency === "USD" ? point.value / INR_PER_USD : point.value,
      displayBenchmark: currency === "USD" ? point.benchmark / INR_PER_USD : point.benchmark,
    }));
  }, [benchmark, currency, history, range]);

  const maxValue = Math.max(...chartData.map((point) => point.displayValue), 1);
  const chartInterval = currency === "USD" ? 10000 : 1000000;
  const domain = range === "All" ? [0, Math.ceil(maxValue / chartInterval) * chartInterval] : ["auto", "auto"];

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
        <label className="benchmark-control">
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
          <Info size={16} />
        </label>
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
              tickFormatter={(value) => formatIndianCompact(value, currency).replace(currency === "INR" ? "₹" : "$", "")}
            />
            <Tooltip
              cursor={{ stroke: "#8d978e", strokeDasharray: "3 3" }}
              content={<ChartTooltip currency={currency} />}
            />
            <Area
              type="monotone"
              dataKey="displayValue"
              stroke="#176a35"
              strokeWidth={2}
              fill="url(#portfolioFill)"
              activeDot={{ r: 4, fill: "#176a35", stroke: "#fff", strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {benchmark ? (
              <Line
                type="monotone"
                dataKey="displayBenchmark"
                stroke="#8e948e"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            ) : null}
          </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function AssetMark({ holding }) {
  return <InstrumentMark symbol={holding.symbol} color={holding.color} />;
}

function HoldingsTable({ holdings, query, onQueryChange, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(null);
  const filtered = holdings.filter((holding) =>
    `${holding.name} ${holding.symbol}`.toLowerCase().includes(query.toLowerCase()),
  );

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
        <span id="holdings-title">{filtered.length} holdings</span>
      </div>
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Market</th>
              <th>Qty</th>
              <th>Avg price</th>
              <th>Current price</th>
              <th>Invested</th>
              <th>Value</th>
              <th>U / R P&amp;L</th>
              <th>Allocation</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((holding) => {
              const invested = valueInInr(holding, holding.averagePrice);
              const current = valueInInr(holding);
              const gain = Number.isFinite(holding.unrealizedPnlInr)
                ? holding.unrealizedPnlInr
                : current - invested;
              const realized = Number(holding.realizedPnlInr || 0);
              const gainPercent = invested ? (gain / invested) * 100 : 0;
              const total = holdings.reduce((sum, item) => sum + valueInInr(item), 0);
              const allocation = total ? (current / total) * 100 : 0;
              const nativeInvested = holding.quantity * holding.averagePrice;
              const nativeValue = holding.quantity * holding.currentPrice;

              return (
                <tr key={holding.id}>
                  <td>
                    <div className="asset-cell">
                      <AssetMark holding={holding} />
                      <div>
                        <strong>{holding.name}</strong>
                        <span>{holding.symbol}</span>
                      </div>
                    </div>
                  </td>
                  <td>{holding.market}</td>
                  <td>{holding.quantity.toLocaleString("en-IN")}</td>
                  <td>{formatMoney(holding.averagePrice, holding.currency, 2)}</td>
                  <td>{formatMoney(holding.currentPrice, holding.currency, 2)}</td>
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
                          <button type="button" onClick={() => { setMenuOpen(null); onEdit(holding); }}>
                            <PencilSimple size={16} /> Edit holding
                          </button>
                          <button className="danger-action" type="button" onClick={() => { setMenuOpen(null); onDelete(holding); }}>
                            <Trash size={16} /> Delete
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
                ? "Use Add holding to create your first Redis-backed entry."
                : "Try a company name or ticker symbol."}
            </span>
          </div>
        ) : null}
      </div>
      <footer className="table-footer">
        <span>US stocks show values in USD with INR equivalent below.</span>
        <strong>INR/USD: {INR_PER_USD.toFixed(2)}</strong>
        <button type="button">Show more <CaretDown size={13} /></button>
      </footer>
    </section>
  );
}

function MetricsRail({ summary, allocation }) {
  return (
    <aside className="metrics-rail" id="analytics-section" aria-label="Portfolio analytics">
      <section className="allocation-block">
        <h2>Portfolio allocation</h2>
        <div className="allocation-layout">
          <div className="donut-wrap">
            {allocation.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocation}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="67%"
                    outerRadius="93%"
                    paddingAngle={1}
                    stroke="#f8f6f0"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {allocation.map((item) => <Cell key={item.name} fill={item.color} />)}
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
            {allocation.map((item) => (
              <div key={item.name}>
                <i style={{ backgroundColor: item.color }} />
                <span>{item.name}</span>
                <strong>{item.value.toFixed(1)}%</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="headline-metric">
        <p>XIRR <Info size={15} /></p>
        <strong>{summary.xirr.toFixed(1)}%</strong>
      </section>
      <section className="headline-metric">
        <p>CAGR <Info size={15} /></p>
        <strong>{summary.cagr.toFixed(1)}%</strong>
      </section>

      <section className="pnl-breakdown">
        <h2>Gains &amp; losses</h2>
        <dl>
          <div>
            <dt>Unrealized P&amp;L</dt>
            <dd className={summary.unrealizedGain < 0 ? "negative" : summary.unrealizedGain > 0 ? "positive" : "neutral"}>
              {formatSignedMoney(summary.unrealizedGain, "INR")}
            </dd>
          </div>
          <div>
            <dt>Realized P&amp;L</dt>
            <dd className={summary.realizedGain < 0 ? "negative" : summary.realizedGain > 0 ? "positive" : "neutral"}>
              {formatSignedMoney(summary.realizedGain, "INR")}
            </dd>
          </div>
          <div className="net-pnl">
            <dt>Total P&amp;L</dt>
            <dd className={summary.allTimeGain < 0 ? "negative" : summary.allTimeGain > 0 ? "positive" : "neutral"}>
              {formatSignedMoney(summary.allTimeGain, "INR")}
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
    assetClass: assetClassFor(assetType, currency),
    assetType: String(assetType || "STOCK").toUpperCase().includes("ETF") ? "ETF" : "STOCK",
    currency,
    price: Number(firstDefined(item.price, item.current_price, item.regular_market_price, 0)),
  };
}

function HoldingDrawer({ holding, onClose, onSave }) {
  const isEditing = Boolean(holding);
  const [selectedSymbol, setSelectedSymbol] = useState(holding ? normalizeSearchResult({ ...holding, price: holding.currentPrice }) : null);
  const [searchOpen, setSearchOpen] = useState(!holding);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    symbol: holding?.symbol ?? "",
    name: holding?.name ?? "",
    market: holding?.market ?? "NSE",
    assetClass: holding?.assetClass ?? "Indian Stocks",
    currency: holding?.currency ?? "INR",
    quantity: holding?.quantity ?? "",
    averagePrice: holding?.averagePrice ?? "",
    currentPrice: holding?.currentPrice ?? "",
    date: holding?.tradedAt
      ? String(holding.tradedAt).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  });
  const searchRef = useRef(null);

  useEffect(() => {
    const query = form.symbol.trim();
    if (!searchOpen || query.length < 1) {
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
  }, [form.symbol, searchOpen]);

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
      currency: normalized.currency,
      currentPrice: roundedPrice,
      averagePrice: current.averagePrice || roundedPrice,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.symbol || !form.quantity || !form.averagePrice) return;
    setSaving(true);
    await onSave({
      ...form,
      id: holding?.id,
      quantity: Number(form.quantity),
      averagePrice: Number(form.averagePrice),
      currentPrice: Number(form.currentPrice || form.averagePrice),
    });
    setSaving(false);
  }

  const totalCost = Number(form.quantity || 0) * Number(form.averagePrice || 0);

  return (
    <DrawerShell
      title={isEditing ? "Edit holding" : "Add a holding"}
      subtitle={isEditing ? "Update the position details used in your portfolio." : "Search a Yahoo Finance symbol and record your purchase."}
      onClose={onClose}
    >
      <form className="holding-form" onSubmit={handleSubmit}>
        <div className="field-group symbol-field" ref={searchRef}>
          <label htmlFor="symbol-search">Symbol or company</label>
          <div className="field-with-icon">
            <MagnifyingGlass size={19} />
            <input
              id="symbol-search"
              value={form.symbol}
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => {
                setSelectedSymbol(null);
                setSearchOpen(true);
                setForm((current) => ({ ...current, symbol: event.target.value.toUpperCase(), name: "" }));
              }}
              placeholder="Try RELIANCE.NS or AAPL"
              autoComplete="off"
              required
            />
            {searching ? <SpinnerGap className="spin field-spinner" size={18} /> : null}
          </div>
          {searchOpen && results.length ? (
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
                    <small>{item.market}</small>
                  </span>
                </button>
              ))}
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
            </div>
          </div>
        ) : null}

        <div className="form-row">
          <div className="field-group">
            <label htmlFor="quantity">Quantity</label>
            <input
              id="quantity"
              type="number"
              min="0.0001"
              step="any"
              value={form.quantity}
              onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
              placeholder="0"
              required
            />
          </div>
          <div className="field-group">
            <label htmlFor="average-price">Average purchase price</label>
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
            <label htmlFor="purchase-date">Purchase date</label>
            <div className="field-with-icon date-field">
              <CalendarBlank size={18} />
              <input
                id="purchase-date"
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

        <div className="cost-preview">
          <span>Purchase value</span>
          <strong>{formatMoney(totalCost, form.currency, form.currency === "USD" ? 2 : 0)}</strong>
          {form.currency === "USD" ? <small>≈ {formatMoney(totalCost * INR_PER_USD, "INR")}</small> : null}
        </div>

        <div className="drawer-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="submit" disabled={saving || !form.quantity || !form.averagePrice}>
            {saving ? <SpinnerGap className="spin" size={18} /> : <Check size={18} weight="bold" />}
            {saving ? "Saving…" : isEditing ? "Save changes" : "Add holding"}
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
        <p>Transactions drive XIRR and historical portfolio value. Add purchases from the main “Add holding” action.</p>
      </div>
    </DrawerShell>
  );
}

function SettingsDrawer({ currency, benchmark, onCurrencyChange, onBenchmarkChange, onClose }) {
  return (
    <DrawerShell title="Portfolio settings" subtitle="Personalise how this dashboard is presented." onClose={onClose}>
      <div className="settings-list">
        <section>
          <span className="setting-icon"><CurrencyInr size={20} /></span>
          <div><strong>Display currency</strong><p>Change summary values and chart labels.</p></div>
          <div className="mini-segmented">
            {["INR", "USD"].map((item) => <button className={currency === item ? "is-selected" : ""} type="button" key={item} onClick={() => onCurrencyChange(item)}>{item}</button>)}
          </div>
        </section>
        <section>
          <span className="setting-icon"><TrendUp size={20} /></span>
          <div><strong>Nifty 50 benchmark</strong><p>Compare your portfolio&apos;s historical path.</p></div>
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
  const [transactions, setTransactions] = useState(demoTransactions);
  const [currency, setCurrency] = useState("INR");
  const [range, setRange] = useState("All");
  const [benchmark, setBenchmark] = useState(false);
  const [query, setQuery] = useState("");
  const [lastUpdated, setLastUpdated] = useState(new Date("2026-07-22T10:12:00+05:30"));
  const [refreshing, setRefreshing] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [editingHolding, setEditingHolding] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, kind = "success") => {
    setToast({ id: Date.now(), message, kind });
  }, []);

  const applyPortfolio = useCallback((response) => {
    const next = unpackPortfolio(response);
    setHoldings(next.holdings);
    setHistory(next.history);
    setAllocation(next.allocation);
    setSummary(next.summary);
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

  useEffect(() => {
    const controller = new AbortController();
    portfolioApi.getPortfolio(controller.signal)
      .then(applyPortfolio)
      .catch(() => {});
    return () => controller.abort();
  }, [applyPortfolio]);

  useEffect(() => {
    if (!drawer) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") setDrawer(null);
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
    } catch {
      setLastUpdated(new Date());
      showToast("Live quotes are unavailable, so the latest saved prices are still shown.", "warning");
    } finally {
      setRefreshing(false);
    }
  }

  function handleNavigate(destination) {
    if (destination === "transactions") {
      setDrawer("transactions");
      const controller = new AbortController();
      portfolioApi.getTransactions(controller.signal)
        .then((response) => {
          const rows = response?.transactions ?? response?.data ?? response;
          if (Array.isArray(rows) && rows.length) {
            setTransactions(rows.map((row, index) => ({
              id: firstDefined(row.id, row.transaction_id, index),
              type: firstDefined(row.type, row.transaction_type, row.side, "Buy").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()),
              symbol: firstDefined(row.symbol, row.ticker, "—"),
              date: fullDate(firstDefined(row.date, row.transaction_date, row.traded_at, row.created_at)),
              quantity: firstDefined(row.quantity, row.units),
              amount: Number(firstDefined(row.amount, Number(row.quantity || 0) * Number(row.price || 0), 0)),
              currency: firstDefined(row.currency, "INR"),
            })));
          }
        })
        .catch(() => {});
      return;
    }
    if (destination === "settings") {
      setDrawer("settings");
      return;
    }
    const id = destination === "analytics" ? "analytics-section" : destination === "holdings" ? "holdings-section" : "portfolio-top";
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openAddDrawer() {
    setEditingHolding(null);
    setDrawer("holding");
  }

  function openEditDrawer(holding) {
    setEditingHolding(holding);
    setDrawer("holding");
  }

  async function saveHolding(form) {
    const payload = {
      symbol: form.symbol,
      side: "BUY",
      quantity: form.quantity,
      price: form.averagePrice,
      traded_at: `${form.date}T12:00:00+05:30`,
      name: form.name,
      asset_type: form.assetType || (form.assetClass.includes("ETF") ? "ETF" : "STOCK"),
      currency: form.currency,
    };

    try {
      if (form.id) await portfolioApi.updateHolding(form.id, payload);
      else await portfolioApi.createHolding(payload);
      await reloadPortfolio();
      showToast(form.id ? `${form.symbol} was updated.` : `${form.symbol} was added to your portfolio.`);
    } catch {
      const localHolding = normalizeHolding({ ...form, id: form.id || `local-${Date.now()}` });
      setHoldings((current) => form.id
        ? current.map((item) => item.id === form.id ? localHolding : item)
        : [...current, localHolding]);
      showToast(`${form.symbol} is saved in this preview. Connect the data service to persist it.`, "warning");
    }
    setDrawer(null);
    setEditingHolding(null);
  }

  async function deleteHolding(holding) {
    const confirmed = window.confirm(`Delete ${holding.name} from this portfolio?`);
    if (!confirmed) return;
    try {
      await portfolioApi.deleteHolding(holding.id);
      await reloadPortfolio();
      showToast(`${holding.symbol} was removed.`);
    } catch {
      setHoldings((current) => current.filter((item) => item.id !== holding.id));
      showToast(`${holding.symbol} was removed from this preview.`, "warning");
    }
  }

  return (
    <div className="app-shell">
      <Sidebar onNavigate={handleNavigate} />
      <main className="workspace" id="portfolio-top">
        <Topbar lastUpdated={lastUpdated} refreshing={refreshing} onRefresh={handleRefresh} onAdd={openAddDrawer} />
        <div className="content-grid">
          <div className="portfolio-column">
            <PortfolioSummary summary={summary} currency={currency} onCurrencyChange={setCurrency} />
            <PortfolioChart
              history={history}
              range={range}
              currency={currency}
              benchmark={benchmark}
              onRangeChange={setRange}
              onBenchmarkChange={setBenchmark}
            />
            <HoldingsTable
              holdings={holdings}
              query={query}
              onQueryChange={setQuery}
              onEdit={openEditDrawer}
              onDelete={deleteHolding}
            />
          </div>
          <MetricsRail summary={summary} allocation={allocation} />
        </div>
      </main>

      {drawer === "holding" ? (
        <HoldingDrawer holding={editingHolding} onClose={() => setDrawer(null)} onSave={saveHolding} />
      ) : null}
      {drawer === "transactions" ? (
        <TransactionsDrawer transactions={transactions} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer === "settings" ? (
        <SettingsDrawer
          currency={currency}
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
