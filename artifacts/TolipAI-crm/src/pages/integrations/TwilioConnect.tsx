import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Phone, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2,
  ExternalLink, RefreshCw, Zap, ShieldCheck, MessageSquare,
  PhoneCall, ChevronRight, ArrowLeft, Info, Copy, Check, Mic,
  Building2,
} from "lucide-react";
import { apiRawFetch as apiFetch } from "@/lib/api";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCrmGetMe } from "@workspace/api-client-react";


function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function TwilioConnect() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useCrmGetMe();
  const isAdmin = me?.role === "admin" || me?.role === "super_admin";
  const isSuperAdmin = me?.role === "super_admin";

  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [apiKeySid, setApiKeySid] = useState("");
  const [apiKeySecret, setApiKeySecret] = useState("");
  const [voiceAppSid, setVoiceAppSid] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  // Super admin campaign selector — null means "global / session" mode
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  // Fetch campaign list for super admin
  const { data: campaigns } = useQuery<any[]>({
    queryKey: ["campaigns-list"],
    queryFn: () => apiFetch("/crm/campaigns"),
    enabled: !!isSuperAdmin,
    retry: false,
  });

  // Build config query key — changes when super admin switches campaign
  const configQueryKey = isSuperAdmin && selectedCampaignId
    ? ["twilio-config", selectedCampaignId]
    : ["twilio-config"];

  const configUrl = isSuperAdmin && selectedCampaignId
    ? `/twilio/config?campaignId=${selectedCampaignId}`
    : "/twilio/config";

  const { data: config, isLoading } = useQuery<any>({
    queryKey: configQueryKey,
    queryFn: () => apiFetch(configUrl),
    retry: false,
  });

  const { data: guide } = useQuery<any>({
    queryKey: ["twilio-setup-guide"],
    queryFn: () => apiFetch("/twilio/setup-guide"),
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: (body: {
      accountSid: string; authToken: string; phoneNumber: string; twilioEnabled: boolean;
      apiKeySid: string; apiKeySecret: string; voiceAppSid: string; campaignId?: number;
    }) => apiFetch("/twilio/config", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      const noTarget = isSuperAdmin && !selectedCampaignId;
      const campaignName = campaigns?.find((c: any) => c.id === selectedCampaignId)?.name;
      toast({
        title: "Twilio credentials saved",
        description: noTarget
          ? "Credentials active for this session. To persist across deploys, set TWILIO_* environment variables in Railway."
          : `Campaign "${campaignName}" is now connected to Twilio.`,
      });
      setAccountSid(""); setAuthToken(""); setPhoneNumber("");
      setApiKeySid(""); setApiKeySecret(""); setVoiceAppSid("");
      qc.invalidateQueries({ queryKey: configQueryKey });
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  async function handleSetupWebhooks() {
    setSettingUp(true);
    try {
      const result = await apiFetch("/twilio/setup-webhooks", { method: "POST" });
      toast({
        title: `Webhooks configured on ${result.configured} number(s)`,
        description: "Inbound SMS will now appear automatically in the CRM.",
      });
      qc.invalidateQueries({ queryKey: configQueryKey });
    } catch (err: any) {
      toast({ title: "Webhook setup failed", description: err.message, variant: "destructive" });
    } finally {
      setSettingUp(false);
    }
  }

  const isConfigured = config?.configured;
  const isEnabled = config?.twilioEnabled;
  const isVoiceConfigured = config?.voiceConfigured;
  const isSuperAdminNoTarget = isSuperAdmin && !selectedCampaignId;

  const selectedCampaignName = campaigns?.find((c: any) => c.id === selectedCampaignId)?.name;

  return (
    <div className="space-y-6 pb-20 max-w-3xl">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
        <Link href="/integrations">
          <Button variant="ghost" size="icon" className="rounded-xl border border-white/10 bg-card hover:bg-secondary">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-display font-bold">Twilio Integration</h1>
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : isConfigured && isEnabled ? (
              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 border text-xs">Active</Badge>
            ) : isConfigured ? (
              <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 border text-xs">Disabled</Badge>
            ) : (
              <Badge className="bg-secondary text-muted-foreground border-white/10 border text-xs">Not configured</Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">
            {me?.campaignName ? (
              <span>Campaign: <span className="text-foreground font-medium">{me.campaignName}</span> · </span>
            ) : null}
            Click-to-call, browser dialer, and two-way SMS for your campaign leads.
          </p>
        </div>
      </motion.div>

      {/* ── Super Admin Campaign Selector ── */}
      {isSuperAdmin && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
            <div className="p-5 border-b border-border bg-secondary/20">
              <h2 className="font-semibold flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                Configure Campaign
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Select which campaign you want to configure Twilio credentials for.
              </p>
            </div>
            <div className="p-5">
              <Label className="mb-2 block">Target Campaign</Label>
              <select
                className="w-full bg-background/50 border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
                value={selectedCampaignId ?? ""}
                onChange={e => {
                  const val = e.target.value;
                  setSelectedCampaignId(val === "" ? null : Number(val));
                  // Clear form fields when switching campaigns
                  setAccountSid(""); setAuthToken(""); setPhoneNumber("");
                  setApiKeySid(""); setApiKeySecret(""); setVoiceAppSid("");
                }}
              >
                <option value="">— Global / Session (no campaign) —</option>
                {(campaigns || []).map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.slug ? `(${c.slug})` : ""}
                  </option>
                ))}
              </select>
              {selectedCampaignId && selectedCampaignName && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  Credentials saved below will be stored in the database for campaign{" "}
                  <span className="font-semibold text-foreground">{selectedCampaignName}</span> and persist across Railway deploys.
                </p>
              )}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Super admin global/session notice — only shown when no campaign selected */}
      {isSuperAdminNoTarget && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/8 border border-amber-500/25 text-amber-300">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div className="text-xs space-y-1">
              <p className="font-semibold text-amber-400">Global / Session Mode</p>
              <p className="text-amber-300/80">
                Credentials saved here become active immediately for <span className="font-medium">this server session only</span>.
                They will be cleared on the next Railway deploy or restart.
              </p>
              <p className="text-amber-300/80">
                For permanent storage, either <span className="font-medium">select a specific campaign above</span> or add Railway environment variables:{" "}
                <span className="font-mono text-amber-400">TWILIO_ACCOUNT_SID</span>,{" "}
                <span className="font-mono text-amber-400">TWILIO_AUTH_TOKEN</span>,{" "}
                <span className="font-mono text-amber-400">TWILIO_VOICE_CALLER_ID</span>.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Status Card */}
      {isConfigured && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
            <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isEnabled ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
                  {isEnabled ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertCircle className="w-5 h-5 text-amber-400" />}
                </div>
                <div>
                  <p className="font-semibold text-sm">
                    {selectedCampaignName ? `${selectedCampaignName} Connected` : "Campaign Connected"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Account SID: <span className="font-mono">{config?.accountSid?.slice(0, 8)}...{config?.accountSid?.slice(-4)}</span>
                    {config?.phoneNumber && <span> · {config.phoneNumber}</span>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className={`h-8 text-xs gap-1.5 ${settingUp ? "" : "border-blue-500/30 text-blue-400 hover:bg-blue-500/10"}`}
                  disabled={settingUp || !isEnabled}
                  onClick={handleSetupWebhooks}
                >
                  {settingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  Auto-Configure Webhooks
                </Button>
                <a href="https://console.twilio.com/" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
                    <ExternalLink className="w-3.5 h-3.5" /> Twilio Console
                  </Button>
                </a>
              </div>
            </div>
            <div className="grid grid-cols-4 divide-x divide-border border-t border-border">
              {[
                { icon: MessageSquare, label: "SMS", desc: "Send & receive texts" },
                { icon: PhoneCall, label: "Click-to-Call", desc: "Bridge calls via Twilio" },
                { icon: Mic, label: "Browser Dialer", desc: isVoiceConfigured ? "Configured" : "Needs API Key", active: isVoiceConfigured },
                { icon: ShieldCheck, label: "Webhooks", desc: "Inbound message sync" },
              ].map(({ icon: Icon, label, desc, active }) => (
                <div key={label} className="p-4 flex flex-col items-center text-center gap-1">
                  <Icon className={`w-4 h-4 mb-1 ${active === false ? "text-amber-400" : "text-primary"}`} />
                  <p className="text-xs font-semibold">{label}</p>
                  <p className={`text-[10px] ${active === false ? "text-amber-400" : "text-muted-foreground"}`}>{desc}</p>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Credentials Form */}
      {isAdmin && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
            <div className="p-5 border-b border-border bg-secondary/20">
              <h2 className="font-semibold flex items-center gap-2">
                <Phone className="w-4 h-4 text-primary" />
                {isConfigured ? "Update Credentials" : "Connect Twilio"}
                {selectedCampaignName && (
                  <span className="text-xs text-muted-foreground font-normal">for {selectedCampaignName}</span>
                )}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Find your credentials at{" "}
                <a href="https://console.twilio.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  console.twilio.com
                </a>
              </p>
            </div>
            <div className="p-5 space-y-5">

              {/* ── SMS / Core Credentials ── */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Core SMS Credentials</p>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Account SID</Label>
                    <div className="relative">
                      <Input
                        className="bg-background/50 rounded-xl font-mono text-sm pr-10"
                        placeholder={isConfigured ? config?.accountSid || "AC••••••••••••••••••••••••••••••••" : "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
                        value={accountSid}
                        onChange={e => setAccountSid(e.target.value)}
                      />
                      {accountSid && (
                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                          <CopyButton text={accountSid} />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Starts with "AC" — found on your Twilio Console dashboard.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Auth Token</Label>
                    <div className="relative">
                      <Input
                        type={showToken ? "text" : "password"}
                        className="bg-background/50 rounded-xl font-mono text-sm pr-10"
                        placeholder={isConfigured ? config?.authTokenMasked || "••••••••••••••••••••••••" : "Your Auth Token"}
                        value={authToken}
                        onChange={e => setAuthToken(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Stored encrypted — never sent to third parties.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Phone Number <span className="text-muted-foreground font-normal">(optional — leave blank to auto-select from account)</span></Label>
                    <Input
                      className="bg-background/50 rounded-xl font-mono text-sm"
                      placeholder={isConfigured && config?.phoneNumber ? config.phoneNumber : "+1 (555) 000-0000"}
                      value={phoneNumber}
                      onChange={e => setPhoneNumber(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">Your Twilio number in E.164 format, e.g. +17035551234</p>
                  </div>
                </div>
              </div>

              {/* ── Browser Voice / API Key Credentials ── */}
              <div className="pt-2 border-t border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Browser Calling (Voice SDK)</p>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Required for in-browser calling. Create an API Key at{" "}
                  <a href="https://console.twilio.com/us1/account/keys-credentials/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    console.twilio.com → API Keys
                  </a>
                  {" "}and a TwiML App at{" "}
                  <a href="https://console.twilio.com/us1/develop/voice/twiml-apps" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    TwiML Apps
                  </a>.
                </p>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>API Key SID</Label>
                    <div className="relative">
                      <Input
                        className="bg-background/50 rounded-xl font-mono text-sm pr-10"
                        placeholder={isConfigured ? config?.apiKeySid || "SK••••••••••••••••••••••••••••••••" : "SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
                        value={apiKeySid}
                        onChange={e => setApiKeySid(e.target.value)}
                      />
                      {apiKeySid && (
                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                          <CopyButton text={apiKeySid} />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Starts with "SK" — used to generate browser Voice tokens.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>API Key Secret</Label>
                    <div className="relative">
                      <Input
                        type={showApiSecret ? "text" : "password"}
                        className="bg-background/50 rounded-xl font-mono text-sm pr-10"
                        placeholder={isConfigured ? config?.apiKeySecretMasked || "••••••••••••••••••••••••" : "API Key Secret"}
                        value={apiKeySecret}
                        onChange={e => setApiKeySecret(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiSecret(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showApiSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Stored encrypted — only displayed once by Twilio when created.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>TwiML App SID (Voice)</Label>
                    <div className="relative">
                      <Input
                        className="bg-background/50 rounded-xl font-mono text-sm pr-10"
                        placeholder={isConfigured ? config?.voiceAppSid || "AP••••••••••••••••••••••••••••••••" : "APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
                        value={voiceAppSid}
                        onChange={e => setVoiceAppSid(e.target.value)}
                      />
                      {voiceAppSid && (
                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                          <CopyButton text={voiceAppSid} />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Starts with "AP". Set its Voice Request URL to:{" "}
                      <span className="font-mono text-primary">
  {typeof window !== 'undefined' ? window.location.origin : ''}/api/twilio/voice/answer
</span>
                    </p>
                  </div>
                </div>
              </div>

              <Button
                className="w-full gap-2"
                disabled={saveMutation.isPending || (!accountSid && !isConfigured) || (!authToken && !isConfigured)}
                onClick={() => saveMutation.mutate({
                  accountSid, authToken, phoneNumber, twilioEnabled: true,
                  apiKeySid, apiKeySecret, voiceAppSid,
                  ...(selectedCampaignId ? { campaignId: selectedCampaignId } : {}),
                })}
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {isConfigured ? "Update Credentials" : "Connect Twilio"}
                {selectedCampaignName ? ` for ${selectedCampaignName}` : ""}
              </Button>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Setup Guide */}
      {guide && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
            <div className="p-5 border-b border-border bg-secondary/20">
              <h2 className="font-semibold flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-400" /> Setup Guide
              </h2>
            </div>
            <div className="divide-y divide-border">
              {(guide.steps || []).map((s: any) => (
                <div key={s.step} className="p-4 flex gap-4 items-start">
                  <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {s.step}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{s.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1.5"
                      >
                        Open <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
                </div>
              ))}
            </div>
            {guide.tips?.length > 0 && (
              <div className="p-5 border-t border-border bg-blue-500/5">
                <p className="text-xs font-semibold text-blue-400 mb-2">Pro Tips</p>
                <ul className="space-y-1.5">
                  {guide.tips.map((tip: string, i: number) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                      <span className="text-blue-400/60 mt-0.5">·</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </motion.div>
      )}

      {/* Disable / Reset */}
      {isAdmin && isConfigured && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          <Card className="rounded-2xl border-white/5 bg-card p-5">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Danger Zone</h3>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
              disabled={saveMutation.isPending}
              onClick={() => {
                const target = selectedCampaignName || "this campaign";
                if (confirm(`This will clear Twilio credentials and disable the dialer for ${target}. Continue?`)) {
                  saveMutation.mutate({
                    accountSid: "", authToken: "", phoneNumber: "", twilioEnabled: false,
                    apiKeySid: "", apiKeySecret: "", voiceAppSid: "",
                    ...(selectedCampaignId ? { campaignId: selectedCampaignId } : {}),
                  });
                }
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Disconnect Twilio
            </Button>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
