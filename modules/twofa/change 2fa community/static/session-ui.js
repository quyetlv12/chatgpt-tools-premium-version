(function (root) {
  'use strict';
  root.SessionImportUI = { init };
  function init({ api, toast, onJob, ready, document: doc = document }) {
    const $ = id => doc.getElementById(id);
    const dialog = $('session-import');
    const form = $('session-import-form');
    const fields = ['session-email', 'session-password', 'session-file', 'session-json', 'session-confirm'];
    const maxBytes = 128 * 1024;
    let busy = false;
    let fileVersion = 0;
    const status = message => { $('session-import-status').textContent = message; };
    function clear() {
      fileVersion += 1;
      form.reset();
      status('');
    }
    function setBusy(value) {
      busy = value;
      [...fields, 'submit-session-import', 'close-session-import'].forEach(id => { $(id).disabled = value; });
    }
    $('open-session-import').addEventListener('click', () => {
      if (!ready()) { toast('Đang kết nối máy chủ, vui lòng chờ.', 'error'); return; }
      clear();
      dialog.showModal();
      $('session-email').focus();
    });
    $('close-session-import').addEventListener('click', () => { if (!busy) { clear(); dialog.close(); } });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else clear(); });
    dialog.addEventListener('close', clear);
    $('session-file').addEventListener('change', async () => {
      const version = ++fileVersion;
      const file = $('session-file').files[0];
      $('session-json').value = '';
      status('');
      if (!file) return;
      if (file.size > maxBytes) { status('File vượt giới hạn 128 KB.'); $('session-file').value = ''; return; }
      try {
        const text = await file.text();
        if (version !== fileVersion || busy || !dialog.open) return;
        $('session-json').value = text;
      } catch (_) { if (version === fileVersion) status('Không đọc được file JSON.'); }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      if (!ready()) { status('Chưa kết nối máy chủ.'); return; }
      const raw = $('session-json').value;
      if (new TextEncoder().encode(raw).length > maxBytes) { status('Session vượt giới hạn 128 KB.'); return; }
      // The backend validates identity and expiry; never echo raw input in errors.
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      }
      catch (_) { status('Nội dung không phải object session JSON hợp lệ.'); return; }
      setBusy(true);
      status('Đang gửi một job. Không đóng hoặc gửi lại yêu cầu.');
      fileVersion += 1;
      try {
        const body = JSON.stringify({ email: $('session-email').value.trim(), password: $('session-password').value,
          session_json: raw, confirm: 'CHANGE_2FA_FROM_SESSION' });
        // One request only. A lost response must not trigger another rotation.
        const data = await api('/api/session-jobs', { method: 'POST', body });
        onJob(data.job);
        clear();
        dialog.close();
        toast('Đã thêm job session. Theo dõi kết quả trong danh sách tài khoản.');
      } catch (_) {
        clear();
        status('Chưa xác nhận được yêu cầu. Kiểm tra danh sách job và trạng thái 2FA trước khi nhập lại; không tự gửi lại.');
      } finally { setBusy(false); }
    });
    $('open-session-import').disabled = false;
  }
})(typeof window === 'undefined' ? globalThis : window);
