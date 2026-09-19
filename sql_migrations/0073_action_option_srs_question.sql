-- Optional question-bank link for shared action options.
ALTER TABLE report_action_options
  ADD COLUMN IF NOT EXISTS srs_question_id INTEGER
  REFERENCES srs_readiness_questions(question_id) ON DELETE SET NULL;
