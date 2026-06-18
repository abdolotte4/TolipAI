import { useState, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  MapPin, Search, Building2, Download, Loader2,
  AlertTriangle, AlertCircle, CheckCircle2, Globe, Phone, Info, Home,
  PlayCircle, Square, Zap, SkipForward
} from "lucide-react";


// ─── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_MAPS_KEYWORDS = [
  "we buy houses",
  "home buyers",
  "house buyers",
  "real estate investor",
  "real estate wholesaler",
  "real estate agent",
  "real estate broker",
  "cash home buyers",
  "sell my house fast",
  "property management company",
  "real estate investment company",
  "motivated seller buyers",
];

const GOOGLE_SEARCH_KEYWORDS = [
  "we buy houses company",
  "real estate investment firm",
  "home buying company",
  "cash for houses company",
  "real estate wholesaling company",
  "house flipping company",
  "real estate investor group",
  "motivated seller specialist",
];

const US_STATES = [
  "Alabama,AL", "Alaska,AK", "Arizona,AZ", "Arkansas,AR", "California,CA",
  "Colorado,CO", "Connecticut,CT", "Delaware,DE", "Florida,FL", "Georgia,GA",
  "Hawaii,HI", "Idaho,ID", "Illinois,IL", "Indiana,IN", "Iowa,IA",
  "Kansas,KS", "Kentucky,KY", "Louisiana,LA", "Maine,ME", "Maryland,MD",
  "Massachusetts,MA", "Michigan,MI", "Minnesota,MN", "Mississippi,MS", "Missouri,MO",
  "Montana,MT", "Nebraska,NE", "Nevada,NV", "New Hampshire,NH", "New Jersey,NJ",
  "New Mexico,NM", "New York,NY", "North Carolina,NC", "North Dakota,ND", "Ohio,OH",
  "Oklahoma,OK", "Oregon,OR", "Pennsylvania,PA", "Rhode Island,RI", "South Carolina,SC",
  "South Dakota,SD", "Tennessee,TN", "Texas,TX", "Utah,UT", "Vermont,VT",
  "Virginia,VA", "Washington,WA", "West Virginia,WV", "Wisconsin,WI", "Wyoming,WY",
];

