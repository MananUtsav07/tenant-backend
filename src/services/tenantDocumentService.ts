import { prisma } from '../lib/db.js'
import { AppError } from '../lib/errors.js'
import { createTenantDocumentAccessUrl, deleteS3Object } from './s3StorageService.js'

type TenantDocumentRow = Awaited<ReturnType<typeof prisma.tenant_documents.findFirst>>

function mapTenantDocument(row: NonNullable<TenantDocumentRow>) {
  return {
    ...row,
    file_size_bytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    access_url: createTenantDocumentAccessUrl(row.storage_path, row.public_url),
  }
}

async function assertTenantOwnership(input: { organizationId: string; ownerId: string; tenantId: string }) {
  const tenant = await prisma.tenants.findFirst({
    where: {
      id: input.tenantId,
      organization_id: input.organizationId,
      owner_id: input.ownerId,
    },
    select: { id: true },
  })

  if (!tenant) {
    throw new AppError('Tenant not found in your organization', 404)
  }
}

export async function listTenantDocuments(input: { organizationId: string; ownerId: string; tenantId: string }) {
  await assertTenantOwnership(input)

  const rows = await prisma.tenant_documents.findMany({
    where: {
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      tenant_id: input.tenantId,
    },
    orderBy: { created_at: 'desc' },
  })

  return rows.map((row) => mapTenantDocument(row))
}

export async function createTenantDocument(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  payload: {
    document_name: string
    document_type: string
    file_name: string
    storage_path?: string | null
    public_url?: string | null
    mime_type?: string | null
    file_size_bytes?: number | null
    notes?: string | null
  }
}) {
  await assertTenantOwnership(input)

  const row = await prisma.tenant_documents.create({
    data: {
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      tenant_id: input.tenantId,
      document_name: input.payload.document_name,
      document_type: input.payload.document_type,
      file_name: input.payload.file_name,
      storage_path: input.payload.storage_path ?? null,
      public_url: input.payload.public_url ?? null,
      mime_type: input.payload.mime_type ?? null,
      file_size_bytes: input.payload.file_size_bytes ?? null,
      notes: input.payload.notes ?? null,
    },
  })

  return mapTenantDocument(row)
}

export async function updateTenantDocument(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  documentId: string
  patch: Partial<{
    document_name: string
    document_type: string
    file_name: string
    storage_path: string | null
    public_url: string | null
    mime_type: string | null
    file_size_bytes: number | null
    notes: string | null
  }>
}) {
  await assertTenantOwnership(input)

  const existing = await prisma.tenant_documents.findFirst({
    where: {
      id: input.documentId,
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      tenant_id: input.tenantId,
    },
  })

  if (!existing) {
    throw new AppError('Tenant document not found', 404)
  }

  const row = await prisma.tenant_documents.update({
    where: { id: existing.id },
    data: {
      ...input.patch,
      updated_at: new Date(),
    },
  })

  const previousStoragePath = existing.storage_path
  const isStoragePathChanging =
    typeof input.patch.storage_path !== 'undefined' &&
    previousStoragePath &&
    input.patch.storage_path &&
    input.patch.storage_path !== previousStoragePath

  if (isStoragePathChanging) {
    void deleteS3Object(previousStoragePath).catch((error) => {
      console.error('[tenantDocumentService] failed to delete replaced S3 object', {
        documentId: existing.id,
        storagePath: previousStoragePath,
        error,
      })
    })
  }

  return mapTenantDocument(row)
}

export async function deleteTenantDocument(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  documentId: string
}) {
  await assertTenantOwnership(input)

  const existing = await prisma.tenant_documents.findFirst({
    where: {
      id: input.documentId,
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      tenant_id: input.tenantId,
    },
  })

  if (!existing) {
    throw new AppError('Tenant document not found', 404)
  }

  await prisma.tenant_documents.delete({
    where: { id: existing.id },
  })

  if (existing.storage_path) {
    void deleteS3Object(existing.storage_path).catch((error) => {
      console.error('[tenantDocumentService] failed to delete S3 object after record deletion', {
        documentId: existing.id,
        storagePath: existing.storage_path,
        error,
      })
    })
  }

  return existing
}
