-- A sign-in for the people who review the social apps. The account itself
-- is created in Supabase Authentication, with a password, for this address.
-- Apply once in the SQL editor, like the earlier migrations.

insert into public.waitlist (email, source, invited_at)
values ('reviewer@plan.video', 'review', now())
on conflict (email) do update set invited_at = coalesce(public.waitlist.invited_at, now());
