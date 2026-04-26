require('dotenv').config();

const mongoose = require('mongoose');
const http = require('http');
const morgan = require('morgan');
const util = require('util');

const app = require('./app');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const MONGO_URI = process.env.MONGO_URI;

require('events').defaultMaxListeners = 20;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI missing');
  process.exit(1);
}

let server;
let shuttingDown = false;

const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
};

async function connectMongo() {
  let retries = 5;
  while (retries) {
    try {
      console.log('🔌 Connecting to MongoDB...');
      await mongoose.connect(MONGO_URI, mongooseOptions);
      console.log('✅ MongoDB connected');
      return;
    } catch (err) {
      console.log(`Retry MongoDB... (${retries})`);
      retries--;
      await new Promise(res => setTimeout(res, 3000));
    }
  }
  throw new Error('MongoDB connection failed');
}

async function startServer() {
  try {
    console.log(`ENV: ${process.env.NODE_ENV || 'development'}`);

    if (process.env.NODE_ENV !== 'production') {
      app.use(morgan('dev'));
    }

    await connectMongo();

    mongoose.connection.on('disconnected', () =>
      console.warn('⚠️ MongoDB disconnected')
    );

    server = http.createServer(app);

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    server.on('error', (err) => {
      console.error('❌ Server error:', err);
    });

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled Rejection:', reason);
    });

    process.on('uncaughtException', (err) => {
      console.error('Uncaught Exception:', err);
      setTimeout(() => process.exit(1), 100);
    });

  } catch (err) {
    console.error('❌ Startup failed:', err);
    process.exit(1);
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`🛑 Shutting down (${signal})`);

  try {
    if (server) {
      const closeServer = util.promisify(server.close).bind(server);
      await closeServer();
    }

    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }

    setTimeout(() => process.exit(0), 100);

  } catch (err) {
    console.error('Shutdown error:', err);
    process.exit(1);
  }
}

startServer();