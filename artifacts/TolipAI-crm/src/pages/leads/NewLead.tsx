import { useState } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Save, MapPin, User, Building, DollarSign, FileText, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const PROPERTY_TYPES = ["Single Family", "Multi-Family", "Condo/Townhouse", "Mobile Home", "Land/Lot", "Commercial", "Other"];
const OCCUPANCY_OPTIONS = ["Owner Occupied", "Vacant", "Tenant Occupied", "Rented", "Unknown"];
const LEAD_SOURCES = ["Manual Entry", "Direct Mail", "Phone Outreach", "PPC/Google Ads", "Facebook Ads", "Driving for Dollars", "Referral", "Wholesale Deal", "MLS", "Other"];
const CONDITION_LABELS: Record<number, string> = {
  1: "1 – Tear Down", 2: "2 – Major Rehab", 3: "3 – Extensive Work",
  4: "4 – Heavy Repairs", 5: "5 – Moderate Updates", 6: "6 – Minor Updates",
  7: "7 – Light Cosmetic", 8: "8 – Good Condition", 9: "9 – Very Good", 10: "10 – Move-In Ready",
};

function authHeaders() {
  const token = localStorage.getItem("crm_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export default function NewLead() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    sellerName: "",
    phone: "",
    email: "",
    leadSource: "Manual Entry",
    address: "",
    city: "",
    state: "",
    zip: "",
    propertyType: "",
    beds: "",
    baths: "",
    sqft: "",
    condition: "",
    occupancy: "",
    isRental: false,
    rentalAmount: "",
    reasonForSelling: "",
    howSoon: "",
    askingPrice: "",
    currentValue: "",
    arv: "",
    estimatedRepairCost: "",
    notes: "",
  });

  const set = (field: string, value: string | boolean) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await fetch("/api/crm/leads", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          ...form,
          beds: form.beds ? parseInt(form.beds) : undefined,
          baths: form.baths || undefined,
          sqft: form.sqft ? parseInt(form.sqft) : undefined,
          condition: form.condition ? parseInt(form.condition) : undefined,
          askingPrice: form.askingPrice || undefined,
          currentValue: form.currentValue || undefined,
          arv: form.arv || undefined,
          estimatedRepairCost: form.estimatedRepairCost || undefined,
          occupancy: form.occupancy || undefined,
          isRental: form.isRental || form.occupancy === "Rented",
          rentalAmount: form.rentalAmount || undefined,
          propertyType: form.propertyType || undefined,
          reasonForSelling: form.reasonForSelling || undefined,
          howSoon: form.howSoon || undefined,
          notes: form.notes || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to create lead");
      toast({ title: "Lead created successfully!" });
      setLocation(`/leads/${data.id}`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = "bg-background/50 rounded-xl h-11";

  return (
    <div className="max-w-3xl mx-auto pb-20">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/leads">
          <Button variant="ghost" size="icon" className="rounded-xl border border-white/10 bg-card hover:bg-secondary">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-display font-bold">New Property Lead</h1>
          <p className="text-muted-foreground mt-1">Enter the property details to start tracking this deal.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">

          {/* Seller Information */}
          <Card className="p-6 rounded-2xl bg-card border-white/5 shadow-lg">
            <div className="flex items-center gap-2 mb-6">
              <User className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold text-lg">Seller Information</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2 md:col-span-2">
                <Label>Seller Full Name <span className="text-destructive">*</span></Label>
                <Input required className={inputClass} value={form.sellerName}
                  onChange={e => set("sellerName", e.target.value)} placeholder="John Smith" />
              </div>
              <div className="space-y-2">
                <Label>Phone Number</Label>
                <Input className={inputClass} value={form.phone}
                  onChange={e => set("phone", e.target.value)} placeholder="(555) 123-4567" />
              </div>
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input type="email" className={inputClass} value={form.email}
                  onChange={e => set("email", e.target.value)} placeholder="john@example.com" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Lead Source</Label>
                <Select value={form.leadSource} onValueChange={v => set("leadSource", v)}>
                  <SelectTrigger className={inputClass}><SelectValue /></SelectTrigger>
                  <SelectContent>{LEAD_SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </Card>

          {/* Property Location */}
          <Card className="p-6 rounded-2xl bg-card border-white/5 shadow-lg">
            <div className="flex items-center gap-2 mb-6">
              <MapPin className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold text-lg">Property Location</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="space-y-2 md:col-span-3">
                <Label>Street Address <span className="text-destructive">*</span></Label>
                <Input required className={inputClass} value={form.address}
                  onChange={e => set("address", e.target.value)} placeholder="1309 Coffeen Ave" />
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input className={inputClass} value={form.city}
                  onChange={e => set("city", e.target.value)} placeholder="Sheridan" />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input className={inputClass} value={form.state}
                  onChange={e => set("state", e.target.value)} placeholder="WY" />
              </div>
              <div className="space-y-2">
                <Label>ZIP Code</Label>
                <Input className={inputClass} value={form.zip}
                  onChange={e => set("zip", e.target.value)} placeholder="82801" />
              </div>
            </div>
          </Card>

          {/* Property Details */}
          <Card className="p-6 rounded-2xl bg-card border-white/5 shadow-lg">
            <div className="flex items-center gap-2 mb-6">
              <Building className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold text-lg">Property Details</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2 md:col-span-2">
                <Label>Property Type</Label>
                <Select value={form.propertyType} onValueChange={v => set("propertyType", v)}>
                  <SelectTrigger className={inputClass}><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>{PROPERTY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Bedrooms</Label>
                <Input type="number" min="0" className={inputClass} value={form.beds}
                  onChange={e => set("beds", e.target.value)} placeholder="3" />
              </div>
              <div className="space-y-2">
                <Label>Bathrooms</Label>
                <Input type="number" min="0" step="0.5" className={inputClass} value={form.baths}
                  onChange={e => set("baths", e.target.value)} placeholder="2" />
              </div>
              <div className="space-y-2">
                <Label>Square Footage</Label>
                <Input type="number" min="0" className={inputClass} value={form.sqft}
                  onChange={e => set("sqft", e.target.value)} placeholder="1,500" />
              </div>
              <div className="space-y-2">
                <Label>General Condition / Upgrades</Label>
                <Select value={form.condition} onValueChange={v => set("condition", v)}>
                  <SelectTrigger className={inputClass}><SelectValue placeholder="Rate condition 1–10" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Occupancy</Label>
                <Select value={form.occupancy} onValueChange={v => set("occupancy", v)}>
                  <SelectTrigger className={inputClass}><SelectValue placeholder="Select occupancy" /></SelectTrigger>
                  <SelectContent>{OCCUPANCY_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-background/50 px-4 py-3">
                <div>
                  <Label className="text-sm font-medium">Rental Property?</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Is this currently being rented?</p>
                </div>
                <Switch
                  checked={form.isRental || form.occupancy === "Rented"}
                  onCheckedChange={v => set("isRental", v)}
                />
              </div>
              {(form.isRental || form.occupancy === "Rented") && (
                <div className="space-y-2 md:col-span-2">
                  <Label>Monthly Rental Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      min="0"
                      className={`${inputClass} pl-7`}
                      value={form.rentalAmount}
                      onChange={e => set("rentalAmount", e.target.value)}
                      placeholder="e.g. 1,800"
                    />
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Seller Motivation */}
          <Card className="p-6 rounded-2xl bg-card border-white/5 shadow-lg">
            <div className="flex items-center gap-2 mb-6">
              <Clock className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold text-lg">Seller Motivation</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2 md:col-span-2">
                <Label>Reason for Selling</Label>
                <Textarea className="bg-background/50 rounded-xl min-h-[80px] resize-none" value={form.reasonForSelling}
                  onChange={e => set("reasonForSelling", e.target.value)}
                  placeholder="e.g. Divorce, Foreclosure, Downsizing, Inherited property..." />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>How Soon Do They Need to Sell?</Label>
                <Input className={inputClass} value={form.howSoon}
                  onChange={e => set("howSoon", e.target.value)} placeholder="e.g. ASAP, By May, 3 months..." />
              </div>
            </div>
          </Card>

          {/* Financials */}
          <Card className="p-6 rounded-2xl bg-card border-white/5 shadow-lg">
            <div className="flex items-center gap-2 mb-6">
              <DollarSign className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold text-lg">Financials</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label>Asking Price</Label>
                <Input type="number" min="0" className={inputClass} value={form.askingPrice}
                  onChange={e => set("askingPrice", e.target.value)} placeholder="$280,000" />
              </div>
              <div className="space-y-2">
                <Label>Market Estimate (Current Value)</Label>
                <Input type="number" min="0" className={inputClass} value={form.currentValue}
                  onChange={e => set("currentValue", e.target.value)} placeholder="$445,652" />
              </div>
              <div className="space-y-2">
                <Label>ARV (After Repair Value)</Label>
                <Input type="number" min="0" className={inputClass} value={form.arv}
                  onChange={e => set("arv", e.target.value)} placeholder="$350,000" />
              </div>
              <div className="space-y-2">
                <Label>Estimated Repair Cost</Label>
                <Input type="number" min="0" className={inputClass} value={form.estimatedRepairCost}
                  onChange={e => set("estimatedRepairCost", e.target.value)} placeholder="$25,000" />
              </div>
            </div>
          </Card>

          {/* Notes */}
          <Card className="p-6 rounded-2xl bg-card border-white/5 shadow-lg">
            <div className="flex items-center gap-2 mb-6">
              <FileText className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold text-lg">Additional Notes</h2>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea className="bg-background/50 rounded-xl min-h-[100px] resize-none" value={form.notes}
                onChange={e => set("notes", e.target.value)}
                placeholder="Any extra details, observations, or follow-up reminders..." />
            </div>
          </Card>

          <div className="flex justify-end gap-4 pt-4">
            <Link href="/leads">
              <Button type="button" variant="outline" className="rounded-xl h-12 px-6 border-white/10 hover:bg-secondary">Cancel</Button>
            </Link>
            <Button type="submit" disabled={submitting}
              className="rounded-xl h-12 px-8 bg-gradient-to-r from-primary to-accent hover:opacity-90 shadow-lg shadow-primary/20 text-base">
              <Save className="w-5 h-5 mr-2" />
              {submitting ? "Creating..." : "Create Lead"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
