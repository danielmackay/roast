import { expect, test } from 'claude-code/testing'

import { formatAnswers, parseRound } from './round'

const ROUND = `Some preamble.

❓ **Q1** - **Storage**: Where should answers live?

Options:
- **A)** In memory
- **B)** On disk

➡️ **B** — on disk survives restarts.

---

❓ **Q2** - **Naming**: Should we call it roast?

➡️ Yes, roast is short and fun.

That's round one.`

const PANE = {
  plugin: 'roast',
  component: 'Pane',
  requestId: 'roast',
  props: {
    title: 'Roast',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('parses the grilling round format', async () => {
  const qs = parseRound(ROUND)
  expect(qs.length).toBe(2)
  expect(qs[0]?.title).toBe('Storage')
  expect(qs[0]?.options.map(o => o.key)).toEqual(['A', 'B'])
  expect(qs[0]?.recommendedOption).toBe('B')
  expect(qs[1]?.recommendation).toBe('Yes, roast is short and fun.')
  expect(qs[1]?.options.length).toBe(0)
})

test('formats answers with comments', async () => {
  const [q1, q2] = parseRound(ROUND)
  const text = formatAnswers({
    id: 'r1',
    n: 1,
    source: 'parsed',
    createdAt: 0,
    questions: [q1!, q2!],
    answers: {
      Q1: { kind: 'option', option: 'A', comment: 'keep it simple' },
      Q2: { kind: 'reject' },
    },
    status: 'open',
  })
  expect(text).toContain('Q1 (Storage): Option A (In memory).')
  expect(text).toContain('Comment: keep it simple')
  expect(text).toContain('Q2 (Naming): Disagree with your recommendation.')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`tool round opens the pane and sends answers (${surface})`, async ($, on) => {
    const submitted: string[] = []
    on('command.register', () => ({ value: { command: 'roast' } }))
    on('tool.register', () => ({ value: { tool: 'mcp__roast__ask_round' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.focus', { plugin: '*' }, () => ({}))
    on('clock.now', () => ({ value: 1_000 }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('prompt.submit', (_, e) => {
      submitted.push(e.text)
      return { text: e.text }
    })

    await $.session.start({ cwd: '/', surface, isInteractive: true })
    const ran = await $.tool.call({
      tool: 'mcp__roast__ask_round',
      questions: [
        {
          title: 'Database',
          body: 'Which database?',
          recommendation: 'Postgres',
          options: [{ label: 'Postgres' }, { label: 'SQLite' }],
          recommendedOption: 'A',
        },
        { title: 'Auth', body: 'Use OAuth?', recommendation: 'Yes, OAuth.' },
      ],
    } as never)
    expect(ran.deny).toBeUndefined()

    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Database/ }))?.text).toContain('Q1')

    // Q1 offers options, so Agree and Disagree are not drawn for it.
    expect(await ui.find({ key: 'agree' })).toBeUndefined()
    expect(await ui.find({ key: 'opt:Q1:B' })).toBeDefined()
    // The hidden `c` Button is drawn and pressable.
    expect((await ui.press({ key: 'comment-hotkey' }))?.element).toBe('comment-hotkey')
    await ui.press({ key: 'opt:Q1:B' })
    // Q2 is unanswered, so Send holds the round back.
    await ui.press({ key: 'send' })
    expect(submitted.length).toBe(0)

    await ui.press({ key: 'all' })
    await ui.press({ key: 'send' })

    expect(submitted.length).toBe(1)
    expect(submitted[0]).toContain('Q1 (Database): Option B (SQLite).')
    expect(submitted[0]).toContain('Q2 (Auth): Agree with your recommendation.')
    await ui.unmount()
  })
}
