(() => {
  'use strict';

  const INDEX_LABEL = /^\s*(?:\*\*)?第\s*[0-9０-９]+\s*张(?:\*\*)?(?:\s*[:：])?\s*/u;

  function convertLegacySeparators(line) {
    if (line.includes('|')) return line;
    const parts = line.split('----');
    if (parts.length !== 3 || parts.some((part) => !part.trim())) return line;
    return parts.join('|');
  }

  function normalizeAccounts(text) {
    return String(text).replace(/\r\n?/g, '\n').split('\n').flatMap((line) => {
      const label = line.match(INDEX_LABEL);
      if (!label) return [convertLegacySeparators(line)];
      const account = line.slice(label[0].length);
      return account.trim() ? [convertLegacySeparators(account)] : [];
    }).join('\n');
  }

  function installPasteNormalizer(input) {
    input.addEventListener('paste', (event) => {
      if (!event.clipboardData) return;
      const pasted = event.clipboardData.getData('text/plain') || event.clipboardData.getData('text');
      const normalized = normalizeAccounts(pasted);
      if (normalized === pasted) return;

      event.preventDefault();
      const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
      const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
      input.value = `${input.value.slice(0, start)}${normalized}${input.value.slice(end)}`;
      const caret = start + normalized.length;
      input.setSelectionRange(caret, caret);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  window.AccountInput = Object.freeze({ installPasteNormalizer, normalizeAccounts });
})();
