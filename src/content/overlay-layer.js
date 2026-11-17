import { composedParent } from '../selector/dom.js';

const HOST_STYLE = [
  'all:initial', 'display:block', 'position:fixed', 'inset:0',
  'width:auto', 'height:auto', 'min-width:0', 'min-height:0',
  'max-width:none', 'max-height:none', 'margin:0', 'padding:0',
  'border:0', 'background:transparent', 'overflow:visible',
  'transform:none', 'filter:none', 'perspective:none', 'contain:none',
  'isolation:isolate', 'z-index:2147483647', 'pointer-events:none',
].map(rule => `${rule}!important`).join(';');

function closestComposed(element, selector) {
  for (let node = element; node instanceof Element; node = composedParent(node)) {
    if (node.matches(selector)) return node;
  }
  return null;
}

function activeElement() {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function containerFor(target) {
  // Native modals make nodes outside their flat-tree descendants inert,
  // even when those nodes are popovers in the top layer.
  const modal = closestComposed(activeElement(), 'dialog:modal')
    ?? closestComposed(target, 'dialog:modal')
    ?? [...document.querySelectorAll('dialog:modal')].at(-1);
  const targetModal = closestComposed(target, 'dialog:modal');
  if (modal && modal !== targetModal) return { container: modal, blocked: true };
  // Keep clicks inside site popovers/focus traps so copying does not dismiss
  // the inspected UI. The top layer still escapes their transforms/clipping.
  const container = closestComposed(target, ':popover-open,[role="dialog"],[role="alertdialog"],[aria-modal="true"]')
    ?? modal ?? document.fullscreenElement ?? document.documentElement;
  return { container, blocked: false };
}

export class OverlayLayer {
  constructor(host, { ownsNode, onPosition, onTargetBlocked }) {
    this.host = host;
    this.ownsNode = ownsNode;
    this.onPosition = onPosition;
    this.onTargetBlocked = onTargetBlocked;
    this.host.style.cssText = HOST_STYLE;
    this.supportsPopover = typeof host.showPopover === 'function';
    if (this.supportsPopover) host.setAttribute('popover', 'manual');
    document.documentElement.append(host);

    this.onToggle = event => {
      if (!this.ownsNode(event.target)) this.schedule(true);
    };
    this.onFocus = event => {
      if (!this.ownsNode(event.target)) this.schedule(false);
    };
    this.onFullscreen = () => this.schedule(true);
    this.observer = new MutationObserver(records => {
      if (records.some(record => !this.ownsNode(record.target))) this.schedule(true);
    });
    this.roots = new Set();
    this.watch(document);
    document.addEventListener('focusin', this.onFocus, true);
    document.addEventListener('fullscreenchange', this.onFullscreen, true);
  }

  watch(root) {
    if (this.roots.has(root)) return;
    this.roots.add(root);
    root.addEventListener('beforetoggle', this.onToggle, true);
    root.addEventListener('toggle', this.onToggle, true);
    this.observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['open', 'inert', 'aria-modal'] });
  }

  schedule(raise) {
    if (!this.visible) return;
    this.raisePending ||= raise;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      if (!this.visible) return;
      if (!this.ensure(this.target, this.raisePending)) return;
      this.raisePending = false;
      this.onPosition();
    });
  }

  ensure(target = this.target, raise = false) {
    this.target = target;
    this.visible = true;
    const { container, blocked } = containerFor(target);
    if (blocked) {
      // A newly opened native modal makes the previous inspected element
      // inert. Drop that old selection instead of covering the new form.
      this.onTargetBlocked();
      return false;
    }
    let root = container.getRootNode();
    while (root instanceof ShadowRoot) {
      this.watch(root);
      root = root.host.getRootNode();
    }
    root = target?.getRootNode();
    while (root instanceof ShadowRoot) {
      this.watch(root);
      root = root.host.getRootNode();
    }
    const moved = this.host.parentElement !== container;
    if (moved) container.append(this.host);
    if (this.supportsPopover) {
      try {
        // showPopover() on an already-open popover does not change its order.
        // Only re-enter the top layer after the site opens another overlay.
        if (raise && !moved && this.host.matches(':popover-open')) this.host.hidePopover();
        if (!this.host.matches(':popover-open')) this.host.showPopover();
      } catch {
        // A site may be in the middle of a dialog/popover transition. Keep the
        // fixed maximum-z-index fallback, then retry on the next lifecycle event.
      }
    }
    return true;
  }

  hide() {
    this.visible = false;
    this.target = undefined;
    this.raisePending = false;
    cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (this.supportsPopover && this.host.matches(':popover-open')) this.host.hidePopover();
  }

  destroy() {
    this.hide();
    this.observer.disconnect();
    for (const root of this.roots) {
      root.removeEventListener('beforetoggle', this.onToggle, true);
      root.removeEventListener('toggle', this.onToggle, true);
    }
    this.roots.clear();
    document.removeEventListener('focusin', this.onFocus, true);
    document.removeEventListener('fullscreenchange', this.onFullscreen, true);
  }
}
