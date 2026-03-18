"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Trash2 } from "lucide-react";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";

interface TimeLog {
  time_id: number;
  job_id: number;
  user_id: string;
  user_name: string;
  subject: string;
  work_date: string;
  minutes: number;
  hours: number;
  notes: string;
  created_at: string;
}

interface TimeSubject {
  subject_id: number;
  name: string;
  budget_hours: number;
}

interface JobTimeEntriesProps {
  jobId: number;
  baseUrl: string;
}

export default function JobTimeEntries({ jobId, baseUrl }: JobTimeEntriesProps) {
  const confirmAction = useConfirmDialog();
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [timeSubjects, setTimeSubjects] = useState<TimeSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [totalHours, setTotalHours] = useState(0);
  const [estimatedHours, setEstimatedHours] = useState(0);
  const [budgetBySubject, setBudgetBySubject] = useState<Record<string, { actual: number; budget: number }>>({});

  // Form state for adding new time entry
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [workDate, setWorkDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [hours, setHours] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, [jobId]);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [logsResponse, subjectsResponse, jobResponse] = await Promise.all([
        fetch(`${baseUrl}/time-logs?job_id=${jobId}`, { credentials: "include" }),
        fetch(`${baseUrl}/time-subjects`, { credentials: "include" }),
        fetch(`${baseUrl}/jobs/${jobId}`, { credentials: "include" }),
      ]);

      if (!logsResponse.ok || !subjectsResponse.ok || !jobResponse.ok) {
        throw new Error("Failed to load data");
      }

      const logsData = await logsResponse.json();
      const subjectsData = await subjectsResponse.json();
      const jobData = await jobResponse.json();
      
      const logs = logsData.items || [];
      const subjects = subjectsData.items || [];
      
      setTimeLogs(logs);
      setTimeSubjects(subjects);

      // Set estimated hours from job type
      setEstimatedHours(jobData.estimated_hours || 0);

      // Calculate total actual hours
      const totalActual = logs.reduce((sum: number, log: TimeLog) => sum + log.hours, 0);
      setTotalHours(totalActual);

      // Calculate budget and actual hours by subject
      const subjectMap: Record<string, { actual: number; budget: number }> = {};
      
      // Initialize with all subjects that have time entries
      logs.forEach((log: TimeLog) => {
        if (!subjectMap[log.subject]) {
          const subjectInfo = subjects.find((s: TimeSubject) => s.name === log.subject);
          subjectMap[log.subject] = {
            actual: 0,
            budget: subjectInfo?.budget_hours || 0,
          };
        }
        subjectMap[log.subject].actual += log.hours;
      });

      setBudgetBySubject(subjectMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedSubject) {
      setStatus("Please select a subject");
      return;
    }

    if (!hours || parseFloat(hours) <= 0) {
      setStatus("Please enter valid hours");
      return;
    }

    const minutes = Math.round(parseFloat(hours) * 60);

    setSaving(true);
    setStatus("");

    try {
      const response = await fetch(`${baseUrl}/time-logs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          subject: selectedSubject,
          work_date: workDate,
          minutes,
          notes,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save time log");
      }

      setStatus("Time entry added successfully!");
      
      // Reset form
      setSelectedSubject("");
      setWorkDate(new Date().toISOString().split('T')[0]);
      setHours("");
      setNotes("");
      setShowAddForm(false);
      
      // Reload data
      loadData();
      
      setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save time entry");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(timeId: number) {
    const confirmed = await confirmAction({
      title: "Delete time entry?",
      description: "This time entry will be removed from the job log.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`${baseUrl}/time-logs/${timeId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to delete time log");
      }

      setStatus("Time entry deleted!");
      loadData();
      setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to delete time entry");
    }
  }

  function toggleAddForm() {
    if (showAddForm) {
      // Reset form when closing
      setSelectedSubject("");
      setWorkDate(new Date().toISOString().split('T')[0]);
      setHours("");
      setNotes("");
    }
    setShowAddForm(!showAddForm);
    setStatus("");
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading time entries...</div>;
  }

  if (error) {
    return <div className="text-sm text-destructive">Error: {error}</div>;
  }

  const variance = totalHours - estimatedHours;
  const variancePercent = estimatedHours > 0 ? (variance / estimatedHours) * 100 : 0;
  const isOverBudget = variance > 0;

  return (
    <div className="space-y-6">
      {/* Add Time Entry Form */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Add Time Entry</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject *</Label>
                  <Select value={selectedSubject} onValueChange={setSelectedSubject} required>
                    <SelectTrigger id="subject">
                      <SelectValue placeholder="Select subject..." />
                    </SelectTrigger>
                    <SelectContent>
                      {timeSubjects.map((subject) => (
                        <SelectItem key={subject.subject_id} value={subject.name}>
                          {subject.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="workDate">Work Date *</Label>
                  <Input
                    id="workDate"
                    type="date"
                    value={workDate}
                    onChange={(e) => setWorkDate(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hours">Hours *</Label>
                  <Input
                    id="hours"
                    type="number"
                    step="0.25"
                    min="0"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    placeholder="e.g., 2.5"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Description of work done..."
                  rows={3}
                />
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Add Time Entry"}
                </Button>
                <Button type="button" variant="outline" onClick={toggleAddForm}>
                  Cancel
                </Button>
              </div>

              {status && (
                <div className="text-sm text-muted-foreground">{status}</div>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <CardTitle>Time Entries</CardTitle>
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Actual: </span>
                  <span className="font-semibold">{totalHours.toFixed(2)}h</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Estimated: </span>
                  <span className="font-semibold">{estimatedHours.toFixed(2)}h</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Variance: </span>
                  <span className={`font-semibold ${isOverBudget ? 'text-red-600' : 'text-green-600'}`}>
                    {variance > 0 ? '+' : ''}{variance.toFixed(2)}h ({variancePercent > 0 ? '+' : ''}{variancePercent.toFixed(1)}%)
                  </span>
                </div>
              </div>
            </div>
            <Button onClick={toggleAddForm}>
              <Plus className="h-4 w-4 mr-2" />
              Add Time Entry
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {timeLogs.length === 0 && !showAddForm ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No time entries for this job yet.</p>
              <Button onClick={toggleAddForm} className="mt-4" variant="outline">
                Add your first time entry
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timeLogs.map((log) => (
                  <TableRow key={log.time_id}>
                    <TableCell>{log.work_date}</TableCell>
                    <TableCell>{log.user_name}</TableCell>
                    <TableCell>{log.subject || "-"}</TableCell>
                    <TableCell>{log.hours}</TableCell>
                    <TableCell className="max-w-md">
                      {log.notes || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(log.time_id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Budget Breakdown by Subject */}
      {Object.keys(budgetBySubject).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Budget Breakdown by Subject</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead className="text-right">Budget Hours</TableHead>
                  <TableHead className="text-right">Actual Hours</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">% of Budget</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(budgetBySubject).map(([subject, data]) => {
                  const subjectVariance = data.actual - data.budget;
                  const percentOfBudget = data.budget > 0 ? (data.actual / data.budget) * 100 : 0;
                  const isOver = subjectVariance > 0;
                  
                  return (
                    <TableRow key={subject}>
                      <TableCell className="font-medium">{subject}</TableCell>
                      <TableCell className="text-right">{data.budget.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{data.actual.toFixed(2)}</TableCell>
                      <TableCell className={`text-right font-semibold ${isOver ? 'text-red-600' : 'text-green-600'}`}>
                        {subjectVariance > 0 ? '+' : ''}{subjectVariance.toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${percentOfBudget > 100 ? 'text-red-600' : 'text-green-600'}`}>
                        {percentOfBudget.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
