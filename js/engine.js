/**
 * MailMorph — Email Variation, Syllable Reduction & Gmail Pattern Engine
 * Pure client-side JavaScript (zero server dependencies; GitHub Pages ready).
 */
(function (root) {
  'use strict';

  const Lexicon = root.MailMorphLexicon || (typeof require === 'function' ? require('./lexicon.js') : {
    GIVEN_NAMES: new Set(),
    WHOLE_NAMES: new Set(),
    NICKNAME_MAP: {},
    DOMAIN_TYPO_MAP: {}
  });

  // Explicit character folding for non-NFD characters (European, Nordic, Turkish, African/Nigerian hooked letters)
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
    'ƒ': 'f',  'Ƒ': 'F',
    '©': 'c',  '®': 'r'
  };

  // Optional secondary phonetic expansions (e.g. German/Nordic umlauts)
  const SECONDARY_UMLAUT_MAP = {
    'ä': 'ae', 'Ä': 'Ae',
    'ö': 'oe', 'Ö': 'Oe',
    'ü': 'ue', 'Ü': 'Ue',
    'ø': 'oe', 'Ø': 'Oe'
  };

  // Valid syllable onset consonant clusters (English + Romance + African/Igbo/Yoruba labiovelars & prenasals)
  const ONSET_CLUSTERS = new Set([
    'ch','sh','th','ph','gh','wh','rh',
    'kw','gw','nw','ny','kp','gb','ng',
    'st','sp','sk','sc','sm','sn','sw','sl',
    'tr','pr','br','cr','dr','fr','gr',
    'pl','bl','cl','gl','fl','kl',
    'tw','dw','qu'
  ]);

  const DEFAULT_OPTIONS = {
    preset: 'recommended',          // 'recommended' | 'reduction_only' | 'focused' | 'comprehensive'
    includeOriginal: true,          // Include normalized original email first in output
    fixDomainTypos: true,           // e.g. gmial.com -> gmail.com
    enforceGmailLength: true,       // Enforce 6-30 char rule on @gmail.com / @googlemail.com
    minLengthNonGmail: 3,           // Minimum local-part length on non-Gmail domains
    caseStyle: 'preserve',          // 'preserve' | 'lower'
    maxPerEmail: 0,                 // 0 = unlimited, else cap per source email
    dedupeGmailDots: true,          // Treat a.b@gmail.com and ab@gmail.com as duplicates unless separators enabled
    categories: {
      accentCleanup: true,          // ç -> c, é -> e, ọ -> o, etc.
      numberReduction: true,        // 2004 -> 200 -> 20 -> 2 -> '', plus 04, 4
      syllableReduction: true,      // Multi-syllable & word-boundary step-downs (Odimegwu, Odimegwustan, ...)
      letterReduction: true,        // Progressive character reductions from right to left
      gmailNamePatterns: true,      // Swapped order, initials, nicknames, part+year (Stanleyodimegwu, Sodimegwu, Odimegwus...)
      spellingTranspositions: true, // Common transpositions & spelling variants (Odimegwustanely, micheal, favour/favor...)
      separatorVariants: false,     // Dot/underscore/hyphen variants (optional; Gmail ignores dots)
      commonAffixes: false          // iam..., real..., ...01, ...1 (optional)
    }
  };

  /**
   * Normalize accented / non-ASCII letters (e.g. ç -> c, é -> e, ọ -> o) and track replacements.
   */
  function normalizeAccents(str) {
    if (!str) return { normalized: '', secondary: null, replacements: [] };

    const replacements = [];
    const seenPairs = new Set();
    let hasSecondaryUmlaut = false;
    let secondaryChars = '';
    let primaryChars = '';

    // Compose first to inspect user-perceived characters cleanly, then fold
    const composed = str.normalize ? str.normalize('NFC') : str;

    for (const ch of composed) {
      let mapped = ch;
      let secMapped = ch;

      if (SECONDARY_UMLAUT_MAP[ch]) {
        hasSecondaryUmlaut = true;
        secMapped = SECONDARY_UMLAUT_MAP[ch];
      }

      if (SPECIAL_CHAR_MAP[ch]) {
        mapped = SPECIAL_CHAR_MAP[ch];
        if (!SECONDARY_UMLAUT_MAP[ch]) secMapped = mapped;
      } else if (ch.charCodeAt(0) > 127) {
        const stripped = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        mapped = stripped;
        if (!SECONDARY_UMLAUT_MAP[ch]) secMapped = stripped;
      }

      if (mapped !== ch && /^[a-zA-Z]+$/.test(mapped)) {
        const label = ch + ' → ' + mapped;
        if (!seenPairs.has(label)) {
          seenPairs.add(label);
          replacements.push(label);
        }
      }

      primaryChars += mapped;
      secondaryChars += secMapped;
    }

    // Final safety strip of any lingering combining marks
    const normalized = primaryChars.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const secondary = hasSecondaryUmlaut
      ? secondaryChars.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      : null;

    return {
      normalized: normalized,
      secondary: secondary !== normalized ? secondary : null,
      replacements: replacements
    };
  }

  /**
   * Extract email addresses from arbitrary raw text (PDFs, Word docs, spreadsheets, pasted text).
   * Supports Unicode accented letters in local-parts (e.g. françois2004@gmail.com) and markdown/mailto links.
   */
  function extractEmailsFromText(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];

    let text = rawText;

    // 1. Expand markdown links [label](mailto:addr) into spaces so they never merge together
    text = text.replace(/\[([^\]]*)\]\(\s*mailto:([^)\s?]+)[^)]*\)/gi, ' $1 $2 ');

    // 2. Strip mailto: prefixes and query strings (?subject=...)
    text = text.replace(/mailto:([^\s?"'<>)\]]+)(\?[^\s"'<>)\]]*)?/gi, ' $1 ');

    // 3. Stitch obvious PDF column line-wraps right after '@' or right after '.' in domain
    //    e.g. "Odimegwustanley2004@\ngmail.com" -> "Odimegwustanley2004@gmail.com"
    text = text.replace(/([\p{L}\p{M}\p{N}._%+-]+@)\r?\n\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,24})/gu, '$1$2');

    // 4. Match Unicode-aware email patterns
    const emailRegex = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}._%+'’-]{0,63}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/gu;
    const matches = text.match(emailRegex) || [];

    const results = [];
    const seen = new Set();

    for (let raw of matches) {
      // Clean leading/trailing punctuation artifacts
      raw = raw.replace(/^[.'’-]+|[.,;:!?'’-]+$/g, '').trim();
      const atIdx = raw.lastIndexOf('@');
      if (atIdx <= 0) continue;

      const local = raw.slice(0, atIdx);
      const domain = raw.slice(atIdx + 1).toLowerCase();

      // Verify TLD is alphabetic (2 to 24 chars) and not a file extension artifact like image@2x.png
      const domainParts = domain.split('.');
      const tld = domainParts[domainParts.length - 1];
      if (!tld || !/^[a-z]{2,24}$/.test(tld)) continue;
      if (/^(png|jpg|jpeg|gif|svg|webp|pdf|css|js|woff|woff2|ttf)$/i.test(tld)) continue;

      const dedupeKey = (local.normalize('NFC').toLowerCase()) + '@' + domain;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        results.push(local + '@' + domain);
      }
    }

    return results;
  }

  /**
   * Phonotactic syllable splitter for names & words (supports English, Romance & African CV/cluster patterns).
   * Example: "odimegwustanley" -> ["o", "di", "me", "gwu", "stan", "ley"]
   */
  function syllabify(word) {
    const clean = (word || '').toLowerCase().replace(/[^a-z]/g, '');
    if (clean.length <= 3) return clean ? [clean] : [];

    function isVowelAt(str, i) {
      const ch = str[i];
      if ('aeiou'.indexOf(ch) !== -1) return true;
      if (ch === 'y') {
        // 'y' at start of word or immediately before a vowel acts as consonant (e.g. "yemi", "ayo")
        if (i === 0) return false;
        if (i + 1 < str.length && 'aeiou'.indexOf(str[i + 1]) !== -1) return false;
        return true;
      }
      return false;
    }

    // Identify vowel nuclei groups [start, end] (inclusive)
    const nuclei = [];
    let i = 0;
    while (i < clean.length) {
      if (isVowelAt(clean, i)) {
        let start = i;
        let end = i;
        while (end + 1 < clean.length && isVowelAt(clean, end + 1)) {
          const pair = clean.slice(end, end + 2);
          // True diphthongs/digraphs stay in one nucleus; hiatus vowels like 'ia', 'io', 'ua', 'uo', 'eo', 'ae' (in African names) split
          if (/^(ee|oo|ea|ou|oi|oy|ai|ay|ei|ey|oa|au|aw|eu|ew)$/.test(pair)) {
            end++;
          } else if (pair === 'ie' && end + 1 === clean.length - 1) {
            end++;
          } else {
            break;
          }
        }
        nuclei.push([start, end]);
        i = end + 1;
      } else {
        i++;
      }
    }

    if (nuclei.length <= 1) return [clean];

    // Trailing silent 'e' merge: in words ending in C+'e' where preceding is not an African CV pattern,
    // keep cautiously separate ONLY if vowel-heavy; wait: for names like "ade", "tope", "uche", final 'e' IS pronounced!
    // For English names like "james", "charles", 'es' has its own vowel or merges cleanly.
    const boundaries = [0];

    for (let k = 0; k < nuclei.length - 1; k++) {
      const cStart = nuclei[k][1] + 1;
      const cEnd = nuclei[k + 1][0]; // exclusive
      const cLen = cEnd - cStart;

      if (cLen === 0) {
        boundaries.push(cEnd);
      } else if (cLen === 1) {
        boundaries.push(cStart);
      } else if (cLen === 2) {
        const cluster = clean.slice(cStart, cEnd);
        if (ONSET_CLUSTERS.has(cluster)) {
          boundaries.push(cStart);
        } else {
          boundaries.push(cStart + 1);
        }
      } else {
        // 3+ consonants between vowels: check if last 2 form a valid onset cluster
        const lastTwo = clean.slice(cEnd - 2, cEnd);
        if (ONSET_CLUSTERS.has(lastTwo)) {
          boundaries.push(cEnd - 2);
        } else {
          boundaries.push(cEnd - 1);
        }
      }
    }

    const syllables = [];
    for (let b = 0; b < boundaries.length; b++) {
      const start = boundaries[b];
      const end = b + 1 < boundaries.length ? boundaries[b + 1] : clean.length;
      const syl = clean.slice(start, end);
      if (syl) syllables.push(syl);
    }

    // Merge a lone trailing single consonant if any occurred
    if (syllables.length > 1 && !/[aeiouy]/.test(syllables[syllables.length - 1])) {
      const tail = syllables.pop();
      syllables[syllables.length - 1] += tail;
    }

    return syllables;
  }

  function hasVowel(s) {
    return /[aeiouy]/i.test(s);
  }

  /**
   * Segment an unseparated alphabetic run into compound name words when recognizable.
   * Example: "odimegwustanley" -> ["odimegwu", "stanley"]
   */
  function segmentCompoundAlpha(word, depth) {
    const d = depth || 0;
    const lower = word.toLowerCase();
    if (lower.length < 6 || d >= 2) return [lower];

    // Do not split single known names (their stems/nicknames are handled via NICKNAME_MAP & syllabify)
    if (Lexicon.WHOLE_NAMES.has(lower) || Lexicon.GIVEN_NAMES.has(lower)) {
      return [lower];
    }

    let bestSplit = null;
    let bestScore = 0;

    for (let i = 3; i <= lower.length - 3; i++) {
      const left = lower.slice(0, i);
      const right = lower.slice(i);
      if (!hasVowel(left) || !hasVowel(right)) continue;

      const leftKnown = Lexicon.GIVEN_NAMES.has(left);
      const rightKnown = Lexicon.GIVEN_NAMES.has(right);

      let score = 0;
      if (leftKnown && rightKnown) {
        // Both halves are known names (e.g. "odimegwu" + "stanley", "chinedu" + "emeka", "john" + "paul")
        score = 100 + Math.min(left.length, right.length) * 3;
      } else if (rightKnown && right.length >= 4 && left.length >= 4) {
        // Suffix is a solid known name >= 4 chars (e.g. "nwabueze" + "stanley")
        score = 80 + right.length * 2;
      } else if (leftKnown && left.length >= 4 && right.length >= 4) {
        // Prefix is a solid known name >= 4 chars (e.g. "stanley" + "nwabueze")
        score = 78 + left.length * 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestSplit = [left, right];
      }
    }

    if (bestSplit) {
      const leftSegs = bestSplit[0].length >= 8 && !Lexicon.GIVEN_NAMES.has(bestSplit[0])
        ? segmentCompoundAlpha(bestSplit[0], d + 1)
        : [bestSplit[0]];
      const rightSegs = bestSplit[1].length >= 8 && !Lexicon.GIVEN_NAMES.has(bestSplit[1])
        ? segmentCompoundAlpha(bestSplit[1], d + 1)
        : [bestSplit[1]];
      return leftSegs.concat(rightSegs);
    }

    return [lower];
  }

  /**
   * Tokenize a normalized local-part into structured word & digit tokens + syllable breakdowns.
   */
  function analyzeLocalPart(rawCleanLocal) {
    // Split first by explicit separators (., _, -, +)
    const rawChunks = rawCleanLocal.split(/[._\-+]+/).filter(Boolean);
    const tokens = []; // { type: 'alpha' | 'num', value: string }

    for (const chunk of rawChunks) {
      // Split transitions between letters and digits, and CamelCase transitions (e.g. OdimegwuStanley2004)
      const subParts = chunk
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Za-z])(\d)/g, '$1 $2')
        .replace(/(\d)([A-Za-z])/g, '$1 $2')
        .split(/\s+/)
        .filter(Boolean);

      for (const sp of subParts) {
        if (/^\d+$/.test(sp)) {
          tokens.push({ type: 'num', value: sp });
        } else {
          const alphaOnly = sp.replace(/[^a-zA-Z]/g, '');
          if (!alphaOnly) continue;
          // If it was already CamelCase split into short parts, keep; else try compound name segmentation
          const segs = segmentCompoundAlpha(alphaOnly, 0);
          for (const seg of segs) {
            tokens.push({
              type: 'alpha',
              value: seg,
              syllables: syllabify(seg)
            });
          }
        }
      }
    }

    const alphaWords = tokens.filter(function (t) { return t.type === 'alpha'; }).map(function (t) { return t.value; });
    const numBlocks = tokens.filter(function (t) { return t.type === 'num'; }).map(function (t) { return t.value; });
    const allSyllables = [];
    tokens.forEach(function (t) {
      if (t.type === 'alpha') {
        t.syllables.forEach(function (s) { allSyllables.push(s); });
      }
    });

    return {
      tokens: tokens,
      alphaWords: alphaWords,
      numBlocks: numBlocks,
      allSyllables: allSyllables
    };
  }

  /**
   * Generate realistic spelling, double-letter & adjacent-transposition variations for an alpha word.
   * Captures patterns like "stanley" -> "stanely", "michael" <-> "micheal", "israel" <-> "isreal", "favour" <-> "favor".
   */
  function generateWordSpellingVariants(word) {
    const w = word.toLowerCase();
    if (w.length < 4) return [];
    const out = new Set();

    const rules = [
      [/ley$/, 'ely'],
      [/ely$/, 'ley'],
      [/ael/g, 'eal'],
      [/eal/g, 'ael'],
      [/ie/g, 'ei'],
      [/ei/g, 'ie'],
      [/our/g, 'or'],
      [/([^f])or$/, '$1our'],
      [/ph/g, 'f'],
      [/mohammed/g, 'mohamed'],
      [/mohamed/g, 'mohammed'],
      [/muhammad/g, 'mohammed'],
      [/emmanuel/g, 'emanuel'],
      [/emanuel/g, 'emmanuel'],
      [/matthew/g, 'mathew'],
      [/mathew/g, 'matthew'],
      [/phillip/g, 'philip'],
      [/collins/g, 'colins'],
      [/blessing/g, 'blesing']
    ];

    for (const [pattern, replacement] of rules) {
      if (pattern.test(w)) {
        const candidate = w.replace(pattern, replacement);
        if (candidate !== w && candidate.length >= 3) out.add(candidate);
      }
    }

    // Collapse any double letter (e.g. "millicent" -> "milicent", "hannah" -> "hanah")
    const doubleMatch = w.match(/([a-z])\1/);
    if (doubleMatch) {
      out.add(w.replace(/([a-z])\1/, '$1'));
    }

    // If no rule triggered yet on a 5+ char word, swap the penultimate vowel/consonant pair near the end of the word
    if (out.size === 0 && w.length >= 5) {
      const idx = w.length - 3;
      const swapped = w.slice(0, idx) + w[idx + 1] + w[idx] + w.slice(idx + 2);
      if (swapped !== w) out.add(swapped);
    }

    return Array.from(out);
  }

  /**
   * Number variation helper:
   * For "2004":
   *  - Right-to-left reductions: "200", "20", "2"
   *  - Year/tail reductions: "04", "4"
   */
  function generateNumberVariants(numStr) {
    if (!numStr) return { rightTrim: [], yearTail: [] };
    const rightTrim = [];
    for (let len = numStr.length - 1; len >= 1; len--) {
      rightTrim.push(numStr.slice(0, len));
    }

    const yearTail = [];
    // 4-digit year (1950-2029) -> 2-digit year ("2004" -> "04", "1998" -> "98") and final digit ("4")
    if (numStr.length === 4 && /^(19|20)\d{2}$/.test(numStr)) {
      const twoDigit = numStr.slice(2);
      yearTail.push(twoDigit);
      if (twoDigit[0] === '0' && twoDigit[1] !== '0') {
        yearTail.push(twoDigit.slice(1));
      }
    } else if (numStr.length >= 2) {
      yearTail.push(numStr.slice(-2));
      yearTail.push(numStr.slice(-1));
    }

    return { rightTrim: rightTrim, yearTail: yearTail };
  }

  /**
   * Check whether a candidate local-part satisfies provider syntax & length rules.
   */
  function sanitizeAndValidateLocal(candidateLocal, domain, options) {
    if (!candidateLocal) return null;
    const isGmail = domain === 'gmail.com' || domain === 'googlemail.com';

    let clean = candidateLocal.toLowerCase();
    // Clean leading/trailing separators and repeated dots
    clean = clean.replace(/^[._\-]+|[._\-]+$/g, '').replace(/\.{2,}/g, '.');

    if (isGmail) {
      // Gmail strictly forbids underscores, hyphens, and special symbols in usernames
      if (!options.categories.separatorVariants) {
        clean = clean.replace(/[^a-z0-9]/g, '');
      } else {
        clean = clean.replace(/[_\-]+/g, '.').replace(/[^a-z0-9.]/g, '').replace(/^[.]+|[.]+$/g, '').replace(/\.{2,}/g, '.');
      }
      if (!clean) return null;

      // Gmail length check (6 to 30 characters)
      const charCount = clean.replace(/\./g, '').length;
      if (options.enforceGmailLength) {
        if (charCount < 6 || clean.length > 30) return null;
      } else {
        if (charCount < Math.max(2, options.minLengthNonGmail || 3) || clean.length > 64) return null;
      }
      return clean;
    } else {
      // Standard RFC / Yahoo / Outlook / Custom domain
      clean = clean.replace(/[^a-z0-9._\-]/g, '').replace(/^[._\-]+|[._\-]+$/g, '');
      if (!clean) return null;
      if (clean.length < (options.minLengthNonGmail || 3) || clean.length > 64) return null;
      return clean;
    }
  }

  /**
   * Apply user's chosen capitalization style ('preserve' keeps initial uppercase if source had it; 'lower' lowercases all).
   */
  function applyCaseStyle(localLower, hadLeadingUpper, caseStyle) {
    if (caseStyle === 'preserve' && hadLeadingUpper && localLower.length > 0) {
      return localLower.charAt(0).toUpperCase() + localLower.slice(1);
    }
    return localLower;
  }

  /**
   * Apply preset configuration onto an options object.
   */
  function resolveOptions(userOpts) {
    const opts = JSON.parse(JSON.stringify(DEFAULT_OPTIONS));
    if (!userOpts) return opts;

    if (userOpts.preset === 'reduction_only') {
      opts.categories.accentCleanup = true;
      opts.categories.numberReduction = true;
      opts.categories.syllableReduction = true;
      opts.categories.letterReduction = true;
      opts.categories.gmailNamePatterns = false;
      opts.categories.spellingTranspositions = false;
      opts.categories.separatorVariants = false;
      opts.categories.commonAffixes = false;
    } else if (userOpts.preset === 'focused') {
      opts.categories.accentCleanup = true;
      opts.categories.numberReduction = true;
      opts.categories.syllableReduction = true;
      opts.categories.letterReduction = false;
      opts.categories.gmailNamePatterns = true;
      opts.categories.spellingTranspositions = true;
      opts.categories.separatorVariants = false;
      opts.categories.commonAffixes = false;
      if (!userOpts.maxPerEmail) opts.maxPerEmail = 15;
    } else if (userOpts.preset === 'comprehensive') {
      opts.categories.accentCleanup = true;
      opts.categories.numberReduction = true;
      opts.categories.syllableReduction = true;
      opts.categories.letterReduction = true;
      opts.categories.gmailNamePatterns = true;
      opts.categories.spellingTranspositions = true;
      opts.categories.separatorVariants = true;
      opts.categories.commonAffixes = true;
    }

    // Explicit overrides win
    Object.keys(userOpts).forEach(function (k) {
      if (k === 'categories' && userOpts.categories) {
        Object.assign(opts.categories, userOpts.categories);
      } else if (userOpts[k] !== undefined) {
        opts[k] = userOpts[k];
      }
    });

    return opts;
  }

  /**
   * Generate all ranked email variations for a single input email string.
   */
  function generateVariationsForEmail(inputEmail, rawOptions) {
    const options = resolveOptions(rawOptions);
    const trimmed = (inputEmail || '').trim();
    const atIdx = trimmed.lastIndexOf('@');
    if (atIdx <= 0) {
      return {
        source: trimmed,
        valid: false,
        variations: [],
        analysis: null
      };
    }

    const rawLocal = trimmed.slice(0, atIdx);
    let rawDomain = trimmed.slice(atIdx + 1).toLowerCase().trim();
    const hadLeadingUpper = /^[A-ZÀ-ÖØ-Þ]/.test(rawLocal);

    // Domain typo check (e.g. gmial.com -> gmail.com)
    let domainFixedFrom = null;
    if (options.fixDomainTypos && Lexicon.DOMAIN_TYPO_MAP[rawDomain]) {
      domainFixedFrom = rawDomain;
      rawDomain = Lexicon.DOMAIN_TYPO_MAP[rawDomain];
    }

    const isGmail = rawDomain === 'gmail.com' || rawDomain === 'googlemail.com';

    // Step 1: Accent / Diacritic folding (e.g. ç -> c)
    const accentInfo = normalizeAccents(rawLocal);
    const baseCleanText = options.categories.accentCleanup ? accentInfo.normalized : rawLocal;
    const analysis = analyzeLocalPart(baseCleanText);

    const alphaJoined = analysis.alphaWords.join('');
    const primaryNum = analysis.numBlocks.join('');
    const numVariants = generateNumberVariants(primaryNum);

    const candidates = []; // { email, local, category, label, confidence }
    const seenKeys = new Set();

    function addCandidate(rawCandidateLocal, category, label, confidence) {
      const validLocal = sanitizeAndValidateLocal(rawCandidateLocal, rawDomain, options);
      if (!validLocal) return;

      // Deduplication key (if Gmail & dedupeGmailDots enabled, canonicalize dots)
      const canonicalLocal = (isGmail && options.dedupeGmailDots && !options.categories.separatorVariants)
        ? validLocal.replace(/\./g, '')
        : validLocal;
      const key = canonicalLocal + '@' + rawDomain;

      if (seenKeys.has(key)) return;
      seenKeys.add(key);

      const formattedLocal = applyCaseStyle(validLocal, hadLeadingUpper, options.caseStyle);
      candidates.push({
        email: formattedLocal + '@' + rawDomain,
        local: formattedLocal,
        domain: rawDomain,
        category: category,
        label: label,
        confidence: confidence
      });
    }

    // 0. Base / Accent-Normalized Original
    if (options.includeOriginal) {
      const baseLabel = accentInfo.replacements.length > 0
        ? 'Normalized (' + accentInfo.replacements.join(', ') + ')'
        : (domainFixedFrom ? 'Domain fixed (' + domainFixedFrom + ' → ' + rawDomain + ')' : 'Original / Base');
      addCandidate(baseCleanText, accentInfo.replacements.length > 0 ? 'accent' : 'original', baseLabel, 100);
    }

    // Secondary umlaut fold if present (e.g. müller -> mueller)
    if (options.categories.accentCleanup && accentInfo.secondary) {
      addCandidate(accentInfo.secondary, 'accent', 'Phonetic accent fold', 96);
    }

    // 1. Number & Year Reductions on full alpha stem (e.g. Odimegwustanley2004 -> 200 -> 20 -> 2 -> '', plus 04, 4)
    if (options.categories.numberReduction && primaryNum) {
      numVariants.rightTrim.forEach(function (nv, idx) {
        addCandidate(alphaJoined + nv, 'number_reduction', 'Number reduction (-' + (idx + 1) + ' digit)', 95 - idx * 2);
      });
      // Strip all trailing digits (e.g. Odimegwustanley@gmail.com)
      addCandidate(alphaJoined, 'number_reduction', 'Numbers removed', 94);
      // Year / short number suffixes (e.g. Odimegwustanley04@gmail.com)
      numVariants.yearTail.forEach(function (yv, idx) {
        addCandidate(alphaJoined + yv, 'number_reduction', 'Short year/number (' + yv + ')', 91 - idx * 2);
      });
    }

    // 2. Word-Boundary & Syllable Reductions (e.g. Odimegwu@gmail.com, Odimegwustan@gmail.com)
    if (options.categories.syllableReduction) {
      // 2a. Cumulative word prefixes when multiple name parts exist
      if (analysis.alphaWords.length >= 2) {
        for (let wCount = analysis.alphaWords.length - 1; wCount >= 1; wCount--) {
          const prefixWords = analysis.alphaWords.slice(0, wCount).join('');
          addCandidate(prefixWords, 'syllable_reduction', 'Name stem reduction', 93);
          if (primaryNum && options.categories.numberReduction) {
            addCandidate(prefixWords + primaryNum, 'syllable_reduction', 'Name stem + number', 89);
            if (numVariants.yearTail[0]) {
              addCandidate(prefixWords + numVariants.yearTail[0], 'syllable_reduction', 'Name stem + short year', 86);
            }
            numVariants.rightTrim.slice(0, 2).forEach(function (nv) {
              addCandidate(prefixWords + nv, 'syllable_reduction', 'Name stem + reduced number', 84);
            });
          }
        }
      }

      // 2b. Cumulative syllable step-downs from right to left across all syllables
      // e.g. ["o","di","me","gwu","stan","ley"] -> "odimegwustan", "odimegwu", "odime"
      if (analysis.allSyllables.length >= 2) {
        for (let sCount = analysis.allSyllables.length - 1; sCount >= 1; sCount--) {
          const sylPrefix = analysis.allSyllables.slice(0, sCount).join('');
          addCandidate(sylPrefix, 'syllable_reduction', 'Syllable reduction (' + sCount + '/' + analysis.allSyllables.length + ' syl)', 90 - (analysis.allSyllables.length - sCount));
          if (primaryNum && sCount >= 2 && options.categories.numberReduction) {
            addCandidate(sylPrefix + primaryNum, 'syllable_reduction', 'Syllable stem + number', 83);
            if (numVariants.yearTail[0]) {
              addCandidate(sylPrefix + numVariants.yearTail[0], 'syllable_reduction', 'Syllable stem + short year', 81);
            }
          }
        }
      }
    }

    // 3. Spelling / Transposition / Double-Letter Patterns (e.g. Odimegwustanely@gmail.com)
    if (options.categories.spellingTranspositions && analysis.alphaWords.length >= 1) {
      analysis.alphaWords.forEach(function (word, idx) {
        const variants = generateWordSpellingVariants(word);
        variants.forEach(function (vWord) {
          const rebuilt = analysis.alphaWords.map(function (orig, j) { return j === idx ? vWord : orig; }).join('');
          addCandidate(rebuilt, 'spelling_pattern', 'Spelling/transposition (' + word + ' → ' + vWord + ')', 88);
          if (primaryNum) {
            addCandidate(rebuilt + primaryNum, 'spelling_pattern', 'Spelling/transposition + number', 87);
          }
        });
      });

      // Also check full joined alpha string if single word
      if (analysis.alphaWords.length === 1) {
        generateWordSpellingVariants(alphaJoined).forEach(function (vFull) {
          addCandidate(vFull, 'spelling_pattern', 'Transposition variant', 87);
          if (primaryNum) addCandidate(vFull + primaryNum, 'spelling_pattern', 'Transposition + number', 86);
        });
      }
    }

    // 4. Gmail Name Creation Patterns (Swapped Order, Initials, Nicknames, Individual Parts)
    if (options.categories.gmailNamePatterns) {
      const words = analysis.alphaWords;
      const shortYr = numVariants.yearTail[0] || '';

      if (words.length >= 2) {
        const first = words[0];
        const second = words[1];
        const rest = words.slice(2).join('');

        // Reversed order: Stanleyodimegwu, Stanleyodimegwu2004, Stanleyodimegwu04
        const reversed = second + first + rest;
        addCandidate(reversed, 'gmail_pattern', 'Reversed name order', 86);
        if (primaryNum) addCandidate(reversed + primaryNum, 'gmail_pattern', 'Reversed name + number', 85);
        if (shortYr) addCandidate(reversed + shortYr, 'gmail_pattern', 'Reversed name + short year', 83);

        // First + Second Initial: Odimegwus, Odimegwus2004, Odimegwus04
        addCandidate(first + second[0], 'gmail_pattern', 'First part + initial', 85);
        if (primaryNum) addCandidate(first + second[0] + primaryNum, 'gmail_pattern', 'First part + initial + number', 84);
        if (shortYr) addCandidate(first + second[0] + shortYr, 'gmail_pattern', 'First part + initial + year', 82);

        // Second Initial + First: Sodimegwu, Sodimegwu2004, Sodimegwu04
        addCandidate(second[0] + first, 'gmail_pattern', 'Initial + first part', 85);
        if (primaryNum) addCandidate(second[0] + first + primaryNum, 'gmail_pattern', 'Initial + first part + number', 84);
        if (shortYr) addCandidate(second[0] + first + shortYr, 'gmail_pattern', 'Initial + first part + year', 82);

        // First Initial + Second: Ostanley, Ostanley2004
        addCandidate(first[0] + second, 'gmail_pattern', 'Initial + second part', 82);
        if (primaryNum) addCandidate(first[0] + second + primaryNum, 'gmail_pattern', 'Initial + second part + number', 81);
        if (shortYr) addCandidate(first[0] + second + shortYr, 'gmail_pattern', 'Initial + second part + year', 79);

        // Second + First Initial: Stanleyo, Stanleyo2004
        addCandidate(second + first[0], 'gmail_pattern', 'Second part + initial', 81);
        if (primaryNum) addCandidate(second + first[0] + primaryNum, 'gmail_pattern', 'Second part + initial + number', 80);

        // Second name + number & standalone second name
        if (primaryNum) addCandidate(second + primaryNum, 'gmail_pattern', 'Second name + number', 80);
        if (shortYr) addCandidate(second + shortYr, 'gmail_pattern', 'Second name + short year', 78);
        addCandidate(second, 'gmail_pattern', 'Second name standalone', 74);

        // Nickname combinations (e.g. stanley -> stan => odimegwustan, stanodimegwu)
        const nicks1 = Lexicon.NICKNAME_MAP[first] || [];
        const nicks2 = Lexicon.NICKNAME_MAP[second] || [];

        nicks2.forEach(function (n2) {
          addCandidate(first + n2, 'gmail_pattern', 'Surname + nickname (' + n2 + ')', 84);
          addCandidate(n2 + first, 'gmail_pattern', 'Nickname (' + n2 + ') + surname', 82);
          if (primaryNum) {
            addCandidate(first + n2 + primaryNum, 'gmail_pattern', 'Surname + nickname + number', 81);
            addCandidate(n2 + first + primaryNum, 'gmail_pattern', 'Nickname + surname + number', 80);
          }
        });

        nicks1.forEach(function (n1) {
          addCandidate(n1 + second, 'gmail_pattern', 'Nickname (' + n1 + ') + second name', 82);
          addCandidate(second + n1, 'gmail_pattern', 'Second name + nickname (' + n1 + ')', 81);
          if (primaryNum) {
            addCandidate(n1 + second + primaryNum, 'gmail_pattern', 'Nickname + second name + number', 80);
          }
        });

        // 3-word initials (e.g. odimegwu + stanley + chinedu -> odimegwusc, scodimegwu)
        if (words.length >= 3) {
          const third = words[2];
          addCandidate(first + second[0] + third[0], 'gmail_pattern', 'Surname + two initials', 83);
          addCandidate(second[0] + third[0] + first, 'gmail_pattern', 'Two initials + surname', 82);
          addCandidate(first + third, 'gmail_pattern', 'First + third name', 81);
        }
      } else if (words.length === 1) {
        // Single word nickname stems (e.g. christopher2004 -> chris2004, chris04, chris)
        const nicks = Lexicon.NICKNAME_MAP[words[0]] || [];
        nicks.forEach(function (n) {
          addCandidate(n, 'gmail_pattern', 'Nickname (' + n + ')', 84);
          if (primaryNum) addCandidate(n + primaryNum, 'gmail_pattern', 'Nickname + number', 85);
          if (shortYr) addCandidate(n + shortYr, 'gmail_pattern', 'Nickname + short year', 83);
        });
      }
    }

    // 5. Progressive Letter-by-Letter Reduction (Right-to-Left character trimming)
    if (options.categories.letterReduction && alphaJoined.length >= 4) {
      // Trim full normalized alphanumeric string progressively from right
      const fullBase = alphaJoined + primaryNum;
      const minStop = isGmail && options.enforceGmailLength ? 6 : Math.max(3, options.minLengthNonGmail || 3);

      for (let len = fullBase.length - 1; len >= minStop; len--) {
        const sliced = fullBase.slice(0, len);
        addCandidate(sliced, 'letter_reduction', 'Letter reduction (' + len + ' chars)', Math.max(60, 79 - (fullBase.length - len)));
      }

      // Also trim the alphabetic core if numbers were attached
      if (primaryNum) {
        for (let len = alphaJoined.length - 1; len >= minStop; len--) {
          addCandidate(alphaJoined.slice(0, len), 'letter_reduction', 'Alpha reduction (' + len + ' chars)', Math.max(58, 76 - (alphaJoined.length - len)));
        }
      }
    }

    // 6. Optional Separator Variants (Dots for Gmail/Workspace; dots/underscores/hyphens for Yahoo/Outlook/Custom)
    if (options.categories.separatorVariants && analysis.alphaWords.length >= 2) {
      const w1 = analysis.alphaWords[0];
      const w2 = analysis.alphaWords[1];
      const seps = isGmail ? ['.'] : ['.', '_', '-'];
      seps.forEach(function (sep) {
        addCandidate(w1 + sep + w2, 'separator', 'Separated (' + sep + ')', 75);
        addCandidate(w2 + sep + w1, 'separator', 'Reversed separated (' + sep + ')', 73);
        if (primaryNum) {
          addCandidate(w1 + sep + w2 + primaryNum, 'separator', 'Separated + number', 74);
        }
      });
    }

    // 7. Optional Common Gmail Availability Prefixes / Suffixes
    if (options.categories.commonAffixes && alphaJoined.length >= 4) {
      ['iam', 'its', 'real', 'official'].forEach(function (pref) {
        addCandidate(pref + alphaJoined, 'affix', 'Common prefix (' + pref + ')', 62);
      });
      ['1', '01', '123'].forEach(function (suf) {
        if (suf !== primaryNum) {
          addCandidate(alphaJoined + suf, 'affix', 'Common number suffix (' + suf + ')', 64);
        }
      });
      if (analysis.alphaWords.length >= 1 && analysis.alphaWords[0].length >= 5) {
        addCandidate(analysis.alphaWords[0] + '1', 'affix', 'Primary name + 1', 63);
        addCandidate(analysis.alphaWords[0] + '01', 'affix', 'Primary name + 01', 62);
      }
    }

    // Apply per-email cap if set (keeping original first if enabled, then sorting by confidence)
    let finalVariations = candidates;
    if (options.maxPerEmail && options.maxPerEmail > 0 && finalVariations.length > options.maxPerEmail) {
      const sorted = finalVariations.slice().sort(function (a, b) {
        return b.confidence - a.confidence;
      });
      finalVariations = sorted.slice(0, options.maxPerEmail);
    }

    return {
      source: trimmed,
      valid: true,
      isGmail: isGmail,
      domain: rawDomain,
      domainFixedFrom: domainFixedFrom,
      accentReplacements: accentInfo.replacements,
      analysis: {
        words: analysis.alphaWords,
        numbers: analysis.numBlocks,
        syllables: analysis.allSyllables,
        syllableCount: analysis.allSyllables.length,
        localLength: rawLocal.length
      },
      variations: finalVariations
    };
  }

  /**
   * Process a list of source emails and return aggregated results + formatted outputs.
   */
  function processEmailBatch(emails, rawOptions) {
    const options = resolveOptions(rawOptions);
    const perEmailResults = [];
    const uniqueEmails = [];
    const flatRows = [];
    const globalSeen = new Set();

    for (const rawEmail of emails) {
      const res = generateVariationsForEmail(rawEmail, options);
      if (!res.valid) continue;
      perEmailResults.push(res);

      for (const v of res.variations) {
        const canonical = (res.isGmail && options.dedupeGmailDots && !options.categories.separatorVariants)
          ? v.local.toLowerCase().replace(/\./g, '') + '@' + v.domain
          : v.email.toLowerCase();

        if (!globalSeen.has(canonical)) {
          globalSeen.add(canonical);
          uniqueEmails.push(v.email);
          flatRows.push({
            source: res.source,
            email: v.email,
            category: v.category,
            label: v.label,
            confidence: v.confidence
          });
        }
      }
    }

    return {
      sourceCount: perEmailResults.length,
      totalUniqueVariations: uniqueEmails.length,
      results: perEmailResults,
      uniqueEmails: uniqueEmails,
      flatRows: flatRows,
      options: options
    };
  }

  /**
   * Format processed batch output into the user's selected format.
   */
  function formatBatchOutput(batchResult, formatType) {
    const list = batchResult.uniqueEmails || [];
    switch (formatType) {
      case 'bcc_comma':
        return list.join(', ');

      case 'bcc_semicolon':
        return list.join('; ');

      case 'bcc_header':
        return list.length ? 'Bcc: ' + list.join(', ') : '';

      case 'newline':
        return list.join('\n');

      case 'grouped':
        return (batchResult.results || []).map(function (group) {
          const header = '# Source: ' + group.source +
            ' (' + group.variations.length + ' variations | ' +
            group.analysis.syllableCount + ' syllables' +
            (group.accentReplacements.length ? ' | ' + group.accentReplacements.join(', ') : '') + ')';
          const items = group.variations.map(function (v) { return v.email; }).join(', ');
          return header + '\n' + items;
        }).join('\n\n');

      case 'csv': {
        const lines = ['source_email,suggested_email,pattern_category,pattern_detail,confidence_score'];
        (batchResult.flatRows || []).forEach(function (r) {
          const esc = function (s) {
            const str = String(s == null ? '' : s);
            return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
          };
          lines.push([esc(r.source), esc(r.email), esc(r.category), esc(r.label), r.confidence].join(','));
        });
        return lines.join('\n');
      }

      case 'json':
        return JSON.stringify(batchResult.flatRows || [], null, 2);

      default:
        return list.join(', ');
    }
  }

  /**
   * Split unique emails into BCC-safe chunks (e.g. Gmail's 100 or 450 recipient limit per message).
   */
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
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    normalizeAccents: normalizeAccents,
    extractEmailsFromText: extractEmailsFromText,
    syllabify: syllabify,
    analyzeLocalPart: analyzeLocalPart,
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
