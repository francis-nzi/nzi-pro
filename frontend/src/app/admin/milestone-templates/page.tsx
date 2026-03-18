"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

type MilestoneItem = {
  item_id?: number;
  milestone_name: string;
  days_offset: number;
  sort_order: number;
};

type MilestoneTemplate = {
  template_id: number;
  template_name: string;
  description: string;
  is_active: boolean;
  is_default: boolean;
  items: MilestoneItem[];
};

export default function MilestoneTemplatesPage() {
  const confirmAction = useConfirmDialog();
  const [templates, setTemplates] = useState<MilestoneTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MilestoneTemplate | null>(null);
  const [formData, setFormData] = useState({
    template_name: "",
    description: "",
    items: [
      { milestone_name: "", days_offset: 0, sort_order: 1 }
    ] as MilestoneItem[]
  });
  const [status, setStatus] = useState("");

  useEffect(() => {
    fetchTemplates();
  }, []);

  async function fetchTemplates() {
    try {
      setLoading(true);
      const res = await fetch(`${apiBaseUrl()}/milestone-templates`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch templates");
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (err) {
      setStatus(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  function openCreateDialog() {
    setEditingTemplate(null);
    setFormData({
      template_name: "",
      description: "",
      items: [
        { milestone_name: "", days_offset: 0, sort_order: 1 }
      ]
    });
    setDialogOpen(true);
  }

  function openEditDialog(template: MilestoneTemplate) {
    setEditingTemplate(template);
    setFormData({
      template_name: template.template_name,
      description: template.description,
      items: template.items.length > 0 ? template.items : [
        { milestone_name: "", days_offset: 0, sort_order: 1 }
      ]
    });
    setDialogOpen(true);
  }

  function addMilestoneItem() {
    setFormData({
      ...formData,
      items: [
        ...formData.items,
        { milestone_name: "", days_offset: 0, sort_order: formData.items.length + 1 }
      ]
    });
  }

  function removeMilestoneItem(index: number) {
    const newItems = formData.items.filter((_, i) => i !== index);
    // Re-sort
    newItems.forEach((item, i) => {
      item.sort_order = i + 1;
    });
    setFormData({ ...formData, items: newItems });
  }

  function updateMilestoneItem(index: number, field: keyof MilestoneItem, value: string | number) {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData({ ...formData, items: newItems });
  }

  async function handleSave() {
    try {
      setStatus("Saving...");
      
      if (!formData.template_name.trim()) {
        setStatus("Template name is required");
        return;
      }

      if (formData.items.length === 0 || formData.items.some(item => !item.milestone_name.trim())) {
        setStatus("All milestone items must have a name");
        return;
      }

      const url = editingTemplate
        ? `${apiBaseUrl()}/milestone-templates/${editingTemplate.template_id}`
        : `${apiBaseUrl()}/milestone-templates`;
      
      const method = editingTemplate ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || "Failed to save template");
      }

      setStatus("Template saved successfully");
      setDialogOpen(false);
      fetchTemplates();
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  }

  async function handleDelete(template: MilestoneTemplate) {
    if (template.is_default) {
      setStatus("Cannot delete default template");
      return;
    }

    const confirmed = await confirmAction({
      title: "Delete milestone template?",
      description: `Delete template "${template.template_name}"?`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      setStatus("Deleting...");
      const res = await fetch(`${apiBaseUrl()}/milestone-templates/${template.template_id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || "Failed to delete template");
      }

      setStatus("Template deleted successfully");
      fetchTemplates();
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: '#F26624' }}>Milestone Templates</h1>
          <p className="text-sm text-muted-foreground">
            Manage milestone templates for different job types
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link href="/admin">← Back to Admin</Link>
          </Button>
          <Button onClick={openCreateDialog}>Create Template</Button>
        </div>
      </div>

      {status && (
        <div className="mb-4 p-3 bg-muted rounded-md text-sm">
          {status}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">Loading templates...</div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No milestone templates found. Create one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {templates.map((template) => (
            <Card key={template.template_id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {template.template_name}
                      {template.is_default && (
                        <Badge variant="secondary">Default</Badge>
                      )}
                      {!template.is_active && (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </CardTitle>
                    {template.description && (
                      <CardDescription className="mt-1">
                        {template.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(template)}
                    >
                      Edit
                    </Button>
                    {!template.is_default && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(template)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Milestone</TableHead>
                      <TableHead>Days from Start</TableHead>
                      <TableHead>Order</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {template.items.map((item) => (
                      <TableRow key={item.item_id}>
                        <TableCell className="font-medium">{item.milestone_name}</TableCell>
                        <TableCell>+{item.days_offset} days</TableCell>
                        <TableCell>{item.sort_order}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? "Edit Template" : "Create Template"}
            </DialogTitle>
            <DialogDescription>
              Define milestones and their timing relative to the job start date
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="template_name">Template Name *</Label>
              <Input
                id="template_name"
                value={formData.template_name}
                onChange={(e) => setFormData({ ...formData, template_name: e.target.value })}
                placeholder="e.g., Standard CRP, Quick Audit"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description of this template"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Milestones</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addMilestoneItem}
                >
                  Add Milestone
                </Button>
              </div>

              <div className="space-y-3">
                {formData.items.map((item, index) => (
                  <div key={index} className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Label className="text-xs">Milestone Name</Label>
                      <Input
                        value={item.milestone_name}
                        onChange={(e) => updateMilestoneItem(index, "milestone_name", e.target.value)}
                        placeholder="e.g., Data Collection Due"
                      />
                    </div>
                    <div className="w-32">
                      <Label className="text-xs">Days Offset</Label>
                      <Input
                        type="number"
                        value={item.days_offset}
                        onChange={(e) => updateMilestoneItem(index, "days_offset", parseInt(e.target.value) || 0)}
                        placeholder="45"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMilestoneItem(index)}
                      disabled={formData.items.length === 1}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editingTemplate ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
