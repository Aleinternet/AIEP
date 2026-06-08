-- Fase 1A REMESA / AIEP: base operacional para persistencia, permisos y auditoria.
-- Ejecutar despues de schema.sql y migraciones previas.
-- No elimina datos ni reemplaza historial.

create extension if not exists "pgcrypto";

alter table contacts
  add column if not exists category text,
  add column if not exists created_by text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists updated_at timestamptz not null default now();

alter table management_entries
  add column if not exists channel text,
  add column if not exists created_by text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists updated_at timestamptz not null default now();

alter table agreements
  add column if not exists deleted_by text,
  add column if not exists updated_at timestamptz not null default now();

alter table agreement_payments
  add column if not exists label text,
  add column if not exists status text not null default 'pendiente',
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists updated_at timestamptz not null default now();

alter table internal_comments
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_by text,
  add column if not exists created_by_username text;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_debtors_updated_at') then
    create trigger trg_debtors_updated_at
    before update on debtors
    for each row execute function set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_contacts_updated_at') then
    create trigger trg_contacts_updated_at
    before update on contacts
    for each row execute function set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_management_entries_updated_at') then
    create trigger trg_management_entries_updated_at
    before update on management_entries
    for each row execute function set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_agreements_updated_at') then
    create trigger trg_agreements_updated_at
    before update on agreements
    for each row execute function set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_agreement_payments_updated_at') then
    create trigger trg_agreement_payments_updated_at
    before update on agreement_payments
    for each row execute function set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_internal_comments_updated_at') then
    create trigger trg_internal_comments_updated_at
    before update on internal_comments
    for each row execute function set_updated_at();
  end if;
end $$;

create index if not exists idx_debtors_updated_at on debtors(updated_at desc);
create index if not exists idx_debtors_created_at on debtors(created_at desc);

create index if not exists idx_contacts_debtor_active on contacts(debtor_id, deleted_at);
create index if not exists idx_contacts_status on contacts(status);
create index if not exists idx_contacts_created_at on contacts(created_at desc);
create index if not exists idx_contacts_updated_at on contacts(updated_at desc);
create index if not exists idx_contacts_created_by on contacts(created_by);

create index if not exists idx_management_entries_debtor on management_entries(debtor_id);
create index if not exists idx_management_entries_management_date on management_entries(management_date desc);
create index if not exists idx_management_entries_created_at on management_entries(created_at desc);
create index if not exists idx_management_entries_updated_at on management_entries(updated_at desc);
create index if not exists idx_management_entries_created_by on management_entries(created_by);
create index if not exists idx_management_entries_deleted_at on management_entries(deleted_at);

create index if not exists idx_agreements_updated_at on agreements(updated_at desc);
create index if not exists idx_agreements_deleted_at on agreements(deleted_at);
create index if not exists idx_agreements_created_by on agreements(created_by);

create index if not exists idx_agreement_payments_agreement on agreement_payments(agreement_id);
create index if not exists idx_agreement_payments_status on agreement_payments(status);
create index if not exists idx_agreement_payments_created_at on agreement_payments(created_at desc);
create index if not exists idx_agreement_payments_updated_at on agreement_payments(updated_at desc);
create index if not exists idx_agreement_payments_deleted_at on agreement_payments(deleted_at);

create index if not exists idx_internal_comments_debtor_active on internal_comments(debtor_id, deleted_at, created_at desc);
create index if not exists idx_internal_comments_updated_at on internal_comments(updated_at desc);
create index if not exists idx_internal_comments_created_by on internal_comments(created_by);
create index if not exists idx_internal_comments_created_by_username on internal_comments(created_by_username);

create index if not exists idx_audit_log_created_at on audit_log(created_at desc);
create index if not exists idx_audit_log_entity on audit_log(entity_type, entity_id, created_at desc);
create index if not exists idx_audit_log_action on audit_log(action, created_at desc);
