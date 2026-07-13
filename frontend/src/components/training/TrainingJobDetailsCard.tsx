"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { withAuditHeaders } from "@/lib/auth-client";
import type { JobShellJob } from "@/lib/job-shell-data";

type ClientOption = {
  client_db_id: number;
  client_name: string | null;
};

type TeamMember = {
  user_id?: string | null;
  full_name: string | null;
  status?: string | null;
  email?: string | null;
};

type Props = {
  job: JobShellJob;
  baseUrl: string;
};

export default function TrainingJobDetailsCard({ job, baseUrl }: Props) {
  const [jobTitle, setJobTitle] = useState(job.title ?? "");
  const [clientId, setClientId] = useState(job.client_db_id ? String(job.client_db_id) : "");
  const [clientSearch, setClientSearch] = useState(job.client_name ?? "");
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [crmName, setCrmName] = useState(job.crm_name ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const clientSearchTimer = useRef<number | null>(null);

  const loadClients = useCallback(async (query: string) => {
    setClientSearchLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`${baseUrl}/clients?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const json = await res.json();
      setClients(Array.isArray(json.items) ? (json.items as ClientOption[]) : []);
    } catch {
      // ignore transient client search failures
    } finally {
      setClientSearchLoading(false);
    }
  }, [baseUrl]);

  const loadTeamMembers = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/admin/users`, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      const activeMembers = ((json.items ?? []) as TeamMember[])
        .filter((member) => String(member.status ?? "Active").toLowerCase() === "active")
        .sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || ""));
      setTeamMembers(activeMembers);
    } catch {
      // ignore transient user lookup failures
    }
  }, [baseUrl]);

  useEffect(() => {
    setJobTitle(job.title ?? "");
    setClientId(job.client_db_id ? String(job.client_db_id) : "");
    setClientSearch(job.client_name ?? "");
    setCrmName(job.crm_name ?? "");
    setStatus("");
  }, [job.client_db_id, job.client_name, job.crm_name, job.title, job.job_id]);

  useEffect(() => {
    void loadClients("");
    void loadTeamMembers();
  }, [loadClients, loadTeamMembers]);

  useEffect(() => {
    return () => {
      if (clientSearchTimer.current) {
        window.clearTimeout(clientSearchTimer.current);
      }
    };
  }, []);

  const crmOptions = useMemo(() => {
    const options = teamMembers
      .map((member) => ({
        ...member,
        full_name: (member.full_name || "").trim(),
        user_id: (member.user_id || "").trim(),
      }))
      .filter((member) => Boolean(member.full_name || member.user_id));
    const savedCrm = crmName.trim();
    if (savedCrm && !options.some((member) => (member.full_name || member.user_id) === savedCrm)) {
      options.unshift({ user_id: savedCrm, full_name: savedCrm, status: "Active" });
    }
    return options;
  }, [crmName, teamMembers]);

  async function handleClientChange(newClientId: string) {
    setClientId(newClientId);

    if (newClientId) {
      const matchedClient = clients.find((client) => client.client_db_id === Number(newClientId));
      setClientSearch(matchedClient?.client_name || "");
    } else {
      setClientSearch("");
    }
  }

  async function saveJobDetails() {
    if (!Number.isFinite(job.job_id) || job.job_id <= 0) return;

    setSaving(true);
    setStatus("Saving training job details...");
    try {
      const res = await fetch(`${baseUrl}/jobs/${job.job_id}`, {
        method: "PATCH",
        headers: withAuditHeaders(
          {
            "Content-Type": "application/json",
          },
          { page: "Jobs", section: "Training Overview", container: "Job Details" }
        ),
        credentials: "include",
        body: JSON.stringify({
          title: jobTitle,
          client_db_id: clientId ? Number(clientId) : null,
          crm_name: crmName || null,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setStatus(`Save failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
        return;
      }

      setStatus("Training job details saved. Refreshing...");
      window.setTimeout(() => {
        window.location.reload();
      }, 300);
    } catch (err) {
      setStatus(`Save error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="trainingJobTitle">Job Title</Label>
          <Input
            id="trainingJobTitle"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            placeholder="Enter job title..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="trainingClientSearch">Client</Label>
          <div className="relative">
            <Input
              id="trainingClientSearch"
              value={clientSearch}
              onFocus={() => setClientPickerOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setClientPickerOpen(false), 150);
              }}
              onChange={(event) => {
                const value = event.target.value;
                setClientSearch(value);
                setClientPickerOpen(true);
                if (clientId && clients.find((client) => client.client_db_id === Number(clientId))?.client_name !== value) {
                  setClientId("");
                }
                if (!value) {
                  setClientId("");
                }
                if (clientSearchTimer.current) {
                  window.clearTimeout(clientSearchTimer.current);
                }
                clientSearchTimer.current = window.setTimeout(() => {
                  void loadClients(value);
                }, 250);
              }}
              placeholder="Search clients by name or ID..."
              autoComplete="off"
            />
            {clientPickerOpen ? (
              <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-md border bg-background shadow-lg">
                <div className="max-h-64 overflow-y-auto py-1">
                  {clientSearchLoading ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">Searching...</div>
                  ) : clients.length > 0 ? (
                    clients.map((client) => {
                      const isSelected = client.client_db_id === Number(clientId);
                      return (
                        <button
                          key={client.client_db_id}
                          type="button"
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100 ${
                            isSelected ? "bg-slate-100 font-medium" : ""
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            void handleClientChange(String(client.client_db_id));
                            setClientPickerOpen(false);
                          }}
                        >
                          <span className="truncate">{client.client_name || `Client ${client.client_db_id}`}</span>
                          <span className="ml-3 shrink-0 text-xs text-muted-foreground">#{client.client_db_id}</span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No matching clients. Try a different search.
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          {clientId ? (
            <p className="text-xs text-muted-foreground">
              Selected: {clientSearch || job.client_name || "Client"} (#{clientId})
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Switching the client updates the linked client name used across the job workspace.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="trainingCrmName">CRM / Owner</Label>
          <Select value={crmName || "__none__"} onValueChange={(value) => setCrmName(value === "__none__" ? "" : value)}>
            <SelectTrigger id="trainingCrmName">
              <SelectValue placeholder="Select team member..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {crmOptions.map((member) => (
                <SelectItem
                  key={member.user_id || member.full_name}
                  value={member.full_name || member.user_id}
                >
                  {member.full_name || member.user_id || "Unknown"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-end gap-3">
          {status ? <span className="text-sm text-muted-foreground">{status}</span> : null}
          <Button onClick={saveJobDetails} disabled={saving}>
            Save Job Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
