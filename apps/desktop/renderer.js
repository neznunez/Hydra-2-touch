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
const audioButton = document.querySelector('#audio')
const audioMeter = document.querySelector('#audio-meter')
const audioBars = [...document.querySelectorAll('.audio-bar')]
const cameraButton = document.querySelector('#camera')
const sketchName = document.querySelector('#sketch-name')
const codexPanel = document.querySelector('#codex-panel')
const codexInput = document.querySelector('#codex-input')
const codexLog = document.querySelector('#codex-log')
const codexState = document.querySelector('#codex-state')
let timer
let composing = false
let spoutActive = false
let mediaState = { audio: false, camera: false }
let audioReady = false
let cameraReady = false
let codexOpen = false
let codexBusy = false
let codeAnimationId = 0
let history = []
let historyIndex = -1
let applyingHistory = false
let savedCode = ''
let audioMeterFrame = 0

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

function rememberCode(code = editor.value) {
  if (applyingHistory || outputMode) return
  if (history[historyIndex] === code) return
  history = history.slice(0, historyIndex + 1)
  history.push(code)
  if (history.length > 80) history.shift()
  historyIndex = history.length - 1
}

function updateDirty() {
  if (!sketchName) return
  sketchName.classList.toggle('is-dirty', editor.value !== savedCode)
}

function applyHistory(code) {
  applyingHistory = true
  editor.value = code
  updateHighlight()
  execute()
  updateDirty()
  applyingHistory = false
  if (!outputMode) editor.focus()
}

function undoCode() {
  if (historyIndex <= 0) return
  historyIndex -= 1
  applyHistory(history[historyIndex])
}

function redoCode() {
  if (historyIndex >= history.length - 1) return
  historyIndex += 1
  applyHistory(history[historyIndex])
}

function resetCodexChat() {
  window.hydraCodex?.newThread()
  if (!codexLog) return
  codexLog.replaceChildren()
  addCodexMessage('system', 'nova conversa neste projeto')
}

function execute({ quiet = false } = {}) {
  try {
    new Function(editor.value)()
    localStorage.setItem('hydra-studio-code', editor.value)
    error.textContent = ''
    if (!outputMode) window.hydraLive?.write(editor.value)
    rememberCode()
    updateDirty()
    return true
  } catch (exception) {
    if (!quiet) error.textContent = exception.message
    return false
  }
}

function setCode(code, { resetChat = false } = {}) {
  rememberCode(editor.value)
  editor.value = code
  savedCode = code
  updateHighlight()
  execute()
  updateDirty()
  if (resetChat) resetCodexChat()
  if (!outputMode) editor.focus()
}

function setSketchLabel(info) {
  if (!sketchName || !info) return
  sketchName.textContent = info.name || 'hydra-live.js'
  sketchName.title = info.path || info.name || ''
  updateDirty()
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function findChangedRange(before, after) {
  let start = 0
  const shortest = Math.min(before.length, after.length)
  while (start < shortest && before[start] === after[start]) start += 1

  let suffix = 0
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) suffix += 1

  return {
    start,
    beforeEnd: before.length - suffix,
    afterEnd: after.length - suffix
  }
}

function addCodexMessage(kind, text) {
  if (!codexLog) return null
  const message = document.createElement('div')
  message.className = `codex-message ${kind}`
  const prefix = document.createElement('span')
  prefix.className = 'terminal-prefix'
  prefix.textContent = kind === 'user' ? '> ' : kind === 'assistant' ? 'codex: ' : '// '
  message.append(prefix, document.createTextNode(String(text)))
  codexLog.append(message)
  while (codexLog.children.length > 16) codexLog.firstElementChild?.remove()
  codexLog.scrollTop = codexLog.scrollHeight
  return message
}

