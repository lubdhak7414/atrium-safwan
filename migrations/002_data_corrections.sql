alter table session
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_person_id integer references person(id);

alter table enrolment
  add column if not exists cancelled_by_person_id integer references person(id);

alter table check_in
  add column if not exists legacy_seed_defect boolean;

do $$
declare
  changed integer;
  remaining integer;
begin
  update person
  set credits = round(credits)
  where id in (2, 16, 18, 38, 40)
    and credits <> round(credits);
  get diagnostics changed = row_count;
  if changed not in (0, 5) then
    raise exception 'unexpected person credit correction count: %', changed;
  end if;

  update session
  set room_fee_credits = round(room_fee_credits),
      seat_fee_credits = round(seat_fee_credits)
  where id in (127, 381, 399)
    and (room_fee_credits <> round(room_fee_credits)
      or seat_fee_credits <> round(seat_fee_credits));
  get diagnostics changed = row_count;
  if changed not in (0, 3) then
    raise exception 'unexpected session fee correction count: %', changed;
  end if;

  update enrolment
  set credits_charged = round(credits_charged),
      credits_refunded = round(credits_refunded)
  where id in (612, 901, 1494, 1983, 2243, 2483)
    and (credits_charged <> round(credits_charged)
      or credits_refunded <> round(credits_refunded));
  get diagnostics changed = row_count;
  if changed not in (0, 6) then
    raise exception 'unexpected enrolment credit correction count: %', changed;
  end if;

  select count(*) into remaining from person where credits <> round(credits);
  select remaining + (select count(*) from session where room_fee_credits <> round(room_fee_credits))
    + (select count(*) from session where seat_fee_credits <> round(seat_fee_credits))
    + (select count(*) from enrolment where credits_charged <> round(credits_charged))
    + (select count(*) from enrolment where credits_refunded <> round(credits_refunded))
    into remaining;
  if remaining <> 0 then
    raise exception 'fractional credits remain: %', remaining;
  end if;
  if (select count(*) from (values
      (2, 1191::numeric), (16, 1761::numeric), (18, 1576::numeric),
      (38, 1219::numeric), (40, 1676::numeric)
    ) expected(id, credits)
    join person p on p.id = expected.id and p.credits = expected.credits) <> 5
    or (select count(*) from (values
      (127, 30::numeric, 15::numeric),
      (381, 120::numeric, 60::numeric),
      (399, 40::numeric, 20::numeric)
    ) expected(id, room_fee, seat_fee)
    join session s on s.id = expected.id
      and s.room_fee_credits = expected.room_fee
      and s.seat_fee_credits = expected.seat_fee) <> 3
    or (select count(*) from (values
      (127, 18, 15::numeric, 0::numeric),
      (127, 16, 15::numeric, 0::numeric),
      (127, 24, 15::numeric, 15::numeric),
      (399, 38, 20::numeric, 0::numeric),
      (399, 40, 20::numeric, 0::numeric),
      (399, 2, 20::numeric, 0::numeric)
    ) expected(session_id, person_id, charged, refunded)
    join enrolment e on e.session_id = expected.session_id
      and e.person_id = expected.person_id
      and e.credits_charged = expected.charged
      and e.credits_refunded = expected.refunded) <> 6 then
    raise exception 'specified fractional-credit targets did not settle';
  end if;
end
$$;

do $$
declare
  changed integer;
begin
  update session
  set ends_at = starts_at + interval '210 minutes'
  where id in (142, 749)
    and ends_at - starts_at <> interval '210 minutes';
  get diagnostics changed = row_count;
  if changed not in (0, 2) then
    raise exception 'unexpected intensive duration correction count: %', changed;
  end if;

  if (select count(*) from session
      where id in (142, 749)
        and ends_at - starts_at = interval '210 minutes') <> 2 then
    raise exception 'intensive duration correction did not settle both sessions';
  end if;
end
$$;

do $$
declare
  changed integer;
begin
  -- Valid New York slots: Sat 20:00, Mon 10:00, and Tue 10:00.
  update session
  set starts_at = case id
        when 69 then timestamptz '2026-10-18 00:00:00+00'
        when 419 then timestamptz '2026-11-02 15:00:00+00'
        when 463 then timestamptz '2026-09-15 14:00:00+00'
      end,
      ends_at = case id
        when 69 then timestamptz '2026-10-18 01:00:00+00'
        when 419 then timestamptz '2026-11-02 16:00:00+00'
        when 463 then timestamptz '2026-09-15 15:00:00+00'
      end
  where (id = 69 and starts_at = timestamptz '2026-10-18 00:30:00+00')
     or (id = 419 and starts_at = timestamptz '2026-11-01 15:00:00+00')
     or (id = 463 and starts_at = timestamptz '2026-09-15 07:00:00+00');
  get diagnostics changed = row_count;
  if changed not in (0, 3) then
    raise exception 'unexpected opening-hours correction count: %', changed;
  end if;

  if (select count(*) from session where id = 69
      and starts_at = timestamptz '2026-10-18 00:00:00+00'
      and ends_at = timestamptz '2026-10-18 01:00:00+00') <> 1
    or (select count(*) from session where id = 419
      and starts_at = timestamptz '2026-11-02 15:00:00+00'
      and ends_at = timestamptz '2026-11-02 16:00:00+00') <> 1
    or (select count(*) from session where id = 463
      and starts_at = timestamptz '2026-09-15 14:00:00+00'
      and ends_at = timestamptz '2026-09-15 15:00:00+00') <> 1 then
    raise exception 'opening-hours correction did not settle all sessions';
  end if;
