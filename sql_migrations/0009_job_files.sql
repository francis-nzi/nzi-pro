-- Job Files table for storing client-supplied documents and generated reports
CREATE TABLE IF NOT EXISTS job_files (
    file_id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    row_id INTEGER,
    file_type VARCHAR(50) NOT NULL DEFAULT 'client_provided',
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    description TEXT,
    uploaded_by VARCHAR(255),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_job_files_job_id ON job_files(job_id);
CREATE INDEX IF NOT EXISTS idx_job_files_row_id ON job_files(row_id);
CREATE INDEX IF NOT EXISTS idx_job_files_file_type ON job_files(file_type);
