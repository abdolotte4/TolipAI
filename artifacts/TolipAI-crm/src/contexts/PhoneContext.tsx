import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { Device, Call } from "@twilio/voice-sdk";

export type PhoneStatus =
  | "idle"
  | "initializing"
  | "ready"
  | "calling"
  | "in-progress"
  | "disconnecting"
  | "error";

export interface IncomingCallInfo {
  phone: string;
  leadName: string | null;
  leadId: number | null;
}

export interface CallAnalytics {
  mos: number | null;
  jitter: number | null;
  packetLoss: number | null;
}

export interface TranscriptSegment {
  track: "inbound" | "outbound";
  text: string;
  ts: number;
}

interface PhoneContextValue {
  status: PhoneStatus;
  errorMsg: string;
  muted: boolean;
  held: boolean;
  duration: number;
  analytics: CallAnalytics;
  lastAnalytics: CallAnalytics;
  callerIdUsed: string | null;
  currentCallSid: string | null;
  incomingCallInfo: IncomingCallInfo | null;
  hasPendingIncoming: boolean;
  activeLeadId: number | null;
  activeLeadName: string | null;
  liveTranscript: TranscriptSegment[];
  aiSuggestion: string | null;
  clearAiSuggestion: () => void;

  initDevice: () => Promise<boolean>;
  startCall: (phone: string, leadId: number | null, leadName: string, record: boolean) => Promise<void>;
  hangUp: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  sendDTMF: (digit: string) => void;
  acceptIncoming: (leadId?: number | null) => void;
  declineIncoming: () => void;
  resetLastCall: () => void;
  clearTranscript: () => void;
}

const PhoneContext = createContext<PhoneContextValue | null>(null);

function authFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem("crm_token");
  return fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  }).then(async (r) => {
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((json as any)?.error || `HTTP ${r.status}`);
    return json;
  });
}

function playRing(stopSignal: { stopped: boolean }): () => void {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    let t = ctx.currentTime;

    const schedule = () => {
      if (stopSignal.stopped) return;
      [0, 0.2].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 440;
        gain.gain.setValueAtTime(0.15, t + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.15);
        osc.start(t + offset);
        osc.stop(t + offset + 0.15);
      });
      t += 2.0;
    };

    const interval = setInterval(() => {
      if (stopSignal.stopped) {
        clearInterval(interval);
        setTimeout(() => ctx.close(), 500);
        return;
      }
      schedule();
    }, 2000);

    schedule();

    return () => {
      stopSignal.stopped = true;
      clearInterval(interval);
      setTimeout(() => ctx.close(), 500);
    };
  } catch {
    return () => {};
  }
}

