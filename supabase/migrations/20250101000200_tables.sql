-- Enforce US locale for money formatting, consistent across the app.
set lc_monetary = 'en_US.UTF-8';

-- profiles: one-to-one with auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  role text not null default 'customer'
    check (role in ('customer','employee','manager','admin')),
  location_id uuid,
  display_name text,
  locale text not null default 'en'
    check (locale in ('en','zh-Hant','zh-Hans')),
  is_creator boolean not null default false,
  creator_agreement_version text,
  creator_agreed_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- locations
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone varchar(30),
  photo_url text,
  lat numeric(9,6),
  lng numeric(9,6),
  timezone text not null default 'UTC',
  hourly_machine_rate numeric(10,2) not null default 5.00,
  tax_rate numeric(5,4) not null default 0,
  currency text not null default 'USD',
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger locations_updated_at before update on public.locations
  for each row execute function public.tg_set_updated_at();

alter table public.profiles
  add constraint profiles_location_id_fkey
  foreign key (location_id) references public.locations(id) on delete set null;

-- materials
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name jsonb not null check (name ? 'en'),
  adjective jsonb check (adjective is null or adjective ? 'en'),
  density_g_cm3 numeric(5,2) not null,
  default_flow_mm3_s numeric(4,1) not null default 7.0,
  print_profile jsonb,
  is_active boolean default true,
  sort_order smallint default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger materials_updated_at before update on public.materials
  for each row execute function public.tg_set_updated_at();

-- filaments
create table public.filaments (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id),
  color jsonb not null check (color ? 'en'),
  color_hex char(7),
  diameter numeric(4,2) default 1.75,
  cost_per_gram numeric(10,6) not null,
  manufacturer varchar(100),
  is_active boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger filaments_updated_at before update on public.filaments
  for each row execute function public.tg_set_updated_at();

-- location_filaments (which filaments are in-stock per location)
create table public.location_filaments (
  location_id uuid references public.locations(id) on delete cascade,
  filament_id uuid references public.filaments(id) on delete cascade,
  in_stock boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (location_id, filament_id)
);

create trigger location_filaments_updated_at before update on public.location_filaments
  for each row execute function public.tg_set_updated_at();

