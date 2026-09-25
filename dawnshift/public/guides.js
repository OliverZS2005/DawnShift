// Step-by-step guides for connecting each AI, shown in the "Connect" dialog.
// Each step is a list of pieces: plain text, { a: url, text } for a link,
// { b: text } for bold and { code: text } for something to type or copy.
//
// Keep these short and check them now and then: the providers' websites
// change their menus from time to time.

export const COST_LABEL = {
  free: 'Free',
  paid: 'Paid',
  device: 'Free, on your device',
  varies: 'Depends',
};

// The order providers are shown in: free ones first.
export const ORDER = ['groq', 'gemini', 'openrouter', 'ollama', 'lmstudio', 'anthropic', 'openai', 'xai', 'custom'];

export const GUIDES = {
  groq: {
    cost: 'free',
    blurb: 'Very fast and free to start. No card needed. Best free choice for most people.',
    steps: [
      ['Open ', { a: 'https://console.groq.com', text: 'console.groq.com' }, ' and sign in with Google, GitHub or your email.'],
      ['Go to ', { a: 'https://console.groq.com/keys', text: 'API Keys' }, ' and click ', { b: 'Create API Key' }, '. Give it any name, like ', { code: 'Dawnshift' }, '.'],
      ['Copy the key (it starts with ', { code: 'gsk_' }, '). Groq only shows it once, so paste it below right away.'],
      ['Click ', { b: 'Load models' }, ' and pick a big model such as ', { code: 'llama-3.3-70b-versatile' }, ' if it\'s in the list. Then click ', { b: 'Connect' }, '.'],
    ],
    note: 'The free tier has a limit per minute and per day. If you hit it, Dawnshift says so; wait a minute and try again.',
  },
  gemini: {
    cost: 'free',
    blurb: 'Google\'s AI. Has a free tier with a Google account.',
    steps: [
      ['Open ', { a: 'https://aistudio.google.com/apikey', text: 'aistudio.google.com/apikey' }, ' and sign in with a ', { b: 'personal' }, ' Google account. School and work accounts are often blocked, and you need to be 18 or older.'],
      ['Accept the terms if asked, then click ', { b: 'Create API key' }, '. If it asks for a project, pick one or create a new one.'],
      ['Copy the key (it starts with ', { code: 'AIza' }, ') and paste it below.'],
      ['Click ', { b: 'Load models' }, ', pick a "flash" model such as ', { code: 'gemini-2.5-flash' }, ', and click ', { b: 'Connect' }, '.'],
    ],
    note: 'Getting "permission denied"? Create a project first at console.cloud.google.com, then try again. On the free tier, Google may use what you send to improve its products.',
  },
  openrouter: {
    cost: 'free',
    blurb: 'One key for hundreds of models from many companies, including free ones.',
    steps: [
      ['Open ', { a: 'https://openrouter.ai', text: 'openrouter.ai' }, ' and click ', { b: 'Sign in' }, '.'],
      ['Go to ', { a: 'https://openrouter.ai/keys', text: 'openrouter.ai/keys' }, ', click ', { b: 'Create Key' }, ' and give it a name.'],
      ['Copy the key (it starts with ', { code: 'sk-or-' }, ') and paste it below. It\'s only shown once.'],
      ['Click ', { b: 'Load models' }, '. Free models end in ', { code: ':free' }, '. Pick one and click ', { b: 'Connect' }, '.'],
    ],
    note: 'Free models have a daily limit. Adding a little credit to your OpenRouter account raises it.',
  },
  ollama: {
    cost: 'device',
    blurb: 'Runs AI models on your own computer. Free and private, but needs a fairly strong computer.',
    steps: [
      ['Download Ollama from ', { a: 'https://ollama.com/download', text: 'ollama.com/download' }, ' and install it.'],
      ['Open a terminal (on Windows: PowerShell) and download a model that can use tools, for example ', { code: 'ollama pull qwen2.5:7b' }, '. It\'s about 5 GB and needs around 8 GB of memory. On a weaker computer try ', { code: 'ollama pull qwen2.5:3b' }, '.'],
      ['Click ', { b: 'Load models' }, ', pick the model and click ', { b: 'Connect' }, '. No API key needed.'],
    ],
    webNote: 'Using Dawnshift in the browser? Do the "Setup steps for the web version" below first.',
  },
  lmstudio: {
    cost: 'device',
    blurb: 'An app for running AI models on your own computer, with a simple window to download them.',
    steps: [
      ['Download LM Studio from ', { a: 'https://lmstudio.ai', text: 'lmstudio.ai' }, ' and install it.'],
      ['In LM Studio open the ', { b: 'Discover' }, ' tab (the magnifying glass), search for ', { code: 'qwen2.5 7b instruct' }, ' and download it.'],
      ['Open the ', { b: 'Developer' }, ' tab, load the model at the top, and switch the server on until it says ', { b: 'Running' }, '.'],
      ['Click ', { b: 'Load models' }, ', pick the model and click ', { b: 'Connect' }, '. No API key needed.'],
    ],
    webNote: 'Using Dawnshift in the browser? Do the "Setup steps for the web version" below first.',
  },
  anthropic: {
    cost: 'paid',
    blurb: 'Claude, by Anthropic. Very good at careful, multi-step work. You pay per use, from $5.',
    steps: [
      ['Open ', { a: 'https://console.anthropic.com', text: 'console.anthropic.com' }, ' and create an account. A Claude.ai Pro or Max plan is separate and doesn\'t include this.'],
      ['Go to ', { b: 'Settings → Billing' }, ' and buy some credits (the minimum is $5).'],
      ['Go to ', { a: 'https://console.anthropic.com/settings/keys', text: 'API Keys' }, ', click ', { b: 'Create Key' }, ' and copy it (it starts with ', { code: 'sk-ant-' }, ').'],
      ['Paste it below, click ', { b: 'Load models' }, ' and click ', { b: 'Connect' }, '. The default model is the smartest; Sonnet and Haiku models cost less.'],
    ],
    note: 'Set a monthly spending limit under Settings → Limits so you never pay more than you planned.',
  },
  openai: {
    cost: 'paid',
    blurb: 'ChatGPT\'s models, by OpenAI. You pay per use, from $5.',
    steps: [
      ['Open ', { a: 'https://platform.openai.com', text: 'platform.openai.com' }, ' and sign up or log in. A ChatGPT Plus plan is separate and doesn\'t include this.'],
      ['Go to ', { b: 'Settings → Billing' }, ' and add credit (the minimum is $5).'],
      ['Go to ', { a: 'https://platform.openai.com/api-keys', text: 'API keys' }, ', click ', { b: 'Create new secret key' }, ' and copy it (it starts with ', { code: 'sk-' }, ').'],
      ['Paste it below, click ', { b: 'Load models' }, ', pick a model and click ', { b: 'Connect' }, '. Models with "mini" in the name cost less.'],
    ],
    note: 'Set a monthly budget under Settings → Limits so you never pay more than you planned.',
  },
  xai: {
    cost: 'paid',
    blurb: 'Grok, by xAI. You pay per use.',
    steps: [
      ['Open ', { a: 'https://console.x.ai', text: 'console.x.ai' }, ' and sign in with your X account or email.'],
      ['Add credits under ', { b: 'Billing' }, '.'],
      ['Open ', { b: 'API Keys' }, ', click ', { b: 'Create API Key' }, ' and copy it (it starts with ', { code: 'xai-' }, ').'],
      ['Paste it below, click ', { b: 'Load models' }, ', pick a Grok model and click ', { b: 'Connect' }, '.'],
    ],
  },
  custom: {
    cost: 'varies',
    blurb: 'Any other service or program that speaks the OpenAI API, such as DeepSeek, Mistral, Together, vLLM or llama.cpp.',
    steps: [
      ['Find the service\'s "OpenAI-compatible" address in its documentation. It usually ends in ', { code: '/v1' }, '.'],
      ['Paste that under ', { b: 'Server address' }, ', and the service\'s API key under ', { b: 'API key' }, ' if it needs one.'],
      ['Click ', { b: 'Load models' }, ', pick a model and click ', { b: 'Connect' }, '.'],
    ],
    note: 'Pick a model that supports "tools" or "function calling", or the bots can\'t use their abilities.',
  },
};
