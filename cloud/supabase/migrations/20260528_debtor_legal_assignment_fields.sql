-- Campos adicionales del Excel AIEP para domicilio, judicial y asignacion vigente.
-- Ejecutar en Supabase antes de volver a importar archivos desde Google Drive.

alter table debtors
  add column if not exists rut_deudor text,
  add column if not exists rut_deudor_normalizado text,
  add column if not exists procedimiento text,
  add column if not exists usuario text,
  add column if not exists equipo text,
  add column if not exists asignacion text,
  add column if not exists fecha_emision date,
  add column if not exists atraso_gestion text,
  add column if not exists tipo_contacto text,
  add column if not exists resultado text,
  add column if not exists observacion text,
  add column if not exists ubicabilidad text,
  add column if not exists tel_validado text;

create index if not exists debtors_rut_deudor_idx on debtors (rut_deudor_normalizado);
create index if not exists debtors_asignacion_idx on debtors (asignacion);
