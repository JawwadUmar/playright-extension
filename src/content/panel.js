import { Highlighter } from './highlighter.js';

const styles = `
  :host { all: initial; color-scheme: light; }
  *, *::before, *::after { box-sizing: border-box; }
  .outline { display:none; position:fixed; pointer-events:none; border:2px solid #079b8e; border-radius:4px; background:#0eaa9209; box-shadow:0 0 0 2px #ffffffb3; z-index:0; }
  .panel { display:none; position:fixed; pointer-events:auto; width:356px; max-height:calc(100vh - 16px); overflow:auto; color:#18283d; background:#fff; border:1px solid #dce4ed; border-radius:14px; box-shadow:0 12px 48px #1226392b,0 2px 8px #1226390f; font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; text-align:left; letter-spacing:normal; z-index:1; }
  .head { display:flex; align-items:center; gap:8px; padding:11px 14px; background:#f7f9fc; border-bottom:1px solid #e8edf2; }
  .logo { color:#087f77; font:700 17px/1 ui-monospace,monospace; }
  .brand { font-weight:650; font-size:12px; flex:1; }
  .close { border:0; background:transparent; color:#68788c; font:20px/1 sans-serif; padding:1px 4px; cursor:pointer; border-radius:4px; }
  .close:hover { background:#e7edf3; }
  .body { padding:13px 14px; }
  .element { display:flex; align-items:center; gap:7px; margin-bottom:8px; }
  .tag { font:700 12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }
  .type { color:#748095; font-size:11px; }
  .confidence { margin-left:auto; border-radius:20px; padding:2px 7px; background:#e7f6f0; color:#117054; font-size:10px; font-weight:650; }
  .confidence[data-level="Good"] { color:#386891; background:#edf4fc; }
  .confidence[data-level="Fragile"] { color:#9b6512; background:#fff3d9; }
  .strategy { color:#64758b; font-size:11px; display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
  .verified { color:#087f77; }
  code { display:block; white-space:pre-wrap; overflow-wrap:anywhere; max-height:176px; overflow:auto; border:1px solid #e0e8ef; border-radius:8px; background:#f6f8fb; padding:12px; font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace; color:#223d5c; user-select:text; }
  .copy { width:100%; margin-top:11px; padding:9px 12px; display:flex; align-items:center; justify-content:center; gap:9px; border:0; border-radius:7px; background:#087f77; color:white; font:600 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; cursor:pointer; }
  .copy:hover { background:#066d66; } .copy:disabled { opacity:.5; cursor:default; }
  button:focus-visible { outline:3px solid #84cfc6; outline-offset:2px; }
  .language { font-size:10px; font-weight:500; opacity:.8; padding-left:9px; border-left:1px solid #ffffff55; }
  .foot { display:flex; justify-content:space-between; color:#8996a6; font-size:10px; margin-top:9px; }
  .normalized, .details { color:#6c7c90; font-size:11px; margin-top:8px; overflow-wrap:anywhere; }
  .warnings { margin-top:8px; color:#95620b; font-size:11px; }
  .error { margin-top:8px; color:#b94045; font-size:11px; }
  @media (max-height:280px) {
    .head,.foot,.details { display:none; } .body { padding:8px; } .element { margin-bottom:3px; }
    .strategy { margin-bottom:4px; } code { max-height:48px; padding:6px; font-size:11px; line-height:1.4; }
    .copy { margin-top:6px; padding:6px; } .warnings,.normalized { margin-top:4px; font-size:10px; }
  }
  @media (max-width:240px) { .language,.type { display:none; } .brand { font-size:11px; } }
  [hidden] { display:none !important; }
`;

export class FloatingPanel {
  constructor({ onCopy, onDisable, onEnter, onLeave }) {
    this.host = document.createElement('locator-lens-overlay');
    this.host.style.cssText = 'all:initial!important;display:block!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    this.root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = styles;
    this.root.append(style);
    this.highlighter = new Highlighter(this.root);
    this.panel = document.createElement('section');
    this.panel.className = 'panel';
    this.panel.setAttribute('aria-label', 'Playwright selector');
    this.panel.innerHTML = `
      <div class="head"><span class="logo" aria-hidden="true">[·]</span><span class="brand">Locator Lens</span><button class="close" type="button" title="Disable inspection" aria-label="Disable inspection">×</button></div>
      <div class="body">
        <div class="element"><span class="tag"></span><span class="type"></span><span class="confidence"></span></div>
        <div class="strategy"><span class="strategy-name"></span><span class="verified">✓ 1 match · verified</span></div>
        <code tabindex="0" aria-label="Recommended Playwright selector"></code>
        <div class="normalized" hidden></div><div class="warnings" hidden></div><div class="details" hidden></div>
        <button class="copy" data-action="copy" type="button"><span class="copy-label">Copy selector</span><span class="language">Python</span></button>
        <div class="error" role="status" hidden></div>
        <div class="foot"><span>Alt+Shift+C to copy</span><span>Esc to exit</span></div>
      </div>`;
    this.root.append(this.panel);
    this.fields = Object.fromEntries(['tag', 'type', 'confidence', 'strategy-name', 'verified', 'normalized', 'warnings', 'details', 'copy-label', 'language', 'error'].map(name => [name, this.panel.querySelector(`.${name}`)]));
    this.code = this.panel.querySelector('code');
    this.copy = this.panel.querySelector('.copy');
    this.copy.addEventListener('click', onCopy);
    this.panel.querySelector('.close').addEventListener('click', onDisable);
    this.panel.addEventListener('pointerenter', onEnter);
    this.panel.addEventListener('pointerleave', onLeave);
    document.documentElement.append(this.host);
  }

