/**
 * MailMorph — Multi-Format Client-Side Document & Spreadsheet Email Extractor
 * Supports: .txt, .csv, .pdf, .xlsx, .xls, .docx, .doc (OLE2 binary Word, RTF, Word HTML/XML)
 * Runs 100% in the browser — zero backend required (GitHub Pages compatible).
 */
(function (root) {
  'use strict';

  const Engine = root.MailMorphEngine || (typeof require === 'function' ? require('./engine.js') : null);

  function configurePdfWorker() {
    if (root.pdfjsLib && root.pdfjsLib.GlobalWorkerOptions) {
      if (!root.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        root.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
      }
    }
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function (e) { resolve(e.target.result); };
      reader.onerror = function () { reject(new Error('Failed to read file: ' + file.name)); };
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Smart text buffer decoder: tries UTF-8 (fatal: true) first; falls back to Windows-1252 if legacy 8-bit accents exist.
   */
  function decodeTextSmart(uint8) {
    try {
      const utf8 = new TextDecoder('utf-8', { fatal: true });
      return utf8.decode(uint8);
    } catch (_) {
      try {
        return new TextDecoder('windows-1252').decode(uint8);
      } catch (__) {
        return new TextDecoder('utf-8').decode(uint8);
      }
    }
  }

  /**
   * Decode RTF text (often saved with .doc or .rtf extension), preserving hex accents (\'e7 -> ç) and \uN escapes.
   */
  function decodeRtfToText(rtfRaw) {
    const win1252Decoder = new TextDecoder('windows-1252');
    let s = rtfRaw;

    // Preserve mailto links inside HYPERLINK fields
    s = s.replace(/HYPERLINK\s+"([^"]+)"/gi, ' $1 ');

    // Decode Unicode escapes \u231?
    s = s.replace(/\\u(-?\d+)\??/g, function (_, numStr) {
      let code = parseInt(numStr, 10);
      if (code < 0) code += 65536;
      return String.fromCharCode(code);
    });

    // Decode hex escapes \'e7 using Windows-1252 byte table
    s = s.replace(/\\'([0-9a-fA-F]{2})/g, function (_, hex) {
      const byte = new Uint8Array([parseInt(hex, 16)]);
      return win1252Decoder.decode(byte);
    });

    // Replace paragraph/line/cell breaks with spaces, strip remaining RTF control words & braces
    s = s.replace(/\\(par|line|tab|cell|row)\b/gi, '\n');
    s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, '');
    s = s.replace(/[{}]/g, ' ');
    return s;
  }

  /**
   * Extract text from a binary OLE2 Compound File (.doc Word 97-2003) using SheetJS CFB + dual 8-bit/16-bit stream decoding.
   */
  function extractTextFromOle2Doc(uint8, XLSXLib) {
    const chunks = [];
    const win1252 = new TextDecoder('windows-1252');
    const utf16 = new TextDecoder('utf-16le');

    function scanBytes(bytes) {
      if (!bytes || !bytes.length) return;
      const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

      // 1. 8-bit Windows-1252 pass (replace control chars & null bytes with space so 16-bit streams don't false-merge)
      const eightBit = win1252.decode(arr).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, ' ');
      chunks.push(eightBit);

      // 2. Even-aligned UTF-16LE pass
      const evenLen = arr.length - (arr.length % 2);
      if (evenLen >= 8) {
        const evenText = utf16.decode(arr.subarray(0, evenLen)).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, ' ');
        chunks.push(evenText);
      }

      // 3. Odd-aligned UTF-16LE pass (handles unaligned pieces inside WordDocument / 1Table streams)
      if (arr.length >= 9) {
        const rem = arr.length - 1;
        const oddLen = rem - (rem % 2);
        const oddText = utf16.decode(arr.subarray(1, 1 + oddLen)).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, ' ');
        chunks.push(oddText);
      }
    }

    if (XLSXLib && XLSXLib.CFB) {
      try {
        const cfb = XLSXLib.CFB.read(uint8, { type: 'array' });
        if (cfb && Array.isArray(cfb.FileIndex)) {
          cfb.FileIndex.forEach(function (entry) {
            if (entry && entry.content && entry.size > 0) {
              scanBytes(entry.content);
            }
          });
          if (chunks.length > 0) return chunks.join('\n');
        }
      } catch (_) {
        // Fall through to raw binary scan if CFB container is non-standard
      }
    }

    scanBytes(uint8);
    return chunks.join('\n');
  }

  /**
   * Parse PDF buffer via Mozilla PDF.js (all pages + annotations/mailto links).
   */
  async function extractTextFromPdfBuffer(arrayBuffer, pdfLib) {
    const lib = pdfLib || root.pdfjsLib;
    if (!lib) {
      throw new Error('PDF parser library (pdf.js) is not loaded.');
    }
    configurePdfWorker();

    const loadingTask = lib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;
    const pageTexts = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      let lastY = null;
      let lastEndX = null;
      let lineBuf = '';

      for (const item of textContent.items) {
        if (typeof item.str !== 'string') continue;
        const tx = item.transform ? item.transform[4] : 0;
        const ty = item.transform ? item.transform[5] : 0;
        const width = item.width || 0;

        if (lastY !== null && Math.abs(ty - lastY) > 3) {
          lineBuf += '\n';
        } else if (lastEndX !== null) {
          const gap = tx - lastEndX;
          // Insert space between distinct columns/words; join tightly if adjacent glyph run inside one email
          if (gap > 2.5) {
            lineBuf += ' ';
          }
        }

        lineBuf += item.str;
        lastY = ty;
        lastEndX = tx + width;
      }

      pageTexts.push(lineBuf);

      // Also check clickable link annotations (e.g. mailto: links)
      try {
        const annotations = await page.getAnnotations();
        for (const annot of annotations) {
          if (annot.url) pageTexts.push(annot.url);
          if (annot.unsafeUrl) pageTexts.push(annot.unsafeUrl);
        }
      } catch (_) {
        // Ignore annotation errors
      }
    }

    return {
      text: pageTexts.join('\n'),
      meta: pdf.numPages + ' page' + (pdf.numPages === 1 ? '' : 's')
    };
  }

  /**
   * Parse Excel / CSV buffer via SheetJS (all sheets + cell values + mailto hyperlinks).
   */
  function extractTextFromSpreadsheetBuffer(arrayBuffer, XLSXLib) {
    const lib = XLSXLib || root.XLSX;
    if (!lib) {
      throw new Error('Spreadsheet parser library (SheetJS) is not loaded.');
    }

    const workbook = lib.read(new Uint8Array(arrayBuffer), { type: 'array' });
    const pieces = [];

    workbook.SheetNames.forEach(function (sheetName) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return;

      Object.keys(sheet).forEach(function (cellAddr) {
        if (cellAddr[0] === '!') return;
        const cell = sheet[cellAddr];
        if (!cell) return;
        if (cell.w) pieces.push(String(cell.w));
        if (cell.v != null && String(cell.v) !== String(cell.w)) pieces.push(String(cell.v));
        if (cell.l && cell.l.Target) pieces.push(String(cell.l.Target));
      });
    });

    return {
      text: pieces.join('\n'),
      meta: workbook.SheetNames.length + ' sheet' + (workbook.SheetNames.length === 1 ? '' : 's')
    };
  }

  /**
   * Parse Word .docx buffer via Mammoth (raw text + HTML mailto hyperlinks).
   */
  async function extractTextFromDocxBuffer(arrayBuffer, mammothLib) {
    const lib = mammothLib || root.mammoth;
    if (!lib) {
      throw new Error('DOCX parser library (Mammoth) is not loaded.');
    }

    const rawRes = await lib.extractRawText({ arrayBuffer: arrayBuffer });
    let combined = rawRes && rawRes.value ? rawRes.value : '';

    try {
      const htmlRes = await lib.convertToHtml({ arrayBuffer: arrayBuffer });
      if (htmlRes && htmlRes.value) {
        // Extract href="mailto:..." targets from hyperlinks
        const hrefMatches = htmlRes.value.match(/href="([^"]+)"/gi) || [];
        hrefMatches.forEach(function (m) {
          combined += '\n' + m.replace(/^href="|"$|/gi, '');
        });
      }
    } catch (_) {
      // Raw text already captured
    }

    return {
      text: combined,
      meta: 'Word DOCX'
    };
  }

  /**
   * Detect container magic bytes and parse any supported file (.txt, .csv, .pdf, .xlsx, .xls, .docx, .doc).
   * Accepts a browser File object OR { name, arrayBuffer } for testing in Node.js.
   */
  async function parseUploadedFile(fileOrObj, deps) {
    const d = deps || {};
    const name = (fileOrObj.name || 'document.txt').trim();
    const extMatch = name.toLowerCase().match(/\.([a-z0-9]+)$/);
    const ext = extMatch ? extMatch[1] : 'txt';

    const arrayBuffer = fileOrObj.arrayBuffer instanceof ArrayBuffer
      ? fileOrObj.arrayBuffer
      : (typeof fileOrObj.arrayBuffer === 'function'
          ? await fileOrObj.arrayBuffer()
          : await readFileAsArrayBuffer(fileOrObj));

    const uint8 = new Uint8Array(arrayBuffer);

    // Magic-byte signatures
    const isPdfMagic = uint8.length >= 4 &&
      uint8[0] === 0x25 && uint8[1] === 0x50 && uint8[2] === 0x44 && uint8[3] === 0x46; // %PDF
    const isZipMagic = uint8.length >= 4 &&
      uint8[0] === 0x50 && uint8[1] === 0x4B && uint8[2] === 0x03 && uint8[3] === 0x04; // PK..
    const isOle2Magic = uint8.length >= 8 &&
      uint8[0] === 0xD0 && uint8[1] === 0xCF && uint8[2] === 0x11 && uint8[3] === 0xE0; // D0 CF 11 E0

    let extractedText = '';
    let meta = ext.toUpperCase();

    if (ext === 'pdf' || isPdfMagic) {
      const pdfRes = await extractTextFromPdfBuffer(arrayBuffer, d.pdfjsLib);
      extractedText = pdfRes.text;
      meta = 'PDF (' + pdfRes.meta + ')';
    } else if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') {
      const xlsRes = extractTextFromSpreadsheetBuffer(arrayBuffer, d.XLSX);
      extractedText = xlsRes.text;
      meta = ext.toUpperCase() + ' (' + xlsRes.meta + ')';
    } else if (ext === 'csv' || ext === 'tsv') {
      extractedText = decodeTextSmart(uint8);
      meta = ext.toUpperCase();
    } else if (ext === 'docx' || (ext === 'doc' && isZipMagic)) {
      const docxRes = await extractTextFromDocxBuffer(arrayBuffer, d.mammoth);
      extractedText = docxRes.text;
      meta = 'Word DOCX';
    } else if (ext === 'doc' || isOle2Magic) {
      if (isOle2Magic) {
        extractedText = extractTextFromOle2Doc(uint8, d.XLSX || root.XLSX);
        meta = 'Word DOC (Binary)';
      } else {
        const rawStr = decodeTextSmart(uint8);
        if (/^\s*\{\\rtf/i.test(rawStr)) {
          extractedText = decodeRtfToText(rawStr);
          meta = 'Word DOC (RTF)';
        } else if (/<html|<w:wordDocument|<\?xml/i.test(rawStr)) {
          extractedText = rawStr.replace(/<[^>]+>/g, ' ');
          meta = 'Word DOC (HTML/XML)';
        } else {
          extractedText = rawStr;
          meta = 'DOC (Text)';
        }
      }
    } else if (ext === 'rtf') {
      extractedText = decodeRtfToText(decodeTextSmart(uint8));
      meta = 'RTF';
    } else {
      // .txt, .eml, .md, etc.
      extractedText = decodeTextSmart(uint8);
      meta = ext.toUpperCase();
    }

    const emails = Engine ? Engine.extractEmailsFromText(extractedText) : [];

    return {
      fileName: name,
      fileSize: uint8.byteLength,
      fileType: meta,
      emails: emails,
      emailCount: emails.length
    };
  }

  const api = {
    parseUploadedFile: parseUploadedFile,
    decodeTextSmart: decodeTextSmart,
    decodeRtfToText: decodeRtfToText,
    extractTextFromOle2Doc: extractTextFromOle2Doc
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.MailMorphParsers = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
