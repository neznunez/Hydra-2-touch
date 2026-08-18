const http = require('http')
const os = require('os')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { qrDataUrl } = require('./remote-qr')

const PREFERRED_PORT = 17321
const MAX_CODE = 100000
const FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/remote.css': 'remote.css',
  '/remote.js': 'remote.js'
}
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
}

function lanAddresses() {
  const ranked = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/virtual|vethernet|vmware|vbox|hyper-v|loopback|docker|wsl|bluetooth|radmin|zerotier/i.test(name)) continue
    for (const addr of addrs || []) {
      const family = addr.family === 4 || addr.family === 'IPv4'
      if (!family || addr.internal) continue
      if (addr.address.startsWith('169.254.')) continue
      const score = /wi-?fi|wlan|wireless/i.test(name) ? 2 : /ethernet|eth|lan/i.test(name) ? 1 : 0
      ranked.push({ name, address: addr.address, score })
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address))
  return ranked
}

function isPrivateAddress(raw) {
  const ip = String(raw || '').replace('::ffff:', '')
  if (ip === '127.0.0.1' || ip === '::1') return true
  if (ip.startsWith('10.')) return true
  if (ip.startsWith('192.168.')) return true
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1])
    return second >= 16 && second <= 31
  }
  return false
}

function tokenOk(expected, given) {
  const left = Buffer.from(String(expected || ''))
  const right = Buffer.from(String(given || ''))
  if (!left.length || left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

class RemoteEditorServer {
  constructor({ root, getCode, setCode, getSketchName, onStatus }) {
    this.root = root
    this.getCode = getCode
    this.setCode = setCode
    this.getSketchName = getSketchName
    this.onStatus = onStatus
    this.server = null
    this.token = ''
    this.port = 0
    this.clients = new Set()
  }

  status() {
    const addresses = lanAddresses()
    const urls = addresses.map(item => `http://${item.address}:${this.port}/${this.token}`)
    const url = urls[0] || (this.port ? `http://127.0.0.1:${this.port}/${this.token}` : '')
    let qr = ''
    if (url) {
      try { qr = qrDataUrl(url) } catch {}
    }
    return {
      enabled: Boolean(this.server),
      port: this.port,
      token: this.token,
      url,
      urls,
      qr,
      clients: this.clients.size,
      addresses: addresses.map(item => item.address),
      error: this.server && !addresses.length ? 'Ligue o Wi-Fi do PC na mesma rede do celular.' : ''
    }
  }

  emitStatus() {
    this.onStatus?.(this.status())
  }

  pushCode(code) {
    const payload = JSON.stringify({
      type: 'code',
      code: String(code ?? ''),
      name: this.getSketchName?.() || 'hydra-live.js'
    })
    for (const client of this.clients) {
      try { client.write(`data: ${payload}\n\n`) } catch {}
    }
  }

  async start() {
    if (this.server) return this.status()
    this.token = crypto.randomBytes(3).toString('hex')
    this.server = http.createServer((request, response) => this.handle(request, response))
    this.server.on('error', () => {
      this.server = null
      this.port = 0
      this.emitStatus()
    })
    for (let port = PREFERRED_PORT; port < PREFERRED_PORT + 10; port += 1) {
      try {
        await new Promise((resolve, reject) => {
          const onError = error => reject(error)
          this.server.once('error', onError)
          this.server.listen(port, '0.0.0.0', () => {
            this.server.off('error', onError)
            this.port = port
            resolve()
          })
        })
        this.emitStatus()
        return this.status()
      } catch (error) {
        if (error.code !== 'EADDRINUSE') {
          this.stop()
          throw error
        }
      }
    }
    this.stop()
    throw new Error('Não foi possível abrir a porta de rede do celular.')
  }

  stop() {
    for (const client of this.clients) {
      try { client.end() } catch {}
    }
    this.clients.clear()
    if (this.server) {
      this.server.close()
      this.server = null
    }
    this.port = 0
    this.token = ''
    this.emitStatus()
    return this.status()
  }

  handle(request, response) {
    const remote = request.socket.remoteAddress
    if (!isPrivateAddress(remote)) {
      response.writeHead(403)
      response.end('forbidden')
      return
    }
    const url = new URL(request.url, 'http://127.0.0.1')
    const pathToken = (url.pathname.match(/^\/([a-f0-9]{6})\/?$/) || [])[1]
    const file = FILES[url.pathname]
    if (file) {
      this.sendFile(response, file)
      return
    }
    if (pathToken) {
      if (!tokenOk(this.token, pathToken)) {
        response.writeHead(401)
        response.end('token')
        return
      }
      this.sendFile(response, 'index.html')
      return
    }
    if (!tokenOk(this.token, url.searchParams.get('t'))) {
      response.writeHead(401)
      response.end('token')
      return
    }
    if (url.pathname === '/api/status' && request.method === 'GET') {
      this.json(response, {
        name: this.getSketchName?.() || 'hydra-live.js',
        code: this.getCode?.() || '',
        clients: this.clients.size
      })
      return
    }
    if (url.pathname === '/api/events' && request.method === 'GET') {
      this.openEvents(response)
      return
    }
    if (url.pathname === '/api/code' && request.method === 'POST') {
      this.readBody(request).then(body => {
        let parsed
        try { parsed = JSON.parse(body || '{}') } catch {
          response.writeHead(400)
          response.end('json')
          return
        }
        const code = String(parsed.code ?? '')
        if (code.length > MAX_CODE) {
          response.writeHead(413)
          response.end('size')
          return
        }
        this.setCode?.(code)
        this.json(response, { ok: true, name: this.getSketchName?.() || 'hydra-live.js' })
      }).catch(() => {
        response.writeHead(400)
        response.end('body')
      })
      return
    }
    response.writeHead(404)
    response.end('not found')
  }

  sendFile(response, name) {
    const root = path.resolve(this.root)
    const filePath = path.resolve(root, path.basename(name))
    if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath)) {
      response.writeHead(404)
      response.end('missing')
      return
    }
    const type = TYPES[path.extname(name)] || 'application/octet-stream'
    response.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store'
    })
    fs.createReadStream(filePath).pipe(response)
  }

  json(response, payload) {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    response.end(JSON.stringify(payload))
  }

  openEvents(response) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    })
    response.write('\n')
    this.clients.add(response)
    this.emitStatus()
    this.pushCode(this.getCode?.() || '')
    const tick = setInterval(() => {
      try { response.write(': ping\n\n') } catch {}
    }, 15000)
    response.on('close', () => {
      clearInterval(tick)
      this.clients.delete(response)
      this.emitStatus()
    })
  }

  readBody(request) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      request.on('data', chunk => {
        size += chunk.length
        if (size > MAX_CODE + 2048) {
          request.destroy()
          reject(new Error('size'))
          return
        }
        chunks.push(chunk)
      })
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      request.on('error', reject)
    })
  }
}

module.exports = { RemoteEditorServer }
