const { contextBridge } = require('electron');

const QRCode = require('qrcode');

contextBridge.exposeInMainWorld('pfQr', {
  toDataURL: async (text, opts = {}) => {
    const value = String(text ?? '');
    return await QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 8,
      scale: 8,
      type: 'image/png',
      color: { dark: '#000000ff', light: '#ffffffff' },
      ...opts,
    });
  },
});

