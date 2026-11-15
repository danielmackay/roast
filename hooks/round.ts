import type { RoastAnswer, RoastOption, RoastQuestion, RoastRound } from '../types'

// The grilling skill writes each question as
//   ❓ **Q1** - **<title>**: <body>
//   ➡️ <recommendation>
// separated by `---` lines.
const HEAD = /❓️?\s*\*\*Q(\d+)\*\*\s*[-–—:]?\s*\*\*(.+?)\*\*\s*:?[ \t]*/g
const ARROW = /➡️?/
const RULE = /\n[ \t]*-{3,}[ \t]*(?:\n|$)/
const OPTION =
  /^\s*(?:[-*+]\s+)?(?:\*\*)?\(?(?:option\s+)?([A-Ha-h]|[1-9])\s*[).:—–-]\)?(?:\*\*)?\s+(.+)$/i

const KEYS = 'ABCDEFGHIJ'

const skillName = (skill: string): string => skill.split(':').at(-1) ?? skill

const GRILL_SKILLS = new Set(['grilling', 'grill-me', 'grill-with-docs'])

// Wayfinder asks its questions through the grilling skill, but it also asks
// them directly (naming the destination, mapping the frontier), so it gets
// the pane too.
export const isRoastSkill = (skill: string): boolean => {
  const name = skillName(skill)
  return GRILL_SKILLS.has(name) || name === 'wayfinder'
}

const stripBold = (text: string): string => text.replace(/\*\*/g, '').trim()

export function parseOptions(body: string): RoastOption[] {
  const found: RoastOption[] = []
  for (const line of body.split('\n')) {
    const m = OPTION.exec(line)
    if (m) found.push({ key: (m[1] ?? '').toUpperCase(), label: stripBold(m[2] ?? '') })
  }
  // A lone match is more likely prose than a choice.
  if (found.length < 2) return []
  const keys = new Set(found.map(o => o.key))
  return keys.size === found.length ? found : []
}

export function pickRecommended(
  recommendation: string,
  options: readonly RoastOption[],
): string | undefined {
  if (options.length === 0) return undefined
  const keys = new Set(options.map(o => o.key))
  const lead =
    /^\s*(?:\*\*)?(?:option\s+)?\(?([A-Ha-h]|[1-9])\)?(?:\*\*)?(?=[\s).:—–,-]|$)/i.exec(
      recommendation,
    )
  const leadKey = (lead?.[1] ?? '').toUpperCase()
  if (leadKey && keys.has(leadKey)) return leadKey
  const named = /\boption\s+\(?([A-Ha-h]|[1-9])\b/i.exec(recommendation)
  const namedKey = (named?.[1] ?? '').toUpperCase()
  if (namedKey && keys.has(namedKey)) return namedKey
  const lower = recommendation.toLowerCase()
  const byLabel = options.find(
    o => o.label.length >= 4 && lower.includes(o.label.toLowerCase().slice(0, 40)),
  )
  return byLabel?.key
}

export function parseRound(text: string): RoastQuestion[] {
  const heads = [...text.matchAll(HEAD)]

  return heads.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length
    const isLast = i + 1 === heads.length
    const end = isLast ? text.length : (heads[i + 1]?.index ?? text.length)
    const chunk = text.slice(start, end)
    const arrow = ARROW.exec(chunk)
    const body = ((arrow ? chunk.slice(0, arrow.index) : chunk).split(RULE)[0] ?? '').trim()
    let recommendation = arrow ? chunk.slice(arrow.index + arrow[0].length) : ''
    recommendation = recommendation.split(RULE)[0] ?? ''
    // Text after the last question's recommendation is the closing remark.
    if (isLast) recommendation = recommendation.split(/\n\s*\n/)[0] ?? ''
    recommendation = recommendation.trim()
    const options = parseOptions(body)

    return {
      id: `Q${m[1] ?? i + 1}`,
      title: stripBold(m[2] ?? ''),
      body,
      recommendation,
      options,
      recommendedOption: pickRecommended(recommendation, options),
    }
  })
}

