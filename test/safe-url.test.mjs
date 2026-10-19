import test from 'node:test';
import assert from 'node:assert/strict';
import {safeHref} from '../web/v2/safe-url.js';

test('safeHref keeps http(s) links and rejects script, data and unparsable values', () => {
  assert.equal(safeHref('https://jobs.example.com/a?b=1'), 'https://jobs.example.com/a?b=1');
  assert.equal(safeHref('http://example.com'), 'http://example.com/');
  for (const value of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', '/relative', '', null, undefined]) assert.equal(safeHref(value), null, String(value));
});