end
$$;

do $$
declare
  changed integer;
begin
  update session
  set room_id = 6
  where id = 485
    and room_id = 5
    and starts_at = timestamptz '2026-09-15 12:30:00+00'
    and ends_at = timestamptz '2026-09-15 13:30:00+00';
  get diagnostics changed = row_count;
  if changed not in (0, 1) then
    raise exception 'unexpected room-overlap correction count: %', changed;
  end if;

  if exists (
    select 1
    from session s
    where s.id <> 485
      and s.room_id = 6
      and s.status <> 'cancelled'
      and tstzrange(s.starts_at, s.ends_at, '[)') &&
          tstzrange(timestamptz '2026-09-15 12:30:00+00', timestamptz '2026-09-15 13:30:00+00', '[)')
  ) then
    raise exception 'room 6 is not free for session 485';
  end if;
  if (select count(*) from session where id = 485 and room_id = 6
      and starts_at = timestamptz '2026-09-15 12:30:00+00'
      and ends_at = timestamptz '2026-09-15 13:30:00+00') <> 1 then
    raise exception 'session 485 was not moved to room 6';
  end if;
end
$$;

do $$
declare
  changed integer;
begin
  update session
  set starts_at = timestamptz '2026-12-04 15:00:00+00',
      ends_at = timestamptz '2026-12-04 16:00:00+00'
  where id = 557
    and coach_id = 19
    and starts_at = timestamptz '2026-12-04 13:45:00+00'
    and ends_at = timestamptz '2026-12-04 14:45:00+00';
  get diagnostics changed = row_count;
  if changed not in (0, 1) then
    raise exception 'unexpected coach-overlap correction count: %', changed;
  end if;

  if exists (
    select 1
    from session s
    where s.id <> 557
      and s.status <> 'cancelled'
      and (s.coach_id = 19 or s.room_id = 1)
      and tstzrange(s.starts_at, s.ends_at, '[)') &&
          tstzrange(timestamptz '2026-12-04 15:00:00+00', timestamptz '2026-12-04 16:00:00+00', '[)')
  ) then
    raise exception 'session 557 destination slot is occupied';
  end if;
  if (select count(*) from session where id = 557 and coach_id = 19
      and starts_at = timestamptz '2026-12-04 15:00:00+00'
      and ends_at = timestamptz '2026-12-04 16:00:00+00') <> 1 then
    raise exception 'session 557 was not moved to the documented slot';
  end if;
end
$$;

do $$
declare
  changed integer;
  person_changed integer;
  row_data record;
begin
  for row_data in
    update enrolment
    set status = 'cancelled',
        cancelled_at = timestamptz '2026-08-10 00:00:00+00',
        credits_refunded = credits_charged
    where id = 917
      and session_id = 503
      and person_id = 28
      and status = 'active'
    returning person_id, credits_charged
  loop
    changed := coalesce(changed, 0) + 1;
    update person set credits = credits + row_data.credits_charged where id = row_data.person_id;
    get diagnostics person_changed = row_count;
    if person_changed <> 1 then
      raise exception 'person % missing while refunding enrolment 917', row_data.person_id;
    end if;
  end loop;
  if coalesce(changed, 0) not in (0, 1) then
    raise exception 'unexpected teach-attend correction count: %', changed;
  end if;

  changed := 0;
  for row_data in
    update enrolment
    set status = 'cancelled',
        cancelled_at = timestamptz '2026-08-10 00:00:00+00',
        credits_refunded = credits_charged
    where id = 1928
      and session_id = 639
      and person_id = 28
      and status = 'active'
    returning person_id, credits_charged
  loop
    changed := changed + 1;
    update person set credits = credits + row_data.credits_charged where id = row_data.person_id;
    get diagnostics person_changed = row_count;
    if person_changed <> 1 then
      raise exception 'person % missing while refunding enrolment 1928', row_data.person_id;
    end if;
  end loop;
  if changed not in (0, 1) then
    raise exception 'unexpected self-enrolment correction count: %', changed;
  end if;

  if (select count(*) from enrolment where id = 917 and session_id = 503
      and person_id = 28 and status = 'cancelled'
      and cancelled_at = timestamptz '2026-08-10 00:00:00+00'
      and credits_refunded = credits_charged) <> 1
    or (select count(*) from enrolment where id = 1928 and session_id = 639
      and person_id = 28 and status = 'cancelled'
      and cancelled_at = timestamptz '2026-08-10 00:00:00+00'
      and credits_refunded = credits_charged) <> 1 then
    raise exception 'teach-attend or self-enrolment correction did not settle';
  end if;
