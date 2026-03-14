-- 004_admin_blog_analytics.sql
-- Admin role, blog CMS, and analytics events storage.

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  content text not null,
  excerpt text not null,
  cover_image text,
  author text not null default 'TenantFlow Team',
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  user_type text not null default 'public',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint analytics_events_user_type_check check (user_type in ('public', 'owner', 'tenant', 'admin', 'system'))
);

create index if not exists admin_users_email_idx on public.admin_users(email);
create index if not exists blog_posts_published_created_idx on public.blog_posts(published, created_at desc);
create index if not exists blog_posts_slug_idx on public.blog_posts(slug);
create index if not exists analytics_events_name_created_idx on public.analytics_events(event_name, created_at desc);
create index if not exists analytics_events_user_type_created_idx on public.analytics_events(user_type, created_at desc);

drop trigger if exists set_updated_at_admin_users on public.admin_users;
create trigger set_updated_at_admin_users
before update on public.admin_users
for each row
execute function public.set_updated_at();

drop trigger if exists set_updated_at_blog_posts on public.blog_posts;
create trigger set_updated_at_blog_posts
before update on public.blog_posts
for each row
execute function public.set_updated_at();

alter table public.admin_users enable row level security;
alter table public.blog_posts enable row level security;
alter table public.analytics_events enable row level security;

insert into public.admin_users (email, password_hash, full_name)
values (
  'support@prophives.com',
  crypt('Admin@12345', gen_salt('bf')),
  'TenantFlow Admin'
)
on conflict (email) do nothing;

insert into public.blog_posts (title, slug, content, excerpt, cover_image, author, published)
values
(
  'How to Streamline Tenant Support Workflows',
  'streamline-tenant-support-workflows',
  'Property teams can resolve requests faster by standardizing ticket intake, status updates, and escalation rules. TenantFlow centralizes this workflow so owners and managers can respond quickly without losing context.',
  'A practical guide to reduce ticket response time and improve tenant satisfaction.',
  'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1400&q=80',
  'TenantFlow Team',
  true
),
(
  'Rent Reminder Automation for Growing Portfolios',
  'rent-reminder-automation-for-growing-portfolios',
  'Manual follow-ups do not scale when portfolio size increases. Automated reminder schedules keep communication consistent and help reduce overdue payments across properties.',
  'Why automated reminder schedules outperform manual monthly follow-up.',
  'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1400&q=80',
  'TenantFlow Team',
  true
)
on conflict (slug) do nothing;
