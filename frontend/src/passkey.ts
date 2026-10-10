import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser'
import { api, ApiError, type AuthMe } from './api'
import type { Translate } from './i18n'

/** Pilot mode's digital key: the phone's own passkey (fingerprint, face or phone PIN). No password, no SMS. */
export const keysSupported = () => browserSupportsWebAuthn()

/** Make a key on this phone for whoever is signed in; returns how many keys they now have. */
export async function makeKey(): Promise<number> {
  const { challenge_id, options } = await api.passkeyOptions()
  const credential = await startRegistration({ optionsJSON: options })
  return (await api.addPasskey(challenge_id, credential)).passkeys
}

/** Sign in with any Keynection key this phone holds: no user name to type. */
export async function signInWithKey(): Promise<AuthMe> {
  const { challenge_id, options } = await api.signinOptions()
  const credential = await startAuthentication({ optionsJSON: options })
  return api.signin(challenge_id, credential)
}

const REASONS = ['code_used', 'too_slow', 'key_unknown', 'key_retry']

/** Why a key or a code was refused, in the reader's language when the server said why. */
export function problem(e: unknown, t: Translate): string {
  if (e instanceof ApiError && e.code && REASONS.includes(e.code)) return t(`si.err.${e.code}`)
  return e instanceof Error ? e.message : t('si.failed')
}

/** True when the person simply closed the phone's prompt: say nothing alarming. */
export function cancelled(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  if (e instanceof WebAuthnError && e.code === 'ERROR_CEREMONY_ABORTED') return true
  return [e.name, e.cause instanceof Error ? e.cause.name : ''].some((n) => n === 'NotAllowedError' || n === 'AbortError')
}
