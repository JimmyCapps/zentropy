import type { ProbeResult } from '@/types/verdict.js';

const EXFILTRATION_PATTERNS = [
  /https?:\/\/[^\s]+\.(php|aspx?|cgi)\b/gi,
  /\b(webhook|callback|endpoint|receiver)\s*[:=]\s*["']?https?/i,
  /\bfetch\s*\(\s*["']https?/i,
  /\bnew\s+XMLHttpRequest/i,
  /\b(navigator\.sendBeacon|window\.open)\s*\(/i,
  /\b(send|post|transmit|forward|leak|exfiltrate)\s+(the\s+)?(data|info|content|response|system|prompt|key)/i,
  /\b(base64|btoa|atob|encode|encrypt)\s*\(/i,
  /\bdocument\.cookie\b/i,
  /\blocalStorage\.(get|set)Item/i,
];

const WEBHOOK_DOMAINS = [
  /webhook\.site/i,
  /requestbin/i,
  /pipedream/i,
  /hookbin/i,
  /beeceptor/i,
  /ngrok\.io/i,
  /burpcollaborator/i,
  /interact\.sh/i,
  /oastify\.com/i,
];

export function detectExfiltration(probeResults: readonly ProbeResult[]): boolean {
  for (const result of probeResults) {
    if (
      result.flags.includes('exfiltration_language') ||
      result.flags.includes('credential_reference')
    ) {
      return true;
    }

    if (result.rawOutput.length === 0) continue;

    for (const pattern of EXFILTRATION_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      if (regex.test(result.rawOutput)) {
        return true;
      }
    }

    for (const domain of WEBHOOK_DOMAINS) {
      if (domain.test(result.rawOutput)) {
        return true;
      }
    }
  }

  return false;
}
