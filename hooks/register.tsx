import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RoastAnswer, RoastQuestion, RoastRound, RoastView } from '../types'
import {
  describe,
  fillRecommended,
  formatAnswers,
  isAnswered,
  isRoastSkill,
  mark,
  parseRound,
  questionsFromTool,
  skillAddendum,
} from './round'

const PANE = 'roast'
const TOOL = 'mcp__roast__ask_round'

const rounds = atom({ plugin: 'roast', key: 'rounds' } as const, [] as RoastRound[], {
  shape: 'rounds-1',
})
const cursor = atom({ plugin: 'roast', key: 'cursor' } as const, 0)
const view = atom({ plugin: 'roast', key: 'view' } as const, 'round' as RoastView)
const isActive = atom({ plugin: 'roast', key: 'isActive' } as const, false)

// The hidden Button that carries the `c` shortcut, and the control the
// arrows stop on before it, so ←/→ step over it.
const COMMENT_HOTKEY = 'comment-hotkey'
const beforeComment = (q: RoastQuestion): string => {
  const last = q.options.length >= 2 ? q.options.at(-1) : undefined
  return last ? `opt:${q.id}:${last.key}` : 'disagree'
}

const TOOL_SCHEMA = {
  type: 'object',
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      description: 'Every question of this round, in order.',
      items: {
        type: 'object',
        required: ['title', 'body', 'recommendation'],
        properties: {
          title: { type: 'string', description: 'Short question title.' },
          body: { type: 'string', description: 'The question in full, markdown.' },
          recommendation: {
            type: 'string',
            description: 'Your recommended answer; "agree" takes it.',
          },
          options: {
            type: 'array',
            description: 'The choices, when the question offers several.',
            items: {
              type: 'object',
              required: ['label'],
              properties: {
                key: { type: 'string', description: 'A, B, C...' },
                label: { type: 'string' },
              },
            },
          },
          recommendedOption: {
            type: 'string',
            description: 'The key of the recommended option, when there are options.',
          },
        },
      },
    },
  },
}

async function openRound($: EngineInterface, round: RoastRound): Promise<void> {
  const title = `Roast · round ${round.n}`
  const opened = await $.ui.open({ id: PANE, title, focus: true })
  if (!opened.isPlaced) {
    $.ui.toast(`Round ${round.n} ready (${round.questions.length} questions): /roast to answer`)
  }
}

// Moving the ring is a nicety: a refused move leaves the press done.
async function focusOn($: EngineInterface, key: string): Promise<void> {
  try {
    await $.ui.focus({ requestId: PANE, key })
  } catch {
    // The pane may not hold the keyboard (a click from the desktop app).
  }
}

