import { useState } from "react";
import { LinkIcon, Copy, Plus, Trash2 } from "lucide-react";
import { useCrmGetLinks, useCrmCreateLink, useCrmDeleteLink } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function LinkList() {
  const { data: links, isLoading } = useCrmGetLinks();
  const createMutation = useCrmCreateLink();
  const deleteMutation = useCrmDeleteLink();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newLabel, setNewLabel] = useState("");
  const [newSource, setNewSource] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { data: { label: newLabel, leadSource: newSource, active: true } },
      {
        onSuccess: () => {
          setNewLabel("");
          setNewSource("");
          queryClient.invalidateQueries({ queryKey: ['/api/crm/links'] });
          toast({ title: "Link created!" });
        }
      }
    );
  };

  const copyToClipboard = (token: string) => {
    const url = `${window.location.origin}${import.meta.env.BASE_URL}submit/${token}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link copied to clipboard!" });
  };

  const handleDelete = (id: number) => {
    if(confirm("Delete this submission link?")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/crm/links'] })
      });
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-10 space-y-8">
      <div>
        <h1 className="text-3xl font-display font-bold">Submission Links</h1>
        <p className="text-muted-foreground mt-1">Generate public forms for external lead submission.</p>
      </div>

      <Card className="p-6 rounded-2xl bg-card border-white/5 shadow-lg">
        <h3 className="font-semibold text-lg mb-4 flex items-center"><Plus className="w-5 h-5 mr-2 text-primary" /> Create New Link</h3>
        <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="space-y-2 flex-1 w-full">
            <label className="text-sm text-muted-foreground">Label (e.g. FB Ad Campaing Q1)</label>
            <Input required value={newLabel} onChange={e => setNewLabel(e.target.value)} className="bg-background/50 rounded-xl" placeholder="Campaign name" />
          </div>
          <div className="space-y-2 flex-1 w-full">
            <label className="text-sm text-muted-foreground">Lead Source Value</label>
            <Input required value={newSource} onChange={e => setNewSource(e.target.value)} className="bg-background/50 rounded-xl" placeholder="Facebook Ads" />
          </div>
          <Button type="submit" disabled={createMutation.isPending} className="rounded-xl w-full sm:w-auto px-8 h-9">
            Generate Link
          </Button>
        </form>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          [1,2,3].map(i => <div key={i} className="h-40 bg-card rounded-2xl animate-pulse"></div>)
        ) : (
          links?.map(link => (
            <Card key={link.id} className="p-6 rounded-2xl border-white/5 bg-card shadow-md flex flex-col relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <LinkIcon className="w-24 h-24" />
              </div>
              <div className="relative z-10 flex-1">
                <div className="flex justify-between items-start mb-2">
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                    {link.leadSource}
                  </Badge>
                  <span className="text-2xl font-bold text-foreground">{link.submissionsCount}</span>
                </div>
                <h3 className="font-display font-semibold text-lg mb-1">{link.label}</h3>
                <p className="text-xs text-muted-foreground mb-6">Submissions received</p>
              </div>
              
              <div className="flex gap-2 relative z-10 pt-4 border-t border-border mt-auto">
                <Button variant="secondary" className="flex-1 rounded-xl" onClick={() => copyToClipboard(link.token)}>
                  <Copy className="w-4 h-4 mr-2" /> Copy URL
                </Button>
                <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 rounded-xl shrink-0" onClick={() => handleDelete(link.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
