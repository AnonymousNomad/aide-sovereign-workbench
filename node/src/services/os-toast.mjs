export function escapePsSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

const DEFAULT_APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';

export function buildToastScript({ title, body = '', appId = DEFAULT_APP_ID }) {
  const safeTitle = escapePsSingleQuoted(title);
  const safeBody = escapePsSingleQuoted(body);
  return [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
    "$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
    "$template.SelectSingleNode('//text[@id=\"1\"]').InnerText = '" + safeTitle + "'",
    "$template.SelectSingleNode('//text[@id=\"2\"]').InnerText = '" + safeBody + "'",
    '$toast = [Windows.UI.Notifications.ToastNotification]::new($template)',
    '$toast.Tag = \'aide\'',
    '$toast.Group = \'aide\'',
    "$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('" + appId + "')",
    'try { $notifier.Show($toast) } catch { exit 0 }'
  ].join('\r\n');
}
