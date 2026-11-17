chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.target !== 'offscreen' || message.type !== 'clipboard-write') return;
  const field = document.getElementById('clipboard');
  field.value = message.text;
  field.focus();
  field.select();
  const ok = document.execCommand('copy');
  field.value = '';
  respond({ ok, reason: ok ? undefined : 'Clipboard is unavailable. Select and copy the displayed code.' });
});
