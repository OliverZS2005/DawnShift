# Dawnshift video guide: script and YouTube chapters

A script for a 7 to 8 minute setup video. Each chapter lists what to show on
screen and roughly what to say. Say it in your own words; it doesn't need to
be word for word.

**Before you record**

- Use a fresh browser profile or a private window, so the app starts on the
  welcome screen with nothing set up.
- **Never show a real API key on screen.** Create a key just for the video and
  delete it right after recording, or blur it when editing. Anyone who pauses
  the video could copy it and use your credit.
- Hide your bookmarks bar and close other tabs.
- Record at 1080p. Zoom the browser to 125% so text is readable on phones.

---

## YouTube title

> Dawnshift: build a free AI team that works for you (setup guide)

## YouTube description (paste this, then fix the times)

The times below are estimates. After editing, change each one to where that
part really starts. YouTube only makes chapters if the first one is `0:00`,
there are at least three, and each is at least 10 seconds long.

```
Dawnshift gives you a team of AI coworkers that take on tasks, remember what they learn and hand work to each other. It works with free AIs (Groq, Gemini, OpenRouter), paid ones (Claude, ChatGPT, Grok), or AI running on your own computer (Ollama, LM Studio).

Try it: https://dawnshift.dawnlife.online

Chapters
0:00 What is Dawnshift?
0:35 Open the app (computer and phone)
1:05 Which AI should I pick?
1:40 Free: connect Groq
2:45 Free: connect Gemini
3:35 Paid: Claude or ChatGPT
4:15 Your own computer: Ollama
5:15 Hire your AI team
5:45 Give your first task
6:45 Approvals and questions
7:15 Sign up to sync your devices
7:40 Tips and safety

Links from the video
Groq keys: https://console.groq.com/keys
Gemini keys: https://aistudio.google.com/apikey
OpenRouter keys: https://openrouter.ai/keys
Claude keys: https://console.anthropic.com/settings/keys
ChatGPT keys: https://platform.openai.com/api-keys
Grok keys: https://console.x.ai
Ollama: https://ollama.com/download
LM Studio: https://lmstudio.ai

Dawnshift is made by OliverZS2005, built with help from Claude, an AI by Anthropic. It isn't made, endorsed or sponsored by Anthropic, OpenAI, xAI, Google, Groq or any other AI company.
```

---

## Script

### 0:00 What is Dawnshift?

**Show:** a team that's already set up, with a task running and a bot's
answer on screen. (Record this part last, after the rest of the video.)

**Say:** "This is Dawnshift. It's a team of AI coworkers: each one has a job,
remembers what it learns, and can pass work to the others. You pick which AI
runs each bot, and there are free options. Let's set it up from scratch."

### 0:35 Open the app

**Show:** typing `dawnshift.dawnlife.online` in the address bar. Then, briefly,
the app on a phone.

**Say:** "Go to dawnshift.dawnlife.online. Nothing to install. On a phone you
can add it to your home screen and it works like an app. On iPhone that's
Share, then Add to Home Screen."

### 1:05 Which AI should I pick?

**Show:** the "Connect an AI" cards. Point at the Free and Paid labels.

**Say:** "First, connect an AI. The ones marked Free cost nothing. Groq is the
easiest. Paid ones like Claude and ChatGPT charge a little per use but are
smarter. And if you have a strong computer, Ollama or LM Studio run the AI on
your own machine, for free and private."

### 1:40 Free: connect Groq

**Show:** click **Groq**. The step-by-step guide is open at the top. Follow it:
click the console.groq.com link, sign in, API Keys, Create API Key, copy. Back
in Dawnshift, paste, click **Load models**, pick a model, click **Connect**.

**Say:** "Every option has the steps right here, with links. For Groq: sign in,
go to API Keys, create one and copy it. It's only shown once. Paste it in,
Load models, pick a big model, and Connect. That's it."

*(Blur the key.)*

### 2:45 Free: connect Gemini

**Show:** the same for **Gemini**, from aistudio.google.com/apikey.

**Say:** "Gemini works the same way. Use a personal Google account, not a
school or work one, because those often block it. Create an API key, paste it,
and pick a flash model."

### 3:35 Paid: Claude or ChatGPT

**Show:** open **Claude (Anthropic)** and scroll through its steps. No need to
do the whole signup.

**Say:** "For Claude or ChatGPT you add a few dollars of credit first. Note
that a ChatGPT Plus or Claude Pro subscription is separate and doesn't cover
this. Set a monthly limit on their site so you never spend more than you
planned."

### 4:15 Your own computer: Ollama

**Show:** ollama.com/download, then a terminal running `ollama pull qwen2.5:7b`.
In Dawnshift click **Ollama**, open **Setup steps for the web version** and
show the part for your system (Windows, Mac or Linux). Then Load models and
click **Allow** when Chrome asks about devices on your local network.

**Say:** "To run the AI on your own computer, install Ollama and download a
model. In the browser version you tell Ollama to allow this website; the exact
steps are right here. When Chrome asks to access your local network, click
Allow. This works in Chrome and Edge. Safari on iPhone doesn't allow it."

### 5:15 Hire your AI team

**Show:** click **Hire the starter team**. The four bots appear.

**Say:** "Now hire your team. The starter team has a Chief of Staff, a
Researcher, a Writer and an Operations bot. You can change their jobs or add
your own in their settings."

### 5:45 Give your first task

**Show:** pick the Chief of Staff, type a task, for example "Plan a launch
week for my coffee shop's new winter menu: a schedule, three social media
posts and a welcome email. Save it as a file.", and click **Assign**. Show
the bots working and handing parts to each other, the result, then the file
in **Files**.

**Say:** "Give a task like you would to a coworker. The Chief of Staff splits
big jobs up and hands parts to the others. They post notes on the team board
and save their work as files you can download."

### 6:45 Approvals and questions

**Show:** a task waiting on you, with the **Allow** and **Don't allow**
buttons, or a bot's question and the box to answer it.

**Say:** "Bots ask before doing anything important, and they ask you when they
need information. You stay in charge."

### 7:15 Sign up to sync your devices

**Show:** click **Sign up**, make an account, and show the recovery code
screen (blur the code).

**Say:** "Sign up to use your team on your phone and computer. Everything is
encrypted on your device before it's uploaded, so not even the server can read
it. Write down the recovery code: without it, a forgotten password can't be
reset."

### 7:40 Tips and safety

**Say:** "Never share your API keys; they're like passwords. Bots only work
while Dawnshift is open. And if something goes wrong, the error message tells
you what to do next. Links are in the description. Thanks for watching!"
