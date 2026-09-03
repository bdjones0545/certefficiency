const CERTIFICATION_PATTERNS: Array<[code: string, pattern: RegExp]> = [
  ["NSCA-CSCS", /\b(?:nsca[\s-]*)?cscs\b/i],
  ["NASM-CPT", /\bnasm[\s-]*cpt\b/i],
  ["ACSM-EP", /\bacsm[\s-]*(?:ep|certified exercise physiologist)\b/i],
  ["ACSM-CPT", /\bacsm[\s-]*cpt\b/i],
  ["ACE-CPT", /\bace[\s-]*cpt\b/i],
  ["PMP", /\b(?:pmi[\s-]*)?pmp\b/i],
  ["COMPTIA-SEC+", /\b(?:comptia[\s-]*)?(?:security\+|sec\+)(?!\w)/i],
  ["AWS-SAA-C03", /\b(?:aws[\s-]*)?(?:saa[\s-]*c03|solutions architect associate)\b/i],
  ["CISSP", /\bcissp\b/i],
  ["AZ-104", /\baz[\s-]*104\b/i],
];

export function detectCertificationCode(text: string): string | null {
  for (const [code, pattern] of CERTIFICATION_PATTERNS) {
    if (pattern.test(text)) return code;
  }
  return null;
}
