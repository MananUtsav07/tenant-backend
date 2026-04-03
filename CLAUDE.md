# Prophives — Tenant Backend

## Stack
- **Runtime**: Node.js (ESM)
- **Framework**: Express 5
- **Language**: TypeScript (strict, compiled to `dist/`)
- **Database**: Supabase (PostgreSQL via `@supabase/supabase-js`)
- **Validation**: Zod
- **Auth**: JWT (custom, `src/lib/jwt.ts`)
- **Email**: Nodemailer + GoDaddy SMTP
- **AI**: OpenAI (`gpt-4o-mini` default)
- **Messaging**: Telegram Bot API, Meta WhatsApp Business API

## Commands
```bash
npm run dev        # tsx watch (hot reload)
npm run build      # tsc → dist/
npm start          # node dist/index.js
npm run lint       # ESLint
```

## Directory Structure
```
src/
├── app.ts                        # Express app factory — rawBody captured here (line 62)
├── index.ts                      # Server entrypoint
├── config/
│   └── env.ts                    # Zod-validated env schema (all env vars validated here)
├── controllers/
│   ├── whatsappController.ts     # Thin: delegates to providerRegistry (51 lines)
│   └── telegramController.ts     # Fat: all Telegram bot logic inline (~21k lines)
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
│   ├── telegramConversationService.ts
│   ├── notificationService.ts
│   ├── ownerService.ts
│   ├── ticketThreadService.ts
│   └── automation/
│       ├── providers/
│       │   ├── contracts.ts          # Provider interface types
│       │   ├── providerRegistry.ts   # Instantiates DefaultWhatsAppProvider
│       │   └── whatsappProvider.ts   # Meta API integration (~1400 lines)
│       ├── messageTemplateService.ts
│       └── integrationEventService.ts
├── middleware/
│   ├── ownerAuth.ts
│   ├── tenantAuth.ts
│   ├── adminAuth.ts
│   └── requestContext.ts         # Attaches requestId to req
├── lib/
│   ├── errors.ts                 # AppError, asyncHandler
│   ├── supabase.ts               # supabaseAdmin client
│   ├── jwt.ts
│   └── mailer.ts
└── validations/
    └── whatsappSchemas.ts        # Webhook challenge + payload Zod schemas
```

## Environment Variables

All validated in `src/config/env.ts`. Server exits if any required var is missing.

| Variable | Required | Notes |
|----------|----------|-------|
| `PORT` | No | Default 8787 |
| `NODE_ENV` | No | development/production/test |
| `SUPABASE_URL` | Yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | |
| `JWT_SECRET` | Yes | |
| `EMAIL_USER` | Yes | |
| `EMAIL_PASS` | Yes | |
| `SMTP_HOST` | No | Default: GoDaddy |
| `SMTP_PORT` | No | Default 465 |
| `FRONTEND_URL` | Yes | Used for CORS |
| `ALLOWED_ORIGINS` | No | Comma-separated; falls back to FRONTEND_URL |
| `OPENAI_API_KEY` | No | AI features disabled if missing |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot disabled if missing |
| `TELEGRAM_BOT_USERNAME` | No | |
| `TELEGRAM_WEBHOOK_SECRET` | No | |
| `WHATSAPP_PROVIDER` | No | `meta` or `stub` |
| `WHATSAPP_ACCESS_TOKEN` | No | Meta Graph API token (can expire!) |
| `WHATSAPP_PHONE_NUMBER_ID` | No | From Meta Developer Dashboard |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | No | From Meta Developer Dashboard |
| `WHATSAPP_APP_SECRET` | No | Used for HMAC signature verification |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | No | Must match Meta Dashboard setting |
| `INTERNAL_AUTOMATION_KEY` | No | Bearer token for internal routes |

## WhatsApp Integration

### How it works
1. **Webhook verification**: Meta calls `GET /api/public/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
   - Handler: `whatsappController.getWhatsAppWebhook` → `whatsappProvider.handleWebhookChallenge` (line 1141)
   - Returns the challenge string if verify token matches

2. **Inbound messages**: Meta calls `POST /api/public/whatsapp/webhook` with signed payload
   - HMAC-SHA256 signature checked via `x-hub-signature-256` header (needs `WHATSAPP_APP_SECRET` + rawBody)
   - rawBody **is** captured in `app.ts` line 62 via `express.json verify` callback
   - Events extracted by `extractMetaWebhookEvents()` (line 464)
   - Text messages routed to `processWhatsAppOwnerBotMessage` in `whatsappBotService.ts`

3. **Owner identification**: WhatsApp has NO onboarding URL like Telegram.
   - Owner's **sender phone number** is matched against `owners.support_whatsapp` DB field
   - If owner hasn't saved their WhatsApp number in their profile → messages are silently discarded

4. **Outbound messages**: `DefaultWhatsAppProvider.sendFreeform()` / `sendTemplate()` / `sendActionMessage()`
   - Posts to `https://graph.facebook.com/v22.0/{phoneNumberId}/messages`
   - All deliveries logged to `whatsapp_message_deliveries` table

### Common failure reasons
| Symptom | Cause | Fix |
|---------|-------|-----|
| No messages received | Webhook not set up in Meta Portal | Register URL + verify token in Meta Dashboard |
| 401 on sends | Access token expired | Generate new system user token in Meta Business |
| `meta_provider_missing_configuration` | `WHATSAPP_PHONE_NUMBER_ID` or `WHATSAPP_ACCESS_TOKEN` missing/unparseable | Fix .env |
| Bot receives but can't identify owner | Owner hasn't saved their phone in profile | Owner goes to Profile → set support_whatsapp |
| 401 on webhook events | HMAC signature mismatch | Verify `WHATSAPP_APP_SECRET` matches Meta App secret |

### Meta Developer Dashboard checklist
- App → WhatsApp → Configuration → Webhook: `https://<backend>/api/public/whatsapp/webhook`
- Verify Token: value of `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- Subscribed fields: `messages`
- Phone Number ID and Business Account ID must match `.env`

## Telegram Integration (for comparison)

- Bot: `@Prophivesbot` (token in `TELEGRAM_BOT_TOKEN`)
- Webhook: `POST /api/public/telegram/webhook` with `X-Telegram-Bot-Api-Secret-Token` header
- Owner onboarding: unique token URL → `/api/public/telegram/onboard/:token`
- All logic in `telegramController.ts` (no separate service files)
- Delivery logs available via owner API

## Webhook Routes (publicRoutes.ts)
```
GET  /api/public/whatsapp/webhook   → getWhatsAppWebhook (Meta verification)
POST /api/public/whatsapp/webhook   → postWhatsAppWebhook (inbound events)
POST /api/public/telegram/webhook   → postTelegramWebhook
GET  /api/public/telegram/onboard/:token → telegramOnboardOwner
```
