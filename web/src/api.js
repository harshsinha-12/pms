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
    const body = await response.text().catch(() => "");
    const contentType = response.headers.get("content-type") || "";
    let message = contentType.includes("text/html") && response.status === 404
      ? "The API route was not found. Check that Vercel is deploying web/vercel.json with Root Directory set to web."
      : body;
    try {
      const parsed = JSON.parse(body);
      const detail = parsed.detail ?? parsed.message ?? parsed.error;
      message = Array.isArray(detail)
        ? detail.map((item) => item.msg ?? item.message ?? String(item)).join(" · ")
        : typeof detail === "string" ? detail : body;
    } catch {
      // Keep a non-JSON response body as the most useful available error.
    }
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

  createTransaction(transaction) {
    return request("/transactions", {
      method: "POST",
      body: JSON.stringify(transaction),
    });
  },

  updateTransaction(id, transaction) {
    return request(`/transactions/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(transaction),
    });
  },

  deleteTransaction(id) {
    return request(`/transactions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};
