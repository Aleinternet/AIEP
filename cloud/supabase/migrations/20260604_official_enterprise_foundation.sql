-- Base empresarial oficial AIEP / ABG RECOV.
-- Ejecutar en Supabase SQL Editor despues de schema.sql.
-- La migracion es incremental: no elimina tablas existentes ni reemplaza historial.

create extension if not exists "pgcrypto";

do $$
begin
  alter type app_role add value if not exists 'informatico';
exception
  when undefined_object then null;
end $$;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  username text unique,
  display_name text not null,
  role text not null check (role in ('deudor','callcenter','jefatura','informatico')),
  assignment_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists executives (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  assignment_name text unique not null,
  user_id uuid references app_users(id),
  aliases jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_hash text,
  source text not null,
  mode text not null,
  status text not null default 'preview',
  uploaded_by uuid references app_users(id),
  uploaded_by_role text,
  options jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create table if not exists import_job_rows (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid references import_jobs(id) on delete cascade,
  row_number integer,
  match_key text,
  status text,
  changes jsonb not null default '{}'::jsonb,
  error_message text,
  raw_row jsonb,
  created_at timestamptz not null default now()
);

create table if not exists assignment_events (
  id uuid primary key default gen_random_uuid(),
  debtor_id text,
  debtor_key text,
  old_assigned_to text,
  new_assigned_to text not null,
  changed_by uuid references app_users(id),
  changed_by_role text,
  source text not null,
  import_job_id uuid references import_jobs(id),
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists field_change_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text,
  entity_key text,
  field_name text not null,
  old_value text,
  new_value text,
  changed_by uuid references app_users(id),
  changed_by_role text,
  source text not null,
  import_job_id uuid references import_jobs(id),
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid,
  debtor_id text references debtors(id) on delete set null,
  agreement_id uuid references agreements(id) on delete set null,
  amount bigint not null default 0,
  attributed_to text,
  attribution_reason text,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

create table if not exists audit_files (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_kind text not null,
  storage_path text,
  drive_file_id text,
  drive_web_url text,
  file_hash text,
  uploaded_by uuid references app_users(id),
  uploaded_by_role text,
  debtor_id text references debtors(id) on delete set null,
  import_job_id uuid references import_jobs(id),
  created_at timestamptz not null default now()
);

alter table debtors
  add column if not exists id_rem text,
  add column if not exists assigned_executive_id uuid references executives(id),
  add column if not exists is_active boolean not null default true,
  add column if not exists portfolio_status text not null default 'active',
  add column if not exists last_import_job_id uuid references import_jobs(id);

alter table agreements
  add column if not exists down_payment bigint not null default 0,
  add column if not exists payer_rut text,
  add column if not exists payer_rut_normalized text;

alter table app_users
  add column if not exists password_hash text,
  add column if not exists password_salt text,
  add column if not exists password_changed_at timestamptz;

create index if not exists idx_debtors_id_rem on debtors(id_rem);
create index if not exists idx_debtors_rut_deudor_norm on debtors(rut_deudor_normalizado);
create index if not exists idx_debtors_rut_titular_norm on debtors(rut_titular_normalizado);
create index if not exists idx_debtors_rut_alumno_norm on debtors(rut_alumno_normalizado);
create index if not exists idx_debtors_assigned_executive on debtors(assigned_executive_id);
create index if not exists idx_debtors_assignment_text on debtors(asignacion, usuario, equipo);
create index if not exists idx_debtors_status_cartera on debtors(estado, cartera);
create index if not exists idx_import_jobs_status on import_jobs(status, created_at desc);
create index if not exists idx_import_rows_job_status on import_job_rows(import_job_id, status);
create index if not exists idx_assignment_events_debtor on assignment_events(debtor_id, created_at desc);
create index if not exists idx_field_change_entity on field_change_log(entity_type, entity_id, created_at desc);
create index if not exists idx_payment_allocations_debtor on payment_allocations(debtor_id, created_at desc);
create index if not exists idx_audit_files_debtor on audit_files(debtor_id, created_at desc);

alter table app_users enable row level security;
alter table executives enable row level security;
alter table import_jobs enable row level security;
alter table import_job_rows enable row level security;
alter table assignment_events enable row level security;
alter table field_change_log enable row level security;
alter table payment_allocations enable row level security;
alter table audit_files enable row level security;

-- Politicas finales: las escrituras administrativas deben pasar por API server-side
-- con service role. RLS queda habilitado para evitar exposicion accidental desde cliente.
