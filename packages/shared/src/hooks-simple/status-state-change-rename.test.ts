/**
 * Tests for the TodoStateChange → StatusStateChange rename and
 * backwards-compatibility layer.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { HookSystem } from './hook-system.ts';
import type { HookEvent } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;
let system: HookSystem;

function writeHooksJson(hooks: Record<string, unknown[]>) {
  writeFileSync(
    join(tempDir, 'hooks.json'),
    JSON.stringify({ hooks }),
  );
}

function createSystem() {
  system = new HookSystem({
    workspaceRootPath: tempDir,
    workspaceId: 'test-workspace',
  });
  return system;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StatusStateChange rename', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'status-rename-test-'));
  });

  afterEach(async () => {
    await system?.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ---- new name works ----

  it('accepts StatusStateChange as a hook event', () => {
    writeHooksJson({
      StatusStateChange: [{
        matcher: 'done',
        hooks: [{ type: 'command', command: 'echo done' }],
      }],
    });

    const matchers = createSystem().getMatchersForEvent('StatusStateChange' as HookEvent);
    expect(matchers).toHaveLength(1);
    expect(matchers[0]?.matcher).toBe('done');
  });

  it('emits StatusStateChange (not TodoStateChange) on status change', async () => {
    const sys = createSystem();
    sys.setInitialSessionMetadata('s1', { todoState: 'backlog' });

    const emitSpy = spyOn(sys.eventBus, 'emit');
    const events = await sys.updateSessionMetadata('s1', { todoState: 'todo' });

    expect(events).toContain('StatusStateChange');
    expect(events).not.toContain('TodoStateChange');
    expect(emitSpy).toHaveBeenCalledWith(
      'StatusStateChange',
      expect.objectContaining({ oldState: 'backlog', newState: 'todo' }),
    );
  });

  // ---- backwards compatibility ----

  it('remaps TodoStateChange hooks to StatusStateChange', () => {
    writeHooksJson({
      TodoStateChange: [{
        matcher: 'done',
        hooks: [{ type: 'command', command: 'echo done' }],
      }],
    });

    const sys = createSystem();

    // Old key remapped — matchers accessible under new name
    const matchers = sys.getMatchersForEvent('StatusStateChange' as HookEvent);
    expect(matchers).toHaveLength(1);
    expect(matchers[0]?.matcher).toBe('done');

    // Old key no longer exists
    const oldMatchers = sys.getMatchersForEvent('TodoStateChange' as HookEvent);
    expect(oldMatchers).toHaveLength(0);
  });

  it('logs a deprecation warning for TodoStateChange', () => {
    const warnSpy = spyOn(console, 'warn');

    writeHooksJson({
      TodoStateChange: [{
        matcher: 'done',
        hooks: [{ type: 'command', command: 'echo done' }],
      }],
    });

    createSystem();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('TodoStateChange'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('StatusStateChange'),
    );

    warnSpy.mockRestore();
  });

  it('merges matchers when both old and new names are present', () => {
    writeHooksJson({
      TodoStateChange: [{
        matcher: 'done',
        hooks: [{ type: 'command', command: 'echo legacy' }],
      }],
      StatusStateChange: [{
        matcher: 'in_progress',
        hooks: [{ type: 'command', command: 'echo new' }],
      }],
    });

    const matchers = createSystem().getMatchersForEvent('StatusStateChange' as HookEvent);
    expect(matchers).toHaveLength(2);

    const matcherValues = matchers.map((m: any) => m.matcher);
    expect(matcherValues).toContain('done');
    expect(matcherValues).toContain('in_progress');
  });
});
