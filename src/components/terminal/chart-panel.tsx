"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type ISeriesMarkersPrimitiveApi,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Candle, DataSource } from "@/lib/market/types";
import type { AnalysisSnapshot } from "@/lib/ict/types";

/**
 * Candlestick terminal chart with ICT overlays:
 *  - unmitigated FVG zones (dashed gold/emerald pairs)
 *  - order blocks (amber pairs)
 *  - dealing-range equilibrium (dotted)
 *  - sweep + BOS/MSS markers
 */
export function ChartPanel({
  candles,
  analysis,
  source,
  height = 460,
}: {
  candles: Candle[];
  analysis: AnalysisSnapshot | null;
  source: DataSource;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ISeriesMarkersPrimitiveApi<Time> | null>(null);

  // create chart once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b8f98",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.045)" },
        horzLines: { color: "rgba(255,255,255,0.045)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#2fbf71",
      downColor: "#e5484d",
      wickUpColor: "#2fbf71",
      wickDownColor: "#e5484d",
      borderVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
      markersRef.current = null;
    };
  }, []);

  // candles data
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;
    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // ICT overlays
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) {
      series.removePriceLine(line);
    }
    priceLinesRef.current = [];

    if (!analysis) return;

    const addLine = (
      price: number,
      color: string,
      title: string,
      style: LineStyle = LineStyle.Dashed
    ) => {
      priceLinesRef.current.push(
        series.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: style,
          axisLabelVisible: true,
          title,
        })
      );
    };

    for (const z of analysis.fvg.slice(-6)) {
      const color = z.direction === "BULLISH" ? "#2fbf71" : "#e5484d";
      addLine(z.top, color, `FVG ${z.direction === "BULLISH" ? "↑" : "↓"}`);
      addLine(z.bottom, color, "");
    }
    for (const z of analysis.orderBlocks.slice(-4)) {
      addLine(z.top, "#e0a430", `OB ${z.direction === "BULLISH" ? "↑" : "↓"}`, LineStyle.Solid);
      addLine(z.bottom, "#e0a430", "", LineStyle.Solid);
    }
    if (analysis.range) {
      addLine(analysis.range.equilibrium, "#9aa3af", "EQ 50%", LineStyle.Dotted);
    }

    // markers: sweeps + structure events
    const markers: SeriesMarker<Time>[] = [];
    for (const s of analysis.sweeps) {
      markers.push({
        time: s.time as UTCTimestamp,
        position: s.side === "SELL_SIDE" ? "belowBar" : "aboveBar",
        color: s.side === "SELL_SIDE" ? "#2fbf71" : "#e5484d",
        shape: s.side === "SELL_SIDE" ? "arrowUp" : "arrowDown",
        text: "SWEEP",
      });
    }
    for (const e of analysis.structure.events) {
      markers.push({
        time: e.time as UTCTimestamp,
        position: e.direction === "BULLISH" ? "belowBar" : "aboveBar",
        color: e.type === "MSS" ? "#e0a430" : "#7aa2f7",
        shape: "circle",
        text: e.type,
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current?.setMarkers(markers);
  }, [analysis]);

  return (
    <div className="relative">
      <div ref={containerRef} style={{ height }} className="w-full" />
      <div className="absolute left-3 top-2 flex items-center gap-2 text-[11px]">
        <span
          className={`rounded-full px-2 py-0.5 font-semibold tracking-wide ${
            source === "LIVE"
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-amber-500/10 text-amber-400"
          }`}
        >
          {source === "LIVE" ? "LIVE DATA" : "SIMULATED DATA"}
        </span>
        <span className="text-muted-foreground">
          FVG · Order Blocks · Sweeps · BOS/MSS overlaid
        </span>
      </div>
    </div>
  );
}
