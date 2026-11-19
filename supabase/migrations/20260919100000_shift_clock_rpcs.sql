-- Shift scheduling was already fully modelled (public.work_schedules: a
-- recurring weekly shift per employee, with break minutes and an effective
-- date range, manager-writable via existing RLS) but never wired to
-- anything -- no UI read or wrote it, and attendance.expected_start/
-- expected_end were always null.
--
-- Along the way: the worker-facing clock flow currently does a raw
-- `supabase.from('attendance').update({ clocked_out_at: ... })` from the
-- browser. There is a "workers clock own attendance" INSERT policy (clock
-- in) but no matching UPDATE policy for a worker's own row -- only
-- "managers manage attendance" covers UPDATE. A regular worker can
-- currently clock in but has no RLS path to clock out. Fixing this by
-- routing both through security-definer RPCs (matching the pattern already
-- used for sales/stock/purchase orders) rather than adding a broad
-- self-service UPDATE policy on the table.

create or replace function public.clock_in(target_org uuid, target_branch uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  self_employee_id uuid;
  resolved_branch uuid;
  today date := current_date;
  schedule_row public.work_schedules%rowtype;
  computed_status text := 'present';
  new_attendance_id uuid;
begin
  select id, coalesce(target_branch, branch_id) into self_employee_id, resolved_branch
  from public.employee_profiles
  where user_id = auth.uid() and organization_id = target_org;
  if self_employee_id is null then
    raise exception using message = '{"code":"NOT_AN_EMPLOYEE","message":"No active worker profile for this organization"}';
  end if;
  if exists (select 1 from public.attendance where employee_id = self_employee_id and work_date = today and clocked_in_at is not null) then
    raise exception using message = '{"code":"ALREADY_CLOCKED_IN","message":"Already clocked in today"}';
  end if;

  -- Postgres' extract(dow ...) is 0=Sunday..6=Saturday, matching the
  -- weekday convention work_schedules already uses.
  select * into schedule_row
  from public.work_schedules
  where employee_id = self_employee_id
    and weekday = extract(dow from today)
    and effective_from <= today
    and (effective_to is null or effective_to >= today)
  order by effective_from desc
  limit 1;

  if schedule_row.id is not null and now()::time > (schedule_row.starts_at + interval '10 minutes') then
    computed_status := 'late';
  end if;

  insert into public.attendance (organization_id, employee_id, branch_id, work_date, clocked_in_at, expected_start, expected_end, status)
  values (target_org, self_employee_id, resolved_branch, today, now(), schedule_row.starts_at, schedule_row.ends_at, computed_status)
  on conflict (employee_id, work_date) do update
    set clocked_in_at = now(),
        branch_id = coalesce(resolved_branch, public.attendance.branch_id),
        expected_start = coalesce(schedule_row.starts_at, public.attendance.expected_start),
        expected_end = coalesce(schedule_row.ends_at, public.attendance.expected_end),
        status = computed_status
  returning id into new_attendance_id;

  return new_attendance_id;
end;
$$;

create or replace function public.clock_out(target_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  self_employee_id uuid;
  attendance_row public.attendance%rowtype;
begin
  select id into self_employee_id
  from public.employee_profiles
  where user_id = auth.uid() and organization_id = target_org;
  if self_employee_id is null then
    raise exception using message = '{"code":"NOT_AN_EMPLOYEE","message":"No active worker profile for this organization"}';
  end if;

  select * into attendance_row
  from public.attendance
  where employee_id = self_employee_id and work_date = current_date
  for update;
  if attendance_row.id is null or attendance_row.clocked_in_at is null then
    raise exception using message = '{"code":"NOT_CLOCKED_IN","message":"Not clocked in today"}';
  end if;
  if attendance_row.clocked_out_at is not null then
    raise exception using message = '{"code":"ALREADY_CLOCKED_OUT","message":"Already clocked out today"}';
  end if;

  update public.attendance
  set clocked_out_at = now(),
      status = case
        when attendance_row.expected_end is not null and now()::time < (attendance_row.expected_end - interval '10 minutes')
          and attendance_row.status = 'present' then 'early_departure'
        else attendance_row.status
      end
  where id = attendance_row.id;
end;
$$;

grant execute on function public.clock_in(uuid, uuid) to authenticated;
grant execute on function public.clock_out(uuid) to authenticated;
revoke all on function public.clock_in(uuid, uuid) from public, anon;
revoke all on function public.clock_out(uuid) from public, anon;
