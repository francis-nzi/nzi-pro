export type OrgCapacityErrorReason = "archived" | "inactive_plan" | "user_limit" | "client_limit";

export type OrgCapacityErrorInfo = {
  message: string;
  reason?: OrgCapacityErrorReason | string;
  orgId?: string;
  plan?: string | null;
  planStatus?: string | null;
  maxUsers?: number | null;
  maxClients?: number | null;
  activeMembers?: number | null;
  activeClients?: number | null;
  pendingInvites?: number | null;
  limitType?: string | null;
  limitValue?: number | null;
  currentValue?: number | null;
  additionalValue?: number | null;
  helpText?: string;
  ctaHref?: string;
  ctaLabel?: string;
};

export type ApiErrorInfo = {
  message: string;
  capacity?: OrgCapacityErrorInfo | null;
};

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function withCapacityDefaults(info: OrgCapacityErrorInfo): OrgCapacityErrorInfo {
  if (info.reason === "inactive_plan") {
    return {
      ...info,
      ctaHref: info.ctaHref || "/admin/billing",
      ctaLabel: info.ctaLabel || "Open Billing",
      helpText: info.helpText || "Review the organisation plan and subscription status.",
    };
  }
  if (info.reason === "archived") {
    return {
      ...info,
      ctaHref: info.ctaHref || "/admin/organisations",
      ctaLabel: info.ctaLabel || "Open Organisations",
      helpText: info.helpText || "Reactivate the organisation before retrying this action.",
    };
  }
  if (info.reason === "user_limit") {
    return {
      ...info,
      ctaHref: info.ctaHref || "/admin/organisations",
      ctaLabel: info.ctaLabel || "Manage Members",
      helpText: info.helpText || "Remove a member or increase the user limit.",
    };
  }
  if (info.reason === "client_limit") {
    return {
      ...info,
      ctaHref: info.ctaHref || "/admin/organisations",
      ctaLabel: info.ctaLabel || "Manage Clients",
      helpText: info.helpText || "Remove a client or increase the client limit.",
    };
  }
  return info;
}

export function parseOrgCapacityError(detail: unknown): OrgCapacityErrorInfo | null {
  if (!detail) return null;

  if (typeof detail === "string") {
    const text = detail.trim();
    if (!text) return null;
    if (/organisation is archived/i.test(text)) {
      return withCapacityDefaults({ message: "Organisation is archived", reason: "archived" });
    }
    if (/organisation plan is not active/i.test(text)) {
      return withCapacityDefaults({ message: "Organisation plan is not active", reason: "inactive_plan" });
    }
    const userMatch = text.match(/Organisation user limit reached \((\d+)\s*\/\s*(\d+)\)/i);
    if (userMatch) {
      const currentValue = toNumber(userMatch[1]);
      const limitValue = toNumber(userMatch[2]);
      return withCapacityDefaults({
        message: text,
        reason: "user_limit",
        limitType: "users",
        currentValue,
        limitValue,
      });
    }
    const clientMatch = text.match(/Organisation client limit reached \((\d+)\s*\/\s*(\d+)\)/i);
    if (clientMatch) {
      const currentValue = toNumber(clientMatch[1]);
      const limitValue = toNumber(clientMatch[2]);
      return withCapacityDefaults({
        message: text,
        reason: "client_limit",
        limitType: "clients",
        currentValue,
        limitValue,
      });
    }
    return null;
  }

  if (typeof detail !== "object") return null;

  const candidate = detail as Record<string, unknown>;
  const reason = typeof candidate.reason === "string" ? candidate.reason : null;
  const message = typeof candidate.message === "string" && candidate.message.trim() ? candidate.message.trim() : null;
  if (!reason && !message) return null;

  const info: OrgCapacityErrorInfo = {
    message: message || "Organisation limit reached",
    reason: reason || undefined,
    orgId: typeof candidate.org_id === "string" ? candidate.org_id : undefined,
    plan: typeof candidate.plan === "string" ? candidate.plan : null,
    planStatus: typeof candidate.plan_status === "string" ? candidate.plan_status : null,
    maxUsers: toNumber(candidate.max_users),
    maxClients: toNumber(candidate.max_clients),
    activeMembers: toNumber(candidate.active_members),
    activeClients: toNumber(candidate.active_clients),
    pendingInvites: toNumber(candidate.pending_invites),
    limitType: typeof candidate.limit_type === "string" ? candidate.limit_type : null,
    limitValue: toNumber(candidate.limit_value),
    currentValue: toNumber(candidate.current_value),
    additionalValue: toNumber(candidate.additional_value),
  };

  if (!info.reason) {
    if (/organisation is archived/i.test(info.message)) info.reason = "archived";
    else if (/organisation plan is not active/i.test(info.message)) info.reason = "inactive_plan";
    else if (/organisation user limit reached/i.test(info.message)) info.reason = "user_limit";
    else if (/organisation client limit reached/i.test(info.message)) info.reason = "client_limit";
  }

  if (info.reason === "user_limit" && info.limitValue == null && info.maxUsers != null) {
    info.limitValue = info.maxUsers;
  }
  if (info.reason === "client_limit" && info.limitValue == null && info.maxClients != null) {
    info.limitValue = info.maxClients;
  }

  return withCapacityDefaults(info);
}

export function parseApiError(detail: unknown, fallback: string): ApiErrorInfo {
  const capacity = parseOrgCapacityError(detail);
  if (capacity) {
    return { message: capacity.message || fallback, capacity };
  }

  if (typeof detail === "string") {
    const text = detail.trim();
    if (text) return { message: text, capacity: null };
  }

  if (detail && typeof detail === "object") {
    const candidate = detail as Record<string, unknown>;
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return { message: candidate.message.trim(), capacity: null };
    }
  }

  return { message: fallback, capacity: null };
}
