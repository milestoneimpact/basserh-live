// Passkeys (WebAuthn) with no library: the browser hands over the credential's public key (SPKI) at registration, and every sign in
// is a signature over authenticatorData || SHA-256(clientDataJSON), checked here with WebCrypto. ES256 and RS256.
// No attestation is asked for: what matters is that later signatures come from the same key.
const enc = new TextEncoder();
export const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const sha256 = async b => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
export const newChallenge = () => b64u(crypto.getRandomValues(new Uint8Array(32)));
// the browser's statement of what it signed: the right kind, our challenge, our own address
export function clientData(json, type, challenge, origin) {
  const c = JSON.parse(new TextDecoder().decode(json)); if (c.type !== type) throw new Error('نوع الطلب غير صحيح'); if (c.challenge !== challenge) throw new Error('انتهت صلاحية المحاولة'); if (c.origin !== origin) throw new Error('العنوان غير مطابق'); return c;
}
// an ECDSA signature arrives as DER (two integers); WebCrypto wants r and s, 32 bytes each
function derToRaw(der) { let o = 2; if (der[1] & 0x80) o += der[1] & 0x7f; const int = () => { o++; const len = der[o++]; let v = der.slice(o, o + len); o += len; while (v.length > 32 && v[0] === 0) v = v.slice(1); const out = new Uint8Array(32); out.set(v, 32 - v.length); return out; }; const r = int(), s = int(); const raw = new Uint8Array(64); raw.set(r); raw.set(s, 32); return raw; }
export async function verify({ spki, alg, authenticatorData, clientDataJSON, signature, rpId }) {
  const ad = authenticatorData, rp = await sha256(enc.encode(rpId)); for (let i = 0; i < 32; i++) if (ad[i] !== rp[i]) throw new Error('الموقع غير مطابق'); if (!(ad[32] & 1)) throw new Error('لم يُؤكَّد حضور المستخدم');
  const data = new Uint8Array(ad.length + 32); data.set(ad); data.set(await sha256(clientDataJSON), ad.length);
  if (alg === -7) { const k = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, derToRaw(signature), data); }
  if (alg === -257) { const k = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']); return crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, signature, data); }
  throw new Error('خوارزمية المفتاح غير مدعومة');
}
