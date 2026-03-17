"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/components/PageHeader";
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
import { Trash2, Edit } from "lucide-react";

function apiBaseUrl() {
  if (typeof window === "undefined") return "http://localhost:8000";
  return process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "-";
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

interface TimeLog {
  time_id: number;
  job_id: number;
  job_number: string;
  job_title: string;
  client_name: string;
  user_id: string;
  user_name: string;
  subject: string;
  work_date: string;
  minutes: number;
  hours: number;
  notes: string;
  created_at: string;
}

interface Job {
  job_id: number;
  job_number: string;
  title: string;
  client_name: string;
}

interface TimeSubject {
  subject_id: number;
  name: string;
  budget_hours: number;
}

function TimePageContent() {
  const searchParams = useSearchParams();
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [subjects, setSubjects] = useState<TimeSubject[]>([]);
  const [teamMembers, setTeamMembers] = useState<Array<{user_id: string; full_name: string}>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [filterUserId, setFilterUserId] = useState<string>("");

  // Form state
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [jobSearchQuery, setJobSearchQuery] = useState<string>("");
  const [filteredJobs, setFilteredJobs] = useState<Job[]>([]);
  const [showJobDropdown, setShowJobDropdown] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [workDate, setWorkDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [hours, setHours] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [editingId, setEditingId] = useState<number | null>(null);

  // Handle jobId query parameter to pre-select a job
  useEffect(() => {
    const jobIdParam = searchParams.get('jobId');
    if (jobIdParam && jobs.length > 0) {
      const job = jobs.find(j => j.job_id === parseInt(jobIdParam));
      if (job) {
        setSelectedJobId(String(job.job_id));
        setJobSearchQuery(`${job.job_number} - ${job.title}`);
      }
    }
  }, [searchParams, jobs]);

  useEffect(() => {
    loadData();
  }, [filterUserId]);

  useEffect(() => {
    // Filter jobs based on search query
    if (jobSearchQuery.trim() === "") {
      setFilteredJobs([]);
    } else {
      const query = jobSearchQuery.toLowerCase();
      const filtered = jobs.filter(
        (job) =>
          job.job_number?.toLowerCase().includes(query) ||
          job.title?.toLowerCase().includes(query) ||
          job.client_name?.toLowerCase().includes(query)
      );
      setFilteredJobs(filtered.slice(0, 50)); // Limit to 50 results
    }
  }, [jobSearchQuery, jobs]);

  useEffect(() => {
    // Close dropdown when clicking outside
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest('#job') && !target.closest('.job-dropdown')) {
        setShowJobDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const baseUrl = apiBaseUrl();
      const userFilter = filterUserId ? `?user_id=${filterUserId}` : "";
      const [timeRes, jobsRes, subjectsRes, teamRes] = await Promise.all([
        fetch(`${baseUrl}/time-logs${userFilter}`, { credentials: "include" }),
        fetch(`${baseUrl}/jobs?limit=200`, { credentials: "include" }),
        fetch(`${baseUrl}/time-subjects`, { credentials: "include" }),
        fetch(`${baseUrl}/admin/users`, { credentials: "include" }),
      ]);

      if (!timeRes.ok || !jobsRes.ok || !subjectsRes.ok || !teamRes.ok) {
        const failures = [
          !timeRes.ok ? `time logs (${timeRes.status})` : null,
          !jobsRes.ok ? `jobs (${jobsRes.status})` : null,
          !subjectsRes.ok ? `time subjects (${subjectsRes.status})` : null,
          !teamRes.ok ? `team members (${teamRes.status})` : null,
        ].filter(Boolean);
        throw new Error(`Failed to load data: ${failures.join(", ")}`);
      }

      const timeData = await timeRes.json();
      const jobsData = await jobsRes.json();
      const subjectsData = await subjectsRes.json();
      const teamData = await teamRes.json();

      setTimeLogs(timeData.items || []);
      setJobs(jobsData.items || []);
      setSubjects(subjectsData.items || []);
      setTeamMembers(teamData.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedJobId) {
      setStatus("Please select a job");
      return;
    }

    if (!selectedSubject) {
      setStatus("Please select a subject");
      return;
    }

    if (!hours || parseFloat(hours) <= 0) {
      setStatus("Please enter valid hours");
      return;
    }

    const minutes = Math.round(parseFloat(hours) * 60);

    try {
      const baseUrl = apiBaseUrl();
      const url = editingId
        ? `${baseUrl}/time-logs/${editingId}`
        : `${baseUrl}/time-logs`;
      const method = editingId ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: parseInt(selectedJobId),
          subject: selectedSubject,
          work_date: workDate,
          minutes,
          notes,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save time log");
      }

      setStatus(editingId ? "Time log updated!" : "Time log added!");
      resetForm();
      loadData();

      setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save time log");
    }
  }

  function resetForm() {
    setSelectedJobId("");
    setJobSearchQuery("");
    setSelectedSubject("");
    setWorkDate(new Date().toISOString().split('T')[0]);
    setHours("");
    setNotes("");
    setEditingId(null);
  }

  function handleEdit(log: TimeLog) {
    setSelectedJobId(String(log.job_id));
    setJobSearchQuery(`${log.job_number} - ${log.job_title}`);
    setSelectedSubject(log.subject);
    setWorkDate(log.work_date);
    setHours(String(log.hours));
    setNotes(log.notes);
    setEditingId(log.time_id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDelete(timeId: number) {
    if (!confirm("Are you sure you want to delete this time entry?")) {
      return;
    }

    try {
      const baseUrl = apiBaseUrl();
      const response = await fetch(`${baseUrl}/time-logs/${timeId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to delete time log");
      }

      setStatus("Time log deleted!");
      loadData();
      setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to delete time log");
    }
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

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto w-full max-w-7xl px-6 py-10">
          <div className="text-red-600">Error: {error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <PageHeader
          title="Time Tracking"
          subtitle="Log and review time entries"
          breadcrumbs={[{ label: "Time Tracking" }]}
        />

        <div className="space-y-6">

      {/* Add/Edit Time Entry Form */}
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit Time Entry" : "Add Time Entry"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="job">Job *</Label>
                <div className="relative">
                  <Input
                    id="job"
                    type="text"
                    placeholder="Search by job number, title, or client..."
                    value={jobSearchQuery}
                    onChange={(e) => {
                      setJobSearchQuery(e.target.value);
                      setShowJobDropdown(true);
                    }}
                    onFocus={() => setShowJobDropdown(true)}
                    required
                  />
                  {showJobDropdown && filteredJobs.length > 0 && (
                    <div className="job-dropdown absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-auto">
                      {filteredJobs.map((job) => (
                        <div
                          key={job.job_id}
                          className="px-3 py-2 cursor-pointer hover:bg-accent hover:text-accent-foreground text-sm"
                          onClick={() => {
                            setSelectedJobId(String(job.job_id));
                            setJobSearchQuery(`${job.job_number} - ${job.title}`);
                            setShowJobDropdown(false);
                          }}
                        >
                          <div className="font-medium">{job.job_number} - {job.title}</div>
                          <div className="text-xs text-muted-foreground">{job.client_name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {showJobDropdown && jobSearchQuery && filteredJobs.length === 0 && (
                    <div className="job-dropdown absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg p-3 text-sm text-muted-foreground">
                      No jobs found. Try a different search term.
                    </div>
                  )}
                </div>
                {selectedJobId && (
                  <p className="text-xs text-muted-foreground">
                    Selected Job ID: {selectedJobId}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="subject">Subject *</Label>
                <Select value={selectedSubject} onValueChange={setSelectedSubject} required>
                  <SelectTrigger id="subject">
                    <SelectValue placeholder="Select subject..." />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((subject) => (
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
              <Button type="submit">
                {editingId ? "Update Time Entry" : "Add Time Entry"}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>

            {status && (
              <div className="text-sm text-muted-foreground">{status}</div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Time Logs Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Time Entries</CardTitle>
            <div className="flex items-center gap-2">
              <Label htmlFor="userFilter" className="text-sm">Filter by user:</Label>
              <Select value={filterUserId || "__all__"} onValueChange={(val) => setFilterUserId(val === "__all__" ? "" : val)}>
                <SelectTrigger id="userFilter" className="w-[200px]">
                  <SelectValue placeholder="All users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All users</SelectItem>
                  {teamMembers.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {timeLogs.length === 0 ? (
            <p className="text-muted-foreground">No time entries yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timeLogs.map((log) => (
                  <TableRow key={log.time_id}>
                    <TableCell>{formatDate(log.work_date)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{log.job_number}</div>
                      <div className="text-sm text-muted-foreground">
                        {log.job_title}
                      </div>
                    </TableCell>
                    <TableCell>{log.client_name}</TableCell>
                    <TableCell>{log.subject || "-"}</TableCell>
                    <TableCell>{log.hours}</TableCell>
                    <TableCell>{log.user_name}</TableCell>
                    <TableCell className="max-w-xs truncate">
                      {log.notes || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(log)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(log.time_id)}
                        >
                          <Trash2 className="h-4 w-4" />
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
    </div>
  );
}

export default function TimePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl p-6 text-sm text-muted-foreground">Loading...</div>}>
      <TimePageContent />
    </Suspense>
  );
}
