import { useState, useEffect, useRef } from "react";
import { useToolsStatus, useDistressedJobs, useSearchDistressed, useDistressedJobStatus } from "@/hooks/use-tools";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Download, AlertTriangle, CheckCircle2, Clock, PlayCircle, Plus, X, Phone, Info } from "lucide-react";
import { format } from "date-fns";

const CATEGORIES = [
  { id: "absentee_owner", label: "Absentee Owner", filtered: true, note: "Server-filtered — only non-occupant owners returned" },
  { id: "free_clear", label: "Free & Clear (No Mortgage)", filtered: true, note: "Server-filtered — no mortgage recorded" },
  { id: "pre_foreclosure", label: "Pre-Foreclosure", filtered: false, note: "Label only — requires premium ATTOM data tier" },
  { id: "foreclosure", label: "Foreclosure", filtered: false, note: "Label only — requires premium ATTOM data tier" },
  { id: "tax_delinquent", label: "Tax Delinquent", filtered: false, note: "Label only — requires premium ATTOM data tier" },
  { id: "vacant", label: "Vacant / Abandoned", filtered: false, note: "Label only — requires premium ATTOM data tier" },
  { id: "high_equity", label: "High Equity", filtered: false, note: "Label only — assessed value data not on current plan" },
];

function DistressedJobRow({ jobId }: { jobId: string }) {
  const { data: job, isLoading } = useDistressedJobStatus(jobId);
  const { pin } = useAuth();
  const [enrichJobId, setEnrichJobId] = useState<string | null>(null);
  const [enrichStatus, setEnrichStatus] = useState<{ status: string; processed: number; total: number } | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enrichJobId || enrichStatus?.status === "completed" || enrichStatus?.status === "failed") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/tools/distressed/enrich-status/${enrichJobId}`, {
        headers: { "X-Tools-Pin": pin || "" }
      });
      if (res.ok) {
        const data = await res.json();
        setEnrichStatus(data);
        if (data.status === "completed" || data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [enrichJobId, enrichStatus?.status, pin]);

  if (isLoading || !job) return (
    <div className="flex items-center justify-between p-4 border rounded-lg animate-pulse bg-muted/20">
      <div className="h-4 bg-muted rounded w-1/4"></div>
      <div className="h-4 bg-muted rounded w-1/4"></div>
    </div>
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed": return <Badge variant="default" className="bg-green-500/10 text-green-500 border-green-500/20"><CheckCircle2 className="w-3 h-3 mr-1" /> Completed</Badge>;
      case "running": return <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 border-blue-500/20"><PlayCircle className="w-3 h-3 mr-1 animate-pulse" /> Searching</Badge>;
      case "queued": return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" /> Queued</Badge>;
      case "failed": return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" /> Failed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const downloadFile = async (url: string, filename: string) => {
    const res = await fetch(url, { headers: { "X-Tools-Pin": pin || "" } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Download failed");
      return;
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(href);
  };

  const handleDownload = () =>
    downloadFile(`/api/tools/distressed/download/${jobId}`, `distressed_${jobId.substring(0, 8)}.csv`).catch(() => alert("Download failed."));

  const handleEnrich = async () => {
    setEnrichLoading(true);
    try {
      const res = await fetch(`/api/tools/distressed/enrich/${jobId}`, {
        method: "POST",
        headers: { "X-Tools-Pin": pin || "" }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to start enrichment");
        return;
      }
      const data = await res.json();
      setEnrichJobId(data.enrichJobId);
      setEnrichStatus({ status: "running", processed: 0, total: data.total });
    } catch {
      alert("Failed to start enrichment.");
    } finally {
      setEnrichLoading(false);
    }
  };

  const handleDownloadEnriched = () =>
    downloadFile(`/api/tools/distressed/download-enriched/${enrichJobId}`, `distressed-enriched_${jobId.substring(0, 8)}.csv`).catch(() => alert("Download failed."));

  const progress = job.totalLocations ? (job.locationsProcessed / job.totalLocations) * 100 : 0;
  const enrichProgress = enrichStatus?.total ? (enrichStatus.processed / enrichStatus.total) * 100 : 0;

  return (
    <div className="flex flex-col gap-3 p-4 border border-border/50 rounded-lg bg-card hover:bg-accent/5 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Search className="w-5 h-5 text-muted-foreground" />
          <div className="flex flex-col">
            <span className="font-medium font-mono text-sm">{jobId.substring(0, 8)}...</span>
            <span className="text-xs text-muted-foreground">
              {job.startedAt ? format(new Date(job.startedAt), 'MMM d, HH:mm') : 'Waiting...'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {getStatusBadge(job.status)}
          {job.status === "completed" && job.totalFound > 0 && (
            <>
              <Button size="sm" onClick={handleDownload} variant="outline" className="h-8 border-green-500/40 text-green-400 hover:bg-green-500/10">
                <Download className="w-4 h-4 mr-1" />
                Download CSV
              </Button>
              {!enrichJobId && (
                <Button size="sm" onClick={handleEnrich} variant="outline" className="h-8 border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10" disabled={enrichLoading}>
                  <Phone className="w-4 h-4 mr-1" />
                  {enrichLoading ? "Starting..." : "+ Enrich Contacts"}
                </Button>
              )}
              {enrichStatus?.status === "completed" && (
                <Button size="sm" onClick={handleDownloadEnriched} className="h-8 bg-cyan-600 hover:bg-cyan-700">
                  <Download className="w-4 h-4 mr-1" />
                  Deep Enriched CSV
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {job.status === "completed" && job.totalFound > 0 && !enrichJobId && (
        <div className="text-xs text-muted-foreground border-t border-border/30 pt-2">
          CSV includes: address · property type · year built · sqft · baths · lot size · APN. Use "+ Enrich Contacts" to add owner phone &amp; email.
        </div>
      )}

      {enrichStatus && enrichStatus.status !== "completed" && (
        <div className="space-y-1 mt-1 border-t border-border/30 pt-2">
          <div className="flex justify-between text-xs text-cyan-400">
            <span>Enriching contact data... {enrichStatus.processed}/{enrichStatus.total}</span>
            <span>{Math.round(enrichProgress)}%</span>
          </div>
          <Progress value={enrichProgress} className="h-1.5 [&>div]:bg-cyan-500" />
        </div>
      )}
      {enrichStatus?.status === "completed" && (
        <div className="text-xs text-green-400 mt-1 border-t border-border/30 pt-2">
          ✓ Enrichment complete — {enrichStatus.processed} properties enriched with phone numbers
        </div>
      )}
      
      {(job.status === "running" || job.status === "completed") && (
        <div className="space-y-1.5 mt-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{job.locationsProcessed} / {job.totalLocations} locations</span>
            <span className="font-medium text-foreground">{job.totalFound} properties found</span>
          </div>
          {job.status === "running" && <Progress value={progress} className="h-1.5" />}
        </div>
      )}
    </div>
  );
}

export default function DistressedFinder() {
  const { data: status } = useToolsStatus();
  const { data: jobsData } = useDistressedJobs();
  const searchMutation = useSearchDistressed();

  const [locationType, setLocationType] = useState<string>("zip");
  const [currentLocation, setCurrentLocation] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(["pre_foreclosure"]);
  const [limit, setLimit] = useState("500");

  const isConfigured = status?.engineConfigured !== false;

  const handleAddLocation = () => {
    if (currentLocation.trim() && !locations.includes(currentLocation.trim())) {
      setLocations([...locations, currentLocation.trim()]);
      setCurrentLocation("");
    }
  };

  const handleRemoveLocation = (loc: string) => {
    setLocations(locations.filter(l => l !== loc));
  };

  const toggleCategory = (cat: string) => {
    if (selectedCategories.includes(cat)) {
      setSelectedCategories(selectedCategories.filter(c => c !== cat));
    } else {
      setSelectedCategories([...selectedCategories, cat]);
    }
  };

  const handleSearch = () => {
    if (locations.length === 0 || selectedCategories.length === 0) return;
    
    searchMutation.mutate({
      locations,
      locationType,
      categories: selectedCategories,
      limit: parseInt(limit, 10)
    }, {
      onSuccess: () => {
        setLocations([]);
        setCurrentLocation("");
      }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Opportunity Finder</h1>
        <p className="text-muted-foreground mt-1">Pull property lists by ZIP code or county — then enrich with owner contact info via data enrichment.</p>
      </div>

      {status && !isConfigured && (
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Scraper Engine Unreachable</AlertTitle>
          <AlertDescription>
            The scraper engine is not responding. Check that the engine is deployed and the <code>SCRAPER_ENGINE_URL</code> environment variable is set correctly.
          </AlertDescription>
        </Alert>
      )}

      {(locationType === "state" || locationType === "county") && (
        <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-400">
          <Info className="h-4 w-4" />
          <AlertTitle>{locationType === "state" ? "State" : "County"} Search — Free Scraper Engine</AlertTitle>
          <AlertDescription>
            {locationType === "state" ? "State-wide" : "County-wide"} searches run via the free public-record scraper engine — no ATTOM key needed. The engine fans out across county clerk, public trustee, probate court, tax assessor, and auction aggregator sources for the matching {locationType === "state" ? "state" : "county"}. Results may take a few minutes to accumulate.
          </AlertDescription>
        </Alert>
      )}

      {searchMutation.isError && (
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Search Failed</AlertTitle>
          <AlertDescription>{(searchMutation.error as Error)?.message || "Search failed. Please try again."}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle>New Search</CardTitle>
            <CardDescription>Define search parameters to pull motivated seller leads.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Location Type</Label>
                <Select value={locationType} onValueChange={setLocationType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zip">Zip Code</SelectItem>
                    <SelectItem value="city">City</SelectItem>
                    <SelectItem value="county">County</SelectItem>
                    <SelectItem value="state">State</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Max Records <span className="text-xs text-muted-foreground font-normal">(1 API credit per record)</span></Label>
                <Select value={limit} onValueChange={setLimit}>
                  <SelectTrigger>
                    <SelectValue placeholder="Limit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 (Test)</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                    <SelectItem value="1000">1,000</SelectItem>
                    <SelectItem value="5000">5,000</SelectItem>
                    <SelectItem value="10000">10,000</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                Locations
                {locationType === "city" && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">— include state abbreviation, e.g. <span className="font-mono">Elkridge, MD</span></span>
                )}
                {locationType === "county" && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">— include state abbreviation, e.g. <span className="font-mono">Montgomery, MD</span></span>
                )}
                {locationType === "state" && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">— use 2-letter abbreviation, e.g. <span className="font-mono">MD</span></span>
                )}
              </Label>
              <div className="flex gap-2">
                <Input 
                  placeholder={
                    locationType === "zip" ? "e.g. 20901" :
                    locationType === "city" ? "e.g. Elkridge, MD" :
                    locationType === "county" ? "e.g. Montgomery, MD" : "e.g. MD"
                  }
                  value={currentLocation}
                  onChange={e => setCurrentLocation(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddLocation()}
                />
                <Button type="button" variant="secondary" onClick={handleAddLocation}>
                  <Plus className="w-4 h-4 mr-2" /> Add
                </Button>
              </div>
              {locationType === "city" && (
                <p className="text-xs text-primary/80">
                  Format: <span className="font-mono font-medium">City Name, State</span> — e.g. Elkridge, MD · Columbia, MD · Baltimore, MD · Arlington, VA
                  <br /><span className="text-muted-foreground">City names are automatically resolved to their ZIP codes for the search.</span>
                </p>
              )}
              {locationType === "county" && (
                <p className="text-xs text-amber-500/80">
                  Format: <span className="font-mono font-medium">County Name, State</span> — e.g. Montgomery, MD · Fairfax, VA · Anne Arundel, MD
                </p>
              )}
              {locations.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3 p-3 bg-muted/20 border rounded-md">
                  {locations.map(loc => (
                    <Badge key={loc} variant="secondary" className="flex items-center gap-1 py-1">
                      {loc}
                      <X className="w-3 h-3 cursor-pointer hover:text-destructive transition-colors" onClick={() => handleRemoveLocation(loc)} />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-start justify-between gap-2">
                <Label>Distress Categories</Label>
              </div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Mortgage-Based (server-filtered from your subscription data)</div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                {CATEGORIES.filter(c => c.filtered).map(cat => (
                  <div key={cat.id} title={cat.note} className={`flex items-center space-x-2 p-2 rounded-md border transition-colors ${selectedCategories.includes(cat.id) ? 'bg-primary/10 border-primary/30' : 'bg-primary/5 border-primary/10 hover:border-primary/30'}`}>
                    <Checkbox 
                      id={cat.id} 
                      checked={selectedCategories.includes(cat.id)}
                      onCheckedChange={() => toggleCategory(cat.id)}
                    />
                    <label htmlFor={cat.id} className="text-sm font-medium leading-none cursor-pointer flex items-center gap-1.5">
                      {cat.label}
                      <span className="text-[10px] text-primary font-normal bg-primary/10 px-1.5 py-0.5 rounded-full">Filtered</span>
                    </label>
                  </div>
                ))}
              </div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Label-Only Categories (pulled from area, applied as tag)</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {CATEGORIES.filter(c => !c.filtered).map(cat => (
                  <div key={cat.id} title={cat.note} className={`flex items-center space-x-2 p-2 rounded-md border transition-colors ${selectedCategories.includes(cat.id) ? 'bg-muted/30 border-border' : 'bg-muted/10 border-transparent hover:border-border'}`}>
                    <Checkbox 
                      id={cat.id} 
                      checked={selectedCategories.includes(cat.id)}
                      onCheckedChange={() => toggleCategory(cat.id)}
                    />
                    <label htmlFor={cat.id} className="text-sm font-medium leading-none cursor-pointer text-muted-foreground">
                      {cat.label}
                    </label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground bg-muted/20 px-3 py-2 rounded-md border">
                All categories are sourced from <span className="font-medium text-primary">free public records</span> — county clerk filings, public trustee auction notices, probate court dockets, tax assessor delinquency rolls, government REO portals, and auction aggregators (Auction.com, Hubzu, Xome). Results are extracted and de-duplicated automatically. No paid data subscription required.
              </p>
            </div>
          </CardContent>
          <CardFooter className="bg-muted/5 border-t py-4">
            <Button 
              className="w-full" 
              size="lg"
              disabled={!isConfigured || locations.length === 0 || selectedCategories.length === 0 || searchMutation.isPending}
              onClick={handleSearch}
            >
              {searchMutation.isPending ? "Starting Search..." : "Pull Opportunity List"}
            </Button>
          </CardFooter>
        </Card>

        <Card className="border-border/50 shadow-sm flex flex-col">
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Recent searches</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto pr-2 pb-2">
            <div className="space-y-3">
              {jobsData?.jobs?.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground text-sm border border-dashed rounded-lg">
                  No searches run yet
                </div>
              ) : (
                jobsData?.jobs?.map((job: any) => (
                  <DistressedJobRow key={job.jobId} jobId={job.jobId} />
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
