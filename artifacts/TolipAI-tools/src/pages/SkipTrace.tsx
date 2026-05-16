import { useState, useCallback } from "react";
import { useToolsStatus, useSkipTraceJobs, useUploadSkipTrace, useSkipTraceJobStatus } from "@/hooks/use-tools";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, FileSpreadsheet, Download, AlertTriangle, CheckCircle2, Clock, PlayCircle } from "lucide-react";
import { format } from "date-fns";

function JobStatusRow({ jobId }: { jobId: string }) {
  const { data: job, isLoading } = useSkipTraceJobStatus(jobId);
  const { pin } = useAuth();

  if (isLoading || !job) return (
    <div className="flex items-center justify-between p-4 border rounded-lg animate-pulse bg-muted/20">
      <div className="h-4 bg-muted rounded w-1/4"></div>
      <div className="h-4 bg-muted rounded w-1/4"></div>
    </div>
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed": return <Badge variant="default" className="bg-green-500/10 text-green-500 border-green-500/20"><CheckCircle2 className="w-3 h-3 mr-1" /> Completed</Badge>;
      case "running": return <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 border-blue-500/20"><PlayCircle className="w-3 h-3 mr-1 animate-pulse" /> Running</Badge>;
      case "queued": return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" /> Queued</Badge>;
      case "failed": return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" /> Failed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleDownload = async () => {
    try {
      const res = await fetch(`/api/tools/skip-trace/download/${jobId}`, {
        headers: { "X-Tools-Pin": pin || "" }
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
      a.download = `contact-enrichment-${jobId.substring(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Download failed. Please try again.");
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 border border-border/50 rounded-lg bg-card hover:bg-accent/5 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
          <div className="flex flex-col">
            <span className="font-medium font-mono text-sm">{jobId.substring(0, 8)}...</span>
            <span className="text-xs text-muted-foreground">
              {job.startedAt ? format(new Date(job.startedAt), 'MMM d, yyyy HH:mm') : 'Waiting...'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {getStatusBadge(job.status)}
          {job.status === "completed" && (
            <Button size="sm" onClick={handleDownload} variant="outline" className="h-8">
              <Download className="w-4 h-4 mr-2" />
              Download CSV
            </Button>
          )}
        </div>
      </div>
      
      {(job.status === "running" || job.status === "completed") && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{job.processed} / {job.totalRecords} records processed</span>
            <span>{job.progressPercent}%</span>
          </div>
          <Progress value={job.progressPercent} className="h-1.5" />
          <div className="flex gap-4 text-xs">
            <span className="text-green-500">{job.succeeded} found</span>
            <span className="text-red-400">{job.failed} not found</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SkipTrace() {
  const { data: status } = useToolsStatus();
  const { data: jobsData } = useSkipTraceJobs();
  const uploadMutation = useUploadSkipTrace();
  
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);

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
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      const name = droppedFile.name.toLowerCase();
      if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls')) {
        setFile(droppedFile);
      } else {
        alert("Please upload a CSV or Excel (.xlsx / .xls) file");
      }
    }
  }, []);

  const handleUpload = () => {
    if (file) {
      uploadMutation.mutate(file, {
        onSuccess: () => setFile(null)
      });
    }
  };

  const isConfigured = status?.skipTraceConfigured;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Contact Enrichment</h1>
        <p className="text-muted-foreground mt-1">Upload lists up to 50,000 records for automated contact data enrichment.</p>
      </div>

      {status && !isConfigured && (
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Contact Enrichment Not Configured</AlertTitle>
          <AlertDescription>
            The Contact Enrichment API is not configured. Please set the required environment variables to use this feature.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle>Upload List</CardTitle>
            <CardDescription>Drag and drop your CSV or Excel file here. We will auto-detect columns.</CardDescription>
          </CardHeader>
          <CardContent>
            <div 
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-all
                ${dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}
                ${!isConfigured ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}
              `}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => isConfigured && document.getElementById('file-upload')?.click()}
            >
              <input 
                id="file-upload" 
                type="file" 
                accept=".csv,.xlsx,.xls" 
                className="hidden" 
                onChange={(e) => {
                  if (e.target.files?.[0]) setFile(e.target.files[0]);
                }}
              />
              
              <div className="flex flex-col items-center justify-center gap-4">
                <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
                  <UploadCloud className={`w-8 h-8 ${dragActive ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                {file ? (
                  <div className="space-y-2">
                    <p className="font-medium text-lg">{file.name}</p>
                    <p className="text-sm text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    <Button 
                      className="mt-4 w-full" 
                      onClick={(e) => { e.stopPropagation(); handleUpload(); }}
                      disabled={uploadMutation.isPending}
                    >
                      {uploadMutation.isPending ? "Uploading..." : "Start Processing"}
                    </Button>
                  </div>
                ) : (
                  <div>
                    <p className="text-lg font-medium">Click or drag file to upload</p>
                    <p className="text-sm text-muted-foreground mt-1">Accepts CSV, XLSX, XLS — Separate columns (Street, City, State, Zip) or a single combined column ("120 W 3RD ST,TULSA,OK 74103")</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm flex flex-col">
          <CardHeader>
            <CardTitle>Recent Jobs</CardTitle>
            <CardDescription>Your processing history</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto pr-2 pb-2">
            <div className="space-y-3">
              {jobsData?.jobs?.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground text-sm border border-dashed rounded-lg">
                  No jobs run yet
                </div>
              ) : (
                jobsData?.jobs?.map((job: any) => (
                  <JobStatusRow key={job.jobId} jobId={job.jobId} />
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
