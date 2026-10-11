import { $ } from './util.js';

export interface ConfirmOptions {
  title: string;
  /** Trusted HTML built from escaped parts. */
  body: string;
  confirmText: string;
  tone?: 'primary' | 'long' | 'short' | 'danger';
  /** Runs when the user confirms. Throw to keep the dialog open and show the error. */
  run: (ctl: ConfirmController) => Promise<void>;
  /** Maps a thrown value to the message shown in the dialog. */
  describeError: (err: unknown) => string;
}

export interface ConfirmController {
  setBody(html: string): void;
  setBusy(text: string): void;
}

const TONES = ['btn-primary', 'btn-long', 'btn-short', 'btn-danger'];

/** Open the shared confirmation dialog. Resolves true once `run` succeeded, false when dismissed. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const dlg = $<HTMLDialogElement>('dlg-confirm');
  const body = $('dlg-confirm-body');
  const err = $('dlg-confirm-err');
  const ok = $<HTMLButtonElement>('dlg-confirm-ok');
  const cancel = $<HTMLButtonElement>('dlg-confirm-cancel');
  const x = $<HTMLButtonElement>('dlg-confirm-x');
  $('dlg-confirm-title').textContent = opts.title;
  body.innerHTML = opts.body;
  err.hidden = true;
  err.textContent = '';
  ok.classList.remove(...TONES);
  ok.classList.add(`btn-${opts.tone ?? 'primary'}`);
  ok.textContent = opts.confirmText;
  ok.disabled = false;
  cancel.disabled = false;

  return new Promise<boolean>((resolve) => {
    let busy = false;
    let result = false;
    const ctl: ConfirmController = {
      setBody: (html) => {
        body.innerHTML = html;
      },
      setBusy: (text) => {
        ok.textContent = text;
      },
    };
    const onOk = async () => {
      if (busy) return;
      busy = true;
      ok.disabled = true;
      cancel.disabled = true;
      ok.classList.add('busy');
      err.hidden = true;
      try {
        await opts.run(ctl);
        result = true;
        dlg.close();
      } catch (e) {
        err.textContent = opts.describeError(e);
        err.hidden = false;
        ok.textContent = 'Try again';
      } finally {
        busy = false;
        ok.disabled = false;
        cancel.disabled = false;
        ok.classList.remove('busy');
      }
    };
    const onCancel = () => {
      if (!busy) dlg.close();
    };
    const onClose = () => {
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      x.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
      dlg.removeEventListener('cancel', onEsc);
      resolve(result);
    };
    const onEsc = (e: Event) => {
      if (busy) e.preventDefault();
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    x.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    dlg.addEventListener('cancel', onEsc);
    dlg.showModal();
    cancel.focus();
  });
}

/** Render label/value pairs as a definition list. Values must already be escaped. */
export function kv(rows: Array<[string, string]>): string {
  return `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

export function closeAllDialogs(): void {
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
}
