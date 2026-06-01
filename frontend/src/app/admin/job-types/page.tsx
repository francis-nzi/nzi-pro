"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Save } from "lucide-react";
import Link from "next/link";
import { inferJobFamilyFromJobTypeName } from "@/lib/job-family";

function apiBaseUrl() {
  return "/api/backend";
}

interface JobType {
  job_type_id: number;
  name: string;
  estimated_hours: number;
  is_active: boolean;
  job_family?: string | null;
}

const JOB_FAMILIES = [
  { value: "crp", label: "CRP" },
  { value: "training", label: "Training" },
  { value: "consultancy", label: "Consultancy" },
  { value: "lca", label: "LCA" },
  { value: "pcf", label: "PCF" },
] as const;

export default function JobTypesPage() {
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [editedHours, setEditedHours] = useState<Record<number, string>>({});
  const [editedFamilies, setEditedFamilies] = useState<Record<number, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    loadJobTypes();
  }, []);

  async function loadJobTypes() {
    setLoading(true);
    setError("");

    try {
      const baseUrl = apiBaseUrl();
      const response = await fetch(`${baseUrl}/admin/lookups/job_types`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to load job types");
      }

      const data = await response.json();
      setJobTypes(data.items || []);
      
      // Initialize edited hours with current values
      const hours: Record<number, string> = {};
      const families: Record<number, string> = {};
      (data.items || []).forEach((jobType: JobType) => {
        hours[jobType.job_type_id] = String(jobType.estimated_hours || 0);
        families[jobType.job_type_id] = (jobType.job_family || inferJobFamilyFromJobTypeName(jobType.name) || "crp").toLowerCase();
      });
      setEditedHours(hours);
      setEditedFamilies(families);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load job types");
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(jobType: JobType) {
    setEditingId(jobType.job_type_id);
    setEditedHours((prev) => ({
      ...prev,
      [jobType.job_type_id]: String(jobType.estimated_hours || 0),
    }));
    setEditedFamilies((prev) => ({
      ...prev,
      [jobType.job_type_id]: (jobType.job_family || inferJobFamilyFromJobTypeName(jobType.name) || "crp").toLowerCase(),
    }));
  }

  function handleCancel() {
    setEditingId(null);
  }

  async function handleSave(jobTypeId: number) {
    const hours = editedHours[jobTypeId];
    if (!hours || parseFloat(hours) < 0) {
      setStatus("Please enter a valid number of hours");
      return;
    }

    try {
      const baseUrl = apiBaseUrl();
      const jobFamily = editedFamilies[jobTypeId] || "crp";
      const response = await fetch(`${baseUrl}/admin/lookups/job_types/${jobTypeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ estimated_hours: parseFloat(hours), job_family: jobFamily }),
      });

      if (!response.ok) {
        throw new Error("Failed to update estimated hours");
      }

      setStatus("Estimated hours updated successfully!");
      setEditingId(null);
      loadJobTypes();
      setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to update estimated hours");
    }
  }

  function handleHoursChange(jobTypeId: number, value: string) {
    setEditedHours((prev) => ({
      ...prev,
      [jobTypeId]: value,
    }));
  }

  function handleFamilyChange(jobTypeId: number, value: string) {
    setEditedFamilies((prev) => ({
      ...prev,
      [jobTypeId]: value,
    }));
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto w-full max-w-7xl px-6 py-10">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#F26624' }}>
              Job Type Estimated Hours
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Set estimated hours for each job type to track job budgets
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin">Back to Admin</Link>
          </Button>
        </div>

        {error && (
          <div className="mb-4 text-sm text-destructive">{error}</div>
        )}

        {status && (
          <div className="mb-4 text-sm text-green-600">{status}</div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Estimated Hours by Job Type</CardTitle>
            <p className="text-sm text-muted-foreground">
              These estimated hours will be used as the budget baseline for each job. Actual time logged will be compared against this estimate.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job Type Name</TableHead>
                  <TableHead>Family</TableHead>
                  <TableHead className="text-right">Estimated Hours</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobTypes.filter(jt => jt.is_active).map((jobType) => {
                  const isEditing = editingId === jobType.job_type_id;
                  
                  return (
                    <TableRow key={jobType.job_type_id}>
                      <TableCell className="font-medium">{jobType.name}</TableCell>
                      <TableCell>
                        {isEditing ? (
                          <select
                            value={editedFamilies[jobType.job_type_id] || "crp"}
                            onChange={(e) => handleFamilyChange(jobType.job_type_id, e.target.value)}
                            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                          >
                            {JOB_FAMILIES.map((family) => (
                              <option key={family.value} value={family.value}>
                                {family.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                            {(jobType.job_family || inferJobFamilyFromJobTypeName(jobType.name) || "crp").toUpperCase()}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            value={editedHours[jobType.job_type_id] || "0"}
                            onChange={(e) => handleHoursChange(jobType.job_type_id, e.target.value)}
                            className="w-32 ml-auto"
                            autoFocus
                          />
                        ) : (
                          <span className="font-semibold">{jobType.estimated_hours || 0} hours</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <div className="flex gap-2 justify-end">
                            <Button
                              size="sm"
                              onClick={() => handleSave(jobType.job_type_id)}
                            >
                              <Save className="h-4 w-4 mr-2" />
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleCancel}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(jobType)}
                          >
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
