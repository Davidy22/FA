-- Make Anyth.ing is a Hong Kong shop. Every pickup point, price label and demo
-- row now starts from that assumption: HKD, Asia/Hong_Kong, country HK.
--
-- Expansion elsewhere stays possible - locations.country, locations.currency and
-- public.sales_tax_rate() from 20250101002100 are untouched - only the defaults
-- and the seeded demo rows change. Forward-only: the original seed migration is
-- left as it was and the rows are updated here.

-- A new location or order is Hong Kong unless the admin says otherwise.
alter table public.locations
  alter column currency set default 'HKD',
  alter column timezone set default 'Asia/Hong_Kong',
  alter column country set default 'HK';

alter table public.orders
  alter column currency set default 'HKD';

-- A location whose country was never set is a Hong Kong location. The
-- locations_country_tax trigger normalises the code and zeroes the stored rate,
-- so no Hong Kong row can keep a sales tax it must not charge.
update public.locations
   set country = 'HK'
 where country is null;

-- The seeded demo shops were Taipei and San Francisco placeholders. They move
-- home: Hong Kong addresses and phone numbers, HKD, and no sales tax. The
-- machine rates stay as they were so existing pricing expectations still hold.
update public.locations
   set name = 'Make Anyth.ing Central',
       address = 'G/F, 18 Aberdeen Street, Central, Hong Kong',
       phone = '+852-2345-6789',
       timezone = 'Asia/Hong_Kong',
       currency = 'HKD',
       country = 'HK',
       tax_rate = 0,
       lat = 22.283000,
       lng = 114.154000
 where id = '00000000-0000-0000-0000-000000000001';

update public.locations
   set name = 'Make Anyth.ing Causeway Bay',
       address = '1/F, 456 Hennessy Road, Causeway Bay, Hong Kong',
       phone = '+852-2876-5432',
       timezone = 'Asia/Hong_Kong',
       currency = 'HKD',
       country = 'HK',
       tax_rate = 0,
       lat = 22.280000,
       lng = 114.185000
 where id = '00000000-0000-0000-0000-000000000002';
