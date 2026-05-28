"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import TaskAssigneePicker, { type TaskAssigneeOption } from "@/components/TaskAssigneePicker";

function apiBaseUrl() {
  return "/api/backend";
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

interface TeamMember {
  user_id: string;
  full_name: string;
  email?: string | null;
  role?: string | null;
  position?: string | null;
  status?: string | null;
}

interface ClientContact {
  contact_id: number;
  full_name?: string | null;
  job_title?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface JobDetail {
  job_id: number;
  client_db_id?: number | null;
}

function addDaysIso(sourceIso: string, days: number): string {
  const dt = new Date(`${sourceIso}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return sourceIso;
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().split("T")[0];
}

function TimePageContent() {
  const searchParams = useSearchParams();
  const confirmAction = useConfirmDialog();
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [subjects, setSubjects] = useState<TimeSubject[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [clientContacts, setClientContacts] = useState<ClientContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [filterUserId, setFilterUserId] = useState<string>("");
  const [, setSelectedJobClientId] = useState<number | null>(null);

  // Form state
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [jobSearchQuery, setJobSearchQuery] = useState<string>("");
  const [filteredJobs, setFilteredJobs] = useState<Job[]>([]);
  const [showJobDropdown, setShowJobDropdown] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [workDate, setWorkDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [hours, setHours] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [createTask, setCreateTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState<string>("");
  const [taskDetails, setTaskDetails] = useState<string>("");
  const [taskDueDate, setTaskDueDate] = useState<string>("");
  const [taskPriority, setTaskPriority] = useState<string>("normal");
  const [selectedTaskAssignees, setSelectedTaskAssignees] = useState<string[]>([]);
  const [taskAssigneeLoading, setTaskAssigneeLoading] = useState(false);
  const [notifyTaskAssignee, setNotifyTaskAssignee] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const activeTeamMembers = useMemo(
    () => teamMembers.filter((member) => String(member.status ?? "").trim().toLowerCase() === "active"),
    [teamMembers]
  );

  const taskAssigneeOptions = useMemo<TaskAssigneeOption[]>(() => {
    const options: TaskAssigneeOption[] = [];
    const seen = new Set<string>();

    activeTeamMembers.forEach((member) => {
      const label = String(member.full_name || member.email || "").trim();
      if (!label) return;
      const key = `team:${String(member.user_id || label).trim().toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      options.push({
        value: key,
        label,
        meta: [member.position, member.role, member.email].filter(Boolean).join(" • "),
      });
    });

    clientContacts.forEach((contact) => {
      const label = String(contact.full_name || contact.email || "").trim();
      if (!label) return;
      const key = `client:${contact.contact_id}`;
      if (seen.has(key)) return;
      seen.add(key);
      options.push({
        value: key,
        label,
        meta: [contact.job_title, contact.email].filter(Boolean).join(" • "),
      });
    });

    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [activeTeamMembers, clientContacts]);

  const selectedTaskAssigneeLabels = useMemo(
    () =>
      selectedTaskAssignees
        .map((value) => taskAssigneeOptions.find((option) => option.value === value)?.label)
        .filter((value): value is string => Boolean(value)),
    [selectedTaskAssignees, taskAssigneeOptions]
  );

  const loadData = useCallback(async () => {
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
  }, [filterUserId]);

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
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;

    async function loadClientContacts() {
      setTaskAssigneeLoading(true);
      setClientContacts([]);
      setSelectedJobClientId(null);
      setSelectedTaskAssignees((prev) => prev.filter((value) => value.startsWith("team:")));

      const jobIdNum = Number(selectedJobId);
      if (!Number.isFinite(jobIdNum) || jobIdNum <= 0) {
        if (!cancelled) setTaskAssigneeLoading(false);
        return;
      }

      try {
        const baseUrl = apiBaseUrl();
        const jobRes = await fetch(`${baseUrl}/jobs/${jobIdNum}`, { credentials: "include" });
        if (!jobRes.ok) {
          throw new Error("Failed to load selected job");
        }
        const jobJson = (await jobRes.json()) as JobDetail;
        if (cancelled) return;
        const clientDbId = jobJson?.client_db_id != null ? Number(jobJson.client_db_id) : null;
        setSelectedJobClientId(Number.isFinite(clientDbId ?? NaN) ? clientDbId : null);
        if (!clientDbId || !Number.isFinite(clientDbId)) {
          return;
        }

        const contactsRes = await fetch(`${baseUrl}/clients/${clientDbId}/contacts`, { credentials: "include" });
        if (!contactsRes.ok) {
          throw new Error("Failed to load client contacts");
        }
        const contactsJson = await contactsRes.json();
        if (!cancelled) {
          setClientContacts(Array.isArray(contactsJson?.contacts) ? contactsJson.contacts : []);
        }
      } catch {
        if (!cancelled) {
          setClientContacts([]);
        }
      } finally {
        if (!cancelled) setTaskAssigneeLoading(false);
      }
    }

    void loadClientContacts();
    return () => {
      cancelled = true;
    };
  }, [selectedJobId]);

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

    if (createTask) {
      if (!taskTitle.trim()) {
        setStatus("Please enter a task title");
        return;
      }
      if (!taskDueDate) {
        setStatus("Please choose a task due date");
        return;
      }
      if (selectedTaskAssignees.length === 0) {
        setStatus("Please select at least one task assignee");
        return;
      }
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

      if (createTask) {
        // Resolve first assignee's email/identifier for backend notification lookup
        const firstAssignee = selectedTaskAssignees[0] ?? null;
        let assigneeUserId: string | null = null;
        if (firstAssignee) {
          if (firstAssignee.startsWith("team:")) {
            assigneeUserId = firstAssignee.slice(5); // user_id is their email
          } else if (firstAssignee.startsWith("client:")) {
            const contactId = parseInt(firstAssignee.slice(7));
            const contact = clientContacts.find((c) => c.contact_id === contactId);
            assigneeUserId = contact?.email ?? null;
          } else {
            assigneeUserId = firstAssignee;
          }
        }
        const taskResponse = await fetch(`${baseUrl}/jobs/${parseInt(selectedJobId)}/communications/tasks`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: taskTitle.trim(),
            details: taskDetails.trim() || notes.trim() || "",
            assignee_user_id: assigneeUserId,
            assigned_to: selectedTaskAssigneeLabels.join(", "),
            priority: taskPriority,
            due_at: taskDueDate,
            due_date: taskDueDate,
            status: "open",
            notify_assignee: notifyTaskAssignee && !!assigneeUserId,
          }),
        });

        if (!taskResponse.ok) {
          const taskText = await taskResponse.text().catch(() => "");
          throw new Error(taskText ? `Task creation failed: ${taskText}` : "Task creation failed");
        }
      }

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
    setCreateTask(false);
    setTaskTitle("");
    setTaskDetails("");
    setTaskDueDate("");
    setTaskPriority("normal");
    setSelectedTaskAssignees([]);
    setNotifyTaskAssignee(false);
    setClientContacts([]);
    setSelectedJobClientId(null);
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
    setCreateTask(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDelete(timeId: number) {
    const confirmed = await confirmAction({
      title: "Delete time entry?",
      description: "This time entry will be removed from the log.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) {
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

            <div className="rounded-lg border bg-slate-50 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <input
                  id="createTask"
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={createTask}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setCreateTask(checked);
                    if (checked && !taskDueDate) {
                      setTaskDueDate(addDaysIso(workDate, 7));
                    }
                    if (checked && !taskTitle.trim()) {
                      setTaskTitle(`Follow-up: ${selectedSubject || "time entry"}`);
                    }
                  }}
                />
                <Label htmlFor="createTask" className="font-medium">
                  Create action task
                </Label>
              </div>

              {createTask ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Create a follow-up task for the selected job and add it to the job task list.
                  </p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="taskTitle">Task Title *</Label>
                      <Input
                        id="taskTitle"
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        placeholder="e.g. Follow up on client response"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="taskDueDate">Deadline *</Label>
                      <Input
                        id="taskDueDate"
                        type="date"
                        value={taskDueDate}
                        onChange={(e) => setTaskDueDate(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="taskPriority">Priority</Label>
                    <Select value={taskPriority} onValueChange={setTaskPriority}>
                      <SelectTrigger id="taskPriority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Assign to *</Label>
                    <TaskAssigneePicker
                      value={selectedTaskAssignees}
                      options={taskAssigneeOptions}
                      onChange={setSelectedTaskAssignees}
                      loading={taskAssigneeLoading}
                      placeholder={taskAssigneeOptions.length === 0 ? "Pick a job to load assignees..." : "Search team members or contacts..."}
                      emptyMessage={selectedJobId ? "No assignees match your search." : "Pick a job to load assignees."}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="taskDetails">Task Details</Label>
                    <Textarea
                      id="taskDetails"
                      value={taskDetails}
                      onChange={(e) => setTaskDetails(e.target.value)}
                      placeholder="Add extra context for the task..."
                      rows={4}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={notifyTaskAssignee}
                      onChange={(e) => setNotifyTaskAssignee(e.target.checked)}
                      disabled={selectedTaskAssignees.length === 0}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Notify assignee by email when task is created
                    {selectedTaskAssignees.length === 0 && (
                      <span className="text-xs text-muted-foreground">(select assignee first)</span>
                    )}
                  </label>
                </>
              ) : null}
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
