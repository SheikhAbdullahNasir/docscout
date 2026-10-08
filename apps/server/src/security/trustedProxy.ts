import { isIP } from 'node:net';

/** Parse explicit server-side proxy addresses. An unset value leaves Express proxy trust disabled. */
export function parseTrustedProxySetting(setting: string | undefined): false | string[] {
  if (setting === undefined || setting.trim() === '') return false;

  const entries = setting.split(',').map((entry) => entry.trim());
  if (entries.some((entry) => entry.length === 0)) {
    throw new Error('TRUSTED_PROXY must contain explicit IP addresses or CIDRs.');
  }

  for (const entry of entries) {
    const parts = entry.split('/');
    if (parts.length > 2) throw new Error('TRUSTED_PROXY must contain explicit IP addresses or CIDRs.');
    const family = isIP(parts[0]);
    if (family === 0) throw new Error('TRUSTED_PROXY must contain explicit IP addresses or CIDRs.');
    if (parts.length === 2) {
      const prefixText = parts[1];
      if (!/^\d+$/u.test(prefixText)) throw new Error('TRUSTED_PROXY must contain explicit IP addresses or CIDRs.');
      const prefix = Number(prefixText);
      const maximum = family === 4 ? 32 : 128;
      // Prefix zero trusts every possible address and defeats deliberate proxy selection.
      if (!Number.isInteger(prefix) || prefix < 1 || prefix > maximum) {
        throw new Error('TRUSTED_PROXY cannot trust all addresses or an invalid CIDR.');
      }
    }
  }

  return entries;
}
