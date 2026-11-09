/**
 * MailMorph — Character-by-Character Email Reduction Engine
 * Rules:
 *  1. Convert accented / special letters first (e.g. ç → c, é → e, ñ → n, ọ → o).
 *  2. If the email contains '-' or '_', remove '-' and '_' first (one at a time from right to left).
 *  3. Then remove remaining characters one after the other from right to left until 2 characters remain,
 *     and move on to the next email.
 */
(function (root) {
  'use strict';

  const Lexicon = root.MailMorphLexicon || (typeof require === 'function' ? require('./lexicon.js') : {
    DOMAIN_TYPO_MAP: {}
  });

  const MIN_CHARS = 2; // Reduce until 2 characters remain

  // Non-NFD character folding map (European, Turkish, Nordic, Nigerian/African hooked letters)
  const SPECIAL_CHAR_MAP = {
    'ß': 'ss', 'ẞ': 'SS',
    'æ': 'ae', 'Æ': 'AE',
    'œ': 'oe', 'Œ': 'OE',
    'ø': 'o',  'Ø': 'O',
    'ł': 'l',  'Ł': 'L',
    'đ': 'd',  'Đ': 'D',
    'ð': 'd',  'Ð': 'D',
    'þ': 'th', 'Þ': 'Th',
    'ı': 'i',  'İ': 'I',
    'ɓ': 'b',  'Ɓ': 'B',
    'ɗ': 'd',  'Ɗ': 'D',
    'ƙ': 'k',  'Ƙ': 'K',
    'ƴ': 'y',  'Ƴ': 'Y',
    'ŋ': 'ng', 'Ŋ': 'Ng',
    'ƒ': 'f',  'Ƒ': 'F'
  };

  /**
   * Fold accented letters (e.g. ç -> c, é -> e, ọ -> o) while leaving all ASCII letters, numbers, and symbols untouched.
   */
  function normalizeAccents(str) {
    if (!str) return { normalized: '', replacements: [] };
    const composed = str.normalize ? str.normalize('NFC') : str;
    const replacements = [];
    const seen = new Set();
    let out = '';

    for (const ch of composed) {
      let mapped = ch;
      if (SPECIAL_CHAR_MAP[ch]) {
        mapped = SPECIAL_CHAR_MAP[ch];
      } else if (ch.charCodeAt(0) > 127) {
        mapped = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      }

      if (mapped !== ch && /^[a-zA-Z]+$/.test(mapped)) {
        const tag = ch + ' → ' + mapped;
        if (!seen.has(tag)) {
          seen.add(tag);
          replacements.push(tag);
        }
      }
      out += mapped;
    }

    out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return { normalized: out, replacements: replacements };
  }

  /**
   * Extract email addresses from free text, spreadsheets, PDFs, or Word documents.
   * Preserves symbols (_, -, ., +, etc.) in the local-part intact.
   */
  function extractEmailsFromText(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];

    let text = rawText;
    text = text.replace(/\[([^\]]*)\]\(\s*mailto:([^)\s?]+)[^)]*\)/gi, ' $1 $2 ');
    text = text.replace(/mailto:([^\s?"'<>)\]]+)(\?[^\s"'<>)\]]*)?/gi, ' $1 ');
    text = text.replace(/([\p{L}\p{M}\p{N}._%+\-!#$&'*+/=?^`{|}~]+@)\r?\n\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,24})/gu, '$1$2');

    const emailRegex = /[\p{L}\p{M}\p{N}_%+\-.!#$&'*+/=?^`{|}~]{1,64}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/gu;
    const matches = text.match(emailRegex) || [];

    const results = [];
    const seen = new Set();

    for (let raw of matches) {
      raw = raw.replace(/[.,;:!?]+$/g, '').trim();
      const atIdx = raw.lastIndexOf('@');
      if (atIdx <= 0) continue;

      const local = raw.slice(0, atIdx);
      const domain = raw.slice(atIdx + 1).toLowerCase();

      const parts = domain.split('.');
      const tld = parts[parts.length - 1];
      if (!tld || !/^[a-z]{2,24}$/.test(tld)) continue;
      if (/^(png|jpg|jpeg|gif|svg|webp|pdf|css|js|woff|woff2|ttf)$/i.test(tld)) continue;

      const key = local.normalize('NFC').toLowerCase() + '@' + domain;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(local + '@' + domain);
      }
    }

    return results;
  }

  /**
   * Generate email variations:
   *  - Normalize accented letters (ç -> c) first
   *  - Remove '-' and '_' first before removing letters/numbers
   *  - Remove remaining characters one after the other down to 2 characters
   */
  function generateVariationsForEmail(inputEmail) {
    const trimmed = (inputEmail || '').trim();
    const atIdx = trimmed.lastIndexOf('@');
    if (atIdx <= 0) {
      return { source: trimmed, valid: false, variations: [] };
    }

    const rawLocal = trimmed.slice(0, atIdx);
    let domain = trimmed.slice(atIdx + 1).toLowerCase().trim();
    if (Lexicon.DOMAIN_TYPO_MAP && Lexicon.DOMAIN_TYPO_MAP[domain]) {
      domain = Lexicon.DOMAIN_TYPO_MAP[domain];
    }

    const accentRes = normalizeAccents(rawLocal);
    const currentChars = Array.from(accentRes.normalized.replace(/\s+/g, ''));

    if (currentChars.length === 0) {
      return { source: trimmed, valid: false, variations: [] };
    }

    const variations = [];
    const seenLocals = new Set();

    function pushLocal(charsArr) {
      const loc = charsArr.join('');
      if (!loc) return;
      const key = loc.toLowerCase();
      if (!seenLocals.has(key)) {
        seenLocals.add(key);
        variations.push({
          email: loc + '@' + domain,
          local: loc,
          domain: domain
        });
      }
    }

    // Emit initial (accent-normalized) email
    pushLocal(currentChars);

    // Step 1: Remove '-' and '_' first (one at a time from right to left) while length > MIN_CHARS
    while (currentChars.length > MIN_CHARS) {
      let symIdx = -1;
      for (let i = currentChars.length - 1; i >= 0; i--) {
        if (currentChars[i] === '-' || currentChars[i] === '_') {
          symIdx = i;
          break;
        }
      }
      if (symIdx === -1) break;
      currentChars.splice(symIdx, 1);
      pushLocal(currentChars);
    }

    // Step 2: Remove remaining characters one after the other from right to left until 2 characters remain
    if (currentChars.length > MIN_CHARS) {
      for (let len = currentChars.length - 1; len >= MIN_CHARS; len--) {
        pushLocal(currentChars.slice(0, len));
      }
    }

    return {
      source: trimmed,
      valid: true,
      accentReplacements: accentRes.replacements,
      variations: variations
    };
  }

  /**
   * Process a batch of emails sequentially: finish all reductions for email #1, then move to email #2, etc.
   */
  function processEmailBatch(emails) {
    const results = [];
    const uniqueEmails = [];
    const flatRows = [];
    const globalSeen = new Set();

    for (const rawEmail of emails) {
      const res = generateVariationsForEmail(rawEmail);
      if (!res.valid) continue;
      results.push(res);

      for (const v of res.variations) {
        const key = v.email.toLowerCase();
        if (!globalSeen.has(key)) {
          globalSeen.add(key);
          uniqueEmails.push(v.email);
          flatRows.push({
            source: res.source,
            email: v.email
          });
        }
      }
    }

    return {
      sourceCount: results.length,
      totalUniqueVariations: uniqueEmails.length,
      results: results,
      uniqueEmails: uniqueEmails,
      flatRows: flatRows
    };
  }

  /**
   * Format output according to selected format.
   */
  function formatBatchOutput(batchResult, formatType) {
    const list = batchResult.uniqueEmails || [];
    switch (formatType) {
      case 'bcc_comma':
        return list.join(', ');
      case 'bcc_semicolon':
        return list.join('; ');
      case 'newline':
        return list.join('\n');
      case 'csv': {
        const lines = ['source_email,generated_email'];
        (batchResult.flatRows || []).forEach(function (r) {
          const esc = function (s) {
            const str = String(s == null ? '' : s);
            return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
          };
          lines.push(esc(r.source) + ',' + esc(r.email));
        });
        return lines.join('\n');
      }
      default:
        return list.join(', ');
    }
  }

  function chunkForBcc(uniqueEmails, batchSize, separator) {
    const sep = separator || ', ';
    const size = Math.max(1, parseInt(batchSize, 10) || 100);
    const chunks = [];
    for (let i = 0; i < uniqueEmails.length; i += size) {
      const slice = uniqueEmails.slice(i, i + size);
      chunks.push({
        index: chunks.length + 1,
        count: slice.length,
        emails: slice,
        formatted: slice.join(sep)
      });
    }
    return chunks;
  }

  const api = {
    MIN_CHARS: MIN_CHARS,
    normalizeAccents: normalizeAccents,
    extractEmailsFromText: extractEmailsFromText,
    generateVariationsForEmail: generateVariationsForEmail,
    processEmailBatch: processEmailBatch,
    formatBatchOutput: formatBatchOutput,
    chunkForBcc: chunkForBcc
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.MailMorphEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
