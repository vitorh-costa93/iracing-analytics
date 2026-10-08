// Administrator-only bootstrap. The agent receives only a scoped token, never the service role.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const [driverId, customer, output] = process.argv.slice(2);
if (!/^[a-f0-9-]{36}$/.test(driverId??'') || !/^\d+$/.test(customer??'') || !output || !Number.isSafeInteger(Number(customer)) || Number(customer)<1) throw new Error('Uso: node scripts/provision-agent.mjs DRIVER_UUID CUSTOMER_ID TOKEN_FILE');
for (const line of (await fs.readFile('.env.local','utf8')).split(/\r?\n/)) {
 const match=line.match(/^([^#=]+)=(.*)$/);if(match)process.env[match[1].trim()]??=match[2].trim().replace(/^["']|["']$/g,'');
}
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
if(url!=='https://lwmochpoeltioebqhwwv.supabase.co')throw new Error('Projeto de destino inesperado');
const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const token=randomBytes(32).toString('base64url'), tokenHash=createHash('sha256').update(token).digest('hex');
const target=path.resolve(output);await fs.mkdir(path.dirname(target),{recursive:true});
await fs.writeFile(target,token,{flag:'wx',mode:0o600});
const {data,error}=await db.from('agent_devices').insert({driver_id:driverId,customer_id:Number(customer),token_hash:tokenHash}).select('id').single();
if(error){await fs.unlink(target);throw new Error('Falha na criação da credencial');}
console.log(`Credencial revogável criada: ${data.id}. Importe o arquivo no agente e apague-o imediatamente.`);
