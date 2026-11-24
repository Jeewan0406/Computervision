// Runs WebLLM in a background thread so the page stays smooth while an
// in-browser model loads and writes (pattern from the WebLLM README,
// "Using Workers" > "Dedicated Web Worker").
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