function applyCodexStatus(status) {
  if (!codexState || !status) return
  codexState.dataset.state = status.state || 'idle'
  const labels = {
    idle: 'offline',
    starting: 'iniciando',
    ready: 'online',
    thinking: 'pensando',
    'auth-required': 'login',
    'auth-pending': 'autenticando',
    unavailable: 'indisponível',
    error: 'erro'
  }
  codexState.textContent = labels[status.state] || status.state
  codexState.title = status.message || ''
}

function resizeCodexInput() {
  if (!codexInput) return
  codexInput.style.height = 'auto'
  codexInput.style.height = `${Math.min(codexInput.scrollHeight, 120)}px`
}

async function setCodexOpen(open) {
  if (outputMode || !codexPanel) return
  codexOpen = Boolean(open)
  codexPanel.classList.toggle('is-open', codexOpen)
  codexPanel.setAttribute('aria-hidden', codexOpen ? 'false' : 'true')
  document.body.classList.toggle('codex-open', codexOpen)
  if (codexOpen) {
    codexInput?.focus()
    try {
      applyCodexStatus(await window.hydraCodex?.status())
    } catch (exception) {
      applyCodexStatus({ state: 'unavailable', message: exception.message })
    }
  } else if (!codexBusy) {
    editor.focus()
  }
}

async function animateCodeChange(nextCode) {
  const before = editor.value
  if (before === nextCode) return
  rememberCode(before)
  try {
    new Function(nextCode)
  } catch (exception) {
    throw new Error(`O código gerado tem erro de sintaxe: ${exception.message}`)
  }

  const animationId = ++codeAnimationId
  const range = findChangedRange(before, nextCode)
  const replacement = nextCode.slice(range.start, range.afterEnd)
  const line = before.slice(0, range.start).split('\n').length - 1
  const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 31

  document.body.classList.add('codex-editing')
  editor.focus()
  editor.scrollTop = Math.max(0, line * lineHeight - innerHeight * 0.3)
  editor.setSelectionRange(range.start, range.beforeEnd)
  updateHighlight()
  await wait(520)
  if (animationId !== codeAnimationId) return

  editor.setRangeText('', range.start, range.beforeEnd, 'start')
  updateHighlight()
  await wait(170)
  document.body.classList.add('codex-typing')

  const typingDelay = Math.max(4, Math.min(24, Math.round(4000 / Math.max(replacement.length, 1))))
  let cursor = range.start
  let lastPreview = performance.now()
  for (const character of replacement) {
    if (animationId !== codeAnimationId) return
    editor.setRangeText(character, cursor, cursor, 'end')
    cursor += character.length
    updateHighlight()
    const now = performance.now()
    if (now - lastPreview > 130 && /[\n;)]/.test(character)) {
      execute({ quiet: true })
      lastPreview = now
    }
    await wait(typingDelay)
  }

  editor.value = nextCode
  updateHighlight()
  const applied = execute()
  document.body.classList.remove('codex-editing', 'codex-typing')
  if (!applied) {
    const generatedError = error.textContent
    editor.value = before
    updateHighlight()
    execute()
    throw new Error(`O sketch anterior foi restaurado: ${generatedError}`)
  }
  if (codexOpen) codexInput?.focus()
}

