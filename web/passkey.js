// Passkeys in the browser: add one to the signed in account, or sign in with one the device holds for this site.
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const post = async (p, body) => { const r = await fetch('/api/passkey/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }), j = await r.json(); if (!r.ok) throw new Error(j.error || 'تعذّر الطلب'); return j; };
export const supported = () => !!(window.PublicKeyCredential && navigator.credentials);
export async function register(label) {
  const o = await post('register/start');
  const c = await navigator.credentials.create({ publicKey: { challenge: unb64u(o.challenge), rp: o.rp, user: { ...o.user, id: unb64u(o.user.id) }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }, attestation: 'none', timeout: 120000 } });
  const r = c.response; await post('register/finish', { id: c.id, clientDataJSON: b64u(r.clientDataJSON), publicKey: b64u(r.getPublicKey()), alg: r.getPublicKeyAlgorithm(), label: label || navigator.platform || '' });
}
export async function login() {
  const o = await post('login/start'), c = await navigator.credentials.get({ publicKey: { challenge: unb64u(o.challenge), userVerification: 'preferred', timeout: 120000 } }), r = c.response;
  return post('login/finish', { id: c.id, clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature) });
}
