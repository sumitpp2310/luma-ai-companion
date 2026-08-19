const serverless = require('serverless-http');
const { initDatabase } = require('../../database');
const app = require('../../server');

let initialized = false;

const handler = serverless(app);

module.exports.handler = async (event, context) => {
  // Initialize DB once per cold start
  if (!initialized) {
    await initDatabase();
    initialized = true;
  }
  return handler(event, context);
};
