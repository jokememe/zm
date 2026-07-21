import fs from 'fs'
import path from 'path'

const dir = 'dist/assets'
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))

function importsOf(namePrefix) {
  const f = files.find((x) => x.startsWith(namePrefix) && x.endsWith('.js'))
  if (!f) return { f: null, im: [] }
  const s = fs.readFileSync(path.join(dir, f), 'utf8')
  const im = [...s.matchAll(/from\s*["'](\.\/[^"']+)["']/g)].map((m) => m[1])
  return { f, im }
}

const st = importsOf('sillytavern-')
const ut = importsOf('useTianji-')
const ug = importsOf('useGameState-')
const idx = importsOf('index-')

console.log('sillytavern:', st.f, st.im)
console.log('useTianji:', ut.f, ut.im)
console.log('useGameState:', ug.f, ug.im)
console.log('index:', idx.f, idx.im.slice(0, 15))

const stToUt = st.im.some((i) => i.includes('useTianji'))
const utToSt = ut.im.some((i) => i.includes('sillytavern'))
console.log('\ncycle sillytavern <-> useTianji?', stToUt && utToSt)
console.log('assets use relative?', fs.readFileSync('dist/index.html', 'utf8').includes('./assets/'))
