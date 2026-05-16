import { useQuery } from "@tanstack/react-query";
import { useCrmGetMe } from "@workspace/api-client-react";

function authHeaders() {
  const token = localStorage.getItem("crm_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function fetchCampaigns() {
  const r = await fetch("/api/crm/campaigns", { headers: authHeaders() });
  if (!r.ok) return [];
  return r.json();
}

export function useCampaignGovernance() {
  const { data: me } = useCrmGetMe();
  const isSuperAdmin = me?.role === "super_admin";

  const { data: campaigns = [] } = useQuery<any[]>({
    queryKey: ["crm-campaigns-governance", me?.campaignId],
    queryFn: fetchCampaigns,
    enabled: !!me,
    staleTime: 60_000,
  });

  const campaign = isSuperAdmin
    ? null
    : campaigns.find((c: any) => c.id === me?.campaignId) ?? null;

  // Only super_admin can delete leads
  const canDeleteLeads = isSuperAdmin;

  return {
    me,
    isSuperAdmin,
    canDeleteLeads,
    campaign,
    campaigns,
  };
}
