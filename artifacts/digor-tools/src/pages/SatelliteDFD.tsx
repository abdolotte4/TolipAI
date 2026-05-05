import { useState, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import {
  Satellite, Search, MapPin, Home, AlertTriangle, CheckCircle2,
  TrendingUp, Calendar, DollarSign, RefreshCw, ExternalLink, Info, Camera,
  Eye, ChevronDown, ChevronUp,
} from "lucide-react";

const API_BASE = "/api/scraper-engine";

type DFDProperty = {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  distress_score: number;
  distress_category: "low" | "medium" | "high" | "severe";
  rationale: string;
  latitude: number | null;
  longitude: number | null;
  satellite_url: string | null;
  streetview_url: string | null;
  zillow_url: string | null;
  estimated_value: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  year_built: number | null;
  source: string;
  signals: Record<string, any>;
  yolo_signals?: Record<string, boolean>;
};

type ScanResult = {
  zip: string;
  city: string;
  state: string;
  total_scanned: number;
  total_above_threshold: number;
  min_score_filter: number;
  google_imagery: boolean;
  yolo_available: boolean;
  results: DFDProperty[];
};

const CATEGORY_STYLES: Record<string, string> = {
  low:    "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  medium: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  high:   "bg-orange-500/15 text-orange-300 border-orange-500/30",
  severe: "bg-red-500/15 text-red-300 border-red-500/30",
};

const SCORE_BAR_COLOR: Record<string, string> = {
  low:    "bg-emerald-500",
  medium: "bg-yellow-500",
  high:   "bg-orange-500",
  severe: "bg-red-500",
};

function ScoreBar({ score, category }: { score: number; category: string }) {
  const color = SCORE_BAR_COLOR[category] ?? "bg-primary";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-bold tabular-nums w-8 text-right">{score}</span>
    </div>
  );
}

