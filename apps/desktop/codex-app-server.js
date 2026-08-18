const { spawn, execFileSync } = require('child_process')
const readline = require('readline')
const path = require('path')
const fs = require('fs')

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    sketch: { type: 'string' }
  },
  required: ['message', 'sketch'],
  additionalProperties: false
}

const SYSTEM_PROMPT = `You are the visual coding assistant inside Hydra 2 Touch.
Your only task is to transform the Hydra sketch supplied by the application.
Never run commands, edit files, inspect unrelated folders, or change application code.
Preserve useful comments and return a complete executable Hydra JavaScript sketch.
Prefer native Hydra functions and concise, performance-conscious code.
The message must be short, in Brazilian Portuguese, and describe the visual change.`

function resolveCodexExecutable() {
  if (process.env.HYDRA_CODEX_PATH) {
    return { command: process.env.HYDRA_CODEX_PATH, args: [], env: process.env }
  }

  const packageRoots = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex'),
    path.join(__dirname, 'node_modules', '@openai', 'codex')
  ].filter(Boolean)
  const nativeCandidates = packageRoots.flatMap(packageRoot => [
    {
      packageRoot,
      executable: path.join(
        packageRoot,
        'node_modules',
        '@openai',
        'codex-win32-x64',
        'vendor',
        'x86_64-pc-windows-msvc',
        'bin',
        'codex.exe'
      )
    },
    {
      packageRoot,
      executable: path.join(
        packageRoot,
        'vendor',
        'x86_64-pc-windows-msvc',
        'bin',
        'codex.exe'
      )
    }
  ])
  const nativeCodex = nativeCandidates.find(candidate => fs.existsSync(candidate.executable))
  if (nativeCodex) {
    return {
      command: nativeCodex.executable,
      args: [],
      env: {
        ...process.env,
        CODEX_MANAGED_PACKAGE_ROOT: nativeCodex.packageRoot,
        CODEX_MANAGED_BY_NPM: '1'
      }
    }
  }

  try {
    const matches = execFileSync('where.exe', ['codex'], {
      encoding: 'utf8',
      windowsHide: true
    }).split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    const executable = matches.find(value => {
      const lower = value.toLowerCase()
      return lower.endsWith('.exe') && !lower.includes('windowsapps\\openai.codex_')
    })
    if (executable) return { command: executable, args: [], env: process.env }
  } catch {
    // A mensagem abaixo orienta a instalação quando a CLI não está disponível.
  }
  throw new Error('CLI do Codex não encontrada. Instale com: npm install -g @openai/codex')
}

function parseStructuredReply(text) {
  const source = String(text || '').trim()
  const unfenced = source
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const firstBrace = unfenced.indexOf('{')
  const lastBrace = unfenced.lastIndexOf('}')
  const json = firstBrace >= 0 && lastBrace > firstBrace
    ? unfenced.slice(firstBrace, lastBrace + 1)
    : unfenced
  const result = JSON.parse(json)
  if (!result || typeof result.message !== 'string' || typeof result.sketch !== 'string') {
    throw new Error('O Codex respondeu em um formato inesperado.')
  }
  if (!result.sketch.trim()) throw new Error('O Codex retornou um sketch vazio.')
  return result
}

class CodexAppServer {
  constructor({ cwd, onEvent }) {
    this.cwd = cwd
    this.onEvent = onEvent
    this.process = null
    this.started = null
    this.nextId = 1
    this.pending = new Map()
    this.threadId = null
    this.account = null
    this.requiresOpenaiAuth = true
    this.turnMessages = new Map()
    this.turnWaiters = new Map()
    this.finishedTurns = new Map()
    this.status = { state: 'idle', message: 'Codex pronto para iniciar' }
  }

  emit(type, detail = {}) {
    this.onEvent?.({ type, ...detail })
  }

  setStatus(state, message, detail = {}) {
    this.status = { state, message, ...detail }
    this.emit('status', { status: this.status })
  }

  async start() {
    if (this.started) return this.started
    this.started = this.launch().catch(error => {
      this.started = null
      this.setStatus('unavailable', error.message)
      throw error
    })
    return this.started
  }

