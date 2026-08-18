const pathToken = location.pathname.replace(/\//g, '')
const queryToken = new URLSearchParams(location.search).get('t') || ''
const token = /^[a-f0-9]{6}$/i.test(pathToken) ? pathToken : queryToken
const editor = document.querySelector('#editor')
const status = document.querySelector('#status')
const nameLabel = document.querySelector('#name')
const error = document.querySelector('#error')
let timer
let sending = false
let lastSent = ''
let lastIncoming = ''
let localEditAt = 0

function setStatus(state, label) {
  status.dataset.state = state
  status.textContent = label
}

function applySketch(payload) {
  if (!payload) return
  if (payload.name) nameLabel.textContent = payload.name
  if (typeof payload.code !== 'string') return
  lastIncoming = payload.code
  if (payload.code === editor.value) return
  if (Date.now() - localEditAt < 900) return
  editor.value = payload.code
  lastSent = payload.code
}

async function sendCode() {
  if (!token || sending) return
  const code = editor.value
  if (code === lastSent) return
  sending = true
  try {
    const response = await fetch(`/api/code?t=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    })
    if (!response.ok) throw new Error('o PC recusou o sketch')
    lastSent = code
    const info = await response.json()
    if (info?.name) nameLabel.textContent = info.name
    error.textContent = ''
  } catch (exception) {
    error.textContent = exception.message || 'falha ao enviar'
    setStatus('wait', 'reconectando')
  } finally {
    sending = false
  }
}

function connect() {
  if (!token) {
    setStatus('off', 'sem token')
    error.textContent = 'abra o QR no Hydra 2 Touch'
    editor.disabled = true
    return
  }
  const source = new EventSource(`/api/events?t=${encodeURIComponent(token)}`)
  source.onopen = () => {
    setStatus('on', 'ligado')
    error.textContent = ''
  }
  source.onerror = () => setStatus('wait', 'reconectando')
  source.onmessage = event => {
    try { applySketch(JSON.parse(event.data)) } catch {}
  }
}

editor.addEventListener('input', () => {
  localEditAt = Date.now()
  clearTimeout(timer)
  timer = setTimeout(sendCode, 500)
})
editor.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault()
    const start = editor.selectionStart
    editor.setRangeText('  ', start, editor.selectionEnd, 'end')
  }
})
document.querySelector('#run').onclick = () => {
  clearTimeout(timer)
  sendCode()
}

connect()
