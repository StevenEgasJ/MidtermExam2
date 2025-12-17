const express = require('express');
const mongoose = require('mongoose');

const app = express();

/* ===========================
   PORT (Render / Local)
=========================== */
const PORT = process.env.PORT || 4011;

/* ===========================
   MongoDB Connection
=========================== */
// Usa SIEMPRE variables de entorno en producción
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
    console.error('❌ MONGODB_URI is not defined');
    process.exit(1);
}

console.log('Attempting MongoDB connection using environment variable');

mongoose.connect(mongoUri)
    .then(() => {
        console.log('System connected to MongoDb Database');
        console.log('MongoDB database name:', mongoose.connection.name);
    })
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

/* ===========================
   Middleware
=========================== */
app.use(express.json());

/* ===========================
   Routes
=========================== */
const microphoneRoutes = require('./routes/microphone');
app.use('/api/microphone', microphoneRoutes);

/* ===========================
   Server
=========================== */
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Microphone service is running on port ${PORT}`);
});

module.exports = app;
