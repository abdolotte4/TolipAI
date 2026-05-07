import { useState, useCallback } from "react";
import { useUploadPhoneFinder, usePhoneFinderJobStatus } from "@/hooks/use-tools";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  UploadCloud, Phone, Download, AlertTriangle, CheckCircle2, Clock,
  PlayCircle, FileSpreadsheet, X, Search,
} from "lucide-react";
import * as XLSX from "xlsx";

type ParsedRecord = Record<string, string>;

function JobResultPanel({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const { data: job, isLoading } = usePhoneFinderJobStatus(jobId);
  const { pin } = useAuth();

  const handleDownload = async () => {
    try {
      const res = await fetch(`/api/tools/phone-finder/download/${jobId}`, {
        headers: { "X-Tools-Pin": pin || "" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Download failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `phone-finder-${jobId.substring(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Download failed. Please try again.");
    }
  };

  if (isLoading || !job) return (
    <div className="flex items-center justify-center p-12 text-muted-foreground text-sm animate-pulse">
      Loading job status...
    </div>
  );

  const isRunning = job.status === "running" || job.status === "queued";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {job.status === "completed" && <Badge className="bg-green-500/10 text-green-500 border-green-500/20"><CheckCircle2 className="w-3 h-3 mr-1" /> Completed</Badge>}
          {isRunning && <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20"><PlayCircle className="w-3 h-3 mr-1 animate-pulse" /> Running</Badge>}
          {job.status === "failed" && <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" /> Failed</Badge>}
          <span className="text-sm text-muted-foreground font-mono">{jobId.substring(0, 12)}...</span>
        </div>
        <div className="flex items-center gap-2">
          {job.status === "completed" && (
            <Button size="sm" onClick={handleDownload} variant="outline">
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
      </div>

      {(isRunning || job.status === "completed") && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{job.processed ?? 0} / {job.totalRecords ?? 0} records</span>
            <span>{job.progressPercent ?? 0}%</span>
          </div>
          <Progress value={job.progressPercent ?? 0} className="h-1.5" />
          <div className="flex gap-4 text-xs">
            <span className="text-green-500">{job.found ?? 0} phones found</span>
            <span className="text-muted-foreground">{job.notFound ?? 0} not found</span>
          </div>
        </div>
      )}

      {job.status === "completed" && job.results && job.results.length > 0 && (
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead className="w-[220px]">Name</TableHead>
                  <TableHead className="w-[200px]">Address</TableHead>
                  <TableHead>Phone Numbers</TableHead>
                  <TableHead className="w-[90px]">Source</TableHead>
                  <TableHead className="w-[80px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {job.results.map((row: any, i: number) => (
                  <TableRow key={i} className="hover:bg-accent/5">
                    <TableCell className="font-medium text-xs truncate max-w-[220px]" title={row.name}>{row.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]" title={row.address}>{row.address}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.phones && row.phones.length > 0
                          ? row.phones.map((p: string, pi: number) => (
                            <Badge key={pi} variant="outline" className="text-xs font-mono bg-primary/5 border-primary/20 text-primary">
                              <Phone className="w-3 h-3 mr-1" />{p}
                            </Badge>
                          ))
                          : <span className="text-xs text-muted-foreground italic">—</span>
                        }
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.source ?? "—"}</TableCell>
                    <TableCell>
                      {row.phones && row.phones.length > 0
                        ? <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-xs">Found</Badge>
                        : <Badge variant="outline" className="text-xs text-muted-foreground">None</Badge>
                      }
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PhoneFinder() {
  const uploadMutation = useUploadPhoneFinder();

  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedRecord[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const parseFile = useCallback(async (f: File) => {
    setParseError(null);
    try {
      const ab = await f.arrayBuffer();
      const wb = XLSX.read(ab, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]!];
      if (!sheet) throw new Error("No sheet found");
      const rows = XLSX.utils.sheet_to_json<ParsedRecord>(sheet, { defval: "", raw: false });
      if (!rows.length) throw new Error("No rows found in file");
      setPreview(rows.slice(0, 5));
      setFile(f);
    } catch (err: any) {
      setParseError(err?.message || "Could not parse file");
      setFile(null);
      setPreview([]);
    }
  }, []);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    const name = dropped.name.toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls")) {
      parseFile(dropped);
    } else {
      setParseError("Please upload a CSV or Excel file");
    }
  }, [parseFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
  };

  const handleStart = () => {
    if (!file) return;
    uploadMutation.mutate(file, {
      onSuccess: (data) => {
        setActiveJobId(data.jobId);
        setFile(null);
        setPreview([]);
      },
    });
  };

  const previewCols = preview.length > 0 ? Object.keys(preview[0]!).slice(0, 6) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Phone Finder</h1>
        <p className="text-muted-foreground mt-1">
          Upload a list of investor LLCs or companies — we find their phone numbers via Google Search and Google Maps.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle>Upload Investor List</CardTitle>
            <CardDescription>
              Accepts CSV or Excel. Auto-detects "Investor Name", "Buyer Adress" columns — or any name/address columns.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer
                ${dragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}
              `}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => document.getElementById("phone-file-upload")?.click()}
            >
              <input
                id="phone-file-upload"
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center">
                  <UploadCloud className={`w-7 h-7 ${dragActive ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                {file ? (
                  <div className="space-y-1">
                    <p className="font-medium flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-primary" />{file.name}
                    </p>
                    <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · {preview.length > 0 ? `${preview.length}+ rows detected` : ""}</p>
                  </div>
                ) : (
                  <div>
                    <p className="font-medium">Click or drag file to upload</p>
                    <p className="text-sm text-muted-foreground mt-1">CSV, XLSX, XLS — e.g. investor list with name + address columns</p>
                  </div>
                )}
              </div>
            </div>

            {parseError && (
              <Alert variant="destructive" className="bg-destructive/10 border-destructive/20">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Parse Error</AlertTitle>
                <AlertDescription>{parseError}</AlertDescription>
              </Alert>
            )}

            {preview.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Preview (first {preview.length} rows)</p>
                <div className="rounded-md border border-border/50 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {previewCols.map(col => (
                          <TableHead key={col} className="text-xs whitespace-nowrap">{col}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.map((row, i) => (
                        <TableRow key={i}>
                          {previewCols.map(col => (
                            <TableCell key={col} className="text-xs max-w-[150px] truncate" title={row[col]}>
                              {row[col] || "—"}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Button
                  className="w-full"
                  onClick={handleStart}
                  disabled={uploadMutation.isPending}
                >
                  <Search className="w-4 h-4 mr-2" />
                  {uploadMutation.isPending ? "Starting..." : "Find Phone Numbers"}
                </Button>
              </div>
            )}

            {uploadMutation.isError && (
              <Alert variant="destructive" className="bg-destructive/10 border-destructive/20">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{(uploadMutation.error as Error)?.message || "Failed to start job"}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
            <CardDescription>Google-powered phone lookup</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="space-y-3">
              {[
                { n: "1", t: "Upload your list", d: "CSV or Excel with investor/LLC names and addresses" },
                { n: "2", t: "Google Search", d: "Searches each company name + city/state for phone numbers" },
                { n: "3", t: "Google Maps", d: "Checks Google Places API for business phone numbers" },
                { n: "4", t: "Export results", d: "Download enriched CSV with phone numbers appended" },
              ].map(step => (
                <div key={step.n} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">{step.n}</div>
                  <div>
                    <p className="font-medium text-foreground text-xs">{step.t}</p>
                    <p className="text-xs">{step.d}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border/50 pt-3">
              <p className="text-xs font-medium text-foreground mb-1">Supported column names</p>
              <div className="flex flex-wrap gap-1">
                {["Investor Name", "Company", "Name", "Buyer Adress", "Address", "City", "State"].map(col => (
                  <Badge key={col} variant="outline" className="text-xs">{col}</Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {activeJobId && (
        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-primary" /> Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <JobResultPanel jobId={activeJobId} onClose={() => setActiveJobId(null)} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
