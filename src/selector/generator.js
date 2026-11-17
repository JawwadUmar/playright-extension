import { SelectorValidator } from './validator.js';
import { ancestors, cssString, isStable, shortText, tagName } from './dom.js';

const candidate = (kind, value, strategy, score, extra = {}) => ({
  steps: [{ kind, value, ...extra }], strategy, score, fragile: false,
});

export class SelectorGenerator {
  constructor(window) {
    this.validator = new SelectorValidator(window);
    this.document = window.document;
  }

  candidates(element, forScope = false) {
    const v = this.validator;
    const tag = tagName(element);
    const result = [];
    const role = v.role(element);
    const name = role ? shortText(v.name(element)) : '';
    if (role && name) result.push(candidate('role', role, 'Role', 98, { name }));
    if (!forScope) {
      for (const label of v.labels(element)) {
        if (shortText(label)) result.push(candidate('label', label, 'Label', 96));
      }
      if (/^(INPUT|TEXTAREA)$/.test(element.tagName) && shortText(element.getAttribute('placeholder'))) {
        result.push(candidate('placeholder', element.getAttribute('placeholder'), 'Placeholder', 88));
      }
    }
    if (element.getAttribute('data-testid')) result.push(candidate('testId', element.getAttribute('data-testid'), 'Test ID', 97));
    for (const attr of ['data-test-id', 'data-test', 'data-cy', 'data-qa']) {
      if (element.getAttribute(attr)) result.push(candidate('css', `${tag}[${attr}=${cssString(element.getAttribute(attr))}]`, 'Test attribute', 94));
    }
    if (!forScope && !/^(HTML|BODY|SCRIPT|STYLE|NOSCRIPT|TEMPLATE|INPUT|TEXTAREA|SELECT)$/.test(element.tagName)) {
      const text = shortText(v.text(element));
      if (text) result.push(candidate('text', text, 'Text', 83));
    }
    const id = element.getAttribute('id');
    if (isStable(id)) result.push(candidate('css', `#${CSS.escape(id)}`, 'Stable ID', 91));
    for (const attr of ['name', 'aria-label', 'title', 'alt', 'data-action', 'data-purpose', 'data-field', 'data-name', 'autocomplete']) {
      const value = element.getAttribute(attr);
      if (shortText(value) && (!attr.startsWith('data-') || isStable(value))) {
        result.push(candidate('css', `${tag}[${attr}=${cssString(value)}]`, 'Attribute', attr === 'name' || attr === 'aria-label' ? 87 : 79));
      }
    }
    const href = element.getAttribute('href');
    if (href && href.length < 180 && !/[?#]/.test(href) && !/^(?:javascript|data):/i.test(href)) {
      result.push(candidate('css', `${tag}[href=${cssString(href)}]`, 'Attribute', 77));
    }
    if (element.getAttribute('type') && /^(INPUT|BUTTON)$/.test(element.tagName)) {
      const type = cssString(element.getAttribute('type'));
      const nameAttr = element.getAttribute('name');
      if (nameAttr) result.push(candidate('css', `${tag}[type=${type}][name=${cssString(nameAttr)}]`, 'Attribute', 84));
    }
    if (role) result.push(candidate('role', role, 'Role', 78));
    result.push(candidate('css', tag, 'CSS', 67));
    const seen = new Set();
    return result.filter(item => {
      const key = JSON.stringify(item.steps);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  generate(target) {
    return this.validator.snapshot(() => this.generateSnapshot(target));
  }

  generateSnapshot(target) {
    const start = performance.now();
    let checks = 0;
    let refinementStart;
    const check = (steps, element = target) => {
      checks++;
      return this.validator.validate(steps, element);
    };
    const withinBudget = () => checks < 180 && (refinementStart === undefined || performance.now() - refinementStart < 65);
    if (!(target instanceof Element) || !target.isConnected) return this.unavailable('The element is no longer in the document.');
    const choices = this.candidates(target);
    const parents = ancestors(target, 10).filter(node => node !== this.document.body);
    let anchors;
    const getAnchors = leafSteps => {
      if (anchors) return anchors;
      // The initial whole-page match may itself be expensive on a large DOM.
      // Reserve a separate short budget to find meaningful parent context.
      refinementStart = performance.now();
      anchors = [];
      for (const parent of parents) {
        if (!withinBudget()) break;
        const parentCandidates = this.candidates(parent, true);
        for (const item of parentCandidates) {
          if (!withinBudget()) break;
          if (check(item.steps, parent).valid) {
            anchors.push({ ...item, parent });
            if (check([...item.steps, ...leafSteps]).valid) return anchors;
            break;
          }
        }
        if (!withinBudget()) break;
        // Repeated cards and rows often have a distinctive heading or cell.
        const identifyingChildren = [...parent.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],legend,td,dt,strong,a,[role="link"],p,span')].slice(0, 10);
        for (const child of identifyingChildren) {
          if (!withinBudget() || child === target || child.contains(target) || target.contains(child)) continue;
          const text = shortText(this.validator.text(child));
          if (!text) continue;
          const role = this.validator.role(child);
          const name = role ? shortText(this.validator.name(child)) : '';
          const inner = role && name ? [{ kind: 'role', value: role, name }] : [{ kind: 'text', value: text }];
          const steps = [{ kind: 'css', value: tagName(parent) }, { kind: 'filterHas', steps: inner }];
          if (check(steps, parent).valid) {
            anchors.push({ steps, strategy: 'Parent context', score: 86, parent });
            if (check([...steps, ...leafSteps]).valid) return anchors;
            break;
          }
          // Restrict the identifying child to this precise structural relationship.
          if (child.parentElement === parent) {
            const direct = [{ kind: 'css', value: `:scope > ${tagName(child)}` }, { kind: 'filterText', value: text }];
            const refined = [{ kind: 'css', value: tagName(parent) }, { kind: 'filterHas', steps: direct }];
            if (check(refined, parent).valid) {
              anchors.push({ steps: refined, strategy: 'Parent context', score: 80, parent });
              if (check([...refined, ...leafSteps]).valid) return anchors;
              break;
            }
          }
        }
      }
      return anchors;
    };

    const finish = item => {
      // Validate again immediately before exposing a recommendation.
      if (!check(item.steps).valid) return this.unavailable('The page changed before the selector could be verified.');
      const warnings = [];
      if (item.fragile) warnings.push(item.strategy === 'CSS' && !item.steps.some(step => step.kind === 'nth')
        ? 'Structure dependent. Recheck if the page layout changes.'
        : 'Position dependent. Recheck after the page changes.');
      if (target.matches(':disabled,[aria-disabled="true"]')) warnings.push('The matched element is disabled.');
      if (!this.validator.visible(target)) warnings.push('The matched element is not visible.');
      return {
        status: 'verified', ...item, count: 1, identityVerified: true,
        confidence: item.score >= 90 ? 'High' : item.score >= 70 ? 'Good' : 'Fragile',
        warnings, checks, elapsedMs: Math.round((performance.now() - start) * 10) / 10,
        element: { tag: target.tagName, type: target.getAttribute('type') || this.validator.role(target) || '', name: shortText(this.validator.name(target)) },
      };
    };

    const duplicates = [];
    for (const item of choices) {
      const validation = check(item.steps);
      if (validation.valid) return finish(item);
      if (validation.matches.includes(target)) {
        duplicates.push({ item, matches: validation.matches });
        if (withinBudget()) {
          for (const anchor of getAnchors(item.steps)) {
            const steps = [...anchor.steps, ...item.steps];
            if (check(steps).valid) {
              return finish({ ...item, steps, score: Math.min(item.score, anchor.score), scoped: true, scopeStrategy: anchor.strategy });
            }
          }
        }
      }
    }

    // Try a structural CSS path without indexes before considering position.
    let path = tagName(target);
    let child = target;
    for (const parent of parents) {
      const id = parent.getAttribute('id');
      const part = isStable(id) ? `#${CSS.escape(id)}` : tagName(parent);
      path = `${part}${child.getRootNode() === parent.getRootNode() ? ' > ' : ' '}${path}`;
      const steps = [{ kind: 'css', value: path }];
      if (check(steps).valid) return finish({ steps, strategy: 'CSS', score: 62, fragile: true });
      child = parent;
    }

    // Identical siblings cannot be distinguished semantically. Make the
    // position dependence explicit while still verifying one exact identity.
    for (const { item } of duplicates) {
      for (const anchor of anchors ?? []) {
        const steps = [...anchor.steps, ...item.steps];
        const matches = this.validator.query(steps);
        const index = matches.indexOf(target);
        if (index >= 0) return finish({ ...item, steps: [...steps, { kind: 'nth', index }], score: 38, fragile: true, scoped: true });
      }
      const matches = this.validator.query(item.steps);
      const index = matches.indexOf(target);
      if (index >= 0) return finish({ ...item, steps: [...item.steps, { kind: 'nth', index }], score: 30, fragile: true });
    }

    // XPath cannot cross shadow roots. This branch is only an emergency path.
    if (target.getRootNode() === this.document) {
      const parts = [];
      let node = target;
      while (node instanceof Element) {
        const siblings = node.parentElement ? [...node.parentElement.children].filter(item => item.localName === node.localName) : [node];
        parts.unshift(`*[local-name()=${JSON.stringify(node.localName)}][${siblings.indexOf(node) + 1}]`);
        node = node.parentElement;
      }
      const steps = [{ kind: 'xpath', value: `/${parts.join('/')}` }];
      if (check(steps).valid) return finish({ steps, strategy: 'XPath', score: 20, fragile: true });
    }
    return this.unavailable('No unique locator could be verified. The page may be changing.');
  }

  unavailable(reason) { return { status: 'unavailable', reason, steps: [], count: 0, identityVerified: false }; }
}
