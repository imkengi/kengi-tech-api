/**
 * cPanel Phusion Passenger entry point
 * This file is required by cPanel's Node.js App Setup.
 * It loads the compiled Express app from dist/ and exports it.
 */

// Load environment variables
require('dotenv').config()

// Set Passenger flag so index.js skips app.listen()
process.env.PASSENGER_BASE_URI = process.env.PASSENGER_BASE_URI || '/'

// Import the compiled app
const app = require('./dist/index').default

// Phusion Passenger expects the app to be exported
module.exports = app
