// One daemon serves every VS Code window; each workspace keeps its own pop-ups and tasks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus, within } from '../src/bus';
import { sessions } from '../src/sessions';

test('a path belongs to a workspace only if it is inside it', () => {
  assert.ok(within('/code/shop', '/code/shop'));
  assert.ok(within('/code/shop/src', '/code/shop/'));
  assert.ok(!within('/code/shop-admin', '/code/shop'));
  assert.ok(!within('/code/blog', '/code/shop'));
});

test('a workspace is claimed only while a window with it is connected', () => {
  const off = bus.subscribe(() => {}, ['/code/shop']);
  assert.ok(bus.claimed('/code/shop/api'));
  assert.ok(!bus.claimed('/code/blog'), 'no window has /code/blog, so its pop-ups go to every window');
  off();
  assert.ok(!bus.claimed('/code/shop/api'));
});

test("a task typed in one workspace's panel doesn't apply to another", () => {
  sessions.setTask('panel:/code/shop', 'delete the QA test accounts', 'panel', '/code/shop');
  assert.equal(sessions.getTaskForWorkspace('/code/shop/db'), 'delete the QA test accounts');
  assert.equal(sessions.getTaskForWorkspace('/code/blog'), null);
});

test('task updates say which workspace they are for', () => {
  let seen: string | undefined;
  const off = bus.subscribe((e) => {
    if (e.type === 'task.updated') seen = e.cwd;
  });
  sessions.setTask('panel:/code/blog', 'write the launch post', 'panel', '/code/blog');
  off();
  assert.equal(seen, '/code/blog');
});
