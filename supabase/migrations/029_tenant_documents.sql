create table if not exists public.tenant_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_name text not null,
  document_type text not null,
  file_name text not null,
  storage_path text,
  public_url text,
  mime_type text,
  file_size_bytes bigint,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_documents_tenant_created_idx
  on public.tenant_documents (organization_id, tenant_id, created_at desc);

create index if not exists tenant_documents_owner_idx
  on public.tenant_documents (owner_id);
