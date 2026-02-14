/**
 * Tests for the TodoStateChange → StatusStateChange rename and
 * backwards-compatibility layer.
 *
 * Written TDD-style — tests are added BEFORE the implementation so
 * they fail first, then pass once the production code catches up.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { HookSystem } from './hook-system.ts';

describe('StatusStateChange rename', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'status-rename-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ---- rename ----

  it('accepts StatusStateChange as a hook event in hooks.json', async () => {
    writeFileSync(join(tempDir, 'hooks.json'), JSON.stringify({
      hooks: {
        StatusStateChange: [{
          matcher: 'done',
          hooks: [{ type: 'command', command: 'echo done' }],
        }],
      },
    }));

    const system = new HookSystem({
      workspaceRootPath: tempDir,
      workspaceId: 'test-workspace',
    });

    const matchers = system.getMatchersForEvent('StatusStateChange' as any);
    expect(matchers).toHaveLength(1);
    expect(matchers[0]?.matcher).toBe('done');

    await system.dispose();
  });

  it('does not accept bare TodoStateChange as a hook event', async () => {
    writeFileSync(join(tempDir, 'hooks.json'), JSON.stringify({
      hooks: {
        TodoStateChange: [{
          matcher: 'done',
          hooks: [{ type: 'command', command: 'echo done' }],
        }],
      },
    }));

    const system = new HookSystem({
      workspaceRootPath: tempDir,
      workspaceId: 'test-workspace',
    });

    // Before the compat layer, the old name should simply be dropped
    const matchers = system.getMatchersForEvent('TodoStateChange' as any);
    expect(matchers).toHaveLength(0);

    await system.dispose();
  });

  it('emits StatusStateChange when session status changes', async () => {
    const system = new HookSystem({
      workspaceRootPath: tempDir,
      workspaceId: 'test-workspace',
    });

    system.setInitialSessionMetadata('s1', { todoState: 'backlog' });

    const emitSpy = spyOn(system.eventBus, 'emit');

    const events = await system.updateSessionMetadata('s1', {
      todoState: 'todo',
    });

    expect(events).toContain('StatusStateChange');
    expect(events).not.toContain('TodoStateChange');
    expect(emitSpy).toHaveBeenCalledWith(
      'StatusStateChange',
      expect.objectContaining({ oldState: 'backlog', newState: 'todo' }),
    );

    await system.dispose();
  });
});
