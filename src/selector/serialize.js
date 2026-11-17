export function quote(value) {
  return JSON.stringify(String(value)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// One typed representation drives both the evaluator and the copied code.
export function toSelector(steps) {
  return steps.map(step => {
    switch (step.kind) {
      case 'role': return `internal:role=${step.value}${step.name !== undefined ? `[name=${quote(step.name)}s]` : ''}`;
      case 'label': return `internal:label=${quote(step.value)}s`;
      case 'placeholder': return `internal:attr=[placeholder=${quote(step.value)}s]`;
      case 'testId': return `internal:testid=[data-testid=${quote(step.value)}s]`;
      case 'text': return `internal:text=${quote(step.value)}s`;
      case 'css': return `css=${step.value}`;
      case 'xpath': return `xpath=${step.value}`;
      case 'filterText': return `internal:has-text=${quote(step.value)}i`;
      case 'filterHas': return `internal:has=${quote(toSelector(step.steps))}`;
      case 'nth': return `nth=${step.index}`;
      default: throw new Error(`Unsupported local selector step: ${step.kind}`);
    }
  }).join(' >> ');
}

export function expression(steps, language = 'python', base = 'page') {
  const py = language === 'python';
  let result = base;
  for (const step of steps) {
    const value = quote(step.value ?? '');
    switch (step.kind) {
      case 'role':
        result += py
          ? `.get_by_role(${value}${step.name !== undefined ? `, name=${quote(step.name)}, exact=True` : ''})`
          : `.getByRole(${value}${step.name !== undefined ? `, { name: ${quote(step.name)}, exact: true }` : ''})`;
        break;
      case 'label': case 'placeholder': case 'text': {
        const names = { label: ['get_by_label', 'getByLabel'], placeholder: ['get_by_placeholder', 'getByPlaceholder'], text: ['get_by_text', 'getByText'] };
        result += py ? `.${names[step.kind][0]}(${value}, exact=True)` : `.${names[step.kind][1]}(${value}, { exact: true })`;
        break;
      }
      case 'testId': result += `.${py ? 'get_by_test_id' : 'getByTestId'}(${value})`; break;
      case 'css': result += `.locator(${value})`; break;
      case 'xpath': result += `.locator(${quote(`xpath=${step.value}`)})`; break;
      case 'filterText': result += py ? `.filter(has_text=${value})` : `.filter({ hasText: ${value} })`; break;
      case 'filterHas': {
        const inner = expression(step.steps, language);
        result += py ? `.filter(has=${inner})` : `.filter({ has: ${inner} })`;
        break;
      }
      case 'nth': result += `.nth(${step.index})`; break;
      case 'frame': result += py ? '.content_frame' : '.contentFrame()'; break;
      default: throw new Error(`Unsupported code step: ${step.kind}`);
    }
  }
  return result;
}