  async launch() {
    this.setStatus('starting', 'Iniciando Codex...')
    const executable = resolveCodexExecutable()
    const child = spawn(executable.command, [...executable.args, 'app-server'], {
      cwd: this.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: executable.env
    })
    this.process = child

    child.once('error', error => this.handleExit(error))
    child.once('exit', code => this.handleExit(new Error(`Codex encerrou com código ${code ?? 'desconhecido'}.`)))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', data => {
      const message = String(data).trim()
      if (message) this.emit('diagnostic', { message })
    })

    const lines = readline.createInterface({ input: child.stdout })
    lines.on('line', line => this.handleLine(line))

    await this.request('initialize', {
      clientInfo: {
        name: 'hydra_2_touch',
        title: 'Hydra 2 Touch',
        version: '1.0.0'
      }
    })
    this.notify('initialized', {})
    await this.refreshAccount()
    return this.status
  }

  handleExit(error) {
    if (!this.process) return
    this.process = null
    this.threadId = null
    for (const { reject } of this.pending.values()) reject(error)
    this.pending.clear()
    for (const { reject, timeout } of this.turnWaiters.values()) {
      clearTimeout(timeout)
      reject(error)
    }
    this.turnWaiters.clear()
    this.setStatus('unavailable', error.message)
  }

  handleLine(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }

    if (message.id != null && !message.method) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || 'Falha no Codex.'))
      else pending.resolve(message.result)
      return
    }

    if (message.id != null && message.method) {
      this.respond(message.id, { decision: 'decline' })
      return
    }

    this.handleNotification(message.method, message.params || {})
  }

  handleNotification(method, params) {
    if (method === 'account/updated') {
      if (params.authMode) {
        this.setStatus('ready', 'Codex conectado', { authMode: params.authMode, planType: params.planType })
      } else {
        this.setStatus('auth-required', 'Entre no ChatGPT para usar o Codex')
      }
      return
    }

    if (method === 'account/login/completed') {
      if (params.success) this.refreshAccount().catch(() => {})
      else this.setStatus('auth-required', params.error || 'Login não concluído')
      return
    }

    if (method === 'item/agentMessage/delta') {
      const turnId = params.turnId
      if (turnId) {
        const previous = this.turnMessages.get(turnId) || ''
        this.turnMessages.set(turnId, previous + String(params.delta || ''))
      }
      return
    }

    if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      const turnId = params.turnId
      if (turnId && params.item.phase !== 'commentary') {
        this.turnMessages.set(turnId, String(params.item.text || ''))
      }
      return
    }

    if (method === 'turn/completed') {
      const turn = params.turn || {}
      const outcome = {
        status: turn.status,
        error: turn.error?.message,
        text: this.turnMessages.get(turn.id) || ''
      }
      this.turnMessages.delete(turn.id)
      const waiter = this.turnWaiters.get(turn.id)
      if (waiter) {
        clearTimeout(waiter.timeout)
        this.turnWaiters.delete(turn.id)
        waiter.resolve(outcome)
      } else if (turn.id) {
        this.finishedTurns.set(turn.id, outcome)
      }
      return
    }

    if (method === 'error') {
      const message = params.error?.message || 'Falha no Codex.'
      this.emit('diagnostic', { message })
    }
  }

  request(method, params = {}) {
    if (!this.process?.stdin?.writable) return Promise.reject(new Error('Codex não está disponível.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.process.stdin.write(`${JSON.stringify({ method, id, params })}\n`)
    })
  }

  notify(method, params = {}) {
    if (!this.process?.stdin?.writable) return
    this.process.stdin.write(`${JSON.stringify({ method, params })}\n`)
  }

  respond(id, result) {
    if (!this.process?.stdin?.writable) return
    this.process.stdin.write(`${JSON.stringify({ id, result })}\n`)
  }

  async refreshAccount() {
    const result = await this.request('account/read', { refreshToken: false })
    this.account = result?.account || null
    this.requiresOpenaiAuth = Boolean(result?.requiresOpenaiAuth)
    if (this.account || !this.requiresOpenaiAuth) {
      this.setStatus('ready', 'Codex conectado', {
        authMode: this.account?.type || 'external',
        planType: this.account?.planType || null
      })
    } else {
      this.setStatus('auth-required', 'Entre no ChatGPT para usar o Codex')
    }
    return this.status
  }

  async login() {
    await this.start()
    const result = await this.request('account/login/start', {
      type: 'chatgpt',
      useHostedLoginSuccessPage: true,
      appBrand: 'codex'
    })
    this.setStatus('auth-pending', 'Conclua o login no navegador')
    return result
  }

  async ensureThread() {
    if (this.threadId) return this.threadId
    const result = await this.request('thread/start', {
      cwd: this.cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      personality: 'friendly',
      serviceName: 'hydra_2_touch'
    })
    this.threadId = result?.thread?.id
    if (!this.threadId) throw new Error('Não foi possível iniciar a conversa com o Codex.')
    return this.threadId
  }

  waitForTurn(turnId) {
    const finished = this.finishedTurns.get(turnId)
    if (finished) {
      this.finishedTurns.delete(turnId)
      return Promise.resolve(finished)
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.turnWaiters.delete(turnId)
        reject(new Error('O Codex demorou demais para responder.'))
      }, 180000)
      this.turnWaiters.set(turnId, { resolve, reject, timeout })
    })
  }

  async transformSketch(instruction, sketch) {
    await this.start()
    if (!this.account && this.requiresOpenaiAuth) {
      const error = new Error('Entre no ChatGPT para usar o Codex.')
      error.code = 'AUTH_REQUIRED'
      throw error
    }
    const threadId = await this.ensureThread()
    this.setStatus('thinking', 'Codex está lendo o sketch...')
    const prompt = `${SYSTEM_PROMPT}\n\nPEDIDO DO USUÁRIO:\n${instruction}\n\nSKETCH ATUAL:\n\`\`\`javascript\n${sketch}\n\`\`\``
    const result = await this.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }],
      cwd: this.cwd,
      approvalPolicy: 'never',
      sandboxPolicy: {
        type: 'readOnly'
      },
      effort: 'medium',
      summary: 'concise',
      outputSchema: RESPONSE_SCHEMA
    })
    const turnId = result?.turn?.id
    if (!turnId) throw new Error('O Codex não iniciou a alteração.')
    const outcome = await this.waitForTurn(turnId)
    if (outcome.status !== 'completed') throw new Error(outcome.error || 'O Codex não concluiu a alteração.')
    const reply = parseStructuredReply(outcome.text)
    this.setStatus('ready', 'Codex conectado', {
      authMode: this.account?.type || 'external',
      planType: this.account?.planType || null
    })
    return reply
  }

  newThread() {
    this.threadId = null
  }

  stop() {
    const child = this.process
    this.process = null
    this.started = null
    if (child && !child.killed) child.kill()
  }
}

module.exports = { CodexAppServer, parseStructuredReply }
