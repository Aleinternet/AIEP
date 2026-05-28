-- Esquema base para Plataforma Cobranzas REMESA / AIEP
-- Ejecutar en Supabase SQL Editor.

create extension if not exists "pgcrypto";

create type app_role as enum ('deudor', 'callcenter', 'jefatura', 'admin');
create type contact_type as enum ('telefono', 'correo');
create type contact_status as enum ('sin_validar', 'valido', 'no_considerar');
create type agreement_type as enum ('liquidacion_total', 'pago_cuotas');
create type agreement_status as enum ('vigente', 'pagado', 'vencido', 'eliminado');
create type file_kind as enum ('comprobante_pago', 'cartola_bancaria', 'respaldo', 'otro');

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  role app_role not null,
  username text unique,
  display_name text,
  rut_normalizado text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists debtors (
  id text primary key,
  rut_deudor text,
  rut_deudor_normalizado text,
  rut_titular text not null,
  rut_titular_normalizado text not null,
  nombre_titular text not null,
  rut_alumno text not null,
  rut_alumno_normalizado text not null,
  nombre_alumno text not null,
  estado text not null default 'ACUERDO ROTO',
  cartera text,
  tramo text,
  region text,
  comuna text,
  direccion text,
  rol text,
  tribunal text,
  procedimiento text,
  usuario text,
  equipo text,
  asignacion text,
  fecha_emision date,
  atraso_gestion text,
  tipo_contacto text,
  resultado text,
  observacion text,
  ubicabilidad text,
  tel_validado text,
  saldo_capital bigint not null default 0,
  intereses_mora bigint not null default 0,
  gastos_cobranza bigint not null default 0,
  deuda_total bigint not null default 0,
  monto_oferta bigint not null default 0,
  ultima_gestion date,
  proxima_gestion date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists debtors_rut_titular_idx on debtors (rut_titular_normalizado);
create index if not exists debtors_rut_alumno_idx on debtors (rut_alumno_normalizado);
create index if not exists debtors_rut_deudor_idx on debtors (rut_deudor_normalizado);
create index if not exists debtors_deuda_total_idx on debtors (deuda_total desc);
create index if not exists debtors_estado_idx on debtors (estado);
create index if not exists debtors_asignacion_idx on debtors (asignacion);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  debtor_id text not null references debtors(id) on delete cascade,
  type contact_type not null,
  value text not null,
  status contact_status not null default 'sin_validar',
  note text,
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (debtor_id, type, value)
);

create index if not exists contacts_debtor_idx on contacts (debtor_id);

create table if not exists management_entries (
  id uuid primary key default gen_random_uuid(),
  debtor_id text not null references debtors(id) on delete cascade,
  managed_by uuid references profiles(id),
  management_date date not null default current_date,
  result text,
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists management_entries_debtor_date_idx on management_entries (debtor_id, management_date desc);

create table if not exists internal_comments (
  id uuid primary key default gen_random_uuid(),
  debtor_id text not null references debtors(id) on delete cascade,
  parent_id uuid references internal_comments(id) on delete cascade,
  body text not null,
  created_by uuid references profiles(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists internal_comments_debtor_idx on internal_comments (debtor_id, created_at desc);

create table if not exists agreements (
  id uuid primary key default gen_random_uuid(),
  debtor_id text not null references debtors(id) on delete cascade,
  type agreement_type not null,
  status agreement_status not null default 'vigente',
  agreed_amount bigint not null,
  installments integer,
  start_date date not null,
  observations text,
  created_by uuid references profiles(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agreements_debtor_idx on agreements (debtor_id);
create index if not exists agreements_status_start_idx on agreements (status, start_date);

create table if not exists agreement_payments (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references agreements(id) on delete cascade,
  due_date date not null,
  expected_amount bigint,
  paid_amount bigint,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists agreement_payments_due_idx on agreement_payments (due_date);

create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  debtor_id text references debtors(id) on delete set null,
  kind file_kind not null,
  original_name text not null,
  storage_path text not null,
  drive_file_id text,
  drive_web_url text,
  drive_folder_path text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  uploaded_role app_role,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists files_debtor_kind_idx on files (debtor_id, kind, created_at desc);
create index if not exists files_drive_file_id_idx on files (drive_file_id);

create table if not exists drive_backups (
  id uuid primary key default gen_random_uuid(),
  backup_type text not null,
  drive_folder_id text not null,
  drive_file_id text,
  file_name text not null,
  status text not null default 'creado',
  error_message text,
  created_at timestamptz not null default now()
);

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

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table debtors enable row level security;
alter table contacts enable row level security;
alter table management_entries enable row level security;
alter table internal_comments enable row level security;
alter table agreements enable row level security;
alter table agreement_payments enable row level security;
alter table files enable row level security;
alter table drive_backups enable row level security;
alter table drive_imports enable row level security;
alter table audit_log enable row level security;

-- Para el MVP cloud, las operaciones sensibles deben pasar por API server-side
-- usando SUPABASE_SERVICE_ROLE_KEY. Las politicas finales se ajustan cuando
-- quede definido el proveedor de autenticacion de call center/jefatura.