const TOP_METROS: { city: string; state: string }[] = [
  // Alabama
  { city: "Birmingham", state: "Alabama" }, { city: "Montgomery", state: "Alabama" }, { city: "Huntsville", state: "Alabama" },
  // Alaska
  { city: "Anchorage", state: "Alaska" },
  // Arizona
  { city: "Phoenix", state: "Arizona" }, { city: "Tucson", state: "Arizona" }, { city: "Mesa", state: "Arizona" }, { city: "Scottsdale", state: "Arizona" }, { city: "Chandler", state: "Arizona" },
  // Arkansas
  { city: "Little Rock", state: "Arkansas" }, { city: "Fort Smith", state: "Arkansas" },
  // California
  { city: "Los Angeles", state: "California" }, { city: "San Diego", state: "California" }, { city: "San Jose", state: "California" }, { city: "San Francisco", state: "California" }, { city: "Fresno", state: "California" }, { city: "Sacramento", state: "California" }, { city: "Long Beach", state: "California" }, { city: "Oakland", state: "California" }, { city: "Riverside", state: "California" },
  // Colorado
  { city: "Denver", state: "Colorado" }, { city: "Colorado Springs", state: "Colorado" }, { city: "Aurora", state: "Colorado" },
  // Connecticut
  { city: "Bridgeport", state: "Connecticut" }, { city: "New Haven", state: "Connecticut" }, { city: "Hartford", state: "Connecticut" },
  // Delaware
  { city: "Wilmington", state: "Delaware" },
  // Florida
  { city: "Jacksonville", state: "Florida" }, { city: "Miami", state: "Florida" }, { city: "Tampa", state: "Florida" }, { city: "Orlando", state: "Florida" }, { city: "Fort Lauderdale", state: "Florida" }, { city: "Hialeah", state: "Florida" }, { city: "Cape Coral", state: "Florida" }, { city: "Tallahassee", state: "Florida" }, { city: "Sarasota", state: "Florida" }, { city: "West Palm Beach", state: "Florida" },
  // Georgia
  { city: "Atlanta", state: "Georgia" }, { city: "Columbus", state: "Georgia" }, { city: "Augusta", state: "Georgia" }, { city: "Savannah", state: "Georgia" },
  // Hawaii
  { city: "Honolulu", state: "Hawaii" },
  // Idaho
  { city: "Boise", state: "Idaho" }, { city: "Nampa", state: "Idaho" },
  // Illinois
  { city: "Chicago", state: "Illinois" }, { city: "Aurora", state: "Illinois" }, { city: "Rockford", state: "Illinois" }, { city: "Naperville", state: "Illinois" },
  // Indiana
  { city: "Indianapolis", state: "Indiana" }, { city: "Fort Wayne", state: "Indiana" }, { city: "Evansville", state: "Indiana" },
  // Iowa
  { city: "Des Moines", state: "Iowa" }, { city: "Cedar Rapids", state: "Iowa" },
  // Kansas
  { city: "Wichita", state: "Kansas" }, { city: "Overland Park", state: "Kansas" }, { city: "Kansas City", state: "Kansas" },
  // Kentucky
  { city: "Louisville", state: "Kentucky" }, { city: "Lexington", state: "Kentucky" },
  // Louisiana
  { city: "New Orleans", state: "Louisiana" }, { city: "Baton Rouge", state: "Louisiana" }, { city: "Shreveport", state: "Louisiana" },
  // Maine
  { city: "Portland", state: "Maine" },
  // Maryland
  { city: "Baltimore", state: "Maryland" },
  // Massachusetts
  { city: "Boston", state: "Massachusetts" }, { city: "Worcester", state: "Massachusetts" }, { city: "Springfield", state: "Massachusetts" },
  // Michigan
  { city: "Detroit", state: "Michigan" }, { city: "Grand Rapids", state: "Michigan" }, { city: "Warren", state: "Michigan" }, { city: "Lansing", state: "Michigan" },
  // Minnesota
  { city: "Minneapolis", state: "Minnesota" }, { city: "Saint Paul", state: "Minnesota" }, { city: "Rochester", state: "Minnesota" },
  // Mississippi
  { city: "Jackson", state: "Mississippi" }, { city: "Gulfport", state: "Mississippi" },
  // Missouri
  { city: "Kansas City", state: "Missouri" }, { city: "Saint Louis", state: "Missouri" }, { city: "Springfield", state: "Missouri" },
  // Montana
  { city: "Billings", state: "Montana" }, { city: "Missoula", state: "Montana" },
  // Nebraska
  { city: "Omaha", state: "Nebraska" }, { city: "Lincoln", state: "Nebraska" },
  // Nevada
  { city: "Las Vegas", state: "Nevada" }, { city: "Henderson", state: "Nevada" }, { city: "Reno", state: "Nevada" },
  // New Hampshire
  { city: "Manchester", state: "New Hampshire" }, { city: "Nashua", state: "New Hampshire" },
  // New Jersey
  { city: "Newark", state: "New Jersey" }, { city: "Jersey City", state: "New Jersey" }, { city: "Paterson", state: "New Jersey" },
  // New Mexico
  { city: "Albuquerque", state: "New Mexico" }, { city: "Santa Fe", state: "New Mexico" },
  // New York
  { city: "New York", state: "New York" }, { city: "Buffalo", state: "New York" }, { city: "Rochester", state: "New York" }, { city: "Yonkers", state: "New York" }, { city: "Syracuse", state: "New York" },
  // North Carolina
  { city: "Charlotte", state: "North Carolina" }, { city: "Raleigh", state: "North Carolina" }, { city: "Greensboro", state: "North Carolina" }, { city: "Durham", state: "North Carolina" }, { city: "Winston-Salem", state: "North Carolina" }, { city: "Fayetteville", state: "North Carolina" },
  // North Dakota
  { city: "Fargo", state: "North Dakota" }, { city: "Bismarck", state: "North Dakota" },
  // Ohio
  { city: "Columbus", state: "Ohio" }, { city: "Cleveland", state: "Ohio" }, { city: "Cincinnati", state: "Ohio" }, { city: "Toledo", state: "Ohio" }, { city: "Akron", state: "Ohio" },
  // Oklahoma
  { city: "Oklahoma City", state: "Oklahoma" }, { city: "Tulsa", state: "Oklahoma" }, { city: "Norman", state: "Oklahoma" }, { city: "Broken Arrow", state: "Oklahoma" },
  // Oregon
  { city: "Portland", state: "Oregon" }, { city: "Salem", state: "Oregon" }, { city: "Eugene", state: "Oregon" },
  // Pennsylvania
  { city: "Philadelphia", state: "Pennsylvania" }, { city: "Pittsburgh", state: "Pennsylvania" }, { city: "Allentown", state: "Pennsylvania" },
  // Rhode Island
  { city: "Providence", state: "Rhode Island" },
  // South Carolina
  { city: "Charleston", state: "South Carolina" }, { city: "Columbia", state: "South Carolina" }, { city: "North Charleston", state: "South Carolina" },
  // South Dakota
  { city: "Sioux Falls", state: "South Dakota" }, { city: "Rapid City", state: "South Dakota" },
  // Tennessee
  { city: "Nashville", state: "Tennessee" }, { city: "Memphis", state: "Tennessee" }, { city: "Knoxville", state: "Tennessee" }, { city: "Chattanooga", state: "Tennessee" },
  // Texas
  { city: "Houston", state: "Texas" }, { city: "San Antonio", state: "Texas" }, { city: "Dallas", state: "Texas" }, { city: "Austin", state: "Texas" }, { city: "Fort Worth", state: "Texas" }, { city: "El Paso", state: "Texas" }, { city: "Arlington", state: "Texas" }, { city: "Corpus Christi", state: "Texas" }, { city: "Plano", state: "Texas" }, { city: "Laredo", state: "Texas" }, { city: "Lubbock", state: "Texas" }, { city: "Garland", state: "Texas" }, { city: "Irving", state: "Texas" }, { city: "Amarillo", state: "Texas" },
  // Utah
  { city: "Salt Lake City", state: "Utah" }, { city: "West Valley City", state: "Utah" }, { city: "Provo", state: "Utah" }, { city: "Ogden", state: "Utah" },
  // Vermont
  { city: "Burlington", state: "Vermont" },
  // Virginia
  { city: "Virginia Beach", state: "Virginia" }, { city: "Norfolk", state: "Virginia" }, { city: "Chesapeake", state: "Virginia" }, { city: "Richmond", state: "Virginia" }, { city: "Arlington", state: "Virginia" },
  // Washington
  { city: "Seattle", state: "Washington" }, { city: "Spokane", state: "Washington" }, { city: "Tacoma", state: "Washington" }, { city: "Vancouver", state: "Washington" },
  // West Virginia
  { city: "Charleston", state: "West Virginia" }, { city: "Huntington", state: "West Virginia" },
  // Wisconsin
  { city: "Milwaukee", state: "Wisconsin" }, { city: "Madison", state: "Wisconsin" }, { city: "Green Bay", state: "Wisconsin" },
  // Wyoming
  { city: "Cheyenne", state: "Wyoming" }, { city: "Casper", state: "Wyoming" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScrapeResult {
  name: string;
  [key: string]: any;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KeywordPicker({
  options, selected, onChange, label,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  const toggle = (kw: string) =>
    onChange(selected.includes(kw) ? selected.filter(x => x !== kw) : [...selected, kw]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="flex gap-2">
          <button onClick={() => onChange(options)} className="text-xs text-primary hover:underline">All</button>
          <span className="text-muted-foreground text-xs">·</span>
          <button onClick={() => onChange([])} className="text-xs text-muted-foreground hover:underline">None</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto p-1">
        {options.map(kw => (
          <div key={kw} className="flex items-center gap-2 cursor-pointer" onClick={() => toggle(kw)}>
            <Checkbox checked={selected.includes(kw)} onCheckedChange={() => toggle(kw)} />
            <span className="text-xs text-muted-foreground leading-tight">{kw}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LocationPicker({
  selected, onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [tab, setTab] = useState<"cities" | "states">("cities");
  const [search, setSearch] = useState("");
  const [customInput, setCustomInput] = useState("");

  const toggle = (loc: string) =>
    onChange(selected.includes(loc) ? selected.filter(x => x !== loc) : [...selected, loc]);

  const addCustom = () => {
    const val = customInput.trim();
    if (!val || selected.includes(val)) return;
    onChange([...selected, val]);
    setCustomInput("");
  };

  const cityOptions = TOP_METROS
    .map(m => `${m.city}, ${m.state}`)
    .filter(loc => !search || loc.toLowerCase().includes(search.toLowerCase()));

  const stateOptions = US_STATES
    .map(s => { const [name] = s.split(","); return name.trim(); })
    .filter(s => !search || s.toLowerCase().includes(search.toLowerCase()));

  const visibleOptions = tab === "cities" ? cityOptions : stateOptions;

  return (
    <div>
      <Label className="text-sm font-medium mb-2 block">Locations</Label>

      {/* Custom location input */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          placeholder="Type any city, state, or zip… press Enter"
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
          className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-background/50 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          onClick={addCustom}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >Add</button>
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3 p-2 rounded-lg bg-muted/30 border border-border">
          {selected.map(loc => (
            <span key={loc} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-xs font-medium">
              {loc}
              <button onClick={() => onChange(selected.filter(x => x !== loc))} className="hover:text-destructive ml-0.5">×</button>
            </span>
          ))}
          <button onClick={() => onChange([])} className="text-xs text-muted-foreground hover:text-destructive ml-auto">Clear all</button>
        </div>
      )}

      {/* Tabs + search */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          <button
            className={`px-3 py-1.5 transition-colors ${tab === "cities" ? "bg-primary text-primary-foreground" : "hover:bg-muted/50"}`}
            onClick={() => { setTab("cities"); setSearch(""); }}
          >
            Cities ({TOP_METROS.length})
          </button>
          <button
            className={`px-3 py-1.5 transition-colors ${tab === "states" ? "bg-primary text-primary-foreground" : "hover:bg-muted/50"}`}
            onClick={() => { setTab("states"); setSearch(""); }}
          >
            All 50 States
          </button>
        </div>
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-background/50 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <button onClick={() => onChange([...new Set([...selected, ...visibleOptions])])} className="text-xs text-primary hover:underline whitespace-nowrap">
          {search ? "Add filtered" : tab === "states" ? "All 50" : "All cities"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto p-1 rounded-lg border border-border bg-background/30">
        {visibleOptions.length === 0 && (
          <p className="col-span-2 text-center text-xs text-muted-foreground py-4">No matches. Use the input above to add a custom location.</p>
        )}
        {visibleOptions.map(loc => (
          <div key={loc} className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 rounded px-1 py-0.5" onClick={() => toggle(loc)}>
            <Checkbox checked={selected.includes(loc)} onCheckedChange={() => toggle(loc)} />
            <span className="text-xs text-muted-foreground leading-tight truncate">{loc}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{selected.length} location{selected.length !== 1 ? "s" : ""} selected</p>
    </div>
  );
}

function ResultsTable({ results }: { results: ScrapeResult[] }) {
  if (!results.length) return null;
  const cols = Object.keys(results[0]);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            {cols.map(c => (
              <th key={c} className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={i} className="border-t border-border hover:bg-muted/20 transition-colors">
              {cols.map(c => (
                <td key={c} className="px-3 py-2 text-foreground max-w-[200px] truncate" title={String(r[c] ?? "")}>
                  {r[c] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LeadScraper() {
  const { pin } = useAuth();

  // Google Maps tab
  const [mapsKeywords, setMapsKeywords] = useState<string[]>(["we buy houses", "home buyers"]);
  const [mapsLocations, setMapsLocations] = useState<string[]>(["Tulsa, Oklahoma", "Dallas, Texas"]);
  const [mapsMax, setMapsMax] = useState("50");
  const [mapsLoading, setMapsLoading] = useState(false);
  const [mapsResults, setMapsResults] = useState<ScrapeResult[]>([]);
  const [mapsError, setMapsError] = useState("");

  // Google Search tab
  const [searchKeywords, setSearchKeywords] = useState<string[]>(["we buy houses company"]);
  const [searchLocations, setSearchLocations] = useState<string[]>(["Tulsa, Oklahoma"]);
  const [searchMax, setSearchMax] = useState("50");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ScrapeResult[]>([]);
  const [searchError, setSearchError] = useState("");

  // NAR tab
  const [narState, setNarState] = useState("VA");
  const [narCity, setNarCity] = useState("");
  const [narMax, setNarMax] = useState("30");
  const [narLoading, setNarLoading] = useState(false);
  const [narResults, setNarResults] = useState<ScrapeResult[]>([]);
  const [narError, setNarError] = useState("");

  // Zillow tab
  const [zillowMode, setZillowMode] = useState<"agents" | "listings" | "fsbo">("agents");
  const [zillowCity, setZillowCity] = useState("Tulsa");
  const [zillowState, setZillowState] = useState("OK");
  const [zillowMax, setZillowMax] = useState("20");
  const [zillowLoading, setZillowLoading] = useState(false);
  const [zillowResults, setZillowResults] = useState<ScrapeResult[]>([]);
  const [zillowError, setZillowError] = useState("");
  const [zillowWarning, setZillowWarning] = useState("");

  // Bulk Runner tab
  const [bulkTool, setBulkTool] = useState<"google-maps" | "google-search">("google-maps");
  const [bulkKeywords, setBulkKeywords] = useState<string[]>(["we buy houses", "home buyers", "real estate investor"]);
  const [bulkLocations, setBulkLocations] = useState<string[]>(TOP_METROS.slice(0, 10).map(m => `${m.city}, ${m.state}`));
  const [bulkMaxPerCombo, setBulkMaxPerCombo] = useState("20");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkDone, setBulkDone] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkCompleted, setBulkCompleted] = useState(0);
  const [bulkSkipped, setBulkSkipped] = useState(0);
  const [bulkCurrentCombo, setBulkCurrentCombo] = useState("");
  const [bulkResults, setBulkResults] = useState<ScrapeResult[]>([]);
  const [bulkLog, setBulkLog] = useState<string[]>([]);
  const [bulkApiWarning, setBulkApiWarning] = useState("");
  const bulkAbortRef = useRef(false);

  const headers = { "X-Tools-Pin": pin || "", "Content-Type": "application/json" };

  function downloadCSV(csv: string, filename: string) {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Google Maps scrape ──────────────────────────────────────────────────
  const runMapsSearch = async () => {
    if (!mapsKeywords.length || !mapsLocations.length) {
      setMapsError("Select at least one keyword and one location.");
      return;
    }
    setMapsLoading(true); setMapsError(""); setMapsResults([]);
    try {
      const res = await fetch(`/api/scraper/google-maps`, {
        method: "POST", headers,
        body: JSON.stringify({ keywords: mapsKeywords, locations: mapsLocations, maxResults: Number(mapsMax) }),
      });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("tolipai_tools_pin");
        window.location.href = "/";
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scrape failed");
      setMapsResults(data.results || []);
      if (data.creditExhausted) {
        setMapsError(`ScraperAPI fallback credits exhausted for this month — results below are from ScrapingBee. Configure GOOGLE_MAPS_API_KEY in the engine environment for unlimited primary results.`);
      } else if (!data.count) {
        setMapsError("No results found. Try different keywords or locations.");
      }
    } catch (e: any) { setMapsError(e.message); }
    finally { setMapsLoading(false); }
  };

  // ── Google Search scrape ────────────────────────────────────────────────
  const runSearchScrape = async () => {
    if (!searchKeywords.length) { setSearchError("Select at least one keyword."); return; }
    setSearchLoading(true); setSearchError(""); setSearchResults([]);
    try {
      const res = await fetch(`/api/scraper/google-search`, {
        method: "POST", headers,
        body: JSON.stringify({ keywords: searchKeywords, locations: searchLocations, maxResults: Number(searchMax) }),
      });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("tolipai_tools_pin");
        window.location.href = "/";
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scrape failed");
      setSearchResults(data.results || []);
      if (data.creditExhausted) {
        setSearchError(`ScraperAPI fallback credits exhausted for this month — results below are from ScrapingBee. Configure a scraper engine for unlimited primary results.`);
      } else if (!data.count) {
        setSearchError("No results found. Try different keywords.");
      }
    } catch (e: any) { setSearchError(e.message); }
    finally { setSearchLoading(false); }
  };

  // ── NAR directory scrape ────────────────────────────────────────────────
  const runNarScrape = async () => {
    if (!narState) { setNarError("Select a state."); return; }
    setNarLoading(true); setNarError(""); setNarResults([]);
    try {
      const res = await fetch(`/api/scraper/nar-directory`, {
        method: "POST", headers,
        body: JSON.stringify({ state: narState, city: narCity, maxResults: Number(narMax) }),
      });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("tolipai_tools_pin");
        window.location.href = "/";
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scrape failed");
      setNarResults(data.results || []);
      if (!data.count) setNarError("No results found. Try a different state or city.");
    } catch (e: any) { setNarError(e.message); }
    finally { setNarLoading(false); }
  };

  // ── Bulk runner ──────────────────────────────────────────────────────────
  const runBulk = async () => {
    if (!bulkKeywords.length || !bulkLocations.length) return;

    const combos: { keyword: string; location: string }[] = [];
    for (const keyword of bulkKeywords) {
      for (const location of bulkLocations) {
        combos.push({ keyword, location });
      }
    }

    const total = combos.length;
    setBulkTotal(total);
    setBulkProgress(0);
    setBulkCompleted(0);
    setBulkSkipped(0);
    setBulkResults([]);
    setBulkLog([]);
    setBulkApiWarning("");
    setBulkDone(false);
    setBulkRunning(true);
    bulkAbortRef.current = false;

    const endpoint = bulkTool === "google-maps"
      ? `/api/scraper/google-maps`
      : `/api/scraper/google-search`;

    const accumulated: ScrapeResult[] = [];
    let completed = 0;
    let skipped = 0;

    for (const { keyword, location } of combos) {
      if (bulkAbortRef.current) break;

      setBulkCurrentCombo(`"${keyword}" in ${location}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ keywords: [keyword], locations: [location], maxResults: Number(bulkMaxPerCombo) }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem("tolipai_tools_pin");
          window.location.href = "/";
          return;
        }
        const data = await res.json();
        if (data.creditExhausted) {
          setBulkApiWarning("ScraperAPI fallback credits exhausted — using ScrapingBee fallback (limited results). Configure GOOGLE_MAPS_API_KEY on the engine for unlimited primary results.");
        }
        if (res.ok && data.results?.length) {
          accumulated.push(...data.results);
          setBulkResults([...accumulated]);
          const tag = data.creditExhausted ? " (ScrapingBee fallback)" : "";
          setBulkLog(prev => [`✅ "${keyword}" in ${location} — ${data.results.length} results${tag}`, ...prev.slice(0, 49)]);
        } else {
          skipped++;
          setBulkSkipped(skipped);
          const reason = data.creditExhausted ? "ScraperAPI credits exhausted" : "no results";
          setBulkLog(prev => [`⚠️ "${keyword}" in ${location} — ${reason}`, ...prev.slice(0, 49)]);
        }
      } catch {
        clearTimeout(timeoutId);
        skipped++;
        setBulkSkipped(skipped);
        setBulkLog(prev => [`❌ "${keyword}" in ${location} — request failed`, ...prev.slice(0, 49)]);
      }

      completed++;
      setBulkCompleted(completed);
      setBulkProgress(Math.round((completed / total) * 100));

      // Small delay between requests to be respectful to the API
      if (!bulkAbortRef.current) await new Promise(r => setTimeout(r, 600));
    }

    setBulkRunning(false);
    setBulkDone(true);
    setBulkCurrentCombo("");
  };

  const stopBulk = () => { bulkAbortRef.current = true; };

  const resetBulk = () => {
    setBulkRunning(false); setBulkDone(false); setBulkProgress(0);
    setBulkTotal(0); setBulkCompleted(0); setBulkSkipped(0);
    setBulkCurrentCombo(""); setBulkResults([]); setBulkLog([]);
  };

  // ── Zillow scrape ────────────────────────────────────────────────────────
  const runZillowScrape = async () => {
    if (!zillowCity || !zillowState) { setZillowError("City and state are required."); return; }
    setZillowLoading(true); setZillowError(""); setZillowWarning(""); setZillowResults([]);
    try {
      const res = await fetch(`/api/scraper/zillow`, {
        method: "POST", headers,
        body: JSON.stringify({ mode: zillowMode, city: zillowCity, state: zillowState, maxResults: Number(zillowMax) }),
      });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("tolipai_tools_pin");
        window.location.href = "/";
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scrape failed");
      if (data.warning) setZillowWarning(data.warning);
      setZillowResults(data.results || []);
      if (!data.count && !data.warning) setZillowError("No results found. Zillow may have blocked the request — try again or use a different city.");
    } catch (e: any) { setZillowError(e.message); }
    finally { setZillowLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Lead Scraper</h1>
        <p className="text-muted-foreground mt-1">
          Bulk-run keyword × location combinations across Google Maps, Google Search, NAR Directory, and Zillow. Results accumulate live — export as CSV when done.
        </p>
      </div>

      <Alert className="border-blue-500/30 bg-blue-500/5">
        <Info className="w-4 h-4 text-blue-400" />
        <AlertDescription className="text-blue-300 text-xs">
          <strong>How scraping works:</strong> The Python scraper engine (Playwright / Crawl4AI) runs first — it uses real browser sessions and residential proxies.
          ScraperAPI and ScrapingBee are <strong>fallback only</strong> and are used automatically when the engine is unreachable.
          Configure <code className="bg-black/20 px-1 rounded">GOOGLE_MAPS_API_KEY</code> in the engine environment to unlock the highest-quality Google Maps results.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="bulk">
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="bulk" className="flex items-center gap-1 text-xs">
            <Zap className="w-3.5 h-3.5" /> Bulk Runner
          </TabsTrigger>
          <TabsTrigger value="maps" className="flex items-center gap-1 text-xs">
            <MapPin className="w-3.5 h-3.5" /> Google Maps
          </TabsTrigger>
          <TabsTrigger value="search" className="flex items-center gap-1 text-xs">
            <Globe className="w-3.5 h-3.5" /> Google Search
          </TabsTrigger>
          <TabsTrigger value="nar" className="flex items-center gap-1 text-xs">
            <Building2 className="w-3.5 h-3.5" /> NAR Directory
          </TabsTrigger>
          <TabsTrigger value="zillow" className="flex items-center gap-1 text-xs">
            <Home className="w-3.5 h-3.5" /> Zillow
          </TabsTrigger>
        </TabsList>

        {/* ── BULK RUNNER TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="bulk" className="mt-6 space-y-4">

          {/* Config card — only shown when not running and not done */}
          {!bulkRunning && !bulkDone && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" /> Bulk Batch Runner
                  <Badge variant="outline" className="text-xs ml-auto">Sequential execution</Badge>
                </CardTitle>
                <CardDescription>
                  Select a tool, keywords, and locations. Every keyword × location combination runs automatically one at a time. Results accumulate in real time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">

                {/* Tool selector */}
                <div className="flex items-center gap-4">
                  <Label className="text-sm font-medium whitespace-nowrap">Scrape using</Label>
                  <div className="flex gap-2">
                    {([
                      { value: "google-maps", label: "Google Maps", sub: "Engine (Playwright) → ScraperAPI fallback • returns phone numbers" },
                      { value: "google-search", label: "Google Search", sub: "Engine (Playwright) → ScraperAPI fallback • returns websites" },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setBulkTool(opt.value);
                          setBulkKeywords(opt.value === "google-maps"
                            ? ["we buy houses", "home buyers", "real estate investor"]
                            : ["we buy houses company", "real estate investment firm"]);
                        }}
                        className={`px-4 py-2.5 rounded-lg border text-left transition-all ${
                          bulkTool === opt.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        <div className="text-sm font-medium">{opt.label}</div>
                        <div className="text-xs mt-0.5 opacity-70">{opt.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Keywords */}
                  <div>
                    <KeywordPicker
                      options={bulkTool === "google-maps" ? GOOGLE_MAPS_KEYWORDS : GOOGLE_SEARCH_KEYWORDS}
                      selected={bulkKeywords}
                      onChange={setBulkKeywords}
                      label="Keywords"
                    />
                  </div>

                  {/* Locations */}
                  <div>
                    <LocationPicker selected={bulkLocations} onChange={setBulkLocations} />
                  </div>
                </div>

                {/* Max per combo + queue summary */}
                <div className="flex items-center gap-6 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm whitespace-nowrap">Max results per combo</Label>
                    <Input
                      type="number" min="5" max="50" value={bulkMaxPerCombo}
                      onChange={e => setBulkMaxPerCombo(e.target.value)}
                      className="w-20 h-8 text-sm"
                    />
                  </div>
                  {bulkKeywords.length > 0 && bulkLocations.length > 0 && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/20 rounded-lg">
                      <Zap className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-primary">
                        {bulkKeywords.length} keywords × {bulkLocations.length} locations = {" "}
                        <strong>{bulkKeywords.length * bulkLocations.length} combos</strong>
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">
                        (~{Math.ceil(bulkKeywords.length * bulkLocations.length * Number(bulkMaxPerCombo) * 0.6).toLocaleString()} est. results)
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={runBulk}
                    disabled={!bulkKeywords.length || !bulkLocations.length}
                    size="lg"
                    className="gap-2"
                  >
                    <PlayCircle className="w-4 h-4" />
                    Run {bulkKeywords.length * bulkLocations.length} Combos
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Progress card — shown while running or done */}
          {(bulkRunning || bulkDone) && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {bulkRunning
                      ? <><Loader2 className="w-4 h-4 animate-spin text-primary" /> Running bulk scrape...</>
                      : <><CheckCircle2 className="w-4 h-4 text-green-500" /> Bulk scrape complete</>
                    }
                  </CardTitle>
                  <div className="flex gap-2">
                    {bulkRunning && (
                      <Button size="sm" variant="destructive" onClick={stopBulk} className="gap-1">
                        <Square className="w-3 h-3" /> Stop
                      </Button>
                    )}
                    {bulkDone && (
                      <Button size="sm" variant="outline" onClick={resetBulk} className="gap-1">
                        <SkipForward className="w-3 h-3" /> New Run
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">

                {/* Stats row */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Completed", value: bulkCompleted, sub: `of ${bulkTotal}`, color: "text-blue-400" },
                    { label: "Results", value: bulkResults.length.toLocaleString(), sub: "records", color: "text-green-400" },
                    { label: "Skipped", value: bulkSkipped, sub: "no data", color: "text-amber-400" },
                    { label: "Progress", value: `${bulkProgress}%`, sub: bulkRunning ? "running" : "done", color: "text-primary" },
                  ].map(s => (
                    <div key={s.label} className="bg-muted/30 rounded-lg p-3 text-center">
                      <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                      <p className="text-xs text-muted-foreground/60">{s.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Progress bar */}
                <div className="space-y-1.5">
                  <Progress value={bulkProgress} className="h-2" />
                  {bulkCurrentCombo && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Scraping {bulkCurrentCombo}
                    </p>
                  )}
                </div>

                {/* Credit exhaustion warning */}
                {bulkApiWarning && (
                  <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10">
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <AlertDescription className="text-amber-300 text-xs">
                      {bulkApiWarning}{" "}
                      <a href="https://dashboard.scraperapi.com/billing" target="_blank" rel="noreferrer"
                        className="underline font-semibold">Upgrade ScraperAPI</a>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Live log */}
                {bulkLog.length > 0 && (
                  <div className="bg-muted/20 rounded-lg p-3 max-h-40 overflow-y-auto">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Live log (most recent first)</p>
                    {bulkLog.map((entry, i) => (
                      <p key={i} className="text-xs font-mono text-muted-foreground leading-relaxed">{entry}</p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Results card */}
          {bulkResults.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    {bulkResults.length.toLocaleString()} total results
                    {bulkRunning && <Badge variant="secondary" className="text-xs animate-pulse">updating...</Badge>}
                  </CardTitle>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => {
                      if (!bulkResults.length) return;
                      const cols = Object.keys(bulkResults[0]);
                      const csv = [
                        cols.join(","),
                        ...bulkResults.map(r => cols.map(c => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))
                      ].join("\n");
                      downloadCSV(csv, `bulk-scrape-${bulkTool}-${Date.now()}.csv`);
                    }}
                  >
                    <Download className="w-4 h-4 mr-1.5" />
                    Export {bulkResults.length.toLocaleString()} Records
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ResultsTable results={bulkResults.slice(0, 200)} />
                {bulkResults.length > 200 && (
                  <p className="text-xs text-muted-foreground mt-3 text-center">
                    Showing first 200 of {bulkResults.length.toLocaleString()} records. Export CSV to see all.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── GOOGLE MAPS TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="maps" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" /> Google Maps Lead Scraper
                <Badge variant="outline" className="text-xs ml-auto">ScraperAPI</Badge>
              </CardTitle>
              <CardDescription>
                Search Google Maps by keyword + location. Returns business name, address, phone, website, and rating.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <KeywordPicker
                  options={GOOGLE_MAPS_KEYWORDS}
                  selected={mapsKeywords}
                  onChange={setMapsKeywords}
                  label="Keywords (pick up to 5)"
                />
                <LocationPicker selected={mapsLocations} onChange={setMapsLocations} />
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label className="text-sm whitespace-nowrap">Max results</Label>
                  <Input
                    type="number" min="5" max="200" value={mapsMax}
                    onChange={e => setMapsMax(e.target.value)}
                    className="w-24 h-8 text-sm"
                  />
                </div>
                <Button onClick={runMapsSearch} disabled={mapsLoading} className="ml-auto">
                  {mapsLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scraping...</> : <><Search className="w-4 h-4 mr-2" /> Run Scrape</>}
                </Button>
              </div>

              {mapsError && (
                <Alert variant="destructive">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertDescription>{mapsError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {mapsResults.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    {mapsResults.length} results found
                  </CardTitle>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => {
                      const csv = [
                        Object.keys(mapsResults[0]).join(","),
                        ...mapsResults.map(r => Object.values(r).map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
                      ].join("\n");
                      downloadCSV(csv, `google-maps-leads-${Date.now()}.csv`);
                    }}
                  >
                    <Download className="w-4 h-4 mr-1.5" /> Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ResultsTable results={mapsResults} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── GOOGLE SEARCH TAB ────────────────────────────────────────────────── */}
        <TabsContent value="search" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" /> Google Business Finder
                <Badge variant="outline" className="text-xs ml-auto">ScraperAPI</Badge>
              </CardTitle>
              <CardDescription>
                Find real estate companies via Google Search. Returns company name, website, and domain.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <KeywordPicker
                  options={GOOGLE_SEARCH_KEYWORDS}
                  selected={searchKeywords}
                  onChange={setSearchKeywords}
                  label="Keywords (pick up to 5)"
                />
                <LocationPicker selected={searchLocations} onChange={setSearchLocations} />
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Label className="text-sm whitespace-nowrap">Max results</Label>
                  <Input
                    type="number" min="5" max="200" value={searchMax}
                    onChange={e => setSearchMax(e.target.value)}
                    className="w-24 h-8 text-sm"
                  />
                </div>
                <Button onClick={runSearchScrape} disabled={searchLoading} className="ml-auto">
                  {searchLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scraping...</> : <><Search className="w-4 h-4 mr-2" /> Run Scrape</>}
                </Button>
              </div>

              {searchError && (
                <Alert variant="destructive">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertDescription>{searchError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {searchResults.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    {searchResults.length} results found
                  </CardTitle>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => {
                      const csv = [
                        Object.keys(searchResults[0]).join(","),
                        ...searchResults.map(r => Object.values(r).map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
                      ].join("\n");
                      downloadCSV(csv, `google-search-leads-${Date.now()}.csv`);
                    }}
                  >
                    <Download className="w-4 h-4 mr-1.5" /> Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ResultsTable results={searchResults} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── NAR DIRECTORY TAB ────────────────────────────────────────────────── */}
        <TabsContent value="nar" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" /> NAR Realtor Directory Scraper
                <Badge variant="outline" className="text-xs ml-auto">Engine / API</Badge>
              </CardTitle>
              <CardDescription>
                Scrape REALTOR® member profiles from directories.apps.realtor by state/city. Extracts name, phone, and location.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Alert className="border-blue-500/30 bg-blue-500/5">
                <Info className="w-4 h-4 text-blue-400" />
                <AlertDescription className="text-blue-300 text-xs">
                  Attempts NAR's member search API directly (no credits used). If the API is unavailable, falls back to ScrapingBee. Start with a small max (10–20) to verify results first.
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-sm mb-1.5 block">State <span className="text-red-400">*</span></Label>
                  <Select value={narState} onValueChange={setNarState}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map(s => {
                        const [name, abbr] = s.split(",");
                        return <SelectItem key={abbr} value={abbr}>{name} ({abbr})</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm mb-1.5 block">City (optional)</Label>
                  <Input
                    placeholder="e.g. Richmond"
                    value={narCity}
                    onChange={e => setNarCity(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-sm mb-1.5 block">Max profiles</Label>
                  <Input
                    type="number" min="5" max="100" value={narMax}
                    onChange={e => setNarMax(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={runNarScrape} disabled={narLoading}>
                  {narLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scraping profiles...</> : <><Phone className="w-4 h-4 mr-2" /> Scrape Directory</>}
                </Button>
              </div>

              {narError && (
                <Alert variant="destructive">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertDescription>{narError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {narResults.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    {narResults.length} profiles found
                  </CardTitle>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => {
                      const csv = [
                        Object.keys(narResults[0]).join(","),
                        ...narResults.map(r => Object.values(r).map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
                      ].join("\n");
                      downloadCSV(csv, `nar-directory-${narState}-${Date.now()}.csv`);
                    }}
                  >
                    <Download className="w-4 h-4 mr-1.5" /> Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ResultsTable results={narResults} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── ZILLOW TAB ───────────────────────────────────────────────────────── */}
        <TabsContent value="zillow" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Home className="w-4 h-4 text-primary" /> Zillow Scraper
                <Badge variant="outline" className="text-xs ml-auto">Engine / ScrapingBee</Badge>
              </CardTitle>
              <CardDescription>
                Scrape Zillow for real estate agents, active property listings, or FSBO listings by city and state.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Alert className="border-amber-500/30 bg-amber-500/5">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <AlertDescription className="text-amber-300 text-xs">
                  Zillow uses DataDome bot protection. ScrapingBee premium proxies with JS rendering give the best chance of bypassing it (~40–60% success rate).
                  If blocked, the response will say so — just try again.
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <Label className="text-sm mb-1.5 block">What to scrape</Label>
                  <Select value={zillowMode} onValueChange={(v: any) => setZillowMode(v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agents">Real Estate Agents</SelectItem>
                      <SelectItem value="listings">Active Listings</SelectItem>
                      <SelectItem value="fsbo">FSBO (For Sale By Owner)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm mb-1.5 block">City <span className="text-red-400">*</span></Label>
                  <Input
                    placeholder="e.g. Tulsa"
                    value={zillowCity}
                    onChange={e => setZillowCity(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-sm mb-1.5 block">State abbreviation <span className="text-red-400">*</span></Label>
                  <Select value={zillowState} onValueChange={setZillowState}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map(s => {
                        const [name, abbr] = s.split(",");
                        return <SelectItem key={abbr} value={abbr}>{abbr} — {name}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm mb-1.5 block">Max results</Label>
                  <Input
                    type="number" min="5" max="100" value={zillowMax}
                    onChange={e => setZillowMax(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>

              <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground mb-1">What each mode returns:</p>
                <p><span className="text-primary font-medium">Agents</span> — Name, brokerage, phone, rating, review count, active listings, profile URL</p>
                <p><span className="text-primary font-medium">Active Listings</span> — Address, price, beds/baths, sqft, days on market, listing agent, Zillow URL</p>
                <p><span className="text-primary font-medium">FSBO</span> — Same as listings but for sale-by-owner only (no agent — direct seller contact)</p>
              </div>

              <div className="flex justify-end">
                <Button onClick={runZillowScrape} disabled={zillowLoading}>
                  {zillowLoading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scraping Zillow...</>
                    : <><Search className="w-4 h-4 mr-2" /> Run Scrape</>
                  }
                </Button>
              </div>

              {zillowError && (
                <Alert variant="destructive">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertDescription>{zillowError}</AlertDescription>
                </Alert>
              )}
              {zillowWarning && !zillowError && (
                <Alert className="border-amber-500/30 bg-amber-500/5">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <AlertDescription className="text-amber-300">{zillowWarning}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {zillowResults.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    {zillowResults.length} results scraped from Zillow
                    <Badge variant="secondary" className="text-xs capitalize">{zillowMode}</Badge>
                  </CardTitle>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => {
                      const csv = [
                        Object.keys(zillowResults[0]).join(","),
                        ...zillowResults.map(r => Object.values(r).map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
                      ].join("\n");
                      downloadCSV(csv, `zillow-${zillowMode}-${zillowCity}-${zillowState}-${Date.now()}.csv`);
                    }}
                  >
                    <Download className="w-4 h-4 mr-1.5" /> Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ResultsTable results={zillowResults} />
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
