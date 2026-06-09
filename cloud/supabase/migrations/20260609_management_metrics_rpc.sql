-- Metrica agregada para Dashboard Jefatura REMESA / AIEP.
-- Evita cargar toda la cartera en Vercel para calcular KPIs y graficos.

create or replace function public.aiep_management_metrics(
  p_from date default null,
  p_to date default null,
  p_state text default null,
  p_agreement text default null,
  p_assignment text default null,
  p_min_debt bigint default null,
  p_max_debt bigint default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with active_agreements as (
  select
    id,
    debtor_id,
    type::text as agreement_type,
    status::text as agreement_status,
    coalesce(agreed_amount, 0)::bigint as agreed_amount
  from agreements
  where deleted_at is null
    and coalesce(status::text, '') not in ('pagado', 'eliminado', 'anulado')
),
agreement_debtors as (
  select
    debtor_id,
    bool_or(agreement_type like '%cuota%') as has_cuotas,
    bool_or(agreement_type not like '%cuota%') as has_liquidacion,
    sum(agreed_amount)::bigint as agreed_amount
  from active_agreements
  group by debtor_id
),
base_debtors as (
  select
    d.id,
    coalesce(nullif(d.estado, ''), 'Pendiente') as estado,
    coalesce(d.saldo_capital, 0)::bigint as saldo_capital,
    coalesce(d.deuda_total, 0)::bigint as deuda_total,
    coalesce(d.monto_oferta, 0)::bigint as monto_oferta,
    d.asignacion,
    d.usuario,
    d.equipo,
    d.nombre_titular,
    d.rut_titular,
    d.tramo,
    coalesce(a.agreed_amount, 0)::bigint as agreement_amount,
    coalesce(a.has_cuotas, false) as has_cuotas,
    coalesce(a.has_liquidacion, false) as has_liquidacion,
    (a.debtor_id is not null) as has_agreement,
    case
      when a.debtor_id is not null then 'Convenio en curso'
      else coalesce(nullif(d.estado, ''), 'Pendiente')
    end as display_state
  from debtors d
  left join agreement_debtors a on a.debtor_id = d.id
  where (p_assignment is null or p_assignment = '' or d.asignacion = p_assignment)
    and (p_min_debt is null or p_min_debt <= 0 or coalesce(d.deuda_total, 0) >= p_min_debt)
    and (p_max_debt is null or p_max_debt <= 0 or coalesce(d.deuda_total, 0) <= p_max_debt)
),
filtered_debtors as (
  select *
  from base_debtors
  where (p_state is null or p_state = '' or display_state = p_state)
    and (
      p_agreement is null or p_agreement = ''
      or (p_agreement = 'with' and has_agreement)
      or (p_agreement = 'without' and not has_agreement)
      or (p_agreement = 'cuotas' and has_cuotas)
      or (p_agreement = 'liquidacion' and has_liquidacion)
    )
),
filtered_ids as (
  select id from filtered_debtors
),
entries as (
  select e.debtor_id, coalesce(nullif(e.result, ''), 'Sin dato') as result, coalesce(nullif(e.channel, ''), 'Sin dato') as channel
  from management_entries e
  join filtered_ids f on f.id = e.debtor_id
  where e.deleted_at is null
    and (p_from is null or e.management_date >= p_from)
    and (p_to is null or e.management_date <= p_to)
),
contact_flags as (
  select
    c.debtor_id,
    bool_or(c.type::text = 'telefono') as has_phone,
    bool_or(c.type::text = 'correo') as has_email
  from contacts c
  join filtered_ids f on f.id = c.debtor_id
  where c.deleted_at is null
  group by c.debtor_id
),
receipt_rows as (
  select f.debtor_id, coalesce(f.verified, false) as verified
  from files f
  join filtered_ids d on d.id = f.debtor_id
  where f.kind::text = 'comprobante_pago'
),
active_agreement_rows as (
  select aa.*, fd.saldo_capital
  from active_agreements aa
  join filtered_debtors fd on fd.id = aa.debtor_id
),
paid_by_agreement as (
  select agreement_id, sum(coalesce(paid_amount, 0))::bigint as paid_amount
  from agreement_payments
  where deleted_at is null
  group by agreement_id
),
allocations as (
  select pa.debtor_id, coalesce(pa.amount, 0)::bigint as amount
  from payment_allocations pa
  join filtered_ids f on f.id = pa.debtor_id
),
state_rows as (
  select display_state as label, count(*)::bigint as value
  from filtered_debtors
  group by display_state
  order by value desc
  limit 10
),
result_rows as (
  select result as label, count(*)::bigint as value
  from entries
  group by result
  order by value desc
),
channel_rows as (
  select channel as label, count(*)::bigint as value
  from entries
  group by channel
  order by value desc
),
assignment_rows as (
  select coalesce(nullif(asignacion, ''), nullif(usuario, ''), nullif(equipo, ''), 'Sin asignacion') as label, count(*)::bigint as value
  from filtered_debtors
  group by 1
  order by value desc
  limit 40
),
top_debt_rows as (
  select coalesce(nullif(nombre_titular, ''), rut_titular, id) as label, deuda_total as value
  from filtered_debtors
  order by deuda_total desc
  limit 8
),
totals as (
  select
    count(*)::bigint as total_registros,
    coalesce(sum(saldo_capital), 0)::bigint as saldo_capital,
    coalesce(sum(deuda_total), 0)::bigint as deuda_total,
    coalesce((select sum(agreed_amount) from active_agreement_rows), 0)::bigint as monto_oferta,
    coalesce((select sum(amount) from allocations), 0)::bigint as collected,
    coalesce((select count(*) from entries), 0)::bigint as entries_count,
    coalesce((select count(distinct debtor_id) from entries), 0)::bigint as managed_debtor_count,
    coalesce((select count(*) from receipt_rows), 0)::bigint as receipts,
    coalesce((select count(*) from active_agreement_rows), 0)::bigint as active_agreements,
    coalesce((select count(*) from contact_flags where has_phone), 0)::bigint as with_phone,
    coalesce((select count(*) from contact_flags where has_email), 0)::bigint as with_email,
    coalesce((select count(*) from contact_flags where has_email and not has_phone), 0)::bigint as email_only,
    coalesce((select count(*) from filtered_debtors fd left join contact_flags cf on cf.debtor_id = fd.id where cf.debtor_id is null), 0)::bigint as without_contact,
    coalesce((select count(*) from entries where result in ('Pago / comprobante', 'Pagó / comprobante', 'Pago validado')), 0)::bigint
      + coalesce((select count(*) from receipt_rows where verified), 0)::bigint as paid_evidence,
    coalesce((select count(*) from entries where result = 'Compromiso de pago'), 0)::bigint as promise_count,
    coalesce((
      select sum(greatest(0, aar.agreed_amount - coalesce(pba.paid_amount, 0)))
      from active_agreement_rows aar
      left join paid_by_agreement pba on pba.agreement_id = aar.id
    ), 0)::bigint as agreement_balance,
    coalesce((
      select greatest(0, sum(aar.saldo_capital) - sum(aar.agreed_amount))
      from active_agreement_rows aar
    ), 0)::bigint as lost_capital
  from filtered_debtors
)
select jsonb_build_object(
  'generatedAt', now(),
  'totals', jsonb_build_object(
    'totalRegistros', totals.total_registros,
    'saldoCapital', totals.saldo_capital,
    'deudaTotal', totals.deuda_total,
    'montoOferta', totals.monto_oferta,
    'collected', totals.collected,
    'lostCapital', totals.lost_capital,
    'entries', totals.entries_count,
    'managedDebtorCount', totals.managed_debtor_count,
    'managedRate', case when totals.total_registros > 0 then round((totals.managed_debtor_count::numeric / totals.total_registros::numeric) * 100)::int else 0 end,
    'receipts', totals.receipts,
    'activeAgreements', totals.active_agreements,
    'agreementBalance', totals.agreement_balance,
    'withPhone', totals.with_phone,
    'withEmail', totals.with_email,
    'emailOnly', totals.email_only,
    'withoutContact', totals.without_contact,
    'paidEvidence', totals.paid_evidence,
    'promiseCount', totals.promise_count
  ),
  'bars', jsonb_build_object(
    'states', coalesce((select jsonb_agg(jsonb_build_array(label, value) order by value desc) from state_rows), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(jsonb_build_array(label, value) order by value desc) from result_rows), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(jsonb_build_array(label, value) order by value desc) from channel_rows), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(jsonb_build_array(label, value) order by value desc) from assignment_rows), '[]'::jsonb),
    'funnel', jsonb_build_array(
      jsonb_build_array('Cartera total', totals.total_registros),
      jsonb_build_array('Con gestion', totals.managed_debtor_count),
      jsonb_build_array('Convenios activos', totals.active_agreements),
      jsonb_build_array('Comprobantes', totals.receipts)
    ),
    'topDebt', coalesce((select jsonb_agg(jsonb_build_array(label, value) order by value desc) from top_debt_rows), '[]'::jsonb),
    'bankSource', case when totals.collected > 0 then jsonb_build_array(jsonb_build_array('Pagos asignados', totals.collected)) else '[]'::jsonb end
  ),
  'distribution', coalesce((select jsonb_agg(deuda_total) from filtered_debtors where deuda_total > 0), '[]'::jsonb)
)
from totals;
$$;

grant execute on function public.aiep_management_metrics(date, date, text, text, text, bigint, bigint) to anon, authenticated, service_role;
