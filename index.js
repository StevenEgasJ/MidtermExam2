const port = process.env.PORT || 4011;
const express = require('express');
const app = express();
const mongoose = require('mongoose');

// Prefer environment variable; fall back to local 'microphone' database
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/microphone';
// Diagnostic: log which URI (or placeholder) we are attempting to use.
console.log('Attempting MongoDB connection to:', process.env.MONGODB_URI ? 'MONGODB_URI (from env)' : mongoUri);
// Connect with default options; modern drivers manage parsing and topology automatically.
mongoose.connect(mongoUri);

const db = mongoose.connection;
db.on('error', (error) => console.error('Mongo connection error:', error));
db.once('open', () => {
    try {
        console.log('System connected to MongoDb Database');
        console.log('MongoDB database name:', db.name);
    } catch (err) {
        console.error('Error while reporting DB info:', err);
    }
});
app.use(express.json());

const microphoneRoutes = require('./routes/microphone');

app.use('/api/microphone', microphoneRoutes);

app.listen(port, '0.0.0.0', () => {
    console.log(`Microphone service is running on port ${port}`);
});

module.exports = app;



