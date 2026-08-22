export interface ToastInput {
  title: string;
  body?: string;
  appId?: string;
}

export declare function escapePsSingleQuoted(value: string): string;
export declare function buildToastScript(input: ToastInput): string;
