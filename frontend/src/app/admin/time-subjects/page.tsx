"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

function apiBaseUrl() {
  return "/api/backend";
}

interface TimeSubject {
  subject_id: number;
  name: string;
  budget_hours: number;
}

export default function TimeSubjectsPage() {
  const [subjects, setSubjects] = useState<TimeSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [editedHours, setEditedHours] = useState<Record<number, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    loadSubjects();
  }, []);

  async function loadSubjects() {
    setLoading(true);
    setError("");

    try {
      const baseUrl = apiBaseUrl();
      const response = await fetch(`${baseUrl}/time-subjects`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to load time subjects");
      }

      const data = await response.json();
      setSubjects(data.items || []);
      
      // Initialize edited hours with current values
      const hours: Record<number, string> = {};
      (data.items || []).forEach((subject: TimeSubject) => {
        hours[subject.subject_id] = String(subject.budget_hours);
      });
      setEditedHours(hours);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load time subjects");
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(subject: TimeSubject) {
    setEditingId(subject.subject_id);
    setEditedHours((prev) => ({
      ...prev,
      [subject.subject_id]: String(subject.budget_hours),
    }));
  }

  function handleCancel() {
    setEditingId(null);
  }

  async function handleSave(subjectId: number) {
    const hours = editedHours[subjectId];
    if (!hours || parseFloat(hours) < 0) {
      setStatus("Please enter a valid number of hours");
      return;
    }

    try {
      const baseUrl = apiBaseUrl();
      const response = await fetch(`${baseUrl}/time-subjects/${subjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ budget_hours: parseFloat(hours) }),
      });

      if (!response.ok) {
        throw new Error("Failed to update budget hours");
      }

      setStatus("Budget hours updated successfully!");
      setEditingId(null);
      loadSubjects();
      setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to update budget hours");
    }
  }

  function handleHoursChange(subjectId: number, value: string) {
    setEditedHours((prev) => ({
      ...prev,
      [subjectId]: value,
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
              Time Subject Budget Configuration
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Set default budget hours for each time subject type
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
            <CardTitle>Budget Hours by Subject</CardTitle>
            <p className="text-sm text-muted-foreground">
              These budget hours will be used to calculate if jobs are over or under budget based on actual time logged.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject Name</TableHead>
                  <TableHead className="text-right">Budget Hours</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjects.map((subject) => {
                  const isEditing = editingId === subject.subject_id;
                  
                  return (
                    <TableRow key={subject.subject_id}>
                      <TableCell className="font-medium">{subject.name}</TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            value={editedHours[subject.subject_id] || "0"}
                            onChange={(e) => handleHoursChange(subject.subject_id, e.target.value)}
                            className="w-32 ml-auto"
                            autoFocus
                          />
                        ) : (
                          <span className="font-semibold">{subject.budget_hours} hours</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <div className="flex gap-2 justify-end">
                            <Button
                              size="sm"
                              onClick={() => handleSave(subject.subject_id)}
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
                            onClick={() => handleEdit(subject)}
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
