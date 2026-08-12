import { access } from 'node:fs/promises';
for (const path of ['desktop/frontend/index.html', 'desktop/frontend/app.js', 'desktop/frontend/models/manifest.json', 'desktop/frontend/academy/courses/python-foundations.json', 'desktop/frontend/plugins/README.md', 'desktop/frontend/tasks/manifest.json']) await access(path);
console.log('desktop frontend preparation verified');
