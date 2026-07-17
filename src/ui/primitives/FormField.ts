export interface FormFieldOptions {
  label: string;
  control: HTMLElement;
  hint?: string;
  error?: string;
  required?: boolean;
}

let formFieldSequence = 0;

export function createFormField(options: FormFieldOptions): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'ui-form-field';
  const controlId = options.control.id || `ui-field-${++formFieldSequence}`;
  options.control.id = controlId;
  const label = document.createElement('label');
  label.htmlFor = controlId;
  label.textContent = options.required ? `${options.label} *` : options.label;
  wrapper.append(label, options.control);
  if (options.hint || options.error) {
    const detail = document.createElement('div');
    detail.id = `${controlId}-detail`;
    detail.className = options.error ? 'ui-form-field-error' : 'ui-form-field-hint';
    detail.textContent = options.error ?? options.hint ?? '';
    options.control.setAttribute('aria-describedby', detail.id);
    if (options.error) options.control.setAttribute('aria-invalid', 'true');
    wrapper.append(detail);
  }
  return wrapper;
}
