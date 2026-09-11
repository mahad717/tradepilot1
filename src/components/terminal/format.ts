// Formatting helpers for the trading terminal (client-safe).

export function fmtPrice(n: number, digits = 2): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
}

export function fmtDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function sourceBadge(source: "LIVE" | "SIMULATED"): string {
  return source === "LIVE" ? "LIVE" : "SIMULATED";
}
