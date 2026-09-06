# Ascent Interiors — Meta Ads → WhatsApp → AI → Site Visit

An n8n workflow that takes an interior-design lead from a Meta ad, hands it to
an AI assistant on WhatsApp, qualifies it, and books a site visit on Google
Calendar — writing every turn back to a Google Sheets CRM.

## What it does

```
Meta lead ad ──┐
               ├─► webhook ─► normalise phone ─► CRM lookup ─┐
WhatsApp reply ┘                                             │
                                                             ▼
                                              build context + transcript
                                                             │
                                                             ▼
                                                   AI generates reply
                                                             │
                          ┌──────────────────────────────────┼───────────────────┐
                          ▼                                  ▼                   ▼
                  check availability                  book appointment      plain reply
                  (Calendar freeBusy)                 (Calendar event)
                          │                                  │                   │
                          └──────────────┬───────────────────┴───────────────────┘
                                         ▼
                          24h window check → template or free-form
                                         ▼
                                  send via WhatsApp
                                         ▼
                        record delivery ─► update CRM ─► email alerts

Meta delivery receipts ─► status branch ─► alert email on failure
```

47 nodes. The three that are easy to miss:

- **Pick Send Mode** decides template vs free-form *before* spending a send.
- **Is Status Callback?** splits Meta's `statuses` payloads off the lead path,
  so a failed delivery is visible instead of being silently dropped.
- **Load Existing Lead** preserves the CRM row's `lead_id` so writes land on
  the same row that reads come from.

## The two things that silently break WhatsApp

**1. The 24-hour customer service window.** A free-form `type: text` message
only reaches someone who messaged the business number in the last 24 hours.
Outside that window Meta returns `200` with a real `wamid` and then discards
the message. First contact must be an approved template. `Pick Send Mode`
handles this; it treats an inbound message in the current run as an open
window, and otherwise measures against the last inbound in the transcript.

**2. `can_send_message` on the account.** A billing problem, an unverified
business, or a rejected display name can block business-initiated
conversations account-wide — again with a `200` on every send. Run:

```bash
node scripts/check-whatsapp-health.mjs
```

It prints Meta's own verdict per entity (phone number, WABA, business, app),
including error codes like `141006` (payment method) and the WABA id.

## Setup

1. **n8n**

   ```bash
   npm install -g n8n
   cp n8n.env.example n8n.env   # fill it in
   ./start-n8n.ps1              # loads n8n.env, allows $env in nodes
   ```

   `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` is required — the whole workflow reads
   its config through `$env` expressions, and without it every node fails with
   `access to env vars denied`.

2. **Import the workflow**

   ```bash
   n8n import:workflow --input=workflow/ascent-interiors-whatsapp.json
   n8n update:workflow --id=<id> --active=true
   n8n publish:workflow --id=<id>
   ```

   n8n 2.x versions workflows: an import creates a new version that is not live
   until `publish:workflow` runs, and n8n must be restarted afterwards.

3. **n8n credentials** — create these in the UI and point the workflow's nodes
   at them:

   | Type | Used by |
   |---|---|
   | HTTP Header Auth (`Authorization: Bearer <token>`) | both WhatsApp send nodes |
   | Google Service Account | Sheets CRM + Calendar |
   | SMTP | the three email nodes |
   | OpenAI (or Anthropic) | the chat model node |

4. **Expose the webhook.** Meta cannot reach `localhost`.

   ```bash
   cloudflared tunnel --url http://localhost:5678 --protocol http2
   ```

   `--protocol http2` matters on networks that block QUIC (UDP 7844), where the
   tunnel otherwise dies with *"socket operation was attempted to an
   unreachable network"*.

5. **Register the callback with Meta**

   ```bash
   node scripts/register-meta-callback.mjs
   ```

   This sets a WABA-level `override_callback_uri`, which is the one webhook
   setting that does not need the app secret. Re-run it after every tunnel
   restart — a quick tunnel gets a new hostname each time.

   You still have to tick the **`messages`** webhook field once in the app
   dashboard; that part is app-level and needs the console.

6. **Templates**

   ```bash
   node scripts/create-template.mjs        # submit for approval
   node scripts/check-template-status.mjs  # flips n8n.env when approved
   ```

## Meta Lead Ads

Lead ads need two things beyond the WhatsApp setup:

- a system-user token carrying **`leads_retrieval`** — the webhook only
  delivers a `leadgen_id`, and the name, phone and email come from a follow-up
  Graph call that this permission gates;
- the Facebook Page subscribed to the **`leadgen`** webhook field.

## Google Sheet

One tab named `Leads`, with these columns:

```
lead_id  name  phone  email  conversation_id  conversation_status
qualification_status  appointment_status  appointment_id
appointment_date  appointment_time  conversation_history
last_event_id  last_message_at  created_at  updated_at
```

`conversation_history` holds the transcript as a JSON string. Reads match on
`phone`, writes match on `lead_id` — keep both in sync or the assistant loses
its memory and starts repeating questions.

## Known limits

- **Concurrent messages race.** Two inbound messages inside the same processing
  window both read the same history and the later write wins, dropping one
  exchange. Sheets has no row locking; a real database or a per-lead queue is
  the fix.
- **Quick tunnel hostnames rotate.** Every restart needs
  `register-meta-callback.mjs` again. A named Cloudflare tunnel removes this.
- **Delivery is asynchronous.** A `2xx` from the send call means Meta queued
  the message, nothing more. Only the `statuses` webhook proves delivery, which
  is why `Record Delivery` records `whatsapp_accepted` rather than claiming
  delivery.

## Scripts

| Script | Purpose |
|---|---|
| `check-whatsapp-health.mjs` | Meta's own verdict on why sends do or don't land |
| `register-meta-callback.mjs` | point the WABA webhook at the current tunnel |
| `create-template.mjs` | submit the first-contact template for approval |
| `check-template-status.mjs` | switch `n8n.env` over once it is approved |

All four read the WhatsApp token from n8n's encrypted credential store rather
than from a file or an argument, so it is never written to disk in plaintext
and never appears in a command line.
