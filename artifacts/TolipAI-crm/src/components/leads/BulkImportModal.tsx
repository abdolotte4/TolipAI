import { useState, useRef, useCallback } from "react";
import { X, Upload, AlertCircle, CheckCircle2, Loader2, FileText, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

// ── CSV parser (no external dep needed for simple CSVs) ────────────────────────

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes; continue; }
      if (line[i] === "," && !inQuotes) { result.push(current.trim()); current = ""; continue; }
      current += line[i];
    }
    result.push(current.trim());
    return result;
  };
  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(line => {
    const values = parseRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  }).filter(row => Object.values(row).some(v => v.trim()));
  return { headers, rows };
}

// ── Lead field options ─────────────────────────────────────────────────────────

const LEAD_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "sellerName", label: "Seller Name", required: true },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "address", label: "Property Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "ZIP Code" },
  { key: "propertyType", label: "Property Type" },
  { key: "beds", label: "Bedrooms" },
  { key: "baths", label: "Bathrooms" },
  { key: "sqft", label: "Sq Ft" },
  { key: "askingPrice", label: "Asking Price" },
  { key: "currentValue", label: "Current Value (AVM)" },
  { key: "estimatedRepairCost", label: "Estimated Repair Cost" },
  { key: "arv", label: "ARV" },
  { key: "leadSource", label: "Lead Source" },
  { key: "status", label: "Status" },
  { key: "reasonForSelling", label: "Reason for Selling" },
  { key: "howSoon", label: "How Soon" },
  { key: "notes", label: "Notes" },
];

// ── Auto-map heuristic ────────────────────────────────────────────────────────

