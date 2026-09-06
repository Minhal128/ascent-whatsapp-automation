// Submits the real first-contact template to Meta for approval.
// No variables on purpose: the send node posts name + language only, so a
// parameterless body needs no workflow change. Add {{1}} for the lead's name
// later if the extra node edit is worth it.
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

const env = {};
for (const line of readFileSync('n8n.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const WABA = env.WHATSAPP_WABA_ID;
const G = 'https://graph.facebook.com/v21.0';

const template = {
  name: 'ascent_lead_welcome',
  language: 'en',
  category: 'MARKETING',
  components: [
    {
      type: 'BODY',
      text: 'Thank you for your enquiry with Ascent Interiors. We design and execute residential and commercial interiors in Kolkata - full home interiors, modular kitchens, wardrobes, renovation and restoration.\n\nReply here and tell us about your property, and we can arrange a consultation or a site visit at a time that suits you.',
    },
    { type: 'FOOTER', text: 'Ascent Interiors, Dhakuria, Kolkata' },
  ],
};

const r = await fetch(`${G}/${WABA}/message_templates`, {
  method: 'POST',
  headers: { [cred.name]: cred.value, 'Content-Type': 'application/json' },
  body: JSON.stringify(template),
});
console.log('POST message_templates ->', r.status);
console.log(JSON.stringify(await r.json().catch(() => ({})), null, 2));

const list = await fetch(`${G}/${WABA}/message_templates?fields=name,status,category,language`, { headers: { [cred.name]: cred.value } });
console.log('\ntemplates now:');
console.log(JSON.stringify((await list.json()).data, null, 2));
