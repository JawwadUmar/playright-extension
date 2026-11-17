export const normalize = value => String(value ?? '').replace(/[\u200b\u00ad]/g, '').replace(/\s+/g, ' ').trim();
export const shortText = value => {
  const text = normalize(value);
  return text && text.length <= 180 ? text : '';
};

export function composedParent(element) {
  return element.parentElement ?? (element.getRootNode() instanceof ShadowRoot ? element.getRootNode().host : null);
}

export function ancestors(element, limit = 12) {
  const result = [];
  let parent = composedParent(element);
  while (parent && result.length < limit && parent !== element.ownerDocument.documentElement) {
    result.push(parent);
    parent = composedParent(parent);
  }
  return result;
}

export function meaningfulTarget(element, roleOf) {
  if (!(element instanceof Element)) return null;
  // A nested form control always owns its own semantics.
  const interactive = node => /^(BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|OPTION)$/.test(node.tagName)
    || (node.tagName === 'A' && node.hasAttribute('href'))
    || ['button', 'link', 'checkbox', 'radio', 'switch', 'combobox', 'textbox', 'menuitem', 'tab', 'option', 'slider', 'spinbutton'].includes(roleOf(node))
    || node.isContentEditable;
  if (interactive(element)) return element;
  if (element.tagName === 'LABEL' && element.control) return element.control;
  for (const parent of ancestors(element, 16)) {
    if (interactive(parent)) return parent;
    if (parent.tagName === 'LABEL' && parent.control) return parent.control;
    if (/^(FORM|ARTICLE|SECTION|BODY|MAIN|NAV)$/.test(parent.tagName)) break;
  }
  return element;
}

export function isStable(value) {
  if (!value || value.length > 100) return false;
  return !/(?:^|[-_:])(?:ember|react|radix|headlessui|mui|mantine|chakra|rc|uid|uuid|auto|generated)[-_:]?\d/i.test(value)
    && !/^:r[\w:-]+:$/i.test(value)
    && !/^(?:ember\d+|[a-f\d]{8,}|[\da-f]{8}-[\da-f-]{20,})$/i.test(value)
    && !/(?:^|[-_])[a-f\d]{8,}(?:$|[-_])/i.test(value)
    && !/\d{4,}/.test(value)
    && !/[A-Za-z0-9+/_-]{24,}/.test(value);
}

export function cssString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\x00-\x1f\x7f]/g, char => `\\${char.charCodeAt(0).toString(16)} `)}"`;
}

export function tagName(element) {
  return CSS.escape(element.localName);
}

export function deepElements(root, selector) {
  const matches = [...root.querySelectorAll(selector)];
  for (const node of root.querySelectorAll('*')) {
    if (node.shadowRoot) matches.push(...deepElements(node.shadowRoot, selector));
  }
  return matches;
}
