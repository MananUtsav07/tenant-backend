# Prophives — Tenant Backend

## Stack
- **Runtime**: Node.js 20 (ESM)
- **Framework**: Express 5
- **Language**: TypeScript (strict, compiled to `dist/`)
- **Database**: PostgreSQL via **Prisma ORM v7.6.0** (`@prisma/client` + `@prisma/adapter-pg`)
- **Validation**: Zod
- **Auth**: JWT (custom, `src/lib/jwt.ts`)
- **Email**: Nodemailer + GoDaddy SMTP
- **AI**: OpenAI (`gpt-4o-mini` default)
- **Messaging**: Telegram Bot API, Twilio WhatsApp (or Meta WhatsApp Business API)

## Commands
```bash
npm run dev        # tsx watch (hot reload)
npm run build      # prisma generate + tsc → dist/
npm start          # node dist/index.js
```

## Deployment
- **Server**: AWS Lightsail Ubuntu 22.04 — `65.2.108.154`
- **Process manager**: PM2 (`prophives-backend`, id 1)
- **App directory**: `/opt/prophives-backend`
- **Port**: 3001 (Nginx proxies 80/443 → 3001)
- **SSL**: Let's Encrypt via Certbot (auto-renews, expires 2026-07-05)
- **CI/CD**: GitHub Actions on push to `main` (`.github/workflows/deploy.yml`)
  - Builds locally → SCP `dist/` to server → `npm ci --omit=dev` → `npx prisma generate` → `pm2 restart`
- **Secrets required** in GitHub repo: `LIGHTSAIL_HOST`, `LIGHTSAIL_SSH_KEY`

### Useful server commands
```bash
ssh -i "LightsailDefaultKey-ap-south-1.pem" ubuntu@65.2.108.154
pm2 list
pm2 logs prophives-backend --lines 50
pm2 restart prophives-backend --update-env
```

## Directory Structure
```
src/
├── app.ts                        # Express app factory — rawBody captured here for webhook HMAC
├── index.ts                      # Server entrypoint
├── config/
│   └── env.ts                    # Zod-validated env schema — server exits if any required var missing
├── controllers/
│   ├── whatsappController.ts     # Thin: delegates to providerRegistry
│   └── telegramController.ts     # All Telegram bot logic inline
├── routes/
│   ├── publicRoutes.ts           # Webhook routes (no auth)
│   ├── authRoutes.ts
│   ├── ownerRoutes.ts
│   ├── tenantRoutes.ts
│   └── adminRoutes.ts
├── services/
│   ├── whatsappBotService.ts     # Owner bot: phone→owner lookup, conversation state (10min TTL)
│   ├── whatsappLinkService.ts    # DB: upsert/read owner WhatsApp chat links
│   ├── telegramService.ts
│   ├── telegramOnboardingService.ts
│   ├── ownerService.ts
│   ├── ticketThreadService.ts
│   └── automation/
│       ├── providers/
│       │   ├── contracts.ts          # Provider interface types
│       │   ├── providerRegistry.ts   # Instantiates DefaultWhatsAppProvider
│       │   └── whatsappProvider.ts   # Meta/Twilio API integration
│       ├── messageTemplateService.ts
│       └── integrationEventService.ts
├── middleware/
│   ├── ownerAuth.ts
│   ├── tenantAuth.ts
│   ├── adminAuth.ts
│   └── requestContext.ts
├── lib/
│   ├── db.ts                     # Prisma client singleton using @prisma/adapter-pg
│   ├── errors.ts                 # AppError, asyncHandler
│   ├── supabase.ts               # Empty stub — Supabase fully removed
│   ├── jwt.ts
│   └── mailer.ts
└── validations/
    └── whatsappSchemas.ts
```

## Database (Prisma)

- **Schema**: `prisma/schema.prisma`
- **Config**: `prisma.config.ts` (reads `DATABASE_URL`)
- **Client**: `src/lib/db.ts` — uses `@prisma/adapter-pg` (required for Prisma v7 WASM client engine)

```ts
// src/lib/db.ts
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
export const prisma = new PrismaClient({ adapter })
```

**IMPORTANT**: After `npm ci --omit=dev`, always run `npx prisma generate` before starting the app. Without it, `@prisma/client` throws a CommonJS named export error. The CI/CD pipeline does this automatically.

