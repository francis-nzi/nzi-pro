"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function apiBaseUrl(): string {
  return "/api/backend";
}

type Rule = {
  rule_id: number;
  rule_name: string;
  trigger_key: string;
  scope_type: string;
  filter_json: Record<string, unknown>;
  action_type: string;
  action_json: Record<string, unknown>;
  is_active: boolean;
};

type Run = {
  run_id: number;
  trigger_key: string;
  scope_type: string;
  mode: string;
  status: string;
  started_at: string | null;
  result_json: Record<string, unknown>;
};

export default function AdminAutomationsPage() {
  const baseUrl = useMemo(() => apiBaseUrl(), []);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [form, setForm] = useState({
    rule_name: "",
    trigger_key: "milestone_status",
    scope_type: "job",
    action_type: "create_task",
    is_active: true,
    filter_json: '{\n  "milestone_status_in": ["amber", "red"]\n}',
    action_json: '{\n  "title": "Milestone risk for job {{job_id}}",\n  "details": "Status: {{milestone_status_summary}}",\n  "priority": "high",\n  "due_in_days": 2\n}',
  });
  const [testRun, setTestRun] = useState({
    trigger_key: "milestone_status",
    client_db_id: "",
    job_id: "",
    mode: "preview",
  });
  const [testResult, setTestResult] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const [rulesRes, runsRes] = await Promise.all([
        fetch(`${baseUrl}/automation/rules?include_inactive=true`, { credentials: "include" }),
        fetch(`${baseUrl}/automation/runs?limit=50&offset=0`, { credentials: "include" }),
      ]);
      if (!rulesRes.ok) throw new Error(`Failed to load rules (${rulesRes.status})`);
      if (!runsRes.ok) throw new Error(`Failed to load runs (${runsRes.status})`);
      const rulesJson = await rulesRes.json();
      const runsJson = await runsRes.json();
      setRules(Array.isArray(rulesJson?.items) ? rulesJson.items : []);
      setRuns(Array.isArray(runsJson?.items) ? runsJson.items : []);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(rule: Rule) {
    setEditingRuleId(rule.rule_id);
    setForm({
      rule_name: rule.rule_name,
      trigger_key: rule.trigger_key,
      scope_type: rule.scope_type,
      action_type: rule.action_type,
      is_active: Boolean(rule.is_active),
      filter_json: JSON.stringify(rule.filter_json || {}, null, 2),
      action_json: JSON.stringify(rule.action_json || {}, null, 2),
    });
  }

  function resetForm() {
    setEditingRuleId(null);
    setForm({
      rule_name: "",
      trigger_key: "milestone_status",
      scope_type: "job",
      action_type: "create_task",
      is_active: true,
      filter_json: '{\n  "milestone_status_in": ["amber", "red"]\n}',
      action_json: '{\n  "title": "Milestone risk for job {{job_id}}",\n  "details": "Status: {{milestone_status_summary}}",\n  "priority": "high",\n  "due_in_days": 2\n}',
    });
  }

  async function saveRule() {
    setStatus("");
    try {
      const filterJson = JSON.parse(form.filter_json || "{}");
      const actionJson = JSON.parse(form.action_json || "{}");
      const payload = {
        rule_name: form.rule_name,
        trigger_key: form.trigger_key,
        scope_type: form.scope_type,
        action_type: form.action_type,
        is_active: form.is_active,
        filter_json: filterJson,
        action_json: actionJson,
      };
      const res = editingRuleId
        ? await fetch(`${baseUrl}/automation/rules/${editingRuleId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          })
        : await fetch(`${baseUrl}/automation/rules`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Failed to save rule (${res.status})${txt ? `: ${txt}` : ""}`);
      }
      setStatus("Rule saved.");
      resetForm();
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function runTest() {
    setStatus("");
    setTestResult("");
    try {
      const payload = {
        trigger_key: testRun.trigger_key,
        client_db_id: testRun.client_db_id ? Number(testRun.client_db_id) : null,
        job_id: testRun.job_id ? Number(testRun.job_id) : null,
        mode: testRun.mode,
      };
      const res = await fetch(`${baseUrl}/automation/test-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Test run failed (${res.status}): ${text}`);
      setTestResult(text);
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: "#F26624" }}>Automation Rules</h1>
            <p className="text-sm text-muted-foreground">Configure triggers and actions for CRM automations</p>
          </div>
          <Button variant="secondary" asChild>
            <Link href="/admin">Back to Admin</Link>
          </Button>
        </div>

        {status ? <div className="mb-4 rounded-md bg-muted p-3 text-sm">{status}</div> : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{editingRuleId ? "Edit Rule" : "New Rule"}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label>Rule Name</Label><Input value={form.rule_name} onChange={(e) => setForm((p) => ({ ...p, rule_name: e.target.value }))} /></div>
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label>Trigger</Label>
                  <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.trigger_key} onChange={(e) => setForm((p) => ({ ...p, trigger_key: e.target.value }))}>
                    <option value="milestone_status">milestone_status</option>
                    <option value="no_client_reply">no_client_reply</option>
                  </select>
                </div>
                <div>
                  <Label>Scope</Label>
                  <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.scope_type} onChange={(e) => setForm((p) => ({ ...p, scope_type: e.target.value }))}>
                    <option value="global">global</option>
                    <option value="client">client</option>
                    <option value="job">job</option>
                  </select>
                </div>
                <div>
                  <Label>Action</Label>
                  <select className="w-full rounded-md border px-3 py-2 text-sm" value={form.action_type} onChange={(e) => setForm((p) => ({ ...p, action_type: e.target.value }))}>
                    <option value="create_task">create_task</option>
                    <option value="log_event">log_event</option>
                    <option value="send_email">send_email</option>
                  </select>
                </div>
              </div>
              <div>
                <Label>Filter JSON</Label>
                <Textarea rows={6} value={form.filter_json} onChange={(e) => setForm((p) => ({ ...p, filter_json: e.target.value }))} />
              </div>
              <div>
                <Label>Action JSON</Label>
                <Textarea rows={8} value={form.action_json} onChange={(e) => setForm((p) => ({ ...p, action_json: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))} />
                Active
              </label>
              <div className="flex gap-2">
                <Button onClick={() => void saveRule()} disabled={loading}>Save Rule</Button>
                {editingRuleId ? <Button variant="outline" onClick={resetForm}>Cancel</Button> : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Test Run</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Trigger</Label>
                  <select className="w-full rounded-md border px-3 py-2 text-sm" value={testRun.trigger_key} onChange={(e) => setTestRun((p) => ({ ...p, trigger_key: e.target.value }))}>
                    <option value="milestone_status">milestone_status</option>
                    <option value="no_client_reply">no_client_reply</option>
                  </select>
                </div>
                <div>
                  <Label>Mode</Label>
                  <select className="w-full rounded-md border px-3 py-2 text-sm" value={testRun.mode} onChange={(e) => setTestRun((p) => ({ ...p, mode: e.target.value }))}>
                    <option value="preview">preview</option>
                    <option value="send">send</option>
                  </select>
                </div>
                <div><Label>Client ID</Label><Input value={testRun.client_db_id} onChange={(e) => setTestRun((p) => ({ ...p, client_db_id: e.target.value }))} /></div>
                <div><Label>Job ID</Label><Input value={testRun.job_id} onChange={(e) => setTestRun((p) => ({ ...p, job_id: e.target.value }))} /></div>
              </div>
              <Button onClick={() => void runTest()} disabled={loading}>Run Automation</Button>
              <Textarea rows={10} value={testResult} readOnly placeholder="Test run result..." />
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Rules</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {rules.map((r) => (
                <div key={r.rule_id} className="rounded border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{r.rule_name}</div>
                      <div className="text-xs text-muted-foreground">{r.trigger_key} | {r.scope_type} | {r.action_type} | {r.is_active ? "active" : "inactive"}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => startEdit(r)}>Edit</Button>
                  </div>
                </div>
              ))}
              {!rules.length ? <div className="text-sm text-muted-foreground">No rules yet.</div> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Execution Log</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {runs.map((r) => (
                <div key={r.run_id} className="rounded border p-2">
                  <div className="font-medium">Run #{r.run_id}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.trigger_key} | {r.mode} | {r.scope_type} | {r.status} | {r.started_at ? new Date(r.started_at).toLocaleString("en-GB") : "-"}
                  </div>
                </div>
              ))}
              {!runs.length ? <div className="text-sm text-muted-foreground">No runs yet.</div> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

