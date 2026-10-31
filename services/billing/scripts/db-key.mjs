// Makes billing's database key (supabase/migrations/*_billing_key.sql). The key goes in billing.env;
// the SQL, which holds only its SHA-256, goes in Supabase's SQL editor. Running it again replaces the key.

import { createHash, randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(key).digest("hex");

console.log(`In billing.env:

BILLING_DB_KEY=${key}

In Supabase's SQL editor:

insert into private.service_keys (name, hash) values ('billing', decode('${hash}', 'hex'))
  on conflict (name) do update set hash = excluded.hash;`);
