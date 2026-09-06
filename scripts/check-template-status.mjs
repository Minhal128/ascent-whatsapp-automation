// Checks whether ascent_lead_welcome is approved yet and, once it is, points
// n8n.env at it instead of hello_world. Prints one of:
//   PENDING | REJECTED | APPROVED_UPDATED | ALREADY_ACTIVE
// APPROVED_UPDATED means n8n still has to be restarted to pick up the new env.
import { createDecipheriv, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TEMPLATE = 'ascent_lead_welcome';
const LANG = 'en';

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

const envText = readFileSync('n8n.env', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

if (env.WHATSAPP_TEMPLATE_NAME === TEMPLATE) {
  console.log('ALREADY_ACTIVE');
  process.exit(0);
}

const r = await fetch(
  `https://graph.facebook.com/v21.0/${env.WHATSAPP_WABA_ID}/message_templates?fields=name,status,language`,
  { headers: { [cred.name]: cred.value } },
);
const body = await r.json();
const t = (body.data ?? []).find((x) => x.name === TEMPLATE);
if (!t) { console.log('PENDING (not listed)'); process.exit(0); }
if (t.status !== 'APPROVED') { console.log(t.status); process.exit(0); }

const set = { WHATSAPP_TEMPLATE_NAME: TEMPLATE, WHATSAPP_TEMPLATE_LANG: LANG };
const out = envText.split(/\r?\n/).map((l) => {
  const s = l.trim(); if (!s || s.startsWith('#')) return l;
  const i = s.indexOf('='); if (i < 1) return l;
  const k = s.slice(0, i).trim();
  return k in set ? `${k}=${set[k]}` : l;
});
writeFileSync('n8n.env', out.join('\n'));
console.log('APPROVED_UPDATED');
