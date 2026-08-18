const outputMode = new URLSearchParams(location.search).get('output') === '1'
document.body.classList.toggle('output-mode', outputMode)

const canvas = document.createElement('canvas')
document.querySelector('.stage').prepend(canvas)
const renderScale = outputMode ? 1 : 2
canvas.width = Math.round(innerWidth * renderScale)
canvas.height = Math.round(innerHeight * renderScale)
const hydra = new Hydra({ canvas, detectAudio: false, makeGlobal: true })
hydra.setResolution(canvas.width, canvas.height)

const editor = document.querySelector('#editor')
const highlight = document.querySelector('#highlight')
const error = document.querySelector('#error')
const spoutButton = document.querySelector('#spout')
const sketchName = document.querySelector('#sketch-name')
let timer
let composing = false
let spoutActive = false

editor.value = 'osc(10, 0.1, 1.2).out(o0)\n'

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function colorizeLine(source) {
  if (/^\s*\/\//.test(source)) return `<span class="comment">${escapeHtml(source)}</span>`
  let html = escapeHtml(source)
  const tokens = []
  const hold = (className, value) => {
    const id = tokens.push(`<span class="${className}">${value}</span>`) - 1
    return `\u0001${id}\u0002`
  }
  html = html.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, value => hold('string', value))
  html = html.replace(/\b(?:const|let|var|new|function|return|window|Math|time)\b/g, value => hold('keyword', value))
  html = html.replace(/\b\d+(?:\.\d+)?\b/g, value => hold('number', value))
  html = html.replace(/\.([A-Za-z_$][\w$]*)/g, (_, value) => `.<span class="method">${value}</span>`)
  html = html.replace(/\b(osc|shape|noise|voronoi|solid|gradient|src|hush)\b/g, '<span class="function">$1</span>')
  html = html.replace(/\u0001(\d+)\u0002/g, (_, index) => tokens[Number(index)])
  return html || '&nbsp;'
}

function updateHighlight() {
  highlight.innerHTML = editor.value.split('\n').map(line => {
    return `<span class="line${line ? '' : ' blank'}">${colorizeLine(line)}</span>`
  }).join('')
  highlight.scrollTop = editor.scrollTop
  highlight.scrollLeft = editor.scrollLeft
}

function execute() {
  try {
    new Function(editor.value)()
    localStorage.setItem('hydra-studio-code', editor.value)
    error.textContent = ''
    if (!outputMode) window.hydraLive?.write(editor.value)
  } catch (exception) {
    error.textContent = exception.message
  }
}

function setCode(code) {
  editor.value = code
  updateHighlight()
  execute()
  if (!outputMode) editor.focus()
}

function setSketchLabel(info) {
  if (!sketchName || !info) return
  sketchName.textContent = info.name || 'hydra-live.js'
  sketchName.title = info.path || info.name || ''
}

function applySpoutStatus(status) {
  if (!spoutButton || !status) return
  const state = !status.available ? 'missing' : status.active ? 'on' : 'off'
  spoutActive = Boolean(status.active)
  spoutButton.dataset.state = state
  spoutButton.disabled = !status.available
  spoutButton.setAttribute('aria-pressed', spoutActive ? 'true' : 'false')
  spoutButton.title = state === 'missing'
    ? 'Spout indisponível — módulo nativo não encontrado'
    : state === 'on'
      ? 'Spout ativo — Hydra 2 Touch. Clique para desligar.'
      : 'Spout desligado. Clique para enviar ao TouchDesigner.'
}

async function refreshSketchLabel() {
  try {
    setSketchLabel(await window.hydraSketches?.info())
  } catch {}
}

editor.addEventListener('compositionstart', () => {
  composing = true
  editor.classList.add('composing')
  highlight.classList.add('composing')
})
editor.addEventListener('compositionend', () => {
  composing = false
  editor.classList.remove('composing')
  highlight.classList.remove('composing')
  updateHighlight()
})
editor.addEventListener('input', () => {
  if (!composing) updateHighlight()
  clearTimeout(timer)
  timer = setTimeout(execute, 500)
})
editor.addEventListener('scroll', updateHighlight)
editor.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault()
    const start = editor.selectionStart
    editor.setRangeText('  ', start, editor.selectionEnd, 'end')
    updateHighlight()
  }
})

if (!outputMode) {
  document.querySelector('#run').onclick = execute
  document.querySelector('#save').onclick = async () => {
    try {
      const info = await window.hydraSketches?.save(editor.value)
      if (info) setSketchLabel(info)
    } catch (exception) {
      error.textContent = exception.message
    }
  }
  document.querySelector('#load').onclick = async () => {
    try {
      const sketch = await window.hydraSketches?.open()
      if (sketch?.code != null) {
        setCode(sketch.code)
        setSketchLabel(sketch)
      }
    } catch (exception) {
      error.textContent = exception.message
    }
  }
  document.querySelector('#shuffle').onclick = async () => {
    try {
      const sketch = await window.hydraSketches?.next()
      if (sketch?.code != null) {
        setCode(sketch.code)
        setSketchLabel(sketch)
      } else {
        error.textContent = 'Nenhum sketch salvo em Documentos/Hydra 2 Touch/sketches'
      }
    } catch (exception) {
      error.textContent = exception.message
    }
  }
  spoutButton.onclick = async () => {
    if (spoutButton.disabled) return
    applySpoutStatus(await window.hydraSpout?.setEnabled(!spoutActive))
  }
  window.hydraSpout?.subscribe(applySpoutStatus)
}

window.addEventListener('keydown', event => {
  if (event.ctrlKey && event.shiftKey && event.key === 'Enter') {
    event.preventDefault()
    execute()
  }
  if (event.ctrlKey && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (!outputMode) document.querySelector('#save').click()
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'o') {
    event.preventDefault()
    if (!outputMode) document.querySelector('#load').click()
  }
  if (event.key === 'F11') {
    event.preventDefault()
    document.body.classList.toggle('hide-code')
  }
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
      refreshSketchLabel()
    })
    applySpoutStatus(await window.hydraSpout?.status())
    await refreshSketchLabel()
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
