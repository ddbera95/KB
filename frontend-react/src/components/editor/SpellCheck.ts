// Spell-check engine built on typo-js (Hunspell / MIT)
// Loads en-US dictionary from CDN on first enable, then caches in memory.

// Words to always ignore — technical KB terms, code, IDs, etc.
const IGNORE: Set<string> = new Set([
  // Common tech abbreviations
  'api','apis','url','urls','uuid','uuids','json','sql','html','css','js','ts',
  'jsx','tsx','yaml','toml','xml','csv','pdf',
  // Rust / systems
  'async','await','const','let','fn','impl','struct','enum','trait','vec',
  'hashmap','hashset','println','cargo','crate',
  // KB-specific
  'kb','mcp','llm','ai','db','orm','sdk','cli','gui','ide','ssr','spa',
  'crud','rest','grpc','oauth','jwt','wasm','dom','bom','cdn',
  // Common short words spellers trip over
  'ok','aka','tbd','todo','fixme',
]);

const WORD_RE = /\b[a-zA-Z]{3,}\b/g;

let dictionary: any = null;
let loading = false;
const listeners: Array<() => void> = [];

export function isDictionaryReady() { return dictionary !== null; }

export async function loadDictionary(onReady: () => void): Promise<void> {
  if (dictionary) { onReady(); return; }
  listeners.push(onReady);
  if (loading) return;
  loading = true;

  try {
    // Fetch .aff and .dic files from jsDelivr CDN
    const base = 'https://cdn.jsdelivr.net/npm/typo-js@1.3.2/dictionaries/en_US';
    const [affRes, dicRes] = await Promise.all([
      fetch(`${base}/en_US.aff`),
      fetch(`${base}/en_US.dic`),
    ]);
    const [affData, dicData] = await Promise.all([affRes.text(), dicRes.text()]);

    // Dynamic import keeps typo-js out of the initial bundle
    const { default: Typo } = await import('typo-js');
    dictionary = new Typo('en_US', affData, dicData);

    listeners.forEach(fn => fn());
    listeners.length = 0;
  } catch (e) {
    loading = false;
    console.error('Failed to load spell-check dictionary:', e);
  }
}

export function shouldIgnore(word: string): boolean {
  if (IGNORE.has(word.toLowerCase())) return true;
  // Skip ALL_CAPS (acronyms), camelCase compounds, hex-like, version strings
  if (word === word.toUpperCase()) return true;
  if (/[A-Z]/.test(word.slice(1))) return true; // camelCase / PascalCase
  if (/\d/.test(word)) return true;
  if (word.length > 25) return true; // probably a hash / ID fragment
  return false;
}

export function checkWord(word: string): boolean {
  if (!dictionary) return true; // assume correct if dict not loaded
  if (shouldIgnore(word)) return true;
  return dictionary.check(word);
}

export function getSuggestions(word: string, max = 6): string[] {
  if (!dictionary) return [];
  return (dictionary.suggest(word) as string[]).slice(0, max);
}

export interface SpellError {
  word: string;
  from: number;
  to: number;
}

export function checkText(text: string, offset = 0): SpellError[] {
  const errors: SpellError[] = [];
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text)) !== null) {
    const word = m[0];
    if (!checkWord(word)) {
      errors.push({ word, from: offset + m.index, to: offset + m.index + word.length });
    }
  }
  return errors;
}
