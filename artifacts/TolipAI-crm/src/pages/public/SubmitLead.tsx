import { useState } from "react";
import { useParams } from "wouter";
import { Building, MapPin, CheckCircle, User, DollarSign, MessageSquare } from "lucide-react";
import { useCrmGetSubmissionForm, useCrmSubmitPublicLead } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const selectClass = "flex h-11 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500";

export default function SubmitLead() {
  const { token } = useParams();
  const { data: formInfo, isLoading, isError } = useCrmGetSubmissionForm(token || "");
  const submitMutation = useCrmSubmitPublicLead();

  const [submitted, setSubmitted] = useState(false);

  const [formData, setFormData] = useState({
    sellerName: "",
    phone: "",
    email: "",
    address: "",
    propertyType: "Single Family",
    beds: "",
    baths: "",
    condition: "5",
    occupancy: "",
    reasonForSelling: "",
    howSoon: "",
    askingPriceText: "",
    currentValue: "",
    message: "",
  });

  const set = (key: keyof typeof formData) => (val: string) =>
    setFormData(prev => ({ ...prev, [key]: val }));

  if (isLoading) return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
      <div className="animate-pulse w-32 h-8 bg-zinc-200 rounded"></div>
    </div>
  );

  if (isError || !formInfo?.active) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-8 text-center bg-white shadow-xl rounded-2xl">
          <Building className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-zinc-800 mb-2">Form Unavailable</h2>
          <p className="text-zinc-500">This submission link is invalid or no longer active.</p>
        </Card>
      </div>
    );
  }

  const campaignName = formInfo.campaignName ?? null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    submitMutation.mutate(
      {
        token,
        data: {
          sellerName: formData.sellerName,
          phone: formData.phone,
          email: formData.email || undefined,
          address: formData.address,
          propertyType: formData.propertyType || undefined,
          beds: formData.beds ? Number(formData.beds) : undefined,
          baths: formData.baths ? Number(formData.baths) : undefined,
          condition: Number(formData.condition),
          occupancy: formData.occupancy || undefined,
          reasonForSelling: formData.reasonForSelling || undefined,
          howSoon: formData.howSoon || undefined,
          askingPriceText: formData.askingPriceText || undefined,
          currentValue: formData.currentValue ? Number(formData.currentValue) : undefined,
          message: formData.message || undefined,
        },
      },
      { onSuccess: () => setSubmitted(true) }
    );
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-10 text-center bg-white shadow-2xl rounded-3xl border-0">
          <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-green-500" />
          </div>
          <h2 className="text-3xl font-bold text-zinc-900 mb-3">Property Submitted!</h2>
          <p className="text-zinc-600 mb-8 leading-relaxed">
            Thank you for sharing the details. Our acquisitions team will review the property and reach out to you shortly.
          </p>
          <Button onClick={() => window.location.reload()} variant="outline" className="rounded-xl w-full">
            Submit Another Property
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 py-12 px-4 font-sans text-zinc-900">
      <div className="max-w-2xl mx-auto">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="bg-indigo-600 p-2.5 rounded-xl shadow-lg">
            <Building className="w-7 h-7 text-white" />
          </div>
          <span className="font-bold text-2xl text-zinc-900 tracking-tight">
            {campaignName || "TolipAI Properties"}
          </span>
        </div>

        <Card className="bg-white shadow-xl rounded-3xl border-0 overflow-hidden">
          {/* Header */}
          <div className="bg-indigo-600 p-8 text-center text-white">
            <h1 className="text-3xl font-bold mb-2">
              {campaignName ? `Submit a Property to ${campaignName}` : "Property Submission"}
            </h1>
            <p className="text-indigo-100 opacity-90">Fill out the details below to get a quick cash offer.</p>
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-8">

            {/* ── Contact Info ── */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-zinc-800 border-b pb-2 flex items-center gap-2">
                <User className="w-5 h-5 text-indigo-500" /> Your Contact Info
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-zinc-700">Full Name *</Label>
                  <Input required className="bg-zinc-50 border-zinc-200 text-zinc-900 h-11" value={formData.sellerName} onChange={e => set("sellerName")(e.target.value)} placeholder="John Smith" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-zinc-700">Phone Number *</Label>
                  <Input required type="tel" className="bg-zinc-50 border-zinc-200 text-zinc-900 h-11" value={formData.phone} onChange={e => set("phone")(e.target.value)} placeholder="(407) 555-0100" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-zinc-700">Email <span className="text-zinc-400 font-normal">(Optional)</span></Label>
                  <Input type="email" className="bg-zinc-50 border-zinc-200 text-zinc-900 h-11" value={formData.email} onChange={e => set("email")(e.target.value)} placeholder="john@email.com" />
                </div>
              </div>
            </div>

            {/* ── Property Details ── */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-zinc-800 border-b pb-2 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-indigo-500" /> Property Details
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-zinc-700">Full Property Address *</Label>
                  <Input required className="bg-zinc-50 border-zinc-200 text-zinc-900 h-11" value={formData.address} onChange={e => set("address")(e.target.value)} placeholder="123 Main St, Orlando, FL 32801" />
                  <p className="text-xs text-zinc-400">Include city, state, and ZIP for best results.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-zinc-700">Property Type</Label>
                  <select className={selectClass} value={formData.propertyType} onChange={e => set("propertyType")(e.target.value)}>
                    <option>Single Family</option>
                    <option>Multi Family</option>
                    <option>Condo/Townhouse</option>
                    <option>Land</option>
                    <option>Commercial</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-zinc-700">Occupancy</Label>
                  <select className={selectClass} value={formData.occupancy} onChange={e => set("occupancy")(e.target.value)}>
                    <option value="">-- Select --</option>
                    <option>Owner Occupied</option>
                    <option>Rented</option>
                    <option>Vacant</option>
                  </select>
                </div>
                <div className="space-y-1.5 flex gap-4">
                  <div className="flex-1">
                    <Label className="text-zinc-700">Beds</Label>
                    <Input type="number" min="0" className="bg-zinc-50 border-zinc-200 text-zinc-900 h-11" value={formData.beds} onChange={e => set("beds")(e.target.value)} placeholder="3" />
                  </div>
                  <div className="flex-1">
                    <Label className="text-zinc-700">Baths</Label>
                    <Input type="number" step="0.5" min="0" className="bg-zinc-50 border-zinc-200 text-zinc-900 h-11" value={formData.baths} onChange={e => set("baths")(e.target.value)} placeholder="2" />
                  </div>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-zinc-700">Condition <span className="text-zinc-400 font-normal">(1 = Major Repairs, 10 = Move-In Ready)</span></Label>
                  <input type="range" min="1" max="10" className="w-full accent-indigo-600" value={formData.condition} onChange={e => set("condition")(e.target.value)} />
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>Needs Major Repairs (1)</span>
                    <span className="font-bold text-indigo-600 text-base">{formData.condition}</span>
                    <span>Move-in Ready (10)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Seller Motivation ── */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-zinc-800 border-b pb-2 flex items-center gap-2">
                <User className="w-5 h-5 text-indigo-500" /> Seller Motivation <span className="text-sm font-normal text-zinc-400">(Optional)</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-zinc-700">Reason for Selling</Label>
                  <select className={selectClass} value={formData.reasonForSelling} onChange={e => set("reasonForSelling")(e.target.value)}>
                    <option value="">-- Select --</option>
                    <option>Downsizing</option>
                    <option>Divorce</option>
                    <option>Inherited</option>
                    <option>Financial Hardship</option>
                    <option>Tired Landlord</option>
                    <option>Relocation</option>
                    <option>Health Issues</option>
                    <option>Foreclosure / Pre-foreclosure</option>
                    <option>Estate Sale</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-zinc-700">How Soon Do You Need to Sell?</Label>
                  <select className={selectClass} value={formData.howSoon} onChange={e => set("howSoon")(e.target.value)}>
                    <option value="">-- Select --</option>
                    <option>ASAP</option>
                    <option>Within 1 Month</option>
                    <option>1–3 Months</option>
                    <option>3–6 Months</option>
                    <option>6+ Months</option>
                    <option>Just Exploring</option>
                  </select>
                </div>
              </div>
            </div>

            {/* ── Pricing ── */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-zinc-800 border-b pb-2 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-indigo-500" /> Pricing <span className="text-sm font-normal text-zinc-400">(Optional)</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-zinc-700">Your Asking Price</Label>
                  <Input
                    className="bg-zinc-50 border-zinc-200 text-zinc-900 h-11"
                    value={formData.askingPriceText}
                    onChange={e => set("askingPriceText")(e.target.value)}
                    placeholder="e.g. $150,000 or just make an offer"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-zinc-700">Current Market Value (Your Estimate)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">$</span>
                    <Input
                      type="number"
                      min="0"
                      className="bg-zinc-50 border-zinc-200 text-zinc-900 h-11 pl-8"
                      value={formData.currentValue}
                      onChange={e => set("currentValue")(e.target.value)}
                      placeholder="200000"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Additional Info ── */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-zinc-800 border-b pb-2 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-indigo-500" /> Additional Info <span className="text-sm font-normal text-zinc-400">(Optional)</span>
              </h3>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-zinc-700">Additional Notes</Label>
                <Textarea
                  className="bg-zinc-50 border-zinc-200 text-zinc-900 min-h-[100px]"
                  placeholder="Any repairs needed, access notes, or other details..."
                  value={formData.message}
                  onChange={e => set("message")(e.target.value)}
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={submitMutation.isPending}
              className="w-full h-14 text-lg font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-200 transition-all"
            >
              {submitMutation.isPending ? "Submitting..." : "Submit Property for Review"}
            </Button>
          </form>
        </Card>

        <p className="text-center mt-6 text-sm text-zinc-400">
          Powered by <span className="font-semibold text-zinc-500">TolipAI CRM</span>
        </p>
      </div>
    </div>
  );
}
