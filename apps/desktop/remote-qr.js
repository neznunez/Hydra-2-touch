const qrcode = require('./vendor/qrcode-generator')

function qrDataUrl(text) {
  const qr = qrcode(0, 'M')
  qr.addData(String(text), 'Byte')
  qr.make()
  return qr.createDataURL(4, 8)
}

module.exports = { qrDataUrl }
