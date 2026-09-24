# Dawnshift

A team of AI coworkers that runs on your own computer. It isn't tied to one
AI company: **each bot can use Claude,
ChatGPT, Grok, Gemini, Groq, OpenRouter, or a local model** running in Ollama or
LM Studio. You can mix them, for example Claude for the team lead and a free
local model for the writer.

## What the bots can do

- **Have a job.** You describe each bot's role the way you'd brief a new hire.
  There are ready-made roles to start from: Chief of Staff, Researcher, Writer,
  Operations and Customer Support.
- **Work in the background.** Give a bot a task and it keeps working on its
  own. Tasks survive restarts: if Dawnshift stops, it continues where it left off.
- **Work as a team.** A bot with the "team lead" ability splits a big job into
  pieces, hands each piece to the right coworker, and combines their results.
  Bots also share a **team board** for notes and context.
- **Remember things.** Bots save lasting facts (your preferences, contacts,
  decisions) and see them at the start of every task. You can view and delete
  these notes in each bot's settings.
- **Check with you.** A bot can ask you a question and wait for the answer.
  By default it also asks before anything risky, like writing a file or
  changing data in one of your apps. Everything waiting on you shows up under
  **Needs you**.
- **Use your apps.** Save app tokens (shop, CRM, email service) under
  *Settings → App keys*. Bots call those apps' web APIs by writing
  `{{KEY_NAME}}`. The AI never sees the key itself.
- **Run routines.** Recurring jobs like "every morning, check new orders and
  post a summary" run on their own while Dawnshift is running.
- **Meet Sunny.** A little robot in the corner watches your cursor, nods
  when you hand out work, scans while the team is busy, waves when someone
  needs you and cheers when a task is done. Click it to say hi. All
  animations switch off if your system is set to reduce motion.
- **Share files.** Bots read and write files in a shared workspace folder.
  You can browse it in the *Files* tab.

## Download (for people who just want to use it)

Download the Dawnshift ZIP, unzip it, install [Node.js](https://nodejs.org)
(LTS), then double-click **Start Dawnshift (Windows).bat** or
**Start Dawnshift (Mac).command**. Dawnshift opens in your browser. The
"READ ME FIRST" file inside the ZIP explains everything.

To build the ZIP yourself, run `npm run package`. It writes
`dist/Dawnshift-<version>.zip` with the app, its libraries and the launchers.

## Running it from the source code

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
cd dawnshift
npm install
npm start
```

Then open <http://localhost:3777>. The first screen walks you through
connecting an AI and hiring your team.

### Connecting an AI

| Provider | What you need |
|---|---|
| Claude (Anthropic) | An API key from console.anthropic.com. Defaults to `claude-opus-5`. |
| ChatGPT (OpenAI) | An API key from platform.openai.com |
| Grok (xAI) | An API key from console.x.ai |
| Gemini (Google) | An API key from aistudio.google.com |
| Groq | A free API key from console.groq.com (fast, with a free tier) |
| OpenRouter | One key that gives access to hundreds of models |
| Ollama (local) | Ollama running, and a model that supports tools |
| LM Studio (local) | LM Studio's local server running with a model loaded |
| Anything else | Any server that speaks the OpenAI chat-completions API |

After entering a key, click **Load models** to choose from the models that
provider offers. You can also set keys as environment variables before
starting Dawnshift: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`,
`GEMINI_API_KEY`, `GROQ_API_KEY` or `OPENROUTER_API_KEY`.

**No budget?** Gemini and Groq both have free API keys (no credit card
needed as of 2026), and Ollama or LM Studio are completely free.

Local models are free and private, but small ones are less reliable with
tools. If a local model can't use tools at all, Dawnshift still works with it
as a plain chat bot.

### Options

| Environment variable | Default | What it does |
|---|---|---|
| `PORT` | `3777` | Port for the web page |
| `HOST` | `127.0.0.1` | Only change this if you know you want other devices to connect. There's no login. |
| `DAWNSHIFT_DATA` | `./data` | Where the team, tasks, memory, keys and workspace are stored |

## Privacy and safety

- Everything is stored in the `data/` folder on your computer, including API
  keys and app keys (in `data/state.json`, readable only by your user).
  Nothing is sent anywhere except to the AI providers and apps you connect.
- Dawnshift only accepts connections from your own computer by default. It
  blocks requests from other websites open in your browser, and bots can't
  call Dawnshift's own controls.
- File tools stay inside `data/workspace/`.
- With the default approval setting, bots ask before writing files or sending
  anything other than a read (GET) request to an app. Bots can still *read*
  web pages and APIs on their own, including ones on your local network.
  Choose "Ask me before every action" for a bot if that matters to you.

## Credits

Made by OliverZS2005, built with help from Claude, an AI by Anthropic.

## Legal

- [LICENSE](LICENSE): Dawnshift itself. All rights reserved by the owner.
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): the licenses of the
  open-source packages and fonts Dawnshift uses. Run `npm run notices` to
  regenerate it (and the in-app licenses page) after changing dependencies.
- In the app, *Settings → About* links to the
  [Terms of Service](public/terms.html),
  [Privacy Policy](public/privacy.html) and open-source licenses.

Dawnshift works with AI services from Anthropic, OpenAI, xAI, Google, Groq
and OpenRouter but isn't made, endorsed or sponsored by any of them. Their names
belong to their owners.

## How it works

```
server.js          web server + API for the page
src/runner.js      runs tasks: the loop of "ask the AI -> run its tool calls"
src/providers.js   talks to Anthropic (official SDK) and OpenAI-compatible APIs
src/tools.js       what bots can do: ask you, remember, delegate, web, files
src/templates.js   the ready-made roles
src/store.js       saves everything to data/state.json
public/            the web page (plain HTML/CSS/JS, no build step) and legal pages
scripts/notices.mjs  builds THIRD_PARTY_NOTICES.md and public/licenses.html
```

Conversations are stored in one provider-neutral format, so you can switch a
bot to a different AI at any time, even halfway through a task. With Claude
Opus 5 and newer, Dawnshift turns on Anthropic's server-side fallbacks: if the
model's safety classifier declines a request, it's retried on the model
Anthropic recommends instead of failing.

Run the tests with `npm test`.
