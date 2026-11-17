import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function apartmentChoices(');
const end = source.indexOf('function viewLogin()', start);
const context = {};
runInNewContext(source.slice(start, end) + '\nthis.choices = apartmentChoices;', context);
const choices = (tower, floor) => Array.from(context.choices(tower, floor));
assert.deepEqual(choices(2, 5), ['251','252','253','254','255','256']);
assert.deepEqual(choices(4, 9), ['491','492']);
for (let tower = 1; tower <= 6; tower++) {
  for (let floor = 1; floor <= 9; floor++) {
    const list = choices(tower, floor);
    assert.equal(list.length, floor === 9 ? 2 : 6);
    assert.equal(new Set(list).size, list.length);
    for (const n of list) { assert.equal(n.slice(0,2), String(tower) + floor); assert.ok(Number(n) >= 111 && Number(n) <= 692); }
  }
}
for (const [t, f] of [[0,1],[7,1],[1,0],[1,10],[1,''],[null,9]]) assert.deepEqual(choices(t,f), []);
assert.ok(source.includes('<select class="input" id="aptInput"'));
assert.ok(source.includes('!apartmentChoices(S.login.tower, S.login.floor).includes(number)'));
console.log('54 building/floor combinations, six/two options, invalid inputs and select validation passed.');
