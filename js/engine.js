/**
 * MailMorph — Clean Right-to-Left Email Reduction Engine
 * Rules:
 *  1. Normalize accented / special letters first (e.g. ç → c, é → e, ọ → o).
 *  2. Remove one letter, number, or symbol at a time from right to left until 3 letters remain, then move to the next email.
 *  3. Keep total generations per email strictly under 10 (max 9 per source email).
 */
(function (root) {
  'use strict';

  const Lexicon = root.MailMorphLexicon || (typeof require === 'function' ? require('./lexicon.js') : {
    GIVEN_NAMES: new Set(),
    WHOLE_NAMES: new Set(),
    DOMAIN_TYPO_MAP: {}
  });

  const MAX_PER_EMAIL = 9; // Strictly < 10 ("shouldn't be up to 10")
  const MIN_LETTERS = 3;   // Stop once reduced down to 3 letters

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

  const ONSET_CLUSTERS = new Set([
    'ch','sh','th','ph','gh','wh','kw','gw','nw','ny','kp','gb','ng',
    'st','sp','sk','sc','sm','sn','sw','sl','tr','pr','br','cr','dr','fr','gr',
    'pl','bl','cl','gl','fl','kl','tw','dw','qu'
  ]);

  /**
   * Fold accented letters like ç -> c, é -> e, ọ -> o while preserving valid ASCII email characters.
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
   */
  function extractEmailsFromText(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];

    let text = rawText;
    text = text.replace(/\[([^\]]*)\]\(\s*mailto:([^)\s?]+)[^)]*\)/gi, ' $1 $2 ');
    text = text.replace(/mailto:([^\s?"'<>)\]]+)(\?[^\s"'<>)\]]*)?/gi, ' $1 ');
    text = text.replace(/([\p{L}\p{M}\p{N}._%+-]+@)\r?\n\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,24})/gu, '$1$2');

    const emailRegex = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}._%+'’-]{0,63}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/gu;
    const matches = text.match(emailRegex) || [];

    const results = [];
    const seen = new Set();

    for (let raw of matches) {
      raw = raw.replace(/^[.'’-]+|[.,;:!?'’-]+$/g, '').trim();
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
   * Identify natural syllable & word boundaries (used only to pick the cleanest milestones when a long email > 9 steps).
   */
  function findNaturalMilestoneLengths(cleanStr) {
    const milestones = new Set();
    // Boundary where trailing numbers end (e.g. "Odimegwustanley2004" -> length of "Odimegwustanley")
    const alphaPrefix = cleanStr.replace(/\d+$/, '');
    if (alphaPrefix.length >= MIN_LETTERS && alphaPrefix.length < cleanStr.length) {
      milestones.add(alphaPrefix.length);
    }

    // Compound name split point if recognizable (e.g. "odimegwu" + "stanley" -> length 8)
    const lowerAlpha = alphaPrefix.toLowerCase().replace(/[^a-z]/g, '');
    if (lowerAlpha.length >= 7 && !Lexicon.WHOLE_NAMES.has(lowerAlpha) && !Lexicon.GIVEN_NAMES.has(lowerAlpha)) {
      for (let i = 4; i <= lowerAlpha.length - 4; i++) {
        const left = lowerAlpha.slice(0, i);
        const right = lowerAlpha.slice(i);
        if (Lexicon.GIVEN_NAMES.has(left) || Lexicon.GIVEN_NAMES.has(right)) {
          milestones.add(i);
        }
      }
    }

    // Syllable boundaries on alphabetic part
    let i = 0;
    const nuclei = [];
    while (i < lowerAlpha.length) {
      const isV = 'aeiou'.indexOf(lowerAlpha[i]) !== -1 || (lowerAlpha[i] === 'y' && i > 0);
      if (isV) {
        let end = i;
        while (end + 1 < lowerAlpha.length && 'aeiouy'.indexOf(lowerAlpha[end + 1]) !== -1) {
          if (/^(ee|oo|ea|ou|oi|oy|ai|ay|ei|ey|oa|au|aw|eu|ew)$/.test(lowerAlpha.slice(end, end + 2))) end++;
          else break;
        }
        nuclei.push([i, end]);
        i = end + 1;
      } else {
        i++;
      }
    }
    for (let k = 0; k < nuclei.length - 1; k++) {
      const cStart = nuclei[k][1] + 1;
      const cEnd = nuclei[k + 1][0];
      const cLen = cEnd - cStart;
      if (cLen === 0) milestones.add(cEnd);
      else if (cLen === 1) milestones.add(cStart);
      else if (cLen === 2) milestones.add(ONSET_CLUSTERS.has(lowerAlpha.slice(cStart, cEnd)) ? cStart : cStart + 1);
      else milestones.add(ONSET_CLUSTERS.has(lowerAlpha.slice(cEnd - 2, cEnd)) ? cEnd - 2 : cEnd - 1);
    }

    return milestones;
  }

  /**
   * Sanitize a sliced prefix so it never starts/ends with dangling symbols (., _, -) and count its letters/alphanumerics.
   */
  function cleanSlicedLocal(rawSlice, isGmail) {
    let s = rawSlice;
    // Remove disallowed characters while preserving original casing
    if (isGmail) {
      // Gmail only permits letters, digits, and single internal dots
      s = s.replace(/[^a-zA-Z0-9.]/g, '').replace(/\.{2,}/g, '.');
    } else {
      s = s.replace(/[^a-zA-Z0-9._\-]/g, '').replace(/\.{2,}/g, '.');
    }
    // Strip leading or trailing symbols so slicing "john_doe" -> "john_" lands cleanly on "john"
    s = s.replace(/^[._\-]+|[._\-]+$/g, '');
    return s;
  }

  function countAlphanumeric(str) {
    return (str.replace(/[^a-zA-Z0-9]/g, '')).length;
  }

  /**
   * Generate right-to-left 1-character-at-a-time reductions down to 3 letters, capped strictly under 10 (max 9).
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

    const isGmail = domain === 'gmail.com' || domain === 'googlemail.com';

    // 1. Fold accented letters (e.g. ç -> c) first
    const accentRes = normalizeAccents(rawLocal);
    const baseLocal = cleanSlicedLocal(accentRes.normalized, isGmail);

    if (!baseLocal) {
      return { source: trimmed, valid: false, variations: [] };
    }

    // 2. Remove 1 letter, number, or symbol at a time from right to left until 3 characters remain
    const allSteps = [];
    const seenLower = new Set();

    for (let len = baseLocal.length; len >= 1; len--) {
      const sliced = cleanSlicedLocal(baseLocal.slice(0, len), isGmail);
      if (!sliced) continue;

      const alphaNumLen = countAlphanumeric(sliced);
      if (alphaNumLen < MIN_LETTERS && baseLocal.length >= MIN_LETTERS) {
        break;
      }

      const key = sliced.toLowerCase();
      if (!seenLower.has(key)) {
        seenLower.add(key);
        allSteps.push(sliced);
      }

      if (alphaNumLen === MIN_LETTERS) {
        break;
      }
    }

    // Fallback if input itself was already <= 3 characters
    if (allSteps.length === 0) {
      allSteps.push(baseLocal);
    }

    // 3. Enforce "< 10 per email" cap (MAX_PER_EMAIL = 9)
    let selectedLocals = allSteps;
    if (allSteps.length > MAX_PER_EMAIL) {
      const milestones = findNaturalMilestoneLengths(baseLocal);
      const chosenIndices = new Set();

      // Always keep first 3 immediate 1-by-1 reductions (e.g. ...2004, ...200, ...20) and the final 3-letter stop
      chosenIndices.add(0);
      chosenIndices.add(1);
      chosenIndices.add(2);
      chosenIndices.add(allSteps.length - 1);

      // Fill remaining 5 slots evenly across [3 .. allSteps.length - 2], snapping to nearby natural milestones if within ±1 step
      const slotsNeeded = MAX_PER_EMAIL - chosenIndices.size; // 5
      const spanStart = 3;
      const spanEnd = allSteps.length - 2;

      for (let s = 0; s < slotsNeeded; s++) {
        const ideal = Math.round(spanStart + ((s + 0.5) * (spanEnd - spanStart + 1)) / slotsNeeded - 0.5);
        let bestIdx = Math.max(spanStart, Math.min(spanEnd, ideal));

        // Check ideal, ideal-1, ideal+1 for a natural boundary (like numbers stripped or syllable/name boundary)
        for (const offset of [0, -1, 1, -2, 2]) {
          const cand = ideal + offset;
          if (cand >= spanStart && cand <= spanEnd && !chosenIndices.has(cand)) {
            if (milestones.has(allSteps[cand].length)) {
              bestIdx = cand;
              break;
            }
          }
        }

        // Ensure uniqueness if bestIdx was already taken
        while (chosenIndices.has(bestIdx) && bestIdx < spanEnd) bestIdx++;
        while (chosenIndices.has(bestIdx) && bestIdx > spanStart) bestIdx--;
        chosenIndices.add(bestIdx);
      }

      const sortedIdx = Array.from(chosenIndices).sort(function (a, b) { return a - b; });
      selectedLocals = sortedIdx.map(function (idx) { return allSteps[idx]; });
    }

    const variations = selectedLocals.map(function (loc) {
      return {
        email: loc + '@' + domain,
        local: loc,
        domain: domain
      };
    });

    return {
      source: trimmed,
      valid: true,
      accentReplacements: accentRes.replacements,
      variations: variations
    };
  }

  /**
   * Process a batch of emails one after another: reduce email #1 down to 3 letters, then move to email #2, etc.
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
    MAX_PER_EMAIL: MAX_PER_EMAIL,
    MIN_LETTERS: MIN_LETTERS,
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