function autoMap(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string[]> = {
    sellerName: ["sellername", "name", "ownername", "seller", "fullname", "contact"],
    phone: ["phone", "phonenumber", "mobile", "cell", "telephone"],
    email: ["email", "emailaddress", "mail"],
    address: ["address", "propertyaddress", "street", "streetaddress"],
    city: ["city"],
    state: ["state", "st"],
    zip: ["zip", "zipcode", "postalcode", "postal"],
    propertyType: ["propertytype", "type", "proptype"],
    beds: ["beds", "bedrooms", "br"],
    baths: ["baths", "bathrooms", "ba"],
    sqft: ["sqft", "squarefeet", "size", "livingarea"],
    askingPrice: ["askingprice", "asking", "listprice"],
    currentValue: ["currentvalue", "avm", "value", "marketvalue"],
    estimatedRepairCost: ["erc", "repaircost", "repairs", "estimatedrepaircost"],
    arv: ["arv", "afterrepairvalue"],
    leadSource: ["leadsource", "source", "origin"],
    status: ["status"],
    notes: ["notes", "comments", "description"],
  };
  for (const h of headers) {
    const norm = normalize(h);
    for (const [field, alts] of Object.entries(aliases)) {
      if (alts.includes(norm) && !mapping[field]) {
        mapping[field] = h;
        break;
      }
    }
  }
  return mapping;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

type Step = "upload" | "map" | "preview" | "result";

interface ImportResult {
  created: number;
  failed: number;
  errors: { row: number; message: string }[];
}

export default function BulkImportModal({ onClose }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast({ title: "Please upload a .csv file", variant: "destructive" });
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers: h, rows: r } = parseCSV(text);
      if (h.length === 0 || r.length === 0) {
        toast({ title: "CSV appears empty or invalid", variant: "destructive" });
        return;
      }
      setHeaders(h);
      setRows(r);
      setMapping(autoMap(h));
      setStep("map");
    };
    reader.readAsText(file);
  }, [toast]);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleImport = async () => {
    setLoading(true);
    try {
      const leads = rows.map(row => {
        const lead: Record<string, string> = {};
        for (const [field, col] of Object.entries(mapping)) {
          if (col && row[col] !== undefined) lead[field] = row[col];
        }
        return lead;
      });
      const res: ImportResult = await apiFetch("/leads/bulk-import", {
        method: "POST",
        body: JSON.stringify({ leads }),
      });
      setResult(res);
      setStep("result");
      qc.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      qc.invalidateQueries({ queryKey: ["crm-nav-new-leads"] });
      qc.invalidateQueries({ queryKey: ["crm-stats"] });
    } catch (err: any) {
      toast({ title: "Import failed", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const previewRows = rows.slice(0, 5);
  const mappedFields = LEAD_FIELDS.filter(f => mapping[f.key]);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-3xl max-h-[90vh] flex flex-col"
      >
        <Card className="rounded-2xl border-white/10 bg-card shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="px-6 py-4 bg-secondary/30 border-b border-border flex items-center justify-between shrink-0">
            <div>
              <h2 className="font-display font-bold text-lg flex items-center gap-2">
                <Upload className="w-5 h-5 text-primary" /> Bulk Import Leads
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Upload a CSV file to create multiple leads at once
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Steps indicator */}
          <div className="px-6 py-3 border-b border-border bg-secondary/10 flex items-center gap-2 shrink-0">
            {(["upload", "map", "preview", "result"] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step === s ? "bg-primary text-primary-foreground" :
                  ["upload", "map", "preview", "result"].indexOf(step) > i ? "bg-emerald-500/20 text-emerald-400" :
                  "bg-secondary text-muted-foreground"
                }`}>{i + 1}</div>
                <span className={`text-xs capitalize hidden sm:block ${step === s ? "text-foreground font-medium" : "text-muted-foreground"}`}>{s === "map" ? "Map Columns" : s === "result" ? "Done" : s.charAt(0).toUpperCase() + s.slice(1)}</span>
                {i < 3 && <ChevronDown className="w-3 h-3 text-muted-foreground/40 rotate-[-90deg]" />}
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {step === "upload" && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-secondary/30"}`}
              >
                <Upload className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" />
                <p className="font-medium text-foreground mb-1">Drop your CSV here or click to browse</p>
                <p className="text-sm text-muted-foreground">Supports any CSV with headers. Up to 500 leads per import.</p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileInput} />
              </div>
            )}

            {step === "map" && (
              <div className="space-y-5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="w-4 h-4" />
                  <span><strong className="text-foreground">{fileName}</strong> — {rows.length.toLocaleString()} rows detected</span>
                </div>

                <div>
                  <p className="text-sm font-semibold mb-3">Map CSV columns → Lead fields</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {LEAD_FIELDS.map(field => (
                      <div key={field.key} className="flex items-center gap-2">
                        <div className="w-36 shrink-0">
                          <span className="text-xs text-muted-foreground">{field.label}</span>
                          {field.required && <span className="text-red-400 ml-0.5">*</span>}
                        </div>
                        <select
                          value={mapping[field.key] || ""}
                          onChange={e => setMapping(m => ({ ...m, [field.key]: e.target.value }))}
                          className="flex-1 text-xs h-8 px-2 rounded-lg border border-border bg-background/60 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="">— skip —</option>
                          {headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setStep("upload")} className="rounded-xl">Back</Button>
                  <Button
                    className="flex-1 rounded-xl"
                    disabled={!mapping["sellerName"]}
                    onClick={() => setStep("preview")}
                  >
                    Preview ({rows.length} leads)
                  </Button>
                </div>
              </div>
            )}

            {step === "preview" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Preview (first {Math.min(5, rows.length)} of {rows.length} rows)</p>
                  <Badge variant="secondary">{mappedFields.length} fields mapped</Badge>
                </div>

                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-secondary/30 border-b border-border">
                        {mappedFields.slice(0, 6).map(f => (
                          <th key={f.key} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{f.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/20">
                          {mappedFields.slice(0, 6).map(f => (
                            <td key={f.key} className="px-3 py-2 text-foreground truncate max-w-[120px]">
                              {mapping[f.key] ? row[mapping[f.key]] || <span className="text-muted-foreground/40">—</span> : <span className="text-muted-foreground/40">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {mappedFields.length > 6 && (
                  <p className="text-xs text-muted-foreground">+{mappedFields.length - 6} more fields mapped (not shown in preview)</p>
                )}

                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-400">
                  This will create <strong>{rows.length}</strong> new leads. This action cannot be undone in bulk.
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep("map")} className="rounded-xl" disabled={loading}>Back</Button>
                  <Button
                    className="flex-1 gap-2 rounded-xl"
                    onClick={handleImport}
                    disabled={loading}
                  >
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</> : <><Upload className="w-4 h-4" /> Import {rows.length} Leads</>}
                  </Button>
                </div>
              </div>
            )}

            {step === "result" && result && (
              <div className="space-y-4">
                <div className={`flex items-center gap-3 p-4 rounded-2xl ${result.failed === 0 ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-amber-500/10 border border-amber-500/20"}`}>
                  {result.failed === 0
                    ? <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                    : <AlertCircle className="w-8 h-8 text-amber-400 shrink-0" />}
                  <div>
                    <p className="font-semibold text-foreground">
                      {result.created} lead{result.created !== 1 ? "s" : ""} imported successfully
                    </p>
                    {result.failed > 0 && (
                      <p className="text-sm text-muted-foreground mt-0.5">{result.failed} rows failed — see details below</p>
                    )}
                  </div>
                </div>

                {result.errors.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Failed rows</p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {result.errors.map(e => (
                        <div key={e.row} className="flex items-start gap-2 text-xs bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
                          <span className="text-red-400 shrink-0">Row {e.row}:</span>
                          <span className="text-muted-foreground">{e.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Button className="w-full rounded-xl" onClick={onClose}>Done</Button>
              </div>
            )}
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
