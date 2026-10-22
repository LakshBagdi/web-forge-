/** Turns a technical step error into a plain sentence plus what to do about it. */
export function explainError(raw: string | undefined | null): { what: string; fix: string } | null {
  if (!raw) return null;
  const m = String(raw);
  const has = (re: RegExp) => re.test(m);
  const code = m.match(/HTTP (\d{3})/)?.[1];
  if (has(/Blocked target|resolves to blocked address|Blocked protocol|Invalid URL/i))
    return { what: 'FlowForge refused to call that address.', fix: 'For safety it only calls public web addresses (https://…). Check the URL for typos and that it does not point at your own computer.' };
  if (has(/DNS resolution failed|ENOTFOUND|No addresses for/i))
    return { what: 'That web address does not exist.', fix: 'Check the URL for spelling mistakes (copy it again from the service).' };
  if (has(/ECONNREFUSED|ECONNRESET|socket hang up|fetch failed/i))
    return { what: 'Nothing answered at that address.', fix: 'The service may be down or the address wrong. Try again in a minute, or check the URL.' };
  if (has(/Timed out|timeout/i))
    return { what: 'The step took too long and was stopped.', fix: 'Try again, or raise “Timeout” under Reliability on that step. Add “Max attempts” 3 to retry automatically.' };
  if (has(/OAuth token refresh failed/i))
    return { what: 'Logging in to the service failed (the saved token was refused).', fix: 'Open Credentials and re-enter the client id, client secret and refresh token. A refresh token can only be used once on some services — get a fresh one.' };
  if (has(/Referenced credential not found/i))
    return { what: 'The saved login chosen on this step no longer exists.', fix: 'Pick an Authentication option again on the step (or create it on the Credentials page).' };
  if (has(/Watch value is empty/i))
    return { what: 'The value to watch was empty.', fix: 'The earlier step returned nothing at that spot. Run it, open the step, and copy the right chip from “Data from earlier steps”.' };
  if (code === '401') return { what: 'The service did not accept your login or key (401).', fix: 'Check the API key / credential on this step. Keys expire or get mistyped — create a new one if unsure.' };
  if (code === '403') return { what: 'The service says you are not allowed to do this (403).', fix: 'Your key/app is missing permission. For X: set permissions to Read and write and re-create the token. For Google: enable the Calendar API and re-authorize.' };
  if (code === '404') return { what: 'The service says that address does not exist (404).', fix: 'Check the URL for typos. If it is a Discord or Slack link, the webhook was probably deleted — create a new one and paste its URL.' };
  if (code === '400' || code === '422') return { what: `The service did not understand what was sent (${code}).`, fix: 'Check the message or fields on this step, and that required values are filled in. Open the step’s Output/log to see what the service said.' };
  if (code === '429') return { what: 'Too many requests — the service asked you to slow down (429).', fix: 'Run less often (use a longer schedule) or raise “Backoff” and “Max attempts” under Reliability.' };
  if (code && code.startsWith('5')) return { what: `The other service had a problem (${code}).`, fix: 'It is not your mistake. Press ↻ Retry from failed in a minute, or set “Max attempts” to 3 on the step.' };
  if (has(/Cancelled/i)) return { what: 'You stopped this run.', fix: 'Press Run again whenever you are ready.' };
  return null;
}
