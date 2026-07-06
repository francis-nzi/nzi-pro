export type TrainingProduct = {
  training_product_id: number;
  org_id: string;
  product_code: string | null;
  product_name: string;
  description: string | null;
  default_hours: number | null;
  default_delivery_mode: string | null;
  default_capacity: number | null;
  default_min_attendees: number | null;
  certificate_policy: string | null;
  default_documents_json: string | null;
  is_active: boolean;
  accreditation_body: string | null;
  accreditation_ref: string | null;
  cpd_hours: number | null;
  cpd_points: number | null;
  certificate_validity_months: number | null;
  attendance_threshold_pct: number;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type TrainingBooking = {
  training_booking_id: number;
  org_id: string;
  training_course_run_id: number;
  client_db_id: number | null;
  contact_id: number | null;
  participant_type: string;
  booking_source: string;
  person_name: string;
  person_email: string | null;
  person_phone: string | null;
  billing_status: string;
  attendance_status: string;
  special_requirements: string | null;
  consent_status: string;
  notes: string | null;
  entitlement_id: number | null;
  client_name: string | null;
  client_addr_city: string | null;
  client_addr_country: string | null;
  source_job_number: string | null;
  entitlement_status: string | null;
  allocated_booking_name: string | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type TrainingAttendance = {
  training_session_attendance_id: number;
  org_id: string;
  training_course_session_id: number;
  training_booking_id: number;
  attendance_status: string;
  attendance_minutes: number | null;
  notes: string | null;
  person_name: string;
  person_email: string | null;
  client_name: string | null;
  booking_source: string;
  participant_type: string;
  booking_attendance_status: string;
  entitlement_id: number | null;
  client_db_id: number | null;
  contact_id: number | null;
  person_phone: string | null;
  billing_status: string;
  special_requirements: string | null;
  consent_status: string;
  booking_notes: string | null;
  client_addr_city: string | null;
  client_addr_country: string | null;
  source_job_number: string | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type TrainingSession = {
  training_course_session_id: number;
  org_id: string;
  training_course_run_id: number;
  session_title: string | null;
  session_date: string | null;
  start_time: string | null;
  end_time: string | null;
  session_hours: number | null;
  delivery_mode: string | null;
  venue_name: string | null;
  venue_address: string | null;
  online_meeting_url: string | null;
  online_meeting_id: string | null;
  online_passcode: string | null;
  status: string;
  notes: string | null;
  attendance_count: number;
  attended_count: number;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  attendance: TrainingAttendance[];
};

export type TrainingCourseRun = {
  training_course_run_id: number;
  org_id: string;
  job_id: number;
  training_product_id: number | null;
  product_name: string | null;
  run_name: string | null;
  course_code: string | null;
  total_hours: number | null;
  delivery_mode: string | null;
  capacity: number | null;
  min_attendees: number | null;
  status: string;
  workflow_stage_key: string;
  start_date: string | null;
  end_date: string | null;
  venue_name: string | null;
  venue_address: string | null;
  online_meeting_url: string | null;
  online_meeting_id: string | null;
  online_passcode: string | null;
  notes: string | null;
  reminder_enabled: boolean;
  reminder_schedule_json: string;
  reminder_subject_template: string | null;
  reminder_body_template: string | null;
  completion_subject_template: string | null;
  completion_body_template: string | null;
  post_course_documents_json: string | null;
  auto_certificate: boolean;
  certificate_template_key: string;
  completed_at: string | null;
  booking_count: number;
  confirmed_count: number;
  available_seats: number | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  bookings: TrainingBooking[];
};

export type TrainingEntitlement = {
  training_entitlement_id: number;
  org_id: string;
  source_job_id: number | null;
  source_job_number: string | null;
  source_client_db_id: number | null;
  entitlement_type: string;
  status: string;
  allocated_to_booking_id: number | null;
  reserved_at: string | null;
  consumed_at: string | null;
  expires_at: string | null;
  notes: string | null;
  source_job_client_name: string | null;
  allocated_booking_name: string | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type TrainingSessionStaff = {
  training_session_staff_id: number;
  org_id: string;
  training_course_session_id: number;
  staff_name: string;
  staff_email: string | null;
  staff_role: string;
  staff_title: string | null;
  notes: string | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type TrainingDetails = {
  job_id: number | null;
  training_date: string | null;
  delivery_format: string | null;
  topic: string | null;
  audience: string | null;
  attendee_count: number | null;
  session_duration_hours: number | null;
  materials_link: string | null;
  location: string | null;
  notes: string | null;
};

export type TrainingOverview = {
  job_id: number;
  details: TrainingDetails;
  products: TrainingProduct[];
  course_runs: TrainingCourseRun[];
  available_entitlements: TrainingEntitlement[];
  sessions: TrainingSession[];
};

export type TrainingDocument = {
  training_document_id: number;
  org_id: string;
  target_type: string;
  target_id: number;
  document_type: string;
  document_name: string;
  file_url: string | null;
  notes: string | null;
  attach_to_email: boolean;
  is_visible_on_portal: boolean;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export const DOCUMENT_TYPE_OPTIONS = [
  { value: "course_overview",      label: "Course Overview" },
  { value: "lesson_plan",          label: "Lesson Plan" },
  { value: "slides",               label: "Course Slides" },
  { value: "questionnaire",        label: "Questionnaire" },
  { value: "feedback_form",        label: "Feedback Form" },
  { value: "joining_instructions", label: "Joining Instructions" },
  { value: "post_course_resources",label: "Post-Course Resources" },
  { value: "certificate_template", label: "Certificate Template" },
  { value: "general",              label: "General" },
] as const;

export function formatDocumentType(type: string): string {
  return DOCUMENT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type TrainingLogEntry = {
  training_automation_log_id: number;
  automation_key: string;
  trigger_key: string;
  action_type: string;
  recipient_name: string | null;
  recipient_email: string | null;
  subject: string | null;
  status: string;
  error_text: string | null;
  created_at: string | null;
  sent_at: string | null;
};

export const STAFF_ROLE_OPTIONS = [
  { value: "trainer", label: "Lead Trainer" },
  { value: "co_trainer", label: "Co-Trainer" },
  { value: "guest_speaker", label: "Guest Speaker" },
  { value: "support", label: "Support Staff" },
  { value: "facilitator", label: "Facilitator" },
  { value: "observer", label: "Observer" },
];

export function formatStaffRole(role: string): string {
  return STAFF_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
