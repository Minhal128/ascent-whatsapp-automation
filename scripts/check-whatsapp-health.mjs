// Asks Meta directly why sends are not landing. health_status is the endpoint
// built for exactly this and it also reveals the WABA id. Token stays in-process.
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
function dec(b64) {
  const i = Buffer.from(b64, 'base64');
  const [k, v] = kiv(i.subarray(8, 16));
  const c = createDecipheriv('aes-256-cbc', k, v);
  return c.update(i.subarray(16), undefined, 'utf8') + c.final('utf8');
}
const db = new DatabaseSync(join(n8nDir, 'database.sqlite'), { readOnly: true });
const cred = JSON.parse(dec(db.prepare("select data from credentials_entity where id='bbWhatsAppCloud1'").get().data));
const H = { [cred.name]: cred.value };

const env = {};
for (const line of readFileSync('n8n.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const PNID = env.WHATSAPP_PHONE_NUMBER_ID;
const G = 'https://graph.facebook.com/v21.0';

async function get(label, url) {
  const r = await fetch(url, { headers: H });
  const b = await r.json().catch(() => ({}));
  console.log(`\n### ${label} -> HTTP ${r.status}`);
  console.log(JSON.stringify(b, null, 2).slice(0, 4000));
  return b;
}

const h = await get('health_status', `${G}/${PNID}?fields=health_status`);
await get('phone status fields', `${G}/${PNID}?fields=id,status,throughput,messaging_limit_tier,quality_rating,name_status,new_name_status,account_mode,is_pin_enabled,search_visibility`);

// health_status lists every entity in the chain, WABA included.
const ents = h?.health_status?.entities ?? [];
const waba = ents.find((e) => e.entity_type === 'WABA')?.id;
console.log('\nWABA id from health_status:', waba ?? '(not present)');
if (waba) {
  await get('WABA', `${G}/${waba}?fields=id,name,account_review_status,business_verification_status,message_template_namespace,timezone_id`);
  await get('templates', `${G}/${waba}/message_templates?fields=name,status,category,language&limit=50`);
  await get('subscribed_apps', `${G}/${waba}/subscribed_apps`);
}
