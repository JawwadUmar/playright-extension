export class Highlighter {
  constructor(root) {
    this.outline = document.createElement('div');
    this.outline.className = 'outline';
    this.outline.setAttribute('aria-hidden', 'true');
    root.append(this.outline);
  }
  show(element) {
    const rect = element.getBoundingClientRect();
    Object.assign(this.outline.style, {
      display: rect.width && rect.height ? 'block' : 'none',
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });
  }
  hide() { this.outline.style.display = 'none'; }
}
