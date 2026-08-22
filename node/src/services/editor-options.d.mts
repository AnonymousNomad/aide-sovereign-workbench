export interface EditorOptions {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  minimap_enabled: boolean;
  stickyScroll_enabled: boolean;
  folding_enabled: boolean;
  bracketPairColorization_enabled: boolean;
  multiCursorModifier: string;
}

export declare function editorOptionsFromSettings(settings: { merged(): Record<string, unknown> }): EditorOptions;
