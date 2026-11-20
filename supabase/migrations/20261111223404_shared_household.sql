-- The personal app now uses a server-owned household, independent of Auth.
-- Existing rows are retained; no other application or Auth settings are changed.
alter table nossa_proxima_serie.nps_profiles drop constraint nps_profiles_user_id_fkey;
alter table nossa_proxima_serie.nps_reactions drop constraint nps_reactions_user_id_fkey;
revoke all on nossa_proxima_serie.nps_profiles,nossa_proxima_serie.nps_reactions,nossa_proxima_serie.nps_shows from anon,authenticated;
insert into nossa_proxima_serie.nps_profiles(user_id,name)
values ('00000000-0000-4000-8000-000000000010','Voc�s') on conflict(user_id) do nothing;

