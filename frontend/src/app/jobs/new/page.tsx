"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

type Client = {
  client_db_id: number;
  client_name: string;
};

export default function NewJobPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedClientId = searchParams?.get("clientId");
  
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [clients, setClients] = useState<Client[]>([]);

  // Form fields
  const [clientId, setClientId] = useState(preselectedClientId || "");
  const [jobType, setJobType] = useState("CRP");
  const [reportingYear, setReportingYear] = useState(new Date().getFullYear().toString());
  const [title, setTitle] = useState("");
  const [jobStatus, setJobStatus] = useState("Open");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    loadClients();
  }, [baseUrl]);

  useEffect(() => {
    console.log('Preselection check:', { 
      preselectedClientId, 
      clientsCount: clients.length,
      clientIds: clients.map(c => c.client_db_id)
    });
    
    if (preselectedClientId && clients.length > 0) {
      const clientExists = clients.some((c: Client) => c.client_db_id === Number(preselectedClientId));
      console.log('Client exists check:', { 
        preselectedClientId, 
        asNumber: Number(preselectedClientId),
        clientExists 
      });
      
      if (clientExists) {
        console.log('Setting clientId to:', preselectedClientId);
        setClientId(preselectedClientId);
      } else {
        console.warn('Preselected client not found in list');
      }
    }
  }, [preselectedClientId, clients]);

  async function loadClients() {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/clients?limit=200`);
      if (res.ok) {
        const json = await res.json();
        const allClients = json.items || [];
        setClients(allClients);
      }
    } catch (e) {
      setStatus(`Error loading clients: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!clientId) {
      setStatus("Please select a client");
      return;
    }

    if (!startDate || !dueDate) {
      setStatus("Start date and due date are required");
      return;
    }

    const start = new Date(startDate);
    const due = new Date(dueDate);
    
    if (due < start) {
      setStatus("Due date cannot be before start date");
      return;
    }

    setSaving(true);
    setStatus("Creating job...");

    try {
      const res = await fetch(`${baseUrl}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_db_id: Number(clientId),
          job_type: jobType,
          title: title.trim() || "Untitled",
          reporting_year: Number(reportingYear),
          status: jobStatus,
          start_date: startDate,
          due_date: dueDate,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to create job: ${res.status} - ${text}`);
      }

      const json = await res.json();
      setStatus("Job created successfully!");
      
      setTimeout(() => {
        router.push(`/jobs/${json.job_id}`);
      }, 500);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">New Job</h1>
            <p className="text-sm text-muted-foreground">Create a new job</p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/jobs">Cancel</Link>
          </Button>
        </div>

        {status && (
          <div className="mb-4 rounded-md bg-muted p-3 text-sm">
            {status}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading clients...</div>
        ) : clients.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="mb-4 text-muted-foreground">No clients found. Please create a client first.</p>
              <Button asChild>
                <Link href="/clients/new">Create Client</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <form onSubmit={handleSubmit}>
            <Card>
              <CardHeader>
                <CardTitle>Job Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="client">Client *</Label>
                    <Select value={clientId} onValueChange={setClientId} required>
                      <SelectTrigger id="client">
                        <SelectValue placeholder="Select client..." />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((c) => (
                          <SelectItem key={c.client_db_id} value={String(c.client_db_id)}>
                            {c.client_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="jobType">Job Type *</Label>
                    <Select value={jobType} onValueChange={setJobType}>
                      <SelectTrigger id="jobType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CRP">CRP</SelectItem>
                        <SelectItem value="Carbon Footprint">Carbon Footprint</SelectItem>
                        <SelectItem value="Net Zero Strategy">Net Zero Strategy</SelectItem>
                        <SelectItem value="Consultancy">Consultancy</SelectItem>
                        <SelectItem value="LCA">LCA</SelectItem>
                        <SelectItem value="Training">Training</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reportingYear">Reporting Year *</Label>
                    <Input
                      id="reportingYear"
                      type="number"
                      value={reportingYear}
                      onChange={(e) => setReportingYear(e.target.value)}
                      min="1990"
                      max="2100"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select value={jobStatus} onValueChange={setJobStatus}>
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Open">Open</SelectItem>
                      <SelectItem value="Data Gathering Phase">Data Gathering Phase</SelectItem>
                      <SelectItem value="Reporting Phase">Reporting Phase</SelectItem>
                      <SelectItem value="Awaiting Client Input">Awaiting Client Input</SelectItem>
                      <SelectItem value="Completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="title">Job Title/Description</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Optional description"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="startDate">Start Date *</Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dueDate">Due Date *</Label>
                    <Input
                      id="dueDate"
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="secondary" asChild>
                <Link href="/jobs">Cancel</Link>
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Creating..." : "Create Job"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
