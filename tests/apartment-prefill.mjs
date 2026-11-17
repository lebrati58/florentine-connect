import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function afterLogin()');
const end = source.indexOf('async function onSignedIn()', start);
function input(value = '') { return { value, dataset: {}, handlers: {}, addEventListener(k, cb) { this.handlers[k] = cb; } }; }
const form = { apt: input(), floor: input(), handlers: {}, addEventListener(k, cb) { this.handlers[k] = cb; } };
const state = { login: { tower: 4, floor: '', number: '' } };
runInNewContext(source.slice(start, end) + '\nafterLogin();', { S: state, $: () => form, sessionStorage: { getItem: () => null } });
form.floor.value = '9'; form.floor.handlers.input();
assert.equal(form.apt.value, '49');
form.apt.value = '491'; form.apt.handlers.input();
assert.equal(state.login.number, '491');
form.floor.value = '10'; form.floor.handlers.input();
assert.equal(form.apt.value, '4101');
form.apt.value = 'custom'; form.apt.handlers.input();
assert.equal(state.login.number, 'custom');
for (let tower = 1; tower <= 6; tower++) {
  state.login.tower = tower; form.apt.value = ''; form.apt.dataset = {};
  form.floor.value = '9'; form.floor.handlers.input();
  assert.equal(form.apt.value, String(tower) + '9');
}
assert.ok(source.includes('[1, 2, 3, 4, 5, 6].map'));
console.log('Apartment prefill: six buildings, 491, multi-digit floor, manual correction passed.');
