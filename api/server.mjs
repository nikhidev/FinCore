import {app} from './app.mjs';
import {pool,setup} from './db.mjs';
await setup();
const server = app.listen(Number(process.env.PORT || 4000),process.env.API_HOST || '127.0.0.1',() => console.log('FinCore API ready'));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(() => pool.end()));
