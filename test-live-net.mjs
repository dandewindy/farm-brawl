import WebSocket from 'ws';

const ws = new WebSocket('wss://farm-brawl.farm-brawl.workers.dev/ws?room=pub-1');
const pings = [];
const snaps = [];

ws.on('open', () => {
  console.log('WS OPENED');
  ws.send(JSON.stringify({ t: 'join', name: 'NetTester', species: 'pig' }));
  const timer = setInterval(() => {
    ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
  }, 200);

  setTimeout(() => {
    clearInterval(timer);
    ws.close();
    console.log('--- RESULTS ---');
    console.log('Ping samples:', pings);
    const deltas = [];
    for (let i = 1; i < snaps.length; i++) {
      deltas.push(snaps[i] - snaps[i - 1]);
    }
    console.log('Snapshot arrival deltas (ms):', deltas);
    const rtts = pings.map(p => p.rtt);
    const min = Math.min(...rtts);
    const max = Math.max(...rtts);
    const avg = Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length);
    console.log(`Min: ${min}ms, Max: ${max}ms, Avg: ${avg}ms`);
  }, 4000);
});

ws.on('message', (data) => {
  const str = data.toString();
  if (str.startsWith('{"t":"pong"')) {
    const p = JSON.parse(str);
    const rtt = Date.now() - p.c;
    pings.push({ rtt, colo: p.colo, doColo: p.doColo });
  } else if (str.startsWith('{"t":"s"')) {
    snaps.push(Date.now());
  }
});

ws.on('error', (err) => console.error('WS Error:', err));
