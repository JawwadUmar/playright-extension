export class HoverDetector {
  constructor({ ownsEvent, engaged, onHover, onLeave }) {
    this.ownsEvent = ownsEvent;
    this.engaged = engaged;
    this.onHover = onHover;
    this.onLeave = onLeave;
    this.move = event => {
      if (event.pointerType === 'touch' || event.buttons) return;
      this.point = { x: event.clientX, y: event.clientY };
      if (this.ownsEvent(event)) { this.cancel(); return; }
      const raw = event.composedPath().find(node => node instanceof Element);
      this.schedule(raw);
    };
    this.leave = event => {
      if (event.relatedTarget === null && !this.engaged()) {
        this.cancel();
        this.leaveTimer = setTimeout(() => { if (!this.engaged()) this.onLeave(); }, 120);
      }
    };
  }
  start() {
    document.addEventListener('pointermove', this.move, { capture: true, passive: true });
    document.addEventListener('pointerout', this.leave, { capture: true, passive: true });
  }
  schedule(raw, immediate = false) {
    clearTimeout(this.leaveTimer);
    if (!raw || this.engaged()) return;
    if (raw === this.pending) return;
    clearTimeout(this.timer);
    this.pending = raw;
    this.timer = setTimeout(() => {
      this.pending = null;
      if (!this.engaged()) this.onHover(raw, this.point);
    }, immediate ? 0 : 70);
  }
  resample() {
    if (!this.point || this.engaged()) return;
    let raw = document.elementFromPoint(this.point.x, this.point.y);
    while (raw?.shadowRoot) {
      const inner = raw.shadowRoot.elementFromPoint(this.point.x, this.point.y);
      if (!inner || inner === raw) break;
      raw = inner;
    }
    this.schedule(raw, true);
  }
  cancel() { clearTimeout(this.timer); clearTimeout(this.leaveTimer); this.pending = null; }
  stop() {
    this.cancel();
    document.removeEventListener('pointermove', this.move, true);
    document.removeEventListener('pointerout', this.leave, true);
  }
}
