export const demoHoldings = [];

export const demoSymbols = [
  {
    symbol: "TCS.NS",
    name: "Tata Consultancy Services",
    market: "NSE",
    assetClass: "Indian Stocks",
    currency: "INR",
    price: 4211.35,
  },
  {
    symbol: "INFY.NS",
    name: "Infosys Limited",
    market: "NSE",
    assetClass: "Indian Stocks",
    currency: "INR",
    price: 1812.8,
  },
  {
    symbol: "JUNIORBEES.NS",
    name: "Nippon India ETF Nifty Next 50 Junior BeES",
    market: "NSE",
    assetClass: "Indian ETFs",
    currency: "INR",
    price: 792.15,
  },
  {
    symbol: "GOLDBEES.NS",
    name: "Nippon India ETF Gold BeES",
    market: "NSE",
    assetClass: "Indian ETFs",
    currency: "INR",
    price: 96.42,
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    market: "NASDAQ",
    assetClass: "US Stocks",
    currency: "USD",
    price: 173.88,
  },
  {
    symbol: "VOO",
    name: "Vanguard S&P 500 ETF",
    market: "NYSE",
    assetClass: "US ETFs",
    currency: "USD",
    price: 594.73,
  },
];

export const demoTransactions = [];

export const demoSummary = {
  totalValue: 0,
  allTimeGain: 0,
  allTimeGainPercent: 0,
  todayChange: 0,
  todayChangePercent: 0,
  xirr: 0,
  cagr: 0,
  trailingPe: null,
  forwardPe: null,
  trailingPeCoverage: 0,
  forwardPeCoverage: 0,
  invested: 0,
  withdrawn: 0,
  cash: 0,
  unrealizedGain: 0,
  realizedGain: 0,
};

export const demoAllocation = [];

export function buildDemoHistory() {
  return [];
}
