/**
 * USChoroplethMap — Interactive D3-powered US state choropleth map
 *
 * Architecture:
 *  • D3 + TopoJSON renders a SVG Albers USA projection
 *  • Hover tooltip shows IDR threshold, law status, and compliance tier
 *  • Color scale: green (full law) → amber (partial) → slate (NSA only) → red (no protection)
 *  • Apache Sedona lakehouse integration: exports spatial query results as GeoJSON
 *    via the /api/trpc/lakehouse.spatialQuery endpoint (server-side Sedona via JDBC)
 *
 * Data flow:
 *  STATE_LAWS (static dataset) → D3 color scale → SVG path fill
 *  Hover → tooltip with threshold, tier, law name
 *  Click → parent onStateSelect callback
 */

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";

// Minimal TopoJSON types — use any for internal geometry to avoid strict GeoJSON conflicts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Topology = any;
import { Badge } from "@/components/ui/badge";

export type StateLawData = {
  code: string;
  name: string;
  hasLaw: boolean;
  lawName?: string;
  idrThreshold?: number;
  effectiveDate?: string;
  tier: "full" | "partial" | "nsa_only" | "none";
  complianceStatus: "compliant" | "at_risk" | "non_compliant" | "unknown";
};

type TooltipState = {
  x: number;
  y: number;
  state: StateLawData | null;
  visible: boolean;
};

type Props = {
  stateLaws: StateLawData[];
  onStateSelect?: (state: StateLawData) => void;
  selectedState?: string | null;
  height?: number;
  showLakehouseOverlay?: boolean;
};

// Color scale by tier
const TIER_COLORS: Record<StateLawData["tier"], string> = {
  full: "#16a34a",       // green-600
  partial: "#d97706",    // amber-600
  nsa_only: "#64748b",   // slate-500
  none: "#dc2626",       // red-600
};

const TIER_LABELS: Record<StateLawData["tier"], string> = {
  full: "Full State Law",
  partial: "Partial Protections",
  nsa_only: "NSA Only",
  none: "No State Protection",
};

const COMPLIANCE_COLORS: Record<StateLawData["complianceStatus"], string> = {
  compliant: "#bbf7d0",
  at_risk: "#fef08a",
  non_compliant: "#fecaca",
  unknown: "#e2e8f0",
};

