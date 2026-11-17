import { SelectorGenerator } from '../src/selector/generator.js';
import { meaningfulTarget } from '../src/selector/dom.js';
import { expression, toSelector } from '../src/selector/serialize.js';

const generator = new SelectorGenerator(window);
window.locatorLensTest = {
  inspect(raw) {
    const target = meaningfulTarget(raw, element => generator.validator.role(element));
    const result = generator.generate(target);
    return { ...result, python: expression(result.steps), javascript: expression(result.steps, 'javascript'), selector: toSelector(result.steps), normalized: target !== raw };
  },
  query: steps => generator.validator.query(steps),
};
