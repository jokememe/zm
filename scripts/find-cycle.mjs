import fs from 'fs'
import path from 'path'

const dir = 'dist/assets'
const st = fs.readdirSync(dir).find((f) => f.startsWith('sillytavern-') && f.endsWith('.js'))
const s = fs.readFileSync(path.join(dir, st), 'utf8')
console.log('size', s.length)
// print all unique from imports
console.log([...s.matchAll(/from\s*["'](\.\/[^"']+)["']/g)].map((m) => m[1]))
// search for composable path strings
for (const key of ['useTianji', 'VariablePanel', 'useSillytavern', 'game-bridge', 'LorebookModal']) {
  console.log(key, s.includes(key))
}
// dump first 1500 chars
console.log('---head---')
console.log(s.slice(0, 1500))
