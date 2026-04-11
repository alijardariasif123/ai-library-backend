// require('dotenv').config();

// const mongoose = require('mongoose');
// const http = require('http');
// const morgan = require('morgan');
// const util = require('util');

// const app = require('./app'); // express app configured in backend/app.js

// const PORT = parseInt(process.env.PORT, 10) || 5000;
// const MONGO_URI = process.env.MONGO_URI;

// // If you prefer a safe default for local dev, uncomment the next line and set a local mongodb:
// // const DEFAULT_LOCAL_MONGO = 'mongodb://127.0.0.1:27017/study-assistant';
// // avoid EventEmitter MaxListeners warnings in worker-heavy apps
// const events = require('events');
// events.EventEmitter.defaultMaxListeners = Math.max(20, events.EventEmitter.defaultMaxListeners);

// // then the rest of server setup...

// // Fail fast if MONGO_URI missing in production, but allow a helpful message for devs.
// if (!MONGO_URI) {
//   console.error('❌ MONGO_URI is not set in environment variables. Please set MONGO_URI in your .env file.');
//   console.error('You can create a local MongoDB and set: MONGO_URI=mongodb://127.0.0.1:27017/study-assistant');
//   // Exit to avoid starting without DB (safer). If you want to allow running without DB for testing,
//   // replace the above `process.exit(1)` with a fallback URI.
//   process.exit(1);
// }

// let server;
// let shuttingDown = false;

// // Recommended mongoose options for stable connections
// const mongooseOptions = {
//   useNewUrlParser: true,
//   useUnifiedTopology: true,
//   serverSelectionTimeoutMS: 10000, // 10s
//   socketTimeoutMS: 45000,
// };

// async function startServer() {
//   try {
//     // attach morgan logger early so startup logs are visible for incoming requests
//     // (if app already uses morgan, duplicate logging may occur; that's fine for debugging)
//     app.use(morgan('dev'));

//     // Connect to MongoDB
//     console.log('🔌 Connecting to MongoDB...');
//     await mongoose.connect(MONGO_URI, mongooseOptions);

//     // Helpful connection events
//     mongoose.connection.on('connected', () => console.log('✅ MongoDB connected'));
//     mongoose.connection.on('reconnected', () => console.log('🔁 MongoDB reconnected'));
//     mongoose.connection.on('disconnected', () => console.warn('⚠️ MongoDB disconnected'));
//     mongoose.connection.on('error', (err) => console.error('❌ MongoDB connection error:', err));

//     // Create HTTP server and start listening
//     server = http.createServer(app);

//     server.listen(PORT, () => {
//       console.log(`🚀 Backend server running on port ${PORT}`);
//     });

//     // Graceful shutdown handlers
//     process.on('SIGINT', () => shutdown('SIGINT'));
//     process.on('SIGTERM', () => shutdown('SIGTERM'));

//     // Catch unhandled rejections and uncaught exceptions to log and exit gracefully
//     process.on('unhandledRejection', (reason, promise) => {
//       console.error('Unhandled Rejection at:', promise, 'reason:', reason);
//       // optionally notify monitoring here
//     });

//     process.on('uncaughtException', (err) => {
//       console.error('Uncaught Exception:', err);
//       // After logging, exit — uncaught exceptions may leave process in bad state
//       // Give a moment for logs to flush then exit.
//       setTimeout(() => process.exit(1), 100);
//     });

//   } catch (err) {
//     console.error('❌ Failed to start server:', err);
//     process.exit(1);
//   }
// }

// async function shutdown(signal) {
//   if (shuttingDown) return;
//   shuttingDown = true;
//   console.log(`\n🛑 Shutting down gracefully (signal: ${signal})...`);
//   try {
//     // Stop accepting new connections
//     if (server) {
//       const closeServer = util.promisify(server.close).bind(server);
//       await closeServer();
//       console.log('HTTP server closed');
//     }

//     // Close mongoose connection (if connected)
//     if (mongoose.connection.readyState === 1 /* connected */) {
//       await mongoose.disconnect();
//       console.log('MongoDB disconnected');
//     }

//     // small delay to allow logs to flush
//     setTimeout(() => process.exit(0), 100);
//   } catch (err) {
//     console.error('Error during shutdown', err);
//     setTimeout(() => process.exit(1), 100);
//   }
// }

// // Start the server
// startServer();

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