async function submitCodexPrompt() {
  if (!codexInput || codexBusy) return
  const instruction = codexInput.value.trim()
  if (!instruction) return
  codexInput.value = ''
  resizeCodexInput()
  addCodexMessage('user', instruction)
  codexBusy = true

  try {
    const status = await window.hydraCodex?.status()
    applyCodexStatus(status)
    if (status?.state === 'auth-required') {
      await window.hydraCodex?.login()
      addCodexMessage('system', 'login aberto no navegador; depois de conectar, envie novamente')
      return
    }
    if (status?.state === 'unavailable') throw new Error(status.message || 'Codex indisponível.')

    const working = addCodexMessage('system', 'lendo o sketch e preparando a alteração...')
    const reply = await window.hydraCodex?.transformSketch(instruction, editor.value)
    working?.remove()
    addCodexMessage('assistant', reply.message)
    const applying = addCodexMessage('system', 'selecionando e reescrevendo o código...')
    await animateCodeChange(reply.sketch)
    applying?.remove()
    addCodexMessage('system', 'sketch aplicado')
  } catch (exception) {
    applyCodexStatus({ state: 'error', message: exception.message })
    addCodexMessage('error-message', exception.message)
  } finally {
    codexBusy = false
    document.body.classList.remove('codex-editing', 'codex-typing')
    if (codexOpen) codexInput.focus()
  }
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

function applyMediaButton(button, enabled, onTitle, offTitle) {
  if (!button) return
  button.dataset.state = enabled ? 'on' : 'off'
  button.setAttribute('aria-pressed', enabled ? 'true' : 'false')
  button.title = enabled ? onTitle : offTitle
}

function stopAudioMeter() {
  cancelAnimationFrame(audioMeterFrame)
  audioMeterFrame = 0
  audioButton?.style.removeProperty('--level')
  if (audioMeter) {
    audioMeter.hidden = true
    audioMeter.setAttribute('aria-hidden', 'true')
  }
  for (const bar of audioBars) bar.style.transform = 'scaleY(0.08)'
}

function updateAudioMeter() {
  stopAudioMeter()
  if (!mediaState.audio || !audioButton) return
  if (audioMeter) {
    audioMeter.hidden = false
    audioMeter.setAttribute('aria-hidden', 'false')
  }
  const tick = () => {
    if (!mediaState.audio || !audioButton) return
    const audio = hydra.synth.a
    const live = Boolean(audio?.meyda || audio?.stream)
    const bins = Array.isArray(audio?.fft) ? audio.fft : [0, 0, 0, 0]
    const vol = Math.min(1, Number(audio?.vol || 0) / 10)
    const levels = [0, 1, 2, 3].map(index => (
      Math.min(1, Math.max(vol * 0.45, Number(bins[index] || 0) * 2.4))
    ))
    const peak = Math.max(vol, ...levels)
    for (const [index, bar] of audioBars.entries()) {
      bar.style.transform = `scaleY(${Math.max(0.08, levels[index] || 0).toFixed(3)})`
    }
    audioButton.dataset.state = live ? (peak > 0.04 ? 'live' : 'on') : 'starting'
    audioButton.style.setProperty('--level', peak.toFixed(3))
    audioButton.setAttribute('aria-pressed', 'true')
    audioButton.title = live
      ? (peak > 0.04
        ? 'Microfone captando som. Clique para desligar.'
        : 'Microfone ligado, sem sinal. Fale perto do mic. Clique para desligar.')
      : 'Abrindo o microfone...'
    audioMeterFrame = requestAnimationFrame(tick)
  }
  tick()
}

function installAudioStub() {
  const fft = [0, 0, 0, 0]
  const stub = {
    fft,
    bins: fft,
    vol: 0,
    setBins() {},
    setSmooth() {},
    setCutoff() {},
    setScale() {},
    hide() {},
    show() {},
    tick() {},
    onBeat() {}
  }
  hydra.synth.a = stub
  window.a = stub
}

function hideAudioMeter(audio) {
  if (!audio) return
  audio.hide?.()
  if (audio.canvas) audio.canvas.style.display = 'none'
}

function setAudioEnabled(enabled) {
  if (enabled) {
    if (!audioReady) {
      hydra._initAudio()
      audioReady = true
    }
    hydra.detectAudio = true
    window.a = hydra.synth.a
    hideAudioMeter(hydra.synth.a)
    return
  }
  hydra.detectAudio = false
  const audio = hydra.synth.a
  audio?.stream?.getTracks?.().forEach(track => track.stop())
  if (audio?.meyda?.stop) audio.meyda.stop()
  audioReady = false
  installAudioStub()
}

function setCameraEnabled(enabled) {
  const source = hydra.s?.[0] || window.s0
  if (!source) return
  if (enabled) {
    source.clear?.()
    source.initCam()
    cameraReady = true
    return
  }
  source.clear?.()
  cameraReady = false
}

function applyMediaState(status) {
  if (!status) return
  const audio = Boolean(status.audio)
  const camera = Boolean(status.camera)
  let rerun = false
  if (audio !== mediaState.audio || (audio && !audioReady)) {
    setAudioEnabled(audio)
    if (audio) rerun = true
  }
  if (camera !== mediaState.camera || (camera && !cameraReady)) {
    setCameraEnabled(camera)
    if (camera) rerun = true
  }
  mediaState = { audio, camera }
  if (audio) updateAudioMeter()
  else {
    stopAudioMeter()
    applyMediaButton(
      audioButton,
      false,
      '',
      'Áudio desligado. Clique para usar o microfone em sketches reativos.'
    )
  }
  applyMediaButton(
    cameraButton,
    camera,
    'Câmera ativa em s0. Clique para desligar.',
    'Câmera desligada. Clique para enviar a webcam para s0.'
  )
  if (rerun) execute({ quiet: true })
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

if (!outputMode && codexInput) {
  codexInput.addEventListener('input', resizeCodexInput)
  codexInput.addEventListener('keydown', event => {
    event.stopPropagation()
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitCodexPrompt()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setCodexOpen(false)
    }
  })
  window.hydraCodex?.subscribe(update => {
    if (update?.type === 'status') applyCodexStatus(update.status)
  })
}

if (!outputMode) {
  document.querySelector('#run').onclick = execute
  document.querySelector('#save').onclick = async () => {
    try {
      const info = await window.hydraSketches?.save(editor.value)
      if (info) {
        savedCode = editor.value
        setSketchLabel(info)
      }
    } catch (exception) {
      error.textContent = exception.message
    }
  }
  document.querySelector('#save-as').onclick = async () => {
    try {
      const info = await window.hydraSketches?.saveAs(editor.value)
      if (info) {
        savedCode = editor.value
        setSketchLabel(info)
      }
    } catch (exception) {
      error.textContent = exception.message
    }
  }
  document.querySelector('#load').onclick = async () => {
    try {
      const sketch = await window.hydraSketches?.open()
      if (sketch?.code != null) {
        setCode(sketch.code, { resetChat: true })
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
        setCode(sketch.code, { resetChat: true })
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
  audioButton.onclick = async () => {
    applyMediaState(await window.hydraMedia?.set({ audio: !mediaState.audio }))
  }
  cameraButton.onclick = async () => {
    applyMediaState(await window.hydraMedia?.set({ camera: !mediaState.camera }))
  }
}

window.addEventListener('keydown', event => {
  if (event.target === codexInput) return
  if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redoCode()
    else undoCode()
    return
  }
  if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    redoCode()
    return
  }
  if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    setCodexOpen(!codexOpen)
    return
  }
  if (event.ctrlKey && event.shiftKey && event.key === 'Enter') {
    event.preventDefault()
    execute()
  }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (!outputMode) document.querySelector('#save-as')?.click()
    return
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
  installAudioStub()
  try {
    const liveCode = await window.hydraLive?.read()
    if (liveCode) editor.value = liveCode
    window.hydraLive?.subscribe(code => {
      if (code === editor.value) return
      rememberCode(editor.value)
      editor.value = code
      savedCode = code
      updateHighlight()
      execute()
      refreshSketchLabel()
    })
    window.hydraMedia?.subscribe(applyMediaState)
    applyMediaState(await window.hydraMedia?.status())
    applySpoutStatus(await window.hydraSpout?.status())
    await refreshSketchLabel()
  } catch (exception) {
    error.textContent = `Arquivo ao vivo: ${exception.message}`
  }
  updateHighlight()
  savedCode = editor.value
  rememberCode(editor.value)
  execute()
  updateDirty()
  if (!outputMode) editor.focus()
}

initializeLiveEditing()

window.addEventListener('resize', () => {
  hydra.setResolution(Math.round(innerWidth * renderScale), Math.round(innerHeight * renderScale))
})
