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
  gcv_signals?: Record<string, boolean>;
};

type ScanResult = {
  zip: string;
  city: string;
  state: string;
  total_scanned: number;
  total_above_threshold: number;
  min_score_filter: number;
  google_imagery: boolean;
  gcv_available: boolean;
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
  const gcvFlags = Object.entries(p.gcv_signals ?? {}).filter(([, v]) => v);

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
        {(() => {
          const raw = p.estimated_value;
          if (raw === null || raw === undefined) return null;
          // Strip any accidental $ / comma formatting, guard against NaN/Inf
          const n = parseFloat(String(raw).replace(/[$,]/g, "").trim());
          if (!isFinite(n) || n <= 0) return null;
          return (
            <p className="text-lg font-bold text-foreground mt-2">
              Est. ${Math.round(n).toLocaleString()}
            </p>
          );
        })()}

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

        {/* Google Cloud Vision visual signals as badges */}
        {gcvFlags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {gcvFlags.map(([k]) => (
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
            {gcvFlags.map(([k]) => (
              <div key={`gcv-${k}`} className="flex justify-between text-xs">
                <span className="text-muted-foreground capitalize flex items-center gap-1">
                  <Camera className="w-3 h-3 text-orange-400" /> {k.replace(/_/g, " ")}
                </span>
                <span className="text-orange-300 text-[10px]">vision</span>
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
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function useMyLocation() {
    if (!navigator.geolocation) {
      setGpsError("Geolocation is not supported by your browser");
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          // Reverse geocode using a public API
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { "User-Agent": "TolipAITools/1.0" } }
          );
          if (resp.ok) {
            const data = await resp.json();
            const addr = data?.address;
            if (addr?.postcode) setZip(addr.postcode.slice(0, 5));
            if (addr?.city || addr?.town || addr?.village) {
              setCity(addr.city || addr.town || addr.village || "");
            }
            if (addr?.state) {
              // Convert state name to 2-letter abbreviation for common states
              const stateAbbrevMap: Record<string, string> = {
                "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
                "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
                "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS",
                "Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA",
                "Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT",
                "Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM",
                "New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK",
                "Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
                "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT",
                "Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY",
              };
              setState(stateAbbrevMap[addr.state] || addr.state.slice(0, 2).toUpperCase());
            }
          }
        } catch {
          // Reverse geocode failed; GPS coords obtained but can't resolve address
          setGpsError("Location found but could not resolve ZIP/city. Please enter manually.");
        } finally {
          setGpsLoading(false);
        }
      },
      (err) => {
        setGpsLoading(false);
        if (err.code === 1) {
          setGpsError("Location permission denied. Please allow location access in your browser.");
        } else if (err.code === 2) {
          setGpsError("Location unavailable. Please enter your location manually.");
        } else {
          setGpsError("Could not get your location. Please try again or enter manually.");
        }
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  }

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
    const signal = abortRef.current.signal;

    try {
      // Step 1: Start the job — returns immediately with {job_id, status: "queued"}
      const startResp = await fetch(`${API_BASE}/ai/satellite-dfd`, {
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
        signal,
      });
      if (!startResp.ok) {
        const err = await startResp.json().catch(() => ({ detail: startResp.statusText }));
        throw new Error(err.detail || `HTTP ${startResp.status}`);
      }
      const startData = await startResp.json();

      // If the engine returned a full scan result directly (legacy), use it as-is.
      if (startData.results) {
        setResult(startData as ScanResult);
        return;
      }

      // Step 2: Poll /jobs/{job_id} until done or failed (up to 5 min)
      const jobId: string = startData.job_id;
      if (!jobId) throw new Error("Engine did not return a job_id");

      const POLL_INTERVAL_MS = 4_000;
      const POLL_TIMEOUT_MS  = 5 * 60 * 1_000;
      const deadline = Date.now() + POLL_TIMEOUT_MS;

      while (Date.now() < deadline) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");

        const pollResp = await fetch(`${API_BASE}/jobs/${jobId}`, {
          headers: { "X-Tools-Pin": pin || "" },
          signal,
        });
        if (!pollResp.ok) continue; // transient error — keep polling
        const job = await pollResp.json();

        if (job.status === "done" || job.status === "completed") {
          setResult(job.result as ScanResult);
          return;
        }
        if (job.status === "failed") {
          throw new Error(job.error || "Scan failed");
        }
        // still queued/running — keep polling
      }
      throw new Error("Scan timed out after 5 minutes");
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
          ownership duration, plus Google Cloud Vision detections on satellite imagery. GPT-4o
          interprets all signals to produce a final distress score.{" "}
          <code className="text-primary">GOOGLE_MAPS_API_KEY</code> + <code className="text-primary">GOOGLE_CLOUD_API_KEY</code> unlock
          imagery &amp; visual analysis. Higher score = more distressed.
        </AlertDescription>
      </Alert>

      {/* Scan Form */}
      <Card className="border-border">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center justify-between text-base">
            Scan Area
            <button
              type="button"
              onClick={useMyLocation}
              disabled={gpsLoading}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
            >
              {gpsLoading ? (
                <><span className="inline-block w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" /> Locating…</>
              ) : (
                <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/><circle cx="12" cy="12" r="8" strokeDasharray="3 3"/></svg>Use my location</>
              )}
            </button>
          </CardTitle>
          <CardDescription>
            Enter a ZIP code or City + State to scan
            {gpsError && <span className="block text-orange-500 text-xs mt-1">{gpsError}</span>}
          </CardDescription>
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
                    {result.google_imagery ? (result.gcv_available ? "Full" : "Img") : "Off"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {result.google_imagery
                      ? result.gcv_available ? "Vision + Imagery" : "Imagery only"
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