  ownsEvent(event) { return event.composedPath().includes(this.host); }
  ownsNode(node) { return node === this.host || this.host.contains(node) || node?.getRootNode?.() === this.root; }
  isEngaged() { return this.panel.matches(':hover'); }

  render({ model, code, settings, rawTag }, target, point) {
    const valid = model.status === 'verified';
    this.fields.tag.textContent = model.element?.tag ?? target.tagName;
    this.fields.type.textContent = model.element?.type ? `· ${model.element.type}` : '';
    this.fields.confidence.textContent = model.confidence ?? 'Unverified';
    this.fields.confidence.dataset.level = model.confidence ?? 'Fragile';
    this.fields['strategy-name'].textContent = `${model.strategy ?? 'Unavailable'}${model.scoped ? ' · parent scoped' : ''}`;
    this.fields.verified.hidden = !valid;
    this.code.textContent = valid ? code : model.reason;
    this.fields.normalized.hidden = !rawTag || rawTag === target.tagName;
    this.fields.normalized.textContent = `Hovered ${rawTag} → matched interactive ${target.tagName}`;
    this.fields.warnings.hidden = !model.warnings?.length;
    this.fields.warnings.textContent = model.warnings?.join(' ') ?? '';
    this.fields.details.hidden = !settings.details || !valid;
    this.fields.details.textContent = `Identity checked against the matched DOM element · ${model.checks} checks · ${model.elapsedMs} ms${model.element?.name ? ` · Accessible name: ${model.element.name}` : ''}`;
    this.fields.language.textContent = settings.language === 'python' ? 'Python' : 'JavaScript';
    this.fields['copy-label'].textContent = 'Copy selector';
    this.fields.error.hidden = true;
    this.copy.disabled = !valid;
    this.panel.style.display = 'block';
    this.highlighter.show(target);
    this.position(target, point);
  }

  position(target, point) {
    if (!target?.isConnected) return;
    const margin = 8;
    const width = Math.max(100, Math.min(356, innerWidth - margin * 2));
    this.panel.style.width = `${width}px`;
    const height = this.panel.getBoundingClientRect().height;
    const rect = target.getBoundingClientRect();
    const x = point?.x ?? rect.left;
    const y = point?.y ?? rect.top;
    const choices = [
      [rect.right + 12, y - 20], [x + 18, rect.bottom + 12],
      [rect.left - width - 12, y - 20], [x + 18, rect.top - height - 12], [x + 18, y + 18],
    ].map(([left, top]) => {
      left = Math.max(margin, Math.min(left, innerWidth - width - margin));
      top = Math.max(margin, Math.min(top, innerHeight - height - margin));
      const overlap = Math.max(0, Math.min(left + width, rect.right) - Math.max(left, rect.left)) * Math.max(0, Math.min(top + height, rect.bottom) - Math.max(top, rect.top));
      return { left, top, score: overlap * 10 + Math.hypot(left - x, top - y) };
    }).sort((a, b) => a.score - b.score);
    this.panel.style.left = `${choices[0].left}px`;
    this.panel.style.top = `${choices[0].top}px`;
  }

  copying() { this.fields['copy-label'].textContent = 'Copying…'; }
  copied() {
    this.fields['copy-label'].textContent = '✓ Copied';
    clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => { this.fields['copy-label'].textContent = 'Copy selector'; }, 1800);
  }
  error(message, invalidate = false) {
    this.fields.error.hidden = false;
    this.fields.error.textContent = message;
    this.fields['copy-label'].textContent = 'Copy selector';
    if (invalidate) {
      this.copy.disabled = true;
      this.fields.verified.hidden = true;
      this.highlighter.hide();
    }
  }
  hide() { this.panel.style.display = 'none'; this.highlighter.hide(); }
  destroy() { clearTimeout(this.copyTimer); this.host.remove(); }
}
