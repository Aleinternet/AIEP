-- Ejecutar despues de cloud/supabase/schema.sql
-- Agrega trazabilidad para Google Drive como fuente documental.

alter table files
  add column if not exists drive_file_id text,
  add column if not exists drive_web_url text,
  add column if not exists drive_folder_path text,
  add column if not exists uploaded_role app_role;

create index if not exists files_drive_file_id_idx on files (drive_file_id);

create table if not exists drive_imports (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null,
  drive_file_name text not null,
  drive_folder_path text not null,
  status text not null default 'pendiente',
  rows_read integer not null default 0,
  debtors_upserted integer not null default 0,
  contacts_upserted integer not null default 0,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (drive_file_id)
);

create index if not exists drive_imports_status_idx on drive_imports (status, created_at desc);

alter table drive_imports enable row level security;
