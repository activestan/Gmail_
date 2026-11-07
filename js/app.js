/**
 * MailMorph — Clean, Frictionless UI Controller
 */
(function () {
  'use strict';

  const Engine = window.MailMorphEngine;
  const Parsers = window.MailMorphParsers;

  const state = {
    files: [], // [{ id, fileName, fileType, emails }]
    copiedBatches: new Set(),
    lastResult: null
  };

  const el = {
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    iconMoon: document.getElementById('iconMoon'),
    iconSun: document.getElementById('iconSun'),
    clearBtn: document.getElementById('clearBtn'),
    emailInput: document.getElementById('emailInput'),
    sourceCounter: document.getElementById('sourceCounter'),
    tryExampleBtn: document.getElementById('tryExampleBtn'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    fileList: document.getElementById('fileList'),
    outputStats: document.getElementById('outputStats'),
    formatSelect: document.getElementById('formatSelect'),
    outputArea: document.getElementById('outputArea'),
    copyBtn: document.getElementById('copyBtn'),
    copyBtnText: document.getElementById('copyBtnText'),
    downloadBtn: document.getElementById('downloadBtn'),
    mailtoBtn: document.getElementById('mailtoBtn'),
    batchHelper: document.getElementById('batchHelper'),
    batchButtons: document.getElementById('batchButtons'),
    toast: document.getElementById('toast')
  };

  let toastTimer = null;
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove('visible');
    }, 2400);
  }

  async function copyText(text) {
    if (!text) return false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {}
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    return ok;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderFiles() {
    if (!state.files.length) {
      el.fileList.hidden = true;
      el.fileList.innerHTML = '';
      return;
    }
    el.fileList.hidden = false;
    el.fileList.innerHTML = state.files.map(function (f) {
      return (
        '<div class="file-chip">' +
          '<div style="min-width:0;flex:1;">' +
            '<div class="file-chip-name">' + escapeHtml(f.fileName) + '</div>' +
            '<div class="file-chip-meta">' + escapeHtml(f.fileType) + ' • ' + f.emails.length + ' email' + (f.emails.length === 1 ? '' : 's') + ' found</div>' +
          '</div>' +
          '<button type="button" class="remove-btn" data-remove="' + escapeHtml(f.id) + '" aria-label="Remove file">&times;</button>' +
        '</div>'
      );
    }).join('');
  }

  function update() {
    const typed = Engine.extractEmailsFromText(el.emailInput.value || '');
    const uploaded = [];
    state.files.forEach(function (f) {
      f.emails.forEach(function (e) { uploaded.push(e); });
    });

    const allSources = [];
    const seen = new Set();
    typed.concat(uploaded).forEach(function (em) {
      const k = em.normalize('NFC').toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        allSources.push(em);
      }
    });

    el.sourceCounter.textContent = allSources.length + ' source email' + (allSources.length === 1 ? '' : 's');

    const result = Engine.processEmailBatch(allSources, { preset: 'recommended' });
    state.lastResult = result;

    const total = result.totalUniqueVariations;
    el.outputStats.textContent = total + ' variation' + (total === 1 ? '' : 's');
    el.outputArea.value = Engine.formatBatchOutput(result, el.formatSelect.value);
    el.copyBtnText.textContent = total > 0 ? 'Copy All (' + total + ')' : 'Copy Emails';

    // Progressive BCC batch helper only when list exceeds 200 emails
    if (total > 200) {
      const sep = el.formatSelect.value === 'bcc_semicolon' ? '; ' : ', ';
      const chunks = Engine.chunkForBcc(result.uniqueEmails, 100, sep);
      el.batchHelper.hidden = false;
      el.batchButtons.innerHTML = chunks.map(function (c) {
        const done = state.copiedBatches.has(c.index);
        return (
          '<button type="button" class="batch-chip' + (done ? ' copied' : '') + '" data-batch="' + c.index + '">' +
            'Batch ' + c.index + ' (' + c.count + ')' + (done ? ' ✓' : '') +
          '</button>'
        );
      }).join('');
    } else {
      el.batchHelper.hidden = true;
      el.batchButtons.innerHTML = '';
    }
  }

  async function handleFileUpload(fileList) {
    if (!fileList || !fileList.length) return;
    for (const file of Array.from(fileList)) {
      try {
        const parsed = await Parsers.parseUploadedFile(file);
        state.files.push({
          id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          fileName: parsed.fileName,
          fileType: parsed.fileType,
          emails: parsed.emails
        });
        showToast('Extracted ' + parsed.emailCount + ' email(s) from ' + parsed.fileName);
      } catch (err) {
        showToast('Could not read ' + file.name);
      }
    }
    state.copiedBatches.clear();
    renderFiles();
    update();
  }

  // Theme setup
  if (localStorage.getItem('mailmorph_theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    el.iconMoon.hidden = true;
    el.iconSun.hidden = false;
  }

  el.themeToggleBtn.addEventListener('click', function () {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    el.iconMoon.hidden = next === 'dark';
    el.iconSun.hidden = next !== 'dark';
    try { localStorage.setItem('mailmorph_theme', next); } catch (_) {}
  });

  // Input events
  el.emailInput.addEventListener('input', function () {
    state.copiedBatches.clear();
    update();
  });

  el.tryExampleBtn.addEventListener('click', function () {
    el.emailInput.value = 'Odimegwustanley2004@gmail.com';
    state.copiedBatches.clear();
    update();
  });

  el.clearBtn.addEventListener('click', function () {
    el.emailInput.value = '';
    state.files = [];
    state.copiedBatches.clear();
    renderFiles();
    update();
  });

  // File upload events
  el.dropzone.addEventListener('click', function () { el.fileInput.click(); });
  el.dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.fileInput.click();
    }
  });
  el.fileInput.addEventListener('change', function () {
    handleFileUpload(el.fileInput.files);
    el.fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    el.dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      el.dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    el.dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      el.dropzone.classList.remove('dragover');
    });
  });
  el.dropzone.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) {
      handleFileUpload(e.dataTransfer.files);
    }
  });

  el.fileList.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const id = btn.getAttribute('data-remove');
    state.files = state.files.filter(function (f) { return f.id !== id; });
    renderFiles();
    update();
  });

  // Output format & actions
  el.formatSelect.addEventListener('change', update);

  el.copyBtn.addEventListener('click', async function () {
    const text = el.outputArea.value;
    if (!text) return showToast('Enter or upload an email first');
    if (await copyText(text)) {
      el.copyBtn.classList.add('btn-success');
      const old = el.copyBtnText.textContent;
      el.copyBtnText.textContent = 'Copied!';
      showToast('Copied to clipboard');
      setTimeout(function () {
        el.copyBtn.classList.remove('btn-success');
        el.copyBtnText.textContent = old;
      }, 1500);
    }
  });

  el.downloadBtn.addEventListener('click', function () {
    const text = el.outputArea.value;
    if (!text) return showToast('Nothing to download yet');
    const isCsv = el.formatSelect.value === 'csv';
    const blob = new Blob([text], { type: (isCsv ? 'text/csv' : 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isCsv ? 'email-variations.csv' : 'email-variations.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  });

  el.mailtoBtn.addEventListener('click', function () {
    if (!state.lastResult || !state.lastResult.uniqueEmails.length) {
      return showToast('Enter or upload an email first');
    }
    const batch = state.lastResult.uniqueEmails.slice(0, 75);
    window.location.href = 'mailto:?bcc=' + encodeURIComponent(batch.join(','));
  });

  el.batchButtons.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-batch]');
    if (!btn || !state.lastResult) return;
    const idx = parseInt(btn.getAttribute('data-batch'), 10);
    const sep = el.formatSelect.value === 'bcc_semicolon' ? '; ' : ', ';
    const chunks = Engine.chunkForBcc(state.lastResult.uniqueEmails, 100, sep);
    const target = chunks[idx - 1];
    if (target && await copyText(target.formatted)) {
      state.copiedBatches.add(idx);
      update();
      showToast('Copied Batch ' + idx + ' (' + target.count + ' emails)');
    }
  });

  update();
})();
