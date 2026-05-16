import { useState } from "react";
import { useToolsStatus, usePropertyLookup } from "@/hooks/use-tools";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle, Home, Phone, Mail, User, MapPin, Building2,
  DollarSign, TrendingUp, Percent, CalendarDays, Search
} from "lucide-react";

function formatCurrency(v: number | null | undefined) {
  if (!v && v !== 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

function formatNumber(v: number | null | undefined, suffix = "") {
  if (!v && v !== 0) return "—";
  return `${v.toLocaleString()}${suffix}`;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border/30 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right max-w-[60%] break-words">{value || "—"}</span>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, color = "default" }: {
  icon: any; label: string; value: string; sub?: string;
  color?: "default" | "green" | "blue" | "orange" | "red";
}) {
  const colors = {
    default: "border-border/50",
    green: "border-green-500/20 bg-green-500/5",
    blue: "border-blue-500/20 bg-blue-500/5",
    orange: "border-orange-500/20 bg-orange-500/5",
    red: "border-red-500/20 bg-red-500/5",
  };
  return (
    <Card className={`${colors[color]} shadow-none`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
        </div>
        <div className="text-xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

const STREET_SUFFIXES = new Set([
  "ST","AVE","BLVD","DR","LN","CT","RD","WAY","PL","TER","TERR","CIR","HWY",
  "PKWY","PATH","LOOP","SQ","TRL","TRAIL","RUN","PIKE","FWY","ALY","ALLEY",
  "NW","NE","SW","SE","N","S","E","W"
]);

function parseFullAddress(raw: string): { street: string; city: string; state: string; zip: string } | null {
  const trimmed = raw.trim();

  // Try comma-delimited first: "123 Main St, City Name, ST 12345"
  const commaMatch = trimmed.match(/^(.+?),\s*([A-Za-z][A-Za-z\s]*?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (commaMatch) {
    return {
      street: commaMatch[1]!.trim(),
      city: commaMatch[2]!.trim(),
      state: commaMatch[3]!.trim().toUpperCase(),
      zip: commaMatch[4]!.trim(),
    };
  }

  // Try space-delimited: "123 Main St City Name ST 12345"
  const spaceMatch = trimmed.match(/^(.+)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (spaceMatch) {
    const beforeState = spaceMatch[1]!.trim();
    const state = spaceMatch[2]!.toUpperCase();
    const zip = spaceMatch[3]!.trim();
    const parts = beforeState.toUpperCase().split(/\s+/);
    // Find the last street suffix (e.g. CT, TER, DR) to determine where street ends
    let streetEnd = -1;
    for (let i = parts.length - 1; i >= 1; i--) {
      if (STREET_SUFFIXES.has(parts[i]!)) { streetEnd = i; break; }
    }
    if (streetEnd > 0 && streetEnd < parts.length - 1) {
      const origParts = beforeState.split(/\s+/);
      const street = origParts.slice(0, streetEnd + 1).join(" ");
      const city = origParts.slice(streetEnd + 1).join(" ");
      if (street && city) return { street, city, state, zip };
    }
  }

  return null;
}

export default function PropertyLookup() {
  const { data: status } = useToolsStatus();
  const lookup = usePropertyLookup();
  const [form, setForm] = useState({ street: "", city: "", state: "", zip: "" });
  const [result, setResult] = useState<any>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lookup.mutate(form, {
      onSuccess: (data) => setResult(data),
    });
  };

  const handleStreetBlur = () => {
    if (!form.street) return;
    const parsed = parseFullAddress(form.street);
    if (parsed && (!form.city || !form.state || !form.zip)) {
      setForm(parsed);
    }
  };

  const prop = result?.property;
  const metrics = result?.metrics;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Property Lookup</h1>
        <p className="text-muted-foreground mt-1">Full property profile — AVM, equity, owner, mortgage, and contact info.</p>
      </div>

      {status && !status.attomConfigured && (
        <Alert className="bg-yellow-500/10 border-yellow-500/20 text-yellow-700 dark:text-yellow-400">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>ATTOM API Key Not Configured</AlertTitle>
          <AlertDescription>Full property data requires an ATTOM API key. Lookup will use available free sources but results may be limited.</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Search Form */}
        <div className="xl:col-span-4">
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="w-4 h-4" />
                Property Address
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Street Address</Label>
                  <Input
                    value={form.street}
                    onChange={e => setForm({ ...form, street: e.target.value })}
                    onBlur={handleStreetBlur}
                    required
                    placeholder="123 Main St  –  or paste full address"
                  />
                  <p className="text-xs text-muted-foreground">Tip: paste the full address and city/state/zip will auto-fill</p>
                </div>
                <div className="space-y-2">
                  <Label>City</Label>
                  <Input
                    value={form.city}
                    onChange={e => setForm({ ...form, city: e.target.value })}
                    placeholder="City"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label>State</Label>
                    <Input
                      value={form.state}
                      onChange={e => setForm({ ...form, state: e.target.value })}
                      placeholder="AL"
                      maxLength={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>ZIP</Label>
                    <Input
                      value={form.zip}
                      onChange={e => setForm({ ...form, zip: e.target.value })}
                      placeholder="36106"
                      maxLength={10}
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full mt-2"
                  disabled={lookup.isPending || !form.street}
                >
                  {lookup.isPending ? "Looking up..." : "Look Up Property"}
                </Button>

                {lookup.isError && (
                  <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive mt-2">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{(lookup.error as Error)?.message || "Lookup failed"}</AlertDescription>
                  </Alert>
                )}
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Results */}
        <div className="xl:col-span-8">
          {result && prop ? (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{prop.address}</h2>
                  <p className="text-muted-foreground text-sm">{[prop.city, prop.state, prop.zip].filter(Boolean).join(", ")}</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {prop.propertyType && <Badge variant="outline">{prop.propertyType}</Badge>}
                  {metrics?.isAbsenteeOwner && <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20">Absentee Owner</Badge>}
                  {metrics?.hasPhone && <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Has Phone</Badge>}
                </div>
              </div>

              {/* Key metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard icon={DollarSign} label="AVM" value={formatCurrency(prop.avm)} sub={prop.avmLow && prop.avmHigh ? `${formatCurrency(prop.avmLow)} – ${formatCurrency(prop.avmHigh)}` : undefined} color="blue" />
                <MetricCard icon={TrendingUp} label="Est. Equity" value={formatCurrency(prop.estimatedEquity)} sub={metrics?.equityPercent != null ? `${metrics.equityPercent}% equity` : undefined} color="green" />
                <MetricCard icon={Percent} label="LTV" value={metrics?.ltvPercent != null ? `${metrics.ltvPercent}%` : "—"} sub={formatCurrency(prop.mortgageBalance) + " balance"} color={metrics?.ltvPercent > 80 ? "red" : "default"} />
                <MetricCard icon={Home} label="$/sqft" value={metrics?.pricePerSqft ? `$${metrics.pricePerSqft}` : "—"} sub={prop.sqft ? `${prop.sqft.toLocaleString()} sqft` : undefined} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Property Details */}
                <Card className="border-border/50 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Building2 className="w-4 h-4" /> Property
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <InfoRow label="Beds" value={prop.beds} />
                    <InfoRow label="Baths" value={prop.baths} />
                    <InfoRow label="Sqft" value={prop.sqft ? prop.sqft.toLocaleString() : null} />
                    <InfoRow label="Lot Sqft" value={prop.lotSqft ? prop.lotSqft.toLocaleString() : null} />
                    <InfoRow label="Year Built" value={prop.yearBuilt} />
                    <InfoRow label="County" value={prop.county} />
                  </CardContent>
                </Card>

                {/* Financials */}
                <Card className="border-border/50 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <DollarSign className="w-4 h-4" /> Financials
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <InfoRow label="AVM" value={formatCurrency(prop.avm)} />
                    <InfoRow label="Assessed Value" value={formatCurrency(prop.assessedTotalValue)} />
                    <InfoRow label="Assessed/AVM" value={metrics?.assessedToAvmPercent != null ? `${metrics.assessedToAvmPercent}%` : null} />
                    <InfoRow label="Tax Amount" value={prop.taxAmount ? `${formatCurrency(prop.taxAmount)}/yr` : null} />
                    <InfoRow label="Last Sale" value={formatCurrency(prop.lastSalePrice)} />
                    <InfoRow label="Sale Date" value={prop.lastSaleDate ? new Date(prop.lastSaleDate).toLocaleDateString() : null} />
                  </CardContent>
                </Card>

                {/* Mortgage */}
                <Card className="border-border/50 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CalendarDays className="w-4 h-4" /> Mortgage
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <InfoRow label="Original Amt" value={formatCurrency(prop.mortgageAmount)} />
                    <InfoRow label="Lender" value={prop.mortgageLender} />
                    <InfoRow label="Loan Type" value={prop.mortgageLoanType} />
                    <InfoRow label="Term" value={prop.mortgageTerm ? `${prop.mortgageTerm} months` : null} />
                    <InfoRow label="Mortgage Date" value={prop.mortgageDate ? new Date(prop.mortgageDate).toLocaleDateString() : null} />
                    <InfoRow label="Due Date" value={prop.mortgageDueDate ? new Date(prop.mortgageDueDate).toLocaleDateString() : null} />
                  </CardContent>
                </Card>

                {/* Owner */}
                <Card className="border-border/50 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <User className="w-4 h-4" /> Owner
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <InfoRow label="Owner 1" value={prop.ownerName} />
                    <InfoRow label="Owner 2" value={prop.ownerName2} />
                    <InfoRow label="Owner Type" value={prop.ownerType} />
                    <InfoRow label="Absentee" value={prop.isAbsenteeOwner === true ? "Yes" : prop.isAbsenteeOwner === false ? "No" : null} />
                    <InfoRow label="Mailing Address" value={prop.ownerMailingAddress} />
                  </CardContent>
                </Card>

                {/* Contact */}
                <Card className="border-border/50 shadow-sm md:col-span-1">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Phone className="w-4 h-4" /> Contact Info
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {prop.phones && prop.phones.length > 0 ? (
                      <div className="space-y-2 mb-3">
                        {prop.phones.map((ph: string, i: number) => (
                          <div key={i} className="flex items-center gap-2">
                            <Phone className="w-3 h-3 text-primary shrink-0" />
                            <a href={`tel:${ph}`} className="text-sm font-medium text-primary hover:underline">{ph}</a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground mb-3">No phone numbers found</p>
                    )}

                    {prop.emails && prop.emails.length > 0 ? (
                      <div className="space-y-2">
                        {prop.emails.map((em: string, i: number) => (
                          <div key={i} className="flex items-center gap-2">
                            <Mail className="w-3 h-3 text-primary shrink-0" />
                            <a href={`mailto:${em}`} className="text-sm font-medium text-primary hover:underline truncate">{em}</a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No emails found</p>
                    )}
                  </CardContent>
                </Card>

                {/* Location */}
                {(prop.latitude || prop.longitude) && (
                  <Card className="border-border/50 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <MapPin className="w-4 h-4" /> Location
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <InfoRow label="Latitude" value={prop.latitude} />
                      <InfoRow label="Longitude" value={prop.longitude} />
                      <div className="mt-3">
                        <a
                          href={`https://maps.google.com/?q=${prop.latitude},${prop.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          View on Google Maps →
                        </a>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          ) : (
            <Card className="h-full min-h-[400px] flex items-center justify-center border-dashed border-2 bg-muted/5">
              <div className="text-center text-muted-foreground">
                <Home className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <h3 className="text-lg font-medium text-foreground">No Property Loaded</h3>
                <p className="mt-1 max-w-sm mx-auto text-sm">Enter an address to pull a full property profile including AVM, equity, owner info, mortgage, and contact details.</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
