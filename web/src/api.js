const API_ROOT = "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Request failed (${response.status})`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export const portfolioApi = {
  getPortfolio(signal) {
    return request("/portfolio", { signal });
  },

  getTransactions(signal) {
    return request("/transactions", { signal });
  },

  refresh() {
    return request("/refresh", { method: "POST" });
  },

  searchSymbols(query, signal) {
    return request(`/instruments/search?q=${encodeURIComponent(query)}`, { signal });
  },

  createHolding(holding) {
    return request("/transactions", {
      method: "POST",
      body: JSON.stringify(holding),
    });
  },

  updateHolding(id, holding) {
    return request(`/transactions/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(holding),
    });
  },

  deleteHolding(id) {
    return request(`/transactions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};
