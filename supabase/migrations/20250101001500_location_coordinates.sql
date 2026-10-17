-- The location picker can show a map, so seeded locations need coordinates.
-- Locations managed in Supabase Studio can set lat/lng directly; rows without
-- coordinates still appear in the searchable list.
update public.locations
   set lat = 25.033000, lng = 121.565400
 where id = '00000000-0000-0000-0000-000000000001'
   and lat is null and lng is null;

update public.locations
   set lat = 37.787300, lng = -122.396400
 where id = '00000000-0000-0000-0000-000000000002'
   and lat is null and lng is null;

alter table public.locations
  add constraint locations_lat_range check (lat is null or lat between -90 and 90),
  add constraint locations_lng_range check (lng is null or lng between -180 and 180);