async function addRound(
  $: EngineInterface,
  questions: RoastQuestion[],
  source: RoastRound['source'],
): Promise<RoastRound> {
  const now = await $.clock.now()
  let made: RoastRound | undefined
  await update($, rounds, list => {
    made = {
      id: `r${now}`,
      n: list.length + 1,
      source,
      createdAt: now,
      questions,
      answers: {},
      status: 'open',
    }
    return [...list, made].slice(-50)
  })
  await update($, cursor, () => 0)
  await update($, view, () => 'round' as RoastView)
  $.ui.status(`round ${made!.n} open`)
  return made!
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'roast',
      description: 'Open the roast pane to answer the current grilling round',
    })
    await $.tool.register({
      name: 'ask_round',
      description:
        'Shows one grilling round in the roast pane, where the person answers each question: agree or disagree with your recommendation, pick an option, or comment. Use only while running a grilling skill or wayfinder. Returns at once; the answers arrive as the person\'s next message.',
      inputSchema: TOOL_SCHEMA,
      isDeferred: true,
    })
    return next(e)
  })

  // Teach the grilling skills and wayfinder to hand their rounds to the pane.
  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    if (!isRoastSkill(e.skill)) return result
    await update($, isActive, () => true)
    return { text: result.text + skillAddendum(e.skill) }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const questions = questionsFromTool(e)
    if (typeof questions === 'string') return { deny: questions }
    await update($, isActive, () => true)
    const round = await addRound($, questions, 'tool')
    await openRound($, round)
    return {
      result: `Round ${round.n} (${questions.length} questions) is shown in the roast pane. End your turn now with one short line; the answers arrive as the person's next message.`,
    }
  }).catch(() => ({
    deny: 'The roast pane failed to open this round. Write the round as text instead.',
  }))

  // Fallback: a round written as text in the grilling format.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return result
    if (!(await read($, isActive))) return result
    const questions = parseRound(e.answer)
    if (questions.length === 0) return result
    const now = await $.clock.now()
    const list = await read($, rounds)
    const turnStart = now - e.durationMs
    if (list.some(r => r.createdAt >= turnStart)) return result
    const round = await addRound($, questions, 'parsed')
    await openRound($, round)
    return result
  })

  // The arrows never rest on the hidden shortcut Button: coming from the
  // comment box they go back to Disagree, from anywhere else into the box.
  let lastFocus: string | undefined
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    if (e.element !== COMMENT_HOTKEY) {
      const moved = await next(e)
      if (moved.deny === undefined) lastFocus = e.element
      return moved
    }
    const list = await read($, rounds)
    const round = list.at(-1)
    const at = await read($, cursor)
    const q = round?.questions[at] ?? round?.questions[0]
    if (!round || !q) return next(e)
    const commentKey = `comment:${round.id}:${q.id}`
    const target = lastFocus === commentKey ? beforeComment(q) : commentKey
    const moved = await next({ ...e, element: target })
    if (moved.deny === undefined) lastFocus = target
    return moved
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'roast' }, async $ => {
    const list = await read($, rounds)
    await $.ui.open({
      id: PANE,
      title: list.length ? `Roast · round ${list.at(-1)!.n}` : 'Roast',
      focus: true,
    })
    return { text: list.length ? 'Roast pane opened.' : 'No grilling rounds yet.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Markdown } = $.ui.resolve(e)
    const list = await read($, rounds)
    const shown = await read($, view)
    const round = list.at(-1)

    const setView = (v: RoastView) => () => void update($, view, () => v)

    if (!round || shown === 'history') {
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Text bold>Rounds this session</Text>
            {round && (
              <Button key="back" hotkey="h" onPress={setView('round')}>
                Back to round
              </Button>
            )}
          </Box>
          {list.length === 0 && (
            <Text dimColor>No grilling rounds yet. Run /grill-me or /grill-with-docs.</Text>
          )}
          {[...list].reverse().map(r => (
            <Box key={`hist:${r.id}`} flexDirection="column">
              <Text bold>
                Round {r.n} <Text dimColor>· {r.status} · {r.questions.length} questions</Text>
              </Text>
              {r.questions.map(q => (
                <Text>
                  {mark(r.answers[q.id])} {q.id} {q.title}
                  <Text dimColor> → {describe(q, r.answers[q.id]).split('\n')[0]}</Text>
                </Text>
              ))}
            </Box>
          ))}
        </Box>
      )
    }

    const total = round.questions.length
    const at = Math.min(Math.max(0, await read($, cursor)), total - 1)
    const q = round.questions[at] ?? round.questions[0]!
    const answer: RoastAnswer | undefined = round.answers[q.id]
    const commentKey = `comment:${round.id}:${q.id}`
    // A question with options is answered by picking one; Agree and
    // Disagree are for a single recommendation.
    const hasChoice = q.options.length >= 2
    const isSent = round.status === 'sent'
    const done = round.questions.filter(x => isAnswered(round.answers[x.id])).length

    const setAnswer = async (patch: Partial<RoastAnswer>) => {
      await update($, rounds, all =>
        all.map(r =>
          r.id === round.id
            ? { ...r, answers: { ...r.answers, [q.id]: { ...r.answers[q.id], ...patch } } }
            : r,
        ),
      )
    }
    const go = (i: number) => () => void update($, cursor, () => Math.min(Math.max(0, i), total - 1))
    const choose = (patch: Partial<RoastAnswer>) => async () => {
      await setAnswer(patch)
      await focusOn($, `comment:${round.id}:${q.id}`)
    }
    const nextUnanswered = async () => {
      const fresh = (await read($, rounds)).find(r => r.id === round.id) ?? round
      const later = fresh.questions.findIndex(
        (x, i) => i > at && !isAnswered(fresh.answers[x.id]),
      )
      const any = fresh.questions.findIndex(x => !isAnswered(fresh.answers[x.id]))
      const target = later >= 0 ? later : any
      if (target >= 0) {
        await update($, cursor, () => target)
      } else {
        await focusOn($, 'send')
      }
    }
    const acceptAll = async () => {
      await update($, rounds, all =>
        all.map(r => (r.id === round.id ? { ...r, answers: fillRecommended(r) } : r)),
      )
      await focusOn($, 'send')
    }
    const send = async () => {
      const now = await $.clock.now()
      const fresh = (await read($, rounds)).find(r => r.id === round.id) ?? round
      if (fresh.status === 'sent') return
      const open = fresh.questions.findIndex(x => !isAnswered(fresh.answers[x.id]))
      if (open >= 0) {
        // Every question needs an answer; a comment counts when none fits.
        await update($, cursor, () => open)
        $.ui.toast(`Answer ${fresh.questions[open]?.id ?? 'every question'} first: agree, disagree, an option, or a comment.`)
        return
      }
      await update($, rounds, all =>
        all.map(r => (r.id === round.id ? { ...r, status: 'sent' as const, sentAt: now } : r)),
      )
      $.ui.status(`round ${fresh.n} sent`)
      await $.prompt.submit({ text: formatAnswers(fresh), asUser: true })
    }

    if (isSent) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Round {round.n} sent</Text>
          <Text dimColor>Waiting for the next round. It opens here by itself.</Text>
          <Box flexDirection="column">
            {round.questions.map(x => (
              <Text>
                {mark(round.answers[x.id])} {x.id} {x.title}
              </Text>
            ))}
          </Box>
          <Button key="history" hotkey="h" onPress={setView('history')}>
            History
          </Button>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Text bold>Round {round.n}</Text>
          <Text dimColor>
            {done}/{total} answered
          </Text>
          {round.questions.map((x, i) => (
            <Button
              key={`jump:${x.id}`}
              plain
              dimColor={i !== at}
              onPress={go(i)}
            >
              {x.id}
              {mark(round.answers[x.id])}
            </Button>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text bold color="suggestion">
            ❓ {q.id} · {q.title}
          </Text>
          {q.body !== '' && <Markdown text={q.body} />}
        </Box>

        {q.recommendation !== '' && (
          <Box flexDirection="column">
            <Text bold>➡️ Recommended</Text>
            <Markdown text={q.recommendation} />
          </Box>
        )}

        {hasChoice && (
          <Box flexDirection="column">
            {q.options.map((o, i) => (
              <Button
                key={`opt:${q.id}:${o.key}`}
                plain
                autoFocus={i === 0 ? true : undefined}
                hotkey={i < 9 ? String(i + 1) : undefined}
                onPress={choose({ kind: 'option', option: o.key })}
              >
                {answer?.kind === 'option' && answer.option === o.key ? '● ' : '○ '}
                {o.key}) {o.label}
                {o.key === q.recommendedOption ? <Text dimColor> ★ recommended</Text> : ''}
              </Button>
            ))}
          </Box>
        )}

        {!hasChoice && (
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Button
              key="agree"
              hotkey="a"
              variant={answer?.kind === 'accept' ? 'primary' : undefined}
              autoFocus
              onPress={choose({ kind: 'accept', option: undefined })}
            >
              {answer?.kind === 'accept' ? '✓ Agree' : 'Agree'}
            </Button>
            <Button
              key="disagree"
              hotkey="d"
              variant={answer?.kind === 'reject' ? 'primary' : undefined}
              onPress={choose({ kind: 'reject', option: undefined })}
            >
              {answer?.kind === 'reject' ? '✗ Disagree' : 'Disagree'}
            </Button>
          </Box>
        )}

        {/* Hidden: carries the `c` shortcut into the comment box. */}
        <Box display="none">
          <Button key={COMMENT_HOTKEY} hotkey="c" onPress={() => void focusOn($, commentKey)}>
            Comment
          </Button>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Input
            key={commentKey}
            placeholder="why, or your own answer; Enter for next question"
            value={answer?.comment ?? ''}
            rows={3}
            submitLabel="next"
            onInput={value => void setAnswer({ comment: value })}
            onSubmit={async value => {
              await setAnswer({ comment: value })
              await nextUnanswered()
            }}
          />
        </Box>

        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          <Button key="prev" hotkey="k" onPress={go(at - 1)}>
            ‹ Prev
          </Button>
          <Button key="next" hotkey="j" onPress={go(at + 1)}>
            Next ›
          </Button>
          <Button key="all" hotkey="r" onPress={acceptAll}>
            Agree with all recommended
          </Button>
          <Button key="send" hotkey="s" variant="primary" onPress={send}>
            {done === total ? 'Send round' : `Send (${total - done} unanswered)`}
          </Button>
          <Button key="history" hotkey="h" dimColor onPress={setView('history')}>
            History
          </Button>
        </Box>
        <Text dimColor>
          {hasChoice ? '←/→ move · 1-9 option' : '←/→ move · a agree · d disagree'} · c comment · j/k next/prev question · r agree with all · s send
        </Text>
      </Box>
    )
  })
}
