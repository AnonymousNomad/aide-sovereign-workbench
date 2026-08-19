export interface LspBridge {
  onOpen(relPath: string, languageId: string): void;
  onChange(relPath: string, version: number): void;
  onSave(relPath: string): void;
  onClose(relPath: string): void;
}

export const nullLsp: LspBridge = {
  onOpen() {},
  onChange() {},
  onSave() {},
  onClose() {}
};