"use client";

import { useState } from "react";
import { useCampaigns } from "@/lib/useCampaigns";
import { useReplies, useThread } from "@/lib/useReplies";
import type { ReplyLead, ReplyLeadStatus } from "@/lib/useReplies";
import {
  MessageSquareText,
  ExternalLink,
  Loader2,
  Inbox,
  ChevronDown,
  Mail,
  MousePointerClick,
  Eye,
  Send,
} from "lucide-react";

type FilterTab = "all" | "replied" | "opened" | "clicked";

export default function RepliesPage() {
  const { data: campaignData, loading: campaignLoading } = useCampaigns();
  const campaigns = campaignData?.campaigns ?? [];
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  // Use selected campaign, fallback to active campaign
  const effectiveCampaignId = selectedCampaignId || campaignData?.activeCampaignId || null;

  const { leads, stats, loading: repliesLoading } = useReplies(effectiveCampaignId);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const { emails: threadEmails, uniboxUrl, loading: threadLoading } = useThread(
    selectedEmail,
    effectiveCampaignId,
  );

  const selectedLead = leads.find((l) => l.email === selectedEmail);

  // Filter leads by tab
  const filteredLeads = activeTab === "all"
    ? leads
    : leads.filter((l) => l.status === activeTab);

  // Sort: replied first, then by last activity
  const sortedLeads = [...filteredLeads].sort((a, b) => {
    const priority: Record<ReplyLeadStatus, number> = { replied: 0, clicked: 1, opened: 2, sent: 3 };
    const diff = priority[a.status] - priority[b.status];
    if (diff !== 0) return diff;
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
  });

  if (campaignLoading && !campaignData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-0px)] flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between shrink-0"
        style={{ background: "var(--bg-raised)" }}
      >
        <div className="flex items-center gap-3">
          <MessageSquareText size={18} style={{ color: "var(--accent)" }} />
          <h1 className="text-base font-semibold tracking-tight">Reponses</h1>
        </div>

        <div className="flex items-center gap-4">
          {/* Stats chips */}
          <div className="hidden md:flex items-center gap-2 text-xs">
            <StatChip icon={<Mail size={11} />} count={stats.replied} label="reponses" color="var(--green)" />
            <StatChip icon={<Eye size={11} />} count={stats.opened} label="ouverts" color="var(--accent)" />
            <StatChip icon={<MousePointerClick size={11} />} count={stats.clicked} label="clics" color="var(--purple, #a855f7)" />
          </div>

          {/* Campaign selector */}
          <div className="relative">
            <select
              value={effectiveCampaignId ?? ""}
              onChange={(e) => {
                setSelectedCampaignId(e.target.value || null);
                setSelectedEmail(null);
              }}
              className="appearance-none pl-3 pr-8 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            >
              {campaigns.length === 0 && <option value="">Aucune campagne</option>}
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "var(--text-muted)" }}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 py-2 border-b border-[var(--border)] flex gap-1 shrink-0" style={{ background: "var(--bg)" }}>
        {([
          { key: "all", label: "Tous", count: leads.length },
          { key: "replied", label: "Reponses", count: stats.replied },
          { key: "opened", label: "Ouverts", count: stats.opened },
          { key: "clicked", label: "Cliques", count: stats.clicked },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={{
              background: activeTab === tab.key ? "var(--accent-subtle)" : "transparent",
              color: activeTab === tab.key ? "var(--accent-hover)" : "var(--text-muted)",
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 text-[10px] opacity-70">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main content — split panel */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel — Lead list */}
        <div
          className="w-[360px] shrink-0 border-r border-[var(--border)] overflow-y-auto"
          style={{ background: "var(--bg)" }}
        >
          {repliesLoading && leads.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : sortedLeads.length === 0 ? (
            <EmptyLeadList hasNoCampaign={!effectiveCampaignId} />
          ) : (
            sortedLeads.map((lead) => (
              <LeadListItem
                key={lead.email}
                lead={lead}
                selected={lead.email === selectedEmail}
                onSelect={() => setSelectedEmail(lead.email)}
              />
            ))
          )}
        </div>

        {/* Right panel — Thread */}
        <div className="flex-1 flex flex-col min-h-0" style={{ background: "var(--bg-raised)" }}>
          {!selectedEmail ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: "var(--text-muted)" }}>
              <Inbox size={32} />
              <p className="text-sm">Selectionnez un lead pour voir le thread</p>
            </div>
          ) : threadLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between shrink-0">
                <div>
                  <p className="text-sm font-semibold">{selectedLead?.name || selectedEmail}</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {selectedLead?.company ? `${selectedLead.company} — ` : ""}{selectedEmail}
                  </p>
                </div>
                {uniboxUrl && (
                  <a
                    href={uniboxUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                    style={{
                      background: "var(--accent-subtle)",
                      color: "var(--accent-hover)",
                    }}
                  >
                    <ExternalLink size={12} />
                    Ouvrir dans Instantly
                  </a>
                )}
              </div>

              {/* Thread messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {threadEmails.length === 0 ? (
                  <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
                    Aucun email dans ce thread
                  </p>
                ) : (
                  threadEmails.map((email) => (
                    <ThreadBubble key={email.id} email={email} />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function StatChip({
  icon,
  count,
  label,
  color,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
  color: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full"
      style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
    >
      {icon}
      <span className="font-semibold">{count}</span>
      <span className="opacity-70">{label}</span>
    </span>
  );
}

function LeadListItem({
  lead,
  selected,
  onSelect,
}: {
  lead: ReplyLead;
  selected: boolean;
  onSelect: () => void;
}) {
  const statusConfig: Record<ReplyLeadStatus, { color: string; icon: React.ReactNode }> = {
    replied: { color: "var(--green)", icon: <Mail size={10} /> },
    clicked: { color: "var(--purple, #a855f7)", icon: <MousePointerClick size={10} /> },
    opened: { color: "var(--accent)", icon: <Eye size={10} /> },
    sent: { color: "var(--text-muted)", icon: <Send size={10} /> },
  };

  const config = statusConfig[lead.status];
  const initials = lead.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const timeAgo = formatTimeAgo(lead.lastActivity);

  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-4 py-3 border-b transition-colors"
      style={{
        background: selected ? "var(--accent-subtle)" : "transparent",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex gap-3">
        {/* Avatar */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{
            background: `color-mix(in srgb, ${config.color} 15%, transparent)`,
            color: config.color,
          }}
        >
          {initials || "?"}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium truncate">{lead.name}</p>
            <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
              {timeAgo}
            </span>
          </div>

          {lead.company && (
            <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
              {lead.company}
            </p>
          )}

          {lead.snippet ? (
            <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
              &ldquo;{lead.snippet}&rdquo;
            </p>
          ) : (
            <div className="flex items-center gap-1 mt-0.5">
              <span style={{ color: config.color }}>{config.icon}</span>
              <span className="text-[11px]" style={{ color: config.color }}>
                {lead.status === "replied"
                  ? "A repondu"
                  : lead.status === "clicked"
                    ? "A clique"
                    : lead.status === "opened"
                      ? "A ouvert"
                      : "Envoye"}
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function ThreadBubble({
  email,
}: {
  email: { id: string; type: "sent" | "received"; from: string; subject: string; body: string; timestamp: string };
}) {
  const isSent = email.type === "sent";
  return (
    <div className={`flex ${isSent ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[75%] rounded-xl px-4 py-3"
        style={{
          background: isSent
            ? "var(--accent-subtle)"
            : "var(--bg)",
          border: isSent
            ? "1px solid rgba(99,102,241,0.2)"
            : "1px solid var(--border)",
        }}
      >
        <div className="flex items-center justify-between gap-4 mb-1.5">
          <p className="text-xs font-medium" style={{ color: isSent ? "var(--accent-hover)" : "var(--text-primary)" }}>
            {isSent ? "Vous" : email.from}
          </p>
          <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
            {formatTime(email.timestamp)}
          </span>
        </div>
        {email.subject && (
          <p className="text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
            {email.subject}
          </p>
        )}
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
          {email.body || "(Contenu vide)"}
        </p>
      </div>
    </div>
  );
}

function EmptyLeadList({ hasNoCampaign }: { hasNoCampaign: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <Inbox size={28} style={{ color: "var(--text-muted)" }} />
      <p className="text-sm font-medium mt-3">
        {hasNoCampaign ? "Aucune campagne selectionnee" : "Aucun lead dans cette campagne"}
      </p>
      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
        {hasNoCampaign
          ? "Selectionnez une campagne pour voir les reponses"
          : "Les leads apparaitront ici une fois que la campagne aura commence"}
      </p>
    </div>
  );
}

/* ---------- Helpers ---------- */

function formatTimeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "a l'instant";
  if (minutes < 60) return `il y a ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days}j`;
  return new Date(dateStr).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function formatTime(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