-- premade_products
create table public.premade_products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name jsonb not null check (name ? 'en'),
  description jsonb,
  base_price numeric(10,2) not null check (base_price >= 0),
  default_material_id uuid references public.materials(id),
  category text not null default 'other'
    check (category in ('toy','tool','art','gadget','replacement_part','other')),
  tags text[] default '{}' not null,
  image_urls jsonb default '[]'::jsonb not null,
  source_model_path text not null,
  submitted_by uuid references public.profiles(id),
  source_submission_id uuid,
  is_featured boolean default false,
  status text not null default 'draft'
    check (status in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger premade_products_updated_at before update on public.premade_products
  for each row execute function public.tg_set_updated_at();

-- product_materials
create table public.product_materials (
  product_id uuid references public.premade_products(id) on delete cascade,
  material_id uuid references public.materials(id) on delete cascade,
  price_modifier numeric(10,2) not null default 0,
  primary key (product_id, material_id)
);

-- product_option_groups
create table public.product_option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.premade_products(id) on delete cascade,
  label jsonb not null check (label ? 'en'),
  option_type text not null check (option_type in ('select_one','select_many','text','file')),
  required boolean default false,
  sort_order smallint default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger product_option_groups_updated_at before update on public.product_option_groups
  for each row execute function public.tg_set_updated_at();

-- product_option_choices
create table public.product_option_choices (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.product_option_groups(id) on delete cascade,
  label jsonb not null check (label ? 'en'),
  price_modifier numeric(10,2) not null default 0,
  sort_order smallint default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger product_option_choices_updated_at before update on public.product_option_choices
  for each row execute function public.tg_set_updated_at();

-- text_option_config
create table public.text_option_config (
  group_id uuid primary key references public.product_option_groups(id) on delete cascade,
  max_length int default 100,
  price_modifier numeric(10,2) default 0
);

-- file_option_config
create table public.file_option_config (
  group_id uuid primary key references public.product_option_groups(id) on delete cascade,
  allowed_mime_types text[] not null,
  max_size_bytes int default 5242880,
  required boolean default false
);

-- carts (authenticated users)
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger carts_updated_at before update on public.carts
  for each row execute function public.tg_set_updated_at();

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  kind text not null check (kind in ('premade','custom')),
  product_id uuid references public.premade_products(id),
  quote_request_id uuid,
  material_id uuid references public.materials(id),
  -- note: quote_request_id fk added below after quote_requests table exists
  color_filament_id uuid references public.filaments(id),
  quantity smallint not null default 1 check (quantity between 1 and 99),
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger cart_items_updated_at before update on public.cart_items
  for each row execute function public.tg_set_updated_at();

-- uploaded_models
create table public.uploaded_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  file_path varchar(500) not null,
  original_filename varchar(255),
  model_sha256 char(64),
  volume_cm3 numeric(12,4),
  surface_cm2 numeric(12,4),
  bbox jsonb,
  triangle_count int,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger uploaded_models_updated_at before update on public.uploaded_models
  for each row execute function public.tg_set_updated_at();

alter table public.cart_items
  add constraint cart_items_quote_request_id_fkey
  foreign key (quote_request_id) references public.quote_requests(id) on delete set null;

-- quote_requests
create table public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  uploaded_model_id uuid references public.uploaded_models(id),
  material_id uuid references public.materials(id),
  filament_id uuid references public.filaments(id),
  infill_percent smallint default 20 check (infill_percent between 0 and 100),
  layer_height numeric(4,2) default 0.2,
  quantity smallint default 1 check (quantity between 1 and 10),
  engine text default 'heuristic' check (engine in ('heuristic','wasm','remote')),
  status text default 'complete' check (status in ('processing','complete','failed')),
  estimated_price numeric(10,2),
  price_breakdown jsonb,
  material_usage_grams numeric(10,2),
  print_time_minutes int,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

-- orders
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  user_id uuid references public.profiles(id),
  location_id uuid not null references public.locations(id),
  contact_name text,
  contact_email text not null,
  locale text not null default 'en' check (locale in ('en','zh-Hant','zh-Hans')),
  status text not null default 'pending'
    check (status in ('pending','printing','completed','shipped','cancelled','refunded')),
  subtotal numeric(10,2) not null,
  tax_amount numeric(10,2) not null default 0,
  shipping_amount numeric(10,2) not null default 0,
  total_amount numeric(10,2) not null,
  currency text not null default 'USD',
  shipping_address jsonb,
  tracking_number varchar(100),
  stripe_session_id text,
  stripe_payment_intent_id text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger orders_updated_at before update on public.orders
  for each row execute function public.tg_set_updated_at();

-- order_items
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  premade_product_id uuid references public.premade_products(id),
  quote_request_id uuid references public.quote_requests(id),
  material_id uuid references public.materials(id),
  color_filament_id uuid references public.filaments(id),
  quantity smallint not null default 1 check (quantity between 1 and 99),
  unit_price numeric(10,2) not null,
  total_price numeric(10,2) generated always as (quantity * unit_price) stored,
  item_snapshot jsonb not null,
  creator_id uuid references public.profiles(id),
  creator_revenue numeric(10,2) not null default 0,
  platform_fee numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

-- order_item_option_values
create table public.order_item_option_values (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  option_group_id uuid references public.product_option_groups(id),
  selected_choice_id uuid references public.product_option_choices(id),
  text_value text,
  file_path varchar(500),
  unique (order_item_id, option_group_id)
);

-- order_notes
create table public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  author_id uuid references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

-- model_submissions
create table public.model_submissions (
  id uuid primary key default gen_random_uuid(),
  submitter_id uuid not null references public.profiles(id),
  status text not null default 'draft'
    check (status in ('draft','pending_review','changes_requested','approved','rejected','disabled')),
  title jsonb not null check (title ? 'en'),
  description jsonb,
  category text not null default 'other'
    check (category in ('toy','tool','art','gadget','replacement_part','other')),
  tags text[] default '{}' not null,
  license text not null,
  ip_warranty boolean not null default false,
  model_path text not null,
  preview_urls jsonb default '[]'::jsonb not null,
  base_price numeric(10,2) not null check (base_price >= 0),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  published_product_id uuid references public.premade_products(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger model_submissions_updated_at before update on public.model_submissions
  for each row execute function public.tg_set_updated_at();

-- model_submission_materials
create table public.model_submission_materials (
  submission_id uuid references public.model_submissions(id) on delete cascade,
  material_id uuid references public.materials(id) on delete cascade,
  price_modifier numeric(10,2) not null default 0,
  primary key (submission_id, material_id)
);

-- creator_earnings ledger
create table public.creator_earnings (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id),
  order_item_id uuid references public.order_items(id),
  type text not null check (type in ('sale','refund_clawback','adjustment')),
  amount numeric(10,2) not null,
  memo text,
  created_at timestamptz not null default now()
);

-- payouts
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id),
  amount numeric(10,2) not null check (amount > 0),
  status text not null default 'requested'
    check (status in ('requested','processing','paid','rejected')),
  method text not null default 'manual'
    check (method in ('manual','stripe_connect')),
  reference text,
  processed_by uuid references public.profiles(id),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payouts_updated_at before update on public.payouts
  for each row execute function public.tg_set_updated_at();

-- platform_settings
create table public.platform_settings (
  key text primary key,
  value jsonb not null
);

-- checkout_sessions
create table public.checkout_sessions (
  session_id text primary key,
  cart jsonb not null,
  user_id uuid references public.profiles(id),
  location_id uuid references public.locations(id),
  contact_email text,
  contact_name text,
  locale text default 'en',
  created_at timestamptz not null default now()
);

-- stripe_events for idempotency
create table public.stripe_events (
  id text primary key,
  payload jsonb,
  received_at timestamptz not null default now()
);

-- Indexes
create index orders_location_status_created_idx on public.orders(location_id, status, created_at desc);
create index order_items_order_idx on public.order_items(order_id);
create index premade_products_status_created_idx on public.premade_products(status, created_at desc);
create index model_submissions_status_submitted_idx on public.model_submissions(status, submitted_at);
create index creator_earnings_creator_created_idx on public.creator_earnings(creator_id, created_at);
create index idx_premade_products_tags on public.premade_products using gin (tags);
create index idx_model_submissions_tags on public.model_submissions using gin (tags);
create index idx_premade_products_name_trgm on public.premade_products using gin ((name->>'en') gin_trgm_ops);
create index idx_cart_items_cart on public.cart_items(cart_id);
create index idx_uploaded_models_sha on public.uploaded_models(model_sha256);

-- Auto-create a profile row when a new auth.users row is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)), 'customer')
  on conflict (id) do nothing;
  insert into public.carts (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
