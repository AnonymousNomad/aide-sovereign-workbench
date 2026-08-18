import { SessionFile, type SessionFileT } from '../../../common/contracts/session.ts';
import { api } from './api.ts';

const SAVE_DEBOUNCE_MS = 500;

export class SessionService {
  current: SessionFileT;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<SessionFileT> | null = null;

  constructor(initial: SessionFileT = { version: 1, tabs: [] }) {
    this.current = initial;
  }

  async restore(): Promise<SessionFileT> {
    const session = await api.sessionGet();
    const parsed = SessionFile.safeParse(session);
    this.current = parsed.success ? parsed.data : this.current;
    return this.current;
  }

  set(updater: (prev: SessionFileT) => SessionFileT): void {
    this.current = updater(this.current);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  async flush(): Promise<SessionFileT> {
    if (this.saving !== null) return this.saving;
    const snapshot = this.current;
    this.saving = api
      .sessionPut(snapshot)
      .then(saved => {
        this.current = saved;
        return saved;
      })
      .finally(() => {
        this.saving = null;
      });
    return this.saving;
  }
}