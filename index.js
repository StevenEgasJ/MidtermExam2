const port = process.env.PORT || 4011;
const express = require('express');
const app = express();
const mongoose = require('mongoose');

// Prefer environment variable; fall back to local 'microphone' database
// Default to Atlas cluster0 microphone DB when no MONGODB_URI is provided.
const defaultAtlas = 'mongodb+srv://juhuh3001_db_user:Espe123@cluster0.olchaay.mongodb.net/microphone?retryWrites=true&w=majority&appName=Cluster0';
const mongoUri = process.env.MONGODB_URI || defaultAtlas;
// Diagnostic: log which URI source we are attempting to use (do not print secrets in production).
console.log('Attempting MongoDB connection to:', process.env.MONGODB_URI ? 'MONGODB_URI (from env)' : 'Atlas default');
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



