import type { User } from '@supabase/supabase-js';
import { signIn, signUp } from '../auth';

type Mode = 'login' | 'register';

export class AuthScreen {
  el: HTMLElement;
  private mode: Mode = 'login';
  private onDone: (user: User) => void | Promise<void>;

  constructor(root: HTMLElement, onDone: (user: User) => void | Promise<void>) {
    this.onDone = onDone;
    this.el = document.createElement('div');
    this.el.id = 'authscreen';
    root.appendChild(this.el);
    this.render();
  }

  private render() {
    const reg = this.mode === 'register';
    this.el.innerHTML = `
      <div class="bgword">VOIDSTRIKE</div>
      <div class="auth-box">
        <span class="auth-logo">VOIDSTRIKE</span>
        <div class="tabs auth-tabs">
          <button class="tab ${!reg ? 'on' : ''}" data-mode="login">ENTRAR</button>
          <button class="tab ${reg ? 'on' : ''}" data-mode="register">CRIAR CONTA</button>
        </div>
        <form class="form" id="authForm">
          ${reg ? '<label>NOME DE OPERADOR<input name="username" maxlength="14" required/></label>' : ''}
          <label>EMAIL<input type="email" name="email" autocomplete="email" required/></label>
          <label>PALAVRA-PASSE<input type="password" name="password" minlength="6" autocomplete="${reg ? 'new-password' : 'current-password'}" required/></label>
          <p id="authMsg" class="auth-msg"></p>
          <button class="btn-primary big" type="submit">${reg ? 'CRIAR CONTA' : 'ENTRAR'}</button>
        </form>
      </div>
    `;
    this.el.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        this.mode = b.dataset.mode as Mode;
        this.render();
      }),
    );
    this.el.querySelector('#authForm')!.addEventListener('submit', (e) => this.submit(e));
  }

  private msg(text: string, bad = true) {
    const m = this.el.querySelector<HTMLElement>('#authMsg')!;
    m.textContent = text;
    m.classList.toggle('bad', bad);
  }

  private async submit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    const btn = form.querySelector<HTMLButtonElement>('button')!;
    btn.disabled = true;
    this.msg('', false);
    try {
      let user: User;
      if (this.mode === 'register') {
        const username = String(data.get('username') || '').trim().slice(0, 14) || 'Operador';
        const res = await signUp(email, password, username);
        if (!res.session || !res.user) {
          this.msg('Conta criada! Confirma o teu email antes de entrares.', false);
          btn.disabled = false;
          return;
        }
        user = res.user;
      } else {
        const res = await signIn(email, password);
        user = res.user;
      }
      this.msg('A sincronizar os teus dados...', false);
      await this.onDone(user);
      this.el.remove();
    } catch (err) {
      this.msg(err instanceof Error ? err.message : 'Não foi possível entrar.');
      btn.disabled = false;
    }
  }
}
