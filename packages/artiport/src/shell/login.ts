// Inlined into /login/index.html, which must work without a session (no external assets).

const form = document.querySelector('form')!;
const input = form.querySelector<HTMLInputElement>('input[name="passphrase"]')!;
const button = form.querySelector('button')!;
const error = document.querySelector<HTMLElement>('.error')!;
const labels = document.body.dataset;

function nextUrl(): string {
  const next = new URLSearchParams(location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function fail(message: string | undefined): void {
  error.textContent = message ?? '';
  error.hidden = false;
  input.select();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  error.hidden = true;
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase: input.value }),
    });
    if (response.ok) {
      location.replace(nextUrl());
      return;
    }
    fail(response.status === 401 ? labels.invalid : labels.failed);
  } catch {
    fail(labels.offline);
  } finally {
    button.disabled = false;
  }
});
