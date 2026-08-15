import crypto from 'node:crypto';
export const PENDING='ir_pending'; export const SESSION='ir_session';
function key(){const s=process.env.SESSION_SECRET;if(!s||s.length<32)throw new Error('SESSION_SECRET must have 32+ chars');return crypto.createHash('sha256').update(s).digest();}
export function random(){return crypto.randomBytes(32).toString('base64url')}
export function challenge(v:string){return crypto.createHash('sha256').update(v).digest('base64url')}
export function seal(v:unknown){const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key(),iv);const x=Buffer.concat([c.update(JSON.stringify(v)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),x]).toString('base64url')}
export function open<T>(v:string){const b=Buffer.from(v,'base64url');const d=crypto.createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString()) as T}
