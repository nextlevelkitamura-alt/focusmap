import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let client: S3Client | null = null

export class R2ConfigurationError extends Error {
  constructor(message = 'R2 is not configured') {
    super(message)
    this.name = 'R2ConfigurationError'
  }
}

function accountId() {
  return process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID || ''
}

function accessKeyId() {
  return process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || ''
}

function secretAccessKey() {
  return process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || ''
}

export function r2ScreenshotBucket() {
  return process.env.R2_SCREENSHOT_BUCKET || process.env.R2_BUCKET || ''
}

export function isR2Configured() {
  return Boolean(accountId() && accessKeyId() && secretAccessKey() && r2ScreenshotBucket())
}

export function getR2Client() {
  if (typeof window !== 'undefined') {
    throw new R2ConfigurationError('R2 client is server-only')
  }
  if (client) return client

  const account = accountId()
  const key = accessKeyId()
  const secret = secretAccessKey()
  if (!account || !key || !secret || !r2ScreenshotBucket()) throw new R2ConfigurationError()

  client = new S3Client({
    region: 'auto',
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: key,
      secretAccessKey: secret,
    },
  })
  return client
}

export async function putR2Object(input: {
  key: string
  body: Uint8Array
  contentType: string
}) {
  await getR2Client().send(new PutObjectCommand({
    Bucket: r2ScreenshotBucket(),
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
  }))
}

export async function deleteR2Object(key: string) {
  await getR2Client().send(new DeleteObjectCommand({
    Bucket: r2ScreenshotBucket(),
    Key: key,
  }))
}

export async function signedR2GetUrl(key: string, expiresInSeconds = 300) {
  const expiresIn = Math.max(60, Math.min(900, Math.round(expiresInSeconds)))
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({
      Bucket: r2ScreenshotBucket(),
      Key: key,
    }),
    { expiresIn },
  )
}
