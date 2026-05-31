# Learning app — how to add content

The career path UI lives at **`/learning`** (same login as `/admin` and `/statement`).

## Files

| File | Role |
|------|------|
| `src/learning/lessonArticles/*.ts` | **Readable tutor articles** (main teaching text) |
| `src/learning/curriculum.ts` | Lesson metadata: duration, checklist, resources |
| `src/learning/LessonReader.tsx` | Renders articles (tutor box, headings, code, callouts) |
| `src/learning/externalSyllabus.ts` | **Topics + links** from javascript.info, MDN, react.dev, OpenAI, etc. |
| `src/learning/TopicLibrary.tsx` | Browse/search all external topics |
| `src/learning/types.ts` | TypeScript shapes including `LearningContentBlock` |
| `src/learning/progress.ts` | Saves “Mark complete” in `localStorage` (`learning_progress_v1`) |
| `src/learning/LearningPage.tsx` | UI: Read lesson · Daily plan · Overview |
| `src/learning/AdminNav.tsx` | Links: Admin · Statement · Learning |

## Add readable tutor content (important)

1. Add lesson metadata in `src/learning/curriculum.ts` (title, practice, resources).
2. Add a full article in the matching `src/learning/lessonArticles/phaseN.ts` file:

```ts
"phase-1::my-lesson-id": {
  tutorIntro: "One or two friendly sentences.",
  blocks: [
    { type: "h2", text: "Section title" },
    { type: "p", text: "Several sentences the student can read..." },
    { type: "callout", variant: "tutor", text: "Key advice." },
    { type: "code", code: "const x = 1;" },
    { type: "ul", items: ["bullet one", "bullet two"] },
  ],
},
```

Block types: `h2`, `h3`, `p`, `ul`, `ol`, `code`, `callout` (`tutor` | `tip` | `example` | `think` | `warning`).

## Add a new lesson (metadata only)

Open `src/learning/curriculum.ts`, find the right `phase`, append to `lessons`:

```ts
{
  id: "my-new-topic",           // unique within phase
  title: "GraphQL basics",
  duration: "45 min",
  summary: "One sentence goal.",
  topics: ["Queries", "Mutations"],
  practice: ["Build one query in Apollo or fetch"],
  resources: [
    { label: "GraphQL docs", url: "https://graphql.org/learn/" },
  ],
  projectTieIn: "Optional: tie to this repo",
},
```

Reload `/learning` — it appears in the sidebar. Progress key: `phase-2::my-new-topic`.

## Add a new phase

Copy a full `LearningPhase` object into `phases: [ ... ]` with a new `id` (e.g. `phase-5`).

## Deep links

URLs use hash routing:

- `#phase-1` — first lesson in phase 1
- `#phase-3/llm-basics` — specific lesson

## Deploy

`vercel.json` includes rewrites for `/learning`. No extra config after deploy.

## Optional later upgrades

- Store progress in Firestore per user
- Markdown files instead of TS objects (`import.meta.glob`)
- Quizzes or embedded videos
- “Week 1 Day 1” auto-generated schedule from start date
