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
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Edit,
  FolderUp,
  Printer,
  Trash2,
  X,
} from "lucide-react";
import { useConfirmDialog } from "@/components/ConfirmDialogProvider";
import TaskAssigneePicker, { type TaskAssigneeOption } from "@/components/TaskAssigneePicker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { uploadFormDataWithProgress } from "@/lib/upload-with-progress";

function apiBaseUrl() {
  return "/api/backend";
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "-";
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
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

interface ReportFilters {
  userId: string;
  dateFrom: string;
  dateTo: string;
  jobSearch: string;
  clientSearch: string;
}

function addDaysIso(sourceIso: string, days: number): string {
  const dt = new Date(`${sourceIso}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return sourceIso;
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().split("T")[0];
}

function fmtH(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
}

function generateReportHtml(
  logs: TimeLog[],
  filters: ReportFilters,
  teamMembers: TeamMember[]
): string {
  const totalHours = logs.reduce((s, l) => s + l.hours, 0);

  const byUserMap = new Map<string, { name: string; entries: number; hours: number }>();
  for (const log of logs) {
    const key = log.user_id || "unknown";
    const name = log.user_name || log.user_id || "Unknown";
    if (!byUserMap.has(key)) byUserMap.set(key, { name, entries: 0, hours: 0 });
    const u = byUserMap.get(key)!;
    u.entries += 1;
    u.hours += log.hours;
  }
  const byUser = [...byUserMap.values()].sort((a, b) => b.hours - a.hours);

  const byClientMap = new Map<string, { entries: number; hours: number }>();
  for (const log of logs) {
    const key = log.client_name || "Unassigned";
    if (!byClientMap.has(key)) byClientMap.set(key, { entries: 0, hours: 0 });
    const c = byClientMap.get(key)!;
    c.entries += 1;
    c.hours += log.hours;
  }
  const byClient = [...byClientMap.entries()].sort((a, b) => b[1].hours - a[1].hours);

  const dateStr = new Date().toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const filterParts: string[] = [];
  if (filters.userId) {
    const m = teamMembers.find((x) => x.user_id === filters.userId);
    filterParts.push(`Staff: ${m?.full_name || filters.userId}`);
  }
  if (filters.dateFrom) filterParts.push(`From: ${formatDate(filters.dateFrom)}`);
  if (filters.dateTo) filterParts.push(`To: ${formatDate(filters.dateTo)}`);
  if (filters.jobSearch) filterParts.push(`Job: &ldquo;${filters.jobSearch}&rdquo;`);
  if (filters.clientSearch) filterParts.push(`Client: &ldquo;${filters.clientSearch}&rdquo;`);
  const filterDesc = filterParts.length ? filterParts.join(" &nbsp;&bull;&nbsp; ") : "All records";

  const rowsHtml = logs
    .map(
      (log) => `
    <tr>
      <td>${formatDate(log.work_date)}</td>
      <td>${log.job_number ? `<strong>${log.job_number}</strong>` : ""}${log.job_title ? `<br><span style="color:#666;font-size:10.5px">${log.job_title}</span>` : ""}</td>
      <td>${log.client_name || ""}</td>
      <td>${log.subject || ""}</td>
      <td style="text-align:right;font-weight:600">${fmtH(log.hours)}</td>
      <td>${log.user_name || log.user_id || ""}</td>
      <td style="color:#444;font-size:10.5px">${log.notes || ""}</td>
    </tr>`
    )
    .join("");

  const byUserHtml = byUser
    .map(
      (u) => `
    <tr>
      <td>${u.name}</td>
      <td style="text-align:center">${u.entries}</td>
      <td style="text-align:right;font-weight:600">${fmtH(u.hours)}</td>
    </tr>`
    )
    .join("");

  const byClientHtml = byClient
    .map(
      ([name, c]) => `
    <tr>
      <td>${name}</td>
      <td style="text-align:center">${c.entries}</td>
      <td style="text-align:right;font-weight:600">${fmtH(c.hours)}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>NZI Time Report &ndash; ${dateStr}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;background:#fff;padding:28px 36px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #16a34a;padding-bottom:14px;margin-bottom:16px}
.brand h1{font-size:22px;font-weight:700;color:#16a34a;letter-spacing:-0.5px}
.brand p{font-size:11px;color:#6b7280;margin-top:3px}
.meta{text-align:right;font-size:11px;color:#6b7280}
.meta .rtitle{font-size:17px;font-weight:700;color:#111;margin-bottom:4px}
.filters{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;padding:8px 12px;margin-bottom:14px;font-size:11px;color:#166534}
.stats{display:flex;gap:16px;margin-bottom:16px}
.stat{background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:8px 14px;min-width:80px}
.stat .sv{font-size:20px;font-weight:700;color:#16a34a}
.stat .sl{font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-top:1px}
h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#374151;margin:18px 0 6px;border-bottom:2px solid #e5e7eb;padding-bottom:4px}
table{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:4px}
th{background:#f1f5f9;text-align:left;padding:5px 7px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;color:#475569;border-bottom:2px solid #cbd5e1}
td{padding:5px 7px;border-bottom:1px solid #e5e7eb;vertical-align:top}
.tr-total td{background:#f0fdf4;font-weight:700;border-top:2px solid #86efac}
.sum-wrap{display:flex;gap:24px;margin-top:6px}
.sum-wrap>div{flex:1}
.footer{margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;text-align:center}
@media print{body{padding:0}@page{margin:12mm;size:A4 landscape}}
</style>
</head>
<body>
<div class="hdr">
  <div class="brand">
    <h1>Net Zero International</h1>
    <p>Carbon Management &amp; Reporting</p>
  </div>
  <div class="meta">
    <div class="rtitle">Time Report</div>
    <div>Generated: ${dateStr}</div>
  </div>
</div>
<div class="filters"><strong>Filters:</strong>&nbsp; ${filterDesc}</div>
<div class="stats">
  <div class="stat"><div class="sv">${logs.length}</div><div class="sl">Entries</div></div>
  <div class="stat"><div class="sv">${fmtH(totalHours)}</div><div class="sl">Total Hours</div></div>
  <div class="stat"><div class="sv">${byUserMap.size}</div><div class="sl">Staff</div></div>
  <div class="stat"><div class="sv">${byClientMap.size}</div><div class="sl">Clients</div></div>
</div>
<h2>Time Entries</h2>
<table>
  <thead><tr>
    <th style="width:78px">Date</th>
    <th style="width:130px">Job</th>
    <th style="width:120px">Client</th>
    <th style="width:100px">Subject</th>
    <th style="width:52px;text-align:right">Hours</th>
    <th style="width:110px">Staff</th>
    <th>Notes</th>
  </tr></thead>
  <tbody>
    ${rowsHtml}
    <tr class="tr-total">
      <td colspan="4" style="text-align:right">Total</td>
      <td style="text-align:right">${fmtH(totalHours)}</td>
      <td colspan="2"></td>
    </tr>
  </tbody>
</table>
<div class="sum-wrap">
  <div>
    <h2>Summary by Staff Member</h2>
    <table>
      <thead><tr><th>Staff Member</th><th style="text-align:center">Entries</th><th style="text-align:right">Hours</th></tr></thead>
      <tbody>
        ${byUserHtml}
        <tr class="tr-total"><td>Total</td><td style="text-align:center">${logs.length}</td><td style="text-align:right">${fmtH(totalHours)}</td></tr>
      </tbody>
    </table>
  </div>
  <div>
    <h2>Summary by Client</h2>
    <table>
      <thead><tr><th>Client</th><th style="text-align:center">Entries</th><th style="text-align:right">Hours</th></tr></thead>
      <tbody>
        ${byClientHtml}
        <tr class="tr-total"><td>Total</td><td style="text-align:center">${logs.length}</td><td style="text-align:right">${fmtH(totalHours)}</td></tr>
      </tbody>
    </table>
  </div>
</div>
<div class="footer">Net Zero International Pty Ltd &nbsp;&bull;&nbsp; Time Report &nbsp;&bull;&nbsp; ${dateStr} &nbsp;&bull;&nbsp; Confidential</div>
</body>
</html>`;
}

function TimePageContent() {
  const searchParams = useSearchParams();
  const confirmAction = useConfirmDialog();
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [subjects, setSubjects] = useState<TimeSubject[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [clientContacts, setClientContacts] = useState<ClientContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [, setSelectedJobClientId] = useState<number | null>(null);

  // Save-to-files modal state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTarget, setSaveTarget] = useState<"job" | "client">("job");
  const [saveFormat, setSaveFormat] = useState<"csv" | "html">("csv");
  const [saveJobQuery, setSaveJobQuery] = useState("");
  const [saveJobId, setSaveJobId] = useState<number | null>(null);
  const [saveJobLabel, setSaveJobLabel] = useState("");
  const [saveJobResults, setSaveJobResults] = useState<Array<{ job_id: number; job_number: string; title: string; client_name: string }>>([]);
  const [saveJobSearching, setSaveJobSearching] = useState(false);
  const [saveClientQuery, setSaveClientQuery] = useState("");
  const [saveClientId, setSaveClientId] = useState<number | null>(null);
  const [saveClientLabel, setSaveClientLabel] = useState("");
  const [saveClientResults, setSaveClientResults] = useState<Array<{ client_db_id: number; client_name: string }>>([]);
  const [saveClientSearching, setSaveClientSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  // Applied filters drive the API call; draft filters are what the user is typing
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters>({
    userId: "",
    dateFrom: "",
    dateTo: "",
    jobSearch: "",
    clientSearch: "",
  });
  const [draftUserId, setDraftUserId] = useState<string>("");
  const [staffQuery, setStaffQuery] = useState<string>("");
  const [showStaffDropdown, setShowStaffDropdown] = useState(false);
  const [draftDateFrom, setDraftDateFrom] = useState<string>("");
  const [draftDateTo, setDraftDateTo] = useState<string>("");
  const [draftJobSearch, setDraftJobSearch] = useState<string>("");
  const [draftClientSearch, setDraftClientSearch] = useState<string>("");

  // Form state
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [jobSearchQuery, setJobSearchQuery] = useState<string>("");
  const [filteredJobs, setFilteredJobs] = useState<Job[]>([]);
  const [jobSearchLoading, setJobSearchLoading] = useState(false);
  const [showJobDropdown, setShowJobDropdown] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [workDate, setWorkDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
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
    () =>
      teamMembers.filter(
        (member) =>
          String(member.status ?? "").trim().toLowerCase() === "active"
      ),
    [teamMembers]
  );

  // Staff Member filter needs to list everyone (including disabled staff, so
  // historical entries stay filterable) but must disambiguate duplicate/typo'd
  // accounts sharing a display name -- otherwise picking "the" match is a
  // silent coin flip between a real account and an empty one.
  const staffFilterOptions = useMemo(() => {
    const isActive = (m: TeamMember) =>
      String(m.status ?? "").trim().toLowerCase() === "active";
    const nameCounts = new Map<string, number>();
    for (const m of teamMembers) {
      const key = (m.full_name || "").trim().toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
    return [...teamMembers]
      .sort((a, b) => {
        const aActive = isActive(a) ? 0 : 1;
        const bActive = isActive(b) ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return (a.full_name || "").localeCompare(b.full_name || "");
      })
      .map((member) => {
        const key = (member.full_name || "").trim().toLowerCase();
        const isDuplicateName = (nameCounts.get(key) || 0) > 1;
        const active = isActive(member);
        const suffixParts: string[] = [];
        if (isDuplicateName && member.email) suffixParts.push(member.email);
        if (!active) suffixParts.push("Disabled");
        const label = suffixParts.length
          ? `${member.full_name} (${suffixParts.join(" — ")})`
          : member.full_name;
        return { user_id: member.user_id, label };
      });
  }, [teamMembers]);

  const filteredStaffOptions = useMemo(() => {
    const q = staffQuery.trim().toLowerCase();
    if (!q) return staffFilterOptions;
    return staffFilterOptions.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [staffFilterOptions, staffQuery]);

  const selectedStaffLabel = useMemo(
    () => staffFilterOptions.find((opt) => opt.user_id === draftUserId)?.label || "",
    [staffFilterOptions, draftUserId]
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
        .map(
          (value) =>
            taskAssigneeOptions.find((option) => option.value === value)?.label
        )
        .filter((value): value is string => Boolean(value)),
    [selectedTaskAssignees, taskAssigneeOptions]
  );

  const totalHours = useMemo(
    () => timeLogs.reduce((s, l) => s + l.hours, 0),
    [timeLogs]
  );

  const totalPages = Math.max(1, Math.ceil(timeLogs.length / rowsPerPage));
  const paginatedTimeLogs = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return timeLogs.slice(start, start + rowsPerPage);
  }, [currentPage, rowsPerPage, timeLogs]);
  const firstVisibleRow = timeLogs.length === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1;
  const lastVisibleRow = Math.min(currentPage * rowsPerPage, timeLogs.length);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const hasActiveFilters =
    appliedFilters.userId ||
    appliedFilters.dateFrom ||
    appliedFilters.dateTo ||
    appliedFilters.jobSearch ||
    appliedFilters.clientSearch;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const baseUrl = apiBaseUrl();
      const qp = new URLSearchParams();
      if (appliedFilters.userId) qp.set("user_id", appliedFilters.userId);
      if (appliedFilters.dateFrom) qp.set("date_from", appliedFilters.dateFrom);
      if (appliedFilters.dateTo) qp.set("date_to", appliedFilters.dateTo);
      if (appliedFilters.jobSearch) qp.set("job_search", appliedFilters.jobSearch);
      if (appliedFilters.clientSearch) qp.set("client_search", appliedFilters.clientSearch);
      const query = qp.toString() ? `?${qp.toString()}` : "";

      const [timeRes, subjectsRes, teamRes] = await Promise.all([
        fetch(`${baseUrl}/time-logs${query}`, { credentials: "include" }),
        fetch(`${baseUrl}/time-subjects`, { credentials: "include" }),
        fetch(`${baseUrl}/admin/users`, { credentials: "include" }),
      ]);

      if (!timeRes.ok || !subjectsRes.ok || !teamRes.ok) {
        const failures = [
          !timeRes.ok ? `time logs (${timeRes.status})` : null,
          !subjectsRes.ok ? `time subjects (${subjectsRes.status})` : null,
          !teamRes.ok ? `team members (${teamRes.status})` : null,
        ].filter(Boolean);
        throw new Error(`Failed to load data: ${failures.join(", ")}`);
      }

      const timeData = await timeRes.json();
      const subjectsData = await subjectsRes.json();
      const teamData = await teamRes.json();

      setTimeLogs(timeData.items || []);
      setSubjects(subjectsData.items || []);
      setTeamMembers(teamData.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  // Handle jobId query parameter to pre-select a job
  useEffect(() => {
    const jobIdParam = searchParams.get("jobId");
    if (!jobIdParam) return;
    const baseUrl = apiBaseUrl();
    fetch(`${baseUrl}/jobs/${jobIdParam}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.job_id) {
          setSelectedJobId(String(data.job_id));
          setJobSearchQuery(`${data.job_number} - ${data.title}`);
        }
      })
      .catch(() => null);
  }, [searchParams]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;

    async function loadClientContacts() {
      setTaskAssigneeLoading(true);
      setClientContacts([]);
      setSelectedJobClientId(null);
      setSelectedTaskAssignees((prev) =>
        prev.filter((value) => value.startsWith("team:"))
      );

      const jobIdNum = Number(selectedJobId);
      if (!Number.isFinite(jobIdNum) || jobIdNum <= 0) {
        if (!cancelled) setTaskAssigneeLoading(false);
        return;
      }

      try {
        const baseUrl = apiBaseUrl();
        const jobRes = await fetch(`${baseUrl}/jobs/${jobIdNum}`, {
          credentials: "include",
        });
        if (!jobRes.ok) throw new Error("Failed to load selected job");
        const jobJson = (await jobRes.json()) as JobDetail;
        if (cancelled) return;
        const clientDbId =
          jobJson?.client_db_id != null ? Number(jobJson.client_db_id) : null;
        setSelectedJobClientId(
          Number.isFinite(clientDbId ?? NaN) ? clientDbId : null
        );
        if (!clientDbId || !Number.isFinite(clientDbId)) return;

        const contactsRes = await fetch(
          `${baseUrl}/clients/${clientDbId}/contacts`,
          { credentials: "include" }
        );
        if (!contactsRes.ok) throw new Error("Failed to load client contacts");
        const contactsJson = await contactsRes.json();
        if (!cancelled) {
          setClientContacts(
            Array.isArray(contactsJson?.contacts) ? contactsJson.contacts : []
          );
        }
      } catch {
        if (!cancelled) setClientContacts([]);
      } finally {
        if (!cancelled) setTaskAssigneeLoading(false);
      }
    }

    void loadClientContacts();
    return () => {
      cancelled = true;
    };
  }, [selectedJobId]);

  // Server-side job search — fires after 250 ms of inactivity
  useEffect(() => {
    const q = jobSearchQuery.trim();
    if (!q || selectedJobId) {
      setFilteredJobs([]);
      return;
    }
    setJobSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${apiBaseUrl()}/jobs?q=${encodeURIComponent(q)}&limit=50`,
          { credentials: "include" }
        );
        if (res.ok) {
          const data = await res.json();
          setFilteredJobs(data.items || []);
        }
      } catch {
        // silent
      } finally {
        setJobSearchLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [jobSearchQuery, selectedJobId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest("#job") && !target.closest(".job-dropdown")) {
        setShowJobDropdown(false);
      }
      if (!target.closest("#staffMemberFilter") && !target.closest(".staff-dropdown")) {
        setShowStaffDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function applyReportFilters() {
    setCurrentPage(1);
    setAppliedFilters({
      userId: draftUserId,
      dateFrom: draftDateFrom,
      dateTo: draftDateTo,
      jobSearch: draftJobSearch,
      clientSearch: draftClientSearch,
    });
  }

  function clearReportFilters() {
    setCurrentPage(1);
    setDraftUserId("");
    setStaffQuery("");
    setDraftDateFrom("");
    setDraftDateTo("");
    setDraftJobSearch("");
    setDraftClientSearch("");
    setAppliedFilters({
      userId: "",
      dateFrom: "",
      dateTo: "",
      jobSearch: "",
      clientSearch: "",
    });
  }

  function downloadCsv() {
    const headers = [
      "Date",
      "Job Number",
      "Job Title",
      "Client",
      "Subject",
      "Hours",
      "Staff",
      "Notes",
    ];
    const rows = timeLogs.map((log) => [
      log.work_date || "",
      log.job_number || "",
      log.job_title || "",
      log.client_name || "",
      log.subject || "",
      String(log.hours),
      log.user_name || log.user_id || "",
      log.notes || "",
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      )
      .join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `time-report-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function printReport() {
    const html = generateReportHtml(timeLogs, appliedFilters, teamMembers);
    const win = window.open("", "_blank", "width=1100,height=700,scrollbars=yes");
    if (!win) {
      alert("Please allow pop-ups to open the print report.");
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
    }, 400);
  }

  useEffect(() => {
    const q = saveJobQuery.trim();
    if (!q || saveJobId) { setSaveJobResults([]); return; }
    setSaveJobSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBaseUrl()}/jobs?q=${encodeURIComponent(q)}&limit=20`, { credentials: "include" });
        if (res.ok) { const d = await res.json(); setSaveJobResults(d.items || []); }
      } finally { setSaveJobSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [saveJobQuery, saveJobId]);

  useEffect(() => {
    const q = saveClientQuery.trim();
    if (!q || saveClientId) { setSaveClientResults([]); return; }
    setSaveClientSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBaseUrl()}/clients?q=${encodeURIComponent(q)}&limit=20`, { credentials: "include" });
        if (res.ok) { const d = await res.json(); setSaveClientResults(d.items || []); }
      } finally { setSaveClientSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [saveClientQuery, saveClientId]);

  async function handleSaveToFiles() {
    const targetId = saveTarget === "job" ? saveJobId : saveClientId;
    if (!targetId) { setSaveStatus("Please select a target"); return; }
    if (timeLogs.length === 0) { setSaveStatus("No entries to save"); return; }

    setSaving(true);
    setSaveStatus("");
    try {
      const dateStr = new Date().toISOString().split("T")[0];
      let content: Blob;
      let fileName: string;
      let mimeType: string;

      if (saveFormat === "csv") {
        const headers = ["Date", "Job Number", "Job Title", "Client", "Subject", "Hours", "Staff", "Notes"];
        const rows = timeLogs.map((log) => [
          log.work_date || "",
          log.job_number || "",
          log.job_title || "",
          log.client_name || "",
          log.subject || "",
          String(log.hours),
          log.user_name || log.user_id || "",
          log.notes || "",
        ]);
        const csv = [headers, ...rows]
          .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
          .join("\r\n");
        content = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
        fileName = `time-report-${dateStr}.csv`;
        mimeType = "text/csv";
      } else {
        const html = generateReportHtml(timeLogs, appliedFilters, teamMembers);
        content = new Blob([html], { type: "text/html;charset=utf-8;" });
        fileName = `time-report-${dateStr}.html`;
        mimeType = "text/html";
      }

      const label = saveTarget === "job" ? saveJobLabel : saveClientLabel;
      const description = `Time report exported ${dateStr}${label ? ` — ${label}` : ""}`;
      const fd = new FormData();
      fd.append("file", new File([content], fileName, { type: mimeType }));
      fd.append("file_type", "time_report");
      fd.append("description", description);

      const url = saveTarget === "job"
        ? `${apiBaseUrl()}/jobs/${saveJobId}/files`
        : `${apiBaseUrl()}/clients/${saveClientId}/files`;

      const res = await uploadFormDataWithProgress(url, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json<{ detail?: string }>();
        throw new Error(err.detail || "Save failed");
      }
      setSaveStatus(`Saved to ${saveTarget === "job" ? "job" : "client"} files!`);
      setTimeout(() => { setSaveModalOpen(false); setSaveStatus(""); }, 1500);
    } catch (err) {
      setSaveStatus(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
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

      if (!response.ok) throw new Error("Failed to save time log");

      setStatus(editingId ? "Time log updated!" : "Time log added!");

      if (createTask) {
        const firstAssignee = selectedTaskAssignees[0] ?? null;
        let assigneeUserId: string | null = null;
        if (firstAssignee) {
          if (firstAssignee.startsWith("team:")) {
            assigneeUserId = firstAssignee.slice(5);
          } else if (firstAssignee.startsWith("client:")) {
            const contactId = parseInt(firstAssignee.slice(7));
            const contact = clientContacts.find((c) => c.contact_id === contactId);
            assigneeUserId = contact?.email ?? null;
          } else {
            assigneeUserId = firstAssignee;
          }
        }
        const taskResponse = await fetch(
          `${baseUrl}/jobs/${parseInt(selectedJobId)}/communications/tasks`,
          {
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
          }
        );

        if (!taskResponse.ok) {
          const taskText = await taskResponse.text().catch(() => "");
          throw new Error(
            taskText ? `Task creation failed: ${taskText}` : "Task creation failed"
          );
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
    setWorkDate(new Date().toISOString().split("T")[0]);
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
    if (!confirmed) return;

    try {
      const baseUrl = apiBaseUrl();
      const response = await fetch(`${baseUrl}/time-logs/${timeId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete time log");
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
        <div className="mx-auto w-full max-w-7xl px-6 py-10">Loading...</div>
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
                          setSelectedJobId("");
                          setShowJobDropdown(true);
                        }}
                        onFocus={() => setShowJobDropdown(true)}
                        required
                      />
                      {showJobDropdown && jobSearchLoading && (
                        <div className="job-dropdown absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg p-3 text-sm text-muted-foreground">
                          Searching&hellip;
                        </div>
                      )}
                      {showJobDropdown && !jobSearchLoading && filteredJobs.length > 0 && (
                        <div className="job-dropdown absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-auto">
                          {filteredJobs.map((job) => (
                            <div
                              key={job.job_id}
                              className="px-3 py-2 cursor-pointer hover:bg-accent hover:text-accent-foreground text-sm"
                              onClick={() => {
                                setSelectedJobId(String(job.job_id));
                                setJobSearchQuery(
                                  `${job.job_number} - ${job.title}`
                                );
                                setShowJobDropdown(false);
                              }}
                            >
                              <div className="font-medium">
                                {job.job_number} - {job.title}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {job.client_name}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {showJobDropdown &&
                        !jobSearchLoading &&
                        jobSearchQuery.trim() &&
                        !selectedJobId &&
                        filteredJobs.length === 0 && (
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
                    <Select
                      value={selectedSubject}
                      onValueChange={setSelectedSubject}
                      required
                    >
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
                          setTaskTitle(
                            `Follow-up: ${selectedSubject || "time entry"}`
                          );
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
                        Create a follow-up task for the selected job and add it to
                        the job task list.
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
                          placeholder={
                            taskAssigneeOptions.length === 0
                              ? "Pick a job to load assignees..."
                              : "Search team members or contacts..."
                          }
                          emptyMessage={
                            selectedJobId
                              ? "No assignees match your search."
                              : "Pick a job to load assignees."
                          }
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
                          <span className="text-xs text-muted-foreground">
                            (select assignee first)
                          </span>
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

          {/* Time Entries Table */}
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <CardTitle>Time Entries</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={downloadCsv}
                      disabled={timeLogs.length === 0}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={printReport}
                      disabled={timeLogs.length === 0}
                    >
                      <Printer className="h-4 w-4 mr-1" />
                      Print Report
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSaveJobQuery(""); setSaveJobId(null); setSaveJobLabel("");
                        setSaveClientQuery(""); setSaveClientId(null); setSaveClientLabel("");
                        setSaveJobResults([]); setSaveClientResults([]);
                        setSaveStatus(""); setSaveFormat("csv"); setSaveTarget("job");
                        setSaveModalOpen(true);
                      }}
                      disabled={timeLogs.length === 0}
                    >
                      <FolderUp className="h-4 w-4 mr-1" />
                      Save to Files
                    </Button>
                  </div>
                </div>

                {/* Report filter panel */}
                <div className="rounded-lg border bg-slate-50 p-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Staff member</Label>
                      <div className="relative">
                        <Input
                          id="staffMemberFilter"
                          type="text"
                          className="h-8 text-sm pr-7"
                          placeholder="All staff"
                          value={showStaffDropdown ? staffQuery : selectedStaffLabel}
                          onChange={(e) => {
                            setStaffQuery(e.target.value);
                            setDraftUserId("");
                            setShowStaffDropdown(true);
                          }}
                          onFocus={() => {
                            setStaffQuery("");
                            setShowStaffDropdown(true);
                          }}
                        />
                        {(draftUserId || staffQuery) && (
                          <button
                            type="button"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setDraftUserId("");
                              setStaffQuery("");
                              setShowStaffDropdown(false);
                            }}
                            aria-label="Clear staff filter"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {showStaffDropdown && (
                          <div className="staff-dropdown absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-auto">
                            {filteredStaffOptions.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                No staff match your search.
                              </div>
                            ) : (
                              filteredStaffOptions.map((opt) => (
                                <div
                                  key={opt.user_id}
                                  className="px-3 py-2 cursor-pointer hover:bg-accent hover:text-accent-foreground text-sm"
                                  onClick={() => {
                                    setDraftUserId(opt.user_id);
                                    setStaffQuery("");
                                    setShowStaffDropdown(false);
                                  }}
                                >
                                  {opt.label}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Date from</Label>
                      <Input
                        type="date"
                        className="h-8 text-sm"
                        value={draftDateFrom}
                        onChange={(e) => setDraftDateFrom(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Date to</Label>
                      <Input
                        type="date"
                        className="h-8 text-sm"
                        value={draftDateTo}
                        onChange={(e) => setDraftDateTo(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Job</Label>
                      <Input
                        type="text"
                        className="h-8 text-sm"
                        placeholder="Job number or title..."
                        value={draftJobSearch}
                        onChange={(e) => setDraftJobSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && applyReportFilters()}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Client</Label>
                      <Input
                        type="text"
                        className="h-8 text-sm"
                        placeholder="Client name..."
                        value={draftClientSearch}
                        onChange={(e) => setDraftClientSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && applyReportFilters()}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={applyReportFilters}>
                      Search
                    </Button>
                    {hasActiveFilters && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={clearReportFilters}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Clear filters
                      </Button>
                    )}
                    {hasActiveFilters && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {timeLogs.length} {timeLogs.length === 1 ? "entry" : "entries"} &middot; {fmtH(totalHours)} hours
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {timeLogs.length === 0 ? (
                <p className="text-muted-foreground">No time entries found.</p>
              ) : (
                <>
                  <div className="mb-3 flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <Label htmlFor="time-entries-page-size" className="whitespace-nowrap text-muted-foreground">
                        Rows per page
                      </Label>
                      <Select
                        value={String(rowsPerPage)}
                        onValueChange={(value) => {
                          setRowsPerPage(Number(value));
                          setCurrentPage(1);
                        }}
                      >
                        <SelectTrigger id="time-entries-page-size" className="h-8 w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[10, 20, 50, 100].map((size) => (
                            <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="whitespace-nowrap text-muted-foreground">
                        Showing {firstVisibleRow}-{lastVisibleRow} of {timeLogs.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-1" aria-label="Top pagination">
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(1)} disabled={currentPage === 1} aria-label="First page">
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1} aria-label="Previous page">
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="min-w-24 text-center text-sm">Page {currentPage} of {totalPages}</span>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages} aria-label="Next page">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} aria-label="Last page">
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
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
                    {paginatedTimeLogs.map((log) => (
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
                </>
              )}
              {timeLogs.length > 0 && (
                <div className="mt-3 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {timeLogs.length} {timeLogs.length === 1 ? "entry" : "entries"} &middot; Total:{" "}
                    <strong>{fmtH(totalHours)} hours</strong>
                  </span>
                  <div className="flex items-center gap-1" aria-label="Bottom pagination">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(1)} disabled={currentPage === 1} aria-label="First page">
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1} aria-label="Previous page">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="min-w-24 text-center text-sm text-foreground">Page {currentPage} of {totalPages}</span>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages} aria-label="Next page">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} aria-label="Last page">
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Save to Files modal */}
      <Dialog open={saveModalOpen} onOpenChange={setSaveModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Save Report to Files</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Format */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Format</Label>
              <div className="flex gap-3">
                {(["csv", "html"] as const).map((f) => (
                  <label key={f} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="saveFormat"
                      value={f}
                      checked={saveFormat === f}
                      onChange={() => setSaveFormat(f)}
                      className="accent-green-600"
                    />
                    <span className="text-sm">{f === "csv" ? "CSV spreadsheet" : "HTML report"}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Target type */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Save to</Label>
              <div className="flex gap-3">
                {(["job", "client"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="saveTarget"
                      value={t}
                      checked={saveTarget === t}
                      onChange={() => setSaveTarget(t)}
                      className="accent-green-600"
                    />
                    <span className="text-sm capitalize">{t} files</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Job picker */}
            {saveTarget === "job" && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Select Job</Label>
                {saveJobId ? (
                  <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-2 text-sm">
                    <span className="flex-1">{saveJobLabel}</span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => { setSaveJobId(null); setSaveJobLabel(""); setSaveJobQuery(""); }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      placeholder="Search by job number or title..."
                      value={saveJobQuery}
                      onChange={(e) => setSaveJobQuery(e.target.value)}
                      className="h-8 text-sm"
                    />
                    {(saveJobSearching || saveJobResults.length > 0) && (
                      <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                        {saveJobSearching && (
                          <div className="p-3 text-sm text-muted-foreground">Searching&hellip;</div>
                        )}
                        {saveJobResults.map((j) => (
                          <div
                            key={j.job_id}
                            className="px-3 py-2 cursor-pointer hover:bg-accent text-sm"
                            onClick={() => {
                              setSaveJobId(j.job_id);
                              setSaveJobLabel(`${j.job_number} — ${j.title}`);
                              setSaveJobQuery("");
                              setSaveJobResults([]);
                            }}
                          >
                            <div className="font-medium">{j.job_number} — {j.title}</div>
                            <div className="text-xs text-muted-foreground">{j.client_name}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Client picker */}
            {saveTarget === "client" && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Select Client</Label>
                {saveClientId ? (
                  <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-2 text-sm">
                    <span className="flex-1">{saveClientLabel}</span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => { setSaveClientId(null); setSaveClientLabel(""); setSaveClientQuery(""); }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      placeholder="Search client name..."
                      value={saveClientQuery}
                      onChange={(e) => setSaveClientQuery(e.target.value)}
                      className="h-8 text-sm"
                    />
                    {(saveClientSearching || saveClientResults.length > 0) && (
                      <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-auto">
                        {saveClientSearching && (
                          <div className="p-3 text-sm text-muted-foreground">Searching&hellip;</div>
                        )}
                        {saveClientResults.map((c) => (
                          <div
                            key={c.client_db_id}
                            className="px-3 py-2 cursor-pointer hover:bg-accent text-sm"
                            onClick={() => {
                              setSaveClientId(c.client_db_id);
                              setSaveClientLabel(c.client_name || String(c.client_db_id));
                              setSaveClientQuery("");
                              setSaveClientResults([]);
                            }}
                          >
                            {c.client_name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {saveStatus && (
              <p className="text-sm text-muted-foreground">{saveStatus}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveToFiles}
              disabled={saving || (saveTarget === "job" ? !saveJobId : !saveClientId)}
            >
              {saving ? "Saving..." : "Save File"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TimePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl p-6 text-sm text-muted-foreground">
          Loading...
        </div>
      }
    >
      <TimePageContent />
    </Suspense>
  );
}
