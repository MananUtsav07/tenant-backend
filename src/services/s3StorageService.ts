import crypto from 'node:crypto'
import https from 'node:https'

import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'

type SupportedMethod = 'GET' | 'PUT' | 'DELETE'

type SignedUrlOptions = {
  method: SupportedMethod
  key: string
  expiresInSeconds: number
  contentType?: string | null
}

function assertS3Config() {
  if (!env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_S3_BUCKET) {
    throw new AppError('AWS S3 storage is not configured on the backend', 500)
  }

  return {
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    bucket: env.AWS_S3_BUCKET,
    prefix: env.AWS_S3_DOCUMENTS_PREFIX?.replace(/^\/+|\/+$/g, '') ?? 'tenant-documents',
    publicBaseUrl: env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? null,
  }
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function toDateStamp(date: Date) {
  return toAmzDate(date).slice(0, 8)
}

function sha256Hex(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmac(key: crypto.BinaryLike, value: string) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest()
}

function encodeKey(key: string) {
  return key.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

function buildHost(bucket: string, region: string) {
  return `${bucket}.s3.${region}.amazonaws.com`
}

function buildSigningKey(secretAccessKey: string, dateStamp: string, region: string) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const regionKey = hmac(dateKey, region)
  const serviceKey = hmac(regionKey, 's3')
  return hmac(serviceKey, 'aws4_request')
}

function buildCanonicalQueryString(params: Record<string, string>) {
  return Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

function buildPublicUrl(key: string) {
  const { publicBaseUrl } = assertS3Config()
  if (!publicBaseUrl) return null
  return `${publicBaseUrl}/${encodeKey(key)}`
}

export function buildTenantDocumentStoragePath(input: {
  organizationId: string
  tenantId: string
  fileName: string
}) {
  const { prefix } = assertS3Config()
  const sanitizedFileName = input.fileName.trim().replace(/[^\w.\-]+/g, '_')
  return `${prefix}/${input.organizationId}/tenants/${input.tenantId}/${crypto.randomUUID()}-${sanitizedFileName}`
}

export function createPresignedS3Url(options: SignedUrlOptions) {
  const config = assertS3Config()
  const now = new Date()
  const amzDate = toAmzDate(now)
  const dateStamp = toDateStamp(now)
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const host = buildHost(config.bucket, config.region)
  const signedHeaders = options.method === 'PUT' && options.contentType ? 'content-type;host' : 'host'

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(options.expiresInSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  }

  const canonicalHeaders =
    options.method === 'PUT' && options.contentType
      ? `content-type:${options.contentType}\nhost:${host}\n`
      : `host:${host}\n`

  const canonicalRequest = [
    options.method,
    `/${encodeKey(options.key)}`,
    buildCanonicalQueryString(queryParams),
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const signature = crypto
    .createHmac('sha256', buildSigningKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign, 'utf8')
    .digest('hex')

  const signedQuery = buildCanonicalQueryString({
    ...queryParams,
    'X-Amz-Signature': signature,
  })

  return {
    url: `https://${host}/${encodeKey(options.key)}?${signedQuery}`,
    publicUrl: buildPublicUrl(options.key),
  }
}

export async function createTenantDocumentUploadTarget(input: {
  organizationId: string
  tenantId: string
  fileName: string
  mimeType?: string | null
}) {
  const storagePath = buildTenantDocumentStoragePath({
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    fileName: input.fileName,
  })

  const signed = createPresignedS3Url({
    method: 'PUT',
    key: storagePath,
    expiresInSeconds: 900,
    contentType: input.mimeType ?? null,
  })

  return {
    upload_url: signed.url,
    storage_path: storagePath,
    public_url: signed.publicUrl,
    headers: input.mimeType ? { 'Content-Type': input.mimeType } : {},
  }
}

export function createTenantDocumentAccessUrl(storagePath: string | null, publicUrl: string | null) {
  if (publicUrl) return publicUrl
  if (!storagePath) return null

  return createPresignedS3Url({
    method: 'GET',
    key: storagePath,
    expiresInSeconds: 3600,
  }).url
}

export async function deleteS3Object(storagePath: string) {
  const signed = createPresignedS3Url({
    method: 'DELETE',
    key: storagePath,
    expiresInSeconds: 300,
  })

  await new Promise<void>((resolve, reject) => {
    const request = https.request(signed.url, { method: 'DELETE' }, (response) => {
      const statusCode = response.statusCode ?? 500
      response.resume()

      if (statusCode >= 200 && statusCode < 300) {
        resolve()
        return
      }

      reject(new AppError(`Failed to delete document from S3 (status ${statusCode})`, 502))
    })

    request.on('error', reject)
    request.end()
  })
}
