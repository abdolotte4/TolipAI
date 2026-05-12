import { useState, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Users, Upload, Plus, Trash2, Search, Phone, Mail, MapPin, X, Download,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useCrmGetMe } from "@workspace/api-client-react";

const TEMPLATE_CSV = `name,phone,email,address,notes
John Smith,(555) 123-4567,john@example.com,123 Oak St Atlanta GA 30301,All cash 14 day close
Mary Johnson,(555) 987-6543,mary@example.com,456 Pine Ave Marietta GA 30060,Prefers off-market`;

export default function BuyersList() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useCrmGetMe();

  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", notes: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = me?.role === "admin" || me?.role === "super_admin";

  const { data: buyers = [], isLoading } = useQuery<any[]>({
    queryKey: ["crm-buyers", search],
    queryFn: () => apiFetch(`/buyers${search ? `?search=${encodeURIComponent(search)}` : ""}`),
    enabled: !!me,
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiFetch("/buyers", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: "Buyer added" });
      setForm({ name: "", phone: "", email: "", address: "", notes: "" });
      setShowAddModal(false);
      qc.invalidateQueries({ queryKey: ["crm-buyers"] });
    },
    onError: () => toast({ title: "Failed to add buyer", variant: "destructive" }),
  });

  const uploadMutation = useMutation({
    mutationFn: (csv: string) => apiFetch("/buyers/upload", { method: "POST", body: JSON.stringify({ csv }) }),
    onSuccess: (data: any) => {
      toast({ title: `Imported ${data.inserted} buyers${data.skipped ? ` (${data.skipped} skipped)` : ""}` });
      setCsvText("");
      setShowUploadModal(false);
      qc.invalidateQueries({ queryKey: ["crm-buyers"] });
    },
    onError: () => toast({ title: "Upload failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/buyers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Buyer removed" });
      qc.invalidateQueries({ queryKey: ["crm-buyers"] });
    },
  });

  function handleFileRead(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCsvText(ev.target?.result as string ?? "");
    reader.readAsText(file);
    e.target.value = "";
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "buyers_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold">Buyers List</h1>
          <p className="text-muted-foreground mt-1">Manage cash buyers for this campaign.</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-xl gap-2 border-white/10 hover:bg-secondary" onClick={() => setShowUploadModal(true)}>
              <Upload className="w-4 h-4" /> Import CSV
            </Button>
            <Button className="rounded-xl gap-2 shadow-lg shadow-primary/20" onClick={() => setShowAddModal(true)}>
              <Plus className="w-4 h-4" /> Add Buyer
            </Button>
          </div>
        )}
      </motion.div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, phone, or email..."
          className="pl-9 bg-card rounded-xl border-white/10"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4">
        <Badge variant="secondary" className="px-3 py-1 text-sm rounded-xl">
          <Users className="w-3.5 h-3.5 mr-1.5" />
          {buyers.length} buyer{buyers.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="grid gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 rounded-2xl bg-card animate-pulse" />
          ))}
        </div>
      ) : buyers.length === 0 ? (
        <Card className="rounded-2xl border-white/5 bg-card p-16 flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Users className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="font-display font-semibold text-lg">No buyers yet</p>
            <p className="text-muted-foreground text-sm mt-1">
              {isAdmin ? "Add buyers manually or import a CSV file to get started." : "No buyers have been added yet."}
            </p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-xl gap-2" onClick={() => setShowUploadModal(true)}>
                <Upload className="w-4 h-4" /> Import CSV
              </Button>
              <Button className="rounded-xl gap-2" onClick={() => setShowAddModal(true)}>
                <Plus className="w-4 h-4" /> Add Buyer
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <div className="grid gap-3">
          {buyers.map((buyer: any, i: number) => (
            <motion.div
              key={buyer.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Card className="rounded-2xl border-white/5 bg-card hover:bg-card/80 transition-all shadow-sm hover:shadow-md group">
                <div className="p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-bold text-sm">{buyer.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-3 gap-1 md:gap-4">
                    <div>
                      <p className="font-semibold text-foreground truncate">{buyer.name}</p>
                      {buyer.notes && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{buyer.notes}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      {buyer.phone && (
                        <a href={`tel:${buyer.phone}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors truncate">
                          <Phone className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
                          {buyer.phone}
                        </a>
                      )}
                      {buyer.email && (
                        <a href={`mailto:${buyer.email}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors truncate">
                          <Mail className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
                          {buyer.email}
                        </a>
                      )}
                    </div>
                    <div>
                      {buyer.address && (
                        <p className="flex items-start gap-1.5 text-sm text-muted-foreground truncate">
                          <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-primary mt-0.5" />
                          {buyer.address}
                        </p>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => {
                        if (confirm(`Remove ${buyer.name} from buyers list?`)) deleteMutation.mutate(buyer.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-lg hover:bg-destructive/10 text-destructive ml-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Add Buyer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md">
            <Card className="rounded-2xl border-white/10 bg-card shadow-2xl">
              <div className="p-6 border-b border-border flex items-center justify-between">
                <h2 className="font-display font-bold text-lg">Add Buyer</h2>
                <button onClick={() => setShowAddModal(false)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <Label>Full Name *</Label>
                  <Input className="bg-background/50 rounded-xl" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="John Smith" />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input className="bg-background/50 rounded-xl" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 123-4567" />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" className="bg-background/50 rounded-xl" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="john@example.com" />
                </div>
                <div className="space-y-2">
                  <Label>Address / Market Area</Label>
                  <Input className="bg-background/50 rounded-xl" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Atlanta, GA" />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea className="bg-background/50 rounded-xl resize-none" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="All cash, closes in 14 days..." />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowAddModal(false)}>Cancel</Button>
                  <Button
                    className="flex-1 rounded-xl shadow-lg shadow-primary/20"
                    disabled={!form.name.trim() || addMutation.isPending}
                    onClick={() => addMutation.mutate(form)}
                  >
                    Add Buyer
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      )}

      {/* Upload CSV Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-lg">
            <Card className="rounded-2xl border-white/10 bg-card shadow-2xl">
              <div className="p-6 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="font-display font-bold text-lg">Import CSV / Excel</h2>
                  <p className="text-muted-foreground text-sm mt-0.5">Upload a file or paste CSV data below</p>
                </div>
                <button onClick={() => setShowUploadModal(false)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/30 border border-white/5">
                  <div className="flex-1 text-sm text-muted-foreground">
                    Required column: <strong className="text-foreground">name</strong>. Optional: <strong className="text-foreground">phone, email, address, notes</strong>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0 rounded-lg gap-1.5 text-xs" onClick={downloadTemplate}>
                    <Download className="w-3.5 h-3.5" /> Template
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>Upload file (.csv or .txt)</Label>
                  <input ref={fileInputRef} type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={handleFileRead} />
                  <Button
                    variant="outline"
                    className="w-full rounded-xl border-dashed border-white/20 h-14 gap-2 text-muted-foreground hover:text-foreground hover:border-primary/40"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-4 h-4" />
                    Click to choose a file
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>Or paste CSV data</Label>
                  <Textarea
                    className="bg-background/50 rounded-xl resize-none font-mono text-xs"
                    rows={7}
                    placeholder={`name,phone,email\nJohn Smith,(555) 123-4567,john@email.com\nMary Johnson,(555) 987-6543,mary@email.com`}
                    value={csvText}
                    onChange={e => setCsvText(e.target.value)}
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { setShowUploadModal(false); setCsvText(""); }}>Cancel</Button>
                  <Button
                    className="flex-1 rounded-xl shadow-lg shadow-primary/20 gap-2"
                    disabled={!csvText.trim() || uploadMutation.isPending}
                    onClick={() => uploadMutation.mutate(csvText)}
                  >
                    <Upload className="w-4 h-4" />
                    {uploadMutation.isPending ? "Importing..." : "Import"}
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      )}
    </div>
  );
}