export default function USChoroplethMap({
  stateLaws,
  onStateSelect,
  selectedState,
  height = 480,
  showLakehouseOverlay = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({ x: 0, y: 0, state: null, visible: false });
  const [dimensions, setDimensions] = useState({ width: 960, height });
  const [topoData, setTopoData] = useState<Topology | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lakehouseData, setLakehouseData] = useState<Record<string, number>>({});

  // Build lookup map from state code → law data
  const lawMap = Object.fromEntries(stateLaws.map(s => [s.code, s]));

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width } = entries[0].contentRect;
      if (width > 0) setDimensions({ width, height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [height]);

  // Load US TopoJSON from CDN (unpkg — works in any environment)
  useEffect(() => {
    fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json")
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((topo: Topology) => setTopoData(topo))
      .catch(err => {
        console.error("Failed to load US TopoJSON:", err);
        setLoadError("Could not load map data. Check your internet connection.");
      });
  }, []);

  // Optional: fetch Apache Sedona lakehouse spatial aggregation
  useEffect(() => {
    if (!showLakehouseOverlay) return;
    fetch("/api/trpc/lakehouse.spatialQuery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: { queryType: "dispute_density_by_state" } }),
    })
      .then(r => r.json())
      .then(data => {
        if (data?.result?.data?.json) {
          const rows: Array<{ stateCode: string; count: number }> = data.result.data.json;
          setLakehouseData(Object.fromEntries(rows.map(r => [r.stateCode, r.count])));
        }
      })
      .catch(() => {}); // Sedona overlay is optional — fail silently
  }, [showLakehouseOverlay]);

  // D3 render
  useEffect(() => {
    if (!svgRef.current || !topoData) return;

    const { width } = dimensions;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const projection = d3.geoAlbersUsa()
      .scale(width * 1.25)
      .translate([width / 2, height / 2]);

    const path = d3.geoPath().projection(projection);

    // Cast TopoJSON to get states feature collection
    const states = feature(
      topoData,
      topoData.objects.states
    ) as unknown as FeatureCollection<Geometry, { id?: string }>;

    // FIPS → state abbreviation lookup (standard mapping)
    const FIPS_TO_CODE: Record<string, string> = {
      "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT",
      "10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL",
      "18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD",
      "25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE",
      "32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND",
      "39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD",
      "47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV",
      "55":"WI","56":"WY",
    };

    const g = svg.append("g");

    // State paths
    g.selectAll<SVGPathElement, (typeof states.features)[number]>("path.state")
      .data(states.features)
      .join("path")
      .attr("class", "state")
      .attr("d", path as any)
      .attr("fill", d => {
        const code = FIPS_TO_CODE[(d as any).id as string] ?? "";
        const law = lawMap[code];
        if (!law) return "#e2e8f0";
        // If lakehouse overlay active, blend dispute density
        if (showLakehouseOverlay && lakehouseData[code] !== undefined) {
          const maxCount = Math.max(...Object.values(lakehouseData), 1);
          const intensity = lakehouseData[code] / maxCount;
          return d3.interpolateBlues(0.2 + intensity * 0.7);
        }
        return TIER_COLORS[law.tier] ?? "#e2e8f0";
      })
      .attr("stroke", d => {
        const code = FIPS_TO_CODE[(d as any).id as string] ?? "";
        return selectedState === code ? "#1e40af" : "#fff";
      })
      .attr("stroke-width", d => {
        const code = FIPS_TO_CODE[(d as any).id as string] ?? "";
        return selectedState === code ? 2.5 : 0.75;
      })
      .attr("opacity", d => {
        const code = FIPS_TO_CODE[(d as any).id as string] ?? "";
        return selectedState && selectedState !== code ? 0.65 : 1;
      })
      .style("cursor", "pointer")
      .on("mouseenter", function (event: MouseEvent, d: any) {
        const code = FIPS_TO_CODE[(d as any).id as string] ?? "";
        const law = lawMap[code];
        if (!law) return;
        d3.select(this).attr("stroke", "#1e40af").attr("stroke-width", 2);
        const rect = svgRef.current!.getBoundingClientRect();
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          state: law,
          visible: true,
        });
      })
      .on("mousemove", function (event: MouseEvent) {
        const rect = svgRef.current!.getBoundingClientRect();
        setTooltip(prev => ({ ...prev, x: event.clientX - rect.left, y: event.clientY - rect.top }));
      })
      .on("mouseleave", function (_event: MouseEvent, d: any) {
        const code = FIPS_TO_CODE[(d as any).id as string] ?? "";
        d3.select(this)
          .attr("stroke", selectedState === code ? "#1e40af" : "#fff")
          .attr("stroke-width", selectedState === code ? 2.5 : 0.75);
        setTooltip(prev => ({ ...prev, visible: false }));
      })
      .on("click", (_event: MouseEvent, d: any) => {
        const code = FIPS_TO_CODE[(d as any).id as string] ?? "";
        const law = lawMap[code];
        if (law && onStateSelect) onStateSelect(law);
      });

    // State abbreviation labels (only for larger states)
    g.selectAll<SVGTextElement, (typeof states.features)[number]>("text.label")
      .data(states.features)
      .join("text")
      .attr("class", "label")
      .attr("transform", d => {
        const centroid = path.centroid(d as any);
        return centroid ? `translate(${centroid})` : "";
      })
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", Math.max(7, width / 140))
      .attr("font-family", "system-ui, sans-serif")
      .attr("fill", d => {
        const code = FIPS_TO_CODE[(d as any).id as string] ?? "";
        const law = lawMap[code];
        if (!law) return "#64748b";
        return law.tier === "full" ? "#fff" : law.tier === "none" ? "#fff" : "#1e293b";
      })
      .attr("pointer-events", "none")
      .text(d => FIPS_TO_CODE[(d as any).id as string] ?? "");

  }, [topoData, dimensions, lawMap, selectedState, showLakehouseOverlay, lakehouseData]);

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-48 bg-slate-50 rounded-xl border border-slate-200 text-sm text-slate-500">
        {loadError}
      </div>
    );
  }

  if (!topoData) {
    return (
      <div className="flex items-center justify-center h-48 bg-slate-50 rounded-xl border border-slate-200">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="animate-spin text-lg">⧗</span>
          Loading map data…
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full select-none" style={{ height }}>
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={height}
        className="w-full"
        style={{ display: "block" }}
      />

      {/* Hover Tooltip */}
      {tooltip.visible && tooltip.state && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y - 10,
            transform: tooltip.x > dimensions.width * 0.7 ? "translateX(-110%)" : undefined,
          }}
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl p-3 min-w-[220px] text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-sm text-slate-800">{tooltip.state.name}</span>
              <span className="text-slate-400 font-mono">{tooltip.state.code}</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Protection Tier</span>
                <span
                  className="px-2 py-0.5 rounded-full text-white font-medium text-xs"
                  style={{ backgroundColor: TIER_COLORS[tooltip.state.tier] }}
                >
                  {TIER_LABELS[tooltip.state.tier]}
                </span>
              </div>
              {tooltip.state.lawName && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-slate-500 shrink-0">Law</span>
                  <span className="text-slate-700 text-right font-medium">{tooltip.state.lawName}</span>
                </div>
              )}
              {tooltip.state.idrThreshold !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">IDR Threshold</span>
                  <span className="font-semibold text-slate-800">
                    ${tooltip.state.idrThreshold.toLocaleString()}
                  </span>
                </div>
              )}
              {tooltip.state.effectiveDate && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Effective</span>
                  <span className="text-slate-700">{tooltip.state.effectiveDate}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                <span className="text-slate-500">Compliance</span>
                <span
                  className="px-2 py-0.5 rounded text-xs font-medium"
                  style={{ backgroundColor: COMPLIANCE_COLORS[tooltip.state.complianceStatus] }}
                >
                  {tooltip.state.complianceStatus.replace("_", " ")}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm border border-slate-200 rounded-lg p-2 text-xs space-y-1">
        {Object.entries(TIER_LABELS).map(([tier, label]) => (
          <div key={tier} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-sm shrink-0"
              style={{ backgroundColor: TIER_COLORS[tier as StateLawData["tier"]] }}
            />
            <span className="text-slate-600">{label}</span>
          </div>
        ))}
        {showLakehouseOverlay && (
          <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100">
            <div className="w-3 h-3 rounded-sm bg-blue-400 shrink-0" />
            <span className="text-slate-600">Dispute Density (Sedona)</span>
          </div>
        )}
      </div>

      {/* Apache Sedona badge */}
      {showLakehouseOverlay && (
        <div className="absolute top-3 right-3">
          <Badge variant="outline" className="text-xs bg-white/90 backdrop-blur-sm border-blue-200 text-blue-700">
            ⚡ Apache Sedona Lakehouse
          </Badge>
        </div>
      )}
    </div>
  );
}
