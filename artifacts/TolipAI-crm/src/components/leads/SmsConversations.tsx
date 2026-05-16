import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { format } from "date-fns";
import { Send, RefreshCw, MessageSquare, Bot, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface SmsMessage {
  id: number;
  leadId: number;
  campaignId: number | null;
  direction: "inbound" | "outbound";
  body: string;
  aiGenerated: boolean | null;
  twilioSid: string | null;
  aiModel: string | null;
  aiCostUsd: string | null;
  createdAt: string;
}

interface PhoneNumber {
  id: string;
  phoneNumber?: string;
  number?: string;
  friendlyName?: string;
}

interface Props {
  leadId: number;
  leadPhone?: string;
  campaignId?: number | null;
}

export default function SmsConversations({ leadId, leadPhone, campaignId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [selectedFrom, setSelectedFrom] = useState<string>("");

  // Fetch SMS conversation thread
  const { data: messages = [], isFetching, refetch } = useQuery<SmsMessage[]>({
    queryKey: ["/api/twilio/sms-conversations", leadId],
    queryFn: () => apiFetch(`/twilio/sms-conversations/${leadId}`),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Fetch available Twilio phone numbers for the "From" selector
  const { data: phoneNumbers = [] } = useQuery<PhoneNumber[]>({
    queryKey: ["/api/twilio/phone-numbers"],
    queryFn: async () => {
      const d = await apiFetch("/twilio/phone-numbers");
      return d?.phoneNumbers ?? d ?? [];
    },
    staleTime: 60_000,
  });

  // Auto-select first available number
  useEffect(() => {
    if (phoneNumbers.length > 0 && !selectedFrom) {
      setSelectedFrom(phoneNumbers[0].id || phoneNumbers[0].number || "");
    }
  }, [phoneNumbers, selectedFrom]);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Send SMS mutation
  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      apiFetch("/twilio/messages", {
        method: "POST",
        body: JSON.stringify({
          phoneNumberId: selectedFrom,
          to: leadPhone,
          content,
          leadId,
          campaignId,
        }),
      }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["/api/twilio/sms-conversations", leadId] });
      toast({ title: "Message sent" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to send SMS", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !selectedFrom || !leadPhone) return;
    sendMutation.mutate(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatPhone = (p: PhoneNumber) =>
    p.friendlyName || p.phoneNumber || p.number || p.id;

  const noPhone = !leadPhone;
  const noNumbers = phoneNumbers.length === 0;

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/20">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">SMS Conversations</span>
          {messages.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
              {messages.length}
            </Badge>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="w-7 h-7 rounded-lg"
          onClick={() => refetch()}
          disabled={isFetching}
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[180px] max-h-[380px]">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-8 text-center">
            <MessageSquare className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">No messages yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Send the first SMS below or wait for an inbound reply.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOutbound = msg.direction === "outbound";
            return (
              <div
                key={msg.id}
                className={`flex items-end gap-2 ${isOutbound ? "flex-row-reverse" : "flex-row"}`}
              >
                {/* Avatar */}
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mb-0.5 ${
                  isOutbound ? "bg-primary/20" : "bg-secondary/60"
                }`}>
                  {msg.aiGenerated ? (
                    <Bot className="w-3 h-3 text-primary" />
                  ) : isOutbound ? (
                    <User className="w-3 h-3 text-primary" />
                  ) : (
                    <User className="w-3 h-3 text-muted-foreground" />
                  )}
                </div>

                {/* Bubble */}
                <div className={`max-w-[78%] flex flex-col gap-1 ${isOutbound ? "items-end" : "items-start"}`}>
                  <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed break-words ${
                    isOutbound
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-secondary/50 text-foreground rounded-bl-sm border border-white/5"
                  }`}>
                    {msg.body}
                  </div>
                  <div className="flex items-center gap-1.5 px-1">
                    <span className="text-[10px] text-muted-foreground/60">
                      {format(new Date(msg.createdAt), "MMM d, h:mm a")}
                    </span>
                    {msg.aiGenerated && (
                      <Badge className="text-[9px] h-3.5 px-1 bg-violet-500/15 text-violet-400 border-violet-500/20">
                        AI
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Compose area */}
      <div className="border-t border-border bg-secondary/10 p-3 space-y-2">
        {/* From number selector */}
        {phoneNumbers.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground shrink-0">From:</span>
            <select
              value={selectedFrom}
              onChange={(e) => setSelectedFrom(e.target.value)}
              className="flex-1 text-xs bg-background border border-border rounded-lg px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {phoneNumbers.map((p) => (
                <option key={p.id} value={p.id}>
                  {formatPhone(p)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Warning states */}
        {noPhone && (
          <p className="text-[11px] text-amber-400 bg-amber-400/10 rounded-lg px-2 py-1.5">
            This lead has no phone number — add one above to send an SMS.
          </p>
        )}
        {!noPhone && noNumbers && (
          <p className="text-[11px] text-amber-400 bg-amber-400/10 rounded-lg px-2 py-1.5">
            No Twilio phone numbers found. Configure a number in the Twilio integration settings.
          </p>
        )}

        {/* Input row */}
        <div className="flex gap-2 items-end">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              noPhone
                ? "No phone number on this lead"
                : noNumbers
                ? "No Twilio numbers configured"
                : `Message ${leadPhone ?? "lead"} (Ctrl+Enter to send)`
            }
            disabled={noPhone || noNumbers || sendMutation.isPending}
            rows={2}
            className="resize-none flex-1 text-sm rounded-xl bg-background/70 border-white/10 focus:ring-1 focus:ring-primary"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!draft.trim() || !selectedFrom || !leadPhone || sendMutation.isPending}
            className="h-[52px] w-10 rounded-xl shrink-0"
            title="Send (Ctrl+Enter)"
          >
            {sendMutation.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 pl-1">
          AI auto-replies are active when the campaign AI SMS setting is on.
        </p>
      </div>
    </Card>
  );
}
