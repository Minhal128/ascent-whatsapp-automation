// Re-registers the WhatsApp webhook callback with Meta using the token that
// already lives in n8n's encrypted credential store. Run this after any tunnel
// restart, because a quick tunnel gets a fresh hostname every time.
import { createDecipheriv, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const n8nDir = join(homedir(), '.n8n');
const ek = JSON.parse(readFileSync(join(n8nDir, 'config'), 'utf8')).encryptionKey;
function kiv(salt) {
  const pw = Buffer.concat([Buffer.from(ek, 'binary'), salt]);
  const h = []; let d = pw;
  for (let i = 0; i < 3; i++) { h[i] = createHash('md5').update(d).digest(); d = Buffer.concat([h[i], pw]); }
  const k = Buffer.concat(h); return [k.subarray(0, 32), k.subarray(32, 48)];
}
function decrypt(b64) {
  const i = Buffer.from(b64, 'base64');
  const [k, iv] = kiv(i.subarray(8, 16));
  const c = createDecipheriv('aes-256-cbc', k, iv);
  return c.update(i.subarray(16), undefined, 'utf8') + c.final('utf8');
}
const db = new DatabaseSync(join(n8nDir, 'database.sqlite'), { readOnly: true });
const cred = JSON.parse(decrypt(db.prepare("select data from credentials_entity where id='bbWhatsAppCloud1'").get().data));
const H = { [cred.name]: cred.value };

const env = {};
for (const line of readFileSync('n8n.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const WABA = env.WHATSAPP_WABA_ID;
const CALLBACK = `${env.N8N_PUBLIC_WEBHOOK_BASE}/webhook/meta-leads`;
const G = 'https://graph.facebook.com/v21.0';
console.log('WABA:', WABA);
console.log('callback:', CALLBACK);

const r = await fetch(`${G}/${WABA}/subscribed_apps`, {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ override_callback_uri: CALLBACK, verify_token: env.META_VERIFY_TOKEN }),
});
console.log('\nPOST subscribed_apps ->', r.status);
console.log(JSON.stringify(await r.json().catch(() => ({})), null, 2));

const c = await fetch(`${G}/${WABA}/subscribed_apps`, { headers: H });
console.log('\nGET subscribed_apps ->', c.status);
console.log(JSON.stringify(await c.json().catch(() => ({})), null, 2));
