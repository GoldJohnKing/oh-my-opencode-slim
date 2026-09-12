import { describe, expect, mock, test } from 'bun:test';
import { BackgroundJobBoard } from '../../utils/background-job-board';
import { createTaskSessionManagerHook } from './index';

const PARENT = 'parent-1';

function createHook(board: BackgroundJobBoard) {
  return createTaskSessionManagerHook(
    {
      client: { session: { status: mock(async () => ({ data: {} })) } },
      directory: '/tmp',
      worktree: '/tmp',
    } as never,
    {
      maxSessionsPerAgent: 2,
      backgroundJobBoard: board,
      shouldManageSession: () => true,
    },
  );
}

const HOST_LAUNCH = (taskID: string) =>
  `The subagent is working in the background (sessionID: ${taskID}). You will be notified automatically.`;

function beforeCall(input: { callID: string; description: string }) {
  return [
    {
      tool: 'task',
      sessionID: PARENT,
      callID: input.callID,
    },
    {
      args: {
        subagent_type: 'oracle',
        description: input.description,
        prompt: 'do the review',
        background: true,
      },
    },
  ] as const;
}

function afterCall(input: { callID: string; taskID: string }) {
  return [
    { tool: 'task', sessionID: PARENT, callID: input.callID },
    { output: HOST_LAUNCH(input.taskID) },
  ] as const;
}

function created(input: { child: string; title?: string }) {
  return {
    event: {
      type: 'session.created',
      properties: {
        info: {
          id: input.child,
          parentID: PARENT,
          agent: 'oracle',
          ...(input.title ? { title: input.title } : {}),
        },
      },
    },
  };
}

const L_A = 'Review v2 compat layer PRs';
const L_B = 'Review wake/synthetic PR chain';
const L_C = 'Review v1 fix PRs';

describe('parallel same-agent pairing (incident 2026-09-12)', () => {
  test('after-hooks win: all three children registered with correct labels', async () => {
    const board = new BackgroundJobBoard();
    const hook = createHook(board);
    const sA = 'ses_aaaa1111';
    const sB = 'ses_bbbb2222';
    const sC = 'ses_cccc3333';

    // before: insertion order mirrors the incident (B, A, C)
    await hook['tool.execute.before'](
      ...beforeCall({ callID: 'call-b', description: L_B }),
    );
    await hook['tool.execute.before'](
      ...beforeCall({ callID: 'call-a', description: L_A }),
    );
    await hook['tool.execute.before'](
      ...beforeCall({ callID: 'call-c', description: L_C }),
    );

    // .521 after A registers sA
    await hook['tool.execute.after'](
      ...afterCall({ callID: 'call-a', taskID: sA }),
    );
    // .524 created(sA): board already has it — must not fence pending B
    await hook.event(created({ child: sA, title: L_A }));
    // .565 after B registers sB (was dropped by the fence in the incident)
    await hook['tool.execute.after'](
      ...afterCall({ callID: 'call-b', taskID: sB }),
    );
    // .567 created(sB)
    await hook.event(created({ child: sB, title: L_B }));
    // .573 after C registers sC (was dropped by the cross-mark in the incident)
    await hook['tool.execute.after'](
      ...afterCall({ callID: 'call-c', taskID: sC }),
    );
    // .575 created(sC)
    await hook.event(created({ child: sC, title: L_C }));

    expect(board.taskIDs()).toEqual(new Set([sA, sB, sC]));
    expect(board.get(sA)?.description).toBe(L_A);
    expect(board.get(sB)?.description).toBe(L_B);
    expect(board.get(sC)?.description).toBe(L_C);
    const aliases = new Set([sA, sB, sC].map((id) => board.get(id)?.alias));
    expect(aliases.size).toBe(3);
  });

  test('created-first ordering: tentative registration is kept correct by the after-hook', async () => {
    const board = new BackgroundJobBoard();
    const hook = createHook(board);
    const sB = 'ses_bbbb2222';

    await hook['tool.execute.before'](
      ...beforeCall({ callID: 'call-b', description: L_B }),
    );
    await hook['tool.execute.before'](
      ...beforeCall({ callID: 'call-c', description: L_C }),
    );

    // created(sB) arrives before after(B): title claims pending B
    await hook.event(created({ child: sB, title: L_B }));
    expect(board.get(sB)?.description).toBe(L_B);

    await hook['tool.execute.after'](
      ...afterCall({ callID: 'call-b', taskID: sB }),
    );
    expect(board.get(sB)?.description).toBe(L_B);
    expect(board.get(sB)?.state).toBe('running');
  });

  test('no-title hosts: placeholder is corrected by the matching after-hook', async () => {
    const board = new BackgroundJobBoard();
    const hook = createHook(board);
    const sC = 'ses_cccc3333';

    await hook['tool.execute.before'](
      ...beforeCall({ callID: 'call-b', description: L_B }),
    );
    await hook['tool.execute.before'](
      ...beforeCall({ callID: 'call-c', description: L_C }),
    );

    // Ambiguous (two same-agent pendings, no title): placeholder, not a guess
    await hook.event(created({ child: sC }));
    expect(board.get(sC)?.description).toBe('unattributed oracle task');

    // The owning call's after-hook corrects the description
    await hook['tool.execute.after'](
      ...afterCall({ callID: 'call-c', taskID: sC }),
    );
    expect(board.get(sC)?.description).toBe(L_C);
  });

  test('stale no-title created event cannot cross-mark or misattribute', async () => {
    const board = new BackgroundJobBoard();
    const hook = createHook(board);
    const sA = 'ses_aaaa1111';
    const sX = 'ses_xxxx9999';
    const sB = 'ses_bbbb2222';

    // call A completes before its created event: after-hook consumes its
    // pending and registers sA
    await hook['tool.execute.before'](
      ...beforeCall({ callID: 'call-a', description: L_A }),
    );
    await hook['tool.execute.after'](
      ...afterCall({ callID: 'call-a', taskID: sA }),
    );

    // call B still pending; a late no-title (v1-style) child whose owning
    // call was already consumed must not claim pending B — it gets a
    // placeholder instead of B's label, so no cross-mark can form
    await hook['tool.execute.before'](
      ...beforeCall({ callID: 'call-b', description: L_B }),
    );
    await hook.event(created({ child: sX }));
    expect(board.get(sX)?.description).toBe('unattributed oracle task');

    // after(B) parses sB from its own output; pending B was never
    // cross-marked, so sB registers cleanly with the right label
    await hook['tool.execute.after'](
      ...afterCall({ callID: 'call-b', taskID: sB }),
    );

    expect(board.taskIDs()).toEqual(new Set([sA, sX, sB]));
    expect(board.get(sB)?.description).toBe(L_B);
    expect(board.get(sA)?.description).toBe(L_A);
    // the stale child keeps the honest placeholder label, never B's
    expect(board.get(sX)?.description).toBe('unattributed oracle task');
  });
});
