const sketches = [
`// licensed with CC BY-NC-SA 4.0
// port
// by Marianne Teixido
// https://marianneteixido.github.io/

osc(5, 0.9, 0.001)
  .kaleid([3,4,5,7,8,9,10].fast(0.1))
  .color(0.5, 0.3)
  .colorama(0.4)
  .rotate(0.009, () => Math.sin(time) * -0.001)
  .modulateRotate(o0, () => Math.sin(time) * 0.003)
  .modulate(o0, 0.9)
  .scale(0.9)
  .out(o0)`,
`// feedback study
osc(8, 0.03, 1.2)
  .kaleid(7)
  .modulateRotate(o0, 0.18)
  .colorama(() => time * 0.03)
  .blend(o0, 0.86)
  .out(o0)`,
`// geometry study
shape(6, 0.35, 0.02)
  .repeat(3, 3)
  .modulate(noise(2, 0.08), 0.2)
  .color(0.2, 0.8, 1)
  .diff(osc(12, 0.02, 1.4))
  .out(o0)`
]

const outputMode = new URLSearchParams(location.search).get('output') === '1'
document.body.classList.toggle('output-mode', outputMode)
const canvas = document.createElement('canvas')
document.querySelector('.stage').prepend(canvas)
const renderScale = outputMode ? 1 : 2
canvas.width = Math.round(innerWidth * renderScale)
canvas.height = Math.round(innerHeight * renderScale)
const hydra = new Hydra({ canvas, detectAudio:false, makeGlobal:true })
hydra.setResolution(canvas.width, canvas.height)
const editor = document.querySelector('#editor')
const highlight = document.querySelector('#highlight')
const error = document.querySelector('#error')
let currentSketch = 0
let timer

editor.value = sketches[0]

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function colorizeLine(source) {
  if (/^\s*\/\//.test(source)) return `<span class="comment">${escapeHtml(source)}</span>`
  let html = escapeHtml(source)
  const tokens = []
  const hold = (className, value) => { const id = tokens.push(`<span class="${className}">${value}</span>`) - 1; return `\u0001${id}\u0002` }
  html = html.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, value => hold('string', value))
  html = html.replace(/\b(?:const|let|var|new|function|return|window|Math|time)\b/g, value => hold('keyword', value))
  html = html.replace(/\b\d+(?:\.\d+)?\b/g, value => hold('number', value))
  html = html.replace(/\.([a-zA-Z_$][\w$]*)/g, (_, value) => `.<span class="method">${value}</span>`)
  html = html.replace(/\b(osc|shape|noise|voronoi|solid|gradient|src|hush)\b/g, '<span class="function">$1</span>')
  html = html.replace(/\u0001(\d+)\u0002/g, (_, index) => tokens[Number(index)])
  return html || '&nbsp;'
}

function updateHighlight() {
  highlight.innerHTML = editor.value.split('\n').map(line => `<span class="line${line ? '' : ' blank'}">${colorizeLine(line)}</span>`).join('')
  highlight.scrollTop = editor.scrollTop
  highlight.scrollLeft = editor.scrollLeft
}

function execute() {
  try {
    new Function(editor.value)()
    localStorage.setItem('hydra-studio-code', editor.value)
    error.textContent = ''
  } catch (exception) {
    error.textContent = exception.message
  }
}

function setCode(code) {
  editor.value = code
  updateHighlight()
  execute()
  window.hydraLive?.write(code)
  if (!outputMode) editor.focus()
}

editor.addEventListener('input', () => {
  updateHighlight()
  clearTimeout(timer)
  timer = setTimeout(() => {
    execute()
    window.hydraLive?.write(editor.value)
  }, 500)
})
editor.addEventListener('scroll', updateHighlight)
editor.addEventListener('keydown', event => {
  if (event.key === 'Tab') { event.preventDefault(); const start = editor.selectionStart; editor.setRangeText('  ', start, editor.selectionEnd, 'end') }
})
document.querySelector('#run').onclick = execute
document.querySelector('#shuffle').onclick = () => { currentSketch = (currentSketch + 1) % sketches.length; setCode(sketches[currentSketch]) }
window.addEventListener('keydown', event => {
  if (event.ctrlKey && event.shiftKey && event.key === 'Enter') { event.preventDefault(); execute() }
  if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); localStorage.setItem('hydra-studio-code', editor.value) }
  if (event.key === 'F11') { event.preventDefault(); document.body.classList.toggle('hide-code') }
  if (event.key === 'F' && event.shiftKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault()
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen()
  }
})
async function initializeLiveEditing() {
  try {
    const liveCode = await window.hydraLive?.read()
    if (liveCode) editor.value = liveCode
    window.hydraLive?.subscribe(code => {
      if (code === editor.value) return
      editor.value = code
      updateHighlight()
      execute()
    })
  } catch (exception) {
    error.textContent = `Arquivo ao vivo: ${exception.message}`
  }
  updateHighlight()
  execute()
  if (!outputMode) editor.focus()
}

initializeLiveEditing()

window.addEventListener('resize', () => {
  hydra.setResolution(Math.round(innerWidth * renderScale), Math.round(innerHeight * renderScale))
})

