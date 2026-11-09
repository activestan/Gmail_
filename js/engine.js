/**
 * MailMorph — Clean Email Reduction Engine
 * Rules:
 *  1. Convert accented / special letters (e.g. ç → c, é → e, ñ → n, ọ → o) — never output accented chars.
 *  2. Remove all symbols (-, _, ., +, etc.) from the username — symbols never appear in outputs.
 *  3. Remove 1 character (letter or number) at a time from right to left until 2 characters remain,
 *     then move on to the next email.
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
   * Convert accented letters (e.g. ç -> c, é -> e, ọ -> o) and strip all symbols so only [a-zA-Z0-9] remain.
   */
  function cleanAndNormalizeLocal(str) {
    if (!str) return '';
    const composed = str.normalize ? str.normalize('NFC') : str;
    let out = '';

    for (const ch of composed) {
      if (SPECIAL_CHAR_MAP[ch]) {
        out += SPECIAL_CHAR_MAP[ch];
      } else if (ch.charCodeAt(0) > 127) {
        out += ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      } else {
        out += ch;
      }
    }

    // Strip any lingering diacritics and remove ALL symbols/non-alphanumeric characters
    return out
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '');
  }

  /**
   * Extract email addresses from free text, spreadsheets, PDFs, or Word documents.
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
   *  - Convert accented letters (ç -> c) and strip all symbols first (never included in outputs)
   *  - Remove 1 character at a time from right to left until 2 characters remain
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

    const cleanBase = cleanAndNormalizeLocal(rawLocal);
    if (!cleanBase) {
      return { source: trimmed, valid: false, variations: [] };
    }

    const variations = [];
    if (cleanBase.length <= MIN_CHARS) {
      variations.push({
        email: cleanBase + '@' + domain,
        local: cleanBase,
        domain: domain
      });
    } else {
      for (let len = cleanBase.length; len >= MIN_CHARS; len--) {
        const loc = cleanBase.slice(0, len);
        variations.push({
          email: loc + '@' + domain,
          local: loc,
          domain: domain
        });
      }
    }

    return {
      source: trimmed,
      valid: true,
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
    cleanAndNormalizeLocal: cleanAndNormalizeLocal,
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