end
$$;

do $$
declare
  changed integer;
  person_changed integer;
  row_data record;
begin
  for row_data in
    update enrolment
    set status = 'cancelled',
        cancelled_at = timestamptz '2026-08-10 00:00:00+00',
        credits_refunded = credits_charged
    where id in (2369, 1600, 292)
      and session_id = 83
      and status = 'active'
    returning person_id, credits_charged
  loop
    changed := coalesce(changed, 0) + 1;
    update person set credits = credits + row_data.credits_charged where id = row_data.person_id;
    get diagnostics person_changed = row_count;
    if person_changed <> 1 then
      raise exception 'person % missing while refunding capacity correction', row_data.person_id;
    end if;
  end loop;
  if coalesce(changed, 0) not in (0, 3) then
    raise exception 'unexpected capacity correction count: %', changed;
  end if;

  if (select count(*) from enrolment where id in (2369, 1600, 292)
      and session_id = 83 and status = 'cancelled'
      and cancelled_at = timestamptz '2026-08-10 00:00:00+00'
      and credits_refunded = credits_charged) <> 3
    or (select count(*) from enrolment where session_id = 83 and status = 'active') <> 8 then
    raise exception 'session 83 still has the wrong active capacity count';
  end if;
end
$$;

do $$
declare
  changed integer;
begin
  update check_in
  set legacy_seed_defect = true
  where id = 1251
    and enrolment_id = 1058
    and legacy_seed_defect is distinct from true;
  get diagnostics changed = row_count;
  if changed not in (0, 1) then
    raise exception 'unexpected duplicate check-in correction count: %', changed;
  end if;
  if (select count(*) from check_in where id = 1251 and enrolment_id = 1058 and legacy_seed_defect = true) <> 1 then
    raise exception 'duplicate check-in marker was not applied';
  end if;
end
$$;

do $$
declare
  changed integer;
  person_changed integer;
  row_data record;
begin
  for row_data in
    update session
    set cancelled_at = case id
          when 136 then timestamptz '2026-08-22 22:28:00+00'
          when 459 then timestamptz '2026-09-12 13:28:00+00'
        end,
        cancelled_by_person_id = coach_id
    where id in (136, 459)
      and status = 'cancelled'
      and cancelled_at is null
    returning coach_id, room_fee_credits
  loop
    changed := coalesce(changed, 0) + 1;
    update person set credits = credits + row_data.room_fee_credits where id = row_data.coach_id;
    get diagnostics person_changed = row_count;
    if person_changed <> 1 then
      raise exception 'coach % missing while refunding cancelled session', row_data.coach_id;
    end if;
  end loop;
  if coalesce(changed, 0) not in (0, 2) then
    raise exception 'unexpected cancelled-session correction count: %', changed;
  end if;

  changed := 0;
  for row_data in
    update enrolment e
    set status = 'cancelled',
        cancelled_at = s.cancelled_at,
        cancelled_by_person_id = s.coach_id,
        credits_refunded = e.credits_charged
    from session s
    where e.session_id = s.id
      and s.id in (136, 459)
      and e.status = 'active'
    returning e.person_id, e.credits_charged
  loop
    changed := changed + 1;
    update person set credits = credits + row_data.credits_charged where id = row_data.person_id;
    get diagnostics person_changed = row_count;
    if person_changed <> 1 then
      raise exception 'person % missing while refunding cancelled enrolment', row_data.person_id;
    end if;
  end loop;
  if changed not in (0, 2) then
    raise exception 'unexpected cancelled-enrolment correction count: %', changed;
  end if;

  if (select count(*) from session where id = 136
      and cancelled_at = timestamptz '2026-08-22 22:28:00+00'
      and cancelled_by_person_id = 29) <> 1
    or (select count(*) from session where id = 459
      and cancelled_at = timestamptz '2026-09-12 13:28:00+00'
      and cancelled_by_person_id = 36) <> 1
    or (select count(*) from enrolment where session_id in (136, 459) and status = 'active') <> 0
    or (select count(*) from enrolment where id = 1659 and session_id = 136
      and status = 'cancelled'
      and cancelled_at = timestamptz '2026-08-22 22:28:00+00'
      and cancelled_by_person_id = 29
      and credits_refunded = credits_charged) <> 1
    or (select count(*) from enrolment where id = 585 and session_id = 459
      and status = 'cancelled'
      and cancelled_at = timestamptz '2026-09-12 13:28:00+00'
      and cancelled_by_person_id = 36
      and credits_refunded = credits_charged) <> 1 then
    raise exception 'cancelled-session correction did not settle both sessions';
  end if;
end
$$;

do $$
begin
  if (select count(*) from session where id in (667, 726)) <> 2 then
    raise exception '48-hour historical rows must be preserved';
  end if;
end
$$;
