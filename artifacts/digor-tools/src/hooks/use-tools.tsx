import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import * as XLSX from "xlsx";

async function fetchApi(endpoint: string, options: RequestInit = {}, pin: string | null) {
  if (!pin) throw new Error("No PIN provided");
  const headers = new Headers(options.headers);
  headers.set("X-Tools-Pin", pin);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(endpoint, { ...options, headers });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `API Error: ${res.status}`);
  }
  return res.json();
}

export function useToolsStatus() {
  const { pin } = useAuth();
  return useQuery({
    queryKey: ["tools", "status"],
    queryFn: () => fetchApi("/api/tools/auth/verify", {}, pin),
    enabled: !!pin,
  });
}

export function useSkipTraceJobs() {
  const { pin } = useAuth();
  return useQuery({
    queryKey: ["skipTrace", "jobs"],
    queryFn: () => fetchApi("/api/tools/skip-trace/jobs", {}, pin),
    enabled: !!pin,
  });
}

export function useSkipTraceJobStatus(jobId: string | null) {
  const { pin } = useAuth();
  return useQuery({
    queryKey: ["skipTrace", "job", jobId],
    queryFn: () => fetchApi(`/api/tools/skip-trace/status/${jobId}`, {}, pin),
    enabled: !!pin && !!jobId,
    refetchInterval: (query) => {
      const state = query.state.data?.status;
      return (state === "running" || state === "queued") ? 3000 : false;
    }
  });
}

async function parseFileToRecords(file: File): Promise<Record<string, string>[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("No sheets found in file");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("Could not read sheet");
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "", raw: false });
  if (!rows.length) throw new Error("No data rows found in file");
  return rows;
}

export function useUploadSkipTrace() {
  const { pin } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const records = await parseFileToRecords(file);
      return fetchApi("/api/tools/skip-trace/upload", {
        method: "POST",
        body: JSON.stringify({ records, filename: file.name }),
        headers: { "Content-Type": "application/json" },
      }, pin);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skipTrace", "jobs"] });
    }
  });
}

export function useDistressedJobs() {
  const { pin } = useAuth();
  return useQuery({
    queryKey: ["distressed", "jobs"],
    queryFn: () => fetchApi("/api/tools/distressed/jobs", {}, pin),
    enabled: !!pin,
  });
}

export function useDistressedJobStatus(jobId: string | null) {
  const { pin } = useAuth();
  return useQuery({
    queryKey: ["distressed", "job", jobId],
    queryFn: () => fetchApi(`/api/tools/distressed/status/${jobId}`, {}, pin),
    enabled: !!pin && !!jobId,
    refetchInterval: (query) => {
      const state = query.state.data?.status;
      return (state === "running" || state === "queued") ? 3000 : false;
    }
  });
}

export function useSearchDistressed() {
  const { pin } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => fetchApi("/api/tools/distressed/search", {
      method: "POST",
      body: JSON.stringify(data),
    }, pin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distressed", "jobs"] });
    }
  });
}