### Key Prisma patterns used throughout services
- Pagination: `skip: (page-1)*pageSize, take: pageSize`
- Count: `prisma.table.count({ where })`
- JSON fields: must cast as `as object` — e.g. `metadata: input.metadata as object`
- DateTime: Prisma returns JS `Date` objects — use `.toISOString()` when serializing to responses
- Decimal: Prisma returns `Decimal` objects — use `Number(row.amount)` to serialize
- Dual FK relations: some tables have two FKs to `owners`, generating long relation names like `owners_vacancy_campaigns_owner_idToowners`

## Environment Variables

All validated in `src/config/env.ts`. Server exits if any required var is missing.

| Variable | Required | Notes |
|----------|----------|-------|
| `PORT` | No | Default 8787 |
| `NODE_ENV` | No | development/production/test |
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/dbname` |
| `JWT_SECRET` | Yes | min 20 chars |
| `EMAIL_USER` | Yes | |
| `EMAIL_PASS` | Yes | |
| `SMTP_HOST` | No | GoDaddy: `smtpout.secureserver.net` |
| `SMTP_PORT` | No | Default 465 |
| `SMTP_SECURE` | No | Default true |
| `FRONTEND_URL` | Yes | Used for CORS |
| `ALLOWED_ORIGINS` | No | Comma-separated; falls back to FRONTEND_URL |
| `OPENAI_API_KEY` | No | AI features disabled if missing |
| `OPENAI_MODEL` | No | Default `gpt-4o-mini` |
| `TELEGRAM_BOT_TOKEN` | No | |
| `TELEGRAM_BOT_USERNAME` | No | |
| `TELEGRAM_WEBHOOK_SECRET` | No | |
| `TELEGRAM_ONBOARDING_TOKEN_TTL_MINUTES` | No | Default 30 |
| `WHATSAPP_PROVIDER` | No | `meta`, `twilio`, or `stub` |
| `TWILIO_ACCOUNT_SID` | No | |
| `TWILIO_AUTH_TOKEN` | No | |
| `TWILIO_WHATSAPP_NUMBER` | No | E.164 format |
| `WHATSAPP_ACCESS_TOKEN` | No | Meta Graph API token (can expire) |
| `WHATSAPP_PHONE_NUMBER_ID` | No | Meta Developer Dashboard |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | No | Meta Developer Dashboard |
| `WHATSAPP_APP_SECRET` | No | For HMAC signature verification |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | No | Must match Meta Dashboard |
| `INTERNAL_AUTOMATION_KEY` | No | Bearer token for internal routes |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | No | Default 60 |

## WhatsApp Integration

### How it works
1. **Webhook verification**: Meta calls `GET /api/public/whatsapp/webhook`
2. **Inbound messages**: HMAC-SHA256 verified via `x-hub-signature-256` header (needs `WHATSAPP_APP_SECRET` + rawBody)
3. **Owner identification**: sender phone matched against `owners.support_whatsapp` DB field
4. **Outbound**: posted via Twilio or Meta Graph API, logged to `whatsapp_message_deliveries`

### Common failure reasons
| Symptom | Cause | Fix |
|---------|-------|-----|
| No messages received | Webhook not registered | Add URL + verify token in Meta/Twilio Dashboard |
| 401 on sends | Access token expired | Regenerate system user token in Meta Business |
| Bot can't identify owner | Owner hasn't saved phone | Owner → Profile → set support_whatsapp |
| HMAC mismatch on webhook | Wrong app secret | Verify `WHATSAPP_APP_SECRET` matches Meta App |

## Telegram Integration

- Bot: `@Prophivesbot` (token in `TELEGRAM_BOT_TOKEN`)
- Webhook: `POST /api/public/telegram/webhook` with `X-Telegram-Bot-Api-Secret-Token` header
- Owner onboarding: unique token URL → `/api/public/telegram/onboard/:token`

## Webhook Routes
```
GET  /api/public/whatsapp/webhook        → Meta verification challenge
POST /api/public/whatsapp/webhook        → inbound WhatsApp events
POST /api/public/telegram/webhook        → inbound Telegram events
GET  /api/public/telegram/onboard/:token → owner Telegram onboarding
GET  /api/health                         → {"ok":true,"env":"production","service":"tenant-backend"}
```
