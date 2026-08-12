# AIDE Plugins

Plugins are local, opt-in extensions. Discovery and manifest validation never
execute plugin code. A plugin must declare its API version, commands, views,
activation events, and capabilities before it can be trusted.

Example directory:

```text
plugins/my-plugin/aide-plugin.json
plugins/my-plugin/index.mjs
```

Manifest:

```json
{
  "id": "my-plugin",
  "name": "My Offline Plugin",
  "version": "0.1.0",
  "api_version": "1",
  "description": "Adds a local tool view.",
  "activation_events": ["onCommand:my-plugin.run"],
  "entry": "index.mjs",
  "capabilities": ["ui.view", "command.register"],
  "contributes": {
    "commands": [{"id":"my-plugin.run","title":"Run My Plugin"}],
    "views": [{"id":"my-plugin.panel","title":"My Plugin"}]
  }
}
```

The current foundation validates and trusts manifests but does not execute
plugin entrypoints. Execution will be added only behind an isolated worker or
child-process host with capability-scoped APIs.
