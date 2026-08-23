import { type Route } from '../server.ts';
import { EditorOptionsResponse, type EditorOptionsResponseT } from '../../../common/contracts/editor.ts';
import { editorOptionsFromSettings } from '../../../node/src/services/editor-options.mjs';
import type { SettingsService } from '../../../node/src/services/settings-service.mjs';

export function routeForEditorOptions(settings: SettingsService): Route {
  return {
    method: 'GET',
    path: '/api/editor/options',
    response: EditorOptionsResponse,
    handler: (): EditorOptionsResponseT => editorOptionsFromSettings(settings) as unknown as EditorOptionsResponseT
  };
}
