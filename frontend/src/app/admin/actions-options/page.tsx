"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Edit2, Plus, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

function apiBaseUrl() {
  return "/api/backend";
}

type TermOption = {
  value: string;
  label: string;
  hint: string;
};

type ActionOption = {
  action_option_id: number;
  action_name: string;
  description?: string | null;
  action_term: string;
  action_term_label?: string;
  action_term_hint?: string;
  action_category?: string | null;
  scope_focus?: string | null;
  sort_order: number;
  is_active: boolean;
};

const DEFAULT_TERM_OPTIONS: TermOption[] = [
  { value: "short", label: "Short term", hint: "0-12 months" },
  { value: "medium", label: "Medium term", hint: "1-3 years" },
  { value: "long", label: "Long term", hint: "3+ years" },
];

function termBadgeVariant(term: string): string {
  const normalized = String(term || "").trim().toLowerCase();
  if (normalized === "short") return "bg-green-100 text-green-800 border-green-200";
  if (normalized === "long") return "bg-sky-100 text-sky-800 border-sky-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

export default function AdminActionsOptionsPage() {
  const [items, setItems] = useState<ActionOption[]>([]);
  const [termOptions, setTermOptions] = useState<TermOption[]>(DEFAULT_TERM_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all__");

  const [actionName, setActionName] = useState("");
  const [description, setDescription] = useState("");
  const [actionTerm, setActionTerm] = useState("medium");
  const [actionCategory, setActionCategory] = useState("");
  const [scopeFocus, setScopeFocus] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const baseUrl = apiBaseUrl();
      const res = await fetch(`${baseUrl}/admin/report-action-options?include_inactive=true`, {
        credentials: "include",
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to load action options (${res.status})`);
      }
      const payload = (await res.json()) as { items?: ActionOption[]; term_options?: TermOption[] };
      setItems(Array.isArray(payload.items) ? payload.items : []);
      if (Array.isArray(payload.term_options) && payload.term_options.length) {
        setTermOptions(payload.term_options);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load action options");
    } finally {
      setLoading(false);
    }
  }

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter === "active" && !item.is_active) return false;
      if (statusFilter === "inactive" && item.is_active) return false;
      if (!q) return true;
      const target = `${item.action_name} ${item.description || ""} ${item.action_category || ""} ${item.scope_focus || ""}`.toLowerCase();
      return target.includes(q);
    });
  }, [items, searchQuery, statusFilter]);

  function resetForm() {
    setActionName("");
    setDescription("");
    setActionTerm("medium");
    setActionCategory("");
    setScopeFocus("");
    setSortOrder("0");
    setIsActive(true);
    setEditingId(null);
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
    setStatus("");
  }

  function startEdit(item: ActionOption) {
    setActionName(item.action_name);
    setDescription(item.description || "");
    setActionTerm(item.action_term || "medium");
    setActionCategory(item.action_category || "");
    setScopeFocus(item.scope_focus || "");
    setSortOrder(String(item.sort_order || 0));
    setIsActive(item.is_active);
    setEditingId(item.action_option_id);
    setShowForm(true);
    setStatus("");
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!actionName.trim()) {
      setStatus("Action name is required.");
      return;
    }

    const payload = {
      action_name: actionName.trim(),
      description: description.trim() || null,
      action_term: actionTerm,
      action_category: actionCategory.trim() || null,
      scope_focus: scopeFocus.trim() || null,
      sort_order: Number(sortOrder || 0) || 0,
      is_active: isActive,
    };

    try {
      setStatus(editingId ? "Updating action option..." : "Creating action option...");
      const baseUrl = apiBaseUrl();
      const res = await fetch(
        editingId ? `${baseUrl}/admin/report-action-options/${editingId}` : `${baseUrl}/admin/report-action-options`,
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to save action option (${res.status})`);
      }
      await loadData();
      setStatus(editingId ? "Action option updated." : "Action option created.");
      setShowForm(false);
      resetForm();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save action option");
    }
  }

  async function handleToggleActive(item: ActionOption) {
    const baseUrl = apiBaseUrl();
    try {
      setStatus(item.is_active ? "Archiving action option..." : "Reactivating action option...");
      const res = await fetch(`${baseUrl}/admin/report-action-options/${item.action_option_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action_name: item.action_name,
          description: item.description || null,
          action_term: item.action_term,
          action_category: item.action_category || null,
          scope_focus: item.scope_focus || null,
          sort_order: item.sort_order,
          is_active: !item.is_active,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Failed to update action option (${res.status})`);
      }
      await loadData();
      setStatus(item.is_active ? "Action option archived." : "Action option reactivated.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to update action option");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>
              Action Options
            </h1>
            <p className="text-muted-foreground">
              Manage the shared library of suggested carbon reduction actions that can be added into job-level action plans.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/admin">Back to Admin</Link>
            </Button>
            <Button onClick={startCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Action Option
            </Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search action options..."
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="active">Active only</SelectItem>
                  <SelectItem value="inactive">Inactive only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {status ? <div className="mt-3 text-sm text-muted-foreground">{status}</div> : null}
            {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
          </CardContent>
        </Card>

        {showForm ? (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>{editingId ? "Edit Action Option" : "New Action Option"}</CardTitle>
              <CardDescription>
                These suggested actions will be available inside the job Actions section, where they can still be tailored per report.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSave}>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="actionName">Action Name</Label>
                    <Input
                      id="actionName"
                      value={actionName}
                      onChange={(event) => setActionName(event.target.value)}
                      placeholder="e.g. Switch to a renewable electricity tariff"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="actionTerm">Action Term</Label>
                    <Select value={actionTerm} onValueChange={setActionTerm}>
                      <SelectTrigger id="actionTerm">
                        <SelectValue placeholder="Select action term" />
                      </SelectTrigger>
                      <SelectContent>
                        {termOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label} - {option.hint}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="actionCategory">Category</Label>
                    <Input
                      id="actionCategory"
                      value={actionCategory}
                      onChange={(event) => setActionCategory(event.target.value)}
                      placeholder="e.g. Energy, Travel, Procurement"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scopeFocus">Scope / Focus</Label>
                    <Input
                      id="scopeFocus"
                      value={scopeFocus}
                      onChange={(event) => setScopeFocus(event.target.value)}
                      placeholder="e.g. Scope 2, Scope 3, All scopes"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    rows={4}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Describe the action and why it is useful in a report plan."
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="sortOrder">Sort Order</Label>
                    <Input
                      id="sortOrder"
                      type="number"
                      value={sortOrder}
                      onChange={(event) => setSortOrder(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="activeStatus">Status</Label>
                    <Select value={isActive ? "active" : "inactive"} onValueChange={(value) => setIsActive(value === "active")}>
                      <SelectTrigger id="activeStatus">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit">
                    <Save className="mr-2 h-4 w-4" />
                    {editingId ? "Update Action Option" : "Create Action Option"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      resetForm();
                      setShowForm(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Suggested Actions Library</CardTitle>
            <CardDescription>
              Seeded starter actions are included automatically. You can refine, archive, or extend them here over time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading action options...</div>
            ) : filteredItems.length === 0 ? (
              <div className="rounded-md border border-dashed p-8 text-sm text-muted-foreground">
                No action options match the current filters.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Scope / Focus</TableHead>
                    <TableHead>Term</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.action_option_id}>
                      <TableCell>
                        <div className="font-medium">{item.action_name}</div>
                        {item.description ? (
                          <div className="max-w-[440px] text-xs text-muted-foreground">{item.description}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{item.action_category || "General"}</TableCell>
                      <TableCell>{item.scope_focus || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={termBadgeVariant(item.action_term)}>
                          {item.action_term_label || item.action_term}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.is_active ? "secondary" : "outline"}>
                          {item.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(item)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleToggleActive(item)}>
                            {item.is_active ? "Archive" : "Reactivate"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
