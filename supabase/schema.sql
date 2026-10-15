-- Run this entire script in Supabase SQL Editor for project nestxckkpbyfjpwsuiqu.
-- It creates separate product orders and appointment bookings with customer-only RLS.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone text not null check (char_length(phone) between 7 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  name text not null,
  pack_size text not null,
  description text not null,
  price_paise integer not null check (price_paise > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.products (id, name, pack_size, description, price_paise, sort_order)
values
  (
    'ashwagandha-60-capsules',
    'Ashwagandha',
    '60 capsules',
    'Ashwagandha product in a 60-capsule pack. Please check the product label for ingredients and directions.',
    35000,
    1
  ),
  (
    'chyawanprash-500g',
    'Chyawanprash',
    '500 g',
    'Traditional chyawanprash in a 500 g pack. Please check the product label for ingredients and directions.',
    35000,
    2
  )
on conflict (id) do update
set name = excluded.name,
    pack_size = excluded.pack_size,
    description = excluded.description,
    price_paise = excluded.price_paise,
    sort_order = excluded.sort_order,
    updated_at = now();

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  phone text not null,
  service text not null check (service in (
    'Wellness consultation',
    'Personal wellness plan',
    'Ongoing care',
    'Not sure yet'
  )),
  preferred_date date not null,
  preferred_time time not null,
  amount_paise integer not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  booking_status text not null default 'pending_payment' check (
    booking_status in ('pending_payment', 'pending_confirmation', 'confirmed', 'cancelled', 'payment_failed')
  ),
  payment_status text not null default 'pending' check (
    payment_status in ('pending', 'paid', 'failed', 'refunded')
  ),
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  paid_at timestamptz,
  receipt_email_status text not null default 'pending' check (
    receipt_email_status in ('pending', 'sent', 'failed')
  ),
  receipt_email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  phone text not null,
  shipping_address text not null,
  shipping_city text not null,
  shipping_state text not null,
  shipping_pincode text not null check (shipping_pincode ~ '^[0-9]{6}$'),
  shipping_country text not null default 'India' check (shipping_country = 'India'),
  amount_paise integer not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  order_status text not null default 'pending_payment' check (
    order_status in ('pending_payment', 'processing', 'shipped', 'completed', 'cancelled', 'payment_failed')
  ),
  payment_status text not null default 'pending' check (
    payment_status in ('pending', 'paid', 'failed', 'refunded')
  ),
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  paid_at timestamptz,
  receipt_email_status text not null default 'pending' check (
    receipt_email_status in ('pending', 'sent', 'failed')
  ),
  receipt_email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id text not null references public.products (id),
  item_name text not null,
  pack_size text not null,
  unit_price_paise integer not null check (unit_price_paise > 0),
  quantity integer not null check (quantity between 1 and 10),
  created_at timestamptz not null default now()
);

create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  phone text not null,
  message text not null check (char_length(message) between 3 and 1200),
  created_at timestamptz not null default now()
);

create index if not exists bookings_user_created_idx
  on public.bookings (user_id, created_at desc);
create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc);
create index if not exists order_items_order_idx
  on public.order_items (order_id);
create index if not exists enquiries_user_created_idx
  on public.enquiries (user_id, created_at desc);

create or replace function public.handle_new_wellness_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Wellness member'),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_wellness_profile on auth.users;
create trigger on_auth_user_created_wellness_profile
  after insert on auth.users
  for each row execute procedure public.handle_new_wellness_profile();
revoke all on function public.handle_new_wellness_profile() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.bookings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.enquiries enable row level security;

drop policy if exists "Customers can view their own profile" on public.profiles;
create policy "Customers can view their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Customers can create their own profile" on public.profiles;
create policy "Customers can create their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Customers can update their own profile" on public.profiles;
create policy "Customers can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Anyone can view active products" on public.products;
create policy "Anyone can view active products"
  on public.products for select
  to anon, authenticated
  using (is_active);

drop policy if exists "Customers can view their own bookings" on public.bookings;
create policy "Customers can view their own bookings"
  on public.bookings for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Customers can view their own orders" on public.orders;
create policy "Customers can view their own orders"
  on public.orders for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Customers can view their own order items" on public.order_items;
create policy "Customers can view their own order items"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.user_id = (select auth.uid())
    )
  );

drop policy if exists "Customers can view their own enquiries" on public.enquiries;
create policy "Customers can view their own enquiries"
  on public.enquiries for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.products, public.bookings, public.orders, public.order_items, public.enquiries from anon;
grant select on public.products to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.bookings, public.orders, public.order_items, public.enquiries to authenticated;
grant all on public.profiles, public.products, public.bookings, public.orders, public.order_items, public.enquiries to service_role;