function PropertyCard({ p }: { p: DFDProperty }) {
  const [expanded, setExpanded] = useState(false);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});

  const mapsHref = p.latitude && p.longitude
    ? `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`
    : null;

  const heroUrl = p.streetview_url || p.satellite_url;
  const hasImages = !!(p.streetview_url || p.satellite_url);
  const yoloFlags = Object.entries(p.yolo_signals ?? {}).filter(([, v]) => v);

  return (
    <Card className="border-border bg-card hover:border-primary/40 transition-colors overflow-hidden">
      {/* Hero image — street view or satellite */}
      {hasImages && heroUrl && !imgError["hero"] && (
        <div className="relative w-full h-44 bg-muted overflow-hidden">
          <img
            src={heroUrl}
            alt={p.streetview_url ? "Street view" : "Satellite view"}
            className="w-full h-full object-cover"
            onError={() => setImgError(e => ({ ...e, hero: true }))}
          />
          {/* Score badge overlay */}
          <div className="absolute top-2 left-2">
            <Badge
              variant="outline"
              className={`text-[10px] capitalize font-semibold backdrop-blur-sm ${CATEGORY_STYLES[p.distress_category] ?? ""}`}
            >
              {p.distress_category} · {p.distress_score}
            </Badge>
          </div>
          {/* View type tag */}
          <div className="absolute bottom-2 right-2 flex gap-1">
            {p.streetview_url && !imgError["hero"] && (
              <span className="bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded backdrop-blur-sm flex items-center gap-1">
                <Eye className="w-2.5 h-2.5" /> Street View
              </span>
            )}
            {/* Satellite thumbnail (small) if both exist */}
            {p.satellite_url && p.streetview_url && !imgError["sat"] && (
              <img
                src={p.satellite_url}
                alt="Satellite"
                className="w-12 h-9 object-cover rounded border border-white/20"
                onError={() => setImgError(e => ({ ...e, sat: true }))}
              />
            )}
          </div>
        </div>
      )}

      <CardContent className={`p-4 ${!hasImages || imgError["hero"] ? "pt-4" : ""}`}>
        {/* Address + badge (when no image, badge shows here) */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground leading-tight">
              {p.address || "Unknown Address"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {[p.city, p.state, p.zip].filter(Boolean).join(", ")}
            </p>
          </div>
          {(!hasImages || imgError["hero"]) && (
            <Badge variant="outline" className={`text-[10px] capitalize shrink-0 ${CATEGORY_STYLES[p.distress_category] ?? ""}`}>
              {p.distress_category}
            </Badge>
          )}
        </div>

        {/* Score bar (always shown) */}
        {(hasImages && !imgError["hero"]) && (
          <ScoreBar score={p.distress_score} category={p.distress_category} />
        )}

        {/* Estimated value — prominent */}
        {p.estimated_value && (
          <p className="text-lg font-bold text-foreground mt-2">
            Est. ${Number(p.estimated_value).toLocaleString()}
          </p>
        )}

        {/* Property details row */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
          {p.beds && (
            <span className="flex items-center gap-1">
              <Home className="w-3 h-3" />
              {p.beds} bd · {p.baths} ba
            </span>
          )}
          {p.sqft && <span>{Number(p.sqft).toLocaleString()} sqft</span>}
          {p.year_built && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />Built {p.year_built}
            </span>
          )}
        </div>

        {/* YOLO visual signals as badges */}
        {yoloFlags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {yoloFlags.map(([k]) => (
              <Badge key={k} variant="outline"
                className="text-[9px] bg-orange-500/10 text-orange-300 border-orange-500/30 flex items-center gap-0.5">
                <Camera className="w-2.5 h-2.5" />
                {k.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
        )}

        {/* AI rationale */}
        {p.rationale && (
          <p className="text-[11px] text-muted-foreground mt-2 italic leading-relaxed line-clamp-2">
            {p.rationale}
          </p>
        )}

        {/* Action row */}
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/50">
          {p.zillow_url && (
            <a href={p.zillow_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-primary hover:underline">
              <ExternalLink className="w-3 h-3" />View Listing
            </a>
          )}
          {mapsHref && (
            <a href={mapsHref} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <Satellite className="w-3 h-3" />Maps
            </a>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground ml-auto"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Less" : "All signals"}
          </button>
        </div>

        {/* Expanded signals */}
        {expanded && (
          <div className="mt-3 space-y-1">
            {Object.entries(p.signals || {}).map(([k, v]) =>
              v !== null && v !== false && v !== 0 ? (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                  <span className="text-foreground font-mono text-right">{String(v)}</span>
                </div>
              ) : null
            )}
            {yoloFlags.map(([k]) => (
              <div key={`yolo-${k}`} className="flex justify-between text-xs">
                <span className="text-muted-foreground capitalize flex items-center gap-1">
                  <Camera className="w-3 h-3 text-orange-400" /> {k.replace(/_/g, " ")}
                </span>
                <span className="text-orange-300 text-[10px]">visual</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SatelliteDFD() {
  const { pin } = useAuth();
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [minScore, setMinScore] = useState(30);
  const [maxResults, setMaxResults] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function runScan() {
    if (!zip && !(city && state)) {
      setError("Enter a ZIP code or City + State");
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const resp = await fetch(`${API_BASE}/ai/satellite-dfd`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tools-Pin": pin || "",
        },
        body: JSON.stringify({
          zip: zip || "",
          city: city || "",
          state: state || "",
          min_score: minScore,
          max_results: maxResults,
          use_ai_scoring: true,
        }),
        signal: abortRef.current.signal,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      const data: ScanResult = await resp.json();
      setResult(data);
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message || "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  const results = result?.results ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
            <Satellite className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">SkyDrive AI</h1>
          <Badge variant="outline" className="text-[10px] text-primary border-primary/40">BETA</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          AI-powered virtual driving-for-dollars — scores properties 0–100 based on distress signals.
          No physical driving required.
        </p>
      </div>

      <Alert className="border-primary/20 bg-primary/5">
        <Info className="w-4 h-4 text-primary" />
        <AlertDescription className="text-xs text-muted-foreground">
          Scores fuse property age, days listed, FSBO status, price reductions, equity, tax status,
          ownership duration, plus YOLOv8 visual detections on street-view imagery.{" "}
          <code className="text-primary">GOOGLE_MAPS_API_KEY</code> unlocks satellite &amp; street
          view thumbnails. Higher score = more distressed.
        </AlertDescription>
      </Alert>

      {/* Scan Form */}
      <Card className="border-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Scan Area</CardTitle>
          <CardDescription>Enter a ZIP code or City + State to scan</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="zip" className="text-xs">ZIP Code</Label>
              <Input id="zip" placeholder="e.g. 44105" value={zip}
                onChange={e => setZip(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runScan()}
                className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city" className="text-xs">City</Label>
              <Input id="city" placeholder="e.g. Cleveland" value={city}
                onChange={e => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="state" className="text-xs">State (2-letter)</Label>
              <Input id="state" placeholder="e.g. OH" value={state}
                onChange={e => setState(e.target.value.toUpperCase())}
                maxLength={2} className="uppercase font-mono" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Min Distress Score</Label>
                <span className="text-xs font-mono text-primary">{minScore}/100</span>
              </div>
              <Slider value={[minScore]} min={0} max={90} step={5}
                onValueChange={([v]) => setMinScore(v)} />
              <p className="text-[10px] text-muted-foreground">
                0 = all · 50 = medium+ distress · 70 = high/severe only
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Max Results</Label>
                <span className="text-xs font-mono text-primary">{maxResults}</span>
              </div>
              <Slider value={[maxResults]} min={10} max={200} step={10}
                onValueChange={([v]) => setMaxResults(v)} />
            </div>
          </div>

          <Button onClick={runScan} disabled={loading} className="w-full">
            {loading ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Scanning area…</>
            ) : (
              <><Satellite className="w-4 h-4 mr-2" />Run SkyDrive Scan</>
            )}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Stats Bar */}
      {result && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Properties Scanned", value: result.total_scanned, icon: Search },
            { label: `Score ≥ ${result.min_score_filter}`, value: result.total_above_threshold, icon: TrendingUp },
            { label: "Returned", value: results.length, icon: CheckCircle2 },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label} className="border-border">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xl font-bold">{value}</p>
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <Card className="border-border">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xl font-bold">
                    {result.google_imagery ? (result.yolo_available ? "Full" : "Img") : "Off"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {result.google_imagery
                      ? result.yolo_available ? "YOLO + Imagery" : "Imagery only"
                      : "No Google key"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Results grid */}
      {results.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
            {results.length} Properties — sorted by distress score
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {results.map((p, i) => (
              <PropertyCard key={`${p.address}-${i}`} p={p} />
            ))}
          </div>
        </div>
      )}

      {result && results.length === 0 && (
        <Alert>
          <MapPin className="w-4 h-4" />
          <AlertDescription>
            No properties met the minimum distress score of {minScore} in this area.
            Try lowering the threshold or scanning a different ZIP.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
