import { createEvaluator, withSnapshot, getAriaRole, getElementAccessibleNameText, getElementLabels, elementText, isElementVisible } from 'playwright-dom';
import { toSelector } from './serialize.js';

export class SelectorValidator {
  constructor(window) {
    this.document = window.document;
    this.evaluator = createEvaluator(window);
  }

  role(element) { return getAriaRole(element); }
  name(element) { return getElementAccessibleNameText(element, false); }
  labels(element) { return getElementLabels(new Map(), element).map(label => label.normalized); }
  text(element) { return elementText(new Map(), element).normalized; }
  visible(element) { return isElementVisible(element); }
  snapshot(work) { return withSnapshot(this.evaluator, work); }

  query(steps, scope = this.document) {
    try {
      return this.evaluator.querySelectorAll(this.evaluator.parseSelector(toSelector(steps)), scope);
    } catch {
      return [];
    }
  }

  validate(steps, target, scope = this.document) {
    const matches = this.query(steps, scope);
    return { valid: target.isConnected && matches.length === 1 && matches[0] === target, count: matches.length, matches };
  }
}