export function PhoneProvider({ children }: { children: ReactNode }) {
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentCallSidRef = useRef<string | null>(null);
  const pendingIncomingCallRef = useRef<Call | null>(null);
  const pendingAcceptLeadIdRef = useRef<{ leadId?: number | null } | null>(null);
  const ringStopRef = useRef<(() => void) | null>(null);
  const analyticsRef = useRef<CallAnalytics>({ mos: null, jitter: null, packetLoss: null });
  const speechRecognitionRef = useRef<any>(null);

  const [status, setStatus] = useState<PhoneStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [duration, setDuration] = useState(0);
  const [analytics, setAnalytics] = useState<CallAnalytics>({ mos: null, jitter: null, packetLoss: null });
  const [lastAnalytics, setLastAnalytics] = useState<CallAnalytics>({ mos: null, jitter: null, packetLoss: null });
  const [callerIdUsed, setCallerIdUsed] = useState<string | null>(null);
  const [currentCallSid, setCurrentCallSid] = useState<string | null>(null);
  const [incomingCallInfo, setIncomingCallInfo] = useState<IncomingCallInfo | null>(null);
  const [hasPendingIncoming, setHasPendingIncoming] = useState(false);
  const [activeLeadId, setActiveLeadId] = useState<number | null>(null);
  const [activeLeadName, setActiveLeadName] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<TranscriptSegment[]>([]);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  const stopRing = useCallback(() => {
    if (ringStopRef.current) {
      ringStopRef.current();
      ringStopRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearTranscript = useCallback(() => {
    setLiveTranscript([]);
    setAiSuggestion(null);
  }, []);

  useEffect(() => {
    return () => {
      stopRing();
      stopTimer();
      if (callRef.current) { callRef.current.disconnect(); callRef.current = null; }
      if (deviceRef.current) { deviceRef.current.destroy(); deviceRef.current = null; }
    };
  }, [stopRing, stopTimer]);

  // Auto-register the device for inbound calls if the user previously initialised it.
  // This lets inbound Twilio calls ring in the browser without the agent manually clicking
  // "Initialize Dialer" every session.
  useEffect(() => {
    const shouldAutoInit = localStorage.getItem("crm_phone_auto_init") === "true";
    if (!shouldAutoInit) return;
    const token = localStorage.getItem("crm_token");
    if (!token) return;
    // Defer slightly so the page finishes rendering before we request mic permissions
    const t = setTimeout(() => { initDevice().catch(() => {}); }, 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initDevice = useCallback(async (): Promise<boolean> => {
    if (deviceRef.current) return true;
    setStatus("initializing");
    setErrorMsg("");
    try {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (micErr: any) {
        const name = micErr?.name || "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setErrorMsg("Microphone access denied. Allow microphone in your browser settings and retry.");
          setStatus("error");
          return false;
        }
        if (name === "NotFoundError" || name === "NotReadableError") {
          setErrorMsg("No microphone found or it is in use by another app.");
          setStatus("error");
          return false;
        }
      }

      const { token, callerId } = await authFetch("/twilio/voice/token", { method: "POST" });
      setCallerIdUsed(callerId || null);

      const device = new Device(token, {
        logLevel: "warn",
        codecPreferences: ["opus", "pcmu"] as any,
        audioConstraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      } as any);

      device.on("error", (err: any) => {
        const msg = err?.message || "Device error";
        setErrorMsg(msg);
        setStatus("error");
      });

      device.on("tokenWillExpire", async () => {
        try {
          const { token: newToken } = await authFetch("/twilio/voice/token", { method: "POST" });
          device.updateToken(newToken);
        } catch { }
      });

      await device.register();

      device.on("incoming", (call: Call) => {
        pendingIncomingCallRef.current = call;
        const phone = (call.parameters as any)?.From || "";
        setIncomingCallInfo((prev) => ({
          phone,
          leadName: prev?.leadName ?? null,
          leadId: prev?.leadId ?? null,
        }));
        setHasPendingIncoming(true);

        // If the user already clicked Accept before the Device fired (SSE arrived first),
        // honour that intent now and accept the call immediately.
        const pendingAccept = pendingAcceptLeadIdRef.current;
        if (pendingAccept) {
          pendingAcceptLeadIdRef.current = null;
          // Small defer so state setters above flush first
          setTimeout(() => acceptIncoming(pendingAccept.leadId), 0);
          return;
        }

        if (!ringStopRef.current) {
          const stopSignal = { stopped: false };
          ringStopRef.current = playRing(stopSignal);
        }

        call.on("cancel", () => {
          stopRing();
          pendingIncomingCallRef.current = null;
          pendingAcceptLeadIdRef.current = null;
          setIncomingCallInfo(null);
          setHasPendingIncoming(false);
        });
      });

      deviceRef.current = device;
      setStatus("ready");
      // Remember that the device was successfully initialised so we can auto-register on next load
      try { localStorage.setItem("crm_phone_auto_init", "true"); } catch { }
      return true;
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to initialize browser dialer");
      setStatus("error");
      return false;
    }
  }, [stopRing]);

  const startCall = useCallback(
    async (phone: string, leadId: number | null, leadName: string, record: boolean) => {
      const ready = await initDevice();
      if (!ready || !deviceRef.current) return;

      setStatus("calling");
      setDuration(0);
      setAnalytics({ mos: null, jitter: null, packetLoss: null });
      analyticsRef.current = { mos: null, jitter: null, packetLoss: null };
      setMuted(false);
      setHeld(false);
      setActiveLeadId(leadId);
      setActiveLeadName(leadName);
      clearTranscript();

      const params: Record<string, string> = {
        To: phone,
        CallerId: callerIdUsed || "",
        ...(record ? { Record: "true" } : {}),
      };

      const call = await deviceRef.current.connect({ params });
      callRef.current = call;

      call.on("accept", async (c: Call) => {
        setStatus("in-progress");
        const sid = c.parameters?.CallSid || null;
        currentCallSidRef.current = sid;
        setCurrentCallSid(sid);
        timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);

        try {
          await authFetch("/twilio/voice/log", {
            method: "POST",
            body: JSON.stringify({
              callSid: sid,
              leadId: leadId ?? null,
              toNumber: phone,
              fromNumber: callerIdUsed,
              direction: "outbound",
            }),
          });
        } catch { }
      });

      call.on("sample", (sample: any) => {
        if (!sample) return;
        const newAnalytics = {
          mos: typeof sample.mos === "number" ? Math.round(sample.mos * 100) / 100 : null,
          jitter: typeof sample.jitter === "number" ? Math.round(sample.jitter * 10) / 10 : null,
          packetLoss: typeof sample.packetsLostFraction === "number"
            ? Math.round(sample.packetsLostFraction * 1000) / 10 : null,
        };
        analyticsRef.current = newAnalytics;
        setAnalytics(newAnalytics);
      });

      const onDisconnect = async () => {
        stopTimer();
        setStatus("idle");
        setHeld(false);
        const sid = currentCallSidRef.current;
        const finalAnalytics = analyticsRef.current;
        setLastAnalytics(finalAnalytics);

        if (sid) {
          try {
            await authFetch(`/twilio/voice/log/${sid}`, {
              method: "PATCH",
              body: JSON.stringify({
                status: "completed",
                mos: finalAnalytics.mos,
                jitter: finalAnalytics.jitter,
                packetLoss: finalAnalytics.packetLoss,
              }),
            });
          } catch { }
        }
        callRef.current = null;
        currentCallSidRef.current = null;
        setCurrentCallSid(null);
      };

      call.on("disconnect", onDisconnect);
      call.on("cancel", onDisconnect);
      call.on("error", (err: any) => {
        stopTimer();
        setErrorMsg(err?.message || "Call error");
        setStatus("error");
        setHeld(false);
        callRef.current = null;
        currentCallSidRef.current = null;
        setCurrentCallSid(null);
      });
    },
    [initDevice, callerIdUsed, stopTimer, clearTranscript]
  );

  const hangUp = useCallback(() => {
    setStatus("disconnecting");
    if (callRef.current) {
      callRef.current.disconnect();
    } else {
      setStatus("idle");
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (!callRef.current) return;
    const next = !muted;
    callRef.current.mute(next);
    setMuted(next);
  }, [muted]);

  const toggleHold = useCallback(() => {
    if (!callRef.current || status !== "in-progress") return;
    const newHeld = !held;
    // Apply local mute immediately so the caller can't hear the agent during hold
    callRef.current.mute(newHeld);
    setHeld(newHeld);
    // Also call backend to set conference hold (plays music to the caller)
    const sid = currentCallSidRef.current;
    if (sid) {
      authFetch("/twilio/voice/hold", {
        method: "POST",
        body: JSON.stringify({ callSid: sid, hold: newHeld }),
      }).catch(() => { /* non-fatal — local mute still applied */ });
    }
  }, [held, status]);

  const sendDTMF = useCallback((digit: string) => {
    if (!callRef.current) return;
    callRef.current.sendDigits(digit);
  }, []);

  const acceptIncoming = useCallback((leadId?: number | null) => {
    const call = pendingIncomingCallRef.current;
    if (!call) {
      // Device hasn't fired `incoming` yet (SSE arrived before Twilio SDK event).
      // Store the intent — it will be auto-accepted once the Device fires.
      // Stop the ring immediately so the UI doesn't keep ringing while we wait.
      stopRing();
      pendingAcceptLeadIdRef.current = { leadId };
      return;
    }
    stopRing();
    pendingIncomingCallRef.current = null;
    setHasPendingIncoming(false);

    callRef.current = call;
    setStatus("in-progress");
    setDuration(0);
    setAnalytics({ mos: null, jitter: null, packetLoss: null });
    analyticsRef.current = { mos: null, jitter: null, packetLoss: null };
    setMuted(false);
    setHeld(false);
    clearTranscript();

    const phone = (call.parameters as any)?.From || "";
    if (leadId !== undefined) setActiveLeadId(leadId ?? null);

    call.on("sample", (sample: any) => {
      if (!sample) return;
      const newAnalytics = {
        mos: typeof sample.mos === "number" ? Math.round(sample.mos * 100) / 100 : null,
        jitter: typeof sample.jitter === "number" ? Math.round(sample.jitter * 10) / 10 : null,
        packetLoss: typeof sample.packetsLostFraction === "number"
          ? Math.round(sample.packetsLostFraction * 1000) / 10 : null,
      };
      analyticsRef.current = newAnalytics;
      setAnalytics(newAnalytics);
    });

    call.on("disconnect", async () => {
      stopTimer();
      setStatus("idle");
      setHeld(false);
      const sid = currentCallSidRef.current;
      const finalAnalytics = analyticsRef.current;
      setLastAnalytics(finalAnalytics);

      if (sid) {
        try {
          await authFetch(`/twilio/voice/log/${sid}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: "completed",
              mos: finalAnalytics.mos,
              jitter: finalAnalytics.jitter,
              packetLoss: finalAnalytics.packetLoss,
            }),
          });
        } catch { }
      }
      callRef.current = null;
      currentCallSidRef.current = null;
      setCurrentCallSid(null);
      setIncomingCallInfo(null);
    });

    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    call.accept();

    const sid = (call.parameters as any)?.CallSid;
    if (sid) {
      currentCallSidRef.current = sid;
      setCurrentCallSid(sid);
      authFetch("/twilio/voice/log", {
        method: "POST",
        body: JSON.stringify({
          callSid: sid,
          leadId: leadId ?? null,
          fromNumber: phone,
          toNumber: null,
          direction: "inbound",
        }),
      }).catch(() => {});
    }
  }, [stopRing, stopTimer, clearTranscript]);

  const declineIncoming = useCallback(() => {
    stopRing();
    pendingIncomingCallRef.current?.reject();
    pendingIncomingCallRef.current = null;
    pendingAcceptLeadIdRef.current = null;
    setIncomingCallInfo(null);
    setHasPendingIncoming(false);
  }, [stopRing]);

  const resetLastCall = useCallback(() => {
    setLastAnalytics({ mos: null, jitter: null, packetLoss: null });
    setActiveLeadId(null);
    setActiveLeadName(null);
    setCurrentCallSid(null);
  }, []);

  // ── Browser SpeechRecognition — transcribes the agent's microphone live ──────
  useEffect(() => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;

    if (status === "in-progress") {
      try {
        const recognition = new SpeechRec();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = "en-US";
        recognition.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              const text = (result[0]?.transcript || "").trim();
              if (text) {
                setLiveTranscript(prev => [...prev.slice(-99), { track: "outbound", text, ts: Date.now() }]);
              }
            }
          }
        };
        recognition.onerror = () => {};
        recognition.onend = () => {
          if (speechRecognitionRef.current === recognition && callRef.current) {
            try { recognition.start(); } catch { }
          }
        };
        recognition.start();
        speechRecognitionRef.current = recognition;
      } catch { }
    } else {
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.abort(); } catch { }
        speechRecognitionRef.current = null;
      }
    }

    return () => {
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.abort(); } catch { }
        speechRecognitionRef.current = null;
      }
    };
  }, [status]);

  // ── SSE: incoming call metadata + live transcript ────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem("crm_token");
    if (!token) return;
    let es: EventSource | null = null;
    let cancelled = false;
    fetch("/api/crm/auth/sse-token", { method: "POST", headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(({ token: sseToken }: { token: string }) => {
        if (cancelled) return;
        es = new EventSource(`/api/crm/events?token=${encodeURIComponent(sseToken)}`);

        es.addEventListener("incoming_call", (e: MessageEvent) => {
          try {
            const d = JSON.parse(e.data);
            setIncomingCallInfo((prev) => ({
              phone: prev?.phone ?? d.phone ?? "",
              leadName: d.leadName ?? prev?.leadName ?? null,
              leadId: d.leadId ?? prev?.leadId ?? null,
            }));
            setHasPendingIncoming(true);
            if (!ringStopRef.current) {
              const stopSignal = { stopped: false };
              ringStopRef.current = playRing(stopSignal);
            }
            if (!deviceRef.current) {
              initDevice().catch(() => {});
            }
          } catch { }
        });

        es.addEventListener("call_transcript", (e: MessageEvent) => {
          try {
            const d = JSON.parse(e.data);
            const callSid = currentCallSidRef.current;
            if (!callSid || d.callSid !== callSid) return;
            const seg = d.segment as TranscriptSegment;
            if (!seg?.text) return;
            setLiveTranscript((prev) => [...prev.slice(-99), seg]);
          } catch { }
        });

        es.addEventListener("call_suggestion", (e: MessageEvent) => {
          try {
            const d = JSON.parse(e.data);
            const callSid = currentCallSidRef.current;
            if (!callSid || d.callSid !== callSid) return;
            if (d.suggestion) setAiSuggestion(d.suggestion);
          } catch { }
        });
      })
      .catch(() => {});
    return () => { cancelled = true; es?.close(); };
  }, []);

  const value: PhoneContextValue = {
    status,
    errorMsg,
    muted,
    held,
    duration,
    analytics,
    lastAnalytics,
    callerIdUsed,
    currentCallSid,
    incomingCallInfo,
    hasPendingIncoming,
    activeLeadId,
    activeLeadName,
    liveTranscript,
    aiSuggestion,
    clearAiSuggestion: () => setAiSuggestion(null),
    initDevice,
    startCall,
    hangUp,
    toggleMute,
    toggleHold,
    sendDTMF,
    acceptIncoming,
    declineIncoming,
    resetLastCall,
    clearTranscript,
  };

  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}

export function usePhone(): PhoneContextValue {
  const ctx = useContext(PhoneContext);
  if (!ctx) throw new Error("usePhone must be used inside PhoneProvider");
  return ctx;
}
