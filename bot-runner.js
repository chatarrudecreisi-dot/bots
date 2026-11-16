'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const WebSocket = require('ws');
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT || 8080);
const BOT_COUNT = Math.max(1, Number.parseInt(process.env.BOT_COUNT || '5', 10) || 5);
const GAME_WS_URL = process.env.GAME_WS_URL || 'wss://cosa-random-1.onrender.com';
const GAME_FILE = path.join(__dirname, 'comer.html');
const GAME_URL = `http://127.0.0.1:${PORT}/comer.html`;

const httpServer = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/' || pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bot runner activo');
    return;
  }
  if (pathname !== '/comer.html' || !fs.existsSync(GAME_FILE)) {
    res.writeHead(404);
    res.end('No encontrado');
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'
  });
  fs.createReadStream(GAME_FILE).pipe(res);
});

// El HTML de TurboWarp puede abrir una conexión local para su proveedor de
// variables en la nube. Este WSS local conserva el formato de retransmisión.
const wss = new WebSocket.Server({ server: httpServer });
const seats = Array(30).fill(null);
let bufferedMessages = [];

wss.on('connection', (ws) => {
  const seatIndex = seats.findIndex((seat) => seat === null);
  if (seatIndex === -1) {
    ws.send('ERROR,SALA_LLENA');
    ws.close();
    return;
  }
  const seatNumber = seatIndex + 1;
  seats[seatIndex] = ws;
  ws.send(`J${seatNumber}`);
  ws.on('message', (data) => bufferedMessages.push({ sender: ws, text: data.toString() }));
  ws.on('close', () => {
    if (seats[seatIndex] === ws) seats[seatIndex] = null;
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(`DESCONECTADO,J/${seatNumber}/`);
      }
    }
  });
  ws.on('error', (error) => console.error(`WSS J${seatNumber}:`, error.message));
});

setInterval(() => {
  if (!bufferedMessages.length) return;
  const batch = bufferedMessages;
  bufferedMessages = [];
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const outgoing = batch.filter((entry) => entry.sender !== client).map((entry) => entry.text);
    if (outgoing.length) client.send(outgoing.join('|'));
  }
}, 1000 / 60);

let browser;
const pages = [];

async function runBots() {
  if (!fs.existsSync(GAME_FILE)) throw new Error('Falta comer.html en la raíz del repositorio.');
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader']
  });

  for (let i = 0; i < BOT_COUNT; i++) {
    const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
    page.on('pageerror', (error) => console.error(`Error en bot ${i + 1}:`, error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`Consola bot ${i + 1}:`, message.text());
    });

    await page.addInitScript(({ port, gameWsUrl }) => {
      const NativeWebSocket = window.WebSocket;
      function BotRunnerWebSocket(input, protocols) {
        let target = String(input);
        if (/^ws:\/\/localhost:8080(?=\/|$)/i.test(target)) {
          target = `ws://127.0.0.1:${port}`;
        } else if (/^(?:wss?|https?):\/\/(?:cosa-random(?:-1)?\.onrender\.com|192\.168\.1\.13[23]:8080)(?=\/|$)/i.test(target)) {
          target = gameWsUrl;
        }
        return protocols === undefined
          ? new NativeWebSocket(target)
          : new NativeWebSocket(target, protocols);
      }
      BotRunnerWebSocket.prototype = NativeWebSocket.prototype;
      Object.setPrototypeOf(BotRunnerWebSocket, NativeWebSocket);
      window.WebSocket = BotRunnerWebSocket;
    }, { port: PORT, gameWsUrl: GAME_WS_URL });

    await page.goto(GAME_URL, { waitUntil: 'load' });
    pages.push(page);
    console.log(`Bot headless ${i + 1}/${BOT_COUNT} cargado; servidor de juego: ${GAME_WS_URL}`);
  }
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Bot runner escuchando en ${PORT}; abrirá ${BOT_COUNT} instancias.`);
  runBots().catch((error) => console.error('No se pudieron iniciar las instancias:', error));
});

async function stop() {
  for (const page of pages) await page.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  wss.close();
  httpServer.close(() => process.exit(0));
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);


