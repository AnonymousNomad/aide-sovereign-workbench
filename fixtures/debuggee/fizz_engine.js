const fs = require('fs');

function buildItems(limit) {
  const items = [];
  for (let i = 1; i <= limit; i++) {
    if (i % 15 === 0) items.push('FizzBuzz');
    else if (i % 3 === 0) items.push('Fizz');
    else if (i % 5 === 0) items.push('Buzz');
    else items.push(String(i));
  }
  return items;
}

function main() {
  const engine = {
    name: 'fizz-engine',
    items: buildItems(15),
    nested: { meta: { depth: 3, active: true } },
  };
  const total = engine.items.reduce((sum, item) => sum + String(item).length, 0);
  const report = { ok: true, total, engine };
  const pidFile = path.join(__dirname, 'debuggee.pid');
  fs.writeFileSync(pidFile, String(process.pid));
  console.log(JSON.stringify(report));
}

main();