type ToolQuestion = {
  title?: unknown
  body?: unknown
  recommendation?: unknown
  options?: unknown
  recommendedOption?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** The tool's input as questions, or a reason it can't be read. */
export function questionsFromTool(input: unknown): RoastQuestion[] | string {
  const raw = (input as { questions?: unknown } | undefined)?.questions
  if (!Array.isArray(raw) || raw.length === 0) return '`questions` must be a non-empty array.'

  const out: RoastQuestion[] = []
  for (const [i, item] of (raw as ToolQuestion[]).entries()) {
    const title = str(item?.title)
    if (!title) return `questions[${i}].title is required.`
    const options: RoastOption[] = Array.isArray(item.options)
      ? (item.options as { key?: unknown; label?: unknown }[])
          .map((o, j) => ({
            key: (str(o?.key) || KEYS[j] || String(j + 1)).toUpperCase(),
            label: str(o?.label),
          }))
          .filter(o => o.label)
      : []
    const wanted = str(item.recommendedOption).toUpperCase()
    out.push({
      id: `Q${i + 1}`,
      title,
      body: str(item.body),
      recommendation: str(item.recommendation),
      options,
      recommendedOption: options.some(o => o.key === wanted)
        ? wanted
        : pickRecommended(str(item.recommendation), options),
    })
  }

  return out
}

export const isAnswered = (a: RoastAnswer | undefined): boolean =>
  a !== undefined && (a.kind !== undefined || (a.comment ?? '').trim() !== '')

/** One glyph per question for the progress strip. */
export function mark(a: RoastAnswer | undefined): string {
  if (!isAnswered(a)) return '·'
  if (a?.kind === 'accept') return '✓'
  if (a?.kind === 'reject') return '✗'
  if (a?.kind === 'option') return a.option ?? '?'
  return '✎'
}

export function describe(q: RoastQuestion, a: RoastAnswer | undefined): string {
  if (!isAnswered(a)) return 'No answer.'
  const option = (key?: string) => {
    const found = q.options.find(o => o.key === key)
    return found ? `Option ${found.key} (${found.label})` : `Option ${key}`
  }
  let line: string
  switch (a?.kind) {
    case 'accept':
      line = q.recommendedOption
        ? `Agree with your recommendation: ${option(q.recommendedOption)}.`
        : 'Agree with your recommendation.'
      break
    case 'reject':
      line = 'Disagree with your recommendation.'
      break
    case 'option':
      line =
        a.option === q.recommendedOption
          ? `${option(a.option)}, your recommendation.`
          : `${option(a.option)}.`
      break
    default:
      line = 'See my comment.'
  }
  const comment = (a?.comment ?? '').trim()

  return comment ? `${line}\n   Comment: ${comment.replace(/\n/g, '\n   ')}` : line
}

export function formatAnswers(round: RoastRound): string {
  const lines = round.questions.map(
    q => `${q.id} (${q.title}): ${describe(q, round.answers[q.id])}`,
  )

  return [`Roast answers, round ${round.n}:`, '', ...lines].join('\n')
}

/** Recommendation filled into every question without an answer kind. */
export function fillRecommended(round: RoastRound): Record<string, RoastAnswer> {
  const answers: Record<string, RoastAnswer> = { ...round.answers }
  for (const q of round.questions) {
    const a = answers[q.id]
    if (a?.kind !== undefined) continue
    if (q.options.length >= 2) {
      // A choice with no recommended option is left for the person to pick.
      if (q.recommendedOption) answers[q.id] = { ...a, kind: 'option', option: q.recommendedOption }
      continue
    }
    answers[q.id] = { ...a, kind: 'accept' }
  }

  return answers
}

const PANE_STEPS = `

## Answering rounds in the roast pane

The person answers each round in the roast pane instead of typing replies.

1. For every round, call \`mcp__roast__ask_round\` with the whole frontier (if its schema isn't loaded, load it with ToolSearch \`select:mcp__roast__ask_round\`). Give each question its title, its body (markdown, as long as it needs), your recommended answer, and, when the question offers a choice, the choices as \`options\` with the recommended one's key in \`recommendedOption\`. Word each question so that agreeing means taking your recommendation.
2. Don't also write the round as text. When the tool returns, end your turn with one short line, such as "Round 2 is in the roast pane."
3. The answers arrive as the person's next message, headed "Roast answers". "Agree" takes your recommendation, "Disagree" rejects it (the comment usually says why; otherwise ask a follow-up in the next round), and an option names their pick. A question answered only with a comment means the person couldn't pick an answer: read the comment. Comments are the person's own words and outrank everything else.

`

export function skillAddendum(skill: string): string {
  if (skillName(skill) === 'wayfinder') {
    return `${PANE_STEPS.replace(
      'The person answers each round in the roast pane instead of typing replies.',
      'Whenever this effort asks the person a round of questions (naming the destination, mapping the frontier, or working a grilling ticket), they answer it in the roast pane instead of typing replies.',
    )}
If \`mcp__roast__ask_round\` is not available, write the round as text, each question as \`❓ **Q1** - **<title>**: <body>\` followed by \`➡️ <your recommended answer>\`, with \`---\` between questions.
`
  }
  return `${PANE_STEPS}
If \`mcp__roast__ask_round\` is not available, write the round as text in the format above.
`
}